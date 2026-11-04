-- M10 register checks (LOCAL, DISPOSABLE ONLY).
-- Replay migrations on the repository's loopback disposable DB before running.
-- Never target a hosted or production database. This test always rolls back.
BEGIN;

DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'M10: must run as a superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NOT NULL
     AND NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'M10: refusing non-loopback server address %', inet_server_addr();
  END IF;
  IF to_regclass('public.ropa_processing_activities') IS NULL
     OR to_regclass('public.dpia_records') IS NULL
     OR to_regclass('public.privacy_register_audit_events') IS NULL
     OR to_regprocedure('public.privacy_dpia_save(uuid,uuid,text,text,text[],text,text[],text)') IS NULL
     OR to_regprocedure('public.dpia_approve(uuid)') IS NULL THEN
    RAISE EXCEPTION 'M10: register migration is not applied';
  END IF;
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'public.ropa_processing_activities'::regclass)
     OR NOT (SELECT relrowsecurity AND relforcerowsecurity
               FROM pg_class WHERE oid = 'public.dpia_records'::regclass)
     OR NOT (SELECT relrowsecurity AND relforcerowsecurity
               FROM pg_class WHERE oid = 'public.privacy_register_audit_events'::regclass) THEN
    RAISE EXCEPTION 'M10: both registers and audit table must have forced RLS';
  END IF;
  IF has_function_privilege('anon', 'public.dpia_approve(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.dpia_approve(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.dpia_approve(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'M10: DPIA sign-off execution is not limited to authenticated users';
  END IF;
END
$guard$;

CREATE SCHEMA m10;
GRANT USAGE ON SCHEMA m10 TO authenticated;
CREATE FUNCTION m10.login(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION m10.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE 'RESET ROLE'; END $$;
CREATE FUNCTION m10.cnt(p_label text, p_sql text, p_expected bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO n;
  IF n IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'M10 FAIL [%]: expected % rows, got %', p_label, p_expected, n;
  END IF;
END $$;
CREATE FUNCTION m10.denied(p_label text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN insufficient_privilege THEN RETURN;
  END;
  RAISE EXCEPTION 'M10 FAIL [%]: statement was allowed but must be denied', p_label;
END $$;
CREATE FUNCTION m10.invalid(p_label text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN invalid_parameter_value THEN RETURN;
  END;
  RAISE EXCEPTION 'M10 FAIL [%]: invalid input was allowed', p_label;
END $$;
CREATE TABLE m10.ids (label text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT, INSERT ON m10.ids TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA m10 TO authenticated;

INSERT INTO auth.users (id) VALUES
  ('a1000000-0000-4000-8000-000000000001'),
  ('a1000000-0000-4000-8000-000000000002'),
  ('a1000000-0000-4000-8000-000000000003'),
  ('b1000000-0000-4000-8000-000000000001'),
  ('c1000000-0000-4000-8000-000000000001');
INSERT INTO public.schools (id, name, slug) VALUES
  ('61000000-0000-4000-8000-0000000000a1', 'M10 Synthetic Organization A', 'm10-synthetic-a'),
  ('61000000-0000-4000-8000-0000000000b1', 'M10 Synthetic Organization B', 'm10-synthetic-b');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  ('a1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-0000000000a1', 'M10 Synthetic Admin A', 'm10-admin-a@example.invalid', 'admin', true),
  ('a1000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-0000000000a1', 'M10 Synthetic DPO A', 'm10-dpo-a@example.invalid', 'teacher', true),
  ('a1000000-0000-4000-8000-000000000003', '61000000-0000-4000-8000-0000000000a1', 'M10 Synthetic Staff A', 'm10-staff-a@example.invalid', 'teacher', true),
  ('b1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-0000000000b1', 'M10 Synthetic Admin B', 'm10-admin-b@example.invalid', 'admin', true);
INSERT INTO public.super_admins (id, full_name, email)
VALUES ('c1000000-0000-4000-8000-000000000001', 'M10 Synthetic Platform Admin', 'm10-platform@example.invalid');

SELECT m10.login('a1000000-0000-4000-8000-000000000001');
SELECT public.workspace_role_assignment_create(
  '61000000-0000-4000-8000-0000000000a1',
  'a1000000-0000-4000-8000-000000000002',
  'ng.data_protection_officer_dpo', 'org', NULL,
  now() - interval '1 minute', NULL, false, NULL, '{}', '{}'
);
SELECT public.workspace_role_assignment_create(
  '61000000-0000-4000-8000-0000000000a1',
  'a1000000-0000-4000-8000-000000000003',
  'ng.compliance_officer', 'org', NULL,
  now() - interval '1 minute', NULL, false, NULL, '{}', '{}'
);
INSERT INTO m10.ids VALUES (
  'dpia-a',
  public.privacy_dpia_save(
    NULL, '61000000-0000-4000-8000-0000000000a1',
    'M10 synthetic DPIA A', 'Synthetic processing activity A',
    ARRAY['Synthetic data category A'], 'medium',
    ARRAY['Synthetic risk A'], 'Synthetic mitigation A'
  )
);
SELECT public.privacy_ropa_save(
  NULL, '61000000-0000-4000-8000-0000000000a1',
  'm10.synthetic.tenant_a', 'M10 synthetic ROPA A',
  'Synthetic purpose A', ARRAY['Synthetic subject A'], ARRAY['Synthetic data A'],
  ARRAY['Synthetic recipient A'], ARRAY['Synthetic transfer A'],
  'Synthetic retention reference A', 'Synthetic security measures A'
);
SELECT m10.invalid('oversized ROPA values are rejected',
  $$SELECT public.privacy_ropa_save(
    NULL, '61000000-0000-4000-8000-0000000000a1',
    'm10.synthetic.invalid', 'M10 synthetic invalid',
    'Synthetic purpose', ARRAY[repeat('x', 501)], '{}', '{}', '{}',
    'Synthetic retention', 'Synthetic measures')$$);
SELECT m10.invalid('oversized DPIA values are rejected',
  $$SELECT public.privacy_dpia_save(
    NULL, '61000000-0000-4000-8000-0000000000a1',
    'M10 synthetic invalid DPIA', 'Synthetic processing activity',
    ARRAY[repeat('x', 501)], 'medium', '{}', 'Synthetic mitigations')$$);
SELECT m10.logout();

SELECT m10.login('b1000000-0000-4000-8000-000000000001');
INSERT INTO m10.ids VALUES (
  'dpia-b',
  public.privacy_dpia_save(
    NULL, '61000000-0000-4000-8000-0000000000b1',
    'M10 synthetic DPIA B', 'Synthetic processing activity B',
    ARRAY['Synthetic data category B'], 'low',
    ARRAY['Synthetic risk B'], 'Synthetic mitigation B'
  )
);
SELECT public.privacy_ropa_save(
  NULL, '61000000-0000-4000-8000-0000000000b1',
  'm10.synthetic.tenant_b', 'M10 synthetic ROPA B',
  'Synthetic purpose B', ARRAY['Synthetic subject B'], ARRAY['Synthetic data B'],
  ARRAY['Synthetic recipient B'], ARRAY['Synthetic transfer B'],
  'Synthetic retention reference B', 'Synthetic security measures B'
);
SELECT m10.cnt('tenant B sees only its ROPA',
  $$SELECT 1 FROM public.ropa_processing_activities
     WHERE org_id='61000000-0000-4000-8000-0000000000b1'$$, 1);
SELECT m10.cnt('tenant B cannot read tenant A ROPA',
  $$SELECT 1 FROM public.ropa_processing_activities
     WHERE org_id='61000000-0000-4000-8000-0000000000a1'$$, 0);
SELECT m10.cnt('tenant B cannot read platform ROPA',
  $$SELECT 1 FROM public.ropa_processing_activities WHERE org_id IS NULL$$, 0);
SELECT m10.cnt('tenant B sees only its DPIA',
  $$SELECT 1 FROM public.dpia_records
     WHERE school_id='61000000-0000-4000-8000-0000000000b1'$$, 1);
SELECT m10.cnt('tenant B cannot read tenant A DPIA',
  $$SELECT 1 FROM public.dpia_records
     WHERE school_id='61000000-0000-4000-8000-0000000000a1'$$, 0);
SELECT m10.logout();

SELECT m10.login('a1000000-0000-4000-8000-000000000001');
SELECT m10.denied('tenant A cannot spoof tenant B writes',
  $$SELECT public.privacy_ropa_save(
    NULL, '61000000-0000-4000-8000-0000000000b1',
    'm10.synthetic.spoof', 'M10 synthetic spoof',
    'Synthetic purpose', '{}', '{}', '{}', '{}',
    'Synthetic retention', 'Synthetic measures')$$);
SELECT m10.denied('authenticated users cannot write directly to ROPA',
  $$INSERT INTO public.ropa_processing_activities (activity_key, title, purpose, retention_reference, security_measures)
    VALUES ('m10.direct.write', 'M10 direct write', 'Synthetic purpose', 'Synthetic retention', 'Synthetic measures')$$);
SELECT m10.cnt('tenant A sees only its ROPA',
  $$SELECT 1 FROM public.ropa_processing_activities
     WHERE org_id='61000000-0000-4000-8000-0000000000a1'$$, 1);
SELECT m10.cnt('tenant A cannot read tenant B ROPA',
  $$SELECT 1 FROM public.ropa_processing_activities
     WHERE org_id='61000000-0000-4000-8000-0000000000b1'$$, 0);
SELECT m10.cnt('tenant A cannot read platform ROPA',
  $$SELECT 1 FROM public.ropa_processing_activities WHERE org_id IS NULL$$, 0);
SELECT m10.cnt('tenant A sees only its DPIA',
  $$SELECT 1 FROM public.dpia_records
     WHERE school_id='61000000-0000-4000-8000-0000000000a1'$$, 1);
SELECT m10.cnt('tenant A cannot read tenant B DPIA',
  $$SELECT 1 FROM public.dpia_records
     WHERE school_id='61000000-0000-4000-8000-0000000000b1'$$, 0);
SELECT m10.logout();

SELECT m10.login('a1000000-0000-4000-8000-000000000003');
SELECT m10.cnt('non-privacy staff cannot read tenant ROPA',
  $$SELECT 1 FROM public.ropa_processing_activities
     WHERE org_id='61000000-0000-4000-8000-0000000000a1'$$, 0);
SELECT m10.denied('non-DPO cannot sign off',
  $$SELECT public.dpia_approve((SELECT id FROM m10.ids WHERE label='dpia-a'))$$);
SELECT m10.logout();

SELECT m10.login('a1000000-0000-4000-8000-000000000002');
SELECT public.dpia_approve((SELECT id FROM m10.ids WHERE label='dpia-a'));
SELECT m10.cnt('DPO sign-off is audited',
  $$SELECT 1 FROM public.privacy_register_audit_events
     WHERE org_id='61000000-0000-4000-8000-0000000000a1'
       AND record_kind='dpia' AND action='dpia.signed_off'
       AND actor_user_id=auth.uid()$$, 1);
SELECT m10.denied('audit history is append-only',
  $$DELETE FROM public.privacy_register_audit_events WHERE action='dpia.signed_off'$$);
SELECT m10.logout();

SELECT m10.login('c1000000-0000-4000-8000-000000000001');
SELECT m10.cnt('platform admin sees seeded synthetic ROPA only',
  $$SELECT 1 FROM public.ropa_processing_activities
     WHERE org_id IS NULL AND is_synthetic
       AND owner_review_status='owner_review_required'$$, 5);
SELECT m10.cnt('platform admin cannot read tenant ROPA',
  $$SELECT 1 FROM public.ropa_processing_activities WHERE org_id IS NOT NULL$$, 0);
SELECT m10.cnt('platform export is audited',
  $$SELECT 1
      FROM jsonb_array_elements(public.privacy_register_export(NULL)->'ropa') e$$, 5);
SELECT m10.cnt('platform export audit event is recorded',
  $$SELECT 1 FROM public.privacy_register_audit_events
     WHERE org_id IS NULL AND record_kind='register'
       AND action='register.exported' AND actor_user_id=auth.uid()$$, 1);
SELECT m10.logout();

DO $$ BEGIN RAISE NOTICE 'M10 ALL PASS'; END $$;
ROLLBACK;
