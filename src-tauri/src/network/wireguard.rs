//! WireGuard via `wg-quick up/down` (macOS/Linux) or `wireguard.exe /installtunnelservice`
//! (Windows), run with administrator rights. The interface name comes from the config file
//! name, so the stored config is copied to `<data>/network/wg/dc<8 hex>.conf` first.
use super::registry::{self, Run};
use super::store::{NetStore, write_private};
use super::helper::{self, Outcome};
use super::{NetKind, NetProfile, elevate, parse, tools};
use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

/// Interface / tunnel name for a profile id: `dc` + 8 alphanumerics (≤ 15 chars, wg-quick safe).
pub fn iface_name(id: &str) -> String {
    let tail: String = id.chars().filter(|c| c.is_ascii_alphanumeric()).take(8).collect::<String>().to_ascii_lowercase();
    format!("dc{tail}")
}

pub fn up_args(conf: &Path, windows: bool) -> Vec<String> {
    if windows {
        vec!["/installtunnelservice".into(), conf.to_string_lossy().into()]
    } else {
        vec!["up".into(), conf.to_string_lossy().into()]
    }
}

pub fn down_args(conf: &Path, iface: &str, windows: bool) -> Vec<String> {
    if windows {
        vec!["/uninstalltunnelservice".into(), iface.into()]
    } else {
        vec!["down".into(), conf.to_string_lossy().into()]
    }
}

/// PATH for wg-quick: its own dir (wg, wireguard-go) plus Homebrew (bash ≥ 4 on macOS).
fn helper_path(tool: &Path) -> Option<String> {
    if cfg!(windows) {
        return None;
    }
    let mut dirs: Vec<String> = tool.parent().map(|p| vec![p.to_string_lossy().to_string()]).unwrap_or_default();
    for d in ["/opt/homebrew/bin", "/usr/local/bin"] {
        if !dirs.iter().any(|x| x == d) {
            dirs.push(d.into());
        }
    }
    Some(dirs.join(":"))
}

/// macOS wg-quick prints "[+] Interface for dc1234 is utun5".
fn real_iface(output: &str) -> Option<String> {
    output.lines().find_map(|l| l.split(" is ").nth(1).filter(|_| l.contains("Interface for")).map(|s| s.trim().to_string()))
}

pub struct WgRun {
    tool: PathBuf,
    conf: PathBuf,
    iface: String,
    /// Brought up through the passwordless helper (bring it down through it too).
    via_helper: bool,
}

/// `wg-up` / `wg-down` through the passwordless helper. `None` = helper not usable.
async fn run_helper(id: &str, cmd: &str, conf: &Path) -> Option<AppResult<elevate::Output>> {
    let args = [cmd.to_string(), "--conf".into(), conf.to_string_lossy().into()];
    match helper::run(&args).await {
        Outcome::Done(stdout) => Some(Ok(elevate::Output { success: true, code: Some(0), stdout, stderr: String::new() })),
        Outcome::Failed(stderr) => Some(Ok(elevate::Output { success: false, code: None, stdout: String::new(), stderr })),
        Outcome::Rejected(m) => Some(Err(AppError::msg(helper::rejection(&m)))),
        Outcome::Unavailable(why) => {
            registry::log(id, &format!("Passwordless helper unavailable ({why}); asking for the administrator password instead"));
            None
        }
    }
}

impl WgRun {
    pub async fn stop(self, id: &str) -> AppResult<()> {
        let mut out = None;
        if self.via_helper {
            registry::log(id, "Bringing the WireGuard interface down through the passwordless helper");
            out = run_helper(id, "wg-down", &self.conf).await;
        }
        let out = match out {
            Some(o) => o?,
            None => self.stop_with_prompt(id).await?,
        };
        log_output(id, &out);
        let _ = std::fs::remove_file(&self.conf);
        if out.success { Ok(()) } else { Err(AppError::msg(format!("wg-quick down failed: {}", out.message()))) }
    }

    async fn stop_with_prompt(&self, id: &str) -> AppResult<elevate::Output> {
        registry::log(id, "Bringing the WireGuard interface down (administrator rights required)");
        elevate::run(&self.tool.to_string_lossy(), &down_args(&self.conf, &self.iface, cfg!(windows)), true, helper_path(&self.tool).as_deref()).await
    }
}

fn log_output(id: &str, out: &elevate::Output) {
    for l in out.stdout.lines().chain(out.stderr.lines()).filter(|l| !l.trim().is_empty()) {
        registry::log(id, l);
    }
}

pub async fn connect(id: String, generation: u64, profile: NetProfile, store: &NetStore, prompt: bool) -> AppResult<()> {
    let tool = tools::find_wireguard()
        .ok_or_else(|| AppError::msg(format!("WireGuard tools are not installed. {}", tools::wireguard_hint())))?;
    let text = std::fs::read_to_string(store.config_path(&id, NetKind::Wireguard)?)
        .map_err(|_| AppError::msg("The WireGuard configuration file is missing; edit the profile and paste it again"))?;
    let info = parse::parse_wireguard(&text);
    let text = if profile.options.get("dns").is_some_and(|v| v == "false") { parse::wireguard_strip_dns(&text) } else { text };
    let iface = iface_name(&id);
    let dir = store.dir()?.join("wg");
    std::fs::create_dir_all(&dir)?;
    let conf = dir.join(format!("{iface}.conf"));
    write_private(&conf, text.as_bytes())?;

    let mut helper_out = None;
    if !prompt && !cfg!(windows) && helper::ready().await {
        match helper::find_wg_tools(0) {
            Err(e) => registry::log(&id, &format!("Passwordless VPN can't run WireGuard here ({e}); asking for the administrator password instead")),
            Ok(_) => {
                registry::log(&id, &format!("Bringing up {iface} through the passwordless helper"));
                registry::set_connecting(&id, generation, Some("starting".into()));
                helper_out = run_helper(&id, "wg-up", &conf).await;
            }
        }
    }
    let via_helper = helper_out.is_some();
    let launched = match helper_out {
        Some(r) => r,
        None => {
            registry::log(&id, &format!("Bringing up {iface} with {} (administrator rights required)", tool.display()));
            registry::set_connecting(&id, generation, Some("waiting for authorization".into()));
            elevate::run(&tool.to_string_lossy(), &up_args(&conf, cfg!(windows)), true, helper_path(&tool).as_deref()).await
        }
    };
    let out = match launched {
        Ok(o) => o,
        Err(e) => {
            let _ = std::fs::remove_file(&conf);
            return Err(e);
        }
    };
    log_output(&id, &out);
    if !out.success {
        let _ = std::fs::remove_file(&conf);
        return Err(AppError::msg(format!("WireGuard failed: {}", out.message())));
    }
    let shown_iface = real_iface(&format!("{}\n{}", out.stdout, out.stderr)).unwrap_or_else(|| iface.clone());
    let detail = match info.interface.address.first() {
        Some(a) => format!("{a} via {shown_iface}"),
        None => shown_iface.clone(),
    };
    super::traffic::watch_interface(&id, &shown_iface);
    let run = WgRun { tool, conf, iface, via_helper };
    match registry::store_run(&id, generation, Run::Wireguard(run)) {
        Ok(()) => {
            registry::set_connected(&id, generation, Some(detail), vec![]);
        }
        Err(Run::Wireguard(stale)) => stale.stop(&id).await?,
        Err(_) => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_and_args() {
        assert_eq!(iface_name("3F2B1C9E-0000-4a4a-8b8b-123456789abc"), "dc3f2b1c9e");
        assert!(iface_name("3f2b1c9e-0000").len() <= 15);
        let conf = Path::new("/Users/me/Library/Application Support/dev.devcat.app/network/wg/dc3f2b1c9e.conf");
        assert_eq!(up_args(conf, false), vec!["up".to_string(), conf.to_string_lossy().into()]);
        assert_eq!(down_args(conf, "dc3f2b1c9e", true), vec!["/uninstalltunnelservice", "dc3f2b1c9e"]);
        let line = elevate::sh_command("/opt/homebrew/bin/wg-quick", &up_args(conf, false));
        assert_eq!(line, "/opt/homebrew/bin/wg-quick up '/Users/me/Library/Application Support/dev.devcat.app/network/wg/dc3f2b1c9e.conf'");
    }

    #[test]
    fn helper_paths() {
        if cfg!(unix) {
            assert_eq!(helper_path(Path::new("/opt/homebrew/bin/wg-quick")).unwrap(), "/opt/homebrew/bin:/usr/local/bin");
            assert_eq!(helper_path(Path::new("/usr/bin/wg-quick")).unwrap(), "/usr/bin:/opt/homebrew/bin:/usr/local/bin");
        }
    }

    #[test]
    fn iface_from_output() {
        let out = "[#] wireguard-go utun\n[+] Interface for dc3f2b1c9e is utun5\n[#] wg setconf utun5 /dev/fd/63\n";
        assert_eq!(real_iface(out).as_deref(), Some("utun5"));
        assert_eq!(real_iface("[#] ip link add dc1 type wireguard"), None);
    }
}
