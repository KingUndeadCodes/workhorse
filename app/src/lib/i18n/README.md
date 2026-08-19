# i18n

Translation strings live in `locales/*.json`, one file per language. `en.json` is the
source of truth; every other locale must mirror its exact key shape.

## Adding a language

1. Add its id to the `Locale` type and `SUPPORTED_LOCALES` in `index.ts`.
2. Copy `locales/es.json`'s structure into `locales/{id}.json` with every value emptied out —
   or just copy `en.json` and blank the values, keeping the same keys.
3. Import it in `index.ts` and add it to `DICTS`.

A locale file with empty strings is a fully valid, shippable state: `t()`/`tn()` (below) treat
an empty value as "not translated yet" and silently render the English text instead, so the app
stays fully usable while a translation is filled in incrementally.

## Shape

Keys are grouped one namespace per component (`board`, `issueDrawer`, `settings`, ...), plus a
`common` namespace for words reused verbatim across many components (Cancel/Save/Delete/...).
Keys are ordered the same way the text appears in its component, so a translator can read a
namespace top-to-bottom alongside the component and follow along.

A leaf value is either:
- a plain string, consumed via `$t('namespace.key')`, with `{placeholder}` tokens filled in from
  a params object: `$t('issueDrawer.branchCreated', { name: branch.name })`.
- a **plural-forms object**, consumed via `$tn('namespace.key', count)`, e.g.
  `{ "one": "{count} member", "other": "{count} members" }`. The right form for `count` is
  picked with `Intl.PluralRules(locale).select(count)`, not a `count === 1` ternary — languages
  don't all split on the same boundary. English/Spanish only need `one`/`other`; Russian needs
  four categories (`one`/`few`/`many`/`other`) with different count boundaries than English's
  two (e.g. 21, 31, 41… are "one" in Russian, like 1, not "other"). Supply whichever categories
  a language's `Intl.PluralRules(locale).resolvedOptions().pluralCategories` actually has.

## Gender-neutral phrasing

The activity feed ("changed the status", "created this issue", ...) describes an action by an
actor whose grammatical gender isn't known at render time. Languages that gender past-tense
verbs (e.g. Russian) use the masculine form as the default — the same convention most
Russian-localized software uses for this, rather than maintaining two gendered variants of every
activity-log string. Languages whose simple past doesn't inflect for subject gender (Spanish)
don't need this at all.

## Verifying a locale file

There's no automated CI check for this yet — before committing a new or edited locale file,
sanity-check it by hand or with a throwaway script:

- Every key in `en.json` exists at the same path in the file you're checking.
- Every `{placeholder}` in an English string appears in the translated string too (same names).
- Plural entries include at least `other`, plus whichever other categories that language uses.
