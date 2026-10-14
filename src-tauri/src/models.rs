use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Every kind of target DevCat can connect to.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionKind {
    Postgres,
    Mysql,
    Sqlite,
    Mssql,
    Mongodb,
    Redis,
    Kubernetes,
    Rabbitmq,
}

impl ConnectionKind {
    pub fn is_database(&self) -> bool {
        !matches!(self, ConnectionKind::Kubernetes | ConnectionKind::Rabbitmq)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SshConfig {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub user: String,
    /// "password" | "key"
    pub auth: String,
    pub key_path: Option<String>,
    /// Never persisted to disk; stored in the OS keychain.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
}

/// A saved connection profile. `password` is never written to the JSON store;
/// it lives in the OS keychain (macOS Keychain / Windows Credential Manager).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    pub id: String,
    pub name: String,
    pub kind: ConnectionKind,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub user: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    /// Default database / initial catalog. For Redis: db index. For RabbitMQ: vhost.
    #[serde(default)]
    pub database: Option<String>,
    /// SQLite file path, or kubeconfig path for Kubernetes.
    #[serde(default)]
    pub file_path: Option<String>,
    /// Full connection string / URI override (e.g. mongodb+srv://...). Takes precedence.
    #[serde(default)]
    pub url: Option<String>,
    /// disable | prefer | require | verify-full
    #[serde(default)]
    pub ssl_mode: Option<String>,
    #[serde(default)]
    pub ssh: Option<SshConfig>,
    /// UI color tag (e.g. "#e11d48" for production).
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
    /// Driver specific options. Kubernetes: "context". RabbitMQ: "managementPort", "useTls".
    #[serde(default)]
    pub options: HashMap<String, String>,
    #[serde(default)]
    pub read_only: bool,
}
