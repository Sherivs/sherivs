-- M04 tenant and authority-link checks (LOCAL, DISPOSABLE ONLY).
-- Run only after replaying repository migrations on a loopback disposable DB:
--   psql "postgresql://supabase_admin@127.0.0.1:<port>/postgres" \
--     -v ON_ERROR_STOP=1 -f tests/integration/m04-tenant-authority.local.sql
-- The transaction is rolled back; no live database is used.
BEGIN;

DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'M04: must run as a superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NOT NULL
     AND NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'M04: refusing non-loopback server address %', inet_server_addr();
  END IF;
  IF to_regclass('public.institution_authority_links') IS NULL
     OR to_regclass('public.institution_authority_link_audit') IS NULL
     OR to_regprocedure('public.read_my_tenant_hierarchy()') IS NULL THEN
    RAISE EXCEPTION 'M04: tenant-authority migration is not applied';
  END IF;
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'public.institution_authority_links'::regclass)
     OR NOT (SELECT relrowsecurity AND relforcerowsecurity
               FROM pg_class WHERE oid = 'public.institution_authority_link_audit'::regclass) THEN
    RAISE EXCEPTION 'M04: authority-link tables must have RLS enabled and forced';
  END IF;
END
$guard$;

CREATE SCHEMA m04;
GRANT USAGE ON SCHEMA m04 TO authenticated;

CREATE FUNCTION m04.login(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION m04.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE 'RESET ROLE'; END $$;
CREATE FUNCTION m04.cnt(p_label text, p_sql text, p_expected bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO n;
  IF n IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'M04 FAIL [%]: expected % rows, got %', p_label, p_expected, n;
  END IF;
END $$;
CREATE FUNCTION m04.denied(p_label text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN insufficient_privilege THEN RETURN;
  END;
  RAISE EXCEPTION 'M04 FAIL [%]: statement was allowed but must be denied', p_label;
END $$;
CREATE FUNCTION m04.rejects_check_violation(p_label text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN check_violation THEN RETURN;
  END;
  RAISE EXCEPTION 'M04 FAIL [%]: statement did not fail its evidence constraint', p_label;
END $$;
CREATE TABLE m04.authority_link_ids (label text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT, INSERT ON m04.authority_link_ids TO authenticated;
CREATE TABLE m04.verification_stamps (
  id uuid PRIMARY KEY,
  verified_by uuid NOT NULL,
  verified_at timestamptz NOT NULL
);
GRANT SELECT, INSERT ON m04.verification_stamps TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA m04 TO authenticated;

INSERT INTO auth.users (id) VALUES
  ('a4000000-0000-4000-8000-000000000001'),
  ('a4000000-0000-4000-8000-000000000002'),
  ('b4000000-0000-4000-8000-000000000001');
INSERT INTO public.schools (id, name, slug) VALUES
  ('54000000-0000-4000-8000-0000000000a1', 'M04 Synthetic Organization A', 'm04-synthetic-org-a'),
  ('54000000-0000-4000-8000-0000000000b1', 'M04 Synthetic Organization B', 'm04-synthetic-org-b');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  ('a4000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-0000000000a1','M04 Synthetic Admin A','m04-admin-a@example.invalid','admin',true),
  ('a4000000-0000-4000-8000-000000000002','54000000-0000-4000-8000-0000000000a1','M04 Synthetic Member A','m04-member-a@example.invalid','teacher',true),
  ('b4000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-0000000000b1','M04 Synthetic Admin B','m04-admin-b@example.invalid','admin',true);

INSERT INTO public.campuses (id, school_id, name, code) VALUES
  ('54000000-0000-4000-8000-0000000000a2','54000000-0000-4000-8000-0000000000a1','M04 Synthetic Campus A','m04-a'),
  ('54000000-0000-4000-8000-0000000000b2','54000000-0000-4000-8000-0000000000b1','M04 Synthetic Campus B','m04-b');
INSERT INTO public.school_shifts (id, school_id, campus_id, name, kind) VALUES
  ('54000000-0000-4000-8000-0000000000a3','54000000-0000-4000-8000-0000000000a1','54000000-0000-4000-8000-0000000000a2','M04 Synthetic Shift A','morning'),
  ('54000000-0000-4000-8000-0000000000b3','54000000-0000-4000-8000-0000000000b1','54000000-0000-4000-8000-0000000000b2','M04 Synthetic Shift B','afternoon');

DO $cross_tenant_parent$
BEGIN
  BEGIN
    INSERT INTO public.school_shifts (id, school_id, campus_id, name, kind)
    VALUES (
      '54000000-0000-4000-8000-0000000000b4',
      '54000000-0000-4000-8000-0000000000b1',
      '54000000-0000-4000-8000-0000000000a2',
      'M04 Invalid Cross-Tenant Shift',
      'morning'
    );
  EXCEPTION WHEN foreign_key_violation THEN
    RETURN;
  END;
  RAISE EXCEPTION 'M04 FAIL [shift cannot reference another tenant campus]';
END
$cross_tenant_parent$;

INSERT INTO public.role_templates (code, default_scope, data_sensitivity, approval_limit_ngn, guardrails)
VALUES ('m04_test_reader','org','internal',NULL,ARRAY['tenant_isolation']::text[]);
INSERT INTO public.role_catalog (code, name, category, template_code, institution_types)
VALUES ('m04_test_reader','M04 Test Reader','test','m04_test_reader','{}');

SELECT m04.login('b4000000-0000-4000-8000-000000000001');
DO $authority_link_b$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.institution_authority_links (
    school_id, authority_name, source, verification_status
  ) VALUES (
    '54000000-0000-4000-8000-0000000000b1',
    'M04 Synthetic Authority Candidate B',
    'M04 disposable synthetic fixture',
    'unverified'
  ) RETURNING id INTO v_id;
  INSERT INTO m04.authority_link_ids VALUES ('candidate-b', v_id);
END
$authority_link_b$;
SELECT m04.logout();

SELECT m04.login('a4000000-0000-4000-8000-000000000001');
DO $scoped_assignments$
DECLARE v_id uuid;
BEGIN
  v_id := public.workspace_role_assignment_create(
    '54000000-0000-4000-8000-0000000000a1','a4000000-0000-4000-8000-000000000002',
    'm04_test_reader','org','54000000-0000-4000-8000-0000000000a1',now(),NULL,false,NULL,'{}','{}'
  );
  v_id := public.workspace_role_assignment_create(
    '54000000-0000-4000-8000-0000000000a1','a4000000-0000-4000-8000-000000000002',
    'm04_test_reader','campus','54000000-0000-4000-8000-0000000000a2',now(),NULL,false,NULL,'{}','{}'
  );
  v_id := public.workspace_role_assignment_create(
    '54000000-0000-4000-8000-0000000000a1','a4000000-0000-4000-8000-000000000002',
    'm04_test_reader','shift','54000000-0000-4000-8000-0000000000a3',now(),NULL,false,NULL,'{}','{}'
  );
END
$scoped_assignments$;
SELECT m04.denied('cross-tenant organization is isolated',
  $$SELECT public.workspace_role_assignment_create('54000000-0000-4000-8000-0000000000b1','b4000000-0000-4000-8000-000000000001','m04_test_reader','org','54000000-0000-4000-8000-0000000000b1',now(),NULL,false,NULL,'{}','{}')$$);
SELECT m04.denied('cross-tenant campus is isolated',
  $$SELECT public.workspace_role_assignment_create('54000000-0000-4000-8000-0000000000a1','a4000000-0000-4000-8000-000000000002','m04_test_reader','campus','54000000-0000-4000-8000-0000000000b2',now(),NULL,false,NULL,'{}','{}')$$);
SELECT m04.denied('cross-tenant shift is isolated',
  $$SELECT public.workspace_role_assignment_create('54000000-0000-4000-8000-0000000000a1','a4000000-0000-4000-8000-000000000002','m04_test_reader','shift','54000000-0000-4000-8000-0000000000b3',now(),NULL,false,NULL,'{}','{}')$$);
SELECT m04.cnt('organization, campus, and shift assignments are tenant-bound',
  $$SELECT 1 FROM public.user_role_assignments
     WHERE org_id='54000000-0000-4000-8000-0000000000a1'
       AND user_id='a4000000-0000-4000-8000-000000000002'
       AND scope_type IN ('org','campus','shift')$$, 3);

SELECT m04.cnt('hierarchy reader resolves only the active organization',
  $$SELECT 1
      FROM (SELECT public.read_my_tenant_hierarchy() AS hierarchy) h
     WHERE h.hierarchy->'organization'->>'id'='54000000-0000-4000-8000-0000000000a1'
       AND jsonb_array_length(h.hierarchy->'campuses')=1
       AND jsonb_array_length(h.hierarchy->'campuses'->0->'shifts')=1$$, 1);
SELECT m04.cnt('cross-tenant campus is isolated',
  $$SELECT 1 FROM public.campuses WHERE id='54000000-0000-4000-8000-0000000000b2'$$, 0);
SELECT m04.cnt('cross-tenant shift is isolated',
  $$SELECT 1 FROM public.school_shifts WHERE id='54000000-0000-4000-8000-0000000000b3'$$, 0);

DO $authority_link$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.institution_authority_links (
    school_id, authority_name, source, verification_status
  ) VALUES (
    '54000000-0000-4000-8000-0000000000a1',
    'M04 Synthetic Authority Candidate',
    'M04 disposable synthetic fixture',
    'unverified'
  ) RETURNING id INTO v_id;
  INSERT INTO m04.authority_link_ids VALUES ('candidate-a', v_id);
END
$authority_link$;
SELECT m04.cnt('cross-tenant authority link is isolated',
  $$SELECT 1 FROM public.institution_authority_links
     WHERE id=(SELECT id FROM m04.authority_link_ids WHERE label='candidate-b')$$, 0);
SELECT m04.rejects_check_violation('verification requires evidence URL',
  $$UPDATE public.institution_authority_links
       SET verification_status='verified', evidence_url=NULL
     WHERE id=(SELECT id FROM m04.authority_link_ids WHERE label='candidate-a')$$);
UPDATE public.institution_authority_links
   SET verification_status='verified', evidence_url='https://evidence.example.invalid/m04-test'
 WHERE id=(SELECT id FROM m04.authority_link_ids WHERE label='candidate-a');
SELECT m04.cnt('verified link records evidence and verifying actor',
  $$SELECT 1 FROM public.institution_authority_links
     WHERE id=(SELECT id FROM m04.authority_link_ids WHERE label='candidate-a')
       AND verification_status='verified'
       AND evidence_url='https://evidence.example.invalid/m04-test'
       AND verified_by=auth.uid()
       AND verified_at IS NOT NULL$$, 1);
SELECT m04.cnt('verified link audit attributes the actor',
  $$SELECT 1 FROM public.institution_authority_link_audit
     WHERE authority_link_id=(SELECT id FROM m04.authority_link_ids WHERE label='candidate-a')
       AND actor_user_id=auth.uid()
       AND action='update'$$, 1);
INSERT INTO m04.verification_stamps
SELECT id, verified_by, verified_at
  FROM public.institution_authority_links
 WHERE id=(SELECT id FROM m04.authority_link_ids WHERE label='candidate-a');
UPDATE public.institution_authority_links
   SET source='M04 updated synthetic source metadata'
 WHERE id=(SELECT id FROM m04.authority_link_ids WHERE label='candidate-a');
SELECT m04.cnt('unrelated edits preserve verification stamp',
  $$SELECT 1
      FROM public.institution_authority_links l
      JOIN m04.verification_stamps s USING (id)
     WHERE l.verified_by=s.verified_by
       AND l.verified_at=s.verified_at
       AND l.source='M04 updated synthetic source metadata'$$, 1);
SELECT m04.denied('authority-link audit is immutable',
  $$UPDATE public.institution_authority_link_audit SET action='delete'
     WHERE authority_link_id=(SELECT id FROM m04.authority_link_ids WHERE label='candidate-a')$$);
SELECT m04.logout();

SELECT m04.login('b4000000-0000-4000-8000-000000000001');
SELECT m04.cnt('organization B resolves its own hierarchy',
  $$SELECT 1 FROM (SELECT public.read_my_tenant_hierarchy() AS hierarchy) h
     WHERE h.hierarchy->'organization'->>'id'='54000000-0000-4000-8000-0000000000b1'
       AND jsonb_array_length(h.hierarchy->'campuses')=1$$, 1);
SELECT m04.cnt('organization B cannot read organization A links',
  $$SELECT 1 FROM public.institution_authority_links
     WHERE school_id='54000000-0000-4000-8000-0000000000a1'$$, 0);
SELECT m04.cnt('organization B reads only its own authority link',
  $$SELECT 1 FROM public.institution_authority_links
     WHERE id=(SELECT id FROM m04.authority_link_ids WHERE label='candidate-b')
       AND verification_status='unverified'$$, 1);
SELECT m04.cnt('organization B cannot read organization A campuses',
  $$SELECT 1 FROM public.campuses WHERE id='54000000-0000-4000-8000-0000000000a2'$$, 0);
SELECT m04.cnt('organization B cannot read organization A shifts',
  $$SELECT 1 FROM public.school_shifts WHERE id='54000000-0000-4000-8000-0000000000a3'$$, 0);
SELECT m04.logout();

DO $$ BEGIN RAISE NOTICE 'M04 ALL PASS'; END $$;
ROLLBACK;
