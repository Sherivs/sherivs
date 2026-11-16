-- SV1-JARVIS-02 approval inbox (LOCAL, DISPOSABLE ONLY).
-- Run only after replaying repository migrations on a loopback disposable DB:
--   PGOPTIONS='-c jarvis02.test_disposable_database=on' psql -h 127.0.0.1 -p <port> \
--     -v ON_ERROR_STOP=1 -f tests/integration/jarvis02-approval-inbox.local.sql <db>
-- Runs in a transaction that is rolled back; never applies migrations or uses a live DB.
BEGIN;

DO $guard$
BEGIN
  IF coalesce(current_setting('jarvis02.test_disposable_database', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'JARVIS02: set jarvis02.test_disposable_database=on to confirm a disposable DB';
  END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'JARVIS02: must run as a superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NOT NULL
     AND NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'JARVIS02: refusing non-loopback server address %', inet_server_addr();
  END IF;
  IF to_regclass('public.jarvis_approval_requests') IS NULL
     OR to_regclass('public.jarvis_approval_events') IS NULL THEN
    RAISE EXCEPTION 'JARVIS02 migration is not applied';
  END IF;
END
$guard$;

CREATE TEMP TABLE results (name text PRIMARY KEY, ok boolean NOT NULL, detail text);
GRANT ALL ON results TO PUBLIC;

-- expect(name, sql, sqlstate_or_null): runs sql as the current role; ok when it raises the state (or succeeds when null)
CREATE FUNCTION pg_temp.expect(p_name text, p_sql text, p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
    INSERT INTO results VALUES (p_name, p_state IS NULL, CASE WHEN p_state IS NULL THEN 'succeeded' ELSE 'unexpectedly succeeded' END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO results VALUES (p_name, p_state IS NOT NULL AND SQLSTATE = p_state, SQLSTATE || ' ' || SQLERRM);
  END;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.expect(text, text, text) TO PUBLIC;

-- Fixtures (synthetic) --------------------------------------------------------
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-0000000000a1'),  -- active platform staff
  ('00000000-0000-0000-0000-0000000000a2');  -- not staff
INSERT INTO public.platform_staff (id, email, full_name, status)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'staff@example.test', 'Synthetic Staff', 'active');

-- RLS is enabled and forced on both tables
INSERT INTO results SELECT 'rls enabled+forced: requests', relrowsecurity AND relforcerowsecurity, '' FROM pg_class WHERE oid = 'public.jarvis_approval_requests'::regclass;
INSERT INTO results SELECT 'rls enabled+forced: events', relrowsecurity AND relforcerowsecurity, '' FROM pg_class WHERE oid = 'public.jarvis_approval_events'::regclass;

-- Server-side writes (as service_role) ----------------------------------------
SET LOCAL ROLE service_role;
INSERT INTO public.jarvis_approval_requests
  (approval_id, idempotency_key, action_id, action_ref, agent_definition_id, requester_ref, platform_ref, risk_tier, preconditions_digest, requested_at, expires_at)
VALUES
  ('ap-t3', 'k-t3', 'change_subscription', 'ref-1', 'agent-ops', 'identity-agent-ops', 'coregrid', 'T3', 'sha256:a', now(), now() + interval '1 hour'),
  ('ap-t2', 'k-t2', 'send_customer_communications', 'ref-2', 'agent-ops', 'identity-agent-ops', 'coregrid', 'T2', 'sha256:a', now(), now() + interval '1 hour'),
  ('ap-old', 'k-old', 'change_subscription', 'ref-3', 'agent-ops', 'identity-agent-ops', 'coregrid', 'T3', 'sha256:a', now() - interval '2 hours', now() - interval '1 hour');
INSERT INTO public.jarvis_approval_events (approval_id, kind, actor_ref) VALUES ('ap-t3', 'requested', 'identity-agent-ops');

SELECT pg_temp.expect('idempotency key is unique',
  $q$INSERT INTO public.jarvis_approval_requests (approval_id, idempotency_key, action_id, action_ref, agent_definition_id, requester_ref, platform_ref, risk_tier, preconditions_digest, expires_at)
     VALUES ('dup', 'k-t3', 'change_subscription', 'x', 'a', 'r', 'coregrid', 'T3', 'd', now() + interval '1 hour')$q$, '23505');
SELECT pg_temp.expect('only T2/T3 are storable',
  $q$INSERT INTO public.jarvis_approval_requests (approval_id, idempotency_key, action_id, action_ref, agent_definition_id, requester_ref, platform_ref, risk_tier, preconditions_digest, expires_at)
     VALUES ('t4', 'k-t4', 'disable_guardrails', 'x', 'a', 'r', 'coregrid', 'T4', 'd', now() + interval '1 hour')$q$, '23514');
SELECT pg_temp.expect('expiry window capped at 24h',
  $q$INSERT INTO public.jarvis_approval_requests (approval_id, idempotency_key, action_id, action_ref, agent_definition_id, requester_ref, platform_ref, risk_tier, preconditions_digest, expires_at)
     VALUES ('long', 'k-long', 'change_subscription', 'x', 'a', 'r', 'coregrid', 'T3', 'd', now() + interval '25 hours')$q$, '23514');

-- Decision laws ----------------------------------------------------------------
SELECT pg_temp.expect('T3 approve without passkey step-up is rejected',
  $q$UPDATE public.jarvis_approval_requests SET status='approved', decided_by='human-sheriff', decided_role='sheriff', decided_channel='console', decided_at=now(), passkey_step_up_verified=false WHERE approval_id='ap-t3'$q$, '23514');
SELECT pg_temp.expect('T3 approve by platform_staff is rejected',
  $q$UPDATE public.jarvis_approval_requests SET status='approved', decided_by='human-staff', decided_role='platform_staff', decided_channel='console', decided_at=now(), passkey_step_up_verified=true WHERE approval_id='ap-t3'$q$, '23514');
SELECT pg_temp.expect('approval from a phone channel is rejected',
  $q$UPDATE public.jarvis_approval_requests SET status='approved', decided_by='human-sheriff', decided_role='sheriff', decided_channel='voice', decided_at=now(), passkey_step_up_verified=true WHERE approval_id='ap-t3'$q$, '23514');
SELECT pg_temp.expect('self-approval is rejected',
  $q$UPDATE public.jarvis_approval_requests SET status='approved', decided_by='identity-agent-ops', decided_role='sheriff', decided_channel='console', decided_at=now(), passkey_step_up_verified=true WHERE approval_id='ap-t3'$q$, '23514');
SELECT pg_temp.expect('expired request cannot be approved',
  $q$UPDATE public.jarvis_approval_requests SET status='approved', decided_by='human-sheriff', decided_role='sheriff', decided_channel='console', decided_at=now(), passkey_step_up_verified=true WHERE approval_id='ap-old'$q$, '23514');
SELECT pg_temp.expect('request binding cannot be changed',
  $q$UPDATE public.jarvis_approval_requests SET preconditions_digest='sha256:evil' WHERE approval_id='ap-t3'$q$, '23514');
SELECT pg_temp.expect('pending cannot jump to executed',
  $q$UPDATE public.jarvis_approval_requests SET status='executed', executed_at=now() WHERE approval_id='ap-t3'$q$, '23514');
SELECT pg_temp.expect('T3 sheriff console passkey approval succeeds',
  $q$UPDATE public.jarvis_approval_requests SET status='approved', decided_by='human-sheriff', decided_role='sheriff', decided_channel='console', decided_at=now(), passkey_step_up_verified=true WHERE approval_id='ap-t3'$q$, NULL);
SELECT pg_temp.expect('T2 platform_staff console approval succeeds',
  $q$UPDATE public.jarvis_approval_requests SET status='approved', decided_by='human-staff', decided_role='platform_staff', decided_channel='console', decided_at=now() WHERE approval_id='ap-t2'$q$, NULL);
SELECT pg_temp.expect('a decided request cannot be re-decided (replay)',
  $q$UPDATE public.jarvis_approval_requests SET status='denied', decided_by='human-other', decided_role='sheriff', decided_channel='console', decided_at=now() WHERE approval_id='ap-t3'$q$, '23514');
SELECT pg_temp.expect('recorded decision cannot be rewritten on execution',
  $q$UPDATE public.jarvis_approval_requests SET status='executed', executed_at=now(), decided_by='someone-else' WHERE approval_id='ap-t3'$q$, '23514');
SELECT pg_temp.expect('approved executes once',
  $q$UPDATE public.jarvis_approval_requests SET status='executed', executed_at=now() WHERE approval_id='ap-t3'$q$, NULL);
SELECT pg_temp.expect('executed is terminal (no second execution)',
  $q$UPDATE public.jarvis_approval_requests SET status='approved' WHERE approval_id='ap-t3'$q$, '23514');
SELECT pg_temp.expect('service_role has no DELETE on requests',
  $q$DELETE FROM public.jarvis_approval_requests WHERE approval_id='ap-t3'$q$, '42501');
SELECT pg_temp.expect('service_role cannot UPDATE or DELETE events',
  $q$UPDATE public.jarvis_approval_events SET kind='deny'$q$, '42501');
SELECT pg_temp.expect('approve event requires console channel',
  $q$INSERT INTO public.jarvis_approval_events (approval_id, kind, channel) VALUES ('ap-t2', 'approve', 'sms')$q$, '23514');
RESET ROLE;

-- Defence in depth: even a privileged owner cannot rewrite or delete (triggers)
SELECT pg_temp.expect('owner cannot delete requests (trigger)',
  $q$DELETE FROM public.jarvis_approval_requests WHERE approval_id='ap-t3'$q$, '23514');
SELECT pg_temp.expect('owner cannot truncate requests (trigger)',
  $q$TRUNCATE public.jarvis_approval_requests CASCADE$q$, '23514');
SELECT pg_temp.expect('events are append-only for owner (update)',
  $q$UPDATE public.jarvis_approval_events SET kind='deny'$q$, '23514');
SELECT pg_temp.expect('events are append-only for owner (delete)',
  $q$DELETE FROM public.jarvis_approval_events$q$, '23514');

-- Access control ----------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
INSERT INTO results SELECT 'non-staff reads zero requests', count(*) = 0, count(*)::text FROM public.jarvis_approval_requests;
INSERT INTO results SELECT 'non-staff reads zero events', count(*) = 0, count(*)::text FROM public.jarvis_approval_events;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
INSERT INTO results SELECT 'platform staff can read requests', count(*) = 3, count(*)::text FROM public.jarvis_approval_requests;
SELECT pg_temp.expect('staff cannot write requests',
  $q$UPDATE public.jarvis_approval_requests SET status='denied' WHERE approval_id='ap-old'$q$, '42501');
SELECT pg_temp.expect('staff cannot insert requests',
  $q$INSERT INTO public.jarvis_approval_requests (approval_id, idempotency_key, action_id, action_ref, agent_definition_id, requester_ref, platform_ref, risk_tier, preconditions_digest, expires_at)
     VALUES ('s', 'k-s', 'change_subscription', 'x', 'a', 'r', 'coregrid', 'T3', 'd', now() + interval '1 hour')$q$, '42501');
SELECT pg_temp.expect('staff cannot insert events',
  $q$INSERT INTO public.jarvis_approval_events (approval_id, kind) VALUES ('ap-t3', 'requested')$q$, '42501');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.expect('anon has no access', $q$SELECT 1 FROM public.jarvis_approval_requests$q$, '42501');
RESET ROLE;

-- Report ------------------------------------------------------------------------
SELECT name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, detail FROM results ORDER BY ok, name;
DO $report$
DECLARE v_fail integer; v_total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT ok), count(*) INTO v_fail, v_total FROM results;
  IF v_fail > 0 THEN RAISE EXCEPTION 'JARVIS02 APPROVAL INBOX: % of % checks FAILED', v_fail, v_total; END IF;
  RAISE NOTICE 'JARVIS02 APPROVAL INBOX ALL PASS (% checks)', v_total;
END
$report$;
ROLLBACK;
