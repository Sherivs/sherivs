-- =============================================================================
-- SHERIVS rollout POST-DEPLOY VERIFICATION (READ-ONLY). Run in the SQL Editor after
-- each step. Set the step on the line below: 0 = after Step 0 (ledger repair +
-- Paystack fix), 1 = after Step 1 (SHERIVS db push). Every row must show ok = true.
-- Any false = STOP and use the rollback section of docs/ops/ROLLOUT-SHERIVS-001-005.md.
-- =============================================================================
WITH params AS (SELECT 0 AS step),  -- <<< change to 1 after Step 1
p AS (SELECT step FROM params),
checks(name, ok) AS (
  VALUES
  ('ledger has the 70 baseline versions (through 20261003000042)',
     (SELECT count(*) = 70 FROM supabase_migrations.schema_migrations WHERE version <= '20261003000042')),
  ('Paystack fix 20261015000005 recorded',
     EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261015000005')),
  ('paystack_secret_key hidden from anon',
     NOT coalesce(has_column_privilege('anon','public.schools','paystack_secret_key','SELECT'), false)),
  ('paystack_secret_key hidden from authenticated',
     NOT coalesce(has_column_privilege('authenticated','public.schools','paystack_secret_key','SELECT'), false)),
  ('anon can still read the public school columns (website)',
     has_column_privilege('anon','public.schools','name','SELECT') AND has_column_privilege('anon','public.schools','slug','SELECT')),
  ('identity freeze NOT applied (separate decision)',
     NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261015000010')),
  ('9 SHERIVS release migrations recorded iff step >= 1',
     ((SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN
       ('20261020000020','20261020000030','20261020000040','20261020000050',
        '20261020000060','20261020000070','20261020000090','20261020000100','20261020000110'))
      = CASE WHEN (SELECT step FROM p) >= 1 THEN 9 ELSE 0 END)),
  ('cg_idempotency_record RLS on',
     (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.cg_idempotency_record'::regclass)),
  ('website RPCs still public',
     (SELECT bool_and(has_function_privilege('anon', pr.oid, 'EXECUTE')) FROM pg_proc pr JOIN pg_namespace n ON n.oid=pr.pronamespace
       WHERE n.nspname='public' AND pr.proname IN ('public_school_stats','public_teachers'))),
  ('every public table has RLS',
     NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity)),
  -- Step 1 checks (vacuously true at step 0)
  ('[step 1] NDPA tables exist',
     (SELECT step FROM p) < 1 OR (to_regclass('public.consent_records') IS NOT NULL AND to_regclass('public.data_subject_requests') IS NOT NULL
     AND to_regclass('public.security_incidents') IS NOT NULL)),
  ('[step 1] school_tenant_map backfilled (one row per school that has a cg_tenant)',
     (SELECT step FROM p) < 1 OR (to_regclass('public.school_tenant_map') IS NOT NULL AND
     (SELECT (xpath('/row/c/text()', query_to_xml('SELECT (SELECT count(*) FROM public.school_tenant_map) = (SELECT count(*) FROM public.cg_tenant t JOIN public.schools s ON s.id = t.id) AS c', false, false, '')))[1]::text = 'true'))),
  ('[step 1] old school-wide fees/students policies gone',
     (SELECT step FROM p) < 1 OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND policyname IN ('tenant_all_fees','tenant_all_students','platform_fee_ledger_school_access'))),
  ('[step 1] new fees/students policies present',
     (SELECT step FROM p) < 1 OR (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname IN ('fees_read','fees_write','students_read','students_write')) = 4),
  ('[step 1] restrictive write policies on 37 tables',
     (SELECT step FROM p) < 1 OR (SELECT count(DISTINCT tablename) FROM pg_policies WHERE schemaname='public' AND policyname='sv4_insert_role' AND permissive='RESTRICTIVE') = 37),
  ('[step 1] no TRUNCATE for anon/authenticated',
     (SELECT step FROM p) < 1 OR NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee IN ('anon','authenticated') AND privilege_type='TRUNCATE')),
  ('[step 1] anon can still submit admissions',
     (SELECT step FROM p) < 1 OR has_table_privilege('anon','public.admission_applications','INSERT')),
  ('[step 1] anon cannot write fees/students/users',
     (SELECT step FROM p) < 1 OR NOT (has_table_privilege('anon','public.fees','UPDATE') OR has_table_privilege('anon','public.students','UPDATE') OR has_table_privilege('anon','public.users','UPDATE'))),
  ('[step 1] no USING(true) policies in public',
     (SELECT step FROM p) < 1 OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND (qual='true' OR with_check='true')))
)
SELECT name, coalesce(ok, false) AS ok FROM checks ORDER BY ok, name;
