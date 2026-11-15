# ADR-095: Organization Workforce and Plan Packaging

| Field                      | Value                                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required before deployment)                                                                   |
| Date                       | 2026-11-15                                                                                                                    |
| Author                     | Claude Code agent (ENGINE-17 implementation)                                                                                  |
| Creator                    | Claude Code agent, mission E-001 (issue #EPIC)                                                                                |
| Mission                    | ENGINE-17 (the agents an organization can run, and which plans include them)                                                  |
| Capabilities               | Define 17 organization agents as valid tenant role packs; place each on a plan; keep both honest against the existing catalog |
| Cites                      | [ADR-090](./ADR-090_ENGINE_WORKFORCE_CONSOLE.md); [ADR-093](./ADR-093_ENGINE_AGENT_SCOPE_GUARD.md)                            |
| Minimal ownership artifact | `frontend/src/lib/org-workforce/org-agents.ts`                                                                                |

## Context

The internal console workforce (25 Sherivs agents) is complete as a design. Organizations (schools) need their own agents, and smaller plans must get fewer of them, with Enterprise getting all.

The database allows only nine membership roles: admin, principal, teacher, parent, student, bursar, hq, alumni, driver. An admissions, exams, records or safeguarding agent has no membership role to bind to, so the person-role pack model does not fit.

## Options

- **A. Widen the membership roles to fit each agent.** Rejected: a schema and authorization change for a design that is not yet running.
- **B. Treat an organization agent as a pack bound to the nearest membership role and publish it with the person-role packs.** Rejected: it would make the agent look like a person's role and put it in the registry that drives acting contexts.
- **C. Organization-level definitions, each accountable to one real membership role, kept out of the person-role pack list; nothing published.** Chosen.

## Decision

1. **Seventeen agents** (Concierge, Tally, Roll, Marksheet, Courier, Intake, Bell, Haven, Route, Overview, Sitting, Archive, Roster, Upkeep, Scaffold, Shield, Legacy). Each is a valid tenant Role Pack: at most T2, shadow start, no cross-tenant memory, approvals by the organization's own role owner and never the sheriff. Codes start `org-`; codenames are distinct from every platform agent.
2. **Accountability**: each agent names the one membership role that owns its approvals. Its permissions are a subset of the matching generated Nigerian role template and exist in the permission catalog.
3. **Hard limits**: sending or publishing is approval-gated; admission, refund, leave, publishing results, a school-wide broadcast, a safeguarding referral and a breach notice are propose-only. No agent holds a protected or restricted permission except the data-protection agent (`ndpa.dsar`, `audit.view`). Haven holds no counselling notes and no messaging permission, and can only screen, surface and propose.
4. **Plan packaging**: each plan includes everything below it. Counts are trial 1, Starter 5, Growth 12, Professional 16, Enterprise 17. An agent's plan is the first plan that enables the existing feature it follows (`fee_management`, `report_cards`, `ai_admissions_review` and so on), so packaging cannot drift from pricing. Five agents have no matching feature and carry an explicit plan with a written rationale. An agent with no rule is Enterprise only, and an unknown plan resolves to the trial.
5. **Entitlement** is a commercial fact read from the legacy catalog without extending it. It grants nothing beyond what the agent's pack already limits.

## Consequences

- Definitions only. Nothing is published, registered, activated or deployed, and no agent runs: the scope guard of ADR-093 has no data path behind it yet.
- The `org-` packs are not in `TENANT_ROLE_PACKS` and a test keeps it that way.
- Placement of the six un-anchored agents (Sitting, Archive, Roster, Scaffold, Shield) is a starting value for the owner to ratify, as are all plan counts.
- The agents are accountable to a role, not bound to one. Whether to widen the membership roles later, or to keep organization agents as a separate kind, is an owner decision.
- Next missions: an entitlement-gated activation path, and a plan-by-agent view in the console.
- Nothing has been viewed in a browser.
