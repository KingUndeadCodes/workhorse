<script lang="ts">
  import BottomSheet from './BottomSheet.svelte';
  import Icon from './Icon.svelte';
  import LinkPicker from './LinkPicker.svelte';
  import StatusChip from './StatusChip.svelte';
  import { addIssueLink, doneStatusIds, issueLinks, issuesStore, removeIssueLink, selectedIssueId } from '../stores/workspace';
  import { isMobile } from '../stores/viewport';
  import { groupIssueLinks, LINK_RELATION_ORDER, relationToStored, type LinkRelation } from '../util';
  import { t } from '../i18n';
  import type { Issue, IssueLink } from '$domain';

  /**
   * An issue's links to other issues: grouped by how they relate ("Blocked by", "Blocks", ...), each row showing the
   * other issue's status and opening it when clicked, plus a search picker to add one. Lives in the drawer body, not
   * behind "Advanced" — whether something is blocked is the first thing worth knowing about it.
   */
  export let issue: Issue;

  let adding = false;
  let relation: LinkRelation = 'blocks';
  let error = '';

  $: groups = groupIssueLinks(issue.id, $issueLinks);
  $: issuesById = new Map($issuesStore.map((i) => [i.id, i]));

  /** Whether linking `other` with this relation would repeat a link that already exists (same stored type and direction; "relates to" has none). */
  function repeatsExistingLink(other: Issue, rel: LinkRelation, links: IssueLink[]): boolean {
    const { type, reverse } = relationToStored(rel);
    const sourceId = reverse ? other.id : issue.id;
    const targetId = reverse ? issue.id : other.id;
    return links.some((l) => l.type === type && ((l.sourceIssueId === sourceId && l.targetIssueId === targetId) || (type === 'relatesTo' && l.sourceIssueId === targetId && l.targetIssueId === sourceId)));
  }

  $: candidates = $issuesStore.filter((i) => i.id !== issue.id && !repeatsExistingLink(i, relation, $issueLinks));

  function toggleAdding() {
    adding = !adding;
    error = '';
  }

  async function pick(other: Issue) {
    const { type, reverse } = relationToStored(relation);
    error = '';
    try {
      // "is blocked by X" is stored as "X blocks this", so the stored source is whichever side the relation points from.
      await addIssueLink(reverse ? other.id : issue.id, type, reverse ? issue.id : other.id);
      adding = false;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  function open(id: string) {
    $selectedIssueId = id;
  }
</script>

<div class="linked">
  <div class="head">
    <div class="section-label">{$t('issueDrawer.linkedIssuesLabel')}</div>
    <button type="button" class="add" aria-expanded={adding} on:click={toggleAdding}>
      <Icon name={adding ? 'x' : 'plus'} size={10} />{adding ? $t('common.cancel') : $t('linkedIssues.addButton')}
    </button>
  </div>

  {#each groups as group (group.relation)}
    <div class="group">
      <div class="group-label">{$t(`linkedIssues.relations.${group.relation}`)}</div>
      {#each group.links as { link, otherId } (link.id)}
        {@const other = issuesById.get(otherId)}
        {#if other}
          <div class="row" class:done={group.relation === 'blockedBy' && $doneStatusIds.has(other.statusId)}>
            <button type="button" class="open" aria-label={$t('linkedIssues.openIssue', { key: other.key })} on:click={() => open(other.id)}>
              <span class="key mono">{other.key}</span>
              <span class="title">{other.title}</span>
              <StatusChip statusId={other.statusId} />
            </button>
            <button type="button" class="remove" aria-label={$t('issueDrawer.removeLinkLabel', { key: other.key })} on:click={() => removeIssueLink(issue.id, link.id)}><Icon name="x" size={12} /></button>
          </div>
        {/if}
      {/each}
    </div>
  {/each}

  {#if adding}
    {#if $isMobile}
      <BottomSheet open={adding} title={$t('linkedIssues.addButton')} onClose={toggleAdding}>
        <div class="add-panel">
          <label class="relation-field">
            <span>{$t('linkedIssues.relationLabel')}</span>
            <select bind:value={relation}>{#each LINK_RELATION_ORDER as r (r)}<option value={r}>{$t(`linkedIssues.relations.${r}`)}</option>{/each}</select>
          </label>
          <LinkPicker {candidates} onPick={pick} onClose={toggleAdding} />
          {#if error}<p class="error" role="alert">{error}</p>{/if}
        </div>
      </BottomSheet>
    {:else}
      <div class="add-panel">
        <label class="relation-field">
          <span>{$t('linkedIssues.relationLabel')}</span>
          <select bind:value={relation}>{#each LINK_RELATION_ORDER as r (r)}<option value={r}>{$t(`linkedIssues.relations.${r}`)}</option>{/each}</select>
        </label>
        <LinkPicker {candidates} onPick={pick} onClose={toggleAdding} />
        {#if error}<p class="error" role="alert">{error}</p>{/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .linked { display: flex; flex-direction: column; gap: 6px; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .section-label { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-2); }
  .add { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; color: var(--accent-strong); padding: 3px 6px; border-radius: 6px; }
  .add:hover { background: var(--accent-soft); }
  .group { display: flex; flex-direction: column; margin-top: 4px; }
  .group-label { font-size: 10.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-3); padding: 2px 0; }
  .row { display: flex; align-items: center; gap: 4px; }
  .open { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; text-align: left; padding: 5px 6px; margin: 0 -6px; border-radius: 6px; font-size: 12px; color: var(--text); cursor: pointer; }
  .open:hover { background: var(--surface-2); }
  .open:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .key { color: var(--text-3); flex: 0 0 auto; font-size: 11.5px; }
  .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* A finished blocker no longer blocks anything, so it recedes; an open one stays at full strength. */
  .row.done .title { text-decoration: line-through; }
  .row.done .open { opacity: .55; }
  .remove { width: 26px; height: 26px; flex: 0 0 26px; display: flex; align-items: center; justify-content: center; color: var(--text-3); border-radius: 6px; }
  .remove:hover { background: var(--surface-2); color: var(--text); }
  .add-panel { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }
  .relation-field { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; color: var(--text-3); }
  .relation-field select { font: inherit; font-size: 12.5px; color: var(--text); background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; }
  .error { margin: 0; font-size: 12px; color: var(--critical); }

  @media (max-width: 767px) {
    .add { min-height: 44px; font-size: 13px; padding: 0 8px; }
    .open { min-height: 44px; font-size: 13.5px; }
    .remove { width: 44px; height: 44px; flex-basis: 44px; }
    .relation-field select { font-size: 16px; padding: 10px; }
    .group-label { font-size: 11px; }
  }
</style>
