<script lang="ts">
  // Recursive: a comment plus every reply beneath it, nested to any depth (a reply can
  // itself be replied to). Renders itself again via <svelte:self> for each child, so the
  // whole tree is just this component repeated with `depth` incremented.
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import MarkdownEditor from './MarkdownEditor.svelte';
  import { displayName, formatRelativeDate, renderMarkdown } from '../util';
  import type { Comment, User } from '$domain';

  export let comment: Comment;
  export let allComments: Comment[];
  export let users: User[];
  export let currentUserId: string | undefined;
  export let depth = 0;
  export let replyingToId: string | null;
  export let draftReply: string;
  export let submittingReply: boolean;
  export let onStartReply: (id: string) => void;
  export let onCancelReply: () => void;
  export let onSubmitReply: () => void;
  export let onEditComment: (commentId: string, body: string) => Promise<void>;

  $: author = users.find((u) => u.id === comment.authorId);
  $: onBehalfOf = comment.onBehalfOfUserId ? users.find((u) => u.id === comment.onBehalfOfUserId) : undefined;
  $: children = allComments.filter((c) => c.parentCommentId === comment.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  // Indentation is capped, not unbounded — a very deep thread should still stay readable
  // rather than squeezing itself into a sliver on the right edge of the drawer.
  $: indent = Math.min(depth, 4) * 22;

  let editing = false;
  let editDraft = '';
  let submittingEdit = false;

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
      <div class="comment-meta">
        <span class="comment-name">
          {displayName(author)}{#if onBehalfOf}<span class="on-behalf-of"> on behalf of {onBehalfOf.displayName}</span>{/if}
        </span>
        <span class="comment-time">{formatRelativeDate(comment.createdAt)}</span>
        {#if comment.editedAt}<span class="comment-edited">(edited)</span>{/if}
      </div>

      {#if editing}
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
        <div class="comment-text markdown">{@html renderMarkdown(comment.body.plainText, users)}</div>
        <div class="comment-actions">
          <button class="reply-btn" on:click={() => onStartReply(comment.id)}><Icon name="reply" size={12} />Reply</button>
          {#if comment.authorId === currentUserId}
            <button class="reply-btn" on:click={startEdit}><Icon name="pencil" size={12} />Edit</button>
          {/if}
        </div>
      {/if}

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

      {#each children as child (child.id)}
        <svelte:self
          comment={child}
          {allComments}
          {users}
          {currentUserId}
          depth={depth + 1}
          {replyingToId}
          bind:draftReply
          {submittingReply}
          {onStartReply}
          {onCancelReply}
          {onSubmitReply}
          {onEditComment}
        />
      {/each}
    </div>
  </div>
{/if}

<style>
  .comment { display: flex; gap: 9px; margin-top: 14px; }
  .comment-body { flex: 1; min-width: 0; }
  .comment-meta { display: flex; align-items: baseline; gap: 7px; margin-bottom: 3px; }
  .comment-name { font-size: 12.5px; font-weight: 600; color: var(--text); }
  .on-behalf-of { font-weight: 400; color: var(--text-3); }
  .comment-time { font-size: 11px; color: var(--text-3); }
  .comment-text { margin: 0; }
  .comment-edited { font-size: 11px; color: var(--text-3); font-style: italic; }
  .comment-actions { display: flex; gap: 12px; margin-top: 4px; }
  .reply-btn { display: flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 600; color: var(--text-3); }
  .reply-btn:hover { color: var(--text-2); }
  .reply-composer, .edit-composer { margin-top: 10px; }
  .markdown { font-size: 12.5px; color: var(--text-2); line-height: 1.65; }
  .markdown :global(p) { margin: 0 0 8px; }
  .markdown :global(p:last-child) { margin-bottom: 0; }
  .markdown :global(ul), .markdown :global(ol) { margin: 0 0 8px; padding-left: 20px; }
  .markdown :global(code) { font-family: 'Mono', ui-monospace, monospace; font-size: 11.5px; background: var(--surface-sunken); padding: 1px 4px; border-radius: 4px; }
  .markdown :global(pre) { background: var(--surface-sunken); border-radius: 6px; padding: 8px; overflow-x: auto; margin: 0 0 8px; }
  .markdown :global(pre code) { background: none; padding: 0; }
  .markdown :global(a) { color: var(--accent-strong); }
  .markdown :global(blockquote) { border-left: 2px solid var(--border); margin: 0 0 8px; padding-left: 10px; color: var(--text-3); }
  .markdown :global(img) { max-width: 100%; border-radius: 6px; }
  .markdown :global(.mention) {
    font-weight: 600; color: var(--accent-strong); background: var(--accent-soft); border-radius: 4px; padding: 0 3px;
  }
  .markdown :global(.mention-agent) { color: #cc785c; background: rgba(204, 120, 92, .14); }
</style>
