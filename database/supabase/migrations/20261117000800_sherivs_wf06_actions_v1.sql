-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.
-- WF-06: V1 workflow action catalogue and tenant-scoped drafts/outbox.
-- Effects remain disabled unless the application delivery gate explicitly permits them.
--
-- Mass communication threshold: WORKFLOW_MASS_RECIPIENT_THRESHOLD = 25 (the same named constant
-- lives in frontend/src/lib/workflow/workflow-actions.ts). More than 25 recipients, or any
-- audience selector, is mass communication and is capped at draft.
-- Data classes (WORKFLOW_DATA_CLASSES in TS): public, internal, confidential, minor_sensitive.
-- Only public and internal may ever reach the executed (sandbox outbox) record.
BEGIN;

DO $prereq$
BEGIN
  IF to_regclass('public.wf_definition') IS NULL
     OR to_regclass('public.wf_version') IS NULL
     OR to_regclass('public.wf_run') IS NULL
     OR to_regclass('public.wf_step_run') IS NULL
     OR to_regclass('public.wf_org_settings') IS NULL
     OR to_regclass('public.wf_template') IS NULL
     OR to_regclass('public.wf_agent_autonomy') IS NULL
     OR to_regclass('public.organization_memberships') IS NULL
     OR to_regprocedure('public.wf_can(uuid,text)') IS NULL
     OR to_regprocedure('public.wf_autonomy_guard()') IS NULL
     OR to_regclass('public.cg_tool_registry') IS NULL
     OR to_regclass('public.cg_tool_call_ledger') IS NULL THEN
    RAISE EXCEPTION 'WF-06: WF-01 through WF-05 or ENGINE-03 prerequisites are missing';
  END IF;
  IF to_regclass('public.wf_action_type') IS NOT NULL
     OR to_regclass('public.wf_action_template') IS NOT NULL
     OR to_regclass('public.wf_action_draft') IS NOT NULL
     OR to_regclass('public.wf_action_sandbox_outbox') IS NOT NULL
     OR to_regclass('public.wf_webhook_target') IS NOT NULL THEN
    RAISE EXCEPTION 'WF-06: one or more WF-06 objects already exist';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.cg_tool_registry
     WHERE tool_id IN (
       'workflow.action.email', 'workflow.action.whatsapp', 'workflow.action.sms',
       'workflow.action.in_app', 'workflow.action.task', 'workflow.action.wait',
       'workflow.action.webhook'
     )
       AND enabled
  ) THEN
    RAISE EXCEPTION 'WF-06: an action tool is already enabled before this migration';
  END IF;
END
$prereq$;

INSERT INTO public.cg_tool_registry
  (tool_id, version, title, connector, direction, effect, tier, idempotent, max_calls_per_hour, platform_only)
VALUES
  ('workflow.action.email', '1.0.0', 'Workflow email action', 'email', 'write', 'customer_visible', 'T2', true, 100, false),
  ('workflow.action.whatsapp', '1.0.0', 'Workflow WhatsApp action', 'whatsapp', 'write', 'customer_visible', 'T2', true, 100, false),
  ('workflow.action.sms', '1.0.0', 'Workflow SMS action', 'sms', 'write', 'customer_visible', 'T2', true, 100, false),
  ('workflow.action.in_app', '1.0.0', 'Workflow in-app action', 'in-app', 'write', 'internal_state', 'T1', true, 120, false),
  ('workflow.action.task', '1.0.0', 'Workflow task action', 'workflow-task', 'write', 'internal_state', 'T1', true, 120, false),
  ('workflow.action.wait', '1.0.0', 'Workflow wait action', 'workflow-wait', 'write', 'internal_state', 'T1', true, 120, false),
  ('workflow.action.webhook', '1.0.0', 'Workflow registered webhook action', 'http-webhook', 'write', 'customer_visible', 'T2', true, 60, false)
ON CONFLICT (tool_id, version) DO UPDATE SET enabled = true;

DO $tools$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM (VALUES
        ('workflow.action.email', '1.0.0', 'Workflow email action', 'email', 'customer_visible', 'T2', 100),
        ('workflow.action.whatsapp', '1.0.0', 'Workflow WhatsApp action', 'whatsapp', 'customer_visible', 'T2', 100),
        ('workflow.action.sms', '1.0.0', 'Workflow SMS action', 'sms', 'customer_visible', 'T2', 100),
        ('workflow.action.in_app', '1.0.0', 'Workflow in-app action', 'in-app', 'internal_state', 'T1', 120),
        ('workflow.action.task', '1.0.0', 'Workflow task action', 'workflow-task', 'internal_state', 'T1', 120),
        ('workflow.action.wait', '1.0.0', 'Workflow wait action', 'workflow-wait', 'internal_state', 'T1', 120),
        ('workflow.action.webhook', '1.0.0', 'Workflow registered webhook action', 'http-webhook', 'customer_visible', 'T2', 60)
      ) AS expected(tool_id, version, title, connector, effect, tier, max_calls_per_hour)
      LEFT JOIN public.cg_tool_registry registry USING (tool_id, version)
     WHERE registry.tool_id IS NULL
        OR registry.title IS DISTINCT FROM expected.title
        OR registry.connector IS DISTINCT FROM expected.connector
        OR registry.direction IS DISTINCT FROM 'write'
        OR registry.effect IS DISTINCT FROM expected.effect
        OR registry.tier IS DISTINCT FROM expected.tier
        OR registry.idempotent IS DISTINCT FROM true
        OR registry.max_calls_per_hour IS DISTINCT FROM expected.max_calls_per_hour
        OR registry.platform_only IS DISTINCT FROM false
        OR registry.enabled IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'WF-06: workflow action broker tool registry rows conflict with the expected catalogue';
  END IF;
END
$tools$;

CREATE TABLE public.wf_action_type (
  kind             text PRIMARY KEY CHECK (kind IN ('email', 'in_app', 'whatsapp', 'sms', 'task', 'wait', 'webhook')),
  category         text NOT NULL CHECK (category ~ '^[a-z][a-z0-9_]{1,63}$'),
  broker_tool_id   text,
  broker_version   text,
  effect           text NOT NULL CHECK (effect IN ('none', 'internal_state', 'customer_visible', 'money')),
  max_autonomy     text NOT NULL CHECK (max_autonomy IN ('suggest', 'draft', 'act_with_approval', 'act_and_report')),
  CONSTRAINT wf_action_type_cap_check CHECK (
    category NOT IN (
      'money_movement', 'safeguarding', 'credential_change', 'public_publish',
      'mass_message', 'external_authority_share'
    ) OR max_autonomy = 'draft'
  ),
  CONSTRAINT wf_action_type_money_check CHECK (effect <> 'money' OR max_autonomy = 'draft'),
  CONSTRAINT wf_action_type_broker_pair CHECK ((broker_tool_id IS NULL) = (broker_version IS NULL)),
  CONSTRAINT wf_action_type_broker_fk FOREIGN KEY (broker_tool_id, broker_version)
    REFERENCES public.cg_tool_registry (tool_id, version) ON DELETE RESTRICT
);

INSERT INTO public.wf_action_type (kind, category, broker_tool_id, broker_version, effect, max_autonomy)
VALUES
  ('email', 'communication', 'workflow.action.email', '1.0.0', 'customer_visible', 'act_and_report'),
  ('in_app', 'communication', 'workflow.action.in_app', '1.0.0', 'internal_state', 'act_and_report'),
  ('whatsapp', 'communication', 'workflow.action.whatsapp', '1.0.0', 'customer_visible', 'act_and_report'),
  ('sms', 'communication', 'workflow.action.sms', '1.0.0', 'customer_visible', 'act_and_report'),
  ('task', 'internal', 'workflow.action.task', '1.0.0', 'internal_state', 'act_and_report'),
  ('wait', 'internal', 'workflow.action.wait', '1.0.0', 'internal_state', 'act_and_report'),
  ('webhook', 'communication', 'workflow.action.webhook', '1.0.0', 'customer_visible', 'act_and_report');

CREATE TABLE public.wf_action_template (
  org_id          uuid NOT NULL REFERENCES public.wf_org_settings(org_id) ON DELETE RESTRICT,
  kind            text NOT NULL CHECK (kind = 'in_app'),
  template_ref    text NOT NULL CHECK (template_ref ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$'),
  body_template   text NOT NULL CHECK (length(body_template) BETWEEN 1 AND 4000),
  parameter_keys  text[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(parameter_keys) <= 32 AND array_position(parameter_keys, '') IS NULL),
  status          text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'retired')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, kind, template_ref)
);

CREATE OR REPLACE FUNCTION public.wf_autonomy_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_run public.wf_run%ROWTYPE;
  v_template_level text := 'suggest';
  v_tenant_level text := 'draft';
  v_agent_level text := 'suggest';
  v_agent_ref text;
  v_template_agent_ref text;
  v_rank integer;
BEGIN
  SELECT * INTO v_run FROM public.wf_run
   WHERE org_id = NEW.org_id AND id = NEW.run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wf_step_run: run scope is missing' USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.agent_ref IS DISTINCT FROM OLD.agent_ref THEN
    RAISE EXCEPTION 'wf_step_run: agent identity is immutable' USING ERRCODE = '42501';
  END IF;
  IF v_run.agent_ref IS NOT NULL AND NEW.agent_ref IS NOT NULL
     AND v_run.agent_ref IS DISTINCT FROM NEW.agent_ref THEN
    RAISE EXCEPTION 'wf_step_run: agent does not match run' USING ERRCODE = '42501';
  END IF;
  v_agent_ref := coalesce(v_run.agent_ref, NEW.agent_ref);

  IF v_run.template_id IS NOT NULL THEN
    SELECT t.autonomy_max, t.agent_ref INTO v_template_level, v_template_agent_ref
      FROM public.wf_template t WHERE t.id = v_run.template_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'wf_step_run: template is missing' USING ERRCODE = '23503';
    END IF;
    IF v_agent_ref IS NULL THEN v_agent_ref := v_template_agent_ref; END IF;
  END IF;

  SELECT s.autonomy_ceiling INTO v_tenant_level
    FROM public.wf_org_settings s WHERE s.org_id = NEW.org_id;
  v_tenant_level := coalesce(v_tenant_level, 'draft');
  IF v_agent_ref IS NOT NULL THEN
    SELECT a.earned_level INTO v_agent_level
      FROM public.wf_agent_autonomy a
     WHERE a.org_id = NEW.org_id AND a.agent_ref = v_agent_ref;
    v_agent_level := coalesce(v_agent_level, 'suggest');
  END IF;

  v_rank := least(
    CASE v_template_level WHEN 'suggest' THEN 0 WHEN 'draft' THEN 1
      WHEN 'act_with_approval' THEN 2 ELSE 3 END,
    CASE v_tenant_level WHEN 'suggest' THEN 0 WHEN 'draft' THEN 1
      WHEN 'act_with_approval' THEN 2 ELSE 3 END,
    CASE v_agent_level WHEN 'suggest' THEN 0 WHEN 'draft' THEN 1
      WHEN 'act_with_approval' THEN 2 ELSE 3 END
  );
  IF NEW.action_class NOT IN ('internal', 'communication', 'task', 'wait')
     OR NEW.action_class IN (
       'money_movement', 'safeguarding', 'credential_change', 'public_publish',
       'mass_message', 'external_authority_share'
     ) THEN
    v_rank := least(v_rank, 1);
  END IF;
  NEW.autonomy_level := CASE v_rank WHEN 0 THEN 'suggest' WHEN 1 THEN 'draft'
    WHEN 2 THEN 'act_with_approval' ELSE 'act_and_report' END;
  RETURN NEW;
END
$$;

CREATE TABLE public.wf_action_draft (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  run_id          uuid NOT NULL,
  step_run_id     uuid NOT NULL,
  kind            text NOT NULL REFERENCES public.wf_action_type(kind) ON DELETE RESTRICT,
  category        text NOT NULL CHECK (category ~ '^[a-z][a-z0-9_]{1,63}$'),
  template_ref    text CHECK (
    template_ref IS NULL OR template_ref ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$'
  ),
  template_params jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(template_params) = 'object'
    AND pg_column_size(template_params) <= 4096
    AND NOT (template_params ?| ARRAY['body', 'message', 'text', 'html', 'subject', 'to', 'email', 'phone', 'url'])
  ),
  recipient_ids   uuid[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(recipient_ids) <= 500 AND array_position(recipient_ids, NULL) IS NULL),
  audience_selector text CHECK (
    audience_selector IS NULL OR audience_selector IN ('whole_class', 'all_guardians', 'all_staff')
  ),
  data_class      text NOT NULL DEFAULT 'internal'
    CHECK (data_class IN ('public', 'internal', 'confidential', 'minor_sensitive')),
  status          text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'rejected', 'expired')),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wf_action_draft_run_fk FOREIGN KEY (org_id, run_id)
    REFERENCES public.wf_run (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT wf_action_draft_step_fk FOREIGN KEY (org_id, step_run_id)
    REFERENCES public.wf_step_run (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT wf_action_draft_org_id_uniq UNIQUE (org_id, id),
  CONSTRAINT wf_action_draft_idempotency_uniq UNIQUE (org_id, idempotency_key),
  CONSTRAINT wf_action_draft_cap_check CHECK (
    category NOT IN (
      'money_movement', 'safeguarding', 'credential_change', 'public_publish',
      'mass_message', 'external_authority_share', 'unregistered_webhook'
    ) OR status <> 'approved'
  ),
  -- Mass (> WORKFLOW_MASS_RECIPIENT_THRESHOLD = 25 recipients, or any audience selector) or
  -- confidential drafts must carry a capped category, so they can never be approved.
  CONSTRAINT wf_action_draft_mass_confidential_check CHECK (
    category IN (
      'money_movement', 'safeguarding', 'credential_change', 'public_publish',
      'mass_message', 'external_authority_share', 'unregistered_webhook'
    )
    OR (
      cardinality(recipient_ids) <= 25
      AND audience_selector IS NULL
      AND data_class IN ('public', 'internal')
    )
  ),
  CONSTRAINT wf_action_draft_template_check CHECK (
    kind IN ('webhook', 'task', 'wait') OR template_ref IS NOT NULL
  )
);
CREATE INDEX wf_action_draft_run_idx ON public.wf_action_draft (org_id, run_id, created_at DESC);

CREATE TABLE public.wf_action_sandbox_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  run_id          uuid NOT NULL,
  step_run_id     uuid NOT NULL,
  kind            text NOT NULL REFERENCES public.wf_action_type(kind) ON DELETE RESTRICT,
  category        text NOT NULL CHECK (category ~ '^[a-z][a-z0-9_]{1,63}$'),
  template_ref    text CHECK (
    template_ref IS NULL OR template_ref ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$'
  ),
  template_params jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(template_params) = 'object'
    AND pg_column_size(template_params) <= 4096
    AND NOT (template_params ?| ARRAY['body', 'message', 'text', 'html', 'subject', 'to', 'email', 'phone', 'url'])
  ),
  recipient_ids   uuid[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(recipient_ids) <= 500 AND array_position(recipient_ids, NULL) IS NULL),
  audience_selector text CHECK (
    audience_selector IS NULL OR audience_selector IN ('whole_class', 'all_guardians', 'all_staff')
  ),
  data_class      text NOT NULL DEFAULT 'internal'
    CHECK (data_class IN ('public', 'internal', 'confidential', 'minor_sensitive')),
  broker_decision_id uuid NOT NULL REFERENCES public.cg_tool_call_ledger(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wf_action_sandbox_run_fk FOREIGN KEY (org_id, run_id)
    REFERENCES public.wf_run (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT wf_action_sandbox_step_fk FOREIGN KEY (org_id, step_run_id)
    REFERENCES public.wf_step_run (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT wf_action_sandbox_idempotency_uniq UNIQUE (org_id, idempotency_key),
  -- The executed record never carries a capped category (defence in depth for the TS caps).
  CONSTRAINT wf_action_sandbox_cap_check CHECK (
    category NOT IN (
      'money_movement', 'safeguarding', 'credential_change', 'public_publish',
      'mass_message', 'external_authority_share', 'unregistered_webhook'
    )
  ),
  -- Mass communication (> WORKFLOW_MASS_RECIPIENT_THRESHOLD = 25, or any audience selector)
  -- never executes.
  CONSTRAINT wf_action_sandbox_mass_check CHECK (
    cardinality(recipient_ids) <= 25 AND audience_selector IS NULL
  ),
  -- Confidential or minor-sensitive data never executes.
  CONSTRAINT wf_action_sandbox_data_class_check CHECK (data_class IN ('public', 'internal'))
);

-- An executed record must point at an `execute` broker decision of the same tenant, for the
-- action's own tool and idempotency key.
CREATE OR REPLACE FUNCTION public.wf_action_sandbox_outbox_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.cg_tool_call_ledger l
     WHERE l.id = NEW.broker_decision_id
       AND l.kind = 'decision'
       AND l.verdict = 'execute'
       AND l.tenant_ref = NEW.org_id::text
       AND l.tool_id = 'workflow.action.' || NEW.kind
       AND l.idempotency_key = NEW.idempotency_key
  ) THEN
    RAISE EXCEPTION 'wf_action_sandbox_outbox: broker decision does not clear this action'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.wf_action_sandbox_outbox_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER wf_action_sandbox_outbox_00_guard
  BEFORE INSERT OR UPDATE ON public.wf_action_sandbox_outbox
  FOR EACH ROW EXECUTE FUNCTION public.wf_action_sandbox_outbox_guard();

CREATE TABLE public.wf_webhook_target (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.wf_org_settings(org_id) ON DELETE RESTRICT,
  target_url  text NOT NULL CHECK (length(target_url) BETWEEN 9 AND 2048),
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wf_webhook_target_org_url_uniq UNIQUE (org_id, target_url)
);
ALTER TABLE public.wf_action_draft
  ADD COLUMN   webhook_target_id uuid;
ALTER TABLE public.wf_action_sandbox_outbox
  ADD COLUMN webhook_target_id uuid;
ALTER TABLE public.wf_webhook_target
  ADD CONSTRAINT wf_webhook_target_org_id_uniq UNIQUE (org_id, id);
ALTER TABLE public.wf_action_draft
  ADD CONSTRAINT wf_action_draft_webhook_org_fk
  FOREIGN KEY (org_id, webhook_target_id)
  REFERENCES public.wf_webhook_target (org_id, id) ON DELETE RESTRICT;
ALTER TABLE public.wf_action_sandbox_outbox
  ADD CONSTRAINT wf_action_sandbox_webhook_org_fk
  FOREIGN KEY (org_id, webhook_target_id)
  REFERENCES public.wf_webhook_target (org_id, id) ON DELETE RESTRICT;

ALTER TABLE public.wf_action_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_action_type FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wf_action_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_action_template FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wf_action_draft ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_action_draft FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wf_action_sandbox_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_action_sandbox_outbox FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wf_webhook_target ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_webhook_target FORCE ROW LEVEL SECURITY;

CREATE POLICY wf_action_type_authenticated_read ON public.wf_action_type
  FOR SELECT TO authenticated USING (true);
CREATE POLICY wf_action_type_service_read ON public.wf_action_type
  FOR SELECT TO service_role USING (true);
CREATE POLICY wf_action_template_member_read ON public.wf_action_template
  FOR SELECT TO authenticated USING (public.wf_can(org_id, 'workflows.view'));
CREATE POLICY wf_action_template_service ON public.wf_action_template
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY wf_action_draft_member_read ON public.wf_action_draft
  FOR SELECT TO authenticated USING (public.wf_can(org_id, 'workflows.view'));
CREATE POLICY wf_action_draft_service ON public.wf_action_draft
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY wf_action_sandbox_service ON public.wf_action_sandbox_outbox
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY wf_webhook_target_service ON public.wf_webhook_target
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.wf_action_type, public.wf_action_template, public.wf_action_draft,
  public.wf_action_sandbox_outbox, public.wf_webhook_target
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.wf_action_type TO authenticated, service_role;
GRANT SELECT ON TABLE public.wf_action_template TO authenticated, service_role;
GRANT SELECT ON TABLE public.wf_action_draft TO authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.wf_action_draft TO service_role;
GRANT INSERT, UPDATE ON TABLE public.wf_action_template TO service_role;
GRANT INSERT, SELECT ON TABLE public.wf_action_sandbox_outbox TO service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.wf_webhook_target TO service_role;

COMMENT ON TABLE public.wf_action_type IS
  'WF-06 / ADR-116: versioned workflow action kinds, broker tool bindings and maximum autonomy.';
COMMENT ON TABLE public.wf_action_template IS
  'WF-06 / ADR-116: service-managed in-app templates; only approved references may be used by actions.';
COMMENT ON TABLE public.wf_action_draft IS
  'WF-06 / ADR-116: tenant-scoped approval drafts. Contains template references and parameters, never rendered message text or recipient addresses.';
COMMENT ON TABLE public.wf_action_sandbox_outbox IS
  'WF-06 / ADR-116: service-only simulated deliveries. Rows are never dispatched to a provider.';

COMMIT;
