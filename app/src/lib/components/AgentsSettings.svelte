<script lang="ts">
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import AgentForm from './AgentForm.svelte';
  import { agentRuns, agents, fieldDefinitions, issuesStore, users, workflow } from '../stores/workspace';
  import * as api from '../api';
  import { describeAutomationAction, formatRelativeDate } from '../util';
  import type { Agent, AgentRun, AgentRunStatus, AutomationAction, EventType } from '$domain';

  $: pendingRuns = $agentRuns.filter((r) => r.status === 'awaitingApproval');

  let availableRuntimes: string[] = [];
  api.listAgentRuntimes().then((r) => (availableRuntimes = r));

  let expandedAgentId: string | null = null;
  function toggleExpanded(userId: string) {
    expandedAgentId = expandedAgentId === userId ? null : userId;
  }

  async function toggleAgent(userId: string, enabled: boolean) {
    const agent = await api.updateAgent(userId, { enabled });
    agents.update((l) => l.map((a) => (a.userId === userId ? agent : a)));
  }

  async function createAgent(values: Omit<Agent, 'userId' | 'workspaceId' | 'projectId' | 'enabled' | 'createdAt'>) {
    const agent = await api.createAgent(values);
    agents.update((l) => [...l, agent]);
  }

  async function saveAgent(userId: string, values: Omit<Agent, 'userId' | 'workspaceId' | 'projectId' | 'enabled' | 'createdAt'>) {
    const agent = await api.updateAgent(userId, values);
    agents.update((l) => l.map((a) => (a.userId === userId ? agent : a)));
    expandedAgentId = null;
  }

  async function approveRun(id: string) {
    const { run } = await api.approveAgentRun(id);
    agentRuns.update((l) => l.map((r) => (r.id === id ? run : r)));
  }
  async function rejectRun(id: string) {
    const { run } = await api.rejectAgentRun(id);
    agentRuns.update((l) => l.map((r) => (r.id === id ? run : r)));
  }

  /** Last 5 runs for one agent, newest first — from the already-loaded `agentRuns` store, no extra fetch. */
  function recentRunsFor(agentUserId: string): AgentRun[] {
    return $agentRuns
      .filter((r) => r.agentUserId === agentUserId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 5);
  }

  /** All-time token usage across every run this agent has ever made — the same field `withinBudget` sums for `maxSpendPerDay` (server/src/services/EventEngine.ts), just not scoped to today here. */
  function totalTokensFor(agentUserId: string): number {
    return $agentRuns.filter((r) => r.agentUserId === agentUserId).reduce((sum, r) => sum + (r.tokenUsage ?? 0), 0);
  }

  function formatTokenCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return `${n}`;
  }

  const STATUS_LABEL: Record<AgentRunStatus, string> = {
    pending: 'Pending',
    awaitingApproval: 'Awaiting approval',
    applied: 'Applied',
    rejected: 'Rejected',
    failed: 'Failed',
  };

  const emptyDraft = () => ({
    name: '',
    description: '',
    runtime: 'ollama',
    model: 'llama3.1',
    eventFilter: ['issue.created'] as EventType[],
    allowedActionTypes: ['addComment'] as AutomationAction['type'][],
    approvalPolicy: { mode: 'autoApplyAll' as const },
    budget: {},
    ignoreSelfTriggeredEvents: true,
  });
</script>

{#if pendingRuns.length}
  <div class="subsection-label">Awaiting your approval</div>
  <div class="pending-list">
    {#each pendingRuns as run (run.id)}
      {@const agent = $agents.find((a) => a.userId === run.agentUserId)}
      {@const runIssue = $issuesStore.find((i) => i.id === run.issueId)}
      {@const onBehalfOf = $users.find((u) => u.id === runIssue?.agentAssignments?.[run.agentUserId])}
      <div class="pending-card">
        <div class="pending-head">
          <Avatar userId={run.agentUserId} name={agent?.name ?? run.agentUserId} kind="agent" size={20} />
          <span class="agent-name">{agent?.name ?? run.agentUserId}<span class="ai-badge">AI</span></span>
          {#if onBehalfOf}<span class="on-behalf-of">on behalf of {onBehalfOf.displayName}</span>{/if}
          {#if runIssue}<span class="issue-key mono">{runIssue.key}</span>{/if}
          <span class="run-time">{formatRelativeDate(run.startedAt)}</span>
        </div>
        {#if run.rationale}<p class="rationale">{run.rationale}</p>{/if}
        {#if run.proposedActions.length}
          <ul class="proposed-actions">
            {#each run.proposedActions as action}
              <li>{describeAutomationAction(action, { workflow: $workflow, users: $users, fieldDefinitions: $fieldDefinitions })}</li>
            {/each}
          </ul>
        {/if}
        <div class="pending-actions">
          <button class="text-btn" on:click={() => approveRun(run.id)}>Approve</button>
          <button class="text-btn danger" on:click={() => rejectRun(run.id)}>Reject</button>
        </div>
      </div>
    {/each}
  </div>
{/if}

<div class="subsection-label">Agents</div>
<p class="section-hint">
  Agents work tickets on a teammate's behalf — attach one to an issue (from the issue's AI Agents section) and it can
  comment, change status, reassign, or update fields as it makes progress, always attributed back to the human it's
  acting for. Its Instructions are what actually drive its decisions each time it's triggered.
</p>

{#if $agents.length === 0}
  <div class="empty-state">
    <Icon name="robot" size={28} />
    <p>No agents yet — create one below to start automating ticket work.</p>
  </div>
{:else}
  <div class="agent-list">
    {#each $agents as agent (agent.userId)}
      <div class="agent-card">
        <div
          class="agent-card-head"
          role="button"
          tabindex="0"
          on:click={() => toggleExpanded(agent.userId)}
          on:keydown={(e) => e.key === 'Enter' && toggleExpanded(agent.userId)}
        >
          <span class="avatar-ring"><Avatar userId={agent.userId} name={agent.name} kind="agent" size={30} /></span>
          <div class="agent-info">
            <span class="agent-name">{agent.name}<span class="ai-badge">AI</span><span class="status-dot" class:enabled={agent.enabled}></span></span>
            <span class="agent-instructions">{agent.description ?? ''}</span>
          </div>
          <span class="model-chip mono">{agent.model}</span>
          {#if totalTokensFor(agent.userId) > 0}
            <span class="model-chip mono" title="Total tokens used across every run">{formatTokenCount(totalTokensFor(agent.userId))} tok</span>
          {/if}
          <label class="toggle">
            <input
              type="checkbox"
              checked={agent.enabled}
              on:click|stopPropagation
              on:change={(e) => toggleAgent(agent.userId, (e.target as HTMLInputElement).checked)}
            />enabled
          </label>
          <Icon name={expandedAgentId === agent.userId ? 'chevup' : 'chevdown'} size={12} />
        </div>

        {#if expandedAgentId === agent.userId}
          {@const recent = recentRunsFor(agent.userId)}
          <div class="agent-card-body">
            <AgentForm
              {availableRuntimes}
              initial={{
                name: agent.name,
                description: agent.description ?? '',
                runtime: agent.runtime,
                model: agent.model,
                eventFilter: Array.isArray(agent.eventFilter) ? agent.eventFilter : [],
                allowedActionTypes: agent.allowedActionTypes,
                approvalPolicy: agent.approvalPolicy,
                budget: agent.budget,
                ignoreSelfTriggeredEvents: agent.ignoreSelfTriggeredEvents,
              }}
              submitLabel="Save"
              onSubmit={(values) => saveAgent(agent.userId, values)}
              onCancel={() => (expandedAgentId = null)}
            />

            {#if recent.length}
              <div class="subsection-label">Recent activity</div>
              <div class="run-list">
                {#each recent as run (run.id)}
                  <div class="run-row">
                    <span class="run-status status-{run.status}">{STATUS_LABEL[run.status]}</span>
                    <span class="run-summary">
                      {run.proposedActions.length ? run.proposedActions.map((a) => describeAutomationAction(a, { workflow: $workflow, users: $users, fieldDefinitions: $fieldDefinitions })).join('; ') : '—'}
                    </span>
                    {#if run.tokenUsage}<span class="run-tokens mono">{formatTokenCount(run.tokenUsage)} tok</span>{/if}
                    <span class="run-time">{formatRelativeDate(run.startedAt)}</span>
                  </div>
                  {#if run.failureReason}<p class="failure-reason">{run.failureReason}</p>{/if}
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<div class="subsection-label">Add agent</div>
<AgentForm {availableRuntimes} initial={emptyDraft()} submitLabel="Add agent" onSubmit={createAgent} />

<style>
  .subsection-label { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-2); margin: 18px 0 8px; }
  .subsection-label:first-child { margin-top: 0; }
  .section-hint { font-size: 12px; line-height: 1.5; color: var(--text-3); margin: 0 0 16px; max-width: 560px; }

  .ai-badge {
    display: inline-flex; align-items: center; font-size: 9px; font-weight: 700; letter-spacing: .03em;
    color: var(--agent-accent); background: var(--agent-accent-soft); border-radius: 4px; padding: 1px 5px; margin-left: 6px;
  }

  .empty-state {
    display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; color: var(--text-3);
    border: 1px dashed var(--border); border-radius: 10px; padding: 28px 16px; margin-bottom: 16px;
  }
  .empty-state p { margin: 0; font-size: 12.5px; max-width: 280px; }

  .agent-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
  .agent-card { background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  .agent-card-head { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; padding: 10px 12px; cursor: pointer; }
  .agent-card-head:hover { background: var(--surface-sunken); }
  .avatar-ring { display: flex; padding: 3px; border-radius: 50%; background: var(--agent-accent-soft); flex: 0 0 auto; }
  .agent-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .agent-name { display: flex; align-items: center; font-size: 12.5px; font-weight: 600; color: var(--text); }
  .agent-instructions { font-size: 11.5px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-3); margin-left: 8px; flex: 0 0 auto; }
  .status-dot.enabled { background: var(--success); }
  .model-chip { font-size: 10.5px; color: var(--text-2); background: var(--surface); border: 1px solid var(--border); border-radius: 999px; padding: 3px 9px; flex: 0 0 auto; }
  .toggle { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--text-3); white-space: nowrap; flex: 0 0 auto; }
  .agent-card-body { padding: 4px 14px 16px; border-top: 1px solid var(--border); }
  .agent-card-body :global(.agent-form) { margin-top: 12px; }

  .pending-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
  .pending-card { background: var(--warning-soft); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; }
  .pending-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .on-behalf-of { font-size: 11.5px; color: var(--text-3); }
  .issue-key { font-size: 11px; color: var(--text-2); background: var(--surface); border-radius: 5px; padding: 1px 6px; }
  .run-tokens { font-size: 11px; color: var(--text-3); white-space: nowrap; flex: 0 0 auto; }
  .run-time { font-size: 11px; color: var(--text-3); margin-left: auto; white-space: nowrap; }
  .rationale { font-size: 12px; color: var(--text-2); margin: 6px 0 0; }
  .proposed-actions { margin: 6px 0 0; padding-left: 18px; font-size: 12px; color: var(--text-2); }
  .pending-actions { display: flex; gap: 12px; margin-top: 8px; }
  .text-btn { font-size: 12px; font-weight: 600; color: var(--accent-strong); }
  .text-btn.danger { color: var(--critical); }

  .run-list { display: flex; flex-direction: column; gap: 4px; }
  .run-row { display: flex; align-items: center; gap: 10px; font-size: 12px; padding: 5px 0; }
  .run-status { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; border-radius: 5px; padding: 2px 7px; flex: 0 0 auto; }
  .run-status.status-applied { color: var(--success); background: var(--success-soft); }
  .run-status.status-rejected { color: var(--text-3); background: var(--surface); }
  .run-status.status-failed { color: var(--critical); background: var(--critical-soft); }
  .run-status.status-pending, .run-status.status-awaitingApproval { color: var(--warning); background: var(--warning-soft); }
  .run-summary { color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .failure-reason { font-size: 11.5px; color: var(--critical); margin: 0 0 4px; }
</style>
