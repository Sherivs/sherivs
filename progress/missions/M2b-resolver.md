# M2b resolver: overrides change effective permissions

Status: built (database), draft PR, NOT APPLIED. Follows ADR-146 "deliberately left for later".

- Migration `20261127000400_sherivs_m2b_resolver_overrides.sql` replaces `workspace_effective_permission_rows_at` (rollback restores the previous body). An approved, in-force `add_optional_permission` override grants that permission to every role built on the template; an approved, in-force `remove_optional_permission` removes an optional one. Mandatory permissions are never removed. Overrides are per organisation. With no overrides the result is unchanged.
- Harness `tests/integration/m2b-resolver-overrides.local.sql`: 14 checks pass (unapproved does nothing, approval, start and end window, organisation isolation, mandatory survives, other templates untouched). Registered in verify.yml.
- Not applied by the resolver: rename, enable, disable, scope_narrow, approval_limit, add_responsibility. `scope_narrow` and `approval_limit` change what a holder may do inside a check and need design with the approval functions.
- Not built: the TypeScript session cache (invalidation on override change is the hard part and the database is the authority today; a cache is an optimisation).
- Not run: the full sim-lab scenario set against this change. Run it on the preview before any apply.
- Needs: founder approval and a backup before any apply; Tumi's review, because this changes who can do what.
