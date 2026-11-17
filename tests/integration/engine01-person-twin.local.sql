-- ENGINE-01 (LOCAL, DISPOSABLE DATABASE ONLY).
-- Replay repository migrations on a loopback disposable DB first. Synthetic data
-- only. Never target a hosted or production database. This test always rolls back.
BEGIN;

DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'ENGINE-01: must run as a superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'ENGINE-01: refusing non-loopback database server %', inet_server_addr();
  END IF;
  IF current_database() NOT LIKE 'engine_%' AND current_database() <> 'postgres'
     OR current_setting('coregrid.test_disposable_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'ENGINE-01: requires the named, explicitly marked disposable database';
  END IF;
  IF to_regclass('public.cg_role_pack') IS NULL OR to_regclass('public.cg_twin_person') IS NULL
     OR to_regclass('public.cg_twin_context') IS NULL OR to_regclass('public.cg_twin_trust') IS NULL THEN
    RAISE EXCEPTION 'ENGINE-01: engine tables missing';
  END IF;
  -- Posture: every engine table forced-RLS, deny-by-default for clients.
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid IN ('public.cg_role_pack'::regclass, 'public.cg_twin_person'::regclass,
                  'public.cg_twin_context'::regclass, 'public.cg_twin_trust'::regclass)
      AND NOT (relrowsecurity AND relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'ENGINE-01: RLS must be enabled and forced on every engine table';
  END IF;
  IF has_table_privilege('anon', 'public.cg_twin_person', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cg_role_pack', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cg_twin_context', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cg_twin_context', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cg_twin_trust', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cg_twin_trust', 'DELETE') THEN
    RAISE EXCEPTION 'ENGINE-01: client privileges exceed read-only own-passport posture';
  END IF;
  IF has_function_privilege('authenticated', 'public.cg_twin_ensure_context(uuid,text,text,text,text,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cg_twin_reconcile()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cg_twin_reconcile()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.cg_twin_reconcile()', 'EXECUTE') THEN
    RAISE EXCEPTION 'ENGINE-01: provisioning functions must be service-role-only';
  END IF;
END
$guard$;

CREATE SCHEMA eng_test;
GRANT USAGE ON SCHEMA eng_test TO authenticated, anon, service_role;

CREATE FUNCTION eng_test.login(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;

CREATE FUNCTION eng_test.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE 'RESET ROLE'; END $$;

CREATE FUNCTION eng_test.eq(p_label text, p_sql text, p_expected bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO v;
  IF v IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'ENGINE-01 FAIL [%]: expected %, got %', p_label, p_expected, v;
  END IF;
END $$;

CREATE FUNCTION eng_test.throws(p_label text, p_sql text, p_like text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE p_like THEN
      RAISE EXCEPTION 'ENGINE-01 FAIL [%]: wrong error: %', p_label, SQLERRM;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'ENGINE-01 FAIL [%]: expected an error, none raised', p_label;
END $$;

-- Pack factory: minimal valid definition, parameterised by capabilities.
CREATE FUNCTION eng_test.pack(p_code text, p_version text, p_kind text, p_caps jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'schema', 'sherivs.role-pack.v1', 'code', p_code, 'version', p_version, 'kind', p_kind,
    'title', 'Synthetic ' || p_code, 'permissions', jsonb_build_array('x.view'),
    'capabilities', p_caps, 'playbooks', '[]'::jsonb,
    'memory', jsonb_build_object('domains', jsonb_build_array('work'), 'maxSensitivity', 'internal',
                                 'retentionDays', 90, 'crossTenant', false),
    'budget', jsonb_build_object('dailyActions', 50, 'dailyModelCalls', 20, 'dailyCostCapMinor', 1000),
    'escalation', jsonb_build_object('defaultApprover', 'role_owner', 't3Approver', 'platform_staff'),
    'startsInShadow', true)
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA eng_test TO authenticated, anon, service_role;

-- Fixtures: three identities, two tenants (synthetic).
INSERT INTO auth.users (id) VALUES
  ('e1000000-0000-4000-8000-000000000001'),
  ('e1000000-0000-4000-8000-000000000002'),
  ('e1000000-0000-4000-8000-000000000003');
INSERT INTO public.schools (id, name, slug) VALUES
  ('e1100000-0000-4000-8000-0000000000a1', 'ENGINE Synthetic Tenant A', 'engine-a'),
  ('e1100000-0000-4000-8000-0000000000b1', 'ENGINE Synthetic Tenant B', 'engine-b');

-- Packs: teacher (T0/T1/T2), parent (T0), support platform pack (T0/T3).
SET LOCAL ROLE service_role;
INSERT INTO public.cg_role_pack (code, version, kind, applies_to, status, definition) VALUES
 ('teacher-pack', '1.0.0', 'tenant_role', ARRAY['teacher'], 'published',
   eng_test.pack('teacher-pack', '1.0.0', 'tenant_role', jsonb_build_array(
     jsonb_build_object('id','draft.note','title','Draft a note','tier','T0','autonomy','act_autonomously','requiresPermission','x.view'),
     jsonb_build_object('id','mark.attendance','title','Mark attendance','tier','T1','autonomy','act_autonomously','requiresPermission','x.view'),
     jsonb_build_object('id','msg.parent','title','Message parent','tier','T2','autonomy','act_with_approval','approver','role_owner','requiresPermission','x.view','promotableToAutonomous',true)))),
 ('parent-pack', '1.0.0', 'tenant_role', ARRAY['parent'], 'published',
   eng_test.pack('parent-pack', '1.0.0', 'tenant_role', jsonb_build_array(
     jsonb_build_object('id','summarise.child','title','Summarise child','tier','T0','autonomy','act_autonomously','requiresPermission','x.view')))),
 ('support-pack', '1.0.0', 'platform_role', ARRAY['support'], 'published',
   eng_test.pack('support-pack', '1.0.0', 'platform_role', jsonb_build_array(
     jsonb_build_object('id','triage.ticket','title','Triage ticket','tier','T1','autonomy','act_autonomously','requiresPermission','x.view'),
     jsonb_build_object('id','refund.account','title','Refund account','tier','T3','autonomy','act_with_approval','approver','sheriff','requiresPermission','x.view'))));
RESET ROLE;

-- 1. Pack invariants hold even against a service-role writer.
SET LOCAL ROLE service_role;
SELECT eng_test.throws('T4 undeclarable',
  $q$INSERT INTO public.cg_role_pack (code,version,kind,applies_to,status,definition) VALUES ('bad-t4','1.0.0','tenant_role',ARRAY['x'],'published',
     eng_test.pack('bad-t4','1.0.0','tenant_role', jsonb_build_array(jsonb_build_object('id','a.b','tier','T4','autonomy','propose_only'))))$q$,
  '%undeclarable tier%');
SELECT eng_test.throws('tenant pack cannot hold T3',
  $q$INSERT INTO public.cg_role_pack (code,version,kind,applies_to,status,definition) VALUES ('bad-t3','1.0.0','tenant_role',ARRAY['x'],'published',
     eng_test.pack('bad-t3','1.0.0','tenant_role', jsonb_build_array(jsonb_build_object('id','a.b','tier','T3','autonomy','act_with_approval'))))$q$,
  '%exceeds the tier ceiling%');
SELECT eng_test.throws('T2 cannot be declared autonomous',
  $q$INSERT INTO public.cg_role_pack (code,version,kind,applies_to,status,definition) VALUES ('bad-t2','1.0.0','tenant_role',ARRAY['x'],'published',
     eng_test.pack('bad-t2','1.0.0','tenant_role', jsonb_build_array(jsonb_build_object('id','a.b','tier','T2','autonomy','act_autonomously'))))$q$,
  '%autonomous above T1%');
SELECT eng_test.throws('cross-tenant memory undeclarable',
  $q$INSERT INTO public.cg_role_pack (code,version,kind,applies_to,status,definition) VALUES ('bad-mem','1.0.0','tenant_role',ARRAY['x'],'published',
     jsonb_set(eng_test.pack('bad-mem','1.0.0','tenant_role','[]'::jsonb), '{memory,crossTenant}', 'true'))$q$,
  '%cross-tenant memory%');
SELECT eng_test.throws('must start in shadow',
  $q$INSERT INTO public.cg_role_pack (code,version,kind,applies_to,status,definition) VALUES ('bad-shadow','1.0.0','tenant_role',ARRAY['x'],'published',
     jsonb_set(eng_test.pack('bad-shadow','1.0.0','tenant_role','[]'::jsonb), '{startsInShadow}', 'false'))$q$,
  '%start in shadow%');
SELECT eng_test.throws('published pack immutable',
  $q$UPDATE public.cg_role_pack SET definition = jsonb_set(definition, '{title}', '"tampered"') WHERE code='teacher-pack'$q$,
  '%immutable once published%');
SELECT eng_test.throws('published pack cannot be deleted',
  $q$DELETE FROM public.cg_role_pack WHERE code='teacher-pack'$q$, '%cannot be deleted%');
SELECT eng_test.throws('version must increase',
  $q$INSERT INTO public.cg_role_pack (code,version,kind,applies_to,status,definition) VALUES ('teacher-pack','1.0.0','tenant_role',ARRAY['teacher'],'published',
     eng_test.pack('teacher-pack','1.0.0','tenant_role','[]'::jsonb))$q$, '%must exceed published version%');
RESET ROLE;

-- 2. Invitation to ACTIVE membership creates the person, the context and shadow trust.
SET LOCAL ROLE service_role;
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'e1100000-0000-4000-8000-0000000000a1', 'ENGINE User 1', 'e1@example.invalid', 'teacher', true),
  ('e1000000-0000-4000-8000-000000000002', 'e1100000-0000-4000-8000-0000000000b1', 'ENGINE User 2', 'e2@example.invalid', 'parent', true);
INSERT INTO public.organization_memberships (user_id, school_id, role, is_primary, is_active) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'e1100000-0000-4000-8000-0000000000a1', 'teacher', true,  true),
  ('e1000000-0000-4000-8000-000000000002', 'e1100000-0000-4000-8000-0000000000b1', 'parent',  true,  true)
ON CONFLICT (user_id, school_id) DO NOTHING;
RESET ROLE;

SELECT eng_test.eq('one twin per identity (u1)',
  $q$SELECT 1 FROM public.cg_twin_person WHERE identity_id='e1000000-0000-4000-8000-000000000001'$q$, 1);
SELECT eng_test.eq('u1 teacher context active with pack',
  $q$SELECT 1 FROM public.cg_twin_context WHERE identity_id='e1000000-0000-4000-8000-000000000001'
       AND role_code='teacher' AND status='active' AND pack_code='teacher-pack' AND pack_version='1.0.0'$q$, 1);
SELECT eng_test.eq('trust seeded in shadow for all three capabilities',
  $q$SELECT 1 FROM public.cg_twin_trust t JOIN public.cg_twin_context c ON c.id=t.context_id
       WHERE c.identity_id='e1000000-0000-4000-8000-000000000001' AND c.role_code='teacher' AND t.state='shadow'$q$, 3);
SELECT eng_test.eq('provisioning audited',
  $q$SELECT 1 FROM public.audit_logs WHERE action='twin.context.ensure'
       AND new_value->>'identity_id'='e1000000-0000-4000-8000-000000000001'$q$, 1);

-- 3. One person, several memberships: ONE twin, isolated contexts.
SET LOCAL ROLE service_role;
INSERT INTO public.organization_memberships (user_id, school_id, role, is_primary, is_active) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'e1100000-0000-4000-8000-0000000000b1', 'parent', false, true);
RESET ROLE;
SELECT eng_test.eq('still exactly one twin for u1',
  $q$SELECT 1 FROM public.cg_twin_person WHERE identity_id='e1000000-0000-4000-8000-000000000001'$q$, 1);
SELECT eng_test.eq('u1 now has two contexts',
  $q$SELECT 1 FROM public.cg_twin_context WHERE identity_id='e1000000-0000-4000-8000-000000000001'$q$, 2);
SELECT eng_test.eq('context memory scopes are distinct and tenant-bound',
  $q$SELECT DISTINCT memory_scope_id, tenant_ref FROM public.cg_twin_context
       WHERE identity_id='e1000000-0000-4000-8000-000000000001'$q$, 2);
SELECT eng_test.eq('person core scope is in its own tenant namespace',
  $q$SELECT 1 FROM public.cg_twin_person p JOIN public.cg_memory_scope s ON s.id=p.memory_scope_id
       WHERE p.identity_id='e1000000-0000-4000-8000-000000000001' AND s.tenant_id LIKE 'person:%'
         AND s.tenant_id NOT IN (SELECT id::text FROM public.schools)$q$, 1);
SELECT eng_test.eq('no context scope shares a tenant with the person core',
  $q$SELECT 1 FROM public.cg_twin_context c JOIN public.cg_twin_person p ON p.id=c.twin_id
       WHERE c.tenant_ref = p.memory_tenant_ref$q$, 0);

-- 4. Idempotency: replaying provisioning changes nothing.
SET LOCAL ROLE service_role;
SELECT public.cg_twin_reconcile();
SELECT public.cg_twin_reconcile();
RESET ROLE;
SELECT eng_test.eq('reconcile twice: contexts unchanged for u1',
  $q$SELECT 1 FROM public.cg_twin_context WHERE identity_id='e1000000-0000-4000-8000-000000000001'$q$, 2);
SELECT eng_test.eq('reconcile twice: trust rows unchanged for u1 teacher',
  $q$SELECT 1 FROM public.cg_twin_trust t JOIN public.cg_twin_context c ON c.id=t.context_id
       WHERE c.identity_id='e1000000-0000-4000-8000-000000000001' AND c.role_code='teacher'$q$, 3);

-- 5. Deactivation suspends the context; the twin and memory survive. Reactivation keeps trust.
SET LOCAL ROLE service_role;
UPDATE public.cg_twin_trust t SET state='propose' FROM public.cg_twin_context c
 WHERE c.id=t.context_id AND c.identity_id='e1000000-0000-4000-8000-000000000001'
   AND c.role_code='teacher' AND t.capability_id='draft.note';
UPDATE public.organization_memberships SET is_active=false
 WHERE user_id='e1000000-0000-4000-8000-000000000001' AND school_id='e1100000-0000-4000-8000-0000000000a1';
RESET ROLE;
SELECT eng_test.eq('teacher context suspended',
  $q$SELECT 1 FROM public.cg_twin_context WHERE identity_id='e1000000-0000-4000-8000-000000000001'
       AND role_code='teacher' AND status='suspended'$q$, 1);
SELECT eng_test.eq('other context unaffected',
  $q$SELECT 1 FROM public.cg_twin_context WHERE identity_id='e1000000-0000-4000-8000-000000000001'
       AND role_code='parent' AND status='active'$q$, 1);
SELECT eng_test.eq('person twin survives',
  $q$SELECT 1 FROM public.cg_twin_person WHERE identity_id='e1000000-0000-4000-8000-000000000001'$q$, 1);
SET LOCAL ROLE service_role;
UPDATE public.organization_memberships SET is_active=true
 WHERE user_id='e1000000-0000-4000-8000-000000000001' AND school_id='e1100000-0000-4000-8000-0000000000a1';
RESET ROLE;
SELECT eng_test.eq('reactivated context active again',
  $q$SELECT 1 FROM public.cg_twin_context WHERE identity_id='e1000000-0000-4000-8000-000000000001'
       AND role_code='teacher' AND status='active'$q$, 1);
SELECT eng_test.eq('earned trust survived the suspension',
  $q$SELECT 1 FROM public.cg_twin_trust t JOIN public.cg_twin_context c ON c.id=t.context_id
       WHERE c.identity_id='e1000000-0000-4000-8000-000000000001' AND c.role_code='teacher'
         AND t.capability_id='draft.note' AND t.state='propose'$q$, 1);

-- 6. A role without a published pack still gets a twin context; the pack binds on publish.
SET LOCAL ROLE service_role;
INSERT INTO public.organization_memberships (user_id, school_id, role, is_primary, is_active) VALUES
  ('e1000000-0000-4000-8000-000000000003', 'e1100000-0000-4000-8000-0000000000a1', 'driver', true, true);
RESET ROLE;
SELECT eng_test.eq('driver context waits for a pack',
  $q$SELECT 1 FROM public.cg_twin_context WHERE identity_id='e1000000-0000-4000-8000-000000000003'
       AND status='pending_pack' AND pack_code IS NULL$q$, 1);
SET LOCAL ROLE service_role;
INSERT INTO public.cg_role_pack (code, version, kind, applies_to, status, definition) VALUES
 ('driver-pack', '1.0.0', 'tenant_role', ARRAY['driver'], 'published',
   eng_test.pack('driver-pack', '1.0.0', 'tenant_role', jsonb_build_array(
     jsonb_build_object('id','route.alert','title','Route alert','tier','T0','autonomy','act_autonomously','requiresPermission','x.view'))));
RESET ROLE;
SELECT eng_test.eq('publishing the pack binds the waiting context',
  $q$SELECT 1 FROM public.cg_twin_context WHERE identity_id='e1000000-0000-4000-8000-000000000003'
       AND status='active' AND pack_code='driver-pack'$q$, 1);
SELECT eng_test.eq('and seeds its trust in shadow',
  $q$SELECT 1 FROM public.cg_twin_trust t JOIN public.cg_twin_context c ON c.id=t.context_id
       WHERE c.identity_id='e1000000-0000-4000-8000-000000000003' AND t.state='shadow'$q$, 1);

-- 7. Role change moves the context; the old one is suspended, never deleted.
SET LOCAL ROLE service_role;
UPDATE public.organization_memberships SET role='parent'
 WHERE user_id='e1000000-0000-4000-8000-000000000003' AND school_id='e1100000-0000-4000-8000-0000000000a1';
RESET ROLE;
SELECT eng_test.eq('old role context suspended, new role context active',
  $q$SELECT 1 FROM public.cg_twin_context WHERE identity_id='e1000000-0000-4000-8000-000000000003'
       AND ((role_code='driver' AND status='suspended') OR (role_code='parent' AND status='active'))$q$, 2);

-- 8. Platform staff: an invitation alone creates nothing; activation does.
SET LOCAL ROLE service_role;
INSERT INTO public.platform_staff (id, email, full_name, status) VALUES
  ('e1000000-0000-4000-8000-000000000002', 'staff-e2@example.invalid', 'ENGINE Staff Two', 'invited');
INSERT INTO public.platform_staff_roles (staff_id, role_code) VALUES
  ('e1000000-0000-4000-8000-000000000002', 'support');
RESET ROLE;
SELECT eng_test.eq('invited staff has no platform context yet',
  $q$SELECT 1 FROM public.cg_twin_context WHERE identity_id='e1000000-0000-4000-8000-000000000002'
       AND context_kind='platform_staff'$q$, 0);
SET LOCAL ROLE service_role;
UPDATE public.platform_staff SET status='active', activated_at=now()
 WHERE id='e1000000-0000-4000-8000-000000000002';
RESET ROLE;
SELECT eng_test.eq('activation creates the platform context on the SAME person twin',
  $q$SELECT 1 FROM public.cg_twin_context c JOIN public.cg_twin_person p ON p.id=c.twin_id
       WHERE c.identity_id='e1000000-0000-4000-8000-000000000002' AND c.context_kind='platform_staff'
         AND c.tenant_ref='sherivs-platform' AND c.status='active' AND c.pack_code='support-pack'$q$, 1);
SELECT eng_test.eq('same person still has exactly one twin (tenant parent + platform support)',
  $q$SELECT 1 FROM public.cg_twin_person WHERE identity_id='e1000000-0000-4000-8000-000000000002'$q$, 1);
SET LOCAL ROLE service_role;
UPDATE public.platform_staff SET status='suspended' WHERE id='e1000000-0000-4000-8000-000000000002';
RESET ROLE;
SELECT eng_test.eq('suspended staff context suspended',
  $q$SELECT 1 FROM public.cg_twin_context WHERE identity_id='e1000000-0000-4000-8000-000000000002'
       AND context_kind='platform_staff' AND status='suspended'$q$, 1);

-- 9. Trust ladder cannot be bent, even by the service role.
SET LOCAL ROLE service_role;
SELECT eng_test.throws('cannot skip a rung',
  $q$UPDATE public.cg_twin_trust t SET state='assist' FROM public.cg_twin_context c
      WHERE c.id=t.context_id AND c.identity_id='e1000000-0000-4000-8000-000000000001' AND c.role_code='teacher'
        AND t.capability_id='mark.attendance'$q$, '%one rung at a time%');
SELECT eng_test.throws('T2 autonomy needs a sheriff promotion',
  $q$UPDATE public.cg_twin_trust t SET state='autonomous' FROM public.cg_twin_context c
      WHERE c.id=t.context_id AND c.identity_id='e1000000-0000-4000-8000-000000000001' AND c.role_code='teacher'
        AND t.capability_id='msg.parent'$q$, '%one rung at a time%');
UPDATE public.cg_twin_trust t SET state='propose' FROM public.cg_twin_context c
 WHERE c.id=t.context_id AND c.identity_id='e1000000-0000-4000-8000-000000000001' AND c.role_code='teacher' AND t.capability_id='msg.parent';
UPDATE public.cg_twin_trust t SET state='assist' FROM public.cg_twin_context c
 WHERE c.id=t.context_id AND c.identity_id='e1000000-0000-4000-8000-000000000001' AND c.role_code='teacher' AND t.capability_id='msg.parent';
SELECT eng_test.throws('T2 to autonomous without promotion refused',
  $q$UPDATE public.cg_twin_trust t SET state='autonomous' FROM public.cg_twin_context c
      WHERE c.id=t.context_id AND c.identity_id='e1000000-0000-4000-8000-000000000001' AND c.role_code='teacher'
        AND t.capability_id='msg.parent'$q$, '%sheriff promotion%');
UPDATE public.cg_twin_trust t SET state='autonomous', sheriff_promotion_id='promo-synthetic-1' FROM public.cg_twin_context c
 WHERE c.id=t.context_id AND c.identity_id='e1000000-0000-4000-8000-000000000001' AND c.role_code='teacher' AND t.capability_id='msg.parent';
SELECT eng_test.throws('tier is immutable',
  $q$UPDATE public.cg_twin_trust SET tier='T0' WHERE capability_id='msg.parent'$q$, '%immutable%');
RESET ROLE;
-- Demotion clears the promotion.
SET LOCAL ROLE service_role;
UPDATE public.cg_twin_trust t SET state='shadow' FROM public.cg_twin_context c
 WHERE c.id=t.context_id AND c.identity_id='e1000000-0000-4000-8000-000000000001' AND c.role_code='teacher' AND t.capability_id='msg.parent';
RESET ROLE;
SELECT eng_test.eq('demotion wipes the sheriff promotion',
  $q$SELECT 1 FROM public.cg_twin_trust WHERE capability_id='msg.parent' AND state='shadow' AND sheriff_promotion_id IS NULL$q$, 1);
-- T3 can never be autonomous: walk the ladder to assist, then try autonomous.
SET LOCAL ROLE service_role;
UPDATE public.cg_twin_trust t SET state='propose' FROM public.cg_twin_context c
 WHERE c.id=t.context_id AND c.identity_id='e1000000-0000-4000-8000-000000000002' AND c.role_code='support' AND t.capability_id='refund.account';
UPDATE public.cg_twin_trust t SET state='assist' FROM public.cg_twin_context c
 WHERE c.id=t.context_id AND c.identity_id='e1000000-0000-4000-8000-000000000002' AND c.role_code='support' AND t.capability_id='refund.account';
SELECT eng_test.throws('T3 can never be autonomous',
  $q$UPDATE public.cg_twin_trust t SET state='autonomous', sheriff_promotion_id='promo-x' FROM public.cg_twin_context c
      WHERE c.id=t.context_id AND c.identity_id='e1000000-0000-4000-8000-000000000002' AND c.role_code='support'
        AND t.capability_id='refund.account'$q$, '%T3%never be autonomous%');
RESET ROLE;

-- 10. Provisioning failure never blocks the membership change; reconcile repairs it.
-- Poison: a scope row with the id the engine will use but a different tenant makes
-- the context foreign key fail inside the trigger.
INSERT INTO public.cg_memory_scope (id, tenant_id, actor_scope, domains, max_sensitivity, declared_by) VALUES
  ('twin-context:e1000000-0000-4000-8000-000000000003:e1100000-0000-4000-8000-0000000000b1:parent',
   'poisoned-tenant', '[]', '[]', 'internal', 'harness');
SET LOCAL ROLE service_role;
INSERT INTO public.organization_memberships (user_id, school_id, role, is_primary, is_active) VALUES
  ('e1000000-0000-4000-8000-000000000003', 'e1100000-0000-4000-8000-0000000000b1', 'parent', false, true);
RESET ROLE;
SELECT eng_test.eq('membership row was created despite provisioning failure',
  $q$SELECT 1 FROM public.organization_memberships WHERE user_id='e1000000-0000-4000-8000-000000000003'
       AND school_id='e1100000-0000-4000-8000-0000000000b1'$q$, 1);
SELECT eng_test.eq('failure audited',
  $q$SELECT 1 FROM public.audit_logs WHERE action='twin.provision.failed'
       AND new_value->>'identity_id'='e1000000-0000-4000-8000-000000000003'$q$, 1);
DELETE FROM public.cg_memory_scope WHERE tenant_id='poisoned-tenant';
SET LOCAL ROLE service_role;
SELECT public.cg_twin_reconcile();
RESET ROLE;
SELECT eng_test.eq('reconcile repaired the missing context',
  $q$SELECT 1 FROM public.cg_twin_context WHERE identity_id='e1000000-0000-4000-8000-000000000003'
       AND tenant_ref='e1100000-0000-4000-8000-0000000000b1' AND status='active'$q$, 1);

-- 11. Isolation: each person reads only their own passport; nobody else's.
SELECT eng_test.login('e1000000-0000-4000-8000-000000000001');
SELECT eng_test.eq('u1 sees only their own twin', 'SELECT 1 FROM public.cg_twin_person', 1);
SELECT eng_test.eq('u1 sees only their own contexts',
  $q$SELECT 1 FROM public.cg_twin_context WHERE identity_id <> 'e1000000-0000-4000-8000-000000000001'$q$, 0);
SELECT eng_test.eq('u1 sees only their own trust rows',
  $q$SELECT 1 FROM public.cg_twin_trust t WHERE NOT EXISTS (
      SELECT 1 FROM public.cg_twin_context c WHERE c.id=t.context_id AND c.identity_id='e1000000-0000-4000-8000-000000000001')$q$, 0);
SELECT eng_test.throws('client cannot write a context',
  $q$INSERT INTO public.cg_twin_context (twin_id, identity_id, context_kind, tenant_ref, role_code, source_ref, memory_scope_id)
     SELECT id, identity_id, 'tenant_membership', 'x', 'y', 'z', memory_scope_id FROM public.cg_twin_person$q$,
  '%permission denied%');
SELECT eng_test.throws('client cannot promote trust',
  $q$UPDATE public.cg_twin_trust SET state='autonomous'$q$, '%permission denied%');
SELECT eng_test.throws('client cannot read role packs', 'SELECT 1 FROM public.cg_role_pack', '%permission denied%');
SELECT eng_test.throws('client cannot call provisioning',
  $q$SELECT public.cg_twin_reconcile()$q$, '%permission denied%');
SELECT eng_test.logout();

SELECT eng_test.login('e1000000-0000-4000-8000-000000000002');
SELECT eng_test.eq('u2 sees a different single twin', 'SELECT 1 FROM public.cg_twin_person', 1);
SELECT eng_test.eq('u2 cannot see u1 data',
  $q$SELECT 1 FROM public.cg_twin_context WHERE identity_id='e1000000-0000-4000-8000-000000000001'$q$, 0);
SELECT eng_test.logout();

SET LOCAL ROLE anon;
SELECT eng_test.throws('anon denied', 'SELECT 1 FROM public.cg_twin_person', '%permission denied%');
RESET ROLE;

ROLLBACK;
SELECT 'ENGINE-01 HARNESS PASSED' AS result;
