<script lang="ts">
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import WorkflowDiagram from './WorkflowDiagram.svelte';
  import {
    agentRuns,
    agents,
    automationRules,
    components as componentsStore,
    fieldDefinitions,
    issuesStore,
    labels,
    settingsJumpTab,
    statusCategories,
    users,
    versions,
    webhookSubscriptions,
    workflow,
  } from '../stores/workspace';
  import * as api from '../api';
  import { displayName, splitHumansAndAgents } from '../util';
  import type { AutomationAction, AutomationCondition, EventType, FilterOp } from '$domain';

  const tabs = ['Labels', 'Components', 'Versions', 'Fields', 'Workflow', 'Automations', 'Agents', 'Webhooks'] as const;
  let activeTab: (typeof tabs)[number] = 'Labels';

  // Lets the TopBar "New…" menu open Settings already on the relevant tab (e.g. "New Label").
  if ($settingsJumpTab && (tabs as readonly string[]).includes($settingsJumpTab)) {
    activeTab = $settingsJumpTab as (typeof tabs)[number];
  }
  settingsJumpTab.set(null);

  const commonEventTypes: EventType[] = ['issue.created', 'issue.statusChanged', 'issue.assigneesChanged', 'comment.created', 'issue.updated'];

  // ---- Labels ----
  let newLabelName = '';
  async function addLabel() {
    if (!newLabelName.trim()) return;
    const label = await api.createLabel(newLabelName.trim());
    labels.update((l) => [...l, label]);
    newLabelName = '';
  }
  async function removeLabel(id: string) {
    await api.deleteLabel(id);
    labels.update((l) => l.filter((x) => x.id !== id));
  }

  // ---- Components ----
  let newComponentName = '';
  async function addComponent() {
    if (!newComponentName.trim()) return;
    const component = await api.createComponent(newComponentName.trim());
    componentsStore.update((l) => [...l, component]);
    newComponentName = '';
  }
  async function removeComponent(id: string) {
    await api.deleteComponent(id);
    componentsStore.update((l) => l.filter((x) => x.id !== id));
  }

  // ---- Versions ----
  let newVersionName = '';
  async function addVersion() {
    if (!newVersionName.trim()) return;
    const version = await api.createVersion(newVersionName.trim());
    versions.update((l) => [...l, version]);
    newVersionName = '';
  }
  async function releaseVersion(id: string) {
    const version = await api.releaseVersion(id);
    versions.update((l) => l.map((v) => (v.id === id ? version : v)));
  }
  async function removeVersion(id: string) {
    await api.deleteVersion(id);
    versions.update((l) => l.filter((x) => x.id !== id));
  }

  // ---- Custom fields ----
  let newFieldName = '';
  let newFieldKey = '';
  let newFieldOptions = '';
  async function addField() {
    if (!newFieldName.trim() || !newFieldKey.trim()) return;
    const options = newFieldOptions
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)
      .map((label) => ({ id: label.toLowerCase().replace(/\s+/g, '_'), label }));
    const field = await api.createField({ key: newFieldKey.trim(), name: newFieldName.trim(), type: 'select', options, scope: {}, isRequired: false });
    fieldDefinitions.update((l) => [...l, field]);
    newFieldName = '';
    newFieldKey = '';
    newFieldOptions = '';
  }
  async function removeField(id: string) {
    await api.deleteField(id);
    fieldDefinitions.update((l) => l.filter((x) => x.id !== id));
  }

  // ---- Workflow ----
  let newCategoryName = '';
  let newCategoryType: 'todo' | 'inProgress' | 'done' = 'inProgress';
  async function addCategory() {
    if (!newCategoryName.trim()) return;
    const category = await api.createStatusCategory(newCategoryName.trim(), newCategoryType);
    statusCategories.update((l) => [...l, category]);
    newCategoryName = '';
  }
  let categoryError = '';
  async function removeCategory(id: string) {
    categoryError = '';
    try {
      await api.deleteStatusCategory(id);
      statusCategories.update((l) => l.filter((c) => c.id !== id));
    } catch (err) {
      categoryError = err instanceof Error ? err.message : 'Failed to delete category';
    }
  }
  // ---- Automations ----
  /** A condition/action mid-edit in the "add rule" form — string-valued so plain `<input>`s
   * work; converted to the domain's typed shape only when the rule is actually submitted. */
  interface DraftCondition { field: string; op: FilterOp; value: string }
  interface DraftAction { type: AutomationAction['type']; toStatusId: string; userId: string; body: string; fieldId: string; value: string }

  const CONDITION_FIELDS = ['statusId', 'priority', 'issueTypeId', 'assigneeIds', 'labelIds'];
  const FILTER_OPS: FilterOp[] = ['=', '!=', 'in', 'notIn', '>', '<', 'contains', 'isEmpty'];
  const AUTOMATION_ACTION_TYPES: AutomationAction['type'][] = ['transitionStatus', 'assignTo', 'addComment', 'setField'];

  function blankAction(): DraftAction {
    return { type: 'addComment', toStatusId: '', userId: '', body: '', fieldId: '', value: '' };
  }

  let newRuleName = '';
  let newRuleTrigger: EventType = 'issue.created';
  let newRuleConditions: DraftCondition[] = [];
  let newRuleActions: DraftAction[] = [blankAction()];
  $: ({ humans: assignableUsers } = splitHumansAndAgents($users));

  function addCondition() {
    newRuleConditions = [...newRuleConditions, { field: CONDITION_FIELDS[0], op: '=', value: '' }];
  }
  function removeCondition(index: number) {
    newRuleConditions = newRuleConditions.filter((_, i) => i !== index);
  }
  function addAction() {
    newRuleActions = [...newRuleActions, blankAction()];
  }
  function removeAction(index: number) {
    newRuleActions = newRuleActions.filter((_, i) => i !== index);
  }

  /** Actions that only require picking from a list are ready as soon as something's picked;
   * text-entry actions (comment body, field value) need non-empty text too. */
  function actionIsComplete(a: DraftAction): boolean {
    switch (a.type) {
      case 'transitionStatus': return !!a.toStatusId;
      case 'assignTo': return !!a.userId;
      case 'addComment': return !!a.body.trim();
      case 'setField': return !!a.fieldId && !!a.value.trim();
    }
  }

  /** 'isEmpty' needs no value; every other operator does — mirrors actionIsComplete so a
   * blank condition value blocks submission instead of being silently dropped. */
  function conditionIsComplete(c: DraftCondition): boolean {
    return c.op === 'isEmpty' || !!c.value.trim();
  }

  function toCondition(c: DraftCondition): AutomationCondition {
    if (c.op === 'isEmpty') return { field: c.field, op: c.op, value: undefined };
    if (c.op === 'in' || c.op === 'notIn') {
      return { field: c.field, op: c.op, value: c.value.split(',').map((s) => s.trim()).filter(Boolean) };
    }
    if (c.op === '>' || c.op === '<') return { field: c.field, op: c.op, value: Number(c.value) };
    return { field: c.field, op: c.op, value: c.value };
  }

  function toAction(a: DraftAction): AutomationAction {
    switch (a.type) {
      case 'transitionStatus': return { type: 'transitionStatus', toStatusId: a.toStatusId };
      case 'assignTo': return { type: 'assignTo', userId: a.userId };
      case 'addComment': return { type: 'addComment', body: a.body.trim() };
      case 'setField': return { type: 'setField', fieldId: a.fieldId, value: a.value };
    }
  }

  async function addRule() {
    if (!newRuleName.trim() || newRuleActions.length === 0 || !newRuleActions.every(actionIsComplete) || !newRuleConditions.every(conditionIsComplete)) return;
    const rule = await api.createAutomationRule({
      name: newRuleName.trim(),
      projectId: null,
      enabled: true,
      eventFilter: [newRuleTrigger],
      conditions: newRuleConditions.map(toCondition),
      actions: newRuleActions.map(toAction),
    });
    automationRules.update((l) => [...l, rule]);
    newRuleName = '';
    newRuleConditions = [];
    newRuleActions = [blankAction()];
  }
  async function toggleRule(id: string, enabled: boolean) {
    const rule = await api.updateAutomationRule(id, { enabled });
    automationRules.update((l) => l.map((r) => (r.id === id ? rule : r)));
  }
  async function removeRule(id: string) {
    await api.deleteAutomationRule(id);
    automationRules.update((l) => l.filter((x) => x.id !== id));
  }

  /** One-line human-readable summary of an action, for the rule list row. */
  function describeAction(a: AutomationAction): string {
    switch (a.type) {
      case 'transitionStatus': return `→ ${$workflow?.statuses.find((s) => s.id === a.toStatusId)?.name ?? a.toStatusId}`;
      case 'assignTo': return `assign ${$users.find((u) => u.id === a.userId)?.displayName ?? a.userId}`;
      case 'addComment': return `comment "${a.body.length > 30 ? `${a.body.slice(0, 30)}…` : a.body}"`;
      case 'setField': return `set ${$fieldDefinitions.find((f) => f.id === a.fieldId)?.name ?? a.fieldId} = ${JSON.stringify(a.value)}`;
    }
  }

  // ---- Agents ----
  let newAgentName = '';
  let newAgentDescription = '';
  let newAgentModel = 'claude-haiku-4-5';
  let newAgentTrigger: EventType = 'issue.created';
  let newAgentActionTypes: AutomationAction['type'][] = ['addComment'];
  let newAgentAutoApply = true;
  let newAgentMaxRunsPerHour = 20;
  const AGENT_MODELS = ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5'];
  const AGENT_ACTION_TYPES: AutomationAction['type'][] = ['transitionStatus', 'assignTo', 'addComment', 'setField'];

  function toggleAgentActionType(type: AutomationAction['type']) {
    newAgentActionTypes = newAgentActionTypes.includes(type) ? newAgentActionTypes.filter((t) => t !== type) : [...newAgentActionTypes, type];
  }

  async function addAgent() {
    if (!newAgentName.trim() || !newAgentDescription.trim() || newAgentActionTypes.length === 0) return;
    const agent = await api.createAgent({
      name: newAgentName.trim(),
      description: newAgentDescription.trim(),
      model: newAgentModel,
      eventFilter: [newAgentTrigger],
      allowedActionTypes: newAgentActionTypes,
      approvalPolicy: newAgentAutoApply ? { mode: 'autoApplyAll' } : { mode: 'requireApprovalForAll' },
      budget: { maxRunsPerHour: newAgentMaxRunsPerHour },
    });
    agents.update((l) => [...l, agent]);
    newAgentName = '';
    newAgentDescription = '';
    newAgentActionTypes = ['addComment'];
  }
  async function toggleAgent(userId: string, enabled: boolean) {
    const agent = await api.updateAgent(userId, { enabled });
    agents.update((l) => l.map((a) => (a.userId === userId ? agent : a)));
  }
  async function changeAgentModel(userId: string, model: string) {
    const agent = await api.updateAgent(userId, { model });
    agents.update((l) => l.map((a) => (a.userId === userId ? agent : a)));
  }
  async function approveRun(id: string) {
    const { run } = await api.approveAgentRun(id);
    agentRuns.update((l) => l.map((r) => (r.id === id ? run : r)));
  }
  async function rejectRun(id: string) {
    const { run } = await api.rejectAgentRun(id);
    agentRuns.update((l) => l.map((r) => (r.id === id ? run : r)));
  }

  // ---- Webhooks ----
  let newWebhookUrl = '';
  async function addWebhook() {
    if (!newWebhookUrl.trim()) return;
    const hook = await api.createWebhook(newWebhookUrl.trim(), '*');
    webhookSubscriptions.update((l) => [...l, hook]);
    newWebhookUrl = '';
  }
  async function toggleWebhook(id: string, enabled: boolean) {
    const hook = await api.updateWebhook(id, { enabled });
    webhookSubscriptions.update((l) => l.map((h) => (h.id === id ? hook : h)));
  }
  async function removeWebhook(id: string) {
    await api.deleteWebhook(id);
    webhookSubscriptions.update((l) => l.filter((x) => x.id !== id));
  }

  $: pendingRuns = $agentRuns.filter((r) => r.status === 'awaitingApproval');
</script>

<div class="settings">
  <nav class="tabs">
    {#each tabs as tab}
      <button class="tab" class:active={tab === activeTab} on:click={() => (activeTab = tab)}>{tab}</button>
    {/each}
  </nav>

  <div class="panel">
    {#if activeTab === 'Labels'}
      <div class="list">
        {#each $labels as l (l.id)}
          <div class="row"><span class="dot" style="background:{l.color}"></span><span class="row-name">{l.name}</span><button class="icon-btn" on:click={() => removeLabel(l.id)}><Icon name="trash" size={13} /></button></div>
        {/each}
      </div>
      <form class="add-form" on:submit|preventDefault={addLabel}>
        <input type="text" placeholder="Label name" bind:value={newLabelName} />
        <button type="submit">Add label</button>
      </form>
    {:else if activeTab === 'Components'}
      <div class="list">
        {#each $componentsStore as c (c.id)}
          <div class="row"><span class="row-name">{c.name}</span><button class="icon-btn" on:click={() => removeComponent(c.id)}><Icon name="trash" size={13} /></button></div>
        {/each}
      </div>
      <form class="add-form" on:submit|preventDefault={addComponent}>
        <input type="text" placeholder="Component name" bind:value={newComponentName} />
        <button type="submit">Add component</button>
      </form>
    {:else if activeTab === 'Versions'}
      <div class="list">
        {#each $versions as v (v.id)}
          <div class="row">
            <span class="row-name">{v.name}</span>
            <span class="row-tag" class:released={!!v.releasedAt}>{v.releasedAt ? 'Released' : 'Unreleased'}</span>
            {#if !v.releasedAt}<button class="text-btn" on:click={() => releaseVersion(v.id)}>Release</button>{/if}
            <button class="icon-btn" on:click={() => removeVersion(v.id)}><Icon name="trash" size={13} /></button>
          </div>
        {/each}
      </div>
      <form class="add-form" on:submit|preventDefault={addVersion}>
        <input type="text" placeholder="Version name (e.g. v3.5.0)" bind:value={newVersionName} />
        <button type="submit">Add version</button>
      </form>
    {:else if activeTab === 'Fields'}
      <div class="list">
        {#each $fieldDefinitions as f (f.id)}
          <div class="row"><span class="row-name">{f.name}</span><span class="row-tag">{f.type}</span><button class="icon-btn" on:click={() => removeField(f.id)}><Icon name="trash" size={13} /></button></div>
        {/each}
      </div>
      <form class="add-form column" on:submit|preventDefault={addField}>
        <input type="text" placeholder="Field name (e.g. Severity)" bind:value={newFieldName} />
        <input type="text" placeholder="Machine key (e.g. severity)" bind:value={newFieldKey} />
        <input type="text" placeholder="Options, comma-separated (e.g. Low, Medium, High)" bind:value={newFieldOptions} />
        <button type="submit">Add field</button>
      </form>
    {:else if activeTab === 'Workflow'}
      <div class="subsection-label">Status categories</div>
      {#if categoryError}<p class="error">{categoryError}</p>{/if}
      <div class="list">
        {#each $statusCategories as cat (cat.id)}
          <div class="row">
            <span class="row-name">{cat.name}</span><span class="row-tag">{cat.type}</span>
            {#if cat.type === 'inProgress'}
              <button class="icon-btn" on:click={() => removeCategory(cat.id)}><Icon name="trash" size={12} /></button>
            {/if}
          </div>
        {/each}
      </div>
      <form class="add-form" on:submit|preventDefault={addCategory}>
        <input type="text" placeholder="Category name (e.g. Resolving Differences)" bind:value={newCategoryName} />
        <select bind:value={newCategoryType}>
          <option value="todo">todo</option>
          <option value="inProgress">inProgress</option>
          <option value="done">done</option>
        </select>
        <button type="submit">Add category</button>
      </form>

      <div class="subsection-label">Workflow</div>
      <WorkflowDiagram />
    {:else if activeTab === 'Automations'}
      <div class="list">
        {#each $automationRules as rule (rule.id)}
          <div class="row column">
            <div class="row">
              <span class="row-name">{rule.name}</span>
              <span class="row-tag">on {Array.isArray(rule.eventFilter) ? rule.eventFilter.join(', ') : 'all events'}</span>
              <label class="toggle"><input type="checkbox" checked={rule.enabled} on:change={(e) => toggleRule(rule.id, (e.target as HTMLInputElement).checked)} />enabled</label>
              <button class="icon-btn" on:click={() => removeRule(rule.id)}><Icon name="trash" size={13} /></button>
            </div>
            {#if rule.conditions.length}
              <p class="rule-detail">if {rule.conditions.map((c) => `${c.field} ${c.op} ${JSON.stringify(c.value)}`).join(' and ')}</p>
            {/if}
            <p class="rule-detail">{rule.actions.map(describeAction).join('; ')}</p>
          </div>
        {/each}
      </div>
      <form class="add-form column" on:submit|preventDefault={addRule}>
        <input type="text" placeholder="Rule name" bind:value={newRuleName} />
        <label class="agent-form-label">
          Trigger
          <select bind:value={newRuleTrigger}>
            {#each commonEventTypes as t}<option value={t}>{t}</option>{/each}
          </select>
        </label>

        <span class="agent-form-label">Conditions (optional — runs unconditionally if none)</span>
        {#each newRuleConditions as condition, i}
          <div class="rule-row">
            <select bind:value={condition.field}>
              {#each CONDITION_FIELDS as f}<option value={f}>{f}</option>{/each}
            </select>
            <select bind:value={condition.op}>
              {#each FILTER_OPS as op}<option value={op}>{op}</option>{/each}
            </select>
            {#if condition.op !== 'isEmpty'}
              <input type="text" placeholder="value" bind:value={condition.value} />
            {/if}
            <button type="button" class="icon-btn" on:click={() => removeCondition(i)}><Icon name="x" size={13} /></button>
          </div>
        {/each}
        <button type="button" class="text-btn add-row-btn" on:click={addCondition}>+ Add condition</button>

        <span class="agent-form-label">Actions</span>
        {#each newRuleActions as action, i}
          <div class="rule-row">
            <select bind:value={action.type}>
              {#each AUTOMATION_ACTION_TYPES as t}<option value={t}>{t}</option>{/each}
            </select>
            {#if action.type === 'transitionStatus'}
              <select bind:value={action.toStatusId}>
                <option value="" disabled>status…</option>
                {#each $workflow?.statuses ?? [] as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
              </select>
            {:else if action.type === 'assignTo'}
              <select bind:value={action.userId}>
                <option value="" disabled>user…</option>
                {#each assignableUsers as u (u.id)}<option value={u.id}>{u.displayName}</option>{/each}
              </select>
            {:else if action.type === 'addComment'}
              <input type="text" placeholder="Comment body" bind:value={action.body} />
            {:else if action.type === 'setField'}
              <select bind:value={action.fieldId}>
                <option value="" disabled>field…</option>
                {#each $fieldDefinitions as f (f.id)}<option value={f.id}>{f.name}</option>{/each}
              </select>
              <input type="text" placeholder="value" bind:value={action.value} />
            {/if}
            {#if newRuleActions.length > 1}
              <button type="button" class="icon-btn" on:click={() => removeAction(i)}><Icon name="x" size={13} /></button>
            {/if}
          </div>
        {/each}
        <button type="button" class="text-btn add-row-btn" on:click={addAction}>+ Add action</button>

        <button type="submit" disabled={!newRuleName.trim() || !newRuleActions.every(actionIsComplete) || !newRuleConditions.every(conditionIsComplete)}>Add rule</button>
      </form>
    {:else if activeTab === 'Agents'}
      {#if pendingRuns.length}
        <div class="subsection-label">Awaiting your approval</div>
        <div class="list">
          {#each pendingRuns as run (run.id)}
            {@const agent = $agents.find((a) => a.userId === run.agentUserId)}
            {@const runIssue = $issuesStore.find((i) => i.id === run.issueId)}
            {@const onBehalfOf = $users.find((u) => u.id === runIssue?.agentAssignments?.[run.agentUserId])}
            <div class="row column">
              <div class="row">
                <Avatar userId={run.agentUserId} name={`[AI] ${agent?.name ?? run.agentUserId}`} kind="agent" size={18} />
                <span class="row-name">[AI] {agent?.name ?? run.agentUserId}{#if onBehalfOf} <span class="on-behalf-of">on behalf of {onBehalfOf.displayName}</span>{/if}</span>
                <span class="row-tag">{run.status}</span>
              </div>
              {#if run.rationale}<p class="rationale">{run.rationale}</p>{/if}
              <div class="row-actions">
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
        acting for. Its Instructions below are what actually drive its decisions each time it's triggered.
      </p>
      <div class="list">
        {#each $agents as agent (agent.userId)}
          <div class="row">
            <Avatar userId={agent.userId} name={`[AI] ${agent.name}`} kind="agent" size={18} />
            <span class="row-name">[AI] {agent.name}</span>
            <span class="row-tag">{agent.description ?? ''}</span>
            <select value={agent.model} on:change={(e) => changeAgentModel(agent.userId, (e.target as HTMLSelectElement).value)}>
              {#each AGENT_MODELS as model}<option value={model}>{model}</option>{/each}
            </select>
            <label class="toggle"><input type="checkbox" checked={agent.enabled} on:change={(e) => toggleAgent(agent.userId, (e.target as HTMLInputElement).checked)} />enabled</label>
          </div>
        {/each}
      </div>
      <form class="add-form column" on:submit|preventDefault={addAgent}>
        <input type="text" placeholder="Agent name" bind:value={newAgentName} />
        <input type="text" placeholder="Instructions — what should this agent do with a ticket?" bind:value={newAgentDescription} />
        <select bind:value={newAgentModel}>
          {#each AGENT_MODELS as model}<option value={model}>{model}</option>{/each}
        </select>
        <label class="agent-form-label">
          Reacts to
          <select bind:value={newAgentTrigger}>
            {#each commonEventTypes as t}<option value={t}>{t}</option>{/each}
          </select>
        </label>
        <span class="agent-form-label">Allowed actions</span>
        <div class="agent-action-checks">
          {#each AGENT_ACTION_TYPES as type}
            <label class="agent-action-check">
              <input type="checkbox" checked={newAgentActionTypes.includes(type)} on:change={() => toggleAgentActionType(type)} />
              {type}
            </label>
          {/each}
        </div>
        <label class="toggle agent-form-toggle"><input type="checkbox" bind:checked={newAgentAutoApply} />auto-apply actions (unchecked = require approval)</label>
        <label class="agent-form-label">
          Max runs / hour
          <input type="number" min="1" bind:value={newAgentMaxRunsPerHour} />
        </label>
        <button type="submit" disabled={!newAgentName.trim() || !newAgentDescription.trim() || newAgentActionTypes.length === 0}>Add agent</button>
      </form>
    {:else if activeTab === 'Webhooks'}
      <div class="list">
        {#each $webhookSubscriptions as hook (hook.id)}
          <div class="row">
            <span class="row-name">{hook.targetUrl}</span>
            <label class="toggle"><input type="checkbox" checked={hook.enabled} on:change={(e) => toggleWebhook(hook.id, (e.target as HTMLInputElement).checked)} />enabled</label>
            <button class="icon-btn" on:click={() => removeWebhook(hook.id)}><Icon name="trash" size={13} /></button>
          </div>
        {/each}
      </div>
      <form class="add-form" on:submit|preventDefault={addWebhook}>
        <input type="text" placeholder="https://your-service.example/webhook" bind:value={newWebhookUrl} />
        <button type="submit">Add webhook</button>
      </form>
    {/if}
  </div>
</div>

<style>
  .settings { flex: 1; display: flex; overflow: hidden; }
  .tabs { flex: 0 0 180px; display: flex; flex-direction: column; gap: 2px; padding: 16px 10px; border-right: 1px solid var(--border); overflow-y: auto; }
  .tab { text-align: left; font-size: 12.5px; font-weight: 500; color: var(--text-2); padding: 7px 10px; border-radius: 7px; }
  .tab:hover { background: var(--surface-sunken); }
  .tab.active { background: var(--accent-soft); color: var(--accent-strong); font-weight: 600; }
  .panel { flex: 1; overflow-y: auto; padding: 20px 24px; }

  @media (max-width: 768px) {
    .settings { flex-direction: column; overflow: auto; }
    .tabs {
      flex: 0 0 auto; flex-direction: row; overflow-x: auto; overflow-y: visible;
      border-right: none; border-bottom: 1px solid var(--border); padding: 10px;
    }
    .tab { white-space: nowrap; }
    .panel { padding: 16px; }
  }
  .subsection-label { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-2); margin: 18px 0 8px; }
  .subsection-label:first-child { margin-top: 0; }
  .section-hint { font-size: 12px; line-height: 1.5; color: var(--text-3); margin: 0 0 12px; max-width: 520px; }
  .list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
  .row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; font-size: 12.5px; }
  .row.column { flex-direction: column; align-items: stretch; }
  .row-name { color: var(--text); font-weight: 500; }
  .row-tag { color: var(--text-3); font-size: 11.5px; flex: 1; }
  .row-tag.released { color: var(--success); }
  .dot { width: 8px; height: 8px; border-radius: 2px; flex: 0 0 8px; }
  .icon-btn { color: var(--text-3); padding: 4px; border-radius: 6px; margin-left: auto; }
  .icon-btn:hover { background: var(--surface); color: var(--critical); }
  .text-btn { font-size: 12px; font-weight: 600; color: var(--accent-strong); }
  .error { color: var(--critical); font-size: 12px; margin: 0 0 8px; }
  .text-btn.danger { color: var(--critical); }
  .row-actions { display: flex; gap: 12px; margin-top: 6px; }
  .rationale { font-size: 12px; color: var(--text-2); margin: 0; }
  .rule-detail { font-size: 12px; color: var(--text-2); margin: 0; }
  .rule-row { display: flex; align-items: center; gap: 6px; }
  .rule-row select, .rule-row input {
    font: inherit; font-size: 12.5px; color: var(--text); background: var(--surface); border: 1px solid var(--border);
    border-radius: 7px; padding: 6px 8px; flex: 1; min-width: 0;
  }
  .add-row-btn { text-align: left; align-self: flex-start; }
  .toggle { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--text-3); white-space: nowrap; }
  .add-form { display: flex; gap: 8px; }
  .add-form.column { flex-direction: column; align-items: stretch; max-width: 360px; }
  .add-form input, .add-form select {
    font: inherit; font-size: 12.5px; color: var(--text); background: var(--surface); border: 1px solid var(--border);
    border-radius: 7px; padding: 7px 9px; flex: 1;
  }
  .add-form button { font-size: 12px; font-weight: 600; color: var(--accent-on); background: var(--accent); padding: 7px 12px; border-radius: 7px; white-space: nowrap; }
  .add-form button:disabled { opacity: .5; cursor: default; }
  .on-behalf-of { font-weight: 400; color: var(--text-3); font-size: 11.5px; }
  .agent-form-label {
    display: flex; flex-direction: column; gap: 4px; font-size: 10.5px; font-weight: 600;
    letter-spacing: .04em; text-transform: uppercase; color: var(--text-3); margin-top: 4px;
  }
  .agent-form-label select, .agent-form-label input {
    font: inherit; font-size: 12.5px; text-transform: none; font-weight: 400; color: var(--text);
    background: var(--surface); border: 1px solid var(--border); border-radius: 7px; padding: 7px 9px;
  }
  .agent-action-checks { display: flex; flex-wrap: wrap; gap: 8px; }
  .agent-action-check { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text); }
  .agent-form-toggle { margin-top: 2px; }
</style>
