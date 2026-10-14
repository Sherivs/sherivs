# Per-table RLS matrix

Command policies: lexicographic proposed files `00045` (E-HR), `00050`
(E-A), `00060` (E-B), `00070` (E-C). Related isolation tables:
`RELATED-POLICIES.md`.

All policies `TO authenticated`. `service_role` keeps table ALL / BYPASSRLS.
`anon` gets no DML (change set G).

This matrix is **proposed design**, **NOT VERIFIED** on staging. SHERIVS-002
and SHERIVS-003 remain **OPEN**.

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `classes` | same school | school admin / super-admin | same as INSERT | same as INSERT |
| `school_calendar` | same school | school admin / super-admin | same | same |
| `timetables` | same school | school admin / super-admin | same | same |
| `timetable_slots` | same school | school admin / super-admin | same | same |
| `students` | staff same-school (B2 includes teachers); self `user_id`; parent mapped | school admin / super-admin | same | same |
| `parent_student_map` | parent own; staff roles same school (broadcast/driver/fanout) | **none** (B1 BLOCKED) | **none** | **none** |
| `lesson_plans` | owner teacher; school admin; student/parent **approved** class only (B3) | teacher own, status draft/submitted | **split (H2):** owner content (not approved); school-admin review. Trigger denies self-approval | owner or admin |
| `attendance` | teaching staff/hq; self; mapped parent | teaching staff, `marked_by = auth.uid()` | teaching staff | **none** (B4) |
| `attendance_logs` | own teacher or school admin | self `teacher_id = auth.uid()` | school admin | school admin |
| `fees` | finance staff; self; mapped parent | finance, `status in (unpaid,partial)` | finance (settlement columns frozen by D) | **none** (B4) |
| `fraud_attempts` | school admin / super-admin | **none** (B7) | **none** | **none** |
| `subscriptions` | super-admin | super-admin | super-admin | super-admin |
| `staff_payroll` | finance: admin/principal/bursar/hq + super-admin, same school | admin/principal/bursar + super-admin | same as INSERT | **none** |
| `teacher_biometrics` | owner or school-admin same school or super-admin | owner, role teacher/admin/principal, same school | owner only | **none** |

`staff_payroll` / `teacher_biometrics`: live FOR ALL isolation policies are
**dropped** by `00045`. After that file, no FOR ALL remains on those two
tables. Peer teacher/student/parent SELECT of payroll is denied by role
pin. Peer biometric SELECT is denied except school-admin. **NOT VERIFIED.**

Dropped earlier (do not recreate `tenant_all_*`): `grades`, `messages`,
`notifications`, `audit_logs`, `webhook_logs`, `qr_tokens`,
`teacher_performance_profiles`. Follow their existing command policies.

## Unresolved domains — do not invent permissions

Hostel, clinic, library, discipline, transport, meals, sports, and expenses
isolation policies are follow-on (B10) with distinct roles. Recorded
**BLOCKED** in `RELATED-POLICIES.md`. This P0 proposed SQL does **not**
change those tables.

`attendance_verification_log` and `staff_leave` remain FOR ALL residuals
adjacent to 003. They are **not** closed by `00045`.
