-- Local disposable Supabase SQL harness for SV1-CONSOLE Phase D.
-- Never run against a hosted, staging, or production database.
BEGIN;

DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Phase D harness must run as a local database superuser';
  END IF;
  IF inet_server_addr() IS NOT NULL
     AND NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'Phase D harness refuses non-loopback server address %', inet_server_addr();
  END IF;
END
$guard$;

CREATE TEMP TABLE phase_d_results (check_name text, ok boolean) ON COMMIT DROP;
GRANT INSERT ON phase_d_results TO service_role, authenticated;

INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at) VALUES
  ('51111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase-d-actor@example.test', now()),
  ('52222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase-d-tenant-user@example.test', now());

INSERT INTO public.schools (id, name, slug)
VALUES ('53333333-3333-4333-8333-333333333333', 'Phase D School A', 'phase-d-school-a');

INSERT INTO public.users (id, school_id, full_name, email, role)
VALUES (
  '51111111-1111-4111-8111-111111111111',
  '53333333-3333-4333-8333-333333333333',
  'Phase D Actor',
  'phase-d-actor@example.test',
  'admin'
);

INSERT INTO public.platform_staff (id, email, full_name, status)
VALUES (
  '51111111-1111-4111-8111-111111111111',
  'phase-d-actor@example.test',
  'Phase D Actor',
  'active'
);
INSERT INTO public.platform_staff_roles (staff_id, role_code)
VALUES ('51111111-1111-4111-8111-111111111111', 'support');

INSERT INTO public.platform_organization (
  id, display_name, org_type, intended_runtime, lifecycle_state, created_by
)
VALUES (
  '54444444-4444-4444-8444-444444444444',
  'Phase D School B',
  'school',
  'scholar',
  'provisioning',
  '51111111-1111-4111-8111-111111111111'
);

SET LOCAL ROLE service_role;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"51111111-1111-4111-8111-111111111111","role":"service_role"}',
  true
);
DO $retry$
DECLARE
  v_first uuid;
  v_retry uuid;
BEGIN
  v_first := public.provision_platform_organization_school(
    '54444444-4444-4444-8444-444444444444',
    'phase-d-school-b'
  );
  v_retry := public.provision_platform_organization_school(
    '54444444-4444-4444-8444-444444444444',
    'phase-d-school-b'
  );
  INSERT INTO phase_d_results VALUES (
    'retry returns the linked school without creating a duplicate',
    v_first = v_retry
      AND (SELECT count(*) FROM public.schools WHERE id = v_first) = 1
      AND (SELECT count(*) FROM public.schools WHERE slug = 'phase-d-school-b') = 1
  );
END
$retry$;
RESET ROLE;

INSERT INTO public.users (id, school_id, full_name, email, role)
SELECT
  '52222222-2222-4222-8222-222222222222',
  school_id,
  'Phase D Tenant B User',
  'phase-d-tenant-user@example.test',
  'admin'
FROM public.platform_organization
WHERE id = '54444444-4444-4444-8444-444444444444';
INSERT INTO public.students (school_id, user_id)
SELECT school_id, '52222222-2222-4222-8222-222222222222'
FROM public.platform_organization
WHERE id = '54444444-4444-4444-8444-444444444444';
UPDATE public.platform_organization
   SET lifecycle_state = 'active',
       activated_at = now()
 WHERE id = '54444444-4444-4444-8444-444444444444';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"51111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);
INSERT INTO phase_d_results VALUES (
  'platform support can read the active organization case',
  EXISTS (
    SELECT 1 FROM public.platform_organization
     WHERE id = '54444444-4444-4444-8444-444444444444'
       AND lifecycle_state = 'active'
  )
);
INSERT INTO phase_d_results VALUES (
  'an active organization does not grant School B student access',
  (
    SELECT count(*) = 0
      FROM public.students
     WHERE school_id = (
       SELECT school_id FROM public.platform_organization
        WHERE id = '54444444-4444-4444-8444-444444444444'
     )
  )
);
DO $deny$
BEGIN
  PERFORM public.provision_platform_organization_school(
    '54444444-4444-4444-8444-444444444444',
    'phase-d-school-b'
  );
  INSERT INTO phase_d_results VALUES ('authenticated cannot invoke provisioning RPC', false);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO phase_d_results VALUES ('authenticated cannot invoke provisioning RPC', true);
END
$deny$;
RESET ROLE;

SELECT check_name, ok FROM phase_d_results ORDER BY check_name;
DO $assert$
BEGIN
  IF EXISTS (SELECT 1 FROM phase_d_results WHERE NOT ok) THEN
    RAISE EXCEPTION 'SV1-CONSOLE Phase D SQL harness failed';
  END IF;
END
$assert$;

ROLLBACK;
