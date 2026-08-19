import { readable } from 'svelte/store';

/**
 * The single mobile/desktop split used across the app — matches the width where the shell
 * itself already changes structurally (Sidebar disappears, MobileNav appears; see
 * Sidebar.svelte/MobileNav.svelte). Any `@media (max-width: ...)` block that needs to agree
 * with `isMobile` below should use `767px` (one less than this constant), since CSS's
 * `max-width` is inclusive.
 */
export const MOBILE_BREAKPOINT = 768;

function matchesMobile(): boolean {
  return typeof matchMedia === 'function' && matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches;
}

/**
 * Whether the viewport is currently at or below {@link MOBILE_BREAKPOINT} — the one signal
 * components use to switch between an entirely different mobile/desktop component or markup
 * branch (not just reflowed CSS, which stays driven by `@media` directly). Live: updates
 * immediately on resize/rotation/devtools-toggle via the media query's own `change` event,
 * same pattern as `resolvedTheme` in theme.ts.
 */
export const isMobile = readable<boolean>(matchesMobile(), (set) => {
  if (typeof matchMedia !== 'function') return;
  const mql = matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
  const handler = () => set(mql.matches);
  mql.addEventListener('change', handler);
  return () => mql.removeEventListener('change', handler);
});
