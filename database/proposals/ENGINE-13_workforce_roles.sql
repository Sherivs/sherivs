-- PROPOSAL ONLY. NOT APPLIED. NOT IN THE MIGRATIONS DIRECTORY.
-- ENGINE-13 (ADR-091): platform roles for the ten remaining workforce agents.
-- Owner must review, then apply on staging first through the normal migration process
-- with a matching rollback. Role codes follow the platform_roles check (lower-case letters
-- and underscores). None of these roles is privileged. The evaluation role reuses the
-- read-only audit permission. The people role can only ask for access: granting access is a
-- sheriff decision with a passkey and is not a capability of any role here.

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

-- Rollback (for the migration that adopts this proposal):
-- DELETE FROM public.platform_roles WHERE code IN ('onboarding', 'safeguarding', 'qa', 'evaluation', 'marketing', 'localisation', 'data', 'legal', 'people', 'investor');
