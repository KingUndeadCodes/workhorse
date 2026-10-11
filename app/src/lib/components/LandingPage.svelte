<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import LandingShowcase from './LandingShowcase.svelte';

  export let onGetStarted: () => void;
  export let onLogin: () => void;
  export let onPrivacy: () => void;
  export let onTerms: () => void;
  export let onAccessibility: () => void;

  const STEPS: { n: string; title: string; desc: string }[] = [
    { n: '1', title: 'Attach', desc: 'Pick an agent and attach it to a ticket.' },
    { n: '2', title: 'Propose', desc: 'It reads the ticket and proposes actions from a closed, safe vocabulary.' },
    { n: '3', title: 'Approve', desc: 'Auto-apply, or review each proposal first. Everything lands in the activity log.' },
  ];

  const currentYear = new Date().getFullYear();

  // The tab title is otherwise the app's ("Workhorse — Board"); restore it when the visitor
  // moves on to login or signs in.
  onMount(() => {
    document.title = 'Workhorse — Project management with AI agents';
    return undefined;
  });
</script>

<!-- This is an unauthenticated marketing page and must not depend on anything the authenticated
     app can mutate — not the shared theme tokens (see <style> below), and not the shared i18n
     locale store either. Every string here is a literal, always in English. -->
<div class="landing">
  <header class="nav">
    <div class="nav-inner">
      <div class="brand"><Icon name="anvil" size={26} />Workhorse</div>
      <button type="button" class="login-link" on:click={onLogin}>Log in</button>
    </div>
  </header>

  <main class="content">
    <section class="hero">
      <span class="eyebrow">Boards · Sprints · AI agents</span>
      <h1>Project management that <span class="muted">keeps up with your team</span></h1>
      <p class="subtitle">Plan sprints, move work across the board, and let AI agents pick up tickets and work them — with you approving every step that matters. Self-hosted, so your data stays yours.</p>
    </section>

    <LandingShowcase />

    <section class="section">
      <h2>Automation you can trust</h2>
      <p class="section-sub">Agents never get a free hand. Every action comes from a short, fixed list, and you decide how much they can do alone.</p>
      <ol class="steps">
        {#each STEPS as st}
          <li class="step">
            <span class="step-n">{st.n}</span>
            <div class="step-title">{st.title}</div>
            <p class="step-desc">{st.desc}</p>
          </li>
        {/each}
      </ol>
    </section>

    <section class="cta-band">
      <h2>Ready when your team is</h2>
      <p>Create a workspace and start moving work in minutes.</p>
      <button type="button" class="btn" on:click={onGetStarted}>Get started</button>
    </section>
  </main>

  <footer class="footer">
    <p class="copyright">© {currentYear} Workhorse. All rights reserved.</p>
    <div class="footer-links">
      <button type="button" class="footer-link" on:click={onGetStarted}>Get started</button>
      <span class="footer-sep" aria-hidden="true">·</span>
      <a class="footer-link" href="/privacy" on:click|preventDefault={onPrivacy}>Privacy Policy</a>
      <span class="footer-sep" aria-hidden="true">·</span>
      <a class="footer-link" href="/terms" on:click|preventDefault={onTerms}>Terms of Use</a>
      <span class="footer-sep" aria-hidden="true">·</span>
      <a class="footer-link" href="/accessibility" on:click|preventDefault={onAccessibility}>Accessibility Statement</a>
    </div>
    <a class="footer-link github-link" href="https://github.com/KingUndeadCodes/workhorse" target="_blank" rel="noopener noreferrer">
      <img class="github-icon" src="/github.svg" alt="" width="22" height="22" />
      GitHub
    </a>
  </footer>
</div>

<style>
  /* This page is shown to unauthenticated visitors and must render purely off the browser's
     own prefers-color-scheme — it deliberately does NOT use the app's shared --bg/--text/etc
     tokens (app.css's :root), since those are mutated at runtime by an explicit [data-theme]
     choice persisted in localStorage. A returning visitor whose stored in-app theme happens to
     be "dark" should still see this page follow their current OS/browser preference, not
     whatever they last picked while logged in. Every color below is local to this component. */
  .landing {
    --lp-bg: #F5F5F5;
    --lp-surface: #FFFFFF;
    --lp-surface-2: #FAFAFA;
    --lp-surface-sunken: #EBEBEB;
    --lp-border: #DDDDDD;
    --lp-border-strong: #C6C6C6;
    --lp-text: #1F1F1F;
    --lp-text-2: #5A5A5A;
    --lp-text-3: #8C8C8C;
    --lp-accent: #46484D;
    --lp-accent-strong: #2E2F33;
    --lp-accent-soft: #E9E9EA;
    --lp-accent-on: #FFFFFF;
    /* Status/priority/agent colors copied from the app's own light tokens, for the mock board. */
    --lp-info: #3B7DC4; --lp-info-soft: #E6EFFA;
    --lp-success: #2E9E58; --lp-success-soft: #E3F5E9;
    --lp-warning: #B9791A; --lp-warning-soft: #FBF0DD;
    --lp-critical: #D6455A; --lp-critical-soft: #FBE6EA;
    --lp-agent: #CC785C;
    --lp-agent-soft: rgba(204,120,92,.14);
    --lp-create-bg: #2563EB;
    /* The mock window is the one genuinely elevated surface on this page (the style guide reserves shadows for
       those), so it gets a layered shadow: a long soft fall-off plus a tighter contact shadow. Cards inside stay flat. */
    --lp-shadow-lg: 0 32px 64px -16px rgba(12,43,78,.30), 0 12px 24px -8px rgba(12,43,78,.16), 0 2px 6px rgba(12,43,78,.08);
  }
  @media (prefers-color-scheme: dark) {
    .landing {
      --lp-bg: #161616;
      --lp-surface: #1E1E1E;
      --lp-surface-2: #232323;
      --lp-surface-sunken: #121212;
      --lp-border: #333333;
      --lp-border-strong: #444444;
      --lp-text: #EDEDED;
      --lp-text-2: #B0B0B0;
      --lp-text-3: #7A7A7A;
      --lp-accent: #9AA0A6;
      --lp-accent-strong: #C2C7CC;
      --lp-accent-soft: rgba(154,160,166,.14);
      --lp-accent-on: #101114;
      --lp-info: #6FA8E4; --lp-info-soft: rgba(111,168,228,.15);
      --lp-success: #4FBE7C; --lp-success-soft: rgba(79,190,124,.15);
      --lp-warning: #E0A53D; --lp-warning-soft: rgba(224,165,61,.15);
      --lp-critical: #E8677C; --lp-critical-soft: rgba(232,103,124,.15);
      /* Black on a near-black page barely shows, so the dark version is heavier and adds a 1px light edge for definition. */
      --lp-shadow-lg: 0 32px 80px -12px rgba(0,0,0,.85), 0 12px 28px -8px rgba(0,0,0,.65), 0 0 0 1px rgba(255,255,255,.06);
    }
  }
  .landing {
    height: 100vh;
    overflow-y: auto;
    overscroll-behavior: contain;
    width: 100%;
    background: var(--lp-bg);
    display: flex;
    flex-direction: column;
    align-items: center;
    box-sizing: border-box;
  }

  /* ---- nav ---- */
  .nav {
    position: sticky; top: 0; z-index: 5; width: 100%;
    background: color-mix(in srgb, var(--lp-bg) 85%, transparent);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--lp-border);
  }
  .nav-inner {
    max-width: 1040px; margin: 0 auto; padding: 12px 24px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .brand { display: flex; align-items: center; gap: 9px; font-size: 16px; font-weight: 700; color: var(--lp-text); }
  .brand :global(svg) { color: var(--lp-accent); }

  .login-link {
    background: none; border: none; cursor: pointer; font-size: 14px; font-weight: 600;
    color: var(--lp-text-2); padding: 12px 4px;
  }
  .login-link:hover { color: var(--lp-text); }
  .login-link:focus-visible { outline: 2px solid var(--lp-accent); outline-offset: 2px; }

  /* ---- buttons ---- */
  .btn {
    display: inline-flex; align-items: center; justify-content: center;
    padding: 12px 26px; border-radius: 10px; border: 1px solid transparent;
    background: var(--lp-accent); color: var(--lp-accent-on);
    font-size: 14px; font-weight: 700; cursor: pointer; text-decoration: none;
  }
  .btn:hover { background: var(--lp-accent-strong); }
  .btn:focus-visible, .footer-link:focus-visible { outline: 2px solid var(--lp-accent); outline-offset: 2px; }

  .content {
    width: 100%; max-width: 1040px; box-sizing: border-box;
    padding: 72px 24px 24px;
    display: flex; flex-direction: column; align-items: center; gap: 88px;
  }

  /* ---- hero ---- */
  .hero { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 18px; max-width: 700px; }
  .eyebrow {
    font-size: 12px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase;
    color: var(--lp-text-2); background: var(--lp-accent-soft);
    border: 1px solid var(--lp-border); border-radius: 999px; padding: 5px 14px;
  }
  h1 { font-size: 52px; font-weight: 800; line-height: 1.1; letter-spacing: -.02em; color: var(--lp-text); margin: 0; }
  h1 .muted { color: var(--lp-text-3); }
  .subtitle { font-size: 17px; line-height: 1.6; color: var(--lp-text-2); margin: 0; max-width: 600px; }

  /* ---- sections ---- */
  .section { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 28px; text-align: center; }
  h2 { font-size: 28px; font-weight: 800; letter-spacing: -.01em; color: var(--lp-text); margin: 0; }
  .section-sub { font-size: 15px; line-height: 1.6; color: var(--lp-text-2); max-width: 560px; margin: -12px 0 0; }

  .steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; width: 100%; text-align: left; }
  .step { padding: 22px; border-left: 2px solid var(--lp-border-strong); display: flex; flex-direction: column; gap: 6px; }
  .step-n {
    width: 26px; height: 26px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
    background: var(--lp-accent); color: var(--lp-accent-on); font-size: 12.5px; font-weight: 700; margin-bottom: 4px;
  }
  .step-title { font-size: 16px; font-weight: 700; color: var(--lp-text); }
  .step-desc { font-size: 13.5px; line-height: 1.55; color: var(--lp-text-2); margin: 0; }

  .cta-band {
    width: 100%; box-sizing: border-box; text-align: center; padding: 56px 24px;
    background: var(--lp-surface); border: 1px solid var(--lp-border); border-radius: 18px;
    display: flex; flex-direction: column; align-items: center; gap: 12px;
  }
  .cta-band p { font-size: 15px; color: var(--lp-text-2); margin: 0 0 8px; }

  .footer { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 56px 24px 72px; }
  .copyright { font-size: 12px; color: var(--lp-text-2); margin: 0; }
  .footer-links { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 0 8px; }
  .footer-link {
    display: inline-flex; align-items: center; gap: 5px; background: none; border: none;
    color: var(--lp-text-2); font-size: 13px; text-decoration: none; cursor: pointer; padding: 12px 8px; min-height: 44px; box-sizing: border-box;
  }
  .footer-link:hover { color: var(--lp-accent); }
  .github-link { gap: 7px; font-size: 15px; font-weight: 600; color: var(--lp-text-2); }
  /* github.svg is a fixed black fill, not currentColor — invisible-ish against the dark-mode
     footer otherwise, so it's inverted the same way this page already branches every other
     color on prefers-color-scheme (see the :root-level custom properties above). */
  .github-icon { display: block; }
  @media (prefers-color-scheme: dark) {
    .github-icon { filter: invert(1); }
  }
  .footer-sep { color: var(--lp-text-2); font-size: 12px; }

  @media (max-width: 860px) {
    .steps { grid-template-columns: 1fr 1fr; }
    h1 { font-size: 40px; }
  }
  @media (max-width: 600px) {
    .content { padding: 44px 16px 16px; gap: 64px; }
    .nav-inner { padding: 10px 16px; }
    h1 { font-size: 32px; }
    .subtitle { font-size: 15.5px; }
    h2 { font-size: 23px; }
    .steps { grid-template-columns: 1fr; }
    .cta-band { padding: 40px 18px; }
  }
</style>
