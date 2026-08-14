<script lang="ts">
  import Sidebar from './lib/components/Sidebar.svelte';
  import TopBar from './lib/components/TopBar.svelte';
  import Board from './lib/components/Board.svelte';
  import Backlog from './lib/components/Backlog.svelte';
  import Settings from './lib/components/Settings.svelte';
  import ProjectSettings from './lib/components/ProjectSettings.svelte';
  import WorkspaceView from './lib/components/WorkspaceView.svelte';
  import IssueDrawer from './lib/components/IssueDrawer.svelte';
  import Login from './lib/components/Login.svelte';
  import { currentUser } from './lib/stores/auth';
  import { currentView, initWorkspace, loaded, loadError, selectedIssueId } from './lib/stores/workspace';

  // Kicks off the one API call that populates every store in workspace.ts, once there's a
  // logged-in user to make it as; $loaded and $loadError below gate what renders until it
  // resolves. Tracked by user id (not just !$loadError) so logging in again after a failed
  // attempt actually retries instead of being permanently blocked by the stale error.
  let initializedForUserId: string | null = null;
  $: if ($currentUser && $currentUser.id !== initializedForUserId) {
    initializedForUserId = $currentUser.id;
    loadError.set(null);
    initWorkspace();
  }
</script>

{#if !$currentUser}
  <Login />
{:else if $loadError}
  <div class="status-screen">
    <div class="status-card">
      <div class="status-title">Couldn't reach the Workhorse API</div>
      <p class="status-body">{$loadError}</p>
      <p class="status-body">Is the server running? <code>npm run dev --prefix server</code></p>
    </div>
  </div>
{:else if !$loaded}
  <div class="status-screen">
    <div class="status-card">
      <div class="status-title">Loading workspace…</div>
    </div>
  </div>
{:else}
  <div class="app">
    <Sidebar />
    <div class="main">
      <TopBar />
      {#if $selectedIssueId && ($currentView === 'board' || $currentView === 'backlog')}
        <IssueDrawer />
      {:else if $currentView === 'board'}
        <Board />
      {:else if $currentView === 'backlog'}
        <Backlog />
      {:else if $currentView === 'workspace'}
        <WorkspaceView />
      {:else if $currentView === 'projectSettings'}
        <ProjectSettings />
      {:else}
        <Settings />
      {/if}
    </div>
  </div>
{/if}

<style>
  .app {
    display: flex;
    height: 100vh;
    width: 100%;
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }
  .status-screen {
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg);
  }
  .status-card {
    max-width: 360px;
    text-align: center;
    padding: 24px;
  }
  .status-title {
    font-size: 15px;
    font-weight: 700;
    color: var(--text);
    margin-bottom: 8px;
  }
  .status-body {
    font-size: 12.5px;
    color: var(--text-2);
    line-height: 1.6;
    margin: 4px 0;
  }
  .status-body code {
    font-family: 'Mono', ui-monospace, monospace;
    background: var(--surface-2);
    border: 1px solid var(--border);
    padding: 1px 5px;
    border-radius: 4px;
  }
</style>
