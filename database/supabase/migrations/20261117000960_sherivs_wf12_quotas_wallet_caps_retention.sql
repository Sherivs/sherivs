-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.
-- WF-12: per-organization quotas, wallet caps and retention for the workflow engine (ADR-124).
-- Origin: Claude Code agent, mission WF-12 (issue #470). Stacked on WF-08 (#469) -> WF-07 (#467) -> WF-06 (#455).
--
-- Version note: 20261117000960 sorts directly after WF-08 (20261117000950) and before the M2a role catalogue
-- (20261117001000, PR #448). It is free on every open branch checked on 2026-11-20.
--
-- What this adds (all names neutral):
--   wf_org_limits              one row per organization: quotas, wallet caps, retention windows (defaults when absent)
--   wf_quota_denial            hourly counters of refused actions (counts only, no identifiers of people)
--   wf_action_spend_rate       which action kinds can cost money, and their unit rate (NULL = not decided = refused)
--   wf_retention_run           append-only log of every dry run and purge (counts and windows only)
--   wf_action_sandbox_outbox.cost_kobo   cost attribution for the wallet cap (computed by a trigger, never client input)
--   quota enforcement          BEFORE INSERT triggers on wf_run, wf_action_draft, wf_action_sandbox_outbox (the authority),
--                              wf_quota_check_action() for the runtime pre-check, wf_create_event_run() defers instead of failing
--   wf_limits_get() / wf_limits_update()                 admin settings surface (service role, actor bound in SQL)
--   wf_retention_run_manual() / wf_retention_run_scheduled()   dry run and purge
--   deletion carve-out for the three append-only tables the purge must reach (run events, approval decisions,
--   step-up evidence): DELETE only inside the purge, only for its organization, never for a client role
--
-- Fail closed: no limits row means the platform defaults, never "unlimited"; an unknown action kind gets 0 per
-- hour; a spend-bearing kind with no decided rate is refused; any error while reading a limit refuses the action.
--
-- Money: nothing here debits, credits or reserves wallet money. school_wallets is only read. The platform
-- ceiling for wallet caps is 0 (wf_wallet_cap_ceiling_kobo), and SMS/WhatsApp have no rate (founder decision 2),
-- so no workflow can spend anything until the founder changes both in a reviewed migration.
--
-- Authority model (same as WF-07 and WF-08): SECURITY DEFINER, empty search_path, EXECUTE only to service_role
-- for the functions the server calls; the server passes the verified person, SQL binds it and derives the
-- organization from it (never from a parameter).
--   view limits and usage     workflows.view
--   change limits             workflows.manage
--   dry run / purge (manual)  workflows.manage
BEGIN;

DO $prereq$
BEGIN
  IF to_regclass('public.wf_run') IS NULL
     OR to_regclass('public.wf_step_run') IS NULL
     OR to_regclass('public.wf_run_event') IS NULL
     OR to_regclass('public.wf_event') IS NULL
     OR to_regclass('public.wf_approval') IS NULL
     OR to_regclass('public.wf_approval_decision') IS NULL
     OR to_regclass('public.wf_approval_step_up') IS NULL
     OR to_regclass('public.wf_action_draft') IS NULL
     OR to_regclass('public.wf_action_sandbox_outbox') IS NULL
     OR to_regclass('public.wf_action_type') IS NULL
     OR to_regclass('public.wf_org_settings') IS NULL
     OR to_regclass('public.school_wallets') IS NULL
     OR to_regclass('public.cg_tool_call_ledger') IS NULL
     OR to_regprocedure('public.wf_can(uuid,text)') IS NULL
     OR to_regprocedure('public.wf_audit_append(uuid,text,text,text,jsonb,jsonb)') IS NULL
     OR to_regprocedure('public.wf_act_as(uuid)') IS NULL
     OR to_regprocedure('public.wf_act_restore(jsonb)') IS NULL
     OR to_regprocedure('public.wf_append_only()') IS NULL
     OR to_regprocedure('public.wf_runtime_settings_audit()') IS NULL
     OR to_regprocedure('public.wf_approval_step_up_guard()') IS NULL
     OR to_regprocedure('public.wf_run_retry(uuid,uuid,text)') IS NULL
     OR to_regprocedure('public.wf_create_event_run(uuid,uuid,text,uuid,uuid,text,timestamptz,timestamptz,integer,integer,text,text,text,integer,integer,integer,jsonb,jsonb)') IS NULL
     OR to_regprocedure('public.get_my_organization_id()') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'WF-12: WF-01 through WF-08 prerequisites are missing';
  END IF;
  IF to_regclass('public.wf_org_limits') IS NOT NULL
     OR to_regclass('public.wf_retention_run') IS NOT NULL
     OR to_regclass('public.wf_quota_denial') IS NOT NULL
     OR to_regclass('public.wf_action_spend_rate') IS NOT NULL
     OR to_regprocedure('public.wf_limits_get(uuid)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'wf_action_sandbox_outbox'
                   AND column_name = 'cost_kobo') THEN
    RAISE EXCEPTION 'WF-12: one or more WF-12 objects already exist';
  END IF;
END
$prereq$;

-- -----------------------------------------------------------------------------
-- 1. Platform bounds, defaults and the wallet ceiling (constants; changed only by a reviewed migration)
-- -----------------------------------------------------------------------------
-- The platform ceiling for wallet caps. 0 means no workflow may spend. STABLE, not IMMUTABLE, on purpose: an
-- immutable result could be folded into a cached plan and outlive the migration that changes it. Raising it is a founder decision
-- (WhatsApp and SMS rates and who pays, decision 2) and a one-line migration that replaces this function.
CREATE FUNCTION public.wf_wallet_cap_ceiling_kobo()
RETURNS bigint LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT 0::bigint $$;

-- Per-kind hourly default. Unknown kinds get 0 (fail closed). SMS and WhatsApp are 0 because v1 sends email and
-- in-app only.
CREATE FUNCTION public.wf_default_actions_per_hour(p_kind text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE p_kind
    WHEN 'email' THEN 100 WHEN 'in_app' THEN 300 WHEN 'task' THEN 300 WHEN 'wait' THEN 300
    WHEN 'webhook' THEN 60 WHEN 'sms' THEN 0 WHEN 'whatsapp' THEN 0 ELSE 0 END
$$;

CREATE FUNCTION public.wf_limit_bounds()
RETURNS jsonb LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'runs_per_day',            jsonb_build_object('default', 500,  'min', 1,   'max', 10000),
    'steps_per_run',           jsonb_build_object('default', 100,  'min', 1,   'max', 1000),
    'drafts_pending',          jsonb_build_object('default', 200,  'min', 1,   'max', 2000),
    'actions_per_hour',        jsonb_build_object('default', jsonb_build_object(
                                 'email', 100, 'in_app', 300, 'task', 300, 'wait', 300, 'webhook', 60,
                                 'sms', 0, 'whatsapp', 0), 'min', 0, 'max', 5000),
    'wallet_cap_kobo_per_day', jsonb_build_object('default', 0,    'min', 0,   'max', public.wf_wallet_cap_ceiling_kobo()),
    'wallet_cap_kobo_per_run', jsonb_build_object('default', 0,    'min', 0,   'max', public.wf_wallet_cap_ceiling_kobo()),
    'retention_outbox_days',   jsonb_build_object('default', 90,   'min', 30,  'max', 3650),
    'retention_draft_days',    jsonb_build_object('default', 180,  'min', 90,  'max', 3650),
    'retention_event_days',    jsonb_build_object('default', 180,  'min', 90,  'max', 3650),
    'retention_run_days',      jsonb_build_object('default', 365,  'min', 180, 'max', 3650),
    'retention_stepup_days',   jsonb_build_object('default', 365,  'min', 90,  'max', 3650),
    'retention_evidence_days', jsonb_build_object('default', 2555, 'min', 730, 'max', 3650),
    'retention_auto_purge',    jsonb_build_object('default', false))
$$;

CREATE FUNCTION public.wf_limit_defaults()
RETURNS jsonb LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_object_agg(k, v -> 'default') FROM jsonb_each(public.wf_limit_bounds()) AS b(k, v)
$$;

-- -----------------------------------------------------------------------------
-- 2. Tables
-- -----------------------------------------------------------------------------
CREATE TABLE public.wf_org_limits (
  org_id                    uuid PRIMARY KEY REFERENCES public.wf_org_settings (org_id) ON DELETE RESTRICT,
  runs_per_day              integer NOT NULL DEFAULT 500  CHECK (runs_per_day BETWEEN 1 AND 10000),
  steps_per_run             integer NOT NULL DEFAULT 100  CHECK (steps_per_run BETWEEN 1 AND 1000),
  drafts_pending            integer NOT NULL DEFAULT 200  CHECK (drafts_pending BETWEEN 1 AND 2000),
  actions_per_hour          jsonb   NOT NULL DEFAULT '{"email":100,"in_app":300,"task":300,"wait":300,"webhook":60,"sms":0,"whatsapp":0}'::jsonb
                            CHECK (jsonb_typeof(actions_per_hour) = 'object' AND pg_column_size(actions_per_hour) <= 2048),
  wallet_cap_kobo_per_day   bigint  NOT NULL DEFAULT 0    CHECK (wallet_cap_kobo_per_day >= 0),
  wallet_cap_kobo_per_run   bigint  NOT NULL DEFAULT 0    CHECK (wallet_cap_kobo_per_run >= 0),
  retention_outbox_days     integer NOT NULL DEFAULT 90   CHECK (retention_outbox_days BETWEEN 30 AND 3650),
  retention_draft_days      integer NOT NULL DEFAULT 180  CHECK (retention_draft_days BETWEEN 90 AND 3650),
  retention_event_days      integer NOT NULL DEFAULT 180  CHECK (retention_event_days BETWEEN 90 AND 3650),
  retention_run_days        integer NOT NULL DEFAULT 365  CHECK (retention_run_days BETWEEN 180 AND 3650),
  retention_stepup_days     integer NOT NULL DEFAULT 365  CHECK (retention_stepup_days BETWEEN 90 AND 3650),
  retention_evidence_days   integer NOT NULL DEFAULT 2555 CHECK (retention_evidence_days BETWEEN 730 AND 3650),
  retention_auto_purge      boolean NOT NULL DEFAULT false,
  updated_by                uuid,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wf_org_limits_run_cap_within_day CHECK (wallet_cap_kobo_per_run <= wallet_cap_kobo_per_day),
  -- Each window is at least as long as the one that depends on it, so a purge can always make progress
  -- and never removes a parent before the records that point at it.
  CONSTRAINT wf_org_limits_window_order CHECK (
    retention_outbox_days <= retention_draft_days
    AND retention_draft_days <= retention_run_days
    AND retention_event_days <= retention_run_days
    AND retention_run_days <= retention_evidence_days)
);

CREATE TABLE public.wf_quota_denial (
  org_id      uuid NOT NULL,
  limit_name  text NOT NULL CHECK (limit_name IN ('runs_per_day', 'drafts_pending', 'actions_per_hour', 'spend_cap_day',
                                                  'spend_cap_run', 'spend_wallet', 'spend_rate_unknown', 'kind_unknown')),
  kind        text NOT NULL DEFAULT '' CHECK (kind = '' OR kind ~ '^[a-z][a-z0-9_]{0,31}$'),
  bucket      timestamptz NOT NULL CHECK (bucket = date_trunc('hour', bucket)),
  denied      integer NOT NULL DEFAULT 1 CHECK (denied >= 1),
  PRIMARY KEY (org_id, limit_name, kind, bucket)
);

-- A kind listed here can cost money. NULL unit means "no rate decided": the action is refused outright.
CREATE TABLE public.wf_action_spend_rate (
  kind       text PRIMARY KEY REFERENCES public.wf_action_type (kind) ON DELETE RESTRICT,
  unit_kobo  bigint CHECK (unit_kobo IS NULL OR unit_kobo >= 0)
);
INSERT INTO public.wf_action_spend_rate (kind, unit_kobo) VALUES ('sms', NULL), ('whatsapp', NULL);

CREATE TABLE public.wf_retention_run (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  mode          text NOT NULL CHECK (mode IN ('dry_run', 'purge')),
  trigger_kind  text NOT NULL CHECK (trigger_kind IN ('manual', 'scheduler')),
  actor_id      uuid,
  outcome       text NOT NULL CHECK (outcome IN ('completed', 'refused')),
  refusal_code  text CHECK (refusal_code IS NULL OR refusal_code ~ '^[a-z][a-z0-9_]{1,63}$'),
  windows       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(windows) = 'object' AND pg_column_size(windows) <= 2048),
  counts        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(counts) = 'object' AND pg_column_size(counts) <= 4096),
  truncated     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wf_retention_run_refusal CHECK ((outcome = 'refused') = (refusal_code IS NOT NULL)),
  CONSTRAINT wf_retention_run_actor CHECK ((trigger_kind = 'manual') = (actor_id IS NOT NULL))
);
CREATE INDEX wf_retention_run_org_idx ON public.wf_retention_run (org_id, created_at DESC);
CREATE INDEX wf_quota_denial_org_idx ON public.wf_quota_denial (org_id, bucket DESC);

ALTER TABLE public.wf_action_sandbox_outbox
  ADD COLUMN cost_kobo bigint NOT NULL DEFAULT 0 CHECK (cost_kobo >= 0);

ALTER TABLE public.wf_org_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_org_limits FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wf_quota_denial ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_quota_denial FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wf_action_spend_rate ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_action_spend_rate FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wf_retention_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_retention_run FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.wf_org_limits, public.wf_quota_denial, public.wf_action_spend_rate, public.wf_retention_run
  FROM PUBLIC, anon, authenticated;
-- Members read through RLS. Nobody writes these tables directly: every write goes through a SECURITY DEFINER
-- function in this migration (limits, counters, retention log) or a reviewed migration (spend rates).
GRANT SELECT ON public.wf_org_limits, public.wf_quota_denial, public.wf_retention_run TO authenticated;
GRANT SELECT ON public.wf_org_limits, public.wf_quota_denial, public.wf_action_spend_rate, public.wf_retention_run
  TO service_role;

CREATE POLICY wf_org_limits_member_read ON public.wf_org_limits FOR SELECT TO authenticated
  USING (public.wf_can(org_id, 'workflows.view'));
CREATE POLICY wf_org_limits_service_read ON public.wf_org_limits FOR SELECT TO service_role USING (true);
CREATE POLICY wf_quota_denial_member_read ON public.wf_quota_denial FOR SELECT TO authenticated
  USING (public.wf_can(org_id, 'workflows.view'));
CREATE POLICY wf_quota_denial_service_read ON public.wf_quota_denial FOR SELECT TO service_role USING (true);
CREATE POLICY wf_action_spend_rate_service_read ON public.wf_action_spend_rate FOR SELECT TO service_role USING (true);
CREATE POLICY wf_retention_run_member_read ON public.wf_retention_run FOR SELECT TO authenticated
  USING (public.wf_can(org_id, 'workflows.view'));
CREATE POLICY wf_retention_run_service_read ON public.wf_retention_run FOR SELECT TO service_role USING (true);

CREATE TRIGGER wf_retention_run_no_mutation BEFORE UPDATE OR DELETE ON public.wf_retention_run
  FOR EACH ROW EXECUTE FUNCTION public.wf_append_only();
CREATE TRIGGER wf_retention_run_no_truncate BEFORE TRUNCATE ON public.wf_retention_run
  FOR EACH STATEMENT EXECUTE FUNCTION public.wf_append_only();

-- Limits: the organization and the creator never change, the editor is the signed-in person, wallet caps never
-- exceed the platform ceiling, and the hourly map names only real action kinds with whole numbers 0..5000.
CREATE FUNCTION public.wf_org_limits_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE v_key text; v_val jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'wf_org_limits: org_id and created_at are immutable' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.wallet_cap_kobo_per_day > public.wf_wallet_cap_ceiling_kobo()
     OR NEW.wallet_cap_kobo_per_run > public.wf_wallet_cap_ceiling_kobo() THEN
    RAISE EXCEPTION 'wf12:wallet_cap_above_ceiling' USING ERRCODE = '22023';
  END IF;
  FOR v_key, v_val IN SELECT * FROM jsonb_each(NEW.actions_per_hour) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.wf_action_type t WHERE t.kind = v_key)
       OR jsonb_typeof(v_val) <> 'number'
       OR (v_val #>> '{}') !~ '^[0-9]{1,4}$'
       OR (v_val #>> '{}')::integer > 5000 THEN
      RAISE EXCEPTION 'wf12:invalid_actions_per_hour' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  NEW.updated_by := coalesce(auth.uid(), NEW.updated_by);
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER wf_org_limits_10_guard BEFORE INSERT OR UPDATE ON public.wf_org_limits
  FOR EACH ROW EXECUTE FUNCTION public.wf_org_limits_guard();
CREATE TRIGGER wf_org_limits_90_audit AFTER INSERT OR UPDATE ON public.wf_org_limits
  FOR EACH ROW EXECUTE FUNCTION public.wf_runtime_settings_audit();

-- -----------------------------------------------------------------------------
-- 3. Effective limits, usage and the single rule set
-- -----------------------------------------------------------------------------
-- Platform defaults overlaid with the organization's row. Missing row = defaults, never unlimited.
CREATE FUNCTION public.wf_org_limits_effective(p_org uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  -- Wallet caps are clamped to the platform ceiling: lowering the ceiling later lowers every organization's cap with it.
  SELECT e || jsonb_build_object(
           'wallet_cap_kobo_per_day', least((e ->> 'wallet_cap_kobo_per_day')::bigint, public.wf_wallet_cap_ceiling_kobo()),
           'wallet_cap_kobo_per_run', least((e ->> 'wallet_cap_kobo_per_run')::bigint, public.wf_wallet_cap_ceiling_kobo()))
    FROM (SELECT public.wf_limit_defaults() || coalesce(
            (SELECT to_jsonb(l) - 'org_id' - 'updated_by' - 'created_at' - 'updated_at'
               FROM public.wf_org_limits l WHERE l.org_id = p_org), '{}'::jsonb) AS e) x
$$;

-- Read-only usage for the settings screen and the quota rules. VOLATILE on purpose: a multi-row statement must see
-- the rows it has already inserted, or a bulk insert could step over a limit.
CREATE FUNCTION public.wf_usage_snapshot(p_org uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'runs_24h', (SELECT count(*) FROM public.wf_run r
                  WHERE r.org_id = p_org AND r.created_at >= now() - interval '24 hours'),
    'drafts_pending', (SELECT count(*) FROM public.wf_action_draft d
                        WHERE d.org_id = p_org AND d.status = 'draft'),
    'actions_1h', coalesce((SELECT jsonb_object_agg(k.kind, k.n) FROM (
                    SELECT o.kind, count(*) AS n FROM public.wf_action_sandbox_outbox o
                     WHERE o.org_id = p_org AND o.created_at >= now() - interval '1 hour'
                     GROUP BY o.kind) k), '{}'::jsonb),
    'spend_24h_kobo', (SELECT coalesce(sum(o.cost_kobo), 0) FROM public.wf_action_sandbox_outbox o
                        WHERE o.org_id = p_org AND o.created_at >= now() - interval '24 hours'),
    'wallet_spendable_kobo', coalesce((SELECT greatest(floor(w.balance * 100), 0)::bigint
                                         FROM public.school_wallets w WHERE w.school_id = p_org), 0))
$$;

-- The one place that decides whether one more run, draft or action fits. Returns the refusal code, or NULL
-- when it fits. `p_mode` is 'draft' (a draft is being created) or 'execute' (an executed record is being
-- written). Used by the BEFORE INSERT triggers (authority) and by wf_quota_check_action (pre-check).
-- Counts exclude the row being inserted, so used + 1 > limit refuses. Spend caps apply to 'execute' only: a draft
-- spends nothing, and a spend-bearing draft can still be written and reviewed by a person.
CREATE FUNCTION public.wf_quota_violation(
  p_org uuid, p_kind text, p_recipients integer, p_mode text, p_run uuid)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_lim jsonb;
  v_use jsonb;
  v_rate bigint;
  v_spend boolean := false;
  v_cost bigint := 0;
  v_cap_day bigint;
  v_cap_run bigint;
  v_spent_day bigint;
  v_spent_run bigint;
  v_n integer;
  v_limit integer;
BEGIN
  IF p_org IS NULL OR p_kind IS NULL OR p_mode NOT IN ('draft', 'execute') THEN
    RETURN 'kind_unknown';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wf_action_type t WHERE t.kind = p_kind) THEN
    RETURN 'kind_unknown';
  END IF;
  v_lim := public.wf_org_limits_effective(p_org);
  v_use := public.wf_usage_snapshot(p_org);

  SELECT true, s.unit_kobo INTO v_spend, v_rate FROM public.wf_action_spend_rate s WHERE s.kind = p_kind;
  -- A draft spends nothing, so spend is judged only when an executed record is about to be written.
  IF p_mode = 'execute' AND coalesce(v_spend, false) THEN
    IF v_rate IS NULL THEN RETURN 'spend_rate_unknown'; END IF;
    v_cost := v_rate * greatest(coalesce(p_recipients, 0), 1);
    IF v_cost > 0 THEN
      v_cap_day := (v_lim ->> 'wallet_cap_kobo_per_day')::bigint;
      v_cap_run := (v_lim ->> 'wallet_cap_kobo_per_run')::bigint;
      v_spent_day := (v_use ->> 'spend_24h_kobo')::bigint;
      IF v_spent_day + v_cost > v_cap_day THEN RETURN 'spend_cap_day'; END IF;
      IF p_run IS NOT NULL THEN
        SELECT coalesce(sum(o.cost_kobo), 0) INTO v_spent_run
          FROM public.wf_action_sandbox_outbox o WHERE o.org_id = p_org AND o.run_id = p_run;
        IF v_spent_run + v_cost > v_cap_run THEN RETURN 'spend_cap_run'; END IF;
      ELSIF v_cap_run <= 0 THEN
        RETURN 'spend_cap_run';
      END IF;
      IF v_spent_day + v_cost > (v_use ->> 'wallet_spendable_kobo')::bigint THEN RETURN 'spend_wallet'; END IF;
    END IF;
  END IF;

  IF p_mode = 'draft' THEN
    v_n := (v_use ->> 'drafts_pending')::integer;
    IF v_n + 1 > (v_lim ->> 'drafts_pending')::integer THEN RETURN 'drafts_pending'; END IF;
  ELSE
    v_n := coalesce((v_use -> 'actions_1h' ->> p_kind)::integer, 0);
    v_limit := coalesce((v_lim -> 'actions_per_hour' ->> p_kind)::integer, public.wf_default_actions_per_hour(p_kind));
    IF v_n + 1 > v_limit THEN RETURN 'actions_per_hour'; END IF;
  END IF;
  RETURN NULL;
END
$$;

-- Cost attributed to an executed record: rate x recipients (at least one). 0 for kinds that cannot cost money.
CREATE FUNCTION public.wf_action_cost_kobo(p_kind text, p_recipients integer)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce((SELECT s.unit_kobo * greatest(coalesce(p_recipients, 0), 1)
                     FROM public.wf_action_spend_rate s WHERE s.kind = p_kind), 0)
$$;

-- Counted refusals (hourly buckets). Counts only: no run, step, person or recipient identifier.
CREATE FUNCTION public.wf_quota_note_denial(p_org uuid, p_limit text, p_kind text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.wf_quota_denial (org_id, limit_name, kind, bucket)
  VALUES (p_org, p_limit, coalesce(p_kind, ''), date_trunc('hour', now()))
  ON CONFLICT (org_id, limit_name, kind, bucket) DO UPDATE SET denied = public.wf_quota_denial.denied + 1;
END
$$;

CREATE FUNCTION public.wf_quota_runs_exceeded(p_org uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT (public.wf_usage_snapshot(p_org) ->> 'runs_24h')::integer + 1
         > (public.wf_org_limits_effective(p_org) ->> 'runs_per_day')::integer
$$;

-- Runtime pre-check, called before the broker is asked. Never raises for a refusal: it returns the code so the
-- step can fail with a clear reason, and it counts the refusal. Any error propagates (the runtime refuses).
CREATE FUNCTION public.wf_quota_check_action(
  p_org uuid, p_kind text, p_recipients integer, p_mode text, p_run uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_code text;
BEGIN
  IF p_org IS NULL OR p_mode NOT IN ('draft', 'execute') OR coalesce(p_recipients, 0) < 0 OR coalesce(p_recipients, 0) > 500 THEN
    RAISE EXCEPTION 'wf12:invalid_check' USING ERRCODE = '22023';
  END IF;
  v_code := public.wf_quota_violation(p_org, p_kind, p_recipients, p_mode, p_run);
  IF v_code IS NOT NULL THEN
    PERFORM public.wf_quota_note_denial(p_org, v_code, CASE WHEN v_code = 'kind_unknown' THEN NULL ELSE p_kind END);
    RETURN jsonb_build_object('allowed', false, 'code', v_code);
  END IF;
  RETURN jsonb_build_object('allowed', true, 'code', NULL);
END
$$;

-- -----------------------------------------------------------------------------
-- 4. Enforcement triggers (the authority; the runtime pre-check is only a courtesy)
-- -----------------------------------------------------------------------------
-- A replay of the same idempotency key consumes nothing: the existing row is returned to the caller's
-- ON CONFLICT DO NOTHING, so it must not be refused for being at the limit.
CREATE FUNCTION public.wf_run_quota_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_lim jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.wf_run r WHERE r.org_id = NEW.org_id AND r.idempotency_key = NEW.idempotency_key) THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wf12:runs:' || NEW.org_id::text, 7112));
  v_lim := public.wf_org_limits_effective(NEW.org_id);
  IF (public.wf_usage_snapshot(NEW.org_id) ->> 'runs_24h')::integer + 1 > (v_lim ->> 'runs_per_day')::integer THEN
    RAISE EXCEPTION 'wf12:quota_runs_per_day' USING ERRCODE = '54000';
  END IF;
  -- The organization limit can only lower what the published version allows.
  NEW.max_steps := least(NEW.max_steps, (v_lim ->> 'steps_per_run')::integer);
  RETURN NEW;
END
$$;
CREATE TRIGGER wf_run_15_quota BEFORE INSERT ON public.wf_run
  FOR EACH ROW EXECUTE FUNCTION public.wf_run_quota_guard();

CREATE FUNCTION public.wf_action_draft_quota_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_code text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.wf_action_draft d WHERE d.org_id = NEW.org_id AND d.idempotency_key = NEW.idempotency_key) THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wf12:drafts:' || NEW.org_id::text, 7112));
  v_code := public.wf_quota_violation(NEW.org_id, NEW.kind, cardinality(NEW.recipient_ids), 'draft', NEW.run_id);
  IF v_code IS NOT NULL THEN
    RAISE EXCEPTION 'wf12:quota_%', v_code USING ERRCODE = '54000';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER wf_action_draft_30_quota BEFORE INSERT ON public.wf_action_draft
  FOR EACH ROW EXECUTE FUNCTION public.wf_action_draft_quota_guard();

-- The executed record also carries its cost: computed here from the platform rate, whatever the caller sent.
CREATE FUNCTION public.wf_action_sandbox_outbox_quota_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_code text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.cost_kobo IS DISTINCT FROM OLD.cost_kobo THEN
      RAISE EXCEPTION 'wf_action_sandbox_outbox: cost_kobo is immutable' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.wf_action_sandbox_outbox o
              WHERE o.org_id = NEW.org_id AND o.idempotency_key = NEW.idempotency_key) THEN
    NEW.cost_kobo := 0;
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wf12:actions:' || NEW.org_id::text, 7112));
  v_code := public.wf_quota_violation(NEW.org_id, NEW.kind, cardinality(NEW.recipient_ids), 'execute', NEW.run_id);
  IF v_code IS NOT NULL THEN
    RAISE EXCEPTION 'wf12:quota_%', v_code USING ERRCODE = '54000';
  END IF;
  NEW.cost_kobo := public.wf_action_cost_kobo(NEW.kind, cardinality(NEW.recipient_ids));
  RETURN NEW;
END
$$;
CREATE TRIGGER wf_action_sandbox_outbox_30_quota BEFORE INSERT OR UPDATE ON public.wf_action_sandbox_outbox
  FOR EACH ROW EXECUTE FUNCTION public.wf_action_sandbox_outbox_quota_guard();

-- Event-driven run creation: when the daily run quota is full the event goes back to pending and is tried again
-- later (no attempt is burned and nothing is dropped). Everything else is the WF-03 body, unchanged.
CREATE OR REPLACE FUNCTION public.wf_create_event_run(
  p_run uuid,
  p_event uuid,
  p_lease_owner text,
  p_binding uuid,
  p_template uuid,
  p_agent_ref text,
  p_started_at timestamptz,
  p_deadline_at timestamptz,
  p_max_depth integer,
  p_max_steps integer,
  p_step_key text,
  p_step_kind text,
  p_action_class text,
  p_budget_units integer,
  p_max_attempts integer,
  p_timeout_seconds integer,
  p_input jsonb,
  p_run_state jsonb
)
RETURNS TABLE(created boolean)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_event public.wf_event%ROWTYPE;
  v_definition public.wf_definition%ROWTYPE;
  v_version public.wf_version%ROWTYPE;
  v_run_id uuid := p_run;
  v_org uuid;
BEGIN
  SELECT * INTO v_event FROM public.wf_event WHERE id = p_event FOR UPDATE;
  IF NOT FOUND OR v_event.status <> 'claimed' OR v_event.lease_owner IS DISTINCT FROM p_lease_owner
     OR v_event.lease_expires_at <= now() THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;
  v_org := v_event.org_id;

  IF NOT EXISTS (SELECT 1 FROM public.wf_org_settings s
                  WHERE s.org_id = v_org AND s.workflows_enabled) THEN
    UPDATE public.wf_event SET status = 'pending', lease_owner = NULL,
      lease_expires_at = NULL, updated_at = now() WHERE id = p_event;
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  SELECT d.* INTO v_definition
    FROM public.wf_trigger_binding b
    JOIN public.wf_definition d ON d.org_id = b.org_id AND d.id = b.definition_id
   WHERE b.org_id = v_org AND b.id = p_binding AND b.enabled
     AND b.kind = 'event' AND b.event_type = v_event.event_type
     AND d.status = 'active';
  IF NOT FOUND THEN
    UPDATE public.wf_event SET status = 'ignored', lease_owner = NULL,
      lease_expires_at = NULL, updated_at = now() WHERE id = p_event;
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  SELECT * INTO v_version FROM public.wf_version
   WHERE org_id = v_org AND definition_id = v_definition.id
     AND id = v_definition.current_version_id AND state = 'published';
  IF NOT FOUND THEN
    UPDATE public.wf_event SET status = 'pending', lease_owner = NULL,
      lease_expires_at = NULL, updated_at = now() WHERE id = p_event;
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  -- WF-12: the daily run quota. A replay of this event's run is not a new run and is never deferred.
  IF NOT EXISTS (SELECT 1 FROM public.wf_run r
                  WHERE r.org_id = v_org AND r.idempotency_key = 'wf-event:' || p_event::text)
     AND public.wf_quota_runs_exceeded(v_org) THEN
    -- The claim counted an attempt; give it back, or a full day would walk the event to 'dead' after 25 claims.
    UPDATE public.wf_event SET status = 'pending', lease_owner = NULL,
      lease_expires_at = NULL, next_attempt_at = now() + interval '5 minutes',
      attempts = greatest(attempts - 1, 0), updated_at = now()
     WHERE id = p_event;
    PERFORM public.wf_quota_note_denial(v_org, 'runs_per_day', NULL);
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  INSERT INTO public.wf_run (
    id, org_id, definition_id, version_id, trigger_binding_id, event_id,
    idempotency_key, status, max_depth, max_steps, deadline_at, started_at,
    template_id, agent_ref
  ) VALUES (
    v_run_id, v_org, v_definition.id, v_version.id, p_binding, p_event,
    'wf-event:' || p_event::text, CASE WHEN p_step_kind = 'approval' THEN 'waiting' ELSE 'running' END,
    p_max_depth, p_max_steps,
    p_deadline_at, p_started_at, p_template, p_agent_ref
  )
  ON CONFLICT (org_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_run_id;

  IF v_run_id IS NULL THEN
    UPDATE public.wf_event SET status = 'dispatched', lease_owner = NULL,
      lease_expires_at = NULL, updated_at = now() WHERE id = p_event;
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  INSERT INTO public.wf_step_run (
    org_id, run_id, step_key, kind, action_class, budget_units, idempotency_key,
    max_attempts, timeout_seconds, agent_ref, input_ref, status
  ) VALUES (
    v_org, v_run_id, p_step_key, p_step_kind, coalesce(p_action_class, 'unclassified'),
    coalesce(p_budget_units, 0),
    'wf-step:' || v_run_id::text || ':' || p_step_key || ':0',
    p_max_attempts, p_timeout_seconds, p_agent_ref, coalesce(p_input, '{}'::jsonb),
    CASE WHEN p_step_kind = 'approval' THEN 'waiting' ELSE 'pending' END
  );
  IF p_step_kind = 'approval' THEN
    INSERT INTO public.wf_approval (
      org_id, run_id, step_run_id, required_permission, summary,
      requested_by_kind, requested_by_ref, requested_at, expires_at
    )
    SELECT v_org, v_run_id, s.id, 'workflows.approve',
      'Workflow approval required for step ' || p_step_key,
      CASE WHEN p_agent_ref IS NULL THEN 'system' ELSE 'agent' END,
      coalesce(p_agent_ref, 'workflow-runtime'), p_started_at, p_started_at + interval '7 days'
    FROM public.wf_step_run s
    WHERE s.org_id = v_org AND s.run_id = v_run_id AND s.step_key = p_step_key;
  END IF;
  INSERT INTO public.wf_run_event (org_id, run_id, kind, actor_kind, actor_ref, detail)
  VALUES (v_org, v_run_id, 'runtime.state', 'system', 'workflow-runtime', p_run_state);
  UPDATE public.wf_event SET status = 'dispatched', lease_owner = NULL,
    lease_expires_at = NULL, updated_at = now() WHERE id = p_event;
  RETURN QUERY SELECT true;
END
$$;

-- -----------------------------------------------------------------------------
-- 5. Admin settings surface: read and change limits
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.wf_limits_get(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_prev jsonb;
  v_org uuid;
  v_out jsonb;
BEGIN
  v_prev := public.wf_act_as(p_actor);
  v_org := public.get_my_organization_id();
  IF v_org IS NULL OR NOT public.wf_can(v_org, 'workflows.view') THEN
    RAISE EXCEPTION 'wf12:not_authorized' USING ERRCODE = '42501';
  END IF;
  v_out := jsonb_build_object(
    'limits', public.wf_org_limits_effective(v_org),
    'bounds', public.wf_limit_bounds(),
    'usage', public.wf_usage_snapshot(v_org),
    'configured', EXISTS (SELECT 1 FROM public.wf_org_limits l WHERE l.org_id = v_org),
    'settings_exist', EXISTS (SELECT 1 FROM public.wf_org_settings s WHERE s.org_id = v_org),
    'denials_24h', coalesce((SELECT jsonb_agg(jsonb_build_object('limit', x.limit_name, 'kind', x.kind, 'denied', x.n)
                                              ORDER BY x.limit_name, x.kind)
                               FROM (SELECT d.limit_name, d.kind, sum(d.denied)::integer AS n
                                       FROM public.wf_quota_denial d
                                      WHERE d.org_id = v_org AND d.bucket >= date_trunc('hour', now() - interval '24 hours')
                                      GROUP BY d.limit_name, d.kind) x), '[]'::jsonb),
    'spend_kinds', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', s.kind, 'rate_decided', s.unit_kobo IS NOT NULL)
                                              ORDER BY s.kind) FROM public.wf_action_spend_rate s), '[]'::jsonb),
    'wallet_cap_ceiling_kobo', public.wf_wallet_cap_ceiling_kobo(),
    'last_retention', (SELECT jsonb_build_object('id', r.id, 'mode', r.mode, 'trigger', r.trigger_kind,
                              'outcome', r.outcome, 'refusal_code', r.refusal_code, 'counts', r.counts,
                              'truncated', r.truncated, 'at', r.created_at)
                         FROM public.wf_retention_run r WHERE r.org_id = v_org
                        ORDER BY r.created_at DESC, r.id DESC LIMIT 1),
    'can_manage', public.wf_can(v_org, 'workflows.manage'));
  PERFORM public.wf_act_restore(v_prev);
  RETURN v_out;
END
$$;

-- Patch semantics: only the named keys change; `actions_per_hour` merges per kind. Unknown keys, wrong types and
-- out-of-range values are refused with a stable code. The audit row is written by the table trigger.
CREATE FUNCTION public.wf_limits_update(p_actor uuid, p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_prev jsonb;
  v_org uuid;
  v_cur jsonb;
  v_next jsonb;
  v_key text;
  v_val jsonb;
  v_bounds jsonb := public.wf_limit_bounds();
  v_int_keys text[] := ARRAY['runs_per_day', 'steps_per_run', 'drafts_pending', 'retention_outbox_days',
    'retention_draft_days', 'retention_event_days', 'retention_run_days', 'retention_stepup_days',
    'retention_evidence_days'];
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'wf12:invalid_limit' USING ERRCODE = '22023';
  END IF;
  v_prev := public.wf_act_as(p_actor);
  v_org := public.get_my_organization_id();
  IF v_org IS NULL OR NOT public.wf_can(v_org, 'workflows.manage') THEN
    RAISE EXCEPTION 'wf12:not_authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wf_org_settings s WHERE s.org_id = v_org) THEN
    RAISE EXCEPTION 'wf12:settings_missing' USING ERRCODE = 'P0002';
  END IF;
  v_cur := public.wf_org_limits_effective(v_org);
  v_next := v_cur;
  FOR v_key, v_val IN SELECT * FROM jsonb_each(p_patch) LOOP
    IF v_key = ANY (v_int_keys) OR v_key IN ('wallet_cap_kobo_per_day', 'wallet_cap_kobo_per_run') THEN
      IF jsonb_typeof(v_val) <> 'number' OR (v_val #>> '{}') !~ '^[0-9]{1,12}$'
         OR (v_val #>> '{}')::bigint < (v_bounds -> v_key ->> 'min')::bigint
         OR (v_val #>> '{}')::bigint > (v_bounds -> v_key ->> 'max')::bigint THEN
        RAISE EXCEPTION 'wf12:invalid_limit' USING ERRCODE = '22023';
      END IF;
      v_next := v_next || jsonb_build_object(v_key, v_val);
    ELSIF v_key = 'retention_auto_purge' THEN
      IF jsonb_typeof(v_val) <> 'boolean' THEN RAISE EXCEPTION 'wf12:invalid_limit' USING ERRCODE = '22023'; END IF;
      v_next := v_next || jsonb_build_object(v_key, v_val);
    ELSIF v_key = 'actions_per_hour' THEN
      IF jsonb_typeof(v_val) <> 'object' THEN RAISE EXCEPTION 'wf12:invalid_limit' USING ERRCODE = '22023'; END IF;
      v_next := jsonb_set(v_next, '{actions_per_hour}', (v_cur -> 'actions_per_hour') || v_val);
    ELSE
      RAISE EXCEPTION 'wf12:invalid_limit' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  BEGIN
    INSERT INTO public.wf_org_limits (org_id, runs_per_day, steps_per_run, drafts_pending, actions_per_hour,
        wallet_cap_kobo_per_day, wallet_cap_kobo_per_run, retention_outbox_days, retention_draft_days,
        retention_event_days, retention_run_days, retention_stepup_days, retention_evidence_days,
        retention_auto_purge)
    VALUES (v_org, (v_next ->> 'runs_per_day')::integer, (v_next ->> 'steps_per_run')::integer,
        (v_next ->> 'drafts_pending')::integer, v_next -> 'actions_per_hour',
        (v_next ->> 'wallet_cap_kobo_per_day')::bigint, (v_next ->> 'wallet_cap_kobo_per_run')::bigint,
        (v_next ->> 'retention_outbox_days')::integer, (v_next ->> 'retention_draft_days')::integer,
        (v_next ->> 'retention_event_days')::integer, (v_next ->> 'retention_run_days')::integer,
        (v_next ->> 'retention_stepup_days')::integer, (v_next ->> 'retention_evidence_days')::integer,
        (v_next ->> 'retention_auto_purge')::boolean)
    ON CONFLICT (org_id) DO UPDATE SET
        runs_per_day = EXCLUDED.runs_per_day, steps_per_run = EXCLUDED.steps_per_run,
        drafts_pending = EXCLUDED.drafts_pending, actions_per_hour = EXCLUDED.actions_per_hour,
        wallet_cap_kobo_per_day = EXCLUDED.wallet_cap_kobo_per_day,
        wallet_cap_kobo_per_run = EXCLUDED.wallet_cap_kobo_per_run,
        retention_outbox_days = EXCLUDED.retention_outbox_days,
        retention_draft_days = EXCLUDED.retention_draft_days,
        retention_event_days = EXCLUDED.retention_event_days,
        retention_run_days = EXCLUDED.retention_run_days,
        retention_stepup_days = EXCLUDED.retention_stepup_days,
        retention_evidence_days = EXCLUDED.retention_evidence_days,
        retention_auto_purge = EXCLUDED.retention_auto_purge;
  EXCEPTION WHEN check_violation THEN
    -- A window order or cap rule from the table's own constraints: a stable code, no constraint names.
    RAISE EXCEPTION 'wf12:invalid_limit' USING ERRCODE = '22023';
  END;
  v_next := public.wf_org_limits_effective(v_org);
  PERFORM public.wf_act_restore(v_prev);
  RETURN jsonb_build_object('limits', v_next);
END
$$;

-- -----------------------------------------------------------------------------
-- 6. Retention
-- -----------------------------------------------------------------------------
-- Deletion carve-out. Run events, approval decisions and step-up evidence are append-only. DELETE is allowed
-- only while the purge function holds a transaction-local marker bound to the row's organization AND the
-- session user is not a client role. UPDATE and TRUNCATE stay refused. Client roles have no DELETE privilege
-- on any of these tables to begin with; this is a second lock.
CREATE FUNCTION public.wf_retention_delete_allowed(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT current_setting('wf.retention_purge', true) = 'org:' || p_org::text || ':' || txid_current()::text
         AND current_user NOT IN ('anon', 'authenticated', 'service_role')
$$;

CREATE FUNCTION public.wf_retention_delete_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND public.wf_retention_delete_allowed(OLD.org_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END
$$;

-- Run events: UPDATE stays blocked by the existing guard; DELETE moves to the carve-out guard.
DROP TRIGGER wf_run_event_no_mutation ON public.wf_run_event;
CREATE TRIGGER wf_run_event_no_update BEFORE UPDATE ON public.wf_run_event
  FOR EACH ROW EXECUTE FUNCTION public.wf_append_only();
CREATE TRIGGER wf_run_event_no_delete BEFORE DELETE ON public.wf_run_event
  FOR EACH ROW EXECUTE FUNCTION public.wf_retention_delete_guard();
DROP TRIGGER wf_approval_decision_20_append_only ON public.wf_approval_decision;
CREATE TRIGGER wf_approval_decision_20_no_update BEFORE UPDATE ON public.wf_approval_decision
  FOR EACH ROW EXECUTE FUNCTION public.wf_append_only();
CREATE TRIGGER wf_approval_decision_20_no_delete BEFORE DELETE ON public.wf_approval_decision
  FOR EACH ROW EXECUTE FUNCTION public.wf_retention_delete_guard();

-- Step-up evidence: the WF-07 guard, with only its DELETE branch changed.
CREATE OR REPLACE FUNCTION public.wf_approval_step_up_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'wf_approval_step_up is append-only' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF public.wf_retention_delete_allowed(OLD.org_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'wf_approval_step_up is append-only' USING ERRCODE = '42501';
  END IF;
  IF (NEW.id, NEW.org_id, NEW.approval_id, NEW.user_id, NEW.content_digest, NEW.verified_at, NEW.expires_at)
     IS DISTINCT FROM
     (OLD.id, OLD.org_id, OLD.approval_id, OLD.user_id, OLD.content_digest, OLD.verified_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'wf_approval_step_up: evidence fields are immutable' USING ERRCODE = '42501';
  END IF;
  IF (OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at)
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'wf_approval_step_up: a step-up is single use' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

-- A tenant or category legal hold from the M12 retention work stops every purge for the organization
-- (conservative: a category hold may not concern workflow data, and it still blocks). If the M12 table is not
-- present there can be no hold.
CREATE FUNCTION public.wf_retention_legal_hold(p_org uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_hold boolean := false;
BEGIN
  IF to_regclass('public.retention_legal_holds') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.retention_legal_holds h WHERE h.org_id = $1 AND h.active '
            || 'AND h.hold_scope IN (''tenant'', ''category''))'
       INTO v_hold USING p_org;
  END IF;
  RETURN coalesce(v_hold, false);
END
$$;

-- One bounded pass. Order matters: children first, so each parent becomes deletable in the same pass.
-- Every predicate keeps: active runs; anything a pending approval points at; approved drafts of runs that are
-- still active; approval evidence inside its own window; runs with surviving children, retry links, drafts,
-- executed records, approvals, events or caused events. audit_chain and the broker ledger are never touched.
CREATE FUNCTION public.wf_retention_pass(p_org uuid, p_lim jsonb, p_batch integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_c_outbox timestamptz := now() - make_interval(days => (p_lim ->> 'retention_outbox_days')::integer);
  v_c_draft timestamptz := now() - make_interval(days => (p_lim ->> 'retention_draft_days')::integer);
  v_c_event timestamptz := now() - make_interval(days => (p_lim ->> 'retention_event_days')::integer);
  v_c_run timestamptz := now() - make_interval(days => (p_lim ->> 'retention_run_days')::integer);
  v_c_step timestamptz := now() - make_interval(days => (p_lim ->> 'retention_stepup_days')::integer);
  v_c_evid timestamptz := now() - make_interval(days => (p_lim ->> 'retention_evidence_days')::integer);
  n_outbox integer; n_draft integer; n_rev integer; n_stepup integer; n_dec integer; n_stepup_ev integer;
  n_appr integer; n_steps integer; n_runs integer; n_events integer;
  v_appr uuid[]; v_runs uuid[];
BEGIN
  PERFORM set_config('wf.retention_purge', 'org:' || p_org::text || ':' || txid_current()::text, true);

  -- 1. Executed (sandbox) records of finished runs.
  WITH v AS (
    SELECT o.id FROM public.wf_action_sandbox_outbox o
     WHERE o.org_id = p_org AND o.created_at < v_c_outbox
       -- Only for a finished run: while a run can still resume, its executed records are what stops a replay
       -- from sending twice.
       AND EXISTS (SELECT 1 FROM public.wf_run r WHERE r.org_id = o.org_id AND r.id = o.run_id
                    AND r.status IN ('succeeded', 'failed', 'cancelled', 'timed_out'))
       AND NOT EXISTS (SELECT 1 FROM public.wf_action_draft d
                         JOIN public.wf_approval a ON a.org_id = d.org_id AND a.id = d.approval_id
                        WHERE d.org_id = o.org_id AND d.id = o.draft_id AND a.status = 'pending')
     ORDER BY o.created_at LIMIT p_batch)
  DELETE FROM public.wf_action_sandbox_outbox o USING v WHERE o.id = v.id;
  GET DIAGNOSTICS n_outbox = ROW_COUNT;

  -- 2. Drafts: decided or closed, run finished, no executed record left, no pending approval.
  WITH v AS (
    SELECT d.id FROM public.wf_action_draft d
     WHERE d.org_id = p_org AND d.created_at < v_c_draft AND d.status <> 'draft'
       AND NOT EXISTS (SELECT 1 FROM public.wf_action_sandbox_outbox o WHERE o.org_id = d.org_id AND o.draft_id = d.id)
       AND NOT EXISTS (SELECT 1 FROM public.wf_approval a
                        WHERE a.org_id = d.org_id AND a.id = d.approval_id AND a.status = 'pending')
       AND EXISTS (SELECT 1 FROM public.wf_run r WHERE r.org_id = d.org_id AND r.id = d.run_id
                    AND r.status IN ('succeeded', 'failed', 'cancelled', 'timed_out'))
     ORDER BY d.created_at LIMIT p_batch)
  DELETE FROM public.wf_action_draft d USING v WHERE d.id = v.id;
  GET DIAGNOSTICS n_draft = ROW_COUNT;

  -- 3. Run timeline events of finished runs.
  WITH v AS (
    SELECT e.id FROM public.wf_run_event e
     WHERE e.org_id = p_org AND e.at < v_c_event
       AND EXISTS (SELECT 1 FROM public.wf_run r WHERE r.org_id = e.org_id AND r.id = e.run_id
                    AND r.status IN ('succeeded', 'failed', 'cancelled', 'timed_out'))
       AND NOT EXISTS (SELECT 1 FROM public.wf_approval a
                        WHERE a.org_id = e.org_id AND a.run_id = e.run_id AND a.status = 'pending')
     ORDER BY e.id LIMIT p_batch)
  DELETE FROM public.wf_run_event e USING v WHERE e.id = v.id;
  GET DIAGNOSTICS n_rev = ROW_COUNT;

  -- 4. Step-up evidence that never led to a decision (expired, revoked or abandoned challenges).
  WITH v AS (
    SELECT s.id FROM public.wf_approval_step_up s
     WHERE s.org_id = p_org AND s.expires_at < v_c_step
       AND NOT EXISTS (SELECT 1 FROM public.wf_approval_decision d WHERE d.org_id = s.org_id AND d.step_up_id = s.id)
       AND NOT EXISTS (SELECT 1 FROM public.wf_approval a
                        WHERE a.org_id = s.org_id AND a.id = s.approval_id AND a.status = 'pending')
     ORDER BY s.verified_at LIMIT p_batch)
  DELETE FROM public.wf_approval_step_up s USING v WHERE s.id = v.id;
  GET DIAGNOSTICS n_stepup = ROW_COUNT;

  -- 5. Approval evidence (the approval, its decisions and the step-up evidence they used) once the evidence
  --    window has passed, the approval is closed, the run is finished and no draft still points at it.
  v_appr := ARRAY(
    SELECT a.id FROM public.wf_approval a
     WHERE a.org_id = p_org AND a.status <> 'pending' AND a.requested_at < v_c_evid
       AND EXISTS (SELECT 1 FROM public.wf_run r WHERE r.org_id = a.org_id AND r.id = a.run_id
                    AND r.status IN ('succeeded', 'failed', 'cancelled', 'timed_out')
                    AND r.finished_at < v_c_evid)
       AND NOT EXISTS (SELECT 1 FROM public.wf_action_draft d WHERE d.org_id = a.org_id AND d.approval_id = a.id)
     ORDER BY a.requested_at LIMIT p_batch);
  DELETE FROM public.wf_approval_decision d
   WHERE d.org_id = p_org AND d.approval_id = ANY (v_appr);
  GET DIAGNOSTICS n_dec = ROW_COUNT;
  DELETE FROM public.wf_approval_step_up s
   WHERE s.org_id = p_org AND s.approval_id = ANY (v_appr);
  GET DIAGNOSTICS n_stepup_ev = ROW_COUNT;
  DELETE FROM public.wf_approval a WHERE a.org_id = p_org AND a.id = ANY (v_appr);
  GET DIAGNOSTICS n_appr = ROW_COUNT;

  -- 6. Runs and their steps: finished past the run window, and nothing left that points at them.
  v_runs := ARRAY(
    SELECT r.id FROM public.wf_run r
     WHERE r.org_id = p_org AND r.status IN ('succeeded', 'failed', 'cancelled', 'timed_out')
       AND r.finished_at < v_c_run
       AND NOT EXISTS (SELECT 1 FROM public.wf_run c WHERE c.org_id = r.org_id
                        AND (c.parent_run_id = r.id OR c.retry_of_run_id = r.id))
       AND NOT EXISTS (SELECT 1 FROM public.wf_approval a WHERE a.org_id = r.org_id AND a.run_id = r.id)
       AND NOT EXISTS (SELECT 1 FROM public.wf_action_draft d WHERE d.org_id = r.org_id AND d.run_id = r.id)
       AND NOT EXISTS (SELECT 1 FROM public.wf_action_sandbox_outbox o WHERE o.org_id = r.org_id AND o.run_id = r.id)
       AND NOT EXISTS (SELECT 1 FROM public.wf_run_event e WHERE e.org_id = r.org_id AND e.run_id = r.id)
       AND NOT EXISTS (SELECT 1 FROM public.wf_event x WHERE x.org_id = r.org_id AND x.causation_run_id = r.id)
     ORDER BY r.finished_at LIMIT p_batch);
  DELETE FROM public.wf_step_run s WHERE s.org_id = p_org AND s.run_id = ANY (v_runs);
  GET DIAGNOSTICS n_steps = ROW_COUNT;
  DELETE FROM public.wf_run r WHERE r.org_id = p_org AND r.id = ANY (v_runs);
  GET DIAGNOSTICS n_runs = ROW_COUNT;

  -- 7. Inbound events nothing refers to any more.
  WITH v AS (
    SELECT e.id FROM public.wf_event e
     WHERE e.org_id = p_org AND e.status IN ('dispatched', 'ignored', 'dead') AND e.occurred_at < v_c_event
       AND NOT EXISTS (SELECT 1 FROM public.wf_run r WHERE r.org_id = e.org_id AND r.event_id = e.id)
     ORDER BY e.occurred_at LIMIT p_batch)
  DELETE FROM public.wf_event e USING v WHERE e.id = v.id;
  GET DIAGNOSTICS n_events = ROW_COUNT;

  PERFORM set_config('wf.retention_purge', '', true);
  RETURN jsonb_build_object(
    'outbox', n_outbox, 'drafts', n_draft, 'run_events', n_rev, 'unused_step_up', n_stepup,
    'approval_decisions', n_dec, 'approval_step_up', n_stepup_ev, 'approvals', n_appr,
    'step_runs', n_steps, 'runs', n_runs, 'inbound_events', n_events);
END
$$;

-- Dry run and purge share the same code. A dry run does the whole pass inside a subtransaction that it then
-- rolls back, so its counts are exactly what a purge would delete right now.
CREATE FUNCTION public.wf_retention_execute(p_org uuid, p_dry boolean, p_actor uuid, p_trigger text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_lim jsonb := public.wf_org_limits_effective(p_org);
  v_batch constant integer := 5000;
  v_counts jsonb;
  v_windows jsonb;
  v_id uuid := gen_random_uuid();
  v_total bigint;
  v_trunc boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('wf12:retention:' || p_org::text, 7112));
  v_windows := jsonb_build_object(
    'outbox_days', v_lim -> 'retention_outbox_days', 'draft_days', v_lim -> 'retention_draft_days',
    'event_days', v_lim -> 'retention_event_days', 'run_days', v_lim -> 'retention_run_days',
    'stepup_days', v_lim -> 'retention_stepup_days', 'evidence_days', v_lim -> 'retention_evidence_days');

  IF public.wf_retention_legal_hold(p_org) THEN
    INSERT INTO public.wf_retention_run (id, org_id, mode, trigger_kind, actor_id, outcome, refusal_code, windows)
    VALUES (v_id, p_org, CASE WHEN p_dry THEN 'dry_run' ELSE 'purge' END, p_trigger, p_actor, 'refused',
            'legal_hold', v_windows);
    PERFORM public.wf_audit_append(p_org, 'workflow.retention.refused', 'wf_retention_run', v_id::text, NULL,
      jsonb_build_object('mode', CASE WHEN p_dry THEN 'dry_run' ELSE 'purge' END, 'refusal_code', 'legal_hold'));
    RETURN jsonb_build_object('run_id', v_id, 'mode', CASE WHEN p_dry THEN 'dry_run' ELSE 'purge' END,
                              'outcome', 'refused', 'refusal_code', 'legal_hold', 'windows', v_windows,
                              'counts', '{}'::jsonb, 'truncated', false);
  END IF;

  IF p_dry THEN
    BEGIN
      v_counts := public.wf_retention_pass(p_org, v_lim, v_batch);
      RAISE EXCEPTION '%', v_counts::text USING ERRCODE = 'WF12D';
    EXCEPTION WHEN SQLSTATE 'WF12D' THEN
      v_counts := SQLERRM::jsonb;
    END;
    PERFORM set_config('wf.retention_purge', '', true);
  ELSE
    v_counts := public.wf_retention_pass(p_org, v_lim, v_batch);
  END IF;

  SELECT coalesce(sum(value::bigint), 0), coalesce(bool_or(value::bigint >= v_batch), false)
    INTO v_total, v_trunc FROM jsonb_each_text(v_counts);
  INSERT INTO public.wf_retention_run (id, org_id, mode, trigger_kind, actor_id, outcome, windows, counts, truncated)
  VALUES (v_id, p_org, CASE WHEN p_dry THEN 'dry_run' ELSE 'purge' END, p_trigger, p_actor, 'completed',
          v_windows, v_counts, v_trunc);
  PERFORM public.wf_audit_append(p_org,
    CASE WHEN p_dry THEN 'workflow.retention.dry_run' ELSE 'workflow.retention.purge' END,
    'wf_retention_run', v_id::text, NULL,
    jsonb_build_object('counts', v_counts, 'windows', v_windows, 'truncated', v_trunc));
  RETURN jsonb_build_object('run_id', v_id, 'mode', CASE WHEN p_dry THEN 'dry_run' ELSE 'purge' END,
                            'outcome', 'completed', 'refusal_code', NULL, 'windows', v_windows,
                            'counts', v_counts, 'total', v_total, 'truncated', v_trunc);
END
$$;

-- Manual: needs workflows.manage. A real purge must name a dry run of this organization from the last 24 hours,
-- so a person always looks at the counts before anything is deleted.
CREATE FUNCTION public.wf_retention_run_manual(p_actor uuid, p_dry_run boolean DEFAULT true, p_dry_run_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_prev jsonb;
  v_org uuid;
  v_out jsonb;
BEGIN
  IF p_dry_run IS NULL THEN RAISE EXCEPTION 'wf12:invalid_request' USING ERRCODE = '22023'; END IF;
  v_prev := public.wf_act_as(p_actor);
  v_org := public.get_my_organization_id();
  IF v_org IS NULL OR NOT public.wf_can(v_org, 'workflows.manage') THEN
    RAISE EXCEPTION 'wf12:not_authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wf_org_settings s WHERE s.org_id = v_org) THEN
    RAISE EXCEPTION 'wf12:settings_missing' USING ERRCODE = 'P0002';
  END IF;
  IF NOT p_dry_run AND NOT EXISTS (
       SELECT 1 FROM public.wf_retention_run r
        WHERE r.org_id = v_org AND r.id = p_dry_run_id AND r.mode = 'dry_run' AND r.outcome = 'completed'
          AND r.created_at >= now() - interval '24 hours') THEN
    RAISE EXCEPTION 'wf12:dry_run_required' USING ERRCODE = '42501';
  END IF;
  v_out := public.wf_retention_execute(v_org, p_dry_run, p_actor, 'manual');
  PERFORM public.wf_act_restore(v_prev);
  RETURN v_out;
END
$$;

-- Scheduler (service role, no person): only organizations that opted in with retention_auto_purge, and each at
-- most once a day. Everything else is left for a person to preview and run.
CREATE FUNCTION public.wf_retention_run_scheduled(p_max_orgs integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_org uuid;
  v_out jsonb := '[]'::jsonb;
  v_res jsonb;
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
    v_res := public.wf_retention_execute(v_org, false, NULL, 'scheduler');
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'org_id', v_org, 'outcome', v_res ->> 'outcome', 'refusal_code', v_res ->> 'refusal_code',
      'total', coalesce((v_res ->> 'total')::bigint, 0)));
  END LOOP;
  RETURN jsonb_build_object('orgs', v_out);
END
$$;

-- -----------------------------------------------------------------------------
-- 7. Privileges
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.wf_wallet_cap_ceiling_kobo(), public.wf_default_actions_per_hour(text), public.wf_limit_bounds(),
  public.wf_limit_defaults(), public.wf_org_limits_effective(uuid), public.wf_usage_snapshot(uuid),
  public.wf_quota_violation(uuid, text, integer, text, uuid), public.wf_action_cost_kobo(text, integer),
  public.wf_quota_note_denial(uuid, text, text), public.wf_quota_runs_exceeded(uuid),
  public.wf_quota_check_action(uuid, text, integer, text, uuid),
  public.wf_org_limits_guard(), public.wf_run_quota_guard(), public.wf_action_draft_quota_guard(),
  public.wf_action_sandbox_outbox_quota_guard(), public.wf_retention_delete_allowed(uuid),
  public.wf_retention_delete_guard(), public.wf_retention_legal_hold(uuid),
  public.wf_retention_pass(uuid, jsonb, integer), public.wf_retention_execute(uuid, boolean, uuid, text),
  public.wf_limits_get(uuid), public.wf_limits_update(uuid, jsonb),
  public.wf_retention_run_manual(uuid, boolean, uuid), public.wf_retention_run_scheduled(integer)
  FROM PUBLIC, anon, authenticated;
-- What the server calls, and what wf_create_event_run (service role, SECURITY INVOKER) calls.
GRANT EXECUTE ON FUNCTION
  public.wf_limits_get(uuid), public.wf_limits_update(uuid, jsonb),
  public.wf_retention_run_manual(uuid, boolean, uuid), public.wf_retention_run_scheduled(integer),
  public.wf_quota_check_action(uuid, text, integer, text, uuid),
  public.wf_quota_runs_exceeded(uuid), public.wf_quota_note_denial(uuid, text, text)
  TO service_role;

COMMENT ON TABLE public.wf_org_limits IS
  'WF-12 / ADR-124: per-organization quotas, wallet caps and retention windows. No row = platform defaults. Written only through wf_limits_update.';
COMMENT ON TABLE public.wf_action_spend_rate IS
  'WF-12 / ADR-124: action kinds that can cost money. unit_kobo NULL = no rate decided = every such action is refused.';
COMMENT ON TABLE public.wf_retention_run IS
  'WF-12 / ADR-124: append-only log of retention dry runs and purges (counts and windows only).';
COMMENT ON COLUMN public.wf_action_sandbox_outbox.cost_kobo IS
  'WF-12 / ADR-124: cost attributed to this executed record for the wallet cap. Computed by trigger from the platform rate; no wallet money moves.';
COMMENT ON FUNCTION public.wf_wallet_cap_ceiling_kobo() IS
  'WF-12 / ADR-124: platform ceiling for workflow wallet caps. 0 until the founder decides WhatsApp and SMS rates (decision 2).';
COMMENT ON FUNCTION public.wf_retention_run_manual(uuid, boolean, uuid) IS
  'WF-12 / ADR-124: dry run (default) or purge. A purge must name a dry run of this organization from the last 24 hours. Needs workflows.manage.';

COMMIT;
