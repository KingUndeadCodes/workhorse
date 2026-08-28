<script lang="ts">
  import { tick } from 'svelte';
  import type { Issue } from '$domain';
  import Icon from './Icon.svelte';
  import IssueCard from './IssueCard.svelte';
  import SearchFilterBar from './SearchFilterBar.svelte';
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
    users,
    workflow,
  } from '../stores/workspace';
  import { isMobile } from '../stores/viewport';
  import { issueFiltersStore, issueMatchesFilters } from '../stores/issueFilters';
  import { keyboardNavEnabled } from '../stores/keyboardNav';
  import { ACTION_LABEL_KEYS, ACTION_ORDER, keybinds } from '../stores/keybinds';
  import { displayName, formatKeyLabel } from '../util';
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

  // ---- WASD keyboard navigation (Settings → Appearance, off by default) ----
  // Unlike Board.svelte, Backlog has no drag-and-drop today on desktop at all — there's
  // currently no way to move an issue between sprints except opening its full details and
  // changing the Sprint field there. So this isn't a keyboard *alternative* to an existing mouse
  // gesture; it's a new keyboard-only way to do the same reassignment, built on the identical
  // shared keybinds (`stores/keybinds.ts`) Board.svelte uses, reinterpreted for a one-axis list
  // of sprint sections instead of a swimlane × column grid:
  //   - moveUp/moveDown/moveLeft/moveRight all move to the previous/next card in the current
  //     section (there's no second axis here — sections aren't split into columns).
  //   - prevSwimlane/nextSwimlane move to the previous/next section (a sprint, or the trailing
  //     "Backlog" section) — this plays the same role Board's epic swimlanes do.
  //   - firstColumn/lastColumn jump to the first/last card in the current section.
  //   - Shift picks a card up and, dropped into a different section, sets its `sprintId` to that
  //     section's sprint (or clears it, for the Backlog section).
  interface NavSection { sprintId: string | undefined; issues: Issue[] }

  let navSectionIndex = 0;
  let navCardIndex = 0;
  let heldIssueId: string | null = null;
  let infoIssue: Issue | null = null;
  let announcement = '';
  let hintDismissed = false;
  let legendOpen = false;
  let previousNavPosition: [number, number] | null = null;
  let modifierKeyIsBareTap = false;

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
    infoIssue = null;
    tick().then(() => {
      const issue = navSections[si]?.issues[ii];
      const el = document.getElementById(issue ? `issue-card-${issue.id}` : `backlog-nav-section-${si}`);
      el?.focus();
    });
  }

  function recordHistory() {
    previousNavPosition = [navSectionIndex, navCardIndex];
  }

  function moveCard(delta: number) {
    const section = navSections[navSectionIndex];
    if (!section || section.issues.length === 0) return;
    recordHistory();
    focusNavPosition(navSectionIndex, Math.min(Math.max(navCardIndex + delta, 0), section.issues.length - 1));
  }
  function moveSection(delta: number) {
    if (navSections.length === 0) return;
    recordHistory();
    const nextSi = (navSectionIndex + delta + navSections.length) % navSections.length;
    const nextCard = Math.min(navCardIndex, Math.max(0, navSections[nextSi].issues.length - 1));
    focusNavPosition(nextSi, nextCard);
  }
  function moveToEdgeCard(edge: 'first' | 'last') {
    const section = navSections[navSectionIndex];
    if (!section) return;
    recordHistory();
    focusNavPosition(navSectionIndex, edge === 'first' ? 0 : Math.max(0, section.issues.length - 1));
  }
  function goBack() {
    if (!previousNavPosition) return;
    const current: [number, number] = [navSectionIndex, navCardIndex];
    focusNavPosition(...previousNavPosition);
    previousNavPosition = current;
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
      announce(
        $t('backlog.keyboardNav.pickedUp', {
          title: issue.title,
          dropKey: formatKeyLabel($keybinds.pickUpDrop),
          cancelKey: formatKeyLabel($keybinds.cancel),
        }),
      );
    }
  }
  function cancelHold() {
    heldIssueId = null;
    announce($t('backlog.keyboardNav.cancelled'));
  }

  function toggleInfo() {
    const issue = navSections[navSectionIndex]?.issues[navCardIndex];
    infoIssue = issue && infoIssue?.id !== issue.id ? issue : null;
  }
  function handleCardSecondary(issueId: string) {
    const pos = findNavPosition(issueId);
    if (pos) [navSectionIndex, navCardIndex] = pos;
    toggleInfo();
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

  function handleBacklogKeydown(e: KeyboardEvent) {
    if (!$keyboardNavEnabled) return;
    if (!resyncNavPosition(e.target as HTMLElement)) return;
    const key = e.key.toLowerCase();
    const kb = $keybinds;

    if (kb.pickUpDrop === 'shift') {
      if (key === 'shift') {
        modifierKeyIsBareTap = true;
        return;
      }
      if (e.shiftKey) modifierKeyIsBareTap = false;
    }

    if (e.shiftKey && key === kb.goBack) {
      e.preventDefault();
      goBack();
      return;
    }
    if (key === kb.pickUpDrop && kb.pickUpDrop !== 'shift') {
      e.preventDefault();
      toggleHold();
      return;
    }
    // No second axis here — all four movement keys just step through the current section's cards.
    if (key === kb.moveUp || key === kb.moveLeft) { e.preventDefault(); moveCard(-1); return; }
    if (key === kb.moveDown || key === kb.moveRight) { e.preventDefault(); moveCard(1); return; }
    if (key === kb.prevSwimlane) { e.preventDefault(); moveSection(-1); return; }
    if (key === kb.nextSwimlane) { e.preventDefault(); moveSection(1); return; }
    if (key === kb.firstColumn) { e.preventDefault(); moveToEdgeCard('first'); return; }
    if (key === kb.lastColumn) { e.preventDefault(); moveToEdgeCard('last'); return; }
    // showHint is handled globally (see handleGlobalKeydown below), not here — it needs to work
    // even before any card has ever been focused, which this handler can't see at all (it only
    // fires when the keydown bubbles up through a focused card or empty-section placeholder).
    if (key === kb.cancel) {
      if (infoIssue) { e.preventDefault(); infoIssue = null; }
      if (heldIssueId) { e.preventDefault(); cancelHold(); }
      return;
    }
    if (key === kb.info && !(e.target as HTMLElement).classList.contains('card')) {
      e.preventDefault();
      toggleInfo();
    }
  }

  function handleBacklogKeyup(e: KeyboardEvent) {
    if (!$keyboardNavEnabled || $keybinds.pickUpDrop !== 'shift' || e.key !== 'Shift') return;
    const wasBareTap = modifierKeyIsBareTap;
    modifierKeyIsBareTap = false;
    if (!wasBareTap || !resyncNavPosition(e.target as HTMLElement)) return;
    e.preventDefault();
    toggleHold();
  }

  /** Window-level, unlike everything else above — see the identical comment in Board.svelte. */
  function handleGlobalKeydown(e: KeyboardEvent) {
    if (!$keyboardNavEnabled || e.key.toLowerCase() !== $keybinds.showHint) return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
    e.preventDefault();
    if (legendOpen) {
      legendOpen = false;
    } else {
      hintDismissed = false;
      legendOpen = true;
    }
  }

  $: infoRect = infoIssue ? (document.getElementById(`issue-card-${infoIssue.id}`)?.getBoundingClientRect() ?? null) : null;
  $: infoAssignees = infoIssue
    ? infoIssue.assigneeIds.map((id) => $users.find((u) => u.id === id)).filter((u): u is NonNullable<typeof u> => !!u).map(displayName)
    : [];
</script>

<svelte:window on:keydown={handleGlobalKeydown} />
<SearchFilterBar />
{#if $keyboardNavEnabled && !hintDismissed}
  <div class="keyboard-nav-hint">
    <div class="hint-row">
      <p>{$t('backlog.keyboardNav.hintShort', { key: formatKeyLabel($keybinds.showHint) })}</p>
      <button type="button" class="hint-toggle" on:click={() => (legendOpen = !legendOpen)}>
        {legendOpen ? $t('board.keyboardNav.hideShortcuts') : $t('board.keyboardNav.showShortcuts')}
      </button>
      <button type="button" class="hint-dismiss" aria-label={$t('board.keyboardNav.hintDismiss')} on:click={() => (hintDismissed = true)}>
        <Icon name="x" size={11} />
      </button>
    </div>
    {#if legendOpen}
      <dl class="legend">
        {#each ACTION_ORDER as action (action)}
          <div class="legend-row">
            <dt>{$t(ACTION_LABEL_KEYS[action])}</dt>
            <dd class="key-badge">{action === 'goBack' ? `Shift + ${formatKeyLabel($keybinds[action])}` : formatKeyLabel($keybinds[action])}</dd>
          </div>
        {/each}
      </dl>
    {/if}
  </div>
{/if}
<div class="visually-hidden" aria-live="polite">{announcement}</div>
<div class="backlog" on:keydown={handleBacklogKeydown} on:keyup={handleBacklogKeyup}>
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
        class:nav-section={$keyboardNavEnabled && sprintIssues.length === 0}
        tabindex={$keyboardNavEnabled && sprintIssues.length === 0 ? -1 : undefined}
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
          openKey={$keyboardNavEnabled ? $keybinds.openDetails : 'enter'}
          secondaryKey={$keyboardNavEnabled ? $keybinds.info : undefined}
          onSecondary={$keyboardNavEnabled ? () => handleCardSecondary(issue.id) : undefined}
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
      class:nav-section={$keyboardNavEnabled && backlogIssues.length === 0}
      tabindex={$keyboardNavEnabled && backlogIssues.length === 0 ? -1 : undefined}
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
          openKey={$keyboardNavEnabled ? $keybinds.openDetails : 'enter'}
          secondaryKey={$keyboardNavEnabled ? $keybinds.info : undefined}
          onSecondary={$keyboardNavEnabled ? () => handleCardSecondary(issue.id) : undefined}
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

{#if infoIssue && infoRect}
  <div class="info-popover" role="dialog" aria-label={infoIssue.title} style="top:{infoRect.bottom + 6}px; left:{infoRect.left}px">
    <div class="info-popover-title">{infoIssue.title}</div>
    <div class="info-popover-row">
      <span class="info-popover-label">{$t('board.keyboardNav.infoAssignees')}</span>
      <span>{infoAssignees.length ? infoAssignees.join(', ') : $t('board.keyboardNav.infoNone')}</span>
    </div>
    {#if infoIssue.dueDate}
      <div class="info-popover-row">
        <span class="info-popover-label">{$t('board.keyboardNav.infoDueDate')}</span>
        <span>{infoIssue.dueDate}</span>
      </div>
    {/if}
    <button type="button" class="info-popover-close" on:click={() => (infoIssue = null)}>{$t('common.close')}</button>
  </div>
{/if}

<style>
  .visually-hidden {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
    clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
  }
  .keyboard-nav-hint {
    margin: 12px 20px 16px; padding: 9px 12px; font-size: 11.5px; color: var(--text-2);
    background: var(--accent-soft); border-radius: 8px;
  }
  .hint-row { display: flex; align-items: flex-start; gap: 10px; }
  .hint-row p { margin: 0; flex: 1; }
  .hint-toggle { color: var(--accent); font-weight: 600; flex: 0 0 auto; white-space: nowrap; }
  .hint-toggle:hover { color: var(--accent-strong); }
  .hint-dismiss { color: var(--text-2); padding: 2px; border-radius: 4px; flex: 0 0 auto; }
  .hint-dismiss:hover { color: var(--text); background: var(--surface-2); }
  .legend { margin: 10px 0 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 20px; }
  .legend-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 3px 0; }
  .legend-row dt { color: var(--text-2); }
  .legend-row dd { margin: 0; }
  .key-badge {
    font-family: 'Mono', ui-monospace, monospace; font-size: 10.5px; font-weight: 700; color: var(--accent-strong);
    background: var(--surface); border: 1px solid var(--border); border-radius: 5px; padding: 1px 6px; white-space: nowrap;
  }
  .info-popover {
    position: fixed; z-index: 20; width: 240px; background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; box-shadow: var(--shadow-lg); padding: 12px; display: flex; flex-direction: column; gap: 8px;
  }
  .info-popover-title { font-size: 13px; font-weight: 700; color: var(--text); }
  .info-popover-row { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; }
  .info-popover-label { color: var(--text-3); }
  .info-popover-close { align-self: flex-end; font-size: 12px; color: var(--accent); padding: 2px 4px; }
  /* Empty sections only become focusable (tabindex="-1", see the markup above) once keyboard
     navigation is on, so WASD can still land a held card on a sprint with nothing in it yet. */
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

  @media (max-width: 640px) {
    .legend { grid-template-columns: 1fr; }
  }
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
