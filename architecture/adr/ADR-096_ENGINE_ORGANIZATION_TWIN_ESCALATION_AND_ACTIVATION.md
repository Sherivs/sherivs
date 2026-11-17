# ADR-096: Organization Twin, Escalation and Agent Activation

| Field                      | Value                                                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required before deployment)                                                                                                     |
| Date                       | 2026-11-15                                                                                                                                                      |
| Author                     | Claude Code agent (ENGINE-18 implementation)                                                                                                                    |
| Creator                    | Claude Code agent, mission E-001 (issue #EPIC)                                                                                                                  |
| Mission                    | ENGINE-18 (when an organization agent may run, who hears what it raises, the weekly report, and the role and organization switcher view)                        |
| Capabilities               | Activate add-on agents only for entitled, opted-in organizations with an accepted holder; route escalations; build the weekly report; group a person's contexts |
| Cites                      | [ADR-095](./ADR-095_ENGINE_ORGANIZATION_WORKFORCE_AND_PLAN_PACKAGING.md); [ADR-093](./ADR-093_ENGINE_AGENT_SCOPE_GUARD.md)                                      |
| Minimal ownership artifact | `frontend/src/lib/org-workforce/escalation.ts`                                                                                                                  |

## Context

An audit of the repository found that the role side of the vision is largely built: a permission catalog, role templates, per-organization optional permissions and custom grants, custom roles, separation-of-duties rules, responsibilities, a permission-driven workspace manifest, an organization and role switch, push, WhatsApp and email delivery, and a person twin engine keyed by identity, organization and role. What does not exist is any organization-level layer: nothing decides when an organization agent may run, nothing receives what agents raise, and no weekly report exists. The only "digital twin" code is a phone-call configuration, not an organization twin.

## Decision

1. **Agents are not roles.** They are add-ons that serve the role accountable for their work. The accountable role holder approves the agent's actions and answers its escalations. The agent has no membership, no login and no permission outside its pack.
2. **The organization twin** is not an agent and holds no permission. It is the single place that receives what agents raise, decides who must hear it, and builds the report. The chain is agent, then accountable role, then administrator (the first of admin, principal and hq with an eligible holder).
3. **Activation** needs all of: an active organization, a plan that includes the agent, the organization having switched it on, no pause, and at least one holder of the accountable role with an active membership and an accepted invitation. Pending, expired and revoked invitations never count. The result names the reason an agent is not running: locked, available, paused, waiting for a holder, or organization inactive.
4. **Reporting rules.** Every money event reaches the administrator by push at once, however small, and is counted in the weekly report; telling the administrator is not approving the action. Urgent events reach the accountable role by push; critical events reach both at once, even in quiet hours. An unacknowledged event moves up to the administrator after 15 minutes (critical), 60 minutes (urgent) or 24 hours (attention). Quiet hours are 22:00 to 06:00 Africa/Lagos for anything that is neither money nor critical. Channels fall back push, WhatsApp, email, in-app; an event nobody can receive is reported as unroutable, not dropped.
5. **Weekly report** at Monday 07:30 Africa/Lagos, by WhatsApp when the administrator has opted in with a verified number and by email otherwise. It carries counts, the money total in minor units, unanswered urgent items and the top urgent lines. Safeguarding content is never copied into a notification or a report; only that an item exists.
6. **Switcher view.** One person may hold several roles in one organization and belong to several organizations. Each pair is its own context. The view groups a person's active memberships by organization and marks the current one; the switch itself stays a server action.

## Consequences

- Policy and view models only. Nothing is sent, scheduled, stored or activated; no migration, no UI and no delivery job is added. Wiring needs a tenant add-on table, an event table and a scheduled job, each a separate proposal.
- The starting values (acknowledgement windows, quiet hours, report time) are for the owner to ratify.
- Money events are an unconditional push to the administrator, which may be noisy for a large school; a per-organization threshold is a possible later choice, not made here.
- Role selection by organizations from permission packets, custom roles and the dynamic workspace already exist in the database layer; their gaps are listed in the PR and are the next missions.
- Nothing has been viewed in a browser.
