# AIN-01 follow-up: a spent agent budget defers the event

Status: built (database), draft PR, NOT APPLIED.

- Migration `20261127000600_sherivs_ain01_budget_deferral.sql` (rollback restores the previous function). `wf_create_event_run` now catches only `ain01:budget_daily_actions` (SQLSTATE 54000): the run and first step roll back together, the attempt is given back and the event goes back to pending for an hour later. Every other refusal still raises (undecided AI route, class not allowed, paused agent), because waiting does not fix those.
- Tests: three checks added to `tests/integration/wf12-quotas-retention.local.sql` (now 219 pass; the new checks fail without the migration). AIN-01's own harness still passes (136).
- Deferrals are counted as limit name `agent_budget_day` in the WF-12 denial counter. Not built: an alert on that counter; resuming a plain approval-kind step after approval (the resume lives in the TypeScript engine's persisted run record and needs its own design and an end-to-end test).
- Needs: founder approval and a backup before apply; Tumi's review.
