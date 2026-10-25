-- Rollback SHERIVS-A05. Levy fee rows already created stay (they are ordinary fee rows); remove them separately if needed.
BEGIN;
DROP FUNCTION IF EXISTS public.fee_statement(uuid, text, text);
DROP FUNCTION IF EXISTS public.fee_sibling_apply(uuid, text, text);
DROP FUNCTION IF EXISTS public.fee_sibling_rule_set(uuid, int, numeric);
DROP FUNCTION IF EXISTS public.fee_levy_create(uuid, text, numeric, text, text, uuid[], date);
DROP FUNCTION IF EXISTS public.fee_relief_revoke(uuid);
DROP FUNCTION IF EXISTS public.fee_relief_decide(uuid, boolean);
DROP FUNCTION IF EXISTS public.fee_relief_request(uuid, text, text, numeric, text, text, text, text, text);
DROP TABLE IF EXISTS public.fee_sibling_rules;
DROP TABLE IF EXISTS public.fee_levies;
DROP TABLE IF EXISTS public.fee_adjustments;
COMMIT;
