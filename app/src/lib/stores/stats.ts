import { writable } from 'svelte/store';
import type { StatsWindow, WorkspaceStats } from '$domain';
import { fetchStats } from '../api';

/** Which of the three precomputed windows the Stats view is currently showing — purely a
 * client-side toggle, since `workspaceStats` already carries all three at once. */
export const statsWindow = writable<StatsWindow>('24h');

/** Null until `loadStats()` has resolved once. Not populated at `initWorkspace()` time — nobody
 * needs this report until they actually open the Stats view. */
export const workspaceStats = writable<WorkspaceStats | null>(null);

export async function loadStats(): Promise<void> {
  workspaceStats.set(await fetchStats());
}
