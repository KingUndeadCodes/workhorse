import { currentView, selectedIssueId, settingsJumpTab } from '../stores/workspace';

/**
 * TopBar.svelte's "+" dropdown and MobileNav.svelte's "New" tab both offer the same handful of
 * quick-create shortcuts (New Sprint/Label/Component/Version) — New Issue opens NewIssueModal
 * directly in both, but these others just jump to a create form that already lives elsewhere
 * (Backlog for sprints, Settings/ProjectSettings for catalog items), so there's no dedicated
 * store or modal for them. Shared here so the two nav surfaces can't drift apart on where each
 * shortcut actually goes.
 */

/** Jumps to Backlog, where sprint creation lives (see Backlog.svelte's new-sprint form) — there's no separate "create sprint" screen. Clears the selected issue the same way any other view switch does, so the drawer doesn't stay open over the new view. */
export function goToNewSprint(): void {
  currentView.set('backlog');
  selectedIssueId.set(null);
}

/** Jumps to the settings screen that owns a catalog item's create form, pre-selecting its tab via `settingsJumpTab`. Components/Versions live in project settings; Labels stays in workspace settings. */
export function goToNewCatalogItem(tab: 'Labels' | 'Components' | 'Versions'): void {
  settingsJumpTab.set(tab);
  currentView.set(tab === 'Components' || tab === 'Versions' ? 'projectSettings' : 'settings');
}
