<script lang="ts">
  import Icon from './Icon.svelte';
  import IssueCard from './IssueCard.svelte';
  import SearchFilterBar from './SearchFilterBar.svelte';
  import { board, completeSprint, createSprint, featureFlags, issueTypes, issuesStore, moveIssueToStatus, selectedIssueId, sprints, startSprint, statusCategories, workflow } from '../stores/workspace';
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
</script>

<SearchFilterBar />
<div class="backlog">
  {#each orderedSprints as sprint (sprint.id)}
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
      <div class="issue-list">
        {#each sprintIssues as issue (issue.id)}
          <IssueCard
          {issue}
          selected={issue.id === $selectedIssueId}
          onSelect={selectIssue}
          {doneStatusIds}
          columns={mobileMoveColumns}
          onMove={moveIssue}
          moveMenuMode="sheet"
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
    <div class="issue-list">
      {#each backlogIssues as issue (issue.id)}
        <IssueCard
          {issue}
          selected={issue.id === $selectedIssueId}
          onSelect={selectIssue}
          {doneStatusIds}
          columns={mobileMoveColumns}
          onMove={moveIssue}
          moveMenuMode="sheet"
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
