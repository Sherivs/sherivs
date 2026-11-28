# ADR-159: M2b Override Kinds Applied by the Resolver

- Creator: Claude Code agent, mission M2b (remaining override kinds) (provenance id W-023); AI-generated
- Origin: Mission: W-023; Authority: ADR-146 section 7.3 (tenant overrides) and the M2b resolver note (ADR-146 "deliberately left for later")

- Status: PROPOSED. Migration not applied anywhere. Builds on the M2b resolver (PR #532). Needs a backup and Tumi's review.
- Date: 2026-11-28

## Context

The M2b resolver applies only `add_optional_permission` and `remove_optional_permission`. The guard already accepts six more override kinds, approved by a second person, but they changed nothing. An organization could approve a `disable` and see no effect.

## Decision

1. `disable` / `enable`: a template is off in an organization from the latest approved, in-force `disable` until a later approved `enable`. On a tie the disable wins. A disabled template's roles yield no permission rows.
2. `scope_narrow`: an assignment held at a broader scope than the override's scope yields no rows (fail closed) until the person is assigned again at the narrower scope. Assignment rows are never rewritten. An unrecognised scope counts as the broadest. An assignment that carries scope sets keeps only the sets that name a campus or a class narrow enough; a set with only other dimensions (shift, section, gender, level, subject, house, hostel) does not satisfy a narrowing, and an assignment left with no satisfying set yields no rows.
3. `add_responsibility`: the installed pack's responsibility permissions are granted to roles of the template. A protected permission is never granted this way, even if the pack lists one.
4. `approval_limit`: new `workspace_effective_approval_limit(org, user)` returns the template ceiling lowered by the lowest in-force approved override, never raised, and null for a template with no approval authority. `school_expenses_sod_guard` now reads it instead of the raw template ceiling.
5. `rename`: new `workspace_role_display_name(org, role)` returns the approved name, else the catalog name, for members of the organization and the service role only. Display only; it never affects permissions.
6. Helper functions are SECURITY DEFINER with an empty search_path and callable by no client role; only the display-name function is open, to signed-in members and the service role.

## Consequences

- Rollback restores the M2b resolver and the previous expense guard, and refuses (`55000`) while any approved override of these six kinds exists, because they would stop applying and widen access.
- Disabling a template or narrowing a scope removes access immediately for current holders. Narrowing needs holders re-assigned at the narrower scope first; this is intended and visible.
- The expense guard now counts only assignments inside their start and end dates when finding the limit (before: any active assignment). The permission check it already made did the same.
- A user approving expenses through the legacy admin path (no role assignment) is unaffected, as before.
- Only campus and class are placed on the scope hierarchy for scope sets; if the other dimensions should rank (for example level or section), that mapping is a product decision for Tumi.
- Not built: the TypeScript session cache, screens for creating overrides.
