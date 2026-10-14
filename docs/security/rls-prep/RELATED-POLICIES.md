# Related RLS policy inventory (H6)

Named SHERIVS-002 tables (`tenant_all_*`) are covered by change set E.
This inventory lists **other** broad same-school FOR ALL / isolation
policies that look similar and must not be assumed identical.

**No finding is remediated.** SHERIVS-002 and SHERIVS-003 remain **OPEN**.

Sources: `database/supabase/migrations/` at `origin/master` @ `d195ba8`.
Live catalog was not queried in this mission.

## Must close before SHERIVS-002 can be considered closed

Replace every remaining `tenant_all_*` on:

`classes`, `school_calendar`, `timetables`, `timetable_slots`, `students`,
`parent_student_map`, `lesson_plans`, `attendance`, `attendance_logs`,
`fees`, `fraud_attempts`, `subscriptions`.

Confirm `grades`, `messages`, `notifications`, `audit_logs`,
`webhook_logs`, `qr_tokens`, `teacher_performance_profiles` still have
command-specific policies only (already dropped `tenant_all_*`).

Overlapping FOR ALL on those named tables must be zero. Catalog proof:
`scripts/staging/sherivs-rls-prep/catalog-verify.sql`.

Related isolation tables are **not** `tenant_all_*`. They do not block
the **named** SHERIVS-002 close-out, but they are the same defect class
and stay OPEN as follow-on (B10) unless product schedules them in the
same release.

## Must close before SHERIVS-003 can be considered closed

SHERIVS-003 is unauthorized sensitive HR / biometric access.

| Object | Live policy | Why 003 stays open if untouched |
|--------|-------------|-------------------------------|
| `users.salary`, `nin`, `bank_*`, `face_biometric` | peer SELECT + `select("*")` + column GRANT | F revoke is required |
| `staff_payroll` | `staff_payroll_school_isolation` FOR ALL same school | Any same-school JWT (student, teacher, parent) can CRUD payroll after B helpers resolve a school |
| `teacher_biometrics` | `biometrics_school_isolation` **and** later `school_isolation` (duplicate FOR ALL) | Face hash + enrollment readable/writable by any same-school user |
| `users.face_biometric` | column on users | F revoke; enrollment UI uses `teacher_biometrics` |

`staff_leave` is workforce data, not the named 003 columns, but HR UI
writes it with JWT FOR ALL. Treat as 003-adjacent.

Until F **and** command-split (or equivalent) policies exist for
`staff_payroll` and `teacher_biometrics`, **do not close SHERIVS-003**.

## Table-by-table (not identical authorization)

### Sensitive HR / biometric — 003 blockers

| Table | Policy | Commands | App writers | Proposed posture | Close 003? |
|-------|--------|----------|-------------|------------------|------------|
| `staff_payroll` | `staff_payroll_school_isolation` FOR ALL | ALL | `admin/hr.tsx` JWT insert/update; `portal-overview` SELECT | SELECT/INSERT/UPDATE: school admin/principal/bursar only. No student/teacher/parent. No DELETE unless product says so. | **Required** |
| `staff_leave` | `staff_leave_school_isolation` FOR ALL | ALL | `admin/hr.tsx` JWT | Admin write; staff SELECT own; no student | Adjacent; schedule with payroll |
| `teacher_biometrics` | `biometrics_school_isolation` + `school_isolation` | ALL | teacher enrollment JWT upsert; geofence-settings admin read | SELECT/UPDATE own `user_id`; school admin SELECT; deny other roles; drop duplicate policy | **Required** |
| `attendance_verification_log` | `verification_log_school_isolation` + `school_isolation` | ALL | teacher sign-in INSERT | INSERT own `user_id`; admin SELECT; deny UPDATE/DELETE for teachers; drop duplicate | Adjacent (location + face_verified). Required before calling 003 fully closed if logs remain readable school-wide |
| `school_geofence` | `geofence_school_isolation` + `school_isolation` | ALL | admin geofence-settings upsert; teacher sign-in SELECT | Admin write; teacher SELECT for check-in; deny student/parent write | Not 003 columns; still FOR ALL. Follow-on |

No proposed SQL in **this** mission splits these tables. Shipping E
without them does **not** close 003.

### Hostel / clinic / library / discipline

| Table | Policy | Notes |
|-------|--------|-------|
| `hostel_rooms` | FOR ALL same school | Room metadata. Admin write; broader SELECT possible. Not 003. |
| `hostel_allocations` | FOR ALL | Student housing assignment. Parent/student SELECT own is a product decision. **BLOCKED** writer set. |
| `hostel_attendance` | FOR ALL | Night check. Hostel staff/admin only if such a role exists — **BLOCKED** (no dedicated hostel role in V1 staff set). |
| `clinic_visits` | FOR ALL | Medical. Nurse/admin; parent own-child SELECT maybe. **BLOCKED** medical visibility (B9-adjacent). |
| `library_books` | FOR ALL | Catalogue. Broader SELECT OK; writes librarian/admin. |
| `library_borrowings` | FOR ALL | Librarian write; student own SELECT. |
| `discipline_records` | FOR ALL | Admin/principal write; parent visibility **BLOCKED**. |

### Transport / meal / sports / expense

| Table | Policy | Notes |
|-------|--------|-------|
| `school_sports` | `sports_school_rw` FOR ALL + anon public read | Public site. Writes should be admin. FOR ALL includes students. Follow-on. |
| `school_meals` | `meals_school_rw` FOR ALL + anon public read | Same. |
| `school_transport` | `transport_school_rw` FOR ALL + anon public read | Same. Driver-specific bus reads already split on `transport_buses` (MH-03). |
| `transport_buses` | command policies in `20260904010000` / `20261003000041` | Already split. Do not regress. |
| `school_expenses` | `expenses_school_rw` FOR ALL | Finance. bursar/admin only. Students must not CRUD expenses. Follow-on. |
| `school_expense_budgets` | `budgets_school_rw` FOR ALL | Same. |
| `school_staff_types` | `staff_types_school_rw` FOR ALL | Low sensitivity. Follow-on. |
| `school_api_keys` | `api_keys_school_isolation` | Secrets. Must not be student-writable. Follow-on / verify live grants. |
| `platform_fee_ledger` | school access policy | Finance. Follow-on. |

### Memberships

`organization_memberships` already has command policies, but INSERT is
granted to authenticated and school-admin WITH CHECK allows a direct
membership write. Change set A+G freeze + REVOKE INSERT. Required for
SHERIVS-001, not 002.

## BLOCKED product permissions

| ID | Permission | Why blocked |
|----|------------|-------------|
| B1 | Authenticated writes to `parent_student_map` | Only demo-provision writes today |
| B8 | JWT / UI mark-fee-paid | Settlement is Paystack verify/webhook only |
| B9 | Student medical column exposure | Out of named 003; clinic_visits too |
| B10 | Command-split of isolation tables listed above | Needs per-table product owners |
| H-hostel | Hostel night-check writer role | No V1 hostel-warden role |
| H-clinic | Nurse-only clinic writes | `nurse` exists in staff set but policies are school-wide ALL |
| H-discipline-parent | Parent read of discipline | Not specified |
| H-admin-lifecycle | Admin deactivating another admin | `setTeacherActive` is teacher-only |

## What this P0 SQL actually changes for related tables

Nothing. Related-table SQL is follow-on. The prep artifacts now inventory
them so 002/003 close-out cannot ignore them.
