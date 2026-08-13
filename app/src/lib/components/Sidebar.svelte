<script lang="ts">
  import Icon from './Icon.svelte';
  import { currentView, mobileNavOpen, selectedIssueId, workspace, project, users } from '../stores/workspace';

  const navItems: { icon: string; label: string; view: 'board' | 'backlog' }[] = [
    { icon: 'list', label: 'Backlog', view: 'backlog' },
    { icon: 'columns', label: 'Board', view: 'board' },
  ];

  /** Switching views always leaves the current ticket — Board/Backlog should show the list, not a stale drawer.
   * Also closes the off-canvas sidebar, since on mobile a nav tap should return to content. */
  function goToView(view: 'board' | 'backlog') {
    $currentView = view;
    $selectedIssueId = null;
    $mobileNavOpen = false;
  }
</script>

{#if $mobileNavOpen}
  <button class="backdrop" aria-label="Close menu" on:click={() => ($mobileNavOpen = false)}></button>
{/if}

<aside class="sidebar" class:open={$mobileNavOpen}>
  <div class="brand"><Icon name="anvil" size={22} />Anvil</div>

  <button class="workspace" class:active={$currentView === 'workspace'} on:click={() => (($currentView = 'workspace'), ($mobileNavOpen = false))}>
    <div class="workspace-dot"></div>
    <div class="workspace-text">
      <div class="workspace-name">{$workspace?.name ?? ''}</div>
      <div class="workspace-sub">{$users.length} {$users.length === 1 ? 'member' : 'members'}</div>
    </div>
  </button>

  <nav class="nav">
    {#each navItems as item}
      <button class="nav-item" class:active={item.view === $currentView} on:click={() => goToView(item.view)}>
        <Icon name={item.icon} />{item.label}
      </button>
    {/each}
  </nav>

  <div class="section-label">Project</div>
  <nav class="nav" style="padding-top:0">
    <div class="proj-item active">
      <span class="proj-dot" style="background:var(--epic-a)"></span>
      <span class="proj-name">{$project?.name ?? ''}</span>
    </div>
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
    color: #F2F3F6;
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
  .workspace-dot { width: 18px; height: 18px; border-radius: 5px; background: linear-gradient(140deg, var(--accent), #0C4A43); flex: 0 0 18px; }
  .workspace-name { font-size: 12.5px; font-weight: 600; color: #EDEEF2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .workspace-sub { font-size: 11px; color: var(--sidebar-text-dim); }
  .nav { padding: 4px 10px; display: flex; flex-direction: column; gap: 1px; }
  .nav-item {
    display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 7px;
    font-size: 12.5px; font-weight: 500; color: var(--sidebar-text); width: 100%; text-align: left;
  }
  .nav-item:hover { background: var(--sidebar-active-bg); color: #F1F2F5; }
  .nav-item.active { background: rgba(63, 203, 184, .16); color: #7FE0D1; }
  .section-label {
    font-size: 10.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase;
    color: var(--sidebar-text-dim); padding: 16px 14px 6px;
  }
  .proj-item { display: flex; align-items: center; gap: 9px; padding: 6px 10px; border-radius: 7px; font-size: 12.5px; color: var(--sidebar-text); width: 100%; text-align: left; }
  .proj-item.active { background: var(--sidebar-active-bg); color: #F1F2F5; font-weight: 600; }
  .proj-dot { width: 8px; height: 8px; border-radius: 2px; flex: 0 0 8px; }
  .proj-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .backdrop { display: none; }

  @media (max-width: 768px) {
    .backdrop {
      display: block; position: fixed; inset: 0; background: rgba(0, 0, 0, .45); border: none; padding: 0;
      z-index: 39; cursor: default;
    }
    .sidebar {
      position: fixed; inset: 0 auto 0 0; z-index: 40; transform: translateX(-100%);
      transition: transform .18s ease; box-shadow: var(--shadow-lg);
    }
    .sidebar.open { transform: translateX(0); }
  }
</style>
