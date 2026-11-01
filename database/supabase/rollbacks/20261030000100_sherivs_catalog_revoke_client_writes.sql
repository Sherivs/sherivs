-- WARNING: This rollback restores direct client INSERT, UPDATE, and DELETE
-- privileges. Use only with explicit authorization; RLS policies remain in force.
-- Restores the observed pre-migration privilege state. TRUNCATE is not restored.
BEGIN;

GRANT INSERT, UPDATE, DELETE ON TABLE
  public.websites, public.website_versions, public.website_audit, public.website_block_types
  TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.website_block_types TO anon;

COMMIT;
