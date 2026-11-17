-- Rollback of 20261110000600_sherivs_engine03_guard_function_grants.sql
-- Restores the default execute grant on the three trigger functions (not recommended).
GRANT EXECUTE ON FUNCTION public.cg_tool_registry_guard(), public.cg_connector_binding_guard(), public.cg_tool_ledger_guard()
  TO PUBLIC;
