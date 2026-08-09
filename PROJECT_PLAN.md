# Anvil — Master Project Plan

Status: **draft for review**. This is the whole-project version of the same idea as `AGENTS_PLAN.md` — a stable target we build against once you sign off. Section numbers are stable references for feedback ("change 4.3", "cut 6"). `AGENTS_PLAN.md` remains the detailed spec for the agent/automation subsystem specifically — §7 here summarizes and links it rather than duplicating it.

## 0. Vision (unchanged from the original ask)

A project-management / issue-tracking system more capable than Jira, minus third-party service integrations. Single workspace, event-driven, auditable, self-hosted-feeling. Built as Svelte 5 + Vite frontend, Hono backend, sql.js dual-database (state + event log).

## 1. Architecture — current state (stable, not up for debate unless you say otherwise)

- **Dual database**: `state.db` (read model, the source of truth entities query against) and `events.db` (durable, append-only, monotonically-sequenced event log) — two physically separate sql.js files, not just separate tables, on purpose (makes "audit the state against the log" a meaningful check). `server/src/audit.ts` does exactly that.
- **Event notification, not event sourcing.** Entities in `state.db` are the source of truth; `events.db` is a side-channel other things react to (automations, agents, webhooks). Every mutating route funnels through `emitEvent()` in `engine.ts`, which does, in order: append to the log → project the change into `state.db` → `runAutomations()` → `runAgents()` → `dispatchWebhooks()`.
- **Auth**: JWT bearer tokens, scrypt password hashing, `requireAuth` middleware gating everything except `/auth/signup`/`/auth/login`. Complete and working — see `server/src/auth/`.
- **No ORM yet** — raw SQL strings via hand-written `run`/`get`/`all` helpers in `server/src/db/core.ts`. A Kysely migration was **researched in depth in a prior session** (dialect adapter design, generated `Database` interface, migration order) but **zero code has been written** — no dependency installed, no files touched. Treat that research as a plan, not progress.

## 2. Domain model — current state

Complete and stable. Every subsystem below already has real domain types in `domain/`: workspace, project (+components, +versions), issue (+types, +links, +labels, +rich text), board (+filters, +saved views), planning/sprints, workflow (+statuses, +transitions, +post-functions), custom fields, collaboration (comments/attachments/watchers/worklogs), events (the full `EventPayload` union), user/auth, automation, agents, webhooks. `domain/subscription.ts`'s `EventSubscription` is the one shared contract (`eventFilter` + optional `schedule`) that automations, agents, and webhooks all implement — this is the load-bearing abstraction that makes "add a new kind of event listener" cheap, and it's already paying for itself across three subsystems.

No new domain types are anticipated in this plan except the one column noted in §7 (agent token-usage tracking). Any feature below that seems to need a new domain type is flagged as such explicitly.

## 3. Subsystem status matrix

| Subsystem | Status | Notes |
|---|---|---|
| Issues, board, backlog, sprints | **Real, working** | Full CRUD + drag-and-drop board + sprint planning UI exist and function. |
| Workflow (statuses/transitions) | **Real, working** | Configurable beyond Jira's fixed 3-category default, per original ask. |
| Custom fields | **Real, working** | Types, scoping, values on issues. |
| Comments / attachments / watchers / worklogs | **Real, working** | No delivered notifications on top of `Watcher` — see §5. |
| Automation rules (deterministic) | **Real, working** | CRUD + evaluation both implemented; UI for creating rules is narrow (see §6). |
| Agents (AI-driven) | **Real pipeline, stubbed brain** | See §7 — full plan already exists in `AGENTS_PLAN.md`. |
| Webhooks | **Real, working, both halves** | CRUD *and* actual outbound HTTP delivery with HMAC signing — more complete than you may remember; confirmed via `dispatchWebhooks` in `engine.ts`. |
| Notifications (in-app/email/etc.) | **Conceptual only — and deliberately not built this way** | See §5. Not a gap so much as a design decision already made and documented in `domain/notifications.ts` itself. |
| Drafts / private event logs | **Purely conceptual — zero code, zero types** | See §5. This is a real "start from nothing" item if you still want it. |
| Auth | **Real, working** | JWT bearer, signup/login, no regressions found. |
| DB layer (Kysely) | **Researched, not started** | See §8. |
| Frontend UI | **Real for core flows; several areas intentionally absent** | Roadmap/Reports/Docs nav removed as dead links (`REMOVED_UI.md`), not rebuilt. `FilterBar` deleted outright as decorative. |

## 4. What "done" looks like per subsystem — near-term priorities

This is the part most likely to need your feedback. Proposed order, each independently shippable:

1. **Agents** (`AGENTS_PLAN.md`) — the stub is the single highest-leverage gap: it's the one place "AI-powered" is currently fake. Everything around it (approval, budget, run lifecycle) already works.
2. **Automation-rule UI** (§6) — the backend already fully supports multi-action rules with conditions; the UI can currently only build a single-trigger, single-comment rule. Closing this is mostly frontend work against an API that already exists.
3. **Notifications** (§5) — a real decision point, not a code gap: decide whether the "webhooks are the only listener, delivery is the receiver's problem" design still matches what you want for in-app use, before writing anything.
4. **Kysely migration** (§8) — pure internal quality-of-life (type safety, catches the class of bug that already bit `planning.ts` once), no user-visible change. Good "do it when nothing user-facing is blocked on it" work.
5. **Drafts / private event logs** (§9) — biggest single new feature if you still want it; scoped last because it's genuinely new architecture (visibility scoping, merge semantics), not a gap in something half-built.

If you disagree with this ordering, that's exactly the feedback this doc is for.

## 5. Notifications and drafts — decisions needed, not just gaps

Both of these came up in earlier design conversations (an abstract `NotificationMedium` interface, private/mergeable event logs) but **neither exists in the codebase at all** — not partially, not as types-only. Worth being precise about why, since it changes what "finishing" them means:

- **Notifications**: `domain/notifications.ts` contains only `WebhookSubscription`, and its own doc comment explicitly says the domain **does not** model notification mediums or per-user delivery preferences — "a subscriber owns all of that itself once it's receiving events." This reads as a considered decision from an earlier session, not an oversight. **Question for you**: do you still want the abstract `NotificationMedium`/`NotificationPreference` design, or has "webhooks are the one external-listener primitive" superseded it? If you want it back, it's a from-scratch build (new domain types, a delivery pipeline, at least one real medium implementation e.g. in-app or email) — not a small addition.
- **Drafts / private event logs**: zero code, zero types, not started. If you still want this, it needs its own design pass (how does visibility scoping interact with the existing single global `events.db` sequence? what does "merge" mean operationally?) before implementation — this is not something to bolt onto the existing event log casually, given how much of the architecture (audit, automations, agents, webhooks) already assumes one linear, fully-visible sequence per workspace.

Recommend treating both as **explicit go/no-go decisions from you**, not default-yes backlog items, given the audit above shows less existing groundwork than you may have expected.

## 6. Automation-rule UI — closing the gap

Backend (`domain/automation.ts`, `server/src/routes/automations.ts`, `engine.ts`'s `runAutomations`) already fully supports: any `EventType` as trigger, an AND'd list of `AutomationCondition`s, and any combination of the 4 `AutomationAction` types per rule. `Settings.svelte`'s Automations tab currently only builds `{ conditions: [], actions: [{type: 'addComment', body}] }` off a single trigger picker — everything else requires calling the API directly.

Plan: extend the rule-builder form to expose conditions (field/op/value rows) and let the action list be any of the 4 types, matching what the API already accepts. No backend changes needed — this is a pure frontend task once prioritized.

## 7. Agents — see `AGENTS_PLAN.md` (summary only)

Full spec lives in that file; not duplicated here. One-paragraph summary for this document's completeness: the run lifecycle (pending → awaitingApproval/applied/rejected/failed), budget rate-limiting, and approval gating are all real and correct. The single gap is `decideAgentActions()` in `engine.ts`, a hardcoded stub ("if Bug, propose one comment") standing in for a real model call. The plan is to replace it with an Anthropic Messages API tool-use call, one tool per `AutomationAction` variant, gated by each agent's `allowedActionTypes`. No MCP — the tool surface is your own closed 4-action enum, not something that needs a protocol built for external tool exposure. That plan also flags a UI gap (agent config fields are hardcoded client-side, not editable per agent) worth closing in the same pass.

## 8. Kysely migration — see prior research (summary only)

Researched but not started: zero `kysely` dependency, zero files touched. The prior research covered a custom sql.js dialect adapter (via the `kysely-generic-sqlite` package or a ~20-line vendored adapter), a hand-written `Database` type interface per table, and a file-by-file migration order (`db/core.ts` → `queries.ts` → `projector.ts` → routes, smallest-risk-first). This is pure internal type-safety work with no user-visible behavior change — good candidate for a quiet week between feature pushes, not urgent. Re-confirm the plan is still wanted before starting, since a session has passed since the research.

## 9. Drafts / private event logs — if pursued

Placeholder section — deliberately not spec'd yet per §5's "decision needed" framing. If you confirm you want this built, the next step is a dedicated design pass (its own plan document, likely) covering: how a private/draft event log relates to the existing single-sequence `events.db`, what visibility scoping means for automations/agents/webhooks that currently assume full visibility, and what "merge into the main log" does to sequence numbers and anything that's already read past the merge point. Not estimating implementation until that design exists.

## 10. Open questions for your feedback

- Does the priority order in §4 match what you actually want next, or should something jump the queue (e.g. drafts, if that's been on your mind more than the audit suggests)?
- Notifications (§5): keep the current "webhooks only, delivery is the receiver's problem" design, or resurrect the `NotificationMedium` abstraction as a real in-app feature?
- Drafts (§9): still wanted at all, and if so, does a private/scoped event log need to coexist with the current single global sequence, or would a different mechanism (e.g. issue-level draft state instead of a whole separate log) serve the same need with less architectural disruption?
- Any subsystem in §3 you consider *not* actually done that I've marked as real/working — this survey was thorough but automated, worth a sanity check against your own sense of what's solid.

## 11. Known future UI work (flagged, not scheduled)

- **Issue-level Activity/history tab.** When viewing an issue, there should eventually be a section showing that issue's update history (status changes, field edits, assignment changes, etc.) — a real UI over the existing event log (`events.db` already has every `issue.*` event needed; this is a query + rendering task, not new data). Explicitly deferred — noted here so it isn't lost, not being built yet.
- **Workspace membership** (`server/src/routes/workspace.ts`, `WorkspaceView.svelte`) shipped: every signup gets a `workspace_members` row (first-ever signup is `owner`, everyone else `member`), with a `WorkspaceView` screen (click "My Workspace" in the sidebar) listing members and letting owners/admins change roles inline. No invite flow yet — membership is assigned automatically at signup, not granted by an admin. Worth a proper invite-by-email flow if the workspace ever needs a member who isn't self-signing-up.
