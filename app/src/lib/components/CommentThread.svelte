<script context="module" lang="ts">
  import type { Comment } from '$domain';

  // One CommentThread instance is mounted per comment in the tree (recursive via
  // <svelte:self>), and every instance is handed the same `allComments` array reference. Without
  // this cache, each instance independently re-filters that whole array (once for its own
  // `children`, again inside `countDescendants`'s own recursion), which is O(N) work per node —
  // O(N^2) total across a thread with N comments, redone on every reactive tick that touches
  // `allComments` even when the change is unrelated to a given node's subtree. Keyed by the
  // array's own identity (a WeakMap, so it's dropped once that array is replaced) so every
  // instance sharing the same `allComments` reference reuses one O(N) grouping pass instead of
  // paying for its own.
  const childrenByParentCache = new WeakMap<Comment[], Map<string, Comment[]>>();
  function getChildrenByParent(allComments: Comment[]): Map<string, Comment[]> {
    const cached = childrenByParentCache.get(allComments);
    if (cached) return cached;
    const map = new Map<string, Comment[]>();
    for (const c of allComments) {
      if (!c.parentCommentId) continue;
      const siblings = map.get(c.parentCommentId);
      if (siblings) siblings.push(c);
      else map.set(c.parentCommentId, [c]);
    }
    childrenByParentCache.set(allComments, map);
    return map;
  }
</script>

<script lang="ts">
  // Recursive: a comment plus every reply beneath it, nested to any depth (a reply can
  // itself be replied to). Renders itself again via <svelte:self> for each child, so the
  // whole tree is just this component repeated with `depth` incremented.
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import MarkdownEditor from './MarkdownEditor.svelte';
  import { displayName, formatRelativeDate, renderMarkdown } from '../util';
  import { lineNumbers } from '../actions/lineNumbers';
  import type { User } from '$domain';

  export let comment: Comment;
  export let allComments: Comment[];
  export let users: User[];
  export let currentUserId: string | undefined;
  export let depth = 0;
  /**
   * Depth within the currently-visible "page" of the thread — distinct from `depth` (which
   * keeps counting up forever, for indent). Resets to 0 whenever a "Continue thread" stub is
   * expanded, so replies only ever render 4 levels at a time no matter how deep the underlying
   * thread actually goes; see `MAX_WINDOW_DEPTH` below.
   */
  export let windowDepth = 0;
  export let replyingToId: string | null;
  export let draftReply: string;
  export let submittingReply: boolean;
  export let onStartReply: (id: string) => void;
  export let onCancelReply: () => void;
  export let onSubmitReply: () => void;
  export let onEditComment: (commentId: string, body: string) => Promise<void>;
  export let onDeleteComment: (commentId: string) => Promise<void>;

  $: commentHtml = renderMarkdown(comment.body.plainText, users);
  $: author = users.find((u) => u.id === comment.authorId);
  $: childrenByParent = getChildrenByParent(allComments);
  $: children = [...(childrenByParent.get(comment.id) ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  // Indentation is capped, not unbounded — a very deep thread should still stay readable
  // rather than squeezing itself into a sliver on the right edge of the drawer.
  $: indent = Math.min(depth, 4) * 22;

  /** Every reply under this comment, however deep — the count shown on a collapsed thread, same idea as Reddit's "[+] N children" stub. */
  function countDescendants(commentId: string, map: Map<string, Comment[]>): number {
    const direct = map.get(commentId) ?? [];
    return direct.length + direct.reduce((sum, c) => sum + countDescendants(c.id, map), 0);
  }
  $: descendantCount = countDescendants(comment.id, childrenByParent);

  // Collapsing a comment hides its body, actions, and every reply beneath it, leaving just the
  // meta line — for a user who wants to skim past one specific sub-conversation. Local to this
  // instance on purpose: collapsing one subtree shouldn't affect sibling threads, and there's
  // no reason to persist it server-side.
  let collapsed = false;

  // Only 4 levels of a thread are ever mounted at once — past that, children are replaced by a
  // "Continue thread" stub instead of being rendered (not just visually hidden). A reply chain
  // that goes 15 deep would otherwise mean 15 levels of DOM, markdown rendering, and shrinking
  // indent all at once; this caps the cost the same way pagination would, just keyed on depth
  // instead of comment count. Expanding a stub only re-opens *its* branch, starting a fresh
  // 4-level window from there — sibling branches and everything above stay exactly as they were.
  const MAX_WINDOW_DEPTH = 4;
  let continued = false;
  $: atWindowEdge = windowDepth + 1 >= MAX_WINDOW_DEPTH && !continued;

  let editing = false;
  let editDraft = '';
  let submittingEdit = false;
  let deleting = false;

  async function handleDelete() {
    if (deleting) return;
    const hasReplies = allComments.some((c) => c.parentCommentId === comment.id);
    const message = hasReplies ? 'Delete this comment and all its replies? This can\'t be undone.' : "Delete this comment? This can't be undone.";
    if (!confirm(message)) return;
    deleting = true;
    try {
      await onDeleteComment(comment.id);
    } finally {
      deleting = false;
    }
  }

  function startEdit() {
    editDraft = comment.body.plainText;
    editing = true;
  }

  function cancelEdit() {
    editing = false;
  }

  async function submitEdit() {
    if (!editDraft.trim() || submittingEdit) return;
    submittingEdit = true;
    try {
      await onEditComment(comment.id, editDraft.trim());
      editing = false;
    } finally {
      submittingEdit = false;
    }
  }
</script>

{#if author}
  <div class="comment" style="margin-left:{indent}px">
    <Avatar userId={author.id} name={displayName(author)} avatarUrl={author.avatarUrl} kind={author.kind} size={depth === 0 ? 26 : 22} />
    <div class="comment-body">
      <button type="button" class="comment-meta" on:click={() => (collapsed = !collapsed)} aria-expanded={!collapsed}>
        <Icon name={collapsed ? 'chevron' : 'chevdown'} size={9} />
        <span class="comment-name">{#if author.kind === 'agent'}<Icon name="robot" size={11} />{/if}{displayName(author)}</span>
        <span class="comment-time">{formatRelativeDate(comment.createdAt)}</span>
        {#if comment.editedAt}<span class="comment-edited">(edited)</span>{/if}
        {#if collapsed}<span class="comment-collapsed-count">{descendantCount} {descendantCount === 1 ? 'reply' : 'replies'} hidden</span>{/if}
      </button>

      {#if collapsed}
        <!-- Body, actions, and every reply beneath this comment stay unmounted while
             collapsed — not just visually hidden — so a long-collapsed thread doesn't pay for
             rendering (or fetching) content nobody's looking at. -->
      {:else if editing}
        <div class="edit-composer">
          <MarkdownEditor
            bind:value={editDraft}
            rows={3}
            autofocus
            submitLabel="Save"
            showCancel
            disabled={!editDraft.trim()}
            submitting={submittingEdit}
            onSubmit={submitEdit}
            onCancel={cancelEdit}
            mentionUsers={users}
          />
        </div>
      {:else}
        <div class="comment-text markdown" use:lineNumbers={commentHtml}>{@html commentHtml}</div>
        <div class="comment-actions">
          <button class="reply-btn" on:click={() => onStartReply(comment.id)}><Icon name="reply" size={12} />Reply</button>
          {#if comment.authorId === currentUserId}
            <button class="reply-btn" on:click={startEdit}><Icon name="pencil" size={12} />Edit</button>
            <button class="reply-btn" on:click={handleDelete} disabled={deleting}><Icon name="trash" size={12} />{deleting ? 'Deleting…' : 'Delete'}</button>
          {/if}
        </div>
      {/if}

      {#if !collapsed}
        {#if replyingToId === comment.id}
          <div class="reply-composer">
            <MarkdownEditor
              bind:value={draftReply}
              rows={2}
              autofocus
              placeholder="Write a reply… (markdown supported)"
              submitLabel="Reply"
              showCancel
              disabled={!draftReply.trim()}
              submitting={submittingReply}
              onSubmit={onSubmitReply}
              onCancel={onCancelReply}
              mentionUsers={users}
            />
          </div>
        {/if}

        {#if children.length > 0 && atWindowEdge}
          <button type="button" class="continue-thread" on:click={() => (continued = true)} aria-expanded="false">
            <Icon name="chevron" size={9} />
            Continue thread ({children.length} more {children.length === 1 ? 'reply' : 'replies'})
          </button>
        {:else}
          {#each children as child (child.id)}
            <svelte:self
              comment={child}
              {allComments}
              {users}
              {currentUserId}
              depth={depth + 1}
              windowDepth={continued ? 0 : windowDepth + 1}
              {replyingToId}
              bind:draftReply
              {submittingReply}
              {onStartReply}
              {onCancelReply}
              {onSubmitReply}
              {onEditComment}
              {onDeleteComment}
            />
          {/each}
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  .comment { display: flex; gap: 9px; margin-top: 14px; }
  .comment-body { flex: 1; min-width: 0; }
  .comment-meta {
    display: flex; align-items: baseline; gap: 7px; margin-bottom: 3px;
    width: 100%; text-align: left; font: inherit; color: inherit; cursor: pointer; border-radius: 4px;
  }
  .comment-meta:hover { background: var(--surface-2); }
  .comment-meta :global(svg:first-child) { color: var(--text-3); flex: 0 0 auto; }
  .comment-collapsed-count { font-size: 11px; color: var(--text-3); font-style: italic; }
  .comment-name { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; font-weight: 600; color: var(--text); }
  .comment-name :global(svg) { color: var(--agent-accent); }
  .comment-time { font-size: 11px; color: var(--text-3); }
  .comment-text { margin: 0; }
  .comment-edited { font-size: 11px; color: var(--text-3); font-style: italic; }
  .comment-actions { display: flex; gap: 12px; margin-top: 4px; }
  .reply-btn { display: flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 600; color: var(--text-3); }
  .reply-btn:hover { color: var(--text-2); }
  .continue-thread {
    display: flex; align-items: center; gap: 4px; margin-top: 10px; padding: 4px 8px;
    font-size: 11.5px; font-weight: 600; color: var(--accent-strong); border-radius: 4px;
  }
  .continue-thread:hover { background: var(--accent-soft); }
  .reply-composer, .edit-composer { margin-top: 10px; }
  .markdown { font-size: 12.5px; color: var(--text-2); line-height: 1.65; }
  .markdown :global(p) { margin: 0 0 8px; }
  .markdown :global(p:last-child) { margin-bottom: 0; }
  .markdown :global(ul), .markdown :global(ol) { margin: 0 0 8px; padding-left: 20px; }
  .markdown :global(code) { font-family: 'Mono', ui-monospace, monospace; font-size: 11.5px; background: var(--surface-sunken); padding: 1px 4px; border-radius: 4px; font-variant-ligatures: none; font-feature-settings: 'liga' 0, 'calt' 0; }
  .markdown :global(pre) { background: var(--surface-sunken); border-radius: 6px; padding: 8px; overflow-x: auto; margin: 0 0 8px; }
  .markdown :global(pre code) { background: none; padding: 0; }
  .markdown :global(a) { color: var(--accent-strong); }
  .markdown :global(blockquote) { border-left: 2px solid var(--border); margin: 0 0 8px; padding-left: 10px; color: var(--text-3); }
  .markdown :global(img) { max-width: 100%; border-radius: 6px; }
  .markdown :global(.mention) {
    font-weight: 600; color: var(--accent-strong); background: var(--accent-soft); border-radius: 4px; padding: 0 3px;
  }
  .markdown :global(.mention-agent) { color: var(--agent-accent); background: var(--agent-accent-soft); }
  /* highlight.js token colors for fenced code blocks (see renderMarkdown in util.ts) — built
     from the same tokens as the rest of the theme, so highlighted code follows the light/dark
     toggle and color scheme without needing its own separate hljs theme stylesheet. */
  .markdown :global(.hljs-comment), .markdown :global(.hljs-quote) { color: var(--text-3); font-style: italic; }
  .markdown :global(.hljs-keyword), .markdown :global(.hljs-selector-tag), .markdown :global(.hljs-literal),
  .markdown :global(.hljs-subst), .markdown :global(.hljs-tag), .markdown :global(.hljs-name) { color: var(--accent-strong); font-weight: 600; }
  .markdown :global(.hljs-string), .markdown :global(.hljs-doctag), .markdown :global(.hljs-regexp),
  .markdown :global(.hljs-addition) { color: var(--success); }
  .markdown :global(.hljs-number), .markdown :global(.hljs-symbol), .markdown :global(.hljs-deletion) { color: var(--warning); }
  .markdown :global(.hljs-title), .markdown :global(.hljs-section), .markdown :global(.hljs-selector-id) { color: var(--info); font-weight: 600; }
  .markdown :global(.hljs-type), .markdown :global(.hljs-built_in), .markdown :global(.hljs-builtin-name),
  .markdown :global(.hljs-class .hljs-title) { color: var(--epic-c); }
  .markdown :global(.hljs-attribute), .markdown :global(.hljs-variable), .markdown :global(.hljs-template-variable) { color: var(--critical); }
  .markdown :global(.hljs-attr) { color: var(--info); }
  .markdown :global(.hljs-meta) { color: var(--text-3); }
  .markdown :global(.hljs-emphasis) { font-style: italic; }
  .markdown :global(.hljs-strong) { font-weight: 700; }
  /* Line-number gutter added by the lineNumbers action (highlightjs-line-numbers.js) — turns
     a highlighted <code class="hljs"> into a <table class="hljs-ln">, one <tr> per line. The
     library itself only injects structural CSS (border-collapse, td padding); all the actual
     color/spacing here is ours, on the same tokens as the syntax colors above. */
  .markdown :global(.hljs-ln) { width: 100%; }
  .markdown :global(.hljs-ln-numbers) {
    text-align: right; vertical-align: top; width: 1%; white-space: nowrap; user-select: none;
    color: var(--text-3); border-right: 1px solid var(--border); padding-right: 8px;
  }
  .markdown :global(.hljs-ln-code) { vertical-align: top; padding-left: 10px; }

  @media (max-width: 640px) {
    .comment-name { font-size: 13.5px; }
    .comment-time, .comment-collapsed-count, .comment-edited { font-size: 12px; }
    .markdown { font-size: 13.5px; }
    /* Reply/Edit/Delete were a row of small text links sized for a mouse — widened gap and
       padding so adjacent actions don't get mistapped on a touchscreen. */
    .comment-actions { gap: 16px; }
    .reply-btn { font-size: 12.5px; padding: 6px 2px; }
  }
</style>
