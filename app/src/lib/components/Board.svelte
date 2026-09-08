<script lang="ts">
  import { tick } from 'svelte';
  import type { Issue } from '$domain';
  import IssueCard from './IssueCard.svelte';
  import SearchFilterBar from './SearchFilterBar.svelte';
  import KeyboardNavHint from './KeyboardNavHint.svelte';
  import { board, issueTypes, issuesStore, moveIssueToStatus, selectedIssueId, statusCategories, workflow } from '../stores/workspace';
  import { issueFiltersStore, issueMatchesFilters } from '../stores/issueFilters';
  import { t } from '../i18n';

  /** Cell key currently under the drag cursor, for the drop-target highlight. */
  let dragOverCell: string | null = null;

  // ---- Keyboard navigation: always on, not an opt-in mode ----
  // This is the standard accessible drag-and-drop pattern (the same one Trello and the WAI-ARIA
  // Authoring Practices use), not a custom scheme: focus a card, Space picks it up, arrow keys
  // move it, Space drops it, Escape cancels. Arrow keys because that's how every other widget on
  // the OS already navigates (comboboxes, radio groups) — no new mental model to learn. Enter
  // opens the card's full details, exactly like a click.
  interface NavCell { statusIds: string[]; issues: Issue[] }
  interface NavSwimlane { cells: NavCell[] }

  let navSwimlaneIndex = 0;
  let navColumnIndex = 0;
  let navCardIndex = 0;
  /** Id of the card currently picked up — Space again drops it into the focused column. */
  let heldIssueId: string | null = null;
  /** Announced via aria-live so screen-reader users hear pick-up/drop/cancel outcomes. */
  let announcement = '';

  function announce(message: string) {
    announcement = '';
    tick().then(() => (announcement = message));
  }

  /** Finds an issue's (swimlane, column, card) position in the current `navSwimlanes` grid. */
  function findNavPosition(issueId: string): [number, number, number] | null {
    for (let si = 0; si < navSwimlanes.length; si++) {
      for (let ci = 0; ci < navSwimlanes[si].cells.length; ci++) {
        const ii = navSwimlanes[si].cells[ci].issues.findIndex((i) => i.id === issueId);
        if (ii !== -1) return [si, ci, ii];
      }
    }
    return null;
  }

  /** Moves nav focus to a cell and puts real DOM focus on whatever's there (card or empty-cell placeholder). */
  function focusNavCell(si: number, ci: number, ii: number) {
    navSwimlaneIndex = si;
    navColumnIndex = ci;
    navCardIndex = ii;
    tick().then(() => {
      const issue = navSwimlanes[si]?.cells[ci]?.issues[ii];
      const el = document.getElementById(issue ? `issue-card-${issue.id}` : `nav-cell-${si}-${ci}`);
      el?.focus();
    });
  }

  /** Up/Down within a column — rolls over into the next/previous swimlane's *same* column the
   *  moment it runs out of cards in the current one, instead of needing a separate "switch
   *  swimlane" key. An empty cell still counts as one stop (its placeholder), so a held card can
   *  always be walked into a column with nothing in it yet. */
  function moveVertical(delta: number) {
    const ci = navColumnIndex;
    const ri = navCardIndex + delta;
    const slots = Math.max(navSwimlanes[navSwimlaneIndex]?.cells[ci]?.issues.length ?? 0, 1);
    if (ri >= 0 && ri < slots) {
      focusNavCell(navSwimlaneIndex, ci, ri);
      return;
    }
    const nextSi = navSwimlaneIndex + (delta > 0 ? 1 : -1);
    if (nextSi < 0 || nextSi >= navSwimlanes.length) return; // already at the first/last swimlane
    const nextSlots = Math.max(navSwimlanes[nextSi]?.cells[ci]?.issues.length ?? 0, 1);
    focusNavCell(nextSi, ci, delta > 0 ? 0 : nextSlots - 1);
  }
  /** Left/Right between the (fixed, small) set of columns — clamped, not rolling; there's nothing
   *  beyond the first/last column to roll into. */
  function moveHorizontal(delta: number) {
    const swimlane = navSwimlanes[navSwimlaneIndex];
    if (!swimlane) return;
    const nextCol = Math.min(Math.max(navColumnIndex + delta, 0), swimlane.cells.length - 1);
    const nextIssues = swimlane.cells[nextCol]?.issues ?? [];
    focusNavCell(navSwimlaneIndex, nextCol, Math.min(navCardIndex, Math.max(0, nextIssues.length - 1)));
  }

  function toggleHold() {
    if (heldIssueId) {
      const cell = navSwimlanes[navSwimlaneIndex]?.cells[navColumnIndex];
      const targetStatusId = cell?.statusIds[0];
      const heldIssue = allIssues.find((i) => i.id === heldIssueId);
      if (targetStatusId && heldIssue) {
        moveIssueToStatus(heldIssueId, targetStatusId);
        announce($t('board.keyboardNav.dropped', { title: heldIssue.title, column: columns[navColumnIndex]?.name ?? '' }));
      }
      heldIssueId = null;
    } else {
      const issue = navSwimlanes[navSwimlaneIndex]?.cells[navColumnIndex]?.issues[navCardIndex];
      if (!issue) return;
      heldIssueId = issue.id;
      announce($t('board.keyboardNav.pickedUp', { title: issue.title }));
    }
  }
  function cancelHold() {
    heldIssueId = null;
    announce($t('board.keyboardNav.cancelled'));
  }

  /** Space on a card, wired via IssueCard's `onGrab` prop: this fires during the DOM target
   *  phase, before the ancestor keydown handler below even runs, so it has to sync nav position
   *  itself first (it may have gotten focus via a plain Tab, not our own arrow-key movement). */
  function handleCardGrab(issueId: string) {
    const pos = findNavPosition(issueId);
    if (pos) [navSwimlaneIndex, navColumnIndex, navCardIndex] = pos;
    toggleHold();
  }

  /** Syncs nav position from whichever board element actually has focus — it may have gotten
   *  there via a plain Tab or a mouse click rather than our own arrow-key movement. Returns false
   *  (and does nothing else) when focus isn't on a card or empty-cell placeholder at all. */
  function resyncNavPosition(target: HTMLElement): boolean {
    const isCard = target.classList?.contains('card');
    const isNavCell = target.classList?.contains('nav-cell');
    if (!isCard && !isNavCell) return false;
    if (isCard) {
      const pos = findNavPosition(target.id.replace('issue-card-', ''));
      if (pos) [navSwimlaneIndex, navColumnIndex, navCardIndex] = pos;
    } else {
      const [si, ci] = target.id.replace('nav-cell-', '').split('-').map(Number);
      navSwimlaneIndex = si;
      navColumnIndex = ci;
      navCardIndex = 0;
    }
    return true;
  }

  /** Single keydown listener on the board — only acts when focus is actually on a card or an
   *  empty-cell placeholder, so typing elsewhere on the page (search box, sidebar) is untouched.
   *  Listens on the window, not just this view's own wrapper: nothing is focused by default when
   *  the page loads (or after a plain click on empty space), and a listener scoped to the board
   *  would never see a keydown that fires on some ancestor like <main> instead — arrow keys would
   *  silently do nothing until the user happened to Tab all the way to a card first. Resyncing
   *  from whatever's actually focused (if it's a card/cell) still works the same as before; when
   *  nothing relevant is focused, movement just starts from wherever nav position already was
   *  (the first cell, initially), so arrows always do *something* the first time they're pressed. */
  function handleBoardKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return;
    resyncNavPosition(target);
    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); moveVertical(-1); break;
      case 'ArrowDown': e.preventDefault(); moveVertical(1); break;
      case 'ArrowLeft': e.preventDefault(); moveHorizontal(-1); break;
      case 'ArrowRight': e.preventDefault(); moveHorizontal(1); break;
      case 'Escape': if (heldIssueId) { e.preventDefault(); cancelHold(); } break;
      // Cards handle Space themselves via the `onGrab` prop below (so IssueCard's own handler
      // and this one don't both fire for the same press); only the empty-cell placeholder needs
      // it handled here, since it has no card-level handler at all.
      case ' ':
        if (!(e.target as HTMLElement).classList.contains('card')) { e.preventDefault(); toggleHold(); }
        break;
    }
  }

  /** Display-only grouping color, not domain data — falls back to the accent for any epic beyond the ones we have a curated color for. */
  const epicColors: Record<string, string> = {
    epic_checkout: 'var(--epic-a)',
    epic_fraud: 'var(--epic-b)',
    epic_platform: 'var(--epic-c)',
  };
  function colorForEpic(epicId: string): string {
    return epicColors[epicId] ?? 'var(--accent)';
  }

  /**
   * Issues whose `parentId` is the given epic. Derives from the live store on every call
   * rather than being precomputed, so it can't go stale the moment an issue's `parentId`
   * or `statusId` changes at runtime.
   */
  function issuesForEpic(all: Issue[], epicId: string): Issue[] {
    return all.filter((i) => i.parentId === epicId);
  }

  /** Issues whose `statusId` falls within a board column's `statusIds`. */
  function issuesInColumn(all: Issue[], statusIds: string[]): Issue[] {
    return all.filter((i) => statusIds.includes(i.statusId));
  }

  /** Unique key for one epic/column intersection, used to key the drag-over highlight. */
  function cellKey(epicId: string, columnId: string): string {
    return `${epicId}:${columnId}`;
  }

  /** Reads the dragged issue's id off the drop event and moves it into this column's first status. */
  function handleDrop(e: DragEvent, statusIds: string[]) {
    e.preventDefault();
    dragOverCell = null;
    const issueId = e.dataTransfer?.getData('text/issue-id');
    if (issueId && statusIds[0]) moveIssueToStatus(issueId, statusIds[0]);
  }

  function selectIssue(id: string) {
    $selectedIssueId = id;
  }

  $: allIssues = $issuesStore;
  $: epicTypeId = $issueTypes.find((t) => t.name === 'Epic')?.id;
  $: epics = allIssues.filter((i) => i.issueTypeId === epicTypeId);
  $: epicIds = new Set(epics.map((e) => e.id));
  // Epics carry a statusId too (so they render sensibly if ever shown as a card elsewhere),
  // but they aren't real work moving through the board — excluded here so WIP/column
  // counts reflect only the issues that actually sit in a column.
  $: trackedIssues = allIssues.filter((i) => i.issueTypeId !== epicTypeId && issueMatchesFilters(i, $issueFiltersStore));
  // Issues with no epic (or one that's since been deleted) have nowhere to render in the
  // swimlane-per-epic layout below otherwise — on a brand-new project with zero epics yet,
  // every issue would silently vanish from the board despite existing.
  $: ungroupedIssues = trackedIssues.filter((i) => !i.parentId || !epicIds.has(i.parentId));
  $: columns = $board?.columns ?? [];
  $: columnCounts = columns.map((col) => issuesInColumn(trackedIssues, col.statusIds).length);
  $: doneStatusIds = new Set(
    ($workflow?.statuses ?? [])
      .filter((s) => $statusCategories.find((c) => c.id === s.categoryId)?.type === 'done')
      .map((s) => s.id),
  );
  // Same swimlane order/gating as the markup below — one source of truth so the nav grid never
  // drifts from what's actually rendered.
  $: navSwimlanes = [
    ...(ungroupedIssues.length > 0 || epics.length === 0
      ? [{ cells: columns.map((col) => ({ statusIds: col.statusIds, issues: issuesInColumn(ungroupedIssues, col.statusIds) })) }]
      : []),
    ...epics.map((epic) => ({
      cells: columns.map((col) => ({ statusIds: col.statusIds, issues: issuesInColumn(issuesForEpic(trackedIssues, epic.id), col.statusIds) })),
    })),
  ] satisfies NavSwimlane[];
  $: noEpicLaneOffset = ungroupedIssues.length > 0 || epics.length === 0 ? 1 : 0;
</script>

<svelte:window on:keydown={handleBoardKeydown} />

<SearchFilterBar />
<div class="board-wrap">
  <KeyboardNavHint message={$t('board.keyboardNav.hint')} {announcement} />
  <div class="board-inner">
    <div class="board-head">
      {#each columns as col, i}
        <div class="col-head">
          <div class="col-head-title">
            <span class="col-dot" class:todo={i === 0} class:progress={i === 1} class:review={i === 2} class:done={i === 3}></span>
            <span class="col-name">{col.name}</span>
            {#if !col.wipLimit}<span class="col-count">{columnCounts[i]}</span>{/if}
          </div>
          {#if col.wipLimit}
            <span class="wip-badge mono" class:at-limit={columnCounts[i] >= col.wipLimit}>{columnCounts[i]}·{col.wipLimit}</span>
          {/if}
        </div>
      {/each}
    </div>

    <!-- Also shown when there are no epics at all (even with zero ungrouped issues) — without
         that, a project with no epics and no issues yet rendered a totally blank board: column
         headers with nothing underneath, no "No issues" placeholder, nothing to click into. -->
    {#if ungroupedIssues.length > 0 || epics.length === 0}
      <div class="swimlane">
        <div class="swimlane-head">
          <span class="epic-dot" style="background:var(--text-3)"></span>
          <span class="epic-name">{$t('board.noEpic')}</span>
        </div>
        <div class="swimlane-body">
          {#each columns as col, ci}
            {@const cellIssues = issuesInColumn(ungroupedIssues, col.statusIds)}
            {@const key = cellKey('no-epic', col.id)}
            <div
              id="nav-cell-0-{ci}"
              class="cell"
              class:drag-over={dragOverCell === key}
              class:nav-cell={cellIssues.length === 0}
              tabindex={cellIssues.length === 0 ? -1 : undefined}
              on:dragover={(e) => { e.preventDefault(); dragOverCell = key; }}
              on:dragleave={() => (dragOverCell = null)}
              on:drop={(e) => handleDrop(e, col.statusIds)}
            >
              <span class="cell-label">{col.name}</span>
              {#if cellIssues.length === 0}
                <div class="cell-empty">{$t('board.noIssues')}</div>
              {:else}
                <div class="cell-list" role="list" aria-label="{col.name} — {$t('board.noEpic')}">
                  {#each cellIssues as issue (issue.id)}
                    <div role="listitem">
                      <IssueCard
                        {issue}
                        selected={issue.id === $selectedIssueId}
                        onSelect={selectIssue}
                        {doneStatusIds}
                        {columns}
                        onMove={(issueId, statusIds) => statusIds[0] && moveIssueToStatus(issueId, statusIds[0])}
                        held={heldIssueId === issue.id}
                        onGrab={() => handleCardGrab(issue.id)}
                      />
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#each epics as epic, epicIdx}
      {@const si = noEpicLaneOffset + epicIdx}
      {@const epicIssues = issuesForEpic(allIssues, epic.id)}
      {@const doneCount = epicIssues.filter((i) => doneStatusIds.has(i.statusId)).length}
      {@const total = epicIssues.length}
      {@const epicTrackedIssues = issuesForEpic(trackedIssues, epic.id)}
      <div class="swimlane">
        <div class="swimlane-head">
          <span class="epic-dot" style="background:{colorForEpic(epic.id)}"></span>
          <span class="epic-name">{epic.title}</span>
          <div class="epic-bar"><span style="width:{total ? (doneCount / total) * 100 : 0}%;background:{colorForEpic(epic.id)}"></span></div>
          <span class="epic-progress mono">{doneCount}/{total}</span>
        </div>
        <div class="swimlane-body">
          {#each columns as col, ci}
            {@const cellIssues = issuesInColumn(epicTrackedIssues, col.statusIds)}
            {@const key = cellKey(epic.id, col.id)}
            <div
              id="nav-cell-{si}-{ci}"
              class="cell"
              class:drag-over={dragOverCell === key}
              class:nav-cell={cellIssues.length === 0}
              tabindex={cellIssues.length === 0 ? -1 : undefined}
              on:dragover={(e) => { e.preventDefault(); dragOverCell = key; }}
              on:dragleave={() => (dragOverCell = null)}
              on:drop={(e) => handleDrop(e, col.statusIds)}
            >
              <span class="cell-label">{col.name}</span>
              {#if cellIssues.length === 0}
                <div class="cell-empty">{$t('board.noIssues')}</div>
              {:else}
                <div class="cell-list" role="list" aria-label="{col.name} — {epic.title}">
                  {#each cellIssues as issue (issue.id)}
                    <div role="listitem">
                      <IssueCard
                        {issue}
                        selected={issue.id === $selectedIssueId}
                        onSelect={selectIssue}
                        {doneStatusIds}
                        {columns}
                        onMove={(issueId, statusIds) => statusIds[0] && moveIssueToStatus(issueId, statusIds[0])}
                        held={heldIssueId === issue.id}
                        onGrab={() => handleCardGrab(issue.id)}
                      />
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  /* No top padding here on purpose: a sticky child sticks to the scroller's *content* box, so
     any padding-top leaves an unclipped strip above .board-head that scrolled cards paint into
     — you'd see a sliver of a card's key row floating above the column headers. The 16px lives
     on .board-head instead, so the header's own opaque background covers that strip. (The
     mobile rule below re-adds wrap padding, which is fine there: .board-head is hidden.) */
  .board-wrap { flex: 1; overflow: auto; padding: 0 20px 28px; min-width: 0; }
  /* Carries the top spacing the wrap no longer has (still scrolls away with the hint, as before).
     Its 12px bottom margin moves into .board-head's padding instead, so that gap survives when
     the header is stuck rather than collapsing against whatever scrolls beneath it. */
  .board-wrap > :global(.keyboard-nav-hint) { margin: 16px 0 0; }
  .board-inner { min-width: 880px; }
  .board-head {
    display: grid; grid-template-columns: repeat(4, minmax(200px, 1fr)); gap: 14px;
    position: sticky; top: 0; background: var(--bg); z-index: 5; padding: 12px 0 10px;
  }
  .col-head { display: flex; align-items: center; justify-content: space-between; padding: 2px 6px; }
  .col-head-title { display: flex; align-items: center; gap: 7px; }
  .col-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-3); }
  .col-dot.progress { background: var(--info); }
  .col-dot.review { background: var(--warning); }
  .col-dot.done { background: var(--success); }
  .col-name { font-size: 11.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-2); }
  .col-count { font-size: 11px; color: var(--text-3); }
  .wip-badge { font-size: 10.5px; font-weight: 600; padding: 1px 7px; border-radius: 99px; background: var(--success-soft); color: var(--success); }
  .wip-badge.at-limit { background: var(--warning-soft); color: var(--warning); }

  .swimlane { margin-bottom: 6px; }
  .swimlane-head { display: flex; align-items: center; gap: 10px; padding: 12px 6px 8px; margin-top: 8px; }
  .epic-dot { width: 9px; height: 9px; border-radius: 3px; flex: 0 0 9px; }
  .epic-name { font-size: 12.5px; font-weight: 700; color: var(--text); }
  .epic-progress { font-size: 11px; color: var(--text-3); }
  .epic-bar { width: 64px; height: 4px; border-radius: 99px; background: var(--surface-sunken); overflow: hidden; }
  .epic-bar > span { display: block; height: 100%; border-radius: 99px; }
  .swimlane-body { display: grid; grid-template-columns: repeat(4, minmax(200px, 1fr)); gap: 14px; }
  .cell {
    background: var(--surface-sunken); border-radius: 10px; padding: 8px; min-height: 56px;
    display: flex; flex-direction: column; gap: 8px; transition: background .1s ease;
  }
  .cell-list { display: flex; flex-direction: column; gap: 8px; }
  .cell.drag-over { background: var(--accent-soft); outline: 2px dashed var(--accent); outline-offset: -2px; }
  /* Empty cells are always focusable (tabindex="-1") so a held card can be walked into a column
     with nothing in it yet. */
  .cell.nav-cell:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; background: var(--accent-soft); }
  .cell-empty { display: flex; align-items: center; justify-content: center; color: var(--text-3); font-size: 11.5px; min-height: 40px; border: 1px dashed var(--border); border-radius: 8px; }
  .cell-label { display: none; }

  /* Below this width, four side-by-side 200px-min columns simply can't fit — a horizontal-
     scrolling kanban left you looking at slivers of two columns at once with the header
     misaligned from what was actually on screen. Instead each swimlane becomes a single
     vertical stack of columns, each labeled since the shared sticky header is gone. */
  @media (max-width: 640px) {
    .board-wrap { padding: 12px 10px 20px; }
    .board-inner { min-width: 0; }
    .board-head { display: none; }
    .swimlane-body { grid-template-columns: 1fr; gap: 12px; }
    .cell-label { display: block; font-size: 12.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-3); margin-bottom: 2px; }
    .cell { padding: 10px; gap: 10px; }
    .swimlane-head { padding: 14px 4px 10px; gap: 12px; }
    .epic-name { font-size: 13.5px; }
    .epic-progress { font-size: 12px; }
  }
</style>
