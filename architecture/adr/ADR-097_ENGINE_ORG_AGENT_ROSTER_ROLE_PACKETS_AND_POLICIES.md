# ADR-097: Organization Agent Roster, Role Packet Selector and Workspace Policy Editor

| Field                      | Value                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required before deployment)                                                                                             |
| Date                       | 2026-11-15                                                                                                                                              |
| Author                     | Claude Code agent (ENGINE-19 implementation)                                                                                                            |
| Creator                    | Claude Code agent, mission E-001 (issue #EPIC)                                                                                                          |
| Mission                    | ENGINE-19 (the organization-facing screens for agents, role packets and workspace policies)                                                             |
| Capabilities               | Show which agents a plan includes; let an administrator shape each role's permission packet; let an organization set its workspace policies and modules |
| Cites                      | [ADR-095](./ADR-095_ENGINE_ORGANIZATION_WORKFORCE_AND_PLAN_PACKAGING.md); [ADR-096](./ADR-096_ENGINE_ORGANIZATION_TWIN_ESCALATION_AND_ACTIVATION.md)    |
| Minimal ownership artifact | `frontend/src/lib/org-workforce/role-packet-view.ts`                                                                                                    |

## Context

An audit found that the database already holds the role-packet and workspace-policy functions (`role_context`, `role_set_optional`, `role_add_custom_grant`, `role_remove_custom_grant`, `workspace_policy_list`, `workspace_policy_set`, `workspace_feature_set`), but no screen called any of them. An organization could create a custom role and assign people, yet could not choose which permissions a role carries or which workspace policies apply, which is how an organization makes the platform fit how it really works.

## Decision

1. **Three sections in the organization app**, reached from the Roles screen: `agents`, `role-packets` and `workspace-policies`. Each is a thin container over a pure view model and a presentational panel, so the logic is tested without a database.
2. **Role packets.** `parseRoleContext` reads the server answer into mandatory permissions (always on, never switchable), optional permissions (switchable, with the organization's current state), guardrails, separation-of-duties conflicts and custom grants. `planOptionalChanges` turns what the administrator wants into the exact server calls. It refuses a mandatory or unknown permission, refuses any change to a role the caller holds (the server refuses it too), skips no-op changes, and holds a protected or restricted permission until it is confirmed. Switching a sensitive permission off never needs confirmation.
3. **Custom permissions.** A grant outside the packet must be in the permission catalog and not already carried, and is confirmed if sensitive. Removing a grant only targets a grant of the selected role.
4. **Workspace policies.** `parsePolicyList` and `planPolicyChanges` map to `workspace_policy_set` and `workspace_feature_set`; unknown keys are reported, not sent.
5. **Agent roster.** Built from the activation plan of ADR-096: agents the plan includes, agents that need a higher plan with the plan named, the next plan and what it adds. Each card says the agent starts by proposing and a person decides. The "Switch on" button is disabled with the reason that the add-on table is drafted and not applied; it enables only when that table exists.
6. **The server remains the authority.** These modules only avoid sending calls that would fail and explain why. The database checks the caller, refuses a role the caller holds, and writes the audit trail.

## Consequences

- The screens call existing server functions only; no migration is added here. Switching an agent on, and the plan-level organization status, depend on the proposals of ENGINE-20.
- The organization's active state is read from `subscription_status` with a deny-list (suspended, cancelled, canceled, expired); an unknown status is treated as active. The owner should confirm the real status vocabulary.
- The roster does not yet read members, so it shows plan status only; holder status ("waiting for someone to hold the role") appears once members are passed in.
- New sections are reached by a link from the Roles screen. They do not appear in the permission-driven navigation until rows are added to the workspace item catalog, which is a database change and a separate proposal.
- Nothing has been viewed in a browser. The panels are rendered to markup in tests; the containers are only type-checked.
