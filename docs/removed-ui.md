# Removed UI (not deleted for good — just decluttered)

These pieces were removed because they rendered but did nothing (no click handler) or showed
fake/hardcoded data left over from early mockup work, before real auth and a real database
existed. Listed here so they're easy to reintroduce properly once there's a real feature behind
them, instead of rebuilding from scratch.

## Removed entirely

- **`app/src/lib/components/FilterBar.svelte`** (deleted, was rendered above the Board in
  `App.svelte`) — "Assignee"/"Label"/"Priority" filter chips, "Add filter", "Group by Epic",
  and a grid/lines density toggle. None of it touched any store or filtered `Board.svelte`'s
  issue list — purely decorative. Re-add once the board actually supports filtering/grouping
  (there's already a `SavedView`/query domain type this could hook into).

## Trimmed within existing components

- **Roadmap / Reports / Docs nav items** (`TopBar.svelte`, `Sidebar.svelte`) — routed to
  `view: null`, i.e. clicking did nothing. Remove this note once those views actually exist
  and route somewhere.
- **Fake team avatar stack** (`TopBar.svelte`) — hardcoded `teamIds` (`u_jordan`, `u_mina`,
  etc.) that don't exist in the real database (only real signed-up users do now). Re-add as
  "who's active/assigned in this sprint" once there's more than one real user to show.
- **Fake sprint burndown widget** (`TopBar.svelte`) — hardcoded SVG sparkline plus static
  "4 days left" / "38 / 55 pts done" text, not derived from any sprint data. A real version
  would compute this from `Sprint`/`Issue.storyPoints`/`Issue.statusId` for the active sprint.
  and "· Checkout Revamp" hardcoded breadcrumb suffix.
- **Hardcoded "6 members" workspace subtitle** (`Sidebar.svelte`) — replaced with a real count
  derived from `$users.length`.
- **Hardcoded "Leon Slavin"/`u_leon` footer & search icon button** (`Sidebar.svelte`,
  `TopBar.svelte`) — the sidebar footer now shows the real `$currentUser`; the search button
  had no handler at all and was removed (re-add once there's an actual search feature).
- **Fake multi-project sidebar list** (`Sidebar.svelte`) — previously hardcoded "Nimbus —
  Onboarding", "Forge — Internal Tools", "Vault — Compliance" entries with no matching data or
  click handler. **Resolved**: the sidebar now lists real projects from the `$projects` store,
  supports switching between them, and has a working "create project" form (name/key). Kept
  here as a changelog note rather than a still-open gap.
