//! Read-only phones may still run queries, as long as every statement only reads.
//! Deliberately strict: anything we can't classify is refused.
use crate::models::ConnectionKind;

/// Remove `-- …` / `# …` line comments and `/* … */` blocks (outside quotes).
fn strip_sql_comments(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let b: Vec<char> = s.chars().collect();
    let (mut i, mut quote) = (0, None::<char>);
    while i < b.len() {
        let c = b[i];
        if let Some(q) = quote {
            out.push(c);
            if c == q {
                quote = None;
            }
            i += 1;
            continue;
        }
        match c {
            '\'' | '"' | '`' => {
                quote = Some(c);
                out.push(c);
            }
            '-' if b.get(i + 1) == Some(&'-') => {
                while i < b.len() && b[i] != '\n' {
                    i += 1;
                }
                continue;
            }
            '#' => {
                while i < b.len() && b[i] != '\n' {
                    i += 1;
                }
                continue;
            }
            '/' if b.get(i + 1) == Some(&'*') => {
                i += 2;
                while i + 1 < b.len() && !(b[i] == '*' && b[i + 1] == '/') {
                    i += 1;
                }
                i += 2;
                out.push(' ');
                continue;
            }
            _ => out.push(c),
        }
        i += 1;
    }
    out
}

/// Words that change data or schema anywhere in a statement (catches `WITH … DELETE`,
/// `SELECT … INTO`, `SELECT … FOR UPDATE`, function calls aside).
const WRITE_WORDS: &[&str] = &[
    "insert", "update", "delete", "merge", "upsert", "replace", "create", "drop", "alter", "truncate", "rename", "grant",
    "revoke", "into", "lock", "call", "exec", "execute", "do", "copy", "vacuum", "analyze", "reindex", "cluster", "set",
    "reset", "load", "attach", "detach", "comment", "refresh", "kill", "shutdown",
];

fn sql_read_only(script: &str) -> bool {
    let clean = strip_sql_comments(script);
    let mut any = false;
    for stmt in clean.split(';').map(str::trim).filter(|s| !s.is_empty()) {
        any = true;
        // Quoted text can't change anything: blank it out before looking at words.
        let mut words_src = String::with_capacity(stmt.len());
        let mut quote = None;
        for c in stmt.chars() {
            match quote {
                Some(q) if c == q => quote = None,
                Some(_) => {}
                None if matches!(c, '\'' | '"' | '`') => quote = Some(c),
                None => words_src.push(c.to_ascii_lowercase()),
            }
        }
        let words: Vec<&str> = words_src.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_')).filter(|w| !w.is_empty()).collect();
        let Some(first) = words.first() else { continue };
        if !matches!(*first, "select" | "with" | "show" | "explain" | "describe" | "desc" | "values" | "table") {
            return false;
        }
        if words.iter().any(|w| WRITE_WORDS.contains(w)) {
            return false;
        }
    }
    any
}

const REDIS_READS: &[&str] = &[
    "get", "mget", "strlen", "getrange", "exists", "type", "ttl", "pttl", "scan", "keys", "dbsize", "info", "ping", "hget",
    "hgetall", "hmget", "hkeys", "hvals", "hlen", "hexists", "hscan", "lrange", "llen", "lindex", "smembers", "scard",
    "sismember", "sscan", "zrange", "zrangebyscore", "zrevrange", "zcard", "zscore", "zrank", "zscan", "xrange",
    "xrevrange", "xlen", "xinfo", "memory", "object", "select", "time", "echo", "randomkey", "json.get", "bitcount",
    "getbit", "pfcount",
];

fn redis_read_only(script: &str) -> bool {
    let mut any = false;
    for line in script.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#') && !l.starts_with("//")) {
        any = true;
        let cmd = line.split_whitespace().next().unwrap_or("").to_ascii_lowercase();
        if !REDIS_READS.contains(&cmd.as_str()) {
            return false;
        }
        // MEMORY / OBJECT / XINFO have only reading subcommands except MEMORY PURGE.
        if cmd == "memory" && line.to_ascii_lowercase().contains("purge") {
            return false;
        }
    }
    any
}

fn mongo_read_only(script: &str) -> bool {
    let mut any = false;
    for stmt in script.split([';', '\n']).map(str::trim).filter(|s| !s.is_empty() && !s.starts_with("//")) {
        any = true;
        let lower = stmt.to_ascii_lowercase();
        if lower.starts_with("show ") || lower.starts_with("use ") {
            continue;
        }
        // db.<collection>.<method>(…) or db.getCollection("x").<method>(…)
        let Some(rest) = stmt.strip_prefix("db.") else { return false };
        let method = rest.split('(').next().unwrap_or("").rsplit('.').next().unwrap_or("");
        let reads = ["find", "findOne", "countDocuments", "estimatedDocumentCount", "count", "distinct", "aggregate", "getIndexes", "stats"];
        if !reads.contains(&method) {
            return false;
        }
        // Chained calls after find() (sort/limit/…) are fine; writes in a pipeline are not.
        if lower.contains("$out") || lower.contains("$merge") {
            return false;
        }
    }
    any
}

/// May a read-only phone run `script` on a connection of this kind?
pub fn allowed(kind: Option<ConnectionKind>, script: &str) -> bool {
    match kind {
        Some(ConnectionKind::Postgres | ConnectionKind::Mysql | ConnectionKind::Sqlite | ConnectionKind::Mssql) => sql_read_only(script),
        Some(ConnectionKind::Redis) => redis_read_only(script),
        Some(ConnectionKind::Mongodb) => mongo_read_only(script),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ConnectionKind::*;

    #[test]
    fn sql() {
        for ok in [
            "SELECT * FROM orders",
            "select 1; select 2;",
            "-- note: delete later\nSELECT id FROM t WHERE note = 'drop table x'",
            "WITH t AS (SELECT 1) SELECT * FROM t",
            "EXPLAIN SELECT * FROM t",
            "/* update */ SHOW TABLES",
        ] {
            assert!(allowed(Some(Postgres), ok), "{ok}");
        }
        for bad in [
            "DELETE FROM orders",
            "select 1; drop table x",
            "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d",
            "SELECT * INTO backup FROM t",
            "SELECT * FROM t FOR UPDATE",
            "UPDATE t SET a = 1",
            "",
            "-- only a comment",
            "CALL cleanup()",
        ] {
            assert!(!allowed(Some(Mysql), bad), "{bad}");
        }
    }

    #[test]
    fn redis() {
        assert!(allowed(Some(Redis), "GET a\nHGETALL user:1\n# comment\nSCAN 0 MATCH user:*"));
        assert!(!allowed(Some(Redis), "GET a\nDEL a"));
        assert!(!allowed(Some(Redis), "FLUSHALL"));
        assert!(!allowed(Some(Redis), "MEMORY PURGE"));
    }

    #[test]
    fn mongo() {
        assert!(allowed(Some(Mongodb), "db.orders.find({status: 'paid'}).sort({_id: -1}).limit(5)"));
        assert!(allowed(Some(Mongodb), "use shop\ndb.orders.aggregate([{$group: {_id: '$country'}}])"));
        assert!(!allowed(Some(Mongodb), "db.orders.deleteMany({})"));
        assert!(!allowed(Some(Mongodb), "db.orders.aggregate([{$out: 'x'}])"));
        assert!(!allowed(Some(Kubernetes), "anything"));
        assert!(!allowed(None, "SELECT 1"));
    }
}
