-- Rollback for 20261025100210_sherivs_ux1_workspace_manifest.sql (drops only objects it created).
BEGIN;
DROP FUNCTION IF EXISTS public.workspace_feature_set(uuid, text, boolean);
DROP FUNCTION IF EXISTS public.workspace_prefs_save(uuid, jsonb);
DROP FUNCTION IF EXISTS public.workspace_manifest(uuid);
DROP FUNCTION IF EXISTS public.workspace_item_allowed(uuid, text);
DROP FUNCTION IF EXISTS public._workspace_item_ok(public.workspace_item_catalog, text[], text[], text[]);
DROP FUNCTION IF EXISTS public.workspace_permission_codes(uuid);
DROP FUNCTION IF EXISTS public.workspace_features(uuid);
DROP FUNCTION IF EXISTS public._workspace_legacy_codes(text);
DROP TABLE IF EXISTS public.user_workspace_prefs;
DROP TABLE IF EXISTS public.org_workspace_features;
DROP TABLE IF EXISTS public.workspace_family_layouts;
DROP TABLE IF EXISTS public.workspace_item_catalog;
COMMIT;
