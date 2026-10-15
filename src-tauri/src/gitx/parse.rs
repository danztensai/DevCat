//! Pure parsers for git plumbing output (log records, blame porcelain, for-each-ref, diff-tree).
use super::*;

/// `git log --format` for [`parse_log`]: fields split by US (0x1f), records terminated by RS (0x1e).
pub(super) const LOG_FORMAT: &str = "--format=%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%D%x1e";

/// `git show -s` format for [`parse_detail`]: the log fields + committer + raw body (last, may contain anything).
pub(super) const DETAIL_FORMAT: &str = "--format=%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%D%x1f%cn%x1f%ce%x1f%ct%x1f%b";

/// `git for-each-ref` format for [`parse_ref_line`].
pub(super) const REF_FORMAT: &str = "--format=%(refname)%1f%(objectname)%1f%(*objectname)%1f%(objecttype)%1f%(HEAD)%1f%(upstream:short)%1f%(upstream:track,nobracket)%1f%(creatordate:unix)%1f%(contents:subject)";

/// `git stash list` format for [`parse_stash`].
pub(super) const STASH_FORMAT: &str = "--format=%gd%x1f%H%x1f%gs%x1f%ct";

/// Splits one `%D` (with `--decorate=full`) into labels.
pub(super) fn parse_decorations(d: &str) -> Vec<GitRefLabel> {
    let label = |name: &str, kind: &str| GitRefLabel { name: name.to_string(), kind: kind.to_string() };
    let mut out = Vec::new();
    for item in d.split(", ").map(str::trim).filter(|s| !s.is_empty()) {
        if let Some(target) = item.strip_prefix("HEAD -> ") {
            let name = target.strip_prefix("refs/heads/").unwrap_or(target);
            out.push(label(name, "head"));
        } else if item == "HEAD" {
            out.push(label("HEAD", "detached"));
        } else if let Some(tag) = item.strip_prefix("tag: ") {
            out.push(label(tag.strip_prefix("refs/tags/").unwrap_or(tag), "tag"));
        } else if let Some(b) = item.strip_prefix("refs/heads/") {
            out.push(label(b, "branch"));
        } else if let Some(r) = item.strip_prefix("refs/remotes/") {
            if r.ends_with("/HEAD") {
                continue;
            }
            out.push(label(r, "remote"));
        } else if item == "refs/stash" {
            out.push(label("stash", "stash"));
        } else if !item.starts_with("refs/") {
            // short decorations (no --decorate=full): best effort
            out.push(label(item, "branch"));
        }
    }
    out
}

fn commit_from_fields(f: &[&str]) -> Option<GitCommit> {
    if f.len() < 8 || f[0].is_empty() {
        return None;
    }
    Some(GitCommit {
        sha: f[0].to_string(),
        short: f[1].to_string(),
        parents: f[2].split_whitespace().map(String::from).collect(),
        author: f[3].to_string(),
        email: f[4].to_string(),
        time: f[5].trim().parse().unwrap_or(0),
        subject: f[6].to_string(),
        refs: parse_decorations(f[7]),
    })
}

/// Parses `git log` output produced with [`LOG_FORMAT`].
pub(super) fn parse_log(out: &str) -> Vec<GitCommit> {
    out.split('\x1e')
        .filter_map(|rec| {
            let rec = rec.trim_start_matches(['\n', '\r']);
            let fields: Vec<&str> = rec.split('\x1f').collect();
            commit_from_fields(&fields)
        })
        .collect()
}

/// Parses `git show -s` output produced with [`DETAIL_FORMAT`] (files are filled in later).
pub(super) fn parse_detail(out: &str) -> Option<GitCommitDetail> {
    let f: Vec<&str> = out.splitn(12, '\x1f').collect();
    if f.len() < 12 {
        return None;
    }
    let commit = commit_from_fields(&f[..8])?;
    Some(GitCommitDetail {
        commit,
        committer: f[8].to_string(),
        committer_email: f[9].to_string(),
        commit_time: f[10].trim().parse().unwrap_or(0),
        body: f[11].trim_end().to_string(),
        files: vec![],
    })
}

/// "ahead 1, behind 2" / "ahead 3" / "gone" / "" → (ahead, behind, gone).
pub(super) fn parse_track(s: &str) -> (u32, u32, bool) {
    let (mut ahead, mut behind, mut gone) = (0, 0, false);
    for part in s.split(',').map(str::trim) {
        if let Some(n) = part.strip_prefix("ahead ") {
            ahead = n.trim().parse().unwrap_or(0);
        } else if let Some(n) = part.strip_prefix("behind ") {
            behind = n.trim().parse().unwrap_or(0);
        } else if part == "gone" {
            gone = true;
        }
    }
    (ahead, behind, gone)
}

/// One `git for-each-ref` line (see [`REF_FORMAT`]).
pub(super) enum RefLine {
    Local(GitBranch),
    Remote(GitBranch),
    Tag(GitTag),
}

pub(super) fn parse_ref_line(line: &str) -> Option<RefLine> {
    let f: Vec<&str> = line.splitn(9, '\x1f').collect();
    if f.len() < 9 {
        return None;
    }
    let (refname, oid, peeled, otype, head, upstream, track, time, subject) =
        (f[0], f[1], f[2], f[3], f[4], f[5], f[6], f[7], f[8]);
    let time = time.trim().parse().unwrap_or(0);
    let branch = |name: &str| {
        let (ahead, behind, _) = parse_track(track);
        GitBranch {
            name: name.to_string(),
            full_ref: refname.to_string(),
            sha: oid.to_string(),
            current: head == "*",
            upstream: Some(upstream).filter(|u| !u.is_empty()).map(String::from),
            ahead,
            behind,
            subject: subject.to_string(),
            time,
        }
    };
    if let Some(name) = refname.strip_prefix("refs/heads/") {
        Some(RefLine::Local(branch(name)))
    } else if let Some(name) = refname.strip_prefix("refs/remotes/") {
        if name.ends_with("/HEAD") || !name.contains('/') {
            return None;
        }
        Some(RefLine::Remote(branch(name)))
    } else if let Some(name) = refname.strip_prefix("refs/tags/") {
        let annotated = otype == "tag";
        Some(RefLine::Tag(GitTag {
            name: name.to_string(),
            sha: if annotated && !peeled.is_empty() { peeled.to_string() } else { oid.to_string() },
            annotated,
            subject: subject.to_string(),
            time,
        }))
    } else {
        None
    }
}

/// Parses `git stash list` output produced with [`STASH_FORMAT`].
pub(super) fn parse_stash(out: &str) -> Vec<GitStash> {
    out.lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.splitn(4, '\x1f').collect();
            if f.len() < 4 {
                return None;
            }
            let index = f[0].strip_prefix("stash@{")?.strip_suffix('}')?.parse().ok()?;
            Some(GitStash {
                index,
                name: f[0].to_string(),
                sha: f[1].to_string(),
                message: f[2].to_string(),
                time: f[3].trim().parse().unwrap_or(0),
            })
        })
        .collect()
}

/// Parses `git diff-tree --name-status -z` (renames/copies carry old + new path).
pub(super) fn parse_name_status_z(out: &[u8]) -> Vec<GitCommitFile> {
    let text = String::from_utf8_lossy(out);
    let mut it = text.split('\0').filter(|s| !s.is_empty());
    let mut files = Vec::new();
    while let Some(st) = it.next() {
        let letter = st.chars().next().unwrap_or('M');
        let (old_path, path) = if matches!(letter, 'R' | 'C') {
            let (Some(old), Some(new)) = (it.next(), it.next()) else { break };
            (Some(old.to_string()), new.to_string())
        } else {
            let Some(p) = it.next() else { break };
            (None, p.to_string())
        };
        files.push(GitCommitFile { path, old_path, status: letter.to_string(), additions: None, deletions: None, binary: false });
    }
    files
}

/// Parses `git diff-tree --numstat -z` into (path, additions, deletions); binary files have None counts.
pub(super) fn parse_numstat_z(out: &[u8]) -> Vec<(String, Option<u32>, Option<u32>)> {
    let text = String::from_utf8_lossy(out);
    let mut it = text.split('\0');
    let mut rows = Vec::new();
    while let Some(rec) = it.next() {
        if rec.is_empty() {
            continue;
        }
        let mut parts = rec.splitn(3, '\t');
        let (Some(a), Some(d), Some(p)) = (parts.next(), parts.next(), parts.next()) else { continue };
        let path = if p.is_empty() {
            // rename/copy: "<a>\t<d>\t\0<old>\0<new>\0"
            let _old = it.next();
            match it.next() {
                Some(new) => new.to_string(),
                None => break,
            }
        } else {
            p.to_string()
        };
        rows.push((path, a.parse().ok(), d.parse().ok()));
    }
    rows
}

/// Fills additions/deletions/binary from numstat rows (matched by new path).
pub(super) fn merge_numstat(files: &mut [GitCommitFile], rows: &[(String, Option<u32>, Option<u32>)]) {
    let by_path: HashMap<&str, (Option<u32>, Option<u32>)> = rows.iter().map(|(p, a, d)| (p.as_str(), (*a, *d))).collect();
    for f in files.iter_mut() {
        if let Some((a, d)) = by_path.get(f.path.as_str()) {
            f.additions = *a;
            f.deletions = *d;
            f.binary = a.is_none() && d.is_none();
        }
    }
}

fn is_sha(s: &str) -> bool {
    (s.len() == 40 || s.len() == 64) && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Parses `git blame --porcelain` into a [`GitBlame`] (content rebuilt from the TAB-prefixed lines).
pub(super) fn parse_blame(out: &str) -> GitBlame {
    let mut lines = Vec::new();
    let mut content: Vec<&str> = Vec::new();
    let mut commits: HashMap<String, BlameCommit> = HashMap::new();
    let mut current: Option<String> = None;
    for raw in out.split('\n') {
        if let Some(text) = raw.strip_prefix('\t') {
            content.push(text);
            continue;
        }
        let mut words = raw.splitn(2, ' ');
        let key = words.next().unwrap_or("");
        let value = words.next().unwrap_or("");
        if is_sha(key) {
            let mut nums = value.split(' ');
            let orig_line = nums.next().and_then(|n| n.parse().ok()).unwrap_or(0);
            let line = nums.next().and_then(|n| n.parse().ok()).unwrap_or(0);
            let uncommitted = key.bytes().all(|b| b == b'0');
            commits.entry(key.to_string()).or_insert_with(|| BlameCommit {
                sha: key.to_string(),
                author: String::new(),
                email: String::new(),
                time: 0,
                summary: String::new(),
                filename: String::new(),
                uncommitted,
            });
            lines.push(BlameLine { line, sha: key.to_string(), orig_line });
            current = Some(key.to_string());
            continue;
        }
        let Some(c) = current.as_ref().and_then(|sha| commits.get_mut(sha)) else { continue };
        match key {
            "author" => c.author = value.to_string(),
            "author-mail" => c.email = value.trim_start_matches('<').trim_end_matches('>').to_string(),
            "author-time" => c.time = value.trim().parse().unwrap_or(0),
            "summary" => c.summary = value.to_string(),
            "filename" if c.filename.is_empty() => c.filename = value.to_string(),
            _ => {}
        }
    }
    for c in commits.values_mut().filter(|c| c.uncommitted) {
        c.author = "You".into();
        c.email = String::new();
        c.summary = "Not committed yet".into();
    }
    let mut text = content.join("\n");
    if !content.is_empty() {
        text.push('\n');
    }
    GitBlame { content: text, lines, commits }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ZERO_SHA: &str = "0000000000000000000000000000000000000000";

    #[test]
    fn decorations() {
        let refs = parse_decorations(
            "HEAD -> refs/heads/main, tag: refs/tags/v2, refs/remotes/origin/main, refs/remotes/origin/HEAD, refs/heads/feat/x, refs/stash",
        );
        let pairs: Vec<(&str, &str)> = refs.iter().map(|r| (r.name.as_str(), r.kind.as_str())).collect();
        assert_eq!(
            pairs,
            vec![("main", "head"), ("v2", "tag"), ("origin/main", "remote"), ("feat/x", "branch"), ("stash", "stash")]
        );
        let detached = parse_decorations("HEAD, refs/heads/dev");
        assert_eq!(detached[0], GitRefLabel { name: "HEAD".into(), kind: "detached".into() });
        assert_eq!(detached[1].kind, "branch");
        assert!(parse_decorations("").is_empty());
    }

    #[test]
    fn log_records() {
        let out = "aaaa\x1fa1\x1f\x1fAnn\x1fann@x.io\x1f100\x1finit, with comma\x1f\x1e\n\
bbbb\x1fb1\x1faaaa cccc\x1fBob\x1fbob@x.io\x1f200\x1fMerge\x1fHEAD -> refs/heads/main, tag: refs/tags/v1\x1e\n";
        let commits = parse_log(out);
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].sha, "aaaa");
        assert!(commits[0].parents.is_empty());
        assert_eq!(commits[0].subject, "init, with comma");
        assert!(commits[0].refs.is_empty());
        assert_eq!(commits[1].parents, vec!["aaaa", "cccc"]);
        assert_eq!(commits[1].time, 200);
        assert_eq!(commits[1].refs.len(), 2);
        assert_eq!(commits[1].refs[1].kind, "tag");
    }

    #[test]
    fn detail_record() {
        let out = "aaaa\x1fa1\x1fpppp\x1fAnn\x1fann@x.io\x1f100\x1fsubj\x1f\x1fCee\x1fc@x.io\x1f101\x1fline one\x1fstill body\n\n";
        let d = parse_detail(out).unwrap();
        assert_eq!(d.commit.parents, vec!["pppp"]);
        assert_eq!(d.committer, "Cee");
        assert_eq!(d.commit_time, 101);
        assert_eq!(d.body, "line one\x1fstill body");
    }

    #[test]
    fn track() {
        assert_eq!(parse_track("ahead 1, behind 2"), (1, 2, false));
        assert_eq!(parse_track("behind 7"), (0, 7, false));
        assert_eq!(parse_track("gone"), (0, 0, true));
        assert_eq!(parse_track(""), (0, 0, false));
    }

    #[test]
    fn ref_lines() {
        let local = "refs/heads/main\x1fs1\x1f\x1fcommit\x1f*\x1forigin/main\x1fahead 2\x1f50\x1fsubject: x";
        let Some(RefLine::Local(b)) = parse_ref_line(local) else { panic!() };
        assert_eq!((b.name.as_str(), b.current, b.ahead, b.behind, b.time), ("main", true, 2, 0, 50));
        assert_eq!(b.upstream.as_deref(), Some("origin/main"));
        assert_eq!(b.subject, "subject: x");
        assert!(parse_ref_line("refs/remotes/origin/HEAD\x1fs1\x1f\x1fcommit\x1f \x1f\x1f\x1f1\x1fx").is_none());
        let Some(RefLine::Remote(r)) = parse_ref_line("refs/remotes/origin/feat/a\x1fs2\x1f\x1fcommit\x1f \x1f\x1f\x1f1\x1fx") else {
            panic!()
        };
        assert_eq!((r.name.as_str(), r.current, r.upstream.clone()), ("origin/feat/a", false, None));
        let Some(RefLine::Tag(t)) = parse_ref_line("refs/tags/v2\x1ftagobj\x1fcommitsha\x1ftag\x1f \x1f\x1f\x1f9\x1fmsg") else { panic!() };
        assert_eq!((t.sha.as_str(), t.annotated), ("commitsha", true));
        let Some(RefLine::Tag(t)) = parse_ref_line("refs/tags/v1\x1fcsha\x1f\x1fcommit\x1f \x1f\x1f\x1f9\x1fmsg") else { panic!() };
        assert_eq!((t.sha.as_str(), t.annotated), ("csha", false));
    }

    #[test]
    fn stash_lines() {
        let s = parse_stash("stash@{0}\x1fabc\x1fOn main: wip\x1f10\nstash@{12}\x1fdef\x1fWIP on dev: x\x1f5\n");
        assert_eq!(s.len(), 2);
        assert_eq!((s[1].index, s[1].name.as_str(), s[1].message.as_str()), (12, "stash@{12}", "WIP on dev: x"));
    }

    #[test]
    fn name_status_and_numstat() {
        let ns = b"M\0src/a.rs\0R087\0old name.txt\0new name.txt\0A\0img.png\0D\0gone.txt\0";
        let mut files = parse_name_status_z(ns);
        assert_eq!(files.len(), 4);
        assert_eq!(files[1].status, "R");
        assert_eq!(files[1].old_path.as_deref(), Some("old name.txt"));
        assert_eq!(files[1].path, "new name.txt");
        let num = b"3\t1\tsrc/a.rs\x002\t2\t\0old name.txt\0new name.txt\0-\t-\timg.png\x000\t4\tgone.txt\0";
        let rows = parse_numstat_z(num);
        assert_eq!(rows.len(), 4);
        merge_numstat(&mut files, &rows);
        assert_eq!((files[0].additions, files[0].deletions, files[0].binary), (Some(3), Some(1), false));
        assert_eq!((files[1].additions, files[1].deletions), (Some(2), Some(2)));
        assert!(files[2].binary);
        assert_eq!(files[2].additions, None);
        assert_eq!(files[3].deletions, Some(4));
    }

    #[test]
    fn blame_porcelain() {
        let a = "a".repeat(40);
        let b = "b".repeat(40);
        let out = format!(
            "{a} 1 1 2\nauthor Ann\nauthor-mail <ann@x.io>\nauthor-time 100\nauthor-tz +0000\ncommitter Ann\ncommitter-mail <ann@x.io>\ncommitter-time 100\ncommitter-tz +0000\nsummary first\nboundary\nfilename old.txt\n\tline one\n\
{a} 2 2\n\tline two\n\
{b} 1 3 1\nauthor Bob\nauthor-mail <bob@x.io>\nauthor-time 200\nsummary second\nprevious {a} old.txt\nfilename new.txt\n\t\tindented\n\
{ZERO_SHA} 4 4 1\nauthor Not Committed Yet\nauthor-mail <not.committed.yet>\nauthor-time 300\nsummary Version of new.txt from new.txt\nfilename new.txt\n\tdirty\n"
        );
        let blame = parse_blame(&out);
        assert_eq!(blame.content, "line one\nline two\n\tindented\ndirty\n");
        assert_eq!(blame.lines.len(), 4);
        assert_eq!(blame.lines[1], BlameLine { line: 2, sha: a.clone(), orig_line: 2 });
        assert_eq!(blame.lines[2], BlameLine { line: 3, sha: b.clone(), orig_line: 1 });
        let ca = &blame.commits[&a];
        assert_eq!((ca.author.as_str(), ca.email.as_str(), ca.time, ca.summary.as_str()), ("Ann", "ann@x.io", 100, "first"));
        assert_eq!(ca.filename, "old.txt");
        assert!(!ca.uncommitted);
        assert_eq!(blame.commits[&b].filename, "new.txt");
        let z = &blame.commits[ZERO_SHA];
        assert!(z.uncommitted);
        assert_eq!(z.author, "You");
        assert_eq!(blame.commits.len(), 3);
        assert!(parse_blame("").lines.is_empty());
    }
}
