<script lang="ts">
  // A plain textarea plus a toolbar that inserts markdown syntax at the cursor/selection —
  // "rich text editing" without a WYSIWYG editor or new content format. What's typed is
  // still sanitized markdown, rendered the same way everywhere else (see renderMarkdown).
  // Styled after Jira's field editor (toolbar + body + word-count footer + Submit/Cancel),
  // minus the parts that don't map onto plain markdown: undo/redo (the browser's own
  // Ctrl/Cmd+Z already works inside the textarea), heading levels, and text color (no
  // markdown equivalent without inventing an inline-HTML extension).
  import Icon from './Icon.svelte';

  export let value = '';
  export let placeholder = '';
  export let rows = 4;
  export let autofocus = false;
  export let submitLabel = 'Submit';
  export let showCancel = false;
  export let submitting = false;
  export let disabled = false;
  export let onSubmit: () => void = () => {};
  export let onCancel: () => void = () => {};

  let textarea: HTMLTextAreaElement;

  interface FormatButton {
    key: string;
    icon: string;
    title: string;
  }

  const buttons: FormatButton[] = [
    { key: 'bold', icon: 'bold', title: 'Bold' },
    { key: 'italic', icon: 'italic', title: 'Italic' },
    { key: 'code', icon: 'code', title: 'Code' },
    { key: 'link', icon: 'link', title: 'Link' },
    { key: 'list', icon: 'list', title: 'Bulleted list' },
    { key: 'quote', icon: 'quote', title: 'Quote' },
  ];

  $: wordCount = value.trim() ? value.trim().split(/\s+/).length : 0;

  /** Wraps the current selection (or inserts a placeholder) in `before`/`after`, then restores focus and re-selects the wrapped text. */
  function wrap(before: string, after: string, placeholderText: string) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end) || placeholderText;
    value = value.slice(0, start) + before + selected + after + value.slice(end);
    const selectFrom = start + before.length;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(selectFrom, selectFrom + selected.length);
    });
  }

  /** Prepends `prefix` to the line the cursor is on. */
  function linePrefix(prefix: string) {
    const start = textarea.selectionStart;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    value = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    const cursor = start + prefix.length;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  function applyFormat(key: string) {
    switch (key) {
      case 'bold':
        wrap('**', '**', 'bold text');
        break;
      case 'italic':
        wrap('_', '_', 'italic text');
        break;
      case 'code':
        wrap('`', '`', 'code');
        break;
      case 'link':
        wrap('[', '](url)', 'link text');
        break;
      case 'list':
        linePrefix('- ');
        break;
      case 'quote':
        linePrefix('> ');
        break;
    }
  }
</script>

<div class="wrap">
  <div class="editor">
    <div class="toolbar">
      {#each buttons as b (b.key)}
        <!-- preventDefault on mousedown, not just click: without it the textarea blurs
             before the click handler below ever runs, which used to tear the editor down
             on save-on-blur — kept even now that saving is explicit, since losing the
             selection mid-format is still a bad click. -->
        <button type="button" title={b.title} on:mousedown|preventDefault on:click={() => applyFormat(b.key)}><Icon name={b.icon} size={13} /></button>
      {/each}
    </div>
    <!-- svelte-ignore a11y-autofocus -->
    <textarea bind:this={textarea} bind:value {rows} {placeholder} {autofocus} on:keydown></textarea>
    <div class="footer">
      <span>Markdown supported</span>
      <span>{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
    </div>
  </div>
  <div class="actions">
    <button type="button" class="btn primary" disabled={disabled || submitting} on:click={onSubmit}>{submitting ? `${submitLabel}…` : submitLabel}</button>
    {#if showCancel}<button type="button" class="btn ghost" on:click={onCancel}>Cancel</button>{/if}
  </div>
</div>

<style>
  .wrap { display: flex; flex-direction: column; gap: 10px; }
  .editor { border: 1px solid var(--border); border-radius: 10px; background: var(--surface-2); overflow: hidden; }
  .toolbar { display: flex; gap: 2px; padding: 6px 8px; border-bottom: 1px solid var(--border); background: var(--surface-sunken); }
  .toolbar button { width: 26px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 5px; color: var(--text-3); }
  .toolbar button:hover { background: var(--surface); color: var(--text); }
  textarea {
    width: 100%; font: inherit; font-size: 12.5px; color: var(--text); line-height: 1.6; resize: vertical;
    background: none; border: none; padding: 10px; outline: none; display: block;
  }
  textarea::placeholder { color: var(--text-3); }
  .footer { display: flex; justify-content: space-between; padding: 5px 10px; border-top: 1px solid var(--border); font-size: 10.5px; color: var(--text-3); }
  .actions { display: flex; gap: 8px; }
  .btn { font: inherit; font-size: 12.5px; font-weight: 600; padding: 7px 14px; border-radius: 7px; }
  .btn.primary { color: var(--accent-on); background: var(--accent); }
  .btn.primary:disabled { opacity: .5; }
  .btn.ghost { color: var(--text-2); background: var(--surface-2); }
</style>
