# Workflow enablement runbook

Origin: `database/supabase/migrations/20261117000700_sherivs_wf05_event_sources_v1.sql` and
`architecture/adr/ADR-111_WF05_EVENT_SOURCES_V1.md`  
Creator: copilot-swe-agent[bot]  
Status: operator guidance validated against the WF-05 local sim-lab checks; no hosted changes.

This runbook covers only V1 organizational workflows. The cron route and each organization's
workflow setting are separate controls. Enabling the route or global application flag does not
enable any organization; the `wf_org_settings` row is the event-emission and runtime gate.

## Action delivery mode

`WORKFLOW_DELIVERY_MODE` is the action delivery kill switch. Unset or invalid values resolve to
`off`. In `off`, effectful workflow actions are refused. In `sandbox`, the broker decision is
ledgered and a tenant-scoped sandbox outbox row is written; no provider is contacted. Use
`sandbox` for staging and verify the corresponding outbox/ledger evidence before considering any
production action. Sandbox still requires the action's published role-pack capability and an
active tenant connector binding for the organization; if either is missing, the broker denies
execution and the action remains a draft. The binding is an authorization prerequisite, not a
provider call, and sandbox mode does not resolve its secret or contact the connector.

`live` is refused unless `WORKFLOWS_ENABLED` is exactly `true`, `APP_ENV` is exactly
`production`, and the action's organization has `wf_org_settings.workflows_enabled=true`. Staging
is therefore limited to `sandbox`, even if `live` is mistakenly configured. Live delivery also
requires an available, reviewed broker connector adapter, active tenant binding, and resolved
secret; missing prerequisites fail closed. Do not configure production live delivery as part of
this mission.

For an emergency stop, set `WORKFLOW_DELIVERY_MODE=off`, set `WORKFLOWS_ENABLED=false`, disable
the organization's `wf_org_settings.workflows_enabled`, and disable the Worker route. The mode
gate is checked for each effectful action; invalid mode values also stop delivery. These controls
do not delete ledger, draft, or sandbox-outbox records.

## Approval inbox (WF-07)

Origin: `database/supabase/migrations/20261117000900_sherivs_wf07_approval_inbox.sql` and
`architecture/adr/ADR-122_WF07_APPROVAL_INBOX_AND_STEP_UP.md`. Not applied to any hosted database by
the mission that wrote it; the lead applies it to staging.

Every draft WF-06 produces now gets an approval in the tenant inbox, opened from the workspace menu
as **Approvals** (`/home/s/approvals`). Who can decide, and how many people are needed:

- Deciding needs the `workflows.approve` permission. The admin pass-through that grants view does
  not grant it. The person who started the run, wrote or last edited the workflow version, or created
  its template cannot decide it, and nobody votes twice. Open decision 4 (who may author and approve)
  is not settled; until it is, only these existing rules apply.
- One approver is needed for normal risk and for high-risk categories outside the list below. Two
  different approvers are needed for money movement, safeguarding and mass messages. Those
  categories are always high risk.
- Each high-risk approval needs its own passkey confirmation, tied to that approval and to the
  content fingerprint on screen. It is single use and valid for five minutes. A person without a
  passkey cannot approve a high-risk item; they can still reject. Rejecting never needs a passkey.
- If the content changes after someone opened it, their approval is refused and earlier approvals no
  longer count. A reject or an expiry (seven days) ends the whole run.
- After the required approvals, the cron route's approval sweep dispatches the draft to the sandbox
  outbox, through the broker, and lets the run continue. Live delivery of an approved draft is
  refused in v1. The inbox is pull-based: nothing notifies the approvers, so tell them where to look.

Per-organization counts live in `wf_approval_policy` (service role only; each change is audited).
Defaults apply when no row exists. Money movement and safeguarding cannot be taken off the
two-person list, and the two-person count cannot go below 2:

```sql
-- Staging only, as an authorized operator. Raises the count for one organization to three.
INSERT INTO public.wf_approval_policy (org_id, two_person_required)
VALUES ('<verified-staging-school-uuid>', 3)
ON CONFLICT (org_id) DO UPDATE SET two_person_required = EXCLUDED.two_person_required;
```

Checks before a staging pilot, with `WORKFLOW_DELIVERY_MODE=sandbox`:

1. Give two different users in the pilot organization `workflows.approve`, neither the workflow's
   author nor the person who starts runs, and register a passkey for each.
2. Trigger a draft (for example a message to more than 25 recipients). It appears under
   **Waiting for a decision** with "0 of 2 approvals" and a high-risk tag.
3. Approve as the first person: the item stays waiting and shows "waiting for a second approver".
   `wf_action_sandbox_outbox` must have no row for it yet.
4. Approve as the second person. After the next cron pass there is one outbox row with `draft_id` set
   and a broker decision keyed `wf-approved:<draft id>`, and the run continues.
5. Reject one item and let another expire: neither reaches the outbox, and both runs are cancelled.

The evidence is in `wf_approval_decision`, `wf_approval_step_up` and the audit chain
(`workflow.approval.vote_approve`, `.vote_reject`, `.step_up_verified`, `.step_up_failed`,
`.viewed`). Do not log the content fingerprint with person data.

If the sweep misbehaves, the existing kill switch applies unchanged (`WORKFLOW_DELIVERY_MODE=off`,
`WORKFLOWS_ENABLED=false`, the organization setting, the Worker route). Already approved drafts stay
approved and wait; nothing is deleted. For schema rollback use the paired WF-07 rollback after the
kill switch, and note that it refuses to run while approved capped drafts or their outbox records
exist: export and remove those first.

## Before a staging pilot

1. Confirm the WF-01 through WF-05 migrations and rollbacks are present in the intended staging
   database, source event types are present in `wf_event_source`, and the pilot `org_id` is the
   canonical UUID from `schools.id`.
2. Use a staging application and a staging-only `CRON_SECRET`. Confirm the staging Worker's
   `TARGET_BASE_URL` is the staging HTTPS origin (not the placeholder and never production), and
   `ROUTE_WORKFLOW_TICK` is exactly `"true"`. Keep all unrelated Worker routes off.
3. Set the staging application's `WORKFLOWS_ENABLED=true` and
   `WORKFLOW_DELIVERY_MODE=sandbox`. This permits the authenticated cron route and sandbox
   recording; it does not enable other organizations or contact a provider.
4. As an authorized operator, enable only the approved synthetic/pilot organization:

   ```sql
   INSERT INTO public.wf_org_settings (org_id, workflows_enabled)
   VALUES ('<verified-staging-school-uuid>', true)
   ON CONFLICT (org_id) DO UPDATE SET workflows_enabled = EXCLUDED.workflows_enabled;
   ```

5. Publish and bind only the reviewed template/event type for that organization. Confirm the
   source event payload keys match `wf_event_source.payload_keys` and contain no names, contact
   details, free text, or student result values.

## Production enablement (human approval required)

**Do not enable production workflows without Muhammad's written approval.** The approval record
must identify the organization UUID, event type/template, intended start time, operator, rollback
owner, and review window. No such approval is granted by this mission or by merging this PR.

After that record exists, the authorized operator must:

1. Verify the production WF-05 migration has been applied through the canonical database change
   process, with a fresh backup and a rehearsed rollback. This coding mission does not apply it.
2. Verify the production `TARGET_BASE_URL`, `CRON_SECRET`, worker version, and database connection
   refer only to production. Set `ROUTE_WORKFLOW_TICK="true"`, `WORKFLOWS_ENABLED=true`, and
   `WORKFLOW_DELIVERY_MODE=live` only for the approved window and only after the broker connector
   adapter, binding, template, recipient resolver, and kill-switch behavior have passed review.
3. Enable exactly the approved `wf_org_settings.org_id` using the scoped statement above, after
   confirming it resolves to the approved `schools.id`. Do not enable all organizations or infer
   the tenant from a client-provided identifier.
4. Start with one published, reviewed template and one allow-listed event type. Reconfirm autonomy,
   approval, tenant isolation, payload minimization, and audit evidence before expanding scope.

## Run history, retry and cancel (WF-08)

Origin: `database/supabase/migrations/20261117000950_sherivs_wf08_run_history.sql` and
`architecture/adr/ADR-123_WF08_RUN_HISTORY_REDACTION_RETRY_CANCEL.md`. Not applied to any hosted
database by the mission that wrote it; the lead applies it to staging. The migration number
`20261117000950` replaces the reserved `20261117001000`, which another branch already uses.

People with `workflows.view` open **Workflow runs** (`/home/s/workflow-runs`) in the workspace menu. The
list and detail come from SQL functions that redact by allow-list: statuses, counts, codes and times are
shown; recipient addresses, phone numbers, message text, parameters, payloads and approval notes never
are. A draft shows how many recipients it has, not who.

- **Cancel** needs `workflows.run` or `workflows.manage`, works on a queued, running or waiting run, asks
  for a reason from a fixed list, stops waiting steps, approvals and undecided drafts, and also stops a
  dispatch that was approved but not yet made (the outbox refuses an executed record for a run that is not
  active). Cancelling twice is harmless.
- **Retry** needs `workflows.run` and is offered only on a step that failed for good. It starts a NEW run
  at that step; the original run is never edited. A second retry of the same step returns the same new run.
  The person who retries cannot approve what the new run drafts. A chain stops at three retries.
- Retry is refused, with a plain reason on the screen, when the step already drafted or took its action,
  when the run was cancelled, when workflows are disabled for the organization, when the workflow is paused
  or was republished, when it is an approval step, and when it would give the step more autonomy than it
  had. Capped actions still stop at a draft and an approval; live delivery stays off.

Checks before a staging pilot, with `WORKFLOW_DELIVERY_MODE=sandbox`:

1. As a person with `workflows.view` only, open a failed run: no Cancel or Retry button is shown.
2. As a person with `workflows.run`, retry the failed step. A new run appears with "Retry 1 of 3" and
   the original stays failed. Repeating the retry opens the same new run.
3. Cancel a run that has an approved draft waiting for the sweep. After the next cron pass
   `wf_action_sandbox_outbox` has no row for it.
4. Look in the audit chain for `workflow.run.cancel_requested` and `workflow.run.retry_requested`, one
   each per action, with the person's id.

If a retry misbehaves, the existing kill switch applies unchanged. For schema rollback use the paired WF-08
rollback after the kill switch; it refuses to run while any retry run exists (cancel or leave them, they
are history) and must be applied before the WF-07 rollback.

## Limits, wallet caps and retention (WF-12)

Origin: `database/supabase/migrations/20261117000960_sherivs_wf12_quotas_wallet_caps_retention.sql` and
`architecture/adr/ADR-124_WF12_QUOTAS_WALLET_CAPS_RETENTION.md`. Not applied to any hosted database by the
mission that wrote it; the lead applies it to staging after WF-08. The number `20261117000960` is free on
every branch checked; `..001000` is used by other PRs.

People with `workflows.view` open **Workflow limits** (`/home/s/workflow-limits`) to see usage against the
limits, what was refused in the last 24 hours and the retention windows. Changing anything needs
`workflows.manage`. An organization with no saved settings uses the platform defaults: 500 runs a day, 100
steps a run, 200 drafts waiting, and per hour email 100, in-app 300, task 300, wait 300, webhook 60, SMS 0,
WhatsApp 0.

- **Over a quota** the action or run waits or is refused; nothing is dropped. An event over the daily run
  quota stays pending and is retried every five minutes. An action over the hourly quota fails its step
  with `workflow_quota_actions_per_hour` and follows the normal step retry rules.
- **Spend caps stay at zero** and cannot be raised until the SMS and WhatsApp rates are decided and the
  ceiling function is replaced. SMS and WhatsApp executed records are refused while no rate is decided.
  Email and in-app cost nothing. Nothing here moves money.
- **Retention** removes history past its window. Run a dry run first: it counts what a purge would remove and
  deletes nothing. A purge must name a dry run from the last 24 hours, made with the windows still in force; each dry run authorizes one purge. Pending approvals, active runs, audit
  records and the broker ledger are never removed, and an active legal hold refuses the purge.
- **Automatic purge** is off. To enable it for an organization turn on "Purge automatically" in the screen;
  it runs only when `/api/public/cron/workflow-retention` is called. The Cloudflare cron worker does not
  call it yet (founder decision).

Checks before a staging pilot, with `WORKFLOW_DELIVERY_MODE=sandbox`:

1. As a person with `workflows.view` only, open the screen: the fields are disabled and there is no Save.
2. As a person with `workflows.manage`, set runs per day to 2 and emit three events: two runs start, the
   third event stays `pending` with `attempts` unchanged, and starts after the limit is raised.
3. Run a dry run on an organization with old history. Check the counts, confirm nothing was deleted, then
   purge. The audit chain holds `workflow.retention.dry_run` and `workflow.retention.purge` with counts only.
4. Confirm a draft waiting for approval and its run were not touched, however old.

Rollback: `database/supabase/rollbacks/20261117000960_...sql` refuses once a purge was logged or a cost was
recorded. Apply it after the kill switch and before the WF-08 rollback.

## Agents as engine actors (AIN-01)

Origin: `database/supabase/migrations/20261117000970_sherivs_ain01_agents_as_engine_actors.sql` and
`architecture/adr/ADR-125_AIN01_AGENTS_AS_ENGINE_ACTORS.md`. Not applied to any hosted database by the mission
that wrote it; the lead applies it to staging after WF-12. The number `20261117000970` is free on every branch
checked; `..001000` is used by other PRs.

Every workflow step that runs under an agent must now name a registered agent (42 are seeded: 25 Sherivs-internal
and 17 organization agents). A new step is refused, with a code, when the agent is unknown, not granted to the
organization, not enabled, paused, not allowed that class of action for its tier, or past its daily action
budget. Existing steps are never stopped by a later pause; the pause stops new work.

- **Organization agents** are switched on and paused where they already are (the organization add-on state). If
  that state is missing from the database the step is refused (`ain01:org_state_unavailable`).
- **Internal agents** run in no organization until a reviewed migration grants them (`wf_agent_platform_grant`).
  No administrator, screen or server call can grant one.
- **AI steps** (kind `ai`) cannot be created for anyone while founder decision 3 (AI route) is open.
  `wf_ai_route_approved()` returns false; replacing it is a reviewed migration.
- **Autonomy** is not changed by any of this: an agent without an earned level stays at suggest.

Checks before a staging pilot, with `WORKFLOW_DELIVERY_MODE=sandbox`:

1. Read the registry for a pilot organization through `wf_agent_registry_get` (service role, with a person who has
   `workflows.view`): organization agents are listed with their state; no internal agent is listed.
2. Start a run under an organization agent that the organization has not enabled: the event is retried and the step
   is never created (`ain01:agent_not_enabled`). Enable the agent in the add-on state and retry: the step is created.
3. Pause the agent and start another run: refused (`ain01:agent_paused`); a step already running finishes.
4. Confirm no step of kind `ai` exists: `SELECT count(*) FROM public.wf_step_run WHERE kind = 'ai'` is 0.

Rollback: `database/supabase/rollbacks/20261117000970_...sql` refuses while a platform grant exists. Apply it after
the kill switch and before the WF-12 rollback.

## Autonomy scale and promotion gate (AIN-02)

Origin: `database/supabase/migrations/20261117000980_sherivs_ain02_autonomy_scale_and_promotion_gate.sql` and
`architecture/adr/ADR-126_AIN02_AUTONOMY_SCALE_AND_PROMOTION_GATE.md`. Not applied to any hosted database by the
mission that wrote it; the lead applies it to staging after AIN-01. The number `20261117000980` is free on every
branch checked; `..001000` is used by other PRs.

There is one scale, `suggest < draft < act_with_approval < act_and_report`, mapped to the earned-autonomy ladder
(shadow, propose, assist, autonomous). A step runs at the lowest of: its template, the organization ceiling, the
level the agent has earned, the ceiling for the agent's tier (executive: act_with_approval; assurance: draft) and
the cap for its action class (the six capped classes and unclassified actions: draft; model steps: suggest).

- **Nobody sets an earned level directly.** The service role can read `wf_agent_autonomy` and cannot write it. A
  level rises only through `wf_autonomy_promote`: the server passes the verified person, who must be an active
  super admin (the founder), one rung at a time, with fresh evidence that clears the bar and a written reason.
  Each piece of evidence promotes once.
- **Evidence** is numbers only (counts, suite id, time, content hash), recorded with `wf_autonomy_record_evidence`.
  A pass rate below 0.90, any critical failure or nothing graded lowers the agent one rung in every organization,
  automatically, and writes a ledger row.
- **Demotion** by a person (`wf_autonomy_demote`) is open to the founder and to an administrator of the same
  organization, and can only lower.
- The ledger (`wf_autonomy_change`) and the evidence table are append-only and are the record of why an agent has
  its level; every change also writes the audit chain.

Checks before a staging pilot, with `WORKFLOW_DELIVERY_MODE=sandbox`:

1. As the service role, try `UPDATE public.wf_agent_autonomy SET earned_level = 'act_and_report'`: it is refused
   (`42501`).
2. Record evidence of 20 graded cases with 18 passed for a granted agent and promote it with a person who is not a
   super admin: refused (`ain02:only_the_founder_promotes`). Promote with the founder: the agent moves one rung and
   one row appears in `wf_autonomy_change`.
3. Try the same evidence again for another rung: refused. Try to skip a rung: refused.
4. Record a result with a pass rate of 0.89: the agent drops one rung in each organization and the ledger shows
   `auto_demote` rows with no person.
5. Confirm nothing was sent: `SELECT count(*) FROM public.wf_action_sandbox_outbox` is unchanged.

Rollback: `database/supabase/rollbacks/20261117000980_...sql` refuses while the ledger or the evidence table holds a
row (export them first) and leaves every earned level as it is. Apply it after the kill switch and before the
AIN-01 rollback.

## Kill switch and rollback

To stop new emission and processing, set `WORKFLOW_DELIVERY_MODE=off` first, then set the pilot
organization's `wf_org_settings.workflows_enabled=false`. Then set the application
`WORKFLOWS_ENABLED` unset/false and the Worker `ROUTE_WORKFLOW_TICK="false"`. The org setting
stops source emission even if the cron route is still running; the global and Worker settings stop
tick dispatch.
Already queued events remain stored and unclaimed while the organization is disabled; do not
delete them as a kill-switch shortcut.

For schema rollback, use the paired WF-05 rollback through the canonical database change process.
It removes only WF-05 triggers, functions, and catalog; it does not alter source table definitions,
rows, RLS, or grants. Pause the route and disable the pilot organization before rollback.

## What to watch

- Application cron responses and Worker logs for status, duration, and response size; never log
  response bodies, credentials, or event payloads.
- OpenTelemetry `workflow.tick` spans with ERROR status and the
  `workflow.tick.failures` counter.
- Free-tier alert definition: **`workflow-tick-failure`** fires when the counter increases by at
  least one during a rolling five-minute window. Notify the existing on-call channel and use this
  runbook. Do not introduce a paid service. Confirm the existing OTel exporter and alert delivery
  work in staging before the pilot; if they do not, treat the alert as unavailable and do not
  enable the pilot.
- Local operator/database dashboards for growing pending/claimed/dead event counts, repeat
  retries, missing runs, and the `workflow.run.created` audit-chain entries for the approved
  pilot. Investigate with tenant-scoped IDs and aggregate counts; do not export payload contents.
- Verify events remain isolated to the approved org and duplicate count stays zero. Disable the
  org immediately if events appear for another tenant, PII appears in payloads, or the failure
  alert fires repeatedly.
