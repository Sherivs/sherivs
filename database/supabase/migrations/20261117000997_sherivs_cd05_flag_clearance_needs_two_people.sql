-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.
-- CD-05 (ADR-135): flagged output is cleared only by an approver who did not start the run, AND an organisation with
-- fewer than two people holding workflows.approve cannot clear it at all (one-person institutions stay blocked until
-- the proprietor-approval class of D-04 option C is built). Founder default, 26 Nov 2026.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.wf_safety_review_check(uuid,uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'CD-05: AIN-04 must be applied first';
  END IF;
  IF to_regprocedure('public.wf_review_second_person_exists(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'CD-05: already applied';
  END IF;
END $$;

-- True when the organisation has at least one OTHER active person who holds workflows.approve besides the reviewer.
-- Candidates are active role assignments and active member rows; acts as each in turn (the pattern WF-07 uses) and always restores the caller.
CREATE FUNCTION public.wf_review_second_person_exists(p_org uuid, p_reviewer uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_u record;
  v_prev jsonb;
  v_found boolean := false;
BEGIN
  FOR v_u IN
    SELECT x.uid FROM (
      SELECT a.user_id AS uid FROM public.user_role_assignments a
       WHERE a.org_id = p_org AND a.status = 'active'
      UNION
      SELECT u.id AS uid FROM public.users u
       WHERE u.school_id = p_org AND u.is_active
    ) x
     WHERE x.uid <> p_reviewer
     ORDER BY x.uid
     LIMIT 200
  LOOP
    v_prev := public.wf_act_as(v_u.uid);
    v_found := public.wf_can(p_org, 'workflows.approve');
    PERFORM public.wf_act_restore(v_prev);
    EXIT WHEN v_found;
  END LOOP;
  RETURN v_found;
END
$$;
REVOKE ALL ON FUNCTION public.wf_review_second_person_exists(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

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
  -- CD-05: a flagged output is cleared by one person and seen by another. An organisation with fewer than two people
  -- who hold workflows.approve stays blocked until the proprietor-approval class exists (D-04 option C).
  IF NOT public.wf_review_second_person_exists(v_org, p_actor) THEN
    RAISE EXCEPTION 'ain04:second_reviewer_required' USING ERRCODE = '42501';
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

COMMENT ON FUNCTION public.wf_review_second_person_exists(uuid, uuid) IS
  'CD-05 / ADR-135: true when another active person in the organisation holds workflows.approve.';

COMMIT;
