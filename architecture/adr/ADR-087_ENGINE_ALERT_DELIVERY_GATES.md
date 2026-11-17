# ADR-087: Owner Alert Delivery Through the JARVIS Channel Gates

| Field                      | Value                                                                                                                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required before deployment)                                                                                                                                                                |
| Date                       | 2026-11-15                                                                                                                                                                                                                 |
| Author                     | Claude Code agent (ENGINE-09 implementation)                                                                                                                                                                               |
| Creator                    | Claude Code agent, mission E-001 (issue #EPIC)                                                                                                                                                                             |
| Mission                    | ENGINE-09 (Owner alert delivery through the JARVIS channel gates)                                                                                                                                                          |
| Capabilities               | Plan which channels an owner alert may use: console always; WhatsApp and voice only with owner enablement and, in live mode, an unexpired named authorization; SMS never                                                   |
| Supersedes-in-part         | None                                                                                                                                                                                                                       |
| Cites                      | [ADR-082](./ADR-082_ENGINE_JARVIS_EXECUTIVE_AUTHORITY.md); [ADR-037](./ADR-037_SV1_JARVIS_INBOX_TO_CHANNEL_ESCALATION.md); [ADR-086](./ADR-086_ENGINE_JARVIS_APPROVAL_BRIDGE.md); `docs/engineering/ENTITY_ENGINE_EPIC.md` |
| Minimal ownership artifact | `frontend/src/lib/jarvis-bridge/alert-delivery.ts`                                                                                                                                                                         |

## Context

ENGINE-04 chooses alert content and channels by severity, including SMS, and lets S1 break quiet hours. The JARVIS ladder (ADR-037) separately gates external contact: test mode by default, per-channel owner enablement, and a recorded live authorization. Using the severity channel list directly would bypass those gates.

## Options

- **A. Let the severity table decide delivery.** Rejected: it ignores owner enablement and live authorization.
- **B. Keep the severity plan for content and apply the ladder gates to its channels.** Chosen.

## Decision

1. The ENGINE-04 plan still decides content, the safe console link, dedupe, rate limit and quiet hours; a refusal there is returned unchanged.
2. Each planned channel is then gated: the console is always in-app; WhatsApp and voice need owner enablement; in live mode they also need an unexpired authorization that names the channel and carries an approval reference and approver; SMS is never deliverable because its activation is an owner decision not yet recorded in the ladder's authorization model.
3. In test mode every external channel goes to a synthetic sink; only live mode resolves a registered contact.
4. Every skipped channel is reported with a code, and each delivery carries an idempotency key per alert and channel.
5. Quiet hours differ by purpose on purpose: an S1 alert still breaks through (ENGINE-04); approvals follow the ladder's quiet-hours rules because they can wait.

## Consequences

- Nothing is sent: this returns a plan for a channel adapter to execute later.
- Under the JARVIS default configuration only the console is used.
- Two quiet-hours representations exist (hour-based for alerts, minute-based for the ladder); unifying them is a later cleanup.

## Verification

- `tests/unit/alert-delivery.test.ts` (10 tests) covers console-only fallback, test sinks, live authorization (missing, expired, expiring now, wrong channel, no reference, no approver), enablement without authorization, SMS never, S3/S4, retained ENGINE-04 rules, the JARVIS default config, and a 1500-case property test.
- Mutation testing: 16 of 16 source mutants killed.
- Not verified: any real channel adapter or delivery.
