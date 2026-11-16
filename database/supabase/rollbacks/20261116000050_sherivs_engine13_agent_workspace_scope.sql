-- Rollback for ENGINE-13 (20261116000050). Removes the agent workspace scopes and tenant grants.
-- Export agent_tenant_grants first: it records which human grant lent which agent access, and when.
DROP FUNCTION IF EXISTS public.agent_may_read_tenant(text, text, uuid);
DROP TABLE IF EXISTS public.agent_tenant_grants;
DROP TABLE IF EXISTS public.agent_workspace_scopes;
