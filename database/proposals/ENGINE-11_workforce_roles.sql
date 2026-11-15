-- APPLIED TO PRODUCTION 2026-11-15 as migration 20261115000700_sherivs_engine11_13_platform_roles. Kept as the review record.
-- ENGINE-11 (ADR-089): platform roles for the eight additional workforce agents.
-- Owner must review, then apply on staging first through the normal migration process
-- with a matching rollback. Role codes follow the platform_roles check (lower-case letters
-- and underscores). None of these roles is privileged and none grants a write capability
-- beyond the handling permission named in its Role Pack.

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

-- Rollback (for the migration that adopts this proposal):
-- DELETE FROM public.platform_roles WHERE code IN ('compliance', 'reliability', 'customer_success', 'finops', 'audit', 'knowledge', 'product', 'market');
