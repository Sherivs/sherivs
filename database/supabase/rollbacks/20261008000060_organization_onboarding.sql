-- =============================================================================
-- ROLLBACK: Sherivs organization onboarding (genuine inverse of
-- 20261008000060_organization_onboarding.sql)
-- =============================================================================
-- Removes ONLY the objects this migration created. Organization rows and
-- founder users rows created THROUGH the function are DATA, not schema:
-- they are left in place (§26 — never destroy data in a rollback). An
-- operator who needs those rows gone must explicitly delete them.
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.create_organization_with_founder(text, text, text, text)
  FROM authenticated;

DROP FUNCTION IF EXISTS public.create_organization_with_founder(text, text, text, text);
