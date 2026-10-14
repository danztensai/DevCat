//! Helpers shared by SQL drivers: identifier quoting, literal rendering,
//! script splitting, DML generation for grid edits.
use super::Dialect;
use serde_json::Value;

pub fn quote_ident(d: Dialect, ident: &str) -> String {
    match d {
        Dialect::Mysql => format!("`{}`", ident.replace('`', "``")),
        Dialect::Mssql => format!("[{}]", ident.replace(']', "]]")),
        _ => format!("\"{}\"", ident.replace('"', "\"\"")),
    }
}

/// Render a JSON value as a SQL literal for the given dialect.
pub fn literal(d: Dialect, v: &Value) -> String {
    match v {
        Value::Null => "NULL".into(),
        Value::Bool(b) => match d {
            Dialect::Postgres => if *b { "TRUE".into() } else { "FALSE".into() },
            _ => if *b { "1".into() } else { "0".into() },
        },
        Value::Number(n) => n.to_string(),
        Value::String(s) => {
            let esc = s.replace('\'', "''");
            match d {
                Dialect::Mysql => format!("'{}'", esc.replace('\\', "\\\\")),
                Dialect::Mssql => format!("N'{esc}'"),
                _ => format!("'{esc}'"),
            }
        }
        other => format!("'{}'", other.to_string().replace('\'', "''")),
    }
}

/// Split a script into individual statements for the given dialect, honoring
/// quotes, comments, Postgres dollar-quoting, MySQL `DELIMITER` and MSSQL `GO`.
/// STUB: naive split on ';' — to be replaced.
pub fn split_statements(_d: Dialect, script: &str) -> Vec<String> {
    script.split(';').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()
}
