-- Refuses to roll back while online payments exist in the ledger: they cannot be deleted (append-only) and the
-- narrower constraints would be violated.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.cg_fee_payment WHERE method = 'online')
     OR EXISTS (SELECT 1 FROM public.cg_fee_ledger_line WHERE account_code = 'online_clearing') THEN
    RAISE EXCEPTION 'online payments are in the fee ledger; roll back is refused';
  END IF;
END $$;
DROP TRIGGER IF EXISTS trg_cg_fee_refund_request_online_guard ON public.cg_fee_refund_request;
DROP FUNCTION IF EXISTS public.cg_fee_refund_request_online_guard();
DROP FUNCTION IF EXISTS public.cg_fee_post_online_payment(uuid, text, bigint);
DROP TABLE IF EXISTS public.cg_fee_online_posting;
DROP TABLE IF EXISTS public.cg_fee_online_actor;
ALTER TABLE public.cg_fee_ledger_line DROP CONSTRAINT IF EXISTS cg_fee_ledger_line_account_code_check;
ALTER TABLE public.cg_fee_ledger_line ADD CONSTRAINT cg_fee_ledger_line_account_code_check
  CHECK (account_code = ANY (ARRAY['accounts_receivable'::text, 'fee_revenue'::text, 'cash'::text, 'fee_relief'::text]));
ALTER TABLE public.cg_fee_payment DROP CONSTRAINT IF EXISTS cg_fee_payment_method_check;
ALTER TABLE public.cg_fee_payment ADD CONSTRAINT cg_fee_payment_method_check
  CHECK (method = ANY (ARRAY['cash'::text, 'bank_transfer'::text, 'pos'::text]));
