-- GRP-01 integration checks: group organisation, campus links, aggregate layer, scheduled group events.
-- Local disposable Postgres only; rolls back.
BEGIN;
DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'GRP01 FAIL: refusing to run outside the local disposable database';
  END IF;
  IF to_regclass('public.org_link') IS NULL THEN
    RAISE EXCEPTION 'GRP01 FAIL: the GRP-01 migration must be present';
  END IF;
END $guard$;

CREATE SCHEMA g1t;
CREATE TABLE g1t.passed (n serial PRIMARY KEY, label text NOT NULL);
CREATE TABLE g1t.ids (name text PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid());
INSERT INTO g1t.ids (name) VALUES ('grp'),('grp2'),('cA'),('cB'),('cC'),('gadm'),('g2adm'),('aadm'),('badm'),('cadm'),('founder'),('stranger');
CREATE TABLE g1t.vals (org uuid PRIMARY KEY, v bigint NOT NULL);
CREATE FUNCTION g1t.id(p text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM g1t.ids WHERE name = p $$;
CREATE FUNCTION g1t.ok(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'GRP01 FAIL [%]', p_label; END IF;
  INSERT INTO g1t.passed (label) VALUES (p_label);
END $$;
CREATE FUNCTION g1t.err(p_label text, p_sql text, p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN INSERT INTO g1t.passed (label) VALUES (p_label); RETURN; END IF;
    RAISE EXCEPTION 'GRP01 FAIL [%]: expected % got % (%)', p_label, p_state, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'GRP01 FAIL [%]: statement was allowed', p_label;
END $$;
CREATE FUNCTION g1t.act(p_user text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', g1t.id(p_user)::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', g1t.id(p_user), 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION g1t.back() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;
GRANT USAGE ON SCHEMA g1t TO PUBLIC;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA g1t TO PUBLIC;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA g1t TO PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA g1t TO PUBLIC;
-- A count metric a campus exposes. Registered functions must be public.org_metric_*(uuid) returning bigint.
CREATE FUNCTION public.org_metric_gtest(p uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT coalesce((SELECT v FROM g1t.vals WHERE org = p), 0) $$;
CREATE FUNCTION public.gother(p uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE FUNCTION public.org_metric_gtext(p uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'x' $$;

INSERT INTO auth.users (id) SELECT id FROM g1t.ids WHERE name NOT IN ('grp','grp2','cA','cB','cC');
INSERT INTO public.schools (id, name, slug) VALUES
  (g1t.id('grp'), 'G1 Group', 'g1-group'), (g1t.id('grp2'), 'G1 Other Group', 'g1-group2'),
  (g1t.id('cA'), 'G1 Campus A', 'g1-a'), (g1t.id('cB'), 'G1 Campus B', 'g1-b'), (g1t.id('cC'), 'G1 Campus C', 'g1-c');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  (g1t.id('gadm'), g1t.id('grp'), 'Group Admin', 'g@g1.invalid', 'admin', true),
  (g1t.id('g2adm'), g1t.id('grp2'), 'Other Group Admin', 'g2@g1.invalid', 'admin', true),
  (g1t.id('aadm'), g1t.id('cA'), 'Admin A', 'a@g1.invalid', 'admin', true),
  (g1t.id('badm'), g1t.id('cB'), 'Admin B', 'b@g1.invalid', 'admin', true),
  (g1t.id('cadm'), g1t.id('cC'), 'Admin C', 'c@g1.invalid', 'admin', true),
  (g1t.id('stranger'), g1t.id('cC'), 'Stranger', 's@g1.invalid', 'teacher', true);
INSERT INTO public.super_admins (id, full_name, email, is_active) VALUES (g1t.id('founder'), 'Founder', 'f@g1.invalid', true);
INSERT INTO public.wf_org_settings (org_id, workflows_enabled, autonomy_ceiling) VALUES (g1t.id('grp'), true, 'draft');

-- 1. Closed tables
SELECT g1t.ok('row security is on and forced for all four tables',
  (SELECT bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class
    WHERE oid IN ('public.org_group_root'::regclass, 'public.org_link'::regclass, 'public.org_metric'::regclass, 'public.org_group_threshold'::regclass)));
SELECT g1t.ok('clients have no table privileges and anon cannot execute',
  NOT has_table_privilege('authenticated', 'public.org_link', 'SELECT')
  AND NOT has_function_privilege('anon', 'public.org_group_aggregate(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.wf_group_event_scan(timestamptz)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.wf_group_event_scan(timestamptz)', 'EXECUTE'));

-- 2. Marking a group and registering a metric are platform acts
SELECT g1t.act('gadm');
SELECT g1t.err('an organisation administrator cannot mark a group', format($q$SELECT public.org_group_root_mark(%L,'Group')$q$, g1t.id('grp')), '42501');
SELECT g1t.err('an organisation administrator cannot register a metric', $q$SELECT public.org_metric_register('gtest','Test','public.org_metric_gtest')$q$, '42501');
SELECT g1t.back();
SELECT g1t.act('founder');
SELECT public.org_group_root_mark(g1t.id('grp'), 'Group');
SELECT public.org_group_root_mark(g1t.id('grp2'), 'Other Group');
SELECT g1t.err('a metric function must return a bigint', $q$SELECT public.org_metric_register('gtext','Text','public.org_metric_gtext')$q$, '22023');
SELECT g1t.err('a metric function must be an org_metric_ function', $q$SELECT public.org_metric_register('bad','Bad','public.gother')$q$, '23514');
SELECT public.org_metric_register('gtest', 'Test count', 'public.org_metric_gtest');
SELECT g1t.back();

-- 3. Proposals: only the group's own administrator, and only for a marked group
SELECT g1t.act('aadm');
SELECT g1t.err('a campus administrator cannot propose a link for the group', format($q$SELECT public.org_link_propose(%L,%L)$q$, g1t.id('grp'), g1t.id('cA')), '42501');
SELECT g1t.back();
SELECT g1t.act('gadm');
SELECT set_config('g1t.la', public.org_link_propose(g1t.id('grp'), g1t.id('cA'))::text, true);
SELECT set_config('g1t.lb', public.org_link_propose(g1t.id('grp'), g1t.id('cB'))::text, true);
SELECT set_config('g1t.lc', public.org_link_propose(g1t.id('grp'), g1t.id('cC'))::text, true);
SELECT g1t.err('a campus has one live link at a time', format($q$SELECT public.org_link_propose(%L,%L)$q$, g1t.id('grp'), g1t.id('cA')), '23505');
SELECT g1t.err('a group cannot link to itself', format($q$SELECT public.org_link_propose(%L,%L)$q$, g1t.id('grp'), g1t.id('grp')), '23514');
SELECT g1t.back();
SELECT g1t.act('aadm');
SELECT g1t.err('an unmarked organisation cannot propose', format($q$SELECT public.org_link_propose(%L,%L)$q$, g1t.id('cA'), g1t.id('cB')), '42501');
SELECT g1t.back();

-- 4. Nothing is shared before the campus accepts
SELECT g1t.act('gadm');
SELECT g1t.ok('before acceptance the group sees no campus', jsonb_array_length(public.org_group_aggregate(g1t.id('grp'), 'gtest')->'campuses') = 0);
SELECT g1t.err('the group cannot accept for a campus', format($q$SELECT public.org_link_accept(%L)$q$, current_setting('g1t.la')), '42501');
SELECT g1t.back();
SELECT g1t.act('founder');
SELECT g1t.err('a platform admin cannot accept for a campus', format($q$SELECT public.org_link_accept(%L)$q$, current_setting('g1t.la')), '42501');
SELECT g1t.back();
SELECT g1t.act('badm');
SELECT g1t.err('another campus administrator cannot accept', format($q$SELECT public.org_link_accept(%L)$q$, current_setting('g1t.la')), '42501');
SELECT g1t.back();
SELECT g1t.act('stranger');
SELECT g1t.err('a non-administrator cannot accept', format($q$SELECT public.org_link_accept(%L)$q$, current_setting('g1t.lc')), '42501');
SELECT g1t.back();
SELECT g1t.act('aadm'); SELECT public.org_link_accept(current_setting('g1t.la')::uuid);
SELECT g1t.err('a link cannot be accepted twice', format($q$SELECT public.org_link_accept(%L)$q$, current_setting('g1t.la')), '42501');
SELECT g1t.back();
SELECT g1t.act('badm'); SELECT public.org_link_accept(current_setting('g1t.lb')::uuid); SELECT g1t.back();
SELECT g1t.act('cadm'); SELECT public.org_link_accept(current_setting('g1t.lc')::uuid); SELECT g1t.back();

-- 5. The aggregate layer: counts only, 1 to 4 suppressed, no total when any campus is suppressed
INSERT INTO g1t.vals VALUES (g1t.id('cA'), 12), (g1t.id('cB'), 3), (g1t.id('cC'), 0);
SELECT g1t.act('gadm');
SELECT set_config('g1t.agg1', public.org_group_aggregate(g1t.id('grp'), 'gtest')::text, true);
SELECT g1t.back();
SELECT g1t.ok('a count of 12 is shown', (SELECT (e->>'count')::int = 12 FROM jsonb_array_elements(current_setting('g1t.agg1')::jsonb->'campuses') e WHERE e->>'campus_org' = g1t.id('cA')::text));
SELECT g1t.ok('a count of 3 is suppressed', (SELECT e->'count' = 'null'::jsonb AND (e->>'suppressed')::boolean FROM jsonb_array_elements(current_setting('g1t.agg1')::jsonb->'campuses') e WHERE e->>'campus_org' = g1t.id('cB')::text));
SELECT g1t.ok('a count of 0 is shown', (SELECT (e->>'count')::int = 0 FROM jsonb_array_elements(current_setting('g1t.agg1')::jsonb->'campuses') e WHERE e->>'campus_org' = g1t.id('cC')::text));
SELECT g1t.ok('no total is shown while a campus is suppressed (no differencing)', current_setting('g1t.agg1')::jsonb->'total' = 'null'::jsonb AND (current_setting('g1t.agg1')::jsonb->>'total_suppressed')::boolean);
UPDATE g1t.vals SET v = 8 WHERE org = g1t.id('cB');
SELECT g1t.act('gadm');
SELECT g1t.ok('with nothing suppressed the total is shown', (public.org_group_aggregate(g1t.id('grp'), 'gtest')->>'total')::int = 20);
SELECT g1t.back();
UPDATE g1t.vals SET v = 2 WHERE org = g1t.id('cA'); UPDATE g1t.vals SET v = 0 WHERE org = g1t.id('cB');
SELECT g1t.act('gadm');
SELECT g1t.ok('a small total is suppressed too', (public.org_group_aggregate(g1t.id('grp'), 'gtest')->'total') = 'null'::jsonb);
SELECT g1t.err('an unknown metric is refused', format($q$SELECT public.org_group_aggregate(%L,'nope')$q$, g1t.id('grp')), '22023');
SELECT g1t.back();
SELECT g1t.act('g2adm');
SELECT g1t.err('another group cannot read this group''s campuses', format($q$SELECT public.org_group_aggregate(%L,'gtest')$q$, g1t.id('grp')), '42501');
SELECT g1t.ok('another group sees none of them', jsonb_array_length(public.org_group_aggregate(g1t.id('grp2'), 'gtest')->'campuses') = 0);
SELECT g1t.back();
SELECT g1t.act('aadm');
SELECT g1t.err('a campus cannot read the group aggregate', format($q$SELECT public.org_group_aggregate(%L,'gtest')$q$, g1t.id('grp')), '42501');
SELECT g1t.back();

-- 6. Ending a link stops sharing at once; either side may end
UPDATE g1t.vals SET v = 20 WHERE org IN (g1t.id('cA'), g1t.id('cB'), g1t.id('cC'));
SELECT g1t.act('badm'); SELECT public.org_link_end(current_setting('g1t.lb')::uuid); SELECT public.org_link_end(current_setting('g1t.lb')::uuid); SELECT g1t.back();
SELECT g1t.act('gadm');
SELECT g1t.ok('an ended campus drops out of the aggregate', jsonb_array_length(public.org_group_aggregate(g1t.id('grp'), 'gtest')->'campuses') = 2);
SELECT public.org_link_end(current_setting('g1t.lc')::uuid);
SELECT g1t.ok('the group can end a link too', jsonb_array_length(public.org_group_aggregate(g1t.id('grp'), 'gtest')->'campuses') = 1);
SELECT g1t.back();
SELECT g1t.act('stranger');
SELECT g1t.err('a stranger cannot end a link', format($q$SELECT public.org_link_end(%L)$q$, current_setting('g1t.la')), '42501');
SELECT g1t.err('a stranger cannot list links', format($q$SELECT public.org_links_list(%L)$q$, g1t.id('grp')), '42501');
SELECT g1t.back();
SELECT g1t.act('badm');
SELECT g1t.ok('both sides see the link states', (SELECT bool_or(e->>'state' = 'ended') FROM jsonb_array_elements(public.org_links_list(g1t.id('cB'))) e));
SELECT g1t.back();
SELECT g1t.act('gadm');
SELECT g1t.ok('an ended campus can be linked again by a new proposal', public.org_link_propose(g1t.id('grp'), g1t.id('cC')) IS NOT NULL);
SELECT g1t.back();
SELECT g1t.err('a link cannot be rewritten', format($q$UPDATE public.org_link SET group_org = %L WHERE id = %L$q$, g1t.id('grp2'), current_setting('g1t.la')), '42501');
SELECT g1t.err('a link cannot be deleted', $q$DELETE FROM public.org_link$q$, '42501');

-- 7. Thresholds and scheduled events
SELECT g1t.act('gadm');
SELECT g1t.err('a threshold below 5 would reveal a suppressed count and is refused', format($q$SELECT public.org_group_threshold_set(%L,'gtest',4)$q$, g1t.id('grp')), '23514');
SELECT public.org_group_threshold_set(g1t.id('grp'), 'gtest', 10);
SELECT g1t.back();
SELECT g1t.act('g2adm');
SELECT g1t.err('another group cannot set this group''s threshold', format($q$SELECT public.org_group_threshold_set(%L,'gtest',10)$q$, g1t.id('grp')), '42501');
SELECT g1t.back();
-- Monday 30 Nov 2026 is also the last day of November. 07:30 UTC is 08:30 in Lagos.
SELECT g1t.ok('before 08:00 in Lagos nothing is emitted', (public.wf_group_event_scan('2026-11-30 06:30+00')->>'weekly')::int = 0);
SELECT g1t.ok('Monday after 08:00 emits the weekly and the month-end event for the group',
  (SELECT (r->>'weekly')::int = 1 AND (r->>'month_end')::int = 1 FROM (SELECT public.wf_group_event_scan('2026-11-30 07:30+00') r) x));
SELECT g1t.ok('the events exist once, for the group organisation',
  (SELECT count(*) = 1 FROM public.wf_event WHERE org_id = g1t.id('grp') AND event_type = 'schedule.weekly')
  AND (SELECT count(*) = 1 FROM public.wf_event WHERE org_id = g1t.id('grp') AND event_type = 'schedule.month_end'));
SELECT public.wf_group_event_scan('2026-11-30 12:00+00');
SELECT g1t.ok('a second scan the same day adds nothing',
  (SELECT count(*) = 1 FROM public.wf_event WHERE org_id = g1t.id('grp') AND event_type IN ('schedule.weekly'))
  AND (SELECT count(*) = 1 FROM public.wf_event WHERE org_id = g1t.id('grp') AND event_type = 'schedule.month_end'));
SELECT public.wf_group_event_scan('2026-12-01 07:30+00');
SELECT g1t.ok('Tuesday emits neither the weekly nor the month-end event',
  (SELECT count(*) = 1 FROM public.wf_event WHERE org_id = g1t.id('grp') AND event_type = 'schedule.weekly'));
SELECT g1t.ok('the KPI event fires only for a campus below its threshold and carries no count',
  (SELECT count(*) = 0 FROM public.wf_event WHERE org_id = g1t.id('grp') AND event_type = 'group.kpi_below_threshold'));
UPDATE g1t.vals SET v = 6 WHERE org = g1t.id('cA');
SELECT public.wf_group_event_scan('2026-12-02 07:30+00');
SELECT g1t.ok('a campus at 6 against a threshold of 10 raises one KPI event with no count in it',
  (SELECT count(*) = 1 AND bool_and(NOT (payload ? 'count') AND payload->>'metric' = 'gtest') FROM public.wf_event WHERE org_id = g1t.id('grp') AND event_type = 'group.kpi_below_threshold'));
SELECT public.wf_group_event_scan('2026-12-02 15:00+00');
SELECT g1t.ok('the same day does not raise it again', (SELECT count(*) = 1 FROM public.wf_event WHERE org_id = g1t.id('grp') AND event_type = 'group.kpi_below_threshold'));

DO $$ BEGIN RAISE NOTICE 'GRP01 ALL PASS: % checks', (SELECT count(*) FROM g1t.passed); END $$;
ROLLBACK;
