<script lang="ts">
  // Shared by Board.svelte, Backlog.svelte, and WorkflowDiagram.svelte. Keyboard navigation is
  // always on (it's baseline accessibility, not an opt-in power-user mode — see PROBLEMS.md item
  // 29), so this is deliberately small: one quiet, permanent line of text, not a dismissible
  // banner with an expandable legend. There's nothing left to explain that takes more than a
  // sentence, now that the whole interaction is arrow keys + Space + Enter + Escape everywhere.
  /** View-specific one-line description of what Space does here (the only thing that actually
   *  differs between Board/Backlog/Workflow — everything else is identical). */
  export let message: string;
  /** The caller's own aria-live announcement text (pick-up/drop/cancel messages, etc.). */
  export let announcement = '';
</script>

<p class="keyboard-nav-hint">{message}</p>
<div class="visually-hidden" aria-live="polite">{announcement}</div>

<style>
  .visually-hidden {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
    clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
  }
  .keyboard-nav-hint { margin: 0 0 12px; font-size: 11px; color: var(--text-3); }
</style>
