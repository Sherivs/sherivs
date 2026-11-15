-- Rollback for SEC-02 (20261104034500). It restores the write privileges SEC-02 removed.
-- Running it re-opens the privileges SEC-02 closed. Use it only to recover from an outage.
-- The function search_path pins are harmless and are left in place.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_credential_inventory TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cg_fee_invoice_balances TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cg_fee_receipt_sequence_status TO authenticated;
GRANT SELECT ON public.cg_fee_invoice_balances TO anon;
GRANT SELECT ON public.cg_fee_receipt_sequence_status TO anon;

DO $sec02_rb$
BEGIN
  IF to_regprocedure('public.schools_audit_commercial_change()') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.schools_audit_commercial_change() TO anon, authenticated;
  END IF;
END
$sec02_rb$;
