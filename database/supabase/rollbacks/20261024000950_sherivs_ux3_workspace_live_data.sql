-- Rollback for 20261025100230_sherivs_ux3_workspace_live_data.sql (drops only what it created).
BEGIN;
DROP FUNCTION IF EXISTS public.workspace_scope_resolve(uuid, jsonb);
DROP FUNCTION IF EXISTS public.workspace_widget_data(uuid, text[], jsonb);
DROP FUNCTION IF EXISTS public.workspace_scope_class_ids(uuid, jsonb);
DROP FUNCTION IF EXISTS public.workspace_effective_scope(uuid, jsonb);
DROP FUNCTION IF EXISTS public.workspace_scope_labels(uuid);
COMMIT;
