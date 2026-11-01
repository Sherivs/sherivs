-- Behavioral proof (LOCAL disposable Supabase stack, as postgres, after
-- migration 20261027002000): clients cannot write organization or role-workspace
-- tables; outsiders see none; claimed staff receive a role workspace; invalid
-- invite claims still fail. Rolls back; leaves no rows.
BEGIN;
CREATE TEMP TABLE cp_results (check_name text, ok boolean) ON COMMIT DROP;
GRANT INSERT ON cp_results TO authenticated, anon;

INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at) VALUES
  ('41111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cp-out@example.test', now()),
  ('42222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cp-ops@example.test', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.platform_staff (id, email, full_name, status, invite_expires_at) VALUES
  ('42222222-2222-4222-8222-222222222222', 'cp-ops@example.test', 'Ops Person', 'invited', now() + interval '7 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.platform_staff_roles (staff_id, role_code) VALUES
  ('42222222-2222-4222-8222-222222222222', 'operations')
ON CONFLICT DO NOTHING;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
INSERT INTO cp_results VALUES ('outsider sees no organization cases', (SELECT count(*) FROM public.platform_organization) = 0);
DO $t$ BEGIN
  INSERT INTO public.platform_organization (display_name, country)
  VALUES ('Intruder School', 'Nigeria');
  INSERT INTO cp_results VALUES ('outsider cannot insert organization', false);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO cp_results VALUES ('outsider cannot insert organization', true);
END $t$;

SELECT set_config('request.jwt.claims', '{"sub":"42222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
INSERT INTO cp_results VALUES ('valid invite can be claimed', public.claim_platform_staff_invite());
INSERT INTO cp_results VALUES ('claimed operator has personal workspace', EXISTS (
  SELECT 1 FROM public.platform_workspace w
  JOIN public.platform_workspace_member m ON m.workspace_id = w.id
  WHERE w.kind = 'personal' AND m.user_id = '42222222-2222-4222-8222-222222222222'
));
INSERT INTO cp_results VALUES ('claimed operator has operations role workspace', EXISTS (
  SELECT 1 FROM public.platform_role_workspace rw
  JOIN public.platform_workspace_member m ON m.workspace_id = rw.workspace_id
  WHERE rw.role_code = 'operations' AND m.user_id = '42222222-2222-4222-8222-222222222222'
));
DO $t$ BEGIN
  INSERT INTO public.platform_organization (display_name, country)
  VALUES ('Staff Insert', 'Nigeria');
  INSERT INTO cp_results VALUES ('staff cannot insert organization', false);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO cp_results VALUES ('staff cannot insert organization', true);
END $t$;

RESET ROLE;
SELECT public.sync_platform_staff_workspaces('42222222-2222-4222-8222-222222222222');
INSERT INTO cp_results VALUES ('sync is idempotent for role workspace', (
  SELECT count(*) FROM public.platform_role_workspace WHERE role_code = 'operations'
) = 1);
DELETE FROM public.platform_staff_roles
 WHERE staff_id = '42222222-2222-4222-8222-222222222222';
INSERT INTO public.platform_staff_roles (staff_id, role_code)
VALUES ('42222222-2222-4222-8222-222222222222', 'engineering');
SELECT public.sync_platform_staff_workspaces('42222222-2222-4222-8222-222222222222');
INSERT INTO cp_results VALUES ('role change removes old workspace membership', NOT EXISTS (
  SELECT 1
  FROM public.platform_role_workspace rw
  JOIN public.platform_workspace_member m ON m.workspace_id = rw.workspace_id
  WHERE rw.role_code = 'operations' AND m.user_id = '42222222-2222-4222-8222-222222222222'
));
INSERT INTO cp_results VALUES ('role change adds new workspace membership', EXISTS (
  SELECT 1
  FROM public.platform_role_workspace rw
  JOIN public.platform_workspace_member m ON m.workspace_id = rw.workspace_id
  WHERE rw.role_code = 'engineering' AND m.user_id = '42222222-2222-4222-8222-222222222222'
));
INSERT INTO cp_results VALUES ('role change preserves personal workspace', (
  SELECT count(*) = 1
  FROM public.platform_workspace w
  JOIN public.platform_workspace_member m ON m.workspace_id = w.id
  WHERE w.kind = 'personal' AND m.user_id = '42222222-2222-4222-8222-222222222222'
));
UPDATE public.platform_staff
   SET status = 'suspended'
 WHERE id = '42222222-2222-4222-8222-222222222222';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"42222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
INSERT INTO cp_results VALUES ('suspended staff loses platform capability',
  NOT public.has_platform_capability('platform.engineering.read')
);
RESET ROLE;

SELECT check_name, ok FROM cp_results ORDER BY check_name;
ROLLBACK;
