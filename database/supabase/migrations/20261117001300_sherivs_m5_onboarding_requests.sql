-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.
-- =============================================================================
-- M5 part B (ADR-108): pre-tenant onboarding requests and resumable interview sessions.
--
-- Two PLATFORM tables. Neither has a tenant column: no organization exists yet when a visitor
-- asks to be onboarded. Nobody but the service role writes them. The public intake runs as a
-- server function (frontend/src/lib/onboarding/intake.server.ts) that validates input, checks
-- Turnstile, rate-limits by address and a honeypot, and only then calls the functions below
-- with the service role. anon and authenticated hold no privilege on either table or on any
-- function created here.
--
-- Platform staff: the SELECT policies below admit staff holding 'platform.onboarding.read'
-- (the existing 'onboarding' platform role) through public.has_platform_capability(text). No
-- table grant is given to authenticated in this file, so those policies are dormant: today the
-- console reads through the server with the service role after checking the same capability.
-- A later console mission may GRANT SELECT to authenticated; the policies then decide the rows.
--
-- The resume token is never stored. The server keeps sha-256(token) as lowercase hex and every
-- lookup is by that hash. Answers are opaque, bounded JSON: this file does not interpret them.
--
-- Personal data (NDPA 2023): contact name, email, phone, optional role and note, and the
-- consent record. Retention (ADR-108, LEGAL REVIEW REQUIRED): no policy in
-- RETENTION_POLICY_SCHEDULE.json covers pre-tenant contact data yet. Provisional rule proposed
-- in ADR-108: interview sessions are purged at expires_at (default 30 days) by
-- public.onboarding_intake_purge_expired(); a request that is rejected or never proceeds is
-- erased 365 days after its last update (aligned with RP-COMMS-ORG); a provisioned request
-- follows the tenant's identity-profile policy. Only the session purge is implemented here.
--
-- Audit: every insert, update and delete on both tables writes an audit_logs row with no
-- organization and NO personal data (ids, status, revision and completion only).
-- Rollback: database/supabase/rollbacks/20261117001300_sherivs_m5_onboarding_requests.sql
-- =============================================================================

-- 1. Requests -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.onboarding_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_name         text NOT NULL CHECK (length(btrim(org_name)) BETWEEN 2 AND 160),
  institution_type text NOT NULL CHECK (institution_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  state            text CHECK (state IS NULL OR length(btrim(state)) BETWEEN 1 AND 64),
  lga              text CHECK (lga IS NULL OR length(btrim(lga)) BETWEEN 1 AND 80),
  contact_name     text NOT NULL CHECK (length(btrim(contact_name)) BETWEEN 2 AND 120),
  contact_email    text NOT NULL CHECK (length(contact_email) BETWEEN 6 AND 254
                                        AND contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  contact_phone    text CHECK (contact_phone IS NULL OR (length(contact_phone) BETWEEN 7 AND 24
                                        AND contact_phone ~ '^\+?[0-9][0-9 ()-]{5,22}$')),
  contact_role     text CHECK (contact_role IS NULL OR length(btrim(contact_role)) BETWEEN 1 AND 120),
  note             text CHECK (note IS NULL OR length(note) <= 2000),
  consent_given    boolean NOT NULL CHECK (consent_given),
  consent_version  text NOT NULL CHECK (consent_version ~ '^[A-Za-z0-9._-]{1,32}$'),
  consent_given_at timestamptz NOT NULL,
  source           text NOT NULL CHECK (source IN ('public_onboarding', 'public_demo', 'console')),
  status           text NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new', 'in_interview', 'plan_ready', 'under_review',
                                       'approved', 'provisioned', 'rejected')),
  assigned_staff   uuid REFERENCES public.platform_staff(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onboarding_requests_status_idx
  ON public.onboarding_requests (status, created_at);
-- Not unique on purpose: a second request from the same address is accepted the same way, so the
-- endpoint never reveals whether an address is already known.
CREATE INDEX IF NOT EXISTS onboarding_requests_email_idx
  ON public.onboarding_requests (lower(contact_email));

-- 2. Interview sessions ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reality_interview_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id        uuid NOT NULL REFERENCES public.onboarding_requests(id) ON DELETE CASCADE,
  resume_token_hash text NOT NULL UNIQUE CHECK (resume_token_hash ~ '^[0-9a-f]{64}$'),
  graph_version     text NOT NULL CHECK (graph_version ~ '^[A-Za-z0-9._-]{1,32}$'),
  answers           jsonb NOT NULL DEFAULT '{}'::jsonb
                      CHECK (jsonb_typeof(answers) = 'object' AND octet_length(answers::text) <= 65536),
  revision          integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  completion_pct    smallint NOT NULL DEFAULT 0 CHECK (completion_pct BETWEEN 0 AND 100),
  completed_at      timestamptz,
  expires_at        timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS reality_interview_sessions_request_idx
  ON public.reality_interview_sessions (request_id);
CREATE INDEX IF NOT EXISTS reality_interview_sessions_expiry_idx
  ON public.reality_interview_sessions (expires_at);

-- 3. Row-level security and privileges ------------------------------------------------------------
ALTER TABLE public.onboarding_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.reality_interview_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reality_interview_sessions FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.onboarding_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.reality_interview_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.onboarding_requests TO service_role;
GRANT ALL ON TABLE public.reality_interview_sessions TO service_role;

DROP POLICY IF EXISTS onboarding_requests_service ON public.onboarding_requests;
CREATE POLICY onboarding_requests_service ON public.onboarding_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS onboarding_requests_platform_read ON public.onboarding_requests;
CREATE POLICY onboarding_requests_platform_read ON public.onboarding_requests
  FOR SELECT TO authenticated USING (public.has_platform_capability('platform.onboarding.read'));

DROP POLICY IF EXISTS reality_interview_sessions_service ON public.reality_interview_sessions;
CREATE POLICY reality_interview_sessions_service ON public.reality_interview_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS reality_interview_sessions_platform_read ON public.reality_interview_sessions;
CREATE POLICY reality_interview_sessions_platform_read ON public.reality_interview_sessions
  FOR SELECT TO authenticated USING (public.has_platform_capability('platform.onboarding.read'));

-- 4. Audit (no organization, no personal data) ------------------------------------------------
CREATE OR REPLACE FUNCTION public.onboarding_intake_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  j jsonb := to_jsonb(coalesce(NEW, OLD));
  v_detail jsonb;
BEGIN
  IF TG_TABLE_NAME = 'onboarding_requests' THEN
    v_detail := jsonb_build_object('status', j->'status', 'source', j->'source',
                                   'assigned', (j->>'assigned_staff') IS NOT NULL);
  ELSE
    v_detail := jsonb_build_object('request_id', j->'request_id', 'revision', j->'revision',
                                   'completion_pct', j->'completion_pct',
                                   'completed', (j->>'completed_at') IS NOT NULL);
  END IF;
  INSERT INTO public.audit_logs (school_id, user_id, action, table_name, record_id, new_value)
  VALUES (NULL, auth.uid(), 'platform.' || TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME,
          (j->>'id')::uuid, v_detail);
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.onboarding_intake_audit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS onboarding_requests_audit ON public.onboarding_requests;
CREATE TRIGGER onboarding_requests_audit AFTER INSERT OR UPDATE OR DELETE ON public.onboarding_requests
  FOR EACH ROW EXECUTE FUNCTION public.onboarding_intake_audit();
DROP TRIGGER IF EXISTS reality_interview_sessions_audit ON public.reality_interview_sessions;
CREATE TRIGGER reality_interview_sessions_audit AFTER INSERT OR UPDATE OR DELETE ON public.reality_interview_sessions
  FOR EACH ROW EXECUTE FUNCTION public.onboarding_intake_audit();

-- 5. Server-only functions (service role EXECUTE only; SECURITY INVOKER) -------------------------
-- Errors: PT404 = no live session for this hash; PT409 = stale revision or session already complete.

CREATE OR REPLACE FUNCTION public.onboarding_intake_create(
  p_org_name text, p_institution_type text, p_state text, p_lga text,
  p_contact_name text, p_contact_email text, p_contact_phone text, p_contact_role text,
  p_note text, p_consent_version text, p_source text, p_token_hash text, p_graph_version text)
RETURNS TABLE (session_id uuid, revision integer, completion_pct smallint, expires_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_request uuid;
BEGIN
  INSERT INTO public.onboarding_requests (org_name, institution_type, state, lga, contact_name,
    contact_email, contact_phone, contact_role, note, consent_given, consent_version,
    consent_given_at, source)
  VALUES (btrim(p_org_name), p_institution_type, nullif(btrim(p_state), ''), nullif(btrim(p_lga), ''),
    btrim(p_contact_name), lower(btrim(p_contact_email)), nullif(btrim(p_contact_phone), ''),
    nullif(btrim(p_contact_role), ''), nullif(btrim(p_note), ''), true, p_consent_version, now(), p_source)
  RETURNING id INTO v_request;

  RETURN QUERY
  INSERT INTO public.reality_interview_sessions AS s (request_id, resume_token_hash, graph_version)
  VALUES (v_request, p_token_hash, p_graph_version)
  RETURNING s.id, s.revision, s.completion_pct, s.expires_at;
END
$$;

CREATE OR REPLACE FUNCTION public.onboarding_intake_load(p_token_hash text)
RETURNS TABLE (session_id uuid, resume_token_hash text, graph_version text, answers jsonb,
               revision integer, completion_pct smallint, completed_at timestamptz,
               expires_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT s.id, s.resume_token_hash, s.graph_version, s.answers, s.revision, s.completion_pct,
         s.completed_at, s.expires_at
    FROM public.reality_interview_sessions s
   WHERE s.resume_token_hash = p_token_hash
     AND s.expires_at > now();
$$;

CREATE OR REPLACE FUNCTION public.onboarding_intake_save(
  p_token_hash text, p_expected_revision integer, p_answers jsonb, p_completion_pct integer)
RETURNS TABLE (revision integer, completion_pct smallint, updated_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_row public.reality_interview_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.reality_interview_sessions s
   WHERE s.resume_token_hash = p_token_hash AND s.expires_at > now()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session not found' USING ERRCODE = 'PT404';
  END IF;
  IF v_row.completed_at IS NOT NULL OR v_row.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'stale revision' USING ERRCODE = 'PT409';
  END IF;

  UPDATE public.onboarding_requests r SET status = 'in_interview', updated_at = now()
   WHERE r.id = v_row.request_id AND r.status = 'new';

  RETURN QUERY
  UPDATE public.reality_interview_sessions s
     SET answers = p_answers, completion_pct = p_completion_pct::smallint,
         revision = s.revision + 1, updated_at = now()
   WHERE s.id = v_row.id
  RETURNING s.revision, s.completion_pct, s.updated_at;
END
$$;

CREATE OR REPLACE FUNCTION public.onboarding_intake_complete(p_token_hash text, p_expected_revision integer)
RETURNS TABLE (revision integer, completed_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_row public.reality_interview_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.reality_interview_sessions s
   WHERE s.resume_token_hash = p_token_hash AND s.expires_at > now()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session not found' USING ERRCODE = 'PT404';
  END IF;
  IF v_row.completed_at IS NOT NULL OR v_row.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'stale revision' USING ERRCODE = 'PT409';
  END IF;

  RETURN QUERY
  UPDATE public.reality_interview_sessions s
     SET completed_at = now(), revision = s.revision + 1, updated_at = now()
   WHERE s.id = v_row.id
  RETURNING s.revision, s.completed_at;
END
$$;

-- Retention job entry point (ADR-108). Deletes only sessions whose expiry has passed, using the
-- database clock; the caller cannot choose the cut-off. Returns the number of rows removed.
CREATE OR REPLACE FUNCTION public.onboarding_intake_purge_expired()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM public.reality_interview_sessions s WHERE s.expires_at <= now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

REVOKE ALL ON FUNCTION public.onboarding_intake_create(text, text, text, text, text, text, text, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.onboarding_intake_load(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.onboarding_intake_save(text, integer, jsonb, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.onboarding_intake_complete(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.onboarding_intake_purge_expired() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.onboarding_intake_create(text, text, text, text, text, text, text, text, text, text, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.onboarding_intake_load(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.onboarding_intake_save(text, integer, jsonb, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.onboarding_intake_complete(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.onboarding_intake_purge_expired() TO service_role;
