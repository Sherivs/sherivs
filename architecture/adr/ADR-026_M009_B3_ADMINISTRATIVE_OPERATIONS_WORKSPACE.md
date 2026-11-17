# ADR-026: Administrative Operations Workspace Defers Separation of Duties to the Database and Fails Closed (M009 Stage B-3)

| Field | Value |
|---|---|
| Status | PROPOSED (operator review required before production rollout) |
| Date | 2026-11-13 |
| Author | Claude (M009 Stage B-3 build) |
| Creator | Claude Code agent, mission B-003 (issue #282) |
| Mission | M009 Stage B-3 — Administrative and Institutional Operations workspace |
| Cites | ADR-025; `database/supabase/migrations/20261024000240_sherivs_017_role_permission_catalog.sql` (`sod_template_conflicts`, `sod_permission_rules`); `database/supabase/migrations/20261101000010_sherivs_m009_a1_role_responsibility_engine.sql` (`workspace_role_sod_assert_at`); `frontend/src/lib/workspaces/administrative-operations.ts`; `tests/unit/m009-b3-administrative-operations.test.ts` |
| Minimal ownership artifact | This ADR and the operations spec |

## Context

Finance, registry, HR, facilities and welfare-operations staff need a daily workspace. Separation of duties (cashier cannot approve refunds, an auditor cannot approve what they audit, the bursar cannot bypass controls) must be enforced server-side and cannot be configurable away. The database already enforces it: template conflicts, permission-pair rules and an auditor-independence guard run when assignments and grants are written.

## Options

1. **Re-implement separation of duties in the client** — rejected: a second, driftable source of truth.
2. **New migration with new controls** — rejected for B-3: the controls exist; adding rows here would duplicate them.
3. **Spec over the permitted manifest plus a fail-closed pair check (retained)** — the view never adds items, and if one manifest ever holds both sides of a separation pair (prepare and approve payroll) neither action is shown. The database stays the enforcer.

## Recommendation (decision)

Adopt option 3. No migration is created, as the issue allows when none is needed.

## Findings recorded while testing (not fixed here)

Read-only production checks on 2026-11-13 show two catalog rows whose defaults conflict with the database's own permission-pair rules, with no assignments yet to exercise them:

- `accountant`: `payments.reconcile` is mandatory and `payments.record_cash` is optional but on by default.
- `procurement`: `procurement.request` is mandatory and `procurement.approve` is optional but on by default.

The assignment guard would reject a user holding both permissions, so assigning these templates with defaults is expected to fail until an institution turns one side off. This has not been reproduced against a database and needs staging verification. Separately, the TypeScript copy of the catalog (`role-templates.data.ts`) shows `bursar` with `payments.record_cash` on by default, while production has it off: the copy has drifted. A forward-only catalog correction and a drift check are proposed in the audit register, not done here.

## Consequences

- **Positive:** No new permission or schema; behaviour tested over the real template catalog and the database's own rule text.
- **Negative:** Budget tracking, fee disputes, financial aid and internal audit queues have no data source and are shown as "Not configured".
- **Not done:** Backend end-to-end tests (assignment, visibility, notification, audit) need a non-production Supabase stack and were not run.

## Golden Questions

- **WHO?** M009 Stage B-3 owns the view; the operator ratifies it.
- **WHAT?** A narrowing view with a fail-closed separation-of-duties check.
- **WHERE?** `frontend/src/lib/workspaces/`, unit tests.
- **WHY?** Mandatory controls must not depend on UI behaviour or institution configuration.
- **UNDER WHICH POLICY?** AGENTS identity versus authorization, separation of duties, honesty rules.

## UNKNOWNs

- Whether the two production default conflicts block assignment in practice (needs staging reproduction).
- Operator ruling: unratified until reviewed.
