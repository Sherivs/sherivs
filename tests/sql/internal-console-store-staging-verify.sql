-- Read-only staging proof for SHERIVS-030. Do not insert users or rows.
SELECT json_build_object(
  'workspace', to_regclass('public.platform_workspace') IS NOT NULL,
  'member', to_regclass('public.platform_workspace_member') IS NOT NULL,
  'runtime', to_regclass('public.platform_runtime') IS NOT NULL,
  'recent', to_regclass('public.platform_recent_access') IS NOT NULL,
  'ensure_fn', to_regclass('public.ensure_platform_personal_workspace') IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'ensure_platform_personal_workspace'
    ),
  'invite_expires_at', EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'platform_staff'
       AND column_name = 'invite_expires_at'
  ),
  'initial_workspace_id', EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'platform_staff'
       AND column_name = 'initial_workspace_id'
  ),
  'forced_rls', (
    SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname IN (
         'platform_workspace',
         'platform_workspace_member',
         'platform_runtime',
         'platform_recent_access'
       )
  ),
  'authenticated_insert', EXISTS (
    SELECT 1
      FROM information_schema.role_table_grants
     WHERE table_schema = 'public'
       AND table_name IN (
         'platform_workspace',
         'platform_workspace_member',
         'platform_runtime',
         'platform_recent_access'
       )
       AND grantee = 'authenticated'
       AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  )
) AS proof;
