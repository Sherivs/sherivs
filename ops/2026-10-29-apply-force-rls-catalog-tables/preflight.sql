-- =============================================================================
-- PREFLIGHT (READ-ONLY) for FORCE RLS on the six catalogs and client write grants.
-- Paste into the Supabase SQL editor for production. Run this file alone, in
-- its own query. It changes nothing.
--
-- Result: one grid, check_name / value / ok. Every row in section Z must be
-- ok = true before apply.sql. Current client write grants appear in section Z
-- as a report of what the companion migration will revoke. Section F is
-- informational: force_alone_safe is true only when every affected SECURITY
-- DEFINER owner already bypasses RLS. The combined apply.sql is the path to use.
-- =============================================================================
SET default_transaction_read_only = on;

WITH tables(relname) AS (
  SELECT unnest(ARRAY[
    'websites','website_versions','website_block_types','website_audit',
    'exam_bodies','connector_manifests'
  ])
),
funcs(proname) AS (
  SELECT unnest(ARRAY[
    '_website_validate','_website_data','website_public','website_get',
    'website_save_draft','website_publish','website_rollback',
    'exam_window_upsert','exam_candidate_register',
    'integration_connect','integration_set_outbound'
  ])
),
cat AS (
  SELECT t.relname,
         to_regclass('public.' || t.relname) AS reg,
         c.relrowsecurity,
         c.relforcerowsecurity,
         pg_get_userbyid(c.relowner) AS owner
    FROM tables t
    LEFT JOIN pg_class c
      ON c.oid = to_regclass('public.' || t.relname)
),
fn AS (
  SELECT f.proname,
         p.oid IS NOT NULL AS present,
         p.prosecdef,
         pg_get_userbyid(p.proowner) AS owner,
         r.rolsuper,
         r.rolbypassrls
    FROM funcs f
    LEFT JOIN LATERAL (
      SELECT p.oid, p.prosecdef, p.proowner
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
       WHERE p.proname = f.proname
       ORDER BY p.oid
       LIMIT 1
    ) p ON true
    LEFT JOIN pg_roles r ON r.oid = p.proowner
),
ledger AS (
  SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS present
),
ledger_rows AS (
  SELECT x.version
    FROM xmltable('/table/row' PASSING query_to_xml(
           CASE WHEN (SELECT present FROM ledger)
                THEN 'SELECT version FROM supabase_migrations.schema_migrations'
                ELSE 'SELECT NULL::text AS version WHERE false' END,
           false, false, '')
         COLUMNS version text) x
),
ledger_hit AS (
  SELECT v.version,
         CASE WHEN NOT (SELECT present FROM ledger) THEN NULL
              ELSE EXISTS (SELECT 1 FROM ledger_rows s WHERE s.version = v.version)
         END AS applied
    FROM (VALUES
      ('20261029001000'), ('20261029001100'), ('20261030000100')
    ) v(version)
),
client_write_grants AS (
  SELECT r.rolname, t.relname, p.privilege
    FROM (VALUES ('anon'), ('authenticated')) r(rolname)
    CROSS JOIN (VALUES
      ('websites'), ('website_versions'), ('website_audit'), ('website_block_types')
    ) t(relname)
    CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(privilege)
   WHERE has_table_privilege(r.rolname, format('public.%I', t.relname), p.privilege)
),
owners AS (
  SELECT DISTINCT fn.owner, fn.rolsuper, fn.rolbypassrls
    FROM fn
   WHERE fn.prosecdef
     AND fn.owner IS NOT NULL
)
SELECT section, check_name, value, ok
  FROM (
    SELECT 'A' AS section, 'session user' AS check_name, current_user AS value, true AS ok
    UNION ALL
    SELECT 'A', 'session is superuser', r.rolsuper::text, true
      FROM pg_roles r WHERE r.rolname = current_user
    UNION ALL
    SELECT 'A', 'session bypasses RLS', r.rolbypassrls::text, true
      FROM pg_roles r WHERE r.rolname = current_user
    UNION ALL
    SELECT 'B', 'table ' || relname,
           CASE WHEN reg IS NULL THEN 'MISSING'
                ELSE 'owner=' || owner
                  || ' relrowsecurity=' || relrowsecurity::text
                  || ' relforcerowsecurity=' || relforcerowsecurity::text
           END,
           reg IS NOT NULL
      FROM cat
    UNION ALL
    SELECT 'C', 'function ' || proname,
           CASE WHEN NOT present THEN 'MISSING'
                ELSE 'secdef=' || prosecdef::text
                  || ' owner=' || owner
                  || ' rolsuper=' || rolsuper::text
                  || ' rolbypassrls=' || rolbypassrls::text
           END,
           present
      FROM fn
    UNION ALL
    SELECT 'C', 'scholar_can(uuid,text)',
           CASE WHEN to_regprocedure('public.scholar_can(uuid,text)') IS NULL THEN 'MISSING' ELSE 'present' END,
           to_regprocedure('public.scholar_can(uuid,text)') IS NOT NULL
    UNION ALL
    SELECT 'D', 'role ' || r.rolname,
           'rolsuper=' || r.rolsuper::text || ' rolbypassrls=' || r.rolbypassrls::text,
           true
      FROM pg_roles r
     WHERE r.rolname IN ('postgres','service_role','supabase_admin','authenticator')
    UNION ALL
    SELECT 'D', 'policy ' || tablename || ' ' || policyname,
           cmd || ' / ' || roles::text,
           true
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN (
         'websites','website_versions','website_block_types','website_audit',
         'exam_bodies','connector_manifests')
    UNION ALL
    SELECT 'E', 'ledger',
           CASE WHEN (SELECT present FROM ledger) THEN 'present' ELSE 'ABSENT' END,
           (SELECT present FROM ledger)
    UNION ALL
    SELECT 'E', 'ledger version ' || version,
           CASE WHEN applied IS NULL THEN 'no ledger'
                WHEN applied THEN 'ALREADY APPLIED'
                ELSE 'not applied' END,
           applied IS FALSE
      FROM ledger_hit
    UNION ALL
    SELECT 'F', 'force_alone_safe',
           CASE
             WHEN EXISTS (SELECT 1 FROM fn WHERE prosecdef AND NOT coalesce(rolsuper, false) AND NOT coalesce(rolbypassrls, false))
               THEN 'NO — at least one SECURITY DEFINER owner lacks superuser and BYPASSRLS; do not apply 20261029001000 by itself'
             WHEN EXISTS (SELECT 1 FROM fn WHERE prosecdef)
               THEN 'YES — every affected SECURITY DEFINER owner bypasses RLS'
             ELSE 'NO — affected functions were not found'
           END,
           NOT EXISTS (
             SELECT 1 FROM fn
              WHERE prosecdef
                AND NOT coalesce(rolsuper, false)
                AND NOT coalesce(rolbypassrls, false)
           )
           AND EXISTS (SELECT 1 FROM fn WHERE prosecdef)
    UNION ALL
    SELECT 'Z', 'all six tables exist',
           (SELECT count(*) FROM cat WHERE reg IS NOT NULL)::text || '/6',
           (SELECT count(*) FROM cat WHERE reg IS NOT NULL) = 6
    UNION ALL
    SELECT 'Z', 'RLS already enabled on all six',
           (SELECT count(*) FROM cat WHERE coalesce(relrowsecurity, false))::text || '/6',
           (SELECT count(*) FROM cat WHERE coalesce(relrowsecurity, false)) = 6
    UNION ALL
    SELECT 'Z', 'FORCE not yet applied',
           (SELECT count(*) FROM cat WHERE coalesce(relforcerowsecurity, true))::text || ' still forced',
           (SELECT count(*) FROM cat WHERE reg IS NOT NULL AND NOT coalesce(relforcerowsecurity, true)) = 6
    UNION ALL
    SELECT 'Z', 'functions present',
           (SELECT count(*) FROM fn WHERE present)::text || '/11',
           (SELECT count(*) FROM fn WHERE present) = 11
    UNION ALL
    SELECT 'Z', 'ledger ready and versions absent',
           CASE WHEN NOT (SELECT present FROM ledger) THEN 'ledger missing'
                WHEN EXISTS (SELECT 1 FROM ledger_hit WHERE applied) THEN 'version already recorded'
                ELSE 'ready' END,
           (SELECT present FROM ledger)
           AND NOT EXISTS (SELECT 1 FROM ledger_hit WHERE applied)
    UNION ALL
    SELECT 'Z', 'current client write grants',
           COALESCE((
            SELECT string_agg(
              rolname || ' ' || relname || ' ' || privilege,
              ', ' ORDER BY rolname, relname, privilege
            )
              FROM client_write_grants
           ), 'none'),
           true
    UNION ALL
    SELECT 'Z', 'combined_apply_safe',
           CASE
             WHEN (SELECT count(*) FROM cat WHERE reg IS NOT NULL) < 6 THEN 'NO — table missing'
             WHEN (SELECT count(*) FROM cat WHERE coalesce(relrowsecurity, false)) < 6 THEN 'NO — RLS not enabled'
             WHEN (SELECT count(*) FROM cat WHERE reg IS NOT NULL AND NOT coalesce(relforcerowsecurity, true)) < 6 THEN 'NO — already forced'
             WHEN (SELECT count(*) FROM fn WHERE present) < 11 THEN 'NO — function missing'
             WHEN to_regprocedure('public.scholar_can(uuid,text)') IS NULL THEN 'NO — scholar_can missing'
             WHEN NOT (SELECT present FROM ledger) THEN 'NO — ledger missing'
             WHEN EXISTS (SELECT 1 FROM ledger_hit WHERE applied) THEN 'NO — version already recorded'
             ELSE 'YES — paste apply.sql'
           END,
           (SELECT count(*) FROM cat WHERE reg IS NOT NULL) = 6
           AND (SELECT count(*) FROM cat WHERE coalesce(relrowsecurity, false)) = 6
           AND (SELECT count(*) FROM cat WHERE reg IS NOT NULL AND NOT coalesce(relforcerowsecurity, true)) = 6
           AND (SELECT count(*) FROM fn WHERE present) = 11
           AND to_regprocedure('public.scholar_can(uuid,text)') IS NOT NULL
           AND (SELECT present FROM ledger)
           AND NOT EXISTS (SELECT 1 FROM ledger_hit WHERE applied)
  ) q
 ORDER BY section, check_name;
