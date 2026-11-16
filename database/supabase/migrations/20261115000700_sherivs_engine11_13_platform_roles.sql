-- ENGINE-11 and ENGINE-13 (ADR-089, ADR-091): platform roles for the 18 remaining internal workforce agents.
-- Adopts database/proposals/ENGINE-11_workforce_roles.sql and ENGINE-13_workforce_roles.sql unchanged.
-- None of these roles is privileged; each grants only the read/handle strings its Role Pack names. Idempotent.

INSERT INTO public.platform_roles (code, label, description, capabilities, is_privileged, sort_order) VALUES
  ('compliance', 'Compliance', 'Data-protection requests, retention and incident assessment.',
     ARRAY['platform.compliance.read', 'platform.compliance.handle'], false, 80),
  ('reliability', 'Reliability', 'Incident response and status communication.',
     ARRAY['platform.reliability.read', 'platform.reliability.handle'], false, 90),
  ('customer_success', 'Customer success', 'Tenant adoption, onboarding and check-ins.',
     ARRAY['platform.success.read', 'platform.success.handle'], false, 100),
  ('finops', 'Revenue assurance', 'Usage, cost and collections follow-up.',
     ARRAY['platform.finops.read', 'platform.finops.handle'], false, 110),
  ('audit', 'Audit', 'Independent, read-only review of ledgers, approvals and agent behaviour.',
     ARRAY['platform.audit.read'], false, 120),
  ('knowledge', 'Knowledge', 'Runbooks, decisions and sourced answers.',
     ARRAY['platform.knowledge.read', 'platform.knowledge.handle'], false, 130),
  ('product', 'Product intelligence', 'Feedback and usage synthesis for product decisions.',
     ARRAY['platform.product.read', 'platform.product.handle'], false, 140),
  ('market', 'Market intelligence', 'Competitor and policy watch.',
     ARRAY['platform.market.read', 'platform.market.handle'], false, 150)
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description,
  capabilities = EXCLUDED.capabilities, is_privileged = EXCLUDED.is_privileged,
  sort_order = EXCLUDED.sort_order;

INSERT INTO public.platform_roles (code, label, description, capabilities, is_privileged, sort_order) VALUES
  ('onboarding', 'Onboarding', 'Organization setup plans, import dry-runs and training plans.',
     ARRAY['platform.onboarding.read', 'platform.onboarding.handle'], false, 160),
  ('safeguarding', 'Safeguarding', 'Screening and routing of child safeguarding reports to the designated lead.',
     ARRAY['platform.safeguarding.read', 'platform.safeguarding.handle'], false, 170),
  ('qa', 'Quality assurance', 'Independent change review, regression runs and release notes.',
     ARRAY['platform.qa.read', 'platform.qa.handle'], false, 180),
  ('evaluation', 'Evaluation', 'Synthetic evaluation and red-team testing of the agent workforce.',
     ARRAY['platform.audit.read'], false, 190),
  ('marketing', 'Marketing', 'Content research, drafting and approved publishing.',
     ARRAY['platform.marketing.read', 'platform.marketing.handle'], false, 200),
  ('localisation', 'Localisation', 'Draft translations for native-speaker review.',
     ARRAY['platform.localisation.read', 'platform.localisation.handle'], false, 210),
  ('data', 'Data', 'Metric definitions, aggregates and the weekly briefing.',
     ARRAY['platform.data.read', 'platform.data.handle'], false, 220),
  ('legal', 'Legal', 'Contract drafting from approved templates and obligation tracking.',
     ARRAY['platform.legal.read', 'platform.legal.handle'], false, 230),
  ('people', 'People', 'Staff onboarding, offboarding and access reviews.',
     ARRAY['platform.people.read', 'platform.people.handle'], false, 240),
  ('investor', 'Investor relations', 'Investor metrics, updates and data-room upkeep.',
     ARRAY['platform.investor.read', 'platform.investor.handle'], false, 250)
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description,
  capabilities = EXCLUDED.capabilities, is_privileged = EXCLUDED.is_privileged,
  sort_order = EXCLUDED.sort_order;
