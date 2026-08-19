<script lang="ts">
  import Icon from './Icon.svelte';
  import { currentView, currentProjectId, featureFlags, projects, selectedIssueId, switchProject, createNewProject, workspace, users } from '../stores/workspace';
  import { splitHumansAndAgents } from '../util';
  import { t, tn } from '../i18n';

  // AI agents are User rows (kind: 'agent') so they can be assigned/mentioned like anyone else,
  // but they aren't people — the workspace's member count should only reflect humans.
  $: memberCount = splitHumansAndAgents($users).humans.length;

  const allNavItems: { icon: string; labelKey: string; view: 'board' | 'backlog' }[] = [
    { icon: 'list', labelKey: 'nav.backlog', view: 'backlog' },
    { icon: 'columns', labelKey: 'nav.board', view: 'board' },
  ];
  $: navItems = $featureFlags.sprints ? allNavItems : allNavItems.filter((i) => i.view !== 'backlog');
  // Sprints just got turned off while looking at the Backlog view — nothing to show there anymore.
  $: if (!$featureFlags.sprints && $currentView === 'backlog') $currentView = 'board';

  /** Switching views always leaves the current ticket — Board/Backlog should show the list, not a stale drawer. */
  function goToView(view: 'board' | 'backlog') {
    $currentView = view;
    $selectedIssueId = null;
  }

  async function selectProject(id: string) {
    if (id === $currentProjectId) return;
    $currentView = 'board';
    await switchProject(id);
  }

  let showNewProjectForm = false;
  let newProjectName = '';
  let newProjectKey = '';
  let creatingProject = false;
  let newProjectError = '';

  async function submitNewProject() {
    if (!newProjectName.trim() || !newProjectKey.trim()) return;
    creatingProject = true;
    newProjectError = '';
    try {
      await createNewProject(newProjectName.trim(), newProjectKey.trim());
      newProjectName = '';
      newProjectKey = '';
      showNewProjectForm = false;
    } catch (err) {
      newProjectError = err instanceof Error ? err.message : $t('sidebar.failedCreateProject');
    } finally {
      creatingProject = false;
    }
  }
</script>

<aside class="sidebar">
  <div class="brand"><Icon name="anvil" size={22} />{$t('topBar.workhorseBrand')}</div>

  <button class="workspace" class:active={$currentView === 'workspace'} on:click={() => ($currentView = 'workspace')}>
    <div class="workspace-dot"></div>
    <div class="workspace-text">
      <div class="workspace-name">{$workspace?.name ?? ''}</div>
      <div class="workspace-sub">{$tn('common.members', memberCount)}</div>
    </div>
  </button>

  <nav class="nav">
    {#each navItems as item}
      <button class="nav-item" class:active={item.view === $currentView} on:click={() => goToView(item.view)}>
        <Icon name={item.icon} />{$t(item.labelKey)}
      </button>
    {/each}
  </nav>

  <div class="section-label">{$t('sidebar.projectsLabel')}</div>
  <nav class="nav" style="padding-top:0">
    {#each $projects as p (p.id)}
      <button type="button" class="proj-item" class:active={p.id === $currentProjectId} on:click={() => selectProject(p.id)}>
        <span class="proj-dot" style="background:{p.color}"></span>
        <span class="proj-name">{p.name}</span>
      </button>
    {/each}
    {#if showNewProjectForm}
      <form class="proj-new-form" on:submit|preventDefault={submitNewProject}>
        <input class="proj-new-input" type="text" placeholder={$t('sidebar.newProjectPlaceholder')} bind:value={newProjectName} />
        <input class="proj-new-input" type="text" placeholder={$t('sidebar.newProjectKeyPlaceholder')} bind:value={newProjectKey} />
        <div class="proj-new-actions">
          <button type="submit" class="proj-new-btn" disabled={creatingProject}>{creatingProject ? '…' : $t('common.create')}</button>
          <button type="button" class="proj-new-btn ghost" on:click={() => (showNewProjectForm = false)}>{$t('common.cancel')}</button>
        </div>
        {#if newProjectError}<p class="proj-new-error">{newProjectError}</p>{/if}
      </form>
    {:else}
      <button type="button" class="proj-item proj-add" on:click={() => (showNewProjectForm = true)}>
        <Icon name="plus" size={12} />{$t('sidebar.newProjectButton')}
      </button>
    {/if}
  </nav>
</aside>

<style>
  .sidebar {
    width: 224px;
    flex: 0 0 224px;
    background: var(--sidebar-bg);
    color: var(--sidebar-text);
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--sidebar-border);
    height: 100%;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 18px 18px 16px;
    font-weight: 700;
    font-size: 15px;
    color: var(--sidebar-text);
  }
  .brand :global(svg) { color: var(--accent); }
  .workspace {
    margin: 0 12px 14px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--sidebar-active-bg);
    display: flex;
    align-items: center;
    gap: 8px;
    border: 1px solid var(--sidebar-border);
    width: calc(100% - 24px);
    text-align: left;
  }
  .workspace:hover, .workspace.active { border-color: var(--accent); }
  .workspace-text { overflow: hidden; }
  .workspace-dot { width: 18px; height: 18px; border-radius: 5px; background: linear-gradient(140deg, var(--accent), var(--accent-strong)); flex: 0 0 18px; }
  .workspace-name { font-size: 12.5px; font-weight: 600; color: var(--sidebar-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .workspace-sub { font-size: 11px; color: var(--sidebar-text-dim); }
  .nav { padding: 4px 10px; display: flex; flex-direction: column; gap: 1px; }
  .nav-item {
    display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 7px;
    font-size: 12.5px; font-weight: 500; color: var(--sidebar-text); width: 100%; text-align: left;
  }
  .nav-item:hover { background: var(--sidebar-active-bg); color: var(--sidebar-text); }
  .nav-item.active { background: var(--sidebar-active-bg); color: var(--sidebar-text); font-weight: 600; }
  .section-label {
    font-size: 10.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase;
    color: var(--sidebar-text-dim); padding: 16px 14px 6px;
  }
  .proj-item {
    display: flex; align-items: center; gap: 9px; padding: 6px 10px; border-radius: 7px; font-size: 12.5px;
    color: var(--sidebar-text); width: 100%; text-align: left; background: none; border: none;
  }
  .proj-item:hover { background: var(--sidebar-active-bg); }
  .proj-item.active { background: var(--sidebar-active-bg); color: var(--sidebar-text); font-weight: 600; }
  .proj-dot { width: 8px; height: 8px; border-radius: 2px; flex: 0 0 8px; }
  .proj-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .proj-add { color: var(--sidebar-text-dim); }
  .proj-new-form { display: flex; flex-direction: column; gap: 6px; padding: 6px 10px; }
  .proj-new-input {
    font: inherit; font-size: 12px; color: var(--sidebar-text); background: var(--sidebar-active-bg); border: 1px solid var(--sidebar-border);
    border-radius: 6px; padding: 6px 8px;
  }
  .proj-new-actions { display: flex; gap: 6px; }
  .proj-new-btn { font-size: 11.5px; font-weight: 600; color: var(--accent-on); background: var(--accent); border-radius: 6px; padding: 5px 10px; flex: 1; }
  .proj-new-btn.ghost { color: var(--sidebar-text); background: var(--sidebar-active-bg); }
  .proj-new-btn:disabled { opacity: .5; }
  .proj-new-error { font-size: 11px; color: var(--critical); margin: 0; }

  /* Below 768px, MobileNav's bottom tab bar replaces this Sidebar outright (Board/Backlog are
     one tap away there, Projects/Settings live in its sheets) — so the old hamburger-triggered
     slide-in drawer is fully disabled here rather than left reachable through a removed
     trigger. Desktop's rules above are untouched. */
  @media (max-width: 768px) {
    .sidebar { display: none; }
  }
</style>
