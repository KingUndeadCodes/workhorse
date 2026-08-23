<script lang="ts">
  /**
   * Mobile-only bottom tab bar — replaces the hamburger + full-height Sidebar drawer below the
   * 768px breakpoint (see Sidebar.svelte/TopBar.svelte, where that drawer is now disabled on
   * mobile). The desktop Sidebar is a mouse-era pattern: a narrow list of small click targets
   * off to one side. On a phone the primary views (Board/Backlog) deserve a one-tap-reachable
   * home, same as any native app, so this is a fixed tab bar instead — Projects and
   * Settings/Account (both infrequent) are consolidated into two bottom sheets rather than each
   * getting their own tab, since there's only so much width along the bottom edge.
   * Rendered by App.svelte alongside the existing desktop chrome; invisible above 768px via the
   * media query below, so it never touches desktop layout.
   */
  import Icon from './Icon.svelte';
  import BottomSheet from './BottomSheet.svelte';
  import NewIssueModal from './NewIssueModal.svelte';
  import AccountSettingsModal from './AccountSettingsModal.svelte';
  import { currentUser, logout } from '../stores/auth';
  import {
    createNewProject,
    currentProjectId,
    currentView,
    featureFlags,
    projects,
    selectedIssueId,
    switchProject,
    users,
    workspace,
  } from '../stores/workspace';
  import { splitHumansAndAgents } from '../util';
  import { isMobile } from '../stores/viewport';
  import { goToNewCatalogItem, goToNewSprint } from '../actions/quickCreate';
  import { t, tn } from '../i18n';

  const primaryTabs: { icon: string; labelKey: string; view: 'board' | 'backlog' }[] = [
    { icon: 'columns', labelKey: 'nav.board', view: 'board' },
    { icon: 'list', labelKey: 'nav.backlog', view: 'backlog' },
  ];
  $: tabs = $featureFlags.sprints ? primaryTabs : primaryTabs.filter((tab) => tab.view !== 'backlog');
  $: viewingIssue = $currentView === 'board' || $currentView === 'backlog';
  $: memberCount = splitHumansAndAgents($users).humans.length;

  function goToView(view: 'board' | 'backlog') {
    $currentView = view;
    $selectedIssueId = null;
  }

  let showNewIssue = false;
  let showNewCreate = false;
  let showProjects = false;
  let showMore = false;
  let showAccountSettings = false;

  function openNewIssue() {
    showNewCreate = false;
    showNewIssue = true;
  }
  function createNewSprint() {
    showNewCreate = false;
    goToNewSprint();
  }
  function createNewCatalogItem(tab: 'Labels' | 'Components' | 'Versions') {
    showNewCreate = false;
    goToNewCatalogItem(tab);
  }

  async function selectProject(id: string) {
    showProjects = false;
    if (id === $currentProjectId) return;
    $currentView = 'board';
    $selectedIssueId = null;
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

  function goTo(view: 'settings' | 'projectSettings' | 'workspace' | 'stats') {
    showMore = false;
    $currentView = view;
    $selectedIssueId = null;
  }

  function handleLogout() {
    showMore = false;
    logout();
  }
</script>

<nav class="mobile-nav">
  {#each tabs as tab (tab.view)}
    <button
      type="button"
      class="nav-btn"
      class:active={tab.view === $currentView && viewingIssue && !$selectedIssueId}
      on:click={() => goToView(tab.view)}
    >
      <Icon name={tab.icon} size={19} />
      <span>{$t(tab.labelKey)}</span>
    </button>
  {/each}

  <button type="button" class="nav-btn create-btn" on:click={() => (showNewCreate = true)}>
    <span class="create-circle"><Icon name="plus" size={18} /></span>
    <span>{$t('mobileNav.newTab')}</span>
  </button>

  <button type="button" class="nav-btn" class:active={showProjects} on:click={() => (showProjects = true)}>
    <Icon name="grid" size={19} />
    <span>{$t('mobileNav.projectsTab')}</span>
  </button>

  <button
    type="button"
    class="nav-btn"
    class:active={showMore || $currentView === 'settings' || $currentView === 'projectSettings' || $currentView === 'workspace' || $currentView === 'stats'}
    on:click={() => (showMore = true)}
  >
    <Icon name="gear" size={19} />
    <span>{$t('mobileNav.moreTab')}</span>
  </button>
</nav>

<BottomSheet open={showNewCreate && $isMobile} title={$t('mobileNav.newTab')} onClose={() => (showNewCreate = false)}>
  <div class="sheet-list">
    <button type="button" class="sheet-row" on:click={openNewIssue}>
      <Icon name="plus" size={15} />
      <span class="sheet-row-label">{$t('topBar.newIssue')}</span>
    </button>
    {#if $featureFlags.sprints}
      <button type="button" class="sheet-row" on:click={createNewSprint}>
        <Icon name="list" size={15} />
        <span class="sheet-row-label">{$t('topBar.newSprint')}</span>
      </button>
    {/if}
    {#if $featureFlags.labels}
      <button type="button" class="sheet-row" on:click={() => createNewCatalogItem('Labels')}>
        <Icon name="gear" size={15} />
        <span class="sheet-row-label">{$t('topBar.newLabel')}</span>
      </button>
    {/if}
    {#if $featureFlags.componentsAndVersions}
      <button type="button" class="sheet-row" on:click={() => createNewCatalogItem('Components')}>
        <Icon name="grid" size={15} />
        <span class="sheet-row-label">{$t('topBar.newComponent')}</span>
      </button>
      <button type="button" class="sheet-row" on:click={() => createNewCatalogItem('Versions')}>
        <Icon name="grid" size={15} />
        <span class="sheet-row-label">{$t('topBar.newVersion')}</span>
      </button>
    {/if}
  </div>
</BottomSheet>

<BottomSheet open={showProjects && $isMobile} title={$workspace?.name ?? ''} onClose={() => (showProjects = false)}>
  <div class="sheet-list">
    {#each $projects as p (p.id)}
      <button type="button" class="sheet-row" class:active={p.id === $currentProjectId} on:click={() => selectProject(p.id)}>
        <span class="proj-dot" style="background:{p.color}"></span>
        <span class="sheet-row-label">{p.name}</span>
        {#if p.id === $currentProjectId}<Icon name="check" size={14} />{/if}
      </button>
    {/each}
  </div>
  {#if showNewProjectForm}
    <form class="new-project-form" on:submit|preventDefault={submitNewProject}>
      <input class="new-project-input" type="text" placeholder={$t('sidebar.newProjectPlaceholder')} aria-label={$t('sidebar.newProjectPlaceholder')} bind:value={newProjectName} />
      <input class="new-project-input" type="text" placeholder={$t('sidebar.newProjectKeyPlaceholder')} aria-label={$t('sidebar.newProjectKeyPlaceholder')} bind:value={newProjectKey} />
      <div class="new-project-actions">
        <button type="button" class="sheet-btn ghost" on:click={() => (showNewProjectForm = false)}>{$t('common.cancel')}</button>
        <button type="submit" class="sheet-btn primary" disabled={creatingProject}>{creatingProject ? $t('common.creating') : $t('common.create')}</button>
      </div>
      {#if newProjectError}<p class="new-project-error">{newProjectError}</p>{/if}
    </form>
  {:else}
    <button type="button" class="sheet-row add-row" on:click={() => (showNewProjectForm = true)}>
      <Icon name="plus" size={14} />
      <span class="sheet-row-label">{$t('mobileNav.newProjectRow')}</span>
    </button>
  {/if}
</BottomSheet>

<BottomSheet open={showMore && $isMobile} onClose={() => (showMore = false)}>
  {#if $currentUser}
    <div class="more-user-row">
      <div class="more-user-avatar">{$currentUser.displayName.slice(0, 1).toUpperCase()}</div>
      <div class="more-user-info">
        <div class="more-user-name">{$currentUser.displayName}</div>
        <div class="more-user-email">{$currentUser.email}</div>
      </div>
    </div>
  {/if}
  <div class="sheet-list">
    <button type="button" class="sheet-row" on:click={() => goTo('workspace')}>
      <Icon name="bars" size={15} />
      <span class="sheet-row-label">{$workspace?.name ?? ''} · {$tn('common.members', memberCount)}</span>
    </button>
    <button type="button" class="sheet-row" on:click={() => goTo('stats')}>
      <Icon name="columns" size={15} />
      <span class="sheet-row-label">{$t('mobileNav.statsRow')}</span>
    </button>
    <button type="button" class="sheet-row" on:click={() => goTo('projectSettings')}>
      <Icon name="grid" size={15} />
      <span class="sheet-row-label">{$t('mobileNav.projectSettingsRow')}</span>
    </button>
    <button type="button" class="sheet-row" on:click={() => goTo('settings')}>
      <Icon name="gear" size={15} />
      <span class="sheet-row-label">{$t('mobileNav.workspaceSettingsRow')}</span>
    </button>
    <button type="button" class="sheet-row" on:click={() => ((showMore = false), (showAccountSettings = true))}>
      <Icon name="pencil" size={15} />
      <span class="sheet-row-label">{$t('mobileNav.accountSettingsRow')}</span>
    </button>
    <button type="button" class="sheet-row danger" on:click={handleLogout}>
      <Icon name="x" size={15} />
      <span class="sheet-row-label">{$t('mobileNav.logOutRow')}</span>
    </button>
  </div>
</BottomSheet>

{#if showNewIssue}
  <NewIssueModal onClose={() => (showNewIssue = false)} />
{/if}

{#if showAccountSettings}
  <AccountSettingsModal onClose={() => (showAccountSettings = false)} />
{/if}

<style>
  /* Hidden entirely above the mobile breakpoint — this component only ever renders below it,
     but the guard stays here too since App.svelte mounts it unconditionally. */
  .mobile-nav { display: none; }
  @media (max-width: 768px) {
    .mobile-nav {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 45;
      display: flex; align-items: stretch; justify-content: space-around;
      background: var(--surface); border-top: 1px solid var(--border);
      /* A flat env(safe-area-inset-bottom) leaves the bar's labels sitting flush against the
         home indicator on gesture-nav iPhones — no breathing room at all below the text. The
         extra 8px is a fixed minimum gap on top of whatever the safe area itself provides. */
      padding-bottom: calc(8px + env(safe-area-inset-bottom));
      box-shadow: 0 -2px 12px rgba(0, 0, 0, .06);
    }
    .nav-btn {
      flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 3px; padding: 8px 2px 7px; color: var(--text-3); font-size: 10.5px; font-weight: 600;
      min-height: 54px;
    }
    .nav-btn.active { color: var(--accent-strong); }
    .nav-btn :global(svg) { color: inherit; }
    .create-btn { color: var(--text-2); }
    .create-circle {
      width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
      background: var(--component-create-button-bg, var(--accent)); color: var(--component-create-button-fg, var(--accent-on));
      margin-bottom: 1px;
    }

    .sheet-list { display: flex; flex-direction: column; gap: 2px; }
    .sheet-row {
      display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
      padding: 13px 10px; border-radius: 10px; font-size: 14.5px; font-weight: 500; color: var(--text);
    }
    .sheet-row:active { background: var(--surface-sunken); }
    .sheet-row.active { color: var(--accent-strong); font-weight: 600; background: var(--accent-soft); }
    .sheet-row.danger { color: var(--critical); }
    .sheet-row-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sheet-row :global(svg) { flex: 0 0 auto; }
    .proj-dot { width: 9px; height: 9px; border-radius: 3px; flex: 0 0 9px; }
    .add-row { color: var(--text-3); }

    .more-user-row { display: flex; align-items: center; gap: 12px; padding: 6px 10px 10px; border-bottom: 1px solid var(--border); }
    .more-user-avatar {
      width: 40px; height: 40px; border-radius: 50%; flex: 0 0 40px; display: flex; align-items: center; justify-content: center;
      background: var(--accent-soft); color: var(--accent-strong); font-weight: 700; font-size: 15px;
    }
    .more-user-info { min-width: 0; }
    .more-user-name { font-size: 14.5px; font-weight: 700; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .more-user-email { font-size: 12.5px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .new-project-form { display: flex; flex-direction: column; gap: 8px; padding: 8px 10px 2px; }
    .new-project-input {
      font: inherit; font-size: 16px; color: var(--text); background: var(--surface-2); border: 1px solid var(--border);
      border-radius: 9px; padding: 10px 12px;
    }
    .new-project-actions { display: flex; gap: 8px; }
    .sheet-btn { flex: 1; font-size: 13.5px; font-weight: 600; padding: 10px 0; border-radius: 9px; }
    .sheet-btn.ghost { color: var(--text-2); background: var(--surface-sunken); }
    .sheet-btn.primary { color: var(--accent-on); background: var(--accent); }
    .sheet-btn.primary:disabled { opacity: .5; }
    .new-project-error { font-size: 12px; color: var(--critical); margin: 0; }
  }
</style>
