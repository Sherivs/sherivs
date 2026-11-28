# M2c: override screens, client functions and the permission cache

| Field  | Value                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------ |
| Status | Draft PR stacked on #542 (M2b override kinds); migration NOT APPLIED; nothing runs against a hosted DB |
| Source | Founder instruction 28 Nov 2026 (build the remaining works)                                            |

## Built

- Migration 20261128000400 and rollback: `role_override_create`, `role_override_approve`, `role_override_end`, `role_override_epoch`.
- `effective-permission-cache.ts`, `role-overrides.ts`, `role-overrides.functions.ts`, `role-overrides-screen.tsx`, card registry section `role-overrides`.
- Harness `m2c-override-functions.local.sql` (19 checks) with a CI step. 27 unit tests. ADR-161.

## Not built

- A pick-list of installed templates, permissions and responsibilities (needs a read function for the installed pack).
- Cache invalidation when a role assignment changes (covered only by the 30-second limit).

## Decisions for Tumi and the founder

- Review the four functions; they change who can change access.
- Confirm that any organization administrator may propose, and that approval by a different administrator is enough.
