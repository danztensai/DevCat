//! Long-running Kubernetes streams: logs, watches, exec terminals and port-forwards.
//! Output is pushed to the frontend with Tauri events; every stream has an id that
//! the frontend uses to filter events and to stop it.
use super::{Conn, clean, conn, dyn_api, friendly, resolve};
use crate::error::{AppError, AppResult};
use crate::state::St;
use base64::Engine;
use futures::{AsyncBufReadExt, SinkExt, StreamExt};
use k8s_openapi::api::core::v1::{Pod, Service};
use k8s_openapi::apimachinery::pkg::util::intstr::IntOrString;
use kube::api::{Api, AttachParams, ListParams, LogParams, TerminalSize};
use kube::runtime::{WatchStreamExt, watcher};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use crate::events::Owner;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::task::AbortHandle;

struct StreamEntry {
    conn_id: String,
    abort: AbortHandle,
    /// Label of the window that started the stream (stopped when it closes).
    owner: Option<String>,
}

/// Log and watch streams.
static STREAMS: Lazy<Mutex<HashMap<String, StreamEntry>>> = Lazy::new(|| Mutex::new(HashMap::new()));

/// Event sink; `events::sink()` in the app, a channel in tests.
pub(crate) type Emit = Arc<dyn Fn(&'static str, Value) + Send + Sync>;

fn to_json(v: impl Serialize) -> Value {
    serde_json::to_value(v).unwrap_or(Value::Null)
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Stops every stream / exec session / port-forward belonging to a connection.
pub(crate) fn stop_all_for(conn_id: &str) {
    STREAMS.lock().retain(|_, s| {
        let keep = s.conn_id != conn_id;
        if !keep {
            s.abort.abort();
        }
        keep
    });
    EXECS.lock().retain(|_, s| {
        let keep = s.conn_id != conn_id;
        if !keep {
            s.abort.abort();
        }
        keep
    });
    FORWARDS.lock().retain(|_, f| {
        let keep = f.info.conn_id != conn_id;
        if !keep {
            f.abort.abort();
        }
        keep
    });
}

/// Tie a log / watch stream or exec session to the window that started it.
fn set_owner(id: &str, label: &str) {
    if let Some(s) = STREAMS.lock().get_mut(id) {
        s.owner = Some(label.to_string());
    }
    if let Some(s) = EXECS.lock().get_mut(id) {
        s.owner = Some(label.to_string());
    }
}

/// Stops the log / watch streams and exec sessions started by a window (all, or one
/// connection's). Port-forwards are app-wide and keep running.
pub fn stop_owned_by(label: &str, conn_id: Option<&str>) {
    let owned = |owner: &Option<String>, conn: &str| owner.as_deref() == Some(label) && conn_id.is_none_or(|c| c == conn);
    STREAMS.lock().retain(|_, s| {
        let keep = !owned(&s.owner, &s.conn_id);
        if !keep {
            s.abort.abort();
        }
        keep
    });
    EXECS.lock().retain(|_, s| {
        let keep = !owned(&s.owner, &s.conn_id);
        if !keep {
            s.abort.abort();
        }
        keep
    });
}

#[cfg_attr(feature = "gui", tauri::command)]
pub async fn k8s_stream_stop(stream_id: String) -> AppResult<()> {
    if let Some(s) = STREAMS.lock().remove(&stream_id) {
        s.abort.abort();
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LogBatch {
    stream_id: String,
    lines: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StreamEnd {
    stream_id: String,
    error: Option<String>,
}

/// Starts streaming pod logs. Emits `k8s-log` batches (~100ms) and a final `k8s-log-end`.
#[cfg_attr(feature = "gui", tauri::command)]
#[allow(clippy::too_many_arguments)]
pub async fn k8s_logs_start(
    window: Owner,
    state: St,
    conn_id: String,
    namespace: String,
    pod: String,
    container: Option<String>,
    tail_lines: Option<i64>,
    follow: bool,
    previous: bool,
    timestamps: bool,
    since_seconds: Option<i64>,
) -> AppResult<String> {
    let c = conn(&state, &conn_id).await?;
    let lp = LogParams {
        container: container.filter(|s| !s.is_empty()),
        follow,
        previous,
        timestamps,
        tail_lines,
        since_seconds,
        ..Default::default()
    };
    let id = logs_start(&c, conn_id, crate::events::sink(), &namespace, &pod, &lp).await?;
    set_owner(&id, window.label());
    Ok(id)
}

pub(crate) async fn logs_start(c: &Conn, conn_id: String, emit: Emit, namespace: &str, pod: &str, lp: &LogParams) -> AppResult<String> {
    let api: Api<Pod> = Api::namespaced(c.client.clone(), namespace);
    // Open the stream before returning so errors (e.g. no previous container) surface directly.
    let reader = Box::pin(api.log_stream(pod, lp).await.map_err(friendly)?);
    let id = new_id();
    let sid = id.clone();
    let task = tokio::spawn(async move {
        let lines = futures::stream::unfold(reader, |mut r| async move {
            let mut buf = Vec::new();
            match r.read_until(b'\n', &mut buf).await {
                Ok(0) => None,
                Ok(_) => {
                    while matches!(buf.last(), Some(b'\n' | b'\r')) {
                        buf.pop();
                    }
                    Some((Ok(String::from_utf8_lossy(&buf).into_owned()), r))
                }
                Err(e) => Some((Err(e), r)),
            }
        });
        futures::pin_mut!(lines);
        let mut pending: Vec<String> = Vec::new();
        let mut tick = tokio::time::interval(Duration::from_millis(100));
        let flush = |pending: &mut Vec<String>| {
            if !pending.is_empty() {
                emit("k8s-log", to_json(LogBatch { stream_id: sid.clone(), lines: std::mem::take(pending) }));
            }
        };
        let error = loop {
            tokio::select! {
                line = lines.next() => match line {
                    Some(Ok(l)) => {
                        pending.push(l);
                        if pending.len() >= 5000 {
                            flush(&mut pending);
                        }
                    }
                    Some(Err(e)) => break Some(e.to_string()),
                    None => break None,
                },
                _ = tick.tick() => flush(&mut pending),
            }
        };
        flush(&mut pending);
        emit("k8s-log-end", to_json(StreamEnd { stream_id: sid.clone(), error }));
        STREAMS.lock().remove(&sid);
    });
    STREAMS.lock().insert(id.clone(), StreamEntry { conn_id, abort: task.abort_handle(), owner: None });
    Ok(id)
}

// ---------------------------------------------------------------------------
// Watch
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WatchEvent {
    stream_id: String,
    /// "Added" | "Modified" | "Deleted" | "Restarted" (object = full list) | "Error"
    #[serde(rename = "type")]
    kind: &'static str,
    object: Value,
    error: Option<String>,
}

/// Watches a kind (optionally in one namespace). The first event is `Restarted` with the
/// full list; afterwards individual Added/Modified/Deleted events follow. If the watch has
/// to re-list (e.g. 410 Gone) another `Restarted` is emitted.
#[cfg_attr(feature = "gui", tauri::command)]
pub async fn k8s_watch_start(
    window: Owner,
    state: St,
    conn_id: String,
    kind: String,
    namespace: Option<String>,
    label_selector: Option<String>,
) -> AppResult<String> {
    let c = conn(&state, &conn_id).await?;
    let id = watch_start(&c, conn_id, crate::events::sink(), &kind, namespace.as_deref(), label_selector).await?;
    set_owner(&id, window.label());
    Ok(id)
}

pub(crate) async fn watch_start(
    c: &Conn,
    conn_id: String,
    emit_fn: Emit,
    kind: &str,
    namespace: Option<&str>,
    label_selector: Option<String>,
) -> AppResult<String> {
    let r = resolve(c, kind).await?;
    let api = dyn_api(c, &r, namespace);
    let mut cfg = watcher::Config::default();
    if let Some(sel) = label_selector.filter(|s| !s.is_empty()) {
        cfg = cfg.labels(&sel);
    }
    let id = new_id();
    let sid = id.clone();
    let task = tokio::spawn(async move {
        let stream = watcher(api, cfg).default_backoff();
        futures::pin_mut!(stream);
        let mut init: Vec<Value> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        let mut init_seen: HashSet<String> = HashSet::new();
        let emit = |kind: &'static str, object: Value, error: Option<String>| {
            emit_fn("k8s-watch", to_json(WatchEvent { stream_id: sid.clone(), kind, object, error }));
        };
        let uid = |v: &Value| v["metadata"]["uid"].as_str().unwrap_or_default().to_string();
        while let Some(ev) = stream.next().await {
            match ev {
                Ok(watcher::Event::Init) => {
                    init.clear();
                    init_seen.clear();
                }
                Ok(watcher::Event::InitApply(o)) => {
                    let v = clean(o, &r, true);
                    init_seen.insert(uid(&v));
                    init.push(v);
                }
                Ok(watcher::Event::InitDone) => {
                    seen = std::mem::take(&mut init_seen);
                    emit("Restarted", Value::Array(std::mem::take(&mut init)), None);
                }
                Ok(watcher::Event::Apply(o)) => {
                    let v = clean(o, &r, true);
                    let kind = if seen.insert(uid(&v)) { "Added" } else { "Modified" };
                    emit(kind, v, None);
                }
                Ok(watcher::Event::Delete(o)) => {
                    let v = clean(o, &r, true);
                    seen.remove(&uid(&v));
                    emit("Deleted", v, None);
                }
                Err(e) => emit("Error", Value::Null, Some(e.to_string())),
            }
        }
        STREAMS.lock().remove(&sid);
    });
    STREAMS.lock().insert(id.clone(), StreamEntry { conn_id, abort: task.abort_handle(), owner: None });
    Ok(id)
}

// ---------------------------------------------------------------------------
// Exec (interactive terminal)
// ---------------------------------------------------------------------------

struct ExecSession {
    conn_id: String,
    stdin: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    resize: Option<futures::channel::mpsc::Sender<TerminalSize>>,
    abort: AbortHandle,
    owner: Option<String>,
}

static EXECS: Lazy<Mutex<HashMap<String, ExecSession>>> = Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ExecOutput {
    session_id: String,
    /// base64-encoded raw terminal bytes
    data: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ExecExit {
    session_id: String,
    status: Option<String>,
    error: Option<String>,
}

/// Starts an interactive TTY exec session. Output arrives as base64 in `k8s-exec-output`.
#[cfg_attr(feature = "gui", tauri::command)]
#[allow(clippy::too_many_arguments)]
pub async fn k8s_exec_start(
    window: Owner,
    state: St,
    conn_id: String,
    namespace: String,
    pod: String,
    container: Option<String>,
    command: Vec<String>,
    cols: u16,
    rows: u16,
) -> AppResult<String> {
    let c = conn(&state, &conn_id).await?;
    let id = exec_start(&c, conn_id, crate::events::sink(), &namespace, &pod, container, command, cols, rows).await?;
    set_owner(&id, window.label());
    Ok(id)
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn exec_start(
    c: &Conn,
    conn_id: String,
    emit: Emit,
    namespace: &str,
    pod: &str,
    container: Option<String>,
    command: Vec<String>,
    cols: u16,
    rows: u16,
) -> AppResult<String> {
    let api: Api<Pod> = Api::namespaced(c.client.clone(), namespace);
    let command = if command.is_empty() {
        vec!["/bin/sh".into(), "-c".into(), "command -v bash >/dev/null 2>&1 && exec bash || exec sh".into()]
    } else {
        command
    };
    let mut ap = AttachParams::interactive_tty();
    if let Some(ct) = container.filter(|s| !s.is_empty()) {
        ap = ap.container(ct);
    }
    let mut proc = api.exec(pod, command, &ap).await.map_err(friendly)?;
    let mut stdin = proc.stdin().ok_or_else(|| AppError::msg("exec: no stdin"))?;
    let mut stdout = proc.stdout().ok_or_else(|| AppError::msg("exec: no stdout"))?;
    let mut resize = proc.terminal_size();
    if let Some(r) = resize.as_mut() {
        let _ = r.send(TerminalSize { width: cols.max(1), height: rows.max(1) }).await;
    }
    let status = proc.take_status();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
    let id = new_id();
    let sid = id.clone();
    let task = tokio::spawn(async move {
        let mut buf = vec![0u8; 16 * 1024];
        let error = loop {
            tokio::select! {
                n = stdout.read(&mut buf) => match n {
                    Ok(0) => break None,
                    Ok(n) => {
                        let data = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                        emit("k8s-exec-output", to_json(ExecOutput { session_id: sid.clone(), data }));
                    }
                    Err(e) => break Some(e.to_string()),
                },
                input = rx.recv() => match input {
                    Some(bytes) => {
                        if let Err(e) = stdin.write_all(&bytes).await {
                            break Some(e.to_string());
                        }
                        let _ = stdin.flush().await;
                    }
                    None => break None,
                },
            }
        };
        let status = match status {
            Some(fut) => tokio::time::timeout(Duration::from_secs(2), fut)
                .await
                .ok()
                .flatten()
                .map(|s| s.message.clone().filter(|m| !m.is_empty()).or(s.status.clone()).unwrap_or_default()),
            None => None,
        };
        drop(proc);
        emit("k8s-exec-exit", to_json(ExecExit { session_id: sid.clone(), status, error }));
        EXECS.lock().remove(&sid);
    });
    EXECS.lock().insert(id.clone(), ExecSession { conn_id, stdin: tx, resize, abort: task.abort_handle(), owner: None });
    Ok(id)
}

#[cfg_attr(feature = "gui", tauri::command)]
pub async fn k8s_exec_input(session_id: String, data: String) -> AppResult<()> {
    let tx = EXECS.lock().get(&session_id).map(|s| s.stdin.clone());
    match tx {
        Some(tx) => tx.send(data.into_bytes()).map_err(|_| AppError::msg("exec session closed")),
        None => Err(AppError::msg("exec session not found")),
    }
}

#[cfg_attr(feature = "gui", tauri::command)]
pub async fn k8s_exec_resize(session_id: String, cols: u16, rows: u16) -> AppResult<()> {
    let tx = EXECS.lock().get(&session_id).and_then(|s| s.resize.clone());
    if let Some(mut tx) = tx {
        let _ = tx.send(TerminalSize { width: cols.max(1), height: rows.max(1) }).await;
    }
    Ok(())
}

#[cfg_attr(feature = "gui", tauri::command)]
pub async fn k8s_exec_stop(session_id: String) -> AppResult<()> {
    if let Some(s) = EXECS.lock().remove(&session_id) {
        s.abort.abort();
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Port forwarding
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PortForwardInfo {
    pub(crate) id: String,
    pub(crate) conn_id: String,
    pub(crate) namespace: String,
    /// "pod" | "service"
    pub(crate) kind: String,
    /// pod or service name
    pub(crate) name: String,
    /// pod currently backing the forward
    pub(crate) pod: String,
    /// port requested by the user (service port for services)
    pub(crate) remote_port: u16,
    /// resolved container port on the pod
    pub(crate) target_port: u16,
    pub(crate) local_port: u16,
    pub(crate) connections: u64,
    pub(crate) error: Option<String>,
}

struct Forward {
    info: PortForwardInfo,
    abort: AbortHandle,
}

static FORWARDS: Lazy<Mutex<HashMap<String, Forward>>> = Lazy::new(|| Mutex::new(HashMap::new()));

fn pod_ready(p: &Pod) -> bool {
    let st = p.status.as_ref();
    st.and_then(|s| s.phase.as_deref()) == Some("Running")
        && st
            .and_then(|s| s.conditions.as_ref())
            .is_some_and(|cs| cs.iter().any(|c| c.type_ == "Ready" && c.status == "True"))
}

/// Resolves a service + port to a ready backing pod and the container port.
pub(crate) async fn resolve_service(client: &kube::Client, namespace: &str, svc: &str, port: u16) -> AppResult<(String, u16)> {
    let svcs: Api<Service> = Api::namespaced(client.clone(), namespace);
    let s = svcs.get(svc).await.map_err(friendly)?;
    let spec = s.spec.unwrap_or_default();
    let selector = spec.selector.unwrap_or_default();
    if selector.is_empty() {
        return Err(AppError::msg(format!("Service {svc} has no selector; cannot pick a pod")));
    }
    let sel = selector.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join(",");
    let pods: Api<Pod> = Api::namespaced(client.clone(), namespace);
    let list = pods.list(&ListParams::default().labels(&sel)).await.map_err(friendly)?;
    let pod = list
        .items
        .into_iter()
        .find(pod_ready)
        .ok_or_else(|| AppError::msg(format!("No ready pod backs service {svc}")))?;
    let pod_name = pod.metadata.name.clone().unwrap_or_default();
    let svc_port = spec.ports.unwrap_or_default().into_iter().find(|p| p.port == port as i32);
    let target = match svc_port.and_then(|p| p.target_port) {
        Some(IntOrString::Int(i)) => i as u16,
        Some(IntOrString::String(name)) => pod
            .spec
            .iter()
            .flat_map(|s| s.containers.iter())
            .flat_map(|c| c.ports.iter().flatten())
            .find(|p| p.name.as_deref() == Some(name.as_str()))
            .map(|p| p.container_port as u16)
            .ok_or_else(|| AppError::msg(format!("Named port {name} not found on pod {pod_name}")))?,
        None => port,
    };
    Ok((pod_name, target))
}

fn update_forward(id: &str, f: impl FnOnce(&mut PortForwardInfo)) {
    if let Some(fw) = FORWARDS.lock().get_mut(id) {
        f(&mut fw.info);
    }
}

#[cfg_attr(feature = "gui", tauri::command)]
#[allow(clippy::too_many_arguments)]
pub async fn k8s_port_forward_start(
    state: St,
    conn_id: String,
    namespace: String,
    pod_or_service: String,
    kind: String,
    remote_port: u16,
    local_port: Option<u16>,
) -> AppResult<PortForwardInfo> {
    let c = conn(&state, &conn_id).await?;
    port_forward_start(&c, conn_id, namespace, pod_or_service, &kind, remote_port, local_port).await
}

pub(crate) async fn port_forward_start(
    c: &Conn,
    conn_id: String,
    namespace: String,
    pod_or_service: String,
    kind: &str,
    remote_port: u16,
    local_port: Option<u16>,
) -> AppResult<PortForwardInfo> {
    let is_service = kind == "service";
    let (pod, target_port) = if is_service {
        resolve_service(&c.client, &namespace, &pod_or_service, remote_port).await?
    } else {
        (pod_or_service.clone(), remote_port)
    };
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", local_port.unwrap_or(0)))
        .await
        .map_err(|e| AppError::msg(format!("Cannot listen on local port: {e}")))?;
    let actual = listener.local_addr()?.port();
    let id = new_id();
    let info = PortForwardInfo {
        id: id.clone(),
        conn_id: conn_id.clone(),
        namespace: namespace.clone(),
        kind: if is_service { "service".into() } else { "pod".into() },
        name: pod_or_service.clone(),
        pod: pod.clone(),
        remote_port,
        target_port,
        local_port: actual,
        connections: 0,
        error: None,
    };
    let client = c.client.clone();
    let fid = id.clone();
    let task = tokio::spawn(async move {
        let pods: Api<Pod> = Api::namespaced(client.clone(), &namespace);
        let mut current = (pod, target_port);
        // Aborting the accept loop drops the JoinSet, which aborts every open connection.
        let mut conns = tokio::task::JoinSet::new();
        loop {
            let Ok((mut socket, _)) = listener.accept().await else { continue };
            while conns.try_join_next().is_some() {}
            let mut pf = pods.portforward(&current.0, &[current.1]).await;
            if pf.is_err() && is_service {
                // The backing pod may have been replaced; pick a new one.
                if let Ok(next) = resolve_service(&client, &namespace, &pod_or_service, remote_port).await {
                    current = next;
                    let (p, t) = current.clone();
                    update_forward(&fid, |i| {
                        i.pod = p;
                        i.target_port = t;
                    });
                    pf = pods.portforward(&current.0, &[current.1]).await;
                }
            }
            let mut pf = match pf {
                Ok(pf) => pf,
                Err(e) => {
                    let msg = e.to_string();
                    update_forward(&fid, |i| i.error = Some(msg));
                    continue;
                }
            };
            update_forward(&fid, |i| {
                i.connections += 1;
                i.error = None;
            });
            let port = current.1;
            let fid2 = fid.clone();
            conns.spawn(async move {
                let Some(mut upstream) = pf.take_stream(port) else { return };
                if let Err(e) = tokio::io::copy_bidirectional(&mut socket, &mut upstream).await {
                    let msg = e.to_string();
                    if !msg.contains("reset") && !msg.contains("broken pipe") {
                        update_forward(&fid2, |i| i.error = Some(msg));
                    }
                }
                drop(upstream);
                let _ = pf.join().await;
            });
        }
    });
    FORWARDS.lock().insert(id, Forward { info: info.clone(), abort: task.abort_handle() });
    Ok(info)
}

#[cfg_attr(feature = "gui", tauri::command)]
pub async fn k8s_port_forward_list(conn_id: Option<String>) -> AppResult<Vec<PortForwardInfo>> {
    let mut v: Vec<PortForwardInfo> = FORWARDS
        .lock()
        .values()
        .filter(|f| conn_id.as_ref().is_none_or(|c| &f.info.conn_id == c))
        .map(|f| f.info.clone())
        .collect();
    v.sort_by_key(|i| i.local_port);
    Ok(v)
}

#[cfg_attr(feature = "gui", tauri::command)]
pub async fn k8s_port_forward_stop(id: String) -> AppResult<()> {
    if let Some(f) = FORWARDS.lock().remove(&id) {
        f.abort.abort();
    }
    Ok(())
}
