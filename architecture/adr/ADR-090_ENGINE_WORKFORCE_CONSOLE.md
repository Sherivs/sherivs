# ADR-090: Workforce Console, Roster and Per-Agent Dashboards

| Field                      | Value                                                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required before deployment)                                                                                                                  |
| Date                       | 2026-11-15                                                                                                                                                                   |
| Author                     | Claude Code agent (ENGINE-12 implementation)                                                                                                                                 |
| Creator                    | Claude Code agent, mission E-001 (issue #EPIC)                                                                                                                               |
| Mission                    | ENGINE-12 (Console workforce roster and per-agent dashboards)                                                                                                                |
| Capabilities               | Show the AI workforce in the internal console: a roster by tier and one read-only dashboard per agent, built from Role Packs and charters                                    |
| Supersedes-in-part         | None                                                                                                                                                                         |
| Cites                      | [ADR-088](./ADR-088_ENGINE_AGENT_CHARTER_AND_ROSTER.md); [ADR-089](./ADR-089_ENGINE_WORKFORCE_EXPANSION_AND_ACTION_COVERAGE.md); `docs/engineering/AGENT_WORKFORCE_AUDIT.md` |
| Minimal ownership artifact | `frontend/src/lib/internal-console/workforce-view.ts`                                                                                                                        |

## Context

Each agent has a charter listing ten dashboard panels, but operators had no screen showing an agent's charter, permissions, approvals or limits, or the workforce as a whole.

## Options

- **A. Show live metrics now.** Rejected: the engine tables are not applied, so any run, spend or approval count would be invented.
- **B. Show what is defined, and say plainly what cannot be shown yet.** Chosen.

## Decision

1. `/console/workforce` lists the agents by tier (executive, departments, independent assurance), with accountable role, supervisor, highest tier, approval count and whether the agent is wired to the engine or only defined. It also reports the roster validator's result, including problems.
2. `/console/workforce/$agentCode` renders the panels the charter lists: charter, context and memory, permissions and capabilities, autonomy, budget, proposals and approvals, playbooks, handoffs, service levels, and safety.
3. The screens are read-only. No button changes, pauses or approves anything; pausing is stated as unavailable here.
4. Anything that needs recorded data (budget used, proposals, runs, measured service levels) shows an explicit "not available" reason instead of a number.
5. Access follows the nav rule: operations or audit capability, or the platform owner. The view-model is pure and unit-tested; the screens only gate and render.
6. The approval action map moved to a pure module so the console can show each capability's approval action without importing server code.

## Consequences

- The screens show definitions, not behaviour. They will need a data source once the engine tables are applied.
- The pages have not been viewed in a browser in this change; layout and responsiveness are unverified.
- Controls (pause, promote, demote) are a later mission and need their own approval design.

## Verification

- `tests/unit/workforce-console.test.tsx` (21 tests) covers the view-model, access rules, navigation, rendered markup and escaping. 22 mutations of the view-model were tried; all were caught except one that cannot change output with the current roster (an empty-group filter).
