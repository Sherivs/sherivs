-- =============================================================================
-- SHERIVS-030 — Internal Console store (Plane D).
--
-- Durable workspaces, runtime registry, recent access, and invitation expiry
-- for authorized Sherivs staff. This is not a tenant workspace model and not
-- cg_workspace (tenant projections). Clients have SELECT only.
-- Writes go through service-role server functions after capability checks.
-- Rollback: database/supabase/rollbacks/20261027001000_sherivs_030_internal_console.sql
-- =============================================================================
BEGIN;

-- 1. Invitation expiry on existing staff rows ---------------------------------
ALTER TABLE public.platform_staff
  ADD COLUMN IF NOT EXISTS invite_expires_at timestamptz;

ALTER TABLE public.platform_staff
  ADD COLUMN IF NOT EXISTS initial_workspace_id uuid;

UPDATE public.platform_staff
   SET invite_expires_at = invited_at + interval '14 days'
 WHERE status = 'invited'
   AND invite_expires_at IS NULL;

-- 2. Workspaces ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_workspace (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE
                CHECK (slug ~ '^[a-z0-9][a-z0-9_-]{0,62}$'),
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 80),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 400),
  kind        text NOT NULL CHECK (kind IN ('personal', 'shared')),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  owner_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_workspace_personal_slug
    CHECK (kind <> 'personal' OR slug LIKE 'personal-%')
);

COMMENT ON TABLE public.platform_workspace IS
  'Sherivs Internal Console workspaces. Membership never grants platform-wide authorization.';

CREATE UNIQUE INDEX IF NOT EXISTS platform_workspace_one_personal
  ON public.platform_workspace (owner_id)
  WHERE kind = 'personal';

CREATE INDEX IF NOT EXISTS platform_workspace_owner_idx
  ON public.platform_workspace (owner_id, status);

CREATE TABLE IF NOT EXISTS public.platform_workspace_member (
  workspace_id uuid NOT NULL REFERENCES public.platform_workspace(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access       text NOT NULL CHECK (access IN ('owner', 'member')),
  added_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

COMMENT ON TABLE public.platform_workspace_member IS
  'Internal Console workspace membership. Access is re-checked on every protected read.';

CREATE INDEX IF NOT EXISTS platform_workspace_member_user_idx
  ON public.platform_workspace_member (user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'platform_staff_initial_workspace_fk'
  ) THEN
    ALTER TABLE public.platform_staff
      ADD CONSTRAINT platform_staff_initial_workspace_fk
      FOREIGN KEY (initial_workspace_id) REFERENCES public.platform_workspace(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 3. Runtime registry (data, not executable plugins) --------------------------
CREATE TABLE IF NOT EXISTS public.platform_runtime (
  id           text PRIMARY KEY CHECK (id ~ '^runtime:[a-z][a-z0-9_-]{1,40}$'),
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 80),
  description  text NOT NULL CHECK (length(description) BETWEEN 8 AND 400),
  entry_origin text NOT NULL CHECK (entry_origin LIKE 'https://%'),
  entry_path   text NOT NULL CHECK (entry_path LIKE '/%'),
  help_href    text NOT NULL CHECK (help_href LIKE '/console%'),
  status       text NOT NULL CHECK (status IN ('operational_product', 'not_registered')),
  sort_order   integer NOT NULL DEFAULT 100,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.platform_runtime IS
  'Registered Sherivs runtimes. Rows are written by authorized server functions from the application contract. Future products are not listed until they exist.';

-- 4. Recent access ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_recent_access (
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resource_key text NOT NULL CHECK (length(resource_key) BETWEEN 1 AND 120),
  title        text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  href         text NOT NULL CHECK (href LIKE '/console%'),
  kind         text NOT NULL CHECK (length(kind) BETWEEN 1 AND 40),
  accessed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, resource_key)
);

COMMENT ON TABLE public.platform_recent_access IS
  'Recently opened Internal Console resources. Display still re-authorizes the href.';

CREATE INDEX IF NOT EXISTS platform_recent_access_user_idx
  ON public.platform_recent_access (user_id, accessed_at DESC);

-- 5. Personal workspace provision (service_role + claim path only) ------------
CREATE OR REPLACE FUNCTION public.ensure_platform_personal_workspace(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_name text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user required';
  END IF;
  SELECT id INTO v_id
    FROM public.platform_workspace
   WHERE owner_id = p_user_id AND kind = 'personal';
  IF v_id IS NOT NULL THEN
    INSERT INTO public.platform_workspace_member (workspace_id, user_id, access, added_by)
    VALUES (v_id, p_user_id, 'owner', p_user_id)
    ON CONFLICT (workspace_id, user_id) DO NOTHING;
    RETURN v_id;
  END IF;
  SELECT COALESCE(
           (SELECT s.full_name FROM public.platform_staff s WHERE s.id = p_user_id),
           (SELECT a.full_name FROM public.super_admins a WHERE a.id = p_user_id),
           'Staff member'
         )
    INTO v_name;
  INSERT INTO public.platform_workspace (
    slug, name, description, kind, owner_id, created_by
  ) VALUES (
    'personal-' || replace(p_user_id::text, '-', ''),
    'My Workspace',
    v_name || '''s personal working environment. Private by default.',
    'personal',
    p_user_id,
    p_user_id
  )
  RETURNING id INTO v_id;
  INSERT INTO public.platform_workspace_member (workspace_id, user_id, access, added_by)
  VALUES (v_id, p_user_id, 'owner', p_user_id)
  ON CONFLICT (workspace_id, user_id) DO NOTHING;
  RETURN v_id;
END;
$$;

-- Activate an accepted invitation only when it has not expired, then attach
-- the personal workspace and any selected initial shared workspace.
CREATE OR REPLACE FUNCTION public.claim_platform_staff_invite()
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
  v_initial uuid;
BEGIN
  UPDATE public.platform_staff s
     SET status = 'active', activated_at = now(), updated_at = now()
    FROM auth.users u
   WHERE s.id = auth.uid() AND u.id = s.id
     AND s.status = 'invited'
     AND u.email_confirmed_at IS NOT NULL
     AND (s.invite_expires_at IS NULL OR s.invite_expires_at > now());
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RETURN false;
  END IF;
  PERFORM public.ensure_platform_personal_workspace(auth.uid());
  SELECT initial_workspace_id INTO v_initial
    FROM public.platform_staff WHERE id = auth.uid();
  IF v_initial IS NOT NULL THEN
    INSERT INTO public.platform_workspace_member (workspace_id, user_id, access, added_by)
    SELECT w.id, auth.uid(), 'member', s.invited_by
      FROM public.platform_workspace w
      JOIN public.platform_staff s ON s.id = auth.uid()
     WHERE w.id = v_initial AND w.kind = 'shared' AND w.status = 'active'
    ON CONFLICT (workspace_id, user_id) DO NOTHING;
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_platform_personal_workspace(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_platform_personal_workspace(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.claim_platform_staff_invite() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_platform_staff_invite() TO authenticated, service_role;

-- 6. Backfill personal workspaces for current active staff and super admins ---
INSERT INTO public.platform_workspace (slug, name, description, kind, owner_id, created_by)
SELECT
  'personal-' || replace(s.id::text, '-', ''),
  'My Workspace',
  s.full_name || '''s personal working environment. Private by default.',
  'personal',
  s.id,
  s.id
FROM public.platform_staff s
WHERE s.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM public.platform_workspace w
     WHERE w.owner_id = s.id AND w.kind = 'personal'
  );

INSERT INTO public.platform_workspace (slug, name, description, kind, owner_id, created_by)
SELECT
  'personal-' || replace(a.id::text, '-', ''),
  'My Workspace',
  COALESCE(a.full_name, 'Staff member') || '''s personal working environment. Private by default.',
  'personal',
  a.id,
  a.id
FROM public.super_admins a
WHERE COALESCE(a.is_active, true)
  AND NOT EXISTS (
    SELECT 1 FROM public.platform_workspace w
     WHERE w.owner_id = a.id AND w.kind = 'personal'
  );

INSERT INTO public.platform_workspace_member (workspace_id, user_id, access, added_by)
SELECT w.id, w.owner_id, 'owner', w.owner_id
  FROM public.platform_workspace w
 WHERE w.kind = 'personal'
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- 7. RLS + grants -------------------------------------------------------------
ALTER TABLE public.platform_workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_workspace FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_workspace_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_workspace_member FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_runtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_runtime FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_recent_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_recent_access FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.platform_workspace, public.platform_workspace_member,
  public.platform_runtime, public.platform_recent_access
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.platform_workspace, public.platform_workspace_member,
  public.platform_runtime, public.platform_recent_access
  TO authenticated;
GRANT ALL ON TABLE public.platform_workspace, public.platform_workspace_member,
  public.platform_runtime, public.platform_recent_access
  TO service_role;

DROP POLICY IF EXISTS platform_workspace_read ON public.platform_workspace;
CREATE POLICY platform_workspace_read ON public.platform_workspace
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.platform_workspace_member m
       WHERE m.workspace_id = platform_workspace.id
         AND m.user_id = auth.uid()
    )
    OR (
      kind = 'shared'
      AND (
        public.is_super_admin()
        OR public.has_platform_capability('platform.staff.manage')
      )
    )
  );

DROP POLICY IF EXISTS platform_workspace_member_read ON public.platform_workspace_member;
CREATE POLICY platform_workspace_member_read ON public.platform_workspace_member
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_super_admin()
    OR (
      public.has_platform_capability('platform.staff.manage')
      AND EXISTS (
        SELECT 1 FROM public.platform_workspace w
         WHERE w.id = platform_workspace_member.workspace_id
           AND w.kind = 'shared'
      )
    )
  );

DROP POLICY IF EXISTS platform_runtime_read ON public.platform_runtime;
CREATE POLICY platform_runtime_read ON public.platform_runtime
  FOR SELECT TO authenticated
  USING (public.is_platform_staff());

DROP POLICY IF EXISTS platform_recent_access_read ON public.platform_recent_access;
CREATE POLICY platform_recent_access_read ON public.platform_recent_access
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

COMMIT;
