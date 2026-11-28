# ADR-161: Role Override Screens, Client Functions and a Session Permission Cache (M2c)

| Field                      | Value                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (the migration is not applied; founder approval and a backup are needed first; Tumi reviews it because it changes who can change access) |
| Date                       | 2026-11-28                                                                                                                                        |
| Author                     | Claude Code agent (task 188)                                                                                                                      |
| Creator                    | Claude Code agent, mission M2c (override screens and cache)                                                                                       |
| Origin                     | Founder instruction 28 Nov 2026 (build the remaining works); the "not built" list of PR #542                                                      |
| Mission                    | M2c, gap W-025                                                                                                                                    |
| Capabilities               | Propose, approve and end a tenant role override as the caller; an override epoch; a session cache of effective permissions; one screen            |
| Cites                      | ADR-146, ADR-159, ADR-121                                                                                                                         |
| Minimal ownership artifact | `database/supabase/migrations/20261128000400_sherivs_m2c_override_functions.sql`                                                                  |

## Context

`tenant_role_overrides` is readable by the organization's administrators but writable only by the service role. M2b (ADR-146, ADR-159) made the resolver honour eight override kinds, yet no administrator could create or approve one without the service role. Two parts were listed as not built: a TypeScript cache of effective permissions with invalidation, and screens for creating overrides.

## Options

- **A. Let administrators write the table directly (an INSERT and UPDATE policy).** Rejected: it would spread the four-eyes and organization rules over policies and the guard trigger, and give the client every column.
- **B. Call the service role from a server function.** Rejected: the service role would then stand in for the caller, and the guard's `auth.uid()` rules (the creator is the caller, the approver is the caller) would not apply.
- **C. Four SECURITY DEFINER functions that run as the caller.** Chosen. The organization comes from `get_my_school_id()`, only an organization administrator may propose, approve or end, and the existing guard and audit triggers decide everything else.

## Decision

1. `role_override_create`, `role_override_approve` and `role_override_end` (authenticated and service_role only; none for anon). Approving needs a second administrator; the guard refuses the creator. Ending sets `effective_to`; the row stays as history. Approving an ended or already approved override is refused.
2. `role_override_epoch()` returns an opaque string for the caller's organization (counts of overrides, approvals and ended windows, plus the latest change time). Any member may read it; it says nothing about what changed.
3. `EffectivePermissionCache` keeps `effective_permissions` per organization and user for 30 seconds, and drops an entry when the epoch moves. Every override change made through the server functions also drops the whole organization. When the epoch cannot be read it reloads; when the reload fails it throws and serves nothing stale.
4. A screen at `role-overrides` in the shell (administrators only) with the form per kind, the list with state (pending, scheduled, in force, ended), approve, and end or withdraw. The proposer's own approve button is disabled and explained.

## Consequences

- A change to a role assignment moves no epoch, so a revoked person may keep stale rows here for up to 30 seconds. Callers that need an immediate answer call `invalidateUser`. The same limit covers an override window that ends on the clock.
- The cache is per server process. With several processes, each learns of a change through the epoch check, not through a message.
- The screen asks for a template code as text; a pick-list needs a read function for the installed pack, which is not built.
- Nothing is applied to a hosted database. The migration depends on the M2 engine and on PR #542.

## Verification

- 19 database checks (`tests/integration/m2c-override-functions.local.sql`, CI step added).
- 27 unit tests: cache (10), handlers and schemas (12), screen and registry (5). The card registry coverage and dispatch tests include the new section.
