import { writable } from 'svelte/store';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'workhorse-theme';

/** What the user's OS/browser currently prefers — only consulted once, to seed the initial
 * value before any explicit choice has been made (see {@link theme} below). */
function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

function initialTheme(): Theme {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  if (stored === 'light' || stored === 'dark') return stored;
  return systemPrefersDark() ? 'dark' : 'light';
}

/**
 * The user's explicit light/dark choice, persisted across reloads. Applied by setting
 * `data-theme` on `<html>` — index.html's inline `<style>` (see uiConfigHtmlPlugin in
 * vite.config.ts) defines `:root[data-theme="dark"]`/`:root[data-theme="light"]` overrides
 * that win over the `prefers-color-scheme` media query, so this store is the single source of
 * truth for which palette renders once the user has ever touched the toggle.
 */
export const theme = writable<Theme>(initialTheme());

theme.subscribe((value) => {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = value;
  localStorage.setItem(STORAGE_KEY, value);
});
