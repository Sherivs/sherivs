-- Published packs are immutable and undeletable; the guard allows only published -> retired.
-- Retire these 18 first. Remove the roles with database/supabase/rollbacks/20261115000700_*.sql afterwards
-- (it fails while any staff member still holds one of them, which is intended).
UPDATE public.cg_role_pack SET status='retired'
 WHERE version='1.0.0' AND status='published'
   AND code IN ('compliance-agent','reliability-agent','customer-success-agent','revenue-assurance-agent','sentinel-agent','archivist-agent','product-intelligence-agent','market-intelligence-agent','onboarding-agent','safeguarding-agent','qa-agent','evaluation-agent','marketing-agent','localisation-agent','data-agent','legal-agent','people-agent','investor-agent');
