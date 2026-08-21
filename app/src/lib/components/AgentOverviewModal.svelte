<script lang="ts">
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import { agentRuns, currentView, fieldDefinitions, settingsJumpTab, users, workflow } from '../stores/workspace';
  import { agentRunStatusLabel, describeAutomationAction, formatRelativeDate, formatTokenCount, recentRunsForAgent, totalTokensForAgent } from '../util';
  import { locale, t, tn } from '../i18n';
  import type { Agent, AgentRun } from '$domain';

  export let agent: Agent;
  export let onClose: () => void;

  $: recentRuns = recentRunsForAgent(agent.userId, $agentRuns);
  $: totalTokens = totalTokensForAgent(agent.userId, $agentRuns);
  $: statusLabel = (status: AgentRun['status']) => agentRunStatusLabel(status, $t);

  function manageAgent() {
    currentView.set('settings');
    settingsJumpTab.set('Agents');
    onClose();
  }
</script>

<div class="backdrop" role="button" tabindex="0" on:click={onClose} on:keydown={(e) => e.key === 'Escape' && onClose()}>
  <div class="modal" on:click|stopPropagation on:keydown|stopPropagation role="dialog" aria-modal="true" aria-label={agent.name} tabindex="-1">
    <div class="modal-head">
      <span class="avatar-ring"><Avatar userId={agent.userId} name={agent.name} kind="agent" size={36} /></span>
      <div class="head-info">
        <span class="agent-name">{agent.name}<span class="ai-badge">{$t('agentsSettings.aiBadge')}</span><span class="status-dot" class:enabled={agent.enabled}></span></span>
        {#if agent.description}<p class="agent-description">{agent.description}</p>{/if}
      </div>
      <button type="button" class="icon-btn" on:click={onClose}><Icon name="x" /></button>
    </div>

    <div class="subsection-label">{$t('agentOverview.capabilitiesLabel')}</div>
    <div class="capability-grid">
      <div class="capability"><span class="capability-label">{$t('agentForm.runtimeLabel')}</span><span class="capability-value">{agent.runtime}</span></div>
      <div class="capability"><span class="capability-label">{$t('agentForm.modelLabel')}</span><span class="capability-value">{agent.model}</span></div>
      <div class="capability">
        <span class="capability-label">{$t('agentForm.contextScopeLabel')}</span>
        <span class="capability-value">{$t(`agentForm.contextScopes.${agent.contextScope}.label`)}</span>
      </div>
      <div class="capability"><span class="capability-label">{$t('agentForm.approvalLabel')}</span><span class="capability-value">{$t(`agentForm.${agent.approvalPolicy.mode}`)}</span></div>
    </div>

    <span class="capability-label">{$t('agentForm.allowedActionsLabel')}</span>
    <div class="chip-row">
      {#each agent.allowedActionTypes as type}<span class="tag-chip">{type}</span>{/each}
    </div>

    <span class="capability-label">{$t('agentForm.reactsToLabel')}</span>
    <div class="chip-row">
      {#each agent.eventFilter as eventType}<span class="tag-chip">{eventType}</span>{/each}
    </div>

    {#if agent.budget.maxRunsPerHour || agent.budget.maxRunsPerDay || agent.budget.maxActionsPerRun || agent.budget.maxSpendPerDay}
      <span class="capability-label">{$t('agentOverview.budgetLabel')}</span>
      <div class="chip-row">
        {#if agent.budget.maxRunsPerHour}<span class="tag-chip">{$t('agentForm.maxRunsPerHour')}: {agent.budget.maxRunsPerHour}</span>{/if}
        {#if agent.budget.maxRunsPerDay}<span class="tag-chip">{$t('agentForm.maxRunsPerDay')}: {agent.budget.maxRunsPerDay}</span>{/if}
        {#if agent.budget.maxActionsPerRun}<span class="tag-chip">{$t('agentForm.maxActionsPerRun')}: {agent.budget.maxActionsPerRun}</span>{/if}
        {#if agent.budget.maxSpendPerDay}<span class="tag-chip">{$t('agentForm.maxSpendPerDay')}: {agent.budget.maxSpendPerDay}</span>{/if}
      </div>
    {/if}

    <div class="subsection-label usage-label">
      {$t('agentOverview.usageLabel')}
      {#if totalTokens > 0}<span class="total-tokens mono">{formatTokenCount(totalTokens)} {$t('agentOverview.tokensSuffix')}</span>{/if}
    </div>
    {#if recentRuns.length === 0}
      <p class="no-activity">{$t('agentOverview.noActivityYet')}</p>
    {:else}
      <div class="run-list">
        {#each recentRuns as run (run.id)}
          <div class="run-row">
            <span class="run-status status-{run.status}">{statusLabel(run.status)}</span>
            <span class="run-summary">
              {run.proposedActions.length ? run.proposedActions.map((a) => describeAutomationAction(a, { workflow: $workflow, users: $users, fieldDefinitions: $fieldDefinitions }, $t)).join('; ') : '—'}
            </span>
            {#if run.tokenUsage}<span class="run-tokens mono">{formatTokenCount(run.tokenUsage)} tok</span>{/if}
            <span class="run-time">{formatRelativeDate(run.startedAt, $t, $tn, $locale)}</span>
          </div>
        {/each}
      </div>
    {/if}

    <div class="actions">
      <button type="button" class="btn ghost" on:click={manageAgent}>{$t('agentOverview.manageButton')}</button>
    </div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(10, 12, 18, 0.5); display: flex; align-items: center; justify-content: center; z-index: 50; }
  .modal { width: min(440px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow-y: auto; background: var(--surface); border-radius: 12px; box-shadow: var(--shadow-lg); padding: 20px; }

  .modal-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 16px; }
  .avatar-ring { display: flex; padding: 3px; border-radius: 50%; background: var(--agent-accent-soft); flex: 0 0 auto; }
  .head-info { flex: 1; min-width: 0; }
  .agent-name { display: flex; align-items: center; font-size: 14px; font-weight: 700; color: var(--text); }
  .agent-description { font-size: 12.5px; color: var(--text-3); margin: 4px 0 0; line-height: 1.5; }
  .ai-badge {
    display: inline-flex; align-items: center; font-size: 9px; font-weight: 700; letter-spacing: .03em;
    color: var(--agent-accent); background: var(--agent-accent-soft); border-radius: 4px; padding: 1px 5px; margin-left: 6px;
  }
  .status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-3); margin-left: 8px; flex: 0 0 auto; }
  .status-dot.enabled { background: var(--success); }
  .icon-btn { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 7px; color: var(--text-2); flex: 0 0 auto; }
  .icon-btn:hover { background: var(--surface-2); }

  .subsection-label { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-2); margin: 16px 0 8px; }
  .subsection-label:first-of-type { margin-top: 0; }
  .usage-label { display: flex; align-items: center; justify-content: space-between; }
  .total-tokens { font-size: 11px; font-weight: 600; color: var(--text-3); text-transform: none; letter-spacing: normal; }

  .capability-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; margin-bottom: 12px; }
  .capability { display: flex; flex-direction: column; gap: 2px; }
  .capability-label { display: block; font-size: 10.5px; font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: .03em; margin-bottom: 4px; }
  .capability-value { font-size: 12.5px; color: var(--text); }

  .chip-row { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 12px; }
  .tag-chip { font-size: 11px; color: var(--text-2); background: var(--surface-2); border: 1px solid var(--border); border-radius: 999px; padding: 3px 9px; }

  .no-activity { font-size: 12px; color: var(--text-3); font-style: italic; margin: 0; }
  .run-list { display: flex; flex-direction: column; gap: 4px; }
  .run-row { display: flex; align-items: center; gap: 10px; font-size: 12px; padding: 5px 0; }
  .run-status { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; border-radius: 5px; padding: 2px 7px; flex: 0 0 auto; }
  .run-status.status-applied { color: var(--success); background: var(--success-soft); }
  .run-status.status-rejected { color: var(--text-3); background: var(--surface); }
  .run-status.status-failed { color: var(--critical); background: var(--critical-soft); }
  .run-status.status-pending, .run-status.status-awaitingApproval { color: var(--warning); background: var(--warning-soft); }
  .run-summary { color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .run-tokens { font-size: 11px; color: var(--text-3); white-space: nowrap; flex: 0 0 auto; }
  .run-time { font-size: 11px; color: var(--text-3); white-space: nowrap; flex: 0 0 auto; }

  .actions { display: flex; justify-content: flex-end; margin-top: 18px; }
  .btn { font-size: 12.5px; font-weight: 600; padding: 8px 14px; border-radius: 7px; }
  .btn.ghost { color: var(--text-2); background: var(--surface-2); }

  @media (max-width: 640px) {
    .backdrop { align-items: flex-end; }
    .modal { width: 100%; max-height: calc(100vh - 60px); border-radius: 16px 16px 0 0; padding: 18px 16px calc(18px + env(safe-area-inset-bottom)); }
    .agent-name { font-size: 15px; }
    .capability-grid { grid-template-columns: 1fr; }
    .run-row { flex-wrap: wrap; }
    .btn { padding: 11px 16px; font-size: 13.5px; }
  }
</style>
