-- Rollback: restore the prior ACL (anon/authenticated=arwdxtm on PG17; service_role unchanged).
-- TRUNCATE was never held by anon/authenticated on these views.
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN ON public.cg_fee_invoice_balances, public.cg_fee_receipt_sequence_status TO anon, authenticated;
