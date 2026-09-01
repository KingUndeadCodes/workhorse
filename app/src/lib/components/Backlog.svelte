<script lang="ts">
  import { tick } from 'svelte';
  import type { Issue } from '$domain';
  import Icon from './Icon.svelte';
  import IssueCard from './IssueCard.svelte';
  import SearchFilterBar from './SearchFilterBar.svelte';
  import KeyboardNavHint from './KeyboardNavHint.svelte';
  import {
    board,
    completeSprint,
    createSprint,
    featureFlags,
    issueTypes,
    issuesStore,
    moveIssueToStatus,
    selectedIssueId,
    sprints,
    startSprint,
    statusCategories,
    updateIssue,
    workflow,
  } from '../stores/workspace';
  import { isMobile } from '../stores/viewport';
  import { issueFiltersStore, issueMatchesFilters } from '../stores/issueFilters';
  import { t, tn } from '../i18n';

  let newSprintName = '';
  let creating = false;

  $: epicTypeId = $issueTypes.find((t) => t.name === 'Epic')?.id;
  $: trackedIssues = $issuesStore.filter((i) => i.issueTypeId !== epicTypeId && issueMatchesFilters(i, $issueFiltersStore));
  $: doneStatusIds = new Set(
    ($workflow?.statuses ?? [])
      .filter((s) => $statusCategories.find((c) => c.id === s.categoryId)?.type === 'done')
      .map((s) => s.id),
  );
  $: backlogIssues = trackedIssues.filter((i) => !i.sprintId);
  $: orderedSprints = [...$sprints].sort((a, b) => (a.state === 'active' ? -1 : b.state === 'active' ? 1 : 0));
  // Empty on desktop, so IssueCard's move-trigger (gated on `columns.length > 1`) never renders
  // there — Backlog has no drag-and-drop today, so desktop behavior stays exactly as it was.
  // On mobile this closes a real functional gap: Backlog previously had zero way to change an
  // issue's status at all, on any viewport.
  $: mobileMoveColumns = $isMobile ? ($board?.columns ?? []) : [];

  function selectIssue(id: string) {
    $selectedIssueId = id;
  }

  function moveIssue(issueId: string, statusIds: string[]) {
    if (statusIds[0]) moveIssueToStatus(issueId, statusIds[0]);
  }

  async function submitNewSprint() {
    if (!newSprintName.trim() || creating) return;
    creating = true;
    try {
      await createSprint(newSprintName.trim());
      newSprintName = '';
    } finally {
      creating = false;
    }
  }

  // ---- Keyboard navigation: always on, same pattern as Board.svelte ----
  // Backlog has no drag-and-drop today on desktop at all — there's no mouse gesture for moving an
  // issue between sprints except opening its full details and changing the Sprint field there. So
  // this is a new keyboard-only way to do that reassignment: focus a card, Space picks it up,
  // Up/Down move it (there's only one axis here — sections aren't split into columns like Board's
  // swimlane × column grid), Space drops it into whatever section it's now in.
  interface NavSection { sprintId: string | undefined; issues: Issue[] }

  let navSectionIndex = 0;
  let navCardIndex = 0;
  let heldIssueId: string | null = null;
  let announcement = '';

  function announce(message: string) {
    announcement = '';
    tick().then(() => (announcement = message));
  }

  $: navSections = [
    ...orderedSprints.map((sprint) => ({ sprintId: sprint.id, issues: trackedIssues.filter((i) => i.sprintId === sprint.id) })),
    { sprintId: undefined, issues: backlogIssues },
  ] satisfies NavSection[];
  $: sectionLabels = [...orderedSprints.map((s) => s.name), $t('backlog.backlogLabel')];

  function findNavPosition(issueId: string): [number, number] | null {
    for (let si = 0; si < navSections.length; si++) {
      const ii = navSections[si].issues.findIndex((i) => i.id === issueId);
      if (ii !== -1) return [si, ii];
    }
    return null;
  }

  function focusNavPosition(si: number, ii: number) {
    navSectionIndex = si;
    navCardIndex = ii;
    tick().then(() => {
      const issue = navSections[si]?.issues[ii];
      const el = document.getElementById(issue ? `issue-card-${issue.id}` : `backlog-nav-section-${si}`);
      el?.focus();
    });
  }

  /** Up/Down within the current section's cards; rolls over into the previous/next section the
   *  moment it runs off either end, so there's no separate "switch section" key needed. */
  function moveVertical(delta: number) {
    const section = navSections[navSectionIndex];
    const ii = navCardIndex + delta;
    if (section && ii >= 0 && ii < section.issues.length) {
      focusNavPosition(navSectionIndex, ii);
      return;
    }
    const nextSi = navSectionIndex + (delta > 0 ? 1 : -1);
    if (nextSi < 0 || nextSi >= navSections.length) return; // already at the first/last section
    const nextSection = navSections[nextSi];
    focusNavPosition(nextSi, delta > 0 ? 0 : Math.max(0, nextSection.issues.length - 1));
  }

  function toggleHold() {
    if (heldIssueId) {
      const section = navSections[navSectionIndex];
      const heldIssue = trackedIssues.find((i) => i.id === heldIssueId);
      if (section && heldIssue) {
        updateIssue(heldIssueId, { sprintId: section.sprintId ?? null } as Partial<Issue>);
        announce($t('backlog.keyboardNav.dropped', { title: heldIssue.title, section: sectionLabels[navSectionIndex] ?? '' }));
      }
      heldIssueId = null;
    } else {
      const issue = navSections[navSectionIndex]?.issues[navCardIndex];
      if (!issue) return;
      heldIssueId = issue.id;
      announce($t('backlog.keyboardNav.pickedUp', { title: issue.title }));
    }
  }
  function cancelHold() {
    heldIssueId = null;
    announce($t('backlog.keyboardNav.cancelled'));
  }

  /** Space on a card, wired via IssueCard's `onGrab` prop — see Board.svelte's identical
   *  `handleCardGrab` for why this has to resync position itself. */
  function handleCardGrab(issueId: string) {
    const pos = findNavPosition(issueId);
    if (pos) [navSectionIndex, navCardIndex] = pos;
    toggleHold();
  }

  function resyncNavPosition(target: HTMLElement): boolean {
    const isCard = target.classList?.contains('card');
    const isNavSection = target.classList?.contains('nav-section');
    if (!isCard && !isNavSection) return false;
    if (isCard) {
      const pos = findNavPosition(target.id.replace('issue-card-', ''));
      if (pos) [navSectionIndex, navCardIndex] = pos;
    } else {
      navSectionIndex = Number(target.id.replace('backlog-nav-section-', ''));
      navCardIndex = 0;
    }
    return true;
  }

  // Listens on the window rather than just this view's own wrapper — see Board.svelte's
  // identical `handleBoardKeydown` doc comment for why: nothing is focused by default, and a
  // scoped listener would never see a keydown fired on some ancestor like <main>.
  function handleBacklogKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return;
    resyncNavPosition(target);
    switch (e.key) {
      // No second axis here — Left/Right step through the section just like Up/Down do.
      case 'ArrowUp': case 'ArrowLeft': e.preventDefault(); moveVertical(-1); break;
      case 'ArrowDown': case 'ArrowRight': e.preventDefault(); moveVertical(1); break;
      case 'Escape': if (heldIssueId) { e.preventDefault(); cancelHold(); } break;
      case ' ':
        if (!(e.target as HTMLElement).classList.contains('card')) { e.preventDefault(); toggleHold(); }
        break;
    }
  }
</script>

<svelte:window on:keydown={handleBacklogKeydown} />

<SearchFilterBar />
<div class="backlog">
  <KeyboardNavHint message={$t('backlog.keyboardNav.hint')} {announcement} />
  {#each orderedSprints as sprint, si (sprint.id)}
    {@const sprintIssues = trackedIssues.filter((i) => i.sprintId === sprint.id)}
    {@const points = sprintIssues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0)}
    {@const donePoints = sprintIssues.filter((i) => doneStatusIds.has(i.statusId)).reduce((sum, i) => sum + (i.storyPoints ?? 0), 0)}
    <section class="sprint-block">
      <div class="sprint-head">
        <span class="sprint-name">{sprint.name}</span>
        <span class="sprint-state" class:active={sprint.state === 'active'} class:closed={sprint.state === 'closed'}>{$t(`backlog.sprintStates.${sprint.state}`)}</span>
        {#if sprint.goal}<span class="sprint-goal">{sprint.goal}</span>{/if}
        <span class="sprint-spacer"></span>
        {#if $featureFlags.storyPoints}<span class="sprint-points mono">{$t('backlog.pointsSuffix', { done: donePoints, total: points })}</span>{/if}
        {#if sprint.state === 'future'}
          <button class="btn" on:click={() => startSprint(sprint.id)}>{$t('backlog.startSprintButton')}</button>
        {:else if sprint.state === 'active'}
          <button class="btn" on:click={() => completeSprint(sprint.id)}>{$t('backlog.completeSprintButton')}</button>
        {/if}
      </div>
      <div
        class="issue-list"
        id="backlog-nav-section-{si}"
        class:nav-section={sprintIssues.length === 0}
        tabindex={sprintIssues.length === 0 ? -1 : undefined}
      >
        {#each sprintIssues as issue (issue.id)}
          <IssueCard
          {issue}
          selected={issue.id === $selectedIssueId}
          onSelect={selectIssue}
          {doneStatusIds}
          columns={mobileMoveColumns}
          onMove={moveIssue}
          moveMenuMode="sheet"
          held={heldIssueId === issue.id}
          onGrab={() => handleCardGrab(issue.id)}
        />
        {:else}
          <div class="empty">{$t('backlog.noIssuesInSprint')}</div>
        {/each}
      </div>
    </section>
  {/each}

  <section class="sprint-block">
    <div class="sprint-head">
      <span class="sprint-name">{$t('backlog.backlogLabel')}</span>
      <span class="sprint-spacer"></span>
      <span class="sprint-points mono">{$tn('backlog.issuesCount', backlogIssues.length)}</span>
    </div>
    <div
      class="issue-list"
      id="backlog-nav-section-{orderedSprints.length}"
      class:nav-section={backlogIssues.length === 0}
      tabindex={backlogIssues.length === 0 ? -1 : undefined}
    >
      {#each backlogIssues as issue (issue.id)}
        <IssueCard
          {issue}
          selected={issue.id === $selectedIssueId}
          onSelect={selectIssue}
          {doneStatusIds}
          columns={mobileMoveColumns}
          onMove={moveIssue}
          moveMenuMode="sheet"
          held={heldIssueId === issue.id}
          onGrab={() => handleCardGrab(issue.id)}
        />
      {:else}
        <div class="empty">{$t('backlog.nothingUnscheduled')}</div>
      {/each}
    </div>
  </section>

  <form class="new-sprint" on:submit|preventDefault={submitNewSprint}>
    <Icon name="plus" size={13} />
    <input type="text" placeholder={$t('backlog.newSprintPlaceholder')} bind:value={newSprintName} />
    <button type="submit" disabled={!newSprintName.trim() || creating}>{$t('backlog.createSprintButton')}</button>
  </form>
</div>

<style>
  /* Empty sections only become focusable (tabindex="-1", see the markup above) once keyboard
     navigation is on, so a held card can still be walked onto a sprint with nothing in it yet. */
  .issue-list.nav-section:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; background: var(--accent-soft); border-radius: 8px; }

  .backlog { flex: 1; overflow: auto; padding: 16px 20px 28px; display: flex; flex-direction: column; gap: 22px; }
  .sprint-block { display: flex; flex-direction: column; gap: 10px; }
  .sprint-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .sprint-name { font-size: 13.5px; font-weight: 700; color: var(--text); }
  .sprint-state { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; padding: 2px 7px; border-radius: 99px; background: var(--surface-sunken); color: var(--text-3); }
  .sprint-state.active { background: var(--info-soft); color: var(--info); }
  .sprint-state.closed { background: var(--success-soft); color: var(--success); }
  .sprint-goal { font-size: 12px; color: var(--text-2); }
  .sprint-spacer { flex: 1; }
  .sprint-points { font-size: 11.5px; color: var(--text-3); }
  .btn { font-size: 11.5px; font-weight: 600; color: var(--accent-strong); background: var(--accent-soft); padding: 5px 10px; border-radius: 7px; }
  .issue-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
  .empty { color: var(--text-3); font-size: 12px; padding: 10px; border: 1px dashed var(--border); border-radius: 8px; grid-column: 1 / -1; }
  .new-sprint { display: flex; align-items: center; gap: 8px; padding: 10px; border: 1px dashed var(--border); border-radius: 8px; color: var(--text-3); }
  .new-sprint:focus-within { border-color: var(--accent); }
  .new-sprint input { flex: 1; font: inherit; font-size: 12.5px; color: var(--text); background: none; border: none; outline: none; }
  .new-sprint button { font-size: 12px; font-weight: 600; color: var(--accent-strong); background: var(--accent-soft); padding: 6px 10px; border-radius: 6px; }
  .new-sprint button:disabled { opacity: .5; }

  @media (max-width: 767px) {
    .backlog { padding: 12px 12px 24px; gap: 20px; }
    .issue-list { grid-template-columns: 1fr; }
    .sprint-name { font-size: 14.5px; }
    .sprint-goal { font-size: 12.5px; }
    .sprint-state { padding: 4px 9px; font-size: 11px; }
    /* Start/Complete Sprint were compact inline buttons sized for a mouse — full-width and
       taller gives them a real tap target and keeps them from getting lost in the wrapped
       .sprint-head row on a narrow screen. */
    .sprint-head { gap: 8px 10px; }
    .btn { flex: 1 0 100%; padding: 11px 0; font-size: 13px; text-align: center; }
    .new-sprint { padding: 13px; }
    .new-sprint input { font-size: 16px; }
    .new-sprint button { padding: 9px 13px; font-size: 13px; }
  }
</style>
