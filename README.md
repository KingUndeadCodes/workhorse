# Workhorse

A self-hosted, Jira-shaped issue tracker — projects, boards, backlogs, sprints, and configurable
workflows — with first-class AI agents that can be attached to a ticket and act on it (comment,
transition status, edit fields, touch a linked repo) under an approval/budget policy you control.

Single workspace, event-driven, auditable. The only external integration is optional GitHub linking (each person connects their own account); there are no other third-party services.

## Stack

- **Frontend** (`app/`): Svelte 5 + Vite, TypeScript
- **Backend** (`server/`): Hono + Kysely over sql.js (SQLite compiled to WASM), WebSocket live updates
- **Shared** (`domain/`): TypeScript types used by both frontend and backend

Data is stored as two separate append-only-friendly SQLite files: `state.db` (the read model /
source of truth for entities) and `events.db` (a durable, monotonically-sequenced event log other
subsystems — automations, agents, webhooks, in-app notifications — react to). See
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

## GitHub integration (optional)

Each person can connect their own GitHub account (Settings → Git) so projects can link a repo,
tickets can create branches, and agents can commit by proxy under a real person's credential. A
one-click **Connect GitHub** needs a GitHub OAuth App; without one, users paste a personal access
token. `./dev.sh` loads a gitignored `.env`:

```bash
GITHUB_OAUTH_CLIENT_ID=your-client-id
GITHUB_OAUTH_CLIENT_SECRET=your-client-secret
PUBLIC_URL=http://localhost:8787
```

The OAuth App's callback URL is `<PUBLIC_URL>/api/git-connections/github/oauth/callback`. Full
setup, the attribution rules, security notes, and troubleshooting are in
[`docs/github-integration.md`](docs/github-integration.md).

## UI configuration

`app/ui.config.json` controls the active font and light/dark color scheme. See
[`docs/ui-style-guide.md`](docs/ui-style-guide.md) for the palette rules.

## Checks

```bash
cd server && npx tsc --noEmit
cd server && npx vitest run
cd app && npm run check
cd app && npm test
```

## Project docs

- [`docs/backend-architecture.md`](docs/backend-architecture.md) — backend architecture reference
- [`docs/github-integration.md`](docs/github-integration.md) — GitHub setup, how commits are attributed, API, troubleshooting
- [`docs/ui-style-guide.md`](docs/ui-style-guide.md) — UI color/style conventions
- [`docs/project-plan.md`](docs/project-plan.md) — whole-project roadmap and subsystem status
- [`plans/AGENTS_PLAN.md`](plans/AGENTS_PLAN.md) — detailed spec for the agent/automation subsystem
- [`plans/GIT_OAUTH_PLAN.md`](plans/GIT_OAUTH_PLAN.md) — design record for GitHub OAuth linking (implemented; GitHub only, GitLab dropped)

## License

[MIT](LICENSE)
