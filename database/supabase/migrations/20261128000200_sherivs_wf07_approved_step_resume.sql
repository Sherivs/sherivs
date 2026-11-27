-- WF-07b: resume workflow runs whose approval step has been approved.
-- Until now an approval step parked the run in 'waiting' and nothing ever moved it again after a
-- human approved (wf_decide_approval only recorded the decision). This adds two service_role-only
-- functions: wf_claim_approved_steps (lease approved, draft-less approval steps for the runtime tick)
-- and wf_approver_holds_role (the role the definition names, checked against live role assignments).
-- Nothing here approves anything: the decision, permission, separation of duties and passkey step-up
-- stay in wf_decide_approval. Approvals tied to an action draft are left to the draft executor.
-- Additive; rollback drops both functions.

DO $$
BEGIN
  IF to_regclass('public.wf_approval') IS NULL OR to_regclass('public.wf_action_draft') IS NULL
     OR to_regprocedure('public.wf_decide_approval(uuid,uuid,text,text,text,uuid)') IS NULL
     OR to_regprocedure('public.wf_persist_step_transition(uuid,text,integer,text,timestamptz,text,text,timestamptz,jsonb,text,integer,text,text,integer,text,integer,integer)') IS NULL
     OR to_regprocedure('public.workspace_effective_assignments_at(uuid,uuid,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'WF-07b requires WF-03, WF-07 and the role engine' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.wf_claim_approved_steps(text,integer,integer)') IS NOT NULL
     OR to_regprocedure('public.wf_approver_holds_role(uuid,uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'WF-07b already applied' USING ERRCODE = '55000';
  END IF;
END
$$;

CREATE FUNCTION public.wf_approver_holds_role(p_org uuid, p_user uuid, p_role text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT p_org IS NOT NULL AND p_user IS NOT NULL AND p_role IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.workspace_effective_assignments_at(p_org, p_user, now()) a
        WHERE a.role_code = p_role
     );
$$;

CREATE FUNCTION public.wf_claim_approved_steps(
  p_worker text, p_limit integer DEFAULT 50, p_lease_seconds integer DEFAULT 60
)
RETURNS SETOF public.wf_step_run
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_lease integer := least(greatest(coalesce(p_lease_seconds, 60), 5), 900);
BEGIN
  IF p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'wf_claim_approved_steps: worker id is required' USING ERRCODE = '22023';
  END IF;

  -- A lease that expired on the last allowed attempt ends the run rather than looping forever.
  WITH dead AS (
    UPDATE public.wf_step_run x
       SET status = 'dead', lease_owner = NULL, lease_expires_at = NULL,
           finished_at = now(), error_code = coalesce(x.error_code, 'lease.expired'), updated_at = now()
     WHERE x.id IN (
       SELECT s.id FROM public.wf_step_run s
        WHERE s.kind = 'approval' AND s.status IN ('claimed', 'running')
          AND s.lease_expires_at <= now() AND s.attempt >= s.max_attempts
          AND EXISTS (SELECT 1 FROM public.wf_approval a
                       WHERE a.org_id = s.org_id AND a.step_run_id = s.id AND a.status = 'approved')
          AND EXISTS (SELECT 1 FROM public.wf_run r
                       WHERE r.org_id = s.org_id AND r.id = s.run_id AND r.status = 'waiting')
        ORDER BY s.lease_expires_at LIMIT v_limit FOR UPDATE SKIP LOCKED
     )
     RETURNING x.org_id, x.run_id, x.error_code
  )
  UPDATE public.wf_run r
     SET status = 'failed', finished_at = now(), error_code = coalesce(dead.error_code, 'step.failed'),
         step_count = least(r.max_steps, r.step_count + 1), updated_at = now()
    FROM dead WHERE r.org_id = dead.org_id AND r.id = dead.run_id AND r.status = 'waiting';

  RETURN QUERY
  WITH due AS (
    SELECT s.id FROM public.wf_step_run s
     WHERE s.kind = 'approval'
       AND (s.status = 'waiting'
            OR (s.status IN ('claimed', 'running') AND s.lease_expires_at <= now()))
       AND s.attempt < s.max_attempts
       AND EXISTS (SELECT 1 FROM public.wf_approval a
                    WHERE a.org_id = s.org_id AND a.step_run_id = s.id AND a.status = 'approved'
                      AND a.decided_by IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM public.wf_action_draft d
                        JOIN public.wf_approval a2 ON a2.org_id = d.org_id AND a2.id = d.approval_id
                       WHERE a2.org_id = s.org_id AND a2.step_run_id = s.id)
       AND EXISTS (SELECT 1 FROM public.wf_run r
                    WHERE r.org_id = s.org_id AND r.id = s.run_id
                      AND r.status = 'waiting' AND r.deadline_at > now()
                      AND r.step_count < r.max_steps)
       AND EXISTS (SELECT 1 FROM public.wf_org_settings o
                    WHERE o.org_id = s.org_id AND o.workflows_enabled)
     ORDER BY s.updated_at LIMIT v_limit FOR UPDATE SKIP LOCKED
  )
  UPDATE public.wf_step_run s
     SET status = 'claimed', lease_owner = p_worker,
         lease_expires_at = now() + make_interval(secs => v_lease),
         attempt = s.attempt + 1, started_at = coalesce(s.started_at, now()), updated_at = now()
    FROM due WHERE s.id = due.id
  RETURNING s.*;
END
$$;

REVOKE ALL ON FUNCTION public.wf_claim_approved_steps(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wf_claim_approved_steps(text, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.wf_approver_holds_role(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wf_approver_holds_role(uuid, uuid, text) TO service_role;
