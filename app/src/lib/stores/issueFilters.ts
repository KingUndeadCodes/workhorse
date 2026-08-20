import { derived, writable, type Readable } from 'svelte/store';
import type { Issue } from '$domain';

/**
 * Shared search/filter state for Board.svelte, MobileBoard.svelte, and Backlog.svelte — one
 * store so switching between those views keeps the same search text and filters active instead
 * of each view starting fresh. Purely client-side: the whole project's issues are already
 * loaded into `issuesStore` up front (see workspace.ts), so there's no server round-trip here,
 * just an in-memory predicate the three views apply to their own derived issue lists.
 */
export interface IssueFilterState {
  query: string;
  assigneeIds: string[];
  labelIds: string[];
  priorities: string[];
  issueTypeIds: string[];
  statusIds: string[];
}

function emptyFilters(): IssueFilterState {
  return { query: '', assigneeIds: [], labelIds: [], priorities: [], issueTypeIds: [], statusIds: [] };
}

export const issueFiltersStore = writable<IssueFilterState>(emptyFilters());

/** Resets the facet checkboxes only — leaves the search text alone, since clearing that is just deleting what's typed. */
export function clearFilters(): void {
  issueFiltersStore.update((f) => ({ ...emptyFilters(), query: f.query }));
}

/** Sum of the five facet arrays' lengths, for the Filters button's badge — the search query isn't counted, since its own text is already visible. */
export const activeFilterCount: Readable<number> = derived(
  issueFiltersStore,
  (f) => f.assigneeIds.length + f.labelIds.length + f.priorities.length + f.issueTypeIds.length + f.statusIds.length,
);

/** Whether `issue` matches the current search text and every active filter facet (AND across facets, OR within one). */
export function issueMatchesFilters(issue: Issue, filters: IssueFilterState): boolean {
  const query = filters.query.trim().toLowerCase();
  if (query && !issue.title.toLowerCase().includes(query) && !issue.key.toLowerCase().includes(query)) return false;
  if (filters.assigneeIds.length && !issue.assigneeIds.some((id) => filters.assigneeIds.includes(id))) return false;
  if (filters.labelIds.length && !issue.labelIds.some((id) => filters.labelIds.includes(id))) return false;
  if (filters.priorities.length && !filters.priorities.includes(issue.priority)) return false;
  if (filters.issueTypeIds.length && !filters.issueTypeIds.includes(issue.issueTypeId)) return false;
  if (filters.statusIds.length && !filters.statusIds.includes(issue.statusId)) return false;
  return true;
}
