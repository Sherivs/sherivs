-- ENT-01: subscription authorization. An organization administrator must not be able to promote their own organization.
-- Status: AUTHORED, NOT APPLIED. Do not apply this file to production from the pull request.
-- ADR-071. Rollback: database/supabase/rollbacks/20261104051000_sherivs_ent01_subscription_authorization.sql
-- Tests: tests/integration/ent-01-subscription-authorization.local.sql, frontend/src/lib/subscription-tiers.parity.test.ts
--
-- What this closes (each reproduced on a database built from the repository migrations before this change):
--  1. Row-level security let an administrator update their own organization row without a column restriction, and the client
--     roles hold column privileges on the commercial columns. One update of subscription_tier from trial to enterprise
--     succeeded, and the entitlement trigger then granted the enterprise plan (sms, whatsapp, ai, voice, codegen).
--     The same update could change subscription_status, subscription_expires_at, monthly_fee, max_students and max_teachers.
--  2. The tier column default was enterprise, so every organization created through the self-serve path started on the top plan.
--  3. The tier-to-plan mapping had no row for trial, so a trial organization silently received the starter plan, and the
--     starter plan carried the sms feature with a 500 per month quota. The application catalog says trial and starter have no sms.
--  4. Commercial changes were not audited.
--
-- Not changed: any existing organization (tier, status, expiry, price and limits are not rewritten), prices, wallet rules (FIN-01),
-- message dispatch and the decision to refuse a send for a plan without sms (COMMS-03 wires its send path to the function added here).
--
-- Apply order: after 20261104050000. Re-applying this file is safe.
-- No top-level BEGIN or COMMIT: the migration runner wraps each file in its own transaction.

-- ============ 1. New organizations start in trial ============
-- Column default only: existing rows keep their tier.
ALTER TABLE public.schools ALTER COLUMN subscription_tier SET DEFAULT 'trial';

-- ============ 2. Only trusted paths may change commercial columns ============
-- Who may change them: the platform's server code (service_role), SECURITY DEFINER functions owned by the platform, the database
-- owner (migrations), and a platform super administrator. A client session (authenticated or anon) that is not a super
-- administrator may not, whatever the row-level policy admits. Everything else about the organization row stays editable by its
-- administrator exactly as before.
-- The check uses current_user (the role the statement runs as), not a request claim, so it cannot be supplied by the caller.
-- This is a SECURITY INVOKER trigger function on purpose: inside a SECURITY DEFINER function current_user is the function owner.
CREATE OR REPLACE FUNCTION public.schools_guard_commercial_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Column defaults: tier trial, status active, 100 students, 10 teachers, no expiry, no price.
    IF NEW.subscription_tier IS DISTINCT FROM 'trial'
       OR NEW.subscription_status IS DISTINCT FROM 'active'
       OR NEW.subscription_expires_at IS NOT NULL
       OR NEW.monthly_fee IS NOT NULL
       OR NEW.max_students IS DISTINCT FROM 100
       OR NEW.max_teachers IS DISTINCT FROM 10 THEN
      RAISE EXCEPTION 'subscription fields are managed by the platform' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.subscription_tier IS DISTINCT FROM OLD.subscription_tier
     OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
     OR NEW.subscription_expires_at IS DISTINCT FROM OLD.subscription_expires_at
     OR NEW.monthly_fee IS DISTINCT FROM OLD.monthly_fee
     OR NEW.max_students IS DISTINCT FROM OLD.max_students
     OR NEW.max_teachers IS DISTINCT FROM OLD.max_teachers THEN
    RAISE EXCEPTION 'subscription fields are managed by the platform' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.schools_guard_commercial_columns() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_schools_guard_commercial ON public.schools;
CREATE TRIGGER trg_schools_guard_commercial
  BEFORE INSERT OR UPDATE ON public.schools
  FOR EACH ROW EXECUTE FUNCTION public.schools_guard_commercial_columns();

-- ============ 3. Audit every commercial change ============
-- One row per change to a commercial column, written by the platform (definer). The record holds the commercial columns only, plus
-- who acted and under which database role; no other organization data.
CREATE OR REPLACE FUNCTION public.schools_audit_commercial_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.audit_logs (school_id, user_id, action, table_name, record_id, old_value, new_value)
  VALUES (
    NEW.id,
    (SELECT u.id FROM public.users u WHERE u.id = auth.uid()),
    'subscription.change',
    'schools',
    NEW.id,
    jsonb_build_object(
      'subscription_tier', OLD.subscription_tier, 'subscription_status', OLD.subscription_status,
      'subscription_expires_at', OLD.subscription_expires_at, 'monthly_fee', OLD.monthly_fee,
      'max_students', OLD.max_students, 'max_teachers', OLD.max_teachers),
    jsonb_build_object(
      'subscription_tier', NEW.subscription_tier, 'subscription_status', NEW.subscription_status,
      'subscription_expires_at', NEW.subscription_expires_at, 'monthly_fee', NEW.monthly_fee,
      'max_students', NEW.max_students, 'max_teachers', NEW.max_teachers,
      'actor', auth.uid(), 'via_role', nullif(current_setting('role', true), 'none'))
  );
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.schools_audit_commercial_change() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_schools_audit_commercial ON public.schools;
CREATE TRIGGER trg_schools_audit_commercial
  AFTER UPDATE OF subscription_tier, subscription_status, subscription_expires_at, monthly_fee, max_students, max_teachers
  ON public.schools
  FOR EACH ROW
  WHEN ((OLD.subscription_tier, OLD.subscription_status, OLD.subscription_expires_at, OLD.monthly_fee, OLD.max_students, OLD.max_teachers)
        IS DISTINCT FROM
        (NEW.subscription_tier, NEW.subscription_status, NEW.subscription_expires_at, NEW.monthly_fee, NEW.max_students, NEW.max_teachers))
  EXECUTE FUNCTION public.schools_audit_commercial_change();

-- ============ 4. Plan catalog: trial exists, trial and starter have no paid sms ============
-- Trial is a real plan, not a silent fallback to starter. Quotas other than sms are copied from starter and remain placeholders
-- until the owner confirms the commercial numbers (as the existing catalog states).
INSERT INTO public.entitlement_plans (id, features) VALUES ('trial', ARRAY['core'])
ON CONFLICT (id) DO UPDATE SET features = EXCLUDED.features;

UPDATE public.entitlement_plans SET features = array_remove(features, 'sms') WHERE id = 'starter';

INSERT INTO public.entitlement_plan_quotas (plan_id, meter, quota, period)
SELECT 'trial', q.meter, CASE WHEN q.meter = 'sms' THEN 0 ELSE q.quota END, q.period
  FROM public.entitlement_plan_quotas q WHERE q.plan_id = 'starter'
ON CONFLICT (plan_id, meter) DO UPDATE SET quota = EXCLUDED.quota, period = EXCLUDED.period;

UPDATE public.entitlement_plan_quotas SET quota = 0 WHERE plan_id IN ('trial', 'starter') AND meter = 'sms';

INSERT INTO public.subscription_tier_plans (tier, plan_id) VALUES ('trial', 'trial')
ON CONFLICT (tier) DO UPDATE SET plan_id = EXCLUDED.plan_id;

-- Re-derive organization entitlements from the (unchanged) tiers. This writes org_entitlements only; schools rows are not touched.
-- Only an organization whose tier is trial changes plan (starter to trial); every other organization maps to the plan it had.
SELECT public.sync_org_entitlements_from_tier(NULL);

-- ============ 5. Authoritative SMS entitlement in the database ============
-- One definition, derived from the same catalog that org_entitlements is derived from: a tier is entitled to paid sms when its plan
-- carries the sms feature and a positive sms quota. A tier with no mapping, or no tier, is not entitled (fails closed).
-- The application catalog (frontend/src/lib/subscription-tiers.ts) must agree; frontend/src/lib/subscription-tiers.parity.test.ts
-- fails the build if the two drift.
CREATE OR REPLACE FUNCTION public.tier_sms_entitled(p_tier text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT 'sms' = ANY (p.features) AND coalesce(q.quota, 0) > 0
       FROM public.subscription_tier_plans m
       JOIN public.entitlement_plans p ON p.id = m.plan_id
       LEFT JOIN public.entitlement_plan_quotas q ON q.plan_id = p.id AND q.meter = 'sms'
      WHERE m.tier = lower(btrim(coalesce(p_tier, 'trial')))),
    false)
$$;

-- Whether an organization may send paid sms, from its tier as stored on the organization row (not from a client-supplied value).
CREATE OR REPLACE FUNCTION public.sms_plan_entitled(p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.tier_sms_entitled((SELECT s.subscription_tier FROM public.schools s WHERE s.id = p_org))
$$;

REVOKE ALL ON FUNCTION public.tier_sms_entitled(text), public.sms_plan_entitled(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tier_sms_entitled(text), public.sms_plan_entitled(uuid) TO service_role;
