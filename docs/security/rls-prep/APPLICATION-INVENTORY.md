# Application read/write inventory

Baseline: `origin/master` @ `d195ba8`. No credentials.

Auth: **JWT** browser client; **JWT-srv** `requireSupabaseAuth`; **service_role** `supabaseAdmin`.

## users.role / school_id / is_active

| File | Symbol | Auth | R/W | Columns |
|------|--------|------|-----|---------|
| `frontend/src/contexts/app-context.tsx` | `load` | JWT | R | `select("*")` including identity + HR + biometric |
| `frontend/src/lib/profile.functions.ts` | `getMyProfile` | JWT-srv | R | `role` plus profile fields; not `school_id` |
| `frontend/src/lib/profile.functions.ts` | `updateMyProfile` | JWT-srv | W | allowlisted profile fields only |
| `frontend/src/lib/identity/memberships.functions.ts` | `switchActiveOrganization` | JWT-srv + service_role | R+W | writes `school_id`,`role` via service_role |
| `frontend/src/lib/identity/resolve-identity.functions.ts` | `resolveSherivsIdentity` | JWT-srv | R | `school_id`,`role`,`is_active` |
| `frontend/src/lib/runtime/scholar/staff-accounts.functions.ts` | `createStaffAccount` | JWT-srv gate + service_role | W | insert identity |
| `frontend/src/lib/runtime/scholar/teachers.functions.ts` | `inviteTeacher` | JWT-srv + service_role | W | insert teacher |
| `frontend/src/lib/runtime/scholar/teachers.functions.ts` | `setTeacherActive` | JWT-srv | W | `is_active` |
| `frontend/src/lib/onboarding/provision-organization.functions.ts` | `provisionOrganization` | service_role | W | founder/staff users |
| `frontend/src/lib/onboarding/create-organization.functions.ts` | RPC `create_organization_with_founder` | DEFINER | W | INSERT admin |
| `frontend/src/lib/runtime/scholar/demo-provision.functions.ts` | demo seed | service_role | W | gated off in production |
| `frontend/src/routes/_authenticated/admin/hr.tsx` | `saveStaff` | JWT | W | **role, salary** |
| `frontend/src/routes/auth.tsx` | tenant sign-in | JWT | R | `school_id`,`role` |

## Sensitive HR columns

| Column | App path |
|--------|----------|
| `salary` | `admin/hr.tsx` list + `saveStaff`; also `select("*")` |
| `nin`, `bank_name`, `account_number`, `account_name` | no dedicated UI; `select("*")` + peer SELECT policy |
| `users.face_biometric` | unused; UI uses `teacher_biometrics` |

## fees.status and payment references

| File | Auth | Operation |
|------|------|-----------|
| `frontend/src/lib/runtime/scholar/paystack.functions.ts` `initFeePayment` | JWT-srv | UPDATE reference/access_code |
| `frontend/src/lib/runtime/scholar/paystack.functions.ts` `verifyFeePayment` | JWT-srv | UPDATE status paid |
| `frontend/src/routes/api/public/webhooks/paystack.ts` | HMAC + service_role | UPDATE status paid |
| `frontend/src/routes/_authenticated/admin/fees.tsx` | JWT | CrudList including status=paid |
| `frontend/src/routes/_authenticated/bursar/fee-plans.tsx` | JWT | INSERT unpaid |
| parent fees/dashboard | JWT + JWT-srv | SELECT + init/verify |

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
| `admin/lesson-plans.tsx` | JWT | UPDATE status/review_notes |
| `teacher/lesson-plans.tsx` | JWT | INSERT/UPDATE own |
| `student/dashboard.tsx` | JWT | SELECT class homework **without status filter** today |

## Existing security tests (not a substitute for staging JWT matrix)

| Path | Covers |
|------|--------|
| `scripts/verify-tenant-isolation.mjs` | live Tenant A≠B on messages/users |
| `scripts/run-rls-isolation-check.mjs` | registry postures |
| `tests/unit/organization-memberships.test.ts` | migration shape + dual-write |
| `tests/unit/rls-helper-definer-posture.test.ts` | `is_super_admin` DEFINER ratchet |
| `tests/unit/identity-lifecycle.DEFECTS.md` | helpers ignore `is_active` |
| `tests/unit/sherivs-rls-implementation-prep.test.ts` | this plan: no apply-path SQL, production-ref refuse |
