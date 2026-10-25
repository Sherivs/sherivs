-- =============================================================================
-- SHERIVS-093 — Integration Hub: Fedena, Moodle and OneRoster connectors + scheduled pulls.
-- NOT APPLIED. Review only (draft PR). Builds on SHERIVS-090/092.
--
-- connector_manifests  + fedena, moodle, oneroster (inbound, pull via the cron worker)
-- integration_set_config(p_integration, p_config)   admin; non-secret config only (base_url,
--                      token_url, term, academic_year); https URLs; secrets go to the vault.
-- integration_claim_due_jobs v2: only connectors that can pull; at most one job per integration
--                      per claim so one school cannot starve the others.
-- Rollback: database/supabase/rollbacks/20261025100200_sherivs_093_integration_connectors.sql
-- =============================================================================
BEGIN;

INSERT INTO public.connector_manifests (key, name, version, category, auth_type, entities, directions, status, manifest) VALUES
 ('fedena', 'Fedena', '0.9.0', 'sis', 'oauth2', ARRAY['student','staff','class'], ARRAY['inbound'], 'beta',
   '{"config":["base_url"],"credentials":["client_id","client_secret","username","password","redirect_uri"],"docs":"https://support.fedena.com/support/solutions/articles/190972","assumptions":"XML element names and ransack id_gt paging to be verified on a sandbox"}'),
 ('moodle', 'Moodle', '1.0.0', 'lms', 'api_key', ARRAY['class','student','staff','enrollment','result'], ARRAY['inbound'], 'beta',
   '{"config":["base_url","term","academic_year"],"credentials":["token"],"functions":["core_course_get_courses","core_enrol_get_enrolled_users","gradereport_user_get_grade_items"],"docs":"https://docs.moodle.org/dev/Web_service_API_functions"}'),
 ('oneroster', 'OneRoster 1.1 (Classter and other SIS)', '1.0.0', 'sis', 'oauth2', ARRAY['class','student','staff','guardian','enrollment'], ARRAY['inbound'], 'beta',
   '{"config":["base_url","token_url"],"credentials":["client_id","client_secret"],"docs":"https://www.1edtech.org/standards/oneroster"}')
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, version = EXCLUDED.version, entities = EXCLUDED.entities,
  directions = EXCLUDED.directions, status = EXCLUDED.status, manifest = EXCLUDED.manifest;

CREATE OR REPLACE FUNCTION public.integration_set_config(p_integration uuid, p_config jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.integrations; k text;
BEGIN
  SELECT * INTO i FROM public.integrations WHERE id = p_integration;
  IF i.id IS NULL OR NOT public.scholar_can(i.school_id, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_config) <> 'object' THEN RAISE EXCEPTION 'config must be an object' USING ERRCODE = '22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_config) LOOP
    IF k NOT IN ('base_url','token_url','outbound_url','term','academic_year') THEN RAISE EXCEPTION 'unknown config key %', k USING ERRCODE = '22023'; END IF;
    IF k LIKE '%url' AND (p_config->>k) !~ '^https://[^/\s@?#]+(/[^\s@]*)?$' THEN RAISE EXCEPTION '% must be an https URL', k USING ERRCODE = '22023'; END IF;
  END LOOP;
  UPDATE public.integrations SET config = config || p_config, updated_at = now() WHERE id = i.id;
  PERFORM public._integration_audit(i.school_id, i.id, 'set_config', jsonb_build_object('keys', (SELECT jsonb_agg(x) FROM jsonb_object_keys(p_config) x)));
END $$;
REVOKE ALL ON FUNCTION public.integration_set_config(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.integration_set_config(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.integration_claim_due_jobs(p_limit integer DEFAULT 50)
RETURNS SETOF public.sync_jobs LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.sync_jobs j SET next_run_at = now() + make_interval(mins => j.interval_minutes)
   WHERE j.id IN (
     SELECT id FROM (
       SELECT j2.id, row_number() OVER (PARTITION BY j2.integration_id ORDER BY j2.next_run_at) rn, j2.next_run_at
         FROM public.sync_jobs j2 JOIN public.integrations i ON i.id = j2.integration_id
        WHERE j2.enabled AND j2.next_run_at <= now() AND i.status = 'active'
          AND i.connector_key NOT IN ('csv','rest-webhook')
     ) x WHERE rn = 1 ORDER BY next_run_at LIMIT least(p_limit, 500))
     AND j.id IN (SELECT j3.id FROM public.sync_jobs j3 WHERE j3.next_run_at <= now() FOR UPDATE SKIP LOCKED)
  RETURNING j.*;
$$;
REVOKE ALL ON FUNCTION public.integration_claim_due_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.integration_claim_due_jobs(integer) TO service_role;

COMMIT;
