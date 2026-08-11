<script lang="ts">
  import Icon from './Icon.svelte';
  import WorkflowDiagram from './WorkflowDiagram.svelte';
  import {
    agentRuns,
    agents,
    automationRules,
    components as componentsStore,
    fieldDefinitions,
    labels,
    settingsJumpTab,
    statusCategories,
    versions,
    webhookSubscriptions,
    workflow,
  } from '../stores/workspace';
  import * as api from '../api';
  import type { EventType } from '$domain';

  const tabs = ['Labels', 'Components', 'Versions', 'Fields', 'Workflow', 'Automations', 'Agents', 'Webhooks'] as const;
  let activeTab: (typeof tabs)[number] = 'Labels';

  // Lets the TopBar "New…" menu open Settings already on the relevant tab (e.g. "New Label").
  if ($settingsJumpTab && (tabs as readonly string[]).includes($settingsJumpTab)) {
    activeTab = $settingsJumpTab as (typeof tabs)[number];
  }
  settingsJumpTab.set(null);

  const commonEventTypes: EventType[] = ['issue.created', 'issue.statusChanged', 'issue.assigned', 'comment.created', 'issue.updated'];

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
  let newRuleName = '';
  let newRuleTrigger: EventType = 'issue.created';
  let newRuleComment = '';
  async function addRule() {
    if (!newRuleName.trim() || !newRuleComment.trim()) return;
    const rule = await api.createAutomationRule({
      name: newRuleName.trim(),
      projectId: null,
      enabled: true,
      eventFilter: [newRuleTrigger],
      conditions: [],
      actions: [{ type: 'addComment', body: newRuleComment.trim() }],
    });
    automationRules.update((l) => [...l, rule]);
    newRuleName = '';
    newRuleComment = '';
  }
  async function toggleRule(id: string, enabled: boolean) {
    const rule = await api.updateAutomationRule(id, { enabled });
    automationRules.update((l) => l.map((r) => (r.id === id ? rule : r)));
  }
  async function removeRule(id: string) {
    await api.deleteAutomationRule(id);
    automationRules.update((l) => l.filter((x) => x.id !== id));
  }

  // ---- Agents ----
  let newAgentName = '';
  let newAgentDescription = '';
  async function addAgent() {
    if (!newAgentName.trim()) return;
    const agent = await api.createAgent({
      name: newAgentName.trim(),
      description: newAgentDescription.trim() || undefined,
      eventFilter: ['issue.created'],
      allowedActionTypes: ['addComment', 'setField'],
      approvalPolicy: { mode: 'autoApplyAll' },
      budget: { maxRunsPerHour: 20 },
    });
    agents.update((l) => [...l, agent]);
    newAgentName = '';
    newAgentDescription = '';
  }
  async function toggleAgent(userId: string, enabled: boolean) {
    const agent = await api.updateAgent(userId, { enabled });
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
          <div class="row">
            <span class="row-name">{rule.name}</span>
            <span class="row-tag">{Array.isArray(rule.eventFilter) ? rule.eventFilter.join(', ') : 'all events'}</span>
            <label class="toggle"><input type="checkbox" checked={rule.enabled} on:change={(e) => toggleRule(rule.id, (e.target as HTMLInputElement).checked)} />enabled</label>
            <button class="icon-btn" on:click={() => removeRule(rule.id)}><Icon name="trash" size={13} /></button>
          </div>
        {/each}
      </div>
      <form class="add-form column" on:submit|preventDefault={addRule}>
        <input type="text" placeholder="Rule name" bind:value={newRuleName} />
        <select bind:value={newRuleTrigger}>
          {#each commonEventTypes as t}<option value={t}>{t}</option>{/each}
        </select>
        <input type="text" placeholder="Comment to post when triggered" bind:value={newRuleComment} />
        <button type="submit">Add rule</button>
      </form>
    {:else if activeTab === 'Agents'}
      {#if pendingRuns.length}
        <div class="subsection-label">Awaiting your approval</div>
        <div class="list">
          {#each pendingRuns as run (run.id)}
            {@const agent = $agents.find((a) => a.userId === run.agentUserId)}
            <div class="row column">
              <div class="row"><span class="row-name">{agent?.name ?? run.agentUserId}</span><span class="row-tag">{run.status}</span></div>
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
      <div class="list">
        {#each $agents as agent (agent.userId)}
          <div class="row">
            <span class="row-name">{agent.name}</span>
            <span class="row-tag">{agent.description ?? ''}</span>
            <label class="toggle"><input type="checkbox" checked={agent.enabled} on:change={(e) => toggleAgent(agent.userId, (e.target as HTMLInputElement).checked)} />enabled</label>
          </div>
        {/each}
      </div>
      <form class="add-form column" on:submit|preventDefault={addAgent}>
        <input type="text" placeholder="Agent name" bind:value={newAgentName} />
        <input type="text" placeholder="Description" bind:value={newAgentDescription} />
        <button type="submit">Add agent</button>
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
  .subsection-label { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-2); margin: 18px 0 8px; }
  .subsection-label:first-child { margin-top: 0; }
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
  .toggle { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--text-3); white-space: nowrap; }
  .add-form { display: flex; gap: 8px; }
  .add-form.column { flex-direction: column; align-items: stretch; max-width: 360px; }
  .add-form input, .add-form select {
    font: inherit; font-size: 12.5px; color: var(--text); background: var(--surface); border: 1px solid var(--border);
    border-radius: 7px; padding: 7px 9px; flex: 1;
  }
  .add-form button { font-size: 12px; font-weight: 600; color: var(--accent-on); background: var(--accent); padding: 7px 12px; border-radius: 7px; white-space: nowrap; }
</style>
