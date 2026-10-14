-- SHERIVS-RLS-IMPLEMENTATION-PREP-001
-- GATE 5 catalog proofs. Read-only. Run only on an isolated staging database
-- after change sets B-C-A-F-E-D-G are applied there. Never against production.
--
-- The JS wrapper (assert-not-production.mjs) must refuse the canonical
-- production ref nwrflbpbhyiqdptmlccm and the four Sherivs hostnames before
-- this file is opened against a live connection.

-- A/B helpers: active-user, users-row source, definer, search_path
SELECT p.proname,
       p.prosecdef AS security_definer,
       pg_get_functiondef(p.oid) AS def
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_my_school_id',
    'get_my_role',
    'is_school_admin',
    'is_super_admin',
    'get_my_memberships',
    'freeze_users_identity_columns',
    'freeze_membership_identity_columns',
    'freeze_fees_settlement_columns',
    'freeze_lesson_plan_self_approval',
    'admin_hr_staff_list',
    'admin_hr_staff_write'
  )
ORDER BY p.proname;

-- A/C4/H2: freeze triggers present and enabled
SELECT c.relname, t.tgname, t.tgenabled, pg_get_triggerdef(t.oid)
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('users', 'organization_memberships', 'fees', 'lesson_plans')
  AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;

-- E: no remaining tenant_all_* on named Scholar tables
SELECT pol.polname, c.relname, pol.polcmd
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND pol.polname LIKE 'tenant_all_%'
ORDER BY c.relname, pol.polname;

-- F/G/C3: sensitive, identity, is_active, fee settlement privileges
SELECT table_name, column_name, grantee, privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND (
    (table_name = 'users' AND column_name IN (
      'role', 'school_id', 'is_active', 'salary', 'nin',
      'bank_name', 'account_number', 'account_name', 'face_biometric'
    ))
    OR (table_name = 'fees' AND column_name IN (
      'status', 'paid_amount', 'paid_at',
      'paystack_reference', 'paystack_access_code'
    ))
  )
  AND grantee IN ('anon', 'authenticated', 'PUBLIC')
ORDER BY table_name, column_name, grantee, privilege_type;

-- G: table-level TRUNCATE must not be held by anon/authenticated
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN (
    'users', 'students', 'fees', 'attendance', 'attendance_logs',
    'classes', 'parent_student_map', 'lesson_plans', 'timetables',
    'timetable_slots', 'school_calendar', 'fraud_attempts', 'subscriptions',
    'organization_memberships'
  )
  AND grantee IN ('anon', 'authenticated')
  AND privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'INSERT', 'DELETE')
ORDER BY table_name, grantee, privilege_type;

-- C2/G: authenticated must not hold INSERT/UPDATE/DELETE on memberships
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'organization_memberships'
  AND grantee IN ('anon', 'authenticated', 'PUBLIC')
ORDER BY grantee, privilege_type;

-- H6 inventory (read-only): related FOR ALL isolation policies still present
SELECT pol.polname, c.relname, pol.polcmd
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'staff_payroll', 'staff_leave', 'teacher_biometrics',
    'attendance_verification_log', 'school_geofence',
    'hostel_rooms', 'hostel_allocations', 'hostel_attendance',
    'clinic_visits', 'library_books', 'library_borrowings',
    'discipline_records', 'school_sports', 'school_meals',
    'school_transport', 'school_expenses', 'school_expense_budgets'
  )
ORDER BY c.relname, pol.polname;

-- A/S7: RLS enabled; FORCE after change set H/S7 only
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'users', 'organization_memberships', 'students', 'fees', 'attendance',
    'attendance_logs', 'classes', 'parent_student_map', 'lesson_plans',
    'timetables', 'timetable_slots', 'school_calendar', 'fraud_attempts',
    'subscriptions'
  )
ORDER BY c.relname;
