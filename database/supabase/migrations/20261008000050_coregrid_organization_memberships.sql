-- =============================================================================
-- Sherivs — organization memberships (multi-membership identity store)
-- =============================================================================
-- Status: APPLIED to the canonical project (nwrflbpbhyiqdptmlccm) on
--   2026-10-08 via `node scripts/db-apply-one.mjs 20261008000050`, under the
--   EXPLICIT OPERATOR AUTHORIZATION given in the refoundation run record
--   ("I give you go ahead on everything", 2026-10-08). Post-apply verification
--   recorded in the run: RLS ENABLED+FORCED, four policies present, backfill
--   8/8 users with 0 unmatched, grants exactly (anon: none, authenticated:
--   SELECT/INSERT/UPDATE/DELETE, service_role: ALL), behavioral RLS matrix
--   (member reads own row only; org admin manages own organization; cross-user
--   write and self-grant INSERT fail closed; TRUNCATE privilege revoked).
-- Rollback (genuine inverse):
--   database/supabase/rollbacks/20261008000050_coregrid_organization_memberships.sql
--
-- Authority:
--   SHERIVS EXPERIENCE REFOUNDATION §11 — authentication resolves
--     memberships → organizations → roles → runtime → workspace; users may
--     hold MORE THAN ONE organization membership. Until now the identity
--     store held exactly one membership per user (public.users.school_id
--     NOT NULL, one row per auth user), which made multi-membership
--     unrepresentable.
--   §26 DATA AND DATABASE SAFETY — this migration is strictly ADDITIVE:
--     no table is renamed, no column is dropped, no legacy row is modified
--     or deleted. public.users.school_id REMAINS the ACTIVE-CONTEXT binding
--     (every live tenant RLS predicate resolves through it), now switchable.
--   AGENTS.md §28 DATABASE LAW — constraints, indexes, trigger-enforced
--     consistency, RLS, idempotent backfill.
--
-- Model:
--   organization_memberships = the SET of an actor's organization
--   affiliations (N per user). users.school_id + users.role = the ACTIVE
--   membership (the workspace context the session operates in), switchable
--   server-side (see the identity resolver / switchActiveOrganization).
--
-- Consistency (trigger-enforced, so EVERY write path — admin staff
-- provisioning, onboarding, demo fixtures — keeps the store coherent
-- without touching its code):
--   INSERT/UPDATE on public.users upserts the matching membership row
--   (same user+school): role, is_active mirrored; the row is marked
--   primary. A school MOVE (users.school_id changed) does NOT delete the
--   old membership — prior affiliations are history, not garbage.
--
-- Backfill: idempotent; every existing users row becomes one primary
-- membership. Re-runnable (ON CONFLICT DO NOTHING).
--
-- RLS posture: ENABLED and FORCED. A member reads ONLY their own rows;
-- organization administrators read/manage ONLY their active organization's
-- rows; super admins (internal Sherivs workforce) manage all. No
-- anon access. Fail-closed: a policy-less or revoked-privilege actor sees
-- nothing.
--
-- Relationship to the neutral cg_ substrate: this table is the LIVE legacy
-- identity-store extension (uuid schools FK) driving the live tenant RLS.
-- The neutral org-model substrate (cg_org_membership, tenant_id text,
-- 20261001000000) is a separate, deliberately-unapplied universal layer;
-- COND-003 (tenant uuid-vs-text) governs any future unification. This
-- migration neither reads nor writes cg_ tables.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Table
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.organization_memberships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  school_id   uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('admin','principal','teacher','parent','student','bursar','hq','alumni','driver')),
  is_primary  boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- One membership row per (user, organization); re-activation reuses it.
  CONSTRAINT organization_memberships_user_school_unique UNIQUE (user_id, school_id)
);

COMMENT ON TABLE public.organization_memberships IS
  'Sherivs organization membership set (§11): every organization an actor '
  'is affiliated with, under a declared tenant role. The ACTIVE membership '
  'is public.users.school_id/role (switchable server-side); membership rows '
  'never grant authorization by themselves — every tenant RLS predicate '
  'still resolves through the identity-store helpers below.';

CREATE INDEX IF NOT EXISTS idx_organization_memberships_user
  ON public.organization_memberships (user_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_organization_memberships_school
  ON public.organization_memberships (school_id);

-- At most ONE primary membership per user (the active-context default).
CREATE UNIQUE INDEX IF NOT EXISTS organization_memberships_single_primary
  ON public.organization_memberships (user_id)
  WHERE is_primary = true;

DROP TRIGGER IF EXISTS organization_memberships_touch ON public.organization_memberships;
CREATE TRIGGER organization_memberships_touch
  BEFORE UPDATE ON public.organization_memberships
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- 2. Dual-write trigger — users is the write surface, memberships mirror it
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_organization_membership_on_user_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.school_id IS DISTINCT FROM OLD.school_id
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    -- is_primary marks the ACTIVE-CONTEXT default (users.school_id). A move
    -- to another organization demotes the previous primary — the membership
    -- itself stays (prior affiliations are history, never garbage).
    IF TG_OP = 'UPDATE' AND NEW.school_id IS DISTINCT FROM OLD.school_id THEN
      UPDATE public.organization_memberships
      SET is_primary = false, updated_at = now()
      WHERE user_id = NEW.id AND is_primary = true
        AND school_id <> NEW.school_id;
    END IF;
    -- Mirror the active-context write into the membership set. Idempotent:
    -- re-invites and role moves upsert in place.
    INSERT INTO public.organization_memberships
      (user_id, school_id, role, is_primary, is_active)
    VALUES
      (NEW.id, NEW.school_id, NEW.role, true, COALESCE(NEW.is_active, true))
    ON CONFLICT (user_id, school_id) DO UPDATE
      SET role      = EXCLUDED.role,
          is_active = EXCLUDED.is_active,
          is_primary = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organization_memberships_sync ON public.users;
CREATE TRIGGER organization_memberships_sync
  AFTER INSERT OR UPDATE OF school_id, role, is_active ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_organization_membership_on_user_write();

-- -----------------------------------------------------------------------------
-- 3. Idempotent backfill — every existing member becomes one primary membership
-- -----------------------------------------------------------------------------

INSERT INTO public.organization_memberships (user_id, school_id, role, is_primary, is_active)
SELECT u.id, u.school_id, u.role, true, COALESCE(u.is_active, true)
FROM public.users u
ON CONFLICT (user_id, school_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. RLS — enabled, forced, member-scoped, fail-closed
-- -----------------------------------------------------------------------------

ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships FORCE ROW LEVEL SECURITY;

-- A member reads their own membership set; an organization administrator
-- reads their ACTIVE organization's set (staff administration); internal
-- Sherivs workforce reads all. Nobody else reads anything.
CREATE POLICY organization_memberships_select ON public.organization_memberships
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR public.is_super_admin()
    OR (public.is_school_admin() AND school_id = public.get_my_school_id())
  );

-- Only an organization administrator (of their active organization) or the
-- internal workforce may create memberships — and the WITH CHECK pins the
-- created row to that organization. A client can never grant ITSELF a
-- membership in an organization it cannot administer.
CREATE POLICY organization_memberships_insert ON public.organization_memberships
  FOR INSERT
  WITH CHECK (
    public.is_super_admin()
    OR (public.is_school_admin() AND school_id = public.get_my_school_id())
  );

CREATE POLICY organization_memberships_update ON public.organization_memberships
  FOR UPDATE
  USING (
    public.is_super_admin()
    OR (public.is_school_admin() AND school_id = public.get_my_school_id())
  )
  WITH CHECK (
    public.is_super_admin()
    OR (public.is_school_admin() AND school_id = public.get_my_school_id())
  );

CREATE POLICY organization_memberships_delete ON public.organization_memberships
  FOR DELETE
  USING (
    public.is_super_admin()
    OR (public.is_school_admin() AND school_id = public.get_my_school_id())
  );

-- Privileges follow the policy posture: anon has NOTHING; authenticated may
-- exercise exactly the four policy-gated commands; service role full access.
-- TRUNCATE/REFERENCES/TRIGGER are revoked from authenticated: TRUNCATE is NOT
-- row-level-security gated, so a table-level TRUNCATE grant would be a
-- policy-bypassing write path outside the declared posture.
REVOKE ALL ON TABLE public.organization_memberships FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.organization_memberships FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.organization_memberships TO authenticated;
GRANT ALL ON TABLE public.organization_memberships TO service_role;

-- -----------------------------------------------------------------------------
-- 5. Multi-membership-aware identity-store helpers (SECURITY DEFINER)
-- -----------------------------------------------------------------------------
-- get_my_school_id()/get_my_role() are consumed by EVERY live tenant RLS
-- predicate. They keep their exact signatures and semantics (ONE active
-- organization) but now resolve the ACTIVE CONTEXT as: the primary ACTIVE
-- membership row, falling back to the legacy users row. Post-backfill the
-- two resolutions are identical for every existing user (is_primary=true),
-- so no existing policy's behavior changes; the difference only appears
-- when the server-side switcher re-points the active context.

CREATE OR REPLACE FUNCTION public.get_my_school_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (
      SELECT m.school_id
      FROM public.organization_memberships m
      WHERE m.user_id = auth.uid() AND m.is_active = true
      ORDER BY m.is_primary DESC, m.created_at ASC
      LIMIT 1
    ),
    (SELECT u.school_id FROM public.users u WHERE u.id = auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (
      SELECT m.role
      FROM public.organization_memberships m
      WHERE m.user_id = auth.uid() AND m.is_active = true
      ORDER BY m.is_primary DESC, m.created_at ASC
      LIMIT 1
    ),
    (SELECT u.role FROM public.users u WHERE u.id = auth.uid())
  );
$$;

-- The membership SET (multi-membership reads). Kept definer so the identity
-- resolver can list affiliations for the caller even where substrate rows
-- are the only record.
CREATE OR REPLACE FUNCTION public.get_my_memberships()
RETURNS TABLE (school_id uuid, role text, is_primary boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.school_id, m.role, m.is_primary
  FROM public.organization_memberships m
  WHERE m.user_id = auth.uid() AND m.is_active = true
  ORDER BY m.is_primary DESC, m.created_at ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_memberships() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_memberships() TO authenticated, service_role;
