import { get } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Issue } from '$domain';
import { activeFilterCount, clearFilters, issueFiltersStore, issueMatchesFilters, type IssueFilterState } from '../src/lib/stores/issueFilters';

const issue = (overrides: Partial<Issue> = {}): Issue =>
  ({ id: 'i1', key: 'PRJ-142', title: 'Fix login redirect loop', assigneeIds: ['u1'], labelIds: ['l1'], priority: 'high', issueTypeId: 'bug', statusId: 'todo', ...overrides }) as Issue;
const filters = (overrides: Partial<IssueFilterState> = {}): IssueFilterState => ({ query: '', assigneeIds: [], labelIds: [], priorities: [], issueTypeIds: [], statusIds: [], ...overrides });

describe('issueMatchesFilters', () => {
  it('matches everything when no filter is set', () => {
    expect(issueMatchesFilters(issue(), filters())).toBe(true);
  });

  it('searches title and key, case-insensitively, ignoring surrounding whitespace', () => {
    expect(issueMatchesFilters(issue(), filters({ query: '  LOGIN ' }))).toBe(true);
    expect(issueMatchesFilters(issue(), filters({ query: 'prj-142' }))).toBe(true);
    expect(issueMatchesFilters(issue(), filters({ query: 'checkout' }))).toBe(false);
  });

  it('is OR within one facet and AND across facets', () => {
    expect(issueMatchesFilters(issue(), filters({ assigneeIds: ['u9', 'u1'] }))).toBe(true);
    expect(issueMatchesFilters(issue(), filters({ assigneeIds: ['u9'] }))).toBe(false);
    expect(issueMatchesFilters(issue(), filters({ assigneeIds: ['u1'], priorities: ['low'] }))).toBe(false);
    expect(issueMatchesFilters(issue(), filters({ assigneeIds: ['u1'], priorities: ['high'], statusIds: ['todo'] }))).toBe(true);
  });

  it('filters on labels, issue type, and status', () => {
    expect(issueMatchesFilters(issue(), filters({ labelIds: ['l2'] }))).toBe(false);
    expect(issueMatchesFilters(issue(), filters({ issueTypeIds: ['story'] }))).toBe(false);
    expect(issueMatchesFilters(issue(), filters({ statusIds: ['done'] }))).toBe(false);
  });

  it('an unassigned issue never matches an assignee filter', () => {
    expect(issueMatchesFilters(issue({ assigneeIds: [] }), filters({ assigneeIds: ['u1'] }))).toBe(false);
  });
});

describe('filter store', () => {
  beforeEach(() => issueFiltersStore.set(filters()));

  it('counts facet selections but not the search text', () => {
    issueFiltersStore.set(filters({ query: 'abc', assigneeIds: ['u1', 'u2'], priorities: ['high'] }));
    expect(get(activeFilterCount)).toBe(3);
  });

  it('clearFilters resets the facets but keeps what is typed in the search box', () => {
    issueFiltersStore.set(filters({ query: 'abc', labelIds: ['l1'], statusIds: ['todo'] }));
    clearFilters();
    expect(get(issueFiltersStore)).toEqual(filters({ query: 'abc' }));
    expect(get(activeFilterCount)).toBe(0);
  });
});
