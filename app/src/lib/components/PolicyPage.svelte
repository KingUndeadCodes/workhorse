<script lang="ts">
  import { t } from '../i18n';

  export let titleKey: string;
  export let sectionKeys: { headingKey: string; bodyKey: string }[];
  export let onBack: () => void;
</script>

<div class="policy-page">
  <div class="policy-card">
    <button type="button" class="link back-link" on:click={onBack}>{$t('login.backButton')}</button>
    <h1>{$t(titleKey)}</h1>
    <p class="placeholder-notice">{$t('policyPage.placeholderNotice')}</p>
    {#each sectionKeys as s}
      <section>
        <h2>{$t(s.headingKey)}</h2>
        <p>{$t(s.bodyKey)}</p>
      </section>
    {/each}
  </div>
</div>

<style>
  /* Same rationale as LandingPage.svelte: this page is shown to unauthenticated visitors and
     must follow the browser's prefers-color-scheme directly, never the app's shared --bg/--text
     tokens (which a returning visitor's stored in-app theme choice can mutate via [data-theme]). */
  .policy-page {
    --lp-bg: #F5F5F5;
    --lp-text: #1F1F1F;
    --lp-text-2: #5A5A5A;
    --lp-accent: #46484D;
    --lp-warning: #B9791A;
    --lp-warning-soft: #FBF0DD;
  }
  @media (prefers-color-scheme: dark) {
    .policy-page {
      --lp-bg: #161616;
      --lp-text: #EDEDED;
      --lp-text-2: #B0B0B0;
      --lp-accent: #9AA0A6;
      --lp-warning: #E0A53D;
      --lp-warning-soft: rgba(224,165,61,.15);
    }
  }
  .policy-page {
    height: 100vh;
    overflow-y: auto;
    overscroll-behavior: contain;
    width: 100%;
    background: var(--lp-bg);
    display: flex;
    justify-content: center;
    padding: 64px 24px 80px;
    box-sizing: border-box;
  }
  .policy-card {
    width: 100%;
    max-width: 640px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .link {
    background: none;
    border: none;
    color: var(--lp-text-2);
    font-size: 12.5px;
    cursor: pointer;
    padding: 0;
    align-self: flex-start;
  }
  .link:hover { color: var(--lp-accent); }
  h1 {
    font-size: 24px;
    font-weight: 800;
    color: var(--lp-text);
    margin: 4px 0 0;
  }
  .placeholder-notice {
    font-size: 12.5px;
    color: var(--lp-warning);
    background: var(--lp-warning-soft);
    border-radius: 8px;
    padding: 10px 14px;
    margin: 0;
  }
  section { display: flex; flex-direction: column; gap: 6px; }
  h2 {
    font-size: 15px;
    font-weight: 700;
    color: var(--lp-text);
    margin: 0;
  }
  p {
    font-size: 13.5px;
    color: var(--lp-text-2);
    line-height: 1.65;
    margin: 0;
  }

  @media (max-width: 480px) {
    .policy-page { padding: 40px 16px 60px; }
    h1 { font-size: 20px; }
  }
</style>
