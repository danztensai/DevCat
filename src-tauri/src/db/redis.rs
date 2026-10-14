//! Redis driver.
//!
//! Tree layout: `[]` lists `db0..dbN`; `["db3"]` lists keys of db 3 grouped by
//! the `:` separator. Group path elements carry their trailing `:` (so the key
//! prefix of a group is simply the concatenation of the path elements after the
//! db), leaf keys use the remaining key suffix as the last path element.
//! `TableRef.database` of a key is the bare db index ("3"); every API accepting a
//! database accepts both "3" and "db3".
use super::*;
use crate::db::ssh::{open_endpoint, SshTunnel};
use crate::error::{AppError, AppResult};
use crate::models::{ConnectionConfig, ConnectionKind};
use async_trait::async_trait;
use ::redis::aio::{ConnectionLike, MultiplexedConnection};
use ::redis::{AsyncConnectionConfig, ConnectionAddr, ConnectionInfo, IntoConnectionInfo, Value as RValue};
use serde_json::json;
use std::collections::{BTreeMap, HashMap};
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

/// Max keys returned by one tree expansion.
const TREE_KEY_CAP: usize = 10_000;
/// Max SCAN round trips per tree expansion (bounds time spent on huge keyspaces).
const TREE_SCAN_CALLS: usize = 2_000;
/// Max items returned for list/set/zset/hash values.
const ITEM_CAP: usize = 1000;
/// Number of most recent stream entries returned.
const STREAM_CAP: usize = 200;

pub struct RedisDriver {
    info: ConnectionInfo,
    default_db: i64,
    read_only: bool,
    /// Shared connections used for browsing / key editing, one per db index.
    conns: Mutex<HashMap<i64, MultiplexedConnection>>,
    /// Dedicated connections used by `execute` (MULTI/EXEC, blocking commands).
    /// The lock also serializes scripts so transactions never interleave.
    exec_conns: Mutex<HashMap<i64, MultiplexedConnection>>,
    _tunnel: Option<SshTunnel>,
}

fn parse_db(s: &str) -> Option<i64> {
    let s = s.trim();
    let s = s.strip_prefix("db").unwrap_or(s);
    s.parse::<i64>().ok().filter(|n| *n >= 0)
}

fn to_str(v: &RValue) -> Option<String> {
    Some(match v {
        RValue::BulkString(b) => String::from_utf8_lossy(b).into_owned(),
        RValue::SimpleString(s) => s.clone(),
        RValue::VerbatimString { text, .. } => text.clone(),
        RValue::Okay => "OK".into(),
        RValue::Int(i) => i.to_string(),
        RValue::Double(d) => d.to_string(),
        RValue::Boolean(b) => b.to_string(),
        _ => return None,
    })
}

fn to_i64(v: &RValue) -> Option<i64> {
    match v {
        RValue::Int(i) => Some(*i),
        other => to_str(other).and_then(|s| s.trim().parse().ok()),
    }
}

fn items(v: RValue) -> Vec<RValue> {
    match v {
        RValue::Array(a) | RValue::Set(a) => a,
        RValue::Map(m) => m.into_iter().flat_map(|(k, v)| [k, v]).collect(),
        RValue::Nil => vec![],
        other => vec![other],
    }
}

fn server_error(e: ::redis::RedisError) -> AppError {
    match ::redis::ServerError::try_from(e) {
        Ok(se) => AppError::msg(format_server_error(&se)),
        Err(e) => AppError::Redis(e),
    }
}

fn format_server_error(se: &::redis::ServerError) -> String {
    match se.details() {
        Some(d) => format!("{} {}", se.code(), d),
        None => se.code().to_string(),
    }
}

/// Escape glob metacharacters for SCAN MATCH.
fn glob_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if matches!(c, '*' | '?' | '[' | ']' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

impl RedisDriver {
    pub async fn connect(cfg: &ConnectionConfig) -> AppResult<Self> {
        let trust = cfg.options.get("trustCert").map(|v| v == "true").unwrap_or(false);
        let tls_wanted = matches!(cfg.ssl_mode.as_deref(), Some("require") | Some("verify-full") | Some("verify-ca"));
        let ssh_on = cfg.ssh.as_ref().map(|s| s.enabled).unwrap_or(false);

        let (mut info, tunnel) = match cfg.url.as_deref().map(str::trim).filter(|u| !u.is_empty()) {
            Some(url) => {
                let info = url.into_connection_info()?;
                if ssh_on {
                    // Tunnel to the host named in the URL, keep its TLS settings.
                    let (host, port, tls) = match info.addr() {
                        ConnectionAddr::Tcp(h, p) => (h.clone(), *p, None),
                        ConnectionAddr::TcpTls { host, port, insecure, .. } => (host.clone(), *port, Some(*insecure)),
                        _ => return Err(AppError::msg("SSH tunnelling is only supported for TCP Redis URLs")),
                    };
                    let mut c = cfg.clone();
                    c.host = host;
                    c.port = Some(port);
                    let ep = open_endpoint(&c, 6379).await?;
                    let addr = tunnel_addr(ep.host.clone(), ep.port, tls);
                    (info.set_addr(addr), ep.tunnel)
                } else {
                    (info, None)
                }
            }
            None => {
                let ep = open_endpoint(cfg, 6379).await?;
                let addr = tunnel_addr(ep.host.clone(), ep.port, if tls_wanted { Some(trust) } else { None });
                let mut rs = ::redis::RedisConnectionInfo::default();
                if !cfg.user.is_empty() {
                    rs = rs.set_username(&cfg.user);
                }
                if let Some(p) = cfg.password.as_deref().filter(|p| !p.is_empty()) {
                    rs = rs.set_password(p);
                }
                (addr.into_connection_info()?.set_redis_settings(rs), ep.tunnel)
            }
        };

        let default_db = cfg
            .database
            .as_deref()
            .and_then(parse_db)
            .unwrap_or(info.redis_settings().db());
        info = info.clone().set_redis_settings(info.redis_settings().clone().set_db(0));

        let d = RedisDriver {
            info,
            default_db,
            read_only: cfg.read_only,
            conns: Mutex::new(HashMap::new()),
            exec_conns: Mutex::new(HashMap::new()),
            _tunnel: tunnel,
        };
        let mut c = d.conn(default_db).await?;
        ::redis::cmd("PING").query_async::<RValue>(&mut c).await?;
        Ok(d)
    }

    async fn open(&self, db: i64, response_timeout: Duration) -> AppResult<MultiplexedConnection> {
        let info = self.info.clone().set_redis_settings(self.info.redis_settings().clone().set_db(db));
        let client = ::redis::Client::open(info)?;
        let cfg = AsyncConnectionConfig::new()
            .set_connection_timeout(Some(Duration::from_secs(15)))
            .set_response_timeout(Some(response_timeout));
        Ok(client.get_multiplexed_async_connection_with_config(&cfg).await?)
    }

    async fn conn(&self, db: i64) -> AppResult<MultiplexedConnection> {
        let mut map = self.conns.lock().await;
        if let Some(c) = map.get(&db) {
            return Ok(c.clone());
        }
        let c = self.open(db, Duration::from_secs(60)).await?;
        map.insert(db, c.clone());
        Ok(c)
    }

    /// Multiplexed connections don't reconnect by themselves: drop cached ones
    /// after a transport failure so the next call opens fresh connections.
    async fn evict_if_broken<T>(&self, r: &AppResult<T>) {
        if let Err(AppError::Redis(e)) = r {
            if e.is_io_error() || e.is_connection_dropped() || e.is_unrecoverable_error() || e.is_timeout() {
                self.conns.lock().await.clear();
            }
        }
    }

    fn db_of(&self, database: Option<&str>) -> i64 {
        database.and_then(parse_db).unwrap_or(self.default_db)
    }

    fn check_writable(&self) -> AppResult<()> {
        if self.read_only {
            return Err(AppError::msg("Connection is read-only"));
        }
        Ok(())
    }

    async fn db_count(&self, c: &mut MultiplexedConnection) -> i64 {
        let r: Result<RValue, _> = ::redis::cmd("CONFIG").arg("GET").arg("databases").query_async(c).await;
        match r {
            Ok(v) => items(v).get(1).and_then(to_i64).filter(|n| *n > 0).unwrap_or(16),
            Err(_) => 16,
        }
    }

    /// Key counts per db from `INFO keyspace`.
    async fn keyspace(&self, c: &mut MultiplexedConnection) -> HashMap<i64, u64> {
        let mut out = HashMap::new();
        let info: String = match ::redis::cmd("INFO").arg("keyspace").query_async(c).await {
            Ok(s) => s,
            Err(_) => return out,
        };
        for line in info.lines() {
            // db0:keys=12,expires=0,avg_ttl=0
            if let Some((db, rest)) = line.trim().split_once(':') {
                if let (Some(n), Some(keys)) = (
                    parse_db(db),
                    rest.split(',').find_map(|kv| kv.strip_prefix("keys=")).and_then(|k| k.parse().ok()),
                ) {
                    out.insert(n, keys);
                }
            }
        }
        out
    }

    async fn key_children(&self, db: i64, path: &[String]) -> AppResult<Vec<TreeNode>> {
        let mut c = self.conn(db).await?;
        let prefix: String = path[1..].concat();
        let pattern = format!("{}*", glob_escape(&prefix));
        let mut keys: Vec<Vec<u8>> = Vec::new();
        let mut cursor: u64 = 0;
        let mut calls = 0;
        let mut capped = false;
        loop {
            let (next, batch): (u64, Vec<Vec<u8>>) = ::redis::cmd("SCAN")
                .arg(cursor)
                .arg("MATCH")
                .arg(&pattern)
                .arg("COUNT")
                .arg(1000)
                .query_async(&mut c)
                .await?;
            keys.extend(batch);
            cursor = next;
            calls += 1;
            if cursor == 0 {
                break;
            }
            if keys.len() >= TREE_KEY_CAP || calls >= TREE_SCAN_CALLS {
                capped = true;
                break;
            }
        }
        keys.sort();
        keys.dedup();
        if keys.len() > TREE_KEY_CAP {
            keys.truncate(TREE_KEY_CAP);
            capped = true;
        }

        let mut groups: BTreeMap<String, u64> = BTreeMap::new();
        let mut leaves: Vec<String> = Vec::new();
        for k in &keys {
            let key = String::from_utf8_lossy(k).into_owned();
            let Some(rest) = key.strip_prefix(prefix.as_str()) else { continue };
            match rest.find(':') {
                Some(i) => *groups.entry(rest[..=i].to_string()).or_default() += 1,
                None => leaves.push(key),
            }
        }

        // Key types for leaves, pipelined.
        let mut types: Vec<String> = Vec::new();
        for chunk in leaves.chunks(1000) {
            let mut p = ::redis::pipe();
            for k in chunk {
                p.cmd("TYPE").arg(k);
            }
            let r: Vec<String> = p.query_async(&mut c).await?;
            types.extend(r);
        }

        let dbs = db.to_string();
        let mut out = Vec::with_capacity(groups.len() + leaves.len() + 1);
        for (g, count) in groups {
            let mut p = path.to_vec();
            p.push(g.clone());
            out.push(TreeNode {
                path: p,
                label: g.trim_end_matches(':').to_string(),
                kind: NodeKind::KeyGroup,
                has_children: true,
                detail: Some(if capped { format!("{count}+") } else { count.to_string() }),
                table: None,
            });
        }
        for (key, ty) in leaves.into_iter().zip(types) {
            let mut p = path.to_vec();
            p.push(key[prefix.len()..].to_string());
            out.push(TreeNode {
                path: p,
                label: key[prefix.len()..].to_string(),
                kind: NodeKind::Key,
                has_children: false,
                detail: Some(ty),
                table: Some(TableRef { database: Some(dbs.clone()), schema: None, name: key }),
            });
        }
        if capped {
            let mut p = path.to_vec();
            p.push("\u{0}capped".into());
            out.push(TreeNode {
                path: p,
                label: format!("Showing first {} keys (scan capped)", keys.len()),
                kind: NodeKind::Folder,
                has_children: false,
                detail: Some("use the console with SCAN/MATCH for more".into()),
                table: None,
            });
        }
        Ok(out)
    }

    async fn run_raw(c: &mut MultiplexedConnection, args: &[Vec<u8>]) -> AppResult<RValue> {
        let mut cmd = ::redis::cmd(&String::from_utf8_lossy(&args[0]));
        for a in &args[1..] {
            cmd.arg(a.as_slice());
        }
        match c.req_packed_command(&cmd).await {
            Ok(v) => Ok(v),
            Err(e) => match ::redis::ServerError::try_from(e) {
                Ok(se) => Ok(RValue::ServerError(se)),
                Err(e) => Err(AppError::Redis(e)),
            },
        }
    }
}

fn tunnel_addr(host: String, port: u16, tls_insecure: Option<bool>) -> ConnectionAddr {
    match tls_insecure {
        Some(insecure) => ConnectionAddr::TcpTls { host, port, insecure, tls_params: None },
        None => ConnectionAddr::Tcp(host, port),
    }
}

// ---------------------------------------------------------------------------
// Command line tokenizing and redis-cli style reply formatting
// ---------------------------------------------------------------------------

/// Split a command line the way redis-cli does (`sdssplitargs`).
pub fn tokenize(line: &str) -> Result<Vec<Vec<u8>>, String> {
    let b = line.as_bytes();
    let mut i = 0;
    let mut out = Vec::new();
    loop {
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= b.len() {
            return Ok(out);
        }
        let mut cur: Vec<u8> = Vec::new();
        let mut in_dq = false;
        let mut in_sq = false;
        loop {
            if in_dq {
                if i >= b.len() {
                    return Err("unbalanced quotes".into());
                }
                if b[i] == b'\\' && i + 3 < b.len() && b[i + 1] == b'x' && b[i + 2].is_ascii_hexdigit() && b[i + 3].is_ascii_hexdigit() {
                    let h = std::str::from_utf8(&b[i + 2..i + 4]).unwrap();
                    cur.push(u8::from_str_radix(h, 16).unwrap());
                    i += 4;
                    continue;
                } else if b[i] == b'\\' && i + 1 < b.len() {
                    i += 1;
                    cur.push(match b[i] {
                        b'n' => b'\n',
                        b'r' => b'\r',
                        b't' => b'\t',
                        b'b' => 8,
                        b'a' => 7,
                        c => c,
                    });
                } else if b[i] == b'"' {
                    if i + 1 < b.len() && !b[i + 1].is_ascii_whitespace() {
                        return Err("closing quote must be followed by a space".into());
                    }
                    i += 1;
                    break;
                } else {
                    cur.push(b[i]);
                }
            } else if in_sq {
                if i >= b.len() {
                    return Err("unbalanced quotes".into());
                }
                if b[i] == b'\\' && i + 1 < b.len() && b[i + 1] == b'\'' {
                    i += 1;
                    cur.push(b'\'');
                } else if b[i] == b'\'' {
                    if i + 1 < b.len() && !b[i + 1].is_ascii_whitespace() {
                        return Err("closing quote must be followed by a space".into());
                    }
                    i += 1;
                    break;
                } else {
                    cur.push(b[i]);
                }
            } else {
                if i >= b.len() || b[i].is_ascii_whitespace() {
                    break;
                }
                match b[i] {
                    b'"' => in_dq = true,
                    b'\'' => in_sq = true,
                    c => cur.push(c),
                }
            }
            i += 1;
        }
        out.push(cur);
    }
}

/// redis-cli `sdscatrepr` style quoting.
/// Valid multi-byte UTF-8 is kept readable instead of being hex-escaped.
fn repr(bytes: &[u8]) -> String {
    fn push_byte(s: &mut String, c: u8) {
        match c {
            b'\\' => s.push_str("\\\\"),
            b'"' => s.push_str("\\\""),
            b'\n' => s.push_str("\\n"),
            b'\r' => s.push_str("\\r"),
            b'\t' => s.push_str("\\t"),
            7 => s.push_str("\\a"),
            8 => s.push_str("\\b"),
            0x20..=0x7e => s.push(c as char),
            _ => s.push_str(&format!("\\x{c:02x}")),
        }
    }
    let mut s = String::from("\"");
    match std::str::from_utf8(bytes) {
        Ok(text) => {
            for ch in text.chars() {
                if ch.is_ascii() {
                    push_byte(&mut s, ch as u8);
                } else {
                    s.push(ch);
                }
            }
        }
        Err(_) => bytes.iter().for_each(|&c| push_byte(&mut s, c)),
    }
    s.push('"');
    s
}

pub fn format_reply(v: &RValue) -> String {
    let mut out = String::new();
    fmt_value(v, "", &mut out);
    if out.ends_with('\n') {
        out.pop();
    }
    out
}

fn fmt_value(v: &RValue, indent: &str, out: &mut String) {
    match v {
        RValue::Nil => out.push_str("(nil)\n"),
        RValue::Int(i) => out.push_str(&format!("(integer) {i}\n")),
        RValue::BulkString(b) => {
            // Multi-line text (INFO, CLIENT LIST, ...) is printed raw like redis-cli does.
            match std::str::from_utf8(b) {
                Ok(t) if t.contains('\n') => {
                    out.push_str(t.trim_end_matches(['\r', '\n']));
                    out.push('\n');
                }
                _ => {
                    out.push_str(&repr(b));
                    out.push('\n');
                }
            }
        }
        RValue::SimpleString(s) => {
            out.push_str(s);
            out.push('\n');
        }
        RValue::Okay => out.push_str("OK\n"),
        RValue::Double(d) => out.push_str(&format!("(double) {d}\n")),
        RValue::Boolean(b) => out.push_str(&format!("({b})\n")),
        RValue::VerbatimString { text, .. } => {
            out.push_str(text.trim_end_matches(['\r', '\n']));
            out.push('\n');
        }
        RValue::ServerError(e) => out.push_str(&format!("(error) {}\n", format_server_error(e))),
        RValue::Attribute { data, .. } => fmt_value(data, indent, out),
        RValue::Array(a) | RValue::Set(a) | RValue::Push { data: a, .. } => {
            if a.is_empty() {
                out.push_str(if matches!(v, RValue::Set(_)) { "(empty set)\n" } else { "(empty array)\n" });
                return;
            }
            let w = a.len().to_string().len();
            for (i, item) in a.iter().enumerate() {
                let label = format!("{:>w$}) ", i + 1);
                if i > 0 {
                    out.push_str(indent);
                }
                out.push_str(&label);
                let child_indent = format!("{indent}{}", " ".repeat(label.len()));
                fmt_value(item, &child_indent, out);
            }
        }
        RValue::Map(m) => {
            if m.is_empty() {
                out.push_str("(empty hash)\n");
                return;
            }
            let w = m.len().to_string().len();
            for (i, (k, val)) in m.iter().enumerate() {
                let mut key = String::new();
                fmt_value(k, "", &mut key);
                let label = format!("{:>w$}# {} => ", i + 1, key.trim_end());
                if i > 0 {
                    out.push_str(indent);
                }
                out.push_str(&label);
                let child_indent = format!("{indent}{}", " ".repeat(label.chars().count()));
                fmt_value(val, &child_indent, out);
            }
        }
        other => out.push_str(&format!("{other:?}\n")),
    }
}

/// JSON representation of a reply cell for the tabular view.
fn cell(v: &RValue) -> Value {
    match v {
        RValue::Nil => Value::Null,
        RValue::Int(i) => json!(i),
        RValue::Double(d) => json!(d),
        RValue::Boolean(b) => json!(b),
        RValue::ServerError(e) => json!(format!("(error) {}", format_server_error(e))),
        RValue::Array(a) | RValue::Set(a) | RValue::Push { data: a, .. } => Value::Array(a.iter().map(cell).collect()),
        RValue::Map(m) => {
            let mut o = Map::new();
            for (k, v) in m {
                o.insert(to_str(k).unwrap_or_default(), cell(v));
            }
            Value::Object(o)
        }
        RValue::Attribute { data, .. } => cell(data),
        other => json!(to_str(other).unwrap_or_else(|| format!("{other:?}"))),
    }
}

const BLOCKED: &[&str] = &["MONITOR", "SUBSCRIBE", "PSUBSCRIBE", "SSUBSCRIBE", "SYNC", "PSYNC", "RESET", "QUIT", "HELLO"];

const READ_COMMANDS: &[&str] = &[
    "GET", "MGET", "STRLEN", "GETRANGE", "SUBSTR", "EXISTS", "TYPE", "TTL", "PTTL", "EXPIRETIME", "PEXPIRETIME",
    "KEYS", "SCAN", "RANDOMKEY", "DBSIZE", "LLEN", "LRANGE", "LINDEX", "LPOS", "SCARD", "SMEMBERS", "SISMEMBER",
    "SMISMEMBER", "SRANDMEMBER", "SSCAN", "SINTER", "SUNION", "SDIFF", "SINTERCARD", "ZCARD", "ZRANGE",
    "ZRANGEBYSCORE", "ZRANGEBYLEX", "ZREVRANGE", "ZREVRANGEBYSCORE", "ZREVRANGEBYLEX", "ZSCORE", "ZMSCORE", "ZRANK",
    "ZREVRANK", "ZCOUNT", "ZLEXCOUNT", "ZSCAN", "ZRANDMEMBER", "ZINTER", "ZUNION", "ZDIFF", "ZINTERCARD", "HGET",
    "HMGET", "HGETALL", "HKEYS", "HVALS", "HLEN", "HEXISTS", "HSTRLEN", "HSCAN", "HRANDFIELD", "HTTL", "HPTTL",
    "HEXPIRETIME", "HPEXPIRETIME", "XLEN", "XRANGE", "XREVRANGE", "XREAD", "XINFO", "XPENDING", "GETBIT", "BITCOUNT",
    "BITPOS", "BITFIELD_RO", "PFCOUNT", "GEOPOS", "GEODIST", "GEOHASH", "GEORADIUS_RO", "GEORADIUSBYMEMBER_RO",
    "GEOSEARCH", "OBJECT", "DUMP", "LCS", "PING", "ECHO", "INFO", "TIME", "LASTSAVE", "ROLE", "COMMAND", "SORT_RO",
    "EVAL_RO", "EVALSHA_RO", "FCALL_RO", "PUBSUB", "JSON.GET", "JSON.MGET", "JSON.TYPE", "JSON.STRLEN",
    "JSON.ARRLEN", "JSON.ARRINDEX", "JSON.OBJKEYS", "JSON.OBJLEN", "JSON.RESP", "FT.SEARCH", "FT.INFO", "FT._LIST",
    "FT.AGGREGATE", "FT.EXPLAIN", "TS.GET", "TS.MGET", "TS.RANGE", "TS.REVRANGE", "TS.MRANGE", "TS.INFO",
    "BF.EXISTS", "BF.MEXISTS", "BF.INFO", "CF.EXISTS", "CF.INFO", "TOPK.QUERY", "TOPK.LIST", "TOPK.INFO",
];

/// Commands whose read-only use depends on the subcommand.
const READ_SUBCOMMANDS: &[(&str, &[&str])] = &[
    ("CONFIG", &["GET"]),
    ("CLIENT", &["LIST", "INFO", "GETNAME", "ID"]),
    ("SLOWLOG", &["GET", "LEN"]),
    ("MODULE", &["LIST"]),
    ("MEMORY", &["USAGE", "STATS", "DOCTOR"]),
    ("SCRIPT", &["EXISTS"]),
    ("CLUSTER", &["INFO", "NODES", "SLOTS", "SHARDS", "MYID"]),
    ("ACL", &["WHOAMI", "LIST", "USERS", "CAT", "GETUSER"]),
    ("FUNCTION", &["LIST", "STATS", "DUMP"]),
    ("LATENCY", &["LATEST", "HISTORY", "DOCTOR"]),
];

fn is_read_command(args: &[Vec<u8>]) -> bool {
    let name = String::from_utf8_lossy(&args[0]).to_uppercase();
    if READ_COMMANDS.contains(&name.as_str()) {
        return true;
    }
    if let Some((_, subs)) = READ_SUBCOMMANDS.iter().find(|(c, _)| *c == name) {
        if let Some(sub) = args.get(1) {
            let sub = String::from_utf8_lossy(sub).to_uppercase();
            return subs.contains(&sub.as_str());
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Key value read/write helpers
// ---------------------------------------------------------------------------

fn bytes_to_json(b: &[u8]) -> Value {
    Value::String(String::from_utf8_lossy(b).into_owned())
}

fn json_to_arg(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

impl RedisDriver {
    async fn server_version_inner(&self) -> AppResult<String> {
        let mut c = self.conn(self.default_db).await?;
        let info: String = ::redis::cmd("INFO").arg("server").query_async(&mut c).await?;
        let ver = info
            .lines()
            .find_map(|l| l.trim().strip_prefix("redis_version:"))
            .or_else(|| info.lines().find_map(|l| l.trim().strip_prefix("valkey_version:")))
            .unwrap_or("unknown");
        Ok(format!("Redis {ver}"))
    }

    async fn children_inner(&self, path: &[String]) -> AppResult<Vec<TreeNode>> {
        if path.is_empty() {
            let mut c = self.conn(self.default_db).await?;
            let n = self.db_count(&mut c).await;
            let ks = self.keyspace(&mut c).await;
            return Ok((0..n)
                .map(|i| {
                    let keys = ks.get(&i).copied().unwrap_or(0);
                    TreeNode {
                        path: vec![format!("db{i}")],
                        label: format!("db{i}"),
                        kind: NodeKind::Database,
                        has_children: true,
                        detail: Some(if keys == 1 { "1 key".into() } else { format!("{keys} keys") }),
                        table: None,
                    }
                })
                .collect());
        }
        let db = parse_db(&path[0]).ok_or_else(|| AppError::msg(format!("Invalid Redis database '{}'", path[0])))?;
        self.key_children(db, path).await
    }

    async fn list_databases_inner(&self) -> AppResult<Vec<String>> {
        let mut c = self.conn(self.default_db).await?;
        let n = self.db_count(&mut c).await;
        Ok((0..n).map(|i| i.to_string()).collect())
    }

    async fn get_key_inner(&self, database: Option<&str>, key: &str) -> AppResult<Value> {
        let db = self.db_of(database);
        let mut c = self.conn(db).await?;
        let ty: String = ::redis::cmd("TYPE").arg(key).query_async(&mut c).await?;
        let ttl: i64 = ::redis::cmd("TTL").arg(key).query_async(&mut c).await?;
        let mut out = json!({ "key": key, "type": ty, "ttl": ttl });

        let (value, length): (Value, Option<i64>) = match ty.as_str() {
            "none" => (Value::Null, None),
            "string" => {
                let raw: Vec<u8> = ::redis::cmd("GET").arg(key).query_async(&mut c).await?;
                let len = raw.len() as i64;
                match String::from_utf8(raw) {
                    Ok(s) => (Value::String(s), Some(len)),
                    Err(e) => {
                        out["binary"] = json!(true);
                        (bytes_to_json(e.as_bytes()), Some(len))
                    }
                }
            }
            "list" => {
                let len: i64 = ::redis::cmd("LLEN").arg(key).query_async(&mut c).await?;
                let v: Vec<Vec<u8>> =
                    ::redis::cmd("LRANGE").arg(key).arg(0).arg(ITEM_CAP as i64 - 1).query_async(&mut c).await?;
                (Value::Array(v.iter().map(|b| bytes_to_json(b)).collect()), Some(len))
            }
            "set" => {
                let len: i64 = ::redis::cmd("SCARD").arg(key).query_async(&mut c).await?;
                let mut members: Vec<Vec<u8>> = Vec::new();
                let mut cursor: u64 = 0;
                loop {
                    let (next, batch): (u64, Vec<Vec<u8>>) =
                        ::redis::cmd("SSCAN").arg(key).arg(cursor).arg("COUNT").arg(500).query_async(&mut c).await?;
                    members.extend(batch);
                    cursor = next;
                    if cursor == 0 || members.len() >= ITEM_CAP {
                        break;
                    }
                }
                members.sort();
                members.dedup();
                members.truncate(ITEM_CAP);
                (Value::Array(members.iter().map(|b| bytes_to_json(b)).collect()), Some(len))
            }
            "zset" => {
                let len: i64 = ::redis::cmd("ZCARD").arg(key).query_async(&mut c).await?;
                let v: Vec<(Vec<u8>, f64)> = ::redis::cmd("ZRANGE")
                    .arg(key)
                    .arg(0)
                    .arg(ITEM_CAP as i64 - 1)
                    .arg("WITHSCORES")
                    .query_async(&mut c)
                    .await?;
                (Value::Array(v.iter().map(|(m, s)| json!([bytes_to_json(m), s])).collect()), Some(len))
            }
            "hash" => {
                let len: i64 = ::redis::cmd("HLEN").arg(key).query_async(&mut c).await?;
                let mut pairs: Vec<(Vec<u8>, Vec<u8>)> = Vec::new();
                if len as usize <= ITEM_CAP {
                    pairs = ::redis::cmd("HGETALL").arg(key).query_async(&mut c).await?;
                } else {
                    let mut cursor: u64 = 0;
                    loop {
                        let (next, batch): (u64, Vec<(Vec<u8>, Vec<u8>)>) =
                            ::redis::cmd("HSCAN").arg(key).arg(cursor).arg("COUNT").arg(500).query_async(&mut c).await?;
                        pairs.extend(batch);
                        cursor = next;
                        if cursor == 0 || pairs.len() >= ITEM_CAP {
                            break;
                        }
                    }
                    pairs.truncate(ITEM_CAP);
                }
                let mut o = Map::new();
                for (f, v) in pairs {
                    o.insert(String::from_utf8_lossy(&f).into_owned(), bytes_to_json(&v));
                }
                (Value::Object(o), Some(len))
            }
            "stream" => {
                let len: i64 = ::redis::cmd("XLEN").arg(key).query_async(&mut c).await?;
                let raw: RValue = ::redis::cmd("XREVRANGE")
                    .arg(key)
                    .arg("+")
                    .arg("-")
                    .arg("COUNT")
                    .arg(STREAM_CAP)
                    .query_async(&mut c)
                    .await?;
                let mut entries: Vec<Value> = items(raw)
                    .into_iter()
                    .map(|e| {
                        let mut parts = items(e).into_iter();
                        let id = parts.next().and_then(|v| to_str(&v)).unwrap_or_default();
                        let mut fields = Map::new();
                        let kv = parts.next().map(items).unwrap_or_default();
                        for pair in kv.chunks(2) {
                            if let [k, v] = pair {
                                fields.insert(to_str(k).unwrap_or_default(), json!(to_str(v)));
                            }
                        }
                        json!({ "id": id, "fields": fields })
                    })
                    .collect();
                entries.reverse();
                (Value::Array(entries), Some(len))
            }
            "ReJSON-RL" => {
                let s: Option<String> = ::redis::cmd("JSON.GET").arg(key).query_async(&mut c).await.map_err(server_error)?;
                let v = match s {
                    Some(s) => serde_json::from_str(&s).unwrap_or(Value::String(s)),
                    None => Value::Null,
                };
                (v, None)
            }
            other => (Value::String(format!("(values of type '{other}' are not supported by the key editor)")), None),
        };
        out["value"] = value;
        if let Some(l) = length {
            out["length"] = json!(l);
        }
        Ok(out)
    }

    async fn set_key_inner(&self, database: Option<&str>, value: &Value) -> AppResult<()> {
        self.check_writable()?;
        let db = self.db_of(database);
        let key = value
            .get("key")
            .and_then(Value::as_str)
            .filter(|k| !k.is_empty())
            .ok_or_else(|| AppError::msg("Key name is required"))?;
        let ty = value.get("type").and_then(Value::as_str).unwrap_or("string");
        let ttl = value.get("ttl").and_then(Value::as_i64).unwrap_or(-1);
        let old_key = value.get("oldKey").and_then(Value::as_str).filter(|k| !k.is_empty() && *k != key);
        let v = value.get("value").cloned().unwrap_or(Value::Null);
        let length = value.get("length").and_then(Value::as_u64);

        // Refuse to overwrite a collection with a partially loaded copy.
        let provided = match &v {
            Value::Array(a) => Some(a.len() as u64),
            Value::Object(o) if ty == "hash" => Some(o.len() as u64),
            _ => None,
        };
        if let (Some(len), Some(n), false) = (length, provided, ty == "stream") {
            if len > n && len > ITEM_CAP as u64 {
                return Err(AppError::msg(format!(
                    "This {ty} has {len} items but only {n} were loaded; saving would drop the rest. Use the console to edit large keys."
                )));
            }
        }

        let empty = || AppError::msg(format!("Redis cannot store an empty {ty}; delete the key instead"));
        let mut p = ::redis::pipe();
        p.atomic();
        if let Some(old) = old_key {
            p.cmd("DEL").arg(old).ignore();
        }
        p.cmd("DEL").arg(key).ignore();
        match ty {
            "string" => {
                p.cmd("SET").arg(key).arg(json_to_arg(&v)).ignore();
            }
            "list" | "set" => {
                let arr = v.as_array().ok_or_else(|| AppError::msg(format!("{ty} value must be an array")))?;
                if arr.is_empty() {
                    return Err(empty());
                }
                let c = p.cmd(if ty == "list" { "RPUSH" } else { "SADD" }).arg(key);
                for item in arr {
                    c.arg(json_to_arg(item));
                }
                c.ignore();
            }
            "zset" => {
                let arr = v.as_array().ok_or_else(|| AppError::msg("zset value must be an array of [member, score]"))?;
                if arr.is_empty() {
                    return Err(empty());
                }
                let c = p.cmd("ZADD").arg(key);
                for item in arr {
                    let (m, s) = match item {
                        Value::Array(pair) if pair.len() == 2 => (&pair[0], &pair[1]),
                        Value::Object(o) if o.contains_key("member") => (&o["member"], o.get("score").unwrap_or(&Value::Null)),
                        _ => return Err(AppError::msg("zset entries must be [member, score]")),
                    };
                    let score = match s {
                        Value::Number(n) => n.as_f64().unwrap_or(0.0),
                        Value::String(s) => s.trim().parse::<f64>().map_err(|_| AppError::msg(format!("Invalid score '{s}'")))?,
                        _ => 0.0,
                    };
                    c.arg(score).arg(json_to_arg(m));
                }
                c.ignore();
            }
            "hash" => {
                let o = v.as_object().ok_or_else(|| AppError::msg("hash value must be an object"))?;
                if o.is_empty() {
                    return Err(empty());
                }
                let c = p.cmd("HSET").arg(key);
                for (f, val) in o {
                    c.arg(f).arg(json_to_arg(val));
                }
                c.ignore();
            }
            "stream" => {
                let arr = v.as_array().ok_or_else(|| AppError::msg("stream value must be an array of {id, fields}"))?;
                if arr.is_empty() {
                    return Err(empty());
                }
                for e in arr {
                    let id = e.get("id").and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or("*");
                    let fields = e
                        .get("fields")
                        .and_then(Value::as_object)
                        .filter(|f| !f.is_empty())
                        .ok_or_else(|| AppError::msg("stream entries need at least one field"))?;
                    let c = p.cmd("XADD").arg(key).arg(id);
                    for (f, val) in fields {
                        c.arg(f).arg(json_to_arg(val));
                    }
                    c.ignore();
                }
            }
            "ReJSON-RL" | "json" => {
                p.cmd("JSON.SET").arg(key).arg("$").arg(v.to_string()).ignore();
            }
            other => return Err(AppError::msg(format!("Writing values of type '{other}' is not supported"))),
        }
        if ttl > 0 {
            p.cmd("EXPIRE").arg(key).arg(ttl).ignore();
        }
        let mut c = self.conn(db).await?;
        p.query_async::<()>(&mut c).await.map_err(server_error)?;
        Ok(())
    }

    async fn delete_key_inner(&self, database: Option<&str>, key: &str) -> AppResult<()> {
        self.check_writable()?;
        let mut c = self.conn(self.db_of(database)).await?;
        ::redis::cmd("DEL").arg(key).query_async::<i64>(&mut c).await?;
        Ok(())
    }
}

#[async_trait]
impl Driver for RedisDriver {
    fn kind(&self) -> ConnectionKind {
        ConnectionKind::Redis
    }

    fn dialect(&self) -> Dialect {
        Dialect::None
    }




    async fn execute(&self, script: &str, opts: &ExecOptions) -> AppResult<Vec<QueryResult>> {
        let mut db = self.db_of(opts.database.as_deref());
        let max_rows = opts.max_rows.unwrap_or(1000);
        let mut exec = self.exec_conns.lock().await;
        let mut results = Vec::new();

        for line in script.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') || line.starts_with("//") {
                continue;
            }
            let started = Instant::now();
            let mut res = QueryResult { statement: line.to_string(), ..Default::default() };
            let args = match tokenize(line) {
                Ok(a) if !a.is_empty() => a,
                Ok(_) => continue,
                Err(e) => {
                    res.message = Some(format!("(error) ERR Protocol error: {e}"));
                    results.push(res);
                    continue;
                }
            };
            let name = String::from_utf8_lossy(&args[0]).to_uppercase();

            if BLOCKED.contains(&name.as_str()) {
                res.message = Some(format!(
                    "(error) {name} is not supported in the DevCat console (it needs a dedicated streaming connection)"
                ));
            } else if self.read_only && name != "SELECT" && !is_read_command(&args) {
                res.message = Some(format!("(error) {name} is not allowed: connection is read-only"));
            } else if name == "SELECT" {
                // Switch db for the rest of the script; connections are per db index.
                match args.get(1).and_then(|a| parse_db(&String::from_utf8_lossy(a))) {
                    Some(n) if args.len() == 2 => {
                        db = n;
                        res.message = Some("OK".into());
                    }
                    _ => res.message = Some("(error) ERR invalid DB index".into()),
                }
            } else {
                if !exec.contains_key(&db) {
                    let c = self.open(db, Duration::from_secs(300)).await?;
                    exec.insert(db, c);
                }
                let c = exec.get_mut(&db).expect("exec connection");
                let reply = match Self::run_raw(c, &args).await {
                    Ok(v) => v,
                    Err(e) => {
                        exec.remove(&db);
                        return Err(e);
                    }
                };
                res.message = Some(format_reply(&reply));
                match &reply {
                    RValue::Array(a) | RValue::Set(a) => {
                        res.columns = vec![
                            ColumnInfo { name: "#".into(), type_name: "integer".into() },
                            ColumnInfo { name: "value".into(), type_name: "string".into() },
                        ];
                        res.truncated = a.len() > max_rows;
                        res.rows = a.iter().take(max_rows).enumerate().map(|(i, v)| vec![json!(i + 1), cell(v)]).collect();
                    }
                    RValue::Map(m) => {
                        res.columns = vec![
                            ColumnInfo { name: "key".into(), type_name: "string".into() },
                            ColumnInfo { name: "value".into(), type_name: "string".into() },
                        ];
                        res.truncated = m.len() > max_rows;
                        res.rows = m.iter().take(max_rows).map(|(k, v)| vec![cell(k), cell(v)]).collect();
                    }
                    _ => {}
                }
            }
            res.elapsed_ms = started.elapsed().as_millis() as u64;
            results.push(res);
        }
        Ok(results)
    }

    async fn table_data(&self, _req: &TableDataRequest) -> AppResult<TableDataPage> {
        Err(AppError::Unsupported("Redis keys are opened in the key editor, not the table grid".into()))
    }

    async fn table_structure(&self, _table: &TableRef) -> AppResult<TableStructure> {
        Err(AppError::Unsupported("Redis has no table structure".into()))
    }

    async fn apply_changes(&self, _table: &TableRef, _changes: &[RowChange]) -> AppResult<u64> {
        Err(AppError::Unsupported("Use the key editor to modify Redis values".into()))
    }

    async fn object_ddl(&self, _table: &TableRef, _kind: &NodeKind) -> AppResult<String> {
        Err(AppError::Unsupported("Redis has no DDL".into()))
    }

    async fn schema_snapshot(&self, _database: Option<&str>, _schema: Option<&str>) -> AppResult<SchemaSnapshot> {
        Err(AppError::Unsupported("Redis has no schema".into()))
    }

    async fn server_version(&self) -> AppResult<String> {
        let r = self.server_version_inner().await;
        self.evict_if_broken(&r).await;
        r
    }

    async fn children(&self, path: &[String]) -> AppResult<Vec<TreeNode>> {
        let r = self.children_inner(path).await;
        self.evict_if_broken(&r).await;
        r
    }

    async fn list_databases(&self) -> AppResult<Vec<String>> {
        let r = self.list_databases_inner().await;
        self.evict_if_broken(&r).await;
        r
    }

    async fn get_key(&self, database: Option<&str>, key: &str) -> AppResult<Value> {
        let r = self.get_key_inner(database, key).await;
        self.evict_if_broken(&r).await;
        r
    }

    async fn set_key(&self, database: Option<&str>, value: &Value) -> AppResult<()> {
        let r = self.set_key_inner(database, value).await;
        self.evict_if_broken(&r).await;
        r
    }

    async fn delete_key(&self, database: Option<&str>, key: &str) -> AppResult<()> {
        let r = self.delete_key_inner(database, key).await;
        self.evict_if_broken(&r).await;
        r
    }

    async fn close(&self) {
        self.conns.lock().await.clear();
        self.exec_conns.lock().await.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenizes_like_redis_cli() {
        let t = tokenize(r#"SET "a b" 'it\'s' "x\x41\n" plain"#).unwrap();
        assert_eq!(t, vec![b"SET".to_vec(), b"a b".to_vec(), b"it's".to_vec(), b"xA\n".to_vec(), b"plain".to_vec()]);
        assert!(tokenize(r#"GET "unterminated"#).is_err());
    }

    #[test]
    fn formats_nested_arrays() {
        let v = RValue::Array(vec![
            RValue::Array(vec![RValue::BulkString(b"a".to_vec()), RValue::Int(2)]),
            RValue::Nil,
        ]);
        assert_eq!(format_reply(&v), "1) 1) \"a\"\n   2) (integer) 2\n2) (nil)");
        assert_eq!(format_reply(&RValue::BulkString(b"\x00h\xc3\xa9".to_vec())), "\"\\x00h\u{e9}\"");
    }
}

/// Integration tests against the docker-compose Redis (`cargo test -- --ignored redis_it`).
#[cfg(test)]
mod redis_it {
    use super::*;

    fn cfg() -> ConnectionConfig {
        serde_json::from_value(json!({
            "id": "t", "name": "t", "kind": "redis", "host": "127.0.0.1", "port": 56379, "database": "2"
        }))
        .unwrap()
    }

    #[tokio::test]
    #[ignore]
    async fn redis_it_roundtrip() {
        let d = RedisDriver::connect(&cfg()).await.unwrap();
        assert!(d.server_version().await.unwrap().starts_with("Redis "));
        let db = Some("2");
        d.execute("FLUSHDB", &ExecOptions { database: Some("2".into()), schema: None, max_rows: None }).await.unwrap();

        let cases = vec![
            json!({"key": "it:str", "type": "string", "ttl": -1, "value": "héllo"}),
            json!({"key": "it:list", "type": "list", "ttl": 100, "value": ["a", "b", "a"]}),
            json!({"key": "it:set", "type": "set", "ttl": -1, "value": ["x", "y"]}),
            json!({"key": "it:zset", "type": "zset", "ttl": -1, "value": [["m1", 1.5], ["m2", 2.0]]}),
            json!({"key": "it:hash", "type": "hash", "ttl": -1, "value": {"f1": "v1", "f2": "v2"}}),
            json!({"key": "it:stream", "type": "stream", "ttl": -1, "value": [{"id": "1-1", "fields": {"a": "1"}}, {"id": "2-1", "fields": {"b": "2"}}]}),
        ];
        for c in &cases {
            d.set_key(db, c).await.unwrap();
            let got = d.get_key(db, c["key"].as_str().unwrap()).await.unwrap();
            assert_eq!(got["type"], c["type"], "{got}");
            if c["type"] == "set" {
                let mut v: Vec<String> = serde_json::from_value(got["value"].clone()).unwrap();
                v.sort();
                assert_eq!(json!(v), c["value"]);
            } else {
                assert_eq!(got["value"], c["value"], "{got}");
            }
            if c["ttl"].as_i64().unwrap() > 0 {
                assert!(got["ttl"].as_i64().unwrap() > 0);
            } else {
                assert_eq!(got["ttl"], -1);
            }
        }
        // binary string
        d.execute("SET it:bin \"\\x00\\xff\"", &ExecOptions { database: Some("2".into()), schema: None, max_rows: None }).await.unwrap();
        let b = d.get_key(db, "it:bin").await.unwrap();
        assert_eq!(b["binary"], true);
        assert_eq!(b["length"], 2);

        // rename
        let mut renamed = cases[0].clone();
        renamed["oldKey"] = json!("it:str");
        renamed["key"] = json!("it:str2");
        d.set_key(db, &renamed).await.unwrap();
        assert_eq!(d.get_key(db, "it:str").await.unwrap()["type"], "none");
        assert_eq!(d.get_key(db, "it:str2").await.unwrap()["value"], "héllo");

        // tree
        let top = d.children(&[]).await.unwrap();
        assert!(top.len() >= 16);
        assert!(top[2].detail.as_deref().unwrap().contains("keys"));
        let l1 = d.children(&["db2".into()]).await.unwrap();
        assert_eq!(l1.len(), 1, "{l1:?}");
        assert_eq!(l1[0].kind, NodeKind::KeyGroup);
        assert_eq!(l1[0].path, vec!["db2".to_string(), "it:".to_string()]);
        let l2 = d.children(&l1[0].path).await.unwrap();
        let zset = l2.iter().find(|n| n.label == "zset").unwrap();
        assert_eq!(zset.detail.as_deref(), Some("zset"));
        assert_eq!(zset.table.as_ref().unwrap().name, "it:zset");
        assert_eq!(zset.table.as_ref().unwrap().database.as_deref(), Some("2"));

        // execute
        let r = d
            .execute("LRANGE it:list 0 -1\nGET missing\nINCR it:counter\nNOPE\nSUBSCRIBE x\nSELECT 3\nDBSIZE", &ExecOptions { database: Some("2".into()), schema: None, max_rows: None })
            .await
            .unwrap();
        assert_eq!(r[0].message.as_deref(), Some("1) \"a\"\n2) \"b\"\n3) \"a\""));
        assert_eq!(r[0].rows.len(), 3);
        assert_eq!(r[1].message.as_deref(), Some("(nil)"));
        assert_eq!(r[2].message.as_deref(), Some("(integer) 1"));
        assert!(r[3].message.as_deref().unwrap().starts_with("(error) ERR"), "{:?}", r[3].message);
        assert!(r[4].message.as_deref().unwrap().contains("not supported"));
        assert_eq!(r[6].message.as_deref(), Some("(integer) 0"));

        // delete
        d.delete_key(db, "it:hash").await.unwrap();
        assert_eq!(d.get_key(db, "it:hash").await.unwrap()["type"], "none");

        // read-only
        let mut ro = cfg();
        ro.read_only = true;
        let r = RedisDriver::connect(&ro).await.unwrap();
        let out = r.execute("SET a 1\nGET it:str2", &ExecOptions { database: Some("2".into()), schema: None, max_rows: None }).await.unwrap();
        assert!(out[0].message.as_deref().unwrap().contains("read-only"));
        assert_eq!(out[1].message.as_deref(), Some("\"h\u{e9}llo\""));
        assert!(r.set_key(db, &cases[0]).await.is_err());
    }

    #[tokio::test]
    #[ignore]
    async fn redis_it_url() {
        let mut c = cfg();
        c.host = String::new();
        c.database = None;
        c.url = Some("redis://127.0.0.1:56379/3".into());
        let d = RedisDriver::connect(&c).await.unwrap();
        assert_eq!(d.default_db, 3);
        d.execute("PING", &ExecOptions { database: None, schema: None, max_rows: None }).await.unwrap();
    }
}
