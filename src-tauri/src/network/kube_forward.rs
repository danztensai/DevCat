//! Kubernetes port-forward tunnels: local ports on 127.0.0.1 forwarded to a service or pod
//! through the cluster API, using one of DevCat's Kubernetes connections (its kubeconfig and
//! context). Turned on and off like a VPN, and a database connection can depend on it.
//!
//! Every client connection gets its own port-forward session, so one connection closing
//! can't take the others down (on some clusters, e.g. RKE2, closing any connection kills a
//! shared `kubectl port-forward`). For services the backing pod is looked up again for new
//! connections (cached for a few seconds), so a failover (e.g. a new database primary behind
//! a CloudNativePG `-rw` service) is followed like `kubectl port-forward svc/…` does.
use super::registry::{self, Run};
use super::{NetProfile, PortForward};
use crate::error::{AppError, AppResult};
use k8s_openapi::api::core::v1::Pod;
use kube::Api;
use std::net::Ipv4Addr;
use std::time::{Duration, Instant};
use tauri::Manager;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

/// How long a service → pod lookup is reused for new connections.
const RESOLVE_TTL: Duration = Duration::from_secs(5);

/// Option key: the DevCat Kubernetes connection whose kubeconfig / context is used.
pub const CONN_OPTION: &str = "k8sConnId";

pub struct KubeRun {
    tasks: Vec<JoinHandle<()>>,
}

impl Drop for KubeRun {
    fn drop(&mut self) {
        // Aborting an accept loop drops its JoinSet, which ends that forward's connections.
        for t in &self.tasks {
            t.abort();
        }
    }
}

/// "service/postgres-prod-rw" style label for logs and the status line.
pub fn target_label(f: &PortForward) -> String {
    let kind = if f.kind == "pod" { "pod" } else { "svc" };
    format!("{kind}/{}:{} ({})", f.remote_host, f.remote_port, if f.namespace.is_empty() { "default" } else { &f.namespace })
}

pub fn forward_detail(f: &PortForward, port: u16) -> String {
    format!("127.0.0.1:{port} → {}", target_label(f))
}

/// One line for the sidebar: "svc/postgres-prod-rw → :6543" (+ "and 2 more").
pub fn summary(forwards: &[PortForward]) -> String {
    let Some(f) = forwards.first() else { return String::new() };
    let kind = if f.kind == "pod" { "pod" } else { "svc" };
    let local = if f.bind_port == 0 { "auto".to_string() } else { format!(":{}", f.bind_port) };
    let more = if forwards.len() > 1 { format!(" and {} more", forwards.len() - 1) } else { String::new() };
    format!("{kind}/{} → {local}{more}", f.remote_host)
}

/// Problems with a forward's settings (None = fine).
pub fn validate(f: &PortForward) -> Option<String> {
    if f.kind != "service" && f.kind != "pod" {
        return Some(format!("Unknown Kubernetes target \"{}\" (service or pod)", f.kind));
    }
    if f.remote_host.trim().is_empty() {
        return Some("Each forward needs a service or pod name".into());
    }
    if f.remote_port == 0 {
        return Some("Each forward needs the remote port (e.g. 5432)".into());
    }
    None
}

/// Boxed with a concrete type: building the Kubernetes client may itself start a network
/// profile (the connection's own VPN / tunnel), which leads back into `start_connect`. Without
/// the box the compiler's `Send` check of that spawned future would be cyclic.
pub fn connect_boxed(id: String, generation: u64, profile: NetProfile) -> std::pin::Pin<Box<dyn std::future::Future<Output = AppResult<()>> + Send>> {
    Box::pin(connect(id, generation, profile))
}

async fn connect(id: String, generation: u64, profile: NetProfile) -> AppResult<()> {
    let conn_id = profile
        .options
        .get(CONN_OPTION)
        .filter(|s| !s.is_empty())
        .cloned()
        .ok_or_else(|| AppError::msg("Pick the Kubernetes connection this tunnel uses"))?;
    let app = registry::APP.get().ok_or_else(|| AppError::msg("DevCat isn't ready yet"))?;
    let cfg = {
        let state = app.state::<crate::state::AppState>();
        state.store.get(&conn_id).map_err(|_| AppError::msg("The Kubernetes connection this tunnel uses was deleted"))?
    };
    registry::log(&id, &format!("Using Kubernetes connection \"{}\"", cfg.name));
    let conn = crate::infra::k8s::build_conn(&cfg).await?;
    registry::log(&id, &format!("Cluster: context {} ({})", conn.context, conn.server));
    if profile.forwards.is_empty() {
        return Err(AppError::msg("Add at least one port forward"));
    }
    let mut run = KubeRun { tasks: vec![] };
    let mut ports = Vec::new();
    let mut details = Vec::new();
    for f in &profile.forwards {
        if let Some(e) = validate(f) {
            return Err(AppError::msg(e));
        }
        let ns = if f.namespace.is_empty() { conn.namespace.clone() } else { f.namespace.clone() };
        // Fail fast (like the cluster being unreachable or the login expired) before listening.
        let first = resolve(&conn.client, &ns, f).await.map_err(|e| AppError::msg(format!("{}: {e}", target_label(f))))?;
        registry::log(&id, &format!("{} → pod {} port {}", target_label(f), first.0, first.1));
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, f.bind_port))
            .await
            .map_err(|e| AppError::msg(format!("Cannot listen on 127.0.0.1:{}: {e}", f.bind_port)))?;
        let port = listener.local_addr()?.port();
        let d = forward_detail(f, port);
        registry::log(&id, &format!("Listening: {d}"));
        details.push(d);
        ports.push(port);
        run.tasks.push(tokio::spawn(accept_loop(id.clone(), listener, conn.client.clone(), ns, f.clone(), first)));
    }
    if let Err(stale) = registry::store_run(&id, generation, Run::Kube(run)) {
        drop(stale); // disconnected while we were connecting
        return Ok(());
    }
    registry::set_connected(&id, generation, Some(details.join(", ")), ports);
    Ok(())
}

/// (pod, container port) for a forward.
async fn resolve(client: &kube::Client, ns: &str, f: &PortForward) -> AppResult<(String, u16)> {
    if f.kind == "pod" {
        Ok((f.remote_host.clone(), f.remote_port))
    } else {
        crate::infra::k8s::streams::resolve_service(client, ns, &f.remote_host, f.remote_port).await
    }
}

async fn accept_loop(id: String, listener: TcpListener, client: kube::Client, ns: String, f: PortForward, first: (String, u16)) {
    let pods: Api<Pod> = Api::namespaced(client.clone(), &ns);
    let mut target = first;
    let mut resolved_at = Instant::now();
    let mut conns = tokio::task::JoinSet::new();
    let mut n: u64 = 0;
    loop {
        let Ok((socket, peer)) = listener.accept().await else { break };
        while conns.try_join_next().is_some() {}
        n += 1;
        let _ = socket.set_nodelay(true);
        // Services: follow the pod behind the service (failover) for new connections.
        if f.kind == "service" && resolved_at.elapsed() > RESOLVE_TTL {
            match resolve(&client, &ns, &f).await {
                Ok(t) => {
                    if t != target {
                        registry::log(&id, &format!("{} now → pod {} port {}", target_label(&f), t.0, t.1));
                    }
                    target = t;
                    resolved_at = Instant::now();
                }
                Err(e) => registry::log(&id, &format!("Couldn't look up {} again ({e}); using pod {}", target_label(&f), target.0)),
            }
        }
        let mut pf = pods.portforward(&target.0, &[target.1]).await;
        if pf.is_err() && f.kind == "service" {
            // The pod may have just been replaced: look it up again once.
            if let Ok(t) = resolve(&client, &ns, &f).await {
                registry::log(&id, &format!("{} now → pod {} port {}", target_label(&f), t.0, t.1));
                target = t;
                resolved_at = Instant::now();
                pf = pods.portforward(&target.0, &[target.1]).await;
            }
        }
        let mut pf = match pf {
            Ok(pf) => pf,
            Err(e) => {
                registry::log(&id, &format!("Connection #{n} from {peer}: port-forward to pod {} failed: {e}", target.0));
                continue; // dropping the socket closes the client's connection
            }
        };
        let port = target.1;
        let id2 = id.clone();
        conns.spawn(async move {
            let Some(mut upstream) = pf.take_stream(port) else { return };
            let mut socket = super::traffic::Counted::new(socket, &id2);
            if let Err(e) = tokio::io::copy_bidirectional(&mut socket, &mut upstream).await {
                let msg = e.to_string();
                if !msg.contains("reset") && !msg.contains("broken pipe") {
                    registry::log(&id2, &format!("Connection #{n}: {msg}"));
                }
            }
            drop(upstream);
            let _ = pf.join().await;
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fwd(kind: &str, name: &str, ns: &str, remote: u16, bind: u16) -> PortForward {
        PortForward { kind: kind.into(), bind_port: bind, remote_host: name.into(), remote_port: remote, namespace: ns.into() }
    }

    #[test]
    fn labels_and_validation() {
        let f = fwd("service", "postgres-prod-rw", "database", 5432, 6543);
        assert_eq!(forward_detail(&f, 6543), "127.0.0.1:6543 → svc/postgres-prod-rw:5432 (database)");
        assert_eq!(target_label(&fwd("pod", "web-0", "", 80, 0)), "pod/web-0:80 (default)");
        assert!(validate(&f).is_none());
        assert!(validate(&fwd("service", " ", "database", 5432, 6543)).is_some());
        assert!(validate(&fwd("service", "db", "database", 0, 6543)).is_some());
        assert!(validate(&fwd("local", "db", "database", 5432, 6543)).is_some());
        assert_eq!(summary(&[f.clone()]), "svc/postgres-prod-rw → :6543");
        assert_eq!(summary(&[f.clone(), fwd("pod", "x", "", 1, 0)]), "svc/postgres-prod-rw → :6543 and 1 more");
    }

    /// Live check against a real cluster (no login, no data): sequential and concurrent
    /// connections through one forward each get Postgres' answer to an SSLRequest.
    /// DEVCAT_K8S_CONTEXT=contabo-prod DEVCAT_K8S_NS=database DEVCAT_K8S_SVC=postgres-prod-rw \
    ///   cargo test kube_forward::tests::live -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn live() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let ctx = std::env::var("DEVCAT_K8S_CONTEXT").expect("DEVCAT_K8S_CONTEXT");
        let ns = std::env::var("DEVCAT_K8S_NS").unwrap_or_else(|_| "default".into());
        let svc = std::env::var("DEVCAT_K8S_SVC").expect("DEVCAT_K8S_SVC");
        let cfg: crate::models::ConnectionConfig = serde_json::from_value(serde_json::json!({
            "id": "probe", "name": "probe", "kind": "kubernetes", "options": { "context": ctx }
        })).unwrap();
        let conn = crate::infra::k8s::build_conn(&cfg).await.unwrap();
        let f = fwd("service", &svc, &ns, 5432, 0);
        let first = resolve(&conn.client, &ns, &f).await.unwrap();
        println!("resolved {} -> pod {} port {}", target_label(&f), first.0, first.1);
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let task = tokio::spawn(accept_loop("probe".into(), listener, conn.client.clone(), ns, f, first));
        async fn ssl_request(port: u16) -> u8 {
            let mut s = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            s.write_all(&[0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x2f]).await.unwrap();
            let mut b = [0u8; 1];
            tokio::time::timeout(Duration::from_secs(20), s.read_exact(&mut b)).await.expect("answer in time").unwrap();
            b[0] // connection closes here: the case that kills a shared kubectl forward
        }
        for i in 1..=4 {
            let a = ssl_request(port).await;
            println!("sequential #{i}: {:?}", a as char);
            assert!(a == b'S' || a == b'N');
        }
        let answers = futures::future::join_all((0..4).map(|_| ssl_request(port))).await;
        println!("concurrent: {:?}", answers.iter().map(|a| *a as char).collect::<Vec<_>>());
        assert!(answers.iter().all(|a| *a == b'S' || *a == b'N'));
        task.abort();
    }
}
