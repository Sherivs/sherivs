-- Behavioral proof (LOCAL disposable Supabase stack, as postgres, after
-- migration 20261027001000): clients cannot write console store tables;
-- outsiders see no workspaces; administrators cannot read another person's
-- personal workspace or recent access; invitation claims are replay-safe.
-- Rolls back; leaves no rows.
BEGIN;
CREATE TEMP TABLE ic_results (check_name text, ok boolean) ON COMMIT DROP;
GRANT INSERT ON ic_results TO authenticated, anon;

INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at) VALUES
  ('31111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ic-out@example.test', now()),
  ('32222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ic-eng@example.test', now()),
  ('33333333-3333-4333-8333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ic-exp@example.test', now()),
  ('34444444-4444-4444-8444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ic-admin@example.test', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.platform_staff (id, email, full_name, status, invite_expires_at) VALUES
  ('32222222-2222-4222-8222-222222222222', 'ic-eng@example.test', 'Engineer Person', 'invited', now() + interval '7 days'),
  ('33333333-3333-4333-8333-333333333333', 'ic-exp@example.test', 'Expired Person', 'invited', now() - interval '1 day'),
  ('34444444-4444-4444-8444-444444444444', 'ic-admin@example.test', 'Synthetic Admin', 'active', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.platform_staff_roles (staff_id, role_code) VALUES
  ('32222222-2222-4222-8222-222222222222', 'engineering'),
  ('34444444-4444-4444-8444-444444444444', 'platform_admin')
ON CONFLICT DO NOTHING;

SELECT public.ensure_platform_personal_workspace('32222222-2222-4222-8222-222222222222');
INSERT INTO public.platform_recent_access (user_id, resource_key, title, href, kind)
VALUES (
  '32222222-2222-4222-8222-222222222222',
  'private-synthetic-resource',
  'Synthetic private recent item',
  '/console/workspaces/me',
  'workspace'
);

INSERT INTO public.platform_runtime (
  id, name, description, entry_origin, entry_path, help_href, status, sort_order
) VALUES (
  'runtime:primary',
  'Primary runtime',
  'Fixture runtime for local console-store isolation proof.',
  'https://app.sherivs.com',
  '/home',
  '/console/runtimes',
  'operational_product',
  10
) ON CONFLICT (id) DO NOTHING;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"31111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
INSERT INTO ic_results VALUES ('outsider sees no runtimes', (SELECT count(*) FROM public.platform_runtime) = 0);
INSERT INTO ic_results VALUES ('outsider sees no workspaces', (SELECT count(*) FROM public.platform_workspace) = 0);
DO $t$ BEGIN
  INSERT INTO public.platform_workspace (slug, name, kind, owner_id)
  VALUES ('intruder', 'Intruder', 'shared', '31111111-1111-4111-8111-111111111111');
  INSERT INTO ic_results VALUES ('outsider cannot insert workspace', false);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO ic_results VALUES ('outsider cannot insert workspace', true);
END $t$;

SELECT set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
INSERT INTO ic_results VALUES ('expired invite cannot be claimed', NOT public.claim_platform_staff_invite());

SELECT set_config('request.jwt.claims', '{"sub":"32222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
INSERT INTO ic_results VALUES ('valid invite can be claimed', public.claim_platform_staff_invite());
INSERT INTO ic_results VALUES ('claimed staff has personal workspace', EXISTS (
  SELECT 1 FROM public.platform_workspace w
  JOIN public.platform_workspace_member m ON m.workspace_id = w.id
  WHERE w.kind = 'personal' AND m.user_id = '32222222-2222-4222-8222-222222222222' AND m.access = 'owner'
));
INSERT INTO ic_results VALUES ('replayed invitation claim is rejected', NOT public.claim_platform_staff_invite());
INSERT INTO ic_results VALUES ('invitation replay does not duplicate personal workspace', (
  SELECT count(*) = 1
  FROM public.platform_workspace
  WHERE kind = 'personal' AND owner_id = '32222222-2222-4222-8222-222222222222'
));
INSERT INTO ic_results VALUES ('staff sees registered runtime', EXISTS (
  SELECT 1 FROM public.platform_runtime WHERE id = 'runtime:primary'
));
DO $t$ BEGIN
  INSERT INTO public.platform_runtime (id, name, description, entry_origin, entry_path, help_href, status)
  VALUES ('runtime:fake', 'Fake', 'Should not insert from client.', 'https://example.com', '/x', '/console/x', 'operational_product');
  INSERT INTO ic_results VALUES ('staff cannot insert runtime', false);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO ic_results VALUES ('staff cannot insert runtime', true);
END $t$;

SELECT set_config('request.jwt.claims', '{"sub":"34444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
INSERT INTO ic_results VALUES ('platform admin cannot read another personal workspace', NOT EXISTS (
  SELECT 1 FROM public.platform_workspace
  WHERE kind = 'personal' AND owner_id = '32222222-2222-4222-8222-222222222222'
));
INSERT INTO ic_results VALUES ('platform admin cannot read another personal recent access', NOT EXISTS (
  SELECT 1 FROM public.platform_recent_access
  WHERE user_id = '32222222-2222-4222-8222-222222222222'
));

RESET ROLE;
SELECT check_name, ok FROM ic_results ORDER BY check_name;
ROLLBACK;
