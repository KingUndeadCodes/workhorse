<script lang="ts">
  import { tick } from 'svelte';
  import type { Issue } from '$domain';
  import Icon from './Icon.svelte';
  import IssueCard from './IssueCard.svelte';
  import SearchFilterBar from './SearchFilterBar.svelte';
  import { board, issueTypes, issuesStore, moveIssueToStatus, selectedIssueId, statusCategories, users, workflow } from '../stores/workspace';
  import { issueFiltersStore, issueMatchesFilters } from '../stores/issueFilters';
  import { keyboardNavEnabled } from '../stores/keyboardNav';
  import { ACTION_LABEL_KEYS, ACTION_ORDER, keybinds } from '../stores/keybinds';
  import { displayName, formatKeyLabel } from '../util';
  import { t } from '../i18n';

  /** Cell key currently under the drag cursor, for the drop-target highlight. */
  let dragOverCell: string | null = null;

  // ---- WASD keyboard navigation (Settings → Appearance, off by default) ----
  // A tap/click + keyboard alternative to the drag-and-drop above — every key below is
  // user-configurable (Settings → Appearance → Keyboard Shortcuts); the defaults are W/A/S/D to
  // move, Shift to pick a card up or drop it, F for a detail popover, Enter for full details,
  // [ / ] to switch swimlanes. Plain, unmodified Tab is deliberately never assignable to
  // anything — it must keep escaping the board for standard keyboard/screen-reader navigation
  // (see keybinds.ts's PROTECTED_KEY) — `goBack`'s key is the one exception, and only because it
  // always requires Shift held down first, same as today's Shift+Tab.
  interface NavCell { statusIds: string[]; issues: Issue[] }
  interface NavSwimlane { cells: NavCell[] }

  let navSwimlaneIndex = 0;
  let navColumnIndex = 0;
  let navCardIndex = 0;
  /** Id of the card currently "picked up" — a second Enter drops it into the focused column. */
  let heldIssueId: string | null = null;
  /** Issue whose detail popover (F/Space) is open, if any. */
  let infoIssue: Issue | null = null;
  /** Announced via aria-live so screen-reader users hear pick-up/drop/cancel outcomes. */
  let announcement = '';
  /** The hint banner can be dismissed and brought back with `?`, rather than always taking up space. */
  let hintDismissed = false;
  /** Full shortcuts legend, expanded from the hint banner — reflects whatever's actually bound
   *  right now, since every key here is user-configurable (Settings → Appearance). */
  let legendOpen = false;

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
    // The info popover (F/Space) is anchored to whatever card was focused when it opened — any
    // further move invalidates that, so close it rather than leaving it pointing at a stale spot.
    infoIssue = null;
    tick().then(() => {
      const issue = navSwimlanes[si]?.cells[ci]?.issues[ii];
      const el = document.getElementById(issue ? `issue-card-${issue.id}` : `nav-cell-${si}-${ci}`);
      el?.focus();
    });
  }

  /** Position before the last WASD/[/] move — Shift+Tab swaps back to it, one step at a time. */
  let previousNavPosition: [number, number, number] | null = null;

  function recordHistory() {
    previousNavPosition = [navSwimlaneIndex, navColumnIndex, navCardIndex];
  }

  function moveVertical(delta: number) {
    const cell = navSwimlanes[navSwimlaneIndex]?.cells[navColumnIndex];
    if (!cell || cell.issues.length === 0) return;
    recordHistory();
    focusNavCell(navSwimlaneIndex, navColumnIndex, Math.min(Math.max(navCardIndex + delta, 0), cell.issues.length - 1));
  }
  function moveHorizontal(delta: number) {
    const swimlane = navSwimlanes[navSwimlaneIndex];
    if (!swimlane) return;
    recordHistory();
    const nextCol = Math.min(Math.max(navColumnIndex + delta, 0), swimlane.cells.length - 1);
    const nextIssues = swimlane.cells[nextCol]?.issues ?? [];
    focusNavCell(navSwimlaneIndex, nextCol, Math.min(navCardIndex, Math.max(0, nextIssues.length - 1)));
  }
  function moveSwimlane(delta: number) {
    if (navSwimlanes.length === 0) return;
    recordHistory();
    const nextSi = (navSwimlaneIndex + delta + navSwimlanes.length) % navSwimlanes.length;
    const nextIssues = navSwimlanes[nextSi]?.cells[navColumnIndex]?.issues ?? [];
    focusNavCell(nextSi, navColumnIndex, Math.min(navCardIndex, Math.max(0, nextIssues.length - 1)));
  }
  /** Home/End — jump straight to the first/last column instead of stepping through with A/D. */
  function moveToEdgeColumn(edge: 'first' | 'last') {
    const swimlane = navSwimlanes[navSwimlaneIndex];
    if (!swimlane) return;
    recordHistory();
    const col = edge === 'first' ? 0 : swimlane.cells.length - 1;
    const nextIssues = swimlane.cells[col]?.issues ?? [];
    focusNavCell(navSwimlaneIndex, col, Math.min(navCardIndex, Math.max(0, nextIssues.length - 1)));
  }
  /** Shift+Tab — swaps focus with wherever it was before the last move, one step of "back". */
  function goBack() {
    if (!previousNavPosition) return;
    const current: [number, number, number] = [navSwimlaneIndex, navColumnIndex, navCardIndex];
    focusNavCell(...previousNavPosition);
    previousNavPosition = current;
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
      announce(
        $t('board.keyboardNav.pickedUp', {
          title: issue.title,
          dropKey: formatKeyLabel($keybinds.pickUpDrop),
          cancelKey: formatKeyLabel($keybinds.cancel),
        }),
      );
    }
  }
  function cancelHold() {
    heldIssueId = null;
    announce($t('board.keyboardNav.cancelled'));
  }

  function toggleInfo() {
    const issue = navSwimlanes[navSwimlaneIndex]?.cells[navColumnIndex]?.issues[navCardIndex];
    infoIssue = issue && infoIssue?.id !== issue.id ? issue : null;
  }

  /** The "info" action on a card, wired via IssueCard's `onSecondary` prop: this fires during
   *  the DOM target phase, before the ancestor keydown handler's own resync below has a chance
   *  to run, so it has to sync nav position itself first (same reasoning as `resyncNavPosition`). */
  function handleCardSecondary(issueId: string) {
    const pos = findNavPosition(issueId);
    if (pos) [navSwimlaneIndex, navColumnIndex, navCardIndex] = pos;
    toggleInfo();
  }

  /** True while the configured pick-up/drop key is held and no other key has been pressed yet —
   *  distinguishes a bare tap (pick up/drop) from the first half of the go-back chord, but only
   *  matters at all when that key is literally Shift (the only key that's also a modifier, and
   *  so the only one that can be ambiguous with a chord). Resolved on keyup: a bare tap commits
   *  pick-up/drop then; a chord already cleared the flag by then. */
  let modifierKeyIsBareTap = false;

  /** Syncs nav position from whichever board element actually has focus — it may have gotten
   *  there via a plain Tab or a mouse click rather than our own WASD movement. Returns false
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
   *  Every action below is driven by `$keybinds` rather than a hardcoded character. */
  function handleBoardKeydown(e: KeyboardEvent) {
    if (!$keyboardNavEnabled) return;
    if (!resyncNavPosition(e.target as HTMLElement)) return;
    const key = e.key.toLowerCase();
    const kb = $keybinds;

    // Only the pick-up/drop key needs the deferred-to-keyup treatment, and only when it's
    // literally bound to Shift — any other key has no chord ambiguity to resolve, so it can fire
    // immediately below like every other action.
    if (kb.pickUpDrop === 'shift') {
      if (key === 'shift') {
        modifierKeyIsBareTap = true;
        return;
      }
      if (e.shiftKey) modifierKeyIsBareTap = false;
    }

    // goBack always requires holding Shift first — see the doc comment above this whole block.
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
    if (key === kb.moveUp) { e.preventDefault(); moveVertical(-1); return; }
    if (key === kb.moveDown) { e.preventDefault(); moveVertical(1); return; }
    if (key === kb.moveLeft) { e.preventDefault(); moveHorizontal(-1); return; }
    if (key === kb.moveRight) { e.preventDefault(); moveHorizontal(1); return; }
    if (key === kb.prevSwimlane) { e.preventDefault(); moveSwimlane(-1); return; }
    if (key === kb.nextSwimlane) { e.preventDefault(); moveSwimlane(1); return; }
    if (key === kb.firstColumn) { e.preventDefault(); moveToEdgeColumn('first'); return; }
    if (key === kb.lastColumn) { e.preventDefault(); moveToEdgeColumn('last'); return; }
    // showHint is handled globally (see handleGlobalKeydown below), not here — it needs to work
    // even before any card has ever been focused, which this handler can't see at all (it only
    // fires when the keydown bubbles up through a focused card or empty-cell placeholder).
    if (key === kb.cancel) {
      if (infoIssue) { e.preventDefault(); infoIssue = null; }
      if (heldIssueId) { e.preventDefault(); cancelHold(); }
      return;
    }
    // openDetails and info are left alone here on a card — they fall through to IssueCard's own
    // handler (wired via its `openKey`/`secondaryKey` props below) so there's exactly one place
    // deciding which of the two a given key means; only the empty-cell placeholder needs info
    // handled here, since it has no card-level handler at all.
    if (key === kb.info && !(e.target as HTMLElement).classList.contains('card')) {
      e.preventDefault();
      toggleInfo();
    }
  }

  /** Commits the pick-up/drop toggle — only on keyup, and only for a bare tap (see
   *  `modifierKeyIsBareTap`), so holding Shift as part of the go-back chord doesn't also toggle
   *  it. Only relevant when the pick-up/drop key is Shift; any other key just fires on keydown
   *  above and this listener has nothing to do. */
  function handleBoardKeyup(e: KeyboardEvent) {
    if (!$keyboardNavEnabled || $keybinds.pickUpDrop !== 'shift' || e.key !== 'Shift') return;
    const wasBareTap = modifierKeyIsBareTap;
    modifierKeyIsBareTap = false;
    if (!wasBareTap || !resyncNavPosition(e.target as HTMLElement)) return;
    e.preventDefault();
    toggleHold();
  }

  /** Window-level, unlike everything else above: showHint has to work the moment keyboard nav
   *  is turned on, even before the user has ever clicked or tabbed to a card — which the
   *  board-scoped handlers above can never see, since a keydown fired while nothing inside the
   *  board has focus never bubbles through it at all. Skips text inputs so it doesn't hijack
   *  typing a literal "?" (or whatever it's rebound to) into the search box or elsewhere. */
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
  // Same swimlane order/gating as the markup below — one source of truth so the WASD nav grid
  // never drifts from what's actually rendered.
  $: navSwimlanes = [
    ...(ungroupedIssues.length > 0 || epics.length === 0
      ? [{ cells: columns.map((col) => ({ statusIds: col.statusIds, issues: issuesInColumn(ungroupedIssues, col.statusIds) })) }]
      : []),
    ...epics.map((epic) => ({
      cells: columns.map((col) => ({ statusIds: col.statusIds, issues: issuesInColumn(issuesForEpic(trackedIssues, epic.id), col.statusIds) })),
    })),
  ] satisfies NavSwimlane[];
  $: noEpicLaneOffset = ungroupedIssues.length > 0 || epics.length === 0 ? 1 : 0;
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
      <p>{$t('board.keyboardNav.hintShort', { key: formatKeyLabel($keybinds.showHint) })}</p>
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
<div class="board-wrap" on:keydown={handleBoardKeydown} on:keyup={handleBoardKeyup}>
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
              class:nav-cell={$keyboardNavEnabled && cellIssues.length === 0}
              tabindex={$keyboardNavEnabled && cellIssues.length === 0 ? -1 : undefined}
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
                        openKey={$keyboardNavEnabled ? $keybinds.openDetails : 'enter'}
                        secondaryKey={$keyboardNavEnabled ? $keybinds.info : undefined}
                        onSecondary={$keyboardNavEnabled ? () => handleCardSecondary(issue.id) : undefined}
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
              class:nav-cell={$keyboardNavEnabled && cellIssues.length === 0}
              tabindex={$keyboardNavEnabled && cellIssues.length === 0 ? -1 : undefined}
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
                        openKey={$keyboardNavEnabled ? $keybinds.openDetails : 'enter'}
                        secondaryKey={$keyboardNavEnabled ? $keybinds.info : undefined}
                        onSecondary={$keyboardNavEnabled ? () => handleCardSecondary(issue.id) : undefined}
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

{#if infoIssue && infoRect}
  <div class="info-popover" role="dialog" aria-label={infoIssue.title} style="top:{infoRect.bottom + 6}px; left:{infoRect.left}px">
    <div class="info-popover-title">{infoIssue.title}</div>
    <div class="info-popover-row">
      <span class="info-popover-label">{$t('board.keyboardNav.infoColumn')}</span>
      <span>{columns.find((c) => c.statusIds.includes((infoIssue as Issue).statusId))?.name ?? ''}</span>
    </div>
    {#if infoIssue.dueDate}
      <div class="info-popover-row">
        <span class="info-popover-label">{$t('board.keyboardNav.infoDueDate')}</span>
        <span>{infoIssue.dueDate}</span>
      </div>
    {/if}
    <div class="info-popover-row">
      <span class="info-popover-label">{$t('board.keyboardNav.infoAssignees')}</span>
      <span>{infoAssignees.length ? infoAssignees.join(', ') : $t('board.keyboardNav.infoNone')}</span>
    </div>
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
  @media (max-width: 640px) {
    .legend { grid-template-columns: 1fr; }
  }
  .board-wrap { flex: 1; overflow: auto; padding: 16px 20px 28px; min-width: 0; }
  .board-inner { min-width: 880px; }
  .board-head {
    display: grid; grid-template-columns: repeat(4, minmax(200px, 1fr)); gap: 14px;
    position: sticky; top: 0; background: var(--bg); z-index: 5; padding-bottom: 10px;
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
  /* Empty cells only become focusable (tabindex="-1", see the markup above) once keyboard
     navigation is on, so WASD can still land a held card on a column with nothing in it yet. */
  .cell.nav-cell:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; background: var(--accent-soft); }
  .cell-empty { display: flex; align-items: center; justify-content: center; color: var(--text-3); font-size: 11.5px; min-height: 40px; border: 1px dashed var(--border); border-radius: 8px; }
  .cell-label { display: none; }
  .info-popover {
    position: fixed; z-index: 20; width: 240px; background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; box-shadow: var(--shadow-lg); padding: 12px; display: flex; flex-direction: column; gap: 8px;
  }
  .info-popover-title { font-size: 13px; font-weight: 700; color: var(--text); }
  .info-popover-row { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; }
  .info-popover-label { color: var(--text-3); }
  .info-popover-close { align-self: flex-end; font-size: 12px; color: var(--accent); padding: 2px 4px; }

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
