<script lang="ts">
  import { login, signup } from '../stores/auth';

  /** Set by App.svelte when Login is reached via the landing page, so a visitor can return to
   * it without a full reload. Unset when Login is the only unauthenticated screen. */
  export let onBack: (() => void) | undefined = undefined;

  let mode: 'login' | 'signup' = 'login';
  let email = '';
  let password = '';
  let displayName = '';
  let error = '';
  let busy = false;

  async function submit() {
    error = '';
    busy = true;
    try {
      if (mode === 'login') await login(email, password);
      else await signup(email, password, displayName);
    } catch (e) {
      error = e instanceof Error ? e.message : 'something went wrong';
    } finally {
      busy = false;
    }
  }

  function toggleMode() {
    mode = mode === 'login' ? 'signup' : 'login';
    error = '';
  }
</script>

<div class="auth-screen">
  <form class="auth-card" on:submit|preventDefault={submit}>
    {#if onBack}
      <button type="button" class="link back-link" on:click={onBack}>← Back</button>
    {/if}
    <h1>{mode === 'login' ? 'Log in' : 'Create an account'}</h1>
    {#if mode === 'signup'}
      <label>
        <span>Display name</span>
        <input type="text" name="name" autocomplete="name" placeholder="Ada Lovelace" bind:value={displayName} required />
      </label>
    {/if}
    <label>
      <span>Email</span>
      <input type="email" name="email" placeholder="you@example.com" bind:value={email} required autocomplete="email" />
    </label>
    <label>
      <span>Password</span>
      <input type="password" name="password" placeholder="••••••••" bind:value={password} required minlength="8" autocomplete={mode === 'login' ? 'current-password' : 'new-password'} />
    </label>
    {#if error}<p class="error">{error}</p>{/if}
    <button type="submit" class="primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up'}</button>
    <button type="button" class="link" on:click={toggleMode}>
      {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
    </button>
  </form>
</div>

<style>
  /* This is an unauthenticated screen and must not depend on anything the authenticated app can
     mutate — not the shared --bg/--text/etc tokens (which an in-app theme pick can override via
     [data-theme]), not the shared i18n locale store. Every color here is local to this
     component, driven purely by prefers-color-scheme; every string above is a literal, always
     in English. See LandingPage.svelte/PolicyPage.svelte for the same treatment. */
  .auth-screen {
    --lp-bg: #F5F5F5;
    --lp-surface: #FFFFFF;
    --lp-surface-2: #FAFAFA;
    --lp-border: #DDDDDD;
    --lp-text: #1F1F1F;
    --lp-text-2: #5A5A5A;
    --lp-accent: #46484D;
    --lp-accent-on: #FFFFFF;
    --lp-critical: #D6455A;
  }
  @media (prefers-color-scheme: dark) {
    .auth-screen {
      --lp-bg: #161616;
      --lp-surface: #1E1E1E;
      --lp-surface-2: #232323;
      --lp-border: #333333;
      --lp-text: #EDEDED;
      --lp-text-2: #B0B0B0;
      --lp-accent: #9AA0A6;
      --lp-accent-on: #101114;
      --lp-critical: #E8677C;
    }
  }
  .auth-screen {
    height: 100vh;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--lp-bg);
  }
  .auth-card {
    width: min(320px, calc(100vw - 32px));
    display: flex;
    flex-direction: column;
    gap: 14px;
    background: var(--lp-surface);
    border: 1px solid var(--lp-border);
    border-radius: 12px;
    padding: 28px;
  }
  h1 {
    font-size: 16px;
    font-weight: 700;
    color: var(--lp-text);
    margin: 0 0 4px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 12px;
    color: var(--lp-text-2);
  }
  input {
    font-size: 13px;
    padding: 8px 10px;
    border-radius: 7px;
    border: 1px solid var(--lp-border);
    background: var(--lp-surface-2);
    color: var(--lp-text);
  }
  input:focus-visible {
    outline: 2px solid var(--lp-accent);
    outline-offset: 1px;
  }
  .error {
    font-size: 12px;
    color: var(--lp-critical);
    margin: 0;
  }
  button.primary {
    margin-top: 4px;
    padding: 9px 0;
    border-radius: 7px;
    border: none;
    background: var(--lp-accent);
    color: var(--lp-accent-on);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  button.primary:disabled {
    opacity: 0.6;
    cursor: default;
  }
  button.link {
    background: none;
    border: none;
    color: var(--lp-text-2);
    font-size: 12px;
    cursor: pointer;
    padding: 0;
  }
  button.link:hover {
    color: var(--lp-accent);
  }
  .back-link {
    align-self: flex-start;
    margin-bottom: 2px;
  }

  @media (max-width: 480px) {
    .auth-card { padding: 24px 20px; gap: 16px; }
    h1 { font-size: 18px; }
    label { font-size: 13px; }
    input { padding: 11px 12px; }
    button.primary { padding: 12px 0; font-size: 14px; }
    button.link { padding: 6px 0; font-size: 12.5px; }
  }
</style>
