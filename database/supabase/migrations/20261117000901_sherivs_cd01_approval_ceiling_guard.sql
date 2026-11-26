-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.
-- CD-01 (ADR-131): a human approval can never lift a draft above its autonomy ceiling.
-- Founder default, 26 Nov 2026. A step whose effective autonomy is 'suggest' (the lowest of the
-- template ceiling, the tenant ceiling and the agent's earned level, with the capped-class rule
-- already applied by wf_autonomy_guard) produces advice only. No approval, through any path,
-- may move its draft to 'approved'.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.wf_action_draft') IS NULL
     OR to_regclass('public.wf_step_run') IS NULL
     OR to_regprocedure('public.wf_decide_approval(uuid,uuid,text,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'CD-01: WF-06 and WF-07 must be applied first';
  END IF;
  IF to_regprocedure('public.wf_action_draft_ceiling_guard()') IS NOT NULL THEN
    RAISE EXCEPTION 'CD-01: already applied';
  END IF;
END $$;

CREATE FUNCTION public.wf_action_draft_ceiling_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_level text;
BEGIN
  SELECT s.autonomy_level INTO v_level
    FROM public.wf_step_run s
   WHERE s.org_id = NEW.org_id AND s.id = NEW.step_run_id;
  IF NOT FOUND OR v_level IS NULL OR v_level = 'suggest' THEN
    RAISE EXCEPTION 'wf07:ceiling_suggest' USING ERRCODE = '42501',
      HINT = 'approval cannot lift a draft above its autonomy ceiling';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER wf_action_draft_55_ceiling BEFORE UPDATE OF status ON public.wf_action_draft
  FOR EACH ROW WHEN (NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved')
  EXECUTE FUNCTION public.wf_action_draft_ceiling_guard();

REVOKE ALL ON FUNCTION public.wf_action_draft_ceiling_guard() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.wf_action_draft_ceiling_guard() IS
  'CD-01 / ADR-131: refuses approval of a draft whose step runs at suggest autonomy, on every path.';

COMMIT;
