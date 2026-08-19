<script lang="ts">
  /**
   * Mobile-only alternative to Board.svelte's swimlane grid. Board.svelte lays epics out as
   * rows and statuses as columns in a 2D CSS grid, moved between with native HTML5
   * drag-and-drop — neither survives a narrow viewport: a 2D grid needs both horizontal and
   * vertical scroll to navigate, and drag-and-drop never fires from a touch gesture at all (see
   * IssueCard.svelte's `columns`/`onMove` doc comment). This instead stacks one section per
   * status (in workflow order), each holding its issues sub-grouped by epic — a single
   * vertical scroll covers the whole board, and moving an issue is a tap on its card's move
   * trigger, which opens IssueCard's `moveMenuMode="sheet"` bottom sheet instead of dragging.
   *
   * Shares Board.svelte's exact data sources (`board`, `issuesStore`, `workflow`,
   * `statusCategories`, `issueTypes`, `moveIssueToStatus`, `selectedIssueId`) — no separate
   * fetching or store logic, only a different presentation of the same state. Rendered by
   * App.svelte in place of Board.svelte when `$isMobile` is true.
   */
  import type { Issue } from '$domain';
  import IssueCard from './IssueCard.svelte';
  import { board, issueTypes, issuesStore, moveIssueToStatus, selectedIssueId, statusCategories, workflow } from '../stores/workspace';
  import { t } from '../i18n';

  /** Same curated epic colors as Board.svelte's swimlane headers, kept in sync by eye — there's no shared source for this display-only mapping. */
  const epicColors: Record<string, string> = {
    epic_checkout: 'var(--epic-a)',
    epic_fraud: 'var(--epic-b)',
    epic_platform: 'var(--epic-c)',
  };
  function colorForEpic(epicId: string): string {
    return epicColors[epicId] ?? 'var(--accent)';
  }

  function issuesInColumn(all: Issue[], statusIds: string[]): Issue[] {
    return all.filter((i) => statusIds.includes(i.statusId));
  }

  function selectIssue(id: string) {
    $selectedIssueId = id;
  }

  $: allIssues = $issuesStore;
  $: epicTypeId = $issueTypes.find((it) => it.name === 'Epic')?.id;
  $: epics = allIssues.filter((i) => i.issueTypeId === epicTypeId);
  $: epicIds = new Set(epics.map((e) => e.id));
  $: trackedIssues = allIssues.filter((i) => i.issueTypeId !== epicTypeId);
  $: columns = $board?.columns ?? [];
  $: doneStatusIds = new Set(
    ($workflow?.statuses ?? [])
      .filter((s) => $statusCategories.find((c) => c.id === s.categoryId)?.type === 'done')
      .map((s) => s.id),
  );

  interface EpicGroup {
    key: string;
    name: string;
    color: string;
    issues: Issue[];
  }

  /**
   * Groups one status column's issues by epic — "No Epic" first (mirrors Board.svelte's
   * swimlane order), then the rest in `epics`' own order. Unlike Board.svelte's grid, a group
   * with zero issues in this particular column is simply omitted rather than rendered empty —
   * there's no shared row/column alignment to preserve here, only a flat vertical list.
   *
   * Takes `issues`/`allEpics`/`allEpicIds` as parameters rather than reading the component's
   * `trackedIssues`/`epics`/`epicIds` via closure — Svelte's each-block dependency tracking is
   * syntactic: it only re-runs a `{@const}` when a variable *referenced directly in that
   * template expression* changes, not variables a called function happens to close over. Reading
   * them through a closure compiled clean but silently never re-ran this on a store update — a
   * moved issue's PATCH would succeed while the board kept showing the old column layout until
   * something else forced a remount (e.g. navigating away and back).
   */
  function epicGroupsForColumn(issues: Issue[], allEpics: Issue[], allEpicIds: Set<string>, colStatusIds: string[]): EpicGroup[] {
    const colIssues = issuesInColumn(issues, colStatusIds);
    const groups: EpicGroup[] = [];
    const ungrouped = colIssues.filter((i) => !i.parentId || !allEpicIds.has(i.parentId));
    if (ungrouped.length) groups.push({ key: 'no-epic', name: $t('board.noEpic'), color: 'var(--text-3)', issues: ungrouped });
    for (const epic of allEpics) {
      const epicIssues = colIssues.filter((i) => i.parentId === epic.id);
      if (epicIssues.length) groups.push({ key: epic.id, name: epic.title, color: colorForEpic(epic.id), issues: epicIssues });
    }
    return groups;
  }
</script>

<div class="mobile-board">
  {#each columns as col, i}
    {@const groups = epicGroupsForColumn(trackedIssues, epics, epicIds, col.statusIds)}
    {@const count = groups.reduce((n, g) => n + g.issues.length, 0)}
    <section class="status-section">
      <div class="status-head">
        <span class="status-dot" class:todo={i === 0} class:progress={i === 1} class:review={i === 2} class:done={i === 3}></span>
        <span class="status-name">{col.name}</span>
        <span class="status-count">{count}</span>
      </div>
      {#if groups.length === 0}
        <div class="status-empty">{$t('board.noIssues')}</div>
      {:else}
        {#each groups as group (group.key)}
          <div class="epic-subhead">
            <span class="epic-dot" style="background:{group.color}"></span>
            <span class="epic-name">{group.name}</span>
          </div>
          {#each group.issues as issue (issue.id)}
            <div class="card-wrap">
              <IssueCard
                {issue}
                selected={issue.id === $selectedIssueId}
                onSelect={selectIssue}
                {doneStatusIds}
                {columns}
                moveMenuMode="sheet"
                onMove={(issueId, statusIds) => statusIds[0] && moveIssueToStatus(issueId, statusIds[0])}
              />
            </div>
          {/each}
        {/each}
      {/if}
    </section>
  {/each}
</div>

<style>
  .mobile-board { flex: 1; overflow-y: auto; padding: 12px 12px 24px; display: flex; flex-direction: column; gap: 4px; }
  .status-section { margin-bottom: 10px; }
  .status-head {
    display: flex; align-items: center; gap: 8px; padding: 8px 4px;
    position: sticky; top: 0; background: var(--bg); z-index: 5;
  }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-3); flex: 0 0 auto; }
  .status-dot.progress { background: var(--info); }
  .status-dot.review { background: var(--warning); }
  .status-dot.done { background: var(--success); }
  .status-name { font-size: 12.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-2); }
  .status-count { font-size: 11.5px; color: var(--text-3); margin-left: auto; }
  .status-empty {
    display: flex; align-items: center; justify-content: center; color: var(--text-3); font-size: 12px;
    min-height: 44px; border: 1px dashed var(--border); border-radius: 8px; margin: 0 4px;
  }
  .epic-subhead { display: flex; align-items: center; gap: 8px; padding: 10px 6px 6px; }
  .epic-dot { width: 8px; height: 8px; border-radius: 3px; flex: 0 0 8px; }
  .epic-name { font-size: 12px; font-weight: 700; color: var(--text-2); }
  .card-wrap { padding: 0 4px 10px; }
</style>
