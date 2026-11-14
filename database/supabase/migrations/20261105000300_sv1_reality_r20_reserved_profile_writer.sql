-- SV1-REALITY R20 (audit findings R-20 and R-21): reserved `reality.*` profile keys.
-- Status: AUTHORED, NOT APPLIED. Do not apply to production from the pull request.
-- Rollback: database/supabase/rollbacks/20261105000300_sv1_reality_r20_reserved_profile_writer.sql
-- ADR-074. Depends on R3 (20261105000100). Forward-only.
--
-- Problem: the onboarding interview (profile key `reality.onboarding_interview`) lives in the
-- generic public.cg_org_profile store. Its approval attestation was only as trustworthy as the
-- generic upsert_org_profile RPC, which lets any tenant administrator write any payload under any
-- key directly, bypassing the server validation of the interview (R-20). The server also did a
-- non-atomic read-modify-write (R-21).
--
-- Fix:
--   1. A trigger refuses any insert, update or delete of a `reality.*` row unless the transaction
--      has set the transaction-local flag coregrid.reality_writer. upsert_org_profile does not set
--      it, so the generic RPC can no longer write those keys. Reads are unchanged.
--   2. public.upsert_reality_profile(...) is the only writer. It is executable by service_role
--      only, so only the server (after it has verified the signed-in administrator and validated
--      the interview) can call it. It re-checks that the named actor holds the administrator role
--      in the tenant, bounds the payload, and does an atomic compare-and-set on the stored
--      revision, which closes the lost-update race.
--
-- Limits (not hidden): the flag is a transaction-local setting, so anything that can run SQL in
-- the database as a privileged role can still set it; this blocks the client-reachable paths
-- (PostgREST RPCs and table access), not a database superuser. Existing `reality.*` rows are
-- untouched and stay readable.

DO $r20_guard$
BEGIN
  IF to_regclass('public.cg_org_profile') IS NULL
     OR to_regclass('public.cg_role_assignment') IS NULL
     OR to_regclass('public.cg_org_membership') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cg_org_profile_reality_interview_size')
  THEN
    RAISE EXCEPTION 'R20 requires the organization profile store, the role tables and the R3 migration (20261105000100)'
      USING ERRCODE = '55000';
  END IF;
END
$r20_guard$;

CREATE OR REPLACE FUNCTION public.cg_org_profile_reserved_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  v_new text := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.profile_key END;
  v_old text := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.profile_key END;
BEGIN
  IF (left(coalesce(v_new, ''), 8) = 'reality.' OR left(coalesce(v_old, ''), 8) = 'reality.')
     AND coalesce(current_setting('coregrid.reality_writer', true), '') <> 'on'
  THEN
    RAISE EXCEPTION 'reserved profile key: reality.* is written only by the reality service'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_cg_org_profile_reserved_guard ON public.cg_org_profile;
CREATE TRIGGER trg_cg_org_profile_reserved_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.cg_org_profile
  FOR EACH ROW EXECUTE FUNCTION public.cg_org_profile_reserved_guard();

CREATE OR REPLACE FUNCTION public.upsert_reality_profile(
  p_tenant uuid, p_actor uuid, p_runtime text, p_profile_key text, p_payload jsonb, p_expected_revision integer
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_id uuid;
  v_rev numeric;
BEGIN
  IF p_tenant IS NULL OR p_actor IS NULL OR p_runtime IS NULL OR p_profile_key IS NULL THEN
    RAISE EXCEPTION 'tenant, actor, runtime and profile key are required';
  END IF;
  IF left(p_profile_key, 8) <> 'reality.' THEN
    RAISE EXCEPTION 'only reality.* profile keys are written here';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'payload must be a JSON object';
  END IF;
  IF pg_column_size(p_payload) > 262144 THEN
    RAISE EXCEPTION 'payload exceeds 256 KiB' USING ERRCODE = '23514';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'expected revision must be a non-negative integer';
  END IF;

  -- The named actor must hold the administrator role in this tenant (same rule as
  -- holds_tenant_role, with the actor passed in because the caller is the service role).
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.cg_role_assignment r
       WHERE r.tenant_ref = p_tenant::text AND r.identity_ref = p_actor::text
         AND r.role_id = 'role:administrator' AND r.status = 'active'
         AND r.started_on <= CURRENT_DATE AND (r.ended_on IS NULL OR r.ended_on >= CURRENT_DATE))
    OR EXISTS (
      SELECT 1 FROM public.cg_org_membership m
       WHERE m.tenant_id = p_tenant::text AND m.principal_ref = p_actor::text
         AND m.role_ref = 'role:administrator' AND m.state = 'active')
  ) THEN
    RAISE EXCEPTION 'Forbidden: tenant administrator role required' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('coregrid.reality_writer', 'on', true);

  SELECT p.id, CASE WHEN jsonb_typeof(p.payload -> 'revision') = 'number'
                    THEN (p.payload ->> 'revision')::numeric ELSE 0 END
    INTO v_id, v_rev
    FROM public.cg_org_profile p
   WHERE p.tenant_ref = p_tenant::text AND p.runtime_ref = p_runtime AND p.profile_key = p_profile_key
   FOR UPDATE;

  IF FOUND THEN
    IF v_rev IS DISTINCT FROM p_expected_revision::numeric THEN
      PERFORM set_config('coregrid.reality_writer', '', true);
      RAISE EXCEPTION 'revision_conflict: stored revision %, expected %', v_rev, p_expected_revision
        USING ERRCODE = '40001';
    END IF;
    UPDATE public.cg_org_profile SET payload = p_payload, updated_at = now() WHERE id = v_id;
  ELSE
    IF p_expected_revision <> 0 THEN
      PERFORM set_config('coregrid.reality_writer', '', true);
      RAISE EXCEPTION 'revision_conflict: nothing stored, expected %', p_expected_revision
        USING ERRCODE = '40001';
    END IF;
    INSERT INTO public.cg_org_profile (tenant_ref, runtime_ref, profile_key, payload)
    VALUES (p_tenant::text, p_runtime, p_profile_key, p_payload)
    ON CONFLICT (tenant_ref, runtime_ref, profile_key) DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      PERFORM set_config('coregrid.reality_writer', '', true);
      RAISE EXCEPTION 'revision_conflict: a concurrent write created the profile' USING ERRCODE = '40001';
    END IF;
  END IF;

  PERFORM set_config('coregrid.reality_writer', '', true);
  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION public.upsert_reality_profile(uuid, uuid, text, text, jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_reality_profile(uuid, uuid, text, text, jsonb, integer) TO service_role;

COMMENT ON FUNCTION public.upsert_reality_profile(uuid, uuid, text, text, jsonb, integer) IS
  'SV1-REALITY R20: sole writer of reality.* profile keys. service_role only; atomic compare-and-set on the stored revision.';
