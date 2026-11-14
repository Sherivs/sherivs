# ADR-073: DB-12 feature_flags primary key and duplicate teacher_biometrics index

| Field                      | Value                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required before deployment)                                     |
| Date                       | 2026-11-13                                                                                      |
| Author                     | Claude Code agent (DB-12 implementation)                                                        |
| Creator                    | Claude Code agent, mission DB-12 (issue #357)                                                   |
| Mission                    | DB-12 (audit finding R-12, database advisor clean-up)                                           |
| Capabilities               | Database integrity, schema hygiene                                                              |
| Supersedes-in-part         | None                                                                                            |
| Cites                      | ADR-018 fee configuration and flags (migration 20261024000250); Supabase advisors 0004 and 0009 |
| Minimal ownership artifact | database/supabase/migrations/20261105000200_sherivs_db12_flags_pk_and_duplicate_index.sql       |

## Context

Read-only advisor checks on the production database found two structural defects. `public.feature_flags` (9 rows) has no primary key; its only uniqueness rule is the functional unique index `feature_flags_scope` on `(key, coalesce(org_id, zero uuid))`. `public.teacher_biometrics` (0 rows) carries two identical indexes on `(user_id, school_id)`: `idx_teacher_biometrics_user` and `idx_biometrics_user`. The first is harmless in effect but is a missing-key finding that blocks logical replication and some tooling. The second doubles write cost for no read benefit. A primary key on `(key, org_id)` is not possible because `org_id` is nullable (NULL is the platform-wide default).

## Decision

Add a surrogate `id uuid` primary key (`feature_flags_pkey`, default `gen_random_uuid()`) and keep `feature_flags_scope` as the rule that prevents duplicate flags; `flag_set()` relies on it for `ON CONFLICT` inference. Drop `idx_biometrics_user` only after the migration proves it is identical to `idx_teacher_biometrics_user` (columns, operator classes, collation, ordering, uniqueness, predicate and expressions). The migration is idempotent, uses a 5 second lock timeout, and changes no policy, grant, trigger, function or row value. A matching rollback restores the earlier structure. Authored, not applied.

## Consequences

`feature_flags` rows gain a generated id; nothing reads or writes it yet. Write cost on `teacher_biometrics` drops by one index. Applying needs a brief exclusive lock on two tiny tables. Rollback removes the id and recreates the duplicate index. Not applied to production: the owner decides when, staging first.

## Verification

Local PostgreSQL 16 replay of all 169 migrations, then `tests/integration/db12-flags-pk-and-index.local.sql` (rolled back): before state recreated from the rollback, migration applied twice, primary key, distinct ids, scope rule and duplicate refusal intact, flag_set and flag_on unchanged, same three triggers, RLS, grants and policies unchanged, a differently defined or column-swapped index is never dropped, rollback twice, roll forward again. Mutants caught: unguarded drop (two cases), non-primary key, scope index dropped. Unit test `db12-flags-pk-and-index.test.ts` (8) with a mutant caught. Not yet run on PostgreSQL 17 CI (billing hold) or against production.
