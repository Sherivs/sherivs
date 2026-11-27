-- M9 part B checks: an online refund needs a second person's approval before it is sent. Local disposable Postgres only; rolls back.
BEGIN;
DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'M9B FAIL: refusing to run outside the local disposable database';
  END IF;
  IF to_regclass('public.cg_financial_reversal_decision') IS NULL THEN
    RAISE EXCEPTION 'M9B FAIL: the M9B migration must be present';
  END IF;
END $guard$;

CREATE SCHEMA m9t;
CREATE TABLE m9t.passed (n serial PRIMARY KEY, label text NOT NULL);
CREATE TABLE m9t.ids (name text PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid());
INSERT INTO m9t.ids (name) VALUES ('org'), ('requester'), ('bursar'), ('bursar2'), ('cashbursar'), ('outsider'), ('entry'), ('rev1'), ('rev2'), ('rev3'), ('rev4');
CREATE FUNCTION m9t.id(p text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM m9t.ids WHERE name = p $$;
CREATE FUNCTION m9t.ok(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'M9B FAIL [%]', p_label; END IF;
  INSERT INTO m9t.passed (label) VALUES (p_label);
END $$;
CREATE FUNCTION m9t.err(p_label text, p_sql text, p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN INSERT INTO m9t.passed (label) VALUES (p_label); RETURN; END IF;
    RAISE EXCEPTION 'M9B FAIL [%]: expected % got % (%)', p_label, p_state, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'M9B FAIL [%]: statement was allowed', p_label;
END $$;
CREATE FUNCTION m9t.act(p_user text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', m9t.id(p_user)::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', m9t.id(p_user), 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION m9t.svc() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  EXECUTE 'SET LOCAL ROLE service_role';
END $$;
CREATE FUNCTION m9t.back() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;
GRANT USAGE ON SCHEMA m9t TO PUBLIC;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA m9t TO PUBLIC;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA m9t TO PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA m9t TO PUBLIC;

-- Fixtures bypass triggers and checks that other missions test; the functions under test are not bypassed.
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id) SELECT id FROM m9t.ids WHERE name IN ('requester', 'bursar', 'bursar2', 'cashbursar', 'outsider');
INSERT INTO public.schools (id, name, slug) VALUES (m9t.id('org'), 'M9B Org', 'm9b-org');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active)
  SELECT id, m9t.id('org'), name, name || '@m9b.invalid', 'admin', true FROM m9t.ids WHERE name IN ('requester', 'bursar', 'bursar2', 'cashbursar');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active)
  SELECT m9t.id('outsider'), s.id, 'Outsider', 'outsider@m9b.invalid', 'admin', true FROM (SELECT gen_random_uuid() id) s, LATERAL (SELECT 1) x
  WHERE false;
INSERT INTO public.organization_memberships (user_id, school_id, role)
  SELECT id, m9t.id('org'), 'admin' FROM m9t.ids WHERE name IN ('requester', 'bursar', 'bursar2', 'cashbursar');
INSERT INTO public.user_role_assignments (org_id, user_id, role_code, started_at) VALUES
  (m9t.id('org'), m9t.id('bursar'), 'ng.bursar', now() - interval '1 day'),
  (m9t.id('org'), m9t.id('bursar2'), 'ng.bursar', now() - interval '1 day'),
  (m9t.id('org'), m9t.id('requester'), 'ng.bursar', now() - interval '1 day'),
  (m9t.id('org'), m9t.id('cashbursar'), 'ng.bursar', now() - interval '1 day'),
  (m9t.id('org'), m9t.id('cashbursar'), 'ng.cashier', now() - interval '1 day');
INSERT INTO public.cg_financial_scope_binding (scope_ref, tenant_id, org_ref, provisioned_by)
  VALUES ('m9b-scope', m9t.id('org')::text, 'm9b-org-ref', 'test');
INSERT INTO public.cg_financial_entry (id, reference, scope_ref, tenant_id, org_ref, subject_ref, principal_ref, amount_minor, currency, provider_event_ref, settled_at)
  VALUES (m9t.id('entry'), 'ref-m9b-000001', 'm9b-scope', m9t.id('org')::text, 'm9b-org-ref', 'sub', 'prin', 100000, 'NGN', 'evt-m9b', now());
INSERT INTO public.cg_financial_reversal (id, entry_id, reference, scope_ref, tenant_id, org_ref, subject_ref, principal_ref, amount_minor, currency, reason, requested_by, idempotency_key)
  SELECT m9t.id(n), m9t.id('entry'), 'ref-m9b-000001', 'm9b-scope', m9t.id('org')::text, 'm9b-org-ref', 'sub', 'prin', 1000, 'NGN', 'overpaid', m9t.id('requester')::text, 'idem-' || n
    FROM (VALUES ('rev1'), ('rev2'), ('rev3'), ('rev4')) v(n);
SET LOCAL session_replication_role = origin;

SELECT m9t.ok('the decision table is closed, append-only and forced',
  (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.cg_financial_reversal_decision'::regclass)
  AND NOT has_table_privilege('authenticated', 'public.cg_financial_reversal_decision', 'SELECT')
  AND NOT has_function_privilege('anon', 'public.cg_financial_decide_reversal(uuid,text,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.cg_financial_decide_reversal(uuid,text,text)', 'EXECUTE'));

-- No decision, no provider refund
SELECT m9t.svc();
SELECT m9t.err('the service role cannot start a refund nobody approved', format($q$SELECT public.cg_financial_finish_reversal(%L,'processing','prov-1')$q$, m9t.id('rev1')), '42501');
SELECT m9t.err('nor mark it processed directly', format($q$SELECT public.cg_financial_finish_reversal(%L,'processed','prov-1')$q$, m9t.id('rev1')), '42501');
SELECT public.cg_financial_finish_reversal(m9t.id('rev1'), 'failed');
SELECT m9t.back();
SELECT m9t.ok('failing or cancelling a request needs no approval', (SELECT state = 'failed' FROM public.cg_financial_reversal WHERE id = m9t.id('rev1')));

-- Who may decide
SELECT m9t.act('requester');
SELECT m9t.err('the requester cannot approve their own refund', format($q$SELECT public.cg_financial_decide_reversal(%L,'approved')$q$, m9t.id('rev2')), '42501');
SELECT m9t.back();
SELECT m9t.act('cashbursar');
SELECT m9t.err('a holder of the cash permission cannot decide', format($q$SELECT public.cg_financial_decide_reversal(%L,'approved')$q$, m9t.id('rev2')), '42501');
SELECT m9t.back();
SELECT m9t.act('outsider');
SELECT m9t.err('someone outside the organisation cannot decide', format($q$SELECT public.cg_financial_decide_reversal(%L,'approved')$q$, m9t.id('rev2')), '42501');
SELECT m9t.back();
SELECT m9t.svc();
SELECT m9t.err('the service role cannot decide as a person', format($q$SELECT public.cg_financial_decide_reversal(%L,'approved')$q$, m9t.id('rev2')), '42501');
SELECT m9t.back();

-- Approval
SELECT m9t.act('bursar');
SELECT m9t.err('a decision must be approved or rejected', format($q$SELECT public.cg_financial_decide_reversal(%L,'maybe')$q$, m9t.id('rev2')), '22023');
SELECT m9t.ok('a second bursar approves', (public.cg_financial_decide_reversal(m9t.id('rev2'), 'approved', 'verified')->>'decision') = 'approved');
SELECT m9t.ok('the same decision again is a no-op', (public.cg_financial_decide_reversal(m9t.id('rev2'), 'approved')->>'duplicate')::boolean);
SELECT m9t.back();
SELECT m9t.act('bursar2');
SELECT m9t.err('a different person cannot flip a recorded decision', format($q$SELECT public.cg_financial_decide_reversal(%L,'rejected')$q$, m9t.id('rev2')), '23505');
SELECT m9t.back();
SELECT m9t.svc();
SELECT public.cg_financial_finish_reversal(m9t.id('rev2'), 'processing', 'prov-2');
SELECT m9t.back();
SELECT m9t.ok('after approval the refund can go to the provider', (SELECT state = 'processing' FROM public.cg_financial_reversal WHERE id = m9t.id('rev2')));

-- Rejection
SELECT m9t.act('bursar');
SELECT m9t.ok('a rejection is recorded', (public.cg_financial_decide_reversal(m9t.id('rev3'), 'rejected', 'not owed')->>'decision') = 'rejected');
SELECT m9t.err('a decided reversal cannot be decided again', format($q$SELECT public.cg_financial_decide_reversal(%L,'approved')$q$, m9t.id('rev3')), '23505');
SELECT m9t.back();
SELECT m9t.ok('and it cancels the reversal', (SELECT state = 'cancelled' FROM public.cg_financial_reversal WHERE id = m9t.id('rev3')));
SELECT m9t.svc();
SELECT m9t.err('a cancelled reversal can never be sent', format($q$SELECT public.cg_financial_finish_reversal(%L,'processing')$q$, m9t.id('rev3')), 'P0001');
SELECT m9t.back();

-- Decisions are history
SELECT m9t.err('a decision cannot be edited', $q$UPDATE public.cg_financial_reversal_decision SET decision = 'rejected'$q$, '42501');
SELECT m9t.err('a decision cannot be deleted', $q$DELETE FROM public.cg_financial_reversal_decision$q$, '42501');
SELECT m9t.ok('only the approved and rejected decisions exist', (SELECT count(*) = 2 FROM public.cg_financial_reversal_decision));

DO $$ BEGIN RAISE NOTICE 'M9B ALL PASS: % checks', (SELECT count(*) FROM m9t.passed); END $$;
ROLLBACK;
