<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { t } from '../i18n';

  /** A paragraph of explanatory text that can fold down to one line — for hints long enough to push the real controls down the page. */
  export let text: string;
  /** Names this hint in storage, so whether it's folded is remembered across visits. */
  export let storageKey: string;

  const STORAGE_PREFIX = 'anvil.hint.';
  const textId = `hint-text-${storageKey}`;

  function readCollapsed(): boolean {
    try {
      return localStorage.getItem(STORAGE_PREFIX + storageKey) === 'collapsed';
    } catch {
      return false; // storage blocked (private window, site data cleared): just start open
    }
  }

  let collapsed = readCollapsed();
  let el: HTMLParagraphElement;
  // A hint short enough to fit on one line has nothing to fold, so it gets no toggle.
  let canCollapse = false;

  async function measure() {
    await tick();
    if (!el) return;
    // scrollHeight is the full text height whether or not it's currently clamped.
    canCollapse = el.scrollHeight > parseFloat(getComputedStyle(el).lineHeight) * 1.5;
  }
  onMount(() => {
    measure();
    // Re-measure when the text can reflow without the window resizing: web fonts arriving, or the hint's own width changing.
    document.fonts?.ready.then(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  });
  $: text, measure();

  function toggle() {
    collapsed = !collapsed;
    try {
      localStorage.setItem(STORAGE_PREFIX + storageKey, collapsed ? 'collapsed' : 'expanded');
    } catch {
      /* the choice just won't be remembered */
    }
  }
</script>

<div class="hint-wrap">
  <!-- Clamped as soon as it's stored as collapsed, not once measured: measuring works clamped too (scrollHeight is
       the full height either way), and waiting would paint it open first and then snap it shut on every visit. -->
  <p class="hint" id={textId} class:clamped={collapsed} bind:this={el}>{text}</p>
  {#if canCollapse}
    <button type="button" class="hint-toggle" aria-expanded={!collapsed} aria-controls={textId} on:click={toggle}>
      {collapsed ? $t('common.showMore') : $t('common.showLess')}
    </button>
  {/if}
</div>

<style>
  .hint-wrap { max-width: 560px; margin: 0 0 16px; }
  .hint { font-size: 12px; line-height: 1.5; color: var(--text-3); margin: 0; }
  .hint.clamped { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 1; line-clamp: 1; overflow: hidden; }
  .hint-toggle { margin-top: 2px; padding: 4px 0; font-size: 12px; font-weight: 600; color: var(--accent-strong); }
  .hint-toggle:hover { text-decoration: underline; text-underline-offset: 3px; }

  @media (max-width: 768px) {
    .hint-toggle { display: flex; align-items: center; min-height: 44px; padding: 0; margin-top: 0; font-size: 12.5px; }
  }
</style>
