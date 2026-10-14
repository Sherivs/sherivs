# Per-table RLS matrix (named tenant_all_* tables)

Command policies: `docs/security/rls-prep/proposed-sql/E-command-policies.sql.proposed`.

All policies `TO authenticated`. `service_role` keeps table ALL / BYPASSRLS. `anon` gets no DML (change set G).

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `classes` | same school | school admin / super-admin | same as INSERT | same as INSERT |
| `school_calendar` | same school | school admin / super-admin | same | same |
| `timetables` | same school | school admin / super-admin | same | same |
| `timetable_slots` | same school | school admin / super-admin | same | same |
| `students` | staff same-school (B2 includes teachers); self `user_id`; parent mapped | school admin / super-admin | same | same |
| `parent_student_map` | parent own; staff roles same school (broadcast/driver/fanout) | **none** (B1) | **none** | **none** |
| `lesson_plans` | owner teacher; school admin; student/parent **approved** class only (B3) | teacher own `teacher_id`; admin | owner or admin | owner or admin |
| `attendance` | teaching staff/hq; self; mapped parent | teaching staff, `marked_by = auth.uid()` | teaching staff | **none** (B4) |
| `attendance_logs` | own teacher or school admin | self `teacher_id = auth.uid()` | school admin | school admin |
| `fees` | finance staff; self; mapped parent | finance, `status in (unpaid,partial)` | finance (settlement columns frozen by D) | **none** (B4) |
| `fraud_attempts` | school admin / super-admin | **none** (B7) | **none** | **none** |
| `subscriptions` | super-admin | super-admin | super-admin | super-admin |

Dropped earlier (do not recreate `tenant_all_*`): `grades`, `messages`, `notifications`, `audit_logs`, `webhook_logs`, `qr_tokens`, `teacher_performance_profiles`. Follow their existing command policies.

Follow-on (B10), not this P0: `staff_payroll`, `staff_leave`, `teacher_biometrics`, geofence, hostel, clinic, library, discipline, and other `*_school_isolation` FOR ALL tables.
