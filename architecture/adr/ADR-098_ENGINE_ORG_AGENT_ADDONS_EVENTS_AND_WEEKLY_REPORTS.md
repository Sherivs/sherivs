# ADR-098: Organization Agent Add-ons, Event Log, Notification Outbox and Weekly Reports (database proposal)

| Field                      | Value                                                                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required before deployment)                                                                                                                                                                     |
| Date                       | 2026-11-15                                                                                                                                                                                                                      |
| Author                     | Claude Code agent (ENGINE-20 implementation)                                                                                                                                                                                    |
| Creator                    | Claude Code agent, mission E-001 (issue #EPIC)                                                                                                                                                                                  |
| Mission                    | ENGINE-20 (the database side of the organization workforce)                                                                                                                                                                     |
| Capabilities               | Switch an organization agent on or off within the plan; pause and resume it; record what agents raise; queue notifications; request weekly reports                                                                              |
| Cites                      | [ADR-095](./ADR-095_ENGINE_ORGANIZATION_WORKFORCE_AND_PLAN_PACKAGING.md); [ADR-096](./ADR-096_ENGINE_ORGANIZATION_TWIN_ESCALATION_AND_ACTIVATION.md); [ADR-097](./ADR-097_ENGINE_ORG_AGENT_ROSTER_ROLE_PACKETS_AND_POLICIES.md) |
| Minimal ownership artifact | `database/proposals/ENGINE-20_org_agent_addons_events_reports.sql`                                                                                                                                                              |

## Context

ADR-095 to ADR-097 define the organization workforce in code: 17 agents, each accountable to one membership role, packaged by plan, with an escalation policy and screens. Nothing stores whether an organization switched an agent on, what an agent raised, who was told, or whether the weekly report was requested. Without that, the roster's "Switch on" button has to stay disabled and the escalation policy has nothing to read.

## Decision

This is a proposal file under `database/proposals/`. It is not a migration and is not applied. It adds:

1. **`org_agent_catalog`**: the 17 agents with accountable role and lowest plan. Seeded from the code definitions; a unit test fails if the two drift.
2. **`org_agent_addon_events`** (append-only) and **`change_org_agent()`**: the only way to switch an agent on or off, pause or resume it. It checks the caller is signed in, has `settings.manage` in that organization, that the organization is active, and that the plan includes the agent (an unknown plan counts as the trial). A pause needs a written reason. A platform pause can only be placed and lifted by the sheriff; an organization cannot lift it.
3. **`org_agent_events`** and **`raise_org_agent_event()`** (service role only): what agents raise. An agent that is off or paused cannot raise. Duplicates within an hour return the first event. Safeguarding events store a pointer and never text, enforced by a constraint. An event can be acknowledged once, by someone with `settings.manage`; nothing else may change and nothing is deleted.
4. **`org_notification_outbox`** with `enqueue_org_notification()`, `claim_org_notifications()` (`FOR UPDATE SKIP LOCKED`) and `complete_org_notification()`: the recipient must be an active member of the organization, a safeguarding notification must be redacted and carry no summary (also a constraint), one notification per event, recipient and channel, and a failure is retried with a growing delay and is final after five attempts. No worker that sends them is included.
5. **`org_weekly_reports`** with `request_org_weekly_reports()` and `store_org_weekly_report()`: one request per organization per week, only for active organizations with a running agent. The app builds the content (`buildWeeklyReport`) and stores it.
6. **Row-level security is forced on all five tables.** Ordinary users can only read: an administrator reads their organization's log, events and reports; a recipient reads their own notifications; everyone reads the catalog. Every function pins `search_path`.

The weekly schedule is deliberately not created. The repository does not use `pg_cron` today, and whether it is available and how the job should run is an owner decision. The file documents the call the job must make (Monday 06:30 UTC, which is 07:30 in Lagos).

## Consequences

- Nothing runs until the owner applies the proposal on staging, then production, as a forward-only migration with the rollback in the file. Until then the roster keeps its honest disabled state.
- The check file stubs the Supabase pieces and runs on a throwaway Postgres 16. It was run on a fresh scratch server (port 54351, deleted afterwards): 102 checks, all passed, the proposal applies twice without error, and the rollback removes every table and function it created. It has not been run against a real Supabase project, so `auth.role()`, `scholar_can` and `get_my_school_id` behave here as stubs and must be confirmed on staging.
- `scholar_can(org, 'settings.manage')` is used as the permission for switching agents on and off and for acknowledging events. The owner may prefer a dedicated permission, which needs a row in the permission catalog.
- `subscription_status = 'active'` is the only status that may switch an agent on. If other values mean "active" in practice, the owner must say so.
- The app does not yet call these functions. Wiring the roster button, the event path and the weekly job to them is the next step after the proposal is applied.
- No agent data path calls the scope guard yet (ADR-093); events raised here are still proposals for people to act on.

## Verification

- `tests/unit/org-workforce-sql.test.ts` (10 tests): proposal status, catalog equals the code definitions, allowed roles/plans/kinds/severities/channels equal the code, unknown plan rule, schedule time, safety constraints present, row-level security forced, `search_path` pinned, no write grants to ordinary users, rollback covers everything created.
- Scratch Postgres 16 check file: 102 checks passed; re-apply and rollback verified.
