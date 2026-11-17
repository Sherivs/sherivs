# ADR-094: Agent Workbench, Pause Control and Console Scope Lock

| Field                      | Value                                                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required before deployment)                                                                                                            |
| Date                       | 2026-11-15                                                                                                                                                             |
| Author                     | Claude Code agent (ENGINE-16 implementation)                                                                                                                           |
| Creator                    | Claude Code agent, mission E-001 (issue #EPIC)                                                                                                                         |
| Mission                    | ENGINE-16 (Agent workbench screens, a pause policy and its database proposal, and the internal console scope lock)                                                     |
| Capabilities               | Show each agent's working surface honestly; define who may pause and resume an agent and what a pause reaches; hold a paused agent out of all data                     |
| Cites                      | [ADR-090](./ADR-090_ENGINE_WORKFORCE_CONSOLE.md); [ADR-091](./ADR-091_ENGINE_WORKFORCE_COMPLETION_AND_WORKSPACES.md); [ADR-093](./ADR-093_ENGINE_AGENT_SCOPE_GUARD.md) |
| Minimal ownership artifact | `frontend/src/lib/workforce-pause/pause-policy.ts`                                                                                                                     |

## Context

Every workspace already names a workbench layout and a "pause agent" quick action, but nothing existed behind either: no page to work from, and no rule for who may pause an agent, how far a pause reaches, or who may undo it.

## Options

- **A. A pause is a flag any operator can flip and clear.** Rejected: the risky direction, restoring earned autonomy, would be as cheap as the safe one.
- **B. Pausing is cheap for one ordinary agent and sheriff-only for everything wider; resuming is always sheriff-only; state is an append-only event list.** Chosen.

## Decision

1. **Workbench page** (`/console/workforce/<agent>/workbench`): headline, queues, quick actions and the pause control for one agent. Every queue reads through a `WorkbenchDataSource`; the shipped one reports "not available" because the engine tables are not applied, so no row is ever invented. A queue that points outside the agent's workspace is never read. Quick actions are descriptions: navigation is enabled and read-only; anything that changes something is a disabled button with its reason.
2. **Pause policy** (`pause-policy.ts`, pure): a reason of 10 to 300 characters is required. Pausing one ordinary agent needs `platform.operations.assign` or the sheriff. Pausing the workforce, an executive or assurance agent, or any agent whose pause cascades needs the sheriff. Resuming needs the sheriff.
3. **Reach**: pausing JARVIS (the only cascading agent) or the workforce pauses every agent except the two assurance agents, so a workforce-wide stop cannot silence the verifiers; an assurance agent is paused only directly. A `department` kill scope has no department data behind it, so it is treated as workforce-wide, the safe direction.
4. **State** is an append-only event list; the current state is a fold, last event per target wins, ties resolve in insertion order.
5. **Effect**: a paused agent is held in shadow (`applyPause`) and the scope guard of ADR-093 refuses it all data with `agent_paused`. The pause port on the guard is required, so a guard built without it does not compile; a failing lookup refuses.
6. **Database proposal** (`ENGINE-16_agent_pause_state.sql`, not applied): rules and events tables with forced row-level security, an immutability trigger on events, `change_agent_pause` (checks the caller itself) and `is_agent_paused` (unknown agent reads as paused). It was applied to a throwaway local Postgres 16 with stubbed Supabase functions and 26 behavioural checks passed (`ENGINE-16_agent_pause_state.check.sql`); the rollback was also run. That is not a test against a Supabase project.

## Internal console scope lock

The internal console workforce scope is complete as designed, with these parts shipped as drafts and none applied or deployed:

| Part                                          | Where                  |
| --------------------------------------------- | ---------------------- |
| 25 agents with name, role, charter, role pack | ENGINE-11 to ENGINE-13 |
| Workspaces, boundaries, deny-by-default check | ENGINE-13              |
| Evaluation harness and ladder link            | ENGINE-14              |
| Scope guard (single data door)                | ENGINE-15              |
| Workbench, pause policy, pause proposal       | this ADR               |

Anything further is a new mission, not a gap in this one. What remains is owner-gated and listed below.

## Consequences

- The pause is a policy and a proposal. Nothing pauses an agent until the owner approves the design, applies the tables on staging first, and a console action calls `change_agent_pause`. The workbench shows the pause control as unavailable until then.
- The twin engine compiles contexts for memberships, not for the Sherivs workforce, so there is no acting-context path to apply `applyPause` to yet. The scope guard is the one place the pause is enforced today.
- `ask_for_draft` is disabled: it needs the engine tables and an approved request path.
- Charter service levels, pass bars, grant limits and pause rules are starting values for the owner to ratify.
- Owner steps before any of this is live: fix billing so CI runs; review and merge the stacked drafts; apply the role, scope and pause proposals on staging; create the JARVIS service identity; counsel review of compliance and safeguarding wording; decide SMS activation.
- Nothing has been viewed in a browser.
