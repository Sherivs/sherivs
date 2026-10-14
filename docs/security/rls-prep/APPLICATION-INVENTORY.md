# Application read/write inventory

Baseline: `origin/master` @ `d195ba8`. No credentials.

Auth: **JWT** browser client; **JWT-srv** `requireSupabaseAuth`; **service_role** `supabaseAdmin`.

Compatibility claims are **NOT VERIFIED** on staging. Live `saveStaff` and
Paystack paths are **incompatible** with proposed A/F/D until companion
application work ships in the same release. See
`IDENTITY-PROVISIONING.md`, `HR-RPC-CONTRACT.md`, `PAYMENT-INVARIANTS.md`.

## users.role / school_id / is_active

| File | Symbol | Auth | R/W | Columns |
|------|--------|------|-----|---------|
| `frontend/src/contexts/app-context.tsx` | `load` | JWT | R | `select("*")` including identity + HR + biometric — **breaks under F** until explicit columns |
| `frontend/src/lib/profile.functions.ts` | `getMyProfile` | JWT-srv | R | `role` plus profile fields; not `school_id` |
| `frontend/src/lib/profile.functions.ts` | `updateMyProfile` | JWT-srv | W | allowlisted profile fields only |
| `frontend/src/lib/identity/memberships.functions.ts` | `switchActiveOrganization` | JWT-srv + service_role | R+W | writes `school_id`,`role` via service_role; JWT SELECT memberships |
| `frontend/src/lib/identity/resolve-identity.functions.ts` | `resolveSherivsIdentity` | JWT-srv | R | `school_id`,`role`,`is_active` |
| `frontend/src/lib/runtime/scholar/staff-accounts.functions.ts` | `createStaffAccount` | JWT-srv gate + service_role | W | insert identity |
| `frontend/src/lib/runtime/scholar/teachers.functions.ts` | `inviteTeacher` | JWT-srv + service_role | W | insert teacher |
| `frontend/src/lib/runtime/scholar/teachers.functions.ts` | `setTeacherActive` | JWT-srv | W | `is_active` of **another** teacher (C4: self-change denied) |
| `frontend/src/lib/onboarding/provision-organization.functions.ts` | `provisionOrganization` | service_role | W | founder/staff users |
| `frontend/src/lib/onboarding/create-organization.functions.ts` | RPC `create_organization_with_founder` | DEFINER | W | INSERT admin; memberships via nested sync (C2 **mirror**, not trigger depth). **NOT VERIFIED** |
| `frontend/src/lib/runtime/scholar/demo-provision.functions.ts` | demo seed | service_role | W | gated off in production |
| `frontend/src/routes/_authenticated/admin/hr.tsx` | `saveStaff` | JWT | W | **role, salary** — incompatible with A+F until `HR-RPC-CONTRACT.md` is implemented. **Release blocker.** |
| `frontend/src/routes/auth.tsx` | tenant sign-in | JWT | R | `school_id`,`role` |

PostgREST school-admin `users` INSERT/DELETE is **withdrawn** (C3). Do not
preserve a generic authenticated INSERT merely to keep founder working.

## Sensitive HR columns

| Column | App path |
|--------|----------|
| `salary` | `admin/hr.tsx` list + `saveStaff`; also `select("*")` |
| `nin`, `bank_name`, `account_number`, `account_name` | no dedicated UI; `select("*")` + peer SELECT policy |
| `users.face_biometric` | unused; UI uses `teacher_biometrics` |

## staff_payroll / teacher_biometrics (H6)

| File | Auth | Operation |
|------|------|-----------|
| `admin/hr.tsx` generate/update/approve/pay | JWT | INSERT/UPDATE `staff_payroll` — depends on `00045` finance policies |
| `portal-overview` | JWT | SELECT payroll |
| `teacher` biometric enrollment | JWT | upsert own `teacher_biometrics` |
| `admin/geofence-settings.tsx` | JWT | SELECT biometrics |

Teacher JWT must not SELECT peer payroll or peer biometrics after `00045`.
**NOT VERIFIED.**

## fees.status and payment references

| File | Auth | Operation |
|------|------|-----------|
| `frontend/src/lib/runtime/scholar/paystack.functions.ts` `initFeePayment` | JWT-srv | UPDATE reference/access_code — **breaks under D**; no relationship check beyond RLS |
| `frontend/src/lib/runtime/scholar/paystack.functions.ts` `verifyFeePayment` | JWT-srv | UPDATE status paid — **breaks under D**; no amount/currency match |
| `frontend/src/routes/api/public/webhooks/paystack.ts` | HMAC + service_role | UPDATE by reference even if `fee_id` missing — **H3/H4 incompatible** |
| `frontend/src/routes/_authenticated/admin/fees.tsx` | JWT | CrudList including status=paid — **B8 BLOCKED** |
| `frontend/src/routes/_authenticated/bursar/fee-plans.tsx` | JWT | INSERT unpaid |
| parent fees/dashboard | JWT + JWT-srv | SELECT + init/verify |

`00070` is **not eligible to apply** until the Paystack companion exists.

## attendance / attendance_logs

| File | Auth | Operation |
|------|------|-----------|
| `attendance.functions.ts` `markClassAttendance` | JWT-srv | upsert attendance |
| `attendance.functions.ts` `teacherCheckWithQr` | JWT-srv | insert attendance_logs |
| `teacher/sign-in.tsx` | JWT | insert attendance_logs (GPS/face) |
| parent/student/admin attendance UIs | JWT | SELECT |

## parent_student_map

| File | Auth | R/W |
|------|------|-----|
| `parent/*.tsx`, parent AI | JWT | R own links |
| `notifications-fanout.functions.ts` | JWT-srv admin | R |
| `messages-broadcast.functions.ts` | JWT-srv teacher/admin | R |
| `driver-portal.functions.ts` | JWT-srv | R |
| `demo-provision.functions.ts` | service_role | **W** only production-code writer |

## lesson_plans approval

Schema CHECK `status IN ('draft','submitted','approved','needs_revision')`.

| File | Auth | Operation |
|------|------|-----------|
| `admin/lesson-plans.tsx` | JWT | UPDATE status/review_notes — authorized H2 path (`is_school_admin`) |
| `teacher/lesson-plans.tsx` | JWT | INSERT/UPDATE own draft/submitted — must not set `approved` (H2) |
| `student/dashboard.tsx` | JWT | SELECT class homework **without status filter** today |

## Existing security tests (not a substitute for staging JWT matrix)

| Path | Covers |
|------|--------|
| `scripts/verify-tenant-isolation.mjs` | live Tenant A≠B on messages/users |
| `scripts/run-rls-isolation-check.mjs` | registry postures |
| `tests/unit/organization-memberships.test.ts` | migration shape + dual-write |
| `tests/unit/rls-helper-definer-posture.test.ts` | `is_super_admin` DEFINER ratchet |
| `tests/unit/identity-lifecycle.DEFECTS.md` | helpers ignore `is_active` |
| `tests/unit/sherivs-rls-implementation-prep.test.ts` | plan integrity: no apply-path SQL, C1/C2/C3/H1 ratchets |
| `docs/security/rls-prep/GATE3-CORRECTIONS.md` | C1–C4 / H1–H7 response (round 1) |
| `docs/security/rls-prep/GATE3-CORRECTIONS-002.md` | round-2 C2/C3/H5/H6 response |
| `docs/security/rls-prep/GATE3-INDEPENDENT-REVIEW-002.md` | independent re-review (**do not overwrite**) |
| `docs/security/rls-prep/IDENTITY-PROVISIONING.md` | every users create/modify path |
| `docs/security/rls-prep/HR-RPC-CONTRACT.md` | H5 companion / release blocker |
| `docs/security/rls-prep/PAYMENT-INVARIANTS.md` | H3/H4 not corrected |
| `docs/security/rls-prep/RELATED-POLICIES.md` | H6 |
