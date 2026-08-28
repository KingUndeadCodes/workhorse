import { writable } from 'svelte/store';

const STORAGE_KEY = 'workhorse-keyboard-nav';

function initialValue(): boolean {
  return typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === 'true';
}

/**
 * Opt-in WASD keyboard navigation for the Board — moves and drops issue cards between columns
 * without a mouse or drag gesture. Off by default (see Settings → Appearance); persisted per
 * browser like {@link import('./theme').theme}, not shared across users.
 */
export const keyboardNavEnabled = writable<boolean>(initialValue());

keyboardNavEnabled.subscribe((value) => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, String(value));
});
