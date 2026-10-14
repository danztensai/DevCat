//! SSH tunnelling for database connections. STUB — to be implemented.
//!
//! Drivers call `open_endpoint(cfg)` before connecting and connect to the returned
//! host/port instead of `cfg.host`/`cfg.port`. They must keep the returned
//! `SshTunnel` alive (store it in the driver struct) for the lifetime of the session.
use crate::error::AppResult;
use crate::models::ConnectionConfig;

/// Guard that keeps a local port-forward alive; dropping it closes the tunnel.
pub struct SshTunnel {}

pub struct Endpoint {
    pub host: String,
    pub port: u16,
    pub tunnel: Option<SshTunnel>,
}

/// Resolve the endpoint to connect to. Without SSH this is just `cfg.host:cfg.port`
/// (falling back to `default_port`). With SSH enabled it opens a tunnel and returns
/// `127.0.0.1:<local port>`.
pub async fn open_endpoint(cfg: &ConnectionConfig, default_port: u16) -> AppResult<Endpoint> {
    Ok(Endpoint {
        host: if cfg.host.is_empty() { "localhost".into() } else { cfg.host.clone() },
        port: cfg.port.unwrap_or(default_port),
        tunnel: None,
    })
}
