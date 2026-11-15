# ADR-100: Organization Agent Role Holders

| Field                      | Value                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Status                     | PROPOSED (operator ratification required before deployment)                                                                                |
| Date                       | 2026-11-15                                                                                                                                 |
| Author                     | Claude Code agent (ENGINE-22 implementation)                                                                                               |
| Creator                    | Claude Code agent, mission E-001 (issue #EPIC)                                                                                             |
| Mission                    | ENGINE-22 (close the role-holder gap left by ENGINE-21)                                                                                    |
| Capabilities               | Tell the roster whether the person an agent answers to exists, so a switched-on agent can be shown as running or waiting                   |
| Cites                      | [ADR-096](./ADR-096_ENGINE_ORGANIZATION_TWIN_ESCALATION_AND_ACTIVATION.md); [ADR-099](./ADR-099_ENGINE_ORG_AGENT_WIRING_AND_WEEKLY_JOB.md) |
| Minimal ownership artifact | `database/proposals/ENGINE-22_org_agent_role_holders.sql`                                                                                  |

## Context

ADR-096 says an agent runs only when someone holds the role it answers to. ADR-099 could not check that, because the roster loaded no holders, so it said "Switched on. Who approves it is not checked on this screen yet". The membership table is `organization_memberships(user_id, school_id, role, is_active)`. Its policy lets a school administrator read other people's rows and everyone else read only their own. A person with `settings.manage` is not always a school administrator, so a plain read would return no holders for them and the roster would wrongly say an agent was waiting for someone.

## Decision

1. **A function, not a table read.** `org_agent_holders(p_org)` returns an id and a role for each active member of the organization whose role is one that some agent answers to, read from `org_agent_catalog`. The caller must be signed in and hold `settings.manage` in that organization; the sheriff passes through `scholar_can`. It returns no other column, and never learners or parents.
2. **An active membership counts as an accepted invitation.** This repository has no pending-invitation state for tenant members: the invite path writes an active membership straight away for an existing account. If a pending state is ever added, the function and the app's mapping must change together. This is stated in the proposal, in the code and here.
3. **Unknown means unknown.** If the function is missing or fails, the roster keeps its "not checked" wording. It shows Waiting only when the holders were read and nobody holds the role, and Running only when someone does.
4. **The proposal is separate from ENGINE-20.** It reads `org_agent_catalog`, so it is applied after ENGINE-20, on staging first. It is a proposal, not a migration, with a rollback.

## Consequences

- Until ENGINE-20 and this proposal are applied, nothing changes on screen.
- Scratch Postgres 16 check: 14 checks pass, it applies twice without error, and the rollback removes the function. It has not run on a real Supabase project; `scholar_can` and `auth.uid()` are stubs there.
- The roster does not yet say which person holds the role. The function returns ids, but the screen uses only whether a holder exists.

## Verification

See the pull request. Tests: `org-agent-state-loader.test.ts` (holder mapping, unknown handling, roster construction, and the SQL file checked against the app), with deliberate-fault checks on the loader, the roster construction and the SQL text.
