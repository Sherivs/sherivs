-- Rollback for 20261025100220_sherivs_ux2_scope_policy_workspace.sql. Restores the UX1 functions by
-- re-running the UX1 migration afterwards (its CREATE OR REPLACE bodies are the v1 manifest).
BEGIN;
DROP FUNCTION IF EXISTS public.workspace_policy_set(uuid, text, boolean);
DROP FUNCTION IF EXISTS public.workspace_policy_list(uuid);
DROP FUNCTION IF EXISTS public._workspace_item_ok2(public.workspace_item_catalog, text[], text[], text[], text[], text[]);
DROP FUNCTION IF EXISTS public.workspace_scope_options(uuid);
DROP FUNCTION IF EXISTS public.workspace_policies(uuid);
DROP TABLE IF EXISTS public.org_workspace_policies;
DROP TABLE IF EXISTS public.workspace_policy_catalog;
ALTER TABLE public.workspace_item_catalog DROP COLUMN IF EXISTS policy;
ALTER TABLE public.workspace_item_catalog DROP COLUMN IF EXISTS scope_dims;
COMMIT;
-- then: \i database/supabase/migrations/20261025100210_sherivs_ux1_workspace_manifest.sql
