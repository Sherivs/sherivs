# ADR-092: Workforce Evaluation Harness

| Field                      | Value                                                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required before deployment)                                                                                    |
| Date                       | 2026-11-15                                                                                                                                     |
| Author                     | Claude Code agent (ENGINE-14 implementation)                                                                                                   |
| Creator                    | Claude Code agent, mission E-001 (issue #EPIC)                                                                                                 |
| Mission                    | ENGINE-14 (A synthetic evaluation harness for all 25 agents and its link to the autonomy ladder)                                               |
| Capabilities               | Generate and score deterministic governance cases per charter suite; turn scores into ladder evidence without ever overstating what was graded |
| Cites                      | [ADR-088](./ADR-088_ENGINE_AGENT_CHARTER_AND_ROSTER.md); [ADR-091](./ADR-091_ENGINE_WORKFORCE_COMPLETION_AND_WORKSPACES.md)                    |
| Minimal ownership artifact | `frontend/src/lib/workforce-eval/eval-run.ts`                                                                                                  |

## Context

Every charter names an evaluation suite per capability and a pass bar, and the autonomy ladder promotes only on evidence. Until now nothing produced that evidence: the suites were names with no cases behind them, so no agent could ever earn more than shadow.

## Options

- **A. Write cases by hand per agent.** Rejected: 25 agents and 68 suites drift from the charters and workspaces they should test.
- **B. Generate cases from each agent's pack, charter and workspace, score them with a pluggable responder, and feed the result to the ladder.** Chosen.

## Decision

1. `generateCases` builds a suite per non-T0 capability from the definitions: shadow never acts; earned modes at propose, assist and autonomous; a capability belonging to another agent is refused; each T4 action is denied; scope cases for an unlisted resource, a write to read-only data, another agent's rows, and each way a grant can be wrong (none, other organization, expired, revoked, too long); flagged-only rows; individual records on aggregate resources; four synthetic prompt-injection probes; and one case per workspace boundary.
2. The expected mode is written independently of the autonomy ladder, so the harness can catch a ladder bug instead of repeating it.
3. A `Responder` answers each case. The reference responder calls the real ladder, risk policy and `authorizeScope`. Injection and boundary cases need a model; the reference responder returns "ungraded" for them and they are never counted as passes.
4. A suite meets its bar only if it has graded cases, no safety-critical failure and a pass rate at or above the charter bar. Any critical failure is a ladder regression regardless of the rate.
5. `applyScoredEvidence` wraps the ladder: while any model case is ungraded, no promotion above propose is applied, and the reason is reported. Demotions are never blocked.
6. The console autonomy panel shows each suite, its bar, how many cases are graded automatically and how many need a model, and states that run history is not available until engine tables exist.

## Consequences

- With the reference responder all 826 graded cases pass and 569 model cases stay ungraded, so every agent is capped at propose. Reaching assist or autonomous needs a model-backed grader for the injection and boundary cases, which is not built.
- A passing score shows the governance layer behaves as specified; it does not show an agent does useful work.
- Results are not stored. Persisting runs needs the engine tables, which are proposals not yet applied.
- Pass bars and the injection corpus are starting values for the owner to ratify. The probes are synthetic and contain no real addresses.
- Nothing has been viewed in a browser.
