-- Rollback for 20261022000200_sherivs_013_payments_audit_entitlements.sql (NOT APPLIED).
-- WARNING: dropping audit_chain destroys the tamper-evident history; export it first.
BEGIN;
DROP FUNCTION IF EXISTS public.meter_consume(uuid, text, text, text, bigint, bigint);
DROP TABLE IF EXISTS public.entitlement_overrides, public.usage_alerts, public.usage_counters,
  public.org_entitlements, public.entitlement_plan_quotas, public.entitlement_plans;
DROP TABLE IF EXISTS public.audit_chain_anchors, public.audit_chain;
DROP FUNCTION IF EXISTS public.audit_chain_link_guard(), public.audit_chain_append_only();
DROP TABLE IF EXISTS public.payment_intents;
DROP FUNCTION IF EXISTS public.payment_intent_binding_guard();
DROP TABLE IF EXISTS public.org_payment_subaccounts;
COMMIT;
