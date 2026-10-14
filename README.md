# DevCat

A cross-platform developer workbench: a Navicat-style database client plus
Lens-style tooling for Kubernetes and RabbitMQ, built with [Tauri 2](https://tauri.app)
(Rust) and React + TypeScript.

| Area | Supported |
| --- | --- |
| SQL databases | PostgreSQL, MySQL / MariaDB, SQLite, SQL Server |
| NoSQL | MongoDB, Redis |
| Infrastructure | Kubernetes (any kubeconfig context), RabbitMQ (management API) |

## Features

- **Connections**: saved profiles with groups and color tags, SSH tunnels, SSL, read-only mode.
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
- **Kubernetes**: cluster overview, workloads, config, network, storage, events and CRDs with live updates,
  YAML editing, logs, shell (exec), port-forwarding, scale/restart/delete.
- **RabbitMQ**: overview with live message-rate charts; queues, exchanges, bindings, connections,
  channels and consumers; publish and get messages; declare, purge and delete.

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

Windows installers must be built on Windows. The easiest way is CI: push a tag (`git tag v0.1.0 && git push --tags`)
or run the **build** workflow manually. `.github/workflows/build.yml` builds the macOS (Apple Silicon and
Intel) and Windows installers and attaches them to a draft GitHub release.

Unsigned macOS builds need to be allowed once via *System Settings → Privacy & Security → Open Anyway*
(or `xattr -dr com.apple.quarantine /Applications/DevCat.app`). For distribution, configure code signing and
notarization ([macOS](https://tauri.app/distribute/sign/macos/), [Windows](https://tauri.app/distribute/sign/windows/)).

## Project layout

```
src/                      React frontend
  lib/                    API wrappers + shared types (mirror the Rust types)
  store/                  zustand stores (connections, tabs, ui)
  tabs/                   tab kinds + registry
  features/               connections, query, grid, table, history, redis, mongo,
                          er, compare, transfer, k8s, rabbitmq
src-tauri/src/
  db/                     Driver trait + postgres, mysql, sqlite, mssql, mongo, redis,
                          ssh tunnels, cross-dialect DDL, transfer/backup
  infra/                  kubernetes, rabbitmq
  commands/               Tauri command handlers
  store.rs                saved connections (JSON) + OS keychain secrets
```
