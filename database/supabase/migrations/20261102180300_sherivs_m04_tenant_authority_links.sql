-- M04 tenant hierarchy and institution-authority links.
-- The tenant root, campuses, and shifts reuse the existing schools/campuses/school_shifts tables.
-- No jurisdictional authority candidates are seeded without verified source material.
DO $guard$
BEGIN
  IF to_regclass('public.schools') IS NULL
     OR to_regclass('public.campuses') IS NULL
     OR to_regclass('public.school_shifts') IS NULL
     OR to_regclass('public.organization_memberships') IS NULL
     OR to_regprocedure('public.get_my_school_id()') IS NULL
     OR to_regprocedure('public.scholar_can(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'M04 requires the organization membership, campus/shift, and authorization helpers'
      USING ERRCODE = '55000';
  END IF;
END
$guard$;

BEGIN;

-- A shift may belong to a campus, but that campus must belong to the same tenant.
CREATE UNIQUE INDEX IF NOT EXISTS campuses_id_school_id_m04_uq
  ON public.campuses (id, school_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.school_shifts'::regclass
       AND conname = 'school_shifts_campus_school_m04_fk'
  ) THEN
    ALTER TABLE public.school_shifts
      ADD CONSTRAINT school_shifts_campus_school_m04_fk
      FOREIGN KEY (campus_id, school_id)
      REFERENCES public.campuses (id, school_id)
      NOT VALID;
  END IF;
END
$$;

CREATE TABLE public.institution_authority_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  authority_name text NOT NULL CHECK (length(btrim(authority_name)) BETWEEN 2 AND 200),
  legal_basis text CHECK (legal_basis IS NULL OR length(btrim(legal_basis)) BETWEEN 2 AND 2000),
  source text NOT NULL CHECK (length(btrim(source)) BETWEEN 2 AND 1000),
  evidence_url text,
  verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'verified')),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  verified_by uuid,
  verified_at timestamptz,
  CHECK (effective_until IS NULL OR effective_until > effective_from),
  CHECK (
    verification_status <> 'verified'
    OR (
      nullif(btrim(evidence_url), '') IS NOT NULL
      AND verified_by IS NOT NULL
      AND verified_at IS NOT NULL
    )
  )
);
CREATE INDEX institution_authority_links_tenant_effective_idx
  ON public.institution_authority_links (school_id, effective_from, effective_until);

CREATE TABLE public.institution_authority_link_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  authority_link_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  before_state jsonb,
  after_state jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX institution_authority_link_audit_tenant_time_idx
  ON public.institution_authority_link_audit (school_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.institution_authority_link_actor_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'authority-link changes require an authenticated, audited actor'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.school_id IS DISTINCT FROM OLD.school_id THEN
      RAISE EXCEPTION 'authority links cannot move between tenants' USING ERRCODE = '42501';
    END IF;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  ELSE
    NEW.created_by := v_actor;
    NEW.created_at := clock_timestamp();
  END IF;

  NEW.updated_by := v_actor;
  NEW.updated_at := clock_timestamp();
  IF NEW.verification_status = 'verified' THEN
    IF nullif(btrim(NEW.evidence_url), '') IS NULL THEN
      RAISE EXCEPTION 'verified authority links require evidence_url' USING ERRCODE = '23514';
    END IF;
    NEW.verified_by := CASE WHEN TG_OP = 'UPDATE' AND OLD.verification_status = 'verified' THEN OLD.verified_by ELSE v_actor END;
    NEW.verified_at := CASE WHEN TG_OP = 'UPDATE' AND OLD.verification_status = 'verified' THEN OLD.verified_at ELSE clock_timestamp() END;
  ELSE
    NEW.verified_by := NULL;
    NEW.verified_at := NULL;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER institution_authority_link_actor_guard
  BEFORE INSERT OR UPDATE ON public.institution_authority_links
  FOR EACH ROW EXECUTE FUNCTION public.institution_authority_link_actor_guard();

CREATE OR REPLACE FUNCTION public.institution_authority_link_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_link_id uuid;
  v_school_id uuid;
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'authority-link audit requires an authenticated actor' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_link_id := OLD.id;
    v_school_id := OLD.school_id;
    v_before := to_jsonb(OLD);
  ELSE
    v_link_id := NEW.id;
    v_school_id := NEW.school_id;
    v_after := to_jsonb(NEW);
    IF TG_OP = 'UPDATE' THEN v_before := to_jsonb(OLD); END IF;
  END IF;

  INSERT INTO public.institution_authority_link_audit (
    school_id, authority_link_id, actor_user_id, action, before_state, after_state
  ) VALUES (
    v_school_id, v_link_id, v_actor, lower(TG_OP), v_before, v_after
  );
  RETURN NULL;
END
$$;

CREATE TRIGGER institution_authority_link_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.institution_authority_links
  FOR EACH ROW EXECUTE FUNCTION public.institution_authority_link_audit();

CREATE OR REPLACE FUNCTION public.institution_authority_link_audit_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'institution authority link audit is append-only' USING ERRCODE = '42501';
END
$$;

CREATE TRIGGER institution_authority_link_audit_immutable
  BEFORE UPDATE OR DELETE ON public.institution_authority_link_audit
  FOR EACH ROW EXECUTE FUNCTION public.institution_authority_link_audit_immutable();
CREATE TRIGGER institution_authority_link_audit_immutable_truncate
  BEFORE TRUNCATE ON public.institution_authority_link_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.institution_authority_link_audit_immutable();

ALTER TABLE public.institution_authority_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institution_authority_links FORCE ROW LEVEL SECURITY;
ALTER TABLE public.institution_authority_link_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institution_authority_link_audit FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.institution_authority_links FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.institution_authority_links TO authenticated;
REVOKE ALL ON public.institution_authority_link_audit FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.institution_authority_link_audit TO authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.institution_authority_links,
  public.institution_authority_link_audit FROM authenticated;

CREATE POLICY institution_authority_links_read ON public.institution_authority_links
  FOR SELECT TO authenticated
  USING (school_id = (SELECT public.get_my_school_id()));
CREATE POLICY institution_authority_links_insert ON public.institution_authority_links
  FOR INSERT TO authenticated
  WITH CHECK (
    school_id = (SELECT public.get_my_school_id())
    AND public.scholar_can(school_id, 'settings.manage')
  );
CREATE POLICY institution_authority_links_update ON public.institution_authority_links
  FOR UPDATE TO authenticated
  USING (
    school_id = (SELECT public.get_my_school_id())
    AND public.scholar_can(school_id, 'settings.manage')
  )
  WITH CHECK (
    school_id = (SELECT public.get_my_school_id())
    AND public.scholar_can(school_id, 'settings.manage')
  );
CREATE POLICY institution_authority_links_delete ON public.institution_authority_links
  FOR DELETE TO authenticated
  USING (
    school_id = (SELECT public.get_my_school_id())
    AND public.scholar_can(school_id, 'settings.manage')
  );
CREATE POLICY institution_authority_link_audit_read ON public.institution_authority_link_audit
  FOR SELECT TO authenticated
  USING (
    school_id = (SELECT public.get_my_school_id())
    AND (
      actor_user_id = (SELECT auth.uid())
      OR public.scholar_can(school_id, 'audit.view')
    )
  );

REVOKE ALL ON FUNCTION public.institution_authority_link_actor_guard(),
  public.institution_authority_link_audit(),
  public.institution_authority_link_audit_immutable()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.read_my_tenant_hierarchy()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH tenant AS (
    SELECT public.get_my_school_id() AS id
     WHERE auth.uid() IS NOT NULL
       AND EXISTS (
         SELECT 1
           FROM public.organization_memberships m
           JOIN public.users u ON u.id = m.user_id
          WHERE m.user_id = auth.uid()
            AND m.school_id = public.get_my_school_id()
            AND m.is_active
            AND u.is_active IS TRUE
       )
  )
  SELECT jsonb_build_object(
    'organization', jsonb_build_object('id', s.id, 'name', s.name),
    'campuses', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'code', c.code,
          'isActive', c.is_active,
          'shifts', coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', sh.id,
                'name', sh.name,
                'kind', sh.kind,
                'startsAt', sh.starts_at,
                'endsAt', sh.ends_at
              ) ORDER BY sh.name
            )
              FROM public.school_shifts sh
             WHERE sh.school_id = s.id
               AND sh.campus_id = c.id
          ), '[]'::jsonb)
        ) ORDER BY c.name
      )
        FROM public.campuses c
       WHERE c.school_id = s.id
    ), '[]'::jsonb),
    'unassignedShifts', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', sh.id,
          'name', sh.name,
          'kind', sh.kind,
          'startsAt', sh.starts_at,
          'endsAt', sh.ends_at
        ) ORDER BY sh.name
      )
        FROM public.school_shifts sh
       WHERE sh.school_id = s.id
         AND sh.campus_id IS NULL
    ), '[]'::jsonb)
  )
    FROM tenant t
    JOIN public.schools s ON s.id = t.id;
$$;

REVOKE ALL ON FUNCTION public.read_my_tenant_hierarchy() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_my_tenant_hierarchy() TO authenticated;

COMMIT;
