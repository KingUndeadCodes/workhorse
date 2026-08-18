# Workhorse

A self-hosted, Jira-shaped issue tracker — projects, boards, backlogs, sprints, and configurable
workflows — with first-class AI agents that can be attached to a ticket and act on it (comment,
transition status, edit fields, touch a linked repo) under an approval/budget policy you control.

Single workspace, event-driven, auditable. No third-party service integrations.

## Stack

- **Frontend** (`app/`): Svelte 5 + Vite, TypeScript
- **Backend** (`server/`): Hono + Kysely over sql.js (SQLite compiled to WASM), WebSocket live updates
- **Shared** (`domain/`): TypeScript types used by both frontend and backend
- **Plugins** (`plugins/`): pluggable git/agent-runtime harnesses (see `plugins/README.md`)

Data is stored as two separate append-only-friendly SQLite files: `state.db` (the read model /
source of truth for entities) and `events.db` (a durable, monotonically-sequenced event log other
subsystems — automations, agents, webhooks — react to). See
[`docs/backend-architecture.md`](docs/backend-architecture.md) for the full architecture writeup.

## Getting started

Requires Node.js.

```bash
(cd server && npm install)
(cd app && npm install)
```

Then run both the API server and the frontend together:

```bash
./dev.sh
```

Or run them separately:

```bash
cd server && npm run dev   # API on http://localhost:8787
cd app && npm run dev      # Vite dev server, proxies /api and /ws to the server above
```

## UI configuration

`app/ui.config.json` controls the active font and light/dark color scheme. See
[`docs/ui-style-guide.md`](docs/ui-style-guide.md) for the palette rules.

## Checks

```bash
cd server && npx tsc --noEmit
cd app && npm run check
```

## Project docs

- [`docs/backend-architecture.md`](docs/backend-architecture.md) — backend architecture reference
- [`docs/ui-style-guide.md`](docs/ui-style-guide.md) — UI color/style conventions
- [`docs/project-plan.md`](docs/project-plan.md) — whole-project roadmap and subsystem status
- [`AGENTS_PLAN.md`](AGENTS_PLAN.md) — detailed spec for the agent/automation subsystem
- [`plugins/README.md`](plugins/README.md) — writing a git or agent-runtime plugin

## License

[MIT](LICENSE)
