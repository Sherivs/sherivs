-- SCRATCH-DATABASE CHECK. NEVER RUN ON A REAL PROJECT.
-- Behavioural check for ENGINE-16_agent_pause_state.sql. It stubs the few Supabase pieces the
-- proposal depends on (auth.uid, is_super_admin, has_platform_capability, three roles), so it runs on
-- a throwaway local Postgres 16:
--   1. psql -d scratch -f this file's stub section (everything before "-- ---- checks ----")
--   2. psql -d scratch -f database/proposals/ENGINE-16_agent_pause_state.sql
--   3. psql -d scratch -f this file's checks section
-- Every row printed at the end must say PASS.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('test.sheriff', true), 'off') = 'on' $$;
CREATE FUNCTION public.has_platform_capability(c text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT public.is_super_admin() OR c = ANY (string_to_array(coalesce(current_setting('test.caps', true), ''), ',')) $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), public.is_super_admin(), public.has_platform_capability(text) TO anon, authenticated, service_role;
-- ---- checks ----
CREATE TEMP TABLE results(name text, ok boolean);
GRANT ALL ON results TO PUBLIC;
CREATE OR REPLACE FUNCTION pg_temp.try(p_name text, p_sql text, p_expect text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE msg text := 'ok';
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN msg := SQLERRM; END;
  INSERT INTO results VALUES (p_name || ' => ' || msg, msg = p_expect);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_actor(sheriff boolean, caps text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  PERFORM set_config('test.sheriff', CASE WHEN sheriff THEN 'on' ELSE 'off' END, false);
  PERFORM set_config('test.caps', caps, false);
END $$;
-- operations holder
SELECT pg_temp.as_actor(false, 'platform.operations.assign');
SELECT pg_temp.try('ops pause ordinary', 'SELECT public.change_agent_pause(''pause'',''support-agent'', ''Unexpected spike in proposals'')', 'ok');
SELECT pg_temp.try('ops pause jarvis', 'SELECT public.change_agent_pause(''pause'',''jarvis-executive'', ''Unexpected spike in proposals'')', 'pause_needs_sheriff');
SELECT pg_temp.try('ops pause all', 'SELECT public.change_agent_pause(''pause'',''all'', ''Unexpected spike in proposals'')', 'pause_needs_sheriff');
SELECT pg_temp.try('ops resume', 'SELECT public.change_agent_pause(''resume'',''support-agent'', ''Unexpected spike in proposals'')', 'resume_needs_sheriff');
SELECT pg_temp.try('ops short reason', 'SELECT public.change_agent_pause(''pause'',''finance-agent'', ''short'')', 'reason_too_short');
SELECT pg_temp.try('ops unknown target', 'SELECT public.change_agent_pause(''pause'',''nobody'', ''Unexpected spike in proposals'')', 'unknown_target');
SELECT pg_temp.try('ops unknown action', 'SELECT public.change_agent_pause(''delete'',''support-agent'', ''Unexpected spike in proposals'')', 'unknown_action');
-- viewer
SELECT pg_temp.as_actor(false, 'platform.operations.read');
SELECT pg_temp.try('viewer pause', 'SELECT public.change_agent_pause(''pause'',''finance-agent'', ''Unexpected spike in proposals'')', 'pause_needs_operations_capability');
-- anonymous
SELECT set_config('test.uid', '', false);
SELECT pg_temp.try('anonymous pause', 'SELECT public.change_agent_pause(''pause'',''finance-agent'', ''Unexpected spike in proposals'')', 'not_authenticated');
SELECT pg_temp.as_actor(false, 'platform.operations.assign');
INSERT INTO results SELECT 'only support-agent paused', (SELECT array_agg(a ORDER BY a) FROM (SELECT agent_code a FROM public.agent_pause_rules WHERE public.is_agent_paused(agent_code)) q) = ARRAY['support-agent'];
-- sheriff: cascade
SELECT pg_temp.as_actor(true, '');
SELECT pg_temp.try('sheriff pause jarvis', 'SELECT public.change_agent_pause(''pause'',''jarvis-executive'', ''Unexpected spike in proposals'')', 'ok');
INSERT INTO results SELECT 'jarvis pause reaches 23, not assurance', (SELECT count(*) FROM public.agent_pause_rules WHERE public.is_agent_paused(agent_code)) = 23
  AND NOT EXISTS (SELECT 1 FROM public.agent_pause_rules WHERE tier = 'assurance' AND public.is_agent_paused(agent_code));
SELECT pg_temp.try('sheriff resume jarvis', 'SELECT public.change_agent_pause(''resume'',''jarvis-executive'', ''Unexpected spike in proposals'')', 'ok');
INSERT INTO results SELECT 'after resume only support-agent', (SELECT array_agg(a) FROM (SELECT agent_code a FROM public.agent_pause_rules WHERE public.is_agent_paused(agent_code)) q) = ARRAY['support-agent'];
SELECT pg_temp.try('sheriff pause all', 'SELECT public.change_agent_pause(''pause'',''all'', ''Unexpected spike in proposals'')', 'ok');
INSERT INTO results SELECT 'all reaches 23 not assurance', (SELECT count(*) FROM public.agent_pause_rules WHERE public.is_agent_paused(agent_code)) = 23
  AND NOT EXISTS (SELECT 1 FROM public.agent_pause_rules WHERE tier = 'assurance' AND public.is_agent_paused(agent_code));
SELECT pg_temp.try('sheriff resume all', 'SELECT public.change_agent_pause(''resume'',''all'', ''Unexpected spike in proposals'')', 'ok');
SELECT pg_temp.try('sheriff pause assurance', 'SELECT public.change_agent_pause(''pause'',''sentinel-agent'', ''Unexpected spike in proposals'')', 'ok');
INSERT INTO results SELECT 'assurance paused directly', EXISTS (SELECT 1 FROM public.agent_pause_rules WHERE tier='assurance' AND public.is_agent_paused(agent_code));
INSERT INTO results SELECT 'unknown agent reads as paused', public.is_agent_paused('nobody');
-- append-only, even for the table owner
SELECT pg_temp.try('update blocked', 'UPDATE public.agent_pause_events SET reason = ''tampered tampered''', 'agent_pause_events is append-only');
SELECT pg_temp.try('delete blocked', 'DELETE FROM public.agent_pause_events', 'agent_pause_events is append-only');
-- grants and RLS
SET ROLE authenticated;
SELECT set_config('test.sheriff', 'off', false);
SELECT set_config('test.caps', '', false);
INSERT INTO pg_temp.results SELECT 'authenticated without capability sees no events', (SELECT count(*) FROM public.agent_pause_events) = 0;
SELECT set_config('test.caps', 'platform.operations.read', false);
INSERT INTO pg_temp.results SELECT 'authenticated with read sees events', (SELECT count(*) FROM public.agent_pause_events) > 0;
SELECT pg_temp.try('authenticated cannot insert directly', 'INSERT INTO public.agent_pause_events(action,target,reason,actor_id) VALUES (''pause'',''all'',''direct insert attempt'',gen_random_uuid())', 'permission denied for table agent_pause_events');
SELECT pg_temp.try('authenticated cannot call is_agent_paused', 'SELECT public.is_agent_paused(''support-agent'')', 'permission denied for function is_agent_paused');
RESET ROLE;
SELECT name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS r FROM results ORDER BY 1;
