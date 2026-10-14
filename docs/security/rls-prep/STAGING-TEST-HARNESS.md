# Staging test harness

**Never run against production.**
`scripts/staging/sherivs-rls-prep/assert-not-production.mjs` must exit 0
before any JWT or SQL session is opened.

GATE 4/5 stay **BLOCKED** until a human provisions a throwaway project that
is **not** `nwrflbpbhyiqdptmlccm` and has **no** customer rows.

These tests were **not** executed in this mission. Do not claim they passed.

## Synthetic identities

Create with service_role on staging, delete after the run:

| Actor | School | Role | Notes |
|-------|--------|------|-------|
| Student A | A | student | owns S-A |
| Student B | B | student | cross-tenant |
| Teacher T | A | teacher | owns a lesson plan; biometric row |
| Parent P | A | parent | mapped only to S-A |
| Bursar R | A | bursar | |
| Admin H | A | admin | not T’s teacher_id |
| Admin Z | A | admin | then `is_active=false` |
| Super S | n/a | super_admins | |
| Unlinked U | none | auth user only | founder |

## Required cases

Each row: staging JWT/role, preconditions, expected outcome, evidence.

| ID | JWT / role | Preconditions | Action | Expected | Evidence |
|----|------------|---------------|--------|----------|----------|
| FND-01 | Unlinked U | no users row | `create_organization_with_founder` | org + users admin + memberships mirror | users + memberships rows; `auth.role` still authenticated |
| SW-01 | Admin H | second active membership school C | `switchActiveOrganization` | users.school_id/role match membership | users row; memberships is_primary |
| MEM-01 | Admin H | — | PostgREST INSERT memberships | denied (GRANT and/or policy) | HTTP 401/42501; zero rows |
| MEM-02 | Admin H | — | UPDATE/DELETE memberships | denied | same |
| INS-01 | Admin H | — | PostgREST INSERT `users` | denied | GRANT + no INSERT policy |
| DEL-01 | Admin H | teacher T exists | DELETE `users?id=eq.T` | denied | no DELETE grant/policy |
| ID-01 | Student A | — | PATCH self `{role:admin}` | denied | role unchanged |
| ID-02 | Student A | — | PATCH `{school_id:B}` | denied | school_id unchanged |
| C4-01 | Admin Z or Student A | — | PATCH self `{is_active:true}` | `self_activation_frozen` | is_active unchanged |
| ACT-01 | Admin H | Teacher T active | `setTeacherActive` T false | success | T is_active false; memberships is_active false |
| HR-01 | Teacher T | — | SELECT salary / EXECUTE `admin_hr_staff_list` | column missing / not_authorized | |
| HR-02 | Admin H | Teacher T | `admin_hr_staff_write` salary | success (after C) | salary via RPC only |
| PAYR-01 | Teacher T | payroll row exists | SELECT `staff_payroll` | 0 rows | |
| PAYR-02 | Admin H | — | SELECT/INSERT payroll school A | allow | |
| BIO-01 | Teacher T | — | SELECT peer biometric | 0 rows | |
| BIO-02 | Teacher T | — | upsert own biometric | allow | |
| BIO-03 | Student A | — | SELECT `teacher_biometrics` | 0 rows | |
| LP-01 | Teacher T | own submitted plan | PATCH status=approved | denied | |
| LP-02 | Admin H | T’s submitted plan | PATCH approved | success | |
| PAY-01 | verify path | fee amount 100, Paystack kobo mismatch | verify | reject; unpaid | fees row |
| PAY-02 | verify path | currency != NGN | verify | reject | |
| PAY-03 | webhook | missing fee_id | POST | no UPDATE | fees unchanged |
| PAY-04 | webhook | duplicate charge.success | second POST | idempotent | paid_at unchanged |
| PAY-05 | concurrent | verify + webhook | both | one paid row | |
| INACT-01 | Admin Z | is_active false | `is_school_admin()` / INSERT classes / HR RPC | false / denied | |
| HOST-01 | — | hostname-routing unit tests | `vitest` canonical hosts | pass unchanged | `d195ba8` files |

Also N3 cross-school SELECT 0 rows; P1 profile phone; P3 attendance; P4 parent fees; P5 bursar INSERT unpaid.

Catalog (GATE 5, not executed): `catalog-verify.sql` empty sets for
`users` INSERT/DELETE (`authenticated`), memberships writes, payroll and
biometrics `polcmd = '*'`, and membership freeze body without
`pg_trigger_depth`.

## Execution sketch (future)

1. `assert-not-production.mjs`
2. Apply `00010`–`00080` on staging only (`00070` only with Paystack app; skip `00090`)
3. `catalog-verify.sql`
4. JWT matrix
5. Destroy identities

Do not commit staging keys. Do not log tokens.
