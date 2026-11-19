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
