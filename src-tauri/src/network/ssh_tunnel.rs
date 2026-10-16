//! Standalone SSH tunnels: local (-L) forwards and a SOCKS5 proxy (-D) over one russh session.
use super::registry::{self, Run};
use super::{NetProfile, PortForward};
use crate::db::ssh::{SshSession, connect_session};
use crate::error::{AppError, AppResult};
use std::io;
use std::net::{Ipv4Addr, Ipv6Addr};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;

/// Running tunnel. Dropping it stops the listeners and closes the SSH session.
pub struct SshRun {
    tasks: Vec<JoinHandle<()>>,
    session: Arc<SshSession>,
}

impl Drop for SshRun {
    fn drop(&mut self) {
        for t in &self.tasks {
            t.abort();
        }
        let session = self.session.clone();
        if let Ok(rt) = tokio::runtime::Handle::try_current() {
            rt.spawn(async move {
                let _ = session.disconnect(russh::Disconnect::ByApplication, "", "en").await;
            });
        }
    }
}

pub fn forward_detail(f: &PortForward, port: u16) -> String {
    match f.kind.as_str() {
        "dynamic" => format!("SOCKS5 127.0.0.1:{port}"),
        _ => format!("127.0.0.1:{port} → {}:{}", f.remote_host, f.remote_port),
    }
}

pub async fn connect(id: String, generation: u64, profile: NetProfile) -> AppResult<()> {
    let ssh = profile.ssh.clone().ok_or_else(|| AppError::msg("SSH server settings are missing"))?;
    let target = format!("{}@{}:{}", ssh.user, ssh.host, if ssh.port == 0 { 22 } else { ssh.port });
    registry::log(&id, &format!("Connecting to {target} ({} auth)", if ssh.auth == "key" { "key" } else { "password" }));
    let session = Arc::new(connect_session(&ssh).await?);
    registry::log(&id, "Authenticated");
    let mut run = SshRun { tasks: vec![], session: session.clone() };
    let mut ports = Vec::new();
    let mut details = Vec::new();
    for f in &profile.forwards {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, f.bind_port))
            .await
            .map_err(|e| AppError::msg(format!("Cannot listen on 127.0.0.1:{}: {e}", f.bind_port)))?;
        let port = listener.local_addr()?.port();
        let d = forward_detail(f, port);
        registry::log(&id, &format!("Listening: {d}"));
        details.push(d);
        ports.push(port);
        run.tasks.push(tokio::spawn(accept_loop(id.clone(), listener, session.clone(), f.clone())));
    }
    if profile.forwards.is_empty() {
        registry::log(&id, "No port forwards configured; the session is only kept open");
    }
    let monitor_id = id.clone();
    run.tasks.push(tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            if session.is_closed() {
                registry::set_error(&monitor_id, generation, "SSH connection lost");
                drop(registry::take_run_if(&monitor_id, generation));
                break;
            }
        }
    }));
    let detail = if details.is_empty() { format!("ssh {target}") } else { details.join(", ") };
    if let Err(stale) = registry::store_run(&id, generation, Run::Ssh(run)) {
        drop(stale); // disconnected while we were connecting
        return Ok(());
    }
    registry::set_connected(&id, generation, Some(detail), ports);
    Ok(())
}

async fn accept_loop(id: String, listener: TcpListener, session: Arc<SshSession>, fwd: PortForward) {
    loop {
        let Ok((socket, peer)) = listener.accept().await else { break };
        let session = session.clone();
        let fwd = fwd.clone();
        let id = id.clone();
        tokio::spawn(async move {
            let _ = socket.set_nodelay(true);
            let res = if fwd.kind == "dynamic" {
                serve_socks(&id, socket, peer, &session).await
            } else {
                serve_local(&id, socket, peer, &session, &fwd.remote_host, fwd.remote_port).await
            };
            if let Err(e) = res {
                registry::log(&id, &format!("Forward from {peer} failed: {e}"));
            }
        });
    }
}

async fn open_channel(session: &SshSession, host: &str, port: u16, peer: std::net::SocketAddr) -> io::Result<russh::ChannelStream<russh::client::Msg>> {
    let ch = session
        .channel_open_direct_tcpip(host.to_string(), port as u32, peer.ip().to_string(), peer.port() as u32)
        .await
        .map_err(|e| io::Error::other(format!("cannot open channel to {host}:{port}: {e}")))?;
    Ok(ch.into_stream())
}

async fn serve_local(id: &str, socket: TcpStream, peer: std::net::SocketAddr, session: &SshSession, host: &str, port: u16) -> io::Result<()> {
    let mut stream = open_channel(session, host, port, peer).await?;
    let mut socket = super::traffic::Counted::new(socket, id);
    let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
    Ok(())
}

async fn serve_socks(id: &str, mut socket: TcpStream, peer: std::net::SocketAddr, session: &SshSession) -> io::Result<()> {
    let (host, port) = socks5_accept(&mut socket).await?;
    match open_channel(session, &host, port, peer).await {
        Ok(mut stream) => {
            socks5_reply(&mut socket, REP_OK).await?;
            let mut socket = super::traffic::Counted::new(socket, id);
            let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
            Ok(())
        }
        Err(e) => {
            let _ = socks5_reply(&mut socket, REP_REFUSED).await;
            Err(e)
        }
    }
}

pub const REP_OK: u8 = 0x00;
pub const REP_REFUSED: u8 = 0x05;
const REP_CMD_UNSUPPORTED: u8 = 0x07;
const REP_ATYP_UNSUPPORTED: u8 = 0x08;

fn proto_err(msg: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, format!("SOCKS5: {msg}"))
}

/// Server side of a SOCKS5 handshake (RFC 1928, no authentication, CONNECT only).
/// Returns the requested destination; the caller must answer with `socks5_reply`.
pub async fn socks5_accept<S: AsyncRead + AsyncWrite + Unpin>(s: &mut S) -> io::Result<(String, u16)> {
    let mut head = [0u8; 2];
    s.read_exact(&mut head).await?;
    if head[0] != 5 {
        return Err(proto_err("unsupported protocol version"));
    }
    let mut methods = vec![0u8; head[1] as usize];
    s.read_exact(&mut methods).await?;
    if !methods.contains(&0) {
        s.write_all(&[5, 0xFF]).await?;
        return Err(proto_err("client requires authentication"));
    }
    s.write_all(&[5, 0]).await?;
    let mut req = [0u8; 4];
    s.read_exact(&mut req).await?;
    if req[0] != 5 {
        return Err(proto_err("bad request version"));
    }
    if req[1] != 1 {
        socks5_reply(s, REP_CMD_UNSUPPORTED).await?;
        return Err(proto_err("only CONNECT is supported"));
    }
    let host = match req[3] {
        1 => {
            let mut a = [0u8; 4];
            s.read_exact(&mut a).await?;
            Ipv4Addr::from(a).to_string()
        }
        3 => {
            let mut len = [0u8; 1];
            s.read_exact(&mut len).await?;
            let mut name = vec![0u8; len[0] as usize];
            s.read_exact(&mut name).await?;
            String::from_utf8(name).map_err(|_| proto_err("invalid domain name"))?
        }
        4 => {
            let mut a = [0u8; 16];
            s.read_exact(&mut a).await?;
            Ipv6Addr::from(a).to_string()
        }
        _ => {
            socks5_reply(s, REP_ATYP_UNSUPPORTED).await?;
            return Err(proto_err("unsupported address type"));
        }
    };
    let mut port = [0u8; 2];
    s.read_exact(&mut port).await?;
    Ok((host, u16::from_be_bytes(port)))
}

pub async fn socks5_reply<S: AsyncWrite + Unpin>(s: &mut S, code: u8) -> io::Result<()> {
    s.write_all(&[5, code, 0, 1, 0, 0, 0, 0, 0, 0]).await?;
    s.flush().await
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn handshake(req: Vec<u8>) -> (io::Result<(String, u16)>, Vec<u8>) {
        let (mut client, mut server) = tokio::io::duplex(1024);
        client.write_all(&req).await.unwrap();
        let res = socks5_accept(&mut server).await;
        drop(server);
        let mut got = Vec::new();
        client.read_to_end(&mut got).await.unwrap();
        (res, got)
    }

    #[tokio::test]
    async fn socks_ipv4() {
        let (res, got) = handshake(vec![5, 1, 0, 5, 1, 0, 1, 10, 0, 0, 5, 0x15, 0x38]).await;
        assert_eq!(res.unwrap(), ("10.0.0.5".to_string(), 5432));
        assert_eq!(got, vec![5, 0]);
    }

    #[tokio::test]
    async fn socks_domain_and_ipv6() {
        let mut req = vec![5, 2, 2, 0, 5, 1, 0, 3, 11];
        req.extend_from_slice(b"db.internal");
        req.extend_from_slice(&443u16.to_be_bytes());
        let (res, _) = handshake(req).await;
        assert_eq!(res.unwrap(), ("db.internal".to_string(), 443));

        let mut req = vec![5, 1, 0, 5, 1, 0, 4];
        req.extend_from_slice(&"::1".parse::<Ipv6Addr>().unwrap().octets());
        req.extend_from_slice(&80u16.to_be_bytes());
        let (res, _) = handshake(req).await;
        assert_eq!(res.unwrap(), ("::1".to_string(), 80));
    }

    #[tokio::test]
    async fn socks_rejections() {
        // Only username/password auth offered → 0xFF.
        let (res, got) = handshake(vec![5, 1, 2]).await;
        assert!(res.is_err());
        assert_eq!(got, vec![5, 0xFF]);
        // BIND command → "command not supported".
        let (res, got) = handshake(vec![5, 1, 0, 5, 2, 0, 1, 1, 2, 3, 4, 0, 80]).await;
        assert!(res.is_err());
        assert_eq!(got, vec![5, 0, 5, REP_CMD_UNSUPPORTED, 0, 1, 0, 0, 0, 0, 0, 0]);
        // SOCKS4 client.
        let (res, _) = handshake(vec![4, 1, 0, 80]).await;
        assert!(res.is_err());
    }

    #[test]
    fn details() {
        let l = PortForward { kind: "local".into(), bind_port: 0, remote_host: "db.internal".into(), remote_port: 5432, namespace: String::new() };
        assert_eq!(forward_detail(&l, 5433), "127.0.0.1:5433 → db.internal:5432");
        let d = PortForward { kind: "dynamic".into(), bind_port: 1080, remote_host: String::new(), remote_port: 0, namespace: String::new() };
        assert_eq!(forward_detail(&d, 1080), "SOCKS5 127.0.0.1:1080");
    }

    /// Needs the throwaway sshd described in `db::ssh` tests (127.0.0.1:52222, devcat/devcat,
    /// AllowTcpForwarding yes) and a Postgres reachable from it (DEVCAT_SSH_TARGET, default "postgres:5432").
    #[tokio::test]
    #[ignore]
    async fn tunnel_local_and_socks() {
        let port: u16 = std::env::var("DEVCAT_SSH_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(52222);
        if TcpStream::connect(("127.0.0.1", port)).await.is_err() {
            eprintln!("skipping: no SSH test server");
            return;
        }
        let target = std::env::var("DEVCAT_SSH_TARGET").unwrap_or_else(|_| "postgres:5432".into());
        let (th, tp) = target.split_once(':').unwrap();
        let tp: u16 = tp.parse().unwrap();
        let mut p = super::super::store::tests::profile(super::super::NetKind::Ssh);
        p.id = "ssh-tunnel-test".into();
        p.ssh = Some(crate::models::SshConfig {
            enabled: true,
            host: "127.0.0.1".into(),
            port,
            user: "devcat".into(),
            auth: "password".into(),
            key_path: None,
            password: Some("devcat".into()),
        });
        p.forwards = vec![
            PortForward { kind: "local".into(), bind_port: 0, remote_host: th.into(), remote_port: tp, namespace: String::new() },
            PortForward { kind: "dynamic".into(), bind_port: 0, remote_host: String::new(), remote_port: 0, namespace: String::new() },
        ];
        let generation = registry::begin_connect(&p.id).unwrap();
        connect(p.id.clone(), generation, p.clone()).await.unwrap();
        let st = registry::status(&p.id);
        assert_eq!(st.state, "connected");
        let (lp, sp) = (st.local_ports[0], st.local_ports[1]);
        // Postgres answers an SSLRequest with 'S' or 'N'.
        let ssl_request = [0u8, 0, 0, 8, 0x04, 0xd2, 0x16, 0x2f];
        let mut s = TcpStream::connect(("127.0.0.1", lp)).await.unwrap();
        s.write_all(&ssl_request).await.unwrap();
        let mut b = [0u8; 1];
        s.read_exact(&mut b).await.unwrap();
        assert!(b[0] == b'S' || b[0] == b'N');

        let mut s = TcpStream::connect(("127.0.0.1", sp)).await.unwrap();
        let mut req = vec![5, 1, 0, 5, 1, 0, 3, th.len() as u8];
        req.extend_from_slice(th.as_bytes());
        req.extend_from_slice(&tp.to_be_bytes());
        s.write_all(&req).await.unwrap();
        let mut rep = [0u8; 12];
        s.read_exact(&mut rep).await.unwrap();
        assert_eq!(&rep[..4], &[5, 0, 5, 0]);
        s.write_all(&ssl_request).await.unwrap();
        s.read_exact(&mut b).await.unwrap();
        assert!(b[0] == b'S' || b[0] == b'N');

        let (g2, run) = registry::begin_disconnect(&p.id).unwrap();
        drop(run);
        registry::set_disconnected(&p.id, g2);
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(TcpStream::connect(("127.0.0.1", lp)).await.is_err());
    }
}
