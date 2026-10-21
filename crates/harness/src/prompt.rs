//! The system prompt, assembled from ordered sections: who the agent is, how to work, the
//! environment, and the project's own instructions (`AGENTS.md`, `CLAUDE.md`).
use std::path::Path;

/// Instruction files read from the project folder, in this order.
pub const INSTRUCTION_FILES: &[&str] = &["AGENTS.md", "CLAUDE.md"];
const MAX_INSTRUCTIONS: usize = 40_000;

const IDENTITY: &str = "You are DevCat Agent, a coding agent working in the user's project through tools. \
You read and change files and run commands to get the user's task done.";

const WORKING: &str = "\
# How to work
- Keep working until the task is done. Don't end your answer by announcing what you will do next: do it now with a tool call. End the turn only when the work is finished or you need the user.
- Look before you change: read the relevant files and search the code (`glob`, `grep`, `read`) instead of guessing.
- Make the smallest change that does the job, in the style of the surrounding code.
- Use `edit` for changes to existing files and `write` for new files. Never paste whole files back to the user.
- After changing code, run the project's checks or tests with `shell` when it makes sense, and fix what fails.
- If a tool call is refused, don't retry the same call; ask the user or try another way.
- Keep answers short. Say what you changed and what's left; don't repeat file contents.
- Ask the user when the task is ambiguous or a step would be destructive or hard to undo.";

pub struct Environment<'a> {
    pub cwd: &'a Path,
    pub os: &'a str,
    pub shell: &'a str,
    pub date: &'a str,
}

/// The full system prompt for a session in `env.cwd`.
pub fn system_prompt(env: &Environment<'_>) -> String {
    let mut sections = vec![IDENTITY.to_string(), WORKING.to_string()];
    sections.push(format!(
        "# Environment\n- Project folder (the working directory): {}\n- Operating system: {}\n- Shell used by the `shell` tool: {}\n- Today's date: {}",
        env.cwd.display(),
        env.os,
        env.shell,
        env.date
    ));
    if let Some(i) = project_instructions(env.cwd) {
        sections.push(i);
    }
    sections.join("\n\n")
}

/// The project's instruction files, if any.
pub fn project_instructions(cwd: &Path) -> Option<String> {
    let mut parts = Vec::new();
    for name in INSTRUCTION_FILES {
        if let Ok(text) = std::fs::read_to_string(cwd.join(name))
            && !text.trim().is_empty() {
                let text = if text.len() > MAX_INSTRUCTIONS { format!("{}\n[… cut]", &text[..floor(&text, MAX_INSTRUCTIONS)]) } else { text };
                parts.push(format!("## {name}\n{}", text.trim()));
            }
    }
    (!parts.is_empty()).then(|| format!("# Project instructions\nThe project's own instructions. Follow them.\n\n{}", parts.join("\n\n")))
}

fn floor(s: &str, mut i: usize) -> usize {
    while !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn includes_environment_and_instruction_files() {
        let dir = std::env::temp_dir().join(format!("devcat-harness-prompt-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("AGENTS.md"), "Use tabs.\n").unwrap();
        let p = system_prompt(&Environment { cwd: &dir, os: "linux", shell: "bash", date: "2026-10-21" });
        assert!(p.starts_with("You are DevCat Agent"));
        assert!(p.contains("Today's date: 2026-10-21"));
        assert!(p.contains("## AGENTS.md\nUse tabs."));
        assert!(!p.contains("CLAUDE.md\n"));
        let _ = std::fs::remove_dir_all(dir);
    }
}
