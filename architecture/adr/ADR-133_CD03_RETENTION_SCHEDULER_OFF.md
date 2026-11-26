# ADR-133: The Retention Scheduler Stays Off Until Counsel Confirms Retention Periods (CD-03)

| Field      | Value                                                                              |
| ---------- | ---------------------------------------------------------------------------------- |
| Status     | PROPOSED in the CD-02/03 PR; nothing applied to any hosted database               |
| Date       | 2026-11-26                                                                         |
| Creator    | Claude Code agent, missions CD-02 and CD-03; AI-generated                          |
| Decision   | Founder, Decision Pack consent agenda, 26 Nov 2026 ("decide as a cautious CTO would") |
| Depends on | [ADR-124](ADR-124_WF12_QUOTAS_WALLET_CAPS_RETENTION.md)                            |
| Migration  | `database/supabase/migrations/20261117000962_sherivs_cd03_retention_scheduler_off.sql`                                                  |
| Rollback   | `database/supabase/rollbacks/20261117000962_sherivs_cd03_retention_scheduler_off.sql`                                                   |

## Context

`wf_retention_run_scheduled` purges, once a day, every organisation that opted in with `retention_auto_purge`. The HTTP cron route exists but is not scheduled. Nothing in the database stopped a purge if someone wired the route or called the function.

## Decision

A one-row platform table `wf_retention_platform` has `scheduler_mode` `off` (default), `dry_run` or `purge`. Off: the scheduler returns `{orgs: [], mode: off}` and does nothing. Dry run: it counts eligible rows for opted-in organisations and deletes nothing. Purge: today's behaviour, and the table refuses it unless a counsel reference and confirmation date are recorded. The table has no API grants; only the database owner, in a change the founder approves in writing, can change the mode.

## Consequences

- Retention windows stay at their WF-12 defaults and nothing is deleted automatically until counsel confirms them.
- Operators can switch to dry run first to see real counts before any purge.
- The manual, person-run purge (preview, then run) is unchanged.
