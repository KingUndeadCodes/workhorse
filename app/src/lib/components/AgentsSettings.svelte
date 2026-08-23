<script lang="ts">
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import AgentForm from './AgentForm.svelte';
  import { agentRuns, agents, fieldDefinitions, issuesStore, users, workflow } from '../stores/workspace';
  import * as api from '../api';
  import { agentRunStatusLabel, describeAutomationAction, formatRelativeDate, formatTokenCount, recentRunsForAgent, totalTokensForAgent } from '../util';
  import { locale, t, tn } from '../i18n';
  import type { Agent, AgentRun, AutomationAction, EventType } from '$domain';

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
    const { agent, user } = await api.createAgent(values);
    agents.update((l) => [...l, agent]);
    // Without this, the new agent is invisible to assignee pickers and @mention autocomplete
    // (both read `users`, not `agents`) until the next full reload.
    users.update((l) => [...l, user]);
  }

  async function saveAgent(userId: string, values: Omit<Agent, 'userId' | 'workspaceId' | 'projectId' | 'enabled' | 'createdAt'>) {
    const agent = await api.updateAgent(userId, values);
    agents.update((l) => l.map((a) => (a.userId === userId ? agent : a)));
    // PATCH /agents/:userId keeps User.displayName in sync with Agent.name server-side, but that
    // updated User row isn't part of this response — mirror the rename here too, or every other
    // surface reading `users` (chips, comment authors, @mentions) stays stale until next reload.
    users.update((l) => l.map((u) => (u.id === userId ? { ...u, displayName: agent.name } : u)));
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

  function recentRunsFor(agentUserId: string): AgentRun[] {
    return recentRunsForAgent(agentUserId, $agentRuns);
  }

  function totalTokensFor(agentUserId: string): number {
    return totalTokensForAgent(agentUserId, $agentRuns);
  }

  $: statusLabel = (status: AgentRun['status']) => agentRunStatusLabel(status, $t);

  const emptyDraft = () => ({
    name: '',
    description: '',
    runtime: 'ollama',
    model: 'llama3.1',
    contextScope: 'ticket' as Agent['contextScope'],
    eventFilter: ['issue.created'] as EventType[],
    allowedActionTypes: ['addComment'] as AutomationAction['type'][],
    approvalPolicy: { mode: 'autoApplyAll' as const },
    budget: {},
    ignoreSelfTriggeredEvents: true,
  });
</script>

{#if pendingRuns.length}
  <div class="subsection-label">{$t('agentsSettings.awaitingApproval')}</div>
  <div class="pending-list">
    {#each pendingRuns as run (run.id)}
      {@const agent = $agents.find((a) => a.userId === run.agentUserId)}
      {@const runIssue = $issuesStore.find((i) => i.id === run.issueId)}
      <div class="pending-card">
        <div class="pending-head">
          <Avatar userId={run.agentUserId} name={agent?.name ?? run.agentUserId} kind="agent" size={20} />
          <span class="agent-name">{agent?.name ?? run.agentUserId}<span class="ai-badge">{$t('agentsSettings.aiBadge')}</span></span>
          {#if runIssue}<span class="issue-key mono">{runIssue.key}</span>{/if}
          <span class="run-time">{formatRelativeDate(run.startedAt, $t, $tn, $locale)}</span>
        </div>
        {#if run.rationale}<p class="rationale">{run.rationale}</p>{/if}
        {#if run.proposedActions.length}
          <ul class="proposed-actions">
            {#each run.proposedActions as action}
              <li>{describeAutomationAction(action, { workflow: $workflow, users: $users, fieldDefinitions: $fieldDefinitions }, $t)}</li>
            {/each}
          </ul>
        {/if}
        <div class="pending-actions">
          <button class="text-btn" on:click={() => approveRun(run.id)}>{$t('agentsSettings.approveButton')}</button>
          <button class="text-btn danger" on:click={() => rejectRun(run.id)}>{$t('agentsSettings.rejectButton')}</button>
        </div>
      </div>
    {/each}
  </div>
{/if}

<div class="subsection-label">{$t('agentsSettings.agentsLabel')}</div>
<p class="section-hint">{$t('agentsSettings.hint')}</p>

{#if $agents.length === 0}
  <div class="empty-state">
    <Icon name="robot" size={28} />
    <p>{$t('agentsSettings.noAgentsYet')}</p>
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
            <span class="agent-name">{agent.name}<span class="ai-badge">{$t('agentsSettings.aiBadge')}</span><span class="status-dot" class:enabled={agent.enabled}></span></span>
            <span class="agent-instructions">{agent.description ?? ''}</span>
          </div>
          <span class="model-chip mono">{agent.model}</span>
          {#if totalTokensFor(agent.userId) > 0}
            <span class="model-chip mono" title={$t('agentsSettings.totalTokensTitle')}>{formatTokenCount(totalTokensFor(agent.userId))} tok</span>
          {/if}
          <label class="toggle">
            <input
              type="checkbox"
              checked={agent.enabled}
              on:click|stopPropagation
              on:change={(e) => toggleAgent(agent.userId, (e.target as HTMLInputElement).checked)}
            />{$t('settings.enabledLabel')}
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
                contextScope: agent.contextScope,
                eventFilter: Array.isArray(agent.eventFilter) ? agent.eventFilter : [],
                allowedActionTypes: agent.allowedActionTypes,
                approvalPolicy: agent.approvalPolicy,
                budget: agent.budget,
                ignoreSelfTriggeredEvents: agent.ignoreSelfTriggeredEvents,
              }}
              submitLabel={$t('agentsSettings.saveButton')}
              onSubmit={(values) => saveAgent(agent.userId, values)}
              onCancel={() => (expandedAgentId = null)}
            />

            {#if recent.length}
              <div class="subsection-label">{$t('agentsSettings.recentActivity')}</div>
              <div class="run-list">
                {#each recent as run (run.id)}
                  <div class="run-row">
                    <span class="run-status status-{run.status}">{statusLabel(run.status)}</span>
                    <span class="run-summary">
                      {run.proposedActions.length ? run.proposedActions.map((a) => describeAutomationAction(a, { workflow: $workflow, users: $users, fieldDefinitions: $fieldDefinitions }, $t)).join('; ') : '—'}
                    </span>
                    {#if run.tokenUsage}<span class="run-tokens mono">{formatTokenCount(run.tokenUsage)} tok</span>{/if}
                    <span class="run-time">{formatRelativeDate(run.startedAt, $t, $tn, $locale)}</span>
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

<div class="subsection-label">{$t('agentsSettings.addAgentLabel')}</div>
<AgentForm {availableRuntimes} initial={emptyDraft()} submitLabel={$t('agentsSettings.addAgentButton')} onSubmit={createAgent} />

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

  @media (max-width: 767px) {
    /* .agent-card-head packs avatar/name/model-chip/token-chip/toggle/chevron into one row —
       fine with a mouse's precision and a wide desktop panel, but too many small tap targets
       crammed together on a phone. Wrapping instead of truncating harder keeps every control
       reachable rather than hiding the ones that lose the squeeze. */
    .agent-card-head { flex-wrap: wrap; padding: 13px 12px; gap: 8px 10px; }
    .agent-name { font-size: 13.5px; }
    /* .agent-info still shares its wrap "line" with the avatar unless forced to the full row
       width — otherwise it flex-shrinks to a sliver next to the avatar and its now-`normal`
       white-space wraps the description one character per line. */
    .agent-info { flex-basis: 100%; }
    .agent-instructions { white-space: normal; }
    .model-chip { font-size: 11px; padding: 4px 10px; }
    .toggle { font-size: 12.5px; }
    .toggle input[type="checkbox"] { width: 18px; height: 18px; }
    .pending-card { padding: 12px; }
    .pending-actions { gap: 18px; }
    .text-btn { padding: 6px 2px; font-size: 13px; }
    .run-row { flex-wrap: wrap; }
    .run-time { margin-left: 0; }
  }
</style>
