-- Rollback: restore Supabase default privileges on the M07 fee views.
-- security_invoker stays true; underlying table RLS still blocks anon reads.
GRANT ALL ON public.cg_fee_invoice_balances, public.cg_fee_receipt_sequence_status TO anon, authenticated, service_role;
