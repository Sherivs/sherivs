-- ENGINE-02 (LOCAL, DISPOSABLE DATABASE ONLY). Synthetic data only; always rolls back.
BEGIN;
DO $t$
DECLARE v_opts text[];
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'ENGINE-02 FAIL: must run as superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'ENGINE-02 FAIL: refusing non-loopback server';
  END IF;
  IF current_database() NOT LIKE 'engine_%' AND current_database() <> 'postgres'
     OR current_setting('coregrid.test_disposable_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'ENGINE-02 FAIL: requires the marked disposable database';
  END IF;
  IF to_regclass('public.cg_hermes_observation') IS NULL THEN
    RAISE EXCEPTION 'ENGINE-02 FAIL: base table must remain (no physical rename)';
  END IF;
  IF (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.cg_conductor_observation')) IS DISTINCT FROM 'v' THEN
    RAISE EXCEPTION 'ENGINE-02 FAIL: cg_conductor_observation must be a view';
  END IF;
  SELECT reloptions INTO v_opts FROM pg_class WHERE oid = 'public.cg_conductor_observation'::regclass;
  IF v_opts IS NULL OR NOT ('security_invoker=true' = ANY (v_opts)) THEN
    RAISE EXCEPTION 'ENGINE-02 FAIL: view must be security_invoker (RLS of the base table must apply)';
  END IF;
  IF has_table_privilege('anon', 'public.cg_conductor_observation', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cg_conductor_observation', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cg_conductor_observation', 'INSERT')
     OR has_table_privilege('service_role', 'public.cg_conductor_observation', 'INSERT')
     OR has_table_privilege('service_role', 'public.cg_conductor_observation', 'DELETE') THEN
    RAISE EXCEPTION 'ENGINE-02 FAIL: view must be service-role read-only, closed to clients';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.cg_conductor_observation', 'SELECT') THEN
    RAISE EXCEPTION 'ENGINE-02 FAIL: service_role must read the view';
  END IF;
  IF (SELECT count(*) FROM public.cg_conductor_observation)
     IS DISTINCT FROM (SELECT count(*) FROM public.cg_hermes_observation) THEN
    RAISE EXCEPTION 'ENGINE-02 FAIL: view/base parity';
  END IF;
  RAISE NOTICE 'ENGINE-02 HARNESS PASSED';
END
$t$;
ROLLBACK;
