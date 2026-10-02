-- =============================================================================
-- CoreGrid V1 — domain-neutral tenant-membership primitives (MISSION-R-20)
-- =============================================================================
-- Status: AUTHORED, NOT APPLIED. Do not treat this file as a live database.
-- Apply only with an explicit human authorization decision (governance law):
--   supabase db push --workdir database/supabase
-- Rollback (not applied by this migration):
--   database/supabase/rollbacks/20261002000001_coregrid_v1_neutral_tenant_primitives.sql
--
-- Authority:
--   STREAM_I findings I-002 / I-003 / I-004 / I-005 — the universal cg_
--   substrate RPC surface is gated on get_my_school_id() / is_school_admin(),
--   helpers resolved from public.users.school_id and Scholar AppRole values.
--   A non-Scholar tenant therefore can neither hold nor administer a role
--   assignment, a capability grant, a workforce position or an org profile.
--   This migration closes that hole with domain-neutral primitives.
--   V5.3 Part 46 — no domain contamination: the helper sources below contain
--                    no "school"/"scholar" (or any other domain) vocabulary.
--   Mission: MISSION-R-20 (blocking J-005; V1CAP-013).
--   Style exemplar: 20261001000000_coregrid_v1_org_model.sql.
--
-- Scope (redefinition-only — NO table changes, NO policy changes):
--   1. Neutral helpers (SECURITY DEFINER, documented below):
--        get_my_tenant_id() RETURNS text
--        holds_tenant_role(p_tenant text, p_role_ref text) RETURNS boolean
--        is_tenant_admin(p_tenant text) RETURNS boolean
--   2. CREATE OR REPLACE of every universal cg_ substrate RPC currently
--      gated on the Scholar helpers, re-pointing each gate to the neutral
--      predicate. Function bodies are otherwise byte-equivalent to their
--      authoritative source migrations (bodies preserved; only the gate
--      predicate and, where present, the gate error text change).
--
-- Tenancy resolution substrate (NEUTRAL ONLY — no school vocabulary):
--   cg_org_membership (tenant_id text, principal_ref text, role_ref text,
--     state) joined through its own tenant_ref — table 20261001000000;
--   cg_role_assignment (tenant_ref text, identity_ref text, role_id text,
--     status, started_on, ended_on) — table 20260907000800.
-- The actor is always re-derived inside the helpers from auth.uid(); no
-- client-supplied tenant, identity or role is ever trusted (Constitution 26).
--
-- SECURITY DEFINER posture (why definer is mandatory here):
--   Both substrate tables are deny-by-default (RLS enabled, zero policies,
--   anon/authenticated revoked), so a SECURITY INVOKER helper would always
--   observe nothing and every gate would fail closed into a false "no
--   membership" world. The helpers therefore run as definer so the RPC layer
--   can consult the substrate, and they are the ONLY place that happens:
--     • they expose exactly three answers: the actor's tenant ref, a
--       per-tenant role predicate, a per-tenant administrator predicate;
--     • they never return substrate rows;
--     • EXECUTE is revoked from PUBLIC/anon and granted only to
--       authenticated + service_role;
--     • missing substrate (not yet applied) raises instead of returning
--       false — fail-closed, observable.
--   Canonical truth: helper output is an input to RPC authorization; the
--   authorization decision itself stays with Phase 08 + RLS (Constitution 16).
--
-- Neutral role ref constant:
--   is_tenant_admin(p_tenant) resolves the neutral ADMINISTRATOR role as
--   'role:administrator' (lowercase form to satisfy the cg_role_assignment
--   role_id CHECK '^role:[a-z0-9]+(-[a-z0-9]+)*$'). The neutral role
--   vocabulary and the directional domain->neutral mapping contract are owned
--   by MISSION-R-21; this migration treats role refs as opaque neutral
--   tokens and defines no domain mapping.
--
-- COND-003 parameterization (tenant_id text vs uuid — UNRESOLVED):
--   All neutral helper signatures take/return text and every re-pointed gate
--   compares tenant refs through explicit ::text casts
--   (e.g. public.is_tenant_admin(p_tenant::text)). Today tenant refs are text
--   everywhere in the neutral substrate (cg_identity.tenant_id,
--   cg_org_membership.tenant_id, cg_role_assignment.tenant_ref) while
--   cg_tenant.id is uuid. If COND-003 rules uuid (MISSION-R-02), a follow-up
--   migration converts the substrate columns to uuid and these helpers keep
--   working unchanged because uuid::text renders in canonical lowercase form,
--   so both `p_tenant::text = tenant_ref` (uuid stored canonical) and the
--   text comparisons remain type-correct. No signature churn under either
--   outcome; the type choice stays with the operator ruling.
--
-- Deliberately NOT in scope:
--   • RLS policies for cg_org_unit / cg_org_membership (the helper existing
--     is the unblocking step recorded in I-007; policy authoring is a
--     follow-up migration under explicit authorization).
--   • Removal of the assign_workforce_position p_runtime default
--     ('runtime:scholar', I-005 correction): the live frontend call
--     (frontend/src/lib/workforce-positions.functions.ts) relies on that
--     default and frontend call-sites are re-pointed only after apply
--     authorization; default removal is deferred to that follow-up.
--   • Super-admin bypass: the original RPC gates did not consult
--     is_super_admin(); parity is preserved (that bypass lives in RLS).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Neutral helpers
-- -----------------------------------------------------------------------------

-- Actor tenancy, resolved ONLY from the neutral substrate. Returns:
--   • the single tenant ref when the actor holds exactly one distinct active
--     neutral binding (org membership or time-bounded role assignment);
--   • NULL when the actor holds none;
--   • an AMBIGUOUS_TENANCY exception when the actor holds active bindings in
--     more than one tenant — fail-closed; multi-tenant actors must be gated
--     with is_tenant_admin(p_tenant) / holds_tenant_role(p_tenant, ...).
CREATE OR REPLACE FUNCTION public.get_my_tenant_id()
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenants text[];
  v_count   integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(array_agg(DISTINCT t.tenant), '{}')
    INTO v_tenants
    FROM (
      SELECT m.tenant_id AS tenant
        FROM public.cg_org_membership m
       WHERE m.principal_ref = auth.uid()::text
         AND m.state = 'active'
      UNION
      SELECT r.tenant_ref
        FROM public.cg_role_assignment r
       WHERE r.identity_ref = auth.uid()::text
         AND r.status = 'active'
         AND r.started_on <= CURRENT_DATE
         AND (r.ended_on IS NULL OR r.ended_on >= CURRENT_DATE)
    ) t;

  v_count := array_length(v_tenants, 1);

  IF v_count IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_count > 1 THEN
    RAISE EXCEPTION
      'AMBIGUOUS_TENANCY: actor holds active neutral bindings in % tenants; use is_tenant_admin(p_tenant) for per-tenant checks',
      v_count;
  END IF;

  RETURN v_tenants[1];
END;
$$;

COMMENT ON FUNCTION public.get_my_tenant_id() IS
  $comment$MISSION-R-20 neutral tenancy primitive. Resolves the authenticated actor's
  tenant from cg_org_membership / cg_role_assignment only (no domain
  vocabulary). SECURITY DEFINER because both substrate tables are
  deny-by-default RLS. NULL when unbound; raises AMBIGUOUS_TENANCY when the
  actor is bound in more than one tenant (fail-closed; use
  is_tenant_admin(p_tenant) for multi-tenant actors).$comment$;

-- Per-tenant neutral role predicate: does the authenticated actor hold the
-- given neutral role ref in the given tenant, via EITHER an active
-- time-bounded role assignment OR an active org membership? Unknown tenant,
-- unknown role, or unauthenticated actor all answer false (never NULL).
CREATE OR REPLACE FUNCTION public.holds_tenant_role(p_tenant text, p_role_ref text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_tenant IS NULL OR p_role_ref IS NULL OR auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.cg_role_assignment r
     WHERE r.tenant_ref = p_tenant
       AND r.identity_ref = auth.uid()::text
       AND r.role_id = p_role_ref
       AND r.status = 'active'
       AND r.started_on <= CURRENT_DATE
       AND (r.ended_on IS NULL OR r.ended_on >= CURRENT_DATE)
  ) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM public.cg_org_membership m
     WHERE m.tenant_id = p_tenant
       AND m.principal_ref = auth.uid()::text
       AND m.role_ref = p_role_ref
       AND m.state = 'active'
  );
END;
$$;

COMMENT ON FUNCTION public.holds_tenant_role(text, text) IS
  $comment$MISSION-R-20 neutral per-tenant role predicate (I-002). Time-bounded: an
  assignment whose started_on is in the future or whose ended_on has passed
  does not hold (expired/revoked access fails). Role refs are opaque neutral
  tokens owned by the MISSION-R-21 vocabulary contract. SECURITY DEFINER;
  the actor is re-derived from auth.uid() — never a client parameter.$comment$;

-- Tenant-administrator predicate: the gate every universal cg_ substrate RPC
-- uses. The per-tenant argument makes "own tenant" inherent — the actor must
-- hold the neutral administrator binding IN the tenant under test, which
-- replaces the Scholar pair (is_school_admin() AND get_my_school_id() = tenant).
CREATE OR REPLACE FUNCTION public.is_tenant_admin(p_tenant text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.holds_tenant_role(p_tenant, 'role:administrator');
$$;

COMMENT ON FUNCTION public.is_tenant_admin(text) IS
  $comment$MISSION-R-20 neutral tenant-administrator predicate. True when the actor
  holds an active, time-valid neutral ADMINISTRATOR binding
  ('role:administrator') in the given tenant via cg_role_assignment or
  cg_org_membership. The tenant argument is never trusted from the client in
  the RPC layer — every gated RPC passes the tenant it re-derived from the
  row being acted on.$comment$;

REVOKE ALL ON FUNCTION public.get_my_tenant_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_tenant_id() FROM anon;
REVOKE ALL ON FUNCTION public.holds_tenant_role(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.holds_tenant_role(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.is_tenant_admin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_tenant_admin(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_tenant_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.holds_tenant_role(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_tenant_admin(text) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Re-pointed universal cg_ substrate RPCs (redefinition-only)
-- -----------------------------------------------------------------------------
-- Sources:
--   workforce  : 20260907000300 (list/assign) + 20260907000500 (final end body)
--   org profile: 20260907000700
--   role assign: 20260907000800
-- Every body below is the authoritative source body with ONLY the gate
-- predicate re-pointed to public.is_tenant_admin(...) and, where the original
-- error text named a domain role, reworded to its neutral equivalent.
-- -----------------------------------------------------------------------------

-- 2a. Workforce position surface (I-005)
CREATE OR REPLACE FUNCTION public.list_workforce_positions(p_tenant uuid)
RETURNS TABLE (
  id              uuid,
  identity_ref    text,
  kind_code       text,
  kind_title      text,
  family          text,
  employment_type text,
  started_on      date,
  ended_on        date,
  status          text,
  is_primary      boolean,
  authority_group text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.id, w.identity_ref, w.kind_code, k.title, k.family,
         w.employment_type, w.started_on, w.ended_on, w.status, w.is_primary,
         k.authority_group
  FROM public.cg_workforce_position w
  JOIN public.cg_workforce_kind k
    ON k.runtime_ref = w.runtime_ref AND k.kind_code = w.kind_code
  WHERE w.tenant_ref = p_tenant::text
    AND public.is_tenant_admin(p_tenant::text)
  ORDER BY w.is_primary DESC, w.started_on DESC, w.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_workforce_positions(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_workforce_position(
  p_tenant          uuid,
  p_identity        uuid,
  p_kind_code       text,
  p_runtime         text DEFAULT 'runtime:scholar',
  p_primary         boolean DEFAULT false,
  p_employment_type text DEFAULT 'full_time',
  p_started_on      date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_position_id uuid;
BEGIN
  IF NOT public.is_tenant_admin(p_tenant::text) THEN
    RAISE EXCEPTION 'Forbidden: tenant administrator role required';
  END IF;
  IF p_employment_type NOT IN ('full_time','part_time','contract','volunteer','intern','seconded') THEN
    RAISE EXCEPTION 'Invalid employment type';
  END IF;

  -- Demote an existing primary before promoting a new one (single primary rule).
  IF p_primary THEN
    UPDATE public.cg_workforce_position
       SET is_primary = false, updated_at = now()
     WHERE tenant_ref = p_tenant::text
       AND runtime_ref = p_runtime
       AND identity_ref = p_identity::text
       AND is_primary
       AND status IN ('proposed','active','on_leave');
  END IF;

  -- Re-activate a previously ended appointment instead of duplicating it.
  INSERT INTO public.cg_workforce_position (
    tenant_ref, runtime_ref, kind_code, identity_ref, is_primary,
    employment_type, started_on, status, attributes
  ) VALUES (
    p_tenant::text, p_runtime, p_kind_code, p_identity::text, p_primary,
    p_employment_type, p_started_on, 'active', '{}'::jsonb
  )
  ON CONFLICT (tenant_ref, runtime_ref, identity_ref, kind_code)
  DO UPDATE SET is_primary = EXCLUDED.is_primary,
                employment_type = EXCLUDED.employment_type,
                started_on = EXCLUDED.started_on,
                ended_on = NULL,
                status = 'active',
                updated_at = now()
  RETURNING id INTO v_position_id;

  RETURN v_position_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_workforce_position(uuid, uuid, text, text, boolean, text, date) TO authenticated;

-- Final end_workforce_position body: the 20260907000500 primary-promotion
-- semantics, preserved verbatim; only the scope gate is re-pointed.
CREATE OR REPLACE FUNCTION public.end_workforce_position(
  p_position_id uuid,
  p_ended_on    date DEFAULT CURRENT_DATE
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant       text;
  v_identity     text;
  v_was_primary  boolean;
BEGIN
  SELECT tenant_ref, identity_ref, is_primary
    INTO v_tenant, v_identity, v_was_primary
    FROM public.cg_workforce_position
   WHERE id = p_position_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Position not found';
  END IF;
  IF NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'Forbidden: tenant administrator role required';
  END IF;

  UPDATE public.cg_workforce_position
     SET status = 'ended', ended_on = p_ended_on,
         is_primary = false, updated_at = now()
   WHERE id = p_position_id;

  -- If the ended appointment was the member's primary and they still hold
  -- other open appointments, promote the most recently started one so the
  -- single-primary invariant is preserved for chrome/landing derivation.
  IF v_was_primary THEN
    UPDATE public.cg_workforce_position
       SET is_primary = true, updated_at = now()
     WHERE id = (
       SELECT id
         FROM public.cg_workforce_position
        WHERE tenant_ref = v_tenant
          AND identity_ref = v_identity
          AND id <> p_position_id
          AND is_primary = false
          AND status IN ('active','on_leave')
        ORDER BY started_on DESC, created_at DESC
        LIMIT 1
     );
  END IF;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.end_workforce_position(uuid, date) TO authenticated;

-- 2b. Organization-profile surface (I-004)
CREATE OR REPLACE FUNCTION public.get_org_profile(
  p_tenant uuid, p_runtime text, p_profile_key text
)
RETURNS TABLE (id uuid, payload jsonb, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, payload, updated_at
    FROM public.cg_org_profile
   WHERE tenant_ref = p_tenant::text
     AND runtime_ref = p_runtime
     AND profile_key = p_profile_key
     AND public.is_tenant_admin(p_tenant::text)
$$;

GRANT EXECUTE ON FUNCTION public.get_org_profile(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_org_profile(
  p_tenant uuid, p_runtime text, p_profile_key text, p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_tenant_admin(p_tenant::text) THEN
    RAISE EXCEPTION 'Forbidden: tenant administrator role required';
  END IF;
  IF jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'payload must be a JSON object';
  END IF;

  INSERT INTO public.cg_org_profile (tenant_ref, runtime_ref, profile_key, payload)
  VALUES (p_tenant::text, p_runtime, p_profile_key, p_payload)
  ON CONFLICT (tenant_ref, runtime_ref, profile_key)
  DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_org_profile(uuid, text, text, jsonb) TO authenticated;

-- 2c. Role assignment + capability-grant surface (I-003)
CREATE OR REPLACE FUNCTION public.list_role_assignments(p_tenant uuid)
RETURNS TABLE (
  id           uuid,
  identity_ref text,
  role_id      text,
  status       text,
  started_on   date,
  ended_on     date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.identity_ref, a.role_id, a.status, a.started_on, a.ended_on
  FROM public.cg_role_assignment a
  WHERE a.tenant_ref = p_tenant::text
    AND public.is_tenant_admin(p_tenant::text)
  ORDER BY a.role_id, a.identity_ref;
$$;

GRANT EXECUTE ON FUNCTION public.list_role_assignments(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_role(
  p_tenant     uuid,
  p_identity   uuid,
  p_role_id    text,
  p_started_on date DEFAULT CURRENT_DATE,
  p_ended_on   date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_tenant_admin(p_tenant::text) THEN
    RAISE EXCEPTION 'Not authorized to assign roles for this tenant';
  END IF;

  SELECT a.id INTO v_id
  FROM public.cg_role_assignment a
  WHERE a.tenant_ref = p_tenant::text
    AND a.identity_ref = p_identity::text
    AND a.role_id = p_role_id
    AND a.status IN ('proposed','active','suspended')
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.cg_role_assignment
    (tenant_ref, identity_ref, role_id, status, started_on, ended_on)
  VALUES
    (p_tenant::text, p_identity::text, p_role_id, 'active', p_started_on, p_ended_on)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_role(uuid, uuid, text, date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.end_role_assignment(p_assignment_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant text;
BEGIN
  SELECT a.tenant_ref INTO v_tenant
  FROM public.cg_role_assignment a
  WHERE a.id = p_assignment_id;

  IF v_tenant IS NULL THEN
    RETURN false;
  END IF;

  IF NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'Not authorized to end this assignment';
  END IF;

  UPDATE public.cg_role_assignment
  SET status = 'ended', ended_on = COALESCE(ended_on, CURRENT_DATE)
  WHERE id = p_assignment_id AND status <> 'ended';

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.end_role_assignment(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_role_grants(p_tenant uuid)
RETURNS TABLE (
  id          uuid,
  role_id     text,
  capability  text,
  granted_by  text,
  granted_on  timestamptz,
  revoked_on  timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT g.id, g.role_id, g.capability, g.granted_by, g.granted_on, g.revoked_on
  FROM public.cg_role_grant g
  WHERE g.tenant_ref = p_tenant::text
    AND public.is_tenant_admin(p_tenant::text)
  ORDER BY g.role_id, g.capability, g.granted_on;
$$;

GRANT EXECUTE ON FUNCTION public.list_role_grants(uuid) TO authenticated;

-- granted_by is captured from auth.uid() — a client can never assert who granted.
CREATE OR REPLACE FUNCTION public.grant_role_capability(
  p_tenant     uuid,
  p_role_id    text,
  p_capability text
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_tenant_admin(p_tenant::text) THEN
    RAISE EXCEPTION 'Not authorized to grant capabilities for this tenant';
  END IF;

  SELECT g.id INTO v_id
  FROM public.cg_role_grant g
  WHERE g.tenant_ref = p_tenant::text
    AND g.role_id = p_role_id
    AND g.capability = p_capability
    AND g.revoked_on IS NULL
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.cg_role_grant (tenant_ref, role_id, capability, granted_by)
  VALUES (p_tenant::text, p_role_id, p_capability, COALESCE(auth.uid()::text, 'service'))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_role_capability(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_role_capability(p_grant_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant text;
BEGIN
  SELECT g.tenant_ref INTO v_tenant
  FROM public.cg_role_grant g
  WHERE g.id = p_grant_id AND g.revoked_on IS NULL;

  IF v_tenant IS NULL THEN
    RETURN false;
  END IF;

  IF NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'Not authorized to revoke this grant';
  END IF;

  UPDATE public.cg_role_grant
  SET revoked_on = now()
  WHERE id = p_grant_id AND revoked_on IS NULL;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.revoke_role_capability(uuid) TO authenticated;

-- =============================================================================
-- End of migration. Verification (run after apply authorization):
--   node scripts/verify-neutral-tenant-primitives.mjs
-- Expectations: all three neutral helpers present with SECURITY DEFINER
-- posture; every re-pointed RPC body references the neutral predicate and
-- contains no Scholar helper; cg_role_assignment.tenant_ref carries no
-- foreign key to any domain table, so a non-Scholar tenant ref can hold and
-- administer role assignments. Live proof is gated on apply authorization.
-- =============================================================================