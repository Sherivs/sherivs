# AIN-01 follow-up: a spent agent budget defers the event

Status: built (database), draft PR, NOT APPLIED.

- Migration `20261127000600_sherivs_ain01_budget_deferral.sql` (rollback restores the previous function). `wf_create_event_run` now catches only `ain01:budget_daily_actions` (SQLSTATE 54000): the run and first step roll back together, the attempt is given back and the event goes back to pending for an hour later. Every other refusal still raises (undecided AI route, class not allowed, paused agent), because waiting does not fix those.
- Tests: three checks added to `tests/integration/wf12-quotas-retention.local.sql` (now 218 pass; the new check fails without the migration). AIN-01's own harness still passes (136).
- Not built: a counter or alert for budget deferrals (WF-12 counts quota denials; this does not yet); the approval-step resume and approver notification.
- Needs: founder approval and a backup before apply; Tumi's review.
