# GitHub OAuth — Long-Term Plan

Status: **implemented** — this is now the design record; the working reference for setup, behavior,
API, and troubleshooting is [`docs/github-integration.md`](../docs/github-integration.md). Section
numbers are stable references. Where §2–§4 describe a per-project credential (`GitRepoLink.auth`)
or a connect button on the project's Git tab, "Revision note 2" below supersedes them.

**Revision note:** this plan previously covered both GitHub and GitLab, and chose a GitHub App
over a GitHub OAuth App for better token scoping. Both calls are reversed here: GitLab support is
dropped entirely (not deferred — removed from the codebase), and the target for GitHub is now an
**OAuth App**, not a GitHub App. Reason for the GitHub reversal: a GitHub App authenticates and
commits *as the app itself* (e.g. "workhorse-bot" in commit history) — there is no way to make a
GitHub App act as a proxy for a specific human, which is a real product requirement (an agent's
commit should be attributable to whichever person is accountable for that repo link, not to an
anonymous bot identity). An OAuth App's token *is* a specific human's identity, so it's the only
GitHub auth mechanism that satisfies that requirement — at the cost of the account-wide scope
§1 originally rejected it for. That cost is accepted deliberately below.

**Revision note 2 (per-account credentials):** the credential no longer lives on the project's repo
link. Each person connects their own GitHub account once (`UserGitConnection`, Settings → Git) and
`GitRepoLink` holds only owner/repo/branch. Agent actions resolve whose credential to use at the
moment they act (`GitAuthResolver`: the run's approver, else the person whose event triggered it,
else the link's creator) — see `docs/backend-architecture.md` §6.1. Where §2–§4 below still say
`GitRepoLink.auth` or describe a per-project connect flow, this note wins: the type is `GitAuth`
on `UserGitConnection`, the OAuth routes live at `/api/git-connections/github/oauth/*` (callback
URL to register: `<PUBLIC_URL>/api/git-connections/github/oauth/callback`), and the Connect button
is in Settings → Git, not the project's Git tab. Existing per-project tokens were migrated onto
their creator's connection at boot.

## 0. What exists today (ground truth, not aspiration)

- `server/src/services/GitProvider.ts` — the `GitProvider` interface (`verifyAccess`,
  `createBranch`, `readFile`, `writeFile`), each method taking a plain `token: string` alongside
  `owner`/`repo`/`branch`/etc., plus `GitProviderRegistry` (register/resolve by string id). Two
  implementations are registered in `container.ts`: `'local'` (shells out to a local `git`
  binary, no token used) and `'github'` (GitHub REST API). GitLab support (`GitLabProvider`,
  its registration, its tests, its i18n strings) has been removed — GitHub only, going forward.
- `domain/integrations.ts`'s `GitRepoLink` — one per project (`GitRepoLinkRepository.create`
  replaces any existing link), storing `provider`, `owner`, `repo`, `defaultBranch`, and a single
  `token: string`. `token` is encrypted at rest (`crypto/tokenCipher.ts`, AES-256-GCM,
  generated/persisted key) — `GitRepoLinkRepository` is the only place a plaintext git token
  crosses the database boundary (`WebhookRepository` applies the same encryption to
  `WebhookSubscription.secret`, a separate field).
- Linking flow: `ProjectSettings.svelte`'s Git tab — a plain form (owner/repo/defaultBranch/token
  inputs) — `POST /api/projects/:id/git-repo-link` calls `verifyAccess` synchronously before
  storing anything, 400s with the provider's own error message otherwise. The user obtains
  `token` themselves today, outside the app entirely (a GitHub personal access token), and pastes
  it in.
- Nothing here talks to an OAuth authorization server yet. There is no callback route, no client
  id/secret configuration, no concept of a server's own public origin.

Everything in this plan is scoped around replacing the paste-a-token flow with a real
authorization-code flow for GitHub. `local` (no host, no token) is unaffected and stays exactly
as it is. The pasted-PAT path for GitHub is not being removed (§5).

## 1. Decision: GitHub OAuth App, not a GitHub App

GitHub offers two different things people call "OAuth for GitHub," and they scope very
differently, and — the point that decides this — they attribute actions differently:

- **OAuth App**: a redirect-and-exchange-a-code flow
  (`https://github.com/login/oauth/authorize` → `.../access_token`). The resulting token *is*
  the authorizing human's own identity — any commit made with it shows up as that person in
  GitHub's history, exactly like a personal access token does today. Scope is the downside: the
  token can see everything that person's account can see, not just the one repo they meant to
  link.
- **GitHub App**: installed on specific repositories, authenticating as the app via a signed JWT
  to mint short-lived installation access tokens scoped to exactly the repos it was installed
  on. Better scoped, but every action it takes — including a commit an agent makes on a human's
  behalf — is attributed to the app itself, never to a person. There is no configuration that
  makes a GitHub App act as a named human.

**Decision: build a GitHub OAuth App.** Proxy attribution — an agent's commit should read as
"made using so-and-so's authorization," the same way it does under the current PAT model, not as
an anonymous bot — is a harder requirement than tighter scoping. The account-wide scope an OAuth
App grants is accepted as the cost of that; it is not worse than what already exists (a PAT
already grants whatever scope the user chose when creating it, which is opaque to Workhorse
either way).

## 2. What changes in `GitRepoLink` and `GitProvider`

GitHub OAuth App tokens are non-expiring by default (GitHub only issues short-lived tokens
requiring refresh if the app explicitly opts into "token expiration" in its own settings — this
plan does not enable that in v1; see §9). That means the new token shape is barely more complex
than today's plain string:

- `GitRepoLink` gains a discriminated `auth` field replacing the bare `token`:
  ```ts
  type GitRepoLinkAuth =
    | { kind: 'token'; token: string }   // local's "no token", or a pasted GitHub PAT
    | { kind: 'oauth'; accessToken: string }
  ```
  Both variants' secret fields are encrypted at rest the same way `token` is today
  (`crypto/tokenCipher.ts` generalizes to encrypt/decrypt whichever field is present, not just
  one hardcoded name).
- `GitProvider`'s four methods stop taking a raw `token: string` and instead take `auth:
  GitRepoLinkAuth`. `local`/PAT/OAuth all resolve to a plain bearer token string internally —
  `GitHubProvider` doesn't need to branch on `auth.kind` at all, since both variants ultimately
  hand it one usable token; only `GitRepoLinkRepository`/the linking routes need to know which
  kind produced it.
- `GitProviderRegistry`/`routes/projects.ts`/`routes/issues.ts`/`EventEngine`'s
  `readRepoFile`/`writeRepoFile` cases keep resolving a provider by `GitRepoLink.provider`
  exactly as today — this change is invisible below `GitProvider`.

## 3. Server-side OAuth flow

New config, env-var-driven the same way `OLLAMA_HOST`/`JWT_SECRET` are — a self-hosted
deployment that wants this registers its own OAuth App with GitHub and configures these; a
deployment that doesn't set them simply doesn't get the connect flow offered (§4), same
"discovery endpoint" pattern `GET /api/git-providers` already uses for "is this provider even
configured":

- `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, and a callback URL derived from
  wherever the server's own public origin is configured (no such concept exists yet — this plan
  needs one, e.g. `PUBLIC_URL`, since GitHub redirects the browser to an absolute URL).
- New routes (exact paths TBD in implementation, not fixed here): one to kick off the redirect
  (`GET /api/projects/:id/git-repo-link/github/connect` → 302 to GitHub's `/authorize` endpoint,
  with `state` carrying the project id + a CSRF nonce), one callback
  (`GET /api/git-repo-link/github/callback`) that exchanges the code for an access token, builds
  the `GitRepoLinkAuth`, and calls `verifyAccess` (§0's existing check) before storing — same
  validate-before-store guarantee the PAT flow already has.
- The user still types `owner`/`repo`/`defaultBranch` themselves after connecting — an OAuth
  App's token isn't scoped to one repo the way a GitHub App installation is, so there's no
  GitHub-side "which repo" picker to inherit from; the existing manual fields stay, only the
  token field is replaced by the connect button.

## 4. Frontend flow

`ProjectSettings.svelte`'s Git tab form changes shape depending on whether the server reports
GitHub OAuth as configured (new field on `GET /api/git-providers`'s response, or a new endpoint —
implementation detail): if configured, a **"Connect GitHub"** button replaces the token input
(owner/repo/defaultBranch stay as manual fields either way) and opens the server's redirect route
— popup vs. full-page redirect-and-return is an open question (§9). If not configured, the
existing manual token form is shown exactly as today. Both paths land in the same place — a
stored `GitRepoLink` — so nothing downstream (branch creation, agent repo actions) needs to know
or care which path was used.

## 5. What does NOT change

- `local` git — no host, no token, unaffected by any of this.
- The pasted-PAT path for GitHub stays available indefinitely — not a deprecated fallback. An
  org that doesn't want to register an OAuth App with their GitHub org admin still needs a way to
  link a repo, and a fine-grained PAT is a legitimate tighter-scoped alternative for anyone who
  wants it. The in-product copy should keep offering both, not push OAuth as strictly superior.
- `verifyAccess`/`createBranch`/`readFile`/`writeFile`'s external behavior and error messages —
  §2's `auth` parameter change is a signature change, not a semantic one.
- The single-link-per-project model (`GitRepoLinkRepository.create` replaces any existing link).
  Not revisited here.

## 6. GitLab removal

GitLab support is dropped, full stop — not deferred, not kept as a lower-priority parallel track.
This plan is GitHub-only. Removing it from the codebase is its own small, mechanical pass:
`server/src/services/GitLabProvider.ts` and its registration in `container.ts`, the
`gitlabProvider` import, the `tokenHintGitlab` i18n key across all locales, the GitLab-specific
copy in `ProjectSettings.svelte`, and `GitLabProvider`'s absence should be reflected in
`docs/backend-architecture.md`'s git-provider section the same way the earlier extension removal
updated its own stale claims there.

## 7. README / positioning

`README.md:7`'s "No third-party service integrations" line stops being defensible the moment
this ships (it was already strained by `github` existing as a registered-by-default provider at
all — this plan makes it definitively false, since it adds standing OAuth client credentials as
a first-class deployment concern). This plan should land alongside a README wording change, not
after — something like reframing the line around *what kind* of integration this is (git
hosting, opt-in per deployment, not a marketplace of arbitrary third-party services) rather than
claiming there are none.

## 8. Rollout order (all done, plus the repo picker — project Git tab lists the connected account's repos)

1. `GitRepoLinkAuth` domain type + `GitRepoLink.auth` replacing `token`, migration for existing
   rows (`{ kind: 'token', token: <existing decrypted value> }`), `GitProvider` signature change
   to accept `auth` — no behavior change yet, the pasted-token path keeps working identically.
2. Remove GitLab support (§6) — a clean, independent pass, can land before or after step 1.
3. GitHub OAuth App: app registration docs for a deployer, `GITHUB_OAUTH_*` env vars,
   authorize/callback routes, code exchange in a new server-side flow.
4. `ProjectSettings.svelte`: Connect button when configured, existing token form otherwise.
5. README wording change (§7) — ships in the same pass as step 3, not deferred to the end.

## 9. Open questions for your feedback

- Should GitHub's "expiring user tokens" setting be enabled on the OAuth App (adds a refresh-token
  flow, §2's `GitRepoLinkAuth` would need `refreshToken`/`expiresAt` fields back) for
  defense-in-depth, or is a non-expiring token acceptable for v1 given it's already no worse than
  today's PAT (which also never expires unless the user set that themselves)?
- Should the connect flow open in a popup window or a full-page redirect-and-return? This SPA's
  existing login flow (if it has any redirect-based step) is the precedent to match, or this is
  the first time this app does a redirect-based auth flow at all.
- `PUBLIC_URL` (§3) doesn't exist as a concept yet — is a self-hosted deployment always expected
  to sit behind a stable public origin, or does this need to handle a deployment with no fixed
  public URL (in which case OAuth connect simply isn't offerable, same as any provider with unset
  env vars today)?
- Confirm §6: should the GitLab removal pass also drop `local`'s multi-provider dropdown logic in
  `ProjectSettings.svelte` (currently only shows a `<select>` when more than one provider is
  registered) back down to always-`github`-or-`local`, or leave the dropdown code in place since
  it's harmless with only two providers and would be needed again if a host is ever added later?
