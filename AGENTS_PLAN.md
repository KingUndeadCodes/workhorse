# AI Agents — Long-Term Plan

Status: **draft for review**. This is the spec we build against once you sign off — treat it as "set in stone" until you tell me otherwise. Section numbers are stable references for feedback ("change 4.2", "cut 7").

## 0. What exists today (ground truth, not aspiration)

- `domain/agent.ts` — `Agent` (a `User` row with `kind: 'agent'` plus a behavior record: `allowedActionTypes`, `approvalPolicy`, `budget`, `eventFilter`, `ignoreSelfTriggeredEvents`), `AgentRun` (state machine: `pending → awaitingApproval|applied|rejected|failed`), `AgentApprovalPolicy` (`autoApplyAll` / `requireApprovalForAll` / `requireApprovalFor(actionTypes)`), `AgentBudget` (`maxRunsPerHour`, `maxRunsPerDay`, `maxActionsPerRun`, `maxSpendPerDay`).
- `domain/automation.ts` — the **entire** action vocabulary, shared by deterministic rules and agents alike: `transitionStatus`, `assignTo`, `addComment`, `setField`. Nothing else exists.
- `server/src/engine.ts` — the run lifecycle (`startAgentRun` / `executeAgentRun` / `resolveAgentRun` / `triggerAgentManually`), budget enforcement (`withinBudget`, only `maxRunsPerHour`/`maxRunsPerDay` actually rate-limited), and automation-rule evaluation (`runAutomations`) are all real and working. The **one and only stub** is `decideAgentActions(agent, issue)` — a hardcoded heuristic ("if Bug, propose one comment"), with a docstring explicitly inviting replacement: *"A real agent implementation replaces only this function's body with a model call — budget, approval, and execution around it stay the same."*
- Known structural gaps, already present before any agent work starts: automations/agents only fire on **issue-subject events** (`issueForEvent` gates both `runAutomations` and `runAgents`); actions taken by an automation/agent write events via `writeEvent` directly, **bypassing** `emitEvent`, so they never chain-trigger further automations/agents (no recursion, by design — not a bug to "fix" casually); `schedule` (cron) on `EventSubscription` has no implementation anywhere, not even a DB column; `AgentBudget.maxSpendPerDay` is defined but not enforced.
- UI gap: `Settings.svelte`'s Agents tab only lets you set `name`/`description`/`enabled` after creation; `eventFilter`/`allowedActionTypes`/`approvalPolicy`/`budget` are hardcoded client-side constants in the add-agent form. The Automations tab is similarly narrow (single trigger, single hardcoded `addComment` action, no conditions).

Everything in this plan is scoped around replacing `decideAgentActions` with a real model call, and closing the gaps that block that from being useful — not a rewrite of the run/budget/approval machinery, which already works.

## 1. Decision: no MCP for agent decision-making

The agent's job splits into "decide" (LLM call) and "do" (execute an `AutomationAction`, already implemented). Only "decide" is a candidate for MCP, and it doesn't need it: your tool surface **is** `AutomationAction['type']`, a closed, already-typed enum. MCP is a protocol for exposing tools to *external* clients (Claude Desktop, other people's agents) — irrelevant while the product has no third-party integration surface by design ("more powerful than Jira, minus service integrations").

**Decision:** implement agent decisions with the **Anthropic Messages API, tool use** (`@anthropic-ai/sdk`), where each of the 4 `AutomationAction` variants becomes one tool definition. Revisit MCP only if/when Anvil needs to expose its action surface to agents outside the app itself — out of scope here.

## 2. The decision loop — replacing `decideAgentActions`

Current signature: `decideAgentActions(agent: Agent, issue: Issue): AutomationAction[]`. Real version:

```ts
async function decideAgentActions(agent: Agent, issue: Issue, event: EventEnvelope): Promise<{ actions: AutomationAction[]; rationale: string }>
```

- **Becomes async** — the one structural change that ripples outward. `executeAgentRun`/`startAgentRun` in `engine.ts` must become `async`, and their callers (`triggerAgentManually`, the event-emission path in `emitEvent`, the route handlers in `agents.ts`) must `await` them. This is the single biggest mechanical change in the whole plan — flagged here so it's not a surprise mid-implementation.
- **Tool definitions generated from `AutomationAction`**, one-to-one, hand-written once (not codegen — 4 variants, stable, not worth machinery):
  - `transitionStatus` → tool with `toStatusId` (enum of the issue's workflow's valid transitions from its current status — **not** every status in the system, so the model can't propose an illegal transition)
  - `assignTo` → tool with `userId` (enum of workspace members, or "unassign")
  - `addComment` → tool with `body` (free text)
  - `setField` → tool with `fieldId` (enum of field definitions applicable to the issue's project) + `value` (typed per field's `FieldDefinition.type`)
  - Only tools where `action.type ∈ agent.allowedActionTypes` are included in the API call's `tools` array — this is a hard boundary, not a suggestion to the model. An agent literally cannot be offered a tool it isn't allowed to use.
- **System prompt** is built per-call, not stored on the `Agent` record (no field for it exists today, and it shouldn't — see §5 on why prompt text stays out of the DB row). It states: the issue's full current state (title, description, status, priority, assignee, labels, comments so far), the triggering event, and the agent's `description` field as its persona/purpose.
- **Model call**: single non-streaming `client.messages.create()` with `tool_choice: {type: "auto"}`, `max_tokens` sized for a handful of tool calls plus a short rationale (2000–4000 is plenty), `output_config.effort: "medium"` (this is judgment-and-formatting work, not deep reasoning — start here, tune later against real usage per `shared/model-migration.md` guidance). Model: `claude-haiku-4-5` by default — these are narrow, bounded, high-volume decisions, not open-ended agentic work; escalate to `claude-sonnet-5` only for agents whose `description` signals harder judgment (a per-agent `model` field is a fair v2 addition, not needed for v1).
- **Parsing the response**: walk `response.content`, collect every `tool_use` block into `AutomationAction[]` (validate each against its Zod-equivalent shape before trusting it — malformed tool input from the model is a `failed` run, not a crash), collect any `text` block as `rationale`. If `stop_reason === "refusal"`, the run goes straight to `failed` with the refusal category as `failureReason` — no retry, no fallback model (these are internal low-stakes decisions; a refusal on one is just "this run produced nothing," not worth the complexity of `fallbacks`).
- **Enforce `maxActionsPerRun` here**, truncating the model's proposed action list before it's stored — this closes the "defined but not a real limit" gap noted in §0 for that one field specifically (the two rate limits already work; this is the field that doesn't).

## 3. What does NOT change

- The run state machine (`pending → awaitingApproval|applied|rejected|failed`), `AgentApprovalPolicy` gating, `maxRunsPerHour`/`maxRunsPerDay` enforcement, the projector/event-log write path, and the approve/reject routes are all correct as-is and untouched.
- The non-recursive design (agent/automation actions don't re-trigger other agents/automations) stays. Revisit only as an explicit, separately-scoped future decision — chaining is a real architectural choice (loop prevention, depth limits) and doesn't belong bundled into "give agents a real brain."
- `schedule` (cron-triggered agents) stays unimplemented. Not part of this plan.

## 4. Cost and failure containment

New failure/cost surface that didn't exist when the decision was a hardcoded `if`:

- **API errors** (network, 5xx, rate limit) during `decideAgentActions` → run goes to `failed` with the SDK's typed exception message as `failureReason`. Use the SDK's built-in retry (`max_retries`, default 2) for transient failures; don't hand-roll retry logic.
- **Cost tracking**: log `usage.input_tokens`/`usage.output_tokens` per run onto the `AgentRun` row. This requires one new column (`token_usage TEXT`, JSON) — the only schema change this plan requires. `AgentBudget.maxSpendPerDay` enforcement (§2) reads a running daily sum from this column across an agent's runs; exact per-model pricing lookup happens in `engine.ts`, not hardcoded per call site.
- **No fallback models, no streaming** for agent decisions — these are backend, unattended, short calls; both add complexity with no user-facing payoff here (no one is watching a progress bar).

## 5. Deliberately out of scope for this plan

Listed explicitly so "set in stone" means the same thing to both of us — anything below is a separate future decision, not an oversight:

- **Per-agent system prompt / persona field.** `description` is reused as-is for v1. A dedicated prompt field is a real feature (needs UI, needs guardrails against prompt injection via issue content) — worth its own plan later, not bundled in.
- **MCP, in either direction** (Anvil-as-MCP-server, or agents-calling-external-MCP-servers) — see §1.
- **Event chaining / recursive automation triggering.**
- **Cron-scheduled agents** (`EventSubscription.schedule`).
- **Multi-turn / tool-loop agents** (an agent that calls a tool, sees a result, calls another tool in the same run). v1 is single-shot: one model call, one batch of proposed actions, done. This matches how `AgentRun.proposedActions` is already shaped (a flat list, not a transcript).
- **Streaming, fast mode, extended/adaptive-thinking tuning** for the decision call — start plain, add only if a real latency/quality problem shows up.

## 6. UI gaps this plan exposes (and whether to close them now)

Real agents make the existing UI gap in §0 more painful — right now every agent is created with the *same* hardcoded `eventFilter`/`allowedActionTypes`/`approvalPolicy`/`budget`, so "which actions can this agent take" is invisible and unconfigurable per agent. Recommend closing this **in the same pass** as the engine change, since an agent whose `allowedActionTypes` you can't see or edit is hard to trust with a real model behind it:

- Add the missing fields to the agent create/edit form in `Settings.svelte` (checkboxes for `allowedActionTypes`, a select for `approvalPolicy.mode`, number inputs for the two enforced budget fields).
- Surface `token_usage`/cost-so-far on the agent list once §4's column exists.

The Automations tab's narrowness (single trigger, single `addComment` action, no conditions) is a **pre-existing, separate** gap — not created by this plan, and not required to close before shipping real agents. Flagging it here only so it's a conscious deferral, not a forgotten one.

## 7. Rollout order

1. `decideAgentActions` → async model call, single agent's worth of tool definitions, no UI changes yet. Verify against one hand-created agent via the existing `POST /api/agents/:userId/trigger` route and curl — no frontend dependency needed to prove the loop works.
2. Wire `maxActionsPerRun` truncation and `token_usage` column + `maxSpendPerDay` enforcement.
3. Close the Settings.svelte agent-config gap (§6) so agents are actually configurable end-to-end through the UI.
4. Real end-to-end test: create an agent through the UI with a deliberately narrow `allowedActionTypes`, trigger it on a real issue, confirm it can't propose disallowed actions and that budget/approval gates behave.

## 8. Open questions for your feedback

- Default model per agent: Haiku 4.5 for all agents to start, or expose model choice in the agent form now instead of later?
- `requireApprovalFor(actionTypes)` UX: when a run mixes an auto-applied action and one needing approval, should the auto-applied one execute immediately and the rest wait, or does the whole run wait if *any* action needs approval? (Current `executeAgentRun` behavior should be confirmed against this before the model starts actually producing mixed batches — worth checking now rather than discovering it live.)
- Is single-shot (§5, no tool-loop) actually sufficient, or do you already have an agent use case in mind that needs the model to see a tool result before deciding its next action?
