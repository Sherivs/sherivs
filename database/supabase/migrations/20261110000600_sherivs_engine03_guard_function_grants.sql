-- ENGINE-03 hardening. The three guard functions are trigger functions that clients never call;
-- remove the default execute grant for PUBLIC, anon and authenticated. Triggers keep firing: the
-- execute privilege on a trigger function is checked when the trigger is created, not when it fires.
-- Applied to production before this file was committed. Inverse in rollbacks/20261110000600_*.sql.
REVOKE ALL ON FUNCTION public.cg_tool_registry_guard(), public.cg_connector_binding_guard(), public.cg_tool_ledger_guard()
  FROM PUBLIC, anon, authenticated;
