<script lang="ts">
  import { onMount } from 'svelte';
  import type { Issue } from '$domain';
  import IssueCard from './IssueCard.svelte';
  import { fetchAssignedToMe } from '../api';
  import { currentProjectId, currentView, selectedIssueId, statusCategories, switchProject, workflow } from '../stores/workspace';
  import { t } from '../i18n';

  let issues: Issue[] = [];
  let loaded = false;

  onMount(async () => {
    issues = await fetchAssignedToMe();
    loaded = true;
  });

  $: doneStatusIds = new Set(
    ($workflow?.statuses ?? [])
      .filter((s) => $statusCategories.find((c) => c.id === s.categoryId)?.type === 'done')
      .map((s) => s.id),
  );

  /** Same "switch project if needed, then select the issue" logic as NotificationBell.svelte's openNotification — issues here can belong to any project, not just the currently-selected one. */
  async function openIssue(issueId: string) {
    const issue = issues.find((i) => i.id === issueId);
    if (!issue) return;
    if (issue.projectId !== $currentProjectId) await switchProject(issue.projectId);
    $currentView = 'board';
    $selectedIssueId = issue.id;
  }
</script>

<div class="my-issues-view">
  <div class="header">
    <h1>{$t('myIssues.title')}</h1>
  </div>

  {#if !loaded}
    <p class="empty">{$t('myIssues.loading')}</p>
  {:else if issues.length === 0}
    <p class="empty">{$t('myIssues.empty')}</p>
  {:else}
    <div class="list">
      {#each issues as issue (issue.id)}
        <IssueCard {issue} selected={issue.id === $selectedIssueId} onSelect={openIssue} {doneStatusIds} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .my-issues-view { flex: 1; overflow-y: auto; padding: 28px 32px; max-width: 720px; }
  .header { margin-bottom: 22px; }
  h1 { font-size: 19px; font-weight: 700; color: var(--text); margin: 0; }
  .list { display: flex; flex-direction: column; gap: 8px; }
  .empty { font-size: 12.5px; color: var(--text-3); margin: 0; }

  @media (max-width: 767px) {
    .my-issues-view { padding: 16px; }
  }
</style>
