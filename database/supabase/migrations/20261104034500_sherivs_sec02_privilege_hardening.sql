-- SEC-02: least-privilege hardening found by the production security audit.
-- Status: AUTHORED, NOT APPLIED. Do not apply to production from the pull request.
-- Rollback: database/supabase/rollbacks/20261104034500_sherivs_sec02_privilege_hardening.sql
-- ADR-069. Forward-only and idempotent. It removes privileges and pins function search paths.
-- It does not change any table, policy, row or function body.
--
-- Note: two earlier migrations are named sec01 (check_result, consent_set). This is SEC-02.
--
-- Evidence (read-only production queries, 2026-11-13):
--   * Supabase default privileges give anon and authenticated all table rights on every new
--     public object, including views (pg_default_acl, owner postgres, schema public).
--   * public.org_credential_inventory is security_invoker=false (it runs as its owner, so it
--     bypasses RLS on org_credentials by design, to mask ciphertext). The role authenticated
--     nevertheless holds INSERT, UPDATE and DELETE on it. A single-table view is
--     auto-updatable, so a tenant administrator could write credential rows through it.
--   * public.cg_fee_invoice_balances and public.cg_fee_receipt_sequence_status are
--     security_invoker=true and aggregate (not updatable), but anon holds SELECT and UPDATE.
--   * 11 trigger or immutable helper functions have a mutable search_path (advisor 0011).
--   * public.schools_audit_commercial_change() is a trigger function but anon can execute it
--     (advisor 0028). Trigger firing does not need EXECUTE for the calling role.
--
-- Apply order: no dependencies. Run the read-only pre-apply queries in ADR-069 first.

DO $sec02_guard$
BEGIN
  IF to_regclass('public.org_credential_inventory') IS NULL
     OR to_regclass('public.cg_fee_invoice_balances') IS NULL
     OR to_regclass('public.cg_fee_receipt_sequence_status') IS NULL
  THEN
    RAISE EXCEPTION 'SEC-02 requires the credential vault and the ledger views'
      USING ERRCODE = '55000';
  END IF;
END
$sec02_guard$;

-- 1. Views: read-only for signed-in users, no access for anonymous callers.
REVOKE ALL ON public.org_credential_inventory FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.org_credential_inventory TO authenticated;
GRANT SELECT ON public.org_credential_inventory TO service_role;

REVOKE ALL ON public.cg_fee_invoice_balances FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cg_fee_invoice_balances TO authenticated;
GRANT SELECT ON public.cg_fee_invoice_balances TO service_role;

REVOKE ALL ON public.cg_fee_receipt_sequence_status FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cg_fee_receipt_sequence_status TO authenticated;
GRANT SELECT ON public.cg_fee_receipt_sequence_status TO service_role;

-- 2. Pin search_path on helper and trigger functions whose bodies use only pg_catalog objects.
DO $sec02_search_path$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public._a03_sem_order(text,text)',
    'public.touch_updated_at()',
    'public._head_console_audit_immutable()',
    'public.cg_foundation_reject_history_mutation()',
    'public.cg_guard_record_time_immutable()',
    'public.cg_hermes_observation_append_only()',
    'public.cg_delivery_evidence_forbid_mutation()',
    'public.ndpa_forbid_mutation()',
    'public.security_incidents_set_due()',
    'public._grp_audit_append_only()',
    'public._school_domain_audit_immutable()'
  ]
  LOOP
    IF to_regprocedure(v_sig) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog', v_sig);
    END IF;
  END LOOP;
END
$sec02_search_path$;

-- 3. A trigger function must not be callable as an RPC by anonymous or signed-in users.
DO $sec02_trigger_fn$
BEGIN
  IF to_regprocedure('public.schools_audit_commercial_change()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.schools_audit_commercial_change()
      FROM PUBLIC, anon, authenticated;
  END IF;
END
$sec02_trigger_fn$;
