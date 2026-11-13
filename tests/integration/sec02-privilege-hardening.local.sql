-- SEC-02 privilege hardening contract (LOCAL disposable PostgreSQL only).
--   psql "postgresql://postgres@127.0.0.1:54329/postgres" -v ON_ERROR_STOP=1 \
--     -f tests/integration/sec02-privilege-hardening.local.sql      (run from the repository root)
-- Synthetic fixtures only; the transaction rolls back and never touches a hosted database.
-- The harness first recreates the production privilege state (Supabase default privileges give
-- anon and authenticated all table rights on new views), proves the credential view can be
-- written by a tenant administrator, applies the migration, then proves it can no longer be.
BEGIN;

DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'SEC-02: must run as a superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'SEC-02: refusing non-loopback server address %', inet_server_addr();
  END IF;
  IF to_regclass('public.org_credential_inventory') IS NULL
     OR to_regclass('public.cg_fee_invoice_balances') IS NULL
     OR to_regclass('public.cg_fee_receipt_sequence_status') IS NULL THEN
    RAISE EXCEPTION 'SEC-02: prerequisite views are missing';
  END IF;
END
$guard$;

CREATE SCHEMA s02;
GRANT USAGE ON SCHEMA s02 TO anon, authenticated, service_role;
CREATE TABLE s02.ids (name text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT ON s02.ids TO anon, authenticated, service_role;
CREATE TABLE s02.results (label text, ok boolean);
GRANT SELECT, INSERT ON s02.results TO anon, authenticated, service_role;

CREATE FUNCTION s02.login(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION s02.login_as(p_role text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
END $$;
-- Run a statement as the current role and report whether it raised insufficient_privilege.
CREATE FUNCTION s02.denied(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN true;
END $$;
CREATE FUNCTION s02.rows_affected(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
CREATE FUNCTION s02.assert_true(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'SEC-02 FAIL: %', p_label; END IF;
  RAISE NOTICE 'ok  - %', p_label;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA s02 TO anon, authenticated, service_role;

-- Fixtures (superuser). Two organisations, one administrator for org A, one ordinary user.
INSERT INTO s02.ids VALUES
  ('org_a', '00000000-0000-4000-8000-0000000000a1'),
  ('org_b', '00000000-0000-4000-8000-0000000000b1'),
  ('admin_a', '00000000-0000-4000-8000-0000000000a2'),
  ('plain', '00000000-0000-4000-8000-0000000000c3');

INSERT INTO public.cg_role_assignment (tenant_ref, identity_ref, role_id, status)
SELECT (SELECT id::text FROM s02.ids WHERE name = 'org_a'),
       (SELECT id::text FROM s02.ids WHERE name = 'admin_a'),
       'role:administrator', 'active';

INSERT INTO public.org_credentials (org_id, provider, name, ciphertext, wrapped_dek, key_version)
SELECT id, 'provider-x', 'synthetic-a', repeat('A', 40), 'wrapped-synthetic', 'v1'
  FROM s02.ids WHERE name = 'org_a';
INSERT INTO public.org_credentials (org_id, provider, name, ciphertext, wrapped_dek, key_version)
SELECT id, 'provider-x', 'synthetic-b', repeat('B', 40), 'wrapped-synthetic', 'v1'
  FROM s02.ids WHERE name = 'org_b';

-- A stand-in trigger function for the out-of-band production function (it is not in any
-- repository migration), so the revoke branch is exercised too.
CREATE FUNCTION public.schools_audit_commercial_change() RETURNS trigger LANGUAGE plpgsql
  AS $$ BEGIN RETURN NEW; END $$;

-- Recreate the production state that the audit observed.
GRANT ALL ON public.org_credential_inventory TO anon, authenticated;
GRANT ALL ON public.cg_fee_invoice_balances TO anon, authenticated;
GRANT ALL ON public.cg_fee_receipt_sequence_status TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schools_audit_commercial_change() TO PUBLIC, anon, authenticated;
ALTER FUNCTION public._a03_sem_order(text, text) RESET search_path;
ALTER FUNCTION public.touch_updated_at() RESET search_path;
ALTER FUNCTION public.ndpa_forbid_mutation() RESET search_path;

-- BEFORE: the tenant administrator can write credential rows through the view.
SELECT s02.login((SELECT id FROM s02.ids WHERE name = 'admin_a'));
SELECT s02.assert_true('before: admin A sees exactly one credential row through the view',
  (SELECT count(*) FROM public.org_credential_inventory) = 1);
SELECT s02.assert_true('before: admin A can UPDATE a credential row through the view (the defect)',
  s02.rows_affected($q$UPDATE public.org_credential_inventory SET name = 'tampered'$q$) = 1);
SELECT s02.assert_true('before: admin A can move a credential row to another organisation (the defect)',
  s02.rows_affected(format($q$UPDATE public.org_credential_inventory SET org_id = %L$q$,
    (SELECT id FROM s02.ids WHERE name = 'org_b'))) = 1);
RESET ROLE;
SELECT s02.assert_true('before: anon holds UPDATE on the fee views (excess privilege)',
  has_table_privilege('anon', 'public.cg_fee_invoice_balances', 'UPDATE'));
SELECT s02.assert_true('before: anon can execute the trigger function (excess privilege)',
  has_function_privilege('anon', 'public.schools_audit_commercial_change()', 'EXECUTE'));

-- Undo the simulated tampering so the AFTER checks start from clean fixtures.
UPDATE public.org_credentials SET name = 'synthetic-a', org_id = (SELECT id FROM s02.ids WHERE name = 'org_a')
 WHERE name = 'tampered';

-- Apply the migration twice: it must be idempotent.
\i database/supabase/migrations/20261104034500_sherivs_sec02_privilege_hardening.sql
\i database/supabase/migrations/20261104034500_sherivs_sec02_privilege_hardening.sql

-- AFTER: writes are refused for every client role.
SELECT s02.login((SELECT id FROM s02.ids WHERE name = 'admin_a'));
SELECT s02.assert_true('after: admin A UPDATE through the credential view is refused',
  s02.denied($q$UPDATE public.org_credential_inventory SET name = 'tampered'$q$));
SELECT s02.assert_true('after: admin A DELETE through the credential view is refused',
  s02.denied($q$DELETE FROM public.org_credential_inventory$q$));
SELECT s02.assert_true('after: admin A INSERT through the credential view is refused',
  s02.denied($q$INSERT INTO public.org_credential_inventory (org_id, provider, name, key_version)
                 VALUES (gen_random_uuid(), 'p', 'n', 'v1')$q$));
SELECT s02.assert_true('after: admin A still reads exactly their own organisation''s inventory',
  (SELECT count(*) FROM public.org_credential_inventory
    WHERE org_id = (SELECT id FROM s02.ids WHERE name = 'org_a')) = 1
  AND (SELECT count(*) FROM public.org_credential_inventory) = 1);
SELECT s02.assert_true('after: the ciphertext column is still not exposed by the view',
  NOT EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'org_credential_inventory'
                 AND column_name IN ('ciphertext', 'wrapped_dek')));
SELECT s02.assert_true('after: fee views are still readable by signed-in users',
  s02.denied($q$SELECT count(*) FROM public.cg_fee_invoice_balances$q$) IS NOT TRUE
  AND s02.denied($q$SELECT count(*) FROM public.cg_fee_receipt_sequence_status$q$) IS NOT TRUE);
SELECT s02.assert_true('after: signed-in users hold only SELECT on the fee views',
  NOT has_table_privilege('authenticated', 'public.cg_fee_invoice_balances', 'INSERT, UPDATE, DELETE')
  AND NOT has_table_privilege('authenticated', 'public.cg_fee_receipt_sequence_status', 'INSERT, UPDATE, DELETE')
  AND has_table_privilege('authenticated', 'public.cg_fee_invoice_balances', 'SELECT')
  AND has_table_privilege('authenticated', 'public.cg_fee_receipt_sequence_status', 'SELECT'));
RESET ROLE;

SELECT s02.login((SELECT id FROM s02.ids WHERE name = 'plain'));
SELECT s02.assert_true('after: a user with no administrator role sees no credential inventory',
  (SELECT count(*) FROM public.org_credential_inventory) = 0);
RESET ROLE;

SELECT s02.login_as('anon');
SELECT s02.assert_true('after: anon cannot read the credential view',
  s02.denied($q$SELECT 1 FROM public.org_credential_inventory$q$));
SELECT s02.assert_true('after: anon cannot read the fee views',
  s02.denied($q$SELECT 1 FROM public.cg_fee_invoice_balances$q$)
  AND s02.denied($q$SELECT 1 FROM public.cg_fee_receipt_sequence_status$q$));
SELECT s02.assert_true('after: anon holds no privilege at all on any of the three views',
  NOT has_table_privilege('anon', 'public.cg_fee_invoice_balances', 'SELECT, INSERT, UPDATE, DELETE')
  AND NOT has_table_privilege('anon', 'public.cg_fee_receipt_sequence_status', 'SELECT, INSERT, UPDATE, DELETE')
  AND NOT has_table_privilege('anon', 'public.org_credential_inventory', 'SELECT, INSERT, UPDATE, DELETE'));
SELECT s02.assert_true('after: anon and signed-in users cannot execute the trigger function',
  NOT has_function_privilege('anon', 'public.schools_audit_commercial_change()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.schools_audit_commercial_change()', 'EXECUTE'));
RESET ROLE;

SELECT s02.login_as('service_role');
SELECT s02.assert_true('after: service_role can still read the credential view',
  s02.denied($q$SELECT 1 FROM public.org_credential_inventory$q$) IS NOT TRUE);
RESET ROLE;

SELECT s02.assert_true('after: the eleven functions have search_path pinned to pg_catalog',
  (SELECT count(*) FROM pg_proc p
    WHERE p.oid IN (
      'public._a03_sem_order(text,text)'::regprocedure,
      'public.touch_updated_at()'::regprocedure,
      'public._head_console_audit_immutable()'::regprocedure,
      'public.cg_foundation_reject_history_mutation()'::regprocedure,
      'public.cg_guard_record_time_immutable()'::regprocedure,
      'public.cg_hermes_observation_append_only()'::regprocedure,
      'public.cg_delivery_evidence_forbid_mutation()'::regprocedure,
      'public.ndpa_forbid_mutation()'::regprocedure,
      'public.security_incidents_set_due()'::regprocedure,
      'public._grp_audit_append_only()'::regprocedure,
      'public._school_domain_audit_immutable()'::regprocedure)
      AND p.proconfig @> ARRAY['search_path=pg_catalog']) = 11);

SELECT s02.assert_true('after: pinned helper still returns the same value',
  public._a03_sem_order('2024/2025', 'second') = 2024 * 10 + 2);

CREATE TABLE s02.touch_probe (id int PRIMARY KEY, updated_at timestamptz NOT NULL DEFAULT '2000-01-01');
CREATE TRIGGER s02_touch BEFORE UPDATE ON s02.touch_probe
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
INSERT INTO s02.touch_probe (id) VALUES (1);
UPDATE s02.touch_probe SET id = 1;
SELECT s02.assert_true('after: pinned updated_at trigger function still fires',
  (SELECT updated_at > '2000-01-01' FROM s02.touch_probe WHERE id = 1));

CREATE TABLE s02.append_probe (id int PRIMARY KEY);
CREATE TRIGGER s02_append BEFORE UPDATE OR DELETE ON s02.append_probe
  FOR EACH ROW EXECUTE FUNCTION public.ndpa_forbid_mutation();
INSERT INTO s02.append_probe VALUES (1);
SELECT s02.assert_true('after: pinned append-only guard still blocks updates',
  s02.denied($q$UPDATE s02.append_probe SET id = 2$q$));

DO $done$ BEGIN RAISE NOTICE 'SEC02 ALL PASS'; END $done$;
ROLLBACK;
