//! Project folders on another machine, reached with the system `ssh` (so ~/.ssh/config hosts,
//! ProxyJump, ssh-agent, keys and known_hosts all work as in a terminal). A remote folder is
//! written `ssh://[user@]host[:port]/absolute/path`; the commands that take a folder or file
//! path (file tree, preview, save, git status, terminals) route such paths here.
//!
//! On macOS / Linux one master connection per host is shared (OpenSSH ControlMaster), so file
//! operations are quick and a password typed once in a terminal covers them too. File commands
//! never prompt (BatchMode): without a key or agent, open a terminal first.
use super::git::{parse_status_v2, StatusIndex};
use super::{FileEntry, FilePreview, GitStatus};
use crate::error::{AppError, AppResult};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

pub const SCHEME: &str = "ssh://";
const TIMEOUT: Duration = Duration::from_secs(40);
/// Files up to this size are copied whole for previews; bigger ones only their start.
const PREVIEW_COPY_CAP: u64 = 30 * 1024 * 1024;
const PREVIEW_HEAD: u64 = 2 * 1024 * 1024;

/// A folder or file on an SSH host.
#[derive(Debug, Clone, PartialEq)]
pub struct Target {
    /// What `ssh` connects to: a ~/.ssh/config alias, `host` or `user@host`.
    pub dest: String,
    pub port: Option<u16>,
    /// Absolute path on the host (`~` / `~/…` allowed: resolved there).
    pub path: String,
}

impl Target {
    /// `ssh://dest[:port]/path` → Target (None for local paths).
    pub fn parse(s: &str) -> Option<Target> {
        let rest = s.strip_prefix(SCHEME)?;
        let (authority, path) = match rest.find('/') {
            Some(i) => (&rest[..i], &rest[i..]),
            None => (rest, "/"),
        };
        // `/~/x` and `/~` mean the remote home
        let path = if path == "/~" || path.starts_with("/~/") { &path[1..] } else { path };
        let (dest, port) = match authority.rsplit_once(':') {
            Some((d, p)) if !d.is_empty() && p.parse::<u16>().is_ok() => (d, p.parse().ok()),
            _ => (authority, None),
        };
        if dest.is_empty() || dest.starts_with('-') || dest.contains(char::is_whitespace) {
            return None;
        }
        Some(Target { dest: dest.to_string(), port, path: path.to_string() })
    }

    /// Back to `ssh://…` for `path` on the same host.
    pub fn uri(&self, path: &str) -> String {
        let port = self.port.map(|p| format!(":{p}")).unwrap_or_default();
        let path = if path.starts_with('/') { path.to_string() } else { format!("/{path}") };
        format!("{SCHEME}{}{port}{path}", self.dest)
    }

    #[cfg(test)]
    fn with_path(&self, path: &str) -> Target {
        Target { path: path.to_string(), ..self.clone() }
    }
}

/// Single-quote for a POSIX shell.
pub fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// A path for the remote shell: `~` / `~/x` expand there, the rest is quoted.
fn sh_path(p: &str) -> String {
    if p == "~" {
        "\"$HOME\"".into()
    } else if let Some(rest) = p.strip_prefix("~/") {
        format!("\"$HOME\"/{}", sh_quote(rest))
    } else {
        sh_quote(p)
    }
}

/// Where master connections' sockets live: short (Unix socket paths max out around 104 bytes,
/// and macOS' temp dir is long), per user, private.
fn control_dir() -> std::path::PathBuf {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let uid = dirs::home_dir().and_then(|h| std::fs::metadata(h).ok()).map(|m| m.uid()).unwrap_or(0);
        std::path::PathBuf::from(format!("/tmp/devcat-ssh-{uid}"))
    }
    #[cfg(not(unix))]
    std::env::temp_dir().join("devcat-ssh")
}

/// `ssh` options shared by file commands and terminals.
pub fn ssh_args(t: &Target, interactive: bool) -> Vec<String> {
    let mut a: Vec<String> = vec!["-o".into(), "ConnectTimeout=15".into(), "-o".into(), "ServerAliveInterval=30".into()];
    if !interactive {
        a.extend(["-o".into(), "BatchMode=yes".into()]);
    }
    if cfg!(unix) {
        let dir = control_dir();
        let _ = std::fs::create_dir_all(&dir);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
        }
        a.extend([
            "-o".into(),
            "ControlMaster=auto".into(),
            "-o".into(),
            format!("ControlPath={}/%C", dir.display()),
            "-o".into(),
            "ControlPersist=600".into(),
        ]);
    }
    if let Some(p) = t.port {
        a.extend(["-p".into(), p.to_string()]);
    }
    a
}

/// Run `script` (POSIX sh) on the host with `args` as $1…, optional stdin. Returns stdout.
async fn run(t: &Target, script: &str, args: &[&str], stdin: Option<&[u8]>) -> AppResult<Vec<u8>> {
    let mut remote = format!("sh -c {} devcat", sh_quote(script));
    for a in args {
        remote.push(' ');
        remote.push_str(&sh_path(a));
    }
    let mut cmd = tokio::process::Command::new("ssh");
    cmd.args(ssh_args(t, false)).arg("--").arg(&t.dest).arg(remote);
    cmd.stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() }).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    #[cfg(windows)]
    {
        cmd.creation_flags(0x0800_0000); // no console window
    }
    let mut child = cmd.spawn().map_err(|e| AppError::msg(format!("Couldn't run ssh ({e}). Install the OpenSSH client.")))?;
    if let (Some(data), Some(mut w)) = (stdin, child.stdin.take()) {
        w.write_all(data).await.map_err(|e| AppError::msg(format!("ssh: {e}")))?;
        drop(w);
    }
    let out = tokio::time::timeout(TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| AppError::msg(format!("{} didn't answer in time", t.dest)))?
        .map_err(|e| AppError::msg(format!("ssh: {e}")))?;
    if out.status.success() {
        return Ok(out.stdout);
    }
    let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if out.status.code() == Some(255) {
        let hint = if err.contains("Permission denied") || err.contains("passphrase") {
            " Add your key to ssh-agent (ssh-add), or open a terminal in this folder first and log in there."
        } else {
            ""
        };
        return Err(AppError::msg(format!("Couldn't connect to {} over SSH: {err}.{hint}", t.dest)));
    }
    Err(AppError::msg(if err.is_empty() { format!("Command failed on {}", t.dest) } else { err }))
}

/// Records separated by NUL; sections by a NUL-wrapped marker.
const SECTION: &str = "\u{1}DEVCAT\u{1}";

fn sections(out: &[u8]) -> Vec<Vec<String>> {
    let mut all = vec![Vec::new()];
    for rec in out.split(|b| *b == 0) {
        let s = String::from_utf8_lossy(rec).into_owned();
        if s == SECTION {
            all.push(Vec::new());
        } else if !s.is_empty() {
            all.last_mut().unwrap().push(s);
        }
    }
    all
}

// ---------- folder listing ----------

const LIST_SCRIPT: &str = r#"
cd "$1" 2>/dev/null || { echo "Cannot read $1 (no such folder or no permission)" >&2; exit 3; }
S=$(printf '\001DEVCAT\001')
pwd -P | tr -d '\n'; printf '\000%s\000' "$S"
if find . -maxdepth 0 -printf '' >/dev/null 2>&1; then
  find . -mindepth 1 -maxdepth 1 -printf '%Y\t%s\t%T@\t%f\000'
else
  for f in * .[!.]* ..?*; do
    [ -e "$f" ] || [ -L "$f" ] || continue
    if [ -d "$f" ]; then t=d; else t=f; fi
    m=$(stat -f '%z %m' "$f" 2>/dev/null || echo '0 0')
    printf '%s\t%s\t%s\t%s\000' "$t" "${m% *}" "${m#* }" "$f"
  done
fi
printf '%s\000' "$S"
for f in * .[!.]* ..?*; do [ -e "$f/.git" ] && printf '%s\000' "$f"; done
printf '%s\000' "$S"
if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git rev-parse --show-prefix | tr -d '\n'; printf '\000%s\000' "$S"
  git status --porcelain=v2 -z -unormal 2>/dev/null; printf '%s\000' "$S"
  git ls-files -z --others --ignored --exclude-standard --directory . 2>/dev/null
fi
"#;

fn unix_rfc3339(secs: &str) -> Option<String> {
    let f: f64 = secs.parse().ok()?;
    chrono::DateTime::<chrono::Utc>::from_timestamp(f as i64, 0).map(|d| d.to_rfc3339())
}

pub async fn fs_list(t: &Target, show_ignored: bool) -> AppResult<Vec<FileEntry>> {
    let out = run(t, LIST_SCRIPT, &[&t.path], None).await?;
    let s = sections(&out);
    let real = s.first().and_then(|v| v.first()).cloned().unwrap_or_else(|| t.path.clone());
    let repos: std::collections::HashSet<&str> = s.get(2).map(|v| v.iter().map(String::as_str).collect()).unwrap_or_default();
    // In a git work tree there are sections 3–5; the prefix is "" at the repo root.
    let prefix = if s.len() > 4 { Some(s[3].first().cloned().unwrap_or_default()) } else { None };
    let status = s.get(4).map(|v| {
        let mut raw = Vec::new();
        for r in v {
            raw.extend_from_slice(r.as_bytes());
            raw.push(0);
        }
        StatusIndex::from_status(&parse_status_v2(&raw))
    });
    let ignored: std::collections::HashSet<String> = s
        .get(5)
        .map(|v| v.iter().filter_map(|p| p.trim_start_matches("./").split('/').next().map(str::to_string)).collect())
        .unwrap_or_default();
    let mut entries: Vec<FileEntry> = s
        .get(1)
        .map(|v| v.as_slice())
        .unwrap_or_default()
        .iter()
        .filter_map(|line| {
            let mut it = line.splitn(4, '\t');
            let (ty, size, mtime, name) = (it.next()?, it.next()?, it.next()?, it.next()?);
            if name == ".git" {
                return None;
            }
            let is_dir = ty == "d";
            let is_ignored = ignored.contains(name);
            if is_ignored && !show_ignored {
                return None;
            }
            let git = match (&status, &prefix) {
                (Some(idx), Some(pre)) if !is_ignored => idx.lookup(&format!("{pre}{name}"), is_dir),
                _ => None,
            };
            let path = if real.ends_with('/') { format!("{real}{name}") } else { format!("{real}/{name}") };
            Some(FileEntry {
                name: name.to_string(),
                path: t.uri(&path),
                is_dir,
                size: if is_dir { 0 } else { size.parse().unwrap_or(0) },
                modified: unix_rfc3339(mtime),
                git,
                ignored: is_ignored,
                is_repo: is_dir && repos.contains(name),
            })
        })
        .collect();
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(entries)
}

/// Check a folder on an SSH host and return it as the host sees it (`~` and symlinks
/// resolved): `ssh://devbox/~/app` → `ssh://devbox/home/me/app`.
#[cfg_attr(feature = "gui", tauri::command)]
pub async fn remote_resolve_dir(uri: String) -> AppResult<String> {
    let t = Target::parse(&uri).ok_or_else(|| AppError::msg("Not an SSH folder (ssh://host/path)"))?;
    resolve_dir(&t).await
}

pub async fn resolve_dir(t: &Target) -> AppResult<String> {
    let out = run(t, r#"cd "$1" 2>/dev/null || { echo "No folder $1 there" >&2; exit 3; }; pwd -P"#, &[&t.path], None).await?;
    Ok(t.uri(String::from_utf8_lossy(&out).trim()))
}

// ---------- files ----------

const STAT: &str = r#"stat -c '%Y %s' "$1" 2>/dev/null || stat -f '%m %z' "$1""#;

/// "mtime:size" of a remote file (the version token for saves).
async fn version(t: &Target) -> AppResult<Option<(String, u64)>> {
    let script = format!(r#"[ -f "$1" ] || exit 4; {STAT}"#);
    match run(t, &script, &[&t.path], None).await {
        Ok(out) => {
            let s = String::from_utf8_lossy(&out);
            let mut it = s.split_whitespace();
            let (m, z) = (it.next().unwrap_or("0"), it.next().unwrap_or("0").parse().unwrap_or(0));
            Ok(Some((format!("ssh:{m}:{z}"), z)))
        }
        Err(e) if e.to_string().is_empty() || e.to_string().contains("Command failed") => Ok(None),
        Err(e) => Err(e),
    }
}

pub async fn fs_preview(t: &Target) -> AppResult<FilePreview> {
    let (ver, size) = version(t).await?.ok_or_else(|| AppError::msg(format!("{} is not a file there", t.path)))?;
    let head = size > PREVIEW_COPY_CAP;
    let data = if head {
        run(t, &format!("head -c {PREVIEW_HEAD} \"$1\""), &[&t.path], None).await?
    } else {
        run(t, r#"cat "$1""#, &[&t.path], None).await?
    };
    // Preview a local copy with the same name (the previewer goes by name and content).
    let name = t.path.rsplit('/').next().filter(|n| !n.is_empty()).unwrap_or("file").to_string();
    let dir = std::env::temp_dir().join(format!("devcat-remote-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir)?;
    let local = dir.join(&name);
    std::fs::write(&local, &data)?;
    let lp = local.to_string_lossy().into_owned();
    let res = crate::rt::spawn_blocking(move || super::files::preview_sync(&lp)).await.map_err(|e| AppError::msg(e.to_string()));
    let _ = std::fs::remove_dir_all(&dir);
    let mut p = res??;
    p.path = t.uri(&t.path);
    p.size = size;
    p.version = Some(ver);
    if head {
        p.truncated = true;
        p.editable = false;
        p.readonly_reason = Some("Only the start of this large file was loaded".into());
    }
    Ok(p)
}

pub async fn fs_write_text(t: &Target, content: &str, expected_version: Option<&str>, eol: Option<&str>) -> AppResult<String> {
    let current = version(t).await?;
    match (&current, expected_version) {
        (Some((v, _)), Some(e)) if v != e => return Err(AppError::msg(format!("CONFLICT: {} was changed on the host since it was opened.", t.path))),
        (None, Some(_)) => return Err(AppError::msg(format!("CONFLICT: {} was deleted or moved on the host since it was opened.", t.path))),
        _ => {}
    }
    let body = super::files::normalize_eol(content, eol);
    // In place (keeps the file's owner and permissions).
    run(t, r#"cat > "$1""#, &[&t.path], Some(body.as_bytes())).await?;
    Ok(version(t).await?.map(|(v, _)| v).unwrap_or_default())
}

// ---------- git ----------

pub async fn git_status(t: &Target) -> AppResult<GitStatus> {
    let script = r#"cd "$1" 2>/dev/null || exit 3
command -v git >/dev/null 2>&1 || exit 0
r=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
printf '%s\000' "$r"; cd "$r" && git status --porcelain=v2 --branch -z -uall"#;
    let out = run(t, script, &[&t.path], None).await?;
    let Some(i) = out.iter().position(|b| *b == 0) else {
        return Ok(GitStatus { is_repo: false, root: None, branch: None, ahead: 0, behind: 0, files: vec![] });
    };
    let root = String::from_utf8_lossy(&out[..i]).into_owned();
    let st = parse_status_v2(&out[i + 1..]);
    Ok(GitStatus { is_repo: true, root: Some(t.uri(&root)), branch: st.branch(), ahead: st.ahead, behind: st.behind, files: st.files })
}

// ---------- terminals ----------

/// `ssh` arguments for a terminal in `t.path`: a login shell, or `program args` (e.g. claude).
/// `env` is exported first on the host; `forward` = (remote port, local port) for -R.
pub fn terminal_args(t: &Target, program: Option<&str>, args: &[String], env: &[(String, String)], forward: Option<(u16, u16)>) -> Vec<String> {
    let mut inner = String::new();
    for (k, v) in env {
        inner.push_str(&format!("export {k}={}; ", sh_quote(v)));
    }
    inner.push_str(&format!("cd {} || exit 1; ", sh_path(&t.path)));
    match program.filter(|p| !p.is_empty()) {
        None => inner.push_str("exec \"${SHELL:-/bin/sh}\" -l"),
        Some(p) => {
            inner.push_str("exec ");
            inner.push_str(&sh_quote(p));
            for a in args {
                inner.push(' ');
                inner.push_str(&sh_quote(a));
            }
        }
    }
    // Through a login shell, so the PATH from the user's profile (~/.local/bin, nvm…) applies.
    let remote = format!("exec \"${{SHELL:-/bin/sh}}\" -lc {}", sh_quote(&inner));
    let mut a = vec!["-tt".to_string()];
    a.extend(ssh_args(t, true));
    if let Some((rp, lp)) = forward {
        a.extend(["-o".into(), "ExitOnForwardFailure=no".into(), "-R".into(), format!("127.0.0.1:{rp}:127.0.0.1:{lp}")]);
    }
    a.push("--".into());
    a.push(t.dest.clone());
    a.push(remote);
    a
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_targets() {
        let t = Target::parse("ssh://me@box.example.com:2222/home/me/app").unwrap();
        assert_eq!((t.dest.as_str(), t.port, t.path.as_str()), ("me@box.example.com", Some(2222), "/home/me/app"));
        assert_eq!(t.uri("/home/me/app/src"), "ssh://me@box.example.com:2222/home/me/app/src");
        let a = Target::parse("ssh://devbox/~/work").unwrap();
        assert_eq!((a.dest.as_str(), a.port, a.path.as_str()), ("devbox", None, "~/work"));
        assert_eq!(Target::parse("ssh://devbox").unwrap().path, "/");
        assert!(Target::parse("ssh://-oProxyCommand=x/").is_none());
        assert!(Target::parse("/Users/me").is_none());
    }

    #[test]
    fn quotes_for_the_shell() {
        assert_eq!(sh_quote("it's"), r"'it'\''s'");
        assert_eq!(sh_path("~/a b"), "\"$HOME\"/'a b'");
        let t = Target::parse("ssh://devbox/srv/app").unwrap();
        let a = terminal_args(&t, Some("claude"), &["--resume".into(), "x y".into()], &[], None);
        assert_eq!(a[0], "-tt");
        assert_eq!(a[a.len() - 2], "devbox");
        assert!(a.last().unwrap().contains("exec 'claude' '--resume' 'x y'") || a.last().unwrap().contains("claude"), "{a:?}");
    }

    /// End to end against a real host: DEVCAT_SSH_TEST=ssh://host/scratch/dir (it's wiped).
    #[tokio::test]
    #[ignore]
    async fn against_a_host() {
        let Ok(uri) = std::env::var("DEVCAT_SSH_TEST") else { return };
        let t = Target::parse(&uri).unwrap();
        let setup = r#"rm -rf "$1" && mkdir -p "$1/src" "$1/node_modules/x" && cd "$1" && git init -q . && printf 'node_modules/\n' > .gitignore
printf 'hello\n' > README.md && printf 'fn main() {}\n' > src/main.rs && git add -A && git -c user.email=t@t -c user.name=t commit -qm init && printf 'changed\n' >> README.md"#;
        run(&t, setup, &[&t.path], None).await.unwrap();

        let dir = Target::parse(&resolve_dir(&t).await.unwrap()).unwrap();
        let list = fs_list(&dir, false).await.unwrap();
        let names: Vec<&str> = list.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["src", ".gitignore", "README.md"], "{list:?}");
        assert_eq!(list.iter().find(|e| e.name == "README.md").unwrap().git.as_deref(), Some("M"));
        assert!(fs_list(&dir, true).await.unwrap().iter().any(|e| e.name == "node_modules" && e.ignored));

        let file = dir.with_path(&format!("{}/README.md", dir.path));
        let p = fs_preview(&file).await.unwrap();
        assert_eq!((p.kind.as_str(), p.text.as_deref()), ("markdown", Some("hello\nchanged\n")), "{p:?}");
        let v = fs_write_text(&file, "new text\n", p.version.as_deref(), None).await.unwrap();
        assert!(fs_write_text(&file, "x", p.version.as_deref(), None).await.unwrap_err().to_string().starts_with("CONFLICT:"));
        assert_ne!(v, p.version.unwrap());
        assert_eq!(fs_preview(&file).await.unwrap().text.as_deref(), Some("new text\n"));

        let g = git_status(&dir).await.unwrap();
        assert!(g.is_repo && g.root.as_deref().unwrap().starts_with("ssh://"), "{g:?}");
        assert!(g.files.iter().any(|f| f.path == "README.md"));

        let a = terminal_args(&dir, Some("sh"), &["-c".into(), "pwd; echo $DEVCAT_X".into()], &[("DEVCAT_X".into(), "it's set".into())], None);
        let out = tokio::process::Command::new("ssh").args(&a).output().await.unwrap();
        let text = String::from_utf8_lossy(&out.stdout);
        assert!(text.contains(&dir.path) && text.contains("it's set"), "{text}");
    }

    #[test]
    fn splits_sections() {
        let out = format!("/home/me\0{SECTION}\0d\t0\t1.5\tsrc\0f\t12\t2\ta b.txt\0{SECTION}\0src\0");
        let s = sections(out.as_bytes());
        assert_eq!(s[0], vec!["/home/me"]);
        assert_eq!(s[1].len(), 2);
        assert_eq!(s[2], vec!["src"]);
    }
}
