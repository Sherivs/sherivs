# ENGINE-20 and ENGINE-22 applied to production

Applied on 2026-11-15 to the production Supabase project, after the owner's approval, using the migration tool. Ledger names: `20261110000400_sherivs_engine20_org_agent_addons_events_reports` and `20261110000500_sherivs_engine22_org_agent_role_holders`. The ledger versions are apply-time versions, not the file timestamps.

## Evidence

- Both proposals' behavioural checks passed on a scratch Postgres 16: ENGINE-20 102 of 102, ENGINE-22 14 of 14.
- The rollback ran clean on the same scratch database.
- `verify.sql` returned the expected values in production: 17 catalog rows, 5 tables with forced RLS, 13 functions with a pinned search path, no client-callable internals, no anonymous callers, 2 ledger rows.

## One addition to the proposals

The two trigger functions and `org_tier_rank` have their execute grant revoked from PUBLIC, anon and authenticated. Clients never call them.

## Why this is not in `database/supabase/migrations`

The domain-neutrality guard scans every file in that folder, and these two use school vocabulary (principal, bursar, school_id). The guard's baseline is shrink-only and an addition needs its own ADR. Rather than extend the baseline, the exact SQL is kept here. If the owner wants them in the migrations folder, that needs a new ADR and a baseline decision.

## Files

| File           | Purpose                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| `apply.sql`    | The exact SQL that ran, ENGINE-20 then ENGINE-22.                                                     |
| `verify.sql`   | Read-only post-apply check.                                                                           |
| `rollback.sql` | Inverse, one transaction. The event and report logs are append-only evidence and are destroyed by it. |

Nothing here sends anything: the notification worker is not built, and SMS is not involved.
