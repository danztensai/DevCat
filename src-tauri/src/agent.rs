//! DevCat Agent in the app: runs `crates/harness` sessions for the AI workspace's chat tabs.
//! Everything a turn does is sent to the window as `agent-event` ({ sessionId, event }); tool calls
//! that need approval wait for `agent_approve` (closing the tab or stopping counts as a no).
use crate::error::{AppError, AppResult};
use async_trait::async_trait;
use devcat_harness::approval::{ApprovalRequest, Decision};
use devcat_harness::prompt::{Environment, system_prompt};
use devcat_harness::tools::Registry;
use devcat_harness::{Agent, AgentEvent, Approver, Cancel, Llm, Policy, Session, SessionEvent, Usage};
use once_cell::sync::{Lazy, OnceCell};
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::oneshot;

static DIR: OnceCell<PathBuf> = OnceCell::new();
static RUNS: Lazy<Mutex<HashMap<String, Arc<Run>>>> = Lazy::new(Default::default);

/// Sessions are kept in `<data>/agent-sessions/<id>.jsonl`.
pub fn init(data_dir: PathBuf) {
    let _ = DIR.set(data_dir.join("agent-sessions"));
}

fn dir() -> AppResult<&'static PathBuf> {
    DIR.get().ok_or_else(|| AppError::msg("DevCat Agent is not initialised"))
}

struct Run {
    id: String,
    turn: tokio::sync::Mutex<(Agent, Session)>,
    cancel: Mutex<Cancel>,
    approver: Arc<UiApprover>,
    busy: AtomicBool,
}

fn emit(session_id: &str, event: Value) {
    crate::events::emit("agent-event", json!({ "sessionId": session_id, "event": event }));
}

/// Asks the window: sends the request as an event and waits for `agent_approve`.
struct UiApprover {
    session_id: String,
    pending: Mutex<HashMap<String, oneshot::Sender<Decision>>>,
}

#[async_trait]
impl Approver for UiApprover {
    async fn decide(&self, req: &ApprovalRequest) -> (Decision, String) {
        let (tx, rx) = oneshot::channel();
        self.pending.lock().insert(req.tool_use_id.clone(), tx);
        emit(&self.session_id, json!({ "type": "approval", "request": req }));
        match rx.await {
            Ok(d) => (d, "user".into()),
            // the tab was closed or the turn stopped: fail closed
            Err(_) => (Decision::Deny { reason: Some("Nobody answered.".into()) }, "closed".into()),
        }
    }
}

impl UiApprover {
    fn deny_all(&self) {
        self.pending.lock().clear();
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOpened {
    pub session_id: String,
    pub title: String,
    pub model: String,
    pub provider_name: String,
    pub busy: bool,
    /// The session so far (the chat view rebuilds itself from it).
    pub events: Vec<SessionEvent>,
    pub usage: Usage,
}

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

async fn build(cwd: &str, provider_id: &str, session: Session) -> AppResult<Arc<Run>> {
    let (_, cfg) = crate::ai::agent_config(provider_id)?;
    let id = session.id.clone();
    let approver = Arc::new(UiApprover { session_id: id.clone(), pending: Mutex::default() });
    let shell = if cfg!(windows) { "PowerShell" } else { "bash" };
    let system = system_prompt(&Environment { cwd: std::path::Path::new(cwd), os: std::env::consts::OS, shell, date: &today() });
    let agent = Agent::new(Arc::new(Llm::new(cfg)), Registry::standard(), Policy::Ask, approver.clone(), system);
    Ok(Arc::new(Run { id, turn: tokio::sync::Mutex::new((agent, session)), cancel: Mutex::new(Cancel::default()), approver, busy: AtomicBool::new(false) }))
}

/// Open a chat: a new session, or `session_id` to continue one (still running or from disk).
#[cfg_attr(feature = "gui", tauri::command)]
pub async fn agent_open(cwd: String, provider_id: String, session_id: Option<String>) -> AppResult<AgentOpened> {
    let (provider, cfg) = crate::ai::agent_config(&provider_id)?;
    let existing = session_id.as_ref().and_then(|id| RUNS.lock().get(id).cloned());
    let run = match (existing, session_id) {
        (Some(r), _) => r,
        (None, Some(id)) if valid_id(&id) && dir()?.join(format!("{id}.jsonl")).exists() => {
            let session = Session::open(&dir()?.join(format!("{id}.jsonl"))).await.map_err(|e| AppError::msg(e.to_string()))?;
            build(&cwd, &provider_id, session).await?
        }
        _ => build(&cwd, &provider_id, Session::create(dir()?, &cwd).await.map_err(|e| AppError::msg(e.to_string()))?).await?,
    };
    RUNS.lock().insert(run.id.clone(), run.clone());
    let busy = run.busy.load(Ordering::SeqCst);
    // a running turn holds the lock: send what we can without waiting for it
    let (events, title, usage) = match run.turn.try_lock() {
        Ok(g) => (g.1.events().to_vec(), g.1.title(), g.1.usage()),
        Err(_) => (vec![], String::new(), Usage::default()),
    };
    Ok(AgentOpened { session_id: run.id.clone(), title, model: cfg.model, provider_name: provider.name, busy, events, usage })
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn run_of(session_id: &str) -> AppResult<Arc<Run>> {
    RUNS.lock().get(session_id).cloned().ok_or_else(|| AppError::msg("This chat is closed. Open it again."))
}

/// Send a message; the turn runs in the background and reports through `agent-event`.
#[cfg_attr(feature = "gui", tauri::command)]
pub async fn agent_send(session_id: String, text: String, policy: Policy) -> AppResult<()> {
    let run = run_of(&session_id)?;
    if text.trim().is_empty() {
        return Err(AppError::msg("Type a message first"));
    }
    if run.busy.swap(true, Ordering::SeqCst) {
        return Err(AppError::msg("The agent is still working. Stop it or wait for it to finish."));
    }
    let cancel = Cancel::default();
    *run.cancel.lock() = cancel.clone();
    tokio::spawn(async move {
        let started = std::time::Instant::now();
        emit(&run.id, json!({ "type": "turnStart", "text": text }));
        let mut g = run.turn.lock().await;
        let (agent, session) = &mut *g;
        agent.policy = policy;
        let id = run.id.clone();
        let res = agent.turn(session, &text, &cancel, &mut |e: AgentEvent| emit(&id, serde_json::to_value(&e).unwrap_or(Value::Null))).await;
        let (end, error) = match res {
            Ok(end) => (serde_json::to_value(end).unwrap_or(Value::Null), None),
            Err(devcat_harness::Error::Cancelled) => (json!("stopped"), None),
            Err(e) => (json!("error"), Some(e.to_string())),
        };
        let usage = session.usage();
        let title = session.title();
        drop(g);
        run.busy.store(false, Ordering::SeqCst);
        emit(&run.id, json!({ "type": "turnEnd", "end": end, "error": error, "usage": usage, "title": title, "elapsedMs": started.elapsed().as_millis() as u64 }));
    });
    Ok(())
}

/// Stop the running turn (pending approvals count as a no).
#[cfg_attr(feature = "gui", tauri::command)]
pub async fn agent_stop(session_id: String) -> AppResult<()> {
    let run = run_of(&session_id)?;
    run.cancel.lock().cancel();
    run.approver.deny_all();
    Ok(())
}

/// Answer an approval request.
#[cfg_attr(feature = "gui", tauri::command)]
pub async fn agent_approve(session_id: String, tool_use_id: String, decision: Decision) -> AppResult<()> {
    let run = run_of(&session_id)?;
    let tx = run.approver.pending.lock().remove(&tool_use_id).ok_or_else(|| AppError::msg("That request was already answered"))?;
    let _ = tx.send(decision);
    Ok(())
}

/// Forget a chat (its tab closed); a running turn is stopped.
#[cfg_attr(feature = "gui", tauri::command)]
pub async fn agent_close(session_id: String) -> AppResult<()> {
    if let Some(run) = RUNS.lock().remove(&session_id) {
        run.cancel.lock().cancel();
        run.approver.deny_all();
    }
    Ok(())
}

/// Stop every running turn (app exit).
pub fn shutdown_all() {
    for run in RUNS.lock().drain().map(|(_, r)| r) {
        run.cancel.lock().cancel();
        run.approver.deny_all();
    }
}
