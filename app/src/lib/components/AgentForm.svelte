<script lang="ts">
  // Shared by AgentsSettings.svelte for both "create a new agent" (always visible at the
  // bottom) and "edit an existing agent" (expanded inline on its card) — same fields, same
  // validation, just a different initial value and submit handler.
  import type { Agent, AgentApprovalPolicy, AgentBudget, AutomationAction, EventType } from '$domain';

  export let initial: {
    name: string;
    description: string;
    model: string;
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

  const AGENT_MODELS = ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5'];
  const AGENT_ACTION_TYPES: AutomationAction['type'][] = ['transitionStatus', 'assignTo', 'addComment', 'setField'];
  const EVENT_TRIGGER_OPTIONS: EventType[] = ['issue.created', 'issue.statusChanged', 'issue.assigneesChanged', 'comment.created', 'issue.updated'];

  let name = initial.name;
  let description = initial.description;
  let model = initial.model;
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

  $: valid = name.trim() && description.trim() && allowedActionTypes.length > 0 && eventFilter.length > 0 && (approvalMode !== 'requireApprovalFor' || requireApprovalActionTypes.length > 0);

  async function submit() {
    if (!valid || submitting) return;
    submitting = true;
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim(),
        model,
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
  <input type="text" placeholder="Agent name" bind:value={name} />
  <input type="text" placeholder="Instructions — what should this agent do with a ticket?" bind:value={description} />
  <label class="agent-form-label">
    Model
    <select bind:value={model}>
      {#each AGENT_MODELS as m}<option value={m}>{m}</option>{/each}
    </select>
  </label>

  <span class="agent-form-label">Reacts to</span>
  <div class="check-grid">
    {#each EVENT_TRIGGER_OPTIONS as t}
      <label class="check-option">
        <input type="checkbox" checked={eventFilter.includes(t)} on:change={() => (eventFilter = toggleInArray(eventFilter, t))} />
        {t}
      </label>
    {/each}
  </div>

  <span class="agent-form-label">Allowed actions</span>
  <div class="check-grid">
    {#each AGENT_ACTION_TYPES as type}
      <label class="check-option">
        <input type="checkbox" checked={allowedActionTypes.includes(type)} on:change={() => (allowedActionTypes = toggleInArray(allowedActionTypes, type))} />
        {type}
      </label>
    {/each}
  </div>

  <span class="agent-form-label">Approval</span>
  <div class="approval-choices">
    <label class="radio-option">
      <input type="radio" name="approval-{initial.name}" value="autoApplyAll" checked={approvalMode === 'autoApplyAll'} on:change={() => (approvalMode = 'autoApplyAll')} />
      Auto-apply everything
    </label>
    <label class="radio-option">
      <input type="radio" name="approval-{initial.name}" value="requireApprovalForAll" checked={approvalMode === 'requireApprovalForAll'} on:change={() => (approvalMode = 'requireApprovalForAll')} />
      Require approval for everything
    </label>
    <label class="radio-option">
      <input type="radio" name="approval-{initial.name}" value="requireApprovalFor" checked={approvalMode === 'requireApprovalFor'} on:change={() => (approvalMode = 'requireApprovalFor')} />
      Require approval only for…
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

  <span class="agent-form-label">Budget (optional — blank = unlimited)</span>
  <div class="budget-grid">
    <label class="budget-field">Max runs / hour<input type="number" min="1" placeholder="∞" bind:value={maxRunsPerHour} /></label>
    <label class="budget-field">Max runs / day<input type="number" min="1" placeholder="∞" bind:value={maxRunsPerDay} /></label>
    <label class="budget-field">Max actions / run<input type="number" min="1" placeholder="∞" bind:value={maxActionsPerRun} /></label>
    <label class="budget-field">Max spend / day<input type="number" min="0" step="0.01" placeholder="∞" bind:value={maxSpendPerDay} /></label>
  </div>

  <label class="check-option ignore-self-toggle">
    <input type="checkbox" bind:checked={ignoreSelfTriggeredEvents} />
    Ignore this agent's own events (recommended — prevents it retriggering itself)
  </label>

  <div class="form-actions">
    <button type="submit" class="btn primary" disabled={!valid || submitting}>{submitting ? '…' : submitLabel}</button>
    {#if onCancel}<button type="button" class="btn ghost" on:click={onCancel}>Cancel</button>{/if}
  </div>
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
  .agent-form-label select {
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
</style>
