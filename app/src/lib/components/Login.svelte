<script lang="ts">
  import { login, signup } from '../stores/auth';

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
    <h1>{mode === 'login' ? 'Log in' : 'Create an account'}</h1>
    {#if mode === 'signup'}
      <label>
        <span>Display name</span>
        <input placeholder="Ada Lovelace" bind:value={displayName} required />
      </label>
    {/if}
    <label>
      <span>Email</span>
      <input type="email" placeholder="you@example.com" bind:value={email} required autocomplete="email" />
    </label>
    <label>
      <span>Password</span>
      <input type="password" placeholder="••••••••" bind:value={password} required minlength="8" autocomplete={mode === 'login' ? 'current-password' : 'new-password'} />
    </label>
    {#if error}<p class="error">{error}</p>{/if}
    <button type="submit" class="primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up'}</button>
    <button type="button" class="link" on:click={toggleMode}>
      {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
    </button>
  </form>
</div>

<style>
  .auth-screen {
    height: 100vh;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg);
  }
  .auth-card {
    width: min(320px, calc(100vw - 32px));
    display: flex;
    flex-direction: column;
    gap: 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 28px;
  }
  h1 {
    font-size: 16px;
    font-weight: 700;
    color: var(--text);
    margin: 0 0 4px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 12px;
    color: var(--text-2);
  }
  input {
    font-size: 13px;
    padding: 8px 10px;
    border-radius: 7px;
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text);
  }
  input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .error {
    font-size: 12px;
    color: #C0392B;
    margin: 0;
  }
  button.primary {
    margin-top: 4px;
    padding: 9px 0;
    border-radius: 7px;
    border: none;
    background: var(--accent);
    color: var(--accent-on);
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
    color: var(--text-2);
    font-size: 12px;
    cursor: pointer;
    padding: 0;
  }
  button.link:hover {
    color: var(--accent);
  }
</style>
