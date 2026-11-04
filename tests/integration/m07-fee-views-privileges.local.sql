-- M07 fee views privileges (LOCAL, DISPOSABLE ONLY).
-- Run after replaying repository migrations on a loopback disposable DB (PG17):
--   psql "postgresql://supabase_admin@127.0.0.1:<port>/postgres" \
--     -v ON_ERROR_STOP=1 -f tests/integration/m07-fee-views-privileges.local.sql
BEGIN;
DO $t$
DECLARE
  v text;
  p text;
BEGIN
  FOREACH v IN ARRAY ARRAY['public.cg_fee_invoice_balances', 'public.cg_fee_receipt_sequence_status'] LOOP
    IF to_regclass(v) IS NULL THEN
      RAISE EXCEPTION 'M07 views: % missing', v;
    END IF;
    IF NOT (SELECT coalesce('security_invoker=true' = ANY (reloptions), false) FROM pg_class WHERE oid = v::regclass) THEN
      RAISE EXCEPTION 'M07 views: % is not security_invoker', v;
    END IF;
    FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
      IF has_table_privilege('anon', v, p) THEN
        RAISE EXCEPTION 'M07 views: anon holds % on %', p, v;
      END IF;
      IF p <> 'SELECT' AND has_table_privilege('authenticated', v, p) THEN
        RAISE EXCEPTION 'M07 views: authenticated holds % on %', p, v;
      END IF;
    END LOOP;
    IF NOT has_table_privilege('authenticated', v, 'SELECT')
       OR NOT has_table_privilege('service_role', v, 'SELECT') THEN
      RAISE EXCEPTION 'M07 views: SELECT missing on %', v;
    END IF;
  END LOOP;
  RAISE NOTICE 'M07 FEE VIEWS PRIVILEGES PASS';
END
$t$;
ROLLBACK;
