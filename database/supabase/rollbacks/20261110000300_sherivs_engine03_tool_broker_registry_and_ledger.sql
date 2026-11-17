-- Rollback of 20261110000300_sherivs_engine03_tool_broker_registry_and_ledger.sql
-- Exact inverse. The migration creates three tables (with their indexes, triggers,
-- RLS and grants as catalog consequences of the tables) and four helper functions.
-- Plan: (1) stop the broker server functions, (2) export the ledger if audit evidence is
-- needed (it is append-only and is destroyed here), (3) run in ONE transaction,
-- (4) verify none of the three tables or four functions remain.
DROP TABLE IF EXISTS public.cg_tool_call_ledger;
DROP TABLE IF EXISTS public.cg_connector_binding;
DROP TABLE IF EXISTS public.cg_tool_registry;
DROP FUNCTION IF EXISTS public.cg_tool_ledger_guard();
DROP FUNCTION IF EXISTS public.cg_connector_binding_guard();
DROP FUNCTION IF EXISTS public.cg_tool_registry_guard();
DROP FUNCTION IF EXISTS public.cg_tool_jsonb_has_secret_key(jsonb);
DROP FUNCTION IF EXISTS public.cg_tool_effect_floor(text);
DROP FUNCTION IF EXISTS public.cg_tool_tier_rank(text);
