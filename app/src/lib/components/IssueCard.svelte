<script lang="ts">
  import type { Issue } from '$domain';
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import { issueTypes, users, labels, featureFlags } from '../stores/workspace';
  import { displayName, priorityIcon, storyPointColor, typeIcon } from '../util';

  export let issue: Issue;
  export let selected = false;
  /** Called with the issue's id when the card is clicked. */
  export let onSelect: (id: string) => void;
  /** Status ids whose category is 'done' — used so overdue styling doesn't apply to finished work. */
  export let doneStatusIds: Set<string> = new Set();
  /**
   * The board's columns, for the tap-to-move control — only rendered (via CSS, see
   * `.move-trigger`'s media query) below the same width Board.svelte's own drag-and-drop
   * columns collapse into a single stack. Native HTML5 drag-and-drop (this card's `draggable`
   * below) never fires from a touch gesture on any mobile browser, so past that width dragging
   * a card between statuses is simply impossible — this is the replacement interaction, not a
   * bonus one.
   */
  export let columns: { id: string; name: string; statusIds: string[] }[] = [];
  export let onMove: ((issueId: string, statusIds: string[]) => void) | undefined = undefined;

  let showMoveMenu = false;

  const DAY_MS = 24 * 60 * 60 * 1000;

  $: issueType = $issueTypes.find((t) => t.id === issue.issueTypeId);
  $: assignees = issue.assigneeIds.map((id) => $users.find((u) => u.id === id)).filter((u): u is (typeof $users)[number] => !!u);
  $: attachedAgents = (issue.agentAssignments ?? [])
    .map((id) => $users.find((u) => u.id === id))
    .filter((u): u is (typeof $users)[number] => !!u);
  // Due dates have no time of day, so "due" means by the end of that day — gives real
  // sub-day precision for "due soon" instead of just comparing whole-date strings.
  $: dueTimestamp = issue.dueDate ? new Date(`${issue.dueDate}T23:59:59`).getTime() : null;
  $: isOverdue = dueTimestamp !== null && dueTimestamp < Date.now() && !doneStatusIds.has(issue.statusId);
  $: isDueSoon = !isOverdue && dueTimestamp !== null && dueTimestamp - Date.now() < DAY_MS && !doneStatusIds.has(issue.statusId);

  /** Stashes the issue id in the drag payload so the drop target (Board.svelte) can read it. */
  function handleDragStart(e: DragEvent) {
    e.dataTransfer?.setData('text/issue-id', issue.id);
  }

  function toggleMoveMenu(e: MouseEvent) {
    e.stopPropagation();
    showMoveMenu = !showMoveMenu;
  }
  function moveTo(statusIds: string[]) {
    showMoveMenu = false;
    onMove?.(issue.id, statusIds);
  }
  /** Svelte action: closes the move popover on any click outside it. */
  function closeOnClickOutside(node: HTMLElement) {
    function handleClick(event: MouseEvent) {
      if (!node.contains(event.target as Node)) showMoveMenu = false;
    }
    document.addEventListener('click', handleClick, true);
    return { destroy: () => document.removeEventListener('click', handleClick, true) };
  }
</script>

<div
  class="card"
  class:selected
  role="button"
  tabindex="0"
  draggable="true"
  on:dragstart={handleDragStart}
  on:click={() => onSelect(issue.id)}
  on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(issue.id)}
>
  <div class="top">
    <div class="key-type">
      <span class="type-icon" class:bug={issueType?.name === 'Bug'} class:task={issueType?.name === 'Task'}>
        <Icon name={typeIcon(issueType?.name ?? 'Story')} size={9} />
      </span>
      <span class="key mono">{issue.key}</span>
    </div>
    <div class="top-right">
      {#if $featureFlags.priority}
        <span class="priority-flag {issue.priority}"><Icon name={priorityIcon(issue.priority)} size={11} /></span>
      {/if}
      {#if onMove && columns.length > 1}
        <div class="move-wrap" use:closeOnClickOutside>
          <button class="move-trigger" title="Move to…" on:click={toggleMoveMenu}><Icon name="chevron" size={10} /></button>
          {#if showMoveMenu}
            <div class="move-menu">
              {#each columns as col (col.id)}
                {#if !col.statusIds.includes(issue.statusId)}
                  <button class="move-menu-item" on:click|stopPropagation={() => moveTo(col.statusIds)}>{col.name}</button>
                {/if}
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <div class="title">{issue.title}</div>

  {#if $featureFlags.labels && issue.labelIds.length}
    <div class="labels">
      {#each issue.labelIds as lid (lid)}
        {@const l = $labels.find((lb) => lb.id === lid)}
        {#if l}
          <span class="label-pill"><span class="ldot" style="background:{l.color}"></span>{l.name}</span>
        {/if}
      {/each}
    </div>
  {/if}

  <div class="bottom">
    <div class="bottom-left">
      {#if $featureFlags.dueDates && isOverdue}
        <span class="due-chip overdue mono">OVERDUE</span>
      {:else if $featureFlags.dueDates && isDueSoon}
        <span class="due-chip due-soon mono">DUE SOON</span>
      {/if}
    </div>
    <div class="bottom-right">
      {#if $featureFlags.storyPoints && issue.storyPoints}
        <span class="points-badge mono" style="background:{storyPointColor(issue.storyPoints).bg};color:{storyPointColor(issue.storyPoints).text}">{issue.storyPoints}</span>
      {/if}
      {#if attachedAgents.length}
        <div class="assignee-stack agent-stack">
          {#each attachedAgents as a (a.id)}
            <Avatar userId={a.id} name={displayName(a)} kind={a.kind} size={17} />
          {/each}
        </div>
      {/if}
      {#if assignees.length}
        <div class="assignee-stack">
          {#each assignees as a (a.id)}
            <Avatar userId={a.id} name={displayName(a)} avatarUrl={a.avatarUrl} kind={a.kind} size={19} />
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 9px; padding: 10px 11px 9px;
    cursor: pointer; text-align: left; width: 100%; display: flex; flex-direction: column; gap: 7px;
    transition: box-shadow .12s ease, border-color .12s ease, transform .12s ease;
  }
  .card:hover { box-shadow: var(--shadow); border-color: var(--border-strong); transform: translateY(-1px); }
  .card:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--accent); }
  .card.selected { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft), var(--shadow); }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .top-right { display: flex; align-items: center; gap: 4px; }
  /* Tap-to-move menu — the mobile replacement for drag-and-drop (native HTML5 DnD, used by the
     column drop targets in Board.svelte, never fires from touch). Hidden by default so it
     doesn't clutter the card anywhere drag-and-drop already works; shown only at the same width
     Board.svelte's own columns stop being side-by-side and drag becomes the only way to move a
     card — right when that stops being viable on a touchscreen. */
  .move-wrap { position: relative; display: none; }
  .move-trigger { color: var(--text-3); padding: 3px; border-radius: 5px; transform: rotate(90deg); }
  .move-trigger:hover { background: var(--surface-2); color: var(--text-2); }
  .move-menu {
    position: absolute; top: calc(100% + 4px); right: 0; z-index: 10; min-width: 130px;
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px; box-shadow: var(--shadow-lg);
    padding: 4px; display: flex; flex-direction: column; gap: 1px;
  }
  .move-menu-item { padding: 6px 8px; border-radius: 5px; font-size: 12px; color: var(--text-2); text-align: left; }
  .move-menu-item:hover { background: var(--surface-2); color: var(--text); }
  @media (max-width: 640px) {
    .move-wrap { display: block; }
    /* The move-trigger is a real tap target here (drag-and-drop doesn't work below this width
       at all — see the doc comment on `columns`/`onMove` above), so it gets a proper ~36px hit
       area instead of the icon-sized hover target that was fine for a mouse. */
    .move-trigger { padding: 8px; margin: -8px -6px -8px 0; }
    .card { padding: 13px 13px 12px; gap: 9px; }
    .title { font-size: 13.5px; }
    .key { font-size: 11.5px; }
  }
  .key-type { display: flex; align-items: center; gap: 6px; }
  .type-icon { width: 14px; height: 14px; flex: 0 0 14px; border-radius: 3px; display: flex; align-items: center; justify-content: center; background: var(--success-soft); color: var(--success); }
  .type-icon.bug { background: var(--critical-soft); color: var(--critical); }
  .type-icon.task { background: var(--info-soft); color: var(--info); }
  .key { font-size: 11px; color: var(--text-3); font-weight: 500; }
  .priority-flag { display: flex; align-items: center; }
  .priority-flag.highest { color: var(--critical); }
  .priority-flag.high { color: var(--warning); }
  .priority-flag.medium { color: var(--info); }
  .priority-flag.low, .priority-flag.lowest { color: var(--text-3); }
  .title { font-size: 12.5px; font-weight: 500; color: var(--text); line-height: 1.4; }
  .labels { display: flex; gap: 5px; flex-wrap: wrap; }
  .label-pill { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 5px; color: var(--text-2); background: var(--surface-2); border: 1px solid var(--border); }
  .ldot { width: 6px; height: 6px; border-radius: 2px; }
  .bottom { display: flex; align-items: center; justify-content: space-between; margin-top: 2px; }
  .bottom-left { display: flex; align-items: center; gap: 9px; color: var(--text-3); }
  .bottom-right { display: flex; align-items: center; gap: 6px; }
  .points-badge {
    width: 19px; height: 19px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700;
  }
  .due-chip { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 5px; }
  .due-chip.overdue { background: var(--critical-soft); color: var(--critical); }
  .due-chip.due-soon { background: var(--warning-soft); color: var(--warning); }
  .assignee-stack { display: flex; }
  .assignee-stack :global(> *) { margin-left: -6px; border-radius: 50%; box-shadow: 0 0 0 2px var(--surface); }
  .assignee-stack :global(> *:first-child) { margin-left: 0; }
  .agent-stack { margin-right: 2px; }
</style>
