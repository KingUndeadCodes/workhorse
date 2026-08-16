<script lang="ts">
  import Icon from './Icon.svelte';
  import WorkflowDiagram from './WorkflowDiagram.svelte';
  import AgentsSettings from './AgentsSettings.svelte';
  import {
    automationRules,
    fieldDefinitions,
    labels,
    settingsJumpTab,
    statusCategories,
    users,
    webhookSubscriptions,
    workflow,
  } from '../stores/workspace';
  import * as api from '../api';
  import { describeAutomationAction, splitHumansAndAgents } from '../util';
  import type { AutomationAction, AutomationCondition, EventType, FilterOp } from '$domain';

  const tabs = ['Labels', 'Fields', 'Workflow', 'Automations', 'Agents', 'Webhooks'] as const;
  let activeTab: (typeof tabs)[number] = 'Labels';

  // Lets the TopBar "New…" menu open Settings already on the relevant tab (e.g. "New Label").
  if ($settingsJumpTab && (tabs as readonly string[]).includes($settingsJumpTab)) {
    activeTab = $settingsJumpTab as (typeof tabs)[number];
  }
  settingsJumpTab.set(null);

  const commonEventTypes: EventType[] = [
    'issue.created', 'issue.statusChanged', 'issue.resolved', 'issue.reopened', 'issue.assigneesChanged',
    'issue.priorityChanged', 'issue.labelsChanged', 'issue.dueDateChanged', 'comment.created', 'comment.mentioned', 'issue.updated',
  ];

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
  interface DraftAction {
    type: AutomationAction['type'];
    toStatusId: string; userId: string; body: string; fieldId: string; value: string;
    path: string; content: string; branchName: string; commitMessage: string;
  }

  const CONDITION_FIELDS = ['statusId', 'priority', 'issueTypeId', 'assigneeIds', 'labelIds'];
  const FILTER_OPS: FilterOp[] = ['=', '!=', 'in', 'notIn', '>', '<', 'contains', 'isEmpty'];
  const AUTOMATION_ACTION_TYPES: AutomationAction['type'][] = ['transitionStatus', 'assignTo', 'addComment', 'setField', 'readRepoFile', 'writeRepoFile'];

  function blankAction(): DraftAction {
    return { type: 'addComment', toStatusId: '', userId: '', body: '', fieldId: '', value: '', path: '', content: '', branchName: '', commitMessage: '' };
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
      case 'readRepoFile': return !!a.path.trim();
      case 'writeRepoFile': return !!a.path.trim() && !!a.content.trim() && !!a.branchName.trim();
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
      case 'readRepoFile': return { type: 'readRepoFile', path: a.path.trim() };
      case 'writeRepoFile':
        return { type: 'writeRepoFile', path: a.path.trim(), content: a.content, branchName: a.branchName.trim(), commitMessage: a.commitMessage.trim() || undefined };
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
            <p class="rule-detail">{rule.actions.map((a) => describeAutomationAction(a, { workflow: $workflow, users: $users, fieldDefinitions: $fieldDefinitions })).join('; ')}</p>
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
            {:else if action.type === 'readRepoFile'}
              <input type="text" placeholder="path/to/file.ts" bind:value={action.path} />
            {:else if action.type === 'writeRepoFile'}
              <input type="text" placeholder="path/to/file.ts" bind:value={action.path} />
              <input type="text" placeholder="branch name" bind:value={action.branchName} />
              <input type="text" placeholder="file content" bind:value={action.content} />
              <input type="text" placeholder="commit message (optional)" bind:value={action.commitMessage} />
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
      <AgentsSettings />
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
  .list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
  .row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; font-size: 12.5px; }
  .row.column { flex-direction: column; align-items: stretch; }
  .row-name { color: var(--text); font-weight: 500; }
  .row-tag { color: var(--text-3); font-size: 11.5px; flex: 1; }
  .dot { width: 8px; height: 8px; border-radius: 2px; flex: 0 0 8px; }
  .icon-btn { color: var(--text-3); padding: 4px; border-radius: 6px; margin-left: auto; }
  .icon-btn:hover { background: var(--surface); color: var(--critical); }
  .text-btn { font-size: 12px; font-weight: 600; color: var(--accent-strong); }
  .error { color: var(--critical); font-size: 12px; margin: 0 0 8px; }
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
  .agent-form-label {
    display: flex; flex-direction: column; gap: 4px; font-size: 10.5px; font-weight: 600;
    letter-spacing: .04em; text-transform: uppercase; color: var(--text-3); margin-top: 4px;
  }
  .agent-form-label select {
    font: inherit; font-size: 12.5px; text-transform: none; font-weight: 400; color: var(--text);
    background: var(--surface); border: 1px solid var(--border); border-radius: 7px; padding: 7px 9px;
  }
</style>
