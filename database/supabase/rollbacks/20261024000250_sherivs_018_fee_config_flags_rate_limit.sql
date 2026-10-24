-- Rollback SHERIVS-018. Audit rows already written stay (append-only).
BEGIN;
DROP TRIGGER IF EXISTS trg_schools_onboarding_rate_limit ON public.schools;
DROP FUNCTION IF EXISTS public.schools_onboarding_rate_limit();
DROP FUNCTION IF EXISTS public.rate_limit_take(text, text, int, interval);
DROP TABLE IF EXISTS public.rate_limit_events;
DROP FUNCTION IF EXISTS public.flag_set(text, uuid, boolean);
DROP FUNCTION IF EXISTS public.flag_on(text, uuid);
DROP TABLE IF EXISTS public.feature_flags;
DROP FUNCTION IF EXISTS public.feature_flags_guard();
DROP FUNCTION IF EXISTS public.set_payment_fee_config(uuid, jsonb);
DROP FUNCTION IF EXISTS public.paystack_fee(uuid, numeric, text);
DROP TABLE IF EXISTS public.payment_fee_config;
DROP FUNCTION IF EXISTS public.platform_config_audit();
DROP FUNCTION IF EXISTS public.scholar_can(uuid, text);
DROP FUNCTION IF EXISTS public.scholar_audit();
COMMIT;
