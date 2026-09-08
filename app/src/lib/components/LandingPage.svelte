<script lang="ts">
  import Icon from './Icon.svelte';

  export let onGetStarted: () => void;
  export let onPrivacy: () => void;
  export let onTerms: () => void;
  export let onAccessibility: () => void;

  const FEATURES: { icon: string; title: string; desc: string }[] = [
    { icon: 'columns', title: 'Board & Backlog', desc: 'Drag-and-drop kanban plus full sprint planning, without leaving the page.' },
    { icon: 'robot', title: 'AI Agents', desc: 'Attach an agent to a ticket and it works it autonomously, commenting and updating status as it goes.' },
    { icon: 'route', title: 'Automations', desc: "Rule-based triggers and actions handle the busywork so your team doesn't have to." },
    { icon: 'clock', title: 'Insights', desc: 'Time-spent charts and most-active-ticket rankings, updated in real time.' },
  ];

  const MOCK_COLUMNS: { label: string; cardWidths: number[] }[] = [
    { label: 'To Do', cardWidths: [70, 55] },
    { label: 'In Progress', cardWidths: [60, 80, 45] },
    { label: 'Done', cardWidths: [65] },
  ];

  const currentYear = new Date().getFullYear();
</script>

<!-- This is an unauthenticated marketing page and must not depend on anything the authenticated
     app can mutate — not the shared theme tokens (see <style> below), and not the shared i18n
     locale store either. Every string here is a literal, always in English. -->
<div class="landing">
  <section class="hero">
    <div class="brand"><Icon name="anvil" size={32} />Workhorse</div>
    <h1>Project management that keeps up with your team</h1>
    <p class="subtitle">Boards, sprints, and automations — plus AI agents that can pick up tickets and work them on their own.</p>
    <button type="button" class="cta" on:click={onGetStarted}>Get started</button>
  </section>

  <section class="preview-wrap">
    <div class="preview" aria-hidden="true">
      <div class="preview-chrome">
        <span class="dot"></span><span class="dot"></span><span class="dot"></span>
      </div>
      <div class="preview-board">
        {#each MOCK_COLUMNS as col}
          <div class="preview-col">
            <div class="preview-col-label">{col.label}</div>
            {#each col.cardWidths as w}
              <div class="preview-card">
                <div class="preview-line" style="width:{w}%"></div>
                <div class="preview-line short"></div>
              </div>
            {/each}
          </div>
        {/each}
      </div>
    </div>
    <p class="preview-caption">The board, at a glance</p>
  </section>

  <section class="features">
    {#each FEATURES as f}
      <div class="feature">
        <div class="feature-icon"><Icon name={f.icon} size={18} /></div>
        <div class="feature-title">{f.title}</div>
        <p class="feature-desc">{f.desc}</p>
      </div>
    {/each}
  </section>

  <footer class="footer">
    <p class="copyright">© {currentYear} Workhorse. All rights reserved.</p>
    <div class="footer-links">
      <button type="button" class="footer-link" on:click={onGetStarted}>Get started</button>
      <span class="footer-sep" aria-hidden="true">·</span>
      <button type="button" class="footer-link" on:click={onPrivacy}>Privacy Policy</button>
      <span class="footer-sep" aria-hidden="true">·</span>
      <button type="button" class="footer-link" on:click={onTerms}>Terms of Use</button>
      <span class="footer-sep" aria-hidden="true">·</span>
      <button type="button" class="footer-link" on:click={onAccessibility}>Accessibility Statement</button>
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
    --lp-shadow-lg: 0 12px 32px rgba(12,43,78,.14), 0 2px 8px rgba(12,43,78,.08);
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
      --lp-shadow-lg: 0 16px 40px rgba(0,0,0,.5), 0 2px 8px rgba(0,0,0,.4);
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
    gap: 56px;
    padding: 64px 24px 80px;
    box-sizing: border-box;
  }
  .hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 14px;
    max-width: 560px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 15px;
    font-weight: 700;
    color: var(--lp-text-2);
  }
  .brand :global(svg) { color: var(--lp-accent); }
  h1 {
    font-size: 30px;
    font-weight: 800;
    color: var(--lp-text);
    margin: 4px 0 0;
    line-height: 1.25;
  }
  .subtitle {
    font-size: 14.5px;
    color: var(--lp-text-2);
    line-height: 1.6;
    margin: 0;
  }
  .cta {
    margin-top: 6px;
    padding: 12px 28px;
    border-radius: 9px;
    border: none;
    background: var(--lp-accent);
    color: var(--lp-accent-on);
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
  }
  .cta:hover { background: var(--lp-accent-strong); }

  .preview-wrap { display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; max-width: 720px; }
  .preview {
    width: 100%;
    background: var(--lp-surface);
    border: 1px solid var(--lp-border);
    border-radius: 12px;
    box-shadow: var(--lp-shadow-lg);
    overflow: hidden;
  }
  .preview-chrome {
    display: flex; gap: 6px; padding: 10px 12px;
    background: var(--lp-surface-2); border-bottom: 1px solid var(--lp-border);
  }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--lp-border-strong); }
  .preview-board { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding: 16px; }
  .preview-col { display: flex; flex-direction: column; gap: 8px; }
  .preview-col-label {
    font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
    color: var(--lp-text-3); margin-bottom: 2px;
  }
  .preview-card {
    background: var(--lp-surface-sunken); border-radius: 6px; padding: 8px;
    display: flex; flex-direction: column; gap: 5px;
  }
  .preview-line { height: 6px; border-radius: 3px; background: var(--lp-border-strong); }
  .preview-line.short { width: 35%; }
  .preview-caption { font-size: 12px; color: var(--lp-text-3); margin: 0; }

  .features {
    display: grid;
    grid-template-columns: repeat(4, minmax(140px, 1fr));
    gap: 24px;
    width: 100%;
    max-width: 900px;
  }
  .feature { display: flex; flex-direction: column; gap: 6px; }
  .feature-icon {
    width: 34px; height: 34px; border-radius: 9px; display: flex; align-items: center; justify-content: center;
    background: var(--lp-accent-soft); color: var(--lp-accent-strong); margin-bottom: 2px;
  }
  .feature-title { font-size: 13.5px; font-weight: 700; color: var(--lp-text); }
  .feature-desc { font-size: 12.5px; color: var(--lp-text-2); line-height: 1.5; margin: 0; }

  .footer { display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .copyright { font-size: 12px; color: var(--lp-text-3); margin: 0; }
  .footer-links { display: flex; align-items: center; gap: 8px; }
  .footer-link {
    display: inline-flex; align-items: center; gap: 5px; background: none; border: none;
    color: var(--lp-text-3); font-size: 12px; text-decoration: none; cursor: pointer; padding: 4px;
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
  .footer-sep { color: var(--lp-text-3); font-size: 12px; }

  @media (max-width: 700px) {
    .landing { padding: 48px 16px 64px; gap: 40px; }
    h1 { font-size: 24px; }
    .preview-board { grid-template-columns: 1fr; }
    .features { grid-template-columns: 1fr 1fr; }
  }
  @media (max-width: 420px) {
    .features { grid-template-columns: 1fr; }
  }
</style>
