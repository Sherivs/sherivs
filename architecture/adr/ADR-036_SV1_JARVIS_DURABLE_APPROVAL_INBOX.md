# ADR-036: SV1 JARVIS Durable Approval Inbox

| Field                      | Value                                                                                                                                                                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification and staging verification required before any migration is applied)                                                                                                                                                                                           |
| Date                       | 2026-11-13                                                                                                                                                                                                                                                                                   |
| Author                     | Claude Code agent (SV1-JARVIS-02 implementation)                                                                                                                                                                                                                                             |
| Creator                    | Claude Code agent, mission J-002 (issue #289)                                                                                                                                                                                                                                                |
| Mission                    | SV1-JARVIS-02 (durable approval inbox and passkey step-up)                                                                                                                                                                                                                                   |
| Capabilities               | JARVIS risk policy (ADR-035, PR #321); platform staff identity (`is_platform_staff`)                                                                                                                                                                                                         |
| Supersedes-in-part         | None                                                                                                                                                                                                                                                                                         |
| Cites                      | [ADR-035](./ADR-035_SV1_JARVIS_GOVERNED_AGENT_REGISTRY_AND_RISK_POLICY.md); [approval chains](../../frontend/src/lib/approval/chains.ts); [V1 scope lock](../../docs/v1/V1-SCOPE-LOCK.md); [J0 threat model](../../docs/jarvis/J0-inventory-gap-and-threat-model.md); AGENTS.md §§13, 16, 21 |
| Minimal ownership artifact | `frontend/src/lib/jarvis/approval-inbox.ts` (contract) and migration `20261103165000` (two tables)                                                                                                                                                                                           |

## Context

ADR-035 defines the T0–T4 policy and requires T3 approval with console passkey step-up, revalidated at execution time, but it does not say where approvals live. Without a durable record an approval cannot expire, cannot be proven single-use, and a phone reply could be mistaken for approval.

## Decision

Persist approval requests and an append-only event log, and keep the laws in both a pure TypeScript contract and the database:

- Only T2/T3 actions use the inbox. T0/T1 need none; T4 and unmapped actions are never approvable.
- Requests carry an expiry (at most 24 hours) and a unique idempotency key. The same key with the same payload returns the original; a different payload is a conflict.
- A request is decided at most once; a replayed decision is rejected.
- Only a verified human decides, never the requesting agent identity.
- Phone and message channels (whatsapp, voice, sms, email) may acknowledge or deny only. Approval is console-only. T3 approval additionally needs a sheriff with passkey step-up.
- Execution revalidates the approval (still approved, unexpired, unused, same action and precondition digest) and consumes it. The returned evidence is exactly what `evaluateJarvisRiskPolicy` requires for the execution phase.
- In PostgreSQL, CHECK constraints and a transition trigger re-enforce the decision shape, terminal states, expiry and single use; events are append-only; RLS is forced, platform staff can read, and only `service_role` writes (with privileges revoked from `anon`, `authenticated` and the default-privilege grants first).

## Options considered

1. Reuse `approval/chains.ts` for T3 (rejected): it models tenant escalation cases and resolver pools, not platform agent proposals with passkey step-up and single-use execution.
2. Keep approvals in memory or in the agent's own store (rejected): not durable, not auditable, and lets the proposer influence its own approval.
3. Chosen: a small dedicated inbox bound to the ADR-035 evidence shape.

## Consequences

- Positive: expired, replayed or precondition-drifted approvals cannot execute; a server bug cannot weaken the core laws because the database enforces them too.
- Not yet done (follow-up, outside this PR): server functions that call the contract using the service role, the console UI that lists the inbox, the passkey step-up ceremony wiring (the contract only records the verified result), the Hermes routing (JARVIS-05), and the escalation channels (JARVIS-03).
- The migration is not applied anywhere except a disposable local database. Production application needs owner approval and a staging run first.

## Verification

Offline unit suite `tests/unit/jarvis-approval-inbox.test.ts`; local PostgreSQL harness `tests/integration/jarvis02-approval-inbox.local.sql`; rollback `database/supabase/rollbacks/20261103165000_sherivs_jarvis02_approval_inbox.sql`.
