# ADR-106: Every Workspace Card Is a Contract

| Field                      | Value                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (founder approval required; the route migration is NOT APPLIED)                                                  |
| Date                       | 2026-11-17                                                                                                                |
| Author                     | Claude Code agent (mission M3 implementation)                                                                             |
| Creator                    | Claude Code agent, mission E-008 (M3 card registry and honest routing)                                                    |
| Mission                    | M3 (card registry and real routing), master brief §4.3, §7.4, §12.1                                                       |
| Capabilities               | One registry entry per card; live cards open their real screen; planned cards say so honestly; unknown keys are not found |
| Cites                      | [ADR-101](./ADR-101_SEC_M0_ANONYMOUS_SURFACE_AND_PRIVATE_BY_DEFAULT.md); migrations UX1, UX2, UX3 (20261025100210-230)    |
| Minimal ownership artifact | `frontend/src/lib/shell/card-registry.ts`                                                                                 |

## Context

`public.workspace_item_catalog` holds 107 cards (28 nav, 49 widgets, 25 actions, 5 inboxes; read-only query on production, 2026-11-17). Their `route` column still names the portal pages that were removed. The shell opens every card at `/home/s/<key>`, and `section-screen.tsx` rendered a real screen for 8 section keys; every other card showed its title, a metric or a generic sentence that read as if the section worked.

## Options

- **A. Keep the generic fallback.** Rejected: a card that looks open but does nothing is product theatre.
- **B. Hide every card without a screen.** Rejected for now: 105 of the 107 catalogue cards have no screen, so most homes would be empty. It is a founder decision (previews flag), not an engineering one.
- **C. A typed registry: every key declares its screen, server functions, tables, permissions, scope dimensions, audit events, offline support and status (`live` or `planned`).** Chosen.

## Decision

1. `frontend/src/lib/shell/card-registry.ts` has exactly one entry per catalogue key and per shell section. A `live` entry carries a lazy screen loader (screens stay out of the `/home` static bundle). A `planned` entry carries no screen, no server functions and no tables, and copies its permissions and scope dimensions from the catalogue.
2. `section-screen.tsx` dispatches through the registry only: `live` renders the screen, `planned` renders `PlannedCapabilityState` (planned status in words, one sentence on what it will do, no fake data or actions; a figure only when the server returned one), and an unknown key renders a not-found state.
3. `tests/unit/card-registry-coverage.test.ts` fails when a catalogue key (from a checked-in production snapshot) has no entry, when a `live` entry has no screen or no test that references its screen module, or when a `planned` entry claims a screen, functions or tables. The test proves itself with fake keys.
4. Migration `20261117001200_sherivs_m3_workspace_item_routes.sql` (NOT APPLIED) moves every `route` to its shell route and keeps the previous value in `legacy_route`; the rollback restores it exactly. No grant or policy changes. The client keeps deduplicating cards and matching notification links on the legacy destination.
5. A screen becomes `live` only in the same change that adds it, its server functions and its tests.

## Consequences

- The 9 live keys (`roles`, `agents`, `role-packets`, `workspace-policies`, `school_setup`, `communications`, `students`, `nav.students`, `nav.reports`) behave as before; their screens now load lazily behind a short loading state.
- 105 catalogue cards now say plainly that they are planned. `nav.roles` stays planned: the role screen is reached through the `roles` section, as before.
- **Not done: hiding planned cards from manifests unless previews are enabled.** The manifest is built in two places (the SQL `workspace_manifest()` function, which is the authority, and the client mirror `computeWorkspace()`), with presentation filters in the shell on top. There is no single place to add the rule, and hiding 105 of 107 cards changes every home. It needs a founder decision on the previews flag and a migration of `workspace_manifest()`.
- Not done: §7.4's stricter rule that every card enabled in a published pack has a `live` screen. It cannot pass until the screens are built (M7 onward).
- The client catalogue mirror (`catalog.data.ts`, generated) keeps the legacy routes as provenance; after the migration the database and the mirror differ in `route` only.

## UNKNOWNs

- Whether any server-side job compares notification `action_url` values to `workspace_item_catalog.route` (none found in the repository).
- The audit event names of the live screens are not catalogued yet; `auditEvents` is empty for every entry.
