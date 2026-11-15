# ADR-083: Playbook runner: wake events to governed steps through the broker

| Field | Value |
|---|---|
| Status | PROPOSED (operator ratification required before deployment) |
| Date | 2026-11-14 |
| Author | Claude Code agent (ENGINE-05 implementation) |
| Creator | Claude Code agent, mission E-001 (issue #n/a) |
| Mission | ENGINE-05 (run a Role Pack's playbooks when an event wakes a context, with every step authorised and recorded) |
| Capabilities | Event-driven agent work (internal and tenant); no connector or channel is activated by this change |
| Supersedes-in-part | None |
| Cites | ADR-078 (role packs, ladder), ADR-080 (Conductor), ADR-081 (tool broker), ADR-082 (JARVIS executive), personal-twin sleep/wake (SV1-TWIN-03) |
| Minimal ownership artifact | `frontend/src/lib/playbook-runner/*` (run state machine and admission, capability bindings, port-based orchestrator) |

## Context

Role Packs declare playbooks (a wake event and an ordered list of capabilities) but nothing ran them. The personal-twin sleep/wake scheduler (TWIN-03) already handles a per-user event queue, kill switches and token windows for personal twins; it does not know Role Pack playbooks, tool steps or approvals. The engine needs a runner that turns a wake into governed work without a second authority path.

### Options considered

- **Option 1, a runner that executes capabilities directly.** Simple, and it bypasses the broker and the ledger. Rejected.
- **Option 2, extend the TWIN-03 scheduler.** It is scoped to personal twins and a fixed event allowlist; widening it risks its guarantees. Rejected for now.
- **Option 3, a separate, port-based runner that routes every step through the existing authority (broker for tools, ladder for internal steps).** Chosen.

## Decision

**Adopt Option 3.**

- **Admission is fail-closed.** A run starts only when: the event was not raised by an agent or twin (no self-waking); no kill switch is engaged; the event names this context and tenant; the context is active; some playbook in the pack declares the event kind; that playbook is under its daily run cap; and the context is under its pack's daily action budget. Each refusal has its own reason.
- **Every step is authorised first.** A capability is bound either to a brokered tool or to an internal handler. Internal handlers are limited to T0 and T1 and cannot sit behind a connector, so anything customer-visible, public, financial or production-affecting must be a tool and leave a ledger row. `validateBindings` fails a pack whose capability is unbound, bound to an unknown tool, bound to a tool of another connector, or bound to a tool above its tier.
- **The run stops at the first step that needs a human, is denied, or fails.** A deny aborts the run; a queued approval or sheriff passkey pauses it; shadow and propose-only steps are recorded as not executed and the run continues; a failed step aborts. A stopped run never executes a later step. The kill switch is checked before every step and before every resume.
- **Resuming needs the right approver.** The pending step remembers who must approve (the sheriff for T3). A different approver kind does not resume it; a denial aborts it; an approval runs exactly the pending step with the approval evidence and continues.
- **No double effects.** Each step's idempotency key is `runId:stepIndex`. If the broker reports that step as already decided, the runner does not execute again and records `replayed`, so the owner can reconcile instead of risking a second side effect.
- **Minimal inputs.** A step's arguments are the event's opaque subject reference and correlation id only; free-form event payloads never reach a tool.
- **The shift report holds counts and step outcomes only**, never arguments.
- **Execution is a port.** The runner decides when to act; an adapter performs the call and records its outcome (ENGINE-06). The run state is plain data so it can be persisted; persistence is not built here.

## Consequences

- Positive: playbooks run under the same authority path as everything else; a wake can never start work the pack does not declare; each outward step has a ledger decision; the whole flow is deterministic and testable with in-memory ports.
- **Limit, no scheduler or persistence.** Nothing here triggers a run from a clock or a queue, and run state is not stored. A host must call `admitRun` and `driveRun` and persist the state; wiring to the TWIN-03 scheduler or a durable queue is separate work, and the two must be reconciled rather than run in parallel.
- **Limit, bindings exist only for JARVIS.** The tenant and department packs have no binding tables yet; each needs one and must pass `validateBindings` before it runs.
- **Limit, internal handlers are ports.** The handlers (observe, assess, coordinate, demote, pause, draft) are injected; their real implementations are separate work.
- **Limit, replay is conservative.** A crash between a decision and its execution leaves a replayed step that is reported, not retried.
- **Owner actions:** none beyond ratifying the stop-on-deny and stop-on-failure policy.

## Verification

- Unit: `tests/unit/playbook-runner.test.ts` (16): binding validation, ten admission refusals, end-to-end run, shadow run, internal approval and resume, T3 sheriff resume, denied approval, broker denial, kill switch (during a run and on resume), budget, failure, replay, and a 1500-run seeded property test (T3 executes only with sheriff evidence; every executed tool has an allowing ledger decision; a deny is the last recorded step; actions never exceed the budget).
- Mutation: 19 source mutants (admission checks, per-step kill switch, budget, deny handling, approval gate, replay guard, approver check, denial handling, failure handling, internal gating, resume kill switch, approval evidence, binding checks) were each caught; one survivor (kill switch on resume) led to a new test and is now caught.
- Static: `tsc` and eslint 0 errors.
- Not verified here: a scheduler, persistence, a real adapter, CI on the final branch.
