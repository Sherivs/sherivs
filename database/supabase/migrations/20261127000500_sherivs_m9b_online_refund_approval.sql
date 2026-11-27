-- M9 part B (ADR-155): an online refund (cg_financial_reversal) needs a second person before it can go to the provider.
-- Until now the service role moved a requested reversal to 'processing' with no decision by anyone. After this migration the
-- move needs one approved decision by a finance approver holding payments.refund who is not the requester and holds no cash permission.
-- A rejection cancels the reversal. NOT APPLIED. Founder approval and a backup are required first.

CREATE TABLE public.cg_financial_reversal_decision (
  reversal_id uuid PRIMARY KEY REFERENCES public.cg_financial_reversal (id) ON DELETE RESTRICT,
  decision    text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reason      text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 500),
  decided_by  uuid NOT NULL,
  decided_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cg_financial_reversal_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_financial_reversal_decision FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cg_financial_reversal_decision FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cg_financial_reversal_decision TO service_role;
CREATE POLICY cg_financial_reversal_decision_service_read ON public.cg_financial_reversal_decision FOR SELECT TO service_role USING (true);

CREATE FUNCTION public.cg_financial_reversal_decision_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$ BEGIN RAISE EXCEPTION 'a refund decision is never changed or removed' USING ERRCODE = '42501'; END $$;
CREATE TRIGGER cg_financial_reversal_decision_append_only BEFORE UPDATE OR DELETE ON public.cg_financial_reversal_decision
  FOR EACH ROW EXECUTE FUNCTION public.cg_financial_reversal_decision_guard();
CREATE TRIGGER cg_financial_reversal_decision_no_truncate BEFORE TRUNCATE ON public.cg_financial_reversal_decision
  FOR EACH STATEMENT EXECUTE FUNCTION public.cg_financial_reversal_decision_guard();

CREATE FUNCTION public.cg_financial_decide_reversal(p_id uuid, p_decision text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_rev public.cg_financial_reversal%ROWTYPE;
  v_ctx record;
  v_existing public.cg_financial_reversal_decision%ROWTYPE;
BEGIN
  SELECT * INTO v_rev FROM public.cg_financial_reversal WHERE id = p_id;
  IF v_rev.id IS NULL THEN RAISE EXCEPTION 'reversal is unavailable' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_ctx FROM public.cg_fee_authorize(v_rev.scope_ref, 'payments.refund', 'bursar', 'institution', v_rev.tenant_id);
  SELECT * INTO v_rev FROM public.cg_financial_reversal WHERE id = p_id FOR UPDATE;
  SELECT * INTO v_existing FROM public.cg_financial_reversal_decision WHERE reversal_id = p_id;
  IF v_existing.reversal_id IS NOT NULL THEN
    IF v_existing.decision IS DISTINCT FROM p_decision OR v_existing.decided_by IS DISTINCT FROM v_ctx.actor_id THEN
      RAISE EXCEPTION 'reversal already has a different decision' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('decision', v_existing.decision, 'duplicate', true);
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approved', 'rejected')
     OR (p_reason IS NOT NULL AND length(btrim(p_reason)) NOT BETWEEN 1 AND 500) THEN
    RAISE EXCEPTION 'invalid refund decision' USING ERRCODE = '22023';
  END IF;
  IF v_rev.state <> 'requested' THEN
    RAISE EXCEPTION 'only a requested reversal can be decided' USING ERRCODE = '22023';
  END IF;
  IF v_rev.requested_by = v_ctx.actor_id::text THEN
    RAISE EXCEPTION 'separation of duties: requester cannot approve or reject their own refund' USING ERRCODE = '42501';
  END IF;
  IF public.cg_fee_actor_holds(v_ctx.tenant_id::uuid, v_ctx.actor_id, 'payments.record_cash') THEN
    RAISE EXCEPTION 'separation of duties: a cashier cannot decide refunds' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.cg_financial_reversal_decision (reversal_id, decision, reason, decided_by)
  VALUES (p_id, p_decision, nullif(btrim(p_reason), ''), v_ctx.actor_id);
  IF p_decision = 'rejected' THEN
    UPDATE public.cg_financial_reversal SET state = 'cancelled' WHERE id = p_id;
  END IF;
  RETURN jsonb_build_object('decision', p_decision, 'duplicate', false);
END $$;

-- The service role may start the provider refund only after an approval. Failure and cancellation stay free.
CREATE OR REPLACE FUNCTION public.cg_financial_finish_reversal(p_id uuid, p_state text, p_provider_ref text DEFAULT NULL::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
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
  IF p_state IN ('processing', 'processed') AND v_current = 'requested'
     AND NOT EXISTS (SELECT 1 FROM public.cg_financial_reversal_decision d WHERE d.reversal_id = p_id AND d.decision = 'approved') THEN
    RAISE EXCEPTION 'a refund needs a second person''s approval before it is sent' USING ERRCODE = '42501';
  END IF;
  UPDATE public.cg_financial_reversal
     SET state = p_state,
         provider_ref = coalesce(p_provider_ref, provider_ref),
         processed_at = CASE WHEN p_state = 'processed' THEN now() ELSE processed_at END
   WHERE id = p_id;
END
$function$;

REVOKE ALL ON FUNCTION public.cg_financial_reversal_decision_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cg_financial_decide_reversal(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cg_financial_decide_reversal(uuid, text, text) TO authenticated;
