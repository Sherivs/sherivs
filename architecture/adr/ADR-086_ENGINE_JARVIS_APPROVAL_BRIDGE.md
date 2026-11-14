# ADR-086: Playbook Runner to JARVIS Approval Inbox Bridge

| Field                      | Value                                                                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required before deployment)                                                                                                                                                         |
| Date                       | 2026-11-15                                                                                                                                                                                                          |
| Author                     | Claude Code agent (ENGINE-08 implementation)                                                                                                                                                                        |
| Creator                    | Claude Code agent, mission E-001 (issue #EPIC)                                                                                                                                                                      |
| Mission                    | ENGINE-08 (Restack: playbook runner approval gates through the JARVIS durable approval inbox)                                                                                                                       |
| Capabilities               | Raise and resolve JARVIS inbox approvals for steps a playbook run is waiting on; tier-equal action map; single-use consumption after kill-switch, role and precondition checks                                      |
| Supersedes-in-part         | None                                                                                                                                                                                                                |
| Cites                      | [ADR-083](./ADR-083_ENGINE_PLAYBOOK_RUNNER.md); [ADR-036](./ADR-036_SV1_JARVIS_DURABLE_APPROVAL_INBOX.md); [ADR-037](./ADR-037_SV1_JARVIS_INBOX_TO_CHANNEL_ESCALATION.md); `docs/engineering/ENTITY_ENGINE_EPIC.md` |
| Minimal ownership artifact | `frontend/src/lib/jarvis-bridge/approval-bridge.server.ts`                                                                                                                                                          |

## Context

ENGINE-05 stops a run at a step that needs a human but defined no approval channel, while the JARVIS stack (ADR-036, ADR-037) already provides a durable inbox with expiry, replay protection, human-only decisions, passkey step-up for T3, and a channel escalation ladder. Two approval mechanisms would give two places to get approval wrong.

## Options

- **A. Keep a second approval store inside the runner.** Rejected.
- **B. Bridge the runner to the JARVIS inbox and add no authority.** Chosen.

## Decision

1. Only capabilities with an explicit mapping to a JARVIS risk-policy action of the SAME tier are bridgeable; anything else (for example public social posts) cannot be approved and the run stays unapprovable.
2. Raising a request is idempotent per run and step, is bound to the ledger decision id and to a digest of the step arguments, names the agent as requester and the tenant as platform, and clamps lifetime to the inbox maximum.
3. The inbox alone decides who may approve: verified humans only, never the agent, phone channels cannot approve, and T3 needs a sheriff with passkey step-up.
4. Resuming applies the verdict in a fixed order: a denial, expiry or already-used approval aborts the run; the kill switch is checked next; then the approver role must equal the role the step requires; only then is the single-use approval consumed, with preconditions re-checked against the current arguments, and the runner resumes.
5. The escalation ladder (ADR-037) plans delivery for bridged requests unchanged; live outbound channels remain off until the owner authorizes them.

## Consequences

- This branch carries the JARVIS stack (ADR-036 to ADR-040) merged in; the bridge files are the only new code. Merge the JARVIS stack first and the diff reduces to the bridge.
- A tenant role_owner approval is not supported here because the inbox is the platform inbox.
- Persistence of the inbox (the JARVIS-02 migration) is still unapplied.

## Verification

- `tests/unit/jarvis-bridge.test.ts` (20 tests) runs against the real inbox and ladder: approve, deny, expiry, replay, wrong role, phone channel, no passkey, AI identity, self-approval, kill switch, changed arguments, cross-run isolation.
- Mutation testing: 31 of 33 source mutants killed. The two survivors are equivalent (a redundant guard that the action-map validation also enforces, and an evidence field that the earlier role check makes identical).
- Not verified: the inbox against a real database, or any live delivery channel.
