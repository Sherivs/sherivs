# Per-table RLS matrix (named tenant_all_* tables)

Command policies: lexicographic proposed files `00050` (E-A), `00060` (E-B),
`00070` (E-C). Related isolation tables: `RELATED-POLICIES.md`.

All policies `TO authenticated`. `service_role` keeps table ALL / BYPASSRLS. `anon` gets no DML (change set G).

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

Dropped earlier (do not recreate `tenant_all_*`): `grades`, `messages`, `notifications`, `audit_logs`, `webhook_logs`, `qr_tokens`, `teacher_performance_profiles`. Follow their existing command policies.

## Related tables (H6) — not assumed identical

`staff_payroll` and `teacher_biometrics` FOR ALL policies **must** be
command-split before SHERIVS-003 can close. Hostel, clinic, library,
discipline, transport, meal, sports, and expense isolation policies are
follow-on (B10) with distinct roles. See `RELATED-POLICIES.md`.

This P0 proposed SQL does **not** change those related tables.
