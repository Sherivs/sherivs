-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.
-- AIN-01: agents as engine actors (ADR-125). Origin: Claude Code agent, mission AIN-01 (issue #472).
-- Stacked on WF-12 (#471) -> WF-08 (#469) -> WF-07 (#467) -> WF-06 (#455).
--
-- Version note: 20261117000970 sorts directly after WF-12 (20261117000960) and before the M2a role catalogue
-- (20261117001000, PR #448). It is free on every open branch checked on 2026-11-20.
--
-- What this adds (all names neutral):
--   wf_agent                      one row per engine actor: identity, family, tier, accountable role, supervisor,
--                                 highest capability tier, context ceiling and the daily budget caps
--   wf_agent_capability           the capabilities of each actor (tier, autonomy mode, permission, connector, approver)
--   wf_agent_tier_action_class    which engine action classes each capability tier may use (reviewed data)
--   wf_agent_platform_grant       the only way a platform (Sherivs-internal) agent may act inside an organization;
--                                 empty on purpose, written only by a reviewed migration until WF-13
--   wf_ai_route_approved()        false. Founder decision 3 (AI route) is open: no step of kind 'ai' can exist yet
--   wf_agent_step_guard()         BEFORE INSERT on wf_step_run (fail closed) for any step with an effective agent
--   wf_agent_step_immutable()     BEFORE UPDATE OF action_class, kind, agent_ref: an existing step cannot be reclassified
--   wf_agent_registry_get()       read surface for one organization (needs workflows.view)
--
-- What this does NOT do: no model call, no tenant data to any AI, no send, no change to the autonomy scale
-- (wf_agent_autonomy is never written here; an agent without a row stays at 'suggest'; promotion is AIN-02 and the
-- founder alone, decision 9), no second enable switch for organization agents (their enable, pause and plan check
-- stay in the existing organization add-on state, ENGINE-20/22, which this reads), no weakening of any earlier guard.
--
-- Authority model (same as WF-07, WF-08, WF-12): SECURITY DEFINER, empty search_path, EXECUTE only to service_role
-- for the function the server calls; the server passes the verified person, SQL binds it and derives the
-- organization from it (never from a parameter). The registry tables are service-role readable only: the roster of
-- Sherivs-internal agents is not shown to tenants.
BEGIN;

DO $prereq$
BEGIN
  IF to_regclass('public.wf_step_run') IS NULL
     OR to_regclass('public.wf_run') IS NULL
     OR to_regclass('public.wf_template') IS NULL
     OR to_regclass('public.wf_org_settings') IS NULL
     OR to_regclass('public.wf_agent_autonomy') IS NULL
     OR to_regprocedure('public.wf_autonomy_guard()') IS NULL
     OR to_regprocedure('public.wf_audit_append(uuid,text,text,text,jsonb,jsonb)') IS NULL
     OR to_regprocedure('public.wf_act_as(uuid)') IS NULL
     OR to_regprocedure('public.wf_act_restore(jsonb)') IS NULL
     OR to_regprocedure('public.wf_can(uuid,text)') IS NULL
     OR to_regprocedure('public.is_agent_paused(text)') IS NULL
     OR to_regprocedure('public.get_my_organization_id()') IS NULL THEN
    RAISE EXCEPTION 'AIN-01: WF-03, WF-07 or ENGINE-16 prerequisites are missing';
  END IF;
  IF to_regclass('public.wf_agent') IS NOT NULL
     OR to_regclass('public.wf_agent_capability') IS NOT NULL
     OR to_regclass('public.wf_agent_platform_grant') IS NOT NULL
     OR to_regprocedure('public.wf_agent_registry_get(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'AIN-01: registry objects already exist';
  END IF;
  -- The insert tripwire (ain01:ai_route_undecided) cannot see rows written before it existed, and the claim path has no
  -- check of its own: refuse to install over an AI step so none can ever be claimed while the route is undecided.
  IF EXISTS (SELECT 1 FROM public.wf_step_run WHERE kind = 'ai' OR action_class = 'ai_model') THEN
    RAISE EXCEPTION 'AIN-01: an AI step already exists while the AI route is undecided (founder decision 3); review it first';
  END IF;
END
$prereq$;

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------
CREATE TABLE public.wf_agent (
  agent_ref            text PRIMARY KEY CHECK (agent_ref ~ '^[a-z][a-z0-9-]{1,63}$'),
  family               text NOT NULL CHECK (family IN ('platform', 'org')),
  codename             text NOT NULL CHECK (length(btrim(codename)) BETWEEN 2 AND 60),
  agent_tier           text NOT NULL CHECK (agent_tier IN ('executive', 'department', 'assurance', 'organization')),
  accountable          text NOT NULL CHECK (accountable ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  supervisor           text CHECK (supervisor IS NULL OR supervisor ~ '^[a-z][a-z0-9-]{1,63}$'),
  pack_version         text NOT NULL CHECK (pack_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  max_tier             text NOT NULL CHECK (max_tier IN ('T0', 'T1', 'T2', 'T3')),
  context_ceiling      text NOT NULL CHECK (context_ceiling IN ('public', 'internal', 'restricted')),
  daily_actions        integer NOT NULL CHECK (daily_actions BETWEEN 1 AND 100000),
  daily_model_calls    integer NOT NULL CHECK (daily_model_calls BETWEEN 0 AND 100000),
  daily_cost_cap_minor integer NOT NULL CHECK (daily_cost_cap_minor BETWEEN 0 AND 100000000),
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  -- A platform agent is supervised (by the executive agent, or by the sheriff); an organization agent answers to
  -- its accountable role and has no supervising agent, and its code is the add-on code (org-...).
  CONSTRAINT wf_agent_family_shape CHECK (
    (family = 'platform' AND agent_tier IN ('executive', 'department', 'assurance') AND supervisor IS NOT NULL)
    OR (family = 'org' AND agent_tier = 'organization' AND supervisor IS NULL AND agent_ref LIKE 'org-%')),
  CONSTRAINT wf_agent_no_self_supervision CHECK (supervisor IS DISTINCT FROM agent_ref),
  -- Charter rules (ADR-088) restated where a bug in a seed script cannot bypass them.
  CONSTRAINT wf_agent_executive_sheriff CHECK (agent_tier <> 'executive' OR supervisor = 'sheriff'),
  CONSTRAINT wf_agent_assurance_independent CHECK (
    agent_tier <> 'assurance' OR (supervisor = 'sheriff' AND max_tier IN ('T0', 'T1'))),
  CONSTRAINT wf_agent_org_tier_cap CHECK (family <> 'org' OR max_tier IN ('T0', 'T1', 'T2'))
);

CREATE TABLE public.wf_agent_capability (
  agent_ref           text NOT NULL REFERENCES public.wf_agent (agent_ref) ON DELETE RESTRICT,
  capability_id       text NOT NULL CHECK (capability_id ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  tier                text NOT NULL CHECK (tier IN ('T0', 'T1', 'T2', 'T3')),
  autonomy_mode       text NOT NULL CHECK (autonomy_mode IN ('propose_only', 'act_with_approval', 'act_autonomously')),
  requires_permission text NOT NULL CHECK (requires_permission ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  connector           text CHECK (connector IS NULL OR connector ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  approver            text CHECK (approver IS NULL OR approver IN ('role_owner', 'platform_staff', 'sheriff')),
  PRIMARY KEY (agent_ref, capability_id),
  -- No capability above T1 is ever autonomous (MAX_AUTONOMOUS_TIER).
  CONSTRAINT wf_agent_capability_autonomy_cap CHECK (autonomy_mode <> 'act_autonomously' OR tier IN ('T0', 'T1'))
);

CREATE TABLE public.wf_agent_tier_action_class (
  tier         text NOT NULL CHECK (tier IN ('T0', 'T1', 'T2', 'T3')),
  action_class text NOT NULL CHECK (action_class ~ '^[a-z][a-z0-9_]{1,63}$'),
  PRIMARY KEY (tier, action_class)
);

-- A platform agent may act in an organization only while a row names both. Written only by a reviewed migration
-- (the sheriff-gated path is WF-13), so no tenant administrator can bring an internal agent into a tenant.
CREATE TABLE public.wf_agent_platform_grant (
  org_id     uuid NOT NULL REFERENCES public.wf_org_settings (org_id) ON DELETE RESTRICT,
  agent_ref  text NOT NULL REFERENCES public.wf_agent (agent_ref) ON DELETE RESTRICT,
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, agent_ref)
);
CREATE INDEX wf_agent_platform_grant_agent_idx ON public.wf_agent_platform_grant (agent_ref);
-- The daily budget count: one organization's recent steps of one agent.
CREATE INDEX wf_step_run_agent_recent_idx ON public.wf_step_run (org_id, agent_ref, created_at DESC)
  WHERE agent_ref IS NOT NULL;

-- A capability can never be above its agent's highest tier, and an agent's highest tier is a real capability's.
CREATE FUNCTION public.wf_agent_capability_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE v_max text;
BEGIN
  SELECT a.max_tier INTO v_max FROM public.wf_agent a WHERE a.agent_ref = NEW.agent_ref;
  IF v_max IS NULL OR substr(NEW.tier, 2)::integer > substr(v_max, 2)::integer THEN
    RAISE EXCEPTION 'ain01:capability_above_agent_tier' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER wf_agent_capability_10_guard BEFORE INSERT OR UPDATE ON public.wf_agent_capability
  FOR EACH ROW EXECUTE FUNCTION public.wf_agent_capability_guard();

-- -----------------------------------------------------------------------------
-- 2. Seed (generated from the agent packs and charters; a unit test keeps it in step)
-- -----------------------------------------------------------------------------
-- BEGIN GENERATED AIN01 SEED (scripts/ops/generate-ain01-agent-seed.mjs; do not edit by hand)
INSERT INTO public.wf_agent (agent_ref, family, codename, agent_tier, accountable, supervisor, pack_version,
    max_tier, context_ceiling, daily_actions, daily_model_calls, daily_cost_cap_minor) VALUES
  ('support-agent', 'platform', 'Ada', 'department', 'support', 'jarvis-executive', '1.0.0', 'T2', 'internal', 800, 400, 3000),
  ('engineering-agent', 'platform', 'Forge', 'department', 'engineering', 'jarvis-executive', '1.0.0', 'T3', 'internal', 300, 200, 4000),
  ('security-agent', 'platform', 'Aegis', 'department', 'security', 'jarvis-executive', '1.0.0', 'T3', 'restricted', 400, 150, 2500),
  ('finance-agent', 'platform', 'Ledger', 'department', 'finance', 'jarvis-executive', '1.0.0', 'T3', 'restricted', 200, 60, 1500),
  ('sales-agent', 'platform', 'Atlas', 'department', 'sales', 'jarvis-executive', '1.0.0', 'T3', 'internal', 300, 150, 2000),
  ('operations-agent', 'platform', 'Helm', 'department', 'operations', 'jarvis-executive', '1.0.0', 'T2', 'internal', 500, 120, 2000),
  ('jarvis-executive', 'platform', 'JARVIS', 'executive', 'sheriff', 'sheriff', '1.0.0', 'T3', 'internal', 200, 400, 5000),
  ('compliance-agent', 'platform', 'Themis', 'department', 'compliance', 'jarvis-executive', '1.0.0', 'T2', 'restricted', 200, 100, 1500),
  ('reliability-agent', 'platform', 'Pulse', 'department', 'operations', 'jarvis-executive', '1.0.0', 'T2', 'internal', 300, 120, 2000),
  ('customer-success-agent', 'platform', 'Nia', 'department', 'sales', 'jarvis-executive', '1.0.0', 'T2', 'internal', 300, 150, 2000),
  ('revenue-assurance-agent', 'platform', 'Mint', 'department', 'finance', 'jarvis-executive', '1.0.0', 'T2', 'internal', 200, 100, 1500),
  ('sentinel-agent', 'platform', 'Sentinel', 'assurance', 'sheriff', 'sheriff', '1.0.0', 'T1', 'internal', 150, 80, 1000),
  ('archivist-agent', 'platform', 'Sage', 'department', 'engineering', 'jarvis-executive', '1.0.0', 'T1', 'internal', 300, 200, 2000),
  ('product-intelligence-agent', 'platform', 'Compass', 'department', 'platform_admin', 'jarvis-executive', '1.0.0', 'T1', 'internal', 150, 100, 1500),
  ('market-intelligence-agent', 'platform', 'Scout', 'department', 'platform_admin', 'jarvis-executive', '1.0.0', 'T1', 'internal', 150, 100, 1500),
  ('onboarding-agent', 'platform', 'Bridge', 'department', 'operations', 'jarvis-executive', '1.0.0', 'T2', 'internal', 300, 150, 2000),
  ('safeguarding-agent', 'platform', 'Warden', 'department', 'compliance', 'jarvis-executive', '1.0.0', 'T2', 'restricted', 200, 100, 1500),
  ('qa-agent', 'platform', 'Gauge', 'department', 'engineering', 'jarvis-executive', '1.0.0', 'T1', 'internal', 300, 150, 2000),
  ('evaluation-agent', 'platform', 'Proctor', 'assurance', 'sheriff', 'sheriff', '1.0.0', 'T1', 'internal', 300, 400, 3000),
  ('marketing-agent', 'platform', 'Echo', 'department', 'sales', 'jarvis-executive', '1.0.0', 'T3', 'internal', 300, 200, 2500),
  ('localisation-agent', 'platform', 'Griot', 'department', 'platform_admin', 'jarvis-executive', '1.0.0', 'T1', 'internal', 300, 300, 2000),
  ('data-agent', 'platform', 'Prism', 'department', 'platform_admin', 'jarvis-executive', '1.0.0', 'T1', 'internal', 300, 150, 2000),
  ('legal-agent', 'platform', 'Brief', 'department', 'platform_admin', 'jarvis-executive', '1.0.0', 'T2', 'internal', 200, 100, 1500),
  ('people-agent', 'platform', 'Keystone', 'department', 'platform_admin', 'jarvis-executive', '1.0.0', 'T3', 'internal', 200, 100, 1500),
  ('investor-agent', 'platform', 'Beacon', 'department', 'platform_admin', 'jarvis-executive', '1.0.0', 'T1', 'internal', 200, 100, 1500),
  ('org-support', 'org', 'Concierge', 'organization', 'admin', NULL, '1.0.0', 'T2', 'internal', 150, 30, 300),
  ('org-fees', 'org', 'Tally', 'organization', 'bursar', NULL, '1.0.0', 'T2', 'internal', 150, 30, 300),
  ('org-attendance', 'org', 'Roll', 'organization', 'principal', NULL, '1.0.0', 'T2', 'internal', 150, 30, 300),
  ('org-report-cards', 'org', 'Marksheet', 'organization', 'principal', NULL, '1.0.0', 'T2', 'internal', 150, 30, 300),
  ('org-parent-comms', 'org', 'Courier', 'organization', 'admin', NULL, '1.0.0', 'T2', 'internal', 150, 30, 300),
  ('org-admissions', 'org', 'Intake', 'organization', 'admin', NULL, '1.0.0', 'T2', 'internal', 150, 30, 300),
  ('org-timetable', 'org', 'Bell', 'organization', 'principal', NULL, '1.0.0', 'T2', 'internal', 150, 30, 300),
  ('org-safeguarding', 'org', 'Haven', 'organization', 'principal', NULL, '1.0.0', 'T2', 'internal', 150, 30, 300),
  ('org-transport', 'org', 'Route', 'organization', 'admin', NULL, '1.0.0', 'T2', 'internal', 150, 30, 300),
  ('org-proprietor', 'org', 'Overview', 'organization', 'hq', NULL, '1.0.0', 'T0', 'internal', 150, 30, 300),
  ('org-exams', 'org', 'Sitting', 'organization', 'principal', NULL, '1.0.0', 'T2', 'internal', 150, 30, 300),
  ('org-records', 'org', 'Archive', 'organization', 'admin', NULL, '1.0.0', 'T2', 'internal', 150, 30, 300),
  ('org-staff-admin', 'org', 'Roster', 'organization', 'admin', NULL, '1.0.0', 'T2', 'internal', 150, 30, 300),
  ('org-facilities', 'org', 'Upkeep', 'organization', 'admin', NULL, '1.0.0', 'T2', 'internal', 150, 30, 300),
  ('org-learning-support', 'org', 'Scaffold', 'organization', 'principal', NULL, '1.0.0', 'T2', 'internal', 150, 30, 300),
  ('org-compliance', 'org', 'Shield', 'organization', 'principal', NULL, '1.0.0', 'T2', 'internal', 150, 30, 300),
  ('org-alumni', 'org', 'Legacy', 'organization', 'admin', NULL, '1.0.0', 'T2', 'internal', 150, 30, 300);
INSERT INTO public.wf_agent_capability (agent_ref, capability_id, tier, autonomy_mode, requires_permission,
    connector, approver) VALUES
  ('support-agent', 'lookup.tenant', 'T0', 'act_autonomously', 'platform.tenants.read', NULL, NULL),
  ('support-agent', 'triage.ticket', 'T1', 'act_autonomously', 'platform.support.handle', NULL, NULL),
  ('support-agent', 'draft.reply', 'T0', 'act_autonomously', 'platform.support.handle', NULL, NULL),
  ('support-agent', 'send.reply', 'T2', 'act_with_approval', 'platform.support.handle', 'whatsapp', 'platform_staff'),
  ('support-agent', 'escalate.human', 'T1', 'act_autonomously', 'platform.support.handle', NULL, NULL),
  ('engineering-agent', 'summarise.incident', 'T0', 'act_autonomously', 'platform.engineering.read', NULL, NULL),
  ('engineering-agent', 'run.diagnostics', 'T0', 'act_autonomously', 'platform.engineering.read', NULL, NULL),
  ('engineering-agent', 'draft.pull.request', 'T1', 'act_with_approval', 'platform.engineering.read', 'github', 'platform_staff'),
  ('engineering-agent', 'request.deploy', 'T3', 'act_with_approval', 'platform.config.read', 'github', 'sheriff'),
  ('security-agent', 'triage.alert', 'T0', 'act_autonomously', 'platform.security.read', NULL, NULL),
  ('security-agent', 'correlate.signals', 'T0', 'act_autonomously', 'platform.audit.read', NULL, NULL),
  ('security-agent', 'draft.incident.report', 'T0', 'act_autonomously', 'platform.security.read', NULL, NULL),
  ('security-agent', 'quarantine.worker', 'T2', 'act_with_approval', 'platform.security.read', NULL, 'platform_staff'),
  ('security-agent', 'request.credential.rotation', 'T3', 'act_with_approval', 'platform.security.read', NULL, 'sheriff'),
  ('finance-agent', 'reconcile.billing', 'T0', 'act_autonomously', 'platform.finance.read', NULL, NULL),
  ('finance-agent', 'flag.anomaly', 'T0', 'act_autonomously', 'platform.finance.read', NULL, NULL),
  ('finance-agent', 'draft.invoice', 'T1', 'act_with_approval', 'platform.finance.read', NULL, 'platform_staff'),
  ('finance-agent', 'request.refund', 'T3', 'act_with_approval', 'platform.finance.read', 'payments', 'sheriff'),
  ('sales-agent', 'qualify.lead', 'T1', 'act_autonomously', 'platform.sales.handle', NULL, NULL),
  ('sales-agent', 'draft.outreach', 'T0', 'act_autonomously', 'platform.sales.handle', NULL, NULL),
  ('sales-agent', 'update.crm', 'T1', 'act_autonomously', 'platform.sales.handle', 'crm', NULL),
  ('sales-agent', 'send.outreach', 'T2', 'act_with_approval', 'platform.sales.handle', 'email', 'platform_staff'),
  ('sales-agent', 'publish.social.post', 'T3', 'act_with_approval', 'platform.sales.handle', 'social', 'sheriff'),
  ('operations-agent', 'monitor.platform', 'T0', 'act_autonomously', 'platform.operations.read', NULL, NULL),
  ('operations-agent', 'run.playbook', 'T1', 'act_autonomously', 'platform.operations.read', NULL, NULL),
  ('operations-agent', 'schedule.maintenance', 'T2', 'act_with_approval', 'platform.config.read', NULL, 'platform_staff'),
  ('operations-agent', 'notify.tenants', 'T2', 'act_with_approval', 'platform.operations.read', 'whatsapp', 'platform_staff'),
  ('jarvis-executive', 'observe.platform', 'T0', 'act_autonomously', 'platform.tenants.read', NULL, NULL),
  ('jarvis-executive', 'assess.workforce', 'T0', 'act_autonomously', 'platform.operations.read', NULL, NULL),
  ('jarvis-executive', 'draft.social.post', 'T0', 'act_autonomously', 'platform.sales.handle', NULL, NULL),
  ('jarvis-executive', 'coordinate.workforce', 'T1', 'act_autonomously', 'platform.operations.read', NULL, NULL),
  ('jarvis-executive', 'notify.owner', 'T1', 'act_autonomously', 'platform.operations.read', 'owner-alert', NULL),
  ('jarvis-executive', 'demote.capability', 'T1', 'act_autonomously', 'platform.operations.read', NULL, NULL),
  ('jarvis-executive', 'pause.agent', 'T1', 'act_autonomously', 'platform.operations.read', NULL, NULL),
  ('jarvis-executive', 'send.customer.message', 'T2', 'act_with_approval', 'platform.support.handle', 'whatsapp', 'platform_staff'),
  ('jarvis-executive', 'publish.social.post', 'T3', 'act_with_approval', 'platform.sales.handle', 'social', 'sheriff'),
  ('jarvis-executive', 'request.deploy', 'T3', 'act_with_approval', 'platform.engineering.read', 'vercel', 'sheriff'),
  ('jarvis-executive', 'request.refund', 'T3', 'act_with_approval', 'platform.finance.read', 'payments', 'sheriff'),
  ('jarvis-executive', 'request.access.grant', 'T3', 'act_with_approval', 'platform.staff.manage', 'iam', 'sheriff'),
  ('compliance-agent', 'scan.retention', 'T0', 'act_autonomously', 'platform.compliance.read', NULL, NULL),
  ('compliance-agent', 'assess.data.request', 'T1', 'act_autonomously', 'platform.compliance.handle', NULL, NULL),
  ('compliance-agent', 'draft.breach.assessment', 'T0', 'act_autonomously', 'platform.compliance.handle', NULL, NULL),
  ('compliance-agent', 'send.data.notice', 'T2', 'act_with_approval', 'platform.compliance.handle', 'email', 'platform_staff'),
  ('compliance-agent', 'escalate.counsel', 'T1', 'act_autonomously', 'platform.compliance.handle', NULL, NULL),
  ('reliability-agent', 'detect.incident', 'T0', 'act_autonomously', 'platform.reliability.read', NULL, NULL),
  ('reliability-agent', 'open.incident', 'T1', 'act_autonomously', 'platform.reliability.handle', NULL, NULL),
  ('reliability-agent', 'run.runbook', 'T1', 'act_autonomously', 'platform.reliability.handle', NULL, NULL),
  ('reliability-agent', 'draft.postmortem', 'T0', 'act_autonomously', 'platform.reliability.handle', NULL, NULL),
  ('reliability-agent', 'publish.status.update', 'T2', 'act_with_approval', 'platform.reliability.handle', 'email', 'platform_staff'),
  ('customer-success-agent', 'score.health', 'T0', 'act_autonomously', 'platform.success.read', NULL, NULL),
  ('customer-success-agent', 'flag.churn.risk', 'T1', 'act_autonomously', 'platform.success.handle', NULL, NULL),
  ('customer-success-agent', 'plan.onboarding', 'T1', 'act_autonomously', 'platform.success.handle', NULL, NULL),
  ('customer-success-agent', 'draft.checkin', 'T0', 'act_autonomously', 'platform.success.handle', NULL, NULL),
  ('customer-success-agent', 'send.checkin', 'T2', 'act_with_approval', 'platform.success.handle', 'email', 'platform_staff'),
  ('revenue-assurance-agent', 'detect.usage.anomaly', 'T0', 'act_autonomously', 'platform.finops.read', NULL, NULL),
  ('revenue-assurance-agent', 'forecast.cost', 'T0', 'act_autonomously', 'platform.finops.read', NULL, NULL),
  ('revenue-assurance-agent', 'track.collections', 'T1', 'act_autonomously', 'platform.finops.handle', NULL, NULL),
  ('revenue-assurance-agent', 'draft.dunning.notice', 'T0', 'act_autonomously', 'platform.finops.handle', NULL, NULL),
  ('revenue-assurance-agent', 'send.payment.reminder', 'T2', 'act_with_approval', 'platform.finops.handle', 'email', 'platform_staff'),
  ('sentinel-agent', 'review.ledger', 'T0', 'act_autonomously', 'platform.audit.read', NULL, NULL),
  ('sentinel-agent', 'review.approvals', 'T0', 'act_autonomously', 'platform.audit.read', NULL, NULL),
  ('sentinel-agent', 'review.agent.behaviour', 'T1', 'act_autonomously', 'platform.audit.read', NULL, NULL),
  ('sentinel-agent', 'file.finding', 'T1', 'act_autonomously', 'platform.audit.read', NULL, NULL),
  ('sentinel-agent', 'escalate.sheriff', 'T1', 'act_autonomously', 'platform.audit.read', 'owner-alert', NULL),
  ('archivist-agent', 'search.knowledge', 'T0', 'act_autonomously', 'platform.knowledge.read', NULL, NULL),
  ('archivist-agent', 'answer.with.sources', 'T0', 'act_autonomously', 'platform.knowledge.read', NULL, NULL),
  ('archivist-agent', 'draft.runbook', 'T0', 'act_autonomously', 'platform.knowledge.handle', NULL, NULL),
  ('archivist-agent', 'update.knowledge.entry', 'T1', 'act_autonomously', 'platform.knowledge.handle', NULL, NULL),
  ('product-intelligence-agent', 'synthesise.feedback', 'T0', 'act_autonomously', 'platform.product.read', NULL, NULL),
  ('product-intelligence-agent', 'analyse.usage', 'T0', 'act_autonomously', 'platform.product.read', NULL, NULL),
  ('product-intelligence-agent', 'draft.product.brief', 'T0', 'act_autonomously', 'platform.product.handle', NULL, NULL),
  ('product-intelligence-agent', 'file.product.insight', 'T1', 'act_autonomously', 'platform.product.handle', NULL, NULL),
  ('market-intelligence-agent', 'watch.competitors', 'T0', 'act_autonomously', 'platform.market.read', NULL, NULL),
  ('market-intelligence-agent', 'watch.policy', 'T0', 'act_autonomously', 'platform.market.read', NULL, NULL),
  ('market-intelligence-agent', 'draft.market.brief', 'T0', 'act_autonomously', 'platform.market.handle', NULL, NULL),
  ('market-intelligence-agent', 'file.market.insight', 'T1', 'act_autonomously', 'platform.market.handle', NULL, NULL),
  ('onboarding-agent', 'assess.readiness', 'T0', 'act_autonomously', 'platform.onboarding.read', NULL, NULL),
  ('onboarding-agent', 'plan.setup', 'T1', 'act_autonomously', 'platform.onboarding.handle', NULL, NULL),
  ('onboarding-agent', 'validate.import', 'T1', 'act_autonomously', 'platform.onboarding.handle', NULL, NULL),
  ('onboarding-agent', 'draft.training.plan', 'T0', 'act_autonomously', 'platform.onboarding.handle', NULL, NULL),
  ('onboarding-agent', 'send.welcome.pack', 'T2', 'act_with_approval', 'platform.onboarding.handle', 'email', 'platform_staff'),
  ('safeguarding-agent', 'screen.report', 'T1', 'act_autonomously', 'platform.safeguarding.handle', NULL, NULL),
  ('safeguarding-agent', 'route.designated.lead', 'T1', 'act_autonomously', 'platform.safeguarding.handle', NULL, NULL),
  ('safeguarding-agent', 'draft.guidance', 'T0', 'act_autonomously', 'platform.safeguarding.handle', NULL, NULL),
  ('safeguarding-agent', 'notify.designated.lead', 'T2', 'act_with_approval', 'platform.safeguarding.handle', 'whatsapp', 'platform_staff'),
  ('qa-agent', 'run.regression', 'T1', 'act_autonomously', 'platform.qa.handle', NULL, NULL),
  ('qa-agent', 'review.change', 'T1', 'act_autonomously', 'platform.qa.handle', NULL, NULL),
  ('qa-agent', 'draft.release.notes', 'T0', 'act_autonomously', 'platform.qa.handle', NULL, NULL),
  ('qa-agent', 'recommend.release.hold', 'T1', 'act_autonomously', 'platform.qa.handle', NULL, NULL),
  ('evaluation-agent', 'run.eval.suite', 'T1', 'act_autonomously', 'platform.audit.read', NULL, NULL),
  ('evaluation-agent', 'probe.injection', 'T1', 'act_autonomously', 'platform.audit.read', NULL, NULL),
  ('evaluation-agent', 'score.agent', 'T1', 'act_autonomously', 'platform.audit.read', NULL, NULL),
  ('evaluation-agent', 'report.evaluation', 'T0', 'act_autonomously', 'platform.audit.read', NULL, NULL),
  ('evaluation-agent', 'recommend.autonomy.change', 'T1', 'act_autonomously', 'platform.audit.read', NULL, NULL),
  ('marketing-agent', 'research.topics', 'T0', 'act_autonomously', 'platform.marketing.read', NULL, NULL),
  ('marketing-agent', 'draft.content', 'T0', 'act_autonomously', 'platform.marketing.handle', NULL, NULL),
  ('marketing-agent', 'plan.campaign', 'T1', 'act_autonomously', 'platform.marketing.handle', NULL, NULL),
  ('marketing-agent', 'send.newsletter', 'T2', 'act_with_approval', 'platform.marketing.handle', 'email', 'platform_staff'),
  ('marketing-agent', 'publish.social.post', 'T3', 'act_with_approval', 'platform.marketing.handle', 'social', 'sheriff'),
  ('localisation-agent', 'extract.strings', 'T0', 'act_autonomously', 'platform.localisation.read', NULL, NULL),
  ('localisation-agent', 'translate.draft', 'T0', 'act_autonomously', 'platform.localisation.handle', NULL, NULL),
  ('localisation-agent', 'check.glossary', 'T0', 'act_autonomously', 'platform.localisation.read', NULL, NULL),
  ('localisation-agent', 'file.translation', 'T1', 'act_autonomously', 'platform.localisation.handle', NULL, NULL),
  ('data-agent', 'refresh.metrics', 'T1', 'act_autonomously', 'platform.data.handle', NULL, NULL),
  ('data-agent', 'answer.metric.question', 'T0', 'act_autonomously', 'platform.data.read', NULL, NULL),
  ('data-agent', 'detect.metric.drift', 'T0', 'act_autonomously', 'platform.data.read', NULL, NULL),
  ('data-agent', 'draft.weekly.brief', 'T0', 'act_autonomously', 'platform.data.handle', NULL, NULL),
  ('legal-agent', 'draft.contract', 'T0', 'act_autonomously', 'platform.legal.handle', NULL, NULL),
  ('legal-agent', 'review.vendor.terms', 'T0', 'act_autonomously', 'platform.legal.read', NULL, NULL),
  ('legal-agent', 'track.obligations', 'T1', 'act_autonomously', 'platform.legal.handle', NULL, NULL),
  ('legal-agent', 'refer.counsel', 'T1', 'act_autonomously', 'platform.legal.handle', NULL, NULL),
  ('legal-agent', 'send.legal.notice', 'T2', 'act_with_approval', 'platform.legal.handle', 'email', 'platform_staff'),
  ('people-agent', 'track.onboarding.tasks', 'T1', 'act_autonomously', 'platform.people.handle', NULL, NULL),
  ('people-agent', 'review.access.lists', 'T0', 'act_autonomously', 'platform.people.read', NULL, NULL),
  ('people-agent', 'draft.offboarding.checklist', 'T0', 'act_autonomously', 'platform.people.handle', NULL, NULL),
  ('people-agent', 'schedule.access.review', 'T1', 'act_autonomously', 'platform.people.handle', NULL, NULL),
  ('people-agent', 'request.access.grant', 'T3', 'act_with_approval', 'platform.people.handle', 'iam', 'sheriff'),
  ('investor-agent', 'compile.metrics.pack', 'T0', 'act_autonomously', 'platform.investor.read', NULL, NULL),
  ('investor-agent', 'draft.investor.update', 'T0', 'act_autonomously', 'platform.investor.handle', NULL, NULL),
  ('investor-agent', 'answer.diligence.question', 'T0', 'act_autonomously', 'platform.investor.read', NULL, NULL),
  ('investor-agent', 'maintain.data.room', 'T1', 'act_autonomously', 'platform.investor.handle', NULL, NULL),
  ('investor-agent', 'flag.data.room.gap', 'T1', 'act_autonomously', 'platform.investor.handle', NULL, NULL),
  ('org-support', 'answer.how.to', 'T0', 'act_autonomously', 'ict.support', NULL, NULL),
  ('org-support', 'triage.ticket', 'T0', 'act_autonomously', 'ict.support', NULL, NULL),
  ('org-support', 'draft.ticket.reply', 'T0', 'act_autonomously', 'ict.support', NULL, NULL),
  ('org-support', 'send.ticket.reply', 'T2', 'act_with_approval', 'ict.support', NULL, 'role_owner'),
  ('org-fees', 'flag.arrears', 'T0', 'act_autonomously', 'fees.view', NULL, NULL),
  ('org-fees', 'suggest.matches', 'T0', 'act_autonomously', 'payments.reconcile', NULL, NULL),
  ('org-fees', 'draft.reminder', 'T0', 'act_autonomously', 'fees.view', NULL, NULL),
  ('org-fees', 'send.reminder', 'T2', 'act_with_approval', 'fees.view', NULL, 'role_owner'),
  ('org-fees', 'propose.refund', 'T2', 'propose_only', 'payments.reconcile', NULL, NULL),
  ('org-attendance', 'flag.chronic.absence', 'T0', 'act_autonomously', 'students.view', NULL, NULL),
  ('org-attendance', 'summarise.register', 'T0', 'act_autonomously', 'students.view', NULL, NULL),
  ('org-attendance', 'propose.register.marks', 'T2', 'propose_only', 'attendance.take', NULL, NULL),
  ('org-attendance', 'send.absence.notice', 'T2', 'act_with_approval', 'comms.send_class', NULL, 'role_owner'),
  ('org-report-cards', 'check.missing.scores', 'T0', 'act_autonomously', 'grades.view', NULL, NULL),
  ('org-report-cards', 'draft.comments', 'T0', 'act_autonomously', 'grades.view', NULL, NULL),
  ('org-report-cards', 'compile.report.cards', 'T0', 'act_autonomously', 'grades.view', NULL, NULL),
  ('org-report-cards', 'propose.publish.results', 'T2', 'propose_only', 'grades.view', NULL, NULL),
  ('org-parent-comms', 'draft.newsletter', 'T0', 'act_autonomously', 'news.publish', NULL, NULL),
  ('org-parent-comms', 'draft.announcement', 'T0', 'act_autonomously', 'news.publish', NULL, NULL),
  ('org-parent-comms', 'propose.broadcast', 'T2', 'propose_only', 'news.publish', NULL, NULL),
  ('org-parent-comms', 'publish.news', 'T2', 'act_with_approval', 'news.publish', NULL, 'role_owner'),
  ('org-admissions', 'screen.applications', 'T0', 'act_autonomously', 'admissions.view', NULL, NULL),
  ('org-admissions', 'flag.incomplete', 'T0', 'act_autonomously', 'admissions.view', NULL, NULL),
  ('org-admissions', 'send.applicant.update', 'T2', 'act_with_approval', 'comms.send_class', NULL, 'role_owner'),
  ('org-admissions', 'propose.admission', 'T2', 'propose_only', 'admissions.process', NULL, NULL),
  ('org-timetable', 'detect.clashes', 'T0', 'act_autonomously', 'timetable.view', NULL, NULL),
  ('org-timetable', 'suggest.cover', 'T0', 'act_autonomously', 'timetable.view', NULL, NULL),
  ('org-timetable', 'propose.timetable', 'T2', 'propose_only', 'timetable.manage', NULL, NULL),
  ('org-timetable', 'propose.class.change', 'T2', 'propose_only', 'classes.manage', NULL, NULL),
  ('org-safeguarding', 'screen.concern', 'T0', 'act_autonomously', 'welfare.pastoral', NULL, NULL),
  ('org-safeguarding', 'surface.patterns', 'T0', 'act_autonomously', 'attendance.view', NULL, NULL),
  ('org-safeguarding', 'propose.referral', 'T2', 'propose_only', 'welfare.pastoral', NULL, NULL),
  ('org-transport', 'flag.route.delay', 'T0', 'act_autonomously', 'transport.track', NULL, NULL),
  ('org-transport', 'draft.trip.notice', 'T0', 'act_autonomously', 'transport.manage', NULL, NULL),
  ('org-transport', 'send.trip.notice', 'T2', 'act_with_approval', 'comms.send_class', NULL, 'role_owner'),
  ('org-transport', 'propose.route.change', 'T2', 'propose_only', 'transport.manage', NULL, NULL),
  ('org-proprietor', 'compose.board.pack', 'T0', 'act_autonomously', 'analytics.institution', NULL, NULL),
  ('org-proprietor', 'summarise.finances', 'T0', 'act_autonomously', 'reports.financial', NULL, NULL),
  ('org-proprietor', 'summarise.academics', 'T0', 'act_autonomously', 'reports.academic', NULL, NULL),
  ('org-proprietor', 'flag.kpi.drift', 'T0', 'act_autonomously', 'analytics.institution', NULL, NULL),
  ('org-exams', 'detect.exam.clashes', 'T0', 'act_autonomously', 'exams.schedule', NULL, NULL),
  ('org-exams', 'draft.invigilation.roster', 'T0', 'act_autonomously', 'exams.invigilate', NULL, NULL),
  ('org-exams', 'flag.absentees', 'T0', 'act_autonomously', 'attendance.view', NULL, NULL),
  ('org-exams', 'propose.exam.timetable', 'T2', 'propose_only', 'exams.schedule', NULL, NULL),
  ('org-records', 'find.duplicates', 'T0', 'act_autonomously', 'students.view', NULL, NULL),
  ('org-records', 'flag.record.gaps', 'T0', 'act_autonomously', 'students.view', NULL, NULL),
  ('org-records', 'propose.record.fix', 'T2', 'propose_only', 'students.edit', NULL, NULL),
  ('org-staff-admin', 'summarise.leave', 'T0', 'act_autonomously', 'hr.staff_view', NULL, NULL),
  ('org-staff-admin', 'flag.cover.gaps', 'T0', 'act_autonomously', 'hr.staff_view', NULL, NULL),
  ('org-staff-admin', 'draft.appraisal.notes', 'T0', 'act_autonomously', 'hr.appraisal', NULL, NULL),
  ('org-staff-admin', 'propose.leave.decision', 'T2', 'propose_only', 'hr.leave_approve', NULL, NULL),
  ('org-facilities', 'triage.requests', 'T0', 'act_autonomously', 'works.requests', NULL, NULL),
  ('org-facilities', 'flag.low.stock', 'T0', 'act_autonomously', 'inventory.manage', NULL, NULL),
  ('org-facilities', 'draft.work.order', 'T0', 'act_autonomously', 'works.requests', NULL, NULL),
  ('org-facilities', 'propose.procurement', 'T2', 'propose_only', 'procurement.request', NULL, NULL),
  ('org-learning-support', 'suggest.support.strategies', 'T0', 'act_autonomously', 'students.view', NULL, NULL),
  ('org-learning-support', 'draft.lesson.adaptation', 'T0', 'act_autonomously', 'lesson_notes.submit', NULL, NULL),
  ('org-learning-support', 'send.parent.update', 'T2', 'act_with_approval', 'comms.send_class', NULL, 'role_owner'),
  ('org-compliance', 'track.dsar.deadlines', 'T0', 'act_autonomously', 'ndpa.dsar', NULL, NULL),
  ('org-compliance', 'draft.dsar.response', 'T0', 'act_autonomously', 'ndpa.dsar', NULL, NULL),
  ('org-compliance', 'flag.retention.due', 'T0', 'act_autonomously', 'audit.view', NULL, NULL),
  ('org-compliance', 'propose.breach.notice', 'T2', 'propose_only', 'ndpa.dsar', NULL, NULL),
  ('org-alumni', 'segment.alumni', 'T0', 'act_autonomously', 'alumni.manage', NULL, NULL),
  ('org-alumni', 'draft.alumni.newsletter', 'T0', 'act_autonomously', 'news.publish', NULL, NULL),
  ('org-alumni', 'propose.alumni.broadcast', 'T2', 'propose_only', 'alumni.manage', NULL, NULL),
  ('org-alumni', 'propose.reunion', 'T2', 'propose_only', 'alumni.manage', NULL, NULL);
-- END GENERATED AIN01 SEED

-- BEGIN GENERATED AIN01 TIER CLASSES (scripts/ops/generate-ain01-agent-seed.mjs; do not edit by hand)
INSERT INTO public.wf_agent_tier_action_class (tier, action_class) VALUES
  ('T0', 'internal'),
  ('T0', 'wait'),
  ('T1', 'internal'),
  ('T1', 'wait'),
  ('T1', 'task'),
  ('T1', 'ai_model'),
  ('T1', 'unclassified'),
  ('T2', 'internal'),
  ('T2', 'wait'),
  ('T2', 'task'),
  ('T2', 'ai_model'),
  ('T2', 'unclassified'),
  ('T2', 'communication'),
  ('T3', 'internal'),
  ('T3', 'wait'),
  ('T3', 'task'),
  ('T3', 'ai_model'),
  ('T3', 'unclassified'),
  ('T3', 'communication'),
  ('T3', 'money_movement'),
  ('T3', 'safeguarding'),
  ('T3', 'credential_change'),
  ('T3', 'public_publish'),
  ('T3', 'mass_message'),
  ('T3', 'external_authority_share');
-- END GENERATED AIN01 TIER CLASSES

-- Only platform agents can be granted, only while active.
CREATE FUNCTION public.wf_agent_platform_grant_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'wf_agent_platform_grant: rows are never updated' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wf_agent a
                  WHERE a.agent_ref = NEW.agent_ref AND a.family = 'platform' AND a.status = 'active') THEN
    RAISE EXCEPTION 'ain01:grant_needs_active_platform_agent' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER wf_agent_platform_grant_10_guard BEFORE INSERT OR UPDATE ON public.wf_agent_platform_grant
  FOR EACH ROW EXECUTE FUNCTION public.wf_agent_platform_grant_guard();

CREATE FUNCTION public.wf_agent_platform_grant_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.wf_audit_append(OLD.org_id, 'workflow.agent_grant.revoked', 'wf_agent_platform_grant',
      OLD.org_id::text || ':' || OLD.agent_ref, to_jsonb(OLD), NULL);
  ELSE
    PERFORM public.wf_audit_append(NEW.org_id, 'workflow.agent_grant.granted', 'wf_agent_platform_grant',
      NEW.org_id::text || ':' || NEW.agent_ref, NULL, to_jsonb(NEW));
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER wf_agent_platform_grant_90_audit AFTER INSERT OR DELETE ON public.wf_agent_platform_grant
  FOR EACH ROW EXECUTE FUNCTION public.wf_agent_platform_grant_audit();

-- -----------------------------------------------------------------------------
-- 3. Row level security and privileges
-- -----------------------------------------------------------------------------
ALTER TABLE public.wf_agent ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_agent FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wf_agent_capability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_agent_capability FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wf_agent_tier_action_class ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_agent_tier_action_class FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wf_agent_platform_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_agent_platform_grant FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.wf_agent, public.wf_agent_capability, public.wf_agent_tier_action_class,
  public.wf_agent_platform_grant FROM PUBLIC, anon, authenticated, service_role;
-- Nobody writes these tables at run time: the registry changes through a reviewed migration. Tenants read the
-- registry only through wf_agent_registry_get, which shows their own organization's view.
GRANT SELECT ON public.wf_agent, public.wf_agent_capability, public.wf_agent_tier_action_class,
  public.wf_agent_platform_grant TO service_role;

CREATE POLICY wf_agent_service_read ON public.wf_agent FOR SELECT TO service_role USING (true);
CREATE POLICY wf_agent_capability_service_read ON public.wf_agent_capability FOR SELECT TO service_role USING (true);
CREATE POLICY wf_agent_tier_action_class_service_read ON public.wf_agent_tier_action_class
  FOR SELECT TO service_role USING (true);
CREATE POLICY wf_agent_platform_grant_service_read ON public.wf_agent_platform_grant
  FOR SELECT TO service_role USING (true);

-- -----------------------------------------------------------------------------
-- 4. Rules as functions
-- -----------------------------------------------------------------------------
-- Founder decision 3 (AI route) is open. Replacing this function is a reviewed migration after the decision.
CREATE FUNCTION public.wf_ai_route_approved()
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT false $$;

-- Why an agent may not act in an organization right now, or 'ok'. Fail closed on anything unknown.
--   platform agents: need a grant for the organization and must not be paused (ENGINE-16 pause state)
--   organization agents: must be enabled and not paused in the organization add-on state (ENGINE-20/22). That
--     state lives in objects applied outside this folder, so it is read by name; when they are absent the answer
--     is 'org_state_unavailable', never 'ok'.
CREATE FUNCTION public.wf_agent_state_code(p_org uuid, p_agent text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_agent public.wf_agent%ROWTYPE;
  v_en boolean;
  v_pa boolean;
BEGIN
  SELECT * INTO v_agent FROM public.wf_agent a WHERE a.agent_ref = p_agent;
  IF NOT FOUND OR v_agent.status <> 'active' THEN RETURN 'agent_unknown'; END IF;
  IF v_agent.family = 'platform' THEN
    IF NOT EXISTS (SELECT 1 FROM public.wf_agent_platform_grant g WHERE g.org_id = p_org AND g.agent_ref = p_agent) THEN
      RETURN 'agent_not_granted';
    END IF;
    IF public.is_agent_paused(p_agent) THEN RETURN 'agent_paused'; END IF;
    RETURN 'ok';
  END IF;
  IF to_regclass('public.org_agent_addon_events') IS NULL THEN RETURN 'org_state_unavailable'; END IF;
  BEGIN
    EXECUTE $q$
      SELECT
        coalesce((SELECT e.action = 'enable' FROM public.org_agent_addon_events e
                   WHERE e.org_id = $1 AND e.agent_code = $2 AND e.action IN ('enable', 'disable')
                   ORDER BY e.seq DESC LIMIT 1), false),
        coalesce((SELECT e.action IN ('pause', 'platform_pause') FROM public.org_agent_addon_events e
                   WHERE e.org_id = $1 AND e.agent_code = $2
                     AND e.action IN ('pause', 'resume', 'platform_pause', 'platform_resume')
                   ORDER BY e.seq DESC LIMIT 1), false)
    $q$ INTO v_en, v_pa USING p_org, p_agent;
  EXCEPTION WHEN OTHERS THEN
    RETURN 'org_state_unavailable';
  END;
  IF NOT coalesce(v_en, false) THEN RETURN 'agent_not_enabled'; END IF;
  IF coalesce(v_pa, true) THEN RETURN 'agent_paused'; END IF;
  RETURN 'ok';
END
$$;

CREATE FUNCTION public.wf_agent_class_allowed(p_agent text, p_class text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.wf_agent a
      JOIN public.wf_agent_tier_action_class t ON t.tier = a.max_tier
     WHERE a.agent_ref = p_agent AND t.action_class = p_class);
$$;

-- -----------------------------------------------------------------------------
-- 5. The step guard
-- -----------------------------------------------------------------------------
-- Runs after wf_autonomy_guard (05) and before wf_step_run_guard (10). New steps only: finishing, retrying or
-- cancelling a step that already exists is not blocked by a later pause (the pause stops new work).
-- A replay of an existing idempotency key consumes nothing and is not refused; the caller's ON CONFLICT DO NOTHING
-- returns the existing row.
-- The effective agent is the one wf_autonomy_guard uses: the run's, else the step's, else the template's. It is
-- written onto the step so the daily count (which counts steps by their own agent) and the history agree. A step with no agent is untouched, except that a
-- step of kind 'ai' is refused for everyone while the AI route is undecided.
CREATE FUNCTION public.wf_agent_step_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_run_agent text;
  v_template uuid;
  v_ref text;
  v_state text;
  v_budget integer;
  v_used integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.wf_step_run s
              WHERE s.org_id = NEW.org_id AND s.idempotency_key = NEW.idempotency_key) THEN
    RETURN NEW;
  END IF;
  -- The AI tripwire covers both ways to reach a model: kind 'ai' and the class 'ai_model' (a kind 'action' step
  -- of that class would otherwise reach WF-11 without being an 'ai' step).
  IF (NEW.kind = 'ai' OR NEW.action_class = 'ai_model') AND NOT public.wf_ai_route_approved() THEN
    RAISE EXCEPTION 'ain01:ai_route_undecided' USING ERRCODE = '42501';
  END IF;
  SELECT r.agent_ref, r.template_id INTO v_run_agent, v_template
    FROM public.wf_run r WHERE r.org_id = NEW.org_id AND r.id = NEW.run_id;
  v_ref := coalesce(v_run_agent, NEW.agent_ref);
  IF v_ref IS NULL AND v_template IS NOT NULL THEN
    SELECT t.agent_ref INTO v_ref FROM public.wf_template t WHERE t.id = v_template;
  END IF;
  IF v_ref IS NULL THEN
    RETURN NEW;
  END IF;

  v_state := public.wf_agent_state_code(NEW.org_id, v_ref);
  IF v_state <> 'ok' THEN
    RAISE EXCEPTION 'ain01:%', v_state USING ERRCODE = '42501';
  END IF;
  -- Only steps that act are classified; conditions, waits and approvals carry 'unclassified' by design.
  IF NEW.kind IN ('action', 'notify', 'ai') AND NOT public.wf_agent_class_allowed(v_ref, NEW.action_class) THEN
    RAISE EXCEPTION 'ain01:class_not_allowed' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ain01:agent:' || NEW.org_id::text || ':' || v_ref, 7125));
  SELECT a.daily_actions INTO v_budget FROM public.wf_agent a WHERE a.agent_ref = v_ref;
  SELECT count(*)::integer INTO v_used
    FROM public.wf_step_run s
   WHERE s.org_id = NEW.org_id AND s.agent_ref = v_ref AND s.created_at > now() - interval '24 hours';
  IF v_used + 1 > v_budget THEN
    RAISE EXCEPTION 'ain01:budget_daily_actions' USING ERRCODE = '54000';
  END IF;
  NEW.agent_ref := v_ref;
  RETURN NEW;
END
$$;
CREATE TRIGGER wf_step_run_07_agent BEFORE INSERT ON public.wf_step_run
  FOR EACH ROW EXECUTE FUNCTION public.wf_agent_step_guard();

-- The class, kind and agent of an existing step are fixed at insert. The insert guard classifies the step once;
-- without this a step inserted as 'internal' could be updated to 'money_movement' (a plain UPDATE, or
-- INSERT ... ON CONFLICT (org_id, idempotency_key) DO UPDATE, whose insert half the replay rule lets through).
-- Setting a column to the value it already has is allowed, so a harmless upsert still works.
CREATE FUNCTION public.wf_agent_step_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.action_class IS DISTINCT FROM OLD.action_class
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.agent_ref IS DISTINCT FROM OLD.agent_ref THEN
    RAISE EXCEPTION 'ain01:step_identity_immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER wf_step_run_07_agent_immutable BEFORE UPDATE OF action_class, kind, agent_ref ON public.wf_step_run
  FOR EACH ROW EXECUTE FUNCTION public.wf_agent_step_immutable();

-- -----------------------------------------------------------------------------
-- 6. Read surface for one organization
-- -----------------------------------------------------------------------------
-- Organization agents, plus platform agents granted to this organization. Nothing else: no ungranted platform
-- agent, no other organization's state. The organization comes from the signed-in person, never a parameter.
CREATE FUNCTION public.wf_agent_registry_get(p_actor uuid)
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
    RAISE EXCEPTION 'ain01:not_authorized' USING ERRCODE = '42501';
  END IF;
  v_out := jsonb_build_object(
    'ai_route_approved', public.wf_ai_route_approved(),
    'can_manage', public.wf_can(v_org, 'workflows.manage'),
    'agents', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'agent_ref', a.agent_ref, 'codename', a.codename, 'family', a.family, 'tier', a.agent_tier,
        'accountable', a.accountable, 'supervisor', a.supervisor, 'max_tier', a.max_tier,
        'context_ceiling', a.context_ceiling,
        'budget', jsonb_build_object('daily_actions', a.daily_actions, 'daily_model_calls', a.daily_model_calls,
                                     'daily_cost_cap_minor', a.daily_cost_cap_minor),
        'steps_24h', (SELECT count(*)::integer FROM public.wf_step_run s
                       WHERE s.org_id = v_org AND s.agent_ref = a.agent_ref
                         AND s.created_at > now() - interval '24 hours'),
        'state', public.wf_agent_state_code(v_org, a.agent_ref),
        'effective_autonomy', coalesce((SELECT u.earned_level FROM public.wf_agent_autonomy u
                                         WHERE u.org_id = v_org AND u.agent_ref = a.agent_ref), 'suggest'),
        'action_classes', coalesce((SELECT jsonb_agg(t.action_class ORDER BY t.action_class)
                                      FROM public.wf_agent_tier_action_class t WHERE t.tier = a.max_tier), '[]'::jsonb),
        'capabilities', coalesce((SELECT jsonb_agg(jsonb_build_object(
                                    'id', c.capability_id, 'tier', c.tier, 'autonomy_mode', c.autonomy_mode,
                                    'requires_permission', c.requires_permission, 'connector', c.connector,
                                    'approver', c.approver) ORDER BY c.capability_id)
                                   FROM public.wf_agent_capability c WHERE c.agent_ref = a.agent_ref), '[]'::jsonb)
      ) ORDER BY a.family DESC, a.agent_ref)
      FROM public.wf_agent a
     WHERE a.status = 'active'
       AND (a.family = 'org'
            OR EXISTS (SELECT 1 FROM public.wf_agent_platform_grant g
                        WHERE g.org_id = v_org AND g.agent_ref = a.agent_ref))), '[]'::jsonb));
  PERFORM public.wf_act_restore(v_prev);
  RETURN v_out;
END
$$;

-- -----------------------------------------------------------------------------
-- 7. Privileges
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.wf_ai_route_approved(), public.wf_agent_state_code(uuid, text), public.wf_agent_class_allowed(text, text),
  public.wf_agent_step_guard(), public.wf_agent_step_immutable(), public.wf_agent_capability_guard(), public.wf_agent_platform_grant_guard(),
  public.wf_agent_platform_grant_audit(), public.wf_agent_registry_get(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
-- WF-11 will call the route check from the server; the server reads the registry for a person.
GRANT EXECUTE ON FUNCTION public.wf_ai_route_approved(), public.wf_agent_registry_get(uuid) TO service_role;

COMMENT ON TABLE public.wf_agent IS
  'AIN-01 / ADR-125: engine actors (identity, tier, accountable role, supervisor, daily budget caps). Seeded from the agent packs and charters; changed only by a reviewed migration.';
COMMENT ON TABLE public.wf_agent_capability IS
  'AIN-01 / ADR-125: what each engine actor may do (tier, autonomy mode, permission, connector, approver). No autonomous capability above T1.';
COMMENT ON TABLE public.wf_agent_tier_action_class IS
  'AIN-01 / ADR-125: engine action classes each capability tier may use. Engineering default for the founder to ratify.';
COMMENT ON TABLE public.wf_agent_platform_grant IS
  'AIN-01 / ADR-125: organizations a platform (Sherivs-internal) agent may act in. Empty by default; written only by a reviewed migration until WF-13.';
COMMENT ON FUNCTION public.wf_ai_route_approved() IS
  'AIN-01 / ADR-125: false until founder decision 3 (AI route) is made. While false, no step of kind ai can be created.';
COMMENT ON FUNCTION public.wf_agent_step_guard() IS
  'AIN-01 / ADR-125: fail-closed identity, state, class and daily-budget check for any step with an effective agent.';

COMMIT;
