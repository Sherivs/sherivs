-- PROPOSAL ONLY. NOT APPLIED. NOT IN THE MIGRATIONS DIRECTORY.
-- ENGINE-16 (ADR-094): database-side agent pause state.
-- The code-side policy is frontend/src/lib/workforce-pause/pause-policy.ts. This gives the
-- database the same rules so a pause cannot be skipped by a bug in an agent, a tool or a prompt.
-- Apply on staging first with the matching rollback below. A test keeps the rules seed in step
-- with the agent charters.
--
-- Rules:
--  * Pause state is an append-only list of events. The current state is a fold over them, so
--    history is never lost and nothing is updated or deleted.
--  * Resuming is the sheriff's (super admin's) alone.
--  * Pausing an ordinary agent needs platform.operations.assign or the sheriff. Pausing "all",
--    an executive or assurance agent, or any agent whose pause cascades needs the sheriff.
--  * A pause on a cascading agent, or on "all", reaches every agent except the assurance agents.
--    An assurance agent is paused only directly.
--  * An agent the database does not know is reported as paused (fail closed).
--  * A reason of 10 to 300 characters is required for every change.

BEGIN;

CREATE TABLE IF NOT EXISTS public.agent_pause_rules (
  agent_code text PRIMARY KEY CHECK (agent_code ~ '^[a-z][a-z0-9-]{1,60}$'),
  tier       text NOT NULL CHECK (tier IN ('executive', 'department', 'assurance')),
  kill_scope text NOT NULL CHECK (kill_scope IN ('agent', 'department', 'workforce')),
  CONSTRAINT agent_pause_rules_assurance_alone CHECK (tier <> 'assurance' OR kill_scope = 'agent')
);

CREATE TABLE IF NOT EXISTS public.agent_pause_events (
  seq        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action     text NOT NULL CHECK (action IN ('pause', 'resume')),
  target     text NOT NULL CHECK (target = 'all' OR target ~ '^[a-z][a-z0-9-]{1,60}$'),
  reason     text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 300),
  actor_id   uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_pause_events_target_idx ON public.agent_pause_events (target, seq DESC);

-- Events are never changed or removed, not even by the service role.
CREATE OR REPLACE FUNCTION public.agent_pause_events_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'agent_pause_events is append-only';
END;
$$;
DROP TRIGGER IF EXISTS agent_pause_events_no_change ON public.agent_pause_events;
CREATE TRIGGER agent_pause_events_no_change
  BEFORE UPDATE OR DELETE ON public.agent_pause_events
  FOR EACH ROW EXECUTE FUNCTION public.agent_pause_events_immutable();

-- True when the agent is paused directly, by a cascading agent, or by a workforce pause.
CREATE OR REPLACE FUNCTION public.is_agent_paused(p_agent text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH latest AS (
    SELECT DISTINCT ON (target) target, action
      FROM public.agent_pause_events
     ORDER BY target, seq DESC),
  me AS (SELECT tier FROM public.agent_pause_rules WHERE agent_code = p_agent)
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM me) THEN true
    ELSE EXISTS (SELECT 1 FROM latest WHERE target = p_agent AND action = 'pause')
      OR ((SELECT tier FROM me) <> 'assurance' AND (
            EXISTS (SELECT 1 FROM latest WHERE target = 'all' AND action = 'pause')
         OR EXISTS (SELECT 1
                      FROM latest l
                      JOIN public.agent_pause_rules r ON r.agent_code = l.target
                     WHERE l.action = 'pause' AND r.kill_scope <> 'agent')))
  END;
$$;
REVOKE ALL ON FUNCTION public.is_agent_paused(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_agent_paused(text) TO service_role;

-- The only way to change pause state. It checks the caller itself.
CREATE OR REPLACE FUNCTION public.change_agent_pause(p_action text, p_target text, p_reason text)
RETURNS bigint LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_sheriff boolean := public.is_super_admin();
  v_tier    text;
  v_kill    text;
  v_seq     bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('pause', 'resume') THEN RAISE EXCEPTION 'unknown_action'; END IF;
  IF char_length(v_reason) < 10 THEN RAISE EXCEPTION 'reason_too_short'; END IF;
  IF char_length(v_reason) > 300 THEN RAISE EXCEPTION 'reason_too_long'; END IF;
  IF p_target IS NULL THEN RAISE EXCEPTION 'unknown_target'; END IF;
  IF p_target <> 'all' THEN
    SELECT tier, kill_scope INTO v_tier, v_kill FROM public.agent_pause_rules WHERE agent_code = p_target;
    IF NOT FOUND THEN RAISE EXCEPTION 'unknown_target'; END IF;
  END IF;

  IF p_action = 'resume' THEN
    IF NOT v_sheriff THEN RAISE EXCEPTION 'resume_needs_sheriff'; END IF;
  ELSIF p_target = 'all' OR v_tier IN ('assurance', 'executive') OR v_kill <> 'agent' THEN
    IF NOT v_sheriff THEN RAISE EXCEPTION 'pause_needs_sheriff'; END IF;
  ELSIF NOT (v_sheriff OR public.has_platform_capability('platform.operations.assign')) THEN
    RAISE EXCEPTION 'pause_needs_operations_capability';
  END IF;

  INSERT INTO public.agent_pause_events (action, target, reason, actor_id)
  VALUES (p_action, p_target, v_reason, auth.uid())
  RETURNING seq INTO v_seq;
  RETURN v_seq;
END;
$$;
REVOKE ALL ON FUNCTION public.change_agent_pause(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_agent_pause(text, text, text) TO authenticated, service_role;

ALTER TABLE public.agent_pause_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_pause_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agent_pause_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_pause_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agent_pause_rules, public.agent_pause_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.agent_pause_rules, public.agent_pause_events TO authenticated;
GRANT SELECT, INSERT ON TABLE public.agent_pause_events TO service_role;
GRANT SELECT ON TABLE public.agent_pause_rules TO service_role;

DROP POLICY IF EXISTS agent_pause_rules_staff_read ON public.agent_pause_rules;
CREATE POLICY agent_pause_rules_staff_read ON public.agent_pause_rules
  FOR SELECT TO authenticated
  USING ((SELECT public.has_platform_capability('platform.operations.read')));

DROP POLICY IF EXISTS agent_pause_events_staff_read ON public.agent_pause_events;
CREATE POLICY agent_pause_events_staff_read ON public.agent_pause_events
  FOR SELECT TO authenticated
  USING ((SELECT public.has_platform_capability('platform.operations.read')
          OR public.has_platform_capability('platform.audit.read')));

-- Seed generated from the charters; a test keeps the two in step.
INSERT INTO public.agent_pause_rules (agent_code, tier, kill_scope) VALUES
  ('support-agent', 'department', 'agent'),
  ('engineering-agent', 'department', 'agent'),
  ('security-agent', 'department', 'agent'),
  ('finance-agent', 'department', 'agent'),
  ('sales-agent', 'department', 'agent'),
  ('operations-agent', 'department', 'agent'),
  ('jarvis-executive', 'executive', 'workforce'),
  ('compliance-agent', 'department', 'agent'),
  ('reliability-agent', 'department', 'agent'),
  ('customer-success-agent', 'department', 'agent'),
  ('revenue-assurance-agent', 'department', 'agent'),
  ('sentinel-agent', 'assurance', 'agent'),
  ('archivist-agent', 'department', 'agent'),
  ('product-intelligence-agent', 'department', 'agent'),
  ('market-intelligence-agent', 'department', 'agent'),
  ('onboarding-agent', 'department', 'agent'),
  ('safeguarding-agent', 'department', 'agent'),
  ('qa-agent', 'department', 'agent'),
  ('evaluation-agent', 'assurance', 'agent'),
  ('marketing-agent', 'department', 'agent'),
  ('localisation-agent', 'department', 'agent'),
  ('data-agent', 'department', 'agent'),
  ('legal-agent', 'department', 'agent'),
  ('people-agent', 'department', 'agent'),
  ('investor-agent', 'department', 'agent')
ON CONFLICT (agent_code) DO UPDATE SET tier = EXCLUDED.tier, kill_scope = EXCLUDED.kill_scope;

COMMIT;

-- Rollback (for the migration that adopts this proposal):
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.change_agent_pause(text, text, text);
-- DROP FUNCTION IF EXISTS public.is_agent_paused(text);
-- DROP TABLE IF EXISTS public.agent_pause_events;
-- DROP FUNCTION IF EXISTS public.agent_pause_events_immutable();
-- DROP TABLE IF EXISTS public.agent_pause_rules;
-- COMMIT;
