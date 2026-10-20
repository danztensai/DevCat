# Review and commit

See what the agent changed, ask for a code review, then commit just the files you want.

![The Diff view with the changed files and a side-by-side diff](../img/diff.png)

## The Diff view

Open a chat tab and click **Diff** (<kbd>⌥⇧⌘2</kbd>). The left side lists the changed files in three groups:
staged, changed and untracked (new). Click a file to see its diff, side by side or inline (the button above the diff switches). The list
refreshes every few seconds while the tab is open.

- **Stage** or **Unstage** one file with the button on its row, or use **Stage all** / **Unstage all**.
- **Discard changes** on a file throws away the changes to it. **Discard all changes…** does it for every file,
  after asking.
- **Open file** opens the file in a preview tab.

## Commit

1. Tick the files to commit (**Select for commit / discard**). Only those are committed, and other staged
   changes stay staged. With nothing ticked, the staged files are committed.
2. Type a commit message in the box under the list.
3. Press <kbd>⌘↵</kbd> (<kbd>Ctrl+Enter</kbd>) or click **Commit**.

Ticked files can also be discarded together with **Discard selected…**.

## Code Review (Claude Code)

1. Click **Code Review** (<kbd>⌥⇧⌘3</kbd>).
2. Choose what to review: **Uncommitted changes**, **Staged changes**, or **Branch vs base** (pick the base branch).
3. Click **Run review**.

Claude reads the changes without editing anything and lists findings by severity, each with a suggestion.

- **Show in Diff** jumps to the lines in question.
- **Fix with Claude** switches to the chat and asks Claude to fix that finding.

> **Tip:** Other agents don't have this view. Use their **Review** button instead, which asks the agent in its
> terminal.
