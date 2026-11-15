-- DB-12 contract (LOCAL disposable PostgreSQL only).
--   psql "postgresql://postgres@127.0.0.1:54329/postgres" -v ON_ERROR_STOP=1 \
--     -f tests/integration/db12-flags-pk-and-index.local.sql      (run from the repository root)
-- Synthetic fixtures only; the transaction rolls back and never touches a hosted database.
-- The harness first rolls the migration back to recreate the audited production structure,
-- proves the defects, applies the migration twice (idempotence), then proves the fix and that
-- flag behaviour is unchanged. It also proves the index drop refuses a non-identical index.
BEGIN;

DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'DB-12: must run as a superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'DB-12: refusing non-loopback server address %', inet_server_addr();
  END IF;
  IF to_regclass('public.feature_flags') IS NULL OR to_regclass('public.teacher_biometrics') IS NULL THEN
    RAISE EXCEPTION 'DB-12: prerequisite tables are missing';
  END IF;
END
$guard$;

CREATE SCHEMA d12;
CREATE TABLE d12.results (label text, ok boolean);
CREATE FUNCTION d12.assert_true(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'DB-12 FAIL: %', p_label; END IF;
  RAISE NOTICE 'ok  - %', p_label;
END $$;
CREATE FUNCTION d12.denied(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END $$;
CREATE FUNCTION d12.index_count() RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'teacher_biometrics'
     AND indexname IN ('idx_biometrics_user', 'idx_teacher_biometrics_user')
$$;

-- Recreate the audited production structure (the full replay already applied the migration).
\i database/supabase/rollbacks/20261105000200_sherivs_db12_flags_pk_and_duplicate_index.sql

SELECT d12.assert_true('before: feature_flags has no primary key',
  NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.feature_flags'::regclass AND contype = 'p'));
SELECT d12.assert_true('before: feature_flags has no id column',
  NOT EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'feature_flags' AND column_name = 'id'));
SELECT d12.assert_true('before: teacher_biometrics carries both identical indexes', d12.index_count() = 2);

-- Behaviour baseline that must survive the change.
INSERT INTO public.schools (name, slug) VALUES ('Synthetic School A', 'synthetic-school-a-d12');
CREATE TEMP TABLE d12_school AS SELECT id FROM public.schools WHERE slug = 'synthetic-school-a-d12';
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT public.flag_set('sentry', (SELECT id FROM d12_school), false);
SELECT d12.assert_true('before: org flag override is honoured by flag_on',
  public.flag_on('sentry', (SELECT id FROM d12_school)) = false AND public.flag_on('sentry') = true);
CREATE TEMP TABLE d12_flag_rows AS SELECT key, org_id, enabled, locked FROM public.feature_flags;
CREATE TEMP TABLE d12_trig AS
  SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'public.feature_flags'::regclass AND NOT tgisinternal;
CREATE TEMP TABLE d12_acl AS
  SELECT relrowsecurity, relforcerowsecurity, relacl::text AS acl FROM pg_class WHERE oid = 'public.feature_flags'::regclass;
CREATE TEMP TABLE d12_pol AS
  SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS q FROM pg_policy WHERE polrelid = 'public.feature_flags'::regclass;

\i database/supabase/migrations/20261105000200_sherivs_db12_flags_pk_and_duplicate_index.sql
\i database/supabase/migrations/20261105000200_sherivs_db12_flags_pk_and_duplicate_index.sql

SELECT d12.assert_true('after: feature_flags_pkey is the primary key on id',
  EXISTS (SELECT 1 FROM pg_constraint c
           WHERE c.conrelid = 'public.feature_flags'::regclass AND c.contype = 'p'
             AND c.conname = 'feature_flags_pkey'
             AND (SELECT array_agg(a.attname::text) FROM pg_attribute a
                   WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) = ARRAY['id']));
SELECT d12.assert_true('after: every existing flag row received a distinct non-null id',
  (SELECT count(*) = count(DISTINCT id) AND count(id) = count(*) FROM public.feature_flags));
SELECT d12.assert_true('after: exactly one primary key exists after applying twice',
  (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.feature_flags'::regclass AND contype = 'p') = 1);
SELECT d12.assert_true('after: the (key, org) uniqueness rule is still in place',
  to_regclass('public.feature_flags_scope') IS NOT NULL
  AND (SELECT indisunique FROM pg_index WHERE indexrelid = 'public.feature_flags_scope'::regclass));
SELECT d12.assert_true('after: a duplicate platform-wide flag is still refused',
  d12.denied($q$INSERT INTO public.feature_flags (key, enabled) VALUES ('sentry', true)$q$) = '23505');
SELECT d12.assert_true('after: a duplicate org override is still refused',
  d12.denied(format($q$INSERT INTO public.feature_flags (key, org_id, enabled) VALUES ('sentry', %L, true)$q$,
    (SELECT id FROM d12_school))) = '23505');
SELECT d12.assert_true('after: flag rows are unchanged apart from the new id column',
  (SELECT count(*) FROM (
     (SELECT key, org_id, enabled, locked FROM public.feature_flags EXCEPT SELECT * FROM d12_flag_rows)
     UNION ALL
     (SELECT * FROM d12_flag_rows EXCEPT SELECT key, org_id, enabled, locked FROM public.feature_flags)) d) = 0);
SELECT public.flag_set('sentry', (SELECT id FROM d12_school), true);
SELECT d12.assert_true('after: flag_set (ON CONFLICT on the scope index) and flag_on still work',
  public.flag_on('sentry', (SELECT id FROM d12_school)) = true);
SELECT d12.assert_true('after: the same three triggers are enabled',
  (SELECT count(*) FROM (
     (SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'public.feature_flags'::regclass AND NOT tgisinternal
      EXCEPT SELECT * FROM d12_trig)
     UNION ALL
     (SELECT * FROM d12_trig
      EXCEPT SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'public.feature_flags'::regclass AND NOT tgisinternal)) d) = 0
  AND (SELECT count(*) FROM d12_trig) = 3);
SELECT d12.assert_true('after: row level security, grants and policies are unchanged',
  (SELECT relrowsecurity AND relforcerowsecurity AND acl IS NOT DISTINCT FROM
          (SELECT relacl::text FROM pg_class WHERE oid = 'public.feature_flags'::regclass)
     FROM d12_acl)
  AND NOT EXISTS (
     (SELECT polname, polcmd, pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polrelid = 'public.feature_flags'::regclass
      EXCEPT SELECT * FROM d12_pol)
     UNION ALL
     (SELECT * FROM d12_pol
      EXCEPT SELECT polname, polcmd, pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polrelid = 'public.feature_flags'::regclass)));
SELECT d12.assert_true('after: only the descriptive index remains on teacher_biometrics',
  d12.index_count() = 1 AND to_regclass('public.idx_teacher_biometrics_user') IS NOT NULL
  AND to_regclass('public.idx_biometrics_user') IS NULL);
SELECT d12.assert_true('after: the kept index still covers (user_id, school_id)',
  (SELECT pg_get_indexdef('public.idx_teacher_biometrics_user'::regclass)) LIKE '%(user_id, school_id)%');

-- Safety branch: a non-identical index must never be dropped.
DROP INDEX public.idx_teacher_biometrics_user;
CREATE INDEX idx_teacher_biometrics_user ON public.teacher_biometrics (user_id);
CREATE INDEX idx_biometrics_user ON public.teacher_biometrics (user_id, school_id);
\i database/supabase/migrations/20261105000200_sherivs_db12_flags_pk_and_duplicate_index.sql
SELECT d12.assert_true('guard: differently defined indexes are both kept', d12.index_count() = 2);
DROP INDEX public.idx_biometrics_user;
DROP INDEX public.idx_teacher_biometrics_user;
-- Same columns and operator classes in a different order is a different index, so it is kept.
CREATE INDEX idx_teacher_biometrics_user ON public.teacher_biometrics (school_id, user_id);
CREATE INDEX idx_biometrics_user ON public.teacher_biometrics (user_id, school_id);
\i database/supabase/migrations/20261105000200_sherivs_db12_flags_pk_and_duplicate_index.sql
SELECT d12.assert_true('guard: same columns in a different order are both kept', d12.index_count() = 2);
DROP INDEX public.idx_biometrics_user;
DROP INDEX public.idx_teacher_biometrics_user;
CREATE INDEX idx_teacher_biometrics_user ON public.teacher_biometrics (user_id, school_id);

-- Rollback round trip.
\i database/supabase/rollbacks/20261105000200_sherivs_db12_flags_pk_and_duplicate_index.sql
SELECT d12.assert_true('rollback: primary key and id are gone, scope rule intact, index restored',
  NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.feature_flags'::regclass AND contype = 'p')
  AND to_regclass('public.feature_flags_scope') IS NOT NULL AND d12.index_count() = 2);
\i database/supabase/rollbacks/20261105000200_sherivs_db12_flags_pk_and_duplicate_index.sql
SELECT d12.assert_true('rollback: running it twice is harmless', d12.index_count() = 2);
\i database/supabase/migrations/20261105000200_sherivs_db12_flags_pk_and_duplicate_index.sql
SELECT d12.assert_true('roll forward again: fixed state restored',
  d12.index_count() = 1
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.feature_flags'::regclass AND contype = 'p'));

DO $done$ BEGIN RAISE NOTICE 'DB12 ALL PASS'; END $done$;
ROLLBACK;
