# ADR-093: Agent Scope Guard

| Field                      | Value                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required before deployment)                                                                     |
| Date                       | 2026-11-15                                                                                                                      |
| Author                     | Claude Code agent (ENGINE-15 implementation)                                                                                    |
| Creator                    | Claude Code agent, mission E-001 (issue #EPIC)                                                                                  |
| Mission                    | ENGINE-15 (One enforced door for agent data access)                                                                             |
| Capabilities               | Resolve grants, flags and row owners server-side; deny by default; audit every decision; never call the data port on a deny     |
| Cites                      | [ADR-091](./ADR-091_ENGINE_WORKFORCE_COMPLETION_AND_WORKSPACES.md); [ADR-092](./ADR-092_ENGINE_WORKFORCE_EVALUATION_HARNESS.md) |
| Minimal ownership artifact | `frontend/src/lib/workforce-scope/scope-guard.server.ts`                                                                        |

## Context

ADR-091 defined what each agent may reach and a pure check, `authorizeScope`, but nothing called it. The check also takes grant, "flagged" and row-owner facts as inputs, so any caller could claim them. A search of the execution path found no code through which agents read Sherivs data at all: the tool broker and execution gate govern nine outbound actions (email, deploy, post and so on) by capability, tier and approval, and tools do not name data resources. The data door therefore does not exist yet, and it is cheaper to make it right before it is built than to retrofit it.

## Options

- **A. Add a data-scope parameter to every broker tool.** Rejected: tools are outbound actions, not reads. The mapping would be invented and would not stop a read that bypasses the broker.
- **B. One guard that every agent data operation must pass, with the facts resolved on the server.** Chosen.

## Decision

1. `runAsAgent(ports, agentCode, op)` is the only way an agent reaches data. It finds the agent's workspace in the shipped list, never from the payload.
2. The caller states only an operation kind (read aggregate, read records, write own, propose), a resource, an organization and optionally one row. The kind decides whether an individual record is requested, so an agent cannot ask for a record while describing it as an aggregate.
3. Grants, flags and row owners come from ports. A named row is checked against the port. A listing is not trusted: the guard forces `restrictToOwner` or `restrictToFlagged` onto the data port, and the data port must apply them.
4. Everything fails closed: unknown agent, unknown operation, engaged kill switch, any failing lookup, and a failing audit write all deny. The data port is never called on a deny. A failure inside the data port is reported without its message.
5. Every decision is audited before the data port runs, with agent, operation, resource, organization, outcome and reason, and never row content. An allowed call that cannot be audited does not run.
6. A test keeps `authorizeScope` callable from only three files (the workspace module, this guard and the evaluation harness), so a second, unguarded route to the same decision cannot appear unnoticed.

## Consequences

- Nothing calls the guard in production yet because no agent data path exists. When one is built it must take this guard and nothing else. Until then the guard is tested, not exercised.
- The data port the owner supplies must scope every query by `tenantId` and honour the two restrictions. The guard cannot check that; the database rules proposed in ADR-091 are the second layer and are still not applied.
- Grant, flag and owner lookups are ports with no database implementation yet.
- Audit entries need a table or log sink; none exists, so the audit port is also unimplemented.
- The tool broker is unchanged. Its tools govern what an agent may do in the world; this guard governs what it may read and write inside Sherivs.
