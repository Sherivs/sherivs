-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.
-- CD-04 (ADR-134): pausing an agent drops it to Draft in every organisation, and rising again needs fresh evidence.
-- Founder default, 26 Nov 2026. A pause already stops an agent from running (AIN-01). This adds the memory of it:
-- the earned level falls to 'draft' at once, recorded in the AIN-02 ledger as a demotion by the person who paused.
-- The existing promotion rule ("evidence is superseded by a later demotion here") then makes every piece of
-- evidence evaluated before the pause unusable, so re-promotion needs evidence evaluated after it.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.wf_autonomy_apply(uuid,text,text,text,uuid,uuid,text)') IS NULL
     OR to_regclass('public.agent_pause_events') IS NULL
     OR to_regprocedure('public.is_agent_paused(text)') IS NULL THEN
    RAISE EXCEPTION 'CD-04: AIN-02 and ENGINE-16 must be applied first';
  END IF;
  IF to_regprocedure('public.wf_pause_autonomy_drop()') IS NOT NULL THEN
    RAISE EXCEPTION 'CD-04: already applied';
  END IF;
END $$;

CREATE FUNCTION public.wf_pause_autonomy_drop()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_row record;
BEGIN
  -- Only agents that have a pause rule can be paused (an agent without one reads as paused to is_agent_paused, which
  -- must not demote organisation agents on every pause). Anything above 'draft' that is now paused drops to 'draft'.
  FOR v_row IN
    SELECT a.org_id, a.agent_ref FROM public.wf_agent_autonomy a
     WHERE public.wf_autonomy_rank(a.earned_level) > 1
       AND EXISTS (SELECT 1 FROM public.agent_pause_rules r WHERE r.agent_code = a.agent_ref)
       AND public.is_agent_paused(a.agent_ref)
     ORDER BY a.org_id, a.agent_ref
  LOOP
    PERFORM public.wf_autonomy_apply(v_row.org_id, v_row.agent_ref, 'demote', 'draft', NULL, NEW.actor_id,
      'Agent paused: autonomy dropped to draft; fresh evidence is needed to rise again');
  END LOOP;
  RETURN NULL;
END
$$;

CREATE TRIGGER agent_pause_events_50_autonomy_drop AFTER INSERT ON public.agent_pause_events
  FOR EACH ROW WHEN (NEW.action = 'pause')
  EXECUTE FUNCTION public.wf_pause_autonomy_drop();

REVOKE ALL ON FUNCTION public.wf_pause_autonomy_drop() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.wf_pause_autonomy_drop() IS
  'CD-04 / ADR-134: on every pause event, agents above draft that are now paused fall to draft (ledger kind demote).';

COMMIT;
