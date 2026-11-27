-- A3 (decision D-09): agent promotion needs a verified passkey step-up bound to the exact promotion. Structure and
-- privileges, the digest, spending (single use, person, kind, content, window, revocation), the promotion path, and
-- the classes WF-07 already gates. Local disposable Postgres only; everything rolls back.
BEGIN;
DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'A3 FAIL: refusing to run outside the local disposable database';
  END IF;
  IF to_regclass('public.wf_sensitive_step_up') IS NULL OR to_regprocedure('public.wf_step_up_consume(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'A3 FAIL: the A3 migration must be present';
  END IF;
END $guard$;

CREATE SCHEMA a3t;
GRANT USAGE ON SCHEMA a3t TO anon, authenticated, service_role;
CREATE TABLE a3t.passed (n serial PRIMARY KEY, label text NOT NULL);
GRANT ALL ON a3t.passed TO anon, authenticated, service_role;
GRANT USAGE ON SEQUENCE a3t.passed_n_seq TO anon, authenticated, service_role;
CREATE FUNCTION a3t.ok(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'A3 FAIL [%]', p_label; END IF;
  INSERT INTO a3t.passed (label) VALUES (p_label);
END $$;
CREATE FUNCTION a3t.refused(p_label text, p_sql text, p_state text, p_msg text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state AND (p_msg IS NULL OR SQLERRM LIKE '%' || p_msg || '%') THEN
      INSERT INTO a3t.passed (label) VALUES (p_label);
      RETURN;
    END IF;
    RAISE EXCEPTION 'A3 FAIL [%]: expected % (%) got % (%)', p_label, p_state, p_msg, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'A3 FAIL [%]: statement was allowed', p_label;
END $$;
CREATE FUNCTION a3t.login_as(p_role text, p_user uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', p_role, 'sub', p_user)::text, true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
END $$;
CREATE FUNCTION a3t.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;
-- Record a step-up as the server would (owner context here; service_role in production).
CREATE FUNCTION a3t.su(p_user uuid, p_digest text, p_verified interval DEFAULT interval '0', p_ttl interval DEFAULT interval '4 minutes')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v uuid;
BEGIN
  INSERT INTO public.wf_sensitive_step_up (user_id, action_kind, subject_digest, verified_at, expires_at)
  VALUES (p_user, 'agent_promotion', p_digest, now() - p_verified, now() - p_verified + p_ttl) RETURNING id INTO v;
  RETURN v;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA a3t TO anon, authenticated, service_role;

-- 1. Structure and privileges
SELECT a3t.ok('the evidence table has row security on and no policy',
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.wf_sensitive_step_up'::regclass)
  AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'wf_sensitive_step_up'));
SELECT a3t.ok('anon and authenticated hold no privilege on the evidence table; the service role may read, insert and update, not delete',
  NOT has_table_privilege('anon', 'public.wf_sensitive_step_up', 'SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('authenticated', 'public.wf_sensitive_step_up', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.wf_sensitive_step_up', 'INSERT')
  AND has_table_privilege('service_role', 'public.wf_sensitive_step_up', 'SELECT,INSERT,UPDATE')
  AND NOT has_table_privilege('service_role', 'public.wf_sensitive_step_up', 'DELETE'));
SELECT a3t.ok('no role can execute the spend, the digest or the guard directly',
  NOT has_function_privilege('anon', 'public.wf_step_up_consume(uuid,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.wf_step_up_consume(uuid,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.wf_step_up_consume(uuid,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.wf_step_up_digest(text,text[])', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.wf_sensitive_step_up_guard()', 'EXECUTE'));
SELECT a3t.ok('the promotion function is still closed to anon and authenticated',
  NOT has_function_privilege('anon', 'public.wf_autonomy_promote(uuid,uuid,text,text,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.wf_autonomy_promote(uuid,uuid,text,text,uuid,text)', 'EXECUTE'));
SELECT a3t.refused('an evidence row cannot be longer than five minutes',
  $q$INSERT INTO public.wf_sensitive_step_up (user_id, action_kind, subject_digest, expires_at) VALUES (gen_random_uuid(), 'agent_promotion', repeat('a', 64), now() + interval '6 minutes')$q$, '23514');
SELECT a3t.refused('an evidence row needs a 64-character hex digest and a known kind',
  $q$INSERT INTO public.wf_sensitive_step_up (user_id, action_kind, subject_digest, expires_at) VALUES (gen_random_uuid(), 'agent_promotion', 'short', now() + interval '1 minute')$q$, '23514');
SELECT a3t.refused('an unknown kind is refused',
  $q$INSERT INTO public.wf_sensitive_step_up (user_id, action_kind, subject_digest, expires_at) VALUES (gen_random_uuid(), 'anything', repeat('a', 64), now() + interval '1 minute')$q$, '23514');

-- 2. The digest: fixed for the same input, different for any change; a value the TypeScript side reproduces
SELECT a3t.ok('the digest is the SHA-256 of kind, unit separator and parts, and it changes with every part',
  public.wf_step_up_digest('agent_promotion', ARRAY['o', 'a', 'draft', 'e']) = encode(sha256(convert_to('agent_promotion' || chr(31) || 'o' || chr(31) || 'a' || chr(31) || 'draft' || chr(31) || 'e', 'UTF8')), 'hex')
  AND public.wf_step_up_digest('agent_promotion', ARRAY['o', 'a', 'draft', 'e']) <> public.wf_step_up_digest('agent_promotion', ARRAY['o', 'a', 'draft', 'f'])
  AND public.wf_step_up_digest('agent_promotion', ARRAY['o', 'a', 'draft', 'e']) <> public.wf_step_up_digest('production_change', ARRAY['o', 'a', 'draft', 'e'])
  AND public.wf_step_up_digest('agent_promotion', ARRAY['o', 'a', 'draft', 'e']) <> public.wf_step_up_digest('agent_promotion', ARRAY['o', 'ad', 'raft', 'e']));
SELECT a3t.ok('published test vector (the TypeScript test checks the same value)',
  public.wf_step_up_digest('agent_promotion', ARRAY['11111111-1111-4111-8111-111111111111', 'ledger', 'draft', '22222222-2222-4222-8222-222222222222'])
  = 'e3fc9ac43e968fb9ce45297bd24ca2bfc758a0044078812c9e4888295147c866');

-- 3. Spending, as the server's database function would
CREATE TABLE a3t.k (name text PRIMARY KEY, v uuid);
GRANT ALL ON a3t.k TO anon, authenticated, service_role;
INSERT INTO a3t.k VALUES ('u1', 'a3000000-0000-4000-8000-000000000001'), ('u2', 'a3000000-0000-4000-8000-000000000002'),
  ('founder', 'a3000000-0000-4000-8000-0000000000f1'), ('orgA', 'a3a00000-0000-4000-8000-00000000000a');
CREATE FUNCTION a3t.id(p text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT v FROM a3t.k WHERE name = p $$;
GRANT EXECUTE ON FUNCTION a3t.id(text) TO anon, authenticated, service_role;
CREATE FUNCTION a3t.d(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
SELECT a3t.refused('no evidence: the spend is refused', format($q$SELECT public.wf_step_up_consume(%L, 'agent_promotion', %L)$q$, a3t.id('u1'), a3t.d('x1')), '42501', 'a3:step_up_required');
SELECT a3t.su(a3t.id('u1'), a3t.d('x2'));
SELECT a3t.ok('fresh matching evidence is spent', public.wf_step_up_consume(a3t.id('u1'), 'agent_promotion', a3t.d('x2')) IS NOT NULL);
SELECT a3t.ok('and stamped as used', (SELECT used_at IS NOT NULL FROM public.wf_sensitive_step_up WHERE subject_digest = a3t.d('x2')));
SELECT a3t.refused('the same evidence cannot be spent twice', format($q$SELECT public.wf_step_up_consume(%L, 'agent_promotion', %L)$q$, a3t.id('u1'), a3t.d('x2')), '42501', 'a3:step_up_required');
SELECT a3t.su(a3t.id('u1'), a3t.d('x3'));
SELECT a3t.refused('another person cannot spend it', format($q$SELECT public.wf_step_up_consume(%L, 'agent_promotion', %L)$q$, a3t.id('u2'), a3t.d('x3')), '42501', 'a3:step_up_required');
SELECT a3t.refused('it does not match other content', format($q$SELECT public.wf_step_up_consume(%L, 'agent_promotion', %L)$q$, a3t.id('u1'), a3t.d('x3-other')), '42501', 'a3:step_up_required');
SELECT a3t.refused('it does not match another kind', format($q$SELECT public.wf_step_up_consume(%L, 'production_change', %L)$q$, a3t.id('u1'), a3t.d('x3')), '42501', 'a3:step_up_required');
SELECT a3t.su(a3t.id('u1'), a3t.d('x4'), interval '10 minutes', interval '4 minutes');
SELECT a3t.refused('an expired step-up (verified ten minutes ago) is refused', format($q$SELECT public.wf_step_up_consume(%L, 'agent_promotion', %L)$q$, a3t.id('u1'), a3t.d('x4')), '42501', 'a3:step_up_required');
SELECT a3t.su(a3t.id('u1'), a3t.d('x5'));
UPDATE public.wf_sensitive_step_up SET revoked_at = now() WHERE subject_digest = a3t.d('x5');
SELECT a3t.refused('a revoked step-up is refused', format($q$SELECT public.wf_step_up_consume(%L, 'agent_promotion', %L)$q$, a3t.id('u1'), a3t.d('x5')), '42501', 'a3:step_up_required');
SELECT a3t.refused('evidence fields cannot be edited', $q$UPDATE public.wf_sensitive_step_up SET user_id = gen_random_uuid() WHERE subject_digest = (SELECT a3t.d('x3'))$q$, '42501', 'immutable');
SELECT a3t.refused('a spent step-up cannot be un-spent', $q$UPDATE public.wf_sensitive_step_up SET used_at = NULL WHERE subject_digest = (SELECT a3t.d('x2'))$q$, '42501', 'single use');
SELECT a3t.refused('evidence cannot be deleted', $q$DELETE FROM public.wf_sensitive_step_up$q$, '42501', 'append-only');
SELECT a3t.refused('evidence cannot be truncated', $q$TRUNCATE public.wf_sensitive_step_up$q$, '42501', 'append-only');
SELECT a3t.login_as('authenticated', a3t.id('u1'));
SELECT a3t.refused('a signed-in person cannot read the evidence table', $q$SELECT count(*) FROM public.wf_sensitive_step_up$q$, '42501');
SELECT a3t.refused('a signed-in person cannot write evidence for themselves', format($q$INSERT INTO public.wf_sensitive_step_up (user_id, action_kind, subject_digest, expires_at) VALUES (%L, 'agent_promotion', %L, now() + interval '1 minute')$q$, a3t.id('u1'), a3t.d('self')), '42501');
SELECT a3t.logout();

-- 4. The promotion path
INSERT INTO auth.users (id) VALUES (a3t.id('founder'));
INSERT INTO public.schools (id, name, slug) VALUES (a3t.id('orgA'), 'A3 Org A', 'a3-org-a');
INSERT INTO public.super_admins (id, full_name, email, is_active) VALUES (a3t.id('founder'), 'A3 Founder', 'founder@a3.invalid', true);
INSERT INTO public.wf_org_settings (org_id, workflows_enabled, autonomy_ceiling) VALUES (a3t.id('orgA'), true, 'act_and_report');
INSERT INTO public.agent_pause_rules (agent_code, tier, kill_scope) VALUES ('a3-agent', 'department', 'agent'), ('a3-other', 'department', 'agent');
INSERT INTO public.wf_agent (agent_ref, family, codename, agent_tier, accountable, supervisor, pack_version, max_tier, context_ceiling, daily_actions, daily_model_calls, daily_cost_cap_minor)
VALUES ('a3-agent', 'platform', 'Fixture', 'department', 'fixture', 'jarvis-executive', '1.0.0', 'T3', 'internal', 100000, 0, 0),
       ('a3-other', 'platform', 'Fixture', 'department', 'fixture', 'jarvis-executive', '1.0.0', 'T3', 'internal', 100000, 0, 0);
INSERT INTO public.wf_agent_platform_grant (org_id, agent_ref) VALUES (a3t.id('orgA'), 'a3-agent'), (a3t.id('orgA'), 'a3-other');
CREATE FUNCTION a3t.ev(p_agent text, p_name text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  v := public.wf_autonomy_record_evidence(p_agent, 'suite-' || p_agent, 20, 20, 0, 0, now() - interval '1 hour', a3t.d('a3:' || p_name));
  RETURN (v ->> 'evidence_id')::uuid;
END $$;
GRANT EXECUTE ON FUNCTION a3t.ev(text, text) TO service_role;
CREATE FUNCTION a3t.dig(p_org uuid, p_agent text, p_to text, p_ev uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.wf_step_up_digest('agent_promotion', ARRAY[p_org::text, p_agent, p_to, p_ev::text])
$$;
GRANT EXECUTE ON FUNCTION a3t.dig(uuid, text, text, uuid) TO service_role;
CREATE FUNCTION a3t.lvl(p_agent text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT earned_level FROM public.wf_agent_autonomy WHERE org_id = a3t.id('orgA') AND agent_ref = p_agent), 'suggest')
$$;
GRANT EXECUTE ON FUNCTION a3t.lvl(text) TO service_role;
SELECT a3t.login_as('service_role');
INSERT INTO a3t.k VALUES ('ev1', a3t.ev('a3-agent', 'one')), ('ev2', a3t.ev('a3-other', 'two'));
SELECT a3t.refused('a promotion with no step-up is refused and changes nothing',
  format($q$SELECT public.wf_autonomy_promote(%L, %L, 'a3-agent', 'draft', %L, 'A3 harness promotion on evidence')$q$, a3t.id('founder'), a3t.id('orgA'), a3t.id('ev1')), '42501', 'a3:step_up_required');
SELECT a3t.ok('the level is unchanged and no change row was written',
  a3t.lvl('a3-agent') = 'suggest' AND NOT EXISTS (SELECT 1 FROM public.wf_autonomy_change WHERE agent_ref = 'a3-agent'));
-- a step-up for another level, another agent, another person, another organisation's id: all refused
SELECT a3t.su(a3t.id('founder'), a3t.dig(a3t.id('orgA'), 'a3-agent', 'act_with_approval', a3t.id('ev1')));
SELECT a3t.su(a3t.id('founder'), a3t.dig(a3t.id('orgA'), 'a3-other', 'draft', a3t.id('ev1')));
SELECT a3t.su(a3t.id('u1'), a3t.dig(a3t.id('orgA'), 'a3-agent', 'draft', a3t.id('ev1')));
SELECT a3t.su(a3t.id('founder'), a3t.dig(gen_random_uuid(), 'a3-agent', 'draft', a3t.id('ev1')));
SELECT a3t.refused('a step-up for a different level, agent, person or organisation does not promote',
  format($q$SELECT public.wf_autonomy_promote(%L, %L, 'a3-agent', 'draft', %L, 'A3 harness promotion on evidence')$q$, a3t.id('founder'), a3t.id('orgA'), a3t.id('ev1')), '42501', 'a3:step_up_required');
-- a refused promotion does not burn the matching step-up
SELECT a3t.su(a3t.id('founder'), a3t.dig(a3t.id('orgA'), 'a3-agent', 'draft', a3t.id('ev1')));
SELECT a3t.refused('a promotion refused for another reason (reason too short) fails',
  format($q$SELECT public.wf_autonomy_promote(%L, %L, 'a3-agent', 'draft', %L, 'short')$q$, a3t.id('founder'), a3t.id('orgA'), a3t.id('ev1')), '23514');
SELECT a3t.ok('and it did not spend the matching step-up',
  (SELECT used_at IS NULL FROM public.wf_sensitive_step_up WHERE user_id = a3t.id('founder') AND subject_digest = a3t.dig(a3t.id('orgA'), 'a3-agent', 'draft', a3t.id('ev1')) ORDER BY verified_at DESC LIMIT 1));
SELECT a3t.ok('with the matching step-up the founder promotes',
  (public.wf_autonomy_promote(a3t.id('founder'), a3t.id('orgA'), 'a3-agent', 'draft', a3t.id('ev1'), 'A3 harness promotion on evidence') ->> 'to') = 'draft');
SELECT a3t.ok('and the agent is now at draft', a3t.lvl('a3-agent') = 'draft');
SELECT a3t.ok('the step-up is now spent and the promotion is in the ledger',
  (SELECT used_at IS NOT NULL FROM public.wf_sensitive_step_up WHERE user_id = a3t.id('founder') AND subject_digest = a3t.dig(a3t.id('orgA'), 'a3-agent', 'draft', a3t.id('ev1')) ORDER BY verified_at DESC LIMIT 1)
  AND EXISTS (SELECT 1 FROM public.wf_autonomy_change WHERE agent_ref = 'a3-agent' AND kind = 'promote' AND to_level = 'draft'));
SELECT a3t.ok('the other agent was untouched by it', a3t.lvl('a3-other') = 'suggest');
SELECT a3t.logout();

-- 5. Demotion stays quick and needs no step-up (the safe direction)
SELECT a3t.login_as('service_role');
SELECT a3t.ok('the founder can demote without a step-up',
  (public.wf_autonomy_demote(a3t.id('founder'), a3t.id('orgA'), 'a3-agent', 'suggest', 'A3 harness demotion for the test') ->> 'to') = 'suggest');
SELECT a3t.ok('and the agent is back at suggest', a3t.lvl('a3-agent') = 'suggest');
SELECT a3t.logout();

-- 6. The classes WF-07 already gates stay gated: they cannot be approved without a step-up, and cannot be run below high risk
SELECT a3t.ok('money, safeguarding, credentials, publishing, mass messages and authority sharing are capped classes',
  public.wf_is_capped_category('money_movement') AND public.wf_is_capped_category('safeguarding')
  AND public.wf_is_capped_category('credential_change') AND public.wf_is_capped_category('public_publish')
  AND public.wf_is_capped_category('mass_message') AND public.wf_is_capped_category('external_authority_share')
  AND NOT public.wf_is_capped_category('attendance_note'));
SELECT a3t.ok('a high-risk approving vote without a step-up is refused by the table itself',
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wf_approval_decision_step_up_required' AND conrelid = 'public.wf_approval_decision'::regclass));

DO $done$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM a3t.passed;
  RAISE NOTICE 'A3 ALL PASS: % checks', n;
END $done$;
ROLLBACK;
