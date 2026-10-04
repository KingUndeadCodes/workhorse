import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from '../src/lib/i18n';

// Automates the "Verifying a locale file" checklist in this directory's README. Empty strings are
// deliberately allowed everywhere: they are the documented "not translated yet" scaffold that falls
// back to English at runtime, so a partially translated locale is valid — a *missing* key, an
// orphaned key, a mismatched placeholder, or an impossible plural form is not.
// Vitest runs from app/ (see vitest.config.ts); import.meta.url isn't a file: URL under jsdom, so resolve from cwd.
const LOCALES_DIR = resolve(process.cwd(), 'src/lib/i18n/locales');
const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];

type Dict = { [key: string]: string | Dict };
const load = (id: string): Dict => JSON.parse(readFileSync(join(LOCALES_DIR, `${id}.json`), 'utf8'));

const isPluralForms = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' && v !== null && Object.keys(v).length > 0 && Object.keys(v).every((k) => PLURAL_CATEGORIES.includes(k));

/** dotted path -> leaf (a string, or a plural-forms object); namespaces are recursed into. */
function leaves(dict: Dict, prefix = ''): Map<string, string | Record<string, string>> {
  const out = new Map<string, string | Record<string, string>>();
  for (const [key, value] of Object.entries(dict)) {
    const path = prefix + key;
    if (typeof value === 'string' || isPluralForms(value)) out.set(path, value as string | Record<string, string>);
    else leaves(value as Dict, `${path}.`).forEach((v, k) => out.set(k, v));
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const strings = (leaf: string | Record<string, string>) => (typeof leaf === 'string' ? [leaf] : Object.values(leaf));

const en = leaves(load('en'));
const otherIds = SUPPORTED_LOCALES.map((l) => l.id).filter((id) => id !== 'en');

describe('locale registry', () => {
  it('every locales/*.json file is registered in SUPPORTED_LOCALES, and vice versa', () => {
    const files = readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
    expect(files).toEqual(SUPPORTED_LOCALES.map((l) => l.id).sort());
  });

  it('en is the source of truth: no empty strings, so the English fallback is never blank', () => {
    const empty = [...en].filter(([, leaf]) => strings(leaf).some((s) => !s.trim())).map(([path]) => path);
    expect(empty).toEqual([]);
  });
});

describe.each(otherIds)('locale "%s" mirrors en.json', (id) => {
  const locale = leaves(load(id));

  it('has every key en.json has (no missing keys)', () => {
    const missing = [...en.keys()].filter((path) => !locale.has(path));
    expect(missing).toEqual([]);
  });

  it('has no keys en.json lacks (no orphans from a renamed/removed string)', () => {
    const orphans = [...locale.keys()].filter((path) => !en.has(path));
    expect(orphans).toEqual([]);
  });

  it('uses the same leaf kind as en: a plain string stays a string, plural forms stay plural forms', () => {
    const mismatched = [...locale].filter(([path, leaf]) => en.has(path) && typeof leaf !== typeof en.get(path)).map(([path]) => path);
    expect(mismatched).toEqual([]);
  });

  it('keeps every {placeholder} the English string has, and adds none', () => {
    const problems: string[] = [];
    for (const [path, leaf] of locale) {
      const english = en.get(path);
      if (english === undefined) continue;
      if (typeof leaf === 'string' && typeof english === 'string') {
        if (leaf && placeholders(leaf).join() !== placeholders(english).join()) problems.push(`${path}: {${placeholders(english)}} -> {${placeholders(leaf)}}`);
      } else if (typeof leaf === 'object' && typeof english === 'object') {
        // Plural forms: {count} is always supplied by tn(), so only the *other* placeholders must agree, form by form.
        const expected = placeholders(english.other ?? Object.values(english)[0]).filter((p) => p !== 'count').join();
        for (const [category, text] of Object.entries(leaf)) {
          if (text && placeholders(text).filter((p) => p !== 'count').join() !== expected) problems.push(`${path}.${category}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('plural entries use only categories this language has, and include "other" once translated', () => {
    const valid = new Set(new Intl.PluralRules(id).resolvedOptions().pluralCategories);
    const problems: string[] = [];
    for (const [path, leaf] of locale) {
      if (typeof leaf !== 'object') continue;
      const translated = Object.entries(leaf).filter(([, text]) => text);
      if (translated.length === 0) continue; // all-empty scaffold
      for (const [category] of translated) if (!valid.has(category as Intl.LDMLPluralRule)) problems.push(`${path}: "${category}" is not a plural category of ${id}`);
      if (!leaf.other) problems.push(`${path}: missing "other"`);
    }
    expect(problems).toEqual([]);
  });
});
