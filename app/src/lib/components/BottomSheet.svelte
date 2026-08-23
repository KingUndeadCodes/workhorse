<script lang="ts">
  /**
   * Shared chrome for a mobile bottom sheet — a backdrop plus a panel anchored to the bottom
   * edge with a drag handle, rounded top corners, and safe-area-aware padding. Extracted from
   * MobileNav.svelte's two ad-hoc sheets (Projects/More) so every future mobile picker (Board's
   * move-to-status picker, IssueDrawer's assignee/agent pickers, ...) shares one implementation
   * instead of re-copying the backdrop/panel/handle markup and CSS each time.
   *
   * Desktop-agnostic on purpose: this component has no `@media` gate of its own. Callers decide
   * *whether* to render it (typically behind `{#if $isMobile}`) — it doesn't decide for them.
   */
  import { createEventDispatcher } from 'svelte';

  export let open: boolean;
  export let title: string | undefined = undefined;
  export let onClose: () => void;

  const dispatch = createEventDispatcher<{ close: void }>();

  function close() {
    onClose();
    dispatch('close');
  }
</script>

{#if open}
  <div
    class="sheet-backdrop"
    role="button"
    tabindex="0"
    on:click={close}
    on:keydown={(e) => e.key === 'Escape' && close()}
  >
    <div
      class="sheet"
      on:click|stopPropagation
      on:keydown|stopPropagation
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabindex="-1"
    >
      <div class="sheet-handle"></div>
      {#if title !== undefined}<div class="sheet-title">{title}</div>{/if}
      <div class="sheet-body"><slot /></div>
      <slot name="actions" />
    </div>
  </div>
{/if}

<style>
  .sheet-backdrop {
    display: flex; align-items: flex-end; position: fixed; inset: 0; z-index: 50;
    background: rgba(10, 12, 18, 0.5);
  }
  .sheet {
    width: 100%; max-height: 75vh; overflow-y: auto; overscroll-behavior: contain; background: var(--surface);
    border-radius: 18px 18px 0 0; padding: 10px 16px calc(16px + env(safe-area-inset-bottom));
    display: flex; flex-direction: column; gap: 10px;
  }
  .sheet-handle { width: 36px; height: 4px; border-radius: 99px; background: var(--border-strong); margin: 2px auto 4px; flex: 0 0 auto; }
  .sheet-title { font-size: 15px; font-weight: 700; color: var(--text); padding: 0 4px; flex: 0 0 auto; }
  .sheet-body { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
</style>
