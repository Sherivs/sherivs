-- Rolls back PSA-01. Accrued 'pending' share rows are left in student_platform_fee_ledger: they are the
-- rows the checkout and cash paths already create, and removing them would change collection state.
DROP FUNCTION IF EXISTS public.platform_share_student_list(uuid, text, text, integer);
DROP FUNCTION IF EXISTS public.platform_share_collections(uuid, text, text);
DROP FUNCTION IF EXISTS public.platform_share_waive(uuid, text);
DROP FUNCTION IF EXISTS public.platform_share_settle_overdue(uuid, text, text, integer);
DROP FUNCTION IF EXISTS public.platform_share_accrue(uuid, text, text);
DROP FUNCTION IF EXISTS public.platform_share_set_policy(uuid, integer, boolean, numeric, text, timestamptz);
DROP FUNCTION IF EXISTS public.platform_share_is_operator();
DROP TABLE IF EXISTS public.platform_share_event;
DROP FUNCTION IF EXISTS public.platform_share_event_append_only();
DROP TABLE IF EXISTS public.platform_share_policy;
