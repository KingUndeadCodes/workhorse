<script lang="ts">
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import NewIssueModal from './NewIssueModal.svelte';
  import AccountSettingsModal from './AccountSettingsModal.svelte';
  import NotificationBell from './NotificationBell.svelte';
  import { currentUser, logout } from '../stores/auth';
  import { currentView, featureFlags, issuesStore, selectedIssueId, sprints } from '../stores/workspace';
  import { goToNewCatalogItem, goToNewSprint } from '../actions/quickCreate';
  import { t } from '../i18n';

  const allTabs: { labelKey: string; view: 'board' | 'backlog' }[] = [
    { labelKey: 'nav.board', view: 'board' },
    { labelKey: 'nav.backlog', view: 'backlog' },
  ];
  $: tabs = $featureFlags.sprints ? allTabs : allTabs.filter((tab) => tab.view !== 'backlog');

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
    goToNewSprint();
  }

  function newCatalogItem(tab: 'Labels' | 'Components' | 'Versions') {
    showNewMenu = false;
    goToNewCatalogItem(tab);
  }
</script>

<svelte:window on:click={handleWindowClick} />

<header class="topbar">
  <div class="crumb-tabs">
    <div class="crumb"><b>{$t('topBar.workhorseBrand')}</b><span>/</span><span>{activeSprint?.name ?? $t('topBar.noActiveSprint')}</span></div>
    <div class="mobile-brand"><Icon name="anvil" size={18} />{$t('topBar.workhorseBrand')}</div>
    <div class="view-tabs">
      {#each tabs as tab}
        <button class="view-tab" class:active={tab.view === $currentView && !selectedIssue} on:click={() => goToView(tab.view)}>{$t(tab.labelKey)}</button>
      {/each}
    </div>
    {#if selectedIssue}
      <span class="issue-pill mono"><Icon name="chevron" size={10} />{selectedIssue.key}</span>
    {/if}
  </div>
  <div class="topbar-right">
    <div class="new-menu-wrap" bind:this={newMenuWrap}>
      <button class="new-issue-btn" on:click={toggleNewMenu}><Icon name="plus" size={13} /><span class="new-issue-label">{$t('topBar.newButton')}</span></button>
      {#if showNewMenu}
        <div class="dropdown">
          <button class="dropdown-item" on:click={newIssue}>{$t('topBar.newIssue')}</button>
          {#if $featureFlags.sprints}<button class="dropdown-item" on:click={newSprint}>{$t('topBar.newSprint')}</button>{/if}
          <div class="dropdown-sep"></div>
          {#if $featureFlags.labels}<button class="dropdown-item" on:click={() => newCatalogItem('Labels')}>{$t('topBar.newLabel')}</button>{/if}
          {#if $featureFlags.componentsAndVersions}
            <button class="dropdown-item" on:click={() => newCatalogItem('Components')}>{$t('topBar.newComponent')}</button>
            <button class="dropdown-item" on:click={() => newCatalogItem('Versions')}>{$t('topBar.newVersion')}</button>
          {/if}
        </div>
      {/if}
    </div>
    <button class="icon-btn stats-btn" title={$t('topBar.statsTitle')} aria-label={$t('topBar.statsTitle')} on:click={() => ($currentView = 'stats')}><Icon name="columns" /></button>
    <button class="icon-btn project-settings-btn" title={$t('topBar.projectSettingsTitle')} aria-label={$t('topBar.projectSettingsTitle')} on:click={() => ($currentView = 'projectSettings')}><Icon name="grid" /></button>
    <button class="icon-btn workspace-settings-btn" title={$t('topBar.workspaceSettingsTitle')} aria-label={$t('topBar.workspaceSettingsTitle')} on:click={() => ($currentView = 'settings')}><Icon name="gear" /></button>
    {#if $currentUser}<NotificationBell />{/if}
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
            <button class="dropdown-item" on:click={openAccountSettings}>{$t('topBar.accountSettings')}</button>
            <button class="dropdown-item" on:click={handleLogout}>{$t('topBar.logOut')}</button>
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
  /* overflow: hidden is load-bearing, not decorative — without it, once this box gets
     squeezed narrower than .crumb + .view-tabs' combined content width (the band of widths
     just above the 768px breakpoint, before .crumb disappears entirely below it), the content
     doesn't reflow or truncate on its own: it just renders past this box's shrunk edge and
     visually overlaps .topbar-right's "+ New…" button sitting right after it. */
  .crumb-tabs { display: flex; align-items: center; gap: 18px; min-width: 0; overflow: hidden; }
  /* The least essential piece here (brand + sprint name, vs. the Board/Backlog tabs actually
     needed for navigation) — flex-shrink/min-width:0 make it the one that gives up space and
     clips first as the bar narrows, instead of both pieces shrinking together and neither
     staying legible. */
  .crumb { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-2); white-space: nowrap; flex-shrink: 1; min-width: 0; overflow: hidden; }
  .crumb b { color: var(--text); font-weight: 600; }
  .mobile-brand { display: none; }
  .view-tabs { display: flex; align-items: center; gap: 2px; background: var(--surface-sunken); border-radius: 8px; padding: 3px; flex-shrink: 0; }
  .view-tab { padding: 5px 12px; font-size: 12.5px; font-weight: 500; color: var(--text-2); border-radius: 6px; }
  .view-tab.active { background: var(--surface); color: var(--text); box-shadow: var(--shadow); font-weight: 600; }
  .issue-pill {
    display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; color: var(--accent-strong);
    background: var(--accent-soft); padding: 5px 10px; border-radius: 6px; white-space: nowrap; flex-shrink: 0;
  }
  .issue-pill :global(svg) { transform: rotate(-90deg); }
  .topbar-right { display: flex; align-items: center; gap: 14px; flex: 0 0 auto; }
  .icon-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 7px; color: var(--text-2); }
  .icon-btn:hover { background: var(--surface-sunken); color: var(--text); }
  /* --component-create-button-bg/-fg come from ui.config.json's colorSchemes.*.components
     ("create-button" entry) — see index.html — and fall back to the normal accent colors when a
     scheme doesn't override them. Hover uses a brightness filter rather than a second configured
     color (--accent-strong's role for the default case), since it has to work regardless of
     which color source is live. */
  .new-issue-btn {
    display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: var(--component-create-button-fg, var(--accent-on));
    background: var(--component-create-button-bg, var(--accent)); padding: 7px 12px; border-radius: 7px; white-space: nowrap;
    transition: filter .1s ease;
  }
  .new-issue-btn:hover { filter: brightness(0.92); }
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
  @media (max-width: 768px) {
    .topbar { padding: 0 10px; gap: 8px; height: 58px; }
    /* MobileNav's bottom tab bar replaces the old hamburger-triggered drawer below this width
       — Board/Backlog/Projects/Settings are all one tap away there instead of a second tap
       through a menu, so the icon-only project/workspace settings buttons (now reachable from
       MobileNav's More sheet) stay hidden on mobile too. */
    .stats-btn, .project-settings-btn, .workspace-settings-btn { display: none; }
    .crumb { display: none; }
    /* Nothing else occupies the bar's left side on mobile (crumb hidden, tabs hidden below) —
       shows the wordmark instead of leaving it blank, same identity Sidebar's .brand carries
       on desktop. */
    .mobile-brand { display: flex; align-items: center; gap: 7px; font-size: 14.5px; font-weight: 700; color: var(--text); white-space: nowrap; }
    .mobile-brand :global(svg) { color: var(--accent); }
    .crumb-tabs { min-width: 0; overflow: hidden; }
    /* The sidebar's own nav already covers Board/Backlog on mobile — drop the duplicate
       tabs here so the space goes to the issue-key pill instead, which can't go anywhere else. */
    .view-tabs { display: none; }
    .issue-pill { overflow: hidden; text-overflow: ellipsis; font-size: 13px; padding: 6px 11px; }
    /* MobileNav's own "New" tab already creates an issue one tap away — this dropdown's other
       options (Sprint/Label/Component/Version) are just shortcuts to creation forms that already
       live in Backlog/Settings/Project settings, all reachable from MobileNav's More sheet, so
       nothing is lost by dropping the second, redundant "+" button here. */
    .new-menu-wrap { display: none; }
    /* MobileNav's own "More" sheet already has Account settings and Log out rows — without
       this, there were two ways to do both: this dropdown, and that sheet. */
    .user-menu-wrap { display: none; }
  }
</style>
