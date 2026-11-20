# ADR-124: Workflow Quotas, Wallet Caps and Retention (WF-12)

| Field          | Value                                                                                                                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status         | PROPOSED in the WF-12 PR; nothing applied to any hosted database                                                                                                                                                                              |
| Date           | 2026-11-20                                                                                                                                                                                                                                    |
| Creator        | Claude Code agent, mission WF-12 (provenance id W-012, issue #470); AI-generated                                                                                                                                                              |
| Version target | V1 organizational workflows                                                                                                                                                                                                                   |
| Depends on     | [ADR-105](ADR-105_WF03_WORKFLOW_RUNTIME_CORE.md), [ADR-116](ADR-116_WF06_ACTIONS_V1.md) (stacked on #455), [ADR-122](ADR-122_WF07_APPROVAL_INBOX_AND_STEP_UP.md) (#467), [ADR-123](ADR-123_WF08_RUN_HISTORY_REDACTION_RETRY_CANCEL.md) (#469) |
| Migration      | `database/supabase/migrations/20261117000960_sherivs_wf12_quotas_wallet_caps_retention.sql` (`..000950` is WF-08; `..001000` is used by PRs #448, #461, #462 and #464; the founder confirms the number before apply)                          |
| Rollback       | `database/supabase/rollbacks/20261117000960_sherivs_wf12_quotas_wallet_caps_retention.sql`                                                                                                                                                    |

## Provenance

| Item                         | Source                                                                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement                  | Issue #470 "WF-12: quotas, wallet caps and retention"; the WF-12 roadmap entry in the workflow hand-off; the retention deferral in ADR-123                     |
| Run, event and approval data | WF-01 to WF-07: `wf_run`, `wf_step_run`, `wf_run_event` (append-only), `wf_event`, `wf_approval`, `wf_approval_decision`, `wf_approval_step_up`                |
| Actions, drafts, outbox      | WF-06 `wf_action_draft`, `wf_action_sandbox_outbox`, the broker decision ledger `cg_tool_call_ledger`, and the delivery gate (ADR-116)                         |
| Runtime claim and attempts   | WF-03 `wf_create_event_run`, `wf_claim_due_events` (attempt counting and the dead threshold)                                                                   |
| Permissions and audit        | `wf_can`, `workflows.view`, `workflows.manage`, `wf_audit_append`, `wf_runtime_settings_audit` (ADR-104)                                                       |
| Identity binding pattern     | WF-07 `wf_act_as` / `wf_act_restore` and the server-passes-the-verified-user rule                                                                              |
| Wallet                       | `school_wallets` (read only, one balance column). No other wallet or FIN table is read or written                                                              |
| Legal holds                  | M12 `retention_legal_holds` (PR #318), read through `to_regclass` and dynamic SQL; the M12 retention engine itself is school-record specific and is not reused |

## Context

Workflows can now draft, approve and record actions. Nothing yet limits how much one organization can
make them do, nothing prevents a spend-bearing action from costing money without a cap, and nothing
removes old history, so every table grows for ever and keeps personal data past any reason to hold it.
WF-08 deferred retention to this mission.

## Decision

### Quotas

1. **One table, platform defaults when absent.** `wf_org_limits` holds one row per organization.
   `wf_org_limits_effective(org)` overlays the row on the platform defaults, so an organization with no
   row, or a missing key, is limited by the defaults. It is never unlimited.
2. **Limits and defaults.** Runs per rolling 24 hours: 500 (1 to 10,000). Steps per run: 100 (1 to 1,000);
   it can only lower the published workflow's own `max_steps`. Drafts waiting for review: 200 (1 to 2,000).
   Actions per hour, per kind (counted from executed records, 0 to 5,000): email 100, in_app 300, task 300,
   wait 300, webhook 60, sms 0, whatsapp 0. An unknown kind has no limit row and gets 0.
3. **Enforced in SQL, checked again in the runtime.** BEFORE INSERT triggers are the authority:
   `wf_run_15_quota` (daily runs and the step cap), `wf_action_draft_30_quota` (pending drafts, hourly
   actions) and `wf_action_sandbox_outbox_30_quota` (hourly actions, spend). A per-organization advisory
   lock serializes the count and the insert. The counting functions are `VOLATILE` so a multi-row insert
   sees its own rows. A replay with the same idempotency key consumes nothing and is not refused.
   The runtime calls `wf_quota_check_action` before the broker writes its ledger row, in `draft` or
   `execute` mode, for both the first dispatch and the dispatch of an approved draft. The call is
   fail-closed: a missing port, an error or anything but an explicit `allowed: true` stops the action
   (`workflow_quota_unavailable`, or `workflow_quota_<code>` for a refusal). The pre-check is a courtesy;
   the trigger would stop the write anyway.
4. **Daily run quota defers, it does not drop.** `wf_create_event_run` (WF-03, replaced here with the same
   body plus the check) puts an over-quota event back to `pending` five minutes later and gives the claim's
   attempt back. Without that, a full day would walk the event to `dead` after 25 claims. Nothing is lost
   and the event is processed once the window frees.
5. **Refusals are counted.** `wf_quota_denial` keeps hourly counters per organization, limit and kind (a
   number, no content), shown on the settings screen for the last 24 hours.

### Wallet caps

6. **Default zero, and zero is also the ceiling.** v1 sends email and in-app only, which cost nothing.
   `wallet_cap_kobo_per_day` and `wallet_cap_kobo_per_run` default to 0, and `wf_wallet_cap_ceiling_kobo()`
   returns 0 until the founder decides the SMS and WhatsApp rates (decision 2 in the hand-off), so a cap
   above 0 cannot be saved and an effective cap is clamped to the ceiling even if a row says otherwise.
7. **Spend is judged when it would be spent.** `wf_action_spend_rate` lists `sms` and `whatsapp` with
   `unit_kobo` NULL (no price decided). A NULL rate means every such action is refused
   (`spend_rate_unknown`). Free kinds cost 0. When a rate exists, an executed record costs `rate` times
   its recipients; the outbox trigger writes `cost_kobo` itself (a value supplied by a caller is overwritten
   and it is immutable afterwards) and refuses past the per-run cap, the per-day cap, or the wallet's
   spendable balance (`floor(balance * 100)` from `school_wallets`). Drafts spend nothing and are not
   refused for spend; a person can still review them.
8. **Read only.** The migration reads `school_wallets.balance`. It writes to no wallet, ledger or FIN table
   and moves no money.

### Retention

9. **Per-organization windows with safe minimums** (default / minimum / maximum days): sent-action records
   90/30/3650, decided drafts 180/90/3650, run events and inbound events 180/90/3650, finished runs
   365/180/3650, unused passkey-check records 365/90/3650, approval evidence 2555/730/3650. The table
   requires outbox, draft, event and run windows to be ordered (outbox at most draft at most run; event at
   most run; run at most evidence). `retention_auto_purge` is off by default.
10. **What a purge may delete.** Executed records and decided drafts of a finished run; run events of a
    finished run; passkey-check records that were never used; approval evidence (approvals that are not
    pending, their decisions and passkey records) once the evidence window has passed and the run is
    finished; finished runs and their steps; inbound events that are done and unreferenced. It never deletes:
    anything of a run that can still resume; anything an approval that is still `pending` points at;
    a run with a surviving child or retry link; an inbound event that a surviving run came from; an event
    that is pending or being processed; `audit_chain`; the broker ledger `cg_tool_call_ledger`;
    anything while an M12 tenant-scope or category legal hold is active for the organization.
11. **A narrow deletion carve-out in the append-only tables.** Run events, approval decisions and passkey
    evidence refuse UPDATE, DELETE and TRUNCATE. The delete guard is replaced so DELETE (only) is allowed
    when a transaction-local marker `wf.retention_purge` equals `org:<org>:<txid>` set by the purge, the
    marker's organization is the row's, and the session user is not `anon`, `authenticated` or
    `service_role`. Client roles also have no DELETE privilege. UPDATE and TRUNCATE stay refused.
12. **Dry run is the same pass, rolled back.** A dry run executes the whole purge inside a subtransaction
    and raises a private SQLSTATE with the counts, so its counts are exactly what a purge would delete at
    that moment. Each pass takes at most 5,000 rows per class and says when it was cut short.
13. **A person sees counts before anything is deleted.** `wf_retention_run_manual` (needs `workflows.manage`)
    defaults to a dry run. A purge must name a completed dry run of the same organization from the last 24
    hours, made with the windows still in force, and not used before, or it is refused
    (`wf12:dry_run_required`). The purge row records `dry_run_id` and a unique index lets one dry run
    authorize one purge; the check runs under the organization's retention lock.
14. **Scheduled purge is opt-in.** `wf_retention_run_scheduled` only touches organizations with
    `retention_auto_purge` on, at most once a day each, with no person as actor. One organization failing rolls
    only that organization back; it is reported as `failed` with its SQLSTATE only, audited as
    `workflow.retention.failed`, and the others still run (a failed organization has no log row, so the next
    call tries it again). It is called by
    `/api/public/cron/workflow-retention` (bearer `CRON_SECRET`, `WORKFLOWS_ENABLED` gate). The Cloudflare
    cron worker is NOT changed here; scheduling it is a founder decision.
15. **Audit.** Every dry run, purge and refusal writes `workflow.retention.dry_run`, `.purge` or `.refused`
    with counts and windows only, no row content or identifiers. Every limit change writes
    `workflow.wf_org_limits.changed` through the existing settings audit helper. `wf_retention_run` is an
    append-only log of the same.

### Privileges

16a. **Revoked from the service role too.** Supabase's default privileges grant everything a migrator creates to
`anon`, `authenticated` and `service_role`, so every function and table here is revoked from
`PUBLIC, anon, authenticated, service_role`, and only then granted back: EXECUTE on the nine functions the
server or the event run calls (`wf_limits_get`, `wf_limits_update`, `wf_retention_run_manual`,
`wf_retention_run_scheduled`, `wf_quota_check_action`, `wf_quota_runs_exceeded`, `wf_quota_note_denial`,
`wf_block_draft_dispatch`, `wf_approved_drafts_ready`) and SELECT on the four tables to the service role.
The purge passes, the settings helpers and the trigger functions are not callable by any client or
service-role session; the writes happen inside the `SECURITY DEFINER` functions. The harness reads the ACLs
from the catalog and CI re-applies WF-08 and WF-12 under those default privileges.
16b. **Quota timestamps are stamped by the database.** The triggers on runs, drafts and executed records set
`created_at := now()` on insert, and an executed record's `created_at` cannot be updated, so a caller
cannot back-date a row out of the quota window.
16c. **An approved draft that cannot ever execute is parked.** An approved SMS or WhatsApp draft whose rate is
still undecided (or whose kind is unknown) was dispatched, refused and noted on every sweep.
`wf_block_draft_dispatch` (only for `spend_rate_unknown` and `kind_unknown`) writes one
`draft.dispatch_blocked` timeline event with the code and takes the draft off the sweep's work list
(`wf_approved_drafts_ready`, replaced with WF-08's body plus that condition) for 24 hours. After a day it is
looked at once more, so a decided price releases it without anyone touching the draft. The run's own
deadline still ends a run whose draft stays parked.

### Surface and authority

16. **Settings.** `wf_limits_get` (`workflows.view`) and `wf_limits_update` (`workflows.manage`) are
    `SECURITY DEFINER` with an empty `search_path`, EXECUTE only to `service_role`. The server passes the
    verified user; the function binds it (`wf_act_as`) and derives the organization (never from input).
    Updates are patches: unknown keys, wrong types, values outside the bounds and a window order that
    breaks a constraint are refused with stable codes. The screen is `/home/s/workflow-limits`.
17. **Nothing existing is weakened.** No grant is widened. The new tables have forced row security; clients
    may read through `wf_can`; only the service role reads. The one change to an existing guard is the
    delete carve-out in item 11. WF-03's `wf_create_event_run` keeps its body apart from the quota check.

## Assumptions (open)

- The retention minimums and defaults are engineering choices, not legal advice. Their basis (education
  records, financial approval evidence) is UNVERIFIED and needs the founder's legal review.
- Approval evidence is kept 2555 days (about seven years) by default as a stand-in for a record-keeping rule.
- Any active M12 tenant-scope or category hold blocks all workflow purges for that organization.
- Hourly counts use executed records and pending-draft counts, not attempts.

## Consequences

- Parked drafts are re-checked once a day rather than being terminal; a terminal state would need a new draft
  status and a change to WF-06's constraints, which this mission does not make.
- Old inbound events lose their dedupe keys after the event window; the same source event arriving later
  would be treated as new. Windows are therefore much longer than any source's retry horizon.
- A dry run reports what is eligible now. Rows become eligible in chains (events, then run, then step), and a
  large backlog needs several passes.
- `wf_action_sandbox_outbox` gains `cost_kobo`. An SMS record cannot be written while its rate is undecided,
  which is intended; the WF-07 harness fixture that wrote one now uses email.
- The rollback refuses once a purge or a non-zero cost has been recorded; the log is history.

## Validation boundary

Verified on a local disposable PostgreSQL 16 with a PostgREST stub and counting provider stubs; CI uses
PostgreSQL 17. Nothing was applied to staging or production, no organization was enabled,
`WORKFLOWS_ENABLED` is unchanged and no message was sent.
