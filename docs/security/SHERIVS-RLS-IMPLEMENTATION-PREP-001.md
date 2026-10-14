# SHERIVS-RLS-IMPLEMENTATION-PREP-001

**Mission:** Prepare a reviewable ACTIVE-V1 implementation plan for SHERIVS-001, SHERIVS-002, and SHERIVS-003.

**Classification:** P0 security blocker — design and staging-prep only.

**Version target:** ACTIVE-V1 organizational envelope only. V2 device/IoT and V3 Reality Intelligence remain frozen.

**Status of findings:** OPEN. This mission does not declare any finding remediated.

**GATE 3:** **PASS WITH CONDITIONS** after SHERIVS-RLS-GATE3-CORRECTIONS-001.
Independent re-review (`GATE3-INDEPENDENT-REVIEW-002.md`) of `149a87d` did
**not** fully pass Gate 3. SHERIVS-RLS-GATE3-CORRECTIONS-002 answers those
conditions in `docs/security/rls-prep/` for **another independent review**.
This document does **not** declare Gate 3 fully passed. Proposed SQL is
**not safe to apply** until that re-review and GATE 4/5 staging proofs.

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
| `setTeacherActive` | JWT-srv | `is_active` of **another** teacher | Keep column grant. C4 trigger denies self-reactivation. |
| `switchActiveOrganization` | JWT-srv read + **service_role** write | `school_id`, `role` | **Design-compatible** with A (service_role). **NOT VERIFIED** on staging (H7). |
| `createStaffAccount` / `inviteTeacher` / `provisionOrganization` | service_role | insert identity | **Design-compatible**. **NOT VERIFIED** on staging (H7). |
| `create_organization_with_founder` | DEFINER RPC | INSERT founder admin | Authenticated has **no** users INSERT GRANT (C3). Nested memberships write is allowed only when the row **mirrors** `public.users` or the session is `service_role` (C2; **no** trigger-depth latch). **NOT VERIFIED** on staging (H7). |
| `demo-provision` | service_role | seed | Environment-gated; must stay off in production. |

### Fees / payment references

| Path | Auth | Settlement write? |
|------|------|-------------------|
| `initFeePayment` | JWT-srv UPDATE `paystack_reference`, `paystack_access_code` | **Must move to service_role** after JWT SELECT proves visibility. |
| `verifyFeePayment` | JWT-srv UPDATE `status=paid` | **Must move to service_role**. Defence in depth only. |
| Paystack webhook | HMAC + service_role | Live code updates by reference if `fee_id` missing — **not compatible** with H3/H4. See `PAYMENT-INVARIANTS.md`. Not implemented in this mission. |
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
| **B** `00010` | Helpers read **active** `users` row; EXECUTE hygiene | `get_my_school_id`, `get_my_role`, `is_school_admin`, `is_super_admin`, `get_my_memberships` | Inactive admins lose privilege — intended | Restore previous helper bodies from `20261008000050` / `20260620151525` only as last resort |
| **C** `00020` | HR list/write SQL RPCs (no `p_role`; staff-target pin) | `admin_hr_staff_list` / `admin_hr_staff_write`; `hr.functions.ts` **not in this mission** | `admin/hr.tsx` JWT `saveStaff` **breaks** until the TanStack function exists | Feature-flag HR form off rather than re-opening JWT role UPDATE |
| **A** `00030` | Freeze `users.role`/`school_id`; C4 self `is_active`; C3 users INSERT/DELETE revoke; C2 memberships **mirror** (no trigger depth) | triggers + policy split + REVOKE INSERT/DELETE | HR role field **must** use service_role in the same release | Drop triggers; do **not** re-GRANT identity columns or users INSERT to `authenticated` |
| **F** `00040` | Sensitive column revoke | SELECT/UPDATE revoke on six `users` columns | `app-context` explicit select **not in this mission** | Same as C |
| **E-HR** `00045` | Payroll / biometrics command policies | drop FOR ALL; finance/own-row commands | `admin/hr.tsx` payroll JWT depends on finance SELECT | Pause payroll/biometric UI; **do not restore school_isolation FOR ALL** |
| **E-A** `00050` | First RLS wave | classes, calendar, timetables | low | Pause UI; **do not restore `tenant_all_*`** |
| **E-B** `00060` | Second RLS wave + H2 lesson approval split | students, map, lesson_plans, attendance* | student lesson-plan filter; teacher cannot self-approve | Pause UI; do not restore `tenant_all_*` |
| **D+E-C** `00070` | Fee settlement freeze + fee/fraud/subscription policies | `fees_settlement_freeze`; command policies | `paystack.functions.ts` **not in this mission** — `PAYMENT-INVARIANTS.md` | Pause Paystack buttons; do not re-GRANT settlement columns |
| **G** `00080` | TRUNCATE/anon hygiene; C3 re-REVOKE after table GRANT | table + column privileges | none if E policies exist | Re-assert GRANT list **and** column REVOKEs, never TRUNCATE |
| **H** `00090` | optional `FORCE RLS` on `users` | last DDL | none | `NO FORCE ROW LEVEL SECURITY` |

Per-set preconditions, invariants, tests: `docs/security/rls-prep/CHANGE-SETS.md`.

### Dependency graph

```
S0 catalog pin (read-only)
        │
        ▼
   B helpers 00010
        │
        ▼
   C HR SQL RPCs 00020
        │
        ▼
   A identity + memberships + is_active freeze 00030
        │
        ▼
   F sensitive columns 00040
        │
        ▼
   E-HR payroll/biometrics 00045
        │
        ▼
   E-A 00050  →  E-B 00060 (H2 lesson approval)
        │
        ▼
   D + E-C 00070 (RELEASE BLOCKER until Paystack app)
        │
        ▼
   G grants: REVOKE ALL then allowlist then column re-REVOKE 00080
        │
        ▼
   H optional FORCE RLS 00090 (NOT ELIGIBLE until founder/DEFINER staging)
```

Lexicographic filenames **are** this graph (H1), including `00045`.
C SQL lands before A. `hr.functions.ts` (role writes) and Paystack app
invariants and `app-context` column lists must land in the **same
production release** as A/F/D — they are **not** implemented in this
corrections mission. `00070` is not eligible to apply ahead of Paystack.
`00090` is not eligible until founder/DEFINER staging.

---

## 4. Per-table RLS implementation plan

See `docs/security/rls-prep/PER-TABLE-RLS-MATRIX.md` and proposed SQL
`00045`/`00050`/`00060`/`00070`. Related isolation tables:
`RELATED-POLICIES.md`.

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

Required replacement (same release as A/F): see
`docs/security/rls-prep/HR-RPC-CONTRACT.md`.

SQL RPC `admin_hr_staff_write` is salary/profile only (no `p_role`, staff-role
pin). Future `hr.functions.ts` must not unbounded-update by arbitrary user id.
**Not implemented in this mission.**

`createStaffAccount` / `inviteTeacher` stay service_role. `setTeacherActive`
stays JWT-srv updating **another** user's `is_active` only (C4).

### Payments

Today a parent or bursar JWT can UPDATE settlement columns. Combined with SHERIVS-002, a student JWT in the same school can too.

Required replacement (same release as D/E-C): see
`docs/security/rls-prep/PAYMENT-INVARIANTS.md`.

RLS visibility is **not** payer authorization. Verify and webhook must match
amount/currency, bind reference to the intended fee, refuse missing
identifiers, and be idempotent under concurrency. **Not implemented in this
mission.** Bursar INSERT remains JWT with `status IN ('unpaid','partial')`.
Manual `status=paid` from `admin/fees.tsx` is **B8 BLOCKED**.

---

## 6. Staging test harness plan

**Prerequisite (BLOCKER for GATE 4/5):** this environment has no isolated staging Supabase project. Canonical URL in `.env.example` is production project `nwrflbpbhyiqdptmlccm`. Do **not** improvise production tests.

Harness pieces already in this PR:

- `scripts/staging/sherivs-rls-prep/assert-not-production.mjs` — refuses the production ref and the four Sherivs hostnames.
- `scripts/staging/sherivs-rls-prep/catalog-verify.sql` — GATE 5 read-only proofs.
- Synthetic JWT matrix: `docs/security/rls-prep/STAGING-TEST-HARNESS.md`.

Synthetic identities (create on staging, never production): School A, School B; student, teacher, parent (mapped child), bursar, admin, inactive admin, super-admin. Password material stays in staging secrets, not git.

Required negatives and positives are listed in `STAGING-TEST-HARNESS.md`
(FND-01, SW-01, MEM-01/02, INS-01, DEL-01, ID-01/02, C4-01, ACT-01, HR,
PAYR, BIO, LP, PAY, INACT, HOST-01). Hostname-routing tests must remain
unchanged. **None of those JWT cases were executed in this mission.**

---

## 7. Migration order and dependencies

| Order | Filename (lexicographic = apply order) | Change set | Couples with app |
|------:|------------------------------------------|------------|------------------|
| 1 | `20261015000010_sherivs_authz_helpers_active.sql` | B | none (inactive-admin behaviour change) |
| 2 | `20261015000020_sherivs_admin_hr_rpcs.sql` | C SQL | **yes** when A/F land; `hr.functions.ts` still required |
| 3 | `20261015000030_sherivs_users_identity_freeze.sql` | A | **yes** (HR role + C4) |
| 4 | `20261015000040_sherivs_users_sensitive_column_revoke.sql` | F | **yes** (app-context select list) |
| 4b | `20261015000045_sherivs_rls_payroll_biometrics.sql` | E-HR | payroll JWT in `admin/hr.tsx` |
| 5 | `20261015000050_sherivs_rls_wave_a_classes_calendar_timetable.sql` | E-A | low |
| 6 | `20261015000060_sherivs_rls_wave_b_students_map_plans_attendance.sql` | E-B | student lesson-plan filter (B3); H2 |
| 7 | `20261015000070_sherivs_fees_settlement_and_rls_wave_c.sql` | D+E-C | **blocked** until Paystack app |
| 8 | `20261015000080_sherivs_rls_grant_hygiene.sql` | G | none |
| 9 | `20261015000090_sherivs_users_force_rls.sql` | H optional | **not eligible** until founder/DEFINER staging |

The `db-apply*.mjs` runners sort `database/supabase/migrations/*.sql`
lexicographically. These names **must** keep this order. They currently live
only as `.sql.proposed` under `docs/security/rls-prep/proposed-sql/`. The
implementation mission must **not** fold A–H into one migration.

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
| **B10** | Related FOR ALL tables (`staff_payroll`, `teacher_biometrics`, hostel/clinic/library, …) | Payroll/biometrics command-split is proposed in `00045` (still **OPEN** until applied). Hostel/clinic/library/… remain BLOCKED per `RELATED-POLICIES.md` — do not invent permissions | Yes |
| **B11** | Isolated staging project | Required for GATE 4/5 | **Yes — missing prerequisite** |

---

## 10. Release gates

| Gate | Meaning | This mission |
|------|---------|--------------|
| **GATE 1** | Correct master baseline | **PASS** — `origin/master` @ `d195ba8` with memberships |
| **GATE 2** | HR and fee-payment compatibility paths designed | **PASS** — §5 |
| **GATE 3** | SQL and application changes independently reviewed | **PASS WITH CONDITIONS** — corrections-002 ready for another independent review. **Not fully passed.** Not approved to apply |
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
