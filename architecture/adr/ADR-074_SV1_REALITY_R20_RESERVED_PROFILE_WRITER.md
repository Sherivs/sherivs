# ADR-074: Reserved reality.* profile writer and atomic interview save

| Field                      | Value                                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required before deployment)                                                       |
| Date                       | 2026-11-13                                                                                                        |
| Author                     | Claude Code agent (R-020 implementation)                                                                          |
| Creator                    | Claude Code agent, mission R-020 (issue #357)                                                                     |
| Mission                    | R-020 (SV1-REALITY R20; audit findings R-20 and R-21)                                                             |
| Capabilities               | Tenant data integrity, attestation integrity, concurrency control                                                 |
| Supersedes-in-part         | None                                                                                                              |
| Cites                      | ADR-053 (R3 interview), ADR-054 (R9 website sync), migration 20260907000700 and 20261002000001 (org profile RPCs) |
| Minimal ownership artifact | database/supabase/migrations/20261105000300_sv1_reality_r20_reserved_profile_writer.sql                           |

## Context

The onboarding interview is stored in the generic `cg_org_profile` store under `reality.onboarding_interview`. The generic `upsert_org_profile` RPC lets any tenant administrator write any payload under any key, so an approval (`approvedBy`, `approvedAt`, content hash) could be stored without passing the server engine (audit finding R-20). The server also read the interview, applied a change and wrote it back non-atomically, so two simultaneous requests could lose an update (R-21). R9 publishes website content derived from the approved snapshot, which raised the stakes of an unverified attestation.

## Decision

Reserve the `reality.*` profile-key namespace. A trigger refuses insert, update and delete of those rows unless a transaction-local flag is set, so the generic RPC can no longer write them (renaming a key into or out of the namespace is refused too). The only writer is `upsert_reality_profile(tenant, actor, runtime, key, payload, expected_revision)`, executable by `service_role` only. It re-checks that the named actor is a tenant administrator (same rule as `holds_tenant_role`), requires the namespace, bounds the payload to 256 KiB and performs an atomic compare-and-set on the stored revision under a row lock (SQLSTATE 40001 on conflict). The server functions keep verifying the signed-in administrator and running every change through the pure engine, then call the writer with the verified actor and the revision they loaded; a 40001 becomes a `revision_conflict` outcome. Reads are unchanged. Authored, not applied.

## Consequences

An administrator can no longer store an interview that did not pass the engine, and simultaneous saves are serialised instead of silently overwriting. The interview save now uses the service-role client, so server-side verification of the administrator is the security boundary there (as for other service-role paths). Limit: the flag is transaction-local, so code that can already run SQL with database privileges can still set it; this closes the client-reachable paths, not a database superuser. Existing `reality.*` rows stay readable. The R3 storage harness sets the flag so it keeps testing the generic RPCs. Rolling back re-opens the direct-write path and the server code must be rolled back first.

## Verification

Local PostgreSQL 16 replay of all 170 migrations, then `tests/integration/sv1-reality-r20.local.sql` (31 checks, rolled back): forgery through the generic RPC refused, other keys unaffected, writer denied to authenticated and anon, stale and ahead revisions refused, cross-tenant, non-admin and unknown actors refused, namespace, shape, size and negative-revision checks, flag does not leak, direct DML and renames refused, reads unchanged. Four mutants caught (no trigger, no compare-and-set, no actor check, flag not reset). The R3 storage harness still passes. Unit `reality-r20-reserved-writer.test.ts` (8) with two server-code mutants caught; 185 related unit tests pass. Not exercised with two genuinely concurrent sessions, on PostgreSQL 17 CI (billing hold) or against production.
