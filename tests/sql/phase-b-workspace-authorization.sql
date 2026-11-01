-- Phase B proof. Run only against a disposable local Supabase database after
-- SHERIVS-M1 has been applied. All data is synthetic and rolled back.
BEGIN;
CREATE TEMP TABLE phaseb_results (check_name text, ok boolean) ON COMMIT DROP;
GRANT INSERT ON phaseb_results TO authenticated;

INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at) VALUES
  ('51111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phaseb-support@example.test', now()),
  ('52222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phaseb-admin@example.test', now()),
  ('53333333-3333-4333-8333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phaseb-suspended@example.test', now()),
  ('54444444-4444-4444-8444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phaseb-invite@example.test', now()),
  ('56666666-6666-4666-8666-666666666666', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phaseb-owner@example.test', now());

INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at) VALUES
  ('55555555-5555-4555-8555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phaseb-operator@example.test', now());
INSERT INTO public.super_admins (id, full_name, email, is_active)
VALUES (
  '55555555-5555-4555-8555-555555555555',
  'Synthetic Platform Operator',
  'phaseb-operator@example.test',
  true
);

INSERT INTO public.platform_staff (id, email, full_name, status, invite_expires_at) VALUES
  ('51111111-1111-4111-8111-111111111111', 'phaseb-support@example.test', 'Synthetic Support', 'active', now() + interval '7 days'),
  ('52222222-2222-4222-8222-222222222222', 'phaseb-admin@example.test', 'Synthetic Administrator', 'active', now() + interval '7 days'),
  ('53333333-3333-4333-8333-333333333333', 'phaseb-suspended@example.test', 'Synthetic Suspended', 'suspended', now() + interval '7 days'),
  ('54444444-4444-4444-8444-444444444444', 'phaseb-invite@example.test', 'Synthetic Invitee', 'invited', now() + interval '7 days'),
  ('56666666-6666-4666-8666-666666666666', 'phaseb-owner@example.test', 'Synthetic Owner', 'active', now() + interval '7 days');

INSERT INTO public.platform_staff_roles (staff_id, role_code) VALUES
  ('51111111-1111-4111-8111-111111111111', 'support'),
  ('52222222-2222-4222-8222-222222222222', 'platform_admin'),
  ('53333333-3333-4333-8333-333333333333', 'platform_admin'),
  ('54444444-4444-4444-8444-444444444444', 'support'),
  ('56666666-6666-4666-8666-666666666666', 'platform_admin');

INSERT INTO public.platform_organization (id, display_name, org_type, intended_runtime) VALUES
  ('57777777-7777-4777-8777-777777777777', 'Synthetic Assigned School', 'school', 'scholar'),
  ('58888888-8888-4888-8888-888888888888', 'Synthetic Unassigned School', 'school', 'scholar');
INSERT INTO public.platform_organization_assignment
  (organization_id, staff_id, assignment_type, status, assigned_by)
VALUES
  ('57777777-7777-4777-8777-777777777777', '51111111-1111-4111-8111-111111111111', 'support', 'active', '52222222-2222-4222-8222-222222222222'),
  ('58888888-8888-4888-8888-888888888888', '52222222-2222-4222-8222-222222222222', 'operations', 'active', '52222222-2222-4222-8222-222222222222');

SELECT public.ensure_platform_personal_workspace('51111111-1111-4111-8111-111111111111');
SELECT public.ensure_platform_personal_workspace('52222222-2222-4222-8222-222222222222');
SELECT public.ensure_platform_personal_workspace('53333333-3333-4333-8333-333333333333');
SELECT public.ensure_platform_personal_workspace('54444444-4444-4444-8444-444444444444');
SELECT public.ensure_platform_personal_workspace('56666666-6666-4666-8666-666666666666');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"51111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
INSERT INTO phaseb_results VALUES ('support reads only its assigned org', (
  SELECT count(*) = 1 FROM public.platform_organization
));
INSERT INTO phaseb_results VALUES ('support cannot read an unassigned org', (
  NOT EXISTS (
    SELECT 1 FROM public.platform_organization
     WHERE id = '58888888-8888-4888-8888-888888888888'
  )
));
INSERT INTO phaseb_results VALUES ('active staff can read own personal workspace', (
  SELECT count(*) = 1 FROM public.platform_workspace
   WHERE kind = 'personal' AND owner_id = auth.uid()
));
INSERT INTO phaseb_results VALUES ('support has no staff-management capability', (
  NOT public.has_internal_console_capability('platform.staff.manage')
));

SELECT set_config('request.jwt.claims', '{"sub":"54444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
INSERT INTO phaseb_results VALUES ('first invitation claim succeeds', public.claim_platform_staff_invite());
INSERT INTO phaseb_results VALUES ('replayed invitation claim is a no-op', NOT public.claim_platform_staff_invite());
INSERT INTO phaseb_results VALUES ('claim creates one personal workspace', (
  SELECT count(*) = 1 FROM public.platform_workspace
   WHERE kind = 'personal' AND owner_id = auth.uid()
));
RESET ROLE;
INSERT INTO phaseb_results VALUES ('claim writes one audit record', (
  SELECT count(*) = 1 FROM public.audit_logs
   WHERE action = 'platform_staff.invite.claim'
     AND record_id = '54444444-4444-4444-8444-444444444444'
));
CREATE TEMP TABLE phaseb_personal_before AS
SELECT id, owner_id FROM public.platform_workspace
 WHERE kind = 'personal'
   AND owner_id = '54444444-4444-4444-8444-444444444444';
SELECT public.set_platform_staff_roles(
  '54444444-4444-4444-8444-444444444444',
  ARRAY['operations']::text[],
  '52222222-2222-4222-8222-222222222222'
);
INSERT INTO phaseb_results VALUES ('role change preserves personal workspace identity', (
  SELECT w.id = b.id
    FROM public.platform_workspace w
    JOIN phaseb_personal_before b ON b.owner_id = w.owner_id
   WHERE w.kind = 'personal'
     AND w.owner_id = '54444444-4444-4444-8444-444444444444'
));
INSERT INTO phaseb_results VALUES ('role change removes old role workspace membership', (
  NOT EXISTS (
    SELECT 1 FROM public.platform_workspace_member m
    JOIN public.platform_role_workspace rw ON rw.workspace_id = m.workspace_id
    WHERE m.user_id = '54444444-4444-4444-8444-444444444444'
      AND rw.role_code = 'support'
  )
));
INSERT INTO phaseb_results VALUES ('role change adds new role workspace membership', (
  EXISTS (
    SELECT 1 FROM public.platform_workspace_member m
    JOIN public.platform_role_workspace rw ON rw.workspace_id = m.workspace_id
    WHERE m.user_id = '54444444-4444-4444-8444-444444444444'
      AND rw.role_code = 'operations'
  )
));
SELECT public.set_platform_staff_roles(
  '54444444-4444-4444-8444-444444444444',
  ARRAY['security', 'finance', 'sales']::text[],
  '52222222-2222-4222-8222-222222222222'
);
INSERT INTO phaseb_results VALUES ('legacy roles reuse the V1 workspaces', (
  EXISTS (
    SELECT 1 FROM public.platform_workspace_member m
    JOIN public.platform_role_workspace rw ON rw.workspace_id = m.workspace_id
    WHERE m.user_id = '54444444-4444-4444-8444-444444444444'
      AND rw.role_code = 'platform_admin'
  )
  AND EXISTS (
    SELECT 1 FROM public.platform_workspace_member m
    JOIN public.platform_role_workspace rw ON rw.workspace_id = m.workspace_id
    WHERE m.user_id = '54444444-4444-4444-8444-444444444444'
      AND rw.role_code = 'operations'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.platform_role_workspace
     WHERE role_code IN ('security', 'finance', 'sales')
  )
));

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"52222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
INSERT INTO phaseb_results VALUES ('admin cannot read another personal workspace', (
  NOT EXISTS (
    SELECT 1 FROM public.platform_workspace
     WHERE kind = 'personal'
       AND owner_id = '51111111-1111-4111-8111-111111111111'
  )
));
INSERT INTO phaseb_results VALUES ('admin cannot read another personal membership', (
  NOT EXISTS (
    SELECT 1 FROM public.platform_workspace_member
     WHERE user_id = '51111111-1111-4111-8111-111111111111'
  )
));
INSERT INTO phaseb_results VALUES ('platform admin cannot read org cases', (
  NOT EXISTS (SELECT 1 FROM public.platform_organization)
));

SELECT set_config('request.jwt.claims', '{"sub":"53333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
INSERT INTO phaseb_results VALUES ('suspended staff cannot read own workspace', (
  NOT EXISTS (
    SELECT 1 FROM public.platform_workspace
     WHERE kind = 'personal' AND owner_id = auth.uid()
  )
));
INSERT INTO phaseb_results VALUES ('suspended staff capability is denied', (
  NOT public.has_internal_console_capability('platform.staff.read')
));

SELECT set_config('request.jwt.claims', '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}', true);
INSERT INTO phaseb_results VALUES ('platform operator cannot use a direct operations bypass', (
  NOT public.has_internal_console_capability('platform.operations.read')
));
INSERT INTO phaseb_results VALUES ('platform operator lacks general staff bypass', (
  NOT public.has_internal_console_capability('platform.staff.manage')
));
INSERT INTO phaseb_results VALUES ('platform operator lacks direct org records', (
  NOT EXISTS (SELECT 1 FROM public.platform_organization)
));

RESET ROLE;
SELECT check_name, ok FROM phaseb_results ORDER BY check_name;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM phaseb_results WHERE NOT ok) THEN
    RAISE EXCEPTION 'Phase B authorization proof failed';
  END IF;
END;
$$;
ROLLBACK;
