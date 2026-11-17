-- APPLIED TO PRODUCTION 2026-11-16 (project nwrflbpbhyiqdptmlccm) at the founder's instruction (190 rows, 25 agents).
-- ENGINE-13 (ADR-091): database-side agent workspace scopes.
-- The code-side check is authorizeScope in frontend/src/lib/workforce-charter/workspace.ts.
-- This proposal gives the database the same rules so a bug in an agent, a tool or a
-- prompt cannot widen what an agent reads. Apply on staging first with the matching
-- rollback below. A test keeps the seed in step with the workspace definitions.
--
-- Rules, all deny-by-default:
--  * An agent may use a resource only if a row in agent_workspace_scopes lists it.
--  * Writes and proposals are limited to the agent's own rows. There is no delete mode.
--  * An organization's rows are read only under a time-boxed agent grant that is tied to a
--    human's support grant and is no longer than the scope's grant_max_minutes.
--  * Tables are readable by audit staff and writable only by the service role.


CREATE TABLE IF NOT EXISTS public.agent_workspace_scopes (
  agent_code        text NOT NULL CHECK (agent_code ~ '^[a-z][a-z0-9-]{1,60}$'),
  resource          text NOT NULL CHECK (resource ~ '^[a-z][a-z0-9_-]{1,59}$'),
  access            text NOT NULL CHECK (access IN ('read', 'write_own', 'propose')),
  row_scope         text NOT NULL CHECK (row_scope IN
    ('platform', 'tenant_metadata', 'aggregate', 'tenant_with_grant', 'tenant_flagged', 'own_agent')),
  sensitivity       text NOT NULL CHECK (sensitivity IN ('public', 'internal', 'restricted')),
  grant_max_minutes integer CHECK (grant_max_minutes BETWEEN 1 AND 240),
  PRIMARY KEY (agent_code, resource),
  CONSTRAINT agent_scope_grant_only_with_grant CHECK
    ((row_scope = 'tenant_with_grant') = (grant_max_minutes IS NOT NULL)),
  CONSTRAINT agent_scope_write_own_rows_only CHECK
    (access = 'read' OR row_scope = 'own_agent'),
  CONSTRAINT agent_scope_tenant_rows_read_only CHECK
    (row_scope NOT IN ('tenant_with_grant', 'tenant_flagged') OR access = 'read'),
  CONSTRAINT agent_scope_aggregate_not_restricted CHECK
    (row_scope NOT IN ('tenant_metadata', 'aggregate') OR sensitivity <> 'restricted')
);

-- One row per time-boxed grant of an organization's rows to an agent. It borrows a human's
-- support grant: it is valid only while that grant is active and never outlives the scope's limit.
CREATE TABLE IF NOT EXISTS public.agent_tenant_grants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_code        text NOT NULL CHECK (agent_code ~ '^[a-z][a-z0-9-]{1,60}$'),
  resource          text NOT NULL,
  tenant_id         uuid NOT NULL,
  support_grant_id  uuid NOT NULL REFERENCES public.platform_support_grants(id) ON DELETE CASCADE,
  starts_at         timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  revoked_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agent_code, resource) REFERENCES public.agent_workspace_scopes (agent_code, resource),
  CONSTRAINT agent_tenant_grants_window CHECK
    (expires_at > starts_at AND expires_at <= starts_at + interval '240 minutes')
);
CREATE INDEX IF NOT EXISTS agent_tenant_grants_active_idx
  ON public.agent_tenant_grants (agent_code, resource, tenant_id, expires_at) WHERE revoked_at IS NULL;

-- True only when the agent's scope is tenant_with_grant, an unrevoked and unexpired agent grant
-- exists for the organization, the grant is no longer than the scope allows, and the human
-- support grant it borrows is still active. Anything else is false.
CREATE OR REPLACE FUNCTION public.agent_may_read_tenant(p_agent text, p_resource text, p_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.agent_workspace_scopes s
      JOIN public.agent_tenant_grants g
        ON g.agent_code = s.agent_code AND g.resource = s.resource
      JOIN public.platform_support_grants h ON h.id = g.support_grant_id
     WHERE s.agent_code = p_agent AND s.resource = p_resource
       AND s.access = 'read' AND s.row_scope = 'tenant_with_grant'
       AND g.tenant_id = p_tenant AND h.tenant_id = p_tenant
       AND g.revoked_at IS NULL AND h.revoked_at IS NULL
       AND now() >= g.starts_at AND now() < g.expires_at
       AND now() >= h.starts_at AND now() < h.expires_at
       AND g.expires_at - g.starts_at <= make_interval(mins => s.grant_max_minutes));
$$;
REVOKE ALL ON FUNCTION public.agent_may_read_tenant(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_may_read_tenant(text, text, uuid) TO service_role;

ALTER TABLE public.agent_workspace_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_workspace_scopes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tenant_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tenant_grants FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agent_workspace_scopes, public.agent_tenant_grants
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.agent_workspace_scopes, public.agent_tenant_grants TO authenticated;
GRANT ALL ON TABLE public.agent_workspace_scopes, public.agent_tenant_grants TO service_role;

DROP POLICY IF EXISTS agent_workspace_scopes_audit_read ON public.agent_workspace_scopes;
CREATE POLICY agent_workspace_scopes_audit_read ON public.agent_workspace_scopes
  FOR SELECT TO authenticated
  USING ((SELECT public.has_platform_capability('platform.audit.read')));

DROP POLICY IF EXISTS agent_tenant_grants_audit_read ON public.agent_tenant_grants;
CREATE POLICY agent_tenant_grants_audit_read ON public.agent_tenant_grants
  FOR SELECT TO authenticated
  USING ((SELECT public.has_platform_capability('platform.audit.read')));

-- Seed generated from the workspace definitions; a test keeps the two in step.
INSERT INTO public.agent_workspace_scopes
  (agent_code, resource, access, row_scope, sensitivity, grant_max_minutes) VALUES
  ('jarvis-executive', 'agent_runs', 'write_own', 'own_agent', 'internal', NULL),
  ('jarvis-executive', 'agent_memory', 'write_own', 'own_agent', 'internal', NULL),
  ('jarvis-executive', 'agent_proposals', 'propose', 'own_agent', 'internal', NULL),
  ('jarvis-executive', 'workforce_runs', 'read', 'platform', 'internal', NULL),
  ('jarvis-executive', 'approvals_inbox', 'read', 'platform', 'internal', NULL),
  ('jarvis-executive', 'tool_ledger', 'read', 'platform', 'internal', NULL),
  ('jarvis-executive', 'incident_log', 'read', 'platform', 'internal', NULL),
  ('jarvis-executive', 'audit_log', 'read', 'platform', 'internal', NULL),
  ('jarvis-executive', 'tenant_registry', 'read', 'tenant_metadata', 'internal', NULL),
  ('jarvis-executive', 'platform_metrics', 'read', 'aggregate', 'internal', NULL),
  ('jarvis-executive', 'work_orders', 'write_own', 'own_agent', 'internal', NULL),
  ('jarvis-executive', 'owner_alerts', 'write_own', 'own_agent', 'internal', NULL),
  ('support-agent', 'agent_runs', 'write_own', 'own_agent', 'internal', NULL),
  ('support-agent', 'agent_memory', 'write_own', 'own_agent', 'internal', NULL),
  ('support-agent', 'agent_proposals', 'propose', 'own_agent', 'internal', NULL),
  ('support-agent', 'tenant_registry', 'read', 'tenant_metadata', 'internal', NULL),
  ('support-agent', 'support_tickets', 'read', 'tenant_with_grant', 'internal', 60),
  ('support-agent', 'knowledge_base', 'read', 'platform', 'internal', NULL),
  ('support-agent', 'work_orders', 'write_own', 'own_agent', 'internal', NULL),
  ('engineering-agent', 'agent_runs', 'write_own', 'own_agent', 'internal', NULL),
  ('engineering-agent', 'agent_memory', 'write_own', 'own_agent', 'internal', NULL),
  ('engineering-agent', 'agent_proposals', 'propose', 'own_agent', 'internal', NULL),
  ('engineering-agent', 'code_repository', 'read', 'platform', 'internal', NULL),
  ('engineering-agent', 'ci_runs', 'read', 'platform', 'internal', NULL),
  ('engineering-agent', 'incident_log', 'read', 'platform', 'internal', NULL),
  ('engineering-agent', 'work_orders', 'write_own', 'own_agent', 'internal', NULL),
  ('security-agent', 'agent_runs', 'write_own', 'own_agent', 'internal', NULL),
  ('security-agent', 'agent_memory', 'write_own', 'own_agent', 'internal', NULL),
  ('security-agent', 'agent_proposals', 'propose', 'own_agent', 'internal', NULL),
  ('security-agent', 'security_signals', 'read', 'platform', 'internal', NULL),
  ('security-agent', 'audit_log', 'read', 'platform', 'internal', NULL),
  ('security-agent', 'tool_ledger', 'read', 'platform', 'internal', NULL),
  ('security-agent', 'worker_registry', 'read', 'platform', 'internal', NULL),
  ('security-agent', 'work_orders', 'write_own', 'own_agent', 'internal', NULL),
  ('security-agent', 'security_cases', 'write_own', 'own_agent', 'internal', NULL),
  ('finance-agent', 'agent_runs', 'write_own', 'own_agent', 'internal', NULL),
  ('finance-agent', 'agent_memory', 'write_own', 'own_agent', 'internal', NULL),
  ('finance-agent', 'agent_proposals', 'propose', 'own_agent', 'internal', NULL),
  ('finance-agent', 'billing_records', 'read', 'tenant_metadata', 'internal', NULL),
  ('finance-agent', 'invoices', 'read', 'tenant_metadata', 'internal', NULL),
  ('finance-agent', 'payments_ledger', 'read', 'platform', 'internal', NULL),
  ('finance-agent', 'finance_cases', 'write_own', 'own_agent', 'internal', NULL),
  ('finance-agent', 'work_orders', 'write_own', 'own_agent', 'internal', NULL),
  ('sales-agent', 'agent_runs', 'write_own', 'own_agent', 'internal', NULL),
  ('sales-agent', 'agent_memory', 'write_own', 'own_agent', 'internal', NULL),
  ('sales-agent', 'agent_proposals', 'propose', 'own_agent', 'internal', NULL),
  ('sales-agent', 'crm_leads', 'read', 'platform', 'internal', NULL),
  ('sales-agent', 'crm_updates', 'write_own', 'own_agent', 'internal', NULL),
  ('sales-agent', 'tenant_registry', 'read', 'tenant_metadata', 'internal', NULL),
  ('sales-agent', 'work_orders', 'write_own', 'own_agent', 'internal', NULL),
  ('operations-agent', 'agent_runs', 'write_own', 'own_agent', 'internal', NULL),
  ('operations-agent', 'agent_memory', 'write_own', 'own_agent', 'internal', NULL),
  ('operations-agent', 'agent_proposals', 'propose', 'own_agent', 'internal', NULL),
  ('operations-agent', 'platform_health', 'read', 'platform', 'internal', NULL),
  ('operations-agent', 'incident_log', 'read', 'platform', 'internal', NULL),
  ('operations-agent', 'tenant_registry', 'read', 'tenant_metadata', 'internal', NULL),
  ('operations-agent', 'maintenance_calendar', 'write_own', 'own_agent', 'internal', NULL),
  ('operations-agent', 'work_orders', 'write_own', 'own_agent', 'internal', NULL),
  ('compliance-agent', 'agent_runs', 'write_own', 'own_agent', 'internal', NULL),
  ('compliance-agent', 'agent_memory', 'write_own', 'own_agent', 'internal', NULL),
  ('compliance-agent', 'agent_proposals', 'propose', 'own_agent', 'internal', NULL),
  ('compliance-agent', 'data_requests', 'read', 'tenant_with_grant', 'restricted', 120),
  ('compliance-agent', 'retention_register', 'read', 'platform', 'internal', NULL),
  ('compliance-agent', 'personal_data_incidents', 'read', 'platform', 'restricted', NULL),
  ('compliance-agent', 'compliance_register', 'write_own', 'own_agent', 'restricted', NULL),
  ('reliability-agent', 'agent_runs', 'write_own', 'own_agent', 'internal', NULL),
  ('reliability-agent', 'agent_memory', 'write_own', 'own_agent', 'internal', NULL),
  ('reliability-agent', 'agent_proposals', 'propose', 'own_agent', 'internal', NULL),
  ('reliability-agent', 'platform_health', 'read', 'platform', 'internal', NULL),
  ('reliability-agent', 'incident_log', 'read', 'platform', 'internal', NULL),
  ('reliability-agent', 'knowledge_base', 'read', 'platform', 'internal', NULL),
  ('reliability-agent', 'incident_records', 'write_own', 'own_agent', 'internal', NULL),
  ('reliability-agent', 'work_orders', 'write_own', 'own_agent', 'internal', NULL),
  ('customer-success-agent', 'agent_runs', 'write_own', 'own_agent', 'internal', NULL),
  ('customer-success-agent', 'agent_memory', 'write_own', 'own_agent', 'internal', NULL),
  ('customer-success-agent', 'agent_proposals', 'propose', 'own_agent', 'internal', NULL),
  ('customer-success-agent', 'usage_metrics', 'read', 'aggregate', 'internal', NULL),
  ('customer-success-agent', 'ticket_stats', 'read', 'aggregate', 'internal', NULL),
  ('customer-success-agent', 'tenant_registry', 'read', 'tenant_metadata', 'internal', NULL),
  ('customer-success-agent', 'setup_plans', 'read', 'platform', 'internal', NULL),
  ('customer-success-agent', 'success_cases', 'write_own', 'own_agent', 'internal', NULL),
  ('customer-success-agent', 'work_orders', 'write_own', 'own_agent', 'internal', NULL),
  ('revenue-assurance-agent', 'agent_runs', 'write_own', 'own_agent', 'internal', NULL),
  ('revenue-assurance-agent', 'agent_memory', 'write_own', 'own_agent', 'internal', NULL),
  ('revenue-assurance-agent', 'agent_proposals', 'propose', 'own_agent', 'internal', NULL),
  ('revenue-assurance-agent', 'billing_records', 'read', 'tenant_metadata', 'internal', NULL),
  ('revenue-assurance-agent', 'invoices', 'read', 'tenant_metadata', 'internal', NULL),
  ('revenue-assurance-agent', 'usage_costs', 'read', 'aggregate', 'internal', NULL),
  ('revenue-assurance-agent', 'collections_log', 'write_own', 'own_agent', 'internal', NULL),
  ('revenue-assurance-agent', 'work_orders', 'write_own', 'own_agent', 'internal', NULL),
  ('sentinel-agent', 'agent_runs', 'write_own', 'own_agent', 'internal', NULL),
  ('sentinel-agent', 'agent_memory', 'write_own', 'own_agent', 'internal', NULL),
  ('sentinel-agent', 'agent_proposals', 'propose', 'own_agent', 'internal', NULL),
  ('sentinel-agent', 'tool_ledger', 'read', 'platform', 'internal', NULL),
  ('sentinel-agent', 'approvals_inbox', 'read', 'platform', 'internal', NULL),
  ('sentinel-agent', 'audit_log', 'read', 'platform', 'internal', NULL),
  ('sentinel-agent', 'workforce_runs', 'read', 'platform', 'internal', NULL),
  ('sentinel-agent', 'agent_charters', 'read', 'platform', 'internal', NULL),
  ('sentinel-agent', 'audit_findings', 'write_own', 'own_agent', 'internal', NULL),
  ('archivist-agent', 'agent_runs', 'write_own', 'own_agent', 'internal', NULL),
  ('archivist-agent', 'agent_memory', 'write_own', 'own_agent', 'internal', NULL),
  ('archivist-agent', 'agent_proposals', 'propose', 'own_agent', 'internal', NULL),
  ('archivist-agent', 'knowledge_base', 'read', 'platform', 'internal', NULL),
  ('archivist-agent', 'incident_postmortems', 'read', 'platform', 'internal', NULL),
  ('archivist-agent', 'knowledge_entries', 'write_own', 'own_agent', 'internal', NULL),
  ('archivist-agent', 'work_orders', 'write_own', 'own_agent', 'internal', NULL),
  ('product-intelligence-agent', 'agent_runs', 'write_own', 'own_agent', 'internal', NULL),
  ('product-intelligence-agent', 'agent_memory', 'write_own', 'own_agent', 'internal', NULL),
  ('product-intelligence-agent', 'agent_proposals', 'propose', 'own_agent', 'internal', NULL),
  ('product-intelligence-agent', 'feedback_summaries', 'read', 'aggregate', 'internal', NULL),
  ('product-intelligence-agent', 'usage_metrics', 'read', 'aggregate', 'internal', NULL),
  ('product-intelligence-agent', 'product_insights', 'write_own', 'own_agent', 'internal', NULL),
  ('market-intelligence-agent', 'agent_runs', 'write_own', 'own_agent', 'internal', NULL),
  ('market-intelligence-agent', 'agent_memory', 'write_own', 'own_agent', 'internal', NULL),
  ('market-intelligence-agent', 'agent_proposals', 'propose', 'own_agent', 'internal', NULL),
  ('market-intelligence-agent', 'public_sources', 'read', 'platform', 'public', NULL),
  ('market-intelligence-agent', 'market_notes', 'write_own', 'own_agent', 'public', NULL),
  ('onboarding-agent', 'agent_runs', 'write_own', 'own_agent', 'internal', NULL),
  ('onboarding-agent', 'agent_memory', 'write_own', 'own_agent', 'internal', NULL),
  ('onboarding-agent', 'agent_proposals', 'propose', 'own_agent', 'internal', NULL),
  ('onboarding-agent', 'tenant_registry', 'read', 'tenant_metadata', 'internal', NULL),
  ('onboarding-agent', 'import_headers', 'read', 'tenant_metadata', 'internal', NULL),
  ('onboarding-agent', 'setup_plans', 'write_own', 'own_agent', 'internal', NULL),
  ('onboarding-agent', 'import_reports', 'write_own', 'own_agent', 'internal', NULL),
  ('onboarding-agent', 'work_orders', 'write_own', 'own_agent', 'internal', NULL),
  ('safeguarding-agent', 'agent_runs', 'write_own', 'own_agent', 'internal', NULL),
  ('safeguarding-agent', 'agent_memory', 'write_own', 'own_agent', 'internal', NULL),
  ('safeguarding-agent', 'agent_proposals', 'propose', 'own_agent', 'internal', NULL),
  ('safeguarding-agent', 'safeguarding_reports', 'read', 'tenant_flagged', 'restricted', NULL),
  ('safeguarding-agent', 'safeguarding_cases', 'write_own', 'own_agent', 'restricted', NULL),
  ('safeguarding-agent', 'work_orders', 'write_own', 'own_agent', 'internal', NULL),
  ('qa-agent', 'agent_runs', 'write_own', 'own_agent', 'internal', NULL),
  ('qa-agent', 'agent_memory', 'write_own', 'own_agent', 'internal', NULL),
  ('qa-agent', 'agent_proposals', 'propose', 'own_agent', 'internal', NULL),
  ('qa-agent', 'ci_runs', 'read', 'platform', 'internal', NULL),
  ('qa-agent', 'code_repository', 'read', 'platform', 'internal', NULL),
  ('qa-agent', 'release_pipeline', 'read', 'platform', 'internal', NULL),
  ('qa-agent', 'test_results', 'write_own', 'own_agent', 'internal', NULL),
  ('qa-agent', 'work_orders', 'write_own', 'own_agent', 'internal', NULL),
  ('evaluation-agent', 'agent_runs', 'write_own', 'own_agent', 'internal', NULL),
  ('evaluation-agent', 'agent_memory', 'write_own', 'own_agent', 'internal', NULL),
  ('evaluation-agent', 'agent_proposals', 'propose', 'own_agent', 'internal', NULL),
  ('evaluation-agent', 'agent_charters', 'read', 'platform', 'internal', NULL),
  ('evaluation-agent', 'eval_suites', 'read', 'platform', 'internal', NULL),
  ('evaluation-agent', 'workforce_runs', 'read', 'platform', 'internal', NULL),
  ('evaluation-agent', 'eval_results', 'write_own', 'own_agent', 'internal', NULL),
  ('marketing-agent', 'agent_runs', 'write_own', 'own_agent', 'internal', NULL),
  ('marketing-agent', 'agent_memory', 'write_own', 'own_agent', 'internal', NULL),
  ('marketing-agent', 'agent_proposals', 'propose', 'own_agent', 'internal', NULL),
  ('marketing-agent', 'brand_guide', 'read', 'platform', 'public', NULL),
  ('marketing-agent', 'public_sources', 'read', 'platform', 'public', NULL),
  ('marketing-agent', 'subscriber_segments', 'read', 'aggregate', 'internal', NULL),
  ('marketing-agent', 'content_calendar', 'write_own', 'own_agent', 'internal', NULL),
  ('marketing-agent', 'work_orders', 'write_own', 'own_agent', 'internal', NULL),
  ('localisation-agent', 'agent_runs', 'write_own', 'own_agent', 'internal', NULL),
  ('localisation-agent', 'agent_memory', 'write_own', 'own_agent', 'internal', NULL),
  ('localisation-agent', 'agent_proposals', 'propose', 'own_agent', 'internal', NULL),
  ('localisation-agent', 'glossary', 'read', 'platform', 'internal', NULL),
  ('localisation-agent', 'string_catalogue', 'read', 'platform', 'internal', NULL),
  ('localisation-agent', 'translations', 'write_own', 'own_agent', 'internal', NULL),
  ('localisation-agent', 'work_orders', 'write_own', 'own_agent', 'internal', NULL),
  ('data-agent', 'agent_runs', 'write_own', 'own_agent', 'internal', NULL),
  ('data-agent', 'agent_memory', 'write_own', 'own_agent', 'internal', NULL),
  ('data-agent', 'agent_proposals', 'propose', 'own_agent', 'internal', NULL),
  ('data-agent', 'metric_definitions', 'read', 'platform', 'internal', NULL),
  ('data-agent', 'aggregates', 'read', 'aggregate', 'internal', NULL),
  ('data-agent', 'metrics_store', 'write_own', 'own_agent', 'internal', NULL),
  ('data-agent', 'work_orders', 'write_own', 'own_agent', 'internal', NULL),
  ('legal-agent', 'agent_runs', 'write_own', 'own_agent', 'internal', NULL),
  ('legal-agent', 'agent_memory', 'write_own', 'own_agent', 'internal', NULL),
  ('legal-agent', 'agent_proposals', 'propose', 'own_agent', 'internal', NULL),
  ('legal-agent', 'contract_register', 'read', 'platform', 'internal', NULL),
  ('legal-agent', 'contract_templates', 'read', 'platform', 'internal', NULL),
  ('legal-agent', 'contract_drafts', 'write_own', 'own_agent', 'internal', NULL),
  ('legal-agent', 'obligations', 'write_own', 'own_agent', 'internal', NULL),
  ('legal-agent', 'work_orders', 'write_own', 'own_agent', 'internal', NULL),
  ('people-agent', 'agent_runs', 'write_own', 'own_agent', 'internal', NULL),
  ('people-agent', 'agent_memory', 'write_own', 'own_agent', 'internal', NULL),
  ('people-agent', 'agent_proposals', 'propose', 'own_agent', 'internal', NULL),
  ('people-agent', 'staff_register', 'read', 'platform', 'internal', NULL),
  ('people-agent', 'access_lists', 'read', 'platform', 'internal', NULL),
  ('people-agent', 'access_reviews', 'write_own', 'own_agent', 'internal', NULL),
  ('people-agent', 'work_orders', 'write_own', 'own_agent', 'internal', NULL),
  ('investor-agent', 'agent_runs', 'write_own', 'own_agent', 'internal', NULL),
  ('investor-agent', 'agent_memory', 'write_own', 'own_agent', 'internal', NULL),
  ('investor-agent', 'agent_proposals', 'propose', 'own_agent', 'internal', NULL),
  ('investor-agent', 'investor_metrics', 'read', 'aggregate', 'internal', NULL),
  ('investor-agent', 'metric_definitions', 'read', 'platform', 'internal', NULL),
  ('investor-agent', 'data_room_index', 'write_own', 'own_agent', 'internal', NULL),
  ('investor-agent', 'work_orders', 'write_own', 'own_agent', 'internal', NULL)
ON CONFLICT (agent_code, resource) DO UPDATE SET access = EXCLUDED.access,
  row_scope = EXCLUDED.row_scope, sensitivity = EXCLUDED.sensitivity,
  grant_max_minutes = EXCLUDED.grant_max_minutes;
