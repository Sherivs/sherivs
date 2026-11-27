-- Rollback for M9 part B online refund approval. Restores the previous finish function and drops the decision table (decisions are lost).
CREATE OR REPLACE FUNCTION public.cg_financial_finish_reversal(p_id uuid, p_state text, p_provider_ref text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_current text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_state NOT IN ('processing', 'processed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'invalid reversal state';
  END IF;
  SELECT state INTO v_current FROM public.cg_financial_reversal WHERE id = p_id FOR UPDATE;
  IF v_current IS NULL THEN RAISE EXCEPTION 'reversal not found'; END IF;
  IF v_current IN ('processed', 'cancelled') THEN
    IF v_current <> p_state THEN RAISE EXCEPTION 'terminal reversal state'; END IF;
    RETURN;
  END IF;
  UPDATE public.cg_financial_reversal
     SET state = p_state,
         provider_ref = coalesce(p_provider_ref, provider_ref),
         processed_at = CASE WHEN p_state = 'processed' THEN now() ELSE processed_at END
   WHERE id = p_id;
END
$function$;
DROP FUNCTION IF EXISTS public.cg_financial_decide_reversal(uuid, text, text);
DROP TABLE IF EXISTS public.cg_financial_reversal_decision;
DROP FUNCTION IF EXISTS public.cg_financial_reversal_decision_guard();
