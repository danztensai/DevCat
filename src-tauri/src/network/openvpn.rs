//! OpenVPN: launched elevated as a daemon, then driven over its management interface
//! (127.0.0.1, password protected): credentials, state changes and the log stream.
use super::registry::{self, Run};
use super::store::{NetStore, write_private};
use super::helper::{self, Outcome};
use super::{NetKind, NetProfile, elevate, tools};
use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

// ---------------------------------------------------------------- management protocol

#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    /// Command to write to the management socket (may contain secrets: never log it).
    Send(String),
    Log(String),
    Connecting(String),
    Connected(String),
    Error(String),
    /// Cumulative bytes (in, out) from `>BYTECOUNT`.
    Bytes(u64, u64),
}

const STATES: &[&str] = &[
    "CONNECTING", "WAIT", "AUTH", "GET_CONFIG", "ASSIGN_IP", "ADD_ROUTES", "CONNECTED", "RECONNECTING", "EXITING",
    "RESOLVE", "TCP_CONNECT", "AUTH_PENDING",
];

/// Quote a value for the management protocol: `"…"` with `\` and `"` escaped.
/// Line breaks would end the command, so they are dropped.
pub fn mgmt_quote(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\r' | '\n' => {}
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Reacts to management-interface lines.
pub struct Machine {
    user: Option<String>,
    pass: Option<String>,
    /// A terminal error was reported; suppress "connecting" updates until connected again.
    failed: bool,
    fatal: Option<String>,
}

impl Machine {
    pub fn new(user: Option<String>, pass: Option<String>) -> Self {
        Self { user: user.filter(|u| !u.is_empty()), pass: pass.filter(|p| !p.is_empty()), failed: false, fatal: None }
    }

    fn fail(&mut self, msg: String, stop: bool) -> Vec<Action> {
        self.failed = true;
        let mut a = vec![Action::Error(msg)];
        if stop {
            a.push(Action::Send("signal SIGTERM".into()));
        }
        a
    }

    /// Error message for an unexpected exit of the process.
    pub fn exit_message(&self) -> String {
        match &self.fatal {
            Some(f) => format!("OpenVPN exited: {f}"),
            None => "OpenVPN exited unexpectedly (see the log)".into(),
        }
    }

    pub fn has_failed(&self) -> bool {
        self.failed
    }

    pub fn on_line(&mut self, line: &str) -> Vec<Action> {
        let mut line = line.trim_end_matches(['\r', '\n']);
        while let Some(rest) = line.strip_prefix("ENTER PASSWORD:") {
            line = rest;
        }
        if line.is_empty() {
            return vec![];
        }
        if let Some(rest) = line.strip_prefix(">LOG:") {
            let mut f = rest.splitn(3, ',');
            let (_ts, flags, msg) = (f.next(), f.next().unwrap_or(""), f.next().unwrap_or(rest));
            if flags.contains('F') {
                self.fatal = Some(msg.to_string());
            }
            return vec![Action::Log(msg.to_string())];
        }
        if let Some(rest) = line.strip_prefix(">STATE:") {
            let fields: Vec<&str> = rest.split(',').collect();
            return self.on_state(&fields);
        }
        if line.starts_with(">HOLD:") {
            return vec![Action::Send("hold release".into())];
        }
        if let Some(rest) = line.strip_prefix(">PASSWORD:") {
            return self.on_password(rest);
        }
        if let Some(rest) = line.strip_prefix(">FATAL:") {
            self.fatal = Some(rest.to_string());
            return self.fail(rest.to_string(), false);
        }
        if let Some(rest) = line.strip_prefix(">INFO:") {
            return vec![Action::Log(rest.to_string())];
        }
        if let Some(rest) = line.strip_prefix(">BYTECOUNT:") {
            let mut f = rest.split(',').map(|x| x.trim().parse::<u64>());
            if let (Some(Ok(rx)), Some(Ok(tx))) = (f.next(), f.next()) {
                return vec![Action::Bytes(rx, tx)];
            }
            return vec![];
        }
        if line.starts_with(">PKCS11ID") {
            return vec![];
        }
        if let Some(rest) = line.strip_prefix('>') {
            return vec![Action::Log(rest.to_string())];
        }
        if line.starts_with("SUCCESS:") || line == "END" {
            return vec![];
        }
        if let Some(rest) = line.strip_prefix("ERROR:") {
            return vec![Action::Log(format!("management: {}", rest.trim()))];
        }
        // History dumped by `log on all` / `state on all`: plain CSV lines.
        let fields: Vec<&str> = line.split(',').collect();
        if fields.len() >= 2 && fields[0].chars().all(|c| c.is_ascii_digit()) {
            if STATES.contains(&fields[1]) {
                return self.on_state(&fields);
            }
            if fields.len() >= 3 {
                return vec![Action::Log(fields[2..].join(","))];
            }
        }
        vec![Action::Log(line.to_string())]
    }

    /// `time,STATE,desc,local_ip,remote_ip,remote_port,…`
    fn on_state(&mut self, f: &[&str]) -> Vec<Action> {
        let name = f.get(1).copied().unwrap_or("");
        let desc = f.get(2).copied().unwrap_or("");
        match name {
            "CONNECTED" => {
                self.failed = false;
                let local = f.get(3).copied().unwrap_or("");
                let remote = match (f.get(4).copied().unwrap_or(""), f.get(5).copied().unwrap_or("")) {
                    ("", _) => String::new(),
                    (h, "") => h.to_string(),
                    (h, p) => format!("{h}:{p}"),
                };
                let mut detail = match (local.is_empty(), remote.is_empty()) {
                    (false, false) => format!("{local} ({remote})"),
                    (false, true) => local.to_string(),
                    (true, false) => remote,
                    (true, true) => "connected".into(),
                };
                if desc == "ERROR" {
                    detail.push_str(" — with errors, see the log");
                }
                vec![Action::Connected(detail)]
            }
            "EXITING" => {
                if self.failed {
                    vec![]
                } else if desc == "auth-failure" {
                    self.fail("Authentication failed (check the username/password)".into(), false)
                } else {
                    let msg = self.fatal.clone().unwrap_or_else(|| format!("OpenVPN exited ({desc})"));
                    self.fail(msg, false)
                }
            }
            _ if self.failed => vec![],
            "RECONNECTING" => vec![Action::Connecting(format!("reconnecting ({desc})"))],
            other => vec![Action::Connecting(other.to_ascii_lowercase().replace('_', " "))],
        }
    }

    fn on_password(&mut self, rest: &str) -> Vec<Action> {
        if let Some(r) = rest.strip_prefix("Verification Failed") {
            if r.contains("CRV1") {
                return self.fail("The server requires a challenge/response (2FA), which DevCat does not support yet".into(), true);
            }
            let what = r.split('\'').nth(1).unwrap_or("Auth");
            let msg = if what == "Auth" {
                "Authentication failed (check the username/password)".to_string()
            } else {
                format!("Password verification failed: {what}")
            };
            return self.fail(msg, true);
        }
        let Some(r) = rest.strip_prefix("Need '") else { return vec![] };
        let Some((kind, tail)) = r.split_once('\'') else { return vec![] };
        if tail.contains("SC:") {
            return self.fail("The server requires a one-time code (static challenge), which DevCat does not support yet".into(), true);
        }
        if tail.contains("username/password") {
            return match (&self.user, &self.pass) {
                (Some(u), Some(p)) => vec![
                    Action::Log(format!("Sending credentials for '{kind}' (user {u})")),
                    Action::Send(format!("username {} {}", mgmt_quote(kind), mgmt_quote(u))),
                    Action::Send(format!("password {} {}", mgmt_quote(kind), mgmt_quote(p))),
                ],
                _ => self.fail("The server requires a username and password: set them in the profile".into(), true),
            };
        }
        if tail.contains("password") {
            return match &self.pass {
                Some(p) => vec![
                    Action::Log(format!("Sending password for '{kind}'")),
                    Action::Send(format!("password {} {}", mgmt_quote(kind), mgmt_quote(p))),
                ],
                None => self.fail(format!("OpenVPN needs a password for '{kind}': set it in the profile"), true),
            };
        }
        vec![]
    }
}

// ---------------------------------------------------------------- process control

pub struct Paths {
    pub config: PathBuf,
    pub mgmt_pw: PathBuf,
    pub pid: PathBuf,
    pub log: PathBuf,
}

/// Command line for the elevated openvpn process.
pub fn build_args(p: &Paths, mgmt_port: u16, extra: &str, windows: bool) -> Vec<String> {
    let mut a: Vec<String> = vec![
        "--config".into(),
        p.config.to_string_lossy().into(),
        "--management".into(),
        "127.0.0.1".into(),
        mgmt_port.to_string(),
        p.mgmt_pw.to_string_lossy().into(),
        "--management-query-passwords".into(),
        "--management-hold".into(),
        "--writepid".into(),
        p.pid.to_string_lossy().into(),
        "--log".into(),
        p.log.to_string_lossy().into(),
    ];
    if !windows {
        a.push("--daemon".into());
    }
    a.extend(extra.split_whitespace().map(str::to_string));
    a
}

/// Running OpenVPN daemon. Dropping it asks the daemon to exit (best effort).
pub struct OvpnRun {
    tx: mpsc::UnboundedSender<String>,
    reader: JoinHandle<()>,
    pid_file: PathBuf,
    /// Started through the passwordless helper (stop / clean up through it too).
    via_helper: bool,
}

impl Drop for OvpnRun {
    fn drop(&mut self) {
        let _ = self.tx.send("signal SIGTERM".into());
    }
}

impl OvpnRun {
    /// SIGTERM over management; falls back to an elevated kill if that doesn't work.
    pub async fn stop(mut self, id: &str) -> AppResult<()> {
        if self.reader.is_finished() {
            return Ok(());
        }
        registry::log(id, "Disconnecting");
        let sent = self.tx.send("signal SIGTERM".into()).is_ok();
        if sent && tokio::time::timeout(Duration::from_secs(8), &mut self.reader).await.is_ok() {
            if self.via_helper {
                // Removes the helper's root-only copies of the config (no prompt).
                let args = vec!["openvpn-stop".to_string(), "--profile-id".into(), id.to_string()];
                tokio::spawn(async move { helper::run(&args).await });
            }
            return Ok(());
        }
        if self.via_helper {
            registry::log(id, "Management interface not responding; stopping the process through the passwordless helper");
            match helper::run(&["openvpn-stop".into(), "--profile-id".into(), id.to_string()]).await {
                Outcome::Done(msg) => {
                    registry::log(id, msg.trim());
                    self.reader.abort();
                    return Ok(());
                }
                Outcome::Rejected(m) | Outcome::Failed(m) => {
                    self.reader.abort();
                    return Err(AppError::msg(format!("Cannot stop OpenVPN: {m}")));
                }
                Outcome::Unavailable(why) => registry::log(id, &format!("Passwordless helper unavailable ({why})")),
            }
        }
        registry::log(id, "Management interface not responding; stopping the process with administrator rights");
        let pid = std::fs::read_to_string(&self.pid_file).ok().and_then(|s| s.trim().parse::<u32>().ok());
        let Some(pid) = pid else {
            return Err(AppError::msg("OpenVPN is not responding and its process id is unknown"));
        };
        let out = if cfg!(windows) {
            elevate::run("taskkill.exe", &["/PID".into(), pid.to_string(), "/F".into()], true, None).await?
        } else {
            elevate::run("/bin/kill", &[pid.to_string()], true, None).await?
        };
        self.reader.abort();
        if out.success { Ok(()) } else { Err(AppError::msg(format!("Cannot stop OpenVPN: {}", out.message()))) }
    }
}

fn free_port() -> AppResult<u16> {
    Ok(std::net::TcpListener::bind("127.0.0.1:0")?.local_addr()?.port())
}

fn log_tail(path: &Path, n: usize) -> String {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}

/// `ovpnArgs` the helper can pass on: nothing or `--verb N`. `Err` = anything else.
pub fn helper_verb(extra: &str) -> Result<Option<u8>, ()> {
    match extra.split_whitespace().collect::<Vec<_>>().as_slice() {
        [] => Ok(None),
        ["--verb", n] => n.parse::<u8>().ok().filter(|n| *n <= 11).map(Some).ok_or(()),
        _ => Err(()),
    }
}

/// `Some(verb)` when this connect goes through the passwordless helper.
async fn use_helper(id: &str, prompt: bool, extra: &str) -> Option<Option<u8>> {
    if prompt || cfg!(windows) || !helper::ready().await {
        return None;
    }
    if let Err(e) = helper::find_openvpn(0) {
        registry::log(id, &format!("Passwordless VPN can't run OpenVPN here ({e}); asking for the administrator password instead"));
        return None;
    }
    match helper_verb(extra) {
        Ok(v) => Some(v),
        Err(()) => {
            registry::log(id, "Extra OpenVPN arguments aren't passed through the passwordless helper; asking for the administrator password instead");
            None
        }
    }
}

/// Start the daemon through the helper. `None` = the helper isn't usable (fall back).
async fn launch_with_helper(id: &str, paths: &Paths, port: u16, verb: Option<u8>) -> Option<AppResult<()>> {
    registry::log(id, "Starting OpenVPN through the passwordless helper");
    let mut args: Vec<String> = vec![
        "openvpn-start".into(),
        "--config".into(),
        paths.config.to_string_lossy().into(),
        "--mgmt-port".into(),
        port.to_string(),
        "--mgmt-pass-file".into(),
        paths.mgmt_pw.to_string_lossy().into(),
        "--profile-id".into(),
        id.into(),
    ];
    if let Some(v) = verb {
        args.extend(["--verb".into(), v.to_string()]);
    }
    match helper::run(&args).await {
        Outcome::Done(_) => Some(Ok(())),
        Outcome::Rejected(m) => Some(Err(AppError::msg(helper::rejection(&m)))),
        Outcome::Failed(m) => {
            let tail = log_tail(&paths.log, 5);
            Some(Err(AppError::msg(format!("OpenVPN failed to start: {}", if tail.is_empty() { m } else { tail }))))
        }
        Outcome::Unavailable(why) => {
            registry::log(id, &format!("Passwordless helper unavailable ({why}); asking for the administrator password instead"));
            None
        }
    }
}

pub async fn connect(id: String, generation: u64, profile: NetProfile, store: &NetStore, prompt: bool) -> AppResult<()> {
    let dir = store.dir()?;
    let mut paths = Paths {
        config: store.config_path(&id, NetKind::Openvpn)?,
        mgmt_pw: dir.join(format!("{id}.mgmt")),
        pid: dir.join(format!("{id}.pid")),
        log: dir.join(format!("{id}.log")),
    };
    if !paths.config.exists() {
        return Err(AppError::msg("The OpenVPN configuration file is missing; edit the profile and paste it again"));
    }
    let port = free_port()?;
    let token = uuid::Uuid::new_v4().simple().to_string();
    write_private(&paths.mgmt_pw, format!("{token}\n").as_bytes())?;
    let extra = profile.options.get("ovpnArgs").cloned().unwrap_or_default();

    let mut via_helper = false;
    let mut launched = None;
    if let Some(verb) = use_helper(&id, prompt, &extra).await {
        let (pid, log) = helper::run_files(&id);
        let helper_paths = Paths { pid, log, ..paths };
        registry::set_connecting(&id, generation, Some("starting".into()));
        launched = launch_with_helper(&id, &helper_paths, port, verb).await;
        via_helper = launched.is_some();
        // Back to the app's own pid / log files if the helper wasn't usable.
        paths = if via_helper { helper_paths } else { Paths { pid: dir.join(format!("{id}.pid")), log: dir.join(format!("{id}.log")), ..helper_paths } };
    }
    let launched = match launched {
        Some(r) => r,
        None => launch_with_prompt(&id, generation, &paths, port, &extra).await,
    };
    if let Err(e) = launched {
        let _ = std::fs::remove_file(&paths.mgmt_pw);
        return Err(e);
    }

    let mut stream = None;
    for _ in 0..40 {
        if let Ok(s) = TcpStream::connect(("127.0.0.1", port)).await {
            stream = Some(s);
            break;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    let _ = std::fs::remove_file(&paths.mgmt_pw);
    let Some(stream) = stream else {
        let tail = log_tail(&paths.log, 8);
        return Err(AppError::msg(format!(
            "OpenVPN did not start{}",
            if tail.is_empty() { String::new() } else { format!(":\n{tail}") }
        )));
    };
    let (tx, rx) = mpsc::unbounded_channel();
    for cmd in [token.as_str(), "log on all", "state on all", "bytecount 1", "hold release"] {
        let _ = tx.send(cmd.to_string());
    }
    let machine = Machine::new(profile.vpn_user.clone(), profile.vpn_password.clone());
    let reader = tokio::spawn(mgmt_task(id.clone(), generation, stream, rx, machine));
    let run = OvpnRun { tx, reader, pid_file: paths.pid.clone(), via_helper };
    match registry::store_run(&id, generation, Run::Openvpn(run)) {
        Ok(()) => {
            registry::set_connecting(&id, generation, Some("connecting".into()));
        }
        Err(Run::Openvpn(stale)) => {
            // Disconnected while we were starting: stop the daemon again.
            let _ = stale.stop(&id).await;
        }
        Err(_) => {}
    }
    Ok(())
}

/// Start the daemon elevated with the OS password prompt.
async fn launch_with_prompt(id: &str, generation: u64, paths: &Paths, port: u16, extra: &str) -> AppResult<()> {
    let bin = tools::find_openvpn()
        .ok_or_else(|| AppError::msg(format!("OpenVPN is not installed. {}", tools::openvpn_hint())))?;
    // Created by us so the log stays readable after root writes to it.
    write_private(&paths.log, b"")?;
    let _ = std::fs::remove_file(&paths.pid);
    let args = build_args(paths, port, extra, cfg!(windows));
    registry::log(id, &format!("Starting {} (administrator rights required)", bin.display()));
    registry::set_connecting(id, generation, Some("waiting for authorization".into()));
    match elevate::run(&bin.to_string_lossy(), &args, !cfg!(windows), None).await {
        Ok(o) if o.success => Ok(()),
        Ok(o) => {
            let tail = log_tail(&paths.log, 5);
            Err(AppError::msg(format!("OpenVPN failed to start: {}", if tail.is_empty() { o.message() } else { tail })))
        }
        Err(e) => Err(e),
    }
}

async fn mgmt_task(id: String, generation: u64, stream: TcpStream, mut rx: mpsc::UnboundedReceiver<String>, mut m: Machine) {
    let (r, mut w) = stream.into_split();
    let mut lines = BufReader::new(r).lines();
    let mut rx_open = true;
    loop {
        tokio::select! {
            line = lines.next_line() => {
                let Ok(Some(line)) = line else { break };
                for a in m.on_line(&line) {
                    match a {
                        Action::Send(cmd) => {
                            if w.write_all(format!("{cmd}\n").as_bytes()).await.is_err() {
                                break;
                            }
                        }
                        Action::Log(l) => registry::log(&id, &l),
                        Action::Connecting(d) => {
                            registry::set_connecting(&id, generation, Some(d));
                        }
                        Action::Connected(d) => {
                            registry::log(&id, &format!("Connected: {d}"));
                            registry::set_connected(&id, generation, Some(d), vec![]);
                        }
                        Action::Error(e) => {
                            registry::set_error(&id, generation, e);
                        }
                        Action::Bytes(rx, tx) => super::traffic::set_totals(&id, rx, tx),
                    }
                }
            }
            cmd = rx.recv(), if rx_open => match cmd {
                Some(cmd) => {
                    if w.write_all(format!("{cmd}\n").as_bytes()).await.is_err() {
                        break;
                    }
                }
                None => rx_open = false,
            }
        }
    }
    registry::log(&id, "OpenVPN management connection closed");
    if registry::generation(&id) == Some(generation) && !m.has_failed() && registry::status(&id).state != registry::ERROR {
        registry::set_error(&id, generation, m.exit_message());
    }
    drop(registry::take_run_if(&id, generation));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(m: &mut Machine, lines: &[&str]) -> Vec<Action> {
        lines.iter().flat_map(|l| m.on_line(l)).collect()
    }

    #[test]
    fn quoting() {
        assert_eq!(mgmt_quote("Auth"), "\"Auth\"");
        assert_eq!(mgmt_quote(r#"p"a\ss"#), r#""p\"a\\ss""#);
        assert_eq!(mgmt_quote("a\nb\r"), "\"ab\"");
    }

    #[test]
    fn happy_path() {
        let mut m = Machine::new(Some("alice".into()), Some("pa\"ss".into()));
        let a = run(
            &mut m,
            &[
                "ENTER PASSWORD:SUCCESS: password is correct",
                ">INFO:OpenVPN Management Interface Version 5 -- type 'help' for more info",
                "1700000000,,OpenVPN 2.6.12 starting",
                "END",
                "SUCCESS: real-time state notification set to ON",
                ">HOLD:Waiting for hold release:0",
                ">PASSWORD:Need 'Auth' username/password",
                ">STATE:1700000001,RESOLVE,,,,,,",
                ">STATE:1700000002,WAIT,,,,,,",
                ">STATE:1700000003,AUTH,,,,,,",
                ">LOG:1700000004,W,WARNING: something odd",
                ">STATE:1700000005,CONNECTED,SUCCESS,10.8.0.6,203.0.113.5,1194,,",
            ],
        );
        assert_eq!(
            a,
            vec![
                Action::Log("OpenVPN Management Interface Version 5 -- type 'help' for more info".into()),
                Action::Log("OpenVPN 2.6.12 starting".into()),
                Action::Send("hold release".into()),
                Action::Log("Sending credentials for 'Auth' (user alice)".into()),
                Action::Send("username \"Auth\" \"alice\"".into()),
                Action::Send("password \"Auth\" \"pa\\\"ss\"".into()),
                Action::Connecting("resolve".into()),
                Action::Connecting("wait".into()),
                Action::Connecting("auth".into()),
                Action::Log("WARNING: something odd".into()),
                Action::Connected("10.8.0.6 (203.0.113.5:1194)".into()),
            ]
        );
        // Credentials never end up in log actions.
        assert!(!a.iter().any(|x| matches!(x, Action::Log(l) if l.contains("pa\"ss"))));
    }

    #[test]
    fn state_history_and_reconnect() {
        let mut m = Machine::new(None, None);
        assert_eq!(m.on_line("1700000000,CONNECTED,ERROR,10.8.0.6,1.2.3.4,443,,"), vec![Action::Connected("10.8.0.6 (1.2.3.4:443) — with errors, see the log".into())]);
        assert_eq!(m.on_line(">STATE:1,RECONNECTING,ping-restart,,,,,"), vec![Action::Connecting("reconnecting (ping-restart)".into())]);
        assert_eq!(m.on_line(">STATE:1,GET_CONFIG,,,,,,"), vec![Action::Connecting("get config".into())]);
        assert_eq!(m.on_line(">BYTECOUNT:1,2"), vec![Action::Bytes(1, 2)]);
        assert_eq!(m.on_line(">BYTECOUNT:x"), vec![]);
    }

    #[test]
    fn auth_failure() {
        let mut m = Machine::new(Some("bob".into()), Some("wrong".into()));
        let a = run(
            &mut m,
            &[
                ">PASSWORD:Need 'Auth' username/password",
                ">PASSWORD:Verification Failed: 'Auth'",
                ">STATE:1,RECONNECTING,auth-failure,,,,,",
                ">STATE:1,EXITING,auth-failure,,,,,",
            ],
        );
        let errors: Vec<_> = a.iter().filter(|x| matches!(x, Action::Error(_))).collect();
        assert_eq!(errors, vec![&Action::Error("Authentication failed (check the username/password)".into())]);
        assert!(a.contains(&Action::Send("signal SIGTERM".into())));
        assert!(!a.iter().any(|x| matches!(x, Action::Connecting(_))), "{a:?}");
        assert!(m.has_failed());
    }

    #[test]
    fn missing_credentials_and_key_password() {
        let mut m = Machine::new(Some("bob".into()), None);
        let a = m.on_line(">PASSWORD:Need 'Auth' username/password");
        assert!(matches!(&a[0], Action::Error(e) if e.contains("username and password")));
        assert_eq!(a[1], Action::Send("signal SIGTERM".into()));

        let mut m = Machine::new(None, Some("keypass".into()));
        assert_eq!(
            m.on_line(">PASSWORD:Need 'Private Key' password"),
            vec![Action::Log("Sending password for 'Private Key'".into()), Action::Send("password \"Private Key\" \"keypass\"".into())]
        );

        let mut m = Machine::new(Some("u".into()), Some("p".into()));
        let a = m.on_line(">PASSWORD:Need 'Auth' username/password SC:1,Enter your token");
        assert!(matches!(&a[0], Action::Error(e) if e.contains("static challenge")));
        let a = Machine::new(None, None).on_line(">PASSWORD:Verification Failed: 'Auth' ['CRV1:R,E:Om01u7Fh4LrGBS7uh0SWmzwabUiGiW6l:Y3Ix:Please enter token PIN']");
        assert!(matches!(&a[0], Action::Error(e) if e.contains("challenge")));
        assert_eq!(Machine::new(None, None).on_line(">PASSWORD:Auth-Token:abc"), vec![]);
    }

    #[test]
    fn fatal_and_exit() {
        let mut m = Machine::new(None, None);
        assert_eq!(m.on_line(">LOG:1,F,Cannot open TUN/TAP dev"), vec![Action::Log("Cannot open TUN/TAP dev".into())]);
        let a = m.on_line(">STATE:1,EXITING,exit-with-notification,,,,,");
        assert_eq!(a, vec![Action::Error("Cannot open TUN/TAP dev".into())]);
        assert_eq!(m.exit_message(), "OpenVPN exited: Cannot open TUN/TAP dev");

        let mut m = Machine::new(None, None);
        assert_eq!(m.on_line(">FATAL:Options error"), vec![Action::Error("Options error".into())]);
        assert_eq!(m.on_line(">STATE:1,EXITING,SIGTERM,,,,,"), vec![]);

        let mut m = Machine::new(None, None);
        assert_eq!(m.on_line(">STATE:1,EXITING,SIGTERM,,,,,"), vec![Action::Error("OpenVPN exited (SIGTERM)".into())]);
        assert_eq!(Machine::new(None, None).exit_message(), "OpenVPN exited unexpectedly (see the log)");
    }

    #[test]
    fn helper_extra_args() {
        assert_eq!(helper_verb(""), Ok(None));
        assert_eq!(helper_verb("  --verb 4 "), Ok(Some(4)));
        assert_eq!(helper_verb("--verb 12"), Err(()));
        assert_eq!(helper_verb("--verb x"), Err(()));
        assert_eq!(helper_verb("--route-nopull"), Err(()));
        assert_eq!(helper_verb("--verb 3 --up /x"), Err(()));
    }

    #[test]
    fn args() {
        let p = Paths {
            config: "/data dir/network/x.ovpn".into(),
            mgmt_pw: "/data dir/network/x.mgmt".into(),
            pid: "/data dir/network/x.pid".into(),
            log: "/data dir/network/x.log".into(),
        };
        let a = build_args(&p, 40000, " --verb 4 ", false);
        assert_eq!(
            a,
            vec![
                "--config", "/data dir/network/x.ovpn", "--management", "127.0.0.1", "40000", "/data dir/network/x.mgmt",
                "--management-query-passwords", "--management-hold", "--writepid", "/data dir/network/x.pid", "--log",
                "/data dir/network/x.log", "--daemon", "--verb", "4",
            ]
        );
        assert!(!build_args(&p, 1, "", true).contains(&"--daemon".to_string()));
        // The macOS elevation command line keeps the space-containing paths intact.
        let line = elevate::sh_command("/opt/homebrew/sbin/openvpn", &a);
        assert!(line.contains("--config '/data dir/network/x.ovpn'"), "{line}");
        let script = elevate::osascript_script(&line, "p");
        assert!(script.starts_with("do shell script \"/opt/homebrew/sbin/openvpn --config '/data dir/network/x.ovpn'"));
    }
}
