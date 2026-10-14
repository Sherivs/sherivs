-- SHERIVS-RLS-IMPLEMENTATION-PREP-001
-- GATE 5 catalog proofs. Read-only. Run only on an isolated staging database
-- after change sets A–G are applied there. Never against production.
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
    'admin_hr_staff_read',
    'admin_hr_staff_list',
    'admin_hr_staff_write'
  )
ORDER BY p.proname;

-- A: identity freeze trigger present and enabled
SELECT tgname, tgenabled, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid = 'public.users'::regclass
  AND NOT tgisinternal
ORDER BY tgname;

-- E: no remaining tenant_all_* on named Scholar tables
SELECT pol.polname, c.relname, pol.polcmd
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND pol.polname LIKE 'tenant_all_%'
ORDER BY c.relname, pol.polname;

-- F/G: sensitive and identity column privileges for anon/authenticated
SELECT table_name, column_name, grantee, privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND table_name = 'users'
  AND column_name IN (
    'role', 'school_id', 'salary', 'nin',
    'bank_name', 'account_number', 'account_name', 'face_biometric'
  )
  AND grantee IN ('anon', 'authenticated', 'PUBLIC')
ORDER BY column_name, grantee, privilege_type;

-- G: table-level TRUNCATE must not be held by anon/authenticated
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN (
    'users', 'students', 'fees', 'attendance', 'attendance_logs',
    'classes', 'parent_student_map', 'lesson_plans', 'timetables',
    'timetable_slots', 'school_calendar', 'fraud_attempts', 'subscriptions'
  )
  AND grantee IN ('anon', 'authenticated')
  AND privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES')
ORDER BY table_name, grantee, privilege_type;

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
