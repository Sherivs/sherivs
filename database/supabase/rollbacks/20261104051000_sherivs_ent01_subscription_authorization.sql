-- Rollback ENT-01 subscription authorization (20261104051000).
-- Restores the previous schema behavior. Read before running:
--  * Restoring the old column default makes NEW organizations start in enterprise again, and removing the guard lets a school
--    administrator change their own organization's tier again. Run this only to back out a faulty release, not as a routine step.
--  * It never rewrites an organization's tier, status, expiry, fee or limits. Organization entitlements are re-derived from tiers.
--  * Audit records already written (action 'subscription.change') are kept.
DROP TRIGGER IF EXISTS trg_schools_guard_commercial ON public.schools;
DROP TRIGGER IF EXISTS trg_schools_audit_commercial ON public.schools;
DROP FUNCTION IF EXISTS public.schools_guard_commercial_columns();
DROP FUNCTION IF EXISTS public.schools_audit_commercial_change();
DROP FUNCTION IF EXISTS public.sms_plan_entitled(uuid);
DROP FUNCTION IF EXISTS public.tier_sms_entitled(text);

ALTER TABLE public.schools ALTER COLUMN subscription_tier SET DEFAULT 'enterprise';

-- Catalog back to the previous shape: no trial mapping (trial falls back to starter), starter carries sms with its 500 per month quota.
DELETE FROM public.subscription_tier_plans WHERE tier = 'trial';
SELECT public.sync_org_entitlements_from_tier(NULL);
UPDATE public.entitlement_plans SET features = ARRAY['core', 'sms'] WHERE id = 'starter';
UPDATE public.entitlement_plan_quotas SET quota = 500 WHERE plan_id = 'starter' AND meter = 'sms';
DELETE FROM public.entitlement_plan_quotas WHERE plan_id = 'trial';
DELETE FROM public.entitlement_plans WHERE id = 'trial';
