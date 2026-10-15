//! Live state of network profiles: status, log ring buffer, running handles, events.
//!
//! Every connect/disconnect gets a new generation number. Background tasks pass the
//! generation they were started with; updates from a stale generation are ignored, so a
//! task that finishes after the user already disconnected cannot resurrect the state.
use super::NetStatus;
use once_cell::sync::{Lazy, OnceCell};
use parking_lot::Mutex;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter};

pub const DISCONNECTED: &str = "disconnected";
pub const CONNECTING: &str = "connecting";
pub const CONNECTED: &str = "connected";
pub const DISCONNECTING: &str = "disconnecting";
pub const ERROR: &str = "error";

const MAX_LOG_LINES: usize = 2000;

/// A running connection; dropping/stopping it tears the connection down.
pub enum Run {
    Ssh(super::ssh_tunnel::SshRun),
    Openvpn(super::openvpn::OvpnRun),
    Wireguard(super::wireguard::WgRun),
}

struct Entry {
    status: NetStatus,
    logs: VecDeque<String>,
    generation: u64,
    run: Option<Run>,
}

impl Entry {
    fn new(id: &str) -> Self {
        Self { status: idle(id), logs: VecDeque::new(), generation: 0, run: None }
    }
}

static REG: Lazy<Mutex<HashMap<String, Entry>>> = Lazy::new(Default::default);
static PENDING_LOGS: Lazy<Mutex<HashMap<String, Vec<String>>>> = Lazy::new(Default::default);
static NEXT_GEN: AtomicU64 = AtomicU64::new(1);
pub static APP: OnceCell<AppHandle> = OnceCell::new();

pub fn idle(id: &str) -> NetStatus {
    NetStatus { id: id.into(), state: DISCONNECTED.into(), since: None, detail: None, error: None, local_ports: vec![] }
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn emit(status: &NetStatus) {
    if let Some(app) = APP.get() {
        let _ = app.emit("net-status", status);
    }
}

pub fn status(id: &str) -> NetStatus {
    REG.lock().get(id).map(|e| e.status.clone()).unwrap_or_else(|| idle(id))
}

fn set_state(e: &mut Entry, state: &str) {
    if e.status.state != state {
        e.status.state = state.into();
        e.status.since = Some(now());
    }
}

/// Start a connect attempt: returns its generation, or `None` if the profile is already
/// connecting/connected/disconnecting.
pub fn begin_connect(id: &str) -> Option<u64> {
    let st = {
        let mut reg = REG.lock();
        let e = reg.entry(id.to_string()).or_insert_with(|| Entry::new(id));
        if matches!(e.status.state.as_str(), CONNECTING | CONNECTED | DISCONNECTING) {
            return None;
        }
        e.generation = NEXT_GEN.fetch_add(1, Ordering::SeqCst);
        set_state(e, CONNECTING);
        e.status.detail = None;
        e.status.error = None;
        e.status.local_ports.clear();
        // A handle left over from a failed session (e.g. an exited daemon) is dropped.
        (e.status.clone(), e.generation, e.run.take())
    };
    drop(st.2);
    emit(&st.0);
    Some(st.1)
}

/// Start a disconnect: bumps the generation, sets `disconnecting` and hands back the
/// running handle (if any). Returns `None` when there is nothing to do.
pub fn begin_disconnect(id: &str) -> Option<(u64, Option<Run>)> {
    let (st, generation, run) = {
        let mut reg = REG.lock();
        let e = reg.get_mut(id)?;
        if e.run.is_none() && matches!(e.status.state.as_str(), DISCONNECTED | ERROR) {
            return None;
        }
        e.generation = NEXT_GEN.fetch_add(1, Ordering::SeqCst);
        set_state(e, DISCONNECTING);
        e.status.error = None;
        (e.status.clone(), e.generation, e.run.take())
    };
    emit(&st);
    Some((generation, run))
}

/// Apply `f` to the status if `generation` is still current; emits on change.
pub fn update(id: &str, generation: u64, f: impl FnOnce(&mut NetStatus)) -> bool {
    let st = {
        let mut reg = REG.lock();
        let Some(e) = reg.get_mut(id) else { return false };
        if e.generation != generation {
            return false;
        }
        let mut next = e.status.clone();
        f(&mut next);
        if next == e.status {
            return true;
        }
        if next.state != e.status.state {
            next.since = Some(now());
        }
        e.status = next;
        e.status.clone()
    };
    emit(&st);
    true
}

pub fn set_connected(id: &str, generation: u64, detail: Option<String>, ports: Vec<u16>) -> bool {
    update(id, generation, |s| {
        s.state = CONNECTED.into();
        s.detail = detail;
        s.error = None;
        s.local_ports = ports;
    })
}

pub fn set_connecting(id: &str, generation: u64, detail: Option<String>) -> bool {
    update(id, generation, |s| {
        s.state = CONNECTING.into();
        s.detail = detail;
    })
}

pub fn set_error(id: &str, generation: u64, msg: impl Into<String>) -> bool {
    let msg = msg.into();
    log(id, &format!("ERROR: {msg}"));
    update(id, generation, |s| {
        s.state = ERROR.into();
        s.error = Some(msg);
        s.local_ports.clear();
    })
}

pub fn set_disconnected(id: &str, generation: u64) -> bool {
    update(id, generation, |s| {
        s.state = DISCONNECTED.into();
        s.detail = None;
        s.error = None;
        s.local_ports.clear();
    })
}

/// Store the running handle if `generation` is current; otherwise give it back
/// (the caller must tear it down).
pub fn store_run(id: &str, generation: u64, run: Run) -> Result<(), Run> {
    let mut reg = REG.lock();
    match reg.get_mut(id) {
        Some(e) if e.generation == generation => {
            e.run = Some(run);
            Ok(())
        }
        _ => Err(run),
    }
}

/// Take the running handle if `generation` is still current.
pub fn take_run_if(id: &str, generation: u64) -> Option<Run> {
    let mut reg = REG.lock();
    let e = reg.get_mut(id)?;
    if e.generation == generation { e.run.take() } else { None }
}

pub fn generation(id: &str) -> Option<u64> {
    REG.lock().get(id).map(|e| e.generation)
}

/// Ids with an entry (anything that was ever connected in this run of the app).
pub fn ids() -> Vec<String> {
    REG.lock().keys().cloned().collect()
}

pub fn statuses() -> HashMap<String, NetStatus> {
    REG.lock().iter().map(|(k, e)| (k.clone(), e.status.clone())).collect()
}

pub fn remove(id: &str) {
    REG.lock().remove(id);
    PENDING_LOGS.lock().remove(id);
}

/// Append a log line (timestamped) to the ring buffer and the pending `net-log` batch.
pub fn log(id: &str, line: &str) {
    let line = format!("{} {}", chrono::Local::now().format("%H:%M:%S"), line.trim_end());
    {
        let mut reg = REG.lock();
        let e = reg.entry(id.to_string()).or_insert_with(|| Entry::new(id));
        if e.logs.len() >= MAX_LOG_LINES {
            e.logs.pop_front();
        }
        e.logs.push_back(line.clone());
    }
    if APP.get().is_some() {
        PENDING_LOGS.lock().entry(id.to_string()).or_default().push(line);
    }
}

pub fn logs(id: &str) -> Vec<String> {
    REG.lock().get(id).map(|e| e.logs.iter().cloned().collect()).unwrap_or_default()
}

/// Emit pending log lines as `net-log` events every ~100ms.
pub fn spawn_log_flusher() {
    tauri::async_runtime::spawn(async {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            let batch = std::mem::take(&mut *PENDING_LOGS.lock());
            if let Some(app) = APP.get() {
                for (id, lines) in batch {
                    let _ = app.emit("net-log", serde_json::json!({ "id": id, "lines": lines }));
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generations() {
        let id = "reg-test-1";
        let g = begin_connect(id).unwrap();
        assert!(begin_connect(id).is_none(), "already connecting");
        assert_eq!(status(id).state, CONNECTING);
        assert!(set_connected(id, g, Some("x".into()), vec![1]));
        assert_eq!(status(id).local_ports, vec![1]);
        let (g2, run) = begin_disconnect(id).unwrap();
        assert!(run.is_none());
        assert_eq!(status(id).state, DISCONNECTING);
        assert!(!set_error(id, g, "stale"), "stale generation ignored");
        assert!(set_disconnected(id, g2));
        assert_eq!(status(id), NetStatus { since: status(id).since, ..idle(id) });
        assert!(begin_disconnect(id).is_none());
        let g3 = begin_connect(id).unwrap();
        assert!(set_error(id, g3, "boom"));
        let s = status(id);
        assert_eq!((s.state.as_str(), s.error.as_deref()), (ERROR, Some("boom")));
        assert!(logs(id).last().unwrap().ends_with("ERROR: boom"));
        assert!(begin_connect(id).is_some(), "reconnect after error");
        remove(id);
    }

    #[test]
    fn log_ring() {
        let id = "reg-test-2";
        for i in 0..(MAX_LOG_LINES + 5) {
            log(id, &format!("line {i}"));
        }
        let l = logs(id);
        assert_eq!(l.len(), MAX_LOG_LINES);
        assert!(l[0].ends_with("line 5"));
        remove(id);
    }
}
