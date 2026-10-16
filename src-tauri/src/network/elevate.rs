//! Running VPN helpers with administrator rights.
//!
//! macOS: `osascript -e 'do shell script "…" with administrator privileges'`
//! Linux: `pkexec <program> <args…>` (argv, no shell)
//! Windows: PowerShell `Start-Process -Verb RunAs -WindowStyle Hidden`
//!
//! Every argument is quoted for each layer it passes through (POSIX shell inside an
//! AppleScript string literal; PowerShell single-quoted string + Windows argv quoting).
use crate::error::{AppError, AppResult};

pub const CANCELLED: &str = "Authorization cancelled";

/// Quote one argument for a POSIX shell (`'…'`, with `'` → `'\''`).
pub fn sh_quote(s: &str) -> String {
    if !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_./=:,+@%".contains(c)) {
        return s.to_string();
    }
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// A shell command line from a program and its arguments.
pub fn sh_command(program: &str, args: &[String]) -> String {
    std::iter::once(program).chain(args.iter().map(String::as_str)).map(sh_quote).collect::<Vec<_>>().join(" ")
}

/// Escape text for an AppleScript double-quoted string literal.
pub fn applescript_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// The AppleScript passed to `osascript -e` for a shell command line.
pub fn osascript_script(shell_cmd: &str, prompt: &str) -> String {
    format!(
        "do shell script {} with prompt {} with administrator privileges",
        applescript_string(shell_cmd),
        applescript_string(prompt)
    )
}

/// Quote one argument per the Windows `CommandLineToArgvW` rules.
pub fn win_arg(s: &str) -> String {
    if !s.is_empty() && !s.chars().any(|c| c.is_whitespace() || c == '"') {
        return s.to_string();
    }
    let mut out = String::from("\"");
    let mut backslashes = 0;
    for c in s.chars() {
        match c {
            '\\' => backslashes += 1,
            '"' => {
                out.push_str(&"\\".repeat(backslashes * 2 + 1));
                out.push('"');
                backslashes = 0;
            }
            c => {
                out.push_str(&"\\".repeat(backslashes));
                out.push(c);
                backslashes = 0;
            }
        }
    }
    out.push_str(&"\\".repeat(backslashes * 2));
    out.push('"');
    out
}

/// PowerShell single-quoted string literal.
pub fn ps_string(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// PowerShell script that starts `program` elevated and hidden. With `wait`, it waits and
/// exits with the program's exit code; otherwise it returns as soon as it was launched.
pub fn powershell_script(program: &str, args: &[String], wait: bool) -> String {
    let arg_line = args.iter().map(|a| win_arg(a)).collect::<Vec<_>>().join(" ");
    let mut s = format!(
        "$ErrorActionPreference='Stop'; $p = Start-Process -FilePath {} -Verb RunAs -WindowStyle Hidden -PassThru",
        ps_string(program)
    );
    if !arg_line.is_empty() {
        s.push_str(&format!(" -ArgumentList {}", ps_string(&arg_line)));
    }
    if wait {
        s.push_str(" -Wait; exit $p.ExitCode");
    }
    s
}

/// Which elevation mechanism this OS uses (for `NetTools.elevation`).
pub fn mechanism() -> &'static str {
    if cfg!(target_os = "macos") {
        "osascript"
    } else if cfg!(windows) {
        "uac"
    } else if super::tools::which("pkexec").is_some() {
        "pkexec"
    } else {
        "none"
    }
}

pub struct Output {
    pub success: bool,
    /// Exit code (on Windows, the elevated program's own, passed through PowerShell).
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

impl Output {
    /// The most useful error text: stderr, else stdout.
    pub fn message(&self) -> String {
        let e = self.stderr.trim();
        if e.is_empty() { self.stdout.trim().to_string() } else { e.to_string() }
    }
}

/// Clean an osascript error ("0:12: execution error: <msg> (1)") down to `<msg>`.
pub fn clean_osascript_error(s: &str) -> String {
    let s = s.trim();
    let s = s.split_once("execution error: ").map(|(_, r)| r).unwrap_or(s);
    match s.rfind(" (") {
        Some(i) if s.ends_with(')') && s[i + 2..s.len() - 1].trim_start_matches('-').chars().all(|c| c.is_ascii_digit()) => {
            s[..i].trim().to_string()
        }
        _ => s.to_string(),
    }
}

fn is_cancel(out: &std::process::Output) -> bool {
    let err = String::from_utf8_lossy(&out.stderr);
    if cfg!(target_os = "macos") {
        err.contains("(-128)") || err.contains("User canceled")
    } else if cfg!(windows) {
        err.contains("canceled by the user") || err.contains("cancelled by the user")
    } else {
        // pkexec: 126 = dialog dismissed, 127 = not authorized
        matches!(out.status.code(), Some(126) | Some(127))
    }
}

/// Run `program args…` with administrator rights. `wait = false` (Windows only) returns
/// once the process was launched. `env_path` is prepended to PATH (macOS/Linux) so
/// scripts like wg-quick find their helpers. Cancelling the auth dialog → `CANCELLED`.
pub async fn run(program: &str, args: &[String], wait: bool, env_path: Option<&str>) -> AppResult<Output> {
    let mut cmd;
    if cfg!(target_os = "macos") {
        let mut line = sh_command(program, args);
        if let Some(p) = env_path {
            line = format!("PATH={}:\"$PATH\" {line}", sh_quote(p));
        }
        cmd = tokio::process::Command::new("/usr/bin/osascript");
        cmd.arg("-e").arg(osascript_script(&line, "DevCat needs administrator rights to manage the VPN connection."));
    } else if cfg!(windows) {
        cmd = tokio::process::Command::new("powershell.exe");
        cmd.args(["-NoProfile", "-NonInteractive", "-Command", &powershell_script(program, args, wait)]);
        #[cfg(windows)]
        {
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
    } else {
        let pkexec = super::tools::which("pkexec")
            .ok_or_else(|| AppError::msg("pkexec (polkit) is required to run VPN tools with administrator rights"))?;
        cmd = tokio::process::Command::new(pkexec);
        if let Some(p) = env_path {
            let path = format!("PATH={p}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin");
            cmd.arg("env").arg(path);
        }
        cmd.arg(program).args(args);
    }
    cmd.stdin(std::process::Stdio::null()).kill_on_drop(false);
    let out = cmd.output().await.map_err(|e| AppError::msg(format!("Cannot request administrator rights: {e}")))?;
    if !out.status.success() && is_cancel(&out) {
        return Err(AppError::msg(CANCELLED));
    }
    let mut stderr = String::from_utf8_lossy(&out.stderr).to_string();
    if cfg!(target_os = "macos") && !out.status.success() {
        stderr = clean_osascript_error(&stderr);
    }
    Ok(Output { success: out.status.success(), code: out.status.code(), stdout: String::from_utf8_lossy(&out.stdout).to_string(), stderr })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_quoting() {
        assert_eq!(sh_quote("abc-1.2/x"), "abc-1.2/x");
        assert_eq!(sh_quote(""), "''");
        assert_eq!(sh_quote("a b"), "'a b'");
        assert_eq!(sh_quote("it's"), r"'it'\''s'");
        assert_eq!(sh_quote("$(rm -rf /)"), "'$(rm -rf /)'");
        assert_eq!(sh_quote("a;b`c`"), "'a;b`c`'");
        let cmd = sh_command(
            "/opt/homebrew/sbin/openvpn",
            &["--config".into(), "/Users/me/Library/Application Support/dev.devcat.app/network/x.ovpn".into()],
        );
        assert_eq!(cmd, "/opt/homebrew/sbin/openvpn --config '/Users/me/Library/Application Support/dev.devcat.app/network/x.ovpn'");
    }

    #[test]
    fn applescript_quoting() {
        assert_eq!(applescript_string(r#"a"b\c"#), r#""a\"b\\c""#);
        let line = sh_command("/bin/echo", &["it's \"quoted\" \\ $HOME".into()]);
        let script = osascript_script(&line, "Why");
        assert_eq!(
            script,
            r#"do shell script "/bin/echo 'it'\\''s \"quoted\" \\ $HOME'" with prompt "Why" with administrator privileges"#
        );
        // Newlines can't break out of the string literal.
        assert_eq!(applescript_string("a\nb"), r#""a\nb""#);
    }

    #[test]
    fn windows_quoting() {
        assert_eq!(win_arg("plain"), "plain");
        assert_eq!(win_arg(r"C:\Program Files\x.conf"), r#""C:\Program Files\x.conf""#);
        assert_eq!(win_arg(r#"a"b"#), r#""a\"b""#);
        assert_eq!(win_arg(r"dir with space\"), r#""dir with space\\""#);
        assert_eq!(ps_string("it's"), "'it''s'");
        let s = powershell_script(r"C:\Program Files\WireGuard\wireguard.exe", &["/installtunnelservice".into(), r"C:\Users\O'Neil\dc1.conf".into()], true);
        assert_eq!(
            s,
            r"$ErrorActionPreference='Stop'; $p = Start-Process -FilePath 'C:\Program Files\WireGuard\wireguard.exe' -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList '/installtunnelservice C:\Users\O''Neil\dc1.conf' -Wait; exit $p.ExitCode"
        );
        let s = powershell_script("openvpn.exe", &[], false);
        assert!(!s.contains("-Wait") && !s.contains("-ArgumentList"));
    }

    #[test]
    fn osascript_errors() {
        assert_eq!(clean_osascript_error("0:120: execution error: wg-quick: `utun' already exists (1)\n"), "wg-quick: `utun' already exists");
        assert_eq!(clean_osascript_error("plain message"), "plain message");
        assert_eq!(clean_osascript_error("execution error: User canceled. (-128)"), "User canceled.");
    }
}
