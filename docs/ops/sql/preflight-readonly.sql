-- =============================================================================
-- SHERIVS rollout PRE-FLIGHT (READ-ONLY). Paste into Supabase Dashboard -> SQL Editor
-- for project nwrflbpbhyiqdptmlccm and click Run. It changes nothing; every
-- statement is a SELECT. The result is ONE table (section | item | value); export it
-- as CSV and share it. It contains no secrets (key values are never selected).
-- Works with or without a migration ledger: production had NO ledger on 2026-10-20,
-- so the ledger is read through query_to_xml (evaluated only when the table exists).
-- =============================================================================
WITH
has_ledger AS (
  SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS ok
),
ledger AS (
  SELECT x.version, x.name
    FROM xmltable('/table/row' PASSING query_to_xml(
           CASE WHEN (SELECT ok FROM has_ledger)
                THEN 'SELECT version, coalesce(name, '''') AS name FROM supabase_migrations.schema_migrations'
                ELSE 'SELECT NULL::text AS version, NULL::text AS name WHERE false' END,
           false, false, '')
         COLUMNS version text, name text) x
),
mig AS (
  SELECT 'A. applied migrations' AS section, version AS item, name AS value FROM ledger
),
mig_count AS (
  SELECT 'A0. migration ledger', 'supabase_migrations.schema_migrations',
         CASE WHEN (SELECT ok FROM has_ledger)
              THEN 'present: ' || (SELECT count(*) FROM ledger)::text || ' rows / last '
                   || coalesce((SELECT max(version) FROM ledger), 'none')
              ELSE 'ABSENT (run docs/ops/sql/ledger-repair.sql before any db push)' END
),
release AS (
  SELECT 'B. release migrations present?', v,
         CASE WHEN EXISTS (SELECT 1 FROM ledger l WHERE l.version = v) THEN 'APPLIED'
              WHEN NOT (SELECT ok FROM has_ledger) THEN 'no ledger'
              ELSE 'not applied' END
    FROM unnest(ARRAY['20261003000042','20261015000005','20261015000010','20261020000020',
                      '20261020000030','20261020000040','20261020000050','20261020000060',
                      '20261020000070','20261020000090','20261020000100','20261020000110']) v
),
objs AS (
  SELECT 'C. objects', o,
         CASE WHEN to_regclass(o) IS NOT NULL OR to_regprocedure(o) IS NOT NULL THEN 'exists' ELSE 'missing' END
    FROM unnest(ARRAY['public.consent_records','public.data_subject_requests','public.security_incidents',
                      'public.school_tenant_map','public.can_manage_admissions()','public.my_active_role()',
                      'public.is_linked_to_student(uuid)','public.retention_dry_run()',
                      'public.organization_memberships','public.cg_api_key','public.cg_org_communication_sender',
                      'public.get_my_memberships()']) o
),
pol AS (
  SELECT 'D. policies on key tables', tablename || ' :: ' || policyname,
         cmd || ' / ' || array_to_string(roles, ',') || CASE WHEN permissive = 'RESTRICTIVE' THEN ' / RESTRICTIVE' ELSE '' END
    FROM pg_policies
   WHERE schemaname IN ('public','storage')
     AND tablename IN ('fees','students','users','admission_applications','parent_student_map',
                       'student_platform_fee_ledger','schools','cg_idempotency_record','objects')
),
rls AS (
  SELECT 'E. tables WITHOUT RLS (public)', c.relname, 'rls off'
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
),
grants AS (
  SELECT 'F. risky grants', grantee || ' ' || privilege_type, count(*)::text || ' tables'
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND grantee IN ('anon','authenticated')
     AND privilege_type IN ('TRUNCATE','INSERT','UPDATE','DELETE')
   GROUP BY grantee, privilege_type
),
secret_col AS (
  SELECT 'G. schools.paystack_secret_key readable by', r,
         CASE WHEN has_column_privilege(r, 'public.schools', 'paystack_secret_key', 'SELECT') THEN 'YES (exposed)' ELSE 'no' END
    FROM unnest(ARRAY['anon','authenticated']) r
   WHERE EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='schools' AND column_name='paystack_secret_key')
),
sizes AS (
  SELECT 'H. row counts (lock planning)', relname, n_live_tup::text
    FROM pg_stat_user_tables
   WHERE schemaname = 'public'
     AND relname IN ('fees','students','users','admission_applications','attendance','parent_student_map','grades')
),
roles AS (
  SELECT 'I. users by role', coalesce(role,'(null)'), count(*)::text FROM public.users GROUP BY role
)
SELECT * FROM mig_count UNION ALL SELECT * FROM release UNION ALL SELECT * FROM objs
UNION ALL SELECT * FROM secret_col UNION ALL SELECT * FROM grants UNION ALL SELECT * FROM rls
UNION ALL SELECT * FROM sizes UNION ALL SELECT * FROM roles UNION ALL SELECT * FROM pol
UNION ALL SELECT * FROM mig
ORDER BY 1, 2;
