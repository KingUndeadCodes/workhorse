<script lang="ts">
  import type { Issue } from '$domain';
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import { issueTypes, users, labels } from '../stores/workspace';
  import { displayName, priorityIcon, typeIcon } from '../util';

  export let issue: Issue;
  export let selected = false;
  /** Called with the issue's id when the card is clicked. */
  export let onSelect: (id: string) => void;
  /** Status ids whose category is 'done' — used so overdue styling doesn't apply to finished work. */
  export let doneStatusIds: Set<string> = new Set();

  const TODAY = '2026-08-07';

  $: issueType = $issueTypes.find((t) => t.id === issue.issueTypeId);
  $: assignees = issue.assigneeIds.map((id) => $users.find((u) => u.id === id)).filter((u): u is (typeof $users)[number] => !!u);
  $: attachedAgents = Object.keys(issue.agentAssignments ?? {})
    .map((id) => $users.find((u) => u.id === id))
    .filter((u): u is (typeof $users)[number] => !!u);
  $: isOverdue = !!issue.dueDate && issue.dueDate < TODAY && !doneStatusIds.has(issue.statusId);
  $: isDueToday = issue.dueDate === TODAY;

  /** Stashes the issue id in the drag payload so the drop target (Board.svelte) can read it. */
  function handleDragStart(e: DragEvent) {
    e.dataTransfer?.setData('text/issue-id', issue.id);
  }
</script>

<button
  class="card"
  class:selected
  draggable="true"
  on:dragstart={handleDragStart}
  on:click={() => onSelect(issue.id)}
>
  <div class="top">
    <div class="key-type">
      <span class="type-icon" class:bug={issueType?.name === 'Bug'} class:task={issueType?.name === 'Task'}>
        <Icon name={typeIcon(issueType?.name ?? 'Story')} size={9} />
      </span>
      <span class="key mono">{issue.key}</span>
    </div>
    <span class="priority-flag {issue.priority}"><Icon name={priorityIcon(issue.priority)} size={11} /></span>
  </div>

  <div class="title">{issue.title}</div>

  {#if issue.labelIds.length}
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
      {#if isOverdue}
        <span class="due-chip overdue mono">OVERDUE</span>
      {:else if isDueToday}
        <span class="due-chip overdue mono">TODAY</span>
      {/if}
    </div>
    <div class="bottom-right">
      {#if issue.storyPoints}
        <span class="points-badge mono">{issue.storyPoints}</span>
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
</button>

<style>
  .card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 9px; padding: 10px 11px 9px;
    cursor: pointer; text-align: left; width: 100%; display: flex; flex-direction: column; gap: 7px;
    transition: box-shadow .12s ease, border-color .12s ease, transform .12s ease;
  }
  .card:hover { box-shadow: var(--shadow); border-color: var(--border-strong); transform: translateY(-1px); }
  .card.selected { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft), var(--shadow); }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
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
    width: 19px; height: 19px; border-radius: 50%; background: var(--surface-2); border: 1px solid var(--border);
    display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: var(--text-2);
  }
  .due-chip { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 5px; }
  .due-chip.overdue { background: var(--critical-soft); color: var(--critical); }
  .assignee-stack { display: flex; }
  .assignee-stack :global(> *) { margin-left: -6px; border-radius: 50%; box-shadow: 0 0 0 2px var(--surface); }
  .assignee-stack :global(> *:first-child) { margin-left: 0; }
  .agent-stack { margin-right: 2px; }
</style>
