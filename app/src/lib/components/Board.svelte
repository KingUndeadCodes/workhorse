<script lang="ts">
  import type { Issue } from '$domain';
  import IssueCard from './IssueCard.svelte';
  import { board, issueTypes, issuesStore, moveIssueToStatus, selectedIssueId, statusCategories, workflow } from '../stores/workspace';

  /** Cell key currently under the drag cursor, for the drop-target highlight. */
  let dragOverCell: string | null = null;

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
  $: trackedIssues = allIssues.filter((i) => i.issueTypeId !== epicTypeId);
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
</script>

<div class="board-wrap">
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

    {#if ungroupedIssues.length > 0}
      <div class="swimlane">
        <div class="swimlane-head">
          <span class="epic-dot" style="background:var(--text-3)"></span>
          <span class="epic-name">No Epic</span>
        </div>
        <div class="swimlane-body">
          {#each columns as col}
            {@const cellIssues = issuesInColumn(ungroupedIssues, col.statusIds)}
            {@const key = cellKey('no-epic', col.id)}
            <div
              class="cell"
              role="list"
              aria-label="{col.name} — No Epic"
              class:drag-over={dragOverCell === key}
              on:dragover={(e) => { e.preventDefault(); dragOverCell = key; }}
              on:dragleave={() => (dragOverCell = null)}
              on:drop={(e) => handleDrop(e, col.statusIds)}
            >
              {#if cellIssues.length === 0}
                <div class="cell-empty">No issues</div>
              {:else}
                {#each cellIssues as issue (issue.id)}
                  <IssueCard {issue} selected={issue.id === $selectedIssueId} onSelect={selectIssue} {doneStatusIds} />
                {/each}
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#each epics as epic}
      {@const epicIssues = issuesForEpic(allIssues, epic.id)}
      {@const doneCount = epicIssues.filter((i) => doneStatusIds.has(i.statusId)).length}
      {@const total = epicIssues.length}
      <div class="swimlane">
        <div class="swimlane-head">
          <span class="epic-dot" style="background:{colorForEpic(epic.id)}"></span>
          <span class="epic-name">{epic.title}</span>
          <div class="epic-bar"><span style="width:{total ? (doneCount / total) * 100 : 0}%;background:{colorForEpic(epic.id)}"></span></div>
          <span class="epic-progress mono">{doneCount}/{total}</span>
        </div>
        <div class="swimlane-body">
          {#each columns as col}
            {@const cellIssues = issuesInColumn(epicIssues, col.statusIds)}
            {@const key = cellKey(epic.id, col.id)}
            <div
              class="cell"
              role="list"
              aria-label="{col.name} — {epic.title}"
              class:drag-over={dragOverCell === key}
              on:dragover={(e) => { e.preventDefault(); dragOverCell = key; }}
              on:dragleave={() => (dragOverCell = null)}
              on:drop={(e) => handleDrop(e, col.statusIds)}
            >
              {#if cellIssues.length === 0}
                <div class="cell-empty">No issues</div>
              {:else}
                {#each cellIssues as issue (issue.id)}
                  <IssueCard {issue} selected={issue.id === $selectedIssueId} onSelect={selectIssue} {doneStatusIds} />
                {/each}
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
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
  .cell.drag-over { background: var(--accent-soft); outline: 2px dashed var(--accent); outline-offset: -2px; }
  .cell-empty { display: flex; align-items: center; justify-content: center; color: var(--text-3); font-size: 11.5px; min-height: 40px; border: 1px dashed var(--border); border-radius: 8px; }
</style>
