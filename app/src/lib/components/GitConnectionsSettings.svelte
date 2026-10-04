<script lang="ts">
  import * as api from '../api';
  import { t } from '../i18n';
  import type { UserGitConnectionPublic } from '$domain';

  // Commits are made by proxy: an agent uses the credential of the person it's acting for, so each
  // person connects their own GitHub account here once — it's not tied to any project.
  let connections: UserGitConnectionPublic[] = [];
  let githubOAuth = false;
  let loaded = false;
  let error = '';
  let busy = false;
  let showTokenForm = false;
  let token = '';

  $: github = connections.find((c) => c.provider === 'github');

  async function refresh() {
    try {
      const res = await api.listGitConnections();
      connections = res.connections;
      githubOAuth = res.githubOAuth;
    } finally {
      loaded = true;
    }
  }
  refresh();

  // Return trip from the server's OAuth callback: it redirects back here with ?gitConnect=ready&ticket=…
  // or ?gitConnect=error&message=…. The callback saves nothing itself — this signed-in session finishes
  // the connection by redeeming the ticket, and the server refuses unless the ticket was issued for *this* user.
  const returned = new URLSearchParams(window.location.search);
  const returnedStatus = returned.get('gitConnect');
  const returnedTicket = returned.get('ticket');
  const returnedMessage = returned.get('message');
  if (returnedStatus) {
    const clean = new URL(window.location.href);
    for (const key of ['gitConnect', 'ticket', 'message']) clean.searchParams.delete(key);
    window.history.replaceState(null, '', clean.toString());
    if (returnedStatus === 'error') error = returnedMessage ?? $t('gitConnections.failedConnect');
    else if (returnedStatus === 'ready' && returnedTicket) completeConnect(returnedTicket);
  }

  async function completeConnect(ticket: string) {
    busy = true;
    error = '';
    try {
      await api.completeGitHubConnect(ticket);
      await refresh();
    } catch (err) {
      error = err instanceof Error ? err.message : $t('gitConnections.failedConnect');
    } finally {
      busy = false;
    }
  }

  async function connectWithGithub() {
    busy = true;
    error = '';
    try {
      const { url } = await api.startGitHubConnect(window.location.href);
      window.location.assign(url);
    } catch (err) {
      error = err instanceof Error ? err.message : $t('gitConnections.failedConnect');
      busy = false;
    }
  }

  async function connectWithToken() {
    if (!token.trim()) return;
    busy = true;
    error = '';
    try {
      await api.connectGitWithToken('github', token.trim());
      token = '';
      showTokenForm = false;
      await refresh();
    } catch (err) {
      error = err instanceof Error ? err.message : $t('gitConnections.failedConnect');
    } finally {
      busy = false;
    }
  }

  async function disconnect() {
    error = '';
    try {
      await api.disconnectGit('github');
      await refresh();
    } catch (err) {
      error = err instanceof Error ? err.message : $t('gitConnections.failedDisconnect');
    }
  }
</script>

<p class="section-hint">{$t('gitConnections.hint')}</p>

{#if loaded}
  {#if github}
    <div class="row">
      <span class="gh-mark" style="--s: 14px" aria-hidden="true"></span>
      <span class="row-name">GitHub</span>
      <span class="row-tag">{github.accountLogin ? $t('gitConnections.connectedAs', { login: github.accountLogin }) : $t('gitConnections.connected')}</span>
      <button class="text-btn danger" on:click={disconnect}>{$t('gitConnections.disconnect')}</button>
    </div>
  {:else}
    {#if githubOAuth && !showTokenForm}
      <div class="add-form column">
        <p class="field-hint">{$t('gitConnections.oauthHint')}</p>
        <button type="button" disabled={busy} on:click={connectWithGithub}><span class="gh-mark" style="--s: 16px" aria-hidden="true"></span>{$t('gitConnections.connectGithub')}</button>
        <button type="button" class="text-btn" on:click={() => (showTokenForm = true)}>{$t('gitConnections.usePatInstead')}</button>
      </div>
    {:else}
      <form class="add-form column" on:submit|preventDefault={connectWithToken}>
        <input type="password" placeholder={$t('gitConnections.tokenPlaceholder')} bind:value={token} autocomplete="off" />
        <p class="field-hint">{$t('gitConnections.tokenHint')}</p>
        <button type="submit" disabled={busy || !token.trim()}>{busy ? $t('gitConnections.connecting') : $t('gitConnections.connectToken')}</button>
        {#if githubOAuth}
          <button type="button" class="text-btn" on:click={() => (showTokenForm = false)}>{$t('gitConnections.useOauthInstead')}</button>
        {/if}
      </form>
    {/if}
  {/if}
{/if}
{#if error}<p class="error">{error}</p>{/if}

<style>
  /* public/github.svg as a mask, so the mark takes the surrounding text color in every theme instead of staying black. */
  .gh-mark { flex: none; display: inline-block; width: var(--s, 16px); height: var(--s, 16px); background-color: currentColor; -webkit-mask: url('/github.svg') center / contain no-repeat; mask: url('/github.svg') center / contain no-repeat; }
  .section-hint { font-size: 12px; line-height: 1.5; color: var(--text-3); margin: 0 0 12px; max-width: 520px; }
  .field-hint { font-size: 11px; line-height: 1.4; color: var(--text-3); margin: 0; }
  .row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; font-size: 12.5px; max-width: 520px; }
  .row-name { color: var(--text); font-weight: 500; }
  .row-tag { color: var(--text-3); font-size: 11.5px; flex: 1; }
  .text-btn { font-size: 12px; font-weight: 600; color: var(--accent-strong); text-align: left; }
  .text-btn.danger { color: var(--critical); }
  .error { color: var(--critical); font-size: 12px; margin: 8px 0 0; }
  .add-form { display: flex; gap: 8px; }
  .add-form.column { flex-direction: column; align-items: stretch; max-width: 360px; }
  .add-form input { font: inherit; font-size: 12.5px; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 7px; padding: 7px 9px; }
  .add-form button:not(.text-btn) { font-size: 12px; font-weight: 600; color: var(--accent-on); background: var(--accent); padding: 7px 12px; border-radius: 7px; white-space: nowrap; }
  .add-form button:not(.text-btn) { display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
  .add-form button:disabled { opacity: .5; cursor: default; }
  @media (max-width: 767px) {
    .add-form input { padding: 9px 11px; }
    .add-form button:not(.text-btn) { padding: 10px 14px; }
  }
</style>
