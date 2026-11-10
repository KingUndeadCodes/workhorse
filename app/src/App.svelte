<script lang="ts">
  import Login from './lib/components/Login.svelte';
  import LandingPage from './lib/components/LandingPage.svelte';
  import PrivacyPolicy from './lib/components/PrivacyPolicy.svelte';
  import TermsOfUse from './lib/components/TermsOfUse.svelte';
  import AccessibilityStatement from './lib/components/AccessibilityStatement.svelte';
  import { currentUser } from './lib/stores/auth';
  import { currentView, initWorkspace, loaded, loadError, settingsJumpTab } from './lib/stores/workspace';
  import { initNotifications, resetNotifications } from './lib/stores/notifications';
  import { connectWebSocket, disconnectWebSocket } from './lib/ws';
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

  // The signed-in layout (every view, the issue drawer, the markdown libraries) is its own chunk, so a visitor who
  // only sees the landing page never downloads it. Started the moment a user is known — alongside initWorkspace
  // below, not after it — so by the time the data arrives the code usually has too.
  let shellLoad: Promise<typeof import('./AppShell.svelte')> | undefined;

  // Kicks off the one API call that populates every store in workspace.ts, once there's a
  // logged-in user to make it as; $loaded and $loadError below gate what renders until it
  // resolves. Tracked by user id (not just !$loadError) so logging in again after a failed
  // attempt actually retries instead of being permanently blocked by the stale error.
  let initializedForUserId: string | null = null;
  $: if ($currentUser && $currentUser.id !== initializedForUserId) {
    // The unauthenticated screens each set their own tab title; this is the app's own.
    document.title = 'Workhorse — Board';
    initializedForUserId = $currentUser.id;
    shellLoad ??= import('./AppShell.svelte');
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
  {#await shellLoad}
    <div class="status-screen">
      <div class="status-card">
        <div class="status-title">{$t('app.loadingWorkspace')}</div>
      </div>
    </div>
  {:then shell}
    {#if shell}<svelte:component this={shell.default} />{/if}
  {:catch}
    <!-- The chunk failed to load — typically a tab left open across a deploy, whose old file names no longer exist. -->
    <div class="status-screen">
      <div class="status-card">
        <div class="status-title">{$t('app.loadFailedTitle')}</div>
        <button type="button" class="status-reload" on:click={() => window.location.reload()}>{$t('app.reload')}</button>
      </div>
    </div>
  {/await}
{/if}

<style>
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
  .status-reload { margin-top: 10px; font-size: 12.5px; font-weight: 600; color: var(--accent-strong); }
</style>
