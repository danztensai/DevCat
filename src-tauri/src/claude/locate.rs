//! Locating the `claude` binary and building the environment its child processes get.
//! GUI apps (Finder / Dock launches) don't inherit the login shell's PATH, so both the
//! binary lookup and the PATH handed to claude (for its Bash tool, git, MCP servers…)
//! search the usual install locations explicitly.
use parking_lot::Mutex;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;

static CLAUDE_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);
static CHILD_PATH: tokio::sync::OnceCell<OsString> = tokio::sync::OnceCell::const_new();

fn exe_names() -> &'static [&'static str] {
    if cfg!(windows) { &["claude.exe", "claude.cmd"] } else { &["claude"] }
}

fn is_executable(p: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        p.metadata().is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    {
        p.is_file()
    }
}

/// Well-known install directories, in priority order after PATH.
fn known_dirs() -> Vec<PathBuf> {
    let home = dirs::home_dir().unwrap_or_default();
    let mut v: Vec<PathBuf> = vec![home.join(".local/bin"), home.join(".claude/local")];
    if cfg!(windows) {
        if let Some(profile) = std::env::var_os("USERPROFILE").map(PathBuf::from) {
            v.push(profile.join(".local").join("bin"));
        }
        if let Some(local) = dirs::data_local_dir() {
            v.push(local.join("Programs").join("claude"));
            v.push(local.join("claude"));
            v.push(local.join("AnthropicClaude"));
        }
        if let Some(roaming) = dirs::data_dir() {
            v.push(roaming.join("npm"));
        }
    } else {
        v.extend(
            ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/home/linuxbrew/.linuxbrew/bin"].iter().map(PathBuf::from),
        );
        v.extend([home.join(".bun/bin"), home.join(".npm-global/bin"), home.join("bin")]);
    }
    v
}

fn search() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("CLAUDE_PATH").map(PathBuf::from).filter(|p| is_executable(p)) {
        return Some(p);
    }
    let path = std::env::var_os("PATH").unwrap_or_default();
    std::env::split_paths(&path)
        .chain(known_dirs())
        .flat_map(|d| exe_names().iter().map(move |n| d.join(n)))
        .find(|p| is_executable(p))
}

/// Absolute path of the claude binary (cached while it keeps existing).
pub fn claude_path() -> Option<PathBuf> {
    let mut cached = CLAUDE_PATH.lock();
    if let Some(p) = cached.as_ref().filter(|p| p.is_file()) {
        return Some(p.clone());
    }
    *cached = search();
    cached.clone()
}

/// PATH printed by the user's login + interactive shell (where nvm/asdf/brew usually live).
#[cfg(unix)]
async fn login_shell_path() -> Option<OsString> {
    const MARK: &str = "__DEVCAT_PATH__";
    let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/zsh".into());
    let mut cmd = tokio::process::Command::new(shell);
    cmd.arg("-ilc")
        .arg(format!("printf '%s%s%s' {MARK} \"$PATH\" {MARK}"))
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    let out = tokio::time::timeout(Duration::from_secs(4), cmd.output()).await.ok()?.ok()?;
    let s = String::from_utf8_lossy(&out.stdout);
    let start = s.find(MARK)? + MARK.len();
    let end = start + s[start..].find(MARK)?;
    let p = s[start..end].trim();
    (!p.is_empty()).then(|| OsString::from(p))
}

#[cfg(not(unix))]
async fn login_shell_path() -> Option<OsString> {
    None
}

/// PATH for claude child processes: login shell PATH, our own PATH, the claude binary's
/// dir and the usual install locations (deduplicated, missing dirs dropped).
pub async fn child_path() -> OsString {
    CHILD_PATH
        .get_or_init(|| async {
            let mut dirs_list: Vec<PathBuf> = Vec::new();
            let mut add = |d: PathBuf| {
                if !dirs_list.contains(&d) && d.is_dir() {
                    dirs_list.push(d);
                }
            };
            if let Some(p) = login_shell_path().await {
                std::env::split_paths(&p).for_each(&mut add);
            }
            if let Some(p) = std::env::var_os("PATH") {
                std::env::split_paths(&p).for_each(&mut add);
            }
            if let Some(dir) = claude_path().and_then(|p| p.parent().map(Path::to_path_buf)) {
                add(dir);
            }
            known_dirs().into_iter().for_each(&mut add);
            if !cfg!(windows) {
                let home = dirs::home_dir().unwrap_or_default();
                for d in ["/usr/sbin", "/sbin", "/bin", "/opt/homebrew/sbin", "/usr/local/sbin"] {
                    add(PathBuf::from(d));
                }
                add(home.join(".cargo/bin"));
                add(home.join("go/bin"));
            }
            std::env::join_paths(dirs_list).unwrap_or_else(|_| std::env::var_os("PATH").unwrap_or_default())
        })
        .await
        .clone()
}

/// Absolute path of any CLI (`codex`, `gemini`, …): an explicit path (`~` expanded) is used
/// as is, a bare name is searched on the same augmented PATH claude gets.
pub async fn find_program(name: &str) -> Option<PathBuf> {
    let name = name.trim();
    if name.is_empty() {
        return None;
    }
    let expanded = match name.strip_prefix("~/") {
        Some(rest) => dirs::home_dir()?.join(rest),
        None => PathBuf::from(name),
    };
    let candidates = |p: PathBuf| -> Vec<PathBuf> {
        if cfg!(windows) && p.extension().is_none() {
            ["exe", "cmd", "bat"].iter().map(|e| p.with_extension(e)).chain([p.clone()]).collect()
        } else {
            vec![p]
        }
    };
    if expanded.components().count() > 1 || expanded.is_absolute() {
        return candidates(expanded).into_iter().find(|p| is_executable(p));
    }
    let path = child_path().await;
    std::env::split_paths(&path)
        .flat_map(|d| candidates(d.join(&expanded)))
        .find(|p| is_executable(p))
}

/// A `claude` command with the augmented PATH, no console window on Windows, and the
/// env vars that would make it think it's nested inside another Claude Code removed.
pub async fn command(bin: &Path) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(bin);
    cmd.env("PATH", child_path().await).env_remove("CLAUDECODE").env_remove("CLAUDE_CODE_ENTRYPOINT");
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    cmd
}

/// `git` (or any helper) command with the same PATH as claude gets.
pub async fn tool_command(program: &str) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(program);
    cmd.env("PATH", child_path().await);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_dirs_cover_native_install() {
        let home = dirs::home_dir().unwrap();
        assert!(known_dirs().contains(&home.join(".local/bin")));
        assert!(known_dirs().contains(&home.join(".claude/local")));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn finds_programs() {
        assert!(find_program("sh").await.is_some_and(|p| p.is_absolute()));
        assert_eq!(find_program("/bin/sh").await, Some(PathBuf::from("/bin/sh")));
        assert!(find_program("definitely-not-a-devcat-cli").await.is_none());
        assert!(find_program("").await.is_none());
    }

    #[tokio::test]
    async fn child_path_is_nonempty() {
        assert!(!child_path().await.is_empty());
    }
}
