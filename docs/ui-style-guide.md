# Workhorse UI Style Guide (Draft)

> **Status: DRAFT — not binding.** These rules are proposed conventions for the app's visual
> design. Nothing in this document is enforced yet (no lint rule, no PR check, no design review
> gate). Treat it as a reference to align around, not a spec anyone is required to follow until
> it's promoted out of draft.

This guide exists to keep the UI (`app/src/`) visually consistent as more surfaces get built
out. Each rule below is stated as a constraint — what to avoid — plus the reasoning and a rough
idea of what to do instead. Add examples/screenshots as real components start following (or
deliberately breaking) these rules.

---

## 1. No harsh gradients

Avoid multi-stop, high-contrast gradients (e.g. bright color A straight into bright color B)
on backgrounds, buttons, or cards. If a gradient is used at all, it should be subtle — small hue
or lightness shift, not a visible "banding" effect.

## 2. No purple or black color scheme

The app's palette should not be built around purple or black as primary/brand colors. This
includes purple-heavy accent colors and black (or near-black) as a primary surface or button
color. Existing `--bg`/`--surface`/`--text` tokens should stay within neutral grays, not slide
toward black-as-a-brand-color.

## 3. No Inter / Geist / Space (Grotesk) fonts

Don't use Inter, Geist, or any Space Grotesk / Space Mono variant as the UI typeface. These are
extremely common defaults (especially in AI-generated or template UIs) and make the app look
generic. Pick something with more character, or at minimum a distinct system-font stack.

## 4. No neon colors

Avoid highly saturated, glowing-looking colors (electric blue, neon green, hot magenta, etc.)
for accents, status indicators, or highlights. Saturated color should be used sparingly and
paired with enough contrast/neutrality around it that it doesn't read as "neon."

## 5. No pastel colors

Avoid washed-out, low-saturation pastel colors as primary UI colors (pastel pink/lavender/mint
card backgrounds, etc.). Colors should read as intentional and legible, not soft/washed out to
the point of low contrast.

## 6. No drop shadows on everything

Drop shadows should not be a default applied broadly to cards, buttons, chips, inputs, etc.
Reserve elevation/shadow (if used at all) for a small number of genuinely elevated surfaces
(e.g. a modal or dropdown menu above page content) — not as a default styling flourish on
every container.

## 7. No leading colored stripe

Avoid using a leading colored stripe (a thin vertical bar on a card or list row's left edge) as
a status/category color indicator. Use the existing patterns instead — a tinted badge/icon, a
border color, or a small dot/swatch — rather than introducing a stripe as a new convention.

## 8. No dot grids

Avoid dot-grid background patterns (the "canvas/whiteboard" dotted background look) as a page
or panel background.

## 9. No em dashes

Avoid em dashes ("—") in UI copy (labels, empty states, tooltips, error messages, etc.). Prefer
a period, comma, colon, or rewriting the sentence. (Note: this is a copy-only rule — it does not
apply to code comments or documentation like this file.)

## 10. No radial orbs

Avoid radial-gradient "glow"/"orb" decorative elements (soft circular blurred color blobs,
often used as background decoration behind hero sections or empty states).

<!--
## 11. Avoid high border radius

Avoid uniform, heavily rounded corners (`rounded-xl`/`rounded-2xl`-equivalent, roughly 12px+)
applied blanket-style to almost every container, input, and button. Corner radius should vary
by element size/role rather than defaulting to one large radius everywhere — small controls
(buttons, inputs, chips) should stay closer to a modest radius, reserving larger radii for
genuinely large surfaces (if used at all).

Commented out for now — general polish preference, not one of the classic AI-generated-UI
tells the rest of this guide targets. Revisit if it turns out to matter for this project.
-->
Rule 11 (border radius) is currently disabled — see the comment in this file's source.

## 12. No marketing-site hero patterns

Avoid centered "hero block" layouts (big bold headline + subtext + centered call-to-action
button) inside the product itself — for empty states, onboarding, dashboards, or any other
in-app surface. That pattern belongs to marketing/landing pages, not a working tool; using it
inside the app is one of the more recognizable signs of an AI-scaffolded UI. Empty states should
stay small, left-aligned, and matter-of-fact (see the existing pattern in
[AgentsSettings.svelte](../app/src/lib/components/AgentsSettings.svelte) — an icon, a short
sentence, done).

## 13. No glassmorphism

Avoid translucent, blurred-background ("frosted glass") panels (`backdrop-filter: blur(...)`
over busy content). Surfaces should be opaque, using the existing `--surface`/`--surface-2`
tokens.

## 14. No staggered mount animations

Avoid entrance animations where a list's items fade/slide in one after another on load or on
every re-render. If motion is used at all, keep it to purposeful micro-interactions (hover,
drag, an explicit state change) — not a decorative flourish that plays every time a view mounts.

## 15. No emoji as UI icons

Don't use emoji characters as icons, bullets, or status indicators in the UI. The app has a real
icon component ([Icon.svelte](../app/src/lib/components/Icon.svelte)) — use that (or add to it)
instead of reaching for an emoji as a shortcut.

## 16. Consistent button hierarchy

Not every button is a bold filled/primary button. Each view or section should have at most one
primary action; everything else should use a secondary/ghost/text treatment (the existing
`.btn.primary` / `.btn.ghost` split in [AgentForm.svelte](../app/src/lib/components/AgentForm.svelte)
is the pattern to follow, not a one-off).

## 17. No generic marketing copy tone

Avoid marketing-voice copy in product text — "Supercharge your workflow," "Unlock powerful
insights," "Effortlessly manage…" and similar. In-app copy should stay plain and specific about
what the thing actually does, matching the app's existing tone (e.g. "No agents yet — create one
below to start automating ticket work").

---

## Open questions / follow-ups

- Rule 3's replacement font has since been decided: Noto Sans, configured via
  [ui.config.json](../app/ui.config.json) (see rule 3 itself, which still just says "not
  Inter/Geist/Space Grotesk" — could be tightened to name Noto Sans as the actual standard).
- This guide currently covers what to avoid; it doesn't yet define the positive system (actual
  palette, spacing scale, type scale). That's a natural next step once these constraints are
  agreed on.
