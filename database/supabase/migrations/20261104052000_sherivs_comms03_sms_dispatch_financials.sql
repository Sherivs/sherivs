-- COMMS-03: SMS dispatch financial integrity and tenant entitlement (BulkSMS Nigeria readiness).
--
-- Depends on FIN-01 (20261104050000: wallet functions are server-only, per-organization serialized) and
-- ENT-01 (20261104051000: sms_plan_entitled / tier_sms_entitled, platform-managed subscription). It refuses to run without them.
--
-- What this migration does (ADR-069, ADR-072):
--   1. F1: migration 20261024000270 revoked every write on outbound_messages from service_role, so the dispatcher's direct
--      UPDATEs were denied. Writes now go through service_role-only SECURITY DEFINER functions that keep compare-and-set
--      semantics: comms_sms_claim, comms_sms_settle, comms_sms_hold, comms_sms_report_delivery, comms_sms_reconcile.
--   2. Entitlement is enforced in the database: a message whose organization lost its SMS plan or its sms_live flag can no
--      longer be claimed, and comms_send never queues, meters or sends SMS for a Trial or Starter organization (blocked_plan).
--   3. Simulated (sent_stub) messages are never metered and never consume a pool allowance.
--   4. Refund policy, idempotent and auditable: only a message the provider PROVABLY never accepted is refunded
--      (rejected before submission, or definitively rejected by the provider). An ambiguous outcome is HELD (still queued,
--      claim kept) and is never resent and never refunded automatically; an operator reconciles it against the provider.
--      A delivery failure after acceptance never refunds automatically (provider charging behaviour is not verified).
--
-- Nothing here activates SMS, sets a provider, stores a credential, or schedules anything.

DO $guard$
BEGIN
  IF to_regprocedure('public.sms_plan_entitled(uuid)') IS NULL
     OR to_regprocedure('public.tier_sms_entitled(text)') IS NULL THEN
    RAISE EXCEPTION 'COMMS-03 requires ENT-01 (20261104051000) to be applied first';
  END IF;
  IF to_regprocedure('public.wallet_credit_topup(uuid,numeric,text)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_usage_events_audit') THEN
    RAISE EXCEPTION 'COMMS-03 requires FIN-01 (20261104050000) to be applied first';
  END IF;
  IF to_regclass('public.outbound_messages') IS NULL OR to_regprocedure('public._wallet_post(uuid,text,numeric,text,text,numeric,uuid,jsonb,boolean)') IS NULL THEN
    RAISE EXCEPTION 'COMMS-03: platform communication and wallet migrations are not applied';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Reversal ledger: one row per refunded message charge (append-only, audited, readable by wallet viewers)
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.usage_event_reversals (
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  reference text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('rejected_before_submission','provider_rejected','cancelled_unsent','reconciled_not_accepted')),
  refunded_amount numeric NOT NULL CHECK (refunded_amount >= 0),
  restored_from_pool numeric NOT NULL CHECK (restored_from_pool >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, reference));
ALTER TABLE public.usage_event_reversals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_event_reversals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.usage_event_reversals FROM anon, authenticated, service_role;
GRANT SELECT ON public.usage_event_reversals TO authenticated, service_role;
DROP POLICY IF EXISTS usage_event_reversals_read ON public.usage_event_reversals;
CREATE POLICY usage_event_reversals_read ON public.usage_event_reversals FOR SELECT TO authenticated
  USING (public.scholar_can(school_id, 'wallet.view'));
DROP TRIGGER IF EXISTS trg_usage_event_reversals_append_only ON public.usage_event_reversals;
CREATE TRIGGER trg_usage_event_reversals_append_only BEFORE UPDATE OR DELETE ON public.usage_event_reversals
  FOR EACH ROW EXECUTE FUNCTION public.append_only_guard();
DROP TRIGGER IF EXISTS trg_usage_event_reversals_audit ON public.usage_event_reversals;
CREATE TRIGGER trg_usage_event_reversals_audit AFTER INSERT ON public.usage_event_reversals
  FOR EACH ROW EXECUTE FUNCTION public.scholar_audit();

-- Internal: undo the charge recorded for one message reference. Idempotent twice over: one reversal row per reference
-- (primary key) and a wallet posting that replays by its own reference. Credits the wallet by the amount actually charged
-- and gives back any pool allowance that the message consumed.
CREATE OR REPLACE FUNCTION public._comms_refund_charge(p_org uuid, p_message_reference text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.usage_events%ROWTYPE;
BEGIN
  IF p_reason NOT IN ('rejected_before_submission','provider_rejected','cancelled_unsent','reconciled_not_accepted') THEN
    RAISE EXCEPTION 'invalid refund reason';
  END IF;
  SELECT * INTO u FROM public.usage_events WHERE school_id = p_org AND reference = 'msg:' || p_message_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('refunded', false, 'reason', 'no_charge_recorded'); END IF;
  INSERT INTO public.usage_event_reversals (school_id, reference, reason, refunded_amount, restored_from_pool)
  VALUES (p_org, u.reference, p_reason, u.charged, u.from_pool)
  ON CONFLICT (school_id, reference) DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('refunded', false, 'reason', 'already_refunded'); END IF;
  IF u.charged > 0 THEN
    PERFORM public._wallet_post(p_org, 'refund', u.charged, 'refund:' || u.reference, u.item, u.quantity - u.from_pool,
      u.student_id, jsonb_build_object('reason', p_reason, 'of', u.reference));
  END IF;
  IF u.from_pool > 0 THEN
    UPDATE public.term_usage_pools SET used = greatest(used - u.from_pool, 0), updated_at = now()
     WHERE school_id = p_org AND academic_year = u.academic_year AND term = u.term AND item = u.item;
  END IF;
  RETURN jsonb_build_object('refunded', true, 'amount', u.charged, 'pool_restored', u.from_pool);
END $$;
REVOKE ALL ON FUNCTION public._comms_refund_charge(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- Operator entry point (service_role only): cancel and refund a queued message that will never be sent (no entitlement,
-- sms_live switched off, no scheduler), or refund one that already failed before the provider accepted it. It refuses any
-- message that was claimed or accepted: those need reconciliation against the provider first (comms_sms_reconcile).
CREATE OR REPLACE FUNCTION public.comms_refund_unsubmitted(p_message uuid, p_org uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.outbound_messages%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_reason NOT IN ('rejected_before_submission','provider_rejected','cancelled_unsent') THEN
    RAISE EXCEPTION 'invalid refund reason';
  END IF;
  SELECT * INTO m FROM public.outbound_messages WHERE id = p_message AND org_id = p_org AND channel = 'sms' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'message not found'; END IF;
  IF m.provider_ref IS NOT NULL THEN
    RAISE EXCEPTION 'message was claimed or accepted by the provider: reconcile it manually before any refund';
  END IF;
  IF m.status = 'queued' THEN
    IF p_reason <> 'cancelled_unsent' THEN RAISE EXCEPTION 'a queued message can only be cancelled_unsent'; END IF;
    UPDATE public.outbound_messages SET status = 'failed', error = 'cancelled_unsent', updated_at = now() WHERE id = m.id;
  ELSIF m.status <> 'failed' THEN
    RAISE EXCEPTION 'message state does not allow a refund';
  END IF;
  RETURN public._comms_refund_charge(p_org, m.reference, p_reason);
END $$;
REVOKE ALL ON FUNCTION public.comms_refund_unsubmitted(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comms_refund_unsubmitted(uuid, uuid, text) TO service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Dispatcher write path (F1). All functions: service_role only, compare-and-set, search_path ''.
-- ---------------------------------------------------------------------------------------------------------------------
-- Claim one queued message. The database, not the worker, decides whether the organization may still send SMS: a message
-- of an organization that lost its plan or whose sms_live flag is off is never claimed, so no provider call is ever made.
CREATE OR REPLACE FUNCTION public.comms_sms_claim(p_message uuid, p_org uuid, p_claim text, p_provider text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n int;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_claim IS NULL OR p_claim !~ '^claim:[0-9a-f-]{36}$' THEN RAISE EXCEPTION 'invalid claim'; END IF;
  IF p_provider IS NULL OR p_provider !~ '^[a-z0-9_]{1,40}$' THEN RAISE EXCEPTION 'invalid provider'; END IF;
  IF NOT public.sms_plan_entitled(p_org) OR NOT public.flag_on('sms_live', p_org) THEN RETURN false; END IF;
  UPDATE public.outbound_messages SET provider = p_provider, provider_ref = p_claim, updated_at = now()
   WHERE id = p_message AND org_id = p_org AND channel = 'sms' AND status = 'queued' AND provider_ref IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END $$;

-- Compare-and-set close. p_expected_ref is the claim the caller holds (NULL for a rejection before any claim).
-- p_status: 'sent' (needs the provider's message id), 'failed', or 'queued' (release the claim for a retry).
-- p_refund_reason, when given, refunds the charge in the same transaction; callers pass it ONLY when the provider
-- provably never accepted the message (rejected before submission, or definitively rejected). 'provider_duplicate' is
-- deliberately not a refund reason: a duplicate report means the provider may hold the first copy, so it is ambiguous.
CREATE OR REPLACE FUNCTION public.comms_sms_settle(
  p_message uuid, p_org uuid, p_expected_ref text, p_status text, p_provider text, p_provider_ref text,
  p_error text, p_refund_reason text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ref text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('queued','sent','failed') THEN RAISE EXCEPTION 'invalid status'; END IF;
  IF p_status = 'sent' AND (p_provider_ref IS NULL OR p_provider_ref LIKE 'claim:%') THEN
    RAISE EXCEPTION 'a sent message needs the provider message id';
  END IF;
  IF p_status <> 'sent' AND p_provider_ref IS NOT NULL THEN RAISE EXCEPTION 'only a sent message carries a provider id'; END IF;
  IF p_refund_reason IS NOT NULL AND (p_status <> 'failed' OR p_refund_reason NOT IN
     ('rejected_before_submission','provider_rejected')) THEN
    RAISE EXCEPTION 'invalid refund request';
  END IF;
  UPDATE public.outbound_messages
     SET status = p_status, provider = coalesce(p_provider, provider), provider_ref = p_provider_ref,
         error = left(p_error, 200), updated_at = now()
   WHERE id = p_message AND org_id = p_org AND channel = 'sms' AND status = 'queued'
     AND provider_ref IS NOT DISTINCT FROM p_expected_ref
  RETURNING reference INTO v_ref;
  IF v_ref IS NULL THEN RETURN false; END IF;
  IF p_refund_reason IS NOT NULL THEN PERFORM public._comms_refund_charge(p_org, v_ref, p_refund_reason); END IF;
  RETURN true;
END $$;

-- Hold an AMBIGUOUS outcome: the request may or may not have reached the provider (timeout after sending, a 5xx after the
-- body was written, a 200 without a usable id, a duplicate report). The message stays queued and keeps its claim, so no
-- worker can claim it again (never resent) and nothing is refunded; the held marker in error and the audit row make it
-- visible to the operator. Compare-and-set on the claim held.
CREATE OR REPLACE FUNCTION public.comms_sms_hold(p_message uuid, p_org uuid, p_expected_ref text, p_code text, p_detail text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n int;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_expected_ref IS NULL OR p_expected_ref !~ '^claim:[0-9a-f-]{36}$' THEN RAISE EXCEPTION 'invalid claim'; END IF;
  IF p_code IS NULL OR p_code !~ '^[a-z0-9_]{1,40}$' THEN RAISE EXCEPTION 'invalid hold code'; END IF;
  UPDATE public.outbound_messages SET error = left('held:' || p_code || ': ' || coalesce(p_detail, ''), 200), updated_at = now()
   WHERE id = p_message AND org_id = p_org AND channel = 'sms' AND status = 'queued' AND provider_ref = p_expected_ref;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 1 THEN
    INSERT INTO public.audit_logs (school_id, user_id, action, table_name, record_id, new_value)
    VALUES (p_org, NULL, 'sms.hold', 'outbound_messages', p_message, jsonb_build_object('code', p_code, 'claim', p_expected_ref));
  END IF;
  RETURN v_n = 1;
END $$;

-- Operator reconciliation of a held (claimed, queued) message, after the provider's own records were checked.
--   'accepted'     -> status sent with the provider's message id; the charge stands; delivery reports can then arrive.
--   'not_accepted' -> status failed, claim cleared, and the charge is refunded once.
-- Anything else is refused. Refuses a message that is not currently claimed and queued.
CREATE OR REPLACE FUNCTION public.comms_sms_reconcile(p_message uuid, p_org uuid, p_resolution text, p_provider_ref text, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.outbound_messages%ROWTYPE; v_refund jsonb := jsonb_build_object('refunded', false);
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_resolution NOT IN ('accepted','not_accepted') THEN RAISE EXCEPTION 'invalid resolution'; END IF;
  IF p_resolution = 'accepted' AND (p_provider_ref IS NULL OR p_provider_ref LIKE 'claim:%') THEN
    RAISE EXCEPTION 'an accepted message needs the provider message id';
  END IF;
  IF p_resolution = 'not_accepted' AND p_provider_ref IS NOT NULL THEN RAISE EXCEPTION 'a message that was not accepted has no provider id'; END IF;
  SELECT * INTO m FROM public.outbound_messages WHERE id = p_message AND org_id = p_org AND channel = 'sms' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'message not found'; END IF;
  IF m.status <> 'queued' OR m.provider_ref IS NULL OR m.provider_ref NOT LIKE 'claim:%' THEN
    RAISE EXCEPTION 'only a claimed, queued message can be reconciled';
  END IF;
  IF p_resolution = 'accepted' THEN
    UPDATE public.outbound_messages SET status = 'sent', provider_ref = p_provider_ref, error = NULL, updated_at = now() WHERE id = m.id;
  ELSE
    UPDATE public.outbound_messages SET status = 'failed', provider_ref = NULL, error = 'reconciled_not_accepted', updated_at = now() WHERE id = m.id;
    v_refund := public._comms_refund_charge(p_org, m.reference, 'reconciled_not_accepted');
  END IF;
  INSERT INTO public.audit_logs (school_id, user_id, action, table_name, record_id, new_value)
  VALUES (p_org, NULL, 'sms.reconcile', 'outbound_messages', m.id,
          jsonb_build_object('resolution', p_resolution, 'claim', m.provider_ref, 'note', left(coalesce(p_note, ''), 200)) || jsonb_build_object('refund', v_refund));
  RETURN jsonb_build_object('resolution', p_resolution) || v_refund;
END $$;

-- Delivery report: only a message the provider accepted ('sent') can move to delivered or failed, once. No refund: whether
-- a failed delivery is charged is a provider billing fact that has not been verified.
CREATE OR REPLACE FUNCTION public.comms_sms_report_delivery(p_message uuid, p_org uuid, p_status text, p_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n int;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('delivered','failed') THEN RAISE EXCEPTION 'invalid status'; END IF;
  UPDATE public.outbound_messages SET status = p_status, error = left(p_code, 200), updated_at = now()
   WHERE id = p_message AND org_id = p_org AND channel = 'sms' AND status = 'sent';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END $$;

REVOKE ALL ON FUNCTION public.comms_sms_claim(uuid, uuid, text, text),
  public.comms_sms_settle(uuid, uuid, text, text, text, text, text, text),
  public.comms_sms_hold(uuid, uuid, text, text, text),
  public.comms_sms_reconcile(uuid, uuid, text, text, text),
  public.comms_sms_report_delivery(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comms_sms_claim(uuid, uuid, text, text),
  public.comms_sms_settle(uuid, uuid, text, text, text, text, text, text),
  public.comms_sms_hold(uuid, uuid, text, text, text),
  public.comms_sms_reconcile(uuid, uuid, text, text, text),
  public.comms_sms_report_delivery(uuid, uuid, text, text) TO service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. comms_send policy: [B1] simulated sends are never metered, [D4] SMS plan gate. Adds the status 'blocked_plan'.
--    Everything else in the function is the definition live in production (migration 20261101001000), unchanged.
--    sms_plan_entitled comes from ENT-01 (catalog-derived, fails closed); it is not redefined here.
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.outbound_messages DROP CONSTRAINT IF EXISTS outbound_messages_status_check;
ALTER TABLE public.outbound_messages ADD CONSTRAINT outbound_messages_status_check CHECK (status IN
  ('queued','sent_stub','sent','delivered','failed','blocked_optout','blocked_wallet','blocked_cap','blocked_plan'));

CREATE OR REPLACE FUNCTION public.comms_send(p_school uuid, p_channel text, p_to text, p_template text, p_vars jsonb DEFAULT '{}'::jsonb, p_student uuid DEFAULT NULL::uuid, p_priority text DEFAULT 'normal'::text, p_reference text DEFAULT NULL::text, p_language text DEFAULT 'en'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  tpl public.comms_templates; v_body text; v_ref text := coalesce(p_reference, gen_random_uuid()::text);
  v_status text; v_seg int := 1; v_item text; v_cost numeric := 0; v_opt text;
  v_id uuid; v_err text; m jsonb; v_live boolean; v_recipients uuid[];
  v_org_name text; v_vars jsonb; v_template_parameters text[];
BEGIN
  IF NOT (coalesce(auth.role(), '') = 'service_role'
    OR public.scholar_can(p_school, 'comms.send_class')
    OR public.scholar_can(p_school, 'comms.broadcast')) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO tpl FROM public.comms_templates t
  WHERE t.code = p_template AND t.channel = p_channel AND t.status = 'approved'
    AND (t.org_id = p_school OR t.org_id IS NULL)
  ORDER BY (t.language = p_language) DESC, (t.org_id IS NOT NULL) DESC, (t.language = 'en') DESC
  LIMIT 1;
  IF tpl.id IS NULL THEN RAISE EXCEPTION 'no approved % template %', p_channel, p_template; END IF;
  IF p_channel = 'whatsapp' AND (tpl.wa_template_name IS NULL OR tpl.body NOT LIKE '%{{school}}%') THEN
    RAISE EXCEPTION 'WhatsApp template must be approved and include the organization name';
  END IF;
  IF tpl.category = 'marketing' AND NOT public.scholar_can(p_school, 'comms.broadcast') THEN
    RAISE EXCEPTION 'not allowed: marketing needs comms.broadcast' USING ERRCODE = '42501';
  END IF;
  IF p_priority = 'safety' AND tpl.category NOT IN ('safety', 'authentication') THEN p_priority := 'normal'; END IF;
  IF p_student IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.students WHERE id = p_student AND school_id = p_school
  ) THEN RAISE EXCEPTION 'student not in this school'; END IF;
  IF EXISTS (SELECT 1 FROM public.outbound_messages WHERE org_id = p_school AND reference = v_ref) THEN
    SELECT jsonb_build_object('id', id, 'status', status, 'replay', true)
      INTO m FROM public.outbound_messages WHERE org_id = p_school AND reference = v_ref;
    RETURN m;
  END IF;

  SELECT array_agg(DISTINCT u.id) INTO v_recipients
  FROM public.users u
  JOIN public.organization_memberships om ON om.user_id = u.id AND om.school_id = p_school AND om.is_active
  JOIN auth.users au ON au.id = u.id
  WHERE coalesce(u.is_active, true)
    AND ((p_channel = 'in_app' AND u.id::text = p_to)
      OR (p_channel = 'email' AND lower(coalesce(u.email,'')) = lower(p_to)
          AND lower(coalesce(au.email,'')) = lower(coalesce(u.email,'')) AND au.email_confirmed_at IS NOT NULL)
      OR (p_channel IN ('sms','whatsapp','voice')
          AND regexp_replace(coalesce(u.phone,''), '\D', '', 'g') = regexp_replace(p_to, '\D', '', 'g')
          AND regexp_replace(coalesce(au.phone,''), '\D', '', 'g') = regexp_replace(coalesce(u.phone,''), '\D', '', 'g')
          AND au.phone_confirmed_at IS NOT NULL));
  IF coalesce(cardinality(v_recipients), 0) <> 1 THEN
    RAISE EXCEPTION 'recipient must resolve to exactly one verified contact in this organization' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.comms_send_proposals p
    WHERE p.org_id = p_school AND p.status = 'released' AND p.channel = p_channel
      AND p.template_code = p_template
      AND p.id::text || ':' || v_recipients[1]::text = v_ref
      AND v_recipients[1] = ANY(p.recipient_user_ids)) THEN
    RAISE EXCEPTION 'every outbound message must originate from an approved organization proposal'
      USING ERRCODE = '42501';
  END IF;
  IF p_channel IN ('sms','whatsapp','email','voice') THEN
    SELECT status INTO v_opt FROM public.comms_optins
    WHERE org_id = p_school AND regexp_replace(phone, '\D', '', 'g') = regexp_replace(p_to, '\D', '', 'g')
      AND channel = p_channel;
  END IF;
  v_org_name := (SELECT name FROM public.schools WHERE id = p_school);
  v_vars := coalesce(p_vars, '{}'::jsonb) || jsonb_build_object('school', v_org_name);
  v_body := public.comms_render(tpl.body, v_vars);
  SELECT coalesce(array_agg(left(coalesce(v_vars->>x.matches[1], ''), 200) ORDER BY x.ordinality), ARRAY[]::text[])
    INTO v_template_parameters
  FROM regexp_matches(tpl.body, '\{\{([a-z_]+)\}\}', 'g') WITH ORDINALITY AS x(matches, ordinality);
  IF p_channel = 'sms' THEN
    v_seg := greatest(1, ceil(length(v_body) / 160.0)::int); v_item := 'sms';
  ELSIF p_channel = 'whatsapp' THEN
    v_item := CASE WHEN tpl.category = 'marketing' THEN 'whatsapp_marketing' ELSE 'whatsapp_utility' END;
  END IF;
  IF p_channel = 'sms' AND NOT public.sms_plan_entitled(p_school) THEN
    -- [D4] plan gate: Starter and Trial organizations never queue, meter or send SMS
    v_status := 'blocked_plan';
  ELSIF p_priority <> 'safety' AND (v_opt = 'opted_out'
      OR (p_channel = 'whatsapp' OR tpl.category = 'marketing')
        AND v_opt IS DISTINCT FROM 'opted_in') THEN
    v_status := 'blocked_optout';
  ELSE
    BEGIN
      v_live := p_channel = 'in_app' OR public.flag_on(p_channel || '_live', p_school);
      IF v_item IS NOT NULL AND v_live THEN
        -- [B1] only a message that will really be queued is metered; sent_stub is free
        m := public.meter_usage(p_school, v_item, v_seg, 'msg:' || v_ref, p_student, p_priority);
        v_cost := coalesce((m->>'charged')::numeric, 0);
      END IF;
      v_status := CASE WHEN p_channel = 'in_app' THEN 'sent'
        WHEN v_live THEN 'queued' ELSE 'sent_stub' END;
    EXCEPTION WHEN others THEN
      v_err := SQLERRM;
      v_status := CASE WHEN v_err LIKE 'insufficient_wallet%' THEN 'blocked_wallet'
        WHEN v_err LIKE 'daily_cap%' THEN 'blocked_cap' ELSE NULL END;
      IF v_status IS NULL THEN RAISE; END IF;
    END;
  END IF;
  INSERT INTO public.outbound_messages
    (school_id, org_id, recipient_user_id, channel, to_address, template_code, template_parameters, language, category,
     body, priority, status, provider, segments, cost, student_id, reference, error, created_by)
  VALUES (p_school, p_school, v_recipients[1], p_channel, p_to, p_template, v_template_parameters, tpl.language, tpl.category,
    v_body, p_priority, v_status,
    CASE WHEN v_status = 'queued' THEN CASE p_channel WHEN 'whatsapp' THEN 'meta_cloud'
      WHEN 'sms' THEN 'bulksmsnigeria' ELSE p_channel END ELSE 'stub' END,
    v_seg, v_cost, p_student, v_ref, v_err, auth.uid()) RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'status', v_status, 'segments', v_seg,
    'cost', v_cost, 'language', tpl.language);
END $function$;
