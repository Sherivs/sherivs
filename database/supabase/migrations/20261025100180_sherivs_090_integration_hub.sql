-- =============================================================================
-- SHERIVS-090 — Integration Hub: connect a school's existing software (SIS, result/fee
-- systems, LMS, spreadsheets) so its records appear inside Sherivs.
--
-- NOT APPLIED. Review only (draft PR). Apply after owner approval.
--
-- connector_manifests  platform catalog (CSV, REST/webhook, Google Classroom, ...).
-- integrations         one row per school connection. Holds a vault REFERENCE only
--                      (org_credentials provider/name, migration 0190); never a secret.
-- field_mappings       source field -> canonical field per entity.
-- sync_jobs            schedule per (integration, entity, direction).
-- sync_runs            every run, idempotency key unique per integration.
-- external_id_map      identity map external id <-> Sherivs id + payload hash (dedupe,
--                      idempotent re-sync).
-- integration_records  canonical staging copy of every inbound record (mirror mode).
-- integration_audit    append-only.
--
-- Tenant isolation: every write goes through SECURITY DEFINER RPCs that derive
-- school_id from the integration row, never from the caller or the payload.
-- Rollback: database/supabase/rollbacks/20261025100180_sherivs_090_integration_hub.sql
-- =============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.connector_manifests (
  key          text PRIMARY KEY CHECK (key ~ '^[a-z0-9][a-z0-9_.-]{1,62}$'),
  name         text NOT NULL,
  version      text NOT NULL DEFAULT '1.0.0',
  category     text NOT NULL CHECK (category IN ('file','api','lms','sis','finance','identity')),
  auth_type    text NOT NULL CHECK (auth_type IN ('none','api_key','oauth2','hmac_webhook','db_replica','sftp')),
  entities     text[] NOT NULL,
  directions   text[] NOT NULL DEFAULT ARRAY['inbound'],
  status       text NOT NULL DEFAULT 'beta' CHECK (status IN ('stub','beta','ga','retired')),
  manifest     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.connector_manifests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.connector_manifests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.connector_manifests TO authenticated;
GRANT ALL ON public.connector_manifests TO service_role;
DROP POLICY IF EXISTS connector_manifests_read ON public.connector_manifests;
CREATE POLICY connector_manifests_read ON public.connector_manifests FOR SELECT TO authenticated USING (status <> 'retired');

INSERT INTO public.connector_manifests (key, name, category, auth_type, entities, directions, status, manifest) VALUES
 ('csv', 'CSV / Excel import', 'file', 'none', ARRAY['student','staff','guardian','class','result','fee_invoice','payment'], ARRAY['inbound'], 'beta',
   '{"formats":["csv","xlsx"],"max_rows":20000,"preview_rows":20}'),
 ('rest-webhook', 'Generic REST / webhook', 'api', 'hmac_webhook', ARRAY['student','staff','guardian','class','result','fee_invoice','payment'], ARRAY['inbound','outbound'], 'beta',
   '{"signature":"x-sherivs-signature: sha256=<hex HMAC of t.body>","timestamp_header":"x-sherivs-timestamp","max_skew_s":300}'),
 ('google-classroom', 'Google Classroom', 'lms', 'oauth2', ARRAY['class','student','staff','assignment'], ARRAY['inbound'], 'stub',
   '{"scopes":["https://www.googleapis.com/auth/classroom.courses.readonly","https://www.googleapis.com/auth/classroom.rosters.readonly"],"docs":"https://developers.google.com/classroom/reference/rest"}')
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, entities = EXCLUDED.entities, status = EXCLUDED.status, manifest = EXCLUDED.manifest;

CREATE TABLE IF NOT EXISTS public.integrations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  connector_key    text NOT NULL REFERENCES public.connector_manifests(key),
  display_name     text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  mode             text NOT NULL DEFAULT 'mirror' CHECK (mode IN ('mirror','gradual','cutover')),
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','disconnected')),
  system_of_record jsonb NOT NULL DEFAULT '{}'::jsonb, -- {"student":"external"|"sherivs", ...}
  credential_provider text CHECK (credential_provider IS NULL OR credential_provider ~ '^[a-z0-9][a-z0-9_.-]{0,62}$'),
  credential_name  text CHECK (credential_name IS NULL OR credential_name ~ '^[a-z0-9][a-z0-9_.-]{0,62}$'),
  webhook_id       uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE, -- public, non-secret routing id
  max_records_per_run integer NOT NULL DEFAULT 20000 CHECK (max_records_per_run BETWEEN 1 AND 200000),
  max_runs_per_day integer NOT NULL DEFAULT 96 CHECK (max_runs_per_day BETWEEN 1 AND 2000),
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, id)
);
CREATE INDEX IF NOT EXISTS integrations_school_idx ON public.integrations (school_id);

CREATE TABLE IF NOT EXISTS public.field_mappings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL,
  integration_id uuid NOT NULL,
  entity         text NOT NULL,
  source_field   text NOT NULL CHECK (length(source_field) BETWEEN 1 AND 200),
  target_field   text NOT NULL CHECK (target_field ~ '^[a-z][a-z0-9_]{0,62}$'),
  transform      text NOT NULL DEFAULT 'none' CHECK (transform IN ('none','trim','upper','lower','date_dmy','date_iso','phone_ng','naira_kobo')),
  FOREIGN KEY (school_id, integration_id) REFERENCES public.integrations (school_id, id) ON DELETE CASCADE,
  UNIQUE (integration_id, entity, target_field)
);

CREATE TABLE IF NOT EXISTS public.sync_jobs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL,
  integration_id uuid NOT NULL,
  entity         text NOT NULL,
  direction      text NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound','outbound')),
  interval_minutes integer NOT NULL DEFAULT 60 CHECK (interval_minutes BETWEEN 15 AND 10080),
  enabled        boolean NOT NULL DEFAULT true,
  next_run_at    timestamptz NOT NULL DEFAULT now(),
  cursor         text, -- connector-specific incremental cursor (updated_since, page token)
  FOREIGN KEY (school_id, integration_id) REFERENCES public.integrations (school_id, id) ON DELETE CASCADE,
  UNIQUE (integration_id, entity, direction)
);
CREATE INDEX IF NOT EXISTS sync_jobs_due_idx ON public.sync_jobs (next_run_at) WHERE enabled;

CREATE TABLE IF NOT EXISTS public.sync_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       uuid NOT NULL,
  integration_id  uuid NOT NULL,
  job_id          uuid REFERENCES public.sync_jobs(id) ON DELETE SET NULL,
  entity          text NOT NULL,
  trigger         text NOT NULL CHECK (trigger IN ('manual','schedule','webhook','csv_upload')),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  status          text NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','partial','failed','rejected')),
  received        integer NOT NULL DEFAULT 0,
  created         integer NOT NULL DEFAULT 0,
  updated         integer NOT NULL DEFAULT 0,
  unchanged       integer NOT NULL DEFAULT 0,
  conflicts       integer NOT NULL DEFAULT 0,
  errors          jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  FOREIGN KEY (school_id, integration_id) REFERENCES public.integrations (school_id, id) ON DELETE CASCADE,
  UNIQUE (integration_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS sync_runs_integration_idx ON public.sync_runs (integration_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.external_id_map (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL,
  integration_id uuid NOT NULL,
  entity         text NOT NULL,
  external_id    text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 200),
  sherivs_id     uuid,
  match_method   text NOT NULL DEFAULT 'new' CHECK (match_method IN ('new','external_id','natural_key','manual')),
  payload_hash   text NOT NULL,
  last_run_id    uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (school_id, integration_id) REFERENCES public.integrations (school_id, id) ON DELETE CASCADE,
  UNIQUE (integration_id, entity, external_id)
);
CREATE INDEX IF NOT EXISTS external_id_map_sherivs_idx ON public.external_id_map (school_id, entity, sherivs_id);

CREATE TABLE IF NOT EXISTS public.integration_records (
  school_id      uuid NOT NULL,
  integration_id uuid NOT NULL,
  entity         text NOT NULL,
  external_id    text NOT NULL,
  data           jsonb NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (integration_id, entity, external_id),
  FOREIGN KEY (school_id, integration_id) REFERENCES public.integrations (school_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.integration_audit (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at             timestamptz NOT NULL DEFAULT now(),
  school_id      uuid NOT NULL,
  integration_id uuid,
  actor          uuid,
  actor_kind     text NOT NULL DEFAULT 'user' CHECK (actor_kind IN ('user','service','webhook')),
  action         text NOT NULL,
  detail         jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS integration_audit_school_idx ON public.integration_audit (school_id, at DESC);
CREATE OR REPLACE FUNCTION public._integration_audit_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'integration_audit is append-only'; END $$;
DROP TRIGGER IF EXISTS integration_audit_immutable ON public.integration_audit;
CREATE TRIGGER integration_audit_immutable BEFORE UPDATE OR DELETE ON public.integration_audit
  FOR EACH ROW EXECUTE FUNCTION public._integration_audit_immutable();
DROP TRIGGER IF EXISTS integration_audit_no_truncate ON public.integration_audit;
CREATE TRIGGER integration_audit_no_truncate BEFORE TRUNCATE ON public.integration_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public._integration_audit_immutable();

-- Schools the caller administers, computed ONCE per statement (initplan), not per row.
-- (A per-row scholar_can() in the policy took minutes on 100k sync_runs in the sim lab.)
CREATE OR REPLACE FUNCTION public._integration_admin_schools() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(array_agg(DISTINCT s), '{}') FROM (
    SELECT public.get_my_school_id() AS s
    UNION SELECT m.school_id FROM public.organization_memberships m WHERE m.user_id = auth.uid() AND m.is_active
  ) x WHERE s IS NOT NULL AND public.scholar_can(s, 'settings.manage');
$$;
REVOKE ALL ON FUNCTION public._integration_admin_schools() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._integration_admin_schools() TO authenticated;

-- RLS: school admins READ their own school's rows; no direct client writes anywhere.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['integrations','field_mappings','sync_jobs','sync_runs','external_id_map','integration_records','integration_audit'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_school_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (school_id = ANY ((SELECT public._integration_admin_schools())::uuid[]) OR (SELECT public.is_super_admin()))', t || '_school_read', t);
  END LOOP;
END $$;
-- Records may contain personal data: hide raw staging rows from everyone but service_role.
DROP POLICY IF EXISTS integration_records_school_read ON public.integration_records;
REVOKE SELECT ON public.integration_records FROM authenticated;

CREATE OR REPLACE FUNCTION public._integration_audit(p_school uuid, p_integration uuid, p_action text, p_detail jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.integration_audit (school_id, integration_id, actor, actor_kind, action, detail)
  VALUES (p_school, p_integration, auth.uid(), CASE WHEN coalesce(auth.role(),'') = 'service_role' THEN 'service' ELSE 'user' END, p_action, coalesce(p_detail,'{}'::jsonb));
$$;
REVOKE ALL ON FUNCTION public._integration_audit(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

-- Connect -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.integration_connect(p_school uuid, p_connector text, p_name text, p_mode text DEFAULT 'mirror')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid; m public.connector_manifests;
BEGIN
  IF NOT public.scholar_can(p_school, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO m FROM public.connector_manifests WHERE key = p_connector AND status <> 'retired';
  IF m.key IS NULL THEN RAISE EXCEPTION 'unknown connector %', p_connector USING ERRCODE = '22023'; END IF;
  INSERT INTO public.integrations (school_id, connector_key, display_name, mode, created_by,
      credential_provider, credential_name, system_of_record)
    VALUES (p_school, m.key, p_name, coalesce(p_mode,'mirror'), auth.uid(),
      CASE WHEN m.auth_type = 'none' THEN NULL ELSE 'integration.' || m.key END,
      CASE WHEN m.auth_type = 'none' THEN NULL ELSE replace(gen_random_uuid()::text, '-', '') END,
      (SELECT coalesce(jsonb_object_agg(e, 'external'), '{}'::jsonb) FROM unnest(m.entities) e))
    RETURNING id INTO v;
  INSERT INTO public.sync_jobs (school_id, integration_id, entity)
    SELECT p_school, v, e FROM unnest(m.entities) e WHERE m.key <> 'csv';
  PERFORM public._integration_audit(p_school, v, 'connect', jsonb_build_object('connector', m.key, 'mode', p_mode));
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.integration_update(p_integration uuid, p_mode text DEFAULT NULL, p_status text DEFAULT NULL, p_sor jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.integrations;
BEGIN
  SELECT * INTO i FROM public.integrations WHERE id = p_integration;
  IF i.id IS NULL OR NOT public.scholar_can(i.school_id, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_sor IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_each_text(p_sor) WHERE value NOT IN ('external','sherivs')) THEN
    RAISE EXCEPTION 'system_of_record values must be external or sherivs' USING ERRCODE = '22023'; END IF;
  UPDATE public.integrations SET mode = coalesce(p_mode, mode), status = coalesce(p_status, status),
    system_of_record = coalesce(p_sor, system_of_record), updated_at = now() WHERE id = p_integration;
  PERFORM public._integration_audit(i.school_id, i.id, 'update', jsonb_strip_nulls(jsonb_build_object('mode', p_mode, 'status', p_status, 'sor', p_sor)));
END $$;

CREATE OR REPLACE FUNCTION public.integration_set_mappings(p_integration uuid, p_entity text, p_mappings jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.integrations; n integer;
BEGIN
  SELECT * INTO i FROM public.integrations WHERE id = p_integration;
  IF i.id IS NULL OR NOT public.scholar_can(i.school_id, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.field_mappings WHERE integration_id = i.id AND entity = p_entity;
  INSERT INTO public.field_mappings (school_id, integration_id, entity, source_field, target_field, transform)
    SELECT i.school_id, i.id, p_entity, x->>'source', x->>'target', coalesce(x->>'transform','none')
      FROM jsonb_array_elements(p_mappings) x;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public._integration_audit(i.school_id, i.id, 'set_mappings', jsonb_build_object('entity', p_entity, 'count', n));
  RETURN n;
END $$;

-- Ingest: the ONE write path for inbound records. ----------------------------------
-- p_records: [{"external_id":"..","data":{canonical fields}}] (mapping already applied
-- by the connector runtime). school_id is taken from the integration row only.
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

-- Webhook routing lookup (service_role only): public webhook id -> integration + vault ref.
CREATE OR REPLACE FUNCTION public.integration_webhook_target(p_webhook_id uuid)
RETURNS TABLE (integration_id uuid, school_id uuid, status text, credential_provider text, credential_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT id, school_id, status, credential_provider, credential_name FROM public.integrations
   WHERE webhook_id = p_webhook_id AND connector_key = 'rest-webhook' AND status IN ('draft','active');
$$;

-- Scheduler: claim due jobs (service_role cron). SKIP LOCKED so parallel workers never double-run.
CREATE OR REPLACE FUNCTION public.integration_claim_due_jobs(p_limit integer DEFAULT 50)
RETURNS SETOF public.sync_jobs LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.sync_jobs j SET next_run_at = now() + make_interval(mins => j.interval_minutes)
   WHERE j.id IN (SELECT j2.id FROM public.sync_jobs j2 JOIN public.integrations i ON i.id = j2.integration_id
                   WHERE j2.enabled AND j2.next_run_at <= now() AND i.status = 'active'
                   ORDER BY j2.next_run_at LIMIT least(p_limit, 500) FOR UPDATE OF j2 SKIP LOCKED)
  RETURNING j.*;
$$;

REVOKE ALL ON FUNCTION public.integration_connect(uuid, text, text, text), public.integration_update(uuid, text, text, jsonb),
  public.integration_set_mappings(uuid, text, jsonb), public.integration_ingest(uuid, text, jsonb, text, text),
  public.integration_webhook_target(uuid), public.integration_claim_due_jobs(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.integration_connect(uuid, text, text, text), public.integration_update(uuid, text, text, jsonb),
  public.integration_set_mappings(uuid, text, jsonb), public.integration_ingest(uuid, text, jsonb, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.integration_webhook_target(uuid), public.integration_claim_due_jobs(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.integration_webhook_target(uuid), public.integration_claim_due_jobs(integer) TO service_role;

COMMIT;
