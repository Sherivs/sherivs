# ADR-084: Connector Adapter Framework and Execution Gate

| Field                      | Value                                                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required before deployment)                                                                                                           |
| Date                       | 2026-11-14                                                                                                                                                            |
| Author                     | Claude Code agent (ENGINE-06 implementation)                                                                                                                          |
| Creator                    | Claude Code agent, mission E-001 (issue #EPIC)                                                                                                                        |
| Mission                    | ENGINE-06 (Connector adapter framework: cleared calls only, secret-free results, read-only GitHub adapter)                                                            |
| Capabilities               | Execution gate that re-verifies a cleared ledger decision before any adapter runs; GET-only egress allowlist; read-only GitHub adapter; DB-backed tool ledger adapter |
| Supersedes-in-part         | None                                                                                                                                                                  |
| Cites                      | [ADR-081](./ADR-081_ENGINE_TOOL_BROKER_AND_CONNECTOR_VAULT.md); [ADR-083](./ADR-083_ENGINE_PLAYBOOK_RUNNER.md); `docs/engineering/ENTITY_ENGINE_EPIC.md`              |
| Minimal ownership artifact | `frontend/src/lib/connector-adapters/execution-gate.server.ts`                                                                                                        |

## Context

The broker (ADR-081) decides whether a tool call may run and the runner (ADR-083) drives playbooks, but nothing could yet perform a call. An adapter that decides for itself, or that trusts its caller, would bypass the authority model.

## Options

- **A. Adapters that call the broker themselves.** Rejected: mixes deciding and doing.
- **B. A gate that only executes calls the ledger already cleared, then records the outcome.** Chosen.

## Decision

1. The gate (`executeCleared`) takes a decision id, re-loads the decision from the ledger and re-checks: tool and tier match the registry, the arguments hash to the decision's digest, the verdict is cleared (execute; queue_approval needs an approval reference; sheriff_passkey needs the sheriff), platform-only tools run only in platform contexts, and no earlier success exists.
2. The binding must be active, correctly scoped and not secret-shaped before the secret is resolved. The secret value is used once, scrubbed from the result, and never written to the ledger.
3. Every run records an outcome, and a failure to record is reported loudly (`outcome_unrecorded`). Refusals before clearance write nothing.
4. Egress is HTTPS only, to an allowlist of hosts, with no credentials in the URL and no custom ports. The first adapter is GitHub, GET only, with response fields reduced to an allowlist and a body cap.
5. The DB ledger adapter validates rows with zod and throws on errors so callers fail closed; a unique-violation race returns the winning decision.

## Consequences

- The runner's `execute` port can now be backed by the gate and an adapter.
- No write-capable adapter exists. Adding one needs its own ADR and tests.
- The adapter-level egress wrapper is defence in depth: URLs are built only for api.github.com, so its removal is not observable by a test (the one surviving mutant).

## Verification

- `tests/unit/connector-adapters.test.ts` (25 tests) covers egress blocking, adapter validation and status mapping, the clearance matrix, argument and tier mismatch, binding refusals, secret scrubbing, outcome-unrecorded, a 1500-case property test, the runner end to end, and the DB ledger over a fake client.
- Mutation testing: 28 of 29 source mutants killed; the survivor is the equivalent wrapper noted above.
- Not verified: any live GitHub call, and the DB adapter against a real database.
