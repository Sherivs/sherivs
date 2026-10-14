# SHERIVS-RLS-IMPLEMENTATION-PREP-001

**Mission:** Prepare a reviewable ACTIVE-V1 implementation plan for SHERIVS-001, SHERIVS-002, and SHERIVS-003.

**Classification:** P0 security blocker — design and staging-prep only.

**Version target:** ACTIVE-V1 organizational envelope only. V2 device/IoT and V3 Reality Intelligence remain frozen.

**Status of findings:** OPEN. This mission does not declare any finding remediated.

**Production SQL:** none applied. No GRANT, REVOKE, CREATE, ALTER, DROP, INSERT, UPDATE, DELETE, or TRUNCATE was executed against production. No Supabase, DNS, Vercel, or hostname-routing change.

**Prior missions (design only, not in git):**

- `SHERIVS-SECURITY-AUDIT-001` / `SHERIVS-RLS-VERIFY-001` — [Sherivs security architecture audit](https://cursor.com/agents/bc-3a5b09e1-36ee-43d7-945b-924555998c1b)
- `SHERIVS-RLS-REMEDIATION-DESIGN-001` — [Sherivs security remediation design](https://cursor.com/agents/bc-d50fdf99-5a75-4980-9a38-75c76ce4475f)

This document is the first **git-tracked** implementation plan. It supersedes the canvas-only design where they disagree, notably: authorization helpers must read `public.users` (not memberships first), identity writes must not use a SET-able GUC latch, and B3 is implementable because `lesson_plans.status` already has an approval state.

---

## 1. Baseline reconciliation — GATE 1 PASS (with checkout caveat)

| Source | Result |
|--------|--------|
| Authoritative production git | `origin/master` @ `d195ba8` (PR #9, hostname routing). |
| This branch | created from `origin/master` @ `d195ba8`. |
| Agent default checkout | `coregrid-scholar-migration` was **22 commits behind** master and **lacked** `20261008000050_coregrid_organization_memberships.sql`. Do not implement from that branch. |
| Canonical production architecture | `public.organization_memberships` exists in master SQL and is recorded as applied to project `nwrflbpbhyiqdptmlccm` on 2026-10-08. |
| Hostname routing | four production domains remain an HTTP Host dispatch, not an authorization boundary. Out of scope. Do not modify. |

### Live catalog evidence (from SHERIVS-RLS-VERIFY-001; not re-queried here)

This mission did **not** open a production database connection and did not use customer identities.

Verify mission recorded, against the live catalog:

- RLS **enabled, not forced** on the named Scholar tables including `users`.
- `User updates self` UPDATE USING/WITH CHECK `id = auth.uid()` only.
- `authenticated` has column UPDATE on `users.role` and `users.school_id`.
- Trigger `organization_memberships_sync` AFTER UPDATE OF `school_id, role, is_active`.
- Remaining `tenant_all_*` FOR ALL (roles `{public}`): `fees`, `students`, `attendance`, `attendance_logs`, `classes`, `parent_student_map`, `lesson_plans`, `timetables`, `timetable_slots`, `school_calendar`, `subscriptions`. Repo create-minus-drops also includes `fraud_attempts` (verify inspector omitted that table — treat as live until staging catalog proves otherwise).
- Peer SELECT policy `Same school users can see each other` plus `authenticated` SELECT on `salary`, `nin`, `bank_name`, `account_number`, `account_name`, `face_biometric`.
- `anon` TRUNCATE on some tenant tables (`students`/`fees`/`attendance`/`grades`); `users` TRUNCATE already revoked.

`supabase_migrations` schema was not visible to the verify mission, so applied version stamps are **not independently re-verified** here. Implementation must start with a staging (or read-only catalog) pin of `pg_policies`, `column_privileges`, trigger names, and helper bodies.

### Authoritative helper and trigger bodies (master SQL)

| Object | Last definition | Gap |
|--------|-----------------|-----|
| `get_my_school_id()` / `get_my_role()` | `20261008000050` — COALESCE(active membership, `users` row). Memberships filtered `is_active`; **users fallback is not**. | Authorization disagrees with `is_school_admin()`. |
| `is_school_admin()` | `20260620151525` — `users.role IN ('admin','principal')`. **No `is_active`. Does not read memberships.** | Inactive admin JWT still privileged. Self-written `users.role` is enough. |
| `is_super_admin()` | `20261003000020` SECURITY DEFINER, checks `super_admins.is_active`. | Keep. |
| `sync_organization_membership_on_user_write()` | SECURITY DEFINER AFTER INSERT/UPDATE OF identity columns. Upserts membership, **bypassing** membership INSERT RLS. | Amplifies any accepted `users` identity write. |
| `create_organization_with_founder()` | `20261008000060` SECURITY DEFINER INSERT of founder `users` row. | INSERT is outside the UPDATE freeze; keep as trusted provisioning. |

GATE 1 is **PASS for planning** against `origin/master` @ `d195ba8`. GATE 1 is **not** a production-apply authorization.

---

## 2. Application read/write inventory

Legend: **JWT** = browser Supabase client; **JWT-srv** = TanStack server fn with `requireSupabaseAuth` (user bearer, RLS applies); **service_role** = `supabaseAdmin` from `frontend/src/integrations/supabase/client.server.ts`.

Full path table: `docs/security/rls-prep/APPLICATION-INVENTORY.md`.

### Identity columns (`users.role`, `users.school_id`, `users.is_active`)

| Path | Auth | Write? | Notes |
|------|------|--------|-------|
| `updateMyProfile` | JWT-srv | profile fields only | Zod allowlist. Compatible with freeze. |
| `app-context` `select("*")` | JWT | read all columns | Must become an explicit column list before F. |
| `admin/hr.tsx` `saveStaff` | JWT | **role, salary**, employment fields | **Breaks** under A+F unless C lands in the same release. No server gate today. |
| `setTeacherActive` | JWT-srv | `is_active` | Keep granted. App-gated `requireSchoolAdminScope`. |
| `switchActiveOrganization` | JWT-srv read + **service_role** write | `school_id`, `role` | Compatible with A (service_role). |
| `createStaffAccount` / `inviteTeacher` / `provisionOrganization` | service_role | insert identity | Compatible. |
| `create_organization_with_founder` | DEFINER RPC | INSERT founder admin | Compatible (INSERT, not UPDATE). |
| `demo-provision` | service_role | seed | Environment-gated; must stay off in production. |

### Fees / payment references

| Path | Auth | Settlement write? |
|------|------|-------------------|
| `initFeePayment` | JWT-srv UPDATE `paystack_reference`, `paystack_access_code` | **Must move to service_role** after JWT SELECT proves visibility. |
| `verifyFeePayment` | JWT-srv UPDATE `status=paid` | **Must move to service_role**. Defence in depth only. |
| Paystack webhook | HMAC + service_role | Source of truth. Compatible. |
| `admin/fees.tsx` CrudList | JWT can set `status=paid` | Closes under D. Manual mark-paid is **B8** (human decision). |
| `bursar/fee-plans.tsx` | JWT INSERT `status=unpaid` | Compatible if INSERT policy allows finance staff. |

### Attendance / map / HR sensitive

| Path | Auth | Impact |
|------|------|--------|
| `markClassAttendance` | JWT-srv upsert `attendance` | Keep teaching-staff INSERT/UPDATE. `marked_by = auth.uid()`. |
| Teacher GPS `attendance_logs` insert | JWT | Keep `teacher_id = auth.uid()` INSERT. |
| Parent portals | JWT SELECT `parent_student_map` then child rows | Keep parent SELECT on map. **B1 denies writes** — only demo-provision writes today. |
| `broadcastMessage` | JWT-srv | Teachers SELECT map for class parents — keep staff SELECT. |
| Driver milestone notify | JWT-srv | Driver SELECT map — keep driver SELECT. |
| `fraud_attempts` | none in app | **B7** deny authenticated writes. |
| `salary` | `admin/hr.tsx` JWT | Move to C. |
| `nin` / bank / `users.face_biometric` | no dedicated UI; leaked via `select("*")` and peer SELECT | F revoke + stop `select("*")`. Biometric enrollment uses `teacher_biometrics`, not `users.face_biometric`. |

---

## 3. Implementation change-set plan (A–H)

Proposed SQL is **review-only** under `docs/security/rls-prep/proposed-sql/` (`.sql.proposed`). It is **outside** `database/supabase/migrations/`, so `scripts/db-apply*.mjs` cannot apply it.

**Do not use a GUC latch.** PostgreSQL sessions can `SET` custom GUCs. Trusted identity writes already have a service_role path. School-admin HR role edits must join that path (TanStack + `supabaseAdmin`), not a client-callable “set flag then UPDATE”.

**Do not trust NEW.role, NEW.school_id, or client administrator flags.** Triggers and RPCs authorize from `auth.role()`, `auth.uid()`, and the committed `users` / `super_admins` row.

| Set | Intent | Objects | App coupling | Rollback containment |
|-----|--------|---------|--------------|----------------------|
| **A** | Freeze `users.role`/`school_id`; freeze membership identity columns | trigger `users_identity_freeze`, `memberships_identity_freeze`; column REVOKE UPDATE | HR `saveStaff` role field **must** use service_role first | Drop triggers; do **not** re-GRANT identity columns to `authenticated` |
| **B** | Helpers read **active** `users` row; EXECUTE hygiene | `get_my_school_id`, `get_my_role`, `is_school_admin`, `is_super_admin`, `get_my_memberships` | Inactive admins lose privilege — intended | Restore previous helper bodies from `20261008000050` / `20260620151525` only as last resort |
| **C** | HR list/write replacement | `admin_hr_staff_list` / salary write RPC; new `hr.functions.ts` using service_role for **role** | `admin/hr.tsx` | Feature-flag HR form off rather than re-opening JWT role UPDATE |
| **D** | Freeze fee settlement columns | `fees_settlement_freeze`; column REVOKE | `paystack.functions.ts` | Pause Paystack init UI; do not re-GRANT settlement columns |
| **E** | Replace each `tenant_all_*` with command policies | 12 tables, three waves | Teacher attendance, parent map reads, bursar INSERT, student approved lesson plans | Pause the affected UI; **do not restore `tenant_all_*`** |
| **F** | Sensitive column revoke | SELECT/UPDATE revoke on six `users` columns | `app-context` explicit select; HR uses C | Same as C |
| **G** | TRUNCATE/anon hygiene; map/fraud grants | table privileges | none if E policies exist | Re-assert GRANT SELECT/DML without TRUNCATE |
| **H** | Catalog proofs; optional `FORCE RLS` on `users` | verification queries; last DDL | none | `NO FORCE ROW LEVEL SECURITY` |

Per-set preconditions, invariants, tests: `docs/security/rls-prep/CHANGE-SETS.md`.

### Dependency graph

```
S0 catalog pin (read-only)
        │
        ▼
   B helpers (is_active + users source)
        │
        ├──────────────► A identity freeze ──► C HR app+RPC ──► F column revoke
        │                      │
        │                      └── memberships freeze (same A)
        │
        ├──────────────► E wave A (classes, calendar, timetables)
        │                      │
        │                      ▼
        │                E wave B (students, map, lesson_plans, attendance*)
        │                      │
        │                      ▼
        ├──────────────► D fee settlement freeze ──► E wave C (fees, fraud, subscriptions)
        │
        ▼
   G grants
        │
        ▼
   H catalog proof; optional FORCE RLS
```

C must land **before or with** A in the production release train (HR role field). D must land **with** the Paystack service_role change. F must land **with** the `select("*")` removal.

---

## 4. Per-table RLS implementation plan

See `docs/security/rls-prep/PER-TABLE-RLS-MATRIX.md` and `docs/security/rls-prep/proposed-sql/E-command-policies.sql.proposed`.

ACTIVE-V1 defaults applied:

| ID | Decision | Schema / app fact | Implementation |
|----|----------|-------------------|----------------|
| **B1** | Deny ordinary authenticated writes on `parent_student_map` | Only `demo-provision` writes (service_role). Reads: parent UI, teacher broadcast, admin fanout, driver notify | SELECT for parent + school staff roles; **no** INSERT/UPDATE/DELETE policies |
| **B2** | Teachers keep same-school student visibility | Gradebook/attendance/broadcast loaders | `students` SELECT for `teacher` (and bursar/hq/driver) same school |
| **B3** | Approved-only lesson plans for students/parents | `lesson_plans.status` CHECK `draft/submitted/approved/needs_revision` — **reliable approval state exists** | **Not blocked.** Student/parent SELECT requires `status = 'approved'`. Student dashboard homework widget must add that filter in the same release |
| **B4** | Deny ordinary DELETE of fees and attendance | No delete UI found | No DELETE policy on `fees`/`attendance`. Admin DELETE kept on `attendance_logs` only |
| **B5** | Cross-school identity reassignment is platform-only | `switchActiveOrganization` already service_role and only to an existing active membership | Freeze trigger + HR server fn **never** writes `school_id` |
| **B6** | Do not expose own salary/bank on profile | `getMyProfile` already omits them; `select("*")` does not | F revoke + explicit app-context columns |
| **B7** | Deny authenticated `fraud_attempts` writes | No app writer | SELECT admin-only; no write policies |

---

## 5. HR and payment compatibility plan

### HR

Today `admin/hr.tsx` `saveStaff` does `supabase.from("users").update(rest)` with the **user JWT**, spreading `role` and `salary`. There is no server authorization function.

Required replacement (same release as A/F):

1. New `frontend/src/lib/runtime/scholar/hr.functions.ts`.
2. `requireSchoolAdminScope` (committed actor, lifecycle-aware).
3. Load target with user JWT (RLS) **or** service_role filtered by `get_my_school_id()` from the gate.
4. Reject if `target.school_id !== actorSchool` (never trust client `school_id`).
5. Reject `school_id` in the patch (B5).
6. Role writes via **service_role** so change set A allows them.
7. Salary writes via service_role **or** `admin_hr_staff_write` after F.
8. Audit `hr.staff_update`.
9. UI: `saveStaff` calls the server fn; staff list uses `admin_hr_staff_list` or service_role select of HR columns.

`createStaffAccount` / `inviteTeacher` stay service_role. `setTeacherActive` stays JWT-srv updating `is_active` only.

### Payments

Today a parent or bursar JWT can UPDATE settlement columns. Combined with SHERIVS-002, a student JWT in the same school can too.

Required replacement (same release as D/E wave C):

1. `initFeePayment`: JWT SELECT the fee (RLS visibility). Then `supabaseAdmin` UPDATE reference/access_code for that `id` only, retaining school_id check from the SELECT.
2. `verifyFeePayment`: Paystack verify, then `supabaseAdmin` UPDATE paid fields keyed by `id` + `paystack_reference`.
3. Webhook unchanged (service_role, HMAC).
4. Bursar INSERT remains JWT with `status IN ('unpaid','partial')`.
5. Manual `status=paid` from `admin/fees.tsx` **stops** until B8 is decided.

---

## 6. Staging test harness plan

**Prerequisite (BLOCKER for GATE 4/5):** this environment has no isolated staging Supabase project. Canonical URL in `.env.example` is production project `nwrflbpbhyiqdptmlccm`. Do **not** improvise production tests.

Harness pieces already in this PR:

- `scripts/staging/sherivs-rls-prep/assert-not-production.mjs` — refuses the production ref and the four Sherivs hostnames.
- `scripts/staging/sherivs-rls-prep/catalog-verify.sql` — GATE 5 read-only proofs.
- Synthetic JWT matrix: `docs/security/rls-prep/STAGING-TEST-HARNESS.md`.

Synthetic identities (create on staging, never production): School A, School B; student, teacher, parent (mapped child), bursar, admin, inactive admin, super-admin. Password material stays in staging secrets, not git.

Required negatives and positives are listed in §6 of the harness doc (R001–R022 plus mission-required cases).

---

## 7. Migration order and dependencies

| Order | Suggested filename (when implementation is authorized) | Change set | Couples with app |
|-------|----------------------------------------------------------|------------|------------------|
| 1 | `20261015000020_sherivs_authz_helpers_active.sql` | B | none (inactive-admin behaviour change) |
| 2 | `20261015000040_sherivs_admin_hr_rpcs.sql` + `hr.functions.ts` | C | **yes** |
| 3 | `20261015000010_sherivs_users_identity_freeze.sql` | A | **yes** (HR role) |
| 4 | `20261015000030_sherivs_users_sensitive_column_revoke.sql` + `app-context` select list | F | **yes** |
| 5 | `20261015000060_sherivs_rls_wave_a_*.sql` | E-A | low |
| 6 | `20261015000070_sherivs_rls_wave_b_*.sql` | E-B | student lesson-plan filter (B3) |
| 7 | `20261015000050_sherivs_fees_settlement_freeze.sql` + paystack.functions.ts | D | **yes** |
| 8 | `20261015000080_sherivs_rls_wave_c_*.sql` | E-C | bursar INSERT |
| 9 | `20261015000090_sherivs_rls_grant_hygiene.sql` | G | none |
| 10 | `20261015000100_sherivs_users_force_rls.sql` | H | none |

Timestamps are suggestions so later files sort after `20261008000060_organization_onboarding.sql`. The implementation mission may renumber; it must **not** fold A–H into one migration.

Each forward file needs a genuine inverse under `database/supabase/rollbacks/`, following `20261008000050` / `20261003000020` convention. Inverse of E restores the **command-specific** policies, not `tenant_all_*`.

---

## 8. Verification and rollback plan

See `docs/security/rls-prep/VERIFICATION-AND-ROLLBACK.md`.

**Containment rule:** if an app path breaks, disable that UI or server function. Restoring `tenant_all_*` or re-GRANTING `users.role` / salary columns to `authenticated` is a security incident, not a rollback.

Hostname routing (`d195ba8`) is not in the rollback surface.

---

## 9. Remaining product decisions

| ID | Decision | Default if forced to ship | Needs human approval? |
|----|----------|---------------------------|------------------------|
| B1 | Production writer for `parent_student_map` | Deny authenticated writes | Yes, before any admin linking UI |
| B2 | Teacher student scope | Same-school SELECT | No — compatibility default |
| B3 | Student/parent lesson plans | Approved only | **Implemented, not blocked** (schema supports it). Confirm homework widget empty-until-approved is acceptable |
| B4 | DELETE fees/attendance | Deny | Yes, if finance needs void/delete |
| B5 | School-admin tenant transfer | Platform service_role / super-admin only | Yes, if staff-transfer is a V1 requirement |
| B6 | Own salary on profile | No | Yes, if payroll self-service is required |
| B7 | `fraud_attempts` writer | Deny authenticated | Yes, if a trusted server workflow appears |
| **B8** | Manual mark-fee-paid without Paystack | Deny JWT; webhook/verify only | **Yes** — `admin/fees.tsx` currently offers it |
| **B9** | Student medical columns (`blood_group`, `genotype`, `medical_conditions`, `disability_notes`) | Out of SHERIVS-003 named scope; follow-on after E student SELECT split | Yes |
| **B10** | Related FOR ALL tables (`staff_payroll`, `teacher_biometrics`, hostel/clinic/library, …) | Follow-on wave, not this P0 | Yes |
| **B11** | Isolated staging project | Required for GATE 4/5 | **Yes — missing prerequisite** |

---

## 10. Release gates

| Gate | Meaning | This mission |
|------|---------|--------------|
| **GATE 1** | Correct master baseline | **PASS** — `origin/master` @ `d195ba8` with memberships |
| **GATE 2** | HR and fee-payment compatibility paths designed | **PASS** — §5 |
| **GATE 3** | SQL and application changes independently reviewed | **READY FOR REVIEW** — this PR. Not approved to apply |
| **GATE 4** | Synthetic staging tests pass | **BLOCKED** — no staging project |
| **GATE 5** | Staging catalog proves policies/grants/triggers/ACLs | **BLOCKED** — depends on GATE 4 |
| **GATE 6** | Separate production-apply mission explicitly authorized | **NOT ENTERED** |

Do not proceed through GATE 6 automatically.

---

## 11. Explicit confirmation — production was not modified

- No production SQL execution.
- No production migration apply.
- No GRANT/REVOKE/DDL/DML against the canonical project.
- No Supabase production configuration change.
- No DNS or Vercel change.
- No deployment.
- No customer-data access.
- No production exploit attempt.
- No secret disclosure.
- Hostname-routing code not modified.
- No files added under `database/supabase/migrations/`.

SHERIVS-001, SHERIVS-002, and SHERIVS-003 remain **OPEN**.
