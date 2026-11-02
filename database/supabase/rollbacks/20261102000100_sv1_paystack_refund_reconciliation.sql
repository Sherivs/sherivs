-- Rollback for 20261102000100_sv1_paystack_refund_reconciliation.sql (NOT APPLIED).
-- Do not run against production without explicit owner approval.
BEGIN;
DROP FUNCTION IF EXISTS public.cg_financial_record_refund(text, text, bigint, text);
COMMIT;
