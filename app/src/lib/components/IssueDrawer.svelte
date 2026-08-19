<script lang="ts">
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import MarkdownEditor from './MarkdownEditor.svelte';
  import CommentThread from './CommentThread.svelte';
  import { currentUser } from '../stores/auth';
  import {
    addComment,
    editComment,
    removeComment,
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
    labels,
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
  import { createBranch as apiCreateBranch, deleteBranch as apiDeleteBranch, fetchEventDetail, fetchIssueEvents, getBranch, triggerAgent, type ActivityEventSummary } from '../api';
  import { describeEvent, describeEventType, displayName, formatRelativeDate, priorityIcon, renderMarkdown, splitHumansAndAgents, storyPointColor, storyPointDueDateWarning, typeIcon } from '../util';
  import { lineNumbers } from '../actions/lineNumbers';
  import { STORY_POINT_VALUES, slugifyBranchName, type Branch, type EventEnvelope, type IssueLinkType } from '$domain';

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
  $: attachedAgents = issue
    ? (issue.agentAssignments ?? []).map((id) => $users.find((u) => u.id === id)).filter((u): u is (typeof $users)[number] => !!u)
    : [];
  $: unattachedAgents = issue ? agentUsers.filter((a) => !issue!.agentAssignments?.includes(a.id)) : agentUsers;
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
    activityTab = 'comments';
    draftComment = '';
  }

  let activityTab: 'comments' | 'activity' = 'comments';

  // The Activity tab is a query over the event log, not a live store — re-fetched whenever the
  // drawer opens a different issue or this issue's own comment count changes (a decent proxy
  // for "something new happened here" without wiring a dedicated live-update path for it). The
  // list itself only carries summaries (see ActivityEventSummary) — a row's full detail is
  // fetched lazily, only once that row is actually expanded, and cached in eventDetails so
  // re-collapsing/re-expanding doesn't re-fetch.
  let activityEvents: ActivityEventSummary[] = [];
  let expandedEventIds = new Set<string>();
  let eventDetails: Record<string, EventEnvelope | 'loading' | 'error'> = {};

  $: if (issue) void loadActivity(issue.id, issueComments.length);
  async function loadActivity(issueId: string, _commentCount: number) {
    try {
      const events = (await fetchIssueEvents(issueId)).events;
      if (issue?.id !== issueId) return; // a newer loadActivity call (for a different issue) superseded this one while we were awaiting
      activityEvents = events;
    } catch {
      // Non-critical — the rest of the drawer still works without an activity feed.
    }
  }

  async function toggleActivityItem(eventId: string) {
    if (expandedEventIds.has(eventId)) {
      expandedEventIds.delete(eventId);
      expandedEventIds = expandedEventIds;
      return;
    }
    expandedEventIds.add(eventId);
    expandedEventIds = expandedEventIds;
    if (eventDetails[eventId]) return; // already fetched (or in flight) — reuse it
    eventDetails[eventId] = 'loading';
    try {
      eventDetails[eventId] = (await fetchEventDetail(eventId)).event;
    } catch {
      eventDetails[eventId] = 'error';
    }
  }

  function actorLabel(actor: ActivityEventSummary['actor']): string {
    if (actor.kind === 'user') return $users.find((u) => u.id === actor.userId)?.displayName ?? 'Someone';
    if (actor.kind === 'automation') return 'An automation rule';
    return 'The system';
  }

  /** The full `User` behind an event's actor, when it has one — an automation rule or the system has no avatar to show. */
  function actorUser(actor: ActivityEventSummary['actor']) {
    return actor.kind === 'user' ? $users.find((u) => u.id === actor.userId) : undefined;
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
  let triggeringAgentId: string | null = null;

  function toggleAgentPicker() {
    showAgentPicker = !showAgentPicker;
  }
  async function attachAgentChecked(agentUserId: string, e: Event) {
    const checkbox = e.currentTarget as HTMLInputElement;
    if (!issue) return;
    try {
      await assignAgent(issue.id, agentUserId);
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
              {@const descriptionHtml = renderMarkdown(issue.description.plainText, $users)}
              <div class="markdown" use:lineNumbers={descriptionHtml}>{@html descriptionHtml}</div>
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
        {#if attachedAgents.length === 0}
          <p class="agents-hint">Attach an agent to have it work this ticket.</p>
        {/if}
        <div class="agent-chips">
          {#each attachedAgents as agent (agent.id)}
            <span class="agent-chip">
              <Avatar userId={agent.id} name={displayName(agent)} kind={agent.kind} size={16} />
              <Icon name="robot" size={11} />{displayName(agent)}
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
                    <Icon name="robot" size={11} />{displayName(a)}
                  </label>
                {/each}
              {/if}
            </div>
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
        <div class="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={activityTab === 'comments'} class:active={activityTab === 'comments'} on:click={() => (activityTab = 'comments')}>Comments</button>
          <button type="button" role="tab" aria-selected={activityTab === 'activity'} class:active={activityTab === 'activity'} on:click={() => (activityTab = 'activity')}>Activity</button>
        </div>

          {#if activityTab === 'activity'}
            {#if activityEvents.length === 0}
              <div class="activity-empty">Nothing logged yet.</div>
            {:else}
              <ul class="activity-list">
                {#each [...activityEvents].reverse() as event (event.id)}
                  {@const expanded = expandedEventIds.has(event.id)}
                  {@const detail = eventDetails[event.id]}
                  {@const user = actorUser(event.actor)}
                  <li>
                    <button type="button" class="activity-row" aria-expanded={expanded} on:click={() => toggleActivityItem(event.id)}>
                      <Icon name={expanded ? 'chevdown' : 'chevron'} size={10} />
                      {#if user}
                        <Avatar userId={user.id} name={displayName(user)} avatarUrl={user.avatarUrl} kind={user.kind} size={18} />
                      {:else}
                        <div class="activity-system-avatar"><Icon name="gear" size={10} /></div>
                      {/if}
                      <span class="activity-actor">{actorLabel(event.actor)}</span>
                      <span class="activity-desc">{describeEventType(event.type)}</span>
                      <span class="activity-time">{formatRelativeDate(event.occurredAt)}</span>
                    </button>
                    {#if expanded}
                      <div class="activity-detail">
                        {#if detail === 'loading' || detail === undefined}
                          Loading details…
                        {:else if detail === 'error'}
                          Couldn't load details for this event.
                        {:else}
                          <div>{describeEvent(detail, { workflow: $workflow, labels: $labels, users: $users })}</div>
                          {#if (detail.payload.type === 'comment.created' || detail.payload.type === 'comment.edited') && detail.payload.body}
                            <div class="activity-detail-body markdown">{@html renderMarkdown(detail.payload.body, $users)}</div>
                          {/if}
                        {/if}
                      </div>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          {:else}
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
                onDeleteComment={async (commentId) => { if (issue) await removeComment(issue.id, commentId); }}
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
  .drawer-body { flex: 1; overflow-y: auto; padding: 20px 24px 32px; }
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
  .section-label { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-2); margin: 0 0 8px; }
  .section { margin-bottom: 20px; }
  .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 14px; }
  .tabs button {
    font-size: 12px; font-weight: 600; color: var(--text-3); padding: 6px 4px 8px; margin-right: 14px;
    border-bottom: 2px solid transparent; cursor: pointer;
  }
  .tabs button:hover { color: var(--text-2); }
  .tabs button.active { color: var(--text); border-bottom-color: var(--accent); }
  .activity-empty { font-size: 12px; color: var(--text-3); }
  .activity-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; max-height: 320px; overflow-y: auto; }
  .activity-list li { font-size: 12px; color: var(--text-2); line-height: 1.5; }
  .activity-row {
    display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; font: inherit; color: inherit;
    padding: 4px 2px; border-radius: 4px; cursor: pointer;
  }
  .activity-row:hover { background: var(--surface-2); }
  .activity-system-avatar {
    width: 18px; height: 18px; border-radius: 50%; background: var(--surface-sunken);
    display: inline-flex; align-items: center; justify-content: center; color: var(--text-3); flex: 0 0 auto;
  }
  .activity-actor { font-weight: 600; color: var(--text); }
  .activity-desc { flex: 1; }
  .activity-time { color: var(--text-3); }
  .activity-detail { margin: 2px 2px 6px 24px; padding: 8px 10px; background: var(--surface-2); border-radius: 6px; font-size: 12px; color: var(--text-2); }
  .activity-detail-body { margin-top: 6px; }
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
