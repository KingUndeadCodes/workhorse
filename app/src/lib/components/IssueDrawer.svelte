<script lang="ts">
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import { currentUser } from '../stores/auth';
  import {
    addComment,
    addIssueLink,
    comments,
    components,
    fieldDefinitions,
    issueLinks,
    issueTypes,
    issuesStore,
    logWork,
    removeIssueLink,
    selectedIssueId,
    setIssueField,
    sprints,
    statusCategories,
    toggleWatching,
    updateIssue,
    users,
    watchers,
    workflow,
  } from '../stores/workspace';
  import { formatRelativeDate, priorityIcon, renderMarkdown, typeIcon } from '../util';
  import type { IssueLinkType } from '$domain';

  let draftComment = '';
  let submittingComment = false;

  let linkTargetKey = '';
  let linkType: IssueLinkType = 'relatesTo';

  let worklogHours = '';
  let worklogNote = '';

  let editingDescription = false;
  let showAdvanced = false;

  $: issue = $issuesStore.find((i) => i.id === $selectedIssueId);
  $: issueType = issue ? $issueTypes.find((t) => t.id === issue.issueTypeId) : undefined;
  $: status = issue ? $workflow?.statuses.find((s) => s.id === issue.statusId) : undefined;
  $: category = status ? $statusCategories.find((c) => c.id === status.categoryId) : undefined;
  $: reporter = issue ? $users.find((u) => u.id === issue.reporterId) : undefined;
  $: issueComments = issue ? $comments.filter((c) => c.issueId === issue.id) : [];
  $: issueWatchers = issue ? $watchers.filter((w) => w.issueId === issue.id) : [];
  $: isWatching = issue ? issueWatchers.some((w) => w.userId === $currentUser?.id) : false;
  $: timePct = issue?.originalEstimateSeconds ? Math.min(100, (issue.loggedSeconds / issue.originalEstimateSeconds) * 100) : 0;
  $: applicableFields = $fieldDefinitions.filter((f) => !f.scope.projectIds || (issue && f.scope.projectIds.includes(issue.projectId)));
  $: issueLinksForIssue = issue ? $issueLinks.filter((l) => l.sourceIssueId === issue.id || l.targetIssueId === issue.id) : [];
  $: otherIssues = issue ? $issuesStore.filter((i) => i.id !== issue.id) : [];

  // Reset to the read view whenever the drawer switches to a different issue, so the
  // previous issue's edit state doesn't leak onto the next one.
  let lastIssueId: string | undefined;
  $: if (issue && issue.id !== lastIssueId) {
    lastIssueId = issue.id;
    editingDescription = false;
  }

  /** Closes the drawer by clearing the selection. */
  function close() {
    $selectedIssueId = null;
  }

  function handleStatusChange(e: Event) {
    if (!issue) return;
    updateIssue(issue.id, { statusId: (e.target as HTMLSelectElement).value });
  }

  async function submitComment() {
    if (!issue || !draftComment.trim() || submittingComment) return;
    submittingComment = true;
    try {
      await addComment(issue.id, draftComment.trim());
      draftComment = '';
    } finally {
      submittingComment = false;
    }
  }

  function handleTitleBlur(e: FocusEvent) {
    if (!issue) return;
    const value = (e.target as HTMLInputElement).value.trim();
    if (value && value !== issue.title) updateIssue(issue.id, { title: value });
  }

  function handleDescriptionBlur(e: FocusEvent) {
    if (!issue) return;
    const value = (e.target as HTMLTextAreaElement).value;
    if (value !== (issue.description?.plainText ?? '')) {
      updateIssue(issue.id, { description: { format: 'richtext-v1', content: null, plainText: value } });
    }
    editingDescription = false;
  }

  function handlePriorityChange(e: Event) {
    if (!issue) return;
    updateIssue(issue.id, { priority: (e.target as HTMLSelectElement).value as typeof issue.priority });
  }

  function handleAssigneeChange(e: Event) {
    if (!issue) return;
    const value = (e.target as HTMLSelectElement).value;
    updateIssue(issue.id, { assigneeId: value || undefined });
  }

  function handleSprintChange(e: Event) {
    if (!issue) return;
    const value = (e.target as HTMLSelectElement).value;
    updateIssue(issue.id, { sprintId: value || undefined });
  }

  function handlePointsChange(e: Event) {
    if (!issue) return;
    const value = (e.target as HTMLInputElement).value;
    updateIssue(issue.id, { storyPoints: value ? Number(value) : undefined });
  }

  function handleDueDateChange(e: Event) {
    if (!issue) return;
    const value = (e.target as HTMLInputElement).value;
    updateIssue(issue.id, { dueDate: value || undefined });
  }

  function handleFieldChange(fieldId: string, e: Event) {
    if (!issue) return;
    setIssueField(issue.id, fieldId, (e.target as HTMLSelectElement).value);
  }

  async function submitLink() {
    if (!issue) return;
    const target = otherIssues.find((i) => i.key === linkTargetKey.trim().toUpperCase());
    if (!target) return;
    await addIssueLink(issue.id, linkType, target.id);
    linkTargetKey = '';
  }

  async function submitWorklog() {
    if (!issue) return;
    const hours = Number(worklogHours);
    if (!hours || hours <= 0) return;
    await logWork(issue.id, Math.round(hours * 3600), worklogNote.trim() || undefined);
    worklogHours = '';
    worklogNote = '';
  }
</script>

{#if issue}
  <div class="drawer">
    <div class="drawer-head">
      <div class="crumb"><b>{$sprints.find((s) => s.id === issue?.sprintId)?.name ?? 'Backlog'}</b></div>
      <button class="icon-btn" on:click={close}><Icon name="x" /></button>
    </div>
    <div class="drawer-body">
      <div class="key-row">
        <span class="type-icon" class:bug={issueType?.name === 'Bug'} class:task={issueType?.name === 'Task'}>
          <Icon name={typeIcon(issueType?.name ?? 'Story')} size={11} />
        </span>
        <span class="key mono">{issue.key}</span>
        <select
          class="status-select"
          class:done={category?.type === 'done'}
          class:inprogress={category?.type === 'inProgress'}
          value={issue.statusId}
          on:change={handleStatusChange}
        >
          {#each $workflow?.statuses ?? [] as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
        </select>
      </div>

      <input class="title-input" value={issue.title} on:blur={handleTitleBlur} on:keydown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />

      <div class="section">
        <div class="section-label">Description</div>
        {#if editingDescription}
          <!-- svelte-ignore a11y-autofocus -->
          <textarea
            class="desc-input"
            rows="5"
            autofocus
            placeholder="Add a description… (markdown supported)"
            value={issue.description?.plainText ?? ''}
            on:blur={handleDescriptionBlur}
          ></textarea>
        {:else}
          <button class="desc-view" on:click={() => (editingDescription = true)}>
            {#if issue.description?.plainText}
              <div class="markdown">{@html renderMarkdown(issue.description.plainText)}</div>
            {:else}
              <span class="desc-placeholder">Add a description… (markdown supported)</span>
            {/if}
          </button>
        {/if}
      </div>

      <div class="field-grid">
        <div class="field">
          <span class="field-label">Assignee</span>
          <select class="field-select" value={issue.assigneeId ?? ''} on:change={handleAssigneeChange}>
            <option value="">Unassigned</option>
            {#each $users as u (u.id)}<option value={u.id}>{u.displayName}</option>{/each}
          </select>
        </div>
        <div class="field">
          <span class="field-label">Reporter</span>
          <span class="field-value">
            {#if reporter}
              <Avatar userId={reporter.id} name={reporter.displayName} size={19} />{reporter.displayName}
            {:else}
              Unassigned
            {/if}
          </span>
        </div>
        <div class="field">
          <span class="field-label">Priority</span>
          <select class="field-select" value={issue.priority} on:change={handlePriorityChange}>
            {#each ['highest', 'high', 'medium', 'low', 'lowest'] as p}<option value={p}>{p}</option>{/each}
          </select>
        </div>
        <div class="field">
          <span class="field-label">Story Points</span>
          <input class="field-input" type="number" min="0" value={issue.storyPoints ?? ''} on:change={handlePointsChange} />
        </div>
        <div class="field">
          <span class="field-label">Sprint</span>
          <select class="field-select" value={issue.sprintId ?? ''} on:change={handleSprintChange}>
            <option value="">No sprint</option>
            {#each $sprints as s (s.id)}<option value={s.id}>{s.name} ({s.state})</option>{/each}
          </select>
        </div>
        <div class="field">
          <span class="field-label">Due Date</span>
          <input class="field-input" type="date" value={issue.dueDate ?? ''} on:change={handleDueDateChange} />
        </div>
        {#each applicableFields as fd (fd.id)}
          {@const current = issue.fieldValues.find((fv) => fv.fieldId === fd.id)}
          <div class="field">
            <span class="field-label">{fd.name}</span>
            {#if fd.type === 'select'}
              <select class="field-select" value={current?.value ?? ''} on:change={(e) => handleFieldChange(fd.id, e)}>
                <option value="">—</option>
                {#each fd.options ?? [] as opt (opt.id)}<option value={opt.id}>{opt.label}</option>{/each}
              </select>
            {/if}
          </div>
        {/each}
      </div>

      <div class="section">
        <div class="section-label">Activity</div>
        {#each issueComments as c (c.id)}
          {@const author = $users.find((u) => u.id === c.authorId)}
          {#if author}
            <div class="comment">
              <Avatar userId={author.id} name={author.displayName} size={26} />
              <div class="comment-body">
                <div class="comment-meta"><span class="comment-name">{author.displayName}</span><span class="comment-time">{formatRelativeDate(c.createdAt)}</span></div>
                <div class="comment-text markdown">{@html renderMarkdown(c.body.plainText)}</div>
              </div>
            </div>
          {/if}
        {/each}
        <form class="comment-input" on:submit|preventDefault={submitComment}>
          <Icon name="comment" size={14} />
          <input
            type="text"
            placeholder="Add a comment… (markdown supported)"
            bind:value={draftComment}
            disabled={submittingComment}
            on:keydown={(e) => e.key === 'Enter' && submitComment()}
          />
        </form>
      </div>

      <div class="section watchers-section">
        <div class="avatar-stack">
          {#each issueWatchers as w (w.userId)}
            {@const u = $users.find((usr) => usr.id === w.userId)}
            {#if u}
              <div class="stack-item"><Avatar userId={u.id} name={u.displayName} size={22} /></div>
            {/if}
          {/each}
        </div>
        <button class="watch-toggle" class:active={isWatching} on:click={() => issue && toggleWatching(issue.id, isWatching)}>
          <Icon name="eye" size={13} />{isWatching ? 'Watching' : 'Watch'}
        </button>
      </div>

      <div class="section">
        <button class="advanced-toggle" on:click={() => (showAdvanced = !showAdvanced)}>
          <Icon name={showAdvanced ? 'chevup' : 'chevdown'} size={11} />Advanced
        </button>
        {#if showAdvanced}
          <div class="advanced-body">
            <div class="subsection">
              <div class="section-label">Linked Issues</div>
              {#each issueLinksForIssue as link (link.id)}
                {@const otherId = link.sourceIssueId === issue.id ? link.targetIssueId : link.sourceIssueId}
                {@const other = $issuesStore.find((i) => i.id === otherId)}
                {#if other}
                  <div class="link-row">
                    <span class="link-type">{link.sourceIssueId === issue.id ? link.type : `${link.type} (inverse)`}</span>
                    <span class="key mono">{other.key}</span>
                    <span class="link-title">{other.title}</span>
                    <button class="icon-btn small" on:click={() => removeIssueLink(issue.id, link.id)}><Icon name="x" size={12} /></button>
                  </div>
                {/if}
              {/each}
              <form class="inline-form" on:submit|preventDefault={submitLink}>
                <select class="inline-select" bind:value={linkType}>
                  <option value="relatesTo">relates to</option>
                  <option value="blocks">blocks</option>
                  <option value="duplicates">duplicates</option>
                  <option value="clones">clones</option>
                  <option value="causes">causes</option>
                </select>
                <input class="inline-input" type="text" placeholder="Issue key (e.g. ATL-131)" bind:value={linkTargetKey} />
                <button class="inline-btn" type="submit">Link</button>
              </form>
            </div>

            <div class="subsection">
              <div class="section-label">Time Tracking</div>
              <div class="time-track">
                <span class="time-label mono">{(issue.loggedSeconds / 3600).toFixed(1)}h logged</span>
                {#if issue.originalEstimateSeconds}
                  <div class="time-bar"><span style="width:{timePct}%"></span></div>
                  <span class="time-label mono">{(issue.originalEstimateSeconds / 3600).toFixed(0)}h est.</span>
                {/if}
              </div>
              <form class="inline-form" on:submit|preventDefault={submitWorklog}>
                <input class="inline-input small" type="number" min="0" step="0.25" placeholder="Hours" bind:value={worklogHours} />
                <input class="inline-input" type="text" placeholder="What did you work on? (optional)" bind:value={worklogNote} />
                <button class="inline-btn" type="submit">Log</button>
              </form>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .drawer {
    width: 100%; flex: 1; min-width: 0; background: var(--surface);
    display: flex; flex-direction: column; height: 100%; overflow: hidden;
  }
  .drawer-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px 10px; border-bottom: 1px solid var(--border); flex: 0 0 auto; }
  .crumb { font-size: 11.5px; color: var(--text-3); }
  .crumb b { color: var(--text-2); font-weight: 600; }
  .icon-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 7px; color: var(--text-2); }
  .icon-btn:hover { background: var(--surface-sunken); color: var(--text); }
  .icon-btn.small { width: 22px; height: 22px; flex: 0 0 auto; }
  .drawer-body { flex: 1; overflow-y: auto; padding: 20px 24px 32px; max-width: 760px; }
  .key-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .type-icon { width: 18px; height: 18px; border-radius: 4px; display: flex; align-items: center; justify-content: center; background: var(--success-soft); color: var(--success); }
  .type-icon.bug { background: var(--critical-soft); color: var(--critical); }
  .type-icon.task { background: var(--info-soft); color: var(--info); }
  .key { font-size: 12.5px; color: var(--text-2); }
  .status-select {
    font: inherit; appearance: none; cursor: pointer; border: none; padding: 5px 10px; border-radius: 99px;
    font-size: 11.5px; font-weight: 700; letter-spacing: .02em; text-transform: uppercase; background: var(--surface-2); color: var(--text-2);
  }
  .status-select.inprogress { background: var(--info-soft); color: var(--info); }
  .status-select.done { background: var(--success-soft); color: var(--success); }
  .title-input {
    width: 100%; font: inherit; font-size: 16.5px; font-weight: 700; line-height: 1.35; margin: 0 0 16px;
    color: var(--text); background: none; border: 1px solid transparent; border-radius: 6px; padding: 4px 6px; margin-left: -6px;
  }
  .title-input:hover, .title-input:focus { border-color: var(--border); outline: none; background: var(--surface-2); }
  .field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 14px; margin-bottom: 18px; }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field-label { font-size: 10.5px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--text-3); }
  .field-value { font-size: 12.5px; font-weight: 500; color: var(--text); display: flex; align-items: center; gap: 6px; text-transform: capitalize; }
  .field-select, .field-input {
    font: inherit; font-size: 12.5px; color: var(--text); background: var(--surface-2); border: 1px solid var(--border);
    border-radius: 6px; padding: 5px 6px; text-transform: capitalize;
  }
  .section-label { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-2); margin: 0 0 8px; }
  .section { margin-bottom: 20px; }
  .desc-input {
    width: 100%; font: inherit; font-size: 12.5px; color: var(--text-2); line-height: 1.65; margin: 0; resize: vertical;
    background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 8px;
  }
  .desc-view {
    display: block; width: 100%; text-align: left; font: inherit; background: var(--surface-2); border: 1px solid transparent;
    border-radius: 8px; padding: 8px; cursor: text; min-height: 40px;
  }
  .desc-view:hover { border-color: var(--border); }
  .desc-placeholder { font-size: 12.5px; color: var(--text-3); }
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
  .advanced-toggle { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-2); padding: 4px 0; }
  .advanced-toggle:hover { color: var(--text); }
  .advanced-body { margin-top: 14px; display: flex; flex-direction: column; gap: 20px; }
  .subsection { display: flex; flex-direction: column; }
  .time-track { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .time-bar { flex: 1; height: 7px; border-radius: 99px; background: var(--surface-sunken); overflow: hidden; }
  .time-bar > span { display: block; height: 100%; background: var(--accent); border-radius: 99px; }
  .time-label { font-size: 11px; color: var(--text-3); white-space: nowrap; }
  .comment { display: flex; gap: 9px; margin-bottom: 14px; }
  .comment-body { flex: 1; }
  .comment-meta { display: flex; align-items: baseline; gap: 7px; margin-bottom: 3px; }
  .comment-name { font-size: 12.5px; font-weight: 600; color: var(--text); }
  .comment-time { font-size: 11px; color: var(--text-3); }
  .comment-text { margin: 0; }
  .comment-input { display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: 9px; padding: 8px 10px; color: var(--text-3); font-size: 12.5px; margin-top: 4px; }
  .comment-input input { flex: 1; border: none; background: none; font: inherit; color: var(--text); outline: none; }
  .comment-input input::placeholder { color: var(--text-3); }
  .comment-input input:disabled { opacity: .6; }
  .watchers-section { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
  .avatar-stack { display: flex; align-items: center; }
  .stack-item { margin-left: -6px; border-radius: 50%; border: 2px solid var(--surface); }
  .stack-item:first-child { margin-left: 0; }
  .watch-toggle { display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; color: var(--text-2); background: var(--surface-2); border: 1px solid var(--border); padding: 5px 10px; border-radius: 7px; }
  .watch-toggle.active { color: var(--accent-strong); background: var(--accent-soft); border-color: transparent; }
  .inline-form { display: flex; gap: 6px; margin-top: 6px; }
  .inline-input, .inline-select {
    font: inherit; font-size: 12px; color: var(--text); background: var(--surface-2); border: 1px solid var(--border);
    border-radius: 6px; padding: 5px 7px; flex: 1; min-width: 0;
  }
  .inline-input.small { flex: 0 0 60px; }
  .inline-btn { font-size: 12px; font-weight: 600; color: var(--accent-strong); background: var(--accent-soft); border-radius: 6px; padding: 5px 10px; flex: 0 0 auto; }
  .link-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: 12px; }
  .link-type { color: var(--text-3); text-transform: capitalize; flex: 0 0 auto; }
  .link-title { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
</style>
