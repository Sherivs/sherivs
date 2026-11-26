-- Rollback for CD-05: restores the AIN-04 review entry point and drops the helper.
BEGIN;
CREATE OR REPLACE FUNCTION public.wf_safety_review_check(p_actor uuid, p_check uuid, p_decision text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_prev jsonb;
  v_org uuid;
  v_id uuid;
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN ('cleared', 'rejected') OR p_check IS NULL
     OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 10 AND 300 THEN
    RAISE EXCEPTION 'ain04:invalid_request' USING ERRCODE = '22023';
  END IF;
  v_prev := public.wf_act_as(p_actor);
  v_org := public.get_my_organization_id();
  IF v_org IS NULL OR NOT public.wf_can(v_org, 'workflows.approve') THEN
    RAISE EXCEPTION 'ain04:not_authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wf_safety_check c WHERE c.id = p_check AND c.org_id = v_org) THEN
    RAISE EXCEPTION 'ain04:check_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.wf_safety_open('person:' || p_actor::text);
  INSERT INTO public.wf_safety_review (org_id, check_id, decision, decided_by, reason)
  VALUES (v_org, p_check, p_decision, p_actor, btrim(p_reason))
  RETURNING id INTO v_id;
  PERFORM public.wf_safety_close();
  PERFORM public.wf_act_restore(v_prev);
  RETURN jsonb_build_object('review_id', v_id, 'decision', p_decision);
END
$$;
DROP FUNCTION public.wf_review_second_person_exists(uuid, uuid);
COMMIT;
