<script lang="ts">
  // Mounted identically at the top of Board.svelte, MobileBoard.svelte, and Backlog.svelte —
  // no props, reads/writes issueFiltersStore directly so all three share one search/filter
  // state instead of each view starting fresh.
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import BottomSheet from './BottomSheet.svelte';
  import { issueFiltersStore, activeFilterCount, clearFilters } from '../stores/issueFilters';
  import { isMobile } from '../stores/viewport';
  import { featureFlags, issueTypes, labels, statusCategories, users, workflow } from '../stores/workspace';
  import { splitHumansAndAgents, displayName } from '../util';
  import { t } from '../i18n';

  let showFilterPanel = false;

  $: epicTypeId = $issueTypes.find((it) => it.name === 'Epic')?.id;
  $: filterableTypes = $issueTypes.filter((it) => it.id !== epicTypeId);
  $: ({ humans: assignableUsers } = splitHumansAndAgents($users));

  const PRIORITIES = ['highest', 'high', 'medium', 'low', 'lowest'] as const;

  function toggle(array: string[], id: string): string[] {
    return array.includes(id) ? array.filter((v) => v !== id) : [...array, id];
  }
  function toggleAssignee(id: string) {
    issueFiltersStore.update((f) => ({ ...f, assigneeIds: toggle(f.assigneeIds, id) }));
  }
  function toggleLabel(id: string) {
    issueFiltersStore.update((f) => ({ ...f, labelIds: toggle(f.labelIds, id) }));
  }
  function togglePriority(p: string) {
    issueFiltersStore.update((f) => ({ ...f, priorities: toggle(f.priorities, p) }));
  }
  function toggleType(id: string) {
    issueFiltersStore.update((f) => ({ ...f, issueTypeIds: toggle(f.issueTypeIds, id) }));
  }
  function toggleStatus(id: string) {
    issueFiltersStore.update((f) => ({ ...f, statusIds: toggle(f.statusIds, id) }));
  }

  /** Desktop's popover only — the BottomSheet handles its own dismissal on mobile. */
  function closeOnClickOutside(node: HTMLElement, close: () => void) {
    function handleClick(event: MouseEvent) {
      if (!node.contains(event.target as Node)) close();
    }
    document.addEventListener('click', handleClick, true);
    return { destroy: () => document.removeEventListener('click', handleClick, true) };
  }
</script>

<div class="search-filter-bar">
  <div class="search-field">
    <Icon name="search" size={14} />
    <input type="text" placeholder={$t('filters.searchPlaceholder')} aria-label={$t('filters.searchPlaceholder')} bind:value={$issueFiltersStore.query} />
  </div>
  <div class="filter-control">
    <button type="button" class="filter-btn" class:active={$activeFilterCount > 0} on:click={() => (showFilterPanel = !showFilterPanel)}>
      <Icon name="lines" size={13} />
      {$t('filters.button')}
      {#if $activeFilterCount > 0}<span class="filter-count">{$activeFilterCount}</span>{/if}
    </button>

    {#if $isMobile}
      <BottomSheet open={showFilterPanel} title={$t('filters.title')} onClose={() => (showFilterPanel = false)}>
        {@render filterSections()}
      </BottomSheet>
    {:else if showFilterPanel}
      <div class="filter-popover" use:closeOnClickOutside={() => (showFilterPanel = false)}>
        {@render filterSections()}
      </div>
    {/if}
  </div>
</div>

{#snippet filterSections()}
  <div class="filter-section">
    <div class="filter-section-label">{$t('filters.sectionAssignee')}</div>
    {#each assignableUsers as u (u.id)}
      <label class="filter-option">
        <input type="checkbox" checked={$issueFiltersStore.assigneeIds.includes(u.id)} on:change={() => toggleAssignee(u.id)} />
        <Avatar userId={u.id} name={displayName(u)} avatarUrl={u.avatarUrl} size={18} />
        {displayName(u)}
      </label>
    {/each}
  </div>

  {#if $featureFlags.labels && $labels.length}
    <div class="filter-section">
      <div class="filter-section-label">{$t('filters.sectionLabel')}</div>
      {#each $labels as l (l.id)}
        <label class="filter-option">
          <input type="checkbox" checked={$issueFiltersStore.labelIds.includes(l.id)} on:change={() => toggleLabel(l.id)} />
          <span class="ldot" style="background:{l.color}"></span>
          {l.name}
        </label>
      {/each}
    </div>
  {/if}

  {#if $featureFlags.priority}
    <div class="filter-section">
      <div class="filter-section-label">{$t('filters.sectionPriority')}</div>
      {#each PRIORITIES as p}
        <label class="filter-option">
          <input type="checkbox" checked={$issueFiltersStore.priorities.includes(p)} on:change={() => togglePriority(p)} />
          {$t(`common.priority.${p}`)}
        </label>
      {/each}
    </div>
  {/if}

  <div class="filter-section">
    <div class="filter-section-label">{$t('filters.sectionType')}</div>
    {#each filterableTypes as it (it.id)}
      <label class="filter-option">
        <input type="checkbox" checked={$issueFiltersStore.issueTypeIds.includes(it.id)} on:change={() => toggleType(it.id)} />
        {it.name}
      </label>
    {/each}
  </div>

  <div class="filter-section">
    <div class="filter-section-label">{$t('filters.sectionStatus')}</div>
    {#each $workflow?.statuses ?? [] as s (s.id)}
      <label class="filter-option">
        <input type="checkbox" checked={$issueFiltersStore.statusIds.includes(s.id)} on:change={() => toggleStatus(s.id)} />
        {s.name}
      </label>
    {/each}
  </div>

  <button type="button" class="clear-link" on:click={clearFilters}>{$t('filters.clear')}</button>
{/snippet}

<style>
  .search-filter-bar { display: flex; gap: 8px; padding: 12px 20px 0; }
  .search-field {
    flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; height: 32px;
    box-sizing: border-box; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 0 10px;
    color: var(--text-3);
  }
  .search-field:focus-within { border-color: var(--accent); }
  .search-field input {
    flex: 1; min-width: 0; height: 100%; font: inherit; font-size: 12.5px; color: var(--text); background: none;
    border: none; outline: none; padding: 0;
  }
  .search-field input::placeholder { color: var(--text-3); }
  .filter-control { position: relative; }
  .filter-btn {
    display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; box-sizing: border-box;
    color: var(--text-2); background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px;
    padding: 0 12px; height: 32px; white-space: nowrap;
  }
  .filter-btn:hover, .filter-btn.active { color: var(--text); border-color: var(--border-strong); }
  .filter-count {
    display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px;
    padding: 0 4px; border-radius: 99px; font-size: 10px; font-weight: 700; color: var(--accent-on); background: var(--accent);
  }
  .filter-popover {
    position: absolute; top: calc(100% + 6px); right: 0; z-index: 20; min-width: 220px; max-width: 260px;
    background: var(--surface); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--shadow-lg);
    padding: 10px; max-height: 400px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px;
  }
  .filter-section { display: flex; flex-direction: column; gap: 2px; }
  .filter-section-label { font-size: 10.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-3); margin-bottom: 3px; }
  .filter-option { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text); padding: 5px 6px; border-radius: 5px; cursor: pointer; }
  .filter-option:hover { background: var(--surface-2); }
  .ldot { width: 8px; height: 8px; border-radius: 2px; flex: 0 0 8px; }
  .clear-link { align-self: flex-start; font-size: 12px; font-weight: 600; color: var(--accent-strong); padding: 4px 6px; }

  @media (max-width: 767px) {
    .search-filter-bar { padding: 10px 12px 0; gap: 6px; }
    .search-field { max-width: none; height: 40px; }
    .search-field input { font-size: 16px; }
    .filter-btn { padding: 0 12px; height: 40px; }
    .filter-option { padding: 11px 8px; font-size: 14px; }
    .filter-option input[type="checkbox"] { width: 18px; height: 18px; }
    .filter-section-label { font-size: 11px; }
    .clear-link { font-size: 13px; padding: 8px 6px; }
  }
</style>
