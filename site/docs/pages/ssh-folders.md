# Folders on SSH hosts

Run the agent and terminals on another machine while the file tree, previews and Git status stay in DevCat.

## Open a remote folder

1. In the AI workspace, open the folder menu at the top of the sidebar.
2. Choose **Open folder on SSH host…**.
3. In **Host**, pick a host from your `~/.ssh/config` or type `user@host` (add `:port` if needed).
4. Click **Browse** and pick the folder there (`~` is your home folder on that machine).
5. Click **Open folder**.

New chats and terminals now run on that machine. The file tree, previews, file edits and Git status work over SSH.

## How it connects

DevCat uses your system's `ssh`, so everything you've set up for it works: hosts and options from `~/.ssh/config`,
keys, `ssh-agent` and `ProxyJump`. It keeps one shared connection per host.

The agent runs on that machine, so it has to be installed there (for example Claude Code).

### Hosts that ask for a password

DevCat can't type a password for you. Click **Open anyway**, start a terminal in the folder and type the password
once there. The file tree then uses that connection.

> **Note:** The **Diff** and **Code Review** views work on local folders only for now. Use the agent or a terminal
> for Git on a remote folder.
