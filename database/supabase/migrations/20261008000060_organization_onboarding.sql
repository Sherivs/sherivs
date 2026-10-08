-- =============================================================================
-- Sherivs — organization onboarding (founder creates an organization)
-- =============================================================================
-- Status: NOT YET APPLIED. Apply via `node scripts/db-apply-one.mjs
--   20261008000060` under explicit operator authorization, then record the
--   post-apply verification here (this file's header is the application
--   record, mirroring 20261008000050).
-- Rollback (genuine inverse):
--   database/supabase/rollbacks/20261008000060_organization_onboarding.sql
--
-- Authority:
--   SHERIVS CATEGORY FORMATION PROGRAM §21 — SHERIVS ORGANIZATION
--     ONBOARDING: create account → create organization → identity →
--     runtime selection → provisioning → activation. Until now NO in-product
--     organization creation existed: public.schools RLS grants no INSERT to
--     authenticated customers, so a signed-in but unlinked user could not
--     become a founder. The welcome surface linked out to marketing.
--   SHERIVS EXPERIENCE REFOUNDATION §11 — new customer outcome in the
--     identity chain: onboarding, not Scholar-by-default.
--   §26 DATA AND DATABASE SAFETY — strictly ADDITIVE: one SECURITY DEFINER
--     function + grants. No existing table, column, row, policy or trigger
--     is altered. The memberships-sync trigger (20261008000050) keeps the
--     membership substrate coherent for the new founder automatically.
--
-- Security model (fail-closed, default deny):
--   - RLS already denies INSERT on schools/users to authenticated users.
--     This function is the ONLY customer path that creates an organization.
--   - SECURITY DEFINER is scoped to exactly one purpose and verifies:
--       * caller is authenticated (auth.uid() not null)
--       * caller is UNLINKED — holds no users row and no membership
--         (a linked actor cannot mint a second identity-store row)
--       * runtime is provisionable (V1: scholar only; every other value
--         is rejected until its runtime ships)
--       * name/slug inputs are bounded and slug-shaped
--   - Slug collisions surface as the unique violation on
--     schools_slug_key (mapped to a stable error code by the caller).
--   - The function writes its own audit row (immutable-record posture,
--     AGENTS.md §28) with the actor id, org id and runtime — no secrets.
--   - Grants: execute to authenticated only; anon and PUBLIC revoked.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_organization_with_founder(
  p_org_name   text,
  p_org_slug   text,
  p_full_name  text,
  p_runtime    text DEFAULT 'scholar'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_org_id uuid;
BEGIN
  -- Authentication: who are you?
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  -- Authorization: only an UNLINKED account may found an organization.
  -- (A linked member creates organizations through the internal/onboarding
  -- pathways that require the corresponding authority; not here.)
  IF EXISTS (SELECT 1 FROM public.users WHERE id = v_caller)
     OR EXISTS (SELECT 1 FROM public.organization_memberships WHERE user_id = v_caller) THEN
    RAISE EXCEPTION 'FOUNDER_ALREADY_LINKED';
  END IF;

  -- Runtime resolution: only provisionable runtimes may be selected.
  -- (V1 envelope — §45. Commerce/Health/Government/Logistics are frozen
  -- future runtimes; the application presents them as "in development".)
  IF p_runtime <> 'scholar' THEN
    RAISE EXCEPTION 'RUNTIME_NOT_AVAILABLE';
  END IF;

  -- Validation: bounded inputs, DB-shaped slug (subdomain-safe).
  IF p_org_name IS NULL OR length(btrim(p_org_name)) < 2 OR length(btrim(p_org_name)) > 120 THEN
    RAISE EXCEPTION 'INVALID_ORG_NAME';
  END IF;
  IF p_full_name IS NULL OR length(btrim(p_full_name)) < 2 OR length(btrim(p_full_name)) > 120 THEN
    RAISE EXCEPTION 'INVALID_FOUNDER_NAME';
  END IF;
  IF p_org_slug IS NULL OR p_org_slug !~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$' THEN
    RAISE EXCEPTION 'INVALID_SLUG';
  END IF;

  -- Provisioning: the organization row, founder identity-store row
  -- (role 'admin' passes users_role_check), and — via the memberships-sync
  -- trigger — the founder's primary organization_membership.
  INSERT INTO public.schools (name, slug, onboarding_completed, is_active)
  VALUES (btrim(p_org_name), btrim(p_org_slug), false, true)
  RETURNING id INTO v_org_id;

  INSERT INTO public.users (id, school_id, full_name, role, email, is_active)
  VALUES (
    v_caller,
    v_org_id,
    btrim(p_full_name),
    'admin',
    (SELECT email FROM auth.users WHERE id = v_caller),
    true
  );

  -- Audit (§28 immutable records): WHO / WHAT / WHICH / outcome.
  INSERT INTO public.audit_logs (action, table_name, record_id, school_id, user_id, new_value)
  VALUES (
    'organization.create',
    'schools',
    v_org_id,
    v_org_id,
    v_caller,
    jsonb_build_object('runtime', p_runtime, 'slug', btrim(p_org_slug))
  );

  RETURN v_org_id;
END;
$$;

COMMENT ON FUNCTION public.create_organization_with_founder(text, text, text, text) IS
  'Sherivs organization onboarding: sole customer path that provisions an organization and its founder identity (§21). Unlinked authenticated accounts only; fail-closed.';

-- Privilege posture: executable by authenticated accounts ONLY.
REVOKE ALL ON FUNCTION public.create_organization_with_founder(text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_organization_with_founder(text, text, text, text)
  TO authenticated;
