//! Parsers for OpenVPN (.ovpn), WireGuard (.conf) and `~/.ssh/config` files.
use super::{NetKind, SshConfigHost};
use serde::Serialize;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------- OpenVPN

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OvpnRemote {
    pub host: String,
    pub port: u16,
    pub proto: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OvpnInfo {
    pub summary: String,
    pub remotes: Vec<OvpnRemote>,
    pub dev: Option<String>,
    pub needs_user_pass: bool,
    /// A private key (`<key>` / `<pkcs12>`) is embedded in the config.
    pub has_inline_key: bool,
    /// Names of inline blocks, e.g. ["ca", "cert", "key", "tls-crypt"].
    pub inline_blocks: Vec<String>,
    /// Files referenced by path (`ca foo.crt`), not embedded.
    pub external_files: Vec<String>,
    pub warnings: Vec<String>,
}

/// Directives whose argument is a file that may instead be embedded as `<name>…</name>`.
const FILE_DIRECTIVES: &[&str] = &[
    "ca", "cert", "key", "tls-auth", "tls-crypt", "tls-crypt-v2", "extra-certs", "secret", "crl-verify", "dh",
    "pkcs12", "http-proxy-user-pass",
];

/// Split a config line into whitespace separated tokens, honouring "double" and 'single' quotes.
fn tokens(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut has = false;
    let mut chars = line.chars();
    while let Some(c) = chars.next() {
        match quote {
            Some(q) if c == q => quote = None,
            Some('"') if c == '\\' => {
                if let Some(n) = chars.next() {
                    cur.push(n);
                }
            }
            Some(_) => cur.push(c),
            None if c == '"' || c == '\'' => {
                quote = Some(c);
                has = true;
            }
            None if c.is_whitespace() => {
                if has || !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                    has = false;
                }
            }
            None => cur.push(c),
        }
    }
    if has || !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn is_comment(line: &str) -> bool {
    line.starts_with('#') || line.starts_with(';')
}

/// Directive lines of an .ovpn, with inline blocks reported separately.
/// Yields `Line(tokens)` (possibly inside a `<connection>` block) and `Block(name)`.
enum OvpnItem {
    Line(Vec<String>),
    Block(String),
}

fn ovpn_items(text: &str) -> Vec<OvpnItem> {
    let mut items = Vec::new();
    let mut in_block: Option<String> = None;
    for raw in text.lines() {
        let line = raw.trim();
        if let Some(b) = &in_block {
            if line.eq_ignore_ascii_case(&format!("</{b}>")) {
                in_block = None;
            }
            continue;
        }
        if line.is_empty() || is_comment(line) {
            continue;
        }
        if let Some(tag) = line.strip_prefix('<').and_then(|l| l.strip_suffix('>')) {
            if tag.starts_with('/') {
                continue; // `</connection>`
            }
            let tag = tag.to_ascii_lowercase();
            if tag == "connection" {
                continue; // its directives are parsed like top-level ones
            }
            items.push(OvpnItem::Block(tag.clone()));
            in_block = Some(tag);
            continue;
        }
        let t = tokens(line);
        if !t.is_empty() {
            items.push(OvpnItem::Line(t));
        }
    }
    items
}

fn norm_proto(p: &str) -> String {
    let p = p.to_ascii_lowercase();
    p.strip_suffix("-client").map(str::to_string).unwrap_or(p)
}

pub fn parse_ovpn(text: &str) -> OvpnInfo {
    let mut info = OvpnInfo::default();
    let mut default_port: u16 = 1194;
    let mut default_proto = "udp".to_string();
    // (host, explicit port, explicit proto)
    let mut remotes: Vec<(String, Option<u16>, Option<String>)> = Vec::new();
    let mut scripts = false;
    for item in ovpn_items(text) {
        match item {
            OvpnItem::Block(name) => {
                if name == "key" || name == "pkcs12" {
                    info.has_inline_key = true;
                }
                if !info.inline_blocks.contains(&name) {
                    info.inline_blocks.push(name);
                }
            }
            OvpnItem::Line(t) => {
                let d = t[0].to_ascii_lowercase();
                match d.as_str() {
                    "remote" if t.len() >= 2 => {
                        remotes.push((t[1].clone(), t.get(2).and_then(|p| p.parse().ok()), t.get(3).map(|p| norm_proto(p))))
                    }
                    "proto" if t.len() >= 2 => default_proto = norm_proto(&t[1]),
                    "port" | "rport" if t.len() >= 2 => {
                        if let Ok(p) = t[1].parse() {
                            default_port = p;
                        }
                    }
                    "dev" if t.len() >= 2 => info.dev = Some(t[1].clone()),
                    "auth-user-pass" => {
                        info.needs_user_pass = true;
                        if let Some(f) = t.get(1) {
                            info.external_files.push(f.clone());
                        }
                    }
                    "up" | "down" | "route-up" | "route-pre-down" | "ipchange" | "client-connect" | "learn-address"
                    | "tls-verify" | "auth-user-pass-verify" => scripts = true,
                    _ if FILE_DIRECTIVES.contains(&d.as_str()) && t.len() >= 2 => {
                        if t[1] == "[inline]" {
                            continue;
                        }
                        info.external_files.push(t[1].clone());
                    }
                    _ => {}
                }
            }
        }
    }
    info.remotes = remotes
        .into_iter()
        .map(|(host, port, proto)| OvpnRemote {
            host,
            port: port.unwrap_or(default_port),
            proto: proto.unwrap_or_else(|| default_proto.clone()),
        })
        .collect();
    info.summary = match info.remotes.first() {
        Some(r) if info.remotes.len() > 1 => format!("{} {}:{} (+{})", r.proto, r.host, r.port, info.remotes.len() - 1),
        Some(r) => format!("{} {}:{}", r.proto, r.host, r.port),
        None => "openvpn (no remote)".into(),
    };
    if info.remotes.is_empty() {
        info.warnings.push("No `remote` directive found".into());
    }
    for f in &info.external_files {
        info.warnings.push(format!("References external file \"{f}\"; import the .ovpn file to embed it"));
    }
    if scripts {
        info.warnings.push("Config runs scripts (up/down/…); they execute with administrator rights".into());
    }
    info
}

/// Make an imported .ovpn self-contained: every file referenced by a directive
/// (`ca ca.crt`, `tls-auth ta.key 1`, …) is read relative to `base_dir` and embedded
/// as an inline block. `auth-user-pass <file>` is reduced to `auth-user-pass`; its
/// username/password (first two lines) are returned so they can go to the keychain.
/// Returns (new text, (user, password), warnings).
pub fn inline_ovpn_files(text: &str, base_dir: &Path) -> (String, Option<(String, Option<String>)>, Vec<String>) {
    let mut out = String::with_capacity(text.len());
    let mut appended = String::new();
    let mut creds = None;
    let mut warnings = Vec::new();
    let mut in_block: Option<String> = None;
    let resolve = |f: &str| -> PathBuf {
        let p = super::expand_home(f);
        if p.is_absolute() { p } else { base_dir.join(p) }
    };
    for raw in text.lines() {
        let line = raw.trim();
        if let Some(b) = &in_block {
            if line.eq_ignore_ascii_case(&format!("</{b}>")) {
                in_block = None;
            }
            out.push_str(raw);
            out.push('\n');
            continue;
        }
        if let Some(tag) = line.strip_prefix('<').and_then(|l| l.strip_suffix('>'))
            && !tag.starts_with('/')
            && !tag.eq_ignore_ascii_case("connection")
        {
            in_block = Some(tag.to_ascii_lowercase());
        }
        let t = if line.is_empty() || is_comment(line) || in_block.is_some() { vec![] } else { tokens(line) };
        let d = t.first().map(|s| s.to_ascii_lowercase()).unwrap_or_default();
        if d == "auth-user-pass" && t.len() >= 2 {
            let path = resolve(&t[1]);
            match std::fs::read_to_string(&path) {
                Ok(s) => {
                    let mut lines = s.lines();
                    let user = lines.next().unwrap_or("").trim().to_string();
                    let pass = lines.next().map(|p| p.trim().to_string()).filter(|p| !p.is_empty());
                    if !user.is_empty() {
                        creds = Some((user, pass));
                    }
                    warnings.push(format!("Credentials imported from \"{}\"", t[1]));
                }
                Err(e) => warnings.push(format!("Cannot read \"{}\": {e}; enter the credentials manually", t[1])),
            }
            out.push_str("auth-user-pass\n");
            continue;
        }
        if FILE_DIRECTIVES.contains(&d.as_str()) && t.len() >= 2 && t[1] != "[inline]" {
            let path = resolve(&t[1]);
            let content = if d == "pkcs12" {
                std::fs::read(&path).map(|b| {
                    use base64::Engine;
                    base64::engine::general_purpose::STANDARD.encode(b)
                })
            } else {
                std::fs::read_to_string(&path)
            };
            match content {
                Ok(c) => {
                    appended.push_str(&format!("<{d}>\n{}\n</{d}>\n", c.trim_end()));
                    // `tls-auth ta.key 1` / `secret s.key 0`: direction moves to key-direction.
                    if (d == "tls-auth" || d == "secret") && t.len() >= 3 {
                        out.push_str(&format!("key-direction {}\n", t[2]));
                    }
                    continue;
                }
                Err(e) => warnings.push(format!("Cannot read \"{}\" ({}): {e}", t[1], path.display())),
            }
        }
        out.push_str(raw);
        out.push('\n');
    }
    if !appended.is_empty() {
        out.push_str(&appended);
    }
    (out, creds, warnings)
}

// ---------------------------------------------------------------- WireGuard

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WgInterface {
    pub has_private_key: bool,
    pub address: Vec<String>,
    pub dns: Vec<String>,
    pub mtu: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WgPeer {
    pub public_key: Option<String>,
    pub endpoint: Option<String>,
    pub allowed_ips: Vec<String>,
    pub persistent_keepalive: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WgInfo {
    pub summary: String,
    pub interface: WgInterface,
    pub peers: Vec<WgPeer>,
    pub warnings: Vec<String>,
}

fn list(v: &str) -> Vec<String> {
    v.split(',').map(str::trim).filter(|s| !s.is_empty()).map(str::to_string).collect()
}

/// Parse a WireGuard config. The private key is never part of the result.
pub fn parse_wireguard(text: &str) -> WgInfo {
    #[derive(PartialEq)]
    enum Sec {
        None,
        Iface,
        Peer,
        Other,
    }
    let mut info = WgInfo::default();
    let mut sec = Sec::None;
    let mut saw_iface = false;
    for raw in text.lines() {
        let line = raw.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            let name = line[1..line.len() - 1].trim().to_ascii_lowercase();
            sec = match name.as_str() {
                "interface" => {
                    saw_iface = true;
                    Sec::Iface
                }
                "peer" => {
                    info.peers.push(WgPeer::default());
                    Sec::Peer
                }
                _ => Sec::Other,
            };
            continue;
        }
        let Some((k, v)) = line.split_once('=') else { continue };
        let (k, v) = (k.trim().to_ascii_lowercase(), v.trim());
        match sec {
            Sec::Iface => match k.as_str() {
                "privatekey" => info.interface.has_private_key = !v.is_empty(),
                "address" => info.interface.address.extend(list(v)),
                "dns" => info.interface.dns.extend(list(v)),
                "mtu" => info.interface.mtu = v.parse().ok(),
                _ => {}
            },
            Sec::Peer => {
                let p = info.peers.last_mut().expect("peer section");
                match k.as_str() {
                    "publickey" => p.public_key = Some(v.to_string()),
                    "endpoint" => p.endpoint = Some(v.to_string()),
                    "allowedips" => p.allowed_ips.extend(list(v)),
                    "persistentkeepalive" => p.persistent_keepalive = v.parse().ok(),
                    _ => {}
                }
            }
            _ => {}
        }
    }
    if !saw_iface {
        info.warnings.push("No [Interface] section".into());
    } else if !info.interface.has_private_key {
        info.warnings.push("[Interface] has no PrivateKey".into());
    }
    if info.peers.is_empty() {
        info.warnings.push("No [Peer] section".into());
    }
    for (i, p) in info.peers.iter().enumerate() {
        if p.public_key.is_none() {
            info.warnings.push(format!("Peer {} has no PublicKey", i + 1));
        }
    }
    info.summary = match info.peers.iter().find_map(|p| p.endpoint.clone()) {
        Some(ep) => format!("wg peer {ep}"),
        None => match info.interface.address.first() {
            Some(a) => format!("wg {a}"),
            None => "wireguard".into(),
        },
    };
    info
}

/// Rewrite a WireGuard config without `DNS =` lines (used when the "dns" option is off).
pub fn wireguard_strip_dns(text: &str) -> String {
    text.lines()
        .filter(|l| !l.split('=').next().unwrap_or("").trim().eq_ignore_ascii_case("dns") || !l.contains('='))
        .map(|l| format!("{l}\n"))
        .collect()
}

// ---------------------------------------------------------------- detection

pub fn detect_kind(path: &Path, text: &str) -> Option<NetKind> {
    let ext = path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    let has_iface = text.lines().any(|l| l.trim().eq_ignore_ascii_case("[interface]"));
    if has_iface {
        return Some(NetKind::Wireguard);
    }
    if ext == "ovpn" {
        return Some(NetKind::Openvpn);
    }
    let looks_ovpn = text.lines().map(str::trim).any(|l| {
        let d = l.split_whitespace().next().unwrap_or("").to_ascii_lowercase();
        matches!(d.as_str(), "remote" | "client" | "dev" | "proto" | "<ca>")
    });
    looks_ovpn.then_some(NetKind::Openvpn)
}

// ---------------------------------------------------------------- ssh_config

/// `ssh_config` pattern matching: `*`, `?` and `!negation` in a pattern list.
fn host_matches(patterns: &[String], alias: &str) -> bool {
    let mut matched = false;
    for p in patterns {
        if let Some(neg) = p.strip_prefix('!') {
            if glob(neg, alias) {
                return false;
            }
        } else if glob(p, alias) {
            matched = true;
        }
    }
    matched
}

fn glob(pat: &str, s: &str) -> bool {
    fn rec(p: &[char], s: &[char]) -> bool {
        match p.first() {
            None => s.is_empty(),
            Some('*') => (0..=s.len()).any(|i| rec(&p[1..], &s[i..])),
            Some('?') => !s.is_empty() && rec(&p[1..], &s[1..]),
            Some(c) => s.first().is_some_and(|x| x.eq_ignore_ascii_case(c)) && rec(&p[1..], &s[1..]),
        }
    }
    let p: Vec<char> = pat.chars().collect();
    let s: Vec<char> = s.chars().collect();
    rec(&p, &s)
}

struct SshBlock {
    /// `None` = global (before any Host) or a Match block (ignored).
    patterns: Option<Vec<String>>,
    is_match: bool,
    opts: Vec<(String, String)>,
}

fn ssh_lines(path: &Path, depth: usize, out: &mut Vec<(String, Vec<String>)>) {
    let Ok(text) = std::fs::read_to_string(path) else { return };
    let base = dirs::home_dir().map(|h| h.join(".ssh")).unwrap_or_else(|| path.parent().unwrap_or(Path::new(".")).into());
    ssh_text_lines(&text, &base, depth, out);
}

fn ssh_text_lines(text: &str, base: &Path, depth: usize, out: &mut Vec<(String, Vec<String>)>) {
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        // `Key value`, `Key=value` or `Key = value`
        let (k, rest) = match line.find(|c: char| c.is_whitespace() || c == '=') {
            Some(i) => (&line[..i], line[i..].trim_start_matches(|c: char| c.is_whitespace() || c == '=')),
            None => (line, ""),
        };
        let k = k.to_ascii_lowercase();
        let args = tokens(rest);
        if k == "include" {
            if depth >= 5 {
                continue;
            }
            for a in &args {
                for p in expand_include(a, base) {
                    ssh_lines(&p, depth + 1, out);
                }
            }
            continue;
        }
        out.push((k, args));
    }
}

/// Resolve an Include argument (relative to ~/.ssh) with `*`/`?` globs in the file name.
fn expand_include(arg: &str, base: &Path) -> Vec<PathBuf> {
    let p = super::expand_home(arg);
    let p = if p.is_absolute() { p } else { base.join(p) };
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    if !name.contains(['*', '?']) {
        return vec![p];
    }
    let Some(dir) = p.parent() else { return vec![] };
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .map(|e| e.path())
                .filter(|f| f.is_file() && glob(&name, &f.file_name().unwrap_or_default().to_string_lossy()))
                .collect()
        })
        .unwrap_or_default();
    files.sort();
    files
}

/// Parse ssh_config text into concrete hosts (no wildcard aliases). Options follow
/// ssh semantics: for each alias, the first value obtained from matching blocks wins.
pub fn parse_ssh_config(text: &str, base: &Path) -> Vec<SshConfigHost> {
    let mut lines = Vec::new();
    ssh_text_lines(text, base, 0, &mut lines);
    let mut blocks = vec![SshBlock { patterns: None, is_match: false, opts: vec![] }];
    let mut aliases: Vec<String> = Vec::new();
    for (k, args) in lines {
        match k.as_str() {
            "host" => {
                for a in &args {
                    if !a.contains(['*', '?', '!']) && !aliases.contains(a) {
                        aliases.push(a.clone());
                    }
                }
                blocks.push(SshBlock { patterns: Some(args), is_match: false, opts: vec![] });
            }
            "match" => blocks.push(SshBlock { patterns: None, is_match: true, opts: vec![] }),
            _ => {
                if let Some(v) = args.first() {
                    blocks.last_mut().unwrap().opts.push((k, v.clone()));
                }
            }
        }
    }
    aliases
        .into_iter()
        .map(|alias| {
            let get = |key: &str| -> Option<String> {
                blocks
                    .iter()
                    .filter(|b| !b.is_match && b.patterns.as_ref().is_none_or(|p| host_matches(p, &alias)))
                    .flat_map(|b| b.opts.iter())
                    .find(|(k, _)| k == key)
                    .map(|(_, v)| v.clone())
            };
            let host = get("hostname").map(|h| h.replace("%h", &alias)).unwrap_or_else(|| alias.clone());
            SshConfigHost {
                port: get("port").and_then(|p| p.parse().ok()).unwrap_or(22),
                user: get("user"),
                identity_file: get("identityfile").map(|f| super::expand_home(&f).to_string_lossy().to_string()),
                host,
                alias,
            }
        })
        .collect()
}

pub fn read_ssh_config() -> Vec<SshConfigHost> {
    let Some(home) = dirs::home_dir() else { return vec![] };
    let base = home.join(".ssh");
    match std::fs::read_to_string(base.join("config")) {
        Ok(text) => parse_ssh_config(&text, &base),
        Err(_) => vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("devcat-net-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    const OVPN: &str = r#"
client
dev tun
proto tcp-client
remote vpn.example.com 443
remote backup.example.com 1195 udp
; remote commented.example.com
# remote commented2.example.com
auth-user-pass
<ca>
-----BEGIN CERTIFICATE-----
remote not-a-remote.example.com
-----END CERTIFICATE-----
</ca>
<key>
secret
</key>
"#;

    #[test]
    fn ovpn_basic() {
        let i = parse_ovpn(OVPN);
        assert_eq!(
            i.remotes,
            vec![
                OvpnRemote { host: "vpn.example.com".into(), port: 443, proto: "tcp".into() },
                OvpnRemote { host: "backup.example.com".into(), port: 1195, proto: "udp".into() },
            ]
        );
        assert_eq!(i.summary, "tcp vpn.example.com:443 (+1)");
        assert_eq!(i.dev.as_deref(), Some("tun"));
        assert!(i.needs_user_pass);
        assert!(i.has_inline_key);
        assert_eq!(i.inline_blocks, vec!["ca", "key"]);
        assert!(i.external_files.is_empty());
        assert!(i.warnings.is_empty(), "{:?}", i.warnings);
    }

    #[test]
    fn ovpn_defaults_and_external() {
        let i = parse_ovpn("remote vpn.example.com\nport 1300\nca \"my ca.crt\"\ncert c.crt\ntls-auth [inline] 1\nup /etc/up.sh\n");
        assert_eq!(i.summary, "udp vpn.example.com:1300");
        assert!(!i.needs_user_pass && !i.has_inline_key);
        assert_eq!(i.external_files, vec!["my ca.crt", "c.crt"]);
        assert!(i.warnings.iter().any(|w| w.contains("my ca.crt")));
        assert!(i.warnings.iter().any(|w| w.contains("scripts")));
        let i = parse_ovpn("client\n");
        assert_eq!(i.summary, "openvpn (no remote)");
        assert!(i.warnings.iter().any(|w| w.contains("remote")));
    }

    #[test]
    fn ovpn_connection_blocks() {
        let i = parse_ovpn("<connection>\nremote a.example 1194 udp\n</connection>\n<connection>\nremote b.example 443 tcp\n</connection>\n");
        assert_eq!(i.remotes.len(), 2);
        assert_eq!(i.remotes[1], OvpnRemote { host: "b.example".into(), port: 443, proto: "tcp".into() });
        assert!(i.inline_blocks.is_empty());
    }

    #[test]
    fn ovpn_inline_external_files() {
        let d = tmp_dir();
        std::fs::write(d.join("ca.crt"), "CA-DATA\n").unwrap();
        std::fs::create_dir_all(d.join("keys")).unwrap();
        std::fs::write(d.join("keys/client.key"), "KEY-DATA").unwrap();
        std::fs::write(d.join("ta.key"), "TA-DATA\n").unwrap();
        std::fs::write(d.join("creds.txt"), "alice\ns3cret\n").unwrap();
        let src = "client\nremote vpn.example.com 1194\nca ca.crt\nkey \"keys/client.key\"\ntls-auth ta.key 1\nauth-user-pass creds.txt\ncert missing.crt\n";
        let (out, creds, warnings) = inline_ovpn_files(src, &d);
        assert!(out.contains("<ca>\nCA-DATA\n</ca>"), "{out}");
        assert!(out.contains("<key>\nKEY-DATA\n</key>"));
        assert!(out.contains("<tls-auth>\nTA-DATA\n</tls-auth>"));
        assert!(out.contains("key-direction 1\n"));
        assert!(out.contains("\nauth-user-pass\n"));
        assert!(!out.contains("creds.txt"));
        assert!(out.contains("cert missing.crt"), "unreadable reference is kept");
        assert_eq!(creds, Some(("alice".into(), Some("s3cret".into()))));
        assert!(warnings.iter().any(|w| w.contains("missing.crt")));
        let i = parse_ovpn(&out);
        assert!(i.has_inline_key);
        assert_eq!(i.external_files, vec!["missing.crt"]);
        assert!(i.inline_blocks.contains(&"tls-auth".to_string()));
        // Inline blocks in the source are left untouched.
        let (out2, _, _) = inline_ovpn_files(OVPN, &d);
        assert_eq!(out2.trim(), OVPN.trim());
        std::fs::remove_dir_all(d).unwrap();
    }

    const WG: &str = "[Interface]\nPrivateKey = cHJpdmF0ZQ==\nAddress = 10.0.0.2/32, fd00::2/128\nDNS = 1.1.1.1\nMTU = 1420\n\n[Peer]\nPublicKey = cHVibGlj\nEndpoint = vpn.example.com:51820\nAllowedIPs = 0.0.0.0/0, ::/0\nPersistentKeepalive = 25\n";

    #[test]
    fn wireguard() {
        let i = parse_wireguard(WG);
        assert_eq!(i.summary, "wg peer vpn.example.com:51820");
        assert!(i.interface.has_private_key);
        assert_eq!(i.interface.address, vec!["10.0.0.2/32", "fd00::2/128"]);
        assert_eq!(i.interface.dns, vec!["1.1.1.1"]);
        assert_eq!(i.interface.mtu, Some(1420));
        assert_eq!(i.peers.len(), 1);
        assert_eq!(i.peers[0].allowed_ips, vec!["0.0.0.0/0", "::/0"]);
        assert_eq!(i.peers[0].persistent_keepalive, Some(25));
        assert!(i.warnings.is_empty());
        let json = serde_json::to_string(&i).unwrap();
        assert!(!json.contains("cHJpdmF0ZQ"), "private key leaked: {json}");
        assert!(json.contains("\"allowedIps\""));

        let i = parse_wireguard("[Interface]\nAddress = 10.1.0.2/24\n");
        assert_eq!(i.summary, "wg 10.1.0.2/24");
        assert!(i.warnings.iter().any(|w| w.contains("PrivateKey")));
        assert!(i.warnings.iter().any(|w| w.contains("[Peer]")));
    }

    #[test]
    fn wireguard_dns_strip() {
        let s = wireguard_strip_dns(WG);
        assert!(!s.contains("DNS"));
        assert!(s.contains("Address = 10.0.0.2/32"));
    }

    #[test]
    fn detect() {
        assert_eq!(detect_kind(Path::new("a.conf"), WG), Some(NetKind::Wireguard));
        assert_eq!(detect_kind(Path::new("a.ovpn"), "whatever"), Some(NetKind::Openvpn));
        assert_eq!(detect_kind(Path::new("client.conf"), OVPN), Some(NetKind::Openvpn));
        assert_eq!(detect_kind(Path::new("x.txt"), "hello"), None);
    }

    #[test]
    fn tokenizer() {
        assert_eq!(tokens(r#"ca "a b.crt"  x"#), vec!["ca", "a b.crt", "x"]);
        assert_eq!(tokens(r#"key 'c d' "e\"f""#), vec!["key", "c d", "e\"f"]);
    }

    #[test]
    fn ssh_config() {
        let d = tmp_dir();
        std::fs::create_dir_all(d.join("conf.d")).unwrap();
        std::fs::write(d.join("conf.d/a.conf"), "Host included\n  HostName inc.example.com\n").unwrap();
        let text = format!(
            "Include {}/conf.d/*.conf\n\nHost bastion jump\n  HostName bastion.example.com\n  Port 2222\n  User ops\n  IdentityFile ~/.ssh/id_ops\n\nHost db-*\n  User dbadmin\n\nHost db-prod\n  HostName=10.0.0.5\n\nHost plain\n\nMatch host foo\n  User nobody\n\nHost *\n  User fallback\n  Port 22\n",
            d.display()
        );
        let hosts = parse_ssh_config(&text, &d);
        let names: Vec<_> = hosts.iter().map(|h| h.alias.as_str()).collect();
        assert_eq!(names, vec!["included", "bastion", "jump", "db-prod", "plain"]);
        let b = &hosts[1];
        assert_eq!((b.host.as_str(), b.port, b.user.as_deref()), ("bastion.example.com", 2222, Some("ops")));
        let idf = b.identity_file.as_deref().unwrap();
        assert!(idf.ends_with(".ssh/id_ops") && !idf.starts_with('~'), "{idf}");
        assert_eq!(hosts[2].host, "bastion.example.com");
        let db = &hosts[3];
        assert_eq!((db.host.as_str(), db.user.as_deref()), ("10.0.0.5", Some("dbadmin")));
        let p = &hosts[4];
        assert_eq!((p.host.as_str(), p.port, p.user.as_deref()), ("plain", 22, Some("fallback")));
        assert_eq!(hosts[0].host, "inc.example.com");
        std::fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn glob_and_negation() {
        assert!(glob("db-*", "db-prod"));
        assert!(glob("h?st", "host"));
        assert!(!glob("db-*", "web"));
        let pats = vec!["*.example.com".to_string(), "!secret.example.com".to_string()];
        assert!(host_matches(&pats, "a.example.com"));
        assert!(!host_matches(&pats, "secret.example.com"));
    }
}
