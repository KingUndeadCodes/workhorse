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
picks a real person's credential, so every commit is attributable to someone accountable. For a
repo action the credential comes from the first of these who has connected an account:

| Order | Whose credential | Why |
|---|---|---|
| 1 | The person who **approved** the agent run | They are accountable for it going ahead |
| 2 | The person whose **event triggered** the run (e.g. the commenter) | They asked for it |
| 3 | The user who **created the repo link** | Last resort |

If nobody in that list has connected, the run fails with *"No github account is connected for this
action — connect yours under Settings → Git."* — the request that triggered it still succeeds.
Branch creation from the UI uses the clicking user's own account (then the link creator's).
Linking a repo verifies access with the linking user's account. `local` repos need no credential.

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
(`JWT_SECRET`, `OLLAMA_HOST`, …) — nothing but `dev.sh` reads `.env`.

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
   resolved person's credential (table above).

## Security

- Credentials are encrypted at rest (AES-256-GCM, `gcm1:` prefix) in `user_git_connections`;
  `UserGitConnectionRepository` is the only code that sees plaintext, and secrets are never sent
  to the client (`GET /api/git-connections` returns only the provider, account login, and whether it's a token or OAuth connection).
- An OAuth App token acts with the `repo` scope across **everything that account can see**, not
  just the linked repo — the accepted cost of commits being attributable to a person. A
  fine-grained personal access token scoped to specific repos is the tighter alternative and stays
  fully supported.
- The OAuth `state` is HMAC-signed, expires after 10 minutes, and names the user the callback
  saves the connection for. The callback route is public (GitHub redirects the browser to it); the
  signed state is its only authorization.
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
| `POST /api/git-connections/github/oauth/start` | Returns GitHub's authorize URL (`{ returnTo }`) |
| `GET /api/git-connections/github/oauth/callback` | **Public.** Completes the OAuth flow, redirects to `returnTo?gitConnect=ok\|error` |
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
overwriting an existing connection) and a one-time pass encrypts anything still in plaintext. The
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

## Tests

`server/test/`: `gitRoutes` (HTTP routes), `userGitConnectionRepository` (+ `GitAuthResolver`),
`gitConnectionMigration`, `githubOAuth` (state + code exchange), `githubProvider` (mocked
`fetch`), `eventEngine.gitActions` (agent actions and credential choice),
`gitRepoLinkRepository`, `tokenCipher`. Run with `cd server && npx vitest run`.
