# ADR-091: Workforce Completion and Agent Workspaces

| Field                      | Value                                                                                                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required before deployment)                                                                                                                       |
| Date                       | 2026-11-15                                                                                                                                                                        |
| Author                     | Claude Code agent (ENGINE-13 implementation)                                                                                                                                      |
| Creator                    | Claude Code agent, mission E-001 (issue #EPIC)                                                                                                                                    |
| Mission                    | ENGINE-13 (Ten remaining Sherivs agents, a workspace for every agent, and a scope check)                                                                                          |
| Capabilities               | Complete the 25-agent Sherivs workforce; define each agent's data scopes, hard boundaries and workbench; check every scope request deny-by-default                                |
| Supersedes-in-part         | [ADR-088](./ADR-088_ENGINE_AGENT_CHARTER_AND_ROSTER.md) (public posting is now owned by the marketing agent, not the sales agent)                                                 |
| Cites                      | [ADR-088](./ADR-088_ENGINE_AGENT_CHARTER_AND_ROSTER.md); [ADR-089](./ADR-089_ENGINE_WORKFORCE_EXPANSION_AND_ACTION_COVERAGE.md); [ADR-090](./ADR-090_ENGINE_WORKFORCE_CONSOLE.md) |
| Minimal ownership artifact | `frontend/src/lib/workforce-charter/workspace.ts`                                                                                                                                 |

## Context

Fifteen agents existed. Ten roles were still missing (onboarding, safeguarding, quality assurance, evaluation, marketing, localisation, data, legal, people and investor reporting), and no agent had a written statement of which data it may read, under which row rule, what it must never do, or what its screen looks like. Public posting sat with the sales agent although marketing is the natural owner.

## Options

- **A. Leave the data an agent can reach implicit in its tools.** Rejected: a bug in a tool or prompt would silently widen access.
- **B. Define a workspace per agent, validate it against the pack and charter, check each request deny-by-default, and propose matching database rules.** Chosen.

## Decision

1. Ten agents are added as definition-only Role Packs and charters: Bridge (onboarding), Warden (safeguarding), Gauge (quality assurance), Proctor (evaluation), Echo (marketing), Griot (localisation), Prism (data), Brief (legal), Keystone (people) and Beacon (investor reporting). Each starts in shadow. Two hold a T3 capability, both decided by the sheriff with a passkey: Echo's public post, and Keystone's access request.
2. Proctor is a second independent assurance agent: it reports only to the sheriff, verifies other agents with synthetic cases and recommends autonomy changes; it cannot change them.
3. Public posting moves from the sales agent to Echo. Sales and JARVIS may only ask Echo for it.
4. Every agent has a workspace (`sherivs.agent-workspace.v1`): resources with an access mode (read, write own, propose; there is no delete), a row rule, a sensitivity and a purpose; hard boundaries that start with "Never"; and a workbench layout with queues and quick actions.
5. Row rules are: platform, tenant metadata, aggregate, tenant with grant, tenant flagged and own agent. Organization rows are read-only and only three agents can reach them: support and compliance under a time-boxed grant, safeguarding only for rows the organization itself flagged.
6. `validateWorkspace` checks a workspace against its pack and charter (context ceiling, customer-content flag, read-only organization rows, grant limits, base resources, assurance independence, boundaries and workbench). `authorizeScope` is the pure runtime check and denies unless every condition holds.
7. Two proposals, not applied: roles for the ten agents, and `agent_workspace_scopes` plus `agent_tenant_grants` with forced row-level security. A grant borrows a human's support grant, is capped by the scope's limit, and is checked in `agent_may_read_tenant`. A test keeps the SQL seed identical to the workspace definitions.
8. The console agent page now shows what the agent can reach, its boundaries and its workbench.

## Consequences

- Nothing is enforced in the database until the owner applies the proposals; until then the code-side check is the only enforcement and it is not yet called by the runtime.
- Charter service levels, evaluation bars and grant limits are starting values for the owner to ratify.
- The workbench layouts are specifications. The interactive workbench screens are not built, and nothing has been viewed in a browser.
- Safeguarding and compliance wording needs review by counsel before any of those agents are wired.

## Verification

- `tests/unit/agent-workspace.test.ts` covers the ten agents, all 25 workspaces, every validator rule, the scope check and the SQL seed. 39 mutations of `workspace.ts` were tried and all were caught.
- `tests/unit/workforce-console.test.tsx` covers the new panels for all 25 agents.
