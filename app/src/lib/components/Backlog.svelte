<script lang="ts">
  import Icon from './Icon.svelte';
  import IssueCard from './IssueCard.svelte';
  import { completeSprint, createSprint, issueTypes, issuesStore, selectedIssueId, sprints, startSprint, statusCategories, workflow } from '../stores/workspace';

  let newSprintName = '';
  let creating = false;

  $: epicTypeId = $issueTypes.find((t) => t.name === 'Epic')?.id;
  $: trackedIssues = $issuesStore.filter((i) => i.issueTypeId !== epicTypeId);
  $: doneStatusIds = new Set(
    ($workflow?.statuses ?? [])
      .filter((s) => $statusCategories.find((c) => c.id === s.categoryId)?.type === 'done')
      .map((s) => s.id),
  );
  $: backlogIssues = trackedIssues.filter((i) => !i.sprintId);
  $: orderedSprints = [...$sprints].sort((a, b) => (a.state === 'active' ? -1 : b.state === 'active' ? 1 : 0));

  function selectIssue(id: string) {
    $selectedIssueId = id;
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
</script>

<div class="backlog">
  {#each orderedSprints as sprint (sprint.id)}
    {@const sprintIssues = trackedIssues.filter((i) => i.sprintId === sprint.id)}
    {@const points = sprintIssues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0)}
    {@const donePoints = sprintIssues.filter((i) => doneStatusIds.has(i.statusId)).reduce((sum, i) => sum + (i.storyPoints ?? 0), 0)}
    <section class="sprint-block">
      <div class="sprint-head">
        <span class="sprint-name">{sprint.name}</span>
        <span class="sprint-state" class:active={sprint.state === 'active'} class:closed={sprint.state === 'closed'}>{sprint.state}</span>
        {#if sprint.goal}<span class="sprint-goal">{sprint.goal}</span>{/if}
        <span class="sprint-spacer"></span>
        <span class="sprint-points mono">{donePoints}/{points} pts</span>
        {#if sprint.state === 'future'}
          <button class="btn" on:click={() => startSprint(sprint.id)}>Start sprint</button>
        {:else if sprint.state === 'active'}
          <button class="btn" on:click={() => completeSprint(sprint.id)}>Complete sprint</button>
        {/if}
      </div>
      <div class="issue-list">
        {#each sprintIssues as issue (issue.id)}
          <IssueCard {issue} selected={issue.id === $selectedIssueId} onSelect={selectIssue} {doneStatusIds} />
        {:else}
          <div class="empty">No issues in this sprint yet.</div>
        {/each}
      </div>
    </section>
  {/each}

  <section class="sprint-block">
    <div class="sprint-head">
      <span class="sprint-name">Backlog</span>
      <span class="sprint-spacer"></span>
      <span class="sprint-points mono">{backlogIssues.length} issues</span>
    </div>
    <div class="issue-list">
      {#each backlogIssues as issue (issue.id)}
        <IssueCard {issue} selected={issue.id === $selectedIssueId} onSelect={selectIssue} {doneStatusIds} />
      {:else}
        <div class="empty">Nothing unscheduled — everything's in a sprint.</div>
      {/each}
    </div>
  </section>

  <form class="new-sprint" on:submit|preventDefault={submitNewSprint}>
    <Icon name="plus" size={13} />
    <input type="text" placeholder="New sprint name…" bind:value={newSprintName} />
    <button type="submit" disabled={!newSprintName.trim() || creating}>Create sprint</button>
  </form>
</div>

<style>
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
  .new-sprint input { flex: 1; font: inherit; font-size: 12.5px; color: var(--text); background: none; border: none; outline: none; }
  .new-sprint button { font-size: 12px; font-weight: 600; color: var(--accent-strong); background: var(--accent-soft); padding: 6px 10px; border-radius: 6px; }
  .new-sprint button:disabled { opacity: .5; }
</style>
