import { get } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';
import { locale, t, tn } from '../src/lib/i18n';

beforeEach(() => locale.set('en'));

describe('t()', () => {
  it('looks up a dotted key and fills {placeholders}', () => {
    expect(get(t)('common.cancel')).toBe('Cancel');
    expect(get(t)('gitConnections.connectedAs', { login: 'octocat' })).toBe('Connected as octocat');
  });

  it('leaves a placeholder with no matching param visible instead of dropping it', () => {
    expect(get(t)('gitConnections.connectedAs')).toContain('{login}');
  });

  it('returns the key itself when it exists in no locale, so a typo is obvious in the UI', () => {
    expect(get(t)('no.such.key')).toBe('no.such.key');
  });

  it('switches language reactively, and persists the choice', () => {
    locale.set('es');
    expect(get(t)('common.cancel')).not.toBe('Cancel');
    expect(localStorage.getItem('workhorse-locale')).toBe('es');
  });

  it('falls back to English for a key the active locale has left blank or lacks', async () => {
    // Every shipped locale is complete, so build the gap by hand: an empty scaffold value must read as English, never blank.
    const es = (await import('../src/lib/i18n/locales/es.json')).default as unknown as Record<string, Record<string, string>>;
    const original = es.common.cancel;
    es.common.cancel = '';
    try {
      locale.set('es');
      expect(get(t)('common.cancel')).toBe('Cancel');
    } finally {
      es.common.cancel = original;
    }
  });
});

describe('tn()', () => {
  it('selects the plural form for the count and exposes {count}', () => {
    expect(get(tn)('common.members', 1)).toMatch(/^1 /);
    expect(get(tn)('common.members', 5)).toMatch(/^5 /);
    expect(get(tn)('common.members', 1)).not.toBe(get(tn)('common.members', 5).replace('5', '1'));
  });

  it('uses the active language\'s plural rules, not English\'s: 21 is "one" in Russian, "other" in English', () => {
    locale.set('ru');
    const ru21 = get(tn)('common.members', 21);
    const ru1 = get(tn)('common.members', 1);
    expect(ru21.replace('21', '1')).toBe(ru1);
    locale.set('en');
    expect(get(tn)('common.members', 21).replace('21', '1')).not.toBe(get(tn)('common.members', 1));
  });

  it('returns the key when no plural forms exist for it', () => {
    expect(get(tn)('common.cancel', 2)).toBe('common.cancel');
  });
});
