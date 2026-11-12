<script lang="ts">
  import { onMount } from 'svelte';
  import StatusChip from './StatusChip.svelte';
  import { t } from '../i18n';
  import type { Issue } from '$domain';

  /**
   * Search-as-you-type picker for the issue to link: matches key or title, shows a handful of results with their
   * status, and works from the keyboard (arrows move, Enter picks, Escape closes) the same way the notification
   * panel does. Rendered inline on desktop and inside a bottom sheet on a phone — see LinkedIssues.svelte.
   */
  export let candidates: Issue[];
  export let onPick: (issue: Issue) => void;
  export let onClose: () => void;

  const MAX_RESULTS = 8;

  let query = '';
  let active = 0;
  let input: HTMLInputElement;

  $: needle = query.trim().toLowerCase();
  $: results = (needle ? candidates.filter((i) => i.key.toLowerCase().includes(needle) || i.title.toLowerCase().includes(needle)) : candidates).slice(0, MAX_RESULTS);
  // A new search starts from the top result.
  $: needle, (active = 0);

  onMount(() => input?.focus());

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = Math.min(active + 1, results.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(active - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault(); // inside a form-less panel, but never submit anything around it
      if (results[active]) onPick(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  }
</script>

<div class="picker">
  <input
    bind:this={input}
    bind:value={query}
    class="search"
    type="text"
    role="combobox"
    autocomplete="off"
    placeholder={$t('linkedIssues.searchPlaceholder')}
    aria-label={$t('linkedIssues.searchPlaceholder')}
    aria-expanded="true"
    aria-controls="link-picker-results"
    aria-activedescendant={results[active] ? `link-option-${results[active].id}` : undefined}
    on:keydown={handleKeydown}
  />
  <ul class="results" id="link-picker-results" role="listbox">
    {#each results as issue, i (issue.id)}
      <li id="link-option-{issue.id}" role="option" aria-selected={i === active} class:active={i === active}>
        <button type="button" tabindex="-1" on:click={() => onPick(issue)} on:mousemove={() => (active = i)}>
          <span class="key mono">{issue.key}</span>
          <span class="title">{issue.title}</span>
          <StatusChip statusId={issue.statusId} />
        </button>
      </li>
    {:else}
      <li class="none">{$t('linkedIssues.noResults')}</li>
    {/each}
  </ul>
</div>

<style>
  .picker { display: flex; flex-direction: column; gap: 6px; }
  .search {
    font: inherit; font-size: 12.5px; color: var(--text); background: var(--surface-2); border: 1px solid var(--border);
    border-radius: 6px; padding: 7px 9px; min-width: 0;
  }
  .search:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .results { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; max-height: 260px; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
  .results li + li { border-top: 1px solid var(--border); }
  .results li.active { background: var(--surface-2); }
  .results button { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 7px 10px; font: inherit; font-size: 12px; color: var(--text); }
  .key { color: var(--text-3); flex: 0 0 auto; font-size: 11.5px; }
  .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .none { padding: 12px 10px; font-size: 12px; color: var(--text-3); }

  @media (max-width: 767px) {
    .search { font-size: 16px; padding: 11px 12px; }
    .results { max-height: 50vh; }
    .results button { min-height: 44px; padding: 8px 12px; font-size: 13.5px; }
  }
</style>
