<script lang="ts">
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import MarkdownEditor from './MarkdownEditor.svelte';
  import CommentThread from './CommentThread.svelte';
  import { currentUser } from '../stores/auth';
  import {
    addComment,
    editComment,
    addIssueLink,
    assignAgent,
    comments,
    components,
    featureFlags,
    fieldDefinitions,
    gitRepoLink,
    issueLinks,
    issueTypes,
    issuesStore,
    logWork,
    removeIssueLink,
    selectedIssueId,
    setIssueField,
    sprints,
    statusCategories,
    unassignAgent,
    updateIssue,
    users,
    workflow,
  } from '../stores/workspace';
  import { createBranch as apiCreateBranch, deleteBranch as apiDeleteBranch, getBranch, triggerAgent } from '../api';
  import { displayName, priorityIcon, renderMarkdown, splitHumansAndAgents, storyPointColor, storyPointDueDateWarning, typeIcon } from '../util';
  import { STORY_POINT_VALUES, slugifyBranchName, type Branch, type IssueLinkType } from '$domain';

  let draftComment = '';
  let submittingComment = false;

  let replyingToId: string | null = null;
  let draftReply = '';
  let submittingReply = false;

  let linkTargetKey = '';
  let linkType: IssueLinkType = 'relatesTo';

  let worklogHours = '';
  let worklogNote = '';

  let editingDescription = false;
  let draftDescription = '';
  let showAdvanced = false;

  $: issue = $issuesStore.find((i) => i.id === $selectedIssueId);
  $: issueType = issue ? $issueTypes.find((t) => t.id === issue.issueTypeId) : undefined;
  $: status = issue ? $workflow?.statuses.find((s) => s.id === issue.statusId) : undefined;
  $: category = status ? $statusCategories.find((c) => c.id === status.categoryId) : undefined;
  $: reporter = issue ? $users.find((u) => u.id === issue.reporterId) : undefined;
  $: ({ humans: humanUsers, agents: agentUsers } = splitHumansAndAgents($users));
  $: issueAssignees = issue ? issue.assigneeIds.map((id) => $users.find((u) => u.id === id)).filter((u): u is (typeof $users)[number] => !!u) : [];
  $: attachedAgents = issue
    ? Object.entries(issue.agentAssignments ?? {})
        .map(([agentId, onBehalfOfId]) => ({ agent: $users.find((u) => u.id === agentId), onBehalfOf: $users.find((u) => u.id === onBehalfOfId) }))
        .filter((e): e is { agent: (typeof $users)[number]; onBehalfOf: (typeof $users)[number] } => !!e.agent && !!e.onBehalfOf)
    : [];
  $: unattachedAgents = issue ? agentUsers.filter((a) => issue!.agentAssignments?.[a.id] === undefined) : agentUsers;
  $: issueComments = issue ? $comments.filter((c) => c.issueId === issue.id) : [];
  // Threading is one level deep (see domain/collaboration.ts) — top-level comments plus,
  // for each, the replies attached to it, both ordered oldest-first.
  $: topLevelComments = [...issueComments].filter((c) => !c.parentCommentId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  $: timePct = issue?.originalEstimateSeconds ? Math.min(100, (issue.loggedSeconds / issue.originalEstimateSeconds) * 100) : 0;
  $: pointsDueDateWarning = issue?.storyPoints ? storyPointDueDateWarning(issue.storyPoints, issue.dueDate) : null;
  $: applicableFields = $fieldDefinitions.filter((f) => !f.scope.projectIds || (issue && f.scope.projectIds.includes(issue.projectId)));
  $: issueLinksForIssue = issue ? $issueLinks.filter((l) => l.sourceIssueId === issue.id || l.targetIssueId === issue.id) : [];
  $: otherIssues = issue ? $issuesStore.filter((i) => i.id !== issue.id) : [];

  // Reset to the read view whenever the drawer switches to a different issue, so the
  // previous issue's edit state doesn't leak onto the next one.
  let lastIssueId: string | undefined;
  $: if (issue && issue.id !== lastIssueId) {
    lastIssueId = issue.id;
    editingDescription = false;
    replyingToId = null;
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

  function startReply(commentId: string) {
    replyingToId = commentId;
    draftReply = '';
  }

  function cancelReply() {
    replyingToId = null;
    draftReply = '';
  }

  async function submitReply() {
    if (!issue || !replyingToId || !draftReply.trim() || submittingReply) return;
    submittingReply = true;
    try {
      await addComment(issue.id, draftReply.trim(), replyingToId);
      cancelReply();
    } finally {
      submittingReply = false;
    }
  }

  function handleTitleBlur(e: FocusEvent) {
    if (!issue) return;
    const value = (e.target as HTMLInputElement).value.trim();
    if (value && value !== issue.title) updateIssue(issue.id, { title: value });
  }

  let savingDescription = false;

  function startEditingDescription() {
    draftDescription = issue?.description?.plainText ?? '';
    editingDescription = true;
  }

  function cancelEditingDescription() {
    editingDescription = false;
  }

  async function submitDescription() {
    if (!issue || savingDescription) return;
    if (draftDescription !== (issue.description?.plainText ?? '')) {
      savingDescription = true;
      try {
        await updateIssue(issue.id, { description: { format: 'richtext-v1', content: null, plainText: draftDescription } });
      } finally {
        savingDescription = false;
      }
    }
    editingDescription = false;
  }

  function handlePriorityChange(e: Event) {
    if (!issue) return;
    updateIssue(issue.id, { priority: (e.target as HTMLSelectElement).value as typeof issue.priority });
  }

  let showAssigneePicker = false;
  /** Svelte action: closes the assignee popover on any click outside the node it's attached to. */
  function closeOnClickOutside(node: HTMLElement, close: () => void) {
    function handleClick(event: MouseEvent) {
      if (!node.contains(event.target as Node)) close();
    }
    document.addEventListener('click', handleClick, true);
    return { destroy: () => document.removeEventListener('click', handleClick, true) };
  }
  function toggleAssignee(userId: string) {
    if (!issue) return;
    const current = issue.assigneeIds;
    const next = current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId];
    updateIssue(issue.id, { assigneeIds: next });
  }

  let showAgentPicker = false;
  /** Per-unattached-agent "on behalf of" pick — same checkbox-toggle interaction the Assignees
   * popover uses (check to attach immediately), pre-seeded with a default so a single click is
   * usually enough. */
  let pendingOnBehalfOf: Record<string, string> = {};
  let triggeringAgentId: string | null = null;

  /** Defaults the on-behalf-of pick to the current user if they're an assignee, else the first assignee. */
  function defaultOnBehalfOf(): string {
    if (!issue) return '';
    return $currentUser && issue.assigneeIds.includes($currentUser.id) ? $currentUser.id : (issue.assigneeIds[0] ?? '');
  }
  function toggleAgentPicker() {
    if (showAgentPicker) {
      showAgentPicker = false;
      return;
    }
    // Always reseeded from scratch, not merged with any prior selection — the assignee set
    // (and therefore what's valid) may have changed since the picker was last open.
    const fallback = defaultOnBehalfOf();
    pendingOnBehalfOf = Object.fromEntries(unattachedAgents.map((a) => [a.id, fallback]));
    showAgentPicker = true;
  }
  async function attachAgentChecked(agentUserId: string, e: Event) {
    const checkbox = e.currentTarget as HTMLInputElement;
    if (!issue) return;
    const onBehalfOfUserId = pendingOnBehalfOf[agentUserId];
    if (!onBehalfOfUserId) return;
    try {
      await assignAgent(issue.id, agentUserId, onBehalfOfUserId);
    } catch (err) {
      // Revert the checkbox — without this it stays checked even though the agent never
      // actually got attached, silently disagreeing with attachedAgents.
      checkbox.checked = false;
      alert(err instanceof Error ? err.message : 'Failed to attach agent');
    }
  }
  async function detachAgent(agentUserId: string) {
    if (!issue) return;
    await unassignAgent(issue.id, agentUserId);
  }
  async function runAgentNow(agentUserId: string, agentName: string) {
    if (!issue) return;
    if (!confirm(`Run "${agentName}" on this issue now?`)) return;
    triggeringAgentId = agentUserId;
    try {
      await triggerAgent(agentUserId, issue.id);
    } finally {
      triggeringAgentId = null;
    }
  }

  // ---- Branch ----
  let branch: Branch | null = null;
  let branchLoadedForIssueId: string | null = null;
  let showBranchForm = false;
  let branchNameDraft = '';
  let creatingBranch = false;
  let branchError = '';

  // Reloads the issue's branch whenever the drawer switches to a different issue — there's no
  // global branches store (see gitRepoLink's doc comment), so this is fetched per issue-open.
  $: if (issue && issue.id !== branchLoadedForIssueId) {
    branchLoadedForIssueId = issue.id;
    branch = null;
    showBranchForm = false;
    branchError = '';
    const issueId = issue.id;
    getBranch(issueId)
      .then(({ branch: b }) => {
        if (branchLoadedForIssueId === issueId) branch = b;
      })
      .catch((err) => {
        // Left `branch` at `null` on failure too (nothing better to show), but surfaced as an
        // error rather than silently — without this, a failed fetch looked identical to "no
        // branch exists yet", and clicking "+ Create Branch" produced a confusing 400 if one
        // actually did.
        if (branchLoadedForIssueId === issueId) branchError = err instanceof Error ? err.message : 'Failed to load branch';
      });
  }

  function openBranchForm() {
    if (!issue) return;
    branchNameDraft = slugifyBranchName(issue.key, issue.title);
    branchError = '';
    showBranchForm = true;
  }
  async function confirmCreateBranch() {
    if (!issue || !branchNameDraft.trim()) return;
    creatingBranch = true;
    branchError = '';
    try {
      const { branch: created } = await apiCreateBranch(issue.id, branchNameDraft.trim());
      branch = created;
      showBranchForm = false;
    } catch (err) {
      branchError = err instanceof Error ? err.message : 'Failed to create branch';
    } finally {
      creatingBranch = false;
    }
  }
  async function removeBranch() {
    if (!issue) return;
    await apiDeleteBranch(issue.id);
    branch = null;
  }

  function handleSprintChange(e: Event) {
    if (!issue) return;
    const value = (e.target as HTMLSelectElement).value;
    updateIssue(issue.id, { sprintId: value || undefined });
  }

  function handlePointsChange(e: Event) {
    if (!issue) return;
    const value = (e.target as HTMLSelectElement).value;
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
          style="width: {(status?.name.length ?? 6) + 4}ch"
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
          <MarkdownEditor
            bind:value={draftDescription}
            rows={5}
            autofocus
            placeholder="Add a description… (markdown supported)"
            submitLabel="Save"
            showCancel
            submitting={savingDescription}
            onSubmit={submitDescription}
            onCancel={cancelEditingDescription}
            mentionUsers={$users}
          />
        {:else}
          <button class="desc-view" on:click={startEditingDescription}>
            {#if issue.description?.plainText}
              <div class="markdown">{@html renderMarkdown(issue.description.plainText, $users)}</div>
            {:else}
              <span class="desc-placeholder">Add a description… (markdown supported)</span>
            {/if}
          </button>
        {/if}
      </div>

      <div class="field-grid">
        <div class="field assignee-field" use:closeOnClickOutside={() => (showAssigneePicker = false)}>
          <span class="field-label">Assignees</span>
          <div class="assignee-control">
            {#each issue.assigneeIds as uid (uid)}
              {@const u = $users.find((usr) => usr.id === uid)}
              {#if u}
                <span class="assignee-chip">
                  <Avatar userId={u.id} name={displayName(u)} avatarUrl={u.avatarUrl} kind={u.kind} size={16} />
                  {displayName(u)}
                  <button type="button" class="chip-remove" on:click={() => toggleAssignee(u.id)}><Icon name="x" size={10} /></button>
                </span>
              {/if}
            {/each}
            <button type="button" class="assignee-add" on:click={() => (showAssigneePicker = !showAssigneePicker)}>+ Add</button>
            {#if showAssigneePicker}
              <div class="assignee-popover">
                {#each humanUsers as u (u.id)}
                  <label class="assignee-option">
                    <input type="checkbox" checked={issue.assigneeIds.includes(u.id)} on:change={() => toggleAssignee(u.id)} />
                    <Avatar userId={u.id} name={u.displayName} avatarUrl={u.avatarUrl} size={16} />
                    {u.displayName}
                  </label>
                {/each}
              </div>
            {/if}
          </div>
        </div>
        {#if $featureFlags.reporters}
          <div class="field">
            <span class="field-label">Reporter</span>
            <span class="field-value">
              {#if reporter}
                <Avatar userId={reporter.id} name={displayName(reporter)} avatarUrl={reporter.avatarUrl} kind={reporter.kind} size={19} />{displayName(reporter)}
              {:else}
                Unassigned
              {/if}
            </span>
          </div>
        {/if}
        {#if $featureFlags.priority}
          <div class="field">
            <span class="field-label">Priority</span>
            <select class="field-select" value={issue.priority} on:change={handlePriorityChange}>
              {#each ['highest', 'high', 'medium', 'low', 'lowest'] as p}<option value={p}>{p}</option>{/each}
            </select>
          </div>
        {/if}
        {#if $featureFlags.storyPoints}
          <div class="field">
            <span class="field-label">Story Points</span>
            <select
              class="field-select points-select"
              style={issue.storyPoints ? `background:${storyPointColor(issue.storyPoints).bg};color:${storyPointColor(issue.storyPoints).text}` : ''}
              value={issue.storyPoints ?? ''}
              on:change={handlePointsChange}
            >
              <option value="">—</option>
              {#each STORY_POINT_VALUES as p}<option value={p}>{p}</option>{/each}
            </select>
          </div>
        {/if}
        {#if $featureFlags.sprints}
          <div class="field">
            <span class="field-label">Sprint</span>
            <select class="field-select" value={issue.sprintId ?? ''} on:change={handleSprintChange}>
              <option value="">No sprint</option>
              {#each $sprints as s (s.id)}<option value={s.id}>{s.name} ({s.state})</option>{/each}
            </select>
          </div>
        {/if}
        {#if $featureFlags.dueDates}
          <div class="field">
            <span class="field-label">Due Date</span>
            <input class="field-input" type="date" value={issue.dueDate ?? ''} on:change={handleDueDateChange} />
          </div>
        {/if}
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

      {#if pointsDueDateWarning && $featureFlags.storyPoints && $featureFlags.dueDates}
        <p class="points-warning"><Icon name="clock" size={13} />{pointsDueDateWarning}</p>
      {/if}

      <div class="section agents-section" use:closeOnClickOutside={() => (showAgentPicker = false)}>
        <div class="section-label">AI Agents</div>
        {#if attachedAgents.length === 0 && issueAssignees.length > 0}
          <p class="agents-hint">Attach an agent to have it work this ticket on behalf of an assignee.</p>
        {/if}
        <div class="agent-chips">
          {#each attachedAgents as { agent, onBehalfOf } (agent.id)}
            <span class="agent-chip">
              <Avatar userId={agent.id} name={displayName(agent)} kind={agent.kind} size={16} />
              {displayName(agent)} — on behalf of {onBehalfOf.displayName}
              <button
                type="button"
                class="chip-run"
                title="Run now"
                disabled={triggeringAgentId === agent.id}
                on:click={() => runAgentNow(agent.id, displayName(agent))}
              >{triggeringAgentId === agent.id ? '…' : 'Run'}</button>
              <button type="button" class="chip-remove" on:click={() => detachAgent(agent.id)}><Icon name="x" size={10} /></button>
            </span>
          {/each}
          {#if issueAssignees.length === 0}
            <span class="agents-empty">Assign a person first</span>
          {:else}
            <button type="button" class="assignee-add" on:click={toggleAgentPicker}>+ Add</button>
            {#if showAgentPicker}
              <div class="assignee-popover">
                {#if unattachedAgents.length === 0}
                  <div class="agents-empty">No more agents to attach</div>
                {:else}
                  {#each unattachedAgents as a (a.id)}
                    <label class="assignee-option agent-picker-option">
                      <input type="checkbox" on:change={(e) => attachAgentChecked(a.id, e)} />
                      <Avatar userId={a.id} name={displayName(a)} kind={a.kind} size={16} />
                      {displayName(a)}
                      {#if issueAssignees.length > 1}
                        <select class="on-behalf-of-select" bind:value={pendingOnBehalfOf[a.id]} on:click|stopPropagation>
                          {#each issueAssignees as u (u.id)}<option value={u.id}>{u.displayName}</option>{/each}
                        </select>
                      {/if}
                    </label>
                  {/each}
                {/if}
              </div>
            {/if}
          {/if}
        </div>
      </div>

      {#if $gitRepoLink}
        <div class="section">
          <div class="section-label">Branch</div>
          {#if branch}
            <span class="branch-row">
              <a class="branch-link" href={branch.url} target="_blank" rel="noopener">
                <Icon name="branch" size={13} />{branch.name}
              </a>
              <button type="button" class="chip-remove" on:click={removeBranch}><Icon name="x" size={10} /></button>
            </span>
          {:else if showBranchForm}
            <form class="inline-form" on:submit|preventDefault={confirmCreateBranch}>
              <input class="inline-input" type="text" bind:value={branchNameDraft} />
              <button class="inline-btn" type="submit" disabled={creatingBranch}>{creatingBranch ? '…' : 'Create'}</button>
            </form>
          {:else}
            <button type="button" class="assignee-add" on:click={openBranchForm}>+ Create Branch</button>
          {/if}
          {#if branchError}
            <p class="points-warning">{branchError}</p>
          {/if}
        </div>
      {/if}

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

            {#if $featureFlags.timeTracking}
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
            {/if}
          </div>
        {/if}
      </div>

      <div class="section">
        <div class="section-label">Activity</div>
        {#each topLevelComments as c (c.id)}
          <CommentThread
            comment={c}
            allComments={issueComments}
            users={$users}
            currentUserId={$currentUser?.id}
            {replyingToId}
            bind:draftReply
            {submittingReply}
            onStartReply={startReply}
            onCancelReply={cancelReply}
            onSubmitReply={submitReply}
            onEditComment={async (commentId, body) => { if (issue) await editComment(issue.id, commentId, body); }}
          />
        {/each}

        <div class="new-comment">
          <MarkdownEditor
            bind:value={draftComment}
            rows={3}
            placeholder="Add a comment… (markdown supported)"
            submitLabel="Comment"
            disabled={!draftComment.trim()}
            submitting={submittingComment}
            onSubmit={submitComment}
            mentionUsers={$users}
          />
        </div>
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
    border-radius: 6px; padding: 0 6px; text-transform: capitalize;
    box-sizing: border-box; height: 30px; width: 100%; line-height: normal;
  }
  .field-input[type="date"] { text-transform: uppercase; }
  .points-select { font-weight: 700; border-color: transparent; }
  .points-warning {
    display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--warning);
    background: var(--warning-soft); border-radius: 7px; padding: 8px 10px; margin: -8px 0 18px;
  }
  .assignee-field { position: relative; }
  .assignee-control { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .assignee-chip {
    display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text);
    background: var(--surface-2); border: 1px solid var(--border); border-radius: 999px; padding: 3px 8px 3px 5px;
  }
  .chip-remove { display: flex; align-items: center; justify-content: center; background: none; border: none; color: var(--text-3); cursor: pointer; padding: 0; }
  .chip-remove:hover { color: var(--text); }
  .assignee-add {
    font-size: 12px; color: var(--text-3); background: var(--surface-2); border: 1px dashed var(--border);
    border-radius: 999px; padding: 3px 10px; cursor: pointer;
  }
  .assignee-add:hover { color: var(--text); border-color: var(--text-3); }
  .assignee-popover {
    position: absolute; top: calc(100% + 4px); left: 0; z-index: 10; background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; padding: 6px; box-shadow: 0 8px 24px rgba(0,0,0,.25); max-height: 220px; overflow-y: auto; min-width: 200px;
  }
  .assignee-option { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text); padding: 5px 6px; border-radius: 5px; cursor: pointer; }
  .assignee-option:hover { background: var(--surface-2); }
  .agents-section { position: relative; }
  .branch-row { display: inline-flex; align-items: center; gap: 6px; }
  .branch-link {
    display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: var(--accent-strong);
    background: var(--accent-soft); border-radius: 7px; padding: 5px 10px;
  }
  .branch-link:hover { text-decoration: underline; }
  .agent-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .agent-chip {
    display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text);
    background: var(--surface-2); border: 1px solid var(--border); border-radius: 999px; padding: 3px 8px 3px 5px;
  }
  .chip-run {
    font-size: 10.5px; font-weight: 600; color: var(--text-3); background: none; border: 1px solid var(--border);
    border-radius: 999px; padding: 1px 7px; cursor: pointer;
  }
  .chip-run:hover:not(:disabled) { color: var(--text); border-color: var(--text-3); }
  .chip-run:disabled { opacity: .5; cursor: default; }
  .agents-empty { font-size: 12px; color: var(--text-3); font-style: italic; }
  .agents-hint { font-size: 12px; color: var(--text-3); margin: 0 0 8px; }
  .agent-picker-option { gap: 6px; }
  .on-behalf-of-select {
    margin-left: auto; font: inherit; font-size: 11px; color: var(--text-2); background: var(--surface-2);
    border: 1px solid var(--border); border-radius: 5px; padding: 2px 4px;
  }
  .section-label { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-2); margin: 0 0 8px; }
  .section { margin-bottom: 20px; }
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
  .markdown :global(.mention) {
    font-weight: 600; color: var(--accent-strong); background: var(--accent-soft); border-radius: 4px; padding: 0 3px;
  }
  .markdown :global(.mention-agent) { color: var(--agent-accent); background: var(--agent-accent-soft); }
  .advanced-toggle { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-2); padding: 4px 0; }
  .advanced-toggle:hover { color: var(--text); }
  .advanced-body { margin-top: 14px; display: flex; flex-direction: column; gap: 20px; }
  .subsection { display: flex; flex-direction: column; }
  .time-track { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .time-bar { flex: 1; height: 7px; border-radius: 99px; background: var(--surface-sunken); overflow: hidden; }
  .time-bar > span { display: block; height: 100%; background: var(--accent); border-radius: 99px; }
  .time-label { font-size: 11px; color: var(--text-3); white-space: nowrap; }
  .new-comment { margin-top: 4px; }
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

  @media (max-width: 640px) {
    .drawer-body { padding: 14px 14px 24px; }
    .field-grid { grid-template-columns: 1fr; }
    .assignee-field { grid-column: auto; }
  }
</style>
