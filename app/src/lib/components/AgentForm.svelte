<script lang="ts">
  // Shared by AgentsSettings.svelte for both "create a new agent" (always visible at the
  // bottom) and "edit an existing agent" (expanded inline on its card) — same fields, same
  // validation, just a different initial value and submit handler.
  import type { Agent, AgentApprovalPolicy, AgentBudget, AutomationAction, EventType } from '$domain';
  import { t } from '../i18n';

  export let initial: {
    name: string;
    description: string;
    runtime: string;
    model: string;
    contextScope: Agent['contextScope'];
    eventFilter: EventType[];
    allowedActionTypes: AutomationAction['type'][];
    approvalPolicy: AgentApprovalPolicy;
    budget: AgentBudget;
    ignoreSelfTriggeredEvents: boolean;
  };
  export let submitLabel: string;
  export let onSubmit: (values: Omit<Agent, 'userId' | 'workspaceId' | 'projectId' | 'enabled' | 'createdAt'>) => Promise<void>;
  /** Only set in edit mode — lets the card collapse back without saving. */
  export let onCancel: (() => void) | undefined = undefined;
  /** Ids of every AgentRuntime actually registered on the server (see api.listAgentRuntimes). With one entry there's no real choice to make, so the Runtime field hides itself and locks to it; with several it becomes a dropdown of real options instead of free text guessing at a valid id. */
  export let availableRuntimes: string[] = [];

  const AGENT_MODELS = ['llama3.1', 'qwen2.5', 'mistral'];
  const CONTEXT_SCOPES: { value: Agent['contextScope']; key: string }[] = [
    { value: 'thread', key: 'thread' },
    { value: 'ticket', key: 'ticket' },
    { value: 'project', key: 'project' },
    { value: 'workspace', key: 'workspace' },
  ];
  const AGENT_ACTION_TYPES: AutomationAction['type'][] = ['transitionStatus', 'assignTo', 'addComment', 'setField', 'readRepoFile', 'writeRepoFile'];
  const EVENT_TRIGGER_OPTIONS: EventType[] = [
    'issue.created', 'issue.statusChanged', 'issue.resolved', 'issue.reopened', 'issue.assigneesChanged',
    'issue.priorityChanged', 'issue.labelsChanged', 'issue.dueDateChanged', 'comment.created', 'comment.mentioned', 'issue.updated',
  ];

  let name = initial.name;
  let description = initial.description;
  let runtime = initial.runtime;
  let model = initial.model;
  let contextScope = initial.contextScope;
  let eventFilter = [...initial.eventFilter];
  let allowedActionTypes = [...initial.allowedActionTypes];
  let approvalMode = initial.approvalPolicy.mode;
  let requireApprovalActionTypes = initial.approvalPolicy.mode === 'requireApprovalFor' ? [...initial.approvalPolicy.actionTypes] : [];
  let maxRunsPerHour = initial.budget.maxRunsPerHour?.toString() ?? '';
  let maxRunsPerDay = initial.budget.maxRunsPerDay?.toString() ?? '';
  let maxActionsPerRun = initial.budget.maxActionsPerRun?.toString() ?? '';
  let maxSpendPerDay = initial.budget.maxSpendPerDay?.toString() ?? '';
  let ignoreSelfTriggeredEvents = initial.ignoreSelfTriggeredEvents;
  let submitting = false;

  function toggleInArray<T>(arr: T[], value: T): T[] {
    return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
  }

  function buildApprovalPolicy(): AgentApprovalPolicy {
    if (approvalMode === 'requireApprovalFor') return { mode: 'requireApprovalFor', actionTypes: requireApprovalActionTypes };
    return { mode: approvalMode };
  }

  function buildBudget(): AgentBudget {
    const budget: AgentBudget = {};
    if (maxRunsPerHour.trim()) budget.maxRunsPerHour = Number(maxRunsPerHour);
    if (maxRunsPerDay.trim()) budget.maxRunsPerDay = Number(maxRunsPerDay);
    if (maxActionsPerRun.trim()) budget.maxActionsPerRun = Number(maxActionsPerRun);
    if (maxSpendPerDay.trim()) budget.maxSpendPerDay = Number(maxSpendPerDay);
    return budget;
  }

  // With exactly one registered runtime, there's no real choice — lock to it so nothing ever
  // asks the user to type or pick an id with only one valid answer.
  $: if (availableRuntimes.length === 1 && runtime !== availableRuntimes[0]) runtime = availableRuntimes[0];

  $: valid = name.trim() && description.trim() && runtime.trim() && allowedActionTypes.length > 0 && eventFilter.length > 0 && (approvalMode !== 'requireApprovalFor' || requireApprovalActionTypes.length > 0);

  async function submit() {
    if (!valid || submitting) return;
    submitting = true;
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim(),
        runtime: runtime.trim(),
        model,
        contextScope,
        eventFilter,
        allowedActionTypes,
        approvalPolicy: buildApprovalPolicy(),
        budget: buildBudget(),
        ignoreSelfTriggeredEvents,
      });
    } finally {
      submitting = false;
    }
  }
</script>

<form class="agent-form" on:submit|preventDefault={submit}>
  <input type="text" placeholder={$t('agentForm.namePlaceholder')} aria-label={$t('agentForm.namePlaceholder')} bind:value={name} />
  <input type="text" placeholder={$t('agentForm.instructionsPlaceholder')} aria-label={$t('agentForm.instructionsPlaceholder')} bind:value={description} />
  {#if availableRuntimes.length > 1}
    <label class="agent-form-label">
      {$t('agentForm.runtimeLabel')}
      <select bind:value={runtime}>
        {#each availableRuntimes as r}<option value={r}>{r}</option>{/each}
      </select>
    </label>
  {/if}
  <label class="agent-form-label">
    {$t('agentForm.modelLabel')}
    <input type="text" placeholder="llama3.1" list="agent-model-suggestions" bind:value={model} />
  </label>
  <label class="agent-form-label">
    {$t('agentForm.contextScopeLabel')}
    <select bind:value={contextScope}>
      {#each CONTEXT_SCOPES as s}<option value={s.value}>{$t(`agentForm.contextScopes.${s.key}.label`)} — {$t(`agentForm.contextScopes.${s.key}.hint`)}</option>{/each}
    </select>
  </label>

  <span class="agent-form-label">{$t('agentForm.reactsToLabel')}</span>
  <div class="check-grid">
    {#each EVENT_TRIGGER_OPTIONS as eventType}
      <label class="check-option">
        <input type="checkbox" checked={eventFilter.includes(eventType)} on:change={() => (eventFilter = toggleInArray(eventFilter, eventType))} />
        {eventType}
      </label>
    {/each}
  </div>

  <span class="agent-form-label">{$t('agentForm.allowedActionsLabel')}</span>
  <div class="check-grid">
    {#each AGENT_ACTION_TYPES as type}
      <label class="check-option">
        <input type="checkbox" checked={allowedActionTypes.includes(type)} on:change={() => (allowedActionTypes = toggleInArray(allowedActionTypes, type))} />
        {type}
      </label>
    {/each}
  </div>

  <span class="agent-form-label">{$t('agentForm.approvalLabel')}</span>
  <div class="approval-choices">
    <label class="radio-option">
      <input type="radio" name="approval-{initial.name}" value="autoApplyAll" checked={approvalMode === 'autoApplyAll'} on:change={() => (approvalMode = 'autoApplyAll')} />
      {$t('agentForm.autoApplyAll')}
    </label>
    <label class="radio-option">
      <input type="radio" name="approval-{initial.name}" value="requireApprovalForAll" checked={approvalMode === 'requireApprovalForAll'} on:change={() => (approvalMode = 'requireApprovalForAll')} />
      {$t('agentForm.requireApprovalForAll')}
    </label>
    <label class="radio-option">
      <input type="radio" name="approval-{initial.name}" value="requireApprovalFor" checked={approvalMode === 'requireApprovalFor'} on:change={() => (approvalMode = 'requireApprovalFor')} />
      {$t('agentForm.requireApprovalFor')}
    </label>
    {#if approvalMode === 'requireApprovalFor'}
      <div class="check-grid nested">
        {#each allowedActionTypes as type}
          <label class="check-option">
            <input type="checkbox" checked={requireApprovalActionTypes.includes(type)} on:change={() => (requireApprovalActionTypes = toggleInArray(requireApprovalActionTypes, type))} />
            {type}
          </label>
        {/each}
      </div>
    {/if}
  </div>

  <span class="agent-form-label">{$t('agentForm.budgetLabel')}</span>
  <div class="budget-grid">
    <label class="budget-field">{$t('agentForm.maxRunsPerHour')}<input type="number" min="1" placeholder="∞" bind:value={maxRunsPerHour} /></label>
    <label class="budget-field">{$t('agentForm.maxRunsPerDay')}<input type="number" min="1" placeholder="∞" bind:value={maxRunsPerDay} /></label>
    <label class="budget-field">{$t('agentForm.maxActionsPerRun')}<input type="number" min="1" placeholder="∞" bind:value={maxActionsPerRun} /></label>
    <label class="budget-field">{$t('agentForm.maxSpendPerDay')}<input type="number" min="0" step="0.01" placeholder="∞" bind:value={maxSpendPerDay} /></label>
  </div>

  <label class="check-option ignore-self-toggle">
    <input type="checkbox" bind:checked={ignoreSelfTriggeredEvents} />
    {$t('agentForm.ignoreSelfEvents')}
  </label>

  <div class="form-actions">
    <button type="submit" class="btn primary" disabled={!valid || submitting}>{submitting ? '…' : submitLabel}</button>
    {#if onCancel}<button type="button" class="btn ghost" on:click={onCancel}>{$t('common.cancel')}</button>{/if}
  </div>
  <datalist id="agent-model-suggestions">
    {#each AGENT_MODELS as m}<option value={m}></option>{/each}
  </datalist>
</form>

<style>
  .agent-form { display: flex; flex-direction: column; gap: 8px; max-width: 420px; }
  .agent-form > input {
    font: inherit; font-size: 12.5px; color: var(--text); background: var(--surface); border: 1px solid var(--border);
    border-radius: 7px; padding: 7px 9px;
  }
  .agent-form-label {
    display: flex; flex-direction: column; gap: 4px; font-size: 10.5px; font-weight: 600;
    letter-spacing: .04em; text-transform: uppercase; color: var(--text-3); margin-top: 4px;
  }
  .agent-form-label select, .agent-form-label input {
    font: inherit; font-size: 12.5px; text-transform: none; font-weight: 400; color: var(--text);
    background: var(--surface); border: 1px solid var(--border); border-radius: 7px; padding: 7px 9px;
  }
  .check-grid { display: flex; flex-wrap: wrap; gap: 8px; }
  .check-grid.nested { margin: 4px 0 0 22px; }
  .check-option { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text); }
  .approval-choices { display: flex; flex-direction: column; gap: 6px; }
  .radio-option { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text); }
  .budget-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .budget-field { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--text-3); }
  .budget-field input {
    font: inherit; font-size: 12.5px; color: var(--text); background: var(--surface); border: 1px solid var(--border);
    border-radius: 7px; padding: 6px 8px;
  }
  .ignore-self-toggle { margin-top: 2px; color: var(--text-2); }
  .form-actions { display: flex; gap: 8px; margin-top: 6px; }
  .btn { font-size: 12px; font-weight: 600; padding: 7px 14px; border-radius: 7px; }
  .btn.primary { color: var(--accent-on); background: var(--accent); }
  .btn.primary:disabled { opacity: .5; cursor: default; }
  .btn.ghost { color: var(--text-2); background: var(--surface-2); }

  @media (max-width: 767px) {
    .agent-form { max-width: none; gap: 12px; }
    .agent-form > input { padding: 10px 12px; font-size: 16px; }
    .agent-form-label select, .agent-form-label input { padding: 10px 12px; font-size: 16px; }
    .check-grid { gap: 12px 16px; }
    .check-option, .radio-option { font-size: 13.5px; gap: 8px; }
    .check-option input[type="checkbox"], .radio-option input[type="radio"] { width: 18px; height: 18px; }
    /* Two number-input columns were fine at desktop width; a phone-portrait budget field needs
       its full label visible next to the input, which the 1fr/1fr split didn't leave room for. */
    .budget-grid { grid-template-columns: 1fr; gap: 12px; }
    .budget-field input { padding: 9px 11px; font-size: 16px; }
    .form-actions { gap: 10px; }
    .btn { padding: 10px 16px; font-size: 13.5px; }
  }
</style>
