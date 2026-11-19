# ADR-123: Run History with Server-Side Redaction, Retry and Cancel (WF-08)

| Field          | Value                                                                                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Status         | PROPOSED in the WF-08 PR; nothing applied to any hosted database                                                                                                                                                                                                   |
| Date           | 2026-11-19                                                                                                                                                                                                                                                         |
| Creator        | Claude Code agent, mission WF-08 (provenance id W-008, issue #468); AI-generated                                                                                                                                                                                   |
| Version target | V1 organizational workflows                                                                                                                                                                                                                                        |
| Depends on     | [ADR-104](ADR-104_WF02_WORKFLOW_PERMISSIONS_AND_TEMPLATES.md), [ADR-105](ADR-105_WF03_WORKFLOW_RUNTIME_CORE.md), [ADR-116](ADR-116_WF06_ACTIONS_V1.md) (stacked on #455), [ADR-122](ADR-122_WF07_APPROVAL_INBOX_AND_STEP_UP.md) (stacked on #467)                  |
| Migration      | `database/supabase/migrations/20261117000950_sherivs_wf08_run_history.sql` (the number first reserved, `20261117001000`, is already used by `..001000_sherivs_m2a_role_catalog_extension.sql` on the PR #448 branch; the founder confirms the number before apply) |
| Rollback       | `database/supabase/rollbacks/20261117000950_sherivs_wf08_run_history.sql`                                                                                                                                                                                          |

## Provenance

| Item                      | Source                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Requirement               | Issue #468 "WF-08: run history, PII redaction, retry and cancel"; the WF-08 roadmap entry in the workflow hand-off                                                 |
| Run, step and event model | WF-01 to WF-03: `wf_run`, `wf_step_run`, `wf_run_event`, the immutable-when-finished guards (`wf_run_guard`, `wf_step_run_guard`) and the engine's terminal states |
| Permissions and audit     | `wf_can`, `workflows.view`, `workflows.run`, `workflows.manage`, `wf_audit_append` (ADR-104)                                                                       |
| Actions, drafts, outbox   | WF-06 `wf_action_draft`, `wf_action_sandbox_outbox`, the broker decision ledger, and the delivery gate (ADR-116)                                                   |
| Run end closes approvals  | WF-07 `wf_run_80_close_approvals` (ADR-122)                                                                                                                        |
| Identity binding pattern  | WF-07 `wf_act_as` / `wf_act_restore` and the server-passes-the-verified-user rule                                                                                  |

## Context

People who run workflows need to see what happened, stop a run that should not continue, and try a
failed step again, without being able to leak a recipient, repeat an action that already happened,
climb past a draft cap or send anything live. The database already makes finished runs and dead steps
immutable on purpose, so a retry cannot reopen them.

## Decision

1. **Redaction is done in the database, by allow-list.** `wf_run_history_list` and
   `wf_run_history_detail` return statuses, counts, step and event kinds, timestamps, codes and ids. They
   never return recipient ids or addresses, template parameters, step inputs or outputs, event payloads,
   subject references, approval summaries or notes, or webhook targets. A draft shows the **number** of
   recipients and parameters. The timeline passes through `wf_redact_event_detail`, which keeps only named
   keys whose values have the exact expected shape (a uuid, a lower-case code, `normal` or `high`, and so
   on); everything else, including any key it has not heard of, is dropped. The engine's `runtime.state`
   blob is excluded entirely. The TypeScript parsers are strict (unknown keys are rejected) and scrub
   address-like and phone-like labels again on the way to the screen.
2. **Authority.** Four `SECURITY DEFINER` functions with an empty `search_path`, EXECUTE only to
   `service_role`. The server passes the verified session user; the function binds it (`wf_act_as`),
   derives the organization from it (never from input) and restores the claims. History needs
   `workflows.view`; retry needs `workflows.run`; cancel needs `workflows.run` or `workflows.manage`.
   Another organization's run is "not found". No new permission, no new table, no policy change.
3. **Cancel.** A queued, running or waiting run becomes `cancelled`; in-flight steps lose their lease, so a
   late result is not persisted; the existing run-end trigger cancels pending approvals, undecided drafts
   and waiting steps. An approved draft is frozen and stays approved, but a new BEFORE INSERT guard on the
   outbox refuses an executed record for a run that is not active, so an approved-but-undispatched action
   of a cancelled run is never dispatched. Cancelling twice returns `replayed` and writes nothing more. A
   reason is a code from a fixed list, never free text.
4. **Retry is a new run.** A retry creates a new `wf_run` (`retry_of_run_id`, `retry_of_step_id`,
   `retry_generation`) with one pending step for the dead step's key, and an engine state copied from the
   source with the run id replaced, the state set to running, the attempts cleared and a `run_retried`
   history entry. The source run, its steps and its engine state are not touched. A unique index allows one
   retry per dead step, so a repeat returns the same run (`replayed`). The chain stops at generation 3.
   The person who retries becomes the run's starter, so they can never approve what it drafts.
5. **What retry refuses** (`wf_retry_blockers`, the single source for both the refusal and the reason the
   screen shows): not authorized; workflows disabled for the organization; the run cancelled (a rejected or
   expired approval ends a run as cancelled, so retry cannot go round a decision); the step not dead; an
   approval-kind step; a paused or retired workflow; a version that is no longer the published one; an
   engine state that did not stop at this step; a draft already made for the step; an executed record or a
   broker "execute" decision already recorded for the step; the retry limit. It also refuses if the new
   step would get more autonomy than the dead one had, or if a capped class would end above draft
   (`autonomy_escalation`). The new step is an ordinary step: the autonomy trigger sets its level, it is
   claimed only for an enabled organization, and any action goes through the same broker, draft cap,
   approval and delivery gate as a first attempt.
6. **Audit.** `workflow.run.cancel_requested` and `workflow.run.retry_requested` through
   `wf_audit_append`, plus a timeline event on each run (`run.cancel_requested`, `run.retry_requested`,
   `run.retried`). A refusal writes nothing.
7. **No change to existing guards.** `wf_run_guard`, `wf_step_run_guard`, RLS, grants, the draft freeze
   and the separation-of-duties rules are untouched. The migration runs inside `BEGIN`/`COMMIT` so a
   failure cannot leave it half applied (the reviewed WF-06 and WF-07 migrations follow the repository's
   existing shape; this one adds the transaction deliberately).

## Assumptions (open)

- Retry is refused while workflows are disabled for the organization; cancel and history still work.
- Cancel is allowed to `workflows.run` or `workflows.manage` holders; retry only to `workflows.run`.
- A dead approval-kind step is never retried; approvals are decided by people, and a rejected or
  expired one cancels its run.
- Sub-workflow children are not cancelled with their parent in this version.

## Consequences

- Raw reads of the WF-01 tables by people with `workflows.view` still exist as WF-01 defined them and
  are not redacted; this ADR makes the history functions the supported path, it does not remove the
  older read policy. Restricting it is a decision for the owner.
- Retention and archiving of old runs is WF-12.
- Retry runs add rows; the rollback therefore refuses while any retry run exists.

## Validation boundary

Verified on a local disposable PostgreSQL 16 with a PostgREST stub and counting provider stubs; CI uses
PostgreSQL 17. Nothing was applied to staging or production, no organization was enabled,
`WORKFLOWS_ENABLED` is unchanged and no message was sent.
