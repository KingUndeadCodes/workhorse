import { defineConfig, type Plugin } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import path from 'path'
import { readdirSync, readFileSync } from 'fs'

/** Per-theme override of one component's colors — currently just `bg`/`fg`, the only two a
 * component has ever needed (see `colorSchemes.*.components` below). */
interface ComponentColorOverride { bg?: string; fg?: string }

interface UiConfig {
  font: { family: string; googleFontsUrl: string };
  /** Which named scheme in `colorSchemes` is live — looked up as `${activeColorScheme}light` /
   * `${activeColorScheme}dark`, so switching schemes (or adding a new one) is a one-line change
   * here plus a new pair of entries in `colorSchemes`, never a code change. */
  activeColorScheme: string;
  /**
   * Each entry's keys are CSS custom property names without the leading `--` (e.g. "accent" ->
   * --accent), except for the reserved `components` key. A `*dark` entry only needs to list the
   * keys that actually differ under prefers-color-scheme: dark — anything it omits (rare —
   * mainly sidebar-*, which usually stays the same dark chrome in both themes) just keeps the
   * `*light` value.
   *
   * `components` is an optional map from component name (kebab-case, e.g. "create-button") to a
   * `{ bg?, fg? }` override for that component's default colors — the generic mechanism any
   * component can opt into instead of each one inventing its own top-level colorScheme keys. See
   * `toComponentCssVars` for how these become CSS vars.
   */
  colorSchemes: Record<string, { [key: string]: string | Record<string, ComponentColorOverride> | undefined; components?: Record<string, ComponentColorOverride> }>;
}

/** `{ bg: '#FFF', accentSoft: '#EEE' }` -> `--bg: #FFF; --accent-soft: #EEE;` for inlining into a <style> block. An optional `prefix` produces a differently-named copy of the same vars (e.g. `--preview-light-bg`) — used to expose a palette that isn't the currently-active theme, see uiConfigHtmlPlugin. */
function toCssVars(vars: Record<string, string>, prefix = ''): string {
  return Object.entries(vars).map(([key, value]) => `--${prefix}${key}: ${value};`).join(' ');
}

/** Same idea as `toCssVars`, but for `colorSchemes.*.components` — `{ "create-button": { bg: '#2563EB', fg: '#FFF' } }` -> `--component-create-button-bg: #2563EB; --component-create-button-fg: #FFF;`. Only the properties a given component actually overrides are emitted, so consumers still need their own `var(--component-x-bg, var(--accent))`-style fallback. */
function toComponentCssVars(components: Record<string, ComponentColorOverride>, prefix = ''): string {
  return Object.entries(components)
    .flatMap(([name, { bg, fg }]) => [
      bg ? `--${prefix}component-${name}-bg: ${bg};` : '',
      fg ? `--${prefix}component-${name}-fg: ${fg};` : '',
    ])
    .filter(Boolean)
    .join(' ');
}

/** `#RGB`, `#RRGGBB`, or `rgb()`/`rgba()` — the only color formats actually used in ui.config.json. */
const COLOR_VALUE_RE = /^(#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\))$/;

interface ResolvedScheme {
  vars: Record<string, string>;
  components: Record<string, ComponentColorOverride>;
}

/**
 * Resolves the `light`/`dark` pair for `activeColorScheme`, throwing a descriptive error rather
 * than silently degrading if the config is wrong in any of three ways: (1) `activeColorScheme`
 * doesn't match any entry in `colorSchemes` (a typo'd name would otherwise resolve both sides to
 * `{}`, leaving every CSS variable unset and the whole app unstyled with no indication why), (2)
 * some flat palette value isn't actually a color, or (3) some component override's `bg`/`fg`
 * isn't actually a color (either would otherwise flow straight into the generated CSS and just
 * silently fail to apply). Collects every bad key in one pass so a broken config gets fixed in
 * one edit instead of one Vite error at a time.
 */
function resolveColorScheme(config: UiConfig): { light: ResolvedScheme; dark: ResolvedScheme } {
  const lightKey = `${config.activeColorScheme}light`;
  const darkKey = `${config.activeColorScheme}dark`;
  const lightEntry = config.colorSchemes[lightKey];
  const darkEntry = config.colorSchemes[darkKey];
  if (!lightEntry || !darkEntry) {
    const available = Object.keys(config.colorSchemes).join(', ') || '(none defined)';
    throw new Error(
      `ui.config.json: activeColorScheme "${config.activeColorScheme}" has no "${lightKey}"/"${darkKey}" entry in colorSchemes. Available: ${available}`,
    );
  }

  const split = (entry: (typeof config.colorSchemes)[string]): ResolvedScheme => {
    const { components = {}, ...vars } = entry;
    return { vars: vars as Record<string, string>, components };
  };
  const light = split(lightEntry);
  const dark = split(darkEntry);

  const badVarEntries = [...Object.entries(light.vars), ...Object.entries(dark.vars)].filter(([, value]) => !COLOR_VALUE_RE.test(value));
  const badComponentEntries = [...Object.entries(light.components), ...Object.entries(dark.components)].flatMap(([name, { bg, fg }]) =>
    [bg ? [`components.${name}.bg`, bg] : null, fg ? [`components.${name}.fg`, fg] : null].filter((e): e is [string, string] => e !== null),
  ).filter(([, value]) => !COLOR_VALUE_RE.test(value));
  const badEntries = [...badVarEntries, ...badComponentEntries];
  if (badEntries.length > 0) {
    const description = badEntries.map(([key, value]) => `${key}: "${value}"`).join(', ');
    throw new Error(`ui.config.json: colorSchemes."${config.activeColorScheme}light"/"...dark" has invalid color value(s) — ${description}`);
  }
  return { light, dark };
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
      const { light, dark } = resolveColorScheme(config);
      return html
        .replaceAll('{{UI_FONT_FAMILY}}', config.font.family)
        .replaceAll('{{UI_FONT_GOOGLE_URL}}', config.font.googleFontsUrl)
        .replaceAll('{{UI_COLOR_SCHEME_LIGHT}}', toCssVars(light.vars) + toComponentCssVars(light.components))
        .replaceAll('{{UI_COLOR_SCHEME_DARK}}', toCssVars(dark.vars) + toComponentCssVars(dark.components))
        // Unscoped, always-active copies of both palettes (not gated by [data-theme]) — so the
        // Appearance tab's theme picker can render an accurate preview of *both* options at
        // once, regardless of which one is actually live right now. Component overrides aren't
        // part of that preview (nothing consumes them there today), so only the flat vars are
        // mirrored here.
        .replaceAll('{{UI_COLOR_PREVIEW_LIGHT}}', toCssVars(light.vars, 'preview-light-'))
        .replaceAll('{{UI_COLOR_PREVIEW_DARK}}', toCssVars(dark.vars, 'preview-dark-'));
    },
  };
}

/** A leaf value in a locale JSON file — see `src/lib/i18n/index.ts`'s identical types/logic,
 * which this deliberately duplicates rather than imports: that module is browser-side Svelte
 * store code, and this plugin needs to run in Node, once, before the dev server or build even
 * starts serving anything. */
const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];
function isPluralForms(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    PLURAL_CATEGORIES.some((c) => typeof (value as Record<string, unknown>)[c] === 'string' && (value as Record<string, unknown>)[c]);
}

/** Every dotted path in a locale dict that resolves to a translatable leaf (a string, or a
 * plural-forms group) rather than a namespace to recurse into further. */
function collectLeafPaths(dict: Record<string, unknown>, prefix: string[] = []): string[][] {
  const paths: string[][] = [];
  for (const [key, value] of Object.entries(dict)) {
    const path = [...prefix, key];
    if (typeof value === 'string' || isPluralForms(value)) {
      paths.push(path);
    } else if (typeof value === 'object' && value !== null) {
      paths.push(...collectLeafPaths(value as Record<string, unknown>, path));
    }
  }
  return paths;
}

function getAtPath(dict: Record<string, unknown>, path: string[]): unknown {
  let node: unknown = dict;
  for (const segment of path) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/**
 * Prints a warning to the terminal running `npm run dev`/`vite build` — not the browser
 * console — for every locale under `src/lib/i18n/locales/` that's missing (or has left empty)
 * a key `en.json` defines. Same "not translated yet" condition `t()`/`tn()` use to silently
 * fall back to English for that string at runtime (see that file). An incomplete language pack
 * is a perfectly valid, shippable state (see that directory's README) — this is a heads-up for
 * whoever's actively filling one in, surfaced before the app is even served rather than only
 * discoverable by clicking through the UI in that language.
 */
function localeCompletenessPlugin(): Plugin {
  return {
    name: 'locale-completeness-check',
    buildStart() {
      const localesDir = new URL('./src/lib/i18n/locales/', import.meta.url);
      const en = JSON.parse(readFileSync(new URL('en.json', localesDir), 'utf-8'));
      const enPaths = collectLeafPaths(en);
      const otherFiles = readdirSync(localesDir).filter((f) => f.endsWith('.json') && f !== 'en.json');

      for (const file of otherFiles) {
        const locale = JSON.parse(readFileSync(new URL(file, localesDir), 'utf-8'));
        const missing = enPaths.filter((path) => {
          const value = getAtPath(locale, path);
          return !(typeof value === 'string' && value) && !isPluralForms(value);
        });
        if (missing.length === 0) continue;
        const id = file.replace(/\.json$/, '');
        const preview = missing.slice(0, 10).map((p) => p.join('.'));
        const rest = missing.length - preview.length;
        console.warn(
          `[locale-completeness] "${id}" is missing ${missing.length}/${enPaths.length} translation${enPaths.length === 1 ? '' : 's'} (falls back to English): ${preview.join(', ')}${rest > 0 ? `, +${rest} more` : ''}`,
        );
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte(), uiConfigHtmlPlugin(), localeCompletenessPlugin()],
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
