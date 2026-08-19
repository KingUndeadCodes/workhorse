import { get, writable } from 'svelte/store';

/** The user's stored preference — `'system'` means "keep following the browser/OS setting live", not just at load. */
export type Theme = 'light' | 'dark' | 'system';
/** What actually renders right now — always one of the two real palettes, never `'system'` itself. */
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'workhorse-theme';

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

function initialTheme(): Theme {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system'; // first-ever visit: follow the browser until the user picks something explicit
}

/** The user's chosen preference, persisted across reloads — see {@link Theme}. */
export const theme = writable<Theme>(initialTheme());
/** The theme actually in effect right now — resolves `'system'` against the live OS preference. Read this (not {@link theme}) anywhere that needs to know what's actually rendering, e.g. picking a light-background-only vs dark-background-only image asset. */
export const resolvedTheme = writable<ResolvedTheme>(systemPrefersDark() ? 'dark' : 'light');

/**
 * Applies one resolved theme to the document and updates {@link resolvedTheme}. When `pref` is
 * `'system'`, `data-theme` is deliberately left unset rather than pinned to today's OS value —
 * index.html's `@media (prefers-color-scheme: dark)` rule then drives the actual CSS, so a
 * live OS theme change is reflected immediately with zero JS involved in the *rendering* (this
 * function still runs, to keep `resolvedTheme` accurate for consumers like Avatar.svelte).
 */
function applyTheme(pref: Theme): void {
  const resolved: ResolvedTheme = pref === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : pref;
  resolvedTheme.set(resolved);
  if (typeof document === 'undefined') return;
  if (pref === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = pref;
}

theme.subscribe((value) => {
  applyTheme(value);
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, value);
});

// Only relevant while `theme` is 'system' — re-resolves live if the OS preference flips without
// a reload, instead of only ever being checked once at load like the old single-shot guess was.
if (typeof matchMedia === 'function') {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (get(theme) === 'system') applyTheme('system');
  });
}
