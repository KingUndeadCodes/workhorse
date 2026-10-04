# GitHub integration

Workhorse can link a project to a GitHub repository. Once linked, anyone can create a real branch
for a ticket from its drawer, and AI agents can read and write files in the repo (always on a
branch, never the default branch). GitHub is the only hosted git provider; a `local` provider
(repos on the server's own disk) also ships, mainly for development. GitLab support was removed
deliberately — see [`plans/GIT_OAUTH_PLAN.md`](../plans/GIT_OAUTH_PLAN.md) §6.

## How it works

**Credentials belong to people, not projects.** Each person connects their own GitHub account once
(Settings → Git). A project's repo link records only *which* repo (owner, repo, default branch) and
holds no secret.

**Commits are made by proxy.** An agent has no git identity of its own. When it acts, the server
uses a real person's credential, so every commit is attributable to someone accountable. For a
repo action the credential comes from the first of these who has connected an account:

| Order | Whose credential | Why |
|---|---|---|
| 1 | The person who **approved** the agent run | They are accountable for it going ahead |
| 2 | The person whose **event triggered** the run (e.g. the commenter) | They asked for it |

**There is no fallback to whoever created the repo link.** Linking a repo does not lend its
creator's account to everyone else: someone with no connection of their own — a guest, or a member
who never connected — cannot make the app act with another person's credential. If neither person
above has connected, the run fails with *"No github account is connected for this action — connect
yours under Settings → Git."*; the request that triggered it still succeeds. Branch creation from
the UI uses only the clicking user's own account, and linking a repo verifies access with the
linking user's account. `local` repos need no credential.

## Setup (whoever deploys Workhorse)

You can skip OAuth entirely: every user can instead paste a GitHub **personal access token** (with
`repo` scope) under Settings → Git. OAuth only adds a one-click **Connect GitHub** button.

### 1. Register a GitHub OAuth App

GitHub → Settings → Developer settings → **OAuth Apps** → **New OAuth App**. (Not *GitHub Apps* —
a GitHub App commits as itself, never as a person, which defeats the proxy model above.)

| Field | Value |
|---|---|
| Homepage URL | The address people open Workhorse at (e.g. `http://localhost:5173`) |
| Authorization callback URL | `<PUBLIC_URL>/api/git-connections/github/oauth/callback` |

Then **Generate a new client secret** (shown once). Leave *Enable Device Flow* and *wildcard
matching* off, and don't enable expiring user tokens — tokens are stored without a refresh flow.

### 2. Configure the server

| Variable | Purpose |
|---|---|
| `GITHUB_OAUTH_CLIENT_ID` | The OAuth App's client id |
| `GITHUB_OAUTH_CLIENT_SECRET` | The OAuth App's client secret |
| `PUBLIC_URL` | The server's own origin, used to build the callback URL (e.g. `http://localhost:8787`) |
| `APP_URL` *(optional)* | The origin the app is served from, if different from `PUBLIC_URL`'s — the only place the callback may send the browser back to. Defaults to `PUBLIC_URL`'s origin; `dev.sh` sets it to `http://localhost:5173` |
| `TOKEN_ENCRYPTION_KEY` *(optional)* | Key for encrypting stored credentials. If unset, one is generated once and kept in `server/data/token-encryption.key` |
| `OAUTH_STATE_SECRET` *(optional)* | Key for signing the OAuth `state`. If unset, generated into `server/data/oauth-state.key` |

If any of the first three is unset, **Connect GitHub** simply isn't offered and the token form is
shown instead (`GET /api/git-connections` reports `githubOAuth: false`).

`./dev.sh` loads a gitignored `.env` at the repo root before starting anything:

```bash
GITHUB_OAUTH_CLIENT_ID=your-client-id
GITHUB_OAUTH_CLIENT_SECRET=your-client-secret
PUBLIC_URL=http://localhost:8787
```

Restart `./dev.sh` after editing it. In production, set the variables however you set the others
(`JWT_SECRET`, `OLLAMA_HOST`, …) — nothing but `dev.sh` reads `.env`. If the app and API are served
from different origins there, set `APP_URL` too; if they share one, `PUBLIC_URL` is enough.

**Localhost works.** GitHub accepts `http://localhost` callbacks. The registered URL must match
`PUBLIC_URL` + the path exactly (port, `localhost` vs `127.0.0.1`, no trailing slash). Register one
OAuth App per environment; each has a single callback.

## Using it

1. **Connect your account** — Settings → Git: *Connect GitHub* (OAuth), or *Use a personal access
   token instead*. Shows "Connected as @you"; *Disconnect* removes it.
2. **Link a repo** — Project Settings → Git: pick `github`, then choose a repository from the
   dropdown (your account's repos, most recently pushed first, searchable; the default branch is
   filled in and editable). If the list can't load, type owner/repo by hand. One repo per project;
   linking again replaces it.
3. **Branch a ticket** — the issue drawer's branch action creates `issue/<KEY>-<slug>` off the
   default branch.
4. **Agents** — give an agent the `readRepoFile` / `writeRepoFile` actions. Writes go to a branch
   named by the agent (created off the default branch if missing) and are committed under the
   resolved person's credential (table above). **Repo actions always wait for a person to approve
   them**, whatever the agent's approval policy says: comments are other people's input and become
   the agent's context, so an auto-applied write would let a crafted comment cause a commit with a
   real person's token. Only non-guest members can approve, trigger or reject a run. `readRepoFile`
   records the file's **size and SHA-256** in the event log, never its content — the log is readable
   by every member, streamed to every websocket client, and sent to matching webhooks, so storing a
   private repo's file there would hand it to people with no access to the repo.

## Security

- Credentials are encrypted at rest (AES-256-GCM, `gcm1:` prefix) in `user_git_connections`;
  `UserGitConnectionRepository` is the only code that sees plaintext, and secrets are never sent
  to the client (`GET /api/git-connections` returns only the provider, account login, and whether it's a token or OAuth connection).
- An OAuth App token acts with the `repo` scope across **everything that account can see**, not
  just the linked repo — the accepted cost of commits being attributable to a person. A
  fine-grained personal access token scoped to specific repos is the tighter alternative and stays
  fully supported.
- **The callback saves nothing.** It is public (GitHub redirects the browser to it) and cannot tell
  who is at the keyboard — only who *started* the flow. Saving there would let an attacker start a
  flow, send the authorize link to a victim, and have the victim's token saved to the attacker's
  account (login CSRF). Instead the callback exchanges the code, parks the token behind a one-time
  ticket (60 seconds, in memory), and redirects to the app. The signed-in app then calls
  `POST /api/git-connections/github/oauth/complete`, and the server refuses unless the ticket was
  issued for *that* user. A mismatch burns the ticket.
- The OAuth `state` is HMAC-signed, expires after 10 minutes, carries a single-use nonce, and
  names the user who started the flow. A used state cannot be replayed.
- `returnTo` (where the browser goes afterwards) must be on the app's own origin — `APP_URL` or
  `PUBLIC_URL`, never a value the client picks — so neither the browser nor a ticket can be sent to
  another site.
- Owners, repos, branches and file paths are validated/encoded before being placed in GitHub API
  URLs, so user input can't redirect a request (made with the user's token) to another endpoint.
- **Branch names are validated** (letters, digits, `. _ / -`; never starting with `-`) at the routes,
  in the engine for agent-chosen names, and again in `LocalGitProvider`, which also passes `--` so
  a name can never be read as a git option (`-D` would otherwise delete a branch).
- `LocalGitProvider.writeFile` refuses any path that runs through a symbolic link, so a link
  committed to a repo can't redirect an agent's write outside the worktree.
- Nothing is stored unless it verifies: a pasted token must resolve to a real account, and linking
  a repo must reach the repo and branch.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/git-providers` | Registered provider ids (`local`, `github`) |
| `GET /api/git-connections` | The caller's connections + whether OAuth is configured |
| `PUT /api/git-connections/:provider` | Connect with a pasted token (`{ token }`), verified first |
| `DELETE /api/git-connections/:provider` | Disconnect the caller's account |
| `GET /api/git-connections/:provider/repos` | Repos the caller's account can reach (repo picker); up to 300 |
| `POST /api/git-connections/github/oauth/start` | Returns GitHub's authorize URL (`{ returnTo }`, which must be on the app's origin) |
| `GET /api/git-connections/github/oauth/callback` | **Public.** Exchanges the code and redirects to `returnTo?gitConnect=ready&ticket=…` (or `gitConnect=error&message=…`). Saves nothing |
| `POST /api/git-connections/github/oauth/complete` | Redeems the ticket (`{ ticket }`) as the signed-in user and saves the connection |
| `GET/POST/DELETE /api/projects/:id/git-repo-link` | Read / link (`{ provider, owner, repo, defaultBranch? }`) / unlink |
| `POST /api/issues/:id/branch` | Create a branch for a ticket |

Guests cannot connect accounts or link repos.

## Code map

- `domain/integrations.ts` — `GitRepoLink`, `GitAuth`, `UserGitConnection`, `GitRepoSummary`.
- `server/src/services/GitProvider.ts` — the provider interface (`verifyAccess`, `createBranch`,
  `readFile`, `writeFile`, optional `identify`, `listRepos`) and registry.
  `GitHubProvider.ts` (REST via `fetch`), `LocalGitProvider.ts`.
- `server/src/services/GitAuthResolver.ts` — the proxy-attribution rule above.
- `server/src/services/githubOAuth.ts` — env config, signed state, authorize URL, code exchange.
- `server/src/routes/gitConnections.ts`, `routes/projects.ts`, `routes/issues.ts`.
- `server/src/repositories/UserGitConnectionRepository.ts`, `GitRepoLinkRepository.ts`.
- `app/src/lib/components/GitConnectionsSettings.svelte` (account tab) and
  `ProjectSettings.svelte` (repo link + picker).

## Data and migration

`user_git_connections (user_id, provider, auth_kind, token, account_login, created_at)`, primary key
`(user_id, provider)`. Older databases stored a credential on `git_repo_links`; on boot the schema
moves each one onto its creator's connection (skipping `local` and orphaned rows, never
overwriting an existing connection; a creator with several links keeps their **newest** credential)
and a one-time pass, finished before the server starts serving, encrypts anything still in plaintext. The
legacy `git_repo_links.token` / `auth_kind` columns remain but are always null.

## Limits

- GitHub only (plus `local`). Adding another host means a new `GitProvider` registered in
  `container.ts`.
- One repo per project; the picker lists at most 300 repos (others are still linkable by typing).
- No refresh tokens (tokens don't expire unless you enable that on the GitHub side).
- No GitHub webhooks (nothing reacts to pushes or merges).

## Troubleshooting

| Symptom | Cause |
|---|---|
| GitHub: "The `redirect_uri` is not associated with this application" | The OAuth App's callback URL doesn't match `PUBLIC_URL` + `/api/git-connections/github/oauth/callback` exactly |
| No *Connect GitHub* button | One of the three OAuth env vars is unset, or the server wasn't restarted after editing `.env` |
| "No github account is connected for this action" | Nobody in the resolution order has connected — connect under Settings → Git |
| "GitHub rejected this token" | The token was revoked or expired — reconnect |
| "This connect attempt expired — start again" | More than 10 minutes between starting and finishing the GitHub authorize step |
| "returnTo must be on this app's own origin" | The app is served from an origin that is neither `APP_URL` nor `PUBLIC_URL` — set `APP_URL` |
| "This connect attempt is invalid or has expired" | The ticket was older than 60 seconds, already used, or issued for a different signed-in user |

## Tests

`server/test/`: `gitRoutes` (HTTP routes, including the login-CSRF scenario), `userGitConnectionRepository` (+ `GitAuthResolver`),
`gitConnectionMigration`, `githubOAuth` (state + code exchange), `githubProvider` (mocked
`fetch`), `eventEngine.gitActions` (agent actions and credential choice),
`gitRepoLinkRepository`, `tokenCipher`. Run with `cd server && npx vitest run`.
