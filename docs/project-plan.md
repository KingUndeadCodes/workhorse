# Workhorse — Master Project Plan

Status: **draft for review**. This is the whole-project version of the same idea as `AGENTS_PLAN.md` — a stable target we build against once you sign off. Section numbers are stable references for feedback ("change 4.3", "cut 6"). `AGENTS_PLAN.md` remains the detailed spec for the agent/automation subsystem specifically — §7 here summarizes and links it rather than duplicating it.

(Formerly called "Anvil" in early planning — the project and its docs now consistently use "Workhorse".)

## 0. Vision (unchanged from the original ask)

A project-management / issue-tracking system more capable than Jira, minus third-party service integrations. Single workspace, event-driven, auditable, self-hosted-feeling. Built as Svelte 5 + Vite frontend, Hono backend, sql.js dual-database (state + event log).

## 1. Architecture — current state (stable, not up for debate unless you say otherwise)

- **Dual database**: `state.db` (read model, the source of truth entities query against) and `events.db` (durable, append-only, monotonically-sequenced event log) — two physically separate sql.js files, not just separate tables, on purpose (makes "audit the state against the log" a meaningful check). `server/src/audit.ts` does exactly that.
- **Event notification, not event sourcing.** Entities in `state.db` are the source of truth; `events.db` is a side-channel other things react to (automations, agents, webhooks). Every mutating route funnels through `emitEvent()` in `engine.ts`, which does, in order: append to the log → project the change into `state.db` → `runAutomations()` → `runAgents()` → `dispatchWebhooks()`.
- **Auth**: JWT bearer tokens, scrypt password hashing, `requireAuth` middleware gating everything except `/auth/signup`/`/auth/login`. Complete and working — see `server/src/auth/`.
- **Kysely is the primary query layer.** The migration flagged as "researched, not started" in an earlier version of this doc is done: every repository in `server/src/repositories/*.ts` is built on `Kysely<DB>` (typed against `server/src/db/types.ts`), backed by a sql.js dialect. The old hand-written `run`/`get`/`all` helpers still exist in `server/src/db/core.ts`, but only as legacy plumbing used by `seed.ts`, `eventLog.ts`, and `db/schema.ts` — not general application code anymore.

## 2. Domain model — current state

Complete and stable. Every subsystem below already has real domain types in `domain/`: workspace, project (+components, +versions), issue (+types, +links, +labels, +rich text), board (+filters, +saved views), planning/sprints, workflow (+statuses, +transitions, +post-functions), custom fields, collaboration (comments/attachments/watchers/worklogs), events (the full `EventPayload` union), user/auth, automation, agents, webhooks/integrations. `domain/subscription.ts`'s `EventSubscription` is the one shared contract (`eventFilter` + optional `schedule`) that automations, agents, and webhooks all implement — this is the load-bearing abstraction that makes "add a new kind of event listener" cheap, and it's already paying for itself across three subsystems.

No new domain types are anticipated in this plan except whatever a real agent cloud-backend integration (§7) and/or drafts (§9) end up needing. Any feature below that seems to need a new domain type is flagged as such explicitly.

## 3. Subsystem status matrix

| Subsystem | Status | Notes |
|---|---|---|
| Issues, board, backlog, sprints | **Real, working** | Full CRUD + drag-and-drop board + sprint planning UI exist and function. |
| Workflow (statuses/transitions) | **Real, working** | Configurable beyond Jira's fixed 3-category default, per original ask. |
| Custom fields | **Real, working** | Types, scoping, values on issues. |
| Comments / attachments / watchers / worklogs | **Real, working** | Includes an issue-level Activity tab (`IssueDrawer.svelte`) over the event log. No delivered notifications on top of `Watcher` — see §5. |
| Automation rules (deterministic) | **Real, working, full UI** | Backend and UI both support multi-condition rules (`DraftCondition` over status/priority/type/assignee/labels) and all 4 action types — see §6. |
| Agents (AI-driven) | **Real pipeline, real local-LLM brain** | Runs through a provider-neutral `AgentRuntime` interface with a working `OllamaAgentRuntime` implementation (local Ollama). No cloud-model (Anthropic/OpenAI) backend yet — see §7. |
| Webhooks | **Real, working, both halves** | CRUD *and* actual outbound HTTP delivery with HMAC signing — confirmed via `dispatchWebhooks` in `engine.ts`. |
| Notifications (in-app/email/etc.) | **Conceptual only — and deliberately not built this way** | See §5. Not a gap so much as a design decision already made and documented in `domain/notifications.ts` itself. |
| Drafts / private event logs | **Purely conceptual — zero code, zero types** | See §5. "Draft" only exists today as local unsaved-input state in Svelte components (`draftComment` etc.) — unrelated to this feature. This is a real "start from nothing" item if you still want it. |
| Auth | **Real, working** | JWT bearer, signup/login, no regressions found. |
| DB layer (Kysely) | **Real, done** | See §8 — no longer a pending migration. |
| Workspace membership | **Real, working; no invite flow** | Every signup gets a `workspace_members` row (first signup = owner, rest = member); `WorkspaceView.svelte` lets owners/admins change roles. Membership is still assigned automatically at signup rather than granted by an admin — see §11. |
| Frontend UI | **Real for core flows; a few areas intentionally absent** | Roadmap/Reports/Docs nav removed as dead links (`removed-ui.md`), not rebuilt. `FilterBar` deleted outright as decorative. Multi-project sidebar and per-project switching, previously fake, are now real (`removed-ui.md` updated to drop that entry). |

## 4. What "done" looks like per subsystem — near-term priorities

This is the part most likely to need your feedback. Proposed order, each independently shippable:

1. **Agent cloud backend** (`AGENTS_PLAN.md`) — the local-Ollama `AgentRuntime` works, but a hosted-model option (Anthropic Messages API tool-use, one tool per `AutomationAction` variant) is the natural next step if you want stronger/faster agent reasoning than a local model gives you.
2. **Notifications** (§5) — a real decision point, not a code gap: decide whether the "webhooks are the only listener, delivery is the receiver's problem" design still matches what you want for in-app use, before writing anything.
3. **Drafts / private event logs** (§9) — biggest single new feature if you still want it; scoped last because it's genuinely new architecture (visibility scoping, merge semantics), not a gap in something half-built.
4. **Workspace invite flow** (§11) — membership currently only grows by self-signup; an admin-driven invite-by-email flow would be needed before this feels like a real multi-tenant workspace tool.

If you disagree with this ordering, that's exactly the feedback this doc is for.

## 5. Notifications and drafts — decisions needed, not just gaps

Both of these came up in earlier design conversations (an abstract `NotificationMedium` interface, private/mergeable event logs) but **neither exists in the codebase at all** — not partially, not as types-only. Worth being precise about why, since it changes what "finishing" them means:

- **Notifications**: `domain/notifications.ts` contains only `WebhookSubscription`, and its own doc comment explicitly says the domain **does not** model notification mediums or per-user delivery preferences — "a subscriber owns all of that itself once it's receiving events." This reads as a considered decision from an earlier session, not an oversight. **Question for you**: do you still want the abstract `NotificationMedium`/`NotificationPreference` design, or has "webhooks are the one external-listener primitive" superseded it? If you want it back, it's a from-scratch build (new domain types, a delivery pipeline, at least one real medium implementation e.g. in-app or email) — not a small addition.
- **Drafts / private event logs**: zero persisted code, zero types, not started. (The only "draft" hits in the codebase are unrelated local component state — unsaved comment/reply/description text in `IssueDrawer.svelte`/`CommentThread.svelte`.) If you still want this, it needs its own design pass (how does visibility scoping interact with the existing single global `events.db` sequence? what does "merge" mean operationally?) before implementation — this is not something to bolt onto the existing event log casually, given how much of the architecture (audit, automations, agents, webhooks) already assumes one linear, fully-visible sequence per workspace.

Recommend treating both as **explicit go/no-go decisions from you**, not default-yes backlog items.

## 6. Automation-rule UI — closed

Backend (`domain/automation.ts`, `server/src/routes/automations.ts`, `engine.ts`'s `runAutomations`) fully supports: any `EventType` as trigger, an AND'd list of `AutomationCondition`s, and any combination of the 4 `AutomationAction` types per rule. `Settings.svelte`'s Automations tab now matches: the rule-builder exposes conditions (status/priority/type/assignee/labels rows via `DraftCondition`/`CONDITION_FIELDS`) and lets the action list be any of `transitionStatus`/`assignTo`/`addComment`/`setField`/`readRepoFile`/`writeRepoFile`. This was previously flagged as a frontend gap ("UI can only build a single-trigger, single-comment rule") — that gap is now closed.

## 7. Agents — see `AGENTS_PLAN.md` (summary only)

Full spec lives in that file; not duplicated here. One-paragraph summary for this document's completeness: the run lifecycle (pending → awaitingApproval/applied/rejected/failed), budget rate-limiting, and approval gating are all real and correct. Agent decision-making now runs through `AgentRuntime` (`server/src/services/AgentRuntime.ts`), a provider-neutral interface, with `OllamaAgentRuntime` as a working local-LLM implementation — this replaces what was previously a hardcoded stub in `decideAgentActions()`. The remaining gap is a cloud-model backend (e.g. an Anthropic Messages API tool-use implementation of the same interface, one tool per `AutomationAction` variant, gated by each agent's `allowedActionTypes`) for anyone who wants a hosted model instead of local Ollama. No MCP — the tool surface is your own closed action enum, not something that needs a protocol built for external tool exposure.

## 8. Kysely migration — done

No longer pending. `kysely`/`kysely-wasm` are real dependencies (`server/package.json`), every repository under `server/src/repositories/` queries through `Kysely<DB>`, and `server/src/db/types.ts` is the hand-written `DB` type interface the earlier research proposed. The old raw-SQL `run`/`get`/`all` helpers in `db/core.ts` remain, but only for seed data, the event log, and schema/migration code — not general query code. No further action needed here; kept as a section for historical reference.

## 9. Drafts / private event logs — if pursued

Placeholder section — deliberately not spec'd yet per §5's "decision needed" framing. If you confirm you want this built, the next step is a dedicated design pass (its own plan document, likely) covering: how a private/draft event log relates to the existing single-sequence `events.db`, what visibility scoping means for automations/agents/webhooks that currently assume full visibility, and what "merge into the main log" does to sequence numbers and anything that's already read past the merge point. Not estimating implementation until that design exists.

## 10. Open questions for your feedback

- Does the priority order in §4 match what you actually want next — in particular, is a cloud agent backend (Anthropic/OpenAI) worth building now, or is local-Ollama good enough for the foreseeable future?
- Notifications (§5): keep the current "webhooks only, delivery is the receiver's problem" design, or resurrect the `NotificationMedium` abstraction as a real in-app feature?
- Drafts (§9): still wanted at all, and if so, does a private/scoped event log need to coexist with the current single global sequence, or would a different mechanism (e.g. issue-level draft state instead of a whole separate log) serve the same need with less architectural disruption?
- Workspace invites (§11): worth building an admin-driven invite-by-email flow, or is self-signup membership sufficient for how this is actually used?
- Any subsystem in §3 you consider *not* actually done that I've marked as real/working — this survey was thorough but automated, worth a sanity check against your own sense of what's solid.

## 11. Known future UI/product work (flagged, not scheduled)

- **Workspace invite flow.** `server/src/routes/workspace.ts` and `WorkspaceView.svelte` support real membership and role management, but membership is only ever granted by self-signup (first signup = owner, rest = member) — there's no admin-driven invite-by-email flow. Worth building if the workspace ever needs a member added by someone other than themselves.
- **Agent cloud backend.** See §7 — local Ollama works today; a hosted-model `AgentRuntime` implementation is the natural next increment, not yet started.
