//! MongoDB driver.
//!
//! Value representation: every BSON value is exposed to the frontend as *relaxed
//! Extended JSON v2* (`Bson::into_relaxed_extjson`):
//! ObjectId → `{"$oid": "<hex>"}`, dates → `{"$date": "<ISO-8601>"}`, Int32/Int64/Double →
//! plain JSON numbers, Decimal128 → `{"$numberDecimal": ".."}`, binary → `{"$binary": {..}}`,
//! nested documents/arrays stay JSON objects/arrays. Values coming back (table filters,
//! grid edits) are parsed with the same conventions, so a cell round-trips unchanged.
//!
//! Tree: `[]` → databases; `[db]` → folders `collections` / `views`;
//! `[db, "collections"]` → collections; `[db, "collections", coll]` → indexes.
//!
//! `execute` understands a practical mongo-shell subset (see `ShellParser` and
//! `MongoDriver::run_statement`); arguments may use relaxed JSON5-ish syntax
//! (unquoted keys, single quotes, trailing commas, comments, `ObjectId("..")`,
//! `ISODate("..")`, `NumberLong(..)`, regex literals, ...).
use super::*;
use crate::db::ssh::{open_endpoint, SshTunnel};
use crate::error::{AppError, AppResult};
use crate::models::{ConnectionConfig, ConnectionKind};
use async_trait::async_trait;
use base64::Engine;
use futures::TryStreamExt;
use mongodb::bson::{self, doc, oid::ObjectId, Bson, Document};
use mongodb::options::{ClientOptions, Credential, ServerAddress, Tls, TlsOptions};
use mongodb::{Client, Database};
use serde_json::json;
use std::collections::HashMap;
use std::time::{Duration, Instant};

/// Documents sampled to infer a collection structure.
const SAMPLE_SIZE: i64 = 100;

pub struct MongoDriver {
    client: Client,
    default_db: Option<String>,
    read_only: bool,
    _tunnel: Option<SshTunnel>,
}

fn is_tls(cfg: &ConnectionConfig) -> bool {
    matches!(cfg.ssl_mode.as_deref(), Some("require") | Some("verify-ca") | Some("verify-full"))
}

impl MongoDriver {
    pub async fn connect(cfg: &ConnectionConfig) -> AppResult<Self> {
        let ssh_on = cfg.ssh.as_ref().map(|s| s.enabled).unwrap_or(false);
        let trust = cfg.options.get("trustCert").map(|v| v == "true").unwrap_or(false);
        let mut tunnel = None;
        let url = cfg.url.as_deref().map(str::trim).filter(|u| !u.is_empty());

        let mut opts = match url {
            Some(url) => {
                let mut o = ClientOptions::parse(url).await?;
                if ssh_on {
                    if url.starts_with("mongodb+srv://") {
                        return Err(AppError::msg("SSH tunnelling is not supported with mongodb+srv:// URIs"));
                    }
                    let (host, port) = match o.hosts.first() {
                        Some(ServerAddress::Tcp { host, port }) => (host.clone(), port.unwrap_or(27017)),
                        _ => return Err(AppError::msg("SSH tunnelling needs a TCP host in the URI")),
                    };
                    let mut c = cfg.clone();
                    c.host = host;
                    c.port = Some(port);
                    let ep = open_endpoint(&c, 27017).await?;
                    o.hosts = vec![ServerAddress::Tcp { host: ep.host.clone(), port: Some(ep.port) }];
                    o.direct_connection = Some(true);
                    tunnel = ep.tunnel;
                }
                o
            }
            None => {
                let ep = open_endpoint(cfg, 27017).await?;
                let mut o = ClientOptions::default();
                o.hosts = vec![ServerAddress::Tcp { host: ep.host.clone(), port: Some(ep.port) }];
                // GUI connections target one server; don't follow replica-set member hostnames.
                o.direct_connection = Some(true);
                if !cfg.user.is_empty() {
                    let mut cred = Credential::default();
                    cred.username = Some(cfg.user.clone());
                    cred.password = cfg.password.clone();
                    cred.source = Some(cfg.options.get("authSource").cloned().unwrap_or_else(|| "admin".into()));
                    o.credential = Some(cred);
                }
                if is_tls(cfg) {
                    let mut t = TlsOptions::default();
                    if trust {
                        t.allow_invalid_certificates = Some(true);
                    }
                    o.tls = Some(Tls::Enabled(t));
                }
                tunnel = ep.tunnel;
                o
            }
        };
        opts.app_name = Some("DevCat".into());
        opts.connect_timeout.get_or_insert(Duration::from_secs(10));
        opts.server_selection_timeout.get_or_insert(Duration::from_secs(10));
        let default_db = cfg
            .database
            .clone()
            .filter(|d| !d.is_empty())
            .or_else(|| opts.default_database.clone());

        let client = Client::with_options(opts)?;
        client.database("admin").run_command(doc! { "ping": 1 }).await?;
        Ok(MongoDriver { client, default_db, read_only: cfg.read_only, _tunnel: tunnel })
    }

    fn db_name(&self, db: Option<&str>) -> String {
        db.filter(|d| !d.is_empty())
            .map(str::to_string)
            .or_else(|| self.default_db.clone())
            .unwrap_or_else(|| "test".into())
    }

    fn check_writable(&self) -> AppResult<()> {
        if self.read_only {
            return Err(AppError::msg("Connection is read-only"));
        }
        Ok(())
    }

    /// Raw `listCollections` documents (`name`, `type`, `options`, `info`).
    async fn collection_infos(&self, db: &Database, name: Option<&str>) -> AppResult<Vec<Document>> {
        let mut cmd = doc! { "listCollections": 1, "authorizedCollections": true };
        if let Some(n) = name {
            cmd.insert("filter", doc! { "name": n });
            cmd.remove("authorizedCollections");
        }
        let res = db.run_command(cmd).await?;
        let mut out = first_batch(&res);
        out.sort_by(|a, b| a.get_str("name").unwrap_or("").cmp(b.get_str("name").unwrap_or("")));
        Ok(out)
    }

    async fn index_docs(&self, db: &Database, coll: &str) -> AppResult<Vec<Document>> {
        let res = db.run_command(doc! { "listIndexes": coll }).await?;
        Ok(first_batch(&res))
    }

    async fn sample(&self, db: &Database, coll: &str) -> AppResult<Vec<Document>> {
        let c = db.collection::<Document>(coll);
        Ok(c.find(doc! {}).limit(SAMPLE_SIZE).await?.try_collect().await?)
    }

    async fn structure_of(&self, db_name: &str, coll: &str) -> AppResult<TableStructure> {
        let db = self.client.database(db_name);
        let docs = self.sample(&db, coll).await?;
        let indexes = self.index_docs(&db, coll).await.unwrap_or_default();

        let mut order: Vec<String> = Vec::new();
        let mut stats: HashMap<String, (Vec<&'static str>, usize, bool)> = HashMap::new();
        for d in &docs {
            for (k, v) in d {
                let e = stats.entry(k.clone()).or_insert_with(|| {
                    order.push(k.clone());
                    (Vec::new(), 0, false)
                });
                e.1 += 1;
                if matches!(v, Bson::Null) {
                    e.2 = true;
                } else {
                    let t = bson_type_name(v);
                    if !e.0.contains(&t) {
                        e.0.push(t);
                    }
                }
            }
        }
        if let Some(p) = order.iter().position(|k| k == "_id") {
            let id = order.remove(p);
            order.insert(0, id);
        }
        let columns = order
            .iter()
            .enumerate()
            .map(|(i, k)| {
                let (types, seen, has_null) = &stats[k];
                ColumnDef {
                    name: k.clone(),
                    data_type: if types.is_empty() { "null".into() } else { types.join("|") },
                    nullable: *has_null || *seen < docs.len(),
                    default: None,
                    is_primary_key: k == "_id",
                    auto_increment: false,
                    comment: None,
                    ordinal: i as u32 + 1,
                }
            })
            .collect();

        let indexes = indexes.iter().map(index_def).collect();
        Ok(TableStructure {
            table: Some(TableRef { database: Some(db_name.into()), schema: None, name: coll.into() }),
            columns,
            indexes,
            foreign_keys: vec![],
            comment: Some(format!("Inferred from a sample of {} documents", docs.len())),
        })
    }
}

fn first_batch(res: &Document) -> Vec<Document> {
    res.get_document("cursor")
        .ok()
        .and_then(|c| c.get_array("firstBatch").ok())
        .map(|a| a.iter().filter_map(|b| b.as_document().cloned()).collect())
        .unwrap_or_default()
}

fn index_def(d: &Document) -> IndexDef {
    let name = d.get_str("name").unwrap_or("").to_string();
    let key = d.get_document("key").cloned().unwrap_or_default();
    let method = key.values().find_map(|v| v.as_str().map(str::to_string));
    IndexDef {
        columns: key.keys().cloned().collect(),
        unique: d.get_bool("unique").unwrap_or(false) || name == "_id_",
        primary: name == "_id_",
        method,
        name,
    }
}

pub fn bson_type_name(v: &Bson) -> &'static str {
    match v {
        Bson::Double(_) => "double",
        Bson::String(_) => "string",
        Bson::Array(_) => "array",
        Bson::Document(_) => "object",
        Bson::Boolean(_) => "bool",
        Bson::Null => "null",
        Bson::RegularExpression(_) => "regex",
        Bson::JavaScriptCode(_) => "javascript",
        Bson::JavaScriptCodeWithScope(_) => "javascriptWithScope",
        Bson::Int32(_) => "int",
        Bson::Int64(_) => "long",
        Bson::Timestamp(_) => "timestamp",
        Bson::Binary(_) => "binData",
        Bson::ObjectId(_) => "objectId",
        Bson::DateTime(_) => "date",
        Bson::Symbol(_) => "symbol",
        Bson::Decimal128(_) => "decimal",
        Bson::Undefined => "undefined",
        Bson::MaxKey => "maxKey",
        Bson::MinKey => "minKey",
        Bson::DbPointer(_) => "dbPointer",
    }
}

fn to_json(b: Bson) -> Value {
    b.into_relaxed_extjson()
}

fn doc_json(d: Document) -> Value {
    Bson::Document(d).into_relaxed_extjson()
}

/// Turn a page of documents into a grid: columns are the union of top-level
/// fields (`_id` first, then first-seen order), missing fields are null.
pub fn docs_to_table(docs: Vec<Document>) -> (Vec<ColumnInfo>, Vec<Vec<Value>>) {
    let mut names: Vec<String> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut types: Vec<Vec<&'static str>> = Vec::new();
    if docs.iter().any(|d| d.contains_key("_id")) {
        names.push("_id".into());
        index.insert("_id".into(), 0);
        types.push(vec![]);
    }
    for d in &docs {
        for (k, v) in d {
            let i = *index.entry(k.clone()).or_insert_with(|| {
                names.push(k.clone());
                types.push(vec![]);
                names.len() - 1
            });
            let t = bson_type_name(v);
            if !matches!(v, Bson::Null) && !types[i].contains(&t) {
                types[i].push(t);
            }
        }
    }
    let rows = docs
        .into_iter()
        .map(|d| {
            let mut row = vec![Value::Null; names.len()];
            for (k, v) in d {
                row[index[&k]] = to_json(v);
            }
            row
        })
        .collect();
    let columns = names
        .into_iter()
        .zip(types)
        .map(|(name, t)| ColumnInfo { name, type_name: if t.is_empty() { "null".into() } else { t.join("|") } })
        .collect();
    (columns, rows)
}

// ---------------------------------------------------------------------------
// JSON <-> BSON
// ---------------------------------------------------------------------------

const EXTJSON_KEYS: &[&str] = &[
    "$oid", "$date", "$numberLong", "$numberInt", "$numberDouble", "$numberDecimal", "$binary", "$uuid",
    "$regularExpression", "$timestamp", "$minKey", "$maxKey", "$symbol", "$code", "$undefined", "$dbPointer",
];

/// Interpret single-purpose Extended JSON wrappers (`{"$oid": ..}`, `{"$date": ..}`, ...).
fn maybe_extjson(d: Document) -> Bson {
    let is_ext = d.len() <= 2 && d.keys().next().map(|k| EXTJSON_KEYS.contains(&k.as_str())).unwrap_or(false);
    if is_ext {
        let json = doc_json(d.clone());
        if let Ok(b) = Bson::try_from(json) {
            if !matches!(b, Bson::Document(_)) {
                return b;
            }
        }
    }
    Bson::Document(d)
}

/// Convert relaxed/canonical Extended JSON to BSON, keeping object key order.
pub fn json_to_bson(v: &Value) -> Bson {
    match v {
        Value::Null => Bson::Null,
        Value::Bool(b) => Bson::Boolean(*b),
        Value::Number(n) => match n.as_i64() {
            Some(i) if i32::try_from(i).is_ok() => Bson::Int32(i as i32),
            Some(i) => Bson::Int64(i),
            None => Bson::Double(n.as_f64().unwrap_or(0.0)),
        },
        Value::String(s) => Bson::String(s.clone()),
        Value::Array(a) => Bson::Array(a.iter().map(json_to_bson).collect()),
        Value::Object(o) => maybe_extjson(o.iter().map(|(k, v)| (k.clone(), json_to_bson(v))).collect()),
    }
}

fn map_to_doc(m: &Map<String, Value>) -> Document {
    m.iter().map(|(k, v)| (k.clone(), json_to_bson(v))).collect()
}

// ---------------------------------------------------------------------------
// Tolerant mongo-shell value parser
// ---------------------------------------------------------------------------

pub struct ShellParser {
    c: Vec<char>,
    i: usize,
}

type PResult<T> = Result<T, String>;

fn is_ident_start(c: char) -> bool {
    c.is_alphabetic() || c == '_' || c == '$'
}

fn is_ident_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '$'
}

fn parse_date(s: &str) -> PResult<bson::DateTime> {
    let s = s.trim();
    if let Ok(d) = bson::DateTime::parse_rfc3339_str(s) {
        return Ok(d);
    }
    let fixed = if s.len() == 10 {
        format!("{s}T00:00:00Z")
    } else if !s.ends_with('Z') && !s[s.len().saturating_sub(6)..].contains(['+', '-']) {
        format!("{}Z", s.replace(' ', "T"))
    } else {
        s.replace(' ', "T")
    };
    bson::DateTime::parse_rfc3339_str(&fixed).map_err(|_| format!("Invalid date '{s}'"))
}

impl ShellParser {
    pub fn new(s: &str) -> Self {
        ShellParser { c: s.chars().collect(), i: 0 }
    }

    fn peek(&self) -> Option<char> {
        self.c.get(self.i).copied()
    }

    fn ws(&mut self) {
        loop {
            match self.peek() {
                Some(c) if c.is_whitespace() => self.i += 1,
                Some('/') if self.c.get(self.i + 1) == Some(&'/') => {
                    while let Some(c) = self.peek() {
                        if c == '\n' {
                            break;
                        }
                        self.i += 1;
                    }
                }
                Some('/') if self.c.get(self.i + 1) == Some(&'*') => {
                    self.i += 2;
                    while self.i < self.c.len() && !(self.c[self.i] == '*' && self.c.get(self.i + 1) == Some(&'/')) {
                        self.i += 1;
                    }
                    self.i = (self.i + 2).min(self.c.len());
                }
                _ => return,
            }
        }
    }

    fn eat(&mut self, ch: char) -> bool {
        self.ws();
        if self.peek() == Some(ch) {
            self.i += 1;
            true
        } else {
            false
        }
    }

    fn expect(&mut self, ch: char) -> PResult<()> {
        if self.eat(ch) {
            Ok(())
        } else {
            Err(format!("Expected '{ch}' at position {}{}", self.i, self.context()))
        }
    }

    fn context(&self) -> String {
        let rest: String = self.c[self.i.min(self.c.len())..].iter().take(20).collect();
        if rest.is_empty() { " (end of input)".into() } else { format!(" near '{rest}'") }
    }

    pub fn at_end(&mut self) -> bool {
        self.ws();
        while self.peek() == Some(';') {
            self.i += 1;
            self.ws();
        }
        self.i >= self.c.len()
    }

    fn ident(&mut self) -> Option<String> {
        self.ws();
        match self.peek() {
            Some(c) if is_ident_start(c) => {
                let start = self.i;
                while matches!(self.peek(), Some(c) if is_ident_char(c)) {
                    self.i += 1;
                }
                Some(self.c[start..self.i].iter().collect())
            }
            _ => None,
        }
    }

    fn string(&mut self) -> PResult<String> {
        self.ws();
        let q = self.peek().ok_or("Expected string")?;
        if q != '"' && q != '\'' && q != '`' {
            return Err(format!("Expected string{}", self.context()));
        }
        self.i += 1;
        let mut s = String::new();
        loop {
            let c = self.peek().ok_or("Unterminated string")?;
            self.i += 1;
            if c == q {
                return Ok(s);
            }
            if c != '\\' {
                s.push(c);
                continue;
            }
            let e = self.peek().ok_or("Unterminated string")?;
            self.i += 1;
            match e {
                'n' => s.push('\n'),
                'r' => s.push('\r'),
                't' => s.push('\t'),
                'b' => s.push('\u{8}'),
                'f' => s.push('\u{c}'),
                '0' => s.push('\0'),
                'u' => {
                    let hex: String = self.c[self.i..(self.i + 4).min(self.c.len())].iter().collect();
                    let cp = u32::from_str_radix(&hex, 16).map_err(|_| "Invalid \\u escape")?;
                    self.i += 4;
                    s.push(char::from_u32(cp).unwrap_or('\u{fffd}'));
                }
                'x' => {
                    let hex: String = self.c[self.i..(self.i + 2).min(self.c.len())].iter().collect();
                    let cp = u32::from_str_radix(&hex, 16).map_err(|_| "Invalid \\x escape")?;
                    self.i += 2;
                    s.push(char::from_u32(cp).unwrap_or('\u{fffd}'));
                }
                '\n' => {}
                other => s.push(other),
            }
        }
    }

    fn number(&mut self) -> PResult<Bson> {
        self.ws();
        let start = self.i;
        if matches!(self.peek(), Some('-') | Some('+')) {
            self.i += 1;
        }
        if let Some(id) = self.ident() {
            let neg = self.c[start] == '-';
            return match id.as_str() {
                "Infinity" => Ok(Bson::Double(if neg { f64::NEG_INFINITY } else { f64::INFINITY })),
                "NaN" => Ok(Bson::Double(f64::NAN)),
                _ => Err(format!("Invalid number{}", self.context())),
            };
        }
        let rest: String = self.c[self.i..].iter().take(2).collect();
        if rest.eq_ignore_ascii_case("0x") {
            self.i += 2;
            let hs = self.i;
            while matches!(self.peek(), Some(c) if c.is_ascii_hexdigit()) {
                self.i += 1;
            }
            let hex: String = self.c[hs..self.i].iter().collect();
            let v = i64::from_str_radix(&hex, 16).map_err(|e| e.to_string())?;
            let v = if self.c[start] == '-' { -v } else { v };
            return Ok(int_bson(v));
        }
        let mut float = false;
        while let Some(c) = self.peek() {
            if c.is_ascii_digit() || c == '_' {
                self.i += 1;
            } else if c == '.' || c == 'e' || c == 'E' {
                float = true;
                self.i += 1;
                if (c == 'e' || c == 'E') && matches!(self.peek(), Some('+') | Some('-')) {
                    self.i += 1;
                }
            } else {
                break;
            }
        }
        let text: String = self.c[start..self.i].iter().filter(|c| **c != '_' && **c != '+').collect();
        if text.is_empty() || text == "-" {
            return Err(format!("Invalid number{}", self.context()));
        }
        if !float {
            if let Ok(v) = text.parse::<i64>() {
                return Ok(int_bson(v));
            }
        }
        text.parse::<f64>().map(Bson::Double).map_err(|_| format!("Invalid number '{text}'"))
    }

    fn regex(&mut self) -> PResult<Bson> {
        self.i += 1; // opening '/'
        let mut pattern = String::new();
        let mut in_class = false;
        loop {
            let c = self.peek().ok_or("Unterminated regular expression")?;
            self.i += 1;
            match c {
                '\\' => {
                    pattern.push(c);
                    if let Some(n) = self.peek() {
                        pattern.push(n);
                        self.i += 1;
                    }
                }
                '[' => {
                    in_class = true;
                    pattern.push(c);
                }
                ']' => {
                    in_class = false;
                    pattern.push(c);
                }
                '/' if !in_class => break,
                _ => pattern.push(c),
            }
        }
        let mut flags = String::new();
        while matches!(self.peek(), Some(c) if c.is_ascii_alphabetic()) {
            flags.push(self.c[self.i]);
            self.i += 1;
        }
        Ok(regex_bson(pattern, &flags))
    }

    fn object(&mut self) -> PResult<Document> {
        self.expect('{')?;
        let mut d = Document::new();
        loop {
            if self.eat('}') {
                return Ok(d);
            }
            self.ws();
            let key = match self.peek() {
                Some('"') | Some('\'') | Some('`') => self.string()?,
                Some(c) if c.is_ascii_digit() || c == '-' => match self.number()? {
                    Bson::Int32(i) => i.to_string(),
                    Bson::Int64(i) => i.to_string(),
                    Bson::Double(f) => f.to_string(),
                    _ => unreachable!(),
                },
                Some(c) if is_ident_start(c) => {
                    // Allow dotted paths (`a.b`) as unquoted keys.
                    let mut k = self.ident().unwrap_or_default();
                    while self.peek() == Some('.') {
                        self.i += 1;
                        k.push('.');
                        k.push_str(&self.ident().ok_or_else(|| format!("Invalid key{}", self.context()))?);
                    }
                    k
                }
                _ => return Err(format!("Expected key or '}}'{}", self.context())),
            };
            self.expect(':')?;
            let v = self.value()?;
            d.insert(key, v);
            if !self.eat(',') {
                self.expect('}')?;
                return Ok(d);
            }
        }
    }

    fn array(&mut self) -> PResult<Vec<Bson>> {
        self.expect('[')?;
        let mut a = Vec::new();
        loop {
            if self.eat(']') {
                return Ok(a);
            }
            a.push(self.value()?);
            if !self.eat(',') {
                self.expect(']')?;
                return Ok(a);
            }
        }
    }

    /// Comma separated values up to (and including) the closing `)`.
    pub fn call_args(&mut self) -> PResult<Vec<Bson>> {
        let mut a = Vec::new();
        loop {
            if self.eat(')') {
                return Ok(a);
            }
            a.push(self.value()?);
            if !self.eat(',') {
                self.expect(')')?;
                return Ok(a);
            }
        }
    }

    pub fn value(&mut self) -> PResult<Bson> {
        self.ws();
        match self.peek() {
            None => Err("Unexpected end of input".into()),
            Some('{') => Ok(maybe_extjson(self.object()?)),
            Some('[') => Ok(Bson::Array(self.array()?)),
            Some('"') | Some('\'') | Some('`') => Ok(Bson::String(self.string()?)),
            Some('/') => self.regex(),
            Some(c) if c.is_ascii_digit() || c == '-' || c == '+' || c == '.' => self.number(),
            Some(c) if is_ident_start(c) => {
                let id = self.ident().unwrap_or_default();
                match id.as_str() {
                    "true" => Ok(Bson::Boolean(true)),
                    "false" => Ok(Bson::Boolean(false)),
                    "null" | "undefined" => Ok(Bson::Null),
                    "Infinity" => Ok(Bson::Double(f64::INFINITY)),
                    "NaN" => Ok(Bson::Double(f64::NAN)),
                    "new" => {
                        let f = self.ident().ok_or_else(|| format!("Expected constructor{}", self.context()))?;
                        self.helper(&f)
                    }
                    _ => self.helper(&id),
                }
            }
            Some(c) => Err(format!("Unexpected character '{c}'{}", self.context())),
        }
    }

    /// Shell helper constructors such as `ObjectId("..")` or `ISODate("..")`.
    fn helper(&mut self, name: &str) -> PResult<Bson> {
        let args = if self.eat('(') { self.call_args()? } else { vec![] };
        let str_arg = |i: usize| -> PResult<String> {
            match args.get(i) {
                Some(Bson::String(s)) => Ok(s.clone()),
                Some(Bson::Int32(n)) => Ok(n.to_string()),
                Some(Bson::Int64(n)) => Ok(n.to_string()),
                Some(Bson::Double(n)) => Ok(n.to_string()),
                _ => Err(format!("{name}() expects a string argument")),
            }
        };
        let int_arg = |i: usize| -> PResult<i64> {
            match args.get(i) {
                Some(Bson::Int32(n)) => Ok(*n as i64),
                Some(Bson::Int64(n)) => Ok(*n),
                Some(Bson::Double(n)) => Ok(*n as i64),
                Some(Bson::String(s)) => s.trim().parse().map_err(|_| format!("{name}(): invalid number '{s}'")),
                _ => Err(format!("{name}() expects a numeric argument")),
            }
        };
        match name {
            "ObjectId" => {
                if args.is_empty() {
                    Ok(Bson::ObjectId(ObjectId::new()))
                } else {
                    let s = str_arg(0)?;
                    ObjectId::parse_str(s.trim()).map(Bson::ObjectId).map_err(|_| format!("Invalid ObjectId '{s}'"))
                }
            }
            "ISODate" | "Date" => match args.first() {
                None => Ok(Bson::DateTime(bson::DateTime::now())),
                Some(Bson::String(s)) => parse_date(s).map(Bson::DateTime),
                Some(_) => Ok(Bson::DateTime(bson::DateTime::from_millis(int_arg(0)?))),
            },
            "NumberLong" | "Long" => Ok(Bson::Int64(int_arg(0)?)),
            "NumberInt" | "Int32" => Ok(Bson::Int32(int_arg(0)? as i32)),
            "Double" | "NumberDouble" => {
                let s = str_arg(0)?;
                s.trim().parse::<f64>().map(Bson::Double).map_err(|_| format!("Invalid double '{s}'"))
            }
            "NumberDecimal" | "Decimal128" => {
                let s = str_arg(0)?;
                s.trim()
                    .parse::<bson::Decimal128>()
                    .map(Bson::Decimal128)
                    .map_err(|_| format!("Invalid decimal '{s}'"))
            }
            "UUID" => {
                let s = if args.is_empty() { uuid::Uuid::new_v4().to_string() } else { str_arg(0)? };
                let u = uuid::Uuid::parse_str(s.trim()).map_err(|_| format!("Invalid UUID '{s}'"))?;
                Ok(Bson::Binary(bson::Binary { subtype: bson::spec::BinarySubtype::Uuid, bytes: u.as_bytes().to_vec() }))
            }
            "BinData" => {
                let sub = int_arg(0)? as u8;
                let data = base64::engine::general_purpose::STANDARD
                    .decode(str_arg(1)?.trim())
                    .map_err(|e| format!("BinData: {e}"))?;
                Ok(Bson::Binary(bson::Binary { subtype: sub.into(), bytes: data }))
            }
            "Timestamp" => Ok(Bson::Timestamp(bson::Timestamp {
                time: int_arg(0).unwrap_or(0) as u32,
                increment: int_arg(1).unwrap_or(0) as u32,
            })),
            "RegExp" => Ok(regex_bson(str_arg(0)?, &str_arg(1).unwrap_or_default())),
            "MinKey" => Ok(Bson::MinKey),
            "MaxKey" => Ok(Bson::MaxKey),
            _ => Err(format!("Unknown function or identifier '{name}'")),
        }
    }
}

fn int_bson(v: i64) -> Bson {
    match i32::try_from(v) {
        Ok(i) => Bson::Int32(i),
        Err(_) => Bson::Int64(v),
    }
}

fn regex_bson(pattern: String, flags: &str) -> Bson {
    let mut opts: Vec<char> = flags.chars().filter(|c| "ilmsux".contains(*c)).collect();
    opts.sort_unstable();
    opts.dedup();
    Bson::RegularExpression(bson::Regex { pattern, options: opts.into_iter().collect() })
}

/// Parse a filter/document argument (empty input → empty document).
pub fn parse_document(s: &str) -> PResult<Document> {
    if s.trim().is_empty() {
        return Ok(Document::new());
    }
    let mut p = ShellParser::new(s);
    let v = p.value()?;
    if !p.at_end() {
        return Err(format!("Unexpected trailing input{}", p.context()));
    }
    match v {
        Bson::Document(d) => Ok(d),
        other => Err(format!("Expected a document, got {}", bson_type_name(&other))),
    }
}

// ---------------------------------------------------------------------------
// Shell statements
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
enum Seg {
    Member(String),
    Call(Vec<Bson>),
}

#[derive(Debug)]
enum Stmt {
    Use(String),
    Show(String),
    Chain(Vec<Seg>),
}

/// Split a script into statements: on top-level `;`, and on newlines between
/// complete expressions (a following line starting with `.` continues the chain).
pub fn split_script(script: &str) -> Vec<String> {
    let c: Vec<char> = script.chars().collect();
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut depth: i32 = 0;
    let mut i = 0;
    let flush = |cur: &mut String, out: &mut Vec<String>| {
        let t = cur.trim();
        if !t.is_empty() {
            out.push(t.to_string());
        }
        cur.clear();
    };
    while i < c.len() {
        let ch = c[i];
        match ch {
            '"' | '\'' | '`' => {
                cur.push(ch);
                i += 1;
                while i < c.len() {
                    cur.push(c[i]);
                    if c[i] == '\\' && i + 1 < c.len() {
                        cur.push(c[i + 1]);
                        i += 2;
                        continue;
                    }
                    if c[i] == ch {
                        break;
                    }
                    i += 1;
                }
            }
            '/' if c.get(i + 1) == Some(&'/') => {
                while i < c.len() && c[i] != '\n' {
                    i += 1;
                }
                continue;
            }
            '/' if c.get(i + 1) == Some(&'*') => {
                i += 2;
                while i < c.len() && !(c[i] == '*' && c.get(i + 1) == Some(&'/')) {
                    i += 1;
                }
                i += 2;
                continue;
            }
            '{' | '[' | '(' => {
                depth += 1;
                cur.push(ch);
            }
            '}' | ']' | ')' => {
                depth -= 1;
                cur.push(ch);
            }
            ';' if depth <= 0 => flush(&mut cur, &mut out),
            '\n' if depth <= 0 => {
                let next = c[i + 1..].iter().find(|x| !x.is_whitespace()).copied();
                let last = cur.trim_end().chars().last();
                if next == Some('.') || matches!(last, Some('.') | Some(',')) {
                    cur.push(ch);
                } else {
                    flush(&mut cur, &mut out);
                }
            }
            _ => cur.push(ch),
        }
        i += 1;
    }
    flush(&mut cur, &mut out);
    out
}

fn parse_statement(s: &str) -> PResult<Stmt> {
    let t = s.trim().trim_end_matches(';').trim();
    let words: Vec<&str> = t.split_whitespace().collect();
    match words.as_slice() {
        ["use", db] => return Ok(Stmt::Use(db.trim_matches(['"', '\'']).to_string())),
        ["show", what] => return Ok(Stmt::Show(what.to_lowercase())),
        _ => {}
    }
    let mut p = ShellParser::new(t);
    let root = p.ident().ok_or_else(|| format!("Expected 'db', 'use' or 'show'{}", p.context()))?;
    if root != "db" {
        return Err(format!("Unsupported statement starting with '{root}' (expected db.<collection>.<method>(...))"));
    }
    let mut segs = Vec::new();
    loop {
        if p.at_end() {
            break;
        }
        if p.eat('.') {
            let m = p.ident().ok_or_else(|| format!("Expected name after '.'{}", p.context()))?;
            segs.push(Seg::Member(m));
        } else if p.eat('(') {
            segs.push(Seg::Call(p.call_args()?));
        } else if p.eat('[') {
            let v = p.value()?;
            p.expect(']')?;
            match v {
                Bson::String(s) => segs.push(Seg::Member(s)),
                _ => return Err("Expected a string inside [ ]".into()),
            }
        } else {
            return Err(format!("Unexpected input{}", p.context()));
        }
    }
    Ok(Stmt::Chain(segs))
}

fn arg_doc(args: &[Bson], i: usize, what: &str) -> AppResult<Document> {
    match args.get(i) {
        None | Some(Bson::Null) => Ok(Document::new()),
        Some(Bson::Document(d)) => Ok(d.clone()),
        Some(other) => Err(AppError::msg(format!("{what} must be a document, got {}", bson_type_name(other)))),
    }
}

fn arg_str(args: &[Bson], i: usize, what: &str) -> AppResult<String> {
    match args.get(i) {
        Some(Bson::String(s)) => Ok(s.clone()),
        _ => Err(AppError::msg(format!("{what} must be a string"))),
    }
}

fn arg_i64(args: &[Bson], i: usize, what: &str) -> AppResult<i64> {
    match args.get(i) {
        Some(Bson::Int32(n)) => Ok(*n as i64),
        Some(Bson::Int64(n)) => Ok(*n),
        Some(Bson::Double(n)) => Ok(*n as i64),
        _ => Err(AppError::msg(format!("{what} must be a number"))),
    }
}

fn pipeline_arg(args: &[Bson]) -> AppResult<Vec<Document>> {
    match args.first() {
        Some(Bson::Array(a)) => a
            .iter()
            .map(|s| s.as_document().cloned().ok_or_else(|| AppError::msg("Pipeline stages must be documents")))
            .collect(),
        Some(Bson::Document(_)) => args
            .iter()
            .map(|s| s.as_document().cloned().ok_or_else(|| AppError::msg("Pipeline stages must be documents")))
            .collect(),
        None => Ok(vec![]),
        _ => Err(AppError::msg("aggregate() expects an array of stages")),
    }
}

const WRITE_METHODS: &[&str] = &[
    "insertOne", "insertMany", "insert", "updateOne", "updateMany", "update", "replaceOne", "deleteOne",
    "deleteMany", "remove", "createIndex", "createIndexes", "dropIndex", "dropIndexes", "drop", "renameCollection",
    "createCollection", "createView", "dropDatabase", "findOneAndUpdate", "findOneAndDelete", "findOneAndReplace",
];

const READ_COMMANDS: &[&str] = &[
    "find", "aggregate", "count", "distinct", "listCollections", "listIndexes", "listDatabases", "dbStats",
    "collStats", "serverStatus", "buildInfo", "buildinfo", "ping", "hello", "isMaster", "ismaster",
    "connectionStatus", "hostInfo", "getParameter", "explain", "currentOp", "getCmdLineOpts", "replSetGetStatus",
    "usersInfo", "rolesInfo", "validate", "dataSize", "top", "getLog", "listCommands", "whatsmyuri",
];

fn json_result(statement: &str, v: Value) -> QueryResult {
    QueryResult {
        statement: statement.into(),
        message: Some(serde_json::to_string_pretty(&v).unwrap_or_default()),
        ..Default::default()
    }
}

fn docs_result(statement: &str, mut docs: Vec<Document>, max_rows: usize) -> QueryResult {
    let truncated = docs.len() > max_rows;
    docs.truncate(max_rows);
    let n = docs.len();
    let (columns, rows) = docs_to_table(docs);
    QueryResult {
        statement: statement.into(),
        columns,
        rows,
        truncated,
        message: Some(format!("{n} document(s)")),
        ..Default::default()
    }
}

fn names_result(statement: &str, col: &str, names: Vec<Value>) -> QueryResult {
    QueryResult {
        statement: statement.into(),
        columns: vec![ColumnInfo { name: col.into(), type_name: "string".into() }],
        rows: names.into_iter().map(|n| vec![n]).collect(),
        ..Default::default()
    }
}

impl MongoDriver {
    async fn run_statement(&self, text: &str, cur_db: &mut String, max_rows: usize) -> AppResult<QueryResult> {
        let stmt = parse_statement(text).map_err(AppError::msg)?;
        let segs = match stmt {
            Stmt::Use(db) => {
                *cur_db = db.clone();
                return Ok(QueryResult { statement: text.into(), message: Some(format!("switched to db {db}")), ..Default::default() });
            }
            Stmt::Show(what) => {
                return match what.as_str() {
                    "dbs" | "databases" => {
                        let res = self
                            .client
                            .database("admin")
                            .run_command(doc! { "listDatabases": 1, "authorizedDatabases": true })
                            .await?;
                        let dbs: Vec<Document> = res
                            .get_array("databases")
                            .map(|a| a.iter().filter_map(|d| d.as_document().cloned()).collect())
                            .unwrap_or_default();
                        Ok(docs_result(text, dbs, max_rows))
                    }
                    "collections" | "tables" => {
                        let db = self.client.database(cur_db);
                        let mut names = db.list_collection_names().await?;
                        names.sort();
                        Ok(names_result(text, "name", names.into_iter().map(Value::String).collect()))
                    }
                    other => Err(AppError::msg(format!("Unsupported: show {other} (supported: dbs, collections)"))),
                };
            }
            Stmt::Chain(s) => s,
        };

        // Resolve database / collection / method.
        let mut db_name = cur_db.clone();
        let mut coll: Option<String> = None;
        let mut i = 0;
        let (method, args) = loop {
            match (segs.get(i), segs.get(i + 1)) {
                (Some(Seg::Member(m)), Some(Seg::Call(a))) if m == "getSiblingDB" && coll.is_none() => {
                    db_name = arg_str(a, 0, "getSiblingDB() name")?;
                    i += 2;
                }
                (Some(Seg::Member(m)), Some(Seg::Call(a))) if m == "getCollection" && coll.is_none() => {
                    coll = Some(arg_str(a, 0, "getCollection() name")?);
                    i += 2;
                }
                (Some(Seg::Member(m)), Some(Seg::Call(a))) => {
                    i += 2;
                    break (m.clone(), a.clone());
                }
                (Some(Seg::Member(m)), _) => {
                    coll = Some(match coll {
                        Some(c) => format!("{c}.{m}"),
                        None => m.clone(),
                    });
                    i += 1;
                }
                (Some(Seg::Call(_)), _) => return Err(AppError::msg("Unexpected call")),
                (None, _) => return Err(AppError::msg("Incomplete statement: expected a method call like db.coll.find()")),
            }
        };
        // Cursor modifiers: .sort(), .limit(), .skip(), .projection(), .count(), .toArray(), .pretty()
        let mut mods: Vec<(String, Vec<Bson>)> = Vec::new();
        while i < segs.len() {
            match (&segs[i], segs.get(i + 1)) {
                (Seg::Member(m), Some(Seg::Call(a))) => {
                    mods.push((m.clone(), a.clone()));
                    i += 2;
                }
                (Seg::Member(m), _) => return Err(AppError::msg(format!("Expected a call after .{m}"))),
                _ => return Err(AppError::msg("Unexpected call")),
            }
        }

        if self.read_only && WRITE_METHODS.contains(&method.as_str()) {
            return Err(AppError::msg(format!("{method}() is not allowed: connection is read-only")));
        }
        let db = self.client.database(&db_name);

        let Some(coll_name) = coll else {
            return self.run_db_method(text, &db, &method, &args, max_rows).await;
        };
        let c = db.collection::<Document>(&coll_name);

        let mut res = match method.as_str() {
            "find" | "findOne" => {
                let filter = arg_doc(&args, 0, "filter")?;
                let mut projection = arg_doc(&args, 1, "projection")?;
                let mut sort = None;
                let mut limit: Option<i64> = None;
                let mut skip: Option<u64> = None;
                let mut count = false;
                for (m, a) in &mods {
                    match m.as_str() {
                        "sort" => sort = Some(arg_doc(a, 0, "sort")?),
                        "limit" => limit = Some(arg_i64(a, 0, "limit")?.abs()).filter(|l| *l > 0),
                        "skip" => skip = Some(arg_i64(a, 0, "skip")?.max(0) as u64),
                        "projection" => projection = arg_doc(a, 0, "projection")?,
                        "count" | "countDocuments" | "size" => count = true,
                        "toArray" | "pretty" | "batchSize" | "maxTimeMS" | "hint" | "comment" | "allowDiskUse" => {}
                        other => return Err(AppError::msg(format!("Unsupported cursor method .{other}()"))),
                    }
                }
                if count {
                    let n = c.count_documents(filter).await?;
                    return Ok(json_result(text, json!(n)));
                }
                let cap = if method == "findOne" { 1 } else { max_rows as i64 + 1 };
                let mut q = c.find(filter).limit(limit.map(|l| l.min(cap)).unwrap_or(cap));
                if let Some(s) = sort {
                    q = q.sort(s);
                }
                if let Some(s) = skip {
                    q = q.skip(s);
                }
                if !projection.is_empty() {
                    q = q.projection(projection);
                }
                let docs: Vec<Document> = q.await?.try_collect().await?;
                if method == "findOne" && docs.is_empty() {
                    return Ok(json_result(text, Value::Null));
                }
                docs_result(text, docs, max_rows)
            }
            "aggregate" => {
                let pipeline = pipeline_arg(&args)?;
                if self.read_only && pipeline.iter().any(|s| s.contains_key("$out") || s.contains_key("$merge")) {
                    return Err(AppError::msg("$out/$merge are not allowed: connection is read-only"));
                }
                let mut cursor = c.aggregate(pipeline).await?;
                let mut docs = Vec::new();
                while let Some(d) = cursor.try_next().await? {
                    docs.push(d);
                    if docs.len() > max_rows {
                        break;
                    }
                }
                docs_result(text, docs, max_rows)
            }
            "countDocuments" | "count" => json_result(text, json!(c.count_documents(arg_doc(&args, 0, "filter")?).await?)),
            "estimatedDocumentCount" => json_result(text, json!(c.estimated_document_count().await?)),
            "distinct" => {
                let field = arg_str(&args, 0, "distinct() field")?;
                let values = c.distinct(&field, arg_doc(&args, 1, "filter")?).await?;
                let mut r = names_result(text, &field, values.into_iter().map(to_json).collect());
                r.truncated = r.rows.len() > max_rows;
                r.rows.truncate(max_rows);
                r
            }
            "insertOne" => {
                let d = arg_doc(&args, 0, "document")?;
                let r = c.insert_one(d).await?;
                let mut q = json_result(text, json!({ "acknowledged": true, "insertedId": to_json(r.inserted_id) }));
                q.rows_affected = Some(1);
                q
            }
            "insertMany" | "insert" => {
                let docs: Vec<Document> = match args.first() {
                    Some(Bson::Array(a)) => a
                        .iter()
                        .map(|d| d.as_document().cloned().ok_or_else(|| AppError::msg("insertMany() expects documents")))
                        .collect::<AppResult<_>>()?,
                    Some(Bson::Document(d)) => vec![d.clone()],
                    _ => return Err(AppError::msg(format!("{method}() expects an array of documents"))),
                };
                if docs.is_empty() {
                    return Err(AppError::msg("No documents to insert"));
                }
                let r = c.insert_many(docs).await?;
                let mut ids: Vec<(usize, Bson)> = r.inserted_ids.into_iter().collect();
                ids.sort_by_key(|(i, _)| *i);
                let n = ids.len() as u64;
                let mut q = json_result(
                    text,
                    json!({ "acknowledged": true, "insertedIds": ids.into_iter().map(|(_, v)| to_json(v)).collect::<Vec<_>>() }),
                );
                q.rows_affected = Some(n);
                q
            }
            "updateOne" | "updateMany" | "update" | "replaceOne" => {
                let filter = arg_doc(&args, 0, "filter")?;
                let opts = arg_doc(&args, 2, "options")?;
                let upsert = opts.get_bool("upsert").unwrap_or(false);
                let multi = method == "updateMany" || (method == "update" && opts.get_bool("multi").unwrap_or(false));
                let r = if method == "replaceOne" {
                    c.replace_one(filter, arg_doc(&args, 1, "replacement")?).upsert(upsert).await?
                } else {
                    let update: mongodb::options::UpdateModifications = match args.get(1) {
                        Some(Bson::Document(d)) => d.clone().into(),
                        Some(Bson::Array(_)) => pipeline_arg(&args[1..2])?.into(),
                        _ => return Err(AppError::msg("update must be a document or a pipeline")),
                    };
                    if multi {
                        c.update_many(filter, update).upsert(upsert).await?
                    } else {
                        c.update_one(filter, update).upsert(upsert).await?
                    }
                };
                let mut q = json_result(
                    text,
                    json!({
                        "acknowledged": true,
                        "matchedCount": r.matched_count,
                        "modifiedCount": r.modified_count,
                        "upsertedId": r.upserted_id.map(to_json),
                    }),
                );
                q.rows_affected = Some(r.modified_count);
                q
            }
            "deleteOne" | "deleteMany" | "remove" => {
                let filter = arg_doc(&args, 0, "filter")?;
                let just_one = matches!(args.get(1), Some(Bson::Boolean(true)))
                    || args.get(1).and_then(Bson::as_document).and_then(|d| d.get_bool("justOne").ok()).unwrap_or(false);
                let r = if method == "deleteOne" || (method == "remove" && just_one) {
                    c.delete_one(filter).await?
                } else {
                    c.delete_many(filter).await?
                };
                let mut q = json_result(text, json!({ "acknowledged": true, "deletedCount": r.deleted_count }));
                q.rows_affected = Some(r.deleted_count);
                q
            }
            "createIndex" => {
                let keys = arg_doc(&args, 0, "index keys")?;
                let mut spec = arg_doc(&args, 1, "index options")?;
                if !spec.contains_key("name") {
                    let name = keys
                        .iter()
                        .map(|(k, v)| format!("{k}_{}", match v {
                            Bson::String(s) => s.clone(),
                            Bson::Int32(n) => n.to_string(),
                            Bson::Int64(n) => n.to_string(),
                            Bson::Double(n) => n.to_string(),
                            other => other.to_string(),
                        }))
                        .collect::<Vec<_>>()
                        .join("_");
                    spec.insert("name", name);
                }
                spec.insert("key", keys);
                let name = spec.get_str("name").unwrap_or("").to_string();
                db.run_command(doc! { "createIndexes": &coll_name, "indexes": [spec] }).await?;
                json_result(text, json!(name))
            }
            "dropIndex" => {
                let idx = args.first().cloned().ok_or_else(|| AppError::msg("dropIndex() needs an index name or key"))?;
                let r = db.run_command(doc! { "dropIndexes": &coll_name, "index": idx }).await?;
                json_result(text, doc_json(r))
            }
            "dropIndexes" => {
                let r = db.run_command(doc! { "dropIndexes": &coll_name, "index": "*" }).await?;
                json_result(text, doc_json(r))
            }
            "getIndexes" => {
                let idx = self.index_docs(&db, &coll_name).await?;
                docs_result(text, idx, max_rows)
            }
            "drop" => {
                c.drop().await?;
                json_result(text, json!(true))
            }
            "renameCollection" => {
                let to = arg_str(&args, 0, "renameCollection() target")?;
                let r = self
                    .client
                    .database("admin")
                    .run_command(doc! { "renameCollection": format!("{db_name}.{coll_name}"), "to": format!("{db_name}.{to}") })
                    .await?;
                json_result(text, doc_json(r))
            }
            "stats" => json_result(text, doc_json(db.run_command(doc! { "collStats": &coll_name }).await?)),
            other => return Err(AppError::msg(format!("Unsupported collection method {other}()"))),
        };
        res.statement = text.into();
        Ok(res)
    }

    async fn run_db_method(&self, text: &str, db: &Database, method: &str, args: &[Bson], max_rows: usize) -> AppResult<QueryResult> {
        Ok(match method {
            "getCollectionNames" => {
                let mut names = db.list_collection_names().await?;
                names.sort();
                names_result(text, "name", names.into_iter().map(Value::String).collect())
            }
            "getCollectionInfos" => docs_result(text, self.collection_infos(db, None).await?, max_rows),
            "createCollection" => {
                let mut cmd = doc! { "create": arg_str(args, 0, "createCollection() name")? };
                cmd.extend(arg_doc(args, 1, "options")?);
                json_result(text, doc_json(db.run_command(cmd).await?))
            }
            "createView" => {
                let mut cmd = doc! {
                    "create": arg_str(args, 0, "createView() name")?,
                    "viewOn": arg_str(args, 1, "createView() source")?,
                    "pipeline": pipeline_arg(&args[2.min(args.len())..])?,
                };
                cmd.extend(arg_doc(args, 3, "options")?);
                json_result(text, doc_json(db.run_command(cmd).await?))
            }
            "dropDatabase" => {
                db.drop().await?;
                json_result(text, json!({ "ok": 1, "dropped": db.name() }))
            }
            "runCommand" | "adminCommand" => {
                let cmd = match args.first() {
                    Some(Bson::Document(d)) => d.clone(),
                    Some(Bson::String(s)) => doc! { s.as_str(): 1 },
                    _ => return Err(AppError::msg(format!("{method}() expects a command document"))),
                };
                let name = cmd.keys().next().cloned().unwrap_or_default();
                if self.read_only && !READ_COMMANDS.contains(&name.as_str()) {
                    return Err(AppError::msg(format!("Command '{name}' is not allowed: connection is read-only")));
                }
                let target = if method == "adminCommand" { self.client.database("admin") } else { db.clone() };
                let res = target.run_command(cmd).await?;
                // Commands returning a cursor are shown as a table as well.
                let batch = first_batch(&res);
                let mut q = json_result(text, doc_json(res));
                if !batch.is_empty() {
                    let t = docs_result(text, batch, max_rows);
                    q.columns = t.columns;
                    q.rows = t.rows;
                    q.truncated = t.truncated;
                }
                q
            }
            "stats" => json_result(text, doc_json(db.run_command(doc! { "dbStats": 1 }).await?)),
            "getName" => json_result(text, json!(db.name())),
            "version" => json_result(text, json!(self.server_version().await?)),
            other => return Err(AppError::msg(format!("Unsupported database method db.{other}()"))),
        })
    }
}

#[async_trait]
impl Driver for MongoDriver {
    fn kind(&self) -> ConnectionKind {
        ConnectionKind::Mongodb
    }

    fn dialect(&self) -> Dialect {
        Dialect::None
    }

    async fn server_version(&self) -> AppResult<String> {
        let r = self.client.database("admin").run_command(doc! { "buildInfo": 1 }).await?;
        Ok(format!("MongoDB {}", r.get_str("version").unwrap_or("unknown")))
    }

    async fn children(&self, path: &[String]) -> AppResult<Vec<TreeNode>> {
        match path {
            [] => Ok(self
                .list_databases()
                .await?
                .into_iter()
                .map(|d| TreeNode {
                    path: vec![d.clone()],
                    label: d,
                    kind: NodeKind::Database,
                    has_children: true,
                    detail: None,
                    table: None,
                })
                .collect()),
            [db] => {
                let infos = self.collection_infos(&self.client.database(db), None).await?;
                let views = infos.iter().filter(|i| i.get_str("type") == Ok("view")).count();
                let colls = infos.len() - views;
                let mut out = vec![TreeNode {
                    path: vec![db.clone(), "collections".into()],
                    label: "Collections".into(),
                    kind: NodeKind::Folder,
                    has_children: colls > 0,
                    detail: Some(colls.to_string()),
                    table: None,
                }];
                if views > 0 {
                    out.push(TreeNode {
                        path: vec![db.clone(), "views".into()],
                        label: "Views".into(),
                        kind: NodeKind::Folder,
                        has_children: true,
                        detail: Some(views.to_string()),
                        table: None,
                    });
                }
                Ok(out)
            }
            [db, folder] => {
                let database = self.client.database(db);
                let infos = self.collection_infos(&database, None).await?;
                let want_views = folder == "views";
                let items: Vec<String> = infos
                    .iter()
                    .filter(|i| (i.get_str("type") == Ok("view")) == want_views)
                    .filter_map(|i| i.get_str("name").ok().map(str::to_string))
                    .collect();
                let counts: Vec<Option<u64>> = if want_views {
                    vec![None; items.len()]
                } else {
                    futures::future::join_all(items.iter().take(500).map(|n| {
                        let c = database.collection::<Document>(n);
                        async move { c.estimated_document_count().await.ok() }
                    }))
                    .await
                };
                Ok(items
                    .into_iter()
                    .enumerate()
                    .map(|(i, name)| TreeNode {
                        path: vec![db.clone(), folder.clone(), name.clone()],
                        label: name.clone(),
                        kind: if want_views { NodeKind::View } else { NodeKind::Collection },
                        has_children: !want_views,
                        detail: counts.get(i).copied().flatten().map(|n| n.to_string()),
                        table: Some(TableRef { database: Some(db.clone()), schema: None, name }),
                    })
                    .collect())
            }
            [db, _, coll] => {
                let idx = self.index_docs(&self.client.database(db), coll).await?;
                Ok(idx
                    .iter()
                    .map(|d| {
                        let def = index_def(d);
                        let keys = d.get_document("key").cloned().unwrap_or_default();
                        TreeNode {
                            path: vec![db.clone(), "collections".into(), coll.clone(), def.name.clone()],
                            label: def.name.clone(),
                            kind: NodeKind::Index,
                            has_children: false,
                            detail: Some(format!(
                                "{}{}",
                                if def.unique && !def.primary { "unique " } else { "" },
                                doc_json(keys)
                            )),
                            table: None,
                        }
                    })
                    .collect())
            }
            _ => Ok(vec![]),
        }
    }

    async fn list_databases(&self) -> AppResult<Vec<String>> {
        let res = self
            .client
            .database("admin")
            .run_command(doc! { "listDatabases": 1, "nameOnly": true, "authorizedDatabases": true })
            .await;
        let mut names: Vec<String> = match res {
            Ok(r) => r
                .get_array("databases")
                .map(|a| a.iter().filter_map(|d| d.as_document()?.get_str("name").ok().map(str::to_string)).collect())
                .unwrap_or_default(),
            // Users without listDatabases privilege still get their default database.
            Err(e) => match &self.default_db {
                Some(_) => vec![],
                None => return Err(e.into()),
            },
        };
        if let Some(d) = &self.default_db {
            if !names.contains(d) {
                names.push(d.clone());
            }
        }
        names.sort();
        Ok(names)
    }

    async fn execute(&self, script: &str, opts: &ExecOptions) -> AppResult<Vec<QueryResult>> {
        let mut cur_db = self.db_name(opts.database.as_deref());
        let max_rows = opts.max_rows.unwrap_or(1000).max(1);
        let mut out = Vec::new();
        for stmt in split_script(script) {
            let started = Instant::now();
            let mut r = self
                .run_statement(&stmt, &mut cur_db, max_rows)
                .await
                .map_err(|e| if out.is_empty() { e } else { AppError::msg(format!("Statement {} failed: {e}", out.len() + 1)) })?;
            r.elapsed_ms = started.elapsed().as_millis() as u64;
            out.push(r);
        }
        Ok(out)
    }

    async fn table_data(&self, req: &TableDataRequest) -> AppResult<TableDataPage> {
        let started = Instant::now();
        let db = self.db_name(req.table.database.as_deref());
        let c = self.client.database(&db).collection::<Document>(&req.table.name);
        let filter = parse_document(req.filter.as_deref().unwrap_or("")).map_err(|e| AppError::msg(format!("Invalid filter: {e}")))?;
        let mut sort = Document::new();
        for s in &req.sort {
            sort.insert(s.column.clone(), if s.desc { -1 } else { 1 });
        }
        let mut q = c.find(filter.clone()).skip(req.offset);
        if req.limit > 0 {
            q = q.limit(req.limit as i64);
        }
        if !sort.is_empty() {
            q = q.sort(sort);
        }
        let docs: Vec<Document> = q.await?.try_collect().await?;
        // estimatedDocumentCount is metadata-only but fails on views.
        let total = match filter.is_empty() {
            true => match c.estimated_document_count().await {
                Ok(n) => Some(n),
                Err(_) => c.count_documents(filter).await.ok(),
            },
            false => c.count_documents(filter).await.ok(),
        };
        let (columns, rows) = docs_to_table(docs);
        Ok(TableDataPage {
            result: QueryResult {
                statement: format!("db.getCollection({}).find({})", json!(req.table.name), req.filter.as_deref().unwrap_or("{}")),
                columns,
                rows,
                elapsed_ms: started.elapsed().as_millis() as u64,
                ..Default::default()
            },
            total,
            primary_key: vec!["_id".into()],
        })
    }

    async fn table_structure(&self, table: &TableRef) -> AppResult<TableStructure> {
        let db = self.db_name(table.database.as_deref());
        self.structure_of(&db, &table.name).await
    }

    /// Grid edits. Inserts drop null fields (and a null `_id`, letting the server
    /// generate one); updates use `$set` keyed by `_id`; deletes by `_id`.
    async fn apply_changes(&self, table: &TableRef, changes: &[RowChange]) -> AppResult<u64> {
        self.check_writable()?;
        let db = self.db_name(table.database.as_deref());
        let c = self.client.database(&db).collection::<Document>(&table.name);
        let key_filter = |key: &Map<String, Value>| -> AppResult<Document> {
            let id = key.get("_id").ok_or_else(|| AppError::msg("Row has no _id; cannot identify the document"))?;
            Ok(doc! { "_id": json_to_bson(id) })
        };
        let mut affected = 0u64;
        for ch in changes {
            match ch {
                RowChange::Insert { values } => {
                    let d: Document = values
                        .iter()
                        .filter(|(_, v)| !v.is_null() && !(v.as_str() == Some("")))
                        .map(|(k, v)| (k.clone(), json_to_bson(v)))
                        .collect();
                    c.insert_one(d).await?;
                    affected += 1;
                }
                RowChange::Update { key, values } => {
                    let filter = key_filter(key)?;
                    let mut set = map_to_doc(values);
                    if let Some(id) = set.remove("_id") {
                        if Some(&id) != filter.get("_id") {
                            return Err(AppError::msg("_id is immutable; insert a new document instead"));
                        }
                    }
                    if set.is_empty() {
                        continue;
                    }
                    let r = c.update_one(filter, doc! { "$set": set }).await?;
                    affected += r.matched_count;
                }
                RowChange::Delete { key } => {
                    affected += c.delete_one(key_filter(key)?).await?.deleted_count;
                }
            }
        }
        Ok(affected)
    }

    /// A re-runnable shell script: `db.createCollection(name, options)` followed by
    /// one `createIndex` per secondary index.
    async fn object_ddl(&self, table: &TableRef, _kind: &NodeKind) -> AppResult<String> {
        let db_name = self.db_name(table.database.as_deref());
        let db = self.client.database(&db_name);
        let info = self
            .collection_infos(&db, Some(&table.name))
            .await?
            .into_iter()
            .next()
            .ok_or_else(|| AppError::msg(format!("Collection '{}' not found", table.name)))?;
        let pretty = |d: Document| serde_json::to_string_pretty(&doc_json(d)).unwrap_or_default();
        let name = json!(table.name).to_string();
        let mut out = format!("// Database: {db_name}\n");
        let options = info.get_document("options").cloned().unwrap_or_default();
        if options.is_empty() {
            out.push_str(&format!("db.createCollection({name});\n"));
        } else {
            out.push_str(&format!("db.createCollection({name}, {});\n", pretty(options)));
        }
        if info.get_str("type") != Ok("view") {
            for idx in self.index_docs(&db, &table.name).await? {
                if idx.get_str("name") == Ok("_id_") {
                    continue;
                }
                let key = idx.get_document("key").cloned().unwrap_or_default();
                let mut opts = idx.clone();
                for k in ["v", "key", "ns"] {
                    opts.remove(k);
                }
                out.push_str(&format!(
                    "db.getCollection({name}).createIndex({}, {});\n",
                    serde_json::to_string(&doc_json(key)).unwrap_or_default(),
                    serde_json::to_string(&doc_json(opts)).unwrap_or_default()
                ));
            }
        }
        Ok(out)
    }

    async fn schema_snapshot(&self, database: Option<&str>, _schema: Option<&str>) -> AppResult<SchemaSnapshot> {
        let db_name = self.db_name(database);
        let db = self.client.database(&db_name);
        let mut snap = SchemaSnapshot::default();
        for info in self.collection_infos(&db, None).await? {
            let name = info.get_str("name").unwrap_or("").to_string();
            if name.is_empty() || name.starts_with("system.") {
                continue;
            }
            let tref = TableRef { database: Some(db_name.clone()), schema: None, name: name.clone() };
            if info.get_str("type") == Ok("view") {
                let opts = info.get_document("options").cloned().unwrap_or_default();
                snap.views.push((tref, serde_json::to_string_pretty(&doc_json(opts)).unwrap_or_default()));
            } else {
                snap.tables.push(self.structure_of(&db_name, &name).await?);
            }
        }
        Ok(snap)
    }

    async fn close(&self) {
        self.client.clone().shutdown().immediate(true).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_relaxed_shell_values() {
        let d = parse_document(
            r#"{ name: 'bob', "age": {$gt: 3,}, _id: ObjectId("507f1f77bcf86cd799439011"),
                at: ISODate("2024-01-02T03:04:05Z"), n: NumberLong(5), re: /ab+c/i, // comment
                big: 12345678901, f: -1.5e3, nested: [1, {a: null}], ext: {"$oid": "507f1f77bcf86cd799439011"} }"#,
        )
        .unwrap();
        assert_eq!(d.get_str("name").unwrap(), "bob");
        assert_eq!(d.get_document("age").unwrap().get_i32("$gt").unwrap(), 3);
        assert!(matches!(d.get("_id"), Some(Bson::ObjectId(_))));
        assert!(matches!(d.get("at"), Some(Bson::DateTime(_))));
        assert_eq!(d.get_i64("n").unwrap(), 5);
        assert!(matches!(d.get("re"), Some(Bson::RegularExpression(r)) if r.pattern == "ab+c" && r.options == "i"));
        assert_eq!(d.get_i64("big").unwrap(), 12345678901);
        assert_eq!(d.get_f64("f").unwrap(), -1500.0);
        assert!(matches!(d.get("ext"), Some(Bson::ObjectId(_))));
        // key order preserved
        assert_eq!(d.keys().next().unwrap(), "name");
    }

    #[test]
    fn splits_scripts() {
        let s = "use shop\ndb.a.find({x: 1})\n  .sort({x: -1})\n  .limit(5); db.b.insertOne({s: 'a;b'})\n// c\nshow collections";
        let parts = split_script(s);
        assert_eq!(parts.len(), 4, "{parts:?}");
        assert!(parts[1].contains(".limit(5)"));
        assert_eq!(parts[2], "db.b.insertOne({s: 'a;b'})");
    }

    #[test]
    fn parses_chains() {
        let Stmt::Chain(segs) = parse_statement("db.getCollection('a.b').find({}).limit(2)").unwrap() else { panic!() };
        assert_eq!(segs.len(), 6);
        assert!(parse_statement("foo.bar()").is_err());
    }

    #[test]
    fn extjson_roundtrip() {
        let v = json!({ "_id": { "$oid": "507f1f77bcf86cd799439011" }, "d": { "$date": "2024-01-02T03:04:05Z" }, "x": [1, 2] });
        let b = json_to_bson(&v);
        assert_eq!(b.clone().into_relaxed_extjson(), v);
        let Bson::Document(d) = b else { panic!() };
        assert!(matches!(d.get("_id"), Some(Bson::ObjectId(_))));
    }
}

/// Integration tests against the docker-compose MongoDB (`cargo test -- --ignored mongo_it`).
#[cfg(test)]
mod mongo_it {
    use super::*;

    fn cfg() -> ConnectionConfig {
        serde_json::from_value(json!({
            "id": "t", "name": "t", "kind": "mongodb", "host": "127.0.0.1", "port": 57017,
            "user": "devcat", "password": "devcat", "database": "devcat_it"
        }))
        .unwrap()
    }

    fn opts() -> ExecOptions {
        ExecOptions { database: Some("devcat_it".into()), schema: None, max_rows: Some(50) }
    }

    #[tokio::test]
    #[ignore]
    async fn mongo_it_roundtrip() {
        let d = MongoDriver::connect(&cfg()).await.unwrap();
        assert!(d.server_version().await.unwrap().starts_with("MongoDB "));
        let _ = d.execute("db.people.drop()\ndb.people_v.drop()", &opts()).await;

        let r = d
            .execute(
                r#"
                db.people.insertMany([
                  { _id: 1, name: 'Ann', age: 31, tags: ['a', 'b'], at: ISODate("2024-01-02T03:04:05Z") },
                  { _id: 2, name: "Bob", age: NumberLong(40), addr: { city: 'Oslo' }, },
                  { name: 'Cy', oid: ObjectId("507f1f77bcf86cd799439011"), price: NumberDecimal("9.99") }
                ]);
                db.people.createIndex({ name: 1 }, { unique: true })
                db.people.find({ age: { $gte: 30 } })
                  .sort({ age: -1 })
                  .limit(10)
                db.people.countDocuments({})
                db.people.updateOne({ _id: 1 }, { $set: { age: 32 } })
                db.people.aggregate([{ $group: { _id: null, n: { $sum: 1 } } }])
                db.people.distinct('name')
                db.createView('people_v', 'people', [{ $project: { name: 1 } }])
                show collections
                db.runCommand({ ping: 1 })
                db.people.find({ name: /^a/i }).count()
                "#,
                &opts(),
            )
            .await
            .unwrap();
        assert_eq!(r[0].rows_affected, Some(3));
        assert_eq!(r[1].message.as_deref(), Some("\"name_1\""));
        assert_eq!(r[2].rows.len(), 2);
        assert_eq!(r[2].columns[0].name, "_id");
        assert_eq!(r[2].rows[0][0], json!(2)); // sorted by age desc
        assert_eq!(r[3].message.as_deref(), Some("3"));
        assert_eq!(r[4].rows_affected, Some(1));
        assert_eq!(r[5].rows[0][1], json!(3));
        assert_eq!(r[6].rows.len(), 3);
        assert!(r[8].rows.iter().any(|row| row[0] == json!("people_v")));
        assert!(r[9].message.as_deref().unwrap().contains("\"ok\""));
        assert_eq!(r[10].message.as_deref(), Some("1"));

        // tree
        let dbs = d.children(&[]).await.unwrap();
        assert!(dbs.iter().any(|n| n.label == "devcat_it"));
        let folders = d.children(&["devcat_it".into()]).await.unwrap();
        assert_eq!(folders.len(), 2);
        let colls = d.children(&["devcat_it".into(), "collections".into()]).await.unwrap();
        let people = colls.iter().find(|n| n.label == "people").unwrap();
        assert_eq!(people.detail.as_deref(), Some("3"));
        let idx = d.children(&people.path).await.unwrap();
        assert_eq!(idx.len(), 2);

        // table data: filter + sort + paging
        let tref = people.table.clone().unwrap();
        let page = d
            .table_data(&TableDataRequest {
                table: tref.clone(),
                offset: 0,
                limit: 2,
                filter: Some("{name: {$in: ['Ann', 'Cy']}}".into()),
                sort: vec![SortSpec { column: "name".into(), desc: true }],
            })
            .await
            .unwrap();
        assert_eq!(page.total, Some(2));
        assert_eq!(page.primary_key, vec!["_id".to_string()]);
        let name_col = page.result.columns.iter().position(|c| c.name == "name").unwrap();
        assert_eq!(page.result.rows[0][name_col], json!("Cy"));
        let cy_id = page.result.rows[0][0].clone();
        assert!(cy_id.get("$oid").is_some(), "{cy_id}");
        let oid_col = page.result.columns.iter().position(|c| c.name == "oid").unwrap();
        assert_eq!(page.result.rows[0][oid_col], json!({"$oid": "507f1f77bcf86cd799439011"}));

        // apply_changes round trip
        let mut ins = Map::new();
        ins.insert("_id".into(), Value::Null);
        ins.insert("name".into(), json!("Dee"));
        ins.insert("when".into(), json!({"$date": "2024-05-06T00:00:00Z"}));
        let mut upd = Map::new();
        upd.insert("age".into(), json!(77));
        let mut key = Map::new();
        key.insert("_id".into(), cy_id.clone());
        let mut del = Map::new();
        del.insert("_id".into(), json!(2));
        let n = d
            .apply_changes(
                &tref,
                &[
                    RowChange::Insert { values: ins },
                    RowChange::Update { key: key.clone(), values: upd },
                    RowChange::Delete { key: del },
                ],
            )
            .await
            .unwrap();
        assert_eq!(n, 3);
        let r = d.execute("db.people.findOne({name: 'Cy'})\ndb.people.find({name: 'Dee'})", &opts()).await.unwrap();
        let age = r[0].columns.iter().position(|c| c.name == "age").unwrap();
        assert_eq!(r[0].rows[0][age], json!(77));
        let when = r[1].columns.iter().position(|c| c.name == "when").unwrap();
        assert_eq!(r[1].rows[0][when], json!({"$date": "2024-05-06T00:00:00Z"}));
        assert_eq!(r[1].columns[when].type_name, "date");

        // structure, ddl, snapshot
        let st = d.table_structure(&tref).await.unwrap();
        assert!(st.columns[0].is_primary_key);
        assert!(st.columns.iter().any(|c| c.name == "age" && c.data_type.contains("int") && c.nullable));
        assert!(st.indexes.iter().any(|i| i.name == "name_1" && i.unique));
        let ddl = d.object_ddl(&tref, &NodeKind::Collection).await.unwrap();
        assert!(ddl.contains("createIndex({\"name\":1}"), "{ddl}");
        // DDL is valid shell
        for s in split_script(&ddl) {
            parse_statement(&s).unwrap();
        }
        let snap = d.schema_snapshot(Some("devcat_it"), None).await.unwrap();
        assert!(snap.tables.iter().any(|t| t.table.as_ref().unwrap().name == "people"));
        assert!(snap.views.iter().any(|v| v.0.name == "people_v"));

        // read-only
        let mut ro = cfg();
        ro.read_only = true;
        let r = MongoDriver::connect(&ro).await.unwrap();
        assert!(r.execute("db.people.deleteMany({})", &opts()).await.is_err());
        assert!(r.execute("db.people.find()", &opts()).await.is_ok());
        assert!(r.apply_changes(&tref, &[]).await.is_err());

        d.execute("db.dropDatabase()", &opts()).await.unwrap();
    }

    #[tokio::test]
    #[ignore]
    async fn mongo_it_url() {
        let mut c = cfg();
        c.host = String::new();
        c.database = None;
        c.url = Some("mongodb://devcat:devcat@127.0.0.1:57017/admin?directConnection=true".into());
        let d = MongoDriver::connect(&c).await.unwrap();
        assert!(d.list_databases().await.unwrap().contains(&"admin".to_string()));
    }
}
