# ADR-111: V1 Workflow Event Sources (WF-05)

| Field          | Value                                                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status         | PROPOSED in WF-05 PR; no hosted database changes                                                                                                                                      |
| Date           | 2026-11-17                                                                                                                                                                            |
| Creator        | copilot-swe-agent[bot]                                                                                                                                                                |
| Version target | V1 organizational workflows                                                                                                                                                           |
| Depends on     | [ADR-103](ADR-103_WF01_POSTGRES_WORKFLOW_ENGINE_AND_RUNTIME_PORT.md), [ADR-104](ADR-104_WF02_WORKFLOW_PERMISSIONS_AND_TEMPLATES.md), [ADR-105](ADR-105_WF03_WORKFLOW_RUNTIME_CORE.md) |
| Migration      | `database/supabase/migrations/20261117000700_sherivs_wf05_event_sources_v1.sql`                                                                                                       |
| Rollback       | `database/supabase/rollbacks/20261117000700_sherivs_wf05_event_sources_v1.sql`                                                                                                        |

## Context

WF-01 through WF-03 provide tenant-keyed event storage and a service-role runtime, but domain
changes do not yet feed that runtime. WF-05 adds a small catalog and database triggers without
changing source-table policies, grants, or schemas. Missing organization settings and disabled
settings both mean emission is off. Production remains off: `WORKFLOWS_ENABLED` is unset and no
organization is enabled by this mission.

## Decisions

1. `wf_event_source` contains only event types whose source table and relevant columns exist in
   the applied schema. It is forced-RLS; authenticated users can read the catalog, `anon` has no
   grants, and only `service_role` can write it. Event rows remain governed by the existing WF-01
   RLS and grants.
2. `wf_emit_event` is the single `SECURITY DEFINER` insertion path with an empty search path. It
   first performs an indexed lookup of `wf_org_settings` and returns if the row is absent or
   disabled. It then requires an enabled catalog type and exact payload-key equality before
   inserting with `ON CONFLICT (org_id, dedupe_key) DO NOTHING`. Only `service_role` and the
   definer trigger functions can call it directly.
3. Source triggers derive `org_id` from each row's `school_id`, which is the canonical
   `schools.id` organization key for these sources. For state re-entry events, the dedupe key
   also includes the transaction ID and new tuple version (`ctid`), so each changed row version
   is distinct even when several transitions share one transaction or command; unchanged-status
   replays do not emit.
4. The verified event mapping is:

   | Event                      | Source and transition                                              | Payload keys                                        |
   | -------------------------- | ------------------------------------------------------------------ | --------------------------------------------------- |
   | `fees.invoice_issued`      | `cg_fee_invoice`, insert                                           | `invoice_id`, `amount_kobo`                         |
   | `payment.succeeded`        | `cg_fee_payment`, insert of a recorded fee payment                 | `payment_id`, `invoice_id`, `amount_kobo`, `method` |
   | `wallet.topup_succeeded`   | `wallet_ledger`, insert where `kind = 'topup'`                     | `ledger_id`, `amount_minor`                         |
   | `wallet.low_balance`       | `wallet_alerts`, insert where `kind = 'low_balance'`               | `alert_id`, `kind`                                  |
   | `attendance.marked_absent` | `class_attendance_marks`, insert absent or status change to absent | `attendance_id`, `status`                           |
   | `admissions.stage_changed` | `admission_stage_events`, insert                                   | `application_id`, `from_stage`, `to_stage`          |
   | `results.published`        | `grades`, insert published or transition to `is_published = true`  | `grades_id`                                         |

5. `fees.overdue` is deferred: `cg_fee_invoice` has `due_at` but no overdue status, and this
   mission does not add a clock scan. `payment.failed` is deferred: the `payment_intents` schema
   is explicitly in a not-applied draft migration and its recorded statuses do not include
   `failed`. The applied wallet top-up `failed` state is not treated as a general payment event.
   No missing status or source column is inferred.
6. Payloads contain only source IDs, enumerations, and fee/payment/wallet amounts in minor units.
   Names, phone numbers, emails, free text, student details, and source JSON are excluded.
   Every trigger catches emission errors and raises a warning with the trigger name only, so an
   event catalog or workflow failure does not roll back the source write.
7. `runWorkflowTick` marks `workflow.tick` ERROR and increments the OpenTelemetry counter
   `workflow.tick.failures` once per failed tick, including a failed claim, dispatch, or step.
   The alert definition is documented in the enablement runbook and uses the existing free-tier
   telemetry path; no vendor or dependency is added.

## Security and operations

- The global cron gate and `wf_org_settings.workflows_enabled` gate remain separate. Enabling
  `ROUTE_WORKFLOW_TICK` or `WORKFLOWS_ENABLED` alone does not enable an organization.
- All source grants, policies, RLS settings, and definitions are unchanged. Rollback removes only
  WF-05 triggers, trigger functions, the emitter, and its catalog.
- Tests use disposable loopback Postgres and rollback their fixtures. No hosted SQL execution or
  deployment is authorized by this ADR.

## Golden questions

- **WHO?** Existing source writers create domain truth; the service-role runtime claims emitted events.
- **WHAT?** A catalogued, deduplicated event with an exact, minimized payload.
- **WHERE?** In `wf_event`, scoped to the source row's canonical school/organization ID.
- **WHY?** To connect verified V1 domain transitions to the WF-03 runtime without exposing source PII.
- **UNDER WHICH POLICY?** WF-01/02/03 tenant, authorization, audit and autonomy controls; disabled
  by default per organization.

## Neutrality baseline extension

Under ADR-004's "new ADR" mechanism (ADR-012/ADR-013 precedent), this ADR authorises the
quarantine entries added to `NEUTRALITY_GUARD_BASELINE.json` for
`20261117000700_sherivs_wf05_event_sources_v1.sql`. The migration reads the live legacy source
tables by their existing names (`school_id`, fee, attendance, admissions and grade vocabulary).
It adds no domain code to the universal surface and grants no new privileges to `anon` or
`authenticated`. The neutral-tenant substrate conversion removes these entries in the same change
when it lands.

## Units

`wallet_ledger.amount` is a numeric value in major units (naira), as posted by `_wallet_post`. The
event payload carries `amount_minor = round(amount * 100)` (kobo), so every money key in a WF-05
payload is an integer in minor units.
