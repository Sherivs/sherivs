# ADR-053: Reality Engine R3 Adaptive Onboarding Interview

| Field                      | Value                                                                                                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required before deployment)                                                                                                                                                |
| Date                       | 2026-11-13                                                                                                                                                                                                 |
| Author                     | Claude Code agent (SV1-REALITY R3 implementation)                                                                                                                                                          |
| Creator                    | Claude Code agent, mission R-003 (issue #334)                                                                                                                                                              |
| Mission                    | SV1-REALITY R3 (adaptive school-onboarding interview over the R1 registry, #334 (child of #229))                                                                                                           |
| Capabilities               | Scholar runtime, adaptive school onboarding interview (V1; creche, primary, secondary only)                                                                                                                |
| Supersedes-in-part         | None                                                                                                                                                                                                       |
| Cites                      | ADR-051 (R1 registry), `docs/v1/V1-SCOPE-LOCK.md`, `AGENTS.md` §45, existing `get_org_profile` / `upsert_org_profile` RPCs on `cg_org_profile`, `frontend/src/lib/scholar/reality/`                        |
| Minimal ownership artifact | `frontend/src/lib/scholar/reality/interview.ts` (pure engine) with `interview-view.ts`, `interview-form.ts`, `frontend/src/lib/runtime/scholar/reality-interview.functions.ts` and the School setup screen |

## Context

R1 (ADR-051) supplies a question registry and answer-state semantics but stores nothing and has no UI. R3 must let a school administrator answer the registry questions, see only the questions that apply to their institution type, review them, and approve a snapshot that later phases (R9 website sync) may consume. The owner limited V1 to school onboarding, so R3 supports creche, primary and secondary only. The registry also names islamic, special_needs and multi_institution_group; these are refused by the interview, not guessed. No new table is justified: the neutral `cg_org_profile` store already holds per-tenant profile documents behind school-admin and own-tenant gated RPCs.

### Options considered

- **Option 1, new persisted interview tables (rejected):** needs new migrations and RLS, duplicates `cg_org_profile`, and enlarges the reviewed surface.
- **Option 2, pure engine plus the existing profile store (ruled):** deterministic and testable without a database; reuses the audited RPC gates; costs a read-modify-write on one JSON document.

## Decision

**Adopt Option 2.** The interview is a pure module over the R1 registry. State is a single document stored under runtime `runtime:scholar`, profile key `reality.onboarding_interview`, via the existing RPCs; the server functions never accept tenant, state, source or approver from the client.

Invariants:

- Only human-sourced answers are accepted; AI output can never be stored as an answer.
- Unanswered is `unknown`, never "No"; `unknown` is treated as absent in the content hash.
- Visibility is driven by confirmed answers only. Answers that become hidden are kept dormant and are excluded from the review and the approved snapshot.
- Any accepted edit returns the interview to `discovered` and withdraws the approval; an approval is valid only while the content hash it recorded still matches.
- `approvedSnapshot` returns confirmed, visible answers only, and only when the approval is valid. This is the sole intended input for R9.
- Approval is by a school administrator in the interview screen; the approver is the authenticated user id, not client input.
- Parsing a stored document drops invalid, retired and non-human answers with notes and withdraws an invalid approval.

A forward-only migration (with matching rollback) enforces FORCE ROW LEVEL SECURITY on `cg_org_profile` and adds a NOT VALID size CHECK on interview payloads (at most 262144 bytes). It is within the reserved block, and it has not been applied anywhere.

## Consequences

- Positive: no new tables, tenant isolation and role gating are inherited from the existing RPCs, and the engine is fully testable offline.
- **Limit, attestation:** `upsert_org_profile` lets any school administrator of the tenant write any profile key directly, so `approvedBy` and `approvedAt` are not tamper-proof against an administrator calling the RPC directly. The content hash detects drift; it is not a secret. Recommended follow-up (separate reserved migration and owner approval): a reserved-prefix guard so only the interview functions can write this key.
- **Limit, concurrency:** the write is read-modify-write and not atomic; `expectedRevision` only prevents stale screens from overwriting newer answers.
- **Limit, scope:** islamic, special_needs and multi_institution_group are refused. Creche has only core questions because R1 has no early-childhood pack. Repeating-group answers (campuses, premises) are stored as text lists until a structured model is authorized.
- Nothing is merged, applied, deployed or activated by this change. CI is blocked by an organization billing hold, so all evidence is local.

## Verification

- Unit tests: `tests/unit/reality-r3-interview.test.ts` (41) and `tests/unit/reality-r3-ui.test.tsx` (22), 63 passing, including seeded property tests and mutation checks (break, confirm failure, restore).
- Database harness `tests/integration/sv1-reality-r3.local.sql` against a disposable local PostgreSQL 16 replay: all checks pass (table posture, tenant isolation through the RPCs, teacher and anonymous denial, no direct table access, size bound); six database mutants were caught. Output is in `docs/evidence/r3/`.
- Migration and rollback round trip recorded in `docs/evidence/r3/migration-roundtrip.txt`.
- UI states captured at 1440 and 390 px from a local demo fixture, not production data.
- After the billing hold is cleared, re-run all checks on the draft pull request.
