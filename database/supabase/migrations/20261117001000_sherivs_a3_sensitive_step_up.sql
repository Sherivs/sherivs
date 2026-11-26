-- NOT APPLIED. Needs the founder's written approval for this file, a fresh backup and a restore test; applied from merged master only.
-- A3 (ADR-138, decision D-09): a verified passkey step-up is required to promote an agent. The evidence is single use,
-- valid for at most five minutes, bound to the exact promotion (organisation, agent, level, evidence) and to the person.
-- The server verifies the WebAuthn assertion (challenge = the digest below) and records the result with the service role;
-- the database never sees a credential. Money, safeguarding and the other capped classes already need a step-up in WF-07.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.wf_autonomy_promote(uuid,uuid,text,text,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'A3: the AIN-02 migration is required first';
  END IF;
  IF to_regclass('public.wf_sensitive_step_up') IS NOT NULL THEN
    RAISE EXCEPTION 'A3: already applied';
  END IF;
END $$;

CREATE TABLE public.wf_sensitive_step_up (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  action_kind     text NOT NULL CHECK (action_kind IN ('agent_promotion', 'production_change')),
  subject_digest  text NOT NULL CHECK (subject_digest ~ '^[0-9a-f]{64}$'),
  verified_at     timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  revoked_at      timestamptz,
  CONSTRAINT wf_sensitive_step_up_window CHECK (expires_at > verified_at AND expires_at <= verified_at + interval '5 minutes'),
  CONSTRAINT wf_sensitive_step_up_one_end CHECK (used_at IS NULL OR revoked_at IS NULL)
);
CREATE INDEX wf_sensitive_step_up_lookup
  ON public.wf_sensitive_step_up (user_id, action_kind, subject_digest) WHERE used_at IS NULL AND revoked_at IS NULL;
ALTER TABLE public.wf_sensitive_step_up ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wf_sensitive_step_up FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.wf_sensitive_step_up TO service_role;

CREATE FUNCTION public.wf_sensitive_step_up_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'wf_sensitive_step_up is append-only' USING ERRCODE = '42501';
  END IF;
  IF (NEW.id, NEW.user_id, NEW.action_kind, NEW.subject_digest, NEW.verified_at, NEW.expires_at)
     IS DISTINCT FROM (OLD.id, OLD.user_id, OLD.action_kind, OLD.subject_digest, OLD.verified_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'wf_sensitive_step_up: evidence fields are immutable' USING ERRCODE = '42501';
  END IF;
  IF (OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at)
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'wf_sensitive_step_up: a step-up is single use' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER wf_sensitive_step_up_10_guard BEFORE UPDATE OR DELETE ON public.wf_sensitive_step_up
  FOR EACH ROW EXECUTE FUNCTION public.wf_sensitive_step_up_guard();
CREATE TRIGGER wf_sensitive_step_up_no_truncate BEFORE TRUNCATE ON public.wf_sensitive_step_up
  FOR EACH STATEMENT EXECUTE FUNCTION public.wf_sensitive_step_up_guard();

-- The digest the server uses as the WebAuthn challenge: SHA-256 over the kind and the parts, separated by U+001F.
CREATE FUNCTION public.wf_step_up_digest(p_kind text, p_parts text[])
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
AS $$
  SELECT encode(sha256(convert_to(p_kind || chr(31) || array_to_string(p_parts, chr(31), ''), 'UTF8')), 'hex')
$$;

-- Spends one fresh, matching step-up. Fails closed. Runs inside the caller's transaction, so a later failure gives it back.
CREATE FUNCTION public.wf_step_up_consume(p_user uuid, p_kind text, p_digest text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id uuid;
BEGIN
  SELECT s.id INTO v_id FROM public.wf_sensitive_step_up s
   WHERE s.user_id = p_user AND s.action_kind = p_kind AND s.subject_digest = p_digest
     AND s.used_at IS NULL AND s.revoked_at IS NULL AND now() < s.expires_at
   ORDER BY s.verified_at DESC LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'a3:step_up_required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.wf_sensitive_step_up SET used_at = now() WHERE id = v_id;
  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION public.wf_sensitive_step_up_guard(), public.wf_step_up_digest(text, text[]),
  public.wf_step_up_consume(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- Promotion: same body as AIN-02, plus the spend of the step-up AFTER every other check passed (a refused promotion
-- never burns a step-up; one that fails after the spend rolls it back with the statement).
CREATE OR REPLACE FUNCTION public.wf_autonomy_promote(
  p_actor uuid, p_org uuid, p_agent text, p_to_level text, p_evidence uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_prev jsonb;
  v_state text;
  v_from text;
BEGIN
  v_prev := public.wf_act_as(p_actor);
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'ain02:only_the_founder_promotes' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wf_org_settings s WHERE s.org_id = p_org) THEN
    RAISE EXCEPTION 'ain02:organization_unknown' USING ERRCODE = '23503';
  END IF;
  v_state := public.wf_agent_state_code(p_org, p_agent);
  IF v_state <> 'ok' THEN
    RAISE EXCEPTION 'ain02:agent_not_usable_here:%', v_state USING ERRCODE = '42501';
  END IF;
  v_from := public.wf_autonomy_apply(p_org, p_agent, 'promote', p_to_level, p_evidence, p_actor, p_reason);
  PERFORM public.wf_step_up_consume(p_actor, 'agent_promotion',
    public.wf_step_up_digest('agent_promotion', ARRAY[p_org::text, p_agent, p_to_level, p_evidence::text]));
  PERFORM public.wf_act_restore(v_prev);
  RETURN jsonb_build_object('org_id', p_org, 'agent_ref', p_agent, 'from', v_from, 'to', p_to_level);
END
$$;

COMMENT ON TABLE public.wf_sensitive_step_up IS
  'A3 / ADR-138: verified passkey step-up evidence for sensitive decisions. Written by the server with the service role only; single use; five minutes.';

COMMIT;
