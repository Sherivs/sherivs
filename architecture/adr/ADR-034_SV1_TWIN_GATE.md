# ADR-034: SV1 Personal Twin Isolation, Injection and Audit Gate

| Field                      | Value                                                                                                                                                                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required before deployment)                                                                                                                                                                                                             |
| Date                       | 2026-11-13                                                                                                                                                                                                                                                              |
| Author                     | Claude Code agent (SV1-TWIN-06 implementation)                                                                                                                                                                                                                          |
| Creator                    | Claude Code agent, mission T-006 (issue #295)                                                                                                                                                                                                                           |
| Mission                    | SV1-TWIN-06 (T6 gate: isolation, prompt-injection and audit-completeness evidence, plus a cost report)                                                                                                                                                                  |
| Capabilities               | TWIN-01 provisioning (ADR-029); TWIN-02 role lenses (ADR-030); TWIN-03 sleep/wake (ADR-031); TWIN-04 proposals (ADR-032); TWIN-05 assistant panel (ADR-033)                                                                                                             |
| Supersedes-in-part         | None                                                                                                                                                                                                                                                                    |
| Cites                      | [ADR-029](./ADR-029_SV1_TWIN_PERSONAL_PROVISIONING.md); [ADR-030](./ADR-030_SV1_TWIN_ROLE_LENSES.md); [ADR-031](./ADR-031_SV1_TWIN_SLEEP_WAKE.md); [ADR-032](./ADR-032_SV1_TWIN_PROPOSALS.md); [ADR-033](./ADR-033_SV1_TWIN_ASSISTANT_PANEL.md); AGENTS.md §§13, 16, 21 |
| Minimal ownership artifact | `tests/unit/sv1-twin-gate.test.ts`, `tests/integration/sv1-twin-gate.local.sql`, `scripts/twin-cost-report.ts`, `docs/evidence/twin-06/`                                                                                                                                |

## Context

TWIN-01..05 each carry their own tests. The T6 gate asks a different question of the whole set: can one tenant, user or role reach another's twin; can text inside a record, message or model output widen scope or trigger an action; and does every twin action leave an audit record. It also asks what the twin costs. Running the gate found that rejected decisions (proposals) and rejected requests (sleep/wake) were not audited, and that the sleep/wake audit list has no cap.

## Decision

1. Add a gate suite over the pure modules: an isolation battery (seeded random sequences across tenants, users and role lenses), a prompt-injection differential suite (the same scenario with benign text and with 14 hostile payloads must give identical decisions, statuses, permissions and audit, field by field), and an audit-completeness suite covering 47 call shapes, successful and refused.
2. Add an export-coverage guard: every exported function in every twin module must be classified (audited, pure read, or own record); a new export or a new module fails the test until it is classified.
3. Fix the gaps the gate found in the modules: rejected approve/dismiss/acknowledge/handoff/outcome calls and rejected sleep/wake requests now append an audit record (new audit kind `request_rejected`).
4. Add a local database harness that checks provisioning audit rows, cross-tenant and cross-user isolation, privileges, RLS and grants on a disposable database only (guarded by `coregrid.test_disposable_database`), ending in ROLLBACK.
5. Add a module-level cost script. It measures time, audit records and state size. It does not and cannot measure model or token cost, because the modules contain no gateway.
6. Record, not hide, two limits: lens switches emit no audit record (the lens module is stateless, so the host must audit), and the sleep/wake audit list is unbounded in memory.

## Consequences

- The gate runs without a database or network and is deterministic (fixed seeds).
- Budget thresholds in the default config remain proposals for the owner to approve; the gate does not set them.
- Host integration must (a) audit lens switches, (b) persist and trim sleep/wake audit records (about 1.9 MB per 1,000 wakes in memory), and (c) measure real gateway cost once a gateway exists.
- The database harness has only been run on a local disposable database. Nothing was applied to staging or production. CI is blocked by the organisation billing hold, so all evidence is local until checks are re-run.
- The new `request_rejected` audit kind adds records on refusal paths; consumers of the audit list that switch on kind must handle it.

## Verification

- `npx vitest run tests/unit/sv1-twin-gate.test.ts`: 26 tests pass; 9 deliberate code mutants (owner, tenant, permission, lens widening, two missing audits, undeclared operation, event allowlist, twin source) each make it fail.
- Existing twin suites (121 tests) still pass after the audit changes.
- Local database harness: ALL PASS; 9 database mutants caught.
- Evidence: `docs/evidence/twin-06/` (cost report, mutation results, harness output).
