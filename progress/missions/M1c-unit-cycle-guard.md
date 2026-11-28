# M1c: unit-tree cycle guard

Closes the gap M1 recorded as "cycles longer than one step in the unit tree are not blocked by a constraint".

## What changed
- `20261128000500_sherivs_m1c_unit_cycle_guard.sql`: a BEFORE INSERT OR UPDATE OF parent_unit_id trigger on `workspace_org_units`. It walks the ancestors of the new parent and refuses the write with SQLSTATE 23514 `m1:unit_cycle` if it meets the unit being written, or `m1:unit_too_deep` past 32 ancestors. A per-organization transaction advisory lock stops two concurrent re-parentings from jointly making a loop. Existing rows are not rewritten.
- Rollback in `database/supabase/rollbacks/` (round-trip proven).
- `tests/integration/m1c-unit-cycle-guard.local.sql` (13 checks) and a verify.yml step.

## Evidence (local PostgreSQL 16, chain of 239 migrations, nothing applied to a hosted database)
13 of 13 checks pass: valid insert and re-parent, clear parent, 2- and 3-level cycles refused, self-parent still refused, cross-organization parent still 23503, depth 32 accepted and 33 refused, function not executable by anon or authenticated, security definer with fixed search_path. Domain-neutrality and provenance verifiers pass.

## Not proven
- Concurrent writers: the advisory lock is by design, but the harness is single-session and does not race two transactions.
- Production data: not read. Before applying, run a read-only ancestry check for existing loops (a loop already present would not be caught by this trigger, only new writes).

## Status
Draft pull request, not applied. Needs founder approval and a backup before any hosted apply.
