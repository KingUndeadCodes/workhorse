<script lang="ts">
  import Sidebar from './lib/components/Sidebar.svelte';
  import TopBar from './lib/components/TopBar.svelte';
  import MobileNav from './lib/components/MobileNav.svelte';
  import Board from './lib/components/Board.svelte';
  import MobileBoard from './lib/components/MobileBoard.svelte';
  import Backlog from './lib/components/Backlog.svelte';
  import Settings from './lib/components/Settings.svelte';
  import MyIssuesView from './lib/components/MyIssuesView.svelte';
  import Stats from './lib/components/Stats.svelte';
  import IssueDrawer from './lib/components/IssueDrawer.svelte';
  import ProfileCard from './lib/components/ProfileCard.svelte';
  import { currentView, featureFlags, selectedIssueId, statusChangeError, workspaceFeatures } from './lib/stores/workspace';
  import { isMobile } from './lib/stores/viewport';
  import { t } from './lib/i18n';

  /**
   * The signed-in app's layout. Its own file so App.svelte can load it on demand (see `shellLoad` there): everything
   * imported above — every view, the issue drawer and the markdown libraries behind it — is then fetched only once
   * someone is signed in, not by every visitor to the landing page.
   */

  // Insights switched off (possibly while it's open) — don't leave the user on a view that no longer exists.
  $: if (!$workspaceFeatures.insights && $currentView === 'stats') currentView.set('board');
  // Same for sprints turned off while looking at the Backlog view.
  $: if (!$featureFlags.sprints && $currentView === 'backlog') currentView.set('board');
</script>

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
    {:else if $currentView === 'myIssues'}
      <MyIssuesView />
    {:else if $currentView === 'stats'}
      <Stats />
    {:else}
      <Settings />
    {/if}
  </main>
  <MobileNav />
</div>
<ProfileCard />
{#if $statusChangeError}
  <!-- A refused status change (drag, menu, or drawer) — see statusChangeError in stores/workspace.ts. -->
  <div class="notice" role="alert">
    <span>{$statusChangeError}</span>
    <button type="button" class="notice-dismiss" on:click={() => ($statusChangeError = null)}>{$t('common.close')}</button>
  </div>
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
</style>
