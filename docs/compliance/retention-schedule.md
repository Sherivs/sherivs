# Retention schedule

The authoritative, machine-readable schedule is `architecture/coregrid-mvp-architecture/RETENTION_POLICY_SCHEDULE.json` (human form: `RETENTION_POLICY_SCHEDULE.md`), typed in `frontend/src/lib/governance/retention-policy-schedule.ts` and validated by `node scripts/verify-retention-schedule.mjs`. Mechanism: ADR-005 (immutable records are tombstoned, never deleted). This document does not redefine it.

**All durations are provisional defaults — LEGAL REVIEW REQUIRED** before production execution. M12 provides tenant-scoped dry-run reporting and approved tombstone execution only: source rows and immutable audit records are never physically deleted or mutated. An active legal hold blocks an otherwise eligible candidate.

## Mapping to Scholar tables (education-institution tenants)

| Category (recordFamily) | Policy | Retention | Scholar table(s) in dry run |
|---|---|---|---|
| attendance-activity | RP-ATTND-EDU | 730 d | `attendance` (by `date`) |
| communication | RP-COMMS-EDU | 365 d | `messages` |
| financial | RP-FINAN-EDU | 2555 d | `fees`, `student_platform_fee_ledger`, `staff_payroll` |
| audit | RP-AUDIT-EDU | 2555 d, tombstone only | `audit_logs` |

Not yet mapped to tables (event-triggered or no Scholar table): identity-profile (subject-relationship-end), workforce-employment (employment-end), biometric-reference (consent withdrawal or enrolment end), memory, evidence, kernel-object, event, ai-snapshot (180 d). `grades` has no policy entry of its own: **LEGAL REVIEW REQUIRED** (education-record retention).

## Dry run and approved tombstones

`public.retention_run_dry(org_id)` is the default scheduler/operator entry point. It reports policy/category candidate counts and record IDs for one tenant; reports do not modify source records or create tombstones. An authenticated tenant retention administrator can configure the seeded policy durations, create/release audited holds, approve a dry-run initiated by another actor, and execute that approved report. Execution rechecks holds, policy settings, and source eligibility. Each successful tombstone is an immutable `retention_deletion_audit` row containing the policy reference, run, tenant, target, approver, executor, and time; the source row remains intact. Audit, event, memory, evidence, and other immutable families are not execution targets.

```sql
-- As the scheduler service role, for a tenant resolved by the trusted scheduler.
SELECT public.retention_run_dry('<tenant UUID>');

-- Human approval and execution use the same tenant-scoped, authenticated RPCs.
SELECT public.retention_run_approve('<dry-run UUID>');
SELECT public.retention_run_execute('<approved-run UUID>');
```

Verified on a disposable loopback PostgreSQL instance by `tests/integration/m12-retention-tombstones.local.sql` (Verify's `migrations-sim` job). This is not authorization to apply migrations or run jobs on a production database. See [ADR-048](../../architecture/adr/ADR-048_M12_RETENTION_TOMBSTONE_EXECUTION.md).

## Related

[ndpa-overview.md](./ndpa-overview.md) · [erasure-policy.md](./erasure-policy.md) · ADR-005, ADR-008 (cross-tenant erasure and backup expiry: backups are not edited; they age out per ADR-008)
