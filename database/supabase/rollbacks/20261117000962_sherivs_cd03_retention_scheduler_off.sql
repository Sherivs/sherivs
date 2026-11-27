-- Rollback for CD-03: removes the switch. The scheduler then returns to its WF-12 behaviour (opted-in
-- organisations purge), so only roll back with the founder's approval.
BEGIN;
CREATE OR REPLACE FUNCTION public.wf_retention_run_scheduled(p_max_orgs integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_org uuid;
  v_out jsonb := '[]'::jsonb;
  v_res jsonb;
  v_state text;
BEGIN
  FOR v_org IN
    SELECT l.org_id FROM public.wf_org_limits l
     WHERE l.retention_auto_purge
       AND NOT EXISTS (SELECT 1 FROM public.wf_retention_run r
                        WHERE r.org_id = l.org_id AND r.trigger_kind = 'scheduler'
                          AND r.created_at >= now() - interval '24 hours')
     ORDER BY l.org_id
     LIMIT least(greatest(coalesce(p_max_orgs, 20), 1), 100)
  LOOP
    -- One organization failing must not stop the others. Its work rolls back, the failure is audited by code only,
    -- and it is tried again on the next call (it has no log row, so the once-a-day rule does not skip it).
    BEGIN
      v_res := public.wf_retention_execute(v_org, false, NULL, 'scheduler');
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'org_id', v_org, 'outcome', v_res ->> 'outcome', 'refusal_code', v_res ->> 'refusal_code',
        'total', coalesce((v_res ->> 'total')::bigint, 0)));
    EXCEPTION WHEN OTHERS THEN
      v_state := SQLSTATE;
      PERFORM set_config('wf.retention_purge', '', true);
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'org_id', v_org, 'outcome', 'failed', 'refusal_code', NULL, 'total', 0, 'sqlstate', v_state));
      -- A failing organization has no log row, so it is retried on every call. Its failure is audited once a day, not
      -- once per call, so a persistent fault cannot fill the audit chain (the return value still reports it each time).
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM public.audit_chain c
                        WHERE c.org_id = v_org AND c.action = 'workflow.retention.failed'
                          AND c.at >= now() - interval '24 hours') THEN
          PERFORM public.wf_audit_append(v_org, 'workflow.retention.failed', 'organization', v_org::text, NULL,
            jsonb_build_object('sqlstate', v_state, 'trigger', 'scheduler'));
        END IF;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END;
  END LOOP;
  RETURN jsonb_build_object('orgs', v_out);
END
$$;
DROP TABLE public.wf_retention_platform;
COMMIT;
