# DevCat

A cross-platform developer workbench: a Navicat-style database client plus
Lens-style tooling for Kubernetes and RabbitMQ, built with [Tauri 2](https://tauri.app)
(Rust) and React + TypeScript.

| Area | Supported |
| --- | --- |
| SQL databases | PostgreSQL, MySQL / MariaDB, SQLite, SQL Server |
| NoSQL | MongoDB, Redis |
| Infrastructure | Kubernetes (any kubeconfig context), RabbitMQ (management API) |
| Networking | OpenVPN, WireGuard, SSH tunnels (local forwards + SOCKS proxy) |
| Git | Nested repo discovery, commit graph, blame, branches, tags, stashes, fetch/pull/push |
| AI | Claude Code workspace (terminal, diff, code review) using your installed `claude` CLI |

## Download

Grab the latest installer for macOS, Windows or Linux from the
[Releases page](https://github.com/devileya/DevCat/releases/latest).

## Features

- **Projects**: group connections into projects and focus on one project at a time.
- **Connections**: saved profiles with color tags, SSH tunnels, SSL, read-only mode.
  Passwords are stored in the OS keychain (macOS Keychain / Windows Credential Manager),
  never in plain files.
- **Object browser**: databases, schemas, tables, views, functions, procedures, triggers,
  sequences, indexes, collections, Redis keys.
- **SQL editor**: Monaco with schema-aware autocomplete, run statement or selection, multiple result sets,
  explain, formatting, cancel, query history and saved queries.
- **Data grid**: virtualized, inline editing with commit/discard, filters, sorting, paging,
  copy as CSV/TSV/JSON/INSERT, form view.
- **Table designer**: columns, indexes, foreign keys, with generated CREATE/ALTER SQL preview.
- **ER diagram**: auto-layout, relationship highlighting, export to image.
- **Schema compare and sync**, **data compare**.
- **Data transfer**: export (CSV, JSON, SQL, Excel), import (CSV/JSON with column mapping),
  SQL backup and restore, and copying tables between connections, even across dialects.
- **MongoDB**: document/table/JSON views, editing, aggregation pipeline builder, shell-style queries.
- **Redis**: key browser, editors for every data type, TTL, CLI console.
- **Kubernetes**: cluster overview, applications, workloads, config, network, storage, events, Helm releases and
  CRDs with live updates; per-row actions (logs, shell, port-forward, scale, restart, edit YAML, delete),
  including logs and shell on Deployments with a pod switcher.
- **RabbitMQ**: overview with live message-rate charts; queues, exchanges, bindings, connections,
  channels and consumers; publish and get messages; declare, purge and delete.
  Paste an `amqp://` URL to fill the connection form.
- **VPN & SSH tunnels**: import `.ovpn` / WireGuard `.conf` files or `~/.ssh/config` hosts, or set them up
  in a form; connect/disconnect with live status, logs and a realtime traffic graph. Connections can depend
  on a VPN or tunnel, which is connected automatically first. VPNs need administrator rights to connect
  (the OS asks for your password); OpenVPN / `wireguard-tools` must be installed.
- **Claude Code workspace**: runs your installed [Claude Code](https://docs.claude.com/en/docs/claude-code)
  CLI in a real terminal (like iTerm2), with **Chat ⌥⇧⌘1 · Diff ⌥⇧⌘2 · Code Review ⌥⇧⌘3**, your Claude
  session list (resume any session), a git-aware file tree and file previews (code, Markdown, PDF, images,
  Excel/CSV, Word). Uses your own Claude account; install Claude Code and run `claude` once to log in.

- **Git**: scan a folder for every repository inside it (nested repos, submodules and worktrees; `node_modules`
  and build folders are skipped) and see branch, ahead/behind and changes at a glance. Each repo opens a Git tab
  with a commit graph (all branches, search, author and file-history filters) and per-commit diffs, working-tree
  changes with stage/commit/stash, branches/tags/remotes, and stashes. Checkout, branch, merge, tag, cherry-pick,
  revert and reset from the history. **Blame** for any file preview, with an age heatmap and a link to each commit.
  Fetch, pull and push use your SSH agent or credential helper (they never prompt).

## Development

Prerequisites: Node 20+, pnpm, Rust (stable), plus the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS
(Xcode Command Line Tools on macOS; Microsoft C++ Build Tools + WebView2 on Windows).

```bash
pnpm install
pnpm tauri dev          # run the app with hot reload
```

Local test services for every supported backend:

```bash
docker compose -f docker-compose.dev.yml up -d
```

| Service | Address | Credentials |
| --- | --- | --- |
| PostgreSQL | localhost:55432 | postgres / devcat |
| MySQL | localhost:53306 | root / devcat |
| SQL Server | localhost:51433 | sa / DevCat_Passw0rd! |
| MongoDB | localhost:57017 | devcat / devcat |
| Redis | localhost:56379 | none |
| RabbitMQ | localhost:55673 (management) | devcat / devcat |

Backend integration tests (need the services above):

```bash
cd src-tauri && cargo test -- --ignored
```

## Building installers

```bash
pnpm tauri build        # builds for the current OS
```

- **macOS** → `src-tauri/target/release/bundle/dmg/DevCat_<version>_aarch64.dmg` (and `.app`)
- **Windows** → `src-tauri/target/release/bundle/msi/*.msi` and `nsis/*-setup.exe`

Each OS's installers must be built on that OS. CI does all of them: push a tag (`git tag v0.1.0 && git push --tags`)
or run the **build** workflow manually. `.github/workflows/build.yml` builds macOS (Apple Silicon and Intel),
Windows (`.exe`/`.msi`) and Linux (`.AppImage`/`.deb`/`.rpm`) installers and publishes them on the GitHub release.

macOS builds are ad-hoc signed but not notarized, so allow DevCat once via *System Settings → Privacy & Security →
Open Anyway* (or run `xattr -dr com.apple.quarantine /Applications/DevCat.app`). If macOS says the app "is damaged"
(builds before v0.2.1), run `codesign --force --deep --sign - /Applications/DevCat.app` and the `xattr` command above. For distribution, configure code signing and
notarization ([macOS](https://tauri.app/distribute/sign/macos/), [Windows](https://tauri.app/distribute/sign/windows/)).

## Project layout

```
src/                      React frontend
  lib/                    API wrappers + shared types (mirror the Rust types)
  store/                  zustand stores (connections, tabs, ui)
  tabs/                   tab kinds + registry
  features/               connections, query, grid, table, history, redis, mongo,
                          er, compare, transfer, k8s, rabbitmq, network, claude, files, git
src-tauri/src/
  db/                     Driver trait + postgres, mysql, sqlite, mssql, mongo, redis,
                          ssh tunnels, cross-dialect DDL, transfer/backup
  infra/                  kubernetes, rabbitmq
  network/                VPN (OpenVPN, WireGuard), SSH tunnels, traffic counters
  gitx/                   git tools: repo discovery, log/graph, blame, branches, stashes, remotes
  claude/                 Claude Code CLI driver, PTY terminal, sessions, file previews, git
  commands/               Tauri command handlers
  store.rs                saved connections (JSON) + OS keychain secrets
```
