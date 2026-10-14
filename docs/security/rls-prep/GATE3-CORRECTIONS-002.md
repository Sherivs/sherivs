# SHERIVS-RLS-GATE3-CORRECTIONS-002

Responds to `GATE3-INDEPENDENT-REVIEW-002.md` of corrections-001 @ `149a87d`.
Does **not** overwrite that review.

**Decision:** **A. CORRECTIONS COMPLETE — READY FOR ANOTHER INDEPENDENT REVIEW**

Even with A:

- Gate 3 is **not** fully passed.
- SHERIVS-001, SHERIVS-002, and SHERIVS-003 remain **OPEN**.
- No SQL is authorized for application.
- GATE 4/5 remain blocked on an isolated staging project that is **not**
  `nwrflbpbhyiqdptmlccm`.
- GATE 6 remains **BLOCKED**.

Privilege and provisioning claims in this file are **STATICALLY DERIVED**
and **NOT VERIFIED** until an isolated staging catalog is queried.

---

## Independent-review findings → this delta

| Review item | This delta |
|-------------|------------|
| C3 additive GRANT leaves `users` INSERT/DELETE | `00030` REVOKEs INSERT/DELETE; `00080` `REVOKE ALL` then allowlist GRANT; explicit re-REVOKE INSERT/DELETE after GRANT SELECT, UPDATE; then column REVOKEs |
| C3 leftover INSERT + school-admin FOR ALL | Split `"School admin manages users"` into SELECT + staff-only UPDATE; **no** INSERT/DELETE policy |
| C3 fees/attendance/map leftovers | `REVOKE ALL` then narrower GRANT; explicit re-REVOKE DELETE (fees/attendance/payroll/biometrics) and writes (map/fraud/memberships) |
| C2 `pg_trigger_depth() > 1` is not authorization | Depth exception **removed**. Mirror invariant + SELECT-only GRANT + dropped write policies |
| C2 founder “design-compatible” as proof | Still **NOT VERIFIED**; staging required (FND-01) |
| C4 static OK | Unchanged freeze; staff-only admin UPDATE policy (narrows residual peer `is_active`) |
| H1 `00090` FORCE | Header **NOT ELIGIBLE** until founder/DEFINER staging |
| H2 lesson plans | Unchanged from corrections-001 (static) |
| H3/H4 Paystack unresolved | `00070` marked **RELEASE BLOCKER**; not eligible ahead of app validation |
| H5 `saveStaff` JWT | Companion `hr.functions.ts` specified as **mandatory release blocker**; **not implemented** |
| H6 payroll/biometrics FOR ALL | Proposed command policies in `00045`. 003 stays OPEN |
| H7 provisioning claims | `IDENTITY-PROVISIONING.md`; no compatibility claim without staging |
| Catalog-verify missed users INSERT | Dedicated empty-set query for `users` INSERT/DELETE; payroll/biometrics FOR ALL empty-set |

---

## C3 — Effective `users` privileges

Live foundation (`20260620122048`) grants:

```
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO authenticated
```

plus policy `"School admin manages users" FOR ALL`.

PostgreSQL `GRANT` is additive. `GRANT SELECT, UPDATE` does **not** remove
INSERT/DELETE. Corrections-001 left those commands in the catalog.

Intended authenticated allowlist (this delta):

1. `00030`: `REVOKE INSERT, DELETE ON public.users` and split the FOR ALL
   policy **before** later GRANTs.
2. `00080`: `REVOKE ALL ON TABLE public.users FROM PUBLIC, anon, authenticated`.
3. `00080`: `GRANT SELECT, UPDATE ON TABLE public.users TO authenticated`
   (no INSERT, no DELETE).
4. `00080`: `REVOKE INSERT, DELETE` again (catalog assertion).
5. `00080`: re-REVOKE `UPDATE (role, school_id)` and HR columns **after**
   the table GRANT (table UPDATE restores every column).
6. No generic authenticated `users` INSERT is reintroduced for founder
   provisioning. Founder INSERT is SECURITY DEFINER owner DML.

INSERT and DELETE are assessed separately from UPDATE. An RLS policy is
**not** treated as making leftover INSERT/DELETE harmless.

`setTeacherActive` needs table UPDATE + `UPDATE(is_active)`, not INSERT or
DELETE. Staff/invite/demo use `service_role`. Organization switching uses
`service_role` UPDATE of `school_id`/`role`.

---

## C2 alternatives evaluated

1. **Trigger-depth allow** — rejected by review-002. Nesting ≠ caller auth.
   A leftover school-admin `users` INSERT would nested-write memberships.
2. **Client GUC latch** — rejected. Sessions can `SET` custom GUCs.
3. **`session_replication_role = replica` in sync** — rejected. Skips every
   trigger; too broad even if superuser-only.
4. **Freeze deny every `authenticated` JWT, including DEFINER nested writes**
   — breaks founder (`auth.role()` stays `authenticated` inside DEFINER).
5. **Chosen: users write-gate + memberships GRANT SELECT-only + drop
   authenticated write policies + mirror freeze.**

Why (5) preserves legitimate workflows:

- Founder DEFINER INSERT `users` (function owner; authenticated has **no**
  INSERT GRANT). Sync DEFINER upserts memberships matching that users row.
  Mirror freeze allows the match. JWT is still `authenticated`.
- Switcher `service_role` UPDATE `users.school_id`/`role`; freeze allows
  `service_role`; sync also mirrors.
- Staff/invite/demo `service_role` users writes; same.

Why untrusted callers cannot mint arbitrary memberships:

- Cannot INSERT `users` (GRANT + no INSERT policy). School-admin arbitrary
  identity create is closed at privilege **and** policy.
- Cannot INSERT/UPDATE/DELETE memberships (GRANT + dropped write policies).
- Mirror freeze would still reject a membership whose `(user_id, school_id,
  role)` does not match `public.users`. Extra organizations cannot be
  granted this way because `users.school_id` is a single active context.
- No client-settable GUC. No `pg_trigger_depth()` authorization.

Transaction/trigger semantics: AFTER users INSERT/UPDATE OF identity, the
new users row is visible in the same transaction, so the mirror `EXISTS`
succeeds. `ON CONFLICT DO UPDATE` of `role` still matches `users.role`.
`is_primary` demotion does not list identity columns, so the freeze
(UPDATE OF user_id, school_id, role) does not fire; client cannot perform
that UPDATE without GRANT.

SECURITY DEFINER: freeze and sync `SET search_path = pg_catalog, public`.
EXECUTE revoked from PUBLIC/anon/authenticated. They run as the function
owner (typically BYPASSRLS in Supabase). `auth.uid()` / `auth.role()` still
read the session JWT. **Owner / BYPASSRLS is NOT VERIFIED** against
`pg_proc.proowner`. FORCE RLS (`00090`) is **not eligible** until founder
INSERT under FORCE is proven.

C2 is **not** marked BLOCKED: a statically justifiable boundary exists.
It is **not** proven. Staging still required: FND-01, SW-01, MEM-01/02,
INS-01.

---

## Static privilege matrix — NOT VERIFIED

Until an isolated staging catalog is queried, this matrix is
**STATICALLY DERIVED** from live `20260620122048` + `20261008000050` GRANTs
plus proposed `00010`–`00080`. `00090` excluded (not eligible). `00070`
is in the static sequence but **not eligible to apply** until Paystack
app work; catalogs after a partial apply that skipped `00070` will still
show JWT settlement UPDATE until D is applied with that companion.

### anon

| Table | Privileges |
|-------|------------|
| `users`, `students`, `fees`, `attendance`, named Scholar tables, memberships, payroll, biometrics, `parent_student_map`, `fraud_attempts`, `grades` | **none** after `REVOKE ALL` |

### service_role

Table ALL on `users`, `fees`, `organization_memberships`, `staff_payroll`,
`teacher_biometrics`, `parent_student_map`, `fraud_attempts`, and the other
named tables granted ALL in G / foundation. BYPASSRLS. Application must
still constrain privileged UPDATEs (HR/Paystack contracts). SQL does not
encode fee amount matching.

### authenticated — table grants (RLS still applies)

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `users` | Y | **N** | Y | **N** |
| `organization_memberships` | Y | **N** | **N** | **N** |
| `fees` | Y | Y | Y | **N** |
| `attendance` | Y | Y | Y | **N** |
| `staff_payroll` | Y | Y | Y | **N** |
| `teacher_biometrics` | Y | Y | Y | **N** |
| `parent_student_map` | Y | **N** | **N** | **N** |
| `fraud_attempts` | Y | **N** | **N** | **N** |
| `grades` | Y | Y | Y | Y |
| `students`, `classes`, calendar, timetables, `lesson_plans`, `attendance_logs`, `subscriptions` | Y | Y | Y | Y |

### authenticated — `users` columns

| Column | SELECT | UPDATE |
|--------|--------|--------|
| `role`, `school_id` | Y | **N** |
| `is_active` | Y | Y (self-change **trigger-denied**) |
| `salary`, `nin`, `bank_*`, `face_biometric` | **N** | **N** |
| profile fields | Y | Y |

### authenticated student / teacher / parent JWT — effective (grant + RLS)

| Object | SELECT | INSERT | UPDATE | DELETE |
|--------|--------|--------|--------|--------|
| `users` own non-sensitive | Y | N | Y profile; T self `is_active`; N `role`/`school_id` | N |
| `users` salary / nin / bank / face | N | — | N | — |
| `organization_memberships` | Y own rows | N | N | N |
| `staff_payroll` | N (not finance) | N | N | N |
| `teacher_biometrics` own | Y (teacher) | Y own if teacher/admin/principal | Y own | N |
| `teacher_biometrics` peer | N | N | N | N |

### authenticated school-admin / principal JWT — effective

| Object | SELECT | INSERT | UPDATE | DELETE |
|--------|--------|--------|--------|--------|
| `users` same-school staff | Y (salary N via PostgREST) | **N** | Y non-frozen cols of **staff** rows; T self `is_active`; N `role`/`school_id` | **N** |
| `users` student/parent | Y (peer SELECT) | N | N (staff-role pin) | N |
| HR salary | Y via `admin_hr_staff_list` DEFINER | — | Y via `admin_hr_staff_write` DEFINER | — |
| `users.role` write | Y read | N | N PostgREST; future `hr.functions.ts` only | — |
| `staff_payroll` | Y finance roles | Y | Y | N |
| `teacher_biometrics` | Y same school | own row only | own row only | N |

Residual product decision: a school admin JWT may still UPDATE `is_active`
of **another staff** user (not only teachers) via PostgREST. Narrower than
corrections-001 FOR ALL. Broader than `setTeacherActive`. BLOCKED as a
dedicated admin-lifecycle RPC.

### authenticated — RLS (not a substitute for GRANT)

| Policy | Commands |
|--------|----------|
| `User reads self` / `Same school users` / `users_school_admin_select` | SELECT |
| `User updates self` | UPDATE own row (frozen cols still blocked) |
| `users_school_admin_update_staff` | UPDATE same-school **staff** rows only |
| **no** users INSERT/DELETE policy | |
| memberships SELECT only | |
| payroll finance roles | SELECT/INSERT/UPDATE |
| biometrics own write; own or admin SELECT | |

---

## Unresolved product decisions

- B1 parent_student_map writes
- B8 manual mark-paid
- B9 student medical / clinic
- Hostel/clinic/library/discipline/transport/meals/sports/expenses command
  splits (not invented)
- Admin deactivating another admin vs teacher-only `setTeacherActive`
- Teaching-principal self-approve of lesson plans (denied by H2; product
  may want a second-admin workflow)
- `00090` FORCE RLS
- `attendance_verification_log` / `staff_leave` / api keys / fee ledger
  follow-on HIGH (not 00045)

## Mandatory staging evidence

See `STAGING-TEST-HARNESS.md`. None of those tests were executed here.

## Explicit non-execution

No SQL executed. No database opened. No files under
`database/supabase/migrations/`. Hostname routing not changed.
No `hr.functions.ts` or Paystack application implementation.
