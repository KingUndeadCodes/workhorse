import { defineConfig, type Plugin } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import path from 'path'
import { readFileSync } from 'fs'

interface UiConfig {
  font: { family: string; googleFontsUrl: string };
  /** Which named scheme in `colorSchemes` is live — looked up as `${activeColorScheme}light` /
   * `${activeColorScheme}dark`, so switching schemes (or adding a new one) is a one-line change
   * here plus a new pair of entries in `colorSchemes`, never a code change. */
  activeColorScheme: string;
  /** Each value's keys are CSS custom property names without the leading `--` (e.g. "accent" ->
   * --accent). A `*dark` entry only needs to list the keys that actually differ under
   * prefers-color-scheme: dark — anything it omits (rare — mainly sidebar-*, which usually
   * stays the same dark chrome in both themes) just keeps the `*light` value. */
  colorSchemes: Record<string, Record<string, string>>;
}

/** `{ bg: '#FFF', accentSoft: '#EEE' }` -> `--bg: #FFF; --accent-soft: #EEE;` for inlining into a <style> block. */
function toCssVars(vars: Record<string, string>): string {
  return Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join(' ');
}

/**
 * Substitutes `{{UI_FONT_FAMILY}}` / `{{UI_FONT_GOOGLE_URL}}` / `{{UI_COLOR_SCHEME_LIGHT}}` /
 * `{{UI_COLOR_SCHEME_DARK}}` in index.html with values built from ui.config.json — a plain
 * committed config file rather than an env var, since none of this is secret/per-deployment,
 * just something to switch and try out (see index.html's comment for how it's consumed).
 * Re-reads the file on every request in dev, so editing ui.config.json and reloading the page
 * is enough; no server restart needed.
 */
function uiConfigHtmlPlugin(): Plugin {
  return {
    name: 'ui-config-html',
    transformIndexHtml(html) {
      const config = JSON.parse(readFileSync(new URL('./ui.config.json', import.meta.url), 'utf-8')) as UiConfig;
      const light = config.colorSchemes[`${config.activeColorScheme}light`] ?? {};
      const dark = config.colorSchemes[`${config.activeColorScheme}dark`] ?? {};
      return html
        .replaceAll('{{UI_FONT_FAMILY}}', config.font.family)
        .replaceAll('{{UI_FONT_GOOGLE_URL}}', config.font.googleFontsUrl)
        .replaceAll('{{UI_COLOR_SCHEME_LIGHT}}', toCssVars(light))
        .replaceAll('{{UI_COLOR_SCHEME_DARK}}', toCssVars(dark));
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte(), uiConfigHtmlPlugin()],
  resolve: {
    alias: {
      $domain: path.resolve(__dirname, '../domain'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
  optimizeDeps: {
    // highlightjs-line-numbers.js is only ever reached via a dynamic `import()` inside
    // lineNumbers.ts (deliberately — it patches methods onto the global `hljs`, and has to
    // run after that assignment, which a static import can't guarantee; see that file's
    // comment). Vite's cold-start dependency scan doesn't reliably follow that dynamic import,
    // which caused it to re-optimize mid-session and momentarily end up with two out-of-sync
    // highlight.js module instances. Listing both here forces them into the initial pre-bundle
    // instead of leaving it to runtime discovery.
    include: ['highlight.js', 'highlightjs-line-numbers.js'],
  },
})
