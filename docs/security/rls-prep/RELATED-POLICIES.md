# Related RLS policy inventory (H6) — corrections-002

Named SHERIVS-002 tables (`tenant_all_*`) are covered by E-A/E-B/E-C
(`00050`–`00070`). Payroll/biometrics command policies: `00045`.

**No finding is remediated.** SHERIVS-002 and SHERIVS-003 remain **OPEN**
until proposed SQL is applied and staging-tested.

## Must close before SHERIVS-002 can be considered closed

Replace every remaining `tenant_all_*` on:

`classes`, `school_calendar`, `timetables`, `timetable_slots`, `students`,
`parent_student_map`, `lesson_plans`, `attendance`, `attendance_logs`,
`fees`, `fraud_attempts`, `subscriptions`.

Confirm earlier drops (`grades`, `messages`, `notifications`, `audit_logs`,
`webhook_logs`, `qr_tokens`, `teacher_performance_profiles`) still have
command-specific policies only.

## Must close before SHERIVS-003 can be considered closed

| Object | Proposed design | Removes peer access? |
|--------|-----------------|----------------------|
| `users.salary` / nin / bank_* / `face_biometric` | F column revoke | Yes for PostgREST `select=*` **if** applied |
| `staff_payroll` | `00045` finance-only SELECT/INSERT/UPDATE; no DELETE; drop FOR ALL | Yes vs students/teachers/parents |
| `teacher_biometrics` | `00045` own write; own or school-admin SELECT; drop both FOR ALL policies | Yes vs non-admin peers |
| `attendance_verification_log` | **not** command-split in this P0 | **No** — 003-adjacent residual |
| `staff_leave` | **not** split | Adjacent residual |

`00045` is required design for payroll/biometrics. 003 stays OPEN until
those policies plus F are applied and tested. Verification logs remain a
follow-on residual if 003 is interpreted to include location/face_verified.

## `00045` command matrix (proposed, NOT VERIFIED)

### `staff_payroll`

| Command | Authorized roles | Tenant / ownership | Sensitive |
|---------|------------------|--------------------|-----------|
| SELECT | admin, principal, bursar, hq, super-admin | `school_id = get_my_school_id()` | gross/net/deductions |
| INSERT | admin, principal, bursar, super-admin | same | |
| UPDATE | admin, principal, bursar, super-admin | same | status `draft/approved/paid` |
| DELETE | **none** (authenticated) | | |
| FOR ALL remaining? | **no** after drop | | |

Live UI: `admin/hr.tsx` generate/update/approve/pay; `portal-overview` SELECT.

### `teacher_biometrics`

| Command | Authorized roles | Tenant / ownership | Sensitive |
|---------|------------------|--------------------|-----------|
| SELECT | owner `user_id = auth.uid()`; school admin same school; super-admin | | `face_template_hash` |
| INSERT | owner, role in teacher/admin/principal, same school | `user_id = auth.uid()` | |
| UPDATE | owner only | own row | enrollment_status, hash |
| DELETE | **none** | | |
| FOR ALL remaining? | **no** after dropping `biometrics_school_isolation` and `school_isolation` | | |

Live UI: teacher enrollment upsert/update own; geofence-settings admin SELECT.

Admin **write** of another teacher’s biometric row is **BLOCKED** (no RPC).

## Named `tenant_all_*` remaining until E waves

See `PER-TABLE-RLS-MATRIX.md`. Unauthorized peer ALL-access remains until
those files apply.

## Unresolved product decisions — do not invent permissions

| Domain | Tables | Status |
|--------|--------|--------|
| Hostel | rooms, allocations, attendance | BLOCKED writer/reader set |
| Clinic | `clinic_visits` | BLOCKED (B9-adjacent) |
| Library | books, borrowings | BLOCKED precise roles |
| Discipline | `discipline_records` | BLOCKED parent visibility |
| Transport / meals / sports | school_* + buses (buses already split) | BLOCKED except existing bus policies |
| Expenses | `school_expenses`, budgets | BLOCKED finance vs student |
| API keys / fee ledger / admissions / `school_staff` / AI logs / study_sessions | inventory only | follow-on HIGH for secrets/ledger |
