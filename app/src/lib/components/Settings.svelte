<script lang="ts">
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';
  import WorkflowDiagram from './WorkflowDiagram.svelte';
  import AccountSettings from './AccountSettings.svelte';
  import AgentsSettings from './AgentsSettings.svelte';
  import FeaturesSettings from './FeaturesSettings.svelte';
  import GitConnectionsSettings from './GitConnectionsSettings.svelte';
  import MembersSettings from './MembersSettings.svelte';
  import ProjectSettings from './ProjectSettings.svelte';
  import {
    automationRules,
    currentProject,
    fieldDefinitions,
    isWorkspaceAdmin,
    labels,
    settingsJumpTab,
    type SettingsTab,
    statusCategories,
    users,
    webhookSubscriptions,
    workflow,
    workspaceFeatures,
  } from '../stores/workspace';
  import { theme, type Theme } from '../stores/theme';
  import { isMobile } from '../stores/viewport';
  import { locale, t, tn, SUPPORTED_LOCALES, type Locale } from '../i18n';

  const THEME_OPTIONS: { id: Theme; labelKey: string }[] = [
    { id: 'light', labelKey: 'settings.appearance.themeLight' },
    { id: 'dark', labelKey: 'settings.appearance.themeDark' },
    { id: 'system', labelKey: 'settings.appearance.themeSystem' },
  ];
  import * as api from '../api';
  import { describeAutomationAction, formatRelativeDate, splitHumansAndAgents } from '../util';
  import type { AutomationAction, AutomationCondition, EventType, FilterOp, WebhookDelivery } from '$domain';

  type Tab = SettingsTab;
  const TAB_LABEL_KEYS: Record<Tab, string> = {
    Profile: 'settings.tabs.profile',
    Appearance: 'settings.tabs.appearance',
    Accessibility: 'settings.tabs.accessibility',
    Project: 'projectSettings.tabs.project',
    ProjectGit: 'projectSettings.tabs.git',
    Members: 'settings.tabs.members',
    Labels: 'settings.tabs.labels',
    Fields: 'settings.tabs.fields',
    Workflow: 'settings.tabs.workflow',
    Automations: 'settings.tabs.automations',
    Agents: 'settings.tabs.agents',
    Git: 'settings.tabs.git',
    Webhooks: 'settings.tabs.webhooks',
    Features: 'settings.tabs.features',
  };
  // One screen for everything configurable, grouped by what it applies to: you, this project, or the whole workspace.
  const GROUPS: { id: 'personal' | 'project' | 'workspace'; tabs: Tab[] }[] = [
    { id: 'personal', tabs: ['Profile', 'Appearance', 'Accessibility'] },
    { id: 'project', tabs: ['Project', 'ProjectGit'] },
    { id: 'workspace', tabs: ['Members', 'Labels', 'Fields', 'Workflow', 'Automations', 'Agents', 'Git', 'Webhooks', 'Features'] },
  ];
  // Tabs for a module an owner/admin switched off disappear; Features itself is admin-only.
  $: visible = (tab: Tab) =>
    (tab !== 'Automations' || $workspaceFeatures.automations) &&
    (tab !== 'Agents' || $workspaceFeatures.agents) &&
    (tab !== 'Git' || $workspaceFeatures.git) &&
    (tab !== 'ProjectGit' || $workspaceFeatures.git) &&
    (tab !== 'Webhooks' || $workspaceFeatures.webhooks) &&
    (tab !== 'Features' || $isWorkspaceAdmin);
  $: groups = GROUPS.map((g) => ({ id: g.id, tabs: g.tabs.filter(visible) })).filter((g) => g.tabs.length > 0);
  $: tabs = groups.flatMap((g) => g.tabs);
  $: groupLabel = (id: 'personal' | 'project' | 'workspace') => $t(`settings.groups.${id}`, { name: $currentProject?.name ?? '' });
  let activeTab: Tab = 'Labels';
  $: activeGroupId = groups.find((g) => g.tabs.includes(activeTab))?.id;
  // If the active tab's module gets switched off (here or elsewhere), fall back to a tab that still exists.
  $: if (!tabs.includes(activeTab)) activeTab = 'Labels';

  // On a phone the tabs are a menu you drill into (a grouped list, then a detail screen with a
  // Back button) instead of a sideways-scrolling tab strip — with this many tabs a strip would
  // hide most of them off-screen. `activeTab` stays the single source of truth; this flag only
  // decides, on mobile, whether the menu or the detail is showing, so desktop (and resizing
  // across the breakpoint) never depends on it.
  let mobileMenuOpen = true;
  let rowEls: Partial<Record<Tab, HTMLButtonElement>> = {};
  let detailTitleEl: HTMLElement | undefined;
  async function openTab(tab: Tab) {
    activeTab = tab;
    mobileMenuOpen = false;
    await tick();
    detailTitleEl?.focus();
  }
  async function backToMenu() {
    mobileMenuOpen = true;
    await tick();
    rowEls[activeTab]?.focus();
  }

  // Lets the TopBar "New…" menu open Settings already on the relevant tab (e.g. "New Label").
  // Reactive, not a one-time check: this component stays mounted across jumps whenever the
  // view is already 'settings' (no {#key} in App.svelte), so a plain top-level `if` would only
  // ever fire once, at first mount. On mobile a jump opens the tab's detail directly.
  $: if ($settingsJumpTab) {
    // A tab that's hidden right now (its module is off, or it's admin-only) can't be jumped to; ignore the jump
    // and stay where we are instead of landing on the fallback tab.
    if (tabs.includes($settingsJumpTab)) {
      activeTab = $settingsJumpTab;
      mobileMenuOpen = false;
    }
    settingsJumpTab.set(null);
  }

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
      categoryError = err instanceof Error ? err.message : $t('settings.failedDeleteCategory');
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
    if (expandedWebhookId === id) expandedWebhookId = null;
    const { [id]: _removed, ...rest } = deliveriesByWebhook;
    deliveriesByWebhook = rest;
  }

  // Deliveries are unbounded over time (unlike webhookSubscriptions, they're not part of
  // bootstrap) — fetched lazily on first expand and cached per webhook, same reasoning as
  // NotificationBell's own lazy panel fetch.
  let expandedWebhookId: string | null = null;
  let deliveriesByWebhook: Record<string, { deliveries: WebhookDelivery[]; hasMore: boolean }> = {};
  let deliveriesLoading: Record<string, boolean> = {};
  async function toggleDeliveries(id: string) {
    if (expandedWebhookId === id) {
      expandedWebhookId = null;
      return;
    }
    expandedWebhookId = id;
    if (deliveriesByWebhook[id]) return;
    deliveriesLoading = { ...deliveriesLoading, [id]: true };
    deliveriesByWebhook = { ...deliveriesByWebhook, [id]: await api.fetchWebhookDeliveries(id) };
    deliveriesLoading = { ...deliveriesLoading, [id]: false };
  }
  async function loadMoreDeliveries(id: string) {
    const current = deliveriesByWebhook[id];
    if (!current) return;
    const more = await api.fetchWebhookDeliveries(id, 20, current.deliveries.length);
    deliveriesByWebhook = { ...deliveriesByWebhook, [id]: { deliveries: [...current.deliveries, ...more.deliveries], hasMore: more.hasMore } };
  }
  function deliveryStatusLabel(status: WebhookDelivery['status']): string {
    return status === 'success' ? $t('settings.webhookStatusSuccess') : $t('settings.webhookStatusFailure');
  }
</script>

<div class="settings">
  {#if $isMobile && mobileMenuOpen}
    <nav class="menu" aria-label={$t('settings.title')}>
      {#each groups as group (group.id)}
        <div class="menu-group" role="group" aria-labelledby="settings-group-{group.id}">
          <div class="menu-heading" id="settings-group-{group.id}">{groupLabel(group.id)}</div>
          {#each group.tabs as tab (tab)}
            <button type="button" class="menu-row" bind:this={rowEls[tab]} on:click={() => openTab(tab)}>
              <span>{$t(TAB_LABEL_KEYS[tab])}</span>
              <Icon name="chevron" size={14} />
            </button>
          {/each}
        </div>
      {/each}
    </nav>
  {:else}
    {#if $isMobile}
      <div class="detail-head">
        <button type="button" class="back-btn" aria-label={$t('settings.backToSettings')} on:click={backToMenu}>
          <span class="back-chevron"><Icon name="chevron" size={14} /></span>{$t('settings.title')}
        </button>
        <div class="detail-heading">
          <h2 class="detail-title" tabindex="-1" bind:this={detailTitleEl}>{$t(TAB_LABEL_KEYS[activeTab])}</h2>
          <!-- "Git" exists under both Project and Workspace — the group line says which one this is. -->
          {#if activeGroupId}<span class="detail-group">{groupLabel(activeGroupId)}</span>{/if}
        </div>
      </div>
    {:else}
      <nav class="tabs" aria-label={$t('settings.title')}>
        {#each groups as group (group.id)}
          <div class="tab-group" role="group" aria-labelledby="settings-group-{group.id}">
            <div class="tab-heading" id="settings-group-{group.id}">{groupLabel(group.id)}</div>
            {#each group.tabs as tab (tab)}
              <button class="tab" class:active={tab === activeTab} aria-current={tab === activeTab ? 'page' : undefined} on:click={() => (activeTab = tab)}>{$t(TAB_LABEL_KEYS[tab])}</button>
            {/each}
          </div>
        {/each}
      </nav>
    {/if}

  <div class="panel">
    {#if activeTab === 'Profile'}
      <AccountSettings />
    {:else if activeTab === 'Appearance'}
      <div class="appearance-row">
        <div class="appearance-copy">
          <span class="row-name">{$t('settings.appearance.themeLabel')}</span>
          <span class="row-hint">{$t('settings.appearance.themeHint')}</span>
        </div>
        <div class="theme-picker">
          {#each THEME_OPTIONS as opt (opt.id)}
            <button
              type="button"
              class="theme-option"
              class:active={$theme === opt.id}
              aria-pressed={$theme === opt.id}
              on:click={() => theme.set(opt.id)}
            >
              <span class="theme-preview theme-preview-{opt.id}">
                {#if opt.id === 'system'}
                  <span class="theme-preview-half theme-preview-half-light"><Icon name="sun" size={13} /></span>
                  <span class="theme-preview-half theme-preview-half-dark"><Icon name="moon" size={13} /></span>
                {:else}
                  <span class="theme-preview-sidebar"></span>
                  <span class="theme-preview-content">
                    <span class="theme-preview-bar"></span>
                    <span class="theme-preview-bar short"></span>
                    <span class="theme-preview-accent"></span>
                  </span>
                {/if}
              </span>
              <span class="theme-option-footer">
                <span class="theme-option-check"><Icon name="check" size={11} /></span>
                <span class="theme-option-label">{$t(opt.labelKey)}</span>
              </span>
            </button>
          {/each}
        </div>
      </div>

      <div class="appearance-row">
        <div class="appearance-copy">
          <span class="row-name">{$t('settings.appearance.languageLabel')}</span>
          <span class="row-hint">{$t('settings.appearance.languageHint')}</span>
        </div>
        <div class="language-picker">
          {#each SUPPORTED_LOCALES as opt (opt.id)}
            <button
              type="button"
              class="language-option"
              class:active={$locale === opt.id}
              aria-pressed={$locale === opt.id}
              on:click={() => locale.set(opt.id)}
            >
              <span class="language-option-check"><Icon name="check" size={11} /></span>
              <span class="language-option-label">{opt.label}</span>
            </button>
          {/each}
        </div>
        {#if $locale !== 'en'}
          <p class="language-disclaimer">{$t('settings.appearance.nonEnglishDisclaimer')}</p>
        {/if}
      </div>
    {:else if activeTab === 'Accessibility'}
      <div class="appearance-row">
        <div class="appearance-copy">
          <span class="row-name">{$t('settings.accessibility.keyboardNavLabel')}</span>
          <span class="row-hint">{$t('settings.accessibility.keyboardNavHint')}</span>
        </div>
      </div>
    {:else if activeTab === 'Project' || activeTab === 'ProjectGit'}
      <ProjectSettings tab={activeTab === 'Project' ? 'Project' : 'Git'} />
    {:else if activeTab === 'Members'}
      <MembersSettings />
    {:else if activeTab === 'Labels'}
      <div class="list">
        {#each $labels as l (l.id)}
          <div class="row"><span class="dot" style="background:{l.color}"></span><span class="row-name">{l.name}</span><button class="icon-btn" aria-label={$t('common.deleteNamed', { name: l.name })} on:click={() => removeLabel(l.id)}><Icon name="trash" size={13} /></button></div>
        {/each}
      </div>
      <form class="add-form" on:submit|preventDefault={addLabel}>
        <input type="text" placeholder={$t('settings.labelNamePlaceholder')} bind:value={newLabelName} />
        <button type="submit">{$t('settings.addLabelButton')}</button>
      </form>
    {:else if activeTab === 'Fields'}
      <div class="list">
        {#each $fieldDefinitions as f (f.id)}
          <div class="row"><span class="row-name">{f.name}</span><span class="row-tag">{f.type}</span><button class="icon-btn" aria-label={$t('common.deleteNamed', { name: f.name })} on:click={() => removeField(f.id)}><Icon name="trash" size={13} /></button></div>
        {/each}
      </div>
      <form class="add-form column" on:submit|preventDefault={addField}>
        <input type="text" placeholder={$t('settings.fieldNamePlaceholder')} bind:value={newFieldName} />
        <input type="text" placeholder={$t('settings.fieldKeyPlaceholder')} bind:value={newFieldKey} />
        <input type="text" placeholder={$t('settings.fieldOptionsPlaceholder')} bind:value={newFieldOptions} />
        <button type="submit">{$t('settings.addFieldButton')}</button>
      </form>
    {:else if activeTab === 'Workflow'}
      <div class="subsection-label">{$t('settings.statusCategoriesLabel')}</div>
      {#if categoryError}<p class="error">{categoryError}</p>{/if}
      <div class="list">
        {#each $statusCategories as cat (cat.id)}
          <div class="row">
            <span class="row-name">{cat.name}</span><span class="row-tag">{cat.type}</span>
            {#if cat.type === 'inProgress'}
              <button class="icon-btn" aria-label={$t('common.deleteNamed', { name: cat.name })} on:click={() => removeCategory(cat.id)}><Icon name="trash" size={12} /></button>
            {/if}
          </div>
        {/each}
      </div>
      <form class="add-form" on:submit|preventDefault={addCategory}>
        <input type="text" placeholder={$t('settings.categoryNamePlaceholder')} bind:value={newCategoryName} />
        <select bind:value={newCategoryType}>
          <option value="todo">todo</option>
          <option value="inProgress">inProgress</option>
          <option value="done">done</option>
        </select>
        <button type="submit">{$t('settings.addCategoryButton')}</button>
      </form>

      <div class="subsection-label">{$t('settings.workflowLabel')}</div>
      {#if $isMobile}
        <p class="workflow-mobile-notice">{$t('settings.workflowDesktopOnly')}</p>
      {:else}
        <WorkflowDiagram />
      {/if}
    {:else if activeTab === 'Automations'}
      <div class="list">
        {#each $automationRules as rule (rule.id)}
          <div class="row column">
            <div class="row">
              <span class="row-name">{rule.name}</span>
              <span class="row-tag">on {Array.isArray(rule.eventFilter) ? rule.eventFilter.join(', ') : 'all events'}</span>
              <label class="toggle"><input type="checkbox" checked={rule.enabled} on:change={(e) => toggleRule(rule.id, (e.target as HTMLInputElement).checked)} />{$t('settings.enabledLabel')}</label>
              <button class="icon-btn" aria-label={$t('common.deleteNamed', { name: rule.name })} on:click={() => removeRule(rule.id)}><Icon name="trash" size={13} /></button>
            </div>
            {#if rule.conditions.length}
              <p class="rule-detail">{$t('settings.ruleConditionsPrefix')} {rule.conditions.map((c) => `${c.field} ${c.op} ${JSON.stringify(c.value)}`).join(` ${$t('settings.conditionJoiner')} `)}</p>
            {/if}
            <p class="rule-detail">{rule.actions.map((a) => describeAutomationAction(a, { workflow: $workflow, users: $users, fieldDefinitions: $fieldDefinitions }, $t)).join('; ')}</p>
          </div>
        {/each}
      </div>
      <form class="add-form column" on:submit|preventDefault={addRule}>
        <input type="text" placeholder={$t('settings.ruleNamePlaceholder')} bind:value={newRuleName} />
        <label class="agent-form-label">
          {$t('settings.triggerLabel')}
          <select bind:value={newRuleTrigger}>
            {#each commonEventTypes as eventType}<option value={eventType}>{eventType}</option>{/each}
          </select>
        </label>

        <span class="agent-form-label">{$t('settings.conditionsLabel')}</span>
        {#each newRuleConditions as condition, i}
          <div class="rule-row">
            <select bind:value={condition.field}>
              {#each CONDITION_FIELDS as f}<option value={f}>{f}</option>{/each}
            </select>
            <select bind:value={condition.op}>
              {#each FILTER_OPS as op}<option value={op}>{op}</option>{/each}
            </select>
            {#if condition.op !== 'isEmpty'}
              <input type="text" placeholder={$t('settings.valuePlaceholder')} bind:value={condition.value} />
            {/if}
            <button type="button" class="icon-btn" aria-label={$t('settings.removeConditionLabel')} on:click={() => removeCondition(i)}><Icon name="x" size={13} /></button>
          </div>
        {/each}
        <button type="button" class="text-btn add-row-btn" on:click={addCondition}>{$t('settings.addConditionButton')}</button>

        <span class="agent-form-label">{$t('settings.actionsLabel')}</span>
        {#each newRuleActions as action, i}
          <div class="rule-row">
            <select bind:value={action.type}>
              {#each AUTOMATION_ACTION_TYPES as actionType}<option value={actionType}>{actionType}</option>{/each}
            </select>
            {#if action.type === 'transitionStatus'}
              <select bind:value={action.toStatusId}>
                <option value="" disabled>{$t('settings.statusPlaceholder')}</option>
                {#each $workflow?.statuses ?? [] as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
              </select>
            {:else if action.type === 'assignTo'}
              <select bind:value={action.userId}>
                <option value="" disabled>{$t('settings.userPlaceholder')}</option>
                {#each assignableUsers as u (u.id)}<option value={u.id}>{u.displayName}</option>{/each}
              </select>
            {:else if action.type === 'addComment'}
              <input type="text" placeholder={$t('settings.commentBodyPlaceholder')} bind:value={action.body} />
            {:else if action.type === 'setField'}
              <select bind:value={action.fieldId}>
                <option value="" disabled>{$t('settings.fieldPlaceholder')}</option>
                {#each $fieldDefinitions as f (f.id)}<option value={f.id}>{f.name}</option>{/each}
              </select>
              <input type="text" placeholder={$t('settings.valuePlaceholder')} bind:value={action.value} />
            {:else if action.type === 'readRepoFile'}
              <input type="text" placeholder={$t('settings.pathPlaceholder')} bind:value={action.path} />
            {:else if action.type === 'writeRepoFile'}
              <input type="text" placeholder={$t('settings.pathPlaceholder')} bind:value={action.path} />
              <input type="text" placeholder={$t('settings.branchNamePlaceholder')} bind:value={action.branchName} />
              <input type="text" placeholder={$t('settings.fileContentPlaceholder')} bind:value={action.content} />
              <input type="text" placeholder={$t('settings.commitMessagePlaceholder')} bind:value={action.commitMessage} />
            {/if}
            {#if newRuleActions.length > 1}
              <button type="button" class="icon-btn" aria-label={$t('settings.removeActionLabel')} on:click={() => removeAction(i)}><Icon name="x" size={13} /></button>
            {/if}
          </div>
        {/each}
        <button type="button" class="text-btn add-row-btn" on:click={addAction}>{$t('settings.addActionButton')}</button>

        <button type="submit" disabled={!newRuleName.trim() || !newRuleActions.every(actionIsComplete) || !newRuleConditions.every(conditionIsComplete)}>{$t('settings.addRuleButton')}</button>
      </form>
    {:else if activeTab === 'Agents'}
      <AgentsSettings />
    {:else if activeTab === 'Git'}
      <GitConnectionsSettings />
    {:else if activeTab === 'Features'}
      <FeaturesSettings />
    {:else if activeTab === 'Webhooks'}
      <div class="list">
        {#each $webhookSubscriptions as hook (hook.id)}
          <div class="webhook-item">
            <div class="row">
              <span class="row-name">{hook.targetUrl}</span>
              <label class="toggle"><input type="checkbox" checked={hook.enabled} on:change={(e) => toggleWebhook(hook.id, (e.target as HTMLInputElement).checked)} />{$t('settings.enabledLabel')}</label>
              <div class="row-actions">
                <button
                  class="icon-btn history-btn"
                  class:active={expandedWebhookId === hook.id}
                  aria-label={$t('settings.webhookHistoryButton', { url: hook.targetUrl })}
                  aria-expanded={expandedWebhookId === hook.id}
                  on:click={() => toggleDeliveries(hook.id)}
                ><Icon name="clock" size={13} /></button>
                <button class="icon-btn" aria-label={$t('common.deleteNamed', { name: hook.targetUrl })} on:click={() => removeWebhook(hook.id)}><Icon name="trash" size={13} /></button>
              </div>
            </div>
            {#if expandedWebhookId === hook.id}
              <div class="deliveries">
                {#if deliveriesLoading[hook.id]}
                  <p class="no-activity">{$t('settings.webhookDeliveriesLoading')}</p>
                {:else if !deliveriesByWebhook[hook.id]?.deliveries.length}
                  <p class="no-activity">{$t('settings.webhookDeliveriesEmpty')}</p>
                {:else}
                  <div class="run-list">
                    {#each deliveriesByWebhook[hook.id].deliveries as delivery (delivery.id)}
                      <div class="run-row">
                        <span class="run-status status-{delivery.status}">{deliveryStatusLabel(delivery.status)}</span>
                        <span class="run-summary">{delivery.eventType}{delivery.statusCode !== undefined ? ` · ${delivery.statusCode}` : ''}{delivery.error ? ` · ${delivery.error}` : ''}</span>
                        <span class="run-time">{formatRelativeDate(delivery.createdAt, $t, $tn, $locale)}</span>
                      </div>
                    {/each}
                  </div>
                  {#if deliveriesByWebhook[hook.id].hasMore}
                    <button type="button" class="load-more-btn" on:click={() => loadMoreDeliveries(hook.id)}>{$t('settings.webhookDeliveriesLoadMore')}</button>
                  {/if}
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
      <form class="add-form" on:submit|preventDefault={addWebhook}>
        <input type="text" placeholder={$t('settings.webhookUrlPlaceholder')} bind:value={newWebhookUrl} />
        <button type="submit">{$t('settings.addWebhookButton')}</button>
      </form>
    {/if}
  </div>
  {/if}
</div>

<style>
  .settings { flex: 1; display: flex; overflow: hidden; }
  .tabs { flex: 0 0 200px; display: flex; flex-direction: column; padding: 12px 10px 16px; border-right: 1px solid var(--border); overflow-y: auto; }
  .tab-group { display: flex; flex-direction: column; gap: 2px; }
  .tab-group + .tab-group { margin-top: 14px; }
  .tab-heading {
    font-size: 10.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--text-3);
    padding: 4px 10px 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .tab { text-align: left; font-size: 12.5px; font-weight: 500; color: var(--text-2); padding: 7px 10px; border-radius: 7px; }
  .tab:hover { background: var(--surface-sunken); }
  .tab.active { background: var(--accent-soft); color: var(--accent-strong); font-weight: 600; }
  .panel { flex: 1; overflow-y: auto; padding: 20px 24px; }

  /* Phone layout: a grouped menu you drill into, with a Back header on the detail screen — see
     the `mobileMenuOpen` note in the script. Rows are full-width 48px+ touch targets. */
  .menu { flex: 1; overflow-y: auto; padding: 8px 16px 24px; }
  .menu-group + .menu-group { margin-top: 18px; }
  .menu-heading {
    font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--text-3);
    padding: 10px 4px 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .menu-row {
    display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 48px;
    padding: 0 14px; text-align: left; font-size: 14.5px; font-weight: 500; color: var(--text);
    background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px;
  }
  .menu-row + .menu-row { margin-top: 6px; }
  .menu-row :global(svg) { color: var(--text-3); transform: rotate(-90deg); }
  .menu-row:active { background: var(--surface-sunken); }
  .detail-head {
    position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 10px; padding: 6px 8px;
    background: var(--bg); border-bottom: 1px solid var(--border);
  }
  .back-btn { display: flex; align-items: center; gap: 2px; min-height: 44px; padding: 0 10px 0 6px; border-radius: 8px; font-size: 14px; font-weight: 500; color: var(--accent-strong); flex: 0 0 auto; }
  .back-chevron { display: flex; transform: rotate(90deg); }
  .detail-heading { display: flex; flex-direction: column; min-width: 0; }
  .detail-title { margin: 0; font-size: 15px; font-weight: 700; color: var(--text); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .detail-title:focus { outline: none; }
  .detail-group { font-size: 11px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  @media (max-width: 768px) {
    .settings { flex-direction: column; overflow: auto; }
    .panel { flex: 0 0 auto; overflow: visible; padding: 16px; }
    .row { padding: 11px 12px; font-size: 13.5px; }
    .icon-btn { padding: 8px; }
    .toggle { font-size: 13.5px; }
    .toggle input[type="checkbox"] { width: 18px; height: 18px; }
    .appearance-row { padding: 18px 16px; gap: 18px; }
    .theme-picker { gap: 18px; }
    .language-option { min-height: 44px; }
    .add-form { flex-wrap: wrap; }
    .add-form input, .add-form select { padding: 9px 11px; }
    .add-form button { padding: 10px 14px; }
    .rule-row { flex-wrap: wrap; }
    .rule-row select, .rule-row input { padding: 8px 10px; }
  }
  .subsection-label { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-2); margin: 18px 0 8px; }
  .subsection-label:first-child { margin-top: 0; }
  .list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
  .row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; font-size: 12.5px; }
  .row.column { flex-direction: column; align-items: stretch; }
  .row-name { color: var(--text); font-weight: 500; }
  .row-tag { color: var(--text-3); font-size: 11.5px; flex: 1; }
  .dot { width: 8px; height: 8px; border-radius: 2px; flex: 0 0 8px; }
  .appearance-row {
    display: flex; flex-direction: column; gap: 20px; width: 100%; box-sizing: border-box;
    padding: 24px 28px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px;
    /* Lets the language options below pick their column count from the card's own width, not the viewport's. */
    container-type: inline-size;
  }
  .appearance-row + .appearance-row { margin-top: 20px; }
  .appearance-copy { display: flex; flex-direction: column; gap: 5px; }
  .row-name { font-size: 15px; }
  .row-hint { color: var(--text-3); font-size: 12.5px; max-width: 480px; }

  /* iOS-Settings-style theme picker: each option is a large, abstract preview of this app's
     own chrome (sidebar + content + accent) rendered in that theme's actual colors — via the
     always-active --preview-light- and --preview-dark- vars (see index.html) — rather than a
     generic icon, so it's a real preview of what changes, not decoration. Sized to fill most of
     the available panel width rather than sitting as a small control. */
  .theme-picker { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 28px; width: 100%; }
  .theme-option { display: flex; flex-direction: column; align-items: center; gap: 12px; }
  .theme-preview {
    display: flex; width: 100%; aspect-ratio: 16 / 10; border-radius: 14px; overflow: hidden;
    border: 1px solid var(--border); box-shadow: 0 0 0 3px transparent; transition: box-shadow .15s ease, transform .15s ease;
  }
  .theme-option:hover .theme-preview { transform: translateY(-2px); }
  .theme-option.active .theme-preview { box-shadow: 0 0 0 3px var(--accent); }
  .theme-preview-light { background: var(--preview-light-bg); border-color: var(--preview-light-border); }
  .theme-preview-dark { background: var(--preview-dark-bg); border-color: var(--preview-dark-border); }
  .theme-preview-sidebar { flex: 0 0 28%; }
  .theme-preview-light .theme-preview-sidebar { background: var(--preview-light-sidebar-bg); }
  .theme-preview-dark .theme-preview-sidebar { background: var(--preview-dark-sidebar-bg); }
  .theme-preview-content { flex: 1; display: flex; flex-direction: column; gap: 10px; padding: 16px 14px; min-width: 0; }
  .theme-preview-bar { display: block; height: 7px; border-radius: 4px; width: 100%; }
  .theme-preview-bar.short { width: 55%; }
  .theme-preview-light .theme-preview-bar { background: var(--preview-light-border); }
  .theme-preview-dark .theme-preview-bar { background: var(--preview-dark-border); }
  .theme-preview-accent { display: block; width: 34%; height: 14px; border-radius: 7px; margin-top: auto; }
  .theme-preview-light .theme-preview-accent { background: var(--preview-light-accent); }
  .theme-preview-dark .theme-preview-accent { background: var(--preview-dark-accent); }
  /* "Match Browser" preview: split down the middle instead of showing one fixed palette, since
     which side is actually live depends on the OS setting, not a stored choice. */
  .theme-preview-half { flex: 1; display: flex; align-items: center; justify-content: center; }
  .theme-preview-half-light { background: var(--preview-light-bg); color: var(--preview-light-text-3); }
  .theme-preview-half-dark { background: var(--preview-dark-bg); color: var(--preview-dark-text-3); }
  .theme-option-footer { display: flex; align-items: center; gap: 7px; }
  .theme-option-check {
    width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    background: var(--surface-sunken); border: 1px solid var(--border-strong); color: transparent; transition: all .12s ease;
  }
  .theme-option.active .theme-option-check { background: var(--accent); border-color: var(--accent); color: var(--accent-on); }
  .theme-option-label { font-size: 13px; color: var(--text-2); }
  .theme-option.active .theme-option-label { color: var(--text); font-weight: 600; }

  /* Simpler than the theme picker above — a language has no meaningful "preview" the way a
     color scheme does, so this is just a row of selectable pills reusing the same
     check-and-label footer pattern instead of a big preview swatch. */
  /* Fills the card instead of hugging the left: equal-width options in as many columns as the card has room
     for (one on a phone, then 2 / 4 / 8). Thresholds allow ~185px per option, enough for the longest label. */
  .language-picker { display: grid; grid-template-columns: 1fr; gap: 10px; }
  @container (min-width: 400px) { .language-picker { grid-template-columns: repeat(2, 1fr); } }
  @container (min-width: 770px) { .language-picker { grid-template-columns: repeat(4, 1fr); } }
  @container (min-width: 1550px) { .language-picker { grid-template-columns: repeat(8, 1fr); } }
  .language-option {
    display: flex; align-items: center; gap: 8px; padding: 9px 16px; border-radius: 999px; min-width: 0;
    background: var(--surface-sunken); border: 1px solid var(--border); transition: border-color .12s ease;
  }
  .language-option:hover { border-color: var(--border-strong); }
  .language-option.active { border-color: var(--accent); background: var(--accent-soft); }
  .language-option-check {
    width: 16px; height: 16px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    background: var(--surface); border: 1px solid var(--border-strong); color: transparent; transition: all .12s ease;
  }
  .language-option.active .language-option-check { background: var(--accent); border-color: var(--accent); color: var(--accent-on); }
  .language-option-label { font-size: 13px; color: var(--text-2); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .language-option.active .language-option-label { color: var(--text); font-weight: 600; }
  .language-disclaimer {
    font-size: 12px; line-height: 1.5; color: var(--warning); background: var(--warning-soft);
    border-radius: 8px; padding: 9px 12px; margin: 14px 0 0; max-width: 560px;
  }
  .workflow-mobile-notice {
    font-size: 12.5px; line-height: 1.5; color: var(--text-2); background: var(--surface-2);
    border: 1px dashed var(--border); border-radius: 8px; padding: 16px; margin: 0; max-width: 480px;
  }
  .icon-btn { color: var(--text-3); padding: 4px; border-radius: 6px; margin-left: auto; }
  .icon-btn:hover { background: var(--surface); color: var(--critical); }
  .row-actions { display: flex; align-items: center; gap: 2px; margin-left: auto; }
  .row-actions .icon-btn { margin-left: 0; }
  .history-btn:hover { background: var(--surface); color: var(--text); }
  .history-btn.active { background: var(--surface); color: var(--accent-strong); }
  .webhook-item { display: flex; flex-direction: column; }
  .deliveries { padding: 2px 10px 10px; }
  .run-list { display: flex; flex-direction: column; gap: 4px; }
  .run-row { display: flex; align-items: center; gap: 10px; font-size: 12px; padding: 5px 0; }
  .run-status {
    font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em;
    border-radius: 5px; padding: 2px 7px; flex: 0 0 auto;
  }
  .run-status.status-success { color: var(--success); background: var(--success-soft); }
  .run-status.status-failure { color: var(--critical); background: var(--critical-soft); }
  .run-summary { color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .run-time { font-size: 11px; color: var(--text-3); white-space: nowrap; flex: 0 0 auto; }
  .no-activity { font-size: 12px; color: var(--text-3); padding: 6px 10px; margin: 0; }
  .load-more-btn { font-size: 11.5px; font-weight: 600; color: var(--accent-strong); padding: 6px 10px; border-radius: 6px; }
  .load-more-btn:hover { background: var(--surface); }
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
