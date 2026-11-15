# ADR-099: Organization Agent Screen Wiring and the Weekly Report Job

| Field                      | Value                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required before deployment)                                                                                             |
| Date                       | 2026-11-15                                                                                                                                              |
| Author                     | Claude Code agent (ENGINE-21 implementation)                                                                                                            |
| Creator                    | Claude Code agent, mission E-001 (issue #EPIC)                                                                                                          |
| Mission                    | ENGINE-21 (the app side of the organization workforce add-ons)                                                                                          |
| Capabilities               | Switch an organization agent on, off, pause or resume it from the roster; acknowledge what agents raised; build the weekly report for each organization |
| Cites                      | [ADR-097](./ADR-097_ENGINE_ORG_AGENT_ROSTER_ROLE_PACKETS_AND_POLICIES.md); [ADR-098](./ADR-098_ENGINE_ORG_AGENT_ADDONS_EVENTS_AND_WEEKLY_REPORTS.md)    |
| Minimal ownership artifact | `frontend/src/lib/org-workforce/agent-actions.ts`                                                                                                       |

## Context

ADR-098 proposes the tables and functions behind switching agents on, the event log and the weekly report requests. The roster's "Switch on" button was disabled and nothing read or wrote them. This change connects the app to those functions. It stays inert until the proposal is applied: every call degrades to a plain sentence when the functions are missing.

## Decision

1. **The database is the authority.** The roster calls `change_org_agent` and `ack_org_agent_event` and reads `org_agent_addon_events` and `org_agent_events` under the caller's own sign-in. Nothing here widens access. The app checks `settings.manage` first only so that it does not show a wrong picture to someone the database would show nothing to.
2. **A person without `settings.manage` sees what the plan includes and nothing about what is on.** The log is unreadable to them, so an empty result would otherwise read as "nothing is switched on".
3. **Not applied is a state, not an error.** A missing function or table (`42883`, `42P01`, `PGRST202`, `PGRST205`) keeps the switch disabled with the existing reason and shows no error. Any other database text is replaced by a sentence; raw messages are never shown.
4. **Schools get four actions.** Switch on, switch off, pause and resume. The platform's own pause and resume exist in the database and are not offered. A platform pause shows its reason and cannot be resumed by the school. Pause and resume need a reason of 10 to 300 characters; the check is repeated before the call, and a test fails if the database bounds change.
5. **Who holds each agent's approving role is not loaded on this screen.** The roster says "Switched on. Who approves it is not checked on this screen yet." for a switched-on agent instead of claiming someone is missing. This is a known gap, not a decision.
6. **Safeguarding text is never shown.** The database stores none, and the screen and the report drop any that appears.
7. **The weekly report job is a cron route in the existing pattern.** `/api/public/cron/org-weekly-reports` takes `Authorization: Bearer $CRON_SECRET`, like the wallet and integrations jobs, so it runs from Vercel Cron, n8n or any scheduler. It asks for the window ending at the most recent Monday 06:30 UTC (07:30 in Lagos), builds each organization's report from that organization's events, and stores it. The window is deterministic, so a retry or a manual call in the same week asks for the same window and the database keeps one request per organization per week. One organization failing does not stop the others. It returns 503 until `CRON_SECRET` is set and until the proposal is applied.
8. **The job builds and stores; it sends nothing.** Sending needs the notification worker, which is not part of this change. Reports are addressed to email because no verified WhatsApp opt-in is read yet.

## Consequences

- Nothing changes for a school until the ENGINE-20 proposal is applied. After that the roster works, and the job works once a scheduler calls it.
- The job is not scheduled. No scheduler configuration is added. The owner picks the runner (see `docs/runbooks/org-weekly-reports.md`).
- The screens were not driven in a browser and the SQL functions have not run against a real Supabase project. The unit tests exercise the planner, the state fold (which must match `org_agent_state`), the loader with a stub database, the job with a stub service client, and the route's secret check.
- The role-holder gap (point 5) means a switched-on agent is not yet reported as "Running". Closing it needs a source that maps an organization's role holders to the membership roles the agents are accountable to.

## Verification

See the pull request. Unit tests: `org-agent-wiring.test.tsx` and `org-agent-state-loader.test.ts`, with deliberate-fault checks on the planner, the fold, the roster view model, the loader, the job and the route.
