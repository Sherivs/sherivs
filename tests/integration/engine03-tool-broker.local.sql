-- ENGINE-03 (LOCAL, DISPOSABLE DATABASE ONLY). Synthetic data only; always rolls back.
BEGIN;
DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'ENGINE-03 FAIL: must run as superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'ENGINE-03 FAIL: refusing non-loopback server';
  END IF;
  IF current_database() NOT LIKE 'engine_%' AND current_database() <> 'postgres'
     OR current_setting('coregrid.test_disposable_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'ENGINE-03 FAIL: requires the marked disposable database';
  END IF;
  IF to_regclass('public.cg_tool_registry') IS NULL OR to_regclass('public.cg_connector_binding') IS NULL
     OR to_regclass('public.cg_tool_call_ledger') IS NULL OR to_regclass('public.cg_twin_context') IS NULL THEN
    RAISE EXCEPTION 'ENGINE-03 FAIL: tables missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.cg_tool_registry'::regclass,
       'public.cg_connector_binding'::regclass, 'public.cg_tool_call_ledger'::regclass)
       AND NOT (relrowsecurity AND relforcerowsecurity)) THEN
    RAISE EXCEPTION 'ENGINE-03 FAIL: RLS must be enabled and forced';
  END IF;
  IF has_table_privilege('anon', 'public.cg_tool_call_ledger', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cg_tool_call_ledger', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cg_connector_binding', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cg_tool_registry', 'SELECT')
     OR has_table_privilege('service_role', 'public.cg_tool_call_ledger', 'UPDATE')
     OR has_table_privilege('service_role', 'public.cg_tool_call_ledger', 'DELETE')
     OR has_table_privilege('service_role', 'public.cg_tool_call_ledger', 'TRUNCATE')
     OR has_table_privilege('service_role', 'public.cg_connector_binding', 'DELETE')
     OR has_function_privilege('authenticated', 'public.cg_tool_jsonb_has_secret_key(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ENGINE-03 FAIL: privilege posture exceeds deny-by-default';
  END IF;
END $guard$;

CREATE SCHEMA eng3;
CREATE FUNCTION eng3.throws(p_label text, p_sql text, p_like text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE p_like THEN
      RAISE EXCEPTION 'ENGINE-03 FAIL [%]: wrong error: %', p_label, SQLERRM;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'ENGINE-03 FAIL [%]: expected an error, none raised', p_label;
END $$;
CREATE FUNCTION eng3.pack(p_code text, p_caps jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'schema','sherivs.role-pack.v1','code',p_code,'version','1.0.0','kind','platform_role',
    'title','Synthetic '||p_code,'permissions',jsonb_build_array('x.view'),'capabilities',p_caps,
    'playbooks','[]'::jsonb,
    'memory',jsonb_build_object('domains',jsonb_build_array('work'),'maxSensitivity','internal','retentionDays',90,'crossTenant',false),
    'budget',jsonb_build_object('dailyActions',50,'dailyModelCalls',20,'dailyCostCapMinor',1000),
    'escalation',jsonb_build_object('defaultApprover','role_owner','t3Approver','sheriff'),
    'startsInShadow',true)
$$;
GRANT USAGE ON SCHEMA eng3 TO authenticated;

-- ---- fixtures ---------------------------------------------------------------
INSERT INTO auth.users (id) VALUES ('e3000000-0000-4000-8000-000000000001');
INSERT INTO public.cg_role_pack (code, version, kind, applies_to, status, definition) VALUES
 ('support-pack','1.0.0','platform_role',ARRAY['support'],'published',
  eng3.pack('support-pack', jsonb_build_array(
    jsonb_build_object('id','triage.ticket','title','Triage ticket','tier','T1','autonomy','act_autonomously','requiresPermission','x.view'))));
SELECT public.cg_twin_ensure_person('e3000000-0000-4000-8000-000000000001');
SELECT public.cg_twin_ensure_context('e3000000-0000-4000-8000-000000000001','platform_staff','sherivs-platform','support','e3-src',true);

INSERT INTO public.cg_tool_registry (tool_id,version,title,connector,direction,effect,tier,idempotent,max_calls_per_hour,platform_only) VALUES
 ('github.read','1.0.0','GitHub read','github','read','none','T0',true,600,false),
 ('slack.post.internal','1.0.0','Slack internal post','slack','write','internal_state','T1',true,60,true),
 ('email.send.customer','1.0.0','Email to a customer','email','write','customer_visible','T2',true,100,false),
 ('payments.refund.issue','1.0.0','Issue a refund','payments','write','money','T3',true,10,true);

-- ---- registry invariants ----------------------------------------------------
SELECT eng3.throws('T4 not registrable',
 $q$INSERT INTO public.cg_tool_registry VALUES ('bad.t4','1.0.0','Bad tool','github','write','legal','T4',true,1,true)$q$, '%violates check constraint%');
SELECT eng3.throws('tier below effect floor',
 $q$INSERT INTO public.cg_tool_registry (tool_id,version,title,connector,direction,effect,tier,idempotent,max_calls_per_hour,platform_only) VALUES ('bad.floor','1.0.0','Bad tool','payments','write','money','T1',true,1,true)$q$, '%cg_tool_registry_floor%');
SELECT eng3.throws('money must be platform only',
 $q$INSERT INTO public.cg_tool_registry (tool_id,version,title,connector,direction,effect,tier,idempotent,max_calls_per_hour,platform_only) VALUES ('bad.po','1.0.0','Bad tool','payments','write','money','T3',true,1,false)$q$, '%cg_tool_registry_platform_only%');
SELECT eng3.throws('T3 write must be idempotent',
 $q$INSERT INTO public.cg_tool_registry (tool_id,version,title,connector,direction,effect,tier,idempotent,max_calls_per_hour,platform_only) VALUES ('bad.idem','1.0.0','Bad tool','payments','write','money','T3',false,1,true)$q$, '%cg_tool_registry_t3_idempotent%');
SELECT eng3.throws('read with effect',
 $q$INSERT INTO public.cg_tool_registry (tool_id,version,title,connector,direction,effect,tier,idempotent,max_calls_per_hour,platform_only) VALUES ('bad.re','1.0.0','Bad tool','github','read','internal_state','T1',true,1,false)$q$, '%cg_tool_registry_direction_effect%');
SELECT eng3.throws('definition immutable',
 $q$UPDATE public.cg_tool_registry SET tier='T0' WHERE tool_id='slack.post.internal'$q$, '%immutable%');
SELECT eng3.throws('registry rows never deleted',
 $q$DELETE FROM public.cg_tool_registry WHERE tool_id='github.read'$q$, '%never deleted%');
UPDATE public.cg_tool_registry SET enabled=false WHERE tool_id='github.read';
UPDATE public.cg_tool_registry SET enabled=true WHERE tool_id='github.read';

-- ---- connector bindings hold references only --------------------------------
INSERT INTO public.cg_connector_binding (connector,scope,secret_ref) VALUES ('github','platform','vault://github/main#v1');
SELECT eng3.throws('a raw token is not a reference',
 $q$INSERT INTO public.cg_connector_binding (connector,scope,secret_ref) VALUES ('slack','platform','ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$q$, '%violates check constraint%');
SELECT eng3.throws('a token dressed as a reference is refused',
 $q$INSERT INTO public.cg_connector_binding (connector,scope,secret_ref) VALUES ('slack','platform','vault://slack/ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa#v1')$q$, '%cg_connector_binding_not_secret_shaped%');
SELECT eng3.throws('a long hex string dressed as a reference is refused',
 $q$INSERT INTO public.cg_connector_binding (connector,scope,secret_ref) VALUES ('slack','platform','vault://slack/ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12#v1')$q$, '%cg_connector_binding_not_secret_shaped%');
SELECT eng3.throws('namespace must match connector',
 $q$INSERT INTO public.cg_connector_binding (connector,scope,secret_ref) VALUES ('slack','platform','vault://github/main#v1')$q$, '%cg_connector_binding_namespace%');
SELECT eng3.throws('platform binding names no tenant',
 $q$INSERT INTO public.cg_connector_binding (connector,scope,tenant_ref,secret_ref) VALUES ('slack','platform','t1','vault://slack/main#v1')$q$, '%cg_connector_binding_scope_tenant%');
SELECT eng3.throws('tenant binding names its tenant',
 $q$INSERT INTO public.cg_connector_binding (connector,scope,secret_ref) VALUES ('slack','tenant','vault://slack/main#v1')$q$, '%cg_connector_binding_scope_tenant%');
SELECT eng3.throws('one active binding per scope',
 $q$INSERT INTO public.cg_connector_binding (connector,scope,secret_ref) VALUES ('github','platform','vault://github/other#v1')$q$, '%cg_connector_binding_one_active%');
SELECT eng3.throws('reference immutable',
 $q$UPDATE public.cg_connector_binding SET secret_ref='vault://github/other#v2' WHERE connector='github'$q$, '%immutable%');
UPDATE public.cg_connector_binding SET status='revoked' WHERE connector='github';
SELECT eng3.throws('revoked stays revoked',
 $q$UPDATE public.cg_connector_binding SET status='active' WHERE connector='github'$q$, '%cannot be reactivated%');
SELECT eng3.throws('bindings never deleted',
 $q$DELETE FROM public.cg_connector_binding WHERE connector='github'$q$, '%never deleted%');

-- ---- the ledger --------------------------------------------------------------
CREATE FUNCTION eng3.ctx() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM public.cg_twin_context LIMIT 1 $$;
CREATE FUNCTION eng3.dec(p_tool text, p_tier text, p_verdict text, p_key text DEFAULT NULL, p_deny text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.cg_tool_call_ledger (kind,twin_context_id,tenant_ref,tool_id,tool_version,tier,verdict,deny_code,args_digest,idempotency_key)
  VALUES ('decision', eng3.ctx(), 'sherivs-platform', p_tool, '1.0.0', p_tier, p_verdict, p_deny, repeat('a',64), p_key)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
CREATE FUNCTION eng3.out(p_parent uuid, p_tool text, p_tier text, p_outcome text, p_appr text DEFAULT NULL, p_kind text DEFAULT NULL, p_digest text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.cg_tool_call_ledger (kind,parent_id,twin_context_id,tenant_ref,tool_id,tool_version,tier,outcome,args_digest,approval_ref,approver_kind)
  VALUES ('outcome', p_parent, eng3.ctx(), 'sherivs-platform', p_tool, '1.0.0', p_tier, p_outcome, COALESCE(p_digest, repeat('a',64)), p_appr, p_kind);
END $$;

DO $t$
DECLARE d_exec uuid; d_shadow uuid; d_t3 uuid; d_q uuid; d_deny uuid;
BEGIN
  IF (SELECT status FROM public.cg_twin_context LIMIT 1) <> 'active' THEN
    RAISE EXCEPTION 'ENGINE-03 FAIL: fixture context must be active';
  END IF;

  d_exec := eng3.dec('slack.post.internal','T1','execute','k-exec');
  d_shadow := eng3.dec('slack.post.internal','T1','shadow','k-shadow');
  d_deny := eng3.dec('slack.post.internal','T1','deny','k-deny','rate_limited');
  d_q := eng3.dec('email.send.customer','T2','queue_approval','k-q');
  d_t3 := eng3.dec('payments.refund.issue','T3','sheriff_passkey','k-t3');

  PERFORM eng3.throws('idempotency is unique per context and tool',
    format($q$SELECT eng3.dec('slack.post.internal','T1','execute','k-exec')$q$), '%cg_tool_ledger_idempotency%');
  PERFORM eng3.throws('T3 cannot be logged as execute',
    $q$SELECT eng3.dec('payments.refund.issue','T3','execute','k-bad3')$q$, '%only be sheriff_passkey or deny%');
  PERFORM eng3.throws('logged tier must be the registry tier',
    $q$SELECT eng3.dec('payments.refund.issue','T1','execute','k-bad-tier')$q$, '%does not match registry tier%');
  PERFORM eng3.throws('a deny carries its code',
    $q$SELECT eng3.dec('slack.post.internal','T1','deny','k-nocode')$q$, '%cg_tool_ledger_deny_code%');
  PERFORM eng3.throws('secret keys never reach the ledger',
    $q$INSERT INTO public.cg_tool_call_ledger (kind,twin_context_id,tenant_ref,tool_id,tool_version,tier,verdict,args_digest,args_redacted)
       VALUES ('decision', eng3.ctx(), 'sherivs-platform','slack.post.internal','1.0.0','T1','shadow',repeat('b',64),'{"nested":{"api_key":"x"}}')$q$, '%args_redacted%');
  PERFORM eng3.throws('ledger tenant must match the context tenant',
    $q$INSERT INTO public.cg_tool_call_ledger (kind,twin_context_id,tenant_ref,tool_id,tool_version,tier,verdict,args_digest)
       VALUES ('decision', eng3.ctx(), 'other-tenant','slack.post.internal','1.0.0','T1','shadow',repeat('c',64))$q$, '%tenant does not match%');

  -- Outcomes
  PERFORM eng3.throws('a shadow decision never succeeds', format($q$SELECT eng3.out(%L,'slack.post.internal','T1','succeeded')$q$, d_shadow), '%can never produce a successful side effect%');
  PERFORM eng3.throws('a deny never succeeds', format($q$SELECT eng3.out(%L,'slack.post.internal','T1','succeeded')$q$, d_deny), '%can never produce a successful side effect%');
  PERFORM eng3.throws('digest must repeat', format($q$SELECT eng3.out(%L,'slack.post.internal','T1','succeeded',NULL,NULL,repeat('f',64))$q$, d_exec), '%repeat its decision%');
  PERFORM eng3.out(d_exec,'slack.post.internal','T1','succeeded');
  PERFORM eng3.throws('a decision succeeds once', format($q$SELECT eng3.out(%L,'slack.post.internal','T1','succeeded')$q$, d_exec), '%succeed only once%');
  PERFORM eng3.out(d_exec,'slack.post.internal','T1','failed');
  PERFORM eng3.throws('queued action needs its approval', format($q$SELECT eng3.out(%L,'email.send.customer','T2','succeeded')$q$, d_q), '%needs its approval reference%');
  PERFORM eng3.out(d_q,'email.send.customer','T2','succeeded','appr-1','role_owner');
  PERFORM eng3.throws('T3 needs a passkey approval', format($q$SELECT eng3.out(%L,'payments.refund.issue','T3','succeeded')$q$, d_t3), '%needs a sheriff approval%');
  PERFORM eng3.throws('T3 approval must be the sheriff', format($q$SELECT eng3.out(%L,'payments.refund.issue','T3','succeeded','appr-2','role_owner')$q$, d_t3), '%needs a sheriff approval%');
  PERFORM eng3.out(d_t3,'payments.refund.issue','T3','succeeded','appr-3','sheriff');
  PERFORM eng3.throws('an outcome must point at a decision',
    format($q$SELECT eng3.out((SELECT id FROM public.cg_tool_call_ledger WHERE kind='outcome' LIMIT 1),'slack.post.internal','T1','failed')$q$), '%point at a decision%');

  -- Append-only
  PERFORM eng3.throws('no update', $q$UPDATE public.cg_tool_call_ledger SET tier='T0'$q$, '%append-only%');
  PERFORM eng3.throws('no delete', $q$DELETE FROM public.cg_tool_call_ledger$q$, '%append-only%');
  PERFORM eng3.throws('no truncate', $q$TRUNCATE public.cg_tool_call_ledger CASCADE$q$, '%cg_tool_call_ledger is append-only%');

  -- A suspended context cannot be cleared to act.
  UPDATE public.cg_twin_context SET status = 'suspended';
  PERFORM eng3.throws('suspended context cannot execute',
    $q$SELECT eng3.dec('slack.post.internal','T1','execute','k-susp')$q$, '%only an active context%');
  PERFORM eng3.dec('slack.post.internal','T1','shadow','k-susp-shadow');
  UPDATE public.cg_twin_context SET status = 'active';

  -- Client roles see nothing.
  SET LOCAL ROLE authenticated;
  PERFORM eng3.throws('authenticated cannot read the ledger', $q$SELECT count(*) FROM public.cg_tool_call_ledger$q$, '%permission denied%');
  PERFORM eng3.throws('authenticated cannot read bindings', $q$SELECT count(*) FROM public.cg_connector_binding$q$, '%permission denied%');
  RESET ROLE;

  RAISE NOTICE 'ENGINE-03 HARNESS PASSED';
END $t$;
ROLLBACK;
