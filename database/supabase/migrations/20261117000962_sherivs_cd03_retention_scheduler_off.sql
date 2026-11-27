-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.
-- CD-03 (ADR-133): the retention scheduler is OFF until counsel confirms the retention periods.
-- Founder default, 26 Nov 2026. A platform switch (default 'off') sits in front of wf_retention_run_scheduled:
--   off      nothing runs, nothing is logged
--   dry_run  the scheduler counts eligible rows per opted-in organisation and deletes nothing
--   purge    today's behaviour; allowed only with a recorded counsel reference
-- The table has no API grants; it is changed only by the database owner in a reviewed change.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.wf_retention_run_scheduled(integer)') IS NULL THEN
    RAISE EXCEPTION 'CD-03: WF-12 must be applied first';
  END IF;
  IF to_regclass('public.wf_retention_platform') IS NOT NULL THEN
    RAISE EXCEPTION 'CD-03: already applied';
  END IF;
END $$;

CREATE TABLE public.wf_retention_platform (
  singleton       boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  scheduler_mode  text NOT NULL DEFAULT 'off' CHECK (scheduler_mode IN ('off', 'dry_run', 'purge')),
  counsel_ref     text CHECK (counsel_ref IS NULL OR length(btrim(counsel_ref)) BETWEEN 3 AND 200),
  counsel_confirmed_at timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wf_retention_platform_purge_needs_counsel CHECK (
    scheduler_mode <> 'purge' OR (counsel_ref IS NOT NULL AND counsel_confirmed_at IS NOT NULL))
);
INSERT INTO public.wf_retention_platform (singleton) VALUES (true);

ALTER TABLE public.wf_retention_platform ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_retention_platform FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wf_retention_platform FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.wf_retention_run_scheduled(p_max_orgs integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_org uuid;
  v_out jsonb := '[]'::jsonb;
  v_res jsonb;
  v_state text;
  v_mode text;
BEGIN
  SELECT p.scheduler_mode INTO v_mode FROM public.wf_retention_platform p WHERE p.singleton;
  v_mode := coalesce(v_mode, 'off');
  IF v_mode = 'off' THEN
    RETURN jsonb_build_object('orgs', '[]'::jsonb, 'mode', 'off');
  END IF;
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
      v_res := public.wf_retention_execute(v_org, v_mode = 'dry_run', NULL, 'scheduler');
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
  RETURN jsonb_build_object('orgs', v_out, 'mode', v_mode);
END
$$;

COMMENT ON TABLE public.wf_retention_platform IS
  'CD-03 / ADR-133: platform switch for the retention scheduler. Default off. purge needs a counsel reference.';

COMMIT;
