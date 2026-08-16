# Workhorse Backend — Architecture Reference

This document describes the current state of `server/` (and its dependency on `domain/`) as
implemented, for the purpose of an architectural critique — looking for over-complexity,
redundant abstractions, or inconsistent patterns. It is descriptive, not aspirational: where
something looks unfinished, duplicated, or awkward, that's called out rather than smoothed over.

Stack: Hono (HTTP), Kysely (typed query builder) + sql.js (SQLite compiled to WASM, in-memory
with manual snapshot-to-disk), TypeScript, `tsx` as the dev runner (no build step in dev).

Total backend size: ~5,000 lines across ~35 files in `server/src/`, plus a separate `domain/`
package (~1,000 lines) of shared types imported by both server and frontend.

---

## 0. What this is, and the philosophy behind it

**Workhorse** is a Jira-shaped issue tracker: projects, boards, backlogs, sprints, workflows
with custom statuses/transitions, comments with mentions, and — beyond what a typical tracker
does — first-class **AI agents** that can be attached to a ticket and act on it (comment,
transition status, reassign, set fields) on a human's behalf, plus **automation rules** and
**outbound webhooks** that react to the same underlying event stream agents do. It has gone
through several renames over its development (Anvil -> Workshop -> Workhorse); each rename was
done as a full sweep of every reference in the codebase, not a partial rebrand with old names
left dangling in comments or asset filenames.

The observations below describe the actual, consistently-applied engineering stance seen across
this codebase's history, not aspirational values — every one of them is backed by a specific
decision made and enforced somewhere in this backend.

### Event sourcing as the actual source of truth, not an add-on

`events.db` isn't a log bolted on next to "the real database" — it's treated as the one true
record of what happened, with `state.db` as a derived, rebuildable read model (§2.1, §4.1). The
proof this is taken seriously rather than stated and ignored: `AuditService` exists purely to
replay the log and verify the read model still matches it, and the same event stream is the
single trigger source for automations, agents, *and* webhooks (§4.2) — three different reactive
systems sharing one subscription mechanism (`EventSubscription`/`eventFilter`) rather than each
inventing its own notion of "when should I fire."

### Deliberate, stated simplifications — never silent ones

Where the implementation cuts a corner (JSON columns instead of a fully normalized schema, §3;
sql.js's whole-file-rewrite persistence instead of incremental durability, §2.1; no request-scoped
DI, §7), it is *stated as a conscious tradeoff in the code itself*, usually with the specific
condition under which it should be revisited (e.g. "a real deployment would swap this module...
without touching anything that calls into it"). The pattern throughout is: cut the corner, name
it, and make it cheap to undo later — not hide it behind an abstraction that implies more rigor
than actually exists.

### No compatibility shims, no half-removed features

When something is decided to be gone, it is *actually deleted*, not deprecated-in-place. Recent,
concrete examples from this codebase's own history:
- The `@anthropic-ai/sdk` dependency and its entire runtime implementation were removed outright
  when the project's default LLM backend moved to a local Ollama server (§6.2) — not kept behind
  a flag "in case," not left importable-but-unused.
- Every GitHub-specific reference (branding, a hardcoded provider literal, a bundled SDK
  dependency) was removed in a single deliberate pass when the git integration was generalized
  into the `GitProvider` harness (§6.1), rather than generalized-in-name-only with GitHub still
  secretly the only thing that worked.
- Dead code is flagged as dead, not left ambiguous — `agentParams()` (§3, §9) is called out by
  name specifically because nothing calls it, not smoothed over as "probably used somewhere."

This extends to how features are allowed to *not* exist yet: the git harness ships zero
implementations rather than a half-working stub (§6.1) — an honest "this doesn't work until you
register a provider" was chosen over a fake default that would work in a demo and fail
unpredictably in practice. §0's correction above covers where this reasoning was later found to
be only half-consistent, and what changed as a result.

### Harnesses over hardcoding — and a correction on "earned by a second case"

An earlier version of this document claimed abstraction here was "earned by a second real
implementation needing it, not introduced ahead of one." An external review of this document
correctly caught that this was wrong on both counts, and both were fixed rather than argued away:

- **The shared `ExtensionRegistry<T>` base was itself unearned.** What `GitProviderRegistry` and
  `AgentRuntimeRegistry` had in common was a ~15-line `Map`-backed register/resolve/list — not
  enough shared behavior to justify a generic class, an `Extension` interface, and two subclasses
  just to avoid writing that `Map` twice. It's been removed: `GitProvider`/`GitProviderRegistry`
  and `AgentRuntime`/`AgentRuntimeRegistry` (§6.1, §6.2) are now two small, independent,
  unrelated classes with no common ancestor — they don't need one just because both happen to be
  looked up by a string id.
- **`GitProvider`'s route/schema/UI surface genuinely was built ahead of any consumer**, which
  directly contradicts "not introduced ahead of one." That part of the claim was simply false as
  originally written. The fix applied wasn't to delete the surface (the interface, registry, and
  route wiring together are cheap, and the underlying `GitRepoLink`/`Branch` domain model predates
  this harness and has its own justification independent of it) but to close the actual harm:
  the UI used to present a form that would *always* fail with no way to know that in advance.
  `GET /api/git-providers` (mirroring the equivalent, already-existing `GET /api/agent-runtimes`)
  now lets the client ask first — see §6.1's updated description.

What still holds: the domain's own closed vocabularies (next section) were never generalized
into a registry in the first place, and the `AgentRuntime` interface itself was kept to the one
method callers actually use. What didn't hold is corrected above rather than left standing.

### Closed vocabularies stay closed, on purpose

`AutomationAction`, `AutomationCondition`, `EventPayload` are all discriminated unions dispatched
via `switch`, not registries (§4.4) — this is a conscious contrast with §6's harnesses, not an
inconsistency: these are the system's own internal vocabulary for mutating its own state, where
an open/pluggable action set would mean any registered extension could arbitrarily rewrite issue
data. Pluggability is reserved for integration points with the outside world (which git host,
which model backend); the domain's own mutation vocabulary is not treated as an extension point.

### Verification is part of "done," not a follow-up step

Every change described in this document was typechecked on both sides (`server`'s `tsc`, the
frontend's `svelte-check`) and then exercised against the actually-running application — either
through the browser or via direct API calls — before being considered complete. A failure mode
specific to this stack (`tsx`'s dev loader silently dropping `export *`-re-exported runtime
functions, §7) was caught this way, not by type-checking alone, which is itself evidence for why
this practice exists rather than being optional ceremony.

---

## 1. Directory layout

```
domain/                   Plain TypeScript types + a handful of pure helper functions.
                           No I/O, no framework imports. Imported by both server/ and app/.

server/src/
  index.ts                 Boot sequence: init DB, migrate, seed, backfill, start Hono.
  app.ts                   Route mounting, one inline GET /api/bootstrap handler, CORS.
  container.ts              Manual DI: constructs every repository/service singleton.
  domain.ts                 Re-export shim over ../../domain (see §7 for why it's non-trivial).
  eventLog.ts                The event-sourcing log: append/read against events.db directly.
  seed.ts                    First-boot fixture data.

  db/
    core.ts                  sql.js bootstrapping, dual DB handles, raw run/all/get helpers.
    schema.ts                 Idempotent CREATE TABLE / ALTER TABLE migrations, run on every boot.
    types.ts                  Kysely's DB interface (table -> column -> type).
    mappers.ts                 snake_case DB row -> camelCase domain object, one function per entity.

  auth/
    jwt.ts, middleware.ts, password.ts, secret.ts     Bearer-token auth, bcrypt-style hashing.

  repositories/              One class per entity family. Thin wrappers over Kysely queries.
                              (Agent, AgentRun, Automation, Catalog, GitRepoLink, Issue,
                               Planning, Project, User, Webhook, Workflow, Workspace)

  services/
    EventEngine.ts             The core reactor: automations, agents, webhooks all fan out from here.
    EventProjector.ts          Applies an event onto the read-model tables (state.db).
    AuditService.ts             Replays events.db and diffs against state.db; read-only.
    AgentRuntime.ts             Interface + registry for pluggable LLM backends.
    OllamaAgentRuntime.ts        The one shipped AgentRuntime implementation.
    GitProvider.ts               Interface + registry for pluggable git hosts. Zero implementations shipped.

  routes/                     One Hono sub-router per resource area, mounted in app.ts.
```

---

## 2. Two databases, two access styles

### 2.1 Two SQLite files

`state.db` and `events.db` are **separate sql.js databases**, each its own file on disk,
loaded fully into memory and re-serialized to disk after every write
(`persistState()`/`persistEvents()` in `db/core.ts` — `writeFileSync` of the whole DB export,
not incremental). There is no native SQLite driver in play; sql.js is SQLite compiled to WASM,
adopted specifically to avoid a native-binary crash the project hit with `better-sqlite3`.

- `events.db` — a single `events` table, append-only, written to by exactly one function
  (`appendEvent` in `eventLog.ts`).
- `state.db` — the read model: one table roughly per domain entity (issues, comments, agents,
  projects, ...), the thing every route actually queries.

`AuditService` exists specifically to check these two haven't drifted — it replays `events.db`
from scratch and diffs the recomputed state against what's actually in `state.db`. This is the
one place the split pays for itself as more than a stylistic choice: it turns "does our read
model match the log" into an actual query instead of a tautology.

### 2.2 Two query interfaces, coexisting

`db/core.ts` exports **both**:
- A Kysely instance (`db: Kysely<DB>`) — typed query builder, used by every `repositories/*.ts`
  class.
- Three raw SQL helpers (`run`, `all`, `get`) operating directly on the sql.js `Database`
  handle — used by `eventLog.ts`, `schema.ts`'s migrations, and one documented exception in
  `schema.ts` (`backfillAgentAssignments`, which reads a legacy column no longer in the mapped
  `Issue` type).

The Kysely layer is described in a comment as "the migration target for the hand-written SQL
strings still used elsewhere" — i.e. this is a deliberate, acknowledged partial migration, not
a finished design. Whether that's a healthy in-progress state or a redundant second code path
depends on how much longer both are expected to coexist.

### 2.3 Migrations

`schema.ts`'s `migrateStateDb()` runs unconditionally on every boot: a wall of
`CREATE TABLE IF NOT EXISTS` statements, plus an `addColumnIfMissing(table, column, type)`
helper for columns added after a table already shipped (SQLite has no `ADD COLUMN IF NOT
EXISTS`). There is no migration history/versioning table — idempotency is achieved purely by
each statement being safe to re-run, and by four standalone `backfill*()` functions
(`backfillAgentAssignments`, `backfillProjectColors`, `backfillWorkspaceMembers` in `index.ts`,
`backfillBoardColumns` in `index.ts`) that are one-shot, self-guarding data migrations run every
boot alongside the schema migration. All four are individually documented with the specific
historical reason they exist (a field that moved, a column that got backfilled).

---

## 3. Domain model / persistence mapping

Every table stores arrays and nested objects (label ids, an automation rule's actions, an
event's actor, an agent's budget) as JSON text columns, not join tables — `schema.ts`'s own
comment calls this "a deliberate simplification for a prototype, not full third-normal-form."
Only fields that are actually filtered/sorted on (status, assignee, project, dates) are real
typed columns. `mappers.ts` (391 lines) is the translation layer: one `rowToX`/`xToRow`-shaped
pair of functions per entity, doing `JSON.parse`/`JSON.stringify` and snake_case <-> camelCase
conversion by hand.

Notable: `mappers.ts` exports `agentParams(a: Agent): unknown[]` — a parameter-array builder
matching the old raw-SQL calling convention. Nothing in the codebase calls it; `AgentRepository`
was migrated to Kysely's builder and now sets each column by name. This function is dead code.

Every mapper applies its own default-on-missing-column pattern for fields added after initial
launch, e.g. `model: (r.model as string | null) ?? 'llama3.1'`, `runtime: (r.runtime as string |
null) ?? 'ollama'` — this is how the schema stays additive without a real migration/versioning
system: old rows get a hardcoded default at read time, forever, rather than being rewritten once.

---

## 4. Event sourcing and the reactor (`EventEngine`)

### 4.1 The log

Every meaningful thing that happens — an issue created, a status changed, a comment posted, an
agent's decision, a webhook firing — is first appended to `events.db` via `appendEvent()`, then
immediately projected onto `state.db` via `EventProjector.applyEvent()`. `EventPayload` (domain/
events.ts) is a single large discriminated union (~35 variants) covering every event type in the
system.

### 4.2 `EventEngine` — one class, four responsibilities

`EventEngine.ts` is the largest file in the backend (463 lines) and the busiest: its public
`emitEvent()` is the single entry point every route calls to record something happening, and it
sequentially:

1. Writes + projects the event (`writeEvent`).
2. Runs matching **automation rules** (`runAutomations`) — evaluates each rule's conditions
   against the affected issue, executes its actions if they pass.
3. Runs matching **agents** (`runAgents`) — for each enabled agent attached to the issue, checks
   budget/self-trigger/event-filter, then calls into the agent decision pipeline.
4. Fires matching **webhooks** (`dispatchWebhooks`) — fire-and-forget HTTP POST, signed with
   HMAC, errors only logged.

All three reactive systems (automations, agents, webhooks) share one `EventSubscription` shape
(`eventFilter: EventType[] | '*'`) from `domain/subscription.ts`, and automations/agents further
share one `AutomationAction` discriminated union (`transitionStatus | assignTo | addComment |
setField`) as their entire vocabulary for mutating state — `EventEngine.applyAction()` is the one
place that actually executes an action, called identically whether the actor was a rule or an
agent.

Explicitly **not recursive**: actions applied here go through `writeEvent()` (append + project)
but not back through `emitEvent()`, so an automation-authored comment does not itself re-trigger
automations/agents/webhooks. This is a documented, deliberate limitation (no multi-hop chaining,
no cycle detection) rather than an oversight — but it does mean "does event A eventually cause
event B" is not something the system can answer for chains longer than one hop.

### 4.3 Agent decision pipeline

For an agent whose `eventFilter`/budget/attachment checks pass, `startAgentRun()`:
1. Calls `decideAgentActions()`, which builds a system prompt + tool list from the agent's
   config (allowed action types -> `ACTION_TOOLS`, a hardcoded `Record<ActionType, Tool>`) and
   recent context (comments, prior runs on this issue), then resolves the agent's runtime via
   `agentRuntimes.resolve(agent.runtime)` and calls `.decide()` — see §6.
2. Filters the proposed actions down to `allowedActionTypes` and `budget.maxActionsPerRun`.
3. Decides whether the result needs human approval, per `approvalPolicy` (a 3-way union:
   auto-apply all / require approval for all / require approval for a specific action-type
   subset).
4. Either executes immediately (`executeAgentRun`) or parks the `AgentRun` as
   `'awaitingApproval'` for a human to resolve later via `resolveAgentRun()`.

`AgentRun` is a persisted record (not just an event) with its own status machine (`pending |
awaitingApproval | applied | rejected | failed`) — this is a second piece of state tracking
"what did this agent do," alongside the event log that also recorded every step of it.

### 4.4 Condition/action evaluation is closed-union + switch, not pluggable

`evaluateCondition()` (operators: `= != in notIn > < contains isEmpty`) and `applyAction()`
(action types: `transitionStatus assignTo addComment setField`) are both plain `switch`
statements over closed, hardcoded unions defined in `domain/automation.ts`. Extending either
means editing this switch and the corresponding domain type — there is no registry/strategy
pattern here, in explicit contrast to §6's `GitProvider`/`AgentRuntime`, which are.

---

## 5. Routes layer

Ten Hono sub-routers (`routes/*.ts`), each mounted at `/api` in `app.ts`. Route handlers are
generally thin: parse/validate the body, call one or two repository/service methods, call
`engine.emitEvent()` for anything that should be logged, return JSON. `issues.ts` (408 lines) is
the largest, covering issue CRUD, comments (incl. mention detection, see below), links, worklogs,
attachments, and git-branch creation — arguably a candidate for splitting given its breadth
relative to every other router.

One inline route lives directly in `app.ts` rather than a router file: `GET /api/bootstrap`,
which fetches ~20 lists in parallel (`Promise.all`) and returns them as one big payload — the
entire app's initial state in a single round trip. There is no incremental/paginated loading
anywhere; every list (issues, comments, worklogs, attachments, for the *whole* active project)
comes back in this one response.

### Mention detection

`POST /issues/:id/comments` parses `@Full Name` mentions out of the comment body via
`domain/mentions.ts`'s `parseMentionedUserIds()` (matched against live user display names, not
stored mention ids — a rename doesn't retroactively fix old mentions) and emits one
`comment.mentioned` event per mentioned user, in addition to the `comment.created` event.

The frontend's markdown renderer (`app/src/lib/util.ts`'s `highlightMentions`) needs the same
match rule to style mentions for display, and now calls the same underlying matcher —
`domain/mentions.ts` exports `replaceMentions(text, users, replace)`, the shared core both
`parseMentionedUserIds` (collects matched user ids) and `highlightMentions` (wraps each match in
a styled `<span>`) are built on. This wasn't always the case: an earlier version of both this
document and the code had the frontend re-deriving its own copy of the same regex, which an
external review caught as unforced duplication (§10) — two independently-maintained patterns
for "what counts as a mention" that happened to agree rather than one pattern both used.

---

## 6. The two extension points

Two places in the backend are explicitly designed as pluggable seams rather than closed
implementations. They no longer share a common base class (see §0's correction) — each is a
small, independent register/resolve `Map` behind its own interface.

### 6.1 `GitProvider` (git hosting)

`services/GitProvider.ts` defines `GitProvider` (`{ id: string; verifyAccess(); createBranch()
}`) and `GitProviderRegistry` — its own ~25-line class wrapping a private `Map<string,
GitProvider>`, with no relationship to `AgentRuntimeRegistry` beyond both existing. **Zero
implementations are registered** in `container.ts` — this app ships the interface and the empty
registry only. `GitRepoLink.provider` (domain/integrations.ts) is a plain `string`, not a
literal union, specifically so it isn't coupled to any specific host.

The route/DB/frontend surface around this (git-repo-link CRUD, the `Branch` domain model, the
Project Settings "Git" tab) predates this harness and works end-to-end at the storage layer
regardless of whether a provider is registered — only the parts that need to actually reach a
git host (`verifyAccess` on linking, `createBranch` on issue branch creation) depend on one
existing. `GET /api/git-providers` (routes/projects.ts) returns the registered ids so the
frontend knows upfront whether linking can possibly succeed; with none registered, the Git tab
shows an explicit "no provider is configured" state instead of a form that would always 400.

### 6.2 `AgentRuntime` (LLM backend)

`services/AgentRuntime.ts` defines `AgentRuntime` (`{ id: string; decide() }` — one method,
taking a model id / system prompt / user message / provider-neutral tool list, returning
proposed tool calls + free text + token usage) and its own independent `AgentRuntimeRegistry`.
Unlike git, **one implementation is shipped and registered by default**: `OllamaAgentRuntime`, a
plain-`fetch` HTTP client against a local Ollama server's `/api/chat` (`OLLAMA_HOST` env var, no
SDK dependency). `Agent.runtime` (domain/agent.ts) defaults to `'ollama'` at the mapping layer
for rows predating the field. `GET /api/agent-runtimes` (routes/agents.ts) exposes what's
registered the same way §6.1's `GET /api/git-providers` now does.

`EventEngine.ts` holds zero references to any concrete model SDK — it only ever calls
`this.agentRuntimes.resolve(agent.runtime).decide(...)`. A previous implementation
(`AnthropicAgentRuntime`, using `@anthropic-ai/sdk`) was built, registered, then deliberately
removed entirely (not merely unregistered) per a decision that this app should ship zero
hosted-provider dependency by default — a second/cloud backend is meant to arrive later as a
third-party registration, not as part of this codebase.

### 6.3 Asymmetry between the two extension points

Git ships nothing; agents ship one working implementation. This is an intentional, and now
consistently-supported, asymmetry rather than an inconsistency in a shared mechanism — both
sides expose the same discovery endpoint shape (`GET /api/{git-providers,agent-runtimes}`) and
both frontends gate their forms on it identically (auto-hide the choice with exactly one option,
show an honest empty/locked state with zero, offer a real dropdown with more than one). What
differs is only which one ships a default — a product decision (agents need to work out of the
box; git integration is optional and host-specific), not a structural gap between the two.

---

## 7. Dependency injection: manual, not framework-based

`container.ts` is the entire DI story: module-level `let` bindings for every repository/service,
filled in by one `initContainer()` function called once at boot, after `initDatabases()` (a
build-order dependency enforced only by comment/convention, not the type system). Every route
file imports the singletons it needs directly from `./container` — there is no request-scoped
container, no interface-based injection at the route layer (routes depend on concrete repository
classes, not interfaces), and no test-time override mechanism visible in this codebase.

`server/src/domain.ts` is a re-export shim with a specific, documented gotcha: a plain `export *`
chain from `domain/index.ts` silently drops runtime function values (not types) when loaded
through `tsx`'s dev-time module loader, so every actual function the domain package exports
(`slugifyBranchName`, `parseMentionedUserIds`, `STORY_POINT_VALUES`, `PROJECT_COLORS`,
`DEFAULT_FEATURE_FLAGS`) has to be re-exported a second time, explicitly, by name, in this file.
Forgetting to add a new one here after adding it to `domain/` fails silently at runtime rather
than at compile time — `tsc` type-checks against the type declarations regardless of whether the
runtime binding actually exists.

---

## 8. Auth

Stateless: `POST /auth/login`/`signup` issue a JWT (`auth/jwt.ts`); `requireAuth` middleware
(`auth/middleware.ts`) validates the `Authorization: Bearer` header and attaches the resolved
`User` to Hono's context on every `/api/*` route except the public auth router. No refresh
tokens, no sessions table, no revocation list — a JWT is valid until it expires, full stop. The
signing secret (`auth/secret.ts`) is either `JWT_SECRET` from the environment or a random value
generated once and persisted to a file next to the two SQLite databases (so restarts don't
invalidate every issued token in dev, but there's no rotation story).

Credentials live in a separate `credentials` table (`db/schema.ts`) from `users`, specifically so
`SELECT * FROM users` (which feeds straight into API responses via `rowToUser`) can never leak a
password hash by accident — a structural rather than convention-based guarantee.

---

## 9. Things a reviewer should probably look at first

Flagging these not as conclusions but as the places most likely to contain what you're looking
for:

1. **Kysely + raw-SQL coexistence** (§2.2) — an acknowledged incomplete migration. Worth asking
   whether it's actively converging or has stalled.
2. **`agentParams()` dead code** (§3) — confirmed unused, trivial to verify/delete.
3. **`EventEngine`'s four responsibilities in one class** (§4.2) — automations, agents, webhooks,
   and the write path itself are all one 463-line file. Whether that's cohesion (they're all
   "react to an event") or a god-object depends on how independently each has changed/will
   change.
4. **Git harness ships nothing usable** (§6.1) — a fully-built route/DB/frontend surface gated on
   an extension that doesn't exist, vs. Agents shipping a real default. The frontend/route-level
   harm (a form that always fails with no warning) was fixed post-review via a discovery
   endpoint (§0, §6.1) — but the deeper question stands: is shipping this surface at all ahead of
   any implementation the right MVP shape, or should Git have gotten the same "ship one honest
   default" treatment Agents did, with the route/UI arriving alongside the first real provider
   instead of before it?
5. **No migration versioning** (§2.3) — idempotent `CREATE TABLE IF NOT EXISTS` +
   `addColumnIfMissing` + four hand-written one-shot backfill functions is a lot of bespoke
   machinery in place of a single migrations table with a version counter.
6. **`GET /api/bootstrap` is monolithic** (§5) — every list for the active project, unpaginated,
   in one response. Fine at prototype data volumes; worth asking where it stops being fine.
7. **DI has no seams for testing** (§7) — module-level singletons with no override path mean any
   future test suite either instantiates the whole container or doesn't test through it.

---

## 10. Addendum: response to external review

This document was reviewed by another model against the prompt in the repo's chat history, across
two passes. Three of its findings were acted on directly rather than merely noted:

1. **"`GitProvider` harness contradicts the document's own stated philosophy"** — correct. §0's
   original "abstraction is earned by a second case, not introduced ahead of one" claim didn't
   hold for `GitProvider`'s route/schema/UI, which were built with zero implementations behind
   them. Resolved by adding `GET /api/git-providers` (mirroring the pre-existing `GET
   /api/agent-runtimes`) so the frontend can detect and honestly reflect "nothing is registered"
   instead of presenting a form guaranteed to fail — closing the actual harm — while leaving the
   harness code itself in place, since the reviewer's stronger alternative (delete the
   route/schema/UI entirely until a provider exists) would have discarded working, independently
   -justified infrastructure (`GitRepoLink`/`Branch`) to fix what was really a discoverability gap.
   §9 item 4 still leaves open whether that's the right call.
2. **"`ExtensionRegistry<T>` — premature generalization from a sample size of two"** — correct
   and fully accepted. The shared base added a layer of indirection to avoid duplicating a
   ~15-line `Map` wrapper twice. Removed outright: `GitProviderRegistry` and
   `AgentRuntimeRegistry` are now independent classes with no common ancestor (§6.1, §6.2).
3. **"Mention-detection duplication — the doc's own §9 list missed it"** — correct. §5 previously
   described the frontend's mention highlighting as "shared in intent, though not in code" with
   the server's `parseMentionedUserIds` — which was a euphemism for "these are two separately
   -maintained regexes that happen to agree." Since `domain/` is already imported by both server
   and frontend (§1) there was no structural reason for the duplication. Fixed by extracting the
   shared matcher itself — `domain/mentions.ts`'s `replaceMentions(text, users, replace)` — and
   having both `parseMentionedUserIds` (server-side detection) and the frontend's
   `highlightMentions` (display) call it directly instead of each deriving their own copy of the
   pattern (§5).

This section exists so the document's own history stays visible rather than quietly rewritten —
§0, §5, and §6 above describe the corrected state, not the original claims.
