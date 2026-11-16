-- APPLIED TO PRODUCTION 2026-11-15. The exact SQL that ran is in ops/2026-11-15-apply-engine20-engine22/.
-- Kept here as the reviewed source. Not in the migrations directory: the neutrality guard rejects school vocabulary there.
-- ENGINE-20 (ADR-098): database side of the organization workforce.
-- Code side: frontend/src/lib/org-workforce/ (packaging, activation, escalation).
-- Apply on staging first, with the matching rollback at the end. A test keeps the catalog
-- seed in step with the agent definitions.
--
-- What it adds:
--  * org_agent_catalog        the 17 agents, who is accountable, and the lowest plan that includes each
--  * org_agent_addon_events   append-only log of enable, disable, pause, resume (and platform pauses)
--  * change_org_agent()       the only way to change that state; checks the caller, the plan and the
--                             organization's status itself
--  * org_agent_events         what agents raise (money, safeguarding, ...); safeguarding rows carry no text
--  * org_notification_outbox  who must be told, by which channel, and when; no worker is included
--  * org_weekly_reports       one request per organization per week, built and stored by the app
--
-- Rules:
--  * An agent may be switched on only by someone with settings.manage, only for an active
--    organization, and only when the plan includes it. An unknown plan counts as the trial.
--  * An organization may pause or resume its own agent. A platform pause (sheriff) can only be
--    lifted by the sheriff. An agent that is not switched on, or is paused, cannot raise events.
--  * Safeguarding events store a pointer and no text, and their notifications must be redacted.
--  * Events are never removed. The only change allowed is an acknowledgement, once.
--  * The service role writes events and notifications; people read what their permission allows.
--  * Every table has row-level security forced on.
--
-- Depends on existing objects: public.schools(id, subscription_tier, subscription_status),
-- public.users(id, school_id, is_active), public.scholar_can(uuid, text), public.is_super_admin(),
-- public.get_my_school_id(), auth.uid(), auth.role().

BEGIN;

CREATE TABLE IF NOT EXISTS public.org_agent_catalog (
  agent_code      text PRIMARY KEY CHECK (agent_code ~ '^org-[a-z0-9-]{2,40}$'),
  accountable     text NOT NULL CHECK (accountable IN
                    ('admin','principal','teacher','parent','student','bursar','hq','alumni','driver')),
  min_tier        text NOT NULL CHECK (min_tier IN ('trial','starter','growth','professional','enterprise'))
);

CREATE OR REPLACE FUNCTION public.org_tier_rank(p_tier text)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(array_position(ARRAY['trial','starter','growth','professional','enterprise'], lower(btrim(p_tier))), 1);
$$;

CREATE TABLE IF NOT EXISTS public.org_agent_addon_events (
  seq        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id     uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  agent_code text NOT NULL REFERENCES public.org_agent_catalog(agent_code),
  action     text NOT NULL CHECK (action IN ('enable','disable','pause','resume','platform_pause','platform_resume')),
  reason     text CHECK (reason IS NULL OR char_length(reason) BETWEEN 10 AND 300),
  actor_id   uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS org_agent_addon_events_idx ON public.org_agent_addon_events (org_id, agent_code, seq DESC);

CREATE OR REPLACE FUNCTION public.org_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;
DROP TRIGGER IF EXISTS org_agent_addon_events_no_change ON public.org_agent_addon_events;
CREATE TRIGGER org_agent_addon_events_no_change
  BEFORE UPDATE OR DELETE ON public.org_agent_addon_events
  FOR EACH ROW EXECUTE FUNCTION public.org_append_only();

-- Current state: switched on, paused, and whether the pause is the platform's.
CREATE OR REPLACE FUNCTION public.org_agent_state(p_org uuid, p_agent text)
RETURNS TABLE (enabled boolean, paused boolean, platform_paused boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT
    coalesce((SELECT action = 'enable' FROM public.org_agent_addon_events
               WHERE org_id = p_org AND agent_code = p_agent AND action IN ('enable','disable')
               ORDER BY seq DESC LIMIT 1), false),
    coalesce((SELECT action IN ('pause','platform_pause') FROM public.org_agent_addon_events
               WHERE org_id = p_org AND agent_code = p_agent
                 AND action IN ('pause','resume','platform_pause','platform_resume')
               ORDER BY seq DESC LIMIT 1), false),
    coalesce((SELECT action = 'platform_pause' FROM public.org_agent_addon_events
               WHERE org_id = p_org AND agent_code = p_agent
                 AND action IN ('pause','resume','platform_pause','platform_resume')
               ORDER BY seq DESC LIMIT 1), false)
   WHERE coalesce(auth.role(), '') = 'service_role'
      OR public.is_super_admin()
      OR public.get_my_school_id() = p_org;
$$;
REVOKE ALL ON FUNCTION public.org_agent_state(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_agent_state(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.change_org_agent(p_org uuid, p_agent text, p_action text, p_reason text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_reason text := btrim(coalesce(p_reason, ''));
  v_sheriff boolean := coalesce(public.is_super_admin(), false);
  v_cat    public.org_agent_catalog%ROWTYPE;
  v_tier   text; v_status text;
  v_en boolean; v_pa boolean; v_plat boolean;
  v_seq bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('enable','disable','pause','resume','platform_pause','platform_resume') THEN
    RAISE EXCEPTION 'unknown_action'; END IF;
  SELECT * INTO v_cat FROM public.org_agent_catalog WHERE agent_code = p_agent;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_agent'; END IF;
  SELECT subscription_tier, subscription_status INTO v_tier, v_status FROM public.schools WHERE id = p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_organization'; END IF;

  IF p_action IN ('platform_pause','platform_resume') THEN
    IF NOT v_sheriff THEN RAISE EXCEPTION 'platform_action_needs_sheriff'; END IF;
  ELSIF NOT public.scholar_can(p_org, 'settings.manage') THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  IF p_action IN ('pause','resume','platform_pause','platform_resume') THEN
    IF char_length(v_reason) < 10 THEN RAISE EXCEPTION 'reason_too_short'; END IF;
    IF char_length(v_reason) > 300 THEN RAISE EXCEPTION 'reason_too_long'; END IF;
  END IF;

  SELECT s.enabled, s.paused, s.platform_paused INTO v_en, v_pa, v_plat FROM public.org_agent_state(p_org, p_agent) s;
  v_en := coalesce(v_en, false); v_pa := coalesce(v_pa, false); v_plat := coalesce(v_plat, false);

  IF p_action = 'enable' THEN
    IF v_status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'organization_inactive'; END IF;
    IF public.org_tier_rank(v_tier) < public.org_tier_rank(v_cat.min_tier) THEN RAISE EXCEPTION 'plan_excludes_agent'; END IF;
    IF v_en THEN RAISE EXCEPTION 'already_enabled'; END IF;
  ELSIF p_action = 'disable' THEN
    IF NOT v_en THEN RAISE EXCEPTION 'not_enabled'; END IF;
  ELSIF p_action = 'pause' THEN
    IF NOT v_en THEN RAISE EXCEPTION 'not_enabled'; END IF;
    IF v_pa THEN RAISE EXCEPTION 'already_paused'; END IF;
  ELSIF p_action = 'resume' THEN
    IF NOT v_pa THEN RAISE EXCEPTION 'not_paused'; END IF;
    IF v_plat THEN RAISE EXCEPTION 'paused_by_platform'; END IF;
  ELSIF p_action = 'platform_pause' THEN
    IF v_pa AND v_plat THEN RAISE EXCEPTION 'already_paused'; END IF;
  ELSIF p_action = 'platform_resume' THEN
    IF NOT (v_pa AND v_plat) THEN RAISE EXCEPTION 'not_paused_by_platform'; END IF;
  END IF;

  INSERT INTO public.org_agent_addon_events (org_id, agent_code, action, reason, actor_id)
  VALUES (p_org, p_agent, p_action, nullif(v_reason, ''), auth.uid())
  RETURNING seq INTO v_seq;
  RETURN v_seq;
END;
$$;
REVOKE ALL ON FUNCTION public.change_org_agent(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_org_agent(uuid, text, text, text) TO authenticated, service_role;

-- What agents raise. Safeguarding rows hold a pointer, never text.
CREATE TABLE IF NOT EXISTS public.org_agent_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  agent_code   text NOT NULL REFERENCES public.org_agent_catalog(agent_code),
  kind         text NOT NULL CHECK (kind IN ('money','safeguarding','compliance','operations','academic','info')),
  severity     text NOT NULL CHECK (severity IN ('info','attention','urgent','critical')),
  summary      text CHECK (summary IS NULL OR char_length(summary) BETWEEN 1 AND 280),
  ref          text CHECK (ref IS NULL OR char_length(ref) <= 120),
  amount_minor bigint CHECK (amount_minor IS NULL OR amount_minor >= 0),
  dedupe_key   text CHECK (dedupe_key IS NULL OR char_length(dedupe_key) <= 80),
  created_at   timestamptz NOT NULL DEFAULT now(),
  acked_at     timestamptz,
  acked_by     uuid,
  CONSTRAINT org_agent_events_safeguarding_no_text CHECK (kind <> 'safeguarding' OR summary IS NULL),
  CONSTRAINT org_agent_events_money_has_amount CHECK (kind <> 'money' OR amount_minor IS NOT NULL),
  CONSTRAINT org_agent_events_ack_pair CHECK ((acked_at IS NULL) = (acked_by IS NULL))
);
CREATE INDEX IF NOT EXISTS org_agent_events_org_idx ON public.org_agent_events (org_id, created_at DESC);

-- Events are never removed; the only change is the one-time acknowledgement.
CREATE OR REPLACE FUNCTION public.org_agent_events_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'org_agent_events is append-only'; END IF;
  IF OLD.acked_at IS NOT NULL
     OR (NEW.id, NEW.org_id, NEW.agent_code, NEW.kind, NEW.severity, NEW.summary, NEW.ref, NEW.amount_minor, NEW.dedupe_key, NEW.created_at)
        IS DISTINCT FROM
        (OLD.id, OLD.org_id, OLD.agent_code, OLD.kind, OLD.severity, OLD.summary, OLD.ref, OLD.amount_minor, OLD.dedupe_key, OLD.created_at) THEN
    RAISE EXCEPTION 'org_agent_events only allows a single acknowledgement';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS org_agent_events_guard ON public.org_agent_events;
CREATE TRIGGER org_agent_events_guard
  BEFORE UPDATE OR DELETE ON public.org_agent_events
  FOR EACH ROW EXECUTE FUNCTION public.org_agent_events_guard();

CREATE OR REPLACE FUNCTION public.raise_org_agent_event(
  p_org uuid, p_agent text, p_kind text, p_severity text,
  p_summary text DEFAULT NULL, p_ref text DEFAULT NULL, p_amount_minor bigint DEFAULT NULL, p_dedupe_key text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_en boolean; v_pa boolean; v_plat boolean; v_id uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501'; END IF;
  SELECT s.enabled, s.paused, s.platform_paused INTO v_en, v_pa, v_plat FROM public.org_agent_state(p_org, p_agent) s;
  IF NOT coalesce(v_en, false) OR coalesce(v_pa, true) THEN RAISE EXCEPTION 'agent_not_running'; END IF;
  IF p_dedupe_key IS NOT NULL THEN
    SELECT id INTO v_id FROM public.org_agent_events
     WHERE org_id = p_org AND agent_code = p_agent AND kind = p_kind AND dedupe_key = p_dedupe_key
       AND created_at > now() - interval '1 hour'
     ORDER BY created_at LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;
  INSERT INTO public.org_agent_events (org_id, agent_code, kind, severity, summary, ref, amount_minor, dedupe_key)
  VALUES (p_org, p_agent, p_kind, p_severity, p_summary, p_ref, p_amount_minor, p_dedupe_key)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.raise_org_agent_event(uuid, text, text, text, text, text, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.raise_org_agent_event(uuid, text, text, text, text, text, bigint, text) TO service_role;

CREATE OR REPLACE FUNCTION public.ack_org_agent_event(p_event uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT org_id INTO v_org FROM public.org_agent_events WHERE id = p_event;
  IF v_org IS NULL OR NOT public.scholar_can(v_org, 'settings.manage') THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  UPDATE public.org_agent_events SET acked_at = now(), acked_by = auth.uid()
   WHERE id = p_event AND acked_at IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.ack_org_agent_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ack_org_agent_event(uuid) TO authenticated, service_role;

-- Who must be told, how and when. A worker that sends them is not part of this proposal.
CREATE TABLE IF NOT EXISTS public.org_notification_outbox (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  event_id     uuid REFERENCES public.org_agent_events(id),
  recipient_id uuid NOT NULL,
  channel      text NOT NULL CHECK (channel IN ('push','whatsapp','email','in_app')),
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','cancelled')),
  send_after   timestamptz NOT NULL DEFAULT now(),
  redacted     boolean NOT NULL DEFAULT false,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 2000),
  attempts     int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz,
  CONSTRAINT org_notification_redacted_has_no_summary CHECK (NOT redacted OR NOT (payload ? 'summary'))
);
CREATE UNIQUE INDEX IF NOT EXISTS org_notification_once ON public.org_notification_outbox (event_id, recipient_id, channel) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS org_notification_due ON public.org_notification_outbox (send_after) WHERE status = 'queued';

CREATE OR REPLACE FUNCTION public.enqueue_org_notification(
  p_org uuid, p_event uuid, p_recipient uuid, p_channel text,
  p_send_after timestamptz DEFAULT now(), p_redacted boolean DEFAULT false, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_kind text; v_ev_org uuid; v_id uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_recipient AND school_id = p_org AND is_active) THEN
    RAISE EXCEPTION 'recipient_not_in_organization'; END IF;
  IF p_event IS NOT NULL THEN
    SELECT kind, org_id INTO v_kind, v_ev_org FROM public.org_agent_events WHERE id = p_event;
    IF v_ev_org IS DISTINCT FROM p_org THEN RAISE EXCEPTION 'event_not_in_organization'; END IF;
    IF v_kind = 'safeguarding' AND NOT p_redacted THEN RAISE EXCEPTION 'safeguarding_must_be_redacted'; END IF;
  END IF;
  INSERT INTO public.org_notification_outbox (org_id, event_id, recipient_id, channel, send_after, redacted, payload)
  VALUES (p_org, p_event, p_recipient, p_channel, coalesce(p_send_after, now()), p_redacted, coalesce(p_payload, '{}'::jsonb))
  ON CONFLICT (event_id, recipient_id, channel) WHERE event_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_org_notification(uuid, uuid, uuid, text, timestamptz, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_org_notification(uuid, uuid, uuid, text, timestamptz, boolean, jsonb) TO service_role;

-- A worker claims due rows without two workers taking the same one.
CREATE OR REPLACE FUNCTION public.claim_org_notifications(p_limit int DEFAULT 50)
RETURNS SETOF public.org_notification_outbox LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  UPDATE public.org_notification_outbox o SET status = 'sending', attempts = o.attempts + 1
   WHERE o.id IN (SELECT id FROM public.org_notification_outbox
                   WHERE status = 'queued' AND send_after <= now()
                   ORDER BY send_after, id LIMIT greatest(1, least(coalesce(p_limit, 50), 200))
                   FOR UPDATE SKIP LOCKED)
  RETURNING o.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_org_notifications(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_org_notifications(int) TO service_role;

-- After five attempts a failure is final; before that it is retried with a growing delay.
CREATE OR REPLACE FUNCTION public.complete_org_notification(p_id uuid, p_ok boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501'; END IF;
  UPDATE public.org_notification_outbox
     SET status = CASE WHEN p_ok THEN 'sent' WHEN attempts >= 5 THEN 'failed' ELSE 'queued' END,
         sent_at = CASE WHEN p_ok THEN now() ELSE sent_at END,
         send_after = CASE WHEN p_ok OR attempts >= 5 THEN send_after ELSE now() + (interval '5 minutes' * attempts) END
   WHERE id = p_id AND status = 'sending';
END;
$$;
REVOKE ALL ON FUNCTION public.complete_org_notification(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_org_notification(uuid, boolean) TO service_role;

-- One report request per organization per week; the app builds and stores the content.
CREATE TABLE IF NOT EXISTS public.org_weekly_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  window_end  timestamptz NOT NULL,
  status      text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','built','sent','failed')),
  channel     text CHECK (channel IN ('whatsapp','email')),
  totals      jsonb CHECK (totals IS NULL OR jsonb_typeof(totals) = 'object'),
  lines       text[] CHECK (lines IS NULL OR (coalesce(array_length(lines, 1), 0) <= 20)),
  created_at  timestamptz NOT NULL DEFAULT now(),
  built_at    timestamptz,
  UNIQUE (org_id, window_end)
);

CREATE OR REPLACE FUNCTION public.request_org_weekly_reports(p_window_end timestamptz DEFAULT date_trunc('hour', now()))
RETURNS int LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n int;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501'; END IF;
  WITH running AS (
    SELECT DISTINCT e.org_id FROM public.org_agent_addon_events e
     WHERE e.action = 'enable'
       AND (SELECT s.enabled FROM public.org_agent_state(e.org_id, e.agent_code) s))
  INSERT INTO public.org_weekly_reports (org_id, window_end)
  SELECT r.org_id, p_window_end FROM running r
    JOIN public.schools s ON s.id = r.org_id AND s.subscription_status = 'active'
  ON CONFLICT (org_id, window_end) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.request_org_weekly_reports(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_org_weekly_reports(timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.store_org_weekly_report(p_id uuid, p_channel text, p_totals jsonb, p_lines text[])
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(coalesce(p_lines, ARRAY[]::text[])) l WHERE char_length(l) > 200) THEN
    RAISE EXCEPTION 'report_line_too_long'; END IF;
  UPDATE public.org_weekly_reports
     SET status = 'built', channel = p_channel, totals = p_totals, lines = p_lines, built_at = now()
   WHERE id = p_id AND status = 'requested';
  IF NOT FOUND THEN RAISE EXCEPTION 'report_not_requested'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.store_org_weekly_report(uuid, text, jsonb, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_org_weekly_report(uuid, text, jsonb, text[]) TO service_role;

-- Row-level security, forced on every table.
ALTER TABLE public.org_agent_catalog        ENABLE ROW LEVEL SECURITY;  ALTER TABLE public.org_agent_catalog        FORCE ROW LEVEL SECURITY;
ALTER TABLE public.org_agent_addon_events   ENABLE ROW LEVEL SECURITY;  ALTER TABLE public.org_agent_addon_events   FORCE ROW LEVEL SECURITY;
ALTER TABLE public.org_agent_events         ENABLE ROW LEVEL SECURITY;  ALTER TABLE public.org_agent_events         FORCE ROW LEVEL SECURITY;
ALTER TABLE public.org_notification_outbox  ENABLE ROW LEVEL SECURITY;  ALTER TABLE public.org_notification_outbox  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.org_weekly_reports       ENABLE ROW LEVEL SECURITY;  ALTER TABLE public.org_weekly_reports       FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.org_agent_catalog, public.org_agent_addon_events, public.org_agent_events,
  public.org_notification_outbox, public.org_weekly_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.org_agent_catalog, public.org_agent_addon_events, public.org_agent_events,
  public.org_notification_outbox, public.org_weekly_reports TO authenticated;
GRANT SELECT ON TABLE public.org_agent_catalog TO service_role;
GRANT SELECT, INSERT ON TABLE public.org_agent_addon_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.org_agent_events, public.org_notification_outbox, public.org_weekly_reports TO service_role;

DROP POLICY IF EXISTS org_agent_catalog_read ON public.org_agent_catalog;
CREATE POLICY org_agent_catalog_read ON public.org_agent_catalog FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS org_agent_catalog_service ON public.org_agent_catalog;
CREATE POLICY org_agent_catalog_service ON public.org_agent_catalog FOR SELECT TO service_role USING (true);

DROP POLICY IF EXISTS org_agent_addon_events_read ON public.org_agent_addon_events;
CREATE POLICY org_agent_addon_events_read ON public.org_agent_addon_events FOR SELECT TO authenticated
  USING ((SELECT public.scholar_can(org_id, 'settings.manage')));
DROP POLICY IF EXISTS org_agent_addon_events_service ON public.org_agent_addon_events;
CREATE POLICY org_agent_addon_events_service ON public.org_agent_addon_events FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS org_agent_events_read ON public.org_agent_events;
CREATE POLICY org_agent_events_read ON public.org_agent_events FOR SELECT TO authenticated
  USING ((SELECT public.scholar_can(org_id, 'settings.manage')));
DROP POLICY IF EXISTS org_agent_events_service ON public.org_agent_events;
CREATE POLICY org_agent_events_service ON public.org_agent_events FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS org_notification_outbox_own ON public.org_notification_outbox;
CREATE POLICY org_notification_outbox_own ON public.org_notification_outbox FOR SELECT TO authenticated
  USING (recipient_id = auth.uid());
DROP POLICY IF EXISTS org_notification_outbox_service ON public.org_notification_outbox;
CREATE POLICY org_notification_outbox_service ON public.org_notification_outbox FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS org_weekly_reports_read ON public.org_weekly_reports;
CREATE POLICY org_weekly_reports_read ON public.org_weekly_reports FOR SELECT TO authenticated
  USING ((SELECT public.scholar_can(org_id, 'settings.manage')));
DROP POLICY IF EXISTS org_weekly_reports_service ON public.org_weekly_reports;
CREATE POLICY org_weekly_reports_service ON public.org_weekly_reports FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Seed generated from the agent definitions; a test keeps the two in step.
INSERT INTO public.org_agent_catalog (agent_code, accountable, min_tier) VALUES
  ('org-support', 'admin', 'trial'),
  ('org-fees', 'bursar', 'starter'),
  ('org-attendance', 'principal', 'starter'),
  ('org-report-cards', 'principal', 'starter'),
  ('org-parent-comms', 'admin', 'starter'),
  ('org-admissions', 'admin', 'growth'),
  ('org-timetable', 'principal', 'growth'),
  ('org-safeguarding', 'principal', 'growth'),
  ('org-transport', 'admin', 'growth'),
  ('org-proprietor', 'hq', 'growth'),
  ('org-exams', 'principal', 'growth'),
  ('org-records', 'admin', 'growth'),
  ('org-staff-admin', 'admin', 'professional'),
  ('org-facilities', 'admin', 'professional'),
  ('org-learning-support', 'principal', 'professional'),
  ('org-compliance', 'principal', 'professional'),
  ('org-alumni', 'admin', 'enterprise')
ON CONFLICT (agent_code) DO UPDATE SET accountable = EXCLUDED.accountable, min_tier = EXCLUDED.min_tier;

COMMIT;

-- Weekly job (not scheduled here). The repository does not use pg_cron today, so how it runs is an
-- owner decision. Whatever runs it must, every Monday at 06:30 UTC (07:30 Africa/Lagos), call as the
-- service role:  SELECT public.request_org_weekly_reports(date_trunc('hour', now()));
-- then build each requested report in the app (buildWeeklyReport) and store it with
-- public.store_org_weekly_report(...), and enqueue the delivery with public.enqueue_org_notification(...).

-- Rollback (for the migration that adopts this proposal):
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.store_org_weekly_report(uuid, text, jsonb, text[]);
-- DROP FUNCTION IF EXISTS public.request_org_weekly_reports(timestamptz);
-- DROP TABLE IF EXISTS public.org_weekly_reports;
-- DROP FUNCTION IF EXISTS public.complete_org_notification(uuid, boolean);
-- DROP FUNCTION IF EXISTS public.claim_org_notifications(int);
-- DROP FUNCTION IF EXISTS public.enqueue_org_notification(uuid, uuid, uuid, text, timestamptz, boolean, jsonb);
-- DROP TABLE IF EXISTS public.org_notification_outbox;
-- DROP FUNCTION IF EXISTS public.ack_org_agent_event(uuid);
-- DROP FUNCTION IF EXISTS public.raise_org_agent_event(uuid, text, text, text, text, text, bigint, text);
-- DROP TABLE IF EXISTS public.org_agent_events;
-- DROP FUNCTION IF EXISTS public.org_agent_events_guard();
-- DROP FUNCTION IF EXISTS public.change_org_agent(uuid, text, text, text);
-- DROP FUNCTION IF EXISTS public.org_agent_state(uuid, text);
-- DROP TABLE IF EXISTS public.org_agent_addon_events;
-- DROP FUNCTION IF EXISTS public.org_append_only();
-- DROP FUNCTION IF EXISTS public.org_tier_rank(text);
-- DROP TABLE IF EXISTS public.org_agent_catalog;
-- COMMIT;
