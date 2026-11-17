# ADR-105: Workflow Runtime Core (WF-03)

| Field | Value |
| --- | --- |
| Status | PROPOSED; staging only; production requires Muhammad's written approval |
| Date | 2026-11-17 |
| Creator | Copilot-SWE-Agent[bot] |
| Version target | V1 organizational workflows |
| Depends on | [ADR-103](ADR-103_WF01_POSTGRES_WORKFLOW_ENGINE_AND_RUNTIME_PORT.md), [ADR-104](ADR-104_WF02_WORKFLOW_PERMISSIONS_AND_TEMPLATES.md) |
| Migration | `database/supabase/migrations/20261117000600_sherivs_wf03_runtime_core.sql` |
| Rollback | `database/supabase/rollbacks/20261117000600_sherivs_wf03_runtime_core.sql` |

## Context

WF-01 established tenant-keyed workflow state and the service-role-only step claim. WF-02 established the permission and separation-of-duties boundary and the global template catalogue. WF-03 adds a disabled-by-default runtime without changing those boundaries or the pure workflow evaluator.

## Decisions

1. `/api/public/cron/workflow-tick` requires the existing `CRON_SECRET` bearer check. The exact string `WORKFLOWS_ENABLED=true` is required globally. The per-organization `wf_org_settings.workflows_enabled` setting also defaults to false. The route authenticates before returning a disabled response and does not create its database port or claim work in that case.
2. Event and step claim functions are `SECURITY INVOKER`, pin `search_path`, use `FOR UPDATE SKIP LOCKED`, and are executable only by `service_role`. Both claims require a positive organization setting. Events belonging to a disabled organization are not claimed and remain pending; unmatched or invalid event bindings are ignored by the runtime.
3. Runtime persistence is isolated behind `WorkflowRuntimePort`; the pure engine remains the transition authority. The tick stops claiming/processing near its 45-second budget, fences writes by lease owner and attempt, enforces run deadlines and step limits, uses bounded exponential backoff with jitter, and emits identifiers/counts/status/error codes only. Approval steps create a pending `wf_approval` record and wait; they are never completed by a generic step input.
4. `wf_template` records agent, autonomy ceiling, release, risk, organization/data classification, lawful-basis, evaluation and changelog metadata. Existing seeds retain the restrictive `suggest` ceiling. Per-step autonomy is bounded by the lowest template, tenant, and earned-agent level; an absent earned-agent row means `suggest`.
5. The database and TypeScript enforce the `draft` ceiling for `money_movement`, `safeguarding`, `credential_change`, `public_publish`, `mass_message`, and `external_authority_share`. Unclassified action classes also fail closed at `draft`; only explicitly classified `internal` actions may exceed it. Earned autonomy is writable only by `service_role`. Authenticated settings reads and writes remain subject to `workflows.view` and `workflows.manage`.
6. Side-effecting execution uses the step idempotency key and the existing `cg_idempotency_record` substrate; completed records replay without repeating the action, and providers must honor the same key for in-flight safety. No grants or RLS on that substrate are changed. This mission does not add real action/channel providers; those remain WF-06.
7. `kickWorkflowTick()` is a best-effort, bounded post-commit signal. The scheduled tick remains the durable fallback and callers must invoke the helper only after their event commit.

## Security and operations

- Tenant scope comes from claimed/stored rows, never request fields.
- WF-02 policies, table grants, publication guards, approval guards and SoD triggers are unchanged.
- New tenant settings and earned-autonomy tables have enabled and forced RLS, explicit privileges, and no anon/PUBLIC grants. Claim and runtime persistence routines are invoker functions with pinned search paths.
- A narrowly scoped `SECURITY DEFINER` audit trigger is the exception: it invokes the existing canonical workflow audit writer, whose direct execution remains revoked from all client and service roles. Its pinned empty search path and hash-only before/after fields preserve the audit-chain boundary.
- Migration and rollback tests run against the disposable local simulation only. No hosted database operation is authorized by this ADR.
- OpenTelemetry spans use only row identifiers, counts, statuses and error codes; event payloads and private values are excluded.

## Rollback

The paired rollback removes WF-03 columns, tables, trigger and event claim function, and restores the WF-01 step claim behavior. It verifies all WF-03 objects and columns are absent and does not modify `audit_chain`.

## Golden questions

- **WHO?** The service-role runtime claims and advances work; organization permissions control user settings.
- **WHAT?** A feature-gated event/step runtime with retries, idempotency and autonomy limits.
- **WHERE?** This ADR, the migration/rollback, runtime ports and WF-03 tests.
- **WHY?** To advance durable workflow state without weakening tenant boundaries or autonomous-action limits.
- **UNDER WHICH POLICY?** ADR-101, ADR-103, ADR-104 and the V1 organizational execution boundary.
