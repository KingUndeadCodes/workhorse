<script lang="ts">
  // A plain textarea plus a toolbar that inserts markdown syntax at the cursor/selection —
  // "rich text editing" without a WYSIWYG editor or new content format. What's typed is
  // still sanitized markdown, rendered the same way everywhere else (see renderMarkdown).
  // Styled after Jira's field editor (toolbar + body + word-count footer + Submit/Cancel),
  // minus the parts that don't map onto plain markdown: undo/redo (the browser's own
  // Ctrl/Cmd+Z already works inside the textarea), heading levels, and text color (no
  // markdown equivalent without inventing an inline-HTML extension).
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import { displayName, type Mentionable } from '../util';
  import { t, tn } from '../i18n';

  // `autocorrect` is WebKit/Safari-only and isn't part of Svelte's HTMLAttributes typings for
  // <textarea> (unlike spellcheck/autocapitalize/autocomplete, which are standard and set
  // directly in the markup below) — set imperatively instead of erroring svelte-check.
  function noAutocorrect(node: HTMLTextAreaElement) {
    node.setAttribute('autocorrect', 'off');
  }

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
  /** Users offered by the "@" mention autocomplete — omit to disable mentions entirely. */
  export let mentionUsers: Mentionable[] = [];

  let textarea: HTMLTextAreaElement;
  let dropdownEl: HTMLDivElement | undefined;

  // --- @mention autocomplete ---
  let mentionStart = -1;
  let mentionQuery: string | null = null;
  let mentionMatches: Mentionable[] = [];
  let mentionActiveIndex = 0;

  /** Looks for an in-progress "@word" run ending at the cursor and, if found, computes the matching suggestions. */
  function updateMentionState() {
    if (!textarea || mentionUsers.length === 0) {
      mentionQuery = null;
      return;
    }
    const cursor = textarea.selectionStart;
    const before = value.slice(0, cursor);
    const match = before.match(/(?:^|\s)@([^\s@]*)$/);
    if (!match) {
      mentionQuery = null;
      return;
    }
    mentionQuery = match[1];
    mentionStart = cursor - mentionQuery.length - 1;
    const q = mentionQuery.toLowerCase();
    mentionMatches = mentionUsers.filter((u) => u.displayName.toLowerCase().includes(q));
    mentionActiveIndex = 0;
  }

  function selectMention(user: Mentionable) {
    if (mentionQuery === null || !textarea) return;
    const cursor = textarea.selectionStart;
    const insertion = `@${user.displayName} `;
    value = value.slice(0, mentionStart) + insertion + value.slice(cursor);
    const newCursor = mentionStart + insertion.length;
    mentionQuery = null;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursor, newCursor);
    });
  }

  /** Keeps the highlighted option in view when arrowing past the edge of the scrollable dropdown. */
  function scrollActiveMentionIntoView() {
    requestAnimationFrame(() => {
      dropdownEl?.querySelector('.mention-option.active')?.scrollIntoView({ block: 'nearest' });
    });
  }

  /** Keys `handleMentionKeydown` fully handles itself — the keyup handler must not re-run
      `updateMentionState()` for these, or it would immediately reset `mentionActiveIndex` back
      to 0 and undo the navigation. */
  const MENTION_NAV_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape']);

  function handleMentionKeyup(e: KeyboardEvent) {
    if (mentionQuery !== null && MENTION_NAV_KEYS.has(e.key)) return;
    updateMentionState();
  }

  function handleMentionKeydown(e: KeyboardEvent) {
    if (mentionQuery === null || mentionMatches.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      mentionActiveIndex = (mentionActiveIndex + 1) % mentionMatches.length;
      scrollActiveMentionIntoView();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      mentionActiveIndex = (mentionActiveIndex - 1 + mentionMatches.length) % mentionMatches.length;
      scrollActiveMentionIntoView();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      selectMention(mentionMatches[mentionActiveIndex]);
    } else if (e.key === 'Escape') {
      mentionQuery = null;
    }
  }

  interface FormatButton {
    key: string;
    icon: string;
    titleKey: string;
  }

  const buttons: FormatButton[] = [
    { key: 'bold', icon: 'bold', titleKey: 'markdownEditor.boldTitle' },
    { key: 'italic', icon: 'italic', titleKey: 'markdownEditor.italicTitle' },
    { key: 'code', icon: 'code', titleKey: 'markdownEditor.codeTitle' },
    { key: 'link', icon: 'link', titleKey: 'markdownEditor.linkTitle' },
    { key: 'list', icon: 'list', titleKey: 'markdownEditor.listTitle' },
    { key: 'quote', icon: 'quote', titleKey: 'markdownEditor.quoteTitle' },
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
        wrap('**', '**', $t('markdownEditor.boldPlaceholder'));
        break;
      case 'italic':
        wrap('_', '_', $t('markdownEditor.italicPlaceholder'));
        break;
      case 'code':
        wrap('`', '`', $t('markdownEditor.codePlaceholder'));
        break;
      case 'link':
        wrap('[', '](url)', $t('markdownEditor.linkPlaceholder'));
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
        <button type="button" title={$t(b.titleKey)} aria-label={$t(b.titleKey)} on:mousedown|preventDefault on:click={() => applyFormat(b.key)}><Icon name={b.icon} size={13} /></button>
      {/each}
    </div>
    <div class="textarea-wrap">
      <!-- svelte-ignore a11y-autofocus -->
      <textarea
        bind:this={textarea}
        bind:value
        {rows}
        {placeholder}
        {autofocus}
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        use:noAutocorrect
        on:input={updateMentionState}
        on:keyup={handleMentionKeyup}
        on:blur={() => (mentionQuery = null)}
        on:keydown={handleMentionKeydown}
        on:keydown
      ></textarea>
      {#if mentionQuery !== null && mentionMatches.length > 0}
        <div class="mention-dropdown" bind:this={dropdownEl}>
          {#each mentionMatches as u, i (u.id)}
            <button
              type="button"
              class="mention-option"
              class:active={i === mentionActiveIndex}
              on:mousedown|preventDefault={() => selectMention(u)}
            >
              <Avatar userId={u.id} name={displayName(u)} kind={u.kind} size={16} />
              {#if u.kind === 'agent'}<Icon name="robot" size={11} />{/if}{displayName(u)}
            </button>
          {/each}
        </div>
      {/if}
    </div>
    <div class="footer">
      <span>{$t('markdownEditor.markdownSupported')}</span>
      <span>{$tn('markdownEditor.wordCount', wordCount)}</span>
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
  .textarea-wrap { position: relative; }
  .mention-dropdown {
    position: absolute; top: 4px; left: 10px; z-index: 15; min-width: 180px; max-width: 260px; max-height: 200px;
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 4px;
    box-shadow: var(--shadow-lg); display: flex; flex-direction: column; overflow-y: auto;
  }
  .mention-option {
    display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; font-size: 12.5px;
    color: var(--text); padding: 6px 8px; border-radius: 6px;
  }
  .mention-option:hover, .mention-option.active { background: var(--surface-2); }
  .footer { display: flex; justify-content: space-between; padding: 5px 10px; border-top: 1px solid var(--border); font-size: 10.5px; color: var(--text-3); }
  .actions { display: flex; gap: 8px; }
  .btn { font: inherit; font-size: 12.5px; font-weight: 600; padding: 7px 14px; border-radius: 7px; }
  .btn.primary { color: var(--accent-on); background: var(--accent); }
  .btn.primary:disabled { opacity: .5; }
  .btn.ghost { color: var(--text-2); background: var(--surface-2); }

  @media (max-width: 640px) {
    /* Toolbar icons and Submit/Cancel were sized for a mouse cursor (26x24 buttons) — grown
       toward the ~40px tap-target minimum so formatting a reply from a phone doesn't mean
       repeatedly missing the bold/italic/etc buttons. */
    .toolbar { padding: 4px 6px; gap: 4px; }
    .toolbar button { width: 34px; height: 34px; }
    textarea { font-size: 16px; padding: 12px 10px; }
    .footer { font-size: 11px; padding: 7px 10px; }
    .actions { gap: 10px; }
    .btn { padding: 10px 16px; font-size: 13.5px; }
  }
</style>
