-- Rollback SHERIVS-092. Restores SHERIVS-090's integration_ingest (student-only writer), drops outbound
-- triggers/outbox/invites. Rows already written into core tables stay (they are school records).
BEGIN;
DROP TRIGGER IF EXISTS trg_integration_outbox_students ON public.students;
DROP TRIGGER IF EXISTS trg_integration_outbox_grades ON public.grades;
DROP TRIGGER IF EXISTS trg_integration_outbox_fees ON public.fees;
DROP FUNCTION IF EXISTS public._integration_outbox_capture(), public.integration_set_outbound(uuid, boolean, jsonb),
  public.integration_outbox_claim(integer), public.integration_outbox_ack(bigint, boolean, text, text),
  public.integration_job_done(uuid, text, text),
  public._integration_apply_record(public.integrations, text, text, jsonb, uuid, boolean),
  public._integration_student(public.integrations, jsonb), public._integration_class(public.integrations, jsonb),
  public._integration_ref(uuid, uuid, text, text);
DROP TABLE IF EXISTS public.integration_outbox, public.integration_account_invites;
DELETE FROM public.external_id_map WHERE match_method IN ('pending_account','outbound');
ALTER TABLE public.external_id_map DROP CONSTRAINT IF EXISTS external_id_map_match_method_check;
ALTER TABLE public.external_id_map ADD CONSTRAINT external_id_map_match_method_check
  CHECK (match_method IN ('new','external_id','natural_key','manual'));
DROP INDEX IF EXISTS public.integrations_outbound_idx;
ALTER TABLE public.integrations DROP CONSTRAINT IF EXISTS integrations_config_no_secrets;
ALTER TABLE public.integrations DROP COLUMN IF EXISTS outbound_enabled, DROP COLUMN IF EXISTS config;
UPDATE public.connector_manifests SET entities = ARRAY['student','staff','guardian','class','result','fee_invoice','payment'] WHERE key IN ('csv','rest-webhook');
-- Restore the SHERIVS-090 integration_ingest (copied verbatim from 20261024000900).
CREATE OR REPLACE FUNCTION public.integration_ingest(p_integration uuid, p_entity text, p_records jsonb,
  p_idempotency_key text, p_trigger text DEFAULT 'manual')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  i public.integrations; r public.sync_runs; rec jsonb; ext text; d jsonb; h text;
  m public.external_id_map; sid uuid; method text; apply_core boolean;
  c_new int := 0; c_upd int := 0; c_same int := 0; c_conf int := 0; errs jsonb := '[]'::jsonb; n int;
BEGIN
  SELECT * INTO i FROM public.integrations WHERE id = p_integration;
  IF i.id IS NULL OR NOT public.scholar_can(i.school_id, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF i.status IN ('paused','disconnected') THEN RAISE EXCEPTION 'integration is %', i.status USING ERRCODE = '55000'; END IF;
  IF jsonb_typeof(p_records) <> 'array' THEN RAISE EXCEPTION 'records must be an array' USING ERRCODE = '22023'; END IF;
  n := jsonb_array_length(p_records);

  -- Idempotent replay: same key returns the original run, no writes.
  SELECT * INTO r FROM public.sync_runs WHERE integration_id = i.id AND idempotency_key = p_idempotency_key;
  IF r.id IS NOT NULL THEN
    RETURN jsonb_build_object('run_id', r.id, 'replayed', true, 'status', r.status, 'created', r.created, 'updated', r.updated, 'unchanged', r.unchanged);
  END IF;

  -- Per-school limits.
  IF n > i.max_records_per_run OR (SELECT count(*) FROM public.sync_runs WHERE integration_id = i.id AND started_at > now() - interval '1 day') >= i.max_runs_per_day THEN
    INSERT INTO public.sync_runs (school_id, integration_id, entity, trigger, idempotency_key, status, received, finished_at, errors)
      VALUES (i.school_id, i.id, p_entity, p_trigger, p_idempotency_key, 'rejected', n, now(), '[{"error":"limit exceeded"}]') RETURNING * INTO r;
    PERFORM public._integration_audit(i.school_id, i.id, 'run_rejected', jsonb_build_object('run', r.id, 'received', n));
    RETURN jsonb_build_object('run_id', r.id, 'status', 'rejected');
  END IF;

  INSERT INTO public.sync_runs (school_id, integration_id, entity, trigger, idempotency_key, received)
    VALUES (i.school_id, i.id, p_entity, p_trigger, p_idempotency_key, n) RETURNING * INTO r;
  apply_core := i.mode <> 'mirror' AND coalesce(i.system_of_record->>p_entity, 'external') = 'external';

  FOR rec IN SELECT * FROM jsonb_array_elements(p_records) LOOP
    ext := rec->>'external_id'; d := coalesce(rec->'data', '{}'::jsonb);
    IF ext IS NULL OR length(ext) = 0 OR length(ext) > 200 THEN
      errs := errs || jsonb_build_object('error', 'missing external_id'); CONTINUE; END IF;
    h := md5(d::text);
    SELECT * INTO m FROM public.external_id_map WHERE integration_id = i.id AND entity = p_entity AND external_id = ext;
    IF m.id IS NOT NULL AND m.payload_hash = h THEN c_same := c_same + 1; CONTINUE; END IF;

    INSERT INTO public.integration_records (school_id, integration_id, entity, external_id, data)
      VALUES (i.school_id, i.id, p_entity, ext, d)
      ON CONFLICT (integration_id, entity, external_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now();

    sid := m.sherivs_id; method := coalesce(m.match_method, 'new');
    IF apply_core AND p_entity = 'student' THEN
      IF sid IS NULL AND nullif(d->>'admission_number','') IS NOT NULL THEN
        -- Identity match on the natural key, inside THIS school only.
        SELECT s.id INTO sid FROM public.students s WHERE s.school_id = i.school_id AND s.admission_number = d->>'admission_number' LIMIT 1;
        IF sid IS NOT NULL THEN method := 'natural_key';
          IF EXISTS (SELECT 1 FROM public.external_id_map x WHERE x.integration_id = i.id AND x.entity = 'student' AND x.sherivs_id = sid AND x.external_id <> ext) THEN
            c_conf := c_conf + 1; errs := errs || jsonb_build_object('external_id', ext, 'error', 'duplicate natural key'); CONTINUE; END IF;
        END IF;
      END IF;
      IF sid IS NULL THEN
        INSERT INTO public.students (school_id, admission_number, gender, date_of_birth, state_of_origin)
          VALUES (i.school_id, d->>'admission_number', d->>'gender', nullif(d->>'date_of_birth','')::date, d->>'state_of_origin')
          RETURNING id INTO sid;
        method := 'new';
      ELSE
        UPDATE public.students s SET
          gender = coalesce(d->>'gender', s.gender),
          date_of_birth = coalesce(nullif(d->>'date_of_birth','')::date, s.date_of_birth),
          state_of_origin = coalesce(d->>'state_of_origin', s.state_of_origin)
         WHERE s.id = sid AND s.school_id = i.school_id;
        IF m.id IS NOT NULL THEN method := 'external_id'; END IF;
      END IF;
    END IF;

    INSERT INTO public.external_id_map (school_id, integration_id, entity, external_id, sherivs_id, match_method, payload_hash, last_run_id)
      VALUES (i.school_id, i.id, p_entity, ext, sid, method, h, r.id)
      ON CONFLICT (integration_id, entity, external_id) DO UPDATE
        SET sherivs_id = EXCLUDED.sherivs_id, match_method = EXCLUDED.match_method, payload_hash = EXCLUDED.payload_hash,
            last_run_id = EXCLUDED.last_run_id, updated_at = now();
    IF m.id IS NULL THEN c_new := c_new + 1; ELSE c_upd := c_upd + 1; END IF;
  END LOOP;

  UPDATE public.sync_runs SET created = c_new, updated = c_upd, unchanged = c_same, conflicts = c_conf, errors = errs,
    status = CASE WHEN jsonb_array_length(errs) = 0 THEN 'succeeded' WHEN c_new + c_upd + c_same > 0 THEN 'partial' ELSE 'failed' END,
    finished_at = now() WHERE id = r.id RETURNING * INTO r;
  UPDATE public.integrations SET status = 'active', updated_at = now() WHERE id = i.id AND status = 'draft';
  PERFORM public._integration_audit(i.school_id, i.id, 'run', jsonb_build_object('run', r.id, 'entity', p_entity, 'trigger', p_trigger,
    'created', c_new, 'updated', c_upd, 'unchanged', c_same, 'conflicts', c_conf));
  RETURN jsonb_build_object('run_id', r.id, 'replayed', false, 'status', r.status, 'created', c_new, 'updated', c_upd, 'unchanged', c_same, 'conflicts', c_conf);
END $$;
COMMIT;
