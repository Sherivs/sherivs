-- A5: finished_at on a run and on a step is write-once. Local disposable Postgres only; rolls back.
BEGIN;
DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'A5 FAIL: refusing to run outside the local disposable database';
  END IF;
  IF to_regclass('public.wf_run') IS NULL THEN RAISE EXCEPTION 'A5 FAIL: the WF-01 migration must be present'; END IF;
END $guard$;

CREATE SCHEMA a5t;
CREATE TABLE a5t.passed (n serial PRIMARY KEY, label text NOT NULL);
CREATE FUNCTION a5t.ok(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'A5 FAIL [%]', p_label; END IF;
  INSERT INTO a5t.passed (label) VALUES (p_label);
END $$;
CREATE FUNCTION a5t.refused(p_label text, p_sql text, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' AND SQLERRM LIKE '%' || p_msg || '%' THEN
      INSERT INTO a5t.passed (label) VALUES (p_label);
      RETURN;
    END IF;
    RAISE EXCEPTION 'A5 FAIL [%]: got % (%)', p_label, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'A5 FAIL [%]: statement was allowed', p_label;
END $$;

CREATE FUNCTION a5t.upd(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;

INSERT INTO public.schools (id, name, slug) VALUES ('a5a00000-0000-4000-8000-00000000000a', 'A5 Org', 'a5-org');
INSERT INTO public.wf_definition (id, org_id, key, name) VALUES ('a5d00000-0000-4000-8000-000000000001', 'a5a00000-0000-4000-8000-00000000000a', 'a5-wf', 'A5 wf');
INSERT INTO public.wf_version (id, org_id, definition_id, version, graph, created_by)
VALUES ('a5e00000-0000-4000-8000-000000000001', 'a5a00000-0000-4000-8000-00000000000a', 'a5d00000-0000-4000-8000-000000000001', 1, '{"steps":[]}', gen_random_uuid());
UPDATE public.wf_version SET state = 'published', published_by = gen_random_uuid() WHERE id = 'a5e00000-0000-4000-8000-000000000001';
UPDATE public.wf_definition SET current_version_id = 'a5e00000-0000-4000-8000-000000000001', status = 'active' WHERE id = 'a5d00000-0000-4000-8000-000000000001';
INSERT INTO public.wf_run (id, org_id, definition_id, version_id, idempotency_key, status, max_depth, max_steps, step_count, started_by, deadline_at, started_at)
SELECT ('a5f00000-0000-4000-8000-00000000000' || n)::uuid, 'a5a00000-0000-4000-8000-00000000000a', 'a5d00000-0000-4000-8000-000000000001', 'a5e00000-0000-4000-8000-000000000001',
       'a5-run-' || n, 'running', 3, 200, 0, gen_random_uuid(), now() + interval '1 hour', now() FROM generate_series(1, 3) n;
INSERT INTO public.wf_step_run (id, org_id, run_id, step_key, kind, idempotency_key)
SELECT ('a5b00000-0000-4000-8000-00000000000' || n)::uuid, 'a5a00000-0000-4000-8000-00000000000a', ('a5f00000-0000-4000-8000-00000000000' || n)::uuid, 's' || n, 'action', 'a5-step-' || n FROM generate_series(1, 3) n;

-- Run 1: finishes once; the time can then no longer move, in either direction or to nothing
UPDATE public.wf_run SET status = 'succeeded', finished_at = '2026-11-26 10:00+00' WHERE id = 'a5f00000-0000-4000-8000-000000000001';
SELECT a5t.ok('a run gets finished_at when it becomes final', (SELECT finished_at = '2026-11-26 10:00+00' FROM public.wf_run WHERE id = 'a5f00000-0000-4000-8000-000000000001'));
SELECT a5t.refused('a finished run cannot be given a later finished_at', $q$UPDATE public.wf_run SET finished_at = '2026-11-26 11:00+00' WHERE id = 'a5f00000-0000-4000-8000-000000000001'$q$, 'write-once');
SELECT a5t.refused('nor an earlier one', $q$UPDATE public.wf_run SET finished_at = '2026-11-26 09:00+00' WHERE id = 'a5f00000-0000-4000-8000-000000000001'$q$, 'write-once');
SELECT a5t.refused('nor have it cleared', $q$UPDATE public.wf_run SET finished_at = NULL WHERE id = 'a5f00000-0000-4000-8000-000000000001'$q$, 'write-once');
SELECT a5t.ok('an update that leaves finished_at as it is still works',
  a5t.upd('UPDATE public.wf_run SET finished_at = finished_at, step_count = step_count + 1 WHERE id = ''a5f00000-0000-4000-8000-000000000001''') = 1);
-- Run 2: cancelled (a different final status) is final too
UPDATE public.wf_run SET status = 'cancelled', finished_at = '2026-11-26 10:05+00' WHERE id = 'a5f00000-0000-4000-8000-000000000002';
SELECT a5t.refused('a cancelled run cannot have its time rewritten', $q$UPDATE public.wf_run SET finished_at = now() WHERE id = 'a5f00000-0000-4000-8000-000000000002'$q$, 'write-once');
-- Run 3 is still running: it can be touched, the status rule is unchanged
SELECT a5t.ok('a running run can still be updated', a5t.upd('UPDATE public.wf_run SET step_count = 1 WHERE id = ''a5f00000-0000-4000-8000-000000000003''') = 1);
SELECT a5t.refused('a finished run still cannot change status', $q$UPDATE public.wf_run SET status = 'failed' WHERE id = 'a5f00000-0000-4000-8000-000000000001'$q$, 'cannot change status');

-- Steps
UPDATE public.wf_step_run SET status = 'succeeded', finished_at = '2026-11-26 10:00+00' WHERE id = 'a5b00000-0000-4000-8000-000000000001';
SELECT a5t.ok('a step gets finished_at when it succeeds', (SELECT finished_at = '2026-11-26 10:00+00' FROM public.wf_step_run WHERE id = 'a5b00000-0000-4000-8000-000000000001'));
SELECT a5t.refused('a succeeded step cannot have its time moved', $q$UPDATE public.wf_step_run SET finished_at = '2026-11-26 12:00+00' WHERE id = 'a5b00000-0000-4000-8000-000000000001'$q$, 'write-once');
SELECT a5t.refused('nor cleared', $q$UPDATE public.wf_step_run SET finished_at = NULL WHERE id = 'a5b00000-0000-4000-8000-000000000001'$q$, 'write-once');
INSERT INTO public.wf_step_run (id, org_id, run_id, step_key, kind, idempotency_key) VALUES
  ('a5b00000-0000-4000-8000-000000000004', 'a5a00000-0000-4000-8000-00000000000a', 'a5f00000-0000-4000-8000-000000000003', 's4', 'action', 'a5-step-4');
UPDATE public.wf_step_run SET status = 'dead', finished_at = '2026-11-26 10:10+00' WHERE id = 'a5b00000-0000-4000-8000-000000000004';
SELECT a5t.refused('a dead step is final too', $q$UPDATE public.wf_step_run SET finished_at = now() WHERE id = 'a5b00000-0000-4000-8000-000000000004'$q$, 'write-once');
SELECT a5t.ok('cancelling a run cancelled its step with a finish time', (SELECT status = 'cancelled' AND finished_at IS NOT NULL FROM public.wf_step_run WHERE id = 'a5b00000-0000-4000-8000-000000000002'));
SELECT a5t.refused('and that time is write-once as well', $q$UPDATE public.wf_step_run SET finished_at = now() + interval '1 day' WHERE id = 'a5b00000-0000-4000-8000-000000000002'$q$, 'write-once');
SELECT a5t.ok('an unfinished step can still be updated', a5t.upd('UPDATE public.wf_step_run SET attempt = attempt + 1 WHERE id = ''a5b00000-0000-4000-8000-000000000003''') = 1);

DO $done$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM a5t.passed;
  RAISE NOTICE 'A5 ALL PASS: % checks', n;
END $done$;
ROLLBACK;
