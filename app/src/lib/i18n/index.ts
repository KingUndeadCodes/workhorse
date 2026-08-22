import { derived, writable } from 'svelte/store';
import en from './locales/en.json';
import ru from './locales/ru.json';
import es from './locales/es.json';
import uk from './locales/uk.json';
import hi from './locales/hi.json';
import zh from './locales/zh.json';
import ja from './locales/ja.json';

/** Add a new language by adding its id here, adding a matching entry to `SUPPORTED_LOCALES`
 * below, and creating `./locales/{id}.json` with the same nested key shape as `en.json` (start
 * from a copy of `es.json` with every value emptied out — see `README.md` in this directory for
 * the full scaffold/plural/fallback conventions). */
export type Locale = 'en' | 'ru' | 'es' | 'uk' | 'hi' | 'zh' | 'ja';

export const SUPPORTED_LOCALES: { id: Locale; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'ru', label: 'Русский' },
  { id: 'es', label: 'Español' },
  { id: 'uk', label: 'Українська' },
  { id: 'hi', label: 'हिन्दी' },
  { id: 'zh', label: '中文' },
  { id: 'ja', label: '日本語' },
];

/** A leaf translation is either a plain string or, for anything consumed through `tn()`, a set
 * of CLDR plural-category forms. Russian needs `one`/`few`/`many`/`other`; English only ever
 * uses `one`/`other` — a dict can supply whichever categories its language actually has rules
 * for (see `Intl.PluralRules(locale).resolvedOptions().pluralCategories`), `tn()` falls back to
 * `other` for any it omits. */
export type PluralForms = Partial<Record<'zero' | 'one' | 'two' | 'few' | 'many' | 'other', string>>;
type TranslationValue = string | PluralForms;
export interface TranslationDict {
  [key: string]: TranslationValue | TranslationDict;
}

const DICTS: Record<Locale, TranslationDict> = { en, ru, es, uk, hi, zh, ja };
const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;

const STORAGE_KEY = 'workhorse-locale';

function initialLocale(): Locale {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  return SUPPORTED_LOCALES.some((l) => l.id === stored) ? (stored as Locale) : 'en';
}

/** The active UI language, persisted across reloads the same way {@link "./theme".theme} is. */
export const locale = writable<Locale>(initialLocale());
locale.subscribe((value) => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, value);
});

/** Walks a dotted key path ("board.noIssues") through a nested dict, returning whatever the
 * last segment resolves to (a string, a plural-forms object, a nested dict if the path names a
 * namespace rather than a leaf, or `undefined` if any segment is missing). Callers decide what
 * shape they actually needed. */
function lookup(dict: TranslationDict, path: string[]): TranslationValue | TranslationDict | undefined {
  let node: TranslationValue | TranslationDict | undefined = dict;
  for (const segment of path) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as TranslationDict)[segment];
  }
  return node;
}

/** A translation object only counts as real plural forms once at least one category actually
 * has text — an all-empty-string scaffold entry (see `locales/es.json`) or a missing key both
 * mean "not translated yet", and should fall through to the next locale rather than render blank. */
function asPluralForms(value: TranslationValue | TranslationDict | undefined): PluralForms | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const forms = value as Record<string, unknown>;
  return PLURAL_CATEGORIES.some((c) => typeof forms[c] === 'string' && forms[c]) ? (value as PluralForms) : undefined;
}

/** `{name}`-style placeholders in a resolved template are swapped for `params[name]`; a
 * placeholder with no matching param is left as-is rather than silently dropped, so a missing
 * param is obvious in the rendered UI instead of just vanishing. */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match));
}

/**
 * Reactive translation lookup — `$t('common.cancel')` or `$t('issueDrawer.branchCreated', { name: branch.name })`.
 * Falls back to English whenever the active locale is missing a key, or has the key scaffolded
 * but not yet translated (an empty string) — so an unfinished translation never shows a raw
 * dotted key or blank text, it just quietly reads in English until filled in.
 */
export const t = derived(locale, ($locale) => {
  return (key: string, params?: Record<string, string | number>): string => {
    const path = key.split('.');
    const value = lookup(DICTS[$locale], path);
    const resolved = typeof value === 'string' && value ? value : lookup(DICTS.en, path);
    return interpolate(typeof resolved === 'string' ? resolved : key, params);
  };
});

/**
 * Pluralized counterpart to `t()` — `$tn('sidebar.members', memberCount)`. Translation entries
 * consumed this way store a {@link PluralForms} object instead of a plain string; the correct
 * form for `count` is selected via `Intl.PluralRules`, which is why this can't just be a
 * `count === 1 ? x : y` ternary — Russian has four plural categories (one/few/many/other) with
 * genuinely different singular-count boundaries than English's two, e.g. 21 is "one" in Russian
 * (like 1, 31, 41…) not "other". `count` is always available to the template as `{count}`.
 */
export const tn = derived(locale, ($locale) => {
  return (key: string, count: number, params?: Record<string, string | number>): string => {
    const path = key.split('.');
    const forms = asPluralForms(lookup(DICTS[$locale], path)) ?? asPluralForms(lookup(DICTS.en, path));
    if (!forms) return key;
    const category = new Intl.PluralRules($locale).select(count);
    const template = forms[category] ?? forms.other ?? Object.values(forms)[0] ?? key;
    return interpolate(template, { count, ...params });
  };
});
