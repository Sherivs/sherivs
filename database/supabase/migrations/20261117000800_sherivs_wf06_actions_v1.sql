-- WF-06: V1 workflow action catalogue and tenant-scoped drafts/outbox.
-- Effects remain disabled unless the application delivery gate explicitly permits them.
BEGIN;

DO $prereq$
BEGIN
  IF to_regclass('public.wf_definition') IS NULL
     OR to_regclass('public.wf_version') IS NULL
     OR to_regclass('public.wf_run') IS NULL
     OR to_regclass('public.wf_step_run') IS NULL
     OR to_regclass('public.wf_org_settings') IS NULL
     OR to_regclass('public.wf_template') IS NULL
     OR to_regprocedure('public.wf_can(uuid,text)') IS NULL
     OR to_regclass('public.cg_tool_registry') IS NULL
     OR to_regclass('public.cg_tool_call_ledger') IS NULL THEN
    RAISE EXCEPTION 'WF-06: WF-01 through WF-05 or ENGINE-03 prerequisites are missing';
  END IF;
  IF to_regclass('public.wf_action_type') IS NOT NULL
     OR to_regclass('public.wf_action_draft') IS NOT NULL
     OR to_regclass('public.wf_action_sandbox_outbox') IS NOT NULL
     OR to_regclass('public.wf_webhook_target') IS NOT NULL THEN
    RAISE EXCEPTION 'WF-06: one or more WF-06 objects already exist';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.cg_tool_registry
     WHERE tool_id IN (
       'workflow.action.email', 'workflow.action.whatsapp', 'workflow.action.sms',
       'workflow.action.in_app', 'workflow.action.webhook'
     )
  ) THEN
    RAISE EXCEPTION 'WF-06: a workflow action tool is already registered';
  END IF;
END
$prereq$;

INSERT INTO public.cg_tool_registry
  (tool_id, version, title, connector, direction, effect, tier, idempotent, max_calls_per_hour, platform_only)
VALUES
  ('workflow.action.email', '1.0.0', 'Workflow email action', 'email', 'write', 'customer_visible', 'T2', true, 100, false),
  ('workflow.action.whatsapp', '1.0.0', 'Workflow WhatsApp action', 'whatsapp', 'write', 'customer_visible', 'T2', true, 100, false),
  ('workflow.action.sms', '1.0.0', 'Workflow SMS action', 'sms', 'write', 'customer_visible', 'T2', true, 100, false),
  ('workflow.action.in_app', '1.0.0', 'Workflow in-app action', 'in_app', 'write', 'internal_state', 'T1', true, 120, false),
  ('workflow.action.webhook', '1.0.0', 'Workflow registered webhook action', 'http-webhook', 'write', 'customer_visible', 'T2', true, 60, false);

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
  ('task', 'internal', NULL, NULL, 'internal_state', 'act_and_report'),
  ('wait', 'internal', NULL, NULL, 'none', 'act_and_report'),
  ('webhook', 'communication', 'workflow.action.webhook', '1.0.0', 'customer_visible', 'act_and_report');

CREATE TABLE public.wf_action_draft (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  run_id          uuid NOT NULL,
  step_run_id     uuid NOT NULL,
  kind            text NOT NULL REFERENCES public.wf_action_type(kind) ON DELETE RESTRICT,
  category        text NOT NULL CHECK (category ~ '^[a-z][a-z0-9_]{1,63}$'),
  template_ref    text NOT NULL CHECK (template_ref ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$'),
  template_params jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(template_params) = 'object'
    AND pg_column_size(template_params) <= 4096
    AND NOT (template_params ?| ARRAY['body', 'message', 'text', 'html', 'subject', 'to', 'email', 'phone', 'url'])
  ),
  recipient_ids   uuid[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(recipient_ids) <= 500 AND array_position(recipient_ids, NULL) IS NULL),
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
      'mass_message', 'external_authority_share'
    ) OR status <> 'approved'
  )
);
CREATE INDEX wf_action_draft_run_idx ON public.wf_action_draft (org_id, run_id, created_at DESC);

CREATE TABLE public.wf_action_sandbox_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  run_id          uuid NOT NULL,
  step_run_id     uuid NOT NULL,
  kind            text NOT NULL REFERENCES public.wf_action_type(kind) ON DELETE RESTRICT,
  template_ref    text NOT NULL CHECK (template_ref ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$'),
  template_params jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(template_params) = 'object'
    AND pg_column_size(template_params) <= 4096
    AND NOT (template_params ?| ARRAY['body', 'message', 'text', 'html', 'subject', 'to', 'email', 'phone', 'url'])
  ),
  recipient_ids   uuid[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(recipient_ids) <= 500 AND array_position(recipient_ids, NULL) IS NULL),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wf_action_sandbox_run_fk FOREIGN KEY (org_id, run_id)
    REFERENCES public.wf_run (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT wf_action_sandbox_step_fk FOREIGN KEY (org_id, step_run_id)
    REFERENCES public.wf_step_run (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT wf_action_sandbox_idempotency_uniq UNIQUE (org_id, idempotency_key)
);

CREATE TABLE public.wf_webhook_target (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.wf_org_settings(org_id) ON DELETE RESTRICT,
  target_url  text NOT NULL CHECK (length(target_url) BETWEEN 9 AND 2048),
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wf_webhook_target_org_url_uniq UNIQUE (org_id, target_url)
);

ALTER TABLE public.wf_action_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_action_type FORCE ROW LEVEL SECURITY;
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
CREATE POLICY wf_action_draft_member_read ON public.wf_action_draft
  FOR SELECT TO authenticated USING (public.wf_can(org_id, 'workflows.view'));
CREATE POLICY wf_action_draft_service ON public.wf_action_draft
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY wf_action_sandbox_service ON public.wf_action_sandbox_outbox
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY wf_webhook_target_service ON public.wf_webhook_target
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.wf_action_type, public.wf_action_draft,
  public.wf_action_sandbox_outbox, public.wf_webhook_target
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.wf_action_type TO authenticated, service_role;
GRANT SELECT ON TABLE public.wf_action_draft TO authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.wf_action_draft TO service_role;
GRANT INSERT, SELECT ON TABLE public.wf_action_sandbox_outbox TO service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.wf_webhook_target TO service_role;

COMMENT ON TABLE public.wf_action_type IS
  'WF-06 / ADR-116: versioned workflow action kinds, broker tool bindings and maximum autonomy.';
COMMENT ON TABLE public.wf_action_draft IS
  'WF-06 / ADR-116: tenant-scoped approval drafts. Contains template references and parameters, never rendered message text or recipient addresses.';
COMMENT ON TABLE public.wf_action_sandbox_outbox IS
  'WF-06 / ADR-116: service-only simulated deliveries. Rows are never dispatched to a provider.';

COMMIT;
