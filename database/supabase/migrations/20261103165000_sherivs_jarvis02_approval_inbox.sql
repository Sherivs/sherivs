-- SV1-JARVIS-02: durable JARVIS approval inbox.
-- Forward-only. Not applied to any live database by this change.
-- Writes are server-side (service_role) only; platform staff may read.
-- The database re-enforces the key approval laws so a server bug cannot
-- weaken them: single decision, expiry, T3 sheriff + passkey step-up, console
-- only approval, no self-approval, append-only event log.

BEGIN;

CREATE TABLE IF NOT EXISTS public.jarvis_approval_requests (
  approval_id             text PRIMARY KEY CHECK (length(btrim(approval_id)) > 0),
  idempotency_key         text NOT NULL UNIQUE CHECK (length(btrim(idempotency_key)) > 0),
  action_id               text NOT NULL CHECK (length(btrim(action_id)) > 0),
  action_ref              text NOT NULL CHECK (length(btrim(action_ref)) > 0),
  agent_definition_id     text NOT NULL CHECK (length(btrim(agent_definition_id)) > 0),
  requester_ref           text NOT NULL CHECK (length(btrim(requester_ref)) > 0),
  platform_ref            text NOT NULL CHECK (platform_ref = 'coregrid'),
  risk_tier               text NOT NULL CHECK (risk_tier IN ('T2', 'T3')),
  preconditions_digest    text NOT NULL CHECK (length(btrim(preconditions_digest)) > 0),
  requested_at            timestamptz NOT NULL DEFAULT now(),
  expires_at              timestamptz NOT NULL,
  status                  text NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'executed')),
  decided_by              text,
  decided_role            text CHECK (decided_role IN ('platform_staff', 'sheriff')),
  decided_channel         text CHECK (decided_channel IN ('console', 'whatsapp', 'voice', 'sms', 'email')),
  decided_at              timestamptz,
  passkey_step_up_verified boolean NOT NULL DEFAULT false,
  executed_at             timestamptz,
  CONSTRAINT jarvis_approval_expiry_window
    CHECK (expires_at > requested_at AND expires_at <= requested_at + interval '24 hours'),
  CONSTRAINT jarvis_approval_decision_shape CHECK (
    (status IN ('pending', 'expired') AND (decided_by IS NULL OR status = 'expired'))
    OR status IN ('denied')
    OR (status IN ('approved', 'executed')
        AND decided_by IS NOT NULL AND decided_role IS NOT NULL
        AND decided_at IS NOT NULL AND decided_channel = 'console'
        AND decided_by <> requester_ref
        AND (risk_tier <> 'T3' OR (decided_role = 'sheriff' AND passkey_step_up_verified)))
  ),
  CONSTRAINT jarvis_approval_denied_not_self
    CHECK (decided_by IS NULL OR decided_by <> requester_ref),
  CONSTRAINT jarvis_approval_executed_shape
    CHECK ((status = 'executed') = (executed_at IS NOT NULL))
);

COMMENT ON TABLE public.jarvis_approval_requests IS
  'JARVIS approval requests. Written by the server only; each request is decided at most once and executed at most once.';

CREATE TABLE IF NOT EXISTS public.jarvis_approval_events (
  event_seq   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  approval_id text NOT NULL REFERENCES public.jarvis_approval_requests(approval_id) ON DELETE RESTRICT,
  kind        text NOT NULL
                CHECK (kind IN ('requested', 'approve', 'deny', 'acknowledge', 'expired', 'executed', 'rejected')),
  channel     text CHECK (channel IN ('console', 'whatsapp', 'voice', 'sms', 'email')),
  actor_ref   text,
  code        text,
  at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jarvis_approval_event_approve_console
    CHECK (kind <> 'approve' OR channel = 'console')
);

CREATE INDEX IF NOT EXISTS jarvis_approval_events_approval_idx
  ON public.jarvis_approval_events (approval_id, event_seq);
CREATE INDEX IF NOT EXISTS jarvis_approval_requests_open_idx
  ON public.jarvis_approval_requests (expires_at) WHERE status IN ('pending', 'approved');

-- Transition guard ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.jarvis_approval_transition_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.approval_id IS DISTINCT FROM OLD.approval_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.action_id IS DISTINCT FROM OLD.action_id
     OR NEW.action_ref IS DISTINCT FROM OLD.action_ref
     OR NEW.agent_definition_id IS DISTINCT FROM OLD.agent_definition_id
     OR NEW.requester_ref IS DISTINCT FROM OLD.requester_ref
     OR NEW.platform_ref IS DISTINCT FROM OLD.platform_ref
     OR NEW.risk_tier IS DISTINCT FROM OLD.risk_tier
     OR NEW.preconditions_digest IS DISTINCT FROM OLD.preconditions_digest
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'jarvis_approval: request binding is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('denied', 'expired', 'executed') THEN
    RAISE EXCEPTION 'jarvis_approval: % is terminal', OLD.status USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'pending' AND NEW.status NOT IN ('pending', 'approved', 'denied', 'expired') THEN
    RAISE EXCEPTION 'jarvis_approval: illegal transition pending -> %', NEW.status USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'approved' AND NEW.status NOT IN ('approved', 'executed', 'expired') THEN
    RAISE EXCEPTION 'jarvis_approval: illegal transition approved -> %', NEW.status USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'denied') AND now() >= OLD.expires_at THEN
    RAISE EXCEPTION 'jarvis_approval: request expired' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'approved' AND NEW.status = 'executed' AND now() >= OLD.expires_at THEN
    RAISE EXCEPTION 'jarvis_approval: approval expired' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'approved' AND NEW.status IN ('executed', 'expired')
     AND (NEW.decided_by IS DISTINCT FROM OLD.decided_by
          OR NEW.decided_role IS DISTINCT FROM OLD.decided_role
          OR NEW.decided_channel IS DISTINCT FROM OLD.decided_channel
          OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
          OR NEW.passkey_step_up_verified IS DISTINCT FROM OLD.passkey_step_up_verified) THEN
    RAISE EXCEPTION 'jarvis_approval: recorded decision is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jarvis_approval_transition_guard ON public.jarvis_approval_requests;
CREATE TRIGGER jarvis_approval_transition_guard
  BEFORE UPDATE ON public.jarvis_approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.jarvis_approval_transition_guard();

CREATE OR REPLACE FUNCTION public.jarvis_approval_append_only_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'jarvis_approval: % on % is not allowed (append-only)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS jarvis_approval_requests_no_delete ON public.jarvis_approval_requests;
CREATE TRIGGER jarvis_approval_requests_no_delete
  BEFORE DELETE OR TRUNCATE ON public.jarvis_approval_requests
  FOR EACH STATEMENT EXECUTE FUNCTION public.jarvis_approval_append_only_guard();
DROP TRIGGER IF EXISTS jarvis_approval_events_append_only ON public.jarvis_approval_events;
CREATE TRIGGER jarvis_approval_events_append_only
  BEFORE UPDATE OR DELETE ON public.jarvis_approval_events
  FOR EACH ROW EXECUTE FUNCTION public.jarvis_approval_append_only_guard();
DROP TRIGGER IF EXISTS jarvis_approval_events_no_truncate ON public.jarvis_approval_events;
CREATE TRIGGER jarvis_approval_events_no_truncate
  BEFORE TRUNCATE ON public.jarvis_approval_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.jarvis_approval_append_only_guard();

-- RLS and grants: staff read, server (service_role) writes ----------------------
ALTER TABLE public.jarvis_approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jarvis_approval_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.jarvis_approval_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jarvis_approval_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.jarvis_approval_requests, public.jarvis_approval_events
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.jarvis_approval_requests, public.jarvis_approval_events TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.jarvis_approval_requests TO service_role;
GRANT SELECT, INSERT ON public.jarvis_approval_events TO service_role;

DROP POLICY IF EXISTS jarvis_approval_requests_staff_read ON public.jarvis_approval_requests;
CREATE POLICY jarvis_approval_requests_staff_read ON public.jarvis_approval_requests
  FOR SELECT TO authenticated USING (public.is_platform_staff());
DROP POLICY IF EXISTS jarvis_approval_events_staff_read ON public.jarvis_approval_events;
CREATE POLICY jarvis_approval_events_staff_read ON public.jarvis_approval_events
  FOR SELECT TO authenticated USING (public.is_platform_staff());

COMMIT;
