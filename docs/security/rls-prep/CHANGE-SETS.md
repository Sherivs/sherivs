# Change sets A–H (GATE3-CORRECTIONS-002)

Companion to `docs/security/SHERIVS-RLS-IMPLEMENTATION-PREP-001.md`.
Proposed SQL: `docs/security/rls-prep/proposed-sql/`.

GATE 3 remains **PASS WITH CONDITIONS**. Findings remain **OPEN**.
Privilege and provisioning claims are **STATICALLY DERIVED / NOT VERIFIED**.
Do not copy these files into `database/supabase/migrations/`.

Apply order (filenames sort this way):

1. B helpers `00010`
2. C HR RPCs `00020`
3. A identity freeze + C2 memberships + users INSERT/DELETE revoke `00030`
4. F sensitive columns `00040`
5. E-HR payroll/biometrics `00045`
6. E-A `00050`
7. E-B `00060`
8. D + E-C `00070` — **release blocked** on Paystack app
9. G grants `00080`
10. H FORCE RLS `00090` — **not eligible**

## B — Inactive-user helpers (`00010`)

Unchanged intent from corrections-001. Helpers read active `users` row.

## C — HR SQL RPCs (`00020`)

Salary/profile only; no `p_role`; staff-target pin. `hr.functions.ts` is a
**mandatory companion** (H5) in the same release as A/F. Not implemented.

## A — Identity freeze (`00030`)

| Field | Value |
|-------|-------|
| Invariant | JWT cannot UPDATE `role`/`school_id`. Self cannot UPDATE `is_active`. Authenticated cannot INSERT/DELETE `users`. School-admin policy is SELECT + staff UPDATE only |
| C2 | Memberships: no authenticated write GRANT/policies. Freeze allows `service_role` **or** identity tuple that mirrors `public.users`. **No trigger-depth exception. No GUC.** |
| Compatibility | Founder DEFINER INSERT + sync mirror **NOT VERIFIED**. Switcher service_role **NOT VERIFIED**. `saveStaff` JWT **breaks** until HR app |
| Tests | ID-01..ID-07, founder, switcher, users INSERT/DELETE denial |
| Rollback | Drop freeze triggers; restore command policies not FOR ALL; do not re-GRANT users INSERT |

## F — Sensitive columns (`00040`)

Unchanged. `app-context` `select("*")` still incompatible.

## E-HR — Payroll / biometrics (`00045`)

Command policies. Drops `staff_payroll_school_isolation` FOR ALL and both
`teacher_biometrics` isolation FOR ALL policies. Required before SHERIVS-003
can close. Finding stays OPEN until applied.

## E-A / E-B (`00050` / `00060`)

Named `tenant_all_*` waves. Required before SHERIVS-002 can close.

## D + E-C (`00070`)

JWT settlement freeze. **Not eligible to apply** until
`PAYMENT-INVARIANTS.md` is implemented in init/verify/webhook. B8 BLOCKED.

## G — Grants (`00080`)

`REVOKE ALL` from `PUBLIC/anon/authenticated` then allowlist GRANT
(including `grades` full DML so gradebook is not accidentally withdrawn),
then re-REVOKE users INSERT/DELETE, memberships writes, map/fraud writes,
fees/attendance/payroll/biometrics DELETE, then column REVOKEs. See static
matrix in `GATE3-CORRECTIONS-002.md` (**NOT VERIFIED**).

## H — FORCE RLS (`00090`)

Optional last. **Not eligible** until founder and all DEFINER/owner paths
pass isolated staging.
