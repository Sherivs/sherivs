# ADR-139: finished_at Is Write-Once on Runs and Steps (A5)

- Status: PROPOSED
- Date: 2026-11-26
- Builds on: ADR-103 (WF-01)

## Context
WF-01 refuses a status change on a finished run or step. It did not refuse rewriting `finished_at`, so the recorded moment a run or step ended could be moved after the fact. That moment is evidence in run history, retention and audit.

## Decision
`wf_run_guard` and `wf_step_run_guard` refuse any change to `finished_at` once it is set (to another time or to nothing), with SQLSTATE 42501 and the text "finished_at is write-once". For steps the rule applies only to final states (succeeded, dead, skipped, cancelled); a failed step may be retried and so is not final. Setting it when the run or step becomes final is unchanged, and so is every other update.

## Consequences
- No data change; the rule starts from the first update after the migration. Rows already final keep their value.
- Every existing harness (WF-01 to WF-15a2, AIN-01 to AIN-05) passes unchanged.

## Rollback
`database/supabase/rollbacks/20261117001001_sherivs_a5_finished_at_write_once.sql` restores the WF-01 guards.
