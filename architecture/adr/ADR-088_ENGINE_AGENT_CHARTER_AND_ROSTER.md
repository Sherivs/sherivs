# ADR-088: Agent Charter and Roster Validation

| Field                      | Value                                                                                                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required before deployment)                                                                                                                                                                  |
| Date                       | 2026-11-15                                                                                                                                                                                                                   |
| Author                     | Claude Code agent (ENGINE-10 implementation)                                                                                                                                                                                 |
| Creator                    | Claude Code agent, mission E-001 (issue #EPIC)                                                                                                                                                                               |
| Mission                    | ENGINE-10 (Agent Charter v1 and roster rules)                                                                                                                                                                                |
| Capabilities               | Validate a per-agent charter against its Role Pack, and the whole roster for ownership, supervision and independence                                                                                                         |
| Supersedes-in-part         | None                                                                                                                                                                                                                         |
| Cites                      | [ADR-078](./ADR-078_ENGINE_ROLE_PACKS_AND_EARNED_AUTONOMY.md); [ADR-082](./ADR-082_ENGINE_JARVIS_EXECUTIVE_AUTHORITY.md); [ADR-086](./ADR-086_ENGINE_JARVIS_APPROVAL_BRIDGE.md); `docs/engineering/AGENT_WORKFORCE_AUDIT.md` |
| Minimal ownership artifact | `frontend/src/lib/workforce-charter/charter.ts`                                                                                                                                                                              |

## Context

A Role Pack says what an agent may do. It does not say who is accountable, who supervises, how quality is measured, or which agent owns a shared high-impact request. The audit found T3 capabilities duplicated across packs and no independent checker.

## Options

- **A. Rely on pack review and convention.** Rejected: duplicate ownership and missing evaluation are invisible until an incident.
- **B. A charter per agent, validated against its pack, plus a roster validator.** Chosen.

## Decision

1. Every agent has a charter: mission, accountable human role, supervisor, model policy, a duty per capability, rules for each T3 capability, service levels, evaluation suites, handoffs, review cadence, kill scope and dashboard panels. A charter grants no authority.
2. Each T3 capability has exactly one owner across the roster. Another agent may only hold `delegate_requires_owner_proposal`, meaning it asks the owner agent. Runtime enforcement of that delegation is not built.
3. Every capability at T1 or above names an evaluation suite with a pass bar of at least 90 percent. The suites themselves are not written yet.
4. Supervision follows tier: executive to sheriff, department to the executive agent, assurance to the sheriff only. Assurance agents verify; they cannot originate, act above T1, use external connectors or be paused as a group.
5. Charters and the roster are checked by pure functions that return problems rather than throwing.

## Consequences

- Charter values (service levels, bars, cadences) are starting points for owner ratification.
- Five handoffs in the existing charters target agents that do not exist until ENGINE-11; the tests assert this exact list.
- The charter is not yet read by the runtime or the console.

## Verification

- `tests/unit/agent-charter.test.ts` (22 tests) covers schema failures, each charter rule, assurance independence and each roster rule. All 31 mutations of the validators were caught by the tests (one cycle mutant hangs the run, counted as caught by timeout).
