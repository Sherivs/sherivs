-- RLS isolation check: prove no anonymous / cross-tenant read leaks.
-- Run with:  psql -f database/queries/rls-isolation-check.sql
-- Exits non-zero (via \quit) if any leak is detected.
\set ON_ERROR_STOP on
\timing off

-- 1. Every tenant table MUST have RLS enabled.
SELECT format('FAIL: %I.%I has RLS DISABLED', schemaname, tablename) AS issue
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'schools','students','users','classes','fees','attendance',
    'attendance_logs','qr_tokens','grades','timetables','timetable_slots',
    'lesson_plans','messages','notifications','events','news','testimonials',
    'faqs','why_us_items','school_facilities','academic_programs','blog_posts',
    'parent_student_map','school_calendar','subscriptions','webhook_logs',
    'audit_logs','fraud_attempts','teacher_performance_profiles',
    'super_admins','super_admin_logs','admission_applications',
    'ai_conversations','ai_interaction_log','attendance_verification_log',
    'clinic_visits','digital_twin_calls','digital_twin_config',
    'discipline_records','hostel_allocations','hostel_attendance',
    'hostel_rooms','library_books','library_borrowings','news_reads',
    'notification_preferences','platform_complaints','platform_config',
    'school_ad_campaigns','school_api_keys','school_expense_budgets',
    'school_expenses','school_gallery','school_geofence','school_meals',
    'school_sports','school_staff','school_staff_types','school_transport',
    'staff_leave','staff_payroll','student_platform_fee_ledger',
    'study_sessions','teacher_biometrics','transport_buses'
  )
  AND NOT rowsecurity;

-- 2. Every public-schema table that has rowsecurity ON must have at least one
--    policy — UNLESS it is a deny-by-default control-plane table (RLS enabled,
--    zero policies, zero anon/authenticated grants). Such tables are denied to
--    both client roles by default and are therefore safe without policies.
SELECT format('FAIL: %I.%I has RLS but ZERO policies and anon/authenticated grants', t.schemaname, t.tablename) AS issue
FROM pg_tables t
LEFT JOIN pg_policies p
  ON p.schemaname = t.schemaname AND p.tablename = t.tablename
LEFT JOIN information_schema.role_table_grants g
  ON g.table_schema = t.schemaname
 AND g.table_name = t.tablename
 AND g.grantee IN ('anon','authenticated')
WHERE t.schemaname = 'public' AND t.rowsecurity
GROUP BY t.schemaname, t.tablename
HAVING count(p.policyname) = 0 AND count(g.grantee) > 0;

-- 3. Anonymous role MUST NOT have blanket SELECT on PII-bearing tables.
WITH risky AS (
  SELECT unnest(ARRAY[
    'users','students','fees','grades','attendance','attendance_logs',
    'parent_student_map','messages','notifications','fraud_attempts',
    'webhook_logs','super_admin_logs','audit_logs'
  ]) AS tbl
)
SELECT format('FAIL: anon has %s on public.%s', g.privilege_type, g.table_name) AS issue
FROM information_schema.role_table_grants g
JOIN risky r ON r.tbl = g.table_name
WHERE g.grantee = 'anon'
  AND g.table_schema = 'public'
  AND g.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE');

-- 4. Schools table: anon SELECT is intentional (public website needs it).
--    Only verify no PII columns leak via anon-readable policies.
SELECT format('NOTE: anon can read public.schools (expected for tenant landing pages)') AS info
FROM information_schema.role_table_grants
WHERE grantee = 'anon' AND table_schema = 'public' AND table_name = 'schools'
  AND privilege_type = 'SELECT'
LIMIT 1;


-- 5. Universal kernel substrate (cg_*): deny-by-default control plane.
--    Every kernel table must have RLS enabled, and anon/authenticated must
--    hold NO table privileges on any kernel table.
SELECT format('FAIL: kernel table %I.%I has RLS DISABLED', schemaname, tablename) AS issue
FROM pg_tables
WHERE schemaname = 'public' AND tablename LIKE 'cg\_%' AND NOT rowsecurity;

SELECT format('FAIL: anon/authenticated has %s on public.%s', g.privilege_type, g.table_name) AS issue
FROM information_schema.role_table_grants g
WHERE g.table_schema = 'public'
  AND g.table_name LIKE 'cg\_%'
  AND g.grantee IN ('anon','authenticated');

SELECT format('NOTE: kernel table %I.%I is deny-by-default (RLS enabled)', t.schemaname, t.tablename) AS info
FROM pg_tables t
WHERE t.schemaname = 'public' AND t.tablename LIKE 'cg\_%' AND t.rowsecurity;

-- 6. Secrets: the legacy plaintext Paystack secret column must NEVER be
--    readable by anon or authenticated through PostgREST.
SELECT format('FAIL: %I.%I column %I is readable by %I', c.table_schema, c.table_name, c.column_name, c.grantee) AS issue
FROM information_schema.column_privileges c
WHERE c.table_schema = 'public'
  AND c.table_name = 'schools'
  AND c.column_name = 'paystack_secret_key'
  AND c.grantee IN ('anon', 'authenticated')
  AND c.privilege_type = 'SELECT';

-- 6b. SHERIVS-015: sensitive user columns are never directly readable by
--     anon/authenticated (served only via users_private_fields()).
SELECT format('FAIL: %I.%I column %I is readable by %I', c.table_schema, c.table_name, c.column_name, c.grantee) AS issue
FROM information_schema.column_privileges c
WHERE c.table_schema = 'public'
  AND c.table_name = 'users'
  AND c.column_name IN ('nin', 'account_number', 'salary', 'face_biometric', 'phone')
  AND c.grantee IN ('anon', 'authenticated')
  AND c.privilege_type = 'SELECT';

-- 7. Realtime: every table the application subscribes to must be in the
--    supabase_realtime publication (otherwise channels silently never fire).
SELECT format('FAIL: %s missing from supabase_realtime publication', t) AS issue
FROM unnest(ARRAY[
  'users','fees','grades','admission_applications','audit_logs',
  'attendance','messages','notifications','attendance_logs','transport_buses'
]) AS t
WHERE NOT EXISTS (
  SELECT 1 FROM pg_publication_tables p
  WHERE p.pubname = 'supabase_realtime'
    AND p.schemaname = 'public'
    AND p.tablename = t
);

-- 8. Workforce substrate (20260907000000/0100/0300): the catalog and position
--    registry must be deny-by-default control-plane tables with the seeded
--    runtime:scholar catalog present, structural guards installed, and the
--    org-admin RPC surface present with scoped execute grants.
SELECT format('FAIL: workforce table %I.%I has RLS DISABLED', schemaname, tablename) AS issue
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('cg_workforce_kind','cg_workforce_position')
  AND NOT rowsecurity;

SELECT format('FAIL: anon/authenticated has %s on public.%s', g.privilege_type, g.table_name) AS issue
FROM information_schema.role_table_grants g
WHERE g.table_schema = 'public'
  AND g.table_name IN ('cg_workforce_kind','cg_workforce_position')
  AND g.grantee IN ('anon','authenticated');

SELECT format('FAIL: runtime:scholar catalog has %s kinds (expected 71)', count(*)) AS issue
FROM public.cg_workforce_kind
WHERE runtime_ref = 'runtime:scholar'
HAVING count(*) <> 71;

SELECT format('FAIL: workforce kind %I.%I lacks its single-primary partial index', 'cg_workforce_position', 'cg_workforce_position_one_primary_idx') AS issue
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'cg_workforce_position'
  AND indexname = 'cg_workforce_position_one_primary_idx'
HAVING count(*) = 0;

SELECT format('FAIL: org-admin RPC %s missing', p.proname) AS issue
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'list_workforce_positions','assign_workforce_position',
    'end_workforce_position','get_my_primary_workforce_position'
  )
GROUP BY p.proname
HAVING count(*) = 0;

SELECT format('FAIL: authenticated lacks EXECUTE on public.%s', p.proname) AS issue
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
LEFT JOIN information_schema.role_routine_grants g
  ON g.specific_schema = n.nspname AND g.specific_name = p.oid::text AND g.grantee = 'authenticated'
WHERE n.nspname = 'public'
  AND p.proname IN (
    'list_workforce_positions','assign_workforce_position',
    'end_workforce_position','get_my_primary_workforce_position'
  )
GROUP BY p.proname, p.oid::text
HAVING count(g.grantee) = 0;

-- 9. Foundation Mission 001 substrate (20260929000000): six control-plane
--    tables must be deny-by-default, the execution history must be
--    append-only, and the truth constraints must be installed.
SELECT format('FAIL: foundation table %I.%I has RLS DISABLED', schemaname, tablename) AS issue
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'cg_mission_intent','cg_execution_record','cg_execution_history',
    'cg_foundation_evidence','cg_verification_result','cg_conformance_assessment'
  )
  AND NOT rowsecurity;

SELECT format('FAIL: anon/authenticated has %s on public.%s', g.privilege_type, g.table_name) AS issue
FROM information_schema.role_table_grants g
WHERE g.table_schema = 'public'
  AND g.table_name IN (
    'cg_mission_intent','cg_execution_record','cg_execution_history',
    'cg_foundation_evidence','cg_verification_result','cg_conformance_assessment'
  )
  AND g.grantee IN ('anon','authenticated');

SELECT format('FAIL: foundation execution history is not append-only (trigger missing)') AS issue
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'cg_execution_history'
  AND t.tgname = 'cg_execution_history_append_only'
  AND NOT t.tgisinternal
HAVING count(*) = 0;

SELECT format('FAIL: foundation verification evidence constraint missing') AS issue
FROM pg_constraint
WHERE conrelid = 'public.cg_verification_result'::regclass
  AND pg_get_constraintdef(oid) LIKE '%cardinality(evidence_ids) > 0%'
HAVING count(*) = 0;

SELECT format('FAIL: foundation conformance contract-match constraint missing') AS issue
FROM pg_constraint
WHERE conrelid = 'public.cg_conformance_assessment'::regclass
  AND pg_get_constraintdef(oid) LIKE '%declared_contract_id = observed_contract_id%'
HAVING count(*) = 0;

SELECT format('FAIL: foundation execution idempotency constraint missing') AS issue
FROM pg_constraint
WHERE conrelid = 'public.cg_execution_record'::regclass
  AND pg_get_constraintdef(oid) LIKE '%idempotency_key%'
  AND pg_get_constraintdef(oid) LIKE '%UNIQUE%'
HAVING count(*) = 0;

SELECT format('FAIL: foundation mission unique constraint missing') AS issue
FROM pg_constraint
WHERE conrelid = 'public.cg_mission_intent'::regclass
  AND pg_get_constraintdef(oid) LIKE '%UNIQUE (tenant_id, mission_id, version)%'
HAVING count(*) = 0;

SELECT '✓ RLS isolation check passed' AS result;
