<script lang="ts">
  import { createIssue, issueTypes, users } from '../stores/workspace';
  import { splitHumansAndAgents } from '../util';

  export let onClose: () => void;

  let title = '';
  let issueTypeId = '';
  let priority: 'highest' | 'high' | 'medium' | 'low' | 'lowest' = 'medium';
  let assigneeIds: string[] = [];
  let submitting = false;
  let error = '';

  $: if (!issueTypeId && $issueTypes.length) issueTypeId = $issueTypes.find((t) => t.name === 'Story')?.id ?? $issueTypes[0].id;
  // Agents can't be assignees — see IssueDrawer's "AI Agents" section, added after creation.
  $: ({ humans: humanUsers } = splitHumansAndAgents($users));

  function toggleAssignee(userId: string) {
    assigneeIds = assigneeIds.includes(userId) ? assigneeIds.filter((id) => id !== userId) : [...assigneeIds, userId];
  }

  async function submit() {
    if (!title.trim() || !issueTypeId || submitting) return;
    submitting = true;
    error = '';
    try {
      await createIssue({ title: title.trim(), issueTypeId, priority, assigneeIds });
      onClose();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to create issue';
    } finally {
      submitting = false;
    }
  }
</script>

<div
  class="backdrop"
  role="button"
  tabindex="0"
  on:click={onClose}
  on:keydown={(e) => e.key === 'Escape' && onClose()}
>
  <div class="modal" on:click|stopPropagation on:keydown|stopPropagation role="dialog" aria-modal="true" aria-label="Create issue" tabindex="-1">
    <h2 class="modal-title">New issue</h2>
    <form on:submit|preventDefault={submit}>
      <label class="field">
        <span>Title</span>
        <input type="text" bind:value={title} placeholder="What needs to be done?" />
      </label>
      <div class="row">
        <label class="field">
          <span>Type</span>
          <select bind:value={issueTypeId}>
            {#each $issueTypes.filter((t) => t.name !== 'Epic') as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
          </select>
        </label>
        <label class="field">
          <span>Priority</span>
          <select bind:value={priority}>
            {#each ['highest', 'high', 'medium', 'low', 'lowest'] as p}<option value={p}>{p}</option>{/each}
          </select>
        </label>
      </div>
      <label class="field">
        <span>Assignees</span>
        <div class="assignee-checks">
          {#each humanUsers as u (u.id)}
            <label class="assignee-check">
              <input type="checkbox" checked={assigneeIds.includes(u.id)} on:change={() => toggleAssignee(u.id)} />
              {u.displayName}
            </label>
          {/each}
        </div>
      </label>
      {#if error}<p class="error">{error}</p>{/if}
      <div class="actions">
        <button type="button" class="btn ghost" on:click={onClose}>Cancel</button>
        <button type="submit" class="btn primary" disabled={!title.trim() || submitting}>{submitting ? 'Creating…' : 'Create issue'}</button>
      </div>
    </form>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(10, 12, 18, 0.5); display: flex; align-items: center; justify-content: center; z-index: 50; }
  .modal { width: 420px; background: var(--surface); border-radius: 12px; box-shadow: var(--shadow-lg); padding: 20px; }
  .modal-title { font-size: 15px; font-weight: 700; color: var(--text); margin: 0 0 14px; }
  form { display: flex; flex-direction: column; gap: 12px; }
  .row { display: flex; gap: 12px; }
  .row .field { flex: 1; }
  .field { display: flex; flex-direction: column; gap: 5px; font-size: 11px; font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: .04em; }
  .field input, .field select {
    font: inherit; font-size: 13px; text-transform: none; font-weight: 400; color: var(--text);
    background: var(--surface-2); border: 1px solid var(--border); border-radius: 7px; padding: 8px 10px;
  }
  .error { color: var(--critical); font-size: 12px; margin: 0; }
  .assignee-checks { display: flex; flex-wrap: wrap; gap: 8px; max-height: 100px; overflow-y: auto; }
  .assignee-check { display: flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 400; text-transform: none; color: var(--text); }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
  .btn { font-size: 12.5px; font-weight: 600; padding: 8px 14px; border-radius: 7px; }
  .btn.ghost { color: var(--text-2); background: var(--surface-2); }
  .btn.primary { color: var(--accent-on); background: var(--accent); }
  .btn.primary:disabled { opacity: .5; }
</style>
