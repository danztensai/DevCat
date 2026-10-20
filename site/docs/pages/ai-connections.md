# AI connections

Choose which coding agent DevCat runs, add your own command, and give an agent an API key.

An *AI connection* tells DevCat which agent CLI to start in the AI workspace. Claude Code is built in. You can add:

| Agent | Command | API key variable |
| --- | --- | --- |
| Claude Code (built in) | `claude` | `ANTHROPIC_API_KEY` |
| OpenAI Codex | `codex` | `OPENAI_API_KEY` |
| Gemini CLI | `gemini` | `GEMINI_API_KEY` |
| GitHub Copilot | `copilot` | `GH_TOKEN` |
| Aider | `aider` | the key of the model's vendor |
| opencode | `opencode` | `OPENAI_API_KEY` or another vendor's |
| Custom | any CLI that runs in a terminal | your choice |

## Add an AI connection

1. In the AI workspace, open the agent menu at the top of the sidebar (it shows *Claude Code* at first).
2. Choose **Manage AI connections…**, then **Add AI connection**.
3. Pick the agent. DevCat shows whether its CLI is installed, with the install command if it isn't.
4. Optionally add arguments, **Environment variables** or an **API key**.
5. Click **Use for new chats** so the next **New chat** starts this agent.

## Logins and API keys

Each agent uses its own login by default: run the CLI once in a terminal and sign in the way it asks.

If you'd rather use an API key, enter it in the connection. DevCat keeps it in the system keychain (macOS Keychain,
Windows Credential Manager) and passes it to the agent as the variable shown under **Passed as**. It is never
written to a plain file.

## What differs between agents

- **Claude Code** gets the session list, the launch options and the **Code Review** view.
- **Other agents** get a **Review** button that asks the agent itself to review the changes in its terminal.
- The **Diff** view and extra terminals work the same for every agent.
