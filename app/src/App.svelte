<script lang="ts">
  import Sidebar from './lib/components/Sidebar.svelte';
  import TopBar from './lib/components/TopBar.svelte';
  import MobileNav from './lib/components/MobileNav.svelte';
  import Board from './lib/components/Board.svelte';
  import MobileBoard from './lib/components/MobileBoard.svelte';
  import Backlog from './lib/components/Backlog.svelte';
  import Settings from './lib/components/Settings.svelte';
  import ProjectSettings from './lib/components/ProjectSettings.svelte';
  import WorkspaceView from './lib/components/WorkspaceView.svelte';
  import MyIssuesView from './lib/components/MyIssuesView.svelte';
  import Stats from './lib/components/Stats.svelte';
  import IssueDrawer from './lib/components/IssueDrawer.svelte';
  import Login from './lib/components/Login.svelte';
  import LandingPage from './lib/components/LandingPage.svelte';
  import PrivacyPolicy from './lib/components/PrivacyPolicy.svelte';
  import TermsOfUse from './lib/components/TermsOfUse.svelte';
  import AccessibilityStatement from './lib/components/AccessibilityStatement.svelte';
  import { currentUser } from './lib/stores/auth';
  import { currentView, initWorkspace, loaded, loadError, selectedIssueId, settingsJumpTab, statusChangeError, workspaceFeatures } from './lib/stores/workspace';
  import { initNotifications, resetNotifications } from './lib/stores/notifications';
  import { connectWebSocket, disconnectWebSocket } from './lib/ws';
  import { isMobile } from './lib/stores/viewport';
  import { t } from './lib/i18n';

  /** Which unauthenticated screen is showing — local, not persisted, so a fresh visit always
   * starts back at the landing page. */
  type UnauthView = 'landing' | 'login' | 'privacy' | 'terms' | 'accessibility';
  /** The legal pages have real URLs (shareable, bookmarkable, back-button friendly); landing and login stay on "/". */
  const VIEW_PATHS: Partial<Record<UnauthView, string>> = { privacy: '/privacy', terms: '/terms', accessibility: '/accessibility' };
  function viewForPath(path: string): UnauthView {
    return (Object.keys(VIEW_PATHS) as UnauthView[]).find((v) => VIEW_PATHS[v] === path.replace(/\/+$/, '')) ?? 'landing';
  }
  let unauthView: UnauthView = viewForPath(window.location.pathname);

  function showUnauthView(view: UnauthView) {
    unauthView = view;
    const path = VIEW_PATHS[view] ?? '/';
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
  }
  function syncViewToPath() {
    unauthView = viewForPath(window.location.pathname);
  }
  let loginMode: 'login' | 'signup' = 'login';

  // Insights switched off (possibly while it's open) — don't leave the user on a view that no longer exists.
  $: if (!$workspaceFeatures.insights && $currentView === 'stats') currentView.set('board');

  // Kicks off the one API call that populates every store in workspace.ts, once there's a
  // logged-in user to make it as; $loaded and $loadError below gate what renders until it
  // resolves. Tracked by user id (not just !$loadError) so logging in again after a failed
  // attempt actually retries instead of being permanently blocked by the stale error.
  let initializedForUserId: string | null = null;
  $: if ($currentUser && $currentUser.id !== initializedForUserId) {
    // The unauthenticated screens each set their own tab title; this is the app's own.
    document.title = 'Workhorse — Board';
    initializedForUserId = $currentUser.id;
    loadError.set(null);
    // Returning from GitHub's authorize page (see GitConnectionsSettings) — land back on the Git settings tab.
    if (new URLSearchParams(window.location.search).has('gitConnect')) {
      currentView.set('settings');
      settingsJumpTab.set('Git');
    }
    initWorkspace();
    initNotifications();
    connectWebSocket();
  } else if (!$currentUser && initializedForUserId) {
    initializedForUserId = null;
    disconnectWebSocket();
    resetNotifications();
  }
</script>

<svelte:window on:popstate={syncViewToPath} />

{#if !$currentUser}
  {#if unauthView === 'login'}
    <Login initialMode={loginMode} onBack={() => showUnauthView('landing')} />
  {:else if unauthView === 'privacy'}
    <PrivacyPolicy onBack={() => showUnauthView('landing')} />
  {:else if unauthView === 'terms'}
    <TermsOfUse onBack={() => showUnauthView('landing')} />
  {:else if unauthView === 'accessibility'}
    <AccessibilityStatement onBack={() => showUnauthView('landing')} />
  {:else}
    <LandingPage
      onGetStarted={() => { loginMode = 'signup'; showUnauthView('login'); }}
      onLogin={() => { loginMode = 'login'; showUnauthView('login'); }}
      onPrivacy={() => showUnauthView('privacy')}
      onTerms={() => showUnauthView('terms')}
      onAccessibility={() => showUnauthView('accessibility')}
    />
  {/if}
{:else if $loadError}
  <div class="status-screen">
    <div class="status-card">
      <div class="status-title">{$t('app.apiErrorTitle')}</div>
      <p class="status-body">{$loadError}</p>
      <p class="status-body">{$t('app.serverRunningHint')} <code>npm run dev --prefix server</code></p>
    </div>
  </div>
{:else if !$loaded}
  <div class="status-screen">
    <div class="status-card">
      <div class="status-title">{$t('app.loadingWorkspace')}</div>
    </div>
  </div>
{:else}
  <a href="#main-content" class="skip-link">{$t('app.skipToContent')}</a>
  <div class="app">
    <Sidebar />
    <main class="main" id="main-content" tabindex="-1">
      <TopBar />
      {#if $selectedIssueId && ($currentView === 'board' || $currentView === 'backlog')}
        <IssueDrawer />
      {:else if $currentView === 'board'}
        {#if $isMobile}<MobileBoard />{:else}<Board />{/if}
      {:else if $currentView === 'backlog'}
        <Backlog />
      {:else if $currentView === 'workspace'}
        <WorkspaceView />
      {:else if $currentView === 'myIssues'}
        <MyIssuesView />
      {:else if $currentView === 'projectSettings'}
        <ProjectSettings />
      {:else if $currentView === 'stats'}
        <Stats />
      {:else}
        <Settings />
      {/if}
    </main>
    <MobileNav />
  </div>
  {#if $statusChangeError}
    <!-- A refused status change (drag, menu, or drawer) — see statusChangeError in stores/workspace.ts. -->
    <div class="notice" role="alert">
      <span>{$statusChangeError}</span>
      <button type="button" class="notice-dismiss" on:click={() => ($statusChangeError = null)}>{$t('common.close')}</button>
    </div>
  {/if}
{/if}

<style>
  .skip-link {
    position: absolute; top: -48px; left: 8px; z-index: 1000;
    background: var(--accent); color: var(--accent-on); font-size: 12.5px; font-weight: 600;
    padding: 10px 16px; border-radius: 6px; transition: top .15s ease;
  }
  .skip-link:focus-visible { top: 8px; }
  .notice {
    position: fixed; left: 50%; bottom: calc(20px + env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 900;
    display: flex; align-items: center; gap: 12px; max-width: min(520px, calc(100vw - 32px)); padding: 10px 14px;
    background: var(--surface); color: var(--text); border: 1px solid var(--critical); border-radius: 8px;
    font-size: 12.5px; line-height: 1.4;
  }
  .notice-dismiss { flex: 0 0 auto; font-size: 12px; font-weight: 600; color: var(--accent-strong); }
  @media (max-width: 768px) {
    .notice { bottom: calc(72px + env(safe-area-inset-bottom)); }
  }
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
  /* The skip link's jump target — not part of the normal Tab order (tabindex="-1"), so no
     focus ring is needed here; the visible effect of "skipping" is the content scrolling into
     view, not a ring around the whole landmark. */
  .main:focus { outline: none; }
  /* Reserves room for MobileNav's fixed bottom tab bar (~54px + its own 8px gap above the
     safe-area inset — see that component's .mobile-nav padding-bottom) so the last row of
     board/backlog/settings content isn't hidden underneath it. Desktop is untouched — MobileNav
     renders nothing above 768px. */
  @media (max-width: 768px) {
    .main { padding-bottom: calc(62px + env(safe-area-inset-bottom)); }
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
