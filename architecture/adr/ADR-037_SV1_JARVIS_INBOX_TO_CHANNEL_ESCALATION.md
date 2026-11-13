# ADR-037: SV1 JARVIS Inbox-to-Channel Escalation

| Field                      | Value                                                                                                                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required; no external channel is enabled by this change)                                                                                                                       |
| Date                       | 2026-11-13                                                                                                                                                                                                     |
| Author                     | Claude Code agent (SV1-JARVIS-03 implementation)                                                                                                                                                               |
| Creator                    | Claude Code agent, mission J-003 (issue #291)                                                                                                                                                                  |
| Mission                    | SV1-JARVIS-03 (governed inbox-to-channel escalation)                                                                                                                                                           |
| Capabilities               | ADR-036 approval inbox (PR #362); ADR-035 risk policy                                                                                                                                                          |
| Supersedes-in-part         | None                                                                                                                                                                                                           |
| Cites                      | [ADR-036](./ADR-036_SV1_JARVIS_DURABLE_APPROVAL_INBOX.md); [ADR-035](./ADR-035_SV1_JARVIS_GOVERNED_AGENT_REGISTRY_AND_RISK_POLICY.md); [V1 scope lock](../../docs/v1/V1-SCOPE-LOCK.md); AGENTS.md §§13, 16, 21 |
| Minimal ownership artifact | `frontend/src/lib/jarvis/inbox-escalation.ts`; no migration, no new table, no sender                                                                                                                           |

## Context

An approval waiting in the console inbox may need a nudge on WhatsApp or by voice. The J0 threat model forbids autonomous external sends, forbids phone approval of T3, and requires spoofed inbound calls and messages to be rejected.

## Decision

Add a pure planner and an inbound verifier. They hold no credentials and perform no I/O, so this change cannot contact anyone.

- Ladder: console inbox first (always), then WhatsApp, then voice. Each rung has a minimum delay after the previous attempt. One attempt per rung (idempotency key `approvalId:channel`).
- Test mode (the default) sends external rungs only to synthetic sinks (`test-sink:<channel>`) and never resolves a real contact, even when a live authorization is present.
- Live mode plans a real contact only with all of: owner enablement for the channel, and a recorded, unexpired human outbound authorization naming that channel. Otherwise the rung is skipped with a typed code.
- Quiet hours defer external rungs to the end of the window (never the console). If the window outlasts the request, the ladder stops.
- The ladder stops on acknowledge, deny, approval, or expiry.
- Inbound replies are accepted only when the provider signature check passed, the one-time challenge digest matches for that approval and channel, the challenge is unexpired and unused, and the sender equals the contact bound to the challenge. In test mode the sender must be a synthetic sink. A reply maps to acknowledge or deny only; an "approve" reply is recorded as an acknowledgement, and the approval inbox (ADR-036) refuses phone approval regardless.

## Consequences

- Positive: the safety properties are testable offline and fail closed; mutating any of them breaks a test.
- Not done here (follow-ups): the sender adapters (WhatsApp, Africa's Talking voice), persistence of attempts and challenges (a table would use the reserved block `20261103170000`-`20261103170999`; none is created now), the provider webhook that computes `signatureValid`, and the CORE-19 tenant-scoped delivery integration (this ladder is platform-scoped).

## Verification

`tests/unit/jarvis-inbox-escalation.test.ts` (24 tests, including a send-free source check). Mutation checks: removing the test-sink routing, the live authorization check, the signature check, the quiet-hours check, or the approve-to-acknowledge mapping each makes tests fail.
