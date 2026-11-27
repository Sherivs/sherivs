-- CS-01 integration checks: resource-level approval permission. Local disposable Postgres only; rolls back.
-- Behavioural cases (adviser own class vs other class, class-scope invigilator, restricted assigner, audit) run in
-- the sim-lab scenarios, which the ratchet job gates; this file covers the contract of the check itself.
BEGIN;
DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'CS01 FAIL: refusing to run outside the local disposable database';
  END IF;
  IF to_regprocedure('public.scholar_can_on(uuid,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'CS01 FAIL: the CS-01 migration must be present';
  END IF;
END $guard$;

CREATE SCHEMA c1t;
CREATE TABLE c1t.passed (n serial PRIMARY KEY, label text NOT NULL);
CREATE FUNCTION c1t.ok(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'CS01 FAIL [%]', p_label; END IF;
  INSERT INTO c1t.passed (label) VALUES (p_label);
END $$;

SELECT c1t.ok('scholar_can_on is security definer and stable',
  (SELECT prosecdef AND provolatile = 's' FROM pg_proc WHERE oid = 'public.scholar_can_on(uuid,text,text,uuid)'::regprocedure));
SELECT c1t.ok('anon and public cannot execute it; authenticated and service_role can',
  NOT has_function_privilege('anon', 'public.scholar_can_on(uuid,text,text,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'public.scholar_can_on(uuid,text,text,uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.scholar_can_on(uuid,text,text,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.scholar_can_on(uuid,text,text,uuid)', 'EXECUTE'));
SELECT c1t.ok('the four approval functions now call scholar_can_on',
  (SELECT bool_and(pg_get_functiondef(p.oid) LIKE '%scholar_can_on%')
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('course_reg_decide','malpractice_decide','role_scope_set_add','role_scope_set_remove')));
SELECT c1t.ok('the assignment guard is untouched',
  (SELECT pg_get_functiondef(oid) LIKE '%scholar_can_on%' FROM pg_proc WHERE proname = 'workspace_role_assignment_scope_guard') IS NOT TRUE);

-- No caller (no auth.uid) and unsupported resource kinds fail closed.
SELECT c1t.ok('no signed-in caller is refused',
  public.scholar_can_on(gen_random_uuid(), 'course_reg.approve', 'class', gen_random_uuid()) IS FALSE);
SELECT c1t.ok('an unsupported resource kind is refused',
  public.scholar_can_on(gen_random_uuid(), 'course_reg.approve', 'department', gen_random_uuid()) IS FALSE);

DO $$ BEGIN RAISE NOTICE 'CS01 ALL PASS: % checks', (SELECT count(*) FROM c1t.passed); END $$;
ROLLBACK;
