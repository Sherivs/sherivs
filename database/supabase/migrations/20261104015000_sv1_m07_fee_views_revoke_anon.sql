-- 20261104015000_sv1_m07_fee_views_revoke_anon.sql
-- Defence-in-depth: remove inherited default privileges from the M07 fee views.
-- Views stay security_invoker; underlying cg_fee_* tables remain RLS+FORCE.
-- authenticated ends with SELECT only (also drops MAINTAIN on PG17).
REVOKE ALL ON public.cg_fee_invoice_balances, public.cg_fee_receipt_sequence_status FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cg_fee_invoice_balances, public.cg_fee_receipt_sequence_status TO authenticated, service_role;
ALTER VIEW public.cg_fee_invoice_balances SET (security_invoker = true);
ALTER VIEW public.cg_fee_receipt_sequence_status SET (security_invoker = true);
