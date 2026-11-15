-- Expect: three views with only authenticated:SELECT; 11 pinned functions; anon cannot execute the trigger function; feature_flags pk=1, dup index 0.
SELECT c.relname, string_agg(DISTINCT a.grantee||':'||a.privilege_type, ', ') FROM pg_class c
LEFT JOIN information_schema.role_table_grants a ON a.table_schema='public' AND a.table_name=c.relname AND a.grantee IN ('anon','authenticated','PUBLIC')
WHERE c.relnamespace='public'::regnamespace AND c.relname IN ('org_credential_inventory','cg_fee_invoice_balances','cg_fee_receipt_sequence_status') GROUP BY 1;
SELECT has_function_privilege('anon','public.schools_audit_commercial_change()','EXECUTE') AS anon_exec;
SELECT count(*) FROM pg_constraint WHERE conrelid='public.feature_flags'::regclass AND contype='p' ;
