-- ENT-01 subscription authorization (LOCAL, DISPOSABLE ONLY).
-- Run only after replaying repository migrations on a loopback disposable DB (CI: migrations-sim, PostgreSQL 17), from the repository root:
--   psql "postgresql://postgres@127.0.0.1:<port>/<disposable_db>" -v ON_ERROR_STOP=1 \
--     -f tests/integration/ent-01-subscription-authorization.local.sql
-- Optional: -v apply_migration=1 applies (twice, to prove idempotency) the ENT-01 migration inside the test transaction first.
--   Use that on a database that does not yet carry the migration; the default (0) tests the database as it is.
-- Builds synthetic organizations and users inside ONE transaction and ends with ROLLBACK, so it leaves nothing behind.
-- Every check prints "ENT-01 PASS: <name>" or "ENT-01 FAIL: <name>"; any failure makes the script exit non-zero.
-- Every attempt runs under a realistic role (anon, authenticated with a JWT subject, service_role), so grants, row-level
-- security, triggers and the in-function authorization are all exercised.
\if :{?apply_migration}
\else
  \set apply_migration 0
\endif

BEGIN;

DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'ENT-01: must run as a superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NOT NULL
     AND NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet)
     AND coalesce(current_setting('ent01.allow_non_loopback', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'ENT-01: refusing non-loopback server address %', inet_server_addr();
  END IF;
  IF current_database() !~* '(disposable|scratch|local|test|sim|postgres|ent_01)' THEN
    RAISE EXCEPTION 'ENT-01: refusing database %, not a named disposable DB', current_database();
  END IF;
  IF to_regclass('public.schools') IS NULL OR to_regclass('public.org_entitlements') IS NULL
     OR to_regprocedure('public.create_organization_with_founder(text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'ENT-01: platform migrations are not applied';
  END IF;
END
$guard$;

CREATE SCHEMA ent01;
GRANT USAGE ON SCHEMA ent01 TO PUBLIC;
CREATE TABLE ent01.results (n serial, name text, ok boolean, detail text);
CREATE TABLE ent01.ctx (k text PRIMARY KEY, v text);
GRANT ALL ON ent01.results, ent01.ctx TO PUBLIC;

-- Snapshot of every organization that exists BEFORE the migration: the migration must not change any of them.
CREATE TABLE ent01.pre_schools AS
  SELECT id, subscription_tier, subscription_status, subscription_expires_at, monthly_fee, max_students, max_teachers FROM public.schools;
CREATE TABLE ent01.pre_ent AS SELECT org_id, plan_id FROM public.org_entitlements;

\if :apply_migration
  \i database/supabase/migrations/20261104051000_sherivs_ent01_subscription_authorization.sql
  \i database/supabase/migrations/20261104051000_sherivs_ent01_subscription_authorization.sql
\endif

CREATE FUNCTION ent01.expect(p_name text, p_ok boolean, p_detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO ent01.results (name, ok, detail) VALUES (p_name, coalesce(p_ok, false), p_detail);
  IF coalesce(p_ok, false) THEN RAISE NOTICE 'ENT-01 PASS: % [%]', p_name, p_detail;
  ELSE RAISE NOTICE 'ENT-01 FAIL: % [%]', p_name, p_detail; END IF;
END $$;

-- Run one statement under a realistic role and JWT; returns 'ok:<single text value>' or 'err:<sqlstate>:<message>'.
-- The statement runs in a sub-block, so a failure rolls back everything it did (the same way a failed RPC does).
CREATE FUNCTION ent01.call(p_role text, p_sub uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_sub IS NULL THEN json_build_object('role', p_role)::text
         ELSE json_build_object('sub', p_sub, 'role', p_role)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql INTO v;
    EXECUTE 'RESET ROLE';
    RETURN 'ok:' || coalesce(v, '');
  EXCEPTION WHEN others THEN
    EXECUTE 'RESET ROLE';
    RETURN 'err:' || SQLSTATE || ':' || SQLERRM;
  END;
END $$;

-- UPDATE one organization under a role; returns 'ok:<rows affected>' or 'err:...'
CREATE FUNCTION ent01.upd(p_role text, p_sub uuid, p_school uuid, p_set text) RETURNS text LANGUAGE sql AS $$
  SELECT ent01.call(p_role, p_sub,
    format('with u as (update public.schools set %s where id = %L returning 1) select count(*)::text from u', p_set, p_school))
$$;
CREATE FUNCTION ent01.tier(p_school uuid) RETURNS text LANGUAGE sql AS
$$ SELECT subscription_tier FROM public.schools WHERE id = p_school $$;
CREATE FUNCTION ent01.ctxid(p_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v::uuid FROM ent01.ctx WHERE k = p_k $$;
CREATE FUNCTION ent01.audit_n(p_school uuid) RETURNS bigint LANGUAGE sql AS
$$ SELECT count(*) FROM public.audit_logs WHERE school_id = p_school AND table_name = 'schools' AND action = 'subscription.change' $$;
-- Put the attack-target organization back to its fixture tier (owner role), so a later section never depends on an earlier failure.
CREATE FUNCTION ent01.reset_target() RETURNS void LANGUAGE sql AS
$$ UPDATE public.schools SET subscription_tier = 'trial' WHERE slug IN ('ent01-a', 'ent01-x') AND subscription_tier IS DISTINCT FROM 'trial' $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ent01 TO PUBLIC;

-- ---------------------------------------------------------------- fixtures (owner role, synthetic only)
CREATE FUNCTION ent01.mk_school(p_key text, p_tier text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  INSERT INTO public.schools (name, slug, subscription_tier) VALUES ('ENT01 ' || p_key, 'ent01-' || p_key, p_tier) RETURNING id INTO v;
  INSERT INTO ent01.ctx VALUES (p_key, v::text);
  RETURN v;
END $$;
CREATE FUNCTION ent01.mk_user(p_id text, p_school uuid, p_role text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid := ('00000000-0000-0000-0000-' || lpad(p_id, 12, '0'))::uuid;
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (v, p_id || '@ent01.test', now());
  INSERT INTO public.users (id, school_id, full_name, role, email, is_active)
  VALUES (v, p_school, 'ENT01 ' || p_id, p_role, p_id || '@ent01.test', true);
  RETURN v;
END $$;

DO $fx$
DECLARE a uuid; b uuid; c uuid; d uuid; e uuid; x uuid;
BEGIN
  a := ent01.mk_school('a', 'trial');       -- attack target: trial organization
  b := ent01.mk_school('b', 'starter');
  c := ent01.mk_school('c', 'growth');
  d := ent01.mk_school('d', 'professional');
  e := ent01.mk_school('e', 'enterprise');
  x := ent01.mk_school('x', 'trial');       -- a second tenant (cross-tenant attempts)
  INSERT INTO ent01.ctx VALUES
    ('u_admin',     ent01.mk_user('e1a001', a, 'admin')::text),
    ('u_principal', ent01.mk_user('e1a002', a, 'principal')::text),
    ('u_teacher',   ent01.mk_user('e1a003', a, 'teacher')::text),
    ('u_badmin',    ent01.mk_user('e1b001', b, 'admin')::text),
    ('u_xadmin',    ent01.mk_user('e1c001', x, 'admin')::text),
    ('u_cadmin',    ent01.mk_user('e1d001', c, 'admin')::text);
  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('00000000-0000-0000-0000-00000000e1ee', 'e1ee@ent01.test', now());
  INSERT INTO public.super_admins (id, full_name, email, is_active) VALUES ('00000000-0000-0000-0000-00000000e1ee', 'ENT01 Super', 'e1ee@ent01.test', true);
  INSERT INTO ent01.ctx VALUES ('u_super', '00000000-0000-0000-0000-00000000e1ee');
  -- an unlinked account that founds an organization through the customer self-serve path
  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('00000000-0000-0000-0000-00000000e1f0', 'e1f0@ent01.test', now());
  INSERT INTO ent01.ctx VALUES ('u_founder', '00000000-0000-0000-0000-00000000e1f0');
END $fx$;

-- ================================================================ A. a school administrator cannot elevate their own organization
-- Original defect: RLS admitted the school admin's UPDATE on the whole row and column grants allow tier/status/limit columns,
-- so one PATCH of subscription_tier promoted a trial organization to enterprise and the entitlement trigger granted its features.
DO $t$
DECLARE
  a uuid := ent01.ctxid('a'); adm uuid := ent01.ctxid('u_admin'); pri uuid := ent01.ctxid('u_principal'); r text; n0 bigint;
BEGIN
  n0 := ent01.audit_n(a);
  r := ent01.upd('authenticated', adm, a, $s$subscription_tier = 'enterprise'$s$);
  PERFORM ent01.expect('A1 school admin cannot set subscription_tier to enterprise', r LIKE 'err:42501:%' AND ent01.tier(a) = 'trial', r || ' tier=' || ent01.tier(a));
  PERFORM ent01.expect('A1b the entitlement plan of the organization is unchanged by the denied attempt',
    (SELECT plan_id FROM public.org_entitlements WHERE org_id = a) IN ('starter', 'trial'),
    (SELECT plan_id FROM public.org_entitlements WHERE org_id = a));
  r := ent01.upd('authenticated', adm, a, $s$subscription_tier = 'growth'$s$);
  PERFORM ent01.expect('A2 school admin cannot set subscription_tier to growth', r LIKE 'err:42501:%' AND ent01.tier(a) = 'trial', r);
  r := ent01.upd('authenticated', adm, a, $s$subscription_tier = 'starter'$s$);
  PERFORM ent01.expect('A3 school admin cannot change subscription_tier even sideways', r LIKE 'err:42501:%' AND ent01.tier(a) = 'trial', r);
  r := ent01.upd('authenticated', pri, a, $s$subscription_tier = 'enterprise'$s$);
  PERFORM ent01.expect('A4 a principal cannot set subscription_tier either', r LIKE 'err:42501:%' AND ent01.tier(a) = 'trial', r);
  r := ent01.upd('authenticated', adm, a, $s$subscription_status = 'expired'$s$);
  PERFORM ent01.expect('A5 school admin cannot change subscription_status', r LIKE 'err:42501:%', r);
  r := ent01.upd('authenticated', adm, a, $s$subscription_expires_at = now() + interval '10 years'$s$);
  PERFORM ent01.expect('A6 school admin cannot extend subscription_expires_at', r LIKE 'err:42501:%', r);
  r := ent01.upd('authenticated', adm, a, $s$monthly_fee = 0$s$);
  PERFORM ent01.expect('A7 school admin cannot change monthly_fee', r LIKE 'err:42501:%', r);
  r := ent01.upd('authenticated', adm, a, $s$max_students = 1000000$s$);
  PERFORM ent01.expect('A8 school admin cannot raise max_students', r LIKE 'err:42501:%', r);
  r := ent01.upd('authenticated', adm, a, $s$max_teachers = 1000000$s$);
  PERFORM ent01.expect('A9 school admin cannot raise max_teachers', r LIKE 'err:42501:%', r);
  r := ent01.upd('authenticated', adm, a, $s$subscription_tier = 'enterprise', subscription_status = 'active', max_students = 1000000$s$);
  PERFORM ent01.expect('A10 a combined elevation is denied as a whole', r LIKE 'err:42501:%' AND ent01.tier(a) = 'trial', r);
  PERFORM ent01.expect('A11 denied attempts leave no audit record and no partial change', ent01.audit_n(a) = n0, 'audit rows before=' || n0 || ' after=' || ent01.audit_n(a));
  r := ent01.upd('authenticated', adm, a, $s$subscription_tier = 'enterprise'$s$);
  PERFORM ent01.expect('A12 the denial does not depend on the value set (repeatable)', r LIKE 'err:42501:%', r);
END $t$;

-- A13-A17: ordinary school administration still works, so the guard is not a blanket lock-out
DO $t$
DECLARE a uuid := ent01.ctxid('a'); adm uuid := ent01.ctxid('u_admin'); r text; n0 bigint := ent01.audit_n(ent01.ctxid('a'));
BEGIN
  r := ent01.upd('authenticated', adm, a, $s$name = 'ENT01 a renamed'$s$);
  PERFORM ent01.expect('A13 school admin can still update non-commercial fields', r = 'ok:1' AND (SELECT name FROM public.schools WHERE id = a) = 'ENT01 a renamed', r);
  r := ent01.upd('authenticated', adm, a, $s$subscription_tier = subscription_tier, name = 'ENT01 a renamed again'$s$);
  PERFORM ent01.expect('A14 writing the unchanged tier value back (full-row form submit) is not an elevation and is allowed', r = 'ok:1', r);
  PERFORM ent01.expect('A15 non-commercial updates write no subscription audit record', ent01.audit_n(a) = n0, 'audit rows=' || ent01.audit_n(a));
  r := ent01.upd('authenticated', ent01.ctxid('u_teacher'), a, $s$name = 'ENT01 teacher rename'$s$);
  PERFORM ent01.expect('A16 a teacher still cannot update the organization (existing RLS preserved)', r = 'ok:0' OR r LIKE 'err:%', r);
  PERFORM ent01.expect('A17 the teacher attempt changed nothing', (SELECT name FROM public.schools WHERE id = a) = 'ENT01 a renamed again', (SELECT name FROM public.schools WHERE id = a));
END $t$;

-- ================================================================ B. cross-tenant and unauthenticated attempts
SELECT ent01.reset_target();
DO $t$
DECLARE a uuid := ent01.ctxid('a'); x uuid := ent01.ctxid('x'); r text; t_before text := ent01.tier(ent01.ctxid('x'));
BEGIN
  r := ent01.upd('authenticated', ent01.ctxid('u_admin'), x, $s$subscription_tier = 'enterprise'$s$);
  PERFORM ent01.expect('B1 an admin of one organization cannot elevate another organization', (r = 'ok:0' OR r LIKE 'err:%') AND ent01.tier(x) = t_before, r || ' tier=' || ent01.tier(x));
  r := ent01.upd('authenticated', ent01.ctxid('u_xadmin'), a, $s$subscription_tier = 'enterprise'$s$);
  PERFORM ent01.expect('B2 and the reverse direction', (r = 'ok:0' OR r LIKE 'err:%') AND ent01.tier(a) = 'trial', r || ' tier=' || ent01.tier(a));
  r := ent01.upd('anon', NULL, a, $s$subscription_tier = 'enterprise'$s$);
  PERFORM ent01.expect('B3 anon cannot elevate any organization', (r = 'ok:0' OR r LIKE 'err:%') AND ent01.tier(a) = 'trial', r);
  r := ent01.upd('authenticated', NULL, a, $s$subscription_tier = 'enterprise'$s$);
  PERFORM ent01.expect('B4 an authenticated session with no subject cannot elevate', (r = 'ok:0' OR r LIKE 'err:%') AND ent01.tier(a) = 'trial', r);
  -- a school admin cannot create an organization row with a paid tier directly
  r := ent01.call('authenticated', ent01.ctxid('u_admin'),
    $q$ insert into public.schools (name, slug, subscription_tier) values ('ENT01 forged', 'ent01-forged', 'enterprise') returning id::text $q$);
  PERFORM ent01.expect('B5 an authenticated user cannot insert an organization with an enterprise tier', r LIKE 'err:%'
    AND NOT EXISTS (SELECT 1 FROM public.schools WHERE slug = 'ent01-forged'), r);
  r := ent01.call('authenticated', ent01.ctxid('u_admin'),
    $q$ insert into public.schools (name, slug) values ('ENT01 forged2', 'ent01-forged2') returning id::text $q$);
  PERFORM ent01.expect('B6 an authenticated user cannot insert an organization at all', r LIKE 'err:%'
    AND NOT EXISTS (SELECT 1 FROM public.schools WHERE slug = 'ent01-forged2'), r);
END $t$;

-- ================================================================ C. authorized change paths still work
DO $t$
DECLARE c uuid := ent01.ctxid('c'); r text; n0 bigint; row_audit record;
BEGIN
  n0 := ent01.audit_n(c);
  r := ent01.upd('service_role', NULL, c, $s$subscription_tier = 'professional'$s$);
  PERFORM ent01.expect('C1 the trusted server path (service_role) can change a tier', r = 'ok:1' AND ent01.tier(c) = 'professional', r);
  PERFORM ent01.expect('C2 the entitlement plan follows the tier change', (SELECT plan_id FROM public.org_entitlements WHERE org_id = c) = 'growth',
    coalesce((SELECT plan_id FROM public.org_entitlements WHERE org_id = c), 'none'));
  PERFORM ent01.expect('C3 an authorized change writes one subscription audit record', ent01.audit_n(c) = n0 + 1, 'before=' || n0 || ' after=' || ent01.audit_n(c));
  SELECT * INTO row_audit FROM public.audit_logs WHERE school_id = c AND action = 'subscription.change' ORDER BY created_at DESC, id LIMIT 1;
  PERFORM ent01.expect('C4 the audit record shows old and new tier and carries no unrelated organization data',
    row_audit.old_value ->> 'subscription_tier' = 'growth' AND row_audit.new_value ->> 'subscription_tier' = 'professional'
    AND NOT (row_audit.new_value ? 'name') AND NOT (row_audit.new_value ? 'email') AND row_audit.record_id = c,
    coalesce(row_audit.old_value::text, 'none') || ' -> ' || coalesce(row_audit.new_value::text, 'none'));
  r := ent01.upd('authenticated', ent01.ctxid('u_super'), c, $s$subscription_tier = 'enterprise'$s$);
  PERFORM ent01.expect('C5 a platform super administrator can change a tier', r = 'ok:1' AND ent01.tier(c) = 'enterprise', r);
  PERFORM ent01.expect('C6 the super administrator change is audited with the actor',
    EXISTS (SELECT 1 FROM public.audit_logs WHERE school_id = c AND action = 'subscription.change'
            AND new_value ->> 'actor' = ent01.ctxid('u_super')::text AND new_value ->> 'subscription_tier' = 'enterprise'), 'audit actor recorded');
  r := ent01.upd('service_role', NULL, c, $s$subscription_status = 'suspended', max_students = 250$s$);
  PERFORM ent01.expect('C7 status and limits can be changed by the trusted server path', r = 'ok:1', r);
  r := ent01.upd('service_role', NULL, c, $s$subscription_tier = 'growth'$s$);
  PERFORM ent01.expect('C8 restoring the fixture tier (service_role) works', r = 'ok:1' AND ent01.tier(c) = 'growth', r);
END $t$;

-- ================================================================ D. new organizations start in Trial
DO $t$
DECLARE r text; v uuid; col_default text;
BEGIN
  SELECT column_default INTO col_default FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'schools' AND column_name = 'subscription_tier';
  PERFORM ent01.expect('D1 the subscription_tier column default is trial', col_default LIKE '''trial''%', coalesce(col_default, 'none'));
  r := ent01.call('authenticated', ent01.ctxid('u_founder'),
    $q$ select public.create_organization_with_founder('ENT01 Founded', 'ent01-founded', 'Ent Founder')::text $q$);
  PERFORM ent01.expect('D2 self-serve organization creation succeeds', r LIKE 'ok:%', r);
  v := (SELECT id FROM public.schools WHERE slug = 'ent01-founded');
  PERFORM ent01.expect('D3 a self-serve organization is created in the trial tier', ent01.tier(v) = 'trial', coalesce(ent01.tier(v), 'none'));
  PERFORM ent01.expect('D4 its entitlement plan is trial and carries no sms feature',
    EXISTS (SELECT 1 FROM public.org_entitlements e JOIN public.entitlement_plans p ON p.id = e.plan_id
             WHERE e.org_id = v AND e.plan_id = 'trial' AND NOT ('sms' = ANY (p.features))),
    coalesce((SELECT plan_id FROM public.org_entitlements WHERE org_id = v), 'none'));
  -- the founder (an admin of that new organization) is now subject to the same guard
  r := ent01.upd('authenticated', ent01.ctxid('u_founder'), v, $s$subscription_tier = 'enterprise'$s$);
  PERFORM ent01.expect('D5 the founder of a self-serve organization cannot promote it', r LIKE 'err:42501:%' AND ent01.tier(v) = 'trial', r);
  -- a row inserted by the owner without an explicit tier also lands in trial
  INSERT INTO public.schools (name, slug) VALUES ('ENT01 default', 'ent01-default') RETURNING id INTO v;
  PERFORM ent01.expect('D6 an insert that names no tier lands in trial', ent01.tier(v) = 'trial', ent01.tier(v));
END $t$;

-- ================================================================ E. Trial and Starter get no paid SMS; Growth and above do
SELECT ent01.reset_target();
DO $t$
DECLARE r text; t text; tiers text[] := ARRAY['trial','starter','growth','professional','enterprise']; want boolean;
BEGIN
  FOREACH t IN ARRAY tiers LOOP
    want := t IN ('growth','professional','enterprise');
    r := ent01.call('service_role', NULL, format($q$ select public.tier_sms_entitled(%L)::text $q$, t));
    PERFORM ent01.expect('E1 tier_sms_entitled(' || t || ') = ' || want, r = 'ok:' || want, r);
  END LOOP;
  r := ent01.call('service_role', NULL, $q$ select public.tier_sms_entitled(null)::text $q$);
  PERFORM ent01.expect('E2 a null tier is not entitled', r = 'ok:false', r);
  r := ent01.call('service_role', NULL, $q$ select public.tier_sms_entitled('platinum')::text $q$);
  PERFORM ent01.expect('E3 an unknown tier is not entitled', r = 'ok:false', r);
  r := ent01.call('service_role', NULL, $q$ select public.tier_sms_entitled('  ENTERPRISE ')::text $q$);
  PERFORM ent01.expect('E4 tier names are normalized the same way the plan mapping normalizes them', r = 'ok:true', r);
  FOREACH t IN ARRAY ARRAY['a','b','c','d','e'] LOOP
    want := (SELECT subscription_tier FROM public.schools WHERE id = ent01.ctxid(t)) IN ('growth','professional','enterprise');
    r := ent01.call('service_role', NULL, format($q$ select public.sms_plan_entitled(%L)::text $q$, ent01.ctxid(t)));
    PERFORM ent01.expect('E5 sms_plan_entitled(org ' || t || ', tier ' || (SELECT subscription_tier FROM public.schools WHERE id = ent01.ctxid(t)) || ') = ' || want, r = 'ok:' || want, r);
  END LOOP;
  r := ent01.call('service_role', NULL, format($q$ select public.sms_plan_entitled(%L)::text $q$, gen_random_uuid()));
  PERFORM ent01.expect('E6 an unknown organization is not entitled', r = 'ok:false', r);
  r := ent01.call('authenticated', ent01.ctxid('u_cadmin'), format($q$ select public.sms_plan_entitled(%L)::text $q$, ent01.ctxid('c')));
  PERFORM ent01.expect('E7 clients cannot call the entitlement function (service_role only)', r LIKE 'err:42501:%', r);
  r := ent01.call('anon', NULL, format($q$ select public.sms_plan_entitled(%L)::text $q$, ent01.ctxid('c')));
  PERFORM ent01.expect('E8 anon cannot call the entitlement function', r LIKE 'err:42501:%', r);
END $t$;

-- ================================================================ F. plan catalogs agree (tier mapping, features, quotas)
DO $t$
DECLARE t text; bad text; tiers text[] := ARRAY['trial','starter','growth','professional','enterprise'];
BEGIN
  PERFORM ent01.expect('F1 a trial entitlement plan exists', EXISTS (SELECT 1 FROM public.entitlement_plans WHERE id = 'trial'), 'plans: ' || (SELECT string_agg(id, ',' ORDER BY id) FROM public.entitlement_plans));
  PERFORM ent01.expect('F2 the trial plan carries no sms feature', NOT EXISTS (SELECT 1 FROM public.entitlement_plans WHERE id = 'trial' AND 'sms' = ANY (features)), 'trial features checked');
  PERFORM ent01.expect('F3 the starter plan carries no sms feature', NOT EXISTS (SELECT 1 FROM public.entitlement_plans WHERE id = 'starter' AND 'sms' = ANY (features)),
    coalesce((SELECT features::text FROM public.entitlement_plans WHERE id = 'starter'), 'none'));
  PERFORM ent01.expect('F4 trial and starter sms quotas are zero',
    (SELECT count(*) FROM public.entitlement_plan_quotas WHERE plan_id IN ('trial','starter') AND meter = 'sms' AND quota = 0) = 2,
    coalesce((SELECT string_agg(plan_id || '=' || quota, ',') FROM public.entitlement_plan_quotas WHERE plan_id IN ('trial','starter') AND meter = 'sms'), 'none'));
  PERFORM ent01.expect('F5 growth and enterprise keep sms with a positive quota',
    (SELECT count(*) FROM public.entitlement_plans p JOIN public.entitlement_plan_quotas q ON q.plan_id = p.id AND q.meter = 'sms'
      WHERE p.id IN ('growth','enterprise') AND 'sms' = ANY (p.features) AND q.quota > 0) = 2, 'growth/enterprise sms intact');
  SELECT string_agg(x, ',') INTO bad FROM unnest(tiers) x WHERE NOT EXISTS (SELECT 1 FROM public.subscription_tier_plans m WHERE m.tier = x);
  PERFORM ent01.expect('F6 every tier the schools CHECK allows has an explicit plan mapping (no silent fallback)', bad IS NULL, coalesce('unmapped: ' || bad, 'all mapped'));
  PERFORM ent01.expect('F7 trial maps to the trial plan, not starter', (SELECT plan_id FROM public.subscription_tier_plans WHERE tier = 'trial') = 'trial',
    coalesce((SELECT plan_id FROM public.subscription_tier_plans WHERE tier = 'trial'), 'none'));
  IF to_regprocedure('public.tier_sms_entitled(text)') IS NULL THEN
    bad := 'tier_sms_entitled(text) is missing';
  ELSE
    EXECUTE $q$
      SELECT string_agg(q.id::text, ',') FROM (
        SELECT s.id,
               public.tier_sms_entitled(s.subscription_tier) AS by_tier,
               coalesce(('sms' = ANY (p.features)) AND coalesce(q.quota, 0) > 0, false) AS by_catalog
          FROM public.schools s
          LEFT JOIN public.org_entitlements e ON e.org_id = s.id
          LEFT JOIN public.entitlement_plans p ON p.id = e.plan_id
          LEFT JOIN public.entitlement_plan_quotas q ON q.plan_id = e.plan_id AND q.meter = 'sms'
         WHERE s.slug LIKE 'ent01-%' AND s.subscription_tier = ANY ($1)) q
       WHERE q.by_tier IS DISTINCT FROM q.by_catalog $q$ INTO bad USING tiers;
  END IF;
  PERFORM ent01.expect('F8 the tier helper and the entitlement catalog agree for every fixture organization', bad IS NULL, coalesce('disagree: ' || bad, 'agree'));
END $t$;

-- ================================================================ G. nothing that existed before the migration changed
DO $t$
DECLARE n_changed bigint; n_lost bigint; n_ent bigint;
BEGIN
  SELECT count(*) INTO n_changed FROM ent01.pre_schools p JOIN public.schools s USING (id)
   WHERE (p.subscription_tier, p.subscription_status, p.subscription_expires_at, p.monthly_fee, p.max_students, p.max_teachers)
         IS DISTINCT FROM (s.subscription_tier, s.subscription_status, s.subscription_expires_at, s.monthly_fee, s.max_students, s.max_teachers);
  SELECT count(*) INTO n_lost FROM ent01.pre_schools p WHERE NOT EXISTS (SELECT 1 FROM public.schools s WHERE s.id = p.id);
  PERFORM ent01.expect('G1 no pre-existing organization changed tier, status, expiry, fee or limits', n_changed = 0 AND n_lost = 0, 'changed=' || n_changed || ' missing=' || n_lost);
  SELECT count(*) INTO n_ent FROM ent01.pre_ent p
    JOIN public.org_entitlements e ON e.org_id = p.org_id
    JOIN public.schools s ON s.id = p.org_id
   WHERE e.plan_id IS DISTINCT FROM p.plan_id AND s.subscription_tier <> 'trial';
  PERFORM ent01.expect('G2 no pre-existing non-trial organization changed entitlement plan', n_ent = 0, 'changed=' || n_ent);
END $t$;

-- ================================================================ summary
DO $s$
DECLARE p int; f int; names text;
BEGIN
  SELECT count(*) FILTER (WHERE ok), count(*) FILTER (WHERE NOT ok), string_agg(name, '; ') FILTER (WHERE NOT ok) INTO p, f, names FROM ent01.results;
  RAISE NOTICE 'ENT-01 RESULT: pass=% fail=%', p, f;
  IF f > 0 THEN RAISE EXCEPTION 'ENT-01: % check(s) failed: %', f, names; END IF;
END $s$;

ROLLBACK;
