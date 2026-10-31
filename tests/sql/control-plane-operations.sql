-- Behavioral proof (LOCAL disposable Supabase stack, as postgres, after
-- migration 20261027003000): clients cannot write tickets or incidents;
-- outsiders see none. Rolls back; leaves no rows.
BEGIN;
CREATE TEMP TABLE cop_results (check_name text, ok boolean) ON COMMIT DROP;
GRANT INSERT ON cop_results TO authenticated, anon;

INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at) VALUES
  ('51111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cop-out@example.test', now())
ON CONFLICT (id) DO NOTHING;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"51111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
INSERT INTO cop_results VALUES ('outsider sees no tickets', (SELECT count(*) FROM public.platform_ticket) = 0);
INSERT INTO cop_results VALUES ('outsider sees no incidents', (SELECT count(*) FROM public.platform_incident) = 0);
DO $t$ BEGIN
  INSERT INTO public.platform_ticket (subject, body, opened_by)
  VALUES ('Intruder', 'Should fail', '51111111-1111-4111-8111-111111111111');
  INSERT INTO cop_results VALUES ('outsider cannot insert ticket', false);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO cop_results VALUES ('outsider cannot insert ticket', true);
END $t$;

RESET ROLE;
SELECT check_name, ok FROM cop_results ORDER BY check_name;
ROLLBACK;
