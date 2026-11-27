-- WF-07 follow-up: in-app notification to the people who can decide a pending approval. NOT APPLIED.
-- Founder approval and a backup are required first. In-app only: SMS and WhatsApp are held until Tumi's reset.
-- The message names no student, guardian, amount or step: only that a decision is waiting and how risky it is.
-- One notification per (approval, person), by idempotency key, so a repeated scan sends nothing twice.

CREATE FUNCTION public.wf_approval_notify_scan(p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  a record; c record;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_approvals integer := 0; v_sent integer := 0; v_n integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  FOR a IN
    SELECT w.id, w.org_id, w.risk FROM public.wf_approval w
     WHERE w.status = 'pending' AND w.expires_at > now()
       AND NOT EXISTS (SELECT 1 FROM public.notifications n
                        WHERE n.school_id = w.org_id AND n.idempotency_key LIKE 'wf-approval:' || w.id::text || ':%')
     ORDER BY w.requested_at, w.id
     LIMIT v_limit
  LOOP
    v_approvals := v_approvals + 1;
    FOR c IN SELECT approver_id FROM public.wf_approver_candidates(a.id, 25) LOOP
      INSERT INTO public.notifications (school_id, user_id, title, message, type, action_url, idempotency_key)
      VALUES (a.org_id, c.approver_id, 'Approval waiting',
              CASE WHEN a.risk = 'high' THEN 'A high-risk workflow step is waiting for your decision.'
                   ELSE 'A workflow step is waiting for your decision.' END,
              'approval', '/home/s/approvals', 'wf-approval:' || a.id::text || ':' || c.approver_id::text)
      ON CONFLICT (school_id, user_id, idempotency_key) DO NOTHING;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_sent := v_sent + v_n;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('approvals', v_approvals, 'notified', v_sent);
END $$;

REVOKE ALL ON FUNCTION public.wf_approval_notify_scan(integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wf_approval_notify_scan(integer) TO service_role;
