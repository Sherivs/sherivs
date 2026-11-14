# ADR-076: Private-by-default privileges for new public objects (proposal)

| Field                      | Value                                                                             |
| -------------------------- | --------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required before deployment)                       |
| Date                       | 2026-11-13                                                                        |
| Author                     | Claude Code agent (R-006 implementation)                                          |
| Creator                    | Claude Code agent, mission R-006 (issue #357)                                     |
| Mission                    | R-006 (audit finding R-06, default privileges on schema public)                   |
| Capabilities               | Database least privilege                                                          |
| Supersedes-in-part         | None                                                                              |
| Cites                      | ADR-069 (SEC-02 privilege hardening), audit findings R-05 and R-06                |
| Minimal ownership artifact | database/proposals/20261105009000_sherivs_sec03_private_by_default_privileges.sql |

## Context

A read-only query of production `pg_default_acl` (2026-11-14) shows that objects the role postgres creates in schema public are granted to anon and authenticated by default: tables and views get select, insert, update, delete, references, trigger and maintain; sequences get usage, select and update. That default is the root cause of the SEC-02 defects: a new view was writable by authenticated and ledger views were writable by anon until each was revoked by hand. Every migration author must remember to revoke, and one miss ships an open object.

## Decision

Recommend changing the default so new tables, views and sequences created by postgres in schema public are private to postgres and service_role, and every migration grants explicitly what it means to expose. The change is two `ALTER DEFAULT PRIVILEGES ... REVOKE ALL` statements, shipped as a proposal file outside the migrations directory (database/proposals) so no tool applies it, with a rollback and a local harness. It must be applied last, after every pending migration, because a pending migration that creates an object and relies on the implicit grant would lose it. Functions are deliberately not covered: PostgreSQL gives PUBLIC execute on every new function and a schema-scoped default cannot remove it, while a global revoke would also change extension-created functions. Function exposure stays governed per migration and by the SEC-03 allow-list work (audit finding R-05). Objects created by supabase_admin follow a separate default that this does not change. Proposed, not applied.

## Consequences

After the change a new object is invisible to clients until a migration grants it, which turns the silent failure mode (open by mistake) into a loud one (missing grant, caught by the harness or the first test). Existing objects keep their privileges. Dashboard-created tables (supabase_admin) are unaffected. The owner must decide: approve and apply last on staging then production, or keep the current default and rely on the per-migration revoke discipline. A CI check that every new table in a migration has an explicit grant or revoke is a useful companion and is not built here.

## Verification

Local PostgreSQL 16: `tests/integration/sec03-default-privileges.local.sql` (rolled back) recreates the audited default, proves a new table, view and sequence are open before and private after (applied twice), service_role keeps its rights, objects created before keep exactly their old privileges, an explicit grant gives exactly the named rights, other schemas are unaffected, the per-function revoke pattern works, rollback restores the open default and roll-forward closes it again. Three mutants caught (table revoke narrowed, service_role also revoked, sequence revoke narrowed). Unit `sec03-default-privileges-proposal.test.ts` (5). Not run on PostgreSQL 17 CI (billing hold) or against production, and the harness does not cover supabase_admin-owned defaults.
