-- =============================================================================
-- VERIFY (READ-ONLY) after apply.sql. Paste into a new SQL editor query.
-- Every row must be ok = true. This file does not write.
-- =============================================================================
SET default_transaction_read_only = on;

WITH tables(relname) AS (
  SELECT unnest(ARRAY[
    'websites','website_versions','website_block_types','website_audit',
    'exam_bodies','connector_manifests'
  ])
),
cat AS (
  SELECT t.relname, c.relrowsecurity, c.relforcerowsecurity,
         pg_get_userbyid(c.relowner) AS owner
    FROM tables t
    JOIN pg_class c ON c.oid = to_regclass('public.' || t.relname)
),
need_policy AS (
  SELECT DISTINCT r.rolname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
    JOIN pg_roles r ON r.oid = p.proowner
   WHERE p.proname IN (
           'website_public','website_save_draft','website_publish','exam_window_upsert',
           'integration_connect','integration_set_outbound','_website_data')
     AND p.prosecdef
     AND NOT r.rolsuper
     AND NOT r.rolbypassrls
),
client_write_grants AS (
  SELECT r.rolname, t.relname, p.privilege
    FROM (VALUES ('anon'), ('authenticated')) r(rolname)
    CROSS JOIN (VALUES
     ('websites'), ('website_versions'), ('website_audit'), ('website_block_types')
    ) t(relname)
    CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(privilege)
   WHERE has_table_privilege(r.rolname, format('public.%I', t.relname), p.privilege)
)
SELECT check_name, value, ok
  FROM (
    SELECT 'relforcerowsecurity on all six' AS check_name,
           (SELECT count(*) FROM cat WHERE relforcerowsecurity)::text || '/6' AS value,
           (SELECT count(*) FROM cat WHERE relrowsecurity AND relforcerowsecurity) = 6 AS ok
    UNION ALL
    SELECT 'ledger has 20261029001000',
           CASE WHEN EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261029001000')
                THEN 'recorded' ELSE 'ABSENT' END,
           EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261029001000')
    UNION ALL
    SELECT 'ledger has 20261029001100',
           CASE WHEN EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261029001100')
                THEN 'recorded' ELSE 'ABSENT' END,
           EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261029001100')
    UNION ALL
    SELECT 'ledger has 20261030000100',
           CASE WHEN EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261030000100')
                THEN 'recorded' ELSE 'ABSENT' END,
           EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261030000100')
    UNION ALL
    SELECT 'client policy ' || e.policyname || ' remains',
           COALESCE(p.cmd || ' / ' || p.roles::text, 'MISSING'),
           p.policyname IS NOT NULL
      FROM (VALUES
        ('website_block_types','website_block_types_read'),
        ('websites','websites_read'),
        ('website_versions','website_versions_read'),
        ('website_audit','website_audit_read'),
        ('exam_bodies','exam_bodies_read'),
        ('connector_manifests','connector_manifests_read')
      ) e(tablename, policyname)
      LEFT JOIN pg_policies p
        ON p.schemaname = 'public' AND p.tablename = e.tablename AND p.policyname = e.policyname
    UNION ALL
    SELECT 'anon cannot insert websites',
           has_table_privilege('anon','public.websites','INSERT')::text,
           NOT has_table_privilege('anon','public.websites','INSERT')
    UNION ALL
    SELECT 'authenticated cannot insert websites',
           has_table_privilege('authenticated','public.websites','INSERT')::text,
           NOT has_table_privilege('authenticated','public.websites','INSERT')
    UNION ALL
    SELECT 'anon can still select block types',
           has_table_privilege('anon','public.website_block_types','SELECT')::text,
           has_table_privilege('anon','public.website_block_types','SELECT')
    UNION ALL
    SELECT 'authenticated can still select exam_bodies',
           has_table_privilege('authenticated','public.exam_bodies','SELECT')::text,
           has_table_privilege('authenticated','public.exam_bodies','SELECT')
    UNION ALL
    SELECT 'authenticated can still select website_block_types',
           has_table_privilege('authenticated','public.website_block_types','SELECT')::text,
           has_table_privilege('authenticated','public.website_block_types','SELECT')
    UNION ALL
    SELECT 'authenticated can still select websites',
           has_table_privilege('authenticated','public.websites','SELECT')::text,
           has_table_privilege('authenticated','public.websites','SELECT')
    UNION ALL
    SELECT 'authenticated can still select website_versions',
           has_table_privilege('authenticated','public.website_versions','SELECT')::text,
           has_table_privilege('authenticated','public.website_versions','SELECT')
    UNION ALL
    SELECT 'authenticated can still select website_audit',
           has_table_privilege('authenticated','public.website_audit','SELECT')::text,
           has_table_privilege('authenticated','public.website_audit','SELECT')
    UNION ALL
    SELECT 'no client catalog write privileges remain',
           COALESCE((
             SELECT string_agg(
               rolname || ' ' || relname || ' ' || privilege,
               ', ' ORDER BY rolname, relname, privilege
             )
               FROM client_write_grants
           ), 'none'),
           NOT EXISTS (SELECT 1 FROM client_write_grants)
    UNION ALL
    SELECT 'no definer policy names anon/authenticated/public',
           COALESCE((
             SELECT string_agg(policyname, ', ')
               FROM pg_policies
              WHERE schemaname = 'public' AND policyname LIKE '%definer%'
                AND roles::text[] && ARRAY['anon','authenticated','public']::text[]
           ), 'none'),
           NOT EXISTS (
             SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND policyname LIKE '%definer%'
                AND roles::text[] && ARRAY['anon','authenticated','public']::text[]
           )
    UNION ALL
    SELECT 'definer policies present for non-bypass owners',
           CASE WHEN NOT EXISTS (SELECT 1 FROM need_policy) THEN 'not required (owners bypass RLS)'
                ELSE (SELECT count(*) FROM pg_policies
                       WHERE schemaname = 'public' AND policyname LIKE '%definer%')::text || ' policies'
           END,
           NOT EXISTS (SELECT 1 FROM need_policy)
           OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE '%definer%') = 9
    UNION ALL
    SELECT 'read exam_bodies as ' || current_user,
           (SELECT count(*) FROM public.exam_bodies)::text,
           (SELECT count(*) FROM public.exam_bodies) > 0
    UNION ALL
    SELECT 'read website_block_types as ' || current_user,
           (SELECT count(*) FROM public.website_block_types)::text,
           (SELECT count(*) FROM public.website_block_types) > 0
    UNION ALL
    SELECT 'read connector_manifests as ' || current_user,
           (SELECT count(*) FROM public.connector_manifests)::text,
           (SELECT count(*) FROM public.connector_manifests) > 0
    UNION ALL
    SELECT 'website_public still executable by anon',
           has_function_privilege('anon', 'public.website_public(text,text)', 'EXECUTE')::text,
           has_function_privilege('anon', 'public.website_public(text,text)', 'EXECUTE')
  ) q
 ORDER BY check_name;
