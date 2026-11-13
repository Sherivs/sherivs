# ADR-038: SV1 JARVIS Bounded Internal Role Playbooks

| Field                      | Value                                                                                                                                                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Status                     | PROPOSED (operator ratification required before any playbook is bound to a live worker)                                                                                                                                                                                                          |
| Date                       | 2026-11-13                                                                                                                                                                                                                                                                                       |
| Author                     | Claude Code agent (SV1-JARVIS-04 implementation)                                                                                                                                                                                                                                                 |
| Creator                    | Claude Code agent, mission J-004 (issue #292)                                                                                                                                                                                                                                                    |
| Mission                    | SV1-JARVIS-04 (bounded internal operations playbooks)                                                                                                                                                                                                                                            |
| Capabilities               | ADR-035 risk policy; ADR-036 approval inbox; ADR-037 escalation ladder; CORE-05 capability registry                                                                                                                                                                                              |
| Supersedes-in-part         | None                                                                                                                                                                                                                                                                                             |
| Cites                      | [ADR-035](./ADR-035_SV1_JARVIS_GOVERNED_AGENT_REGISTRY_AND_RISK_POLICY.md); [ADR-036](./ADR-036_SV1_JARVIS_DURABLE_APPROVAL_INBOX.md); [J0 threat model](../../docs/jarvis/J0-inventory-gap-and-threat-model.md); [capability registry](../../frontend/src/lib/workforce/capability-registry.ts) |
| Minimal ownership artifact | `frontend/src/lib/jarvis/playbooks.ts`; data and pure functions only, no migration                                                                                                                                                                                                               |

## Context

The V1 scope lock authorizes five bounded role playbooks mapped to the six console workspaces (#197). The Personal Workspace has no external mutation tools, so it has no agent playbook. Agents propose; humans approve sensitive actions. Existing worker definitions, capability declarations and delegations remain the authority substrate; no second role engine or agent runtime is introduced.

## Decision

A playbook is declarative data per workspace (Platform Operations, Platform Administration, Operations, Engineering, Support):

- `direct`: T0/T1 actions the agent may take within its delegation.
- `escalated`: T2/T3 actions the agent may only propose; each routes to the approval inbox with a named approver (T3 always the sheriff).
- `escalationPath`: console inbox, then WhatsApp, then voice (ADR-037).
- `credentials: "none"`: no standing privileged credentials; any access is brokered per action.

`decidePlaybookAction` returns allow, escalate or deny. Anything undeclared is denied, an invalid playbook denies everything, and `validatePlaybook` rejects T4, secrets, production deploys, production database mutation, spend, T3 without the sheriff, duplicates, a non-console first rung, and any credential. `playbookCapabilityRegistrations` produces plain registrations for the existing capability registry, so the existing risk policy still has the final say at proposal and execution time.

## Consequences

- Positive: bounds are reviewable as data and enforced by tests, including an exhaustive check that every action is allow, escalate or deny strictly according to declaration.
- Not done here: binding a playbook to a persisted worker definition and delegation, Hermes routing (JARVIS-05), and per-playbook runtime budgets. The playbook content (which actions each workspace declares) is a proposal for owner review.

## Verification

`tests/unit/jarvis-playbooks.test.ts` (24 tests, composing with the real capability registry, worker definition, platform authority and risk policy) and `tests/unit/workforce-capability-registry.test.ts` pass. Mutation checks: allowing undeclared actions, dropping the T3 sheriff rule, allowing credentials, or dropping the never-declarable list each fail tests.
