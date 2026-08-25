<script lang="ts">
  import Icon from './Icon.svelte';
  import { t } from '../i18n';

  export let onGetStarted: () => void;
  export let onPrivacy: () => void;
  export let onAccessibility: () => void;

  const FEATURES: { icon: string; titleKey: string; descKey: string }[] = [
    { icon: 'columns', titleKey: 'landing.featureBoardTitle', descKey: 'landing.featureBoardDesc' },
    { icon: 'robot', titleKey: 'landing.featureAgentsTitle', descKey: 'landing.featureAgentsDesc' },
    { icon: 'route', titleKey: 'landing.featureAutomationsTitle', descKey: 'landing.featureAutomationsDesc' },
    { icon: 'clock', titleKey: 'landing.featureInsightsTitle', descKey: 'landing.featureInsightsDesc' },
  ];

  const MOCK_COLUMNS: { labelKey: string; cardWidths: number[] }[] = [
    { labelKey: 'landing.previewTodo', cardWidths: [70, 55] },
    { labelKey: 'landing.previewInProgress', cardWidths: [60, 80, 45] },
    { labelKey: 'landing.previewDone', cardWidths: [65] },
  ];

  const currentYear = new Date().getFullYear();
</script>

<div class="landing">
  <section class="hero">
    <div class="brand"><Icon name="anvil" size={32} />Workhorse</div>
    <h1>{$t('landing.tagline')}</h1>
    <p class="subtitle">{$t('landing.subtitle')}</p>
    <button type="button" class="cta" on:click={onGetStarted}>{$t('landing.ctaButton')}</button>
  </section>

  <section class="preview-wrap">
    <div class="preview" aria-hidden="true">
      <div class="preview-chrome">
        <span class="dot"></span><span class="dot"></span><span class="dot"></span>
      </div>
      <div class="preview-board">
        {#each MOCK_COLUMNS as col}
          <div class="preview-col">
            <div class="preview-col-label">{$t(col.labelKey)}</div>
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
    <p class="preview-caption">{$t('landing.previewCaption')}</p>
  </section>

  <section class="features">
    {#each FEATURES as f}
      <div class="feature">
        <div class="feature-icon"><Icon name={f.icon} size={18} /></div>
        <div class="feature-title">{$t(f.titleKey)}</div>
        <p class="feature-desc">{$t(f.descKey)}</p>
      </div>
    {/each}
  </section>

  <footer class="footer">
    <p class="copyright">{$t('landing.copyright', { year: currentYear })}</p>
    <div class="footer-links">
      <button type="button" class="footer-link" on:click={onGetStarted}>{$t('landing.ctaButton')}</button>
      <span class="footer-sep" aria-hidden="true">·</span>
      <button type="button" class="footer-link" on:click={onPrivacy}>{$t('landing.footerPrivacy')}</button>
      <span class="footer-sep" aria-hidden="true">·</span>
      <button type="button" class="footer-link" on:click={onAccessibility}>{$t('landing.footerAccessibility')}</button>
    </div>
  </footer>
</div>

<style>
  .landing {
    height: 100vh;
    overflow-y: auto;
    overscroll-behavior: contain;
    width: 100%;
    background: var(--bg);
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
    color: var(--text-2);
  }
  .brand :global(svg) { color: var(--accent); }
  h1 {
    font-size: 30px;
    font-weight: 800;
    color: var(--text);
    margin: 4px 0 0;
    line-height: 1.25;
  }
  .subtitle {
    font-size: 14.5px;
    color: var(--text-2);
    line-height: 1.6;
    margin: 0;
  }
  .cta {
    margin-top: 6px;
    padding: 12px 28px;
    border-radius: 9px;
    border: none;
    background: var(--accent);
    color: var(--accent-on);
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
  }
  .cta:hover { background: var(--accent-strong); }

  .preview-wrap { display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; max-width: 720px; }
  .preview {
    width: 100%;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }
  .preview-chrome {
    display: flex; gap: 6px; padding: 10px 12px;
    background: var(--surface-2); border-bottom: 1px solid var(--border);
  }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--border-strong); }
  .preview-board { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding: 16px; }
  .preview-col { display: flex; flex-direction: column; gap: 8px; }
  .preview-col-label {
    font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
    color: var(--text-3); margin-bottom: 2px;
  }
  .preview-card {
    background: var(--surface-sunken); border-radius: 6px; padding: 8px;
    display: flex; flex-direction: column; gap: 5px;
  }
  .preview-line { height: 6px; border-radius: 3px; background: var(--border-strong); }
  .preview-line.short { width: 35%; }
  .preview-caption { font-size: 12px; color: var(--text-3); margin: 0; }

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
    background: var(--accent-soft); color: var(--accent-strong); margin-bottom: 2px;
  }
  .feature-title { font-size: 13.5px; font-weight: 700; color: var(--text); }
  .feature-desc { font-size: 12.5px; color: var(--text-2); line-height: 1.5; margin: 0; }

  .footer { display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .copyright { font-size: 12px; color: var(--text-3); margin: 0; }
  .footer-links { display: flex; align-items: center; gap: 8px; }
  .footer-link {
    background: none; border: none; color: var(--text-3); font-size: 12px; cursor: pointer; padding: 4px;
  }
  .footer-link:hover { color: var(--accent); }
  .footer-sep { color: var(--text-3); font-size: 12px; }

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
