<script lang="ts">
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import NewIssueModal from './NewIssueModal.svelte';
  import AccountSettingsModal from './AccountSettingsModal.svelte';
  import { currentUser, logout } from '../stores/auth';
  import { currentView, issuesStore, mobileNavOpen, selectedIssueId, settingsJumpTab, sprints } from '../stores/workspace';

  const tabs: { label: string; view: 'board' | 'backlog' }[] = [
    { label: 'Board', view: 'board' },
    { label: 'Backlog', view: 'backlog' },
  ];

  $: activeSprint = $sprints.find((s) => s.state === 'active');
  // Only shows the ticket pill while a ticket is actually the thing on screen — not while
  // parked on Settings or the Workspace view with a stale selection left over.
  $: viewingIssue = $currentView === 'board' || $currentView === 'backlog';
  $: selectedIssue = viewingIssue && $selectedIssueId ? $issuesStore.find((i) => i.id === $selectedIssueId) : undefined;

  /** Switching views always leaves the current ticket — Board/Backlog should show the list, not a stale drawer. */
  function goToView(view: 'board' | 'backlog') {
    $currentView = view;
    $selectedIssueId = null;
  }

  let showNewIssue = false;
  let showAccountSettings = false;
  let showUserMenu = false;
  let showNewMenu = false;
  let userMenuWrap: HTMLDivElement;
  let newMenuWrap: HTMLDivElement;

  function toggleUserMenu() {
    showUserMenu = !showUserMenu;
    showNewMenu = false;
  }

  function toggleNewMenu() {
    showNewMenu = !showNewMenu;
    showUserMenu = false;
  }

  /** Closes either menu on any click outside it, without needing a full-screen backdrop. */
  function handleWindowClick(e: MouseEvent) {
    if (showUserMenu && userMenuWrap && !userMenuWrap.contains(e.target as Node)) showUserMenu = false;
    if (showNewMenu && newMenuWrap && !newMenuWrap.contains(e.target as Node)) showNewMenu = false;
  }

  function handleLogout() {
    showUserMenu = false;
    logout();
  }

  function openAccountSettings() {
    showUserMenu = false;
    showAccountSettings = true;
  }

  function newIssue() {
    showNewMenu = false;
    showNewIssue = true;
  }

  function newSprint() {
    showNewMenu = false;
    goToView('backlog');
  }

  function newCatalogItem(tab: string) {
    showNewMenu = false;
    $settingsJumpTab = tab;
    // Components/Versions live in project settings now; Labels stays in workspace settings.
    $currentView = tab === 'Components' || tab === 'Versions' ? 'projectSettings' : 'settings';
  }
</script>

<svelte:window on:click={handleWindowClick} />

<header class="topbar">
  <div class="crumb-tabs">
    <button class="icon-btn menu-btn" title="Menu" on:click={() => ($mobileNavOpen = !$mobileNavOpen)}><Icon name="lines" /></button>
    <div class="crumb"><b>Workhorse</b><span>/</span><span>{activeSprint?.name ?? 'No active sprint'}</span></div>
    <div class="view-tabs">
      {#each tabs as tab}
        <button class="view-tab" class:active={tab.view === $currentView && !selectedIssue} on:click={() => goToView(tab.view)}>{tab.label}</button>
      {/each}
    </div>
    {#if selectedIssue}
      <span class="issue-pill mono"><Icon name="chevron" size={10} />{selectedIssue.key}</span>
    {/if}
  </div>
  <div class="topbar-right">
    <div class="new-menu-wrap" bind:this={newMenuWrap}>
      <button class="new-issue-btn" on:click={toggleNewMenu}><Icon name="plus" size={13} /><span class="new-issue-label">New…</span></button>
      {#if showNewMenu}
        <div class="dropdown">
          <button class="dropdown-item" on:click={newIssue}>Issue</button>
          <button class="dropdown-item" on:click={newSprint}>Sprint</button>
          <div class="dropdown-sep"></div>
          <button class="dropdown-item" on:click={() => newCatalogItem('Labels')}>Label</button>
          <button class="dropdown-item" on:click={() => newCatalogItem('Components')}>Component</button>
          <button class="dropdown-item" on:click={() => newCatalogItem('Versions')}>Version</button>
        </div>
      {/if}
    </div>
    <button class="icon-btn" title="Project settings" on:click={() => ($currentView = 'projectSettings')}><Icon name="grid" /></button>
    <button class="icon-btn" title="Workspace settings" on:click={() => ($currentView = 'settings')}><Icon name="gear" /></button>
    {#if $currentUser}
      <div class="user-menu-wrap" bind:this={userMenuWrap}>
        <button class="avatar-btn" on:click={toggleUserMenu}>
          <Avatar userId={$currentUser.id} name={$currentUser.displayName} avatarUrl={$currentUser.avatarUrl} size={28} />
        </button>
        {#if showUserMenu}
          <div class="dropdown">
            <div class="user-menu-info">
              <div class="user-menu-name">{$currentUser.displayName}</div>
              <div class="user-menu-email">{$currentUser.email}</div>
            </div>
            <button class="dropdown-item" on:click={openAccountSettings}>Account settings</button>
            <button class="dropdown-item" on:click={handleLogout}>Log out</button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</header>

{#if showNewIssue}
  <NewIssueModal onClose={() => (showNewIssue = false)} />
{/if}

{#if showAccountSettings}
  <AccountSettingsModal onClose={() => (showAccountSettings = false)} />
{/if}

<style>
  .topbar {
    flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
    padding: 0 20px; height: 54px; border-bottom: 1px solid var(--border); background: var(--surface);
    gap: 16px;
  }
  .crumb-tabs { display: flex; align-items: center; gap: 18px; min-width: 0; }
  .crumb { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-2); white-space: nowrap; }
  .crumb b { color: var(--text); font-weight: 600; }
  .view-tabs { display: flex; align-items: center; gap: 2px; background: var(--surface-sunken); border-radius: 8px; padding: 3px; }
  .view-tab { padding: 5px 12px; font-size: 12.5px; font-weight: 500; color: var(--text-2); border-radius: 6px; }
  .view-tab.active { background: var(--surface); color: var(--text); box-shadow: var(--shadow); font-weight: 600; }
  .issue-pill {
    display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; color: var(--accent-strong);
    background: var(--accent-soft); padding: 5px 10px; border-radius: 6px; white-space: nowrap;
  }
  .issue-pill :global(svg) { transform: rotate(-90deg); }
  .topbar-right { display: flex; align-items: center; gap: 14px; flex: 0 0 auto; }
  .icon-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 7px; color: var(--text-2); }
  .icon-btn:hover { background: var(--surface-sunken); color: var(--text); }
  .new-issue-btn {
    display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: var(--accent-on);
    background: var(--accent); padding: 7px 12px; border-radius: 7px; white-space: nowrap;
  }
  .new-issue-btn:hover { background: var(--accent-strong); }
  .new-menu-wrap, .user-menu-wrap { position: relative; }
  .avatar-btn { display: flex; border-radius: 50%; }
  .avatar-btn:hover { opacity: 0.85; }
  .dropdown {
    position: absolute; top: calc(100% + 8px); right: 0; z-index: 20; min-width: 170px;
    background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
    box-shadow: var(--shadow-lg); padding: 6px; display: flex; flex-direction: column;
  }
  .dropdown-sep { height: 1px; background: var(--border); margin: 4px 2px; }
  .user-menu-info { padding: 8px 10px 10px; border-bottom: 1px solid var(--border); margin-bottom: 4px; }
  .user-menu-name { font-size: 12.5px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .user-menu-email { font-size: 11px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dropdown-item { width: 100%; text-align: left; font-size: 12.5px; color: var(--text-2); padding: 7px 10px; border-radius: 6px; }
  .dropdown-item:hover { background: var(--surface-sunken); color: var(--text); }
  .menu-btn { display: none; flex: 0 0 auto; }

  @media (max-width: 768px) {
    .topbar { padding: 0 10px; gap: 8px; }
    .menu-btn { display: flex; }
    .crumb { display: none; }
    .crumb-tabs { min-width: 0; overflow: hidden; }
    /* The sidebar's own nav already covers Board/Backlog on mobile — drop the duplicate
       tabs here so the space goes to the issue-key pill instead, which can't go anywhere else. */
    .view-tabs { display: none; }
    .issue-pill { overflow: hidden; text-overflow: ellipsis; }
  }
  @media (max-width: 480px) {
    .new-issue-label { display: none; }
    .new-issue-btn { padding: 7px 9px; }
  }
</style>
