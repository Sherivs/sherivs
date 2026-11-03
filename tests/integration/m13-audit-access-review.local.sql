-- M13 access review and audit behavior (LOCAL, DISPOSABLE ONLY).
-- Run only after replaying repository migrations on a loopback disposable DB:
--   psql "postgresql://supabase_admin@127.0.0.1:<port>/postgres" \
--     -v ON_ERROR_STOP=1 -f tests/integration/m13-audit-access-review.local.sql
-- This transaction is rolled back; it never applies migrations or uses a live DB.
BEGIN;

DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'M13: must run as a superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NOT NULL
     AND NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet)
     AND coalesce(current_setting('m13.allow_non_loopback', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'M13: refusing non-loopback server address %', inet_server_addr();
  END IF;
  IF to_regclass('public.role_access_review_campaigns') IS NULL
     OR to_regclass('public.role_access_review_items') IS NULL
     OR to_regclass('public.role_access_review_audit_events') IS NULL
     OR to_regprocedure('public.workspace_access_review_campaign_create(uuid,text,timestamptz)') IS NULL
     OR to_regprocedure('public.workspace_access_review_decide(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'M13 migration is not applied';
  END IF;
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'public.role_access_review_campaigns'::regclass)
     OR NOT (SELECT relrowsecurity AND relforcerowsecurity
               FROM pg_class WHERE oid = 'public.role_access_review_items'::regclass)
     OR NOT (SELECT relrowsecurity AND relforcerowsecurity
               FROM pg_class WHERE oid = 'public.role_access_review_audit_events'::regclass) THEN
    RAISE EXCEPTION 'M13 tables must have RLS enabled and forced';
  END IF;
END
$guard$;

CREATE SCHEMA m13;
GRANT USAGE ON SCHEMA m13 TO anon, authenticated, service_role;
CREATE FUNCTION m13.login(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION m13.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE 'RESET ROLE'; END $$;
CREATE FUNCTION m13.denied(p_label text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN;
  END;
  RAISE EXCEPTION 'M13 FAIL [%]: statement was allowed but must be denied', p_label;
END $$;
CREATE FUNCTION m13.assert_count(p_label text, p_sql text, p_expected bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_count bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO v_count;
  IF v_count IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'M13 FAIL [%]: expected % rows, got %', p_label, p_expected, v_count;
  END IF;
END $$;
CREATE TABLE m13.ids (name text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT, INSERT ON m13.ids TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA m13 TO anon, authenticated, service_role;

INSERT INTO auth.users (id) VALUES
  ('a9130000-0000-4000-8000-000000000001'),
  ('a9130000-0000-4000-8000-000000000002'),
  ('a9130000-0000-4000-8000-000000000003'),
  ('a9130000-0000-4000-8000-000000000004'),
  ('b9130000-0000-4000-8000-000000000001'),
  ('b9130000-0000-4000-8000-000000000002');
INSERT INTO public.schools (id, name, slug) VALUES
  ('59130000-0000-4000-8000-0000000000a1', 'M13 Demo Tenant A', 'm13-demo-tenant-a'),
  ('59130000-0000-4000-8000-0000000000b2', 'M13 Demo Tenant B', 'm13-demo-tenant-b');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  ('a9130000-0000-4000-8000-000000000001', '59130000-0000-4000-8000-0000000000a1',
   'M13 Demo Administrator', 'm13-admin@example.invalid', 'admin', true),
  ('a9130000-0000-4000-8000-000000000002', '59130000-0000-4000-8000-0000000000a1',
   'M13 Demo Staff One', 'm13-staff-one@example.invalid', 'teacher', true),
  ('a9130000-0000-4000-8000-000000000003', '59130000-0000-4000-8000-0000000000a1',
   'M13 Demo Staff Two', 'm13-staff-two@example.invalid', 'teacher', true),
  ('a9130000-0000-4000-8000-000000000004', '59130000-0000-4000-8000-0000000000a1',
   'M13 Demo Staff Three', 'm13-staff-three@example.invalid', 'teacher', true),
  ('b9130000-0000-4000-8000-000000000001', '59130000-0000-4000-8000-0000000000b2',
   'M13 Demo Tenant B Administrator', 'm13-admin-b@example.invalid', 'admin', true),
  ('b9130000-0000-4000-8000-000000000002', '59130000-0000-4000-8000-0000000000b2',
   'M13 Demo Tenant B Staff', 'm13-staff-b@example.invalid', 'teacher', true);

SELECT m13.login('a9130000-0000-4000-8000-000000000001');
DO $assignments$
DECLARE
  v_assignment uuid;
BEGIN
  v_assignment := public.workspace_role_assignment_create(
    '59130000-0000-4000-8000-0000000000a1',
    'a9130000-0000-4000-8000-000000000002',
    'ng.principal', 'institution', NULL, now() - interval '1 minute',
    NULL, false, NULL, '{}', '{}'
  );
  INSERT INTO m13.ids VALUES ('assignment-retain', v_assignment);
  v_assignment := public.workspace_role_assignment_create(
    '59130000-0000-4000-8000-0000000000a1',
    'a9130000-0000-4000-8000-000000000003',
    'ng.principal', 'institution', NULL, now() - interval '1 minute',
    NULL, false, NULL, '{}', '{}'
  );
  INSERT INTO m13.ids VALUES ('assignment-revoke', v_assignment);
  v_assignment := public.workspace_role_assignment_create(
    '59130000-0000-4000-8000-0000000000a1',
    'a9130000-0000-4000-8000-000000000004',
    'ng.principal', 'institution', NULL, now() - interval '1 minute',
    NULL, false, NULL, '{}', '{}'
  );
  INSERT INTO m13.ids VALUES ('assignment-ended-before-review', v_assignment);
END
$assignments$;

DO $campaign$
DECLARE
  v_campaign uuid;
BEGIN
  v_campaign := public.workspace_access_review_campaign_create(
    '59130000-0000-4000-8000-0000000000a1',
    'M13 quarterly synthetic review',
    now() + interval '7 days'
  );
  INSERT INTO m13.ids VALUES ('campaign', v_campaign);
END
$campaign$;
SELECT m13.assert_count('campaign snapshots active tenant assignments',
  $$SELECT 1 FROM public.role_access_review_items
     WHERE campaign_id = (SELECT id FROM m13.ids WHERE name = 'campaign')$$, 3);
SELECT m13.logout();

-- Seed a real review in tenant B before asserting tenant A cannot see it.
SELECT m13.login('b9130000-0000-4000-8000-000000000001');
DO $tenant_b$
DECLARE
  v_assignment uuid;
  v_campaign uuid;
BEGIN
  v_assignment := public.workspace_role_assignment_create(
    '59130000-0000-4000-8000-0000000000b2',
    'b9130000-0000-4000-8000-000000000002',
    'ng.principal', 'institution', NULL, now() - interval '1 minute',
    NULL, false, NULL, '{}', '{}'
  );
  INSERT INTO m13.ids VALUES ('tenant-b-assignment', v_assignment);
  v_campaign := public.workspace_access_review_campaign_create(
    '59130000-0000-4000-8000-0000000000b2',
    'M13 tenant B synthetic review',
    now() + interval '7 days'
  );
  INSERT INTO m13.ids VALUES ('tenant-b-campaign', v_campaign);
END
$tenant_b$;
SELECT m13.logout();

SELECT m13.login('a9130000-0000-4000-8000-000000000001');
SELECT m13.assert_count('reviewer cannot read tenant B review items',
  $$SELECT 1 FROM public.role_access_review_items
     WHERE org_id = '59130000-0000-4000-8000-0000000000b2'$$, 0);
SELECT m13.assert_count('reviewer cannot read tenant B campaigns',
  $$SELECT 1 FROM public.role_access_review_campaigns
     WHERE org_id = '59130000-0000-4000-8000-0000000000b2'$$, 0);
SELECT m13.denied('cross-tenant campaign creation is denied',
  $$SELECT public.workspace_access_review_campaign_create(
    '59130000-0000-4000-8000-0000000000b2', 'foreign review', now() + interval '1 day')$$);
DO $invalid_decision$
DECLARE
  v_campaign uuid;
  v_item uuid;
  v_assignment uuid;
  v_rejected boolean := false;
BEGIN
  SELECT id INTO v_campaign FROM m13.ids WHERE name = 'campaign';
  SELECT id INTO v_assignment FROM m13.ids WHERE name = 'assignment-retain';
  SELECT id INTO v_item FROM public.role_access_review_items
   WHERE campaign_id = v_campaign AND assignment_id = v_assignment;
  BEGIN
    PERFORM public.workspace_access_review_decide(v_item, NULL);
  EXCEPTION WHEN invalid_parameter_value THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'M13 accepted a NULL decision'; END IF;
END
$invalid_decision$;
SELECT m13.logout();
SELECT set_config('request.jwt.claim.sub', 'a9130000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"a9130000-0000-4000-8000-000000000001","role":"authenticated"}', true);
UPDATE public.user_role_assignments
   SET status = 'ended', ended_at = clock_timestamp(), ended_by = auth.uid()
 WHERE id = (SELECT id FROM m13.ids WHERE name = 'assignment-ended-before-review')
   AND status = 'active';
SELECT m13.login('a9130000-0000-4000-8000-000000000001');
DO $decisions$
DECLARE
  v_campaign uuid;
  v_item uuid;
  v_assignment uuid;
  v_result text;
BEGIN
  SELECT id INTO v_campaign FROM m13.ids WHERE name = 'campaign';
  SELECT id INTO v_assignment FROM m13.ids WHERE name = 'assignment-retain';
  SELECT id INTO v_item FROM public.role_access_review_items
   WHERE campaign_id = v_campaign AND assignment_id = v_assignment;
  v_result := public.workspace_access_review_decide(v_item, 'retain');
  IF v_result <> 'retained' THEN RAISE EXCEPTION 'M13 expected retained, got %', v_result; END IF;

  SELECT id INTO v_assignment FROM m13.ids WHERE name = 'assignment-revoke';
  SELECT id INTO v_item FROM public.role_access_review_items
   WHERE campaign_id = v_campaign AND assignment_id = v_assignment;
  v_result := public.workspace_access_review_decide(v_item, 'revoke');
  IF v_result <> 'revoked' THEN RAISE EXCEPTION 'M13 expected revoked, got %', v_result; END IF;

  SELECT id INTO v_assignment FROM m13.ids WHERE name = 'assignment-ended-before-review';
  SELECT id INTO v_item FROM public.role_access_review_items
   WHERE campaign_id = v_campaign AND assignment_id = v_assignment;
  v_result := public.workspace_access_review_decide(v_item, 'retain');
  IF v_result <> 'already_ended' THEN
    RAISE EXCEPTION 'M13 expected already_ended, got %', v_result;
  END IF;
END
$decisions$;
SELECT m13.assert_count('reviewer can read tenant audit events',
  $$SELECT 1 FROM public.role_access_review_audit_events
     WHERE org_id = '59130000-0000-4000-8000-0000000000a1'$$, 5);
SELECT m13.assert_count('review campaign completed after every assignment is decided',
  $$SELECT 1 FROM public.role_access_review_campaigns
     WHERE id = (SELECT id FROM m13.ids WHERE name = 'campaign')
       AND status = 'completed' AND completed_at IS NOT NULL$$, 1);
SELECT m13.logout();

-- Application roles cannot mutate either append-only role or review audit records.
SET LOCAL ROLE anon;
SELECT m13.denied('anon cannot update review audit',
  $$UPDATE public.role_access_review_audit_events SET action = 'campaign_created'$$);
SELECT m13.denied('anon cannot delete review audit',
  $$DELETE FROM public.role_access_review_audit_events$$);
SELECT m13.denied('anon cannot update role assignment audit',
  $$UPDATE public.role_assignment_audit_events SET action = 'delete'$$);
SELECT m13.denied('anon cannot delete role assignment audit',
  $$DELETE FROM public.role_assignment_audit_events$$);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT m13.denied('authenticated cannot update review audit',
  $$UPDATE public.role_access_review_audit_events SET action = 'campaign_created'$$);
SELECT m13.denied('authenticated cannot delete review audit',
  $$DELETE FROM public.role_access_review_audit_events$$);
SELECT m13.denied('authenticated cannot update role assignment audit',
  $$UPDATE public.role_assignment_audit_events SET action = 'delete'$$);
SELECT m13.denied('authenticated cannot delete role assignment audit',
  $$DELETE FROM public.role_assignment_audit_events$$);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT m13.denied('service_role cannot update review audit',
  $$UPDATE public.role_access_review_audit_events SET action = 'campaign_created'$$);
SELECT m13.denied('service_role cannot delete review audit',
  $$DELETE FROM public.role_access_review_audit_events$$);
SELECT m13.denied('service_role cannot update role assignment audit',
  $$UPDATE public.role_assignment_audit_events SET action = 'delete'$$);
SELECT m13.denied('service_role cannot delete role assignment audit',
  $$DELETE FROM public.role_assignment_audit_events$$);
RESET ROLE;

-- Triggers remain effective even for a privileged owner-level test session.
SELECT m13.denied('audit trigger rejects privileged update',
  $$UPDATE public.role_access_review_audit_events SET action = 'campaign_created'$$);
SELECT m13.denied('audit trigger rejects privileged delete',
  $$DELETE FROM public.role_access_review_audit_events$$);
SELECT m13.denied('audit trigger rejects privileged truncate',
  $$TRUNCATE public.role_access_review_audit_events$$);
SELECT m13.denied('role audit trigger rejects privileged update',
  $$UPDATE public.role_assignment_audit_events SET action = 'delete'$$);
SELECT m13.denied('role audit trigger rejects privileged delete',
  $$DELETE FROM public.role_assignment_audit_events$$);
SELECT m13.denied('role audit trigger rejects privileged truncate',
  $$TRUNCATE public.role_assignment_audit_events$$);

DO $audit$
DECLARE
  v_assignment uuid;
BEGIN
  SELECT id INTO v_assignment FROM m13.ids WHERE name = 'assignment-revoke';
  IF NOT EXISTS (
    SELECT 1 FROM public.user_role_assignments
     WHERE id = v_assignment AND status = 'ended' AND ended_by = 'a9130000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'M13 role revocation did not end the assignment';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.role_assignment_audit_events
     WHERE org_id = '59130000-0000-4000-8000-0000000000a1'
       AND assignment_id = v_assignment
       AND actor_user_id = 'a9130000-0000-4000-8000-000000000001'
       AND target_type = 'user_role_assignments'
  ) THEN
    RAISE EXCEPTION 'M13 role revocation was not recorded by the role engine audit';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.role_access_review_campaigns
     WHERE id = (SELECT id FROM m13.ids WHERE name = 'tenant-b-campaign')
        AND org_id = '59130000-0000-4000-8000-0000000000b2'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.role_access_review_items
     WHERE campaign_id = (SELECT id FROM m13.ids WHERE name = 'tenant-b-campaign')
        AND org_id = '59130000-0000-4000-8000-0000000000b2'
  ) THEN
    RAISE EXCEPTION 'M13 tenant B isolation fixture was not created';
  END IF;
END
$audit$;

ROLLBACK;
