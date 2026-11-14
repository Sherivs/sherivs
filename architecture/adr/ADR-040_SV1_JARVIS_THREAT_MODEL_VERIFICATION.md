# ADR-040: SV1 JARVIS Threat-Model Verification

| Field                      | Value                                                                                                                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator review of the evidence pack required)                                                                                                                                             |
| Date                       | 2026-11-13                                                                                                                                                                                           |
| Author                     | Claude Code agent (SV1-JARVIS-06 implementation)                                                                                                                                                     |
| Creator                    | Claude Code agent, mission J-006 (issue #296)                                                                                                                                                        |
| Mission                    | SV1-JARVIS-06 (verify JARVIS security and escalation invariants)                                                                                                                                     |
| Capabilities               | ADR-035 to ADR-039                                                                                                                                                                                   |
| Supersedes-in-part         | None                                                                                                                                                                                                 |
| Cites                      | [J0 threat model](../../docs/jarvis/J0-inventory-gap-and-threat-model.md); [evidence pack](../../docs/jarvis/J6-verification-evidence.md); [ADR-036](./ADR-036_SV1_JARVIS_DURABLE_APPROVAL_INBOX.md) |
| Minimal ownership artifact | `tests/unit/jarvis-threat-model-verification.test.ts` and `docs/jarvis/J6-verification-evidence.md`; no runtime code, no migration                                                                   |

## Context

The J0 threat model lists ten threats. JARVIS-01 to JARVIS-05 add contracts that claim to address them. Without a combined check, a regression in one module could silently reopen a threat that another module assumed was closed.

## Decision

Keep one test block per J0 threat row, composing the real contracts end to end, plus a coverage test that fails if the J0 table gains or loses a row without a matching block. Record, per row, what is proven and what is not (the gaps), in an evidence pack. Prove kill switch and budget end to end. Use mutation checks across modules to show the tests detect a weakening.

## Consequences

- Positive: a weakening in any layer (passkey requirement, phone-approval block, replay guard, T4 denial, signature check, budget, playbook declaration) fails a test.
- Honest limit: this verifies contracts, not deployments. Ingestion adapters, the passkey ceremony, persistence of controls, senders and the hash-linked audit write are not built and are listed as gaps per row.

## Verification

24 tests in the verification file pass locally; the seven cross-module mutations in the evidence pack each fail at least one test.
