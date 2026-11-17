# ADR-089: Workforce Expansion and Complete Approval Action Coverage

| Field                      | Value                                                                                                                                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required before deployment)                                                                                                                                                          |
| Date                       | 2026-11-15                                                                                                                                                                                                           |
| Author                     | Claude Code agent (ENGINE-11 implementation)                                                                                                                                                                         |
| Creator                    | Claude Code agent, mission E-001 (issue #EPIC)                                                                                                                                                                       |
| Mission                    | ENGINE-11 (Eight additional agents and approval action coverage)                                                                                                                                                     |
| Capabilities               | Define eight additional Role Packs and charters; map every gated capability to a JARVIS approval action, with a guard that fails when one is missed                                                                  |
| Supersedes-in-part         | None                                                                                                                                                                                                                 |
| Cites                      | [ADR-079](./ADR-079_ENGINE_INTERNAL_WORKFORCE_PACKS.md); [ADR-086](./ADR-086_ENGINE_JARVIS_APPROVAL_BRIDGE.md); [ADR-088](./ADR-088_ENGINE_AGENT_CHARTER_AND_ROSTER.md); `docs/engineering/AGENT_WORKFORCE_AUDIT.md` |
| Minimal ownership artifact | `frontend/src/lib/twin-engine/packs/expansion-workforce-packs.ts`                                                                                                                                                    |

## Context

The audit found eight gated capabilities with no JARVIS approval action, so a request from them could not reach the inbox, and recommended eight further agents with defined permissions, context and independent oversight.

## Options

- **A. Add the agents to the existing platform pack list.** Rejected: the existing list is bound to seeded roles and capability bindings that the new agents do not have.
- **B. Define them separately, unbound, with an unapplied role proposal.** Chosen.

## Decision

1. Eight packs (compliance, reliability, customer success, revenue assurance, independent audit, knowledge, product intelligence, market intelligence) are defined in a separate list. They are not bound to connectors and not registered with the runner, and every one starts in shadow.
2. No new agent reaches T3. Money, deploy, secret, access and public-post decisions stay with the agents that own them and are requested through handoffs.
3. The independent audit agent is an assurance agent: read-only, at most T1, no external connector except owner alert, reports only to the sheriff.
4. Their platform roles and permissions are proposed in `database/proposals/ENGINE-11_workforce_roles.sql`, outside the migrations directory, unapplied, none privileged.
5. The approval action map now covers every T2 and T3 capability across all packs. `validateActionCoverage` fails when a gated capability is neither mapped to a tier-equal JARVIS action nor listed in `UNMAPPED_BY_DESIGN`. The only exception is `publish.social.post`, which needs a new risk-policy action that the owner must ratify.

## Consequences

- The new agents cannot run until roles are applied, bindings exist and the runner schedules them.
- Adding any gated capability to any pack now fails a test until it is mapped.
- Compliance wording, regulator timelines and notice content need counsel review before any send capability is enabled.

## Verification

- `tests/unit/workforce-expansion.test.ts` (12 tests) covers pack validity, no T3, role proposal cross-check, charters, the fifteen-agent roster and the assurance agent.
- `tests/unit/jarvis-action-coverage.test.ts` (8 tests) covers the guard; 9 mutations of it are caught by the tests.
