-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.
-- =============================================================================
-- M6 (mission E-016, ADR-148): console onboarding queue, plan review and approval, and ONE
-- database transaction that provisions an organization from an approved plan.
-- Rollback: database/supabase/rollbacks/20261117003100_sherivs_m6_onboarding_provisioning.sql
--
-- Extends, never duplicates:
--   * public.onboarding_requests (M5b, ADR-108) gains the review state: the generated plan, the
--     plan under review, its database-computed hash, the approval record and the provisioned
--     organization. No second request or plan table.
--   * public.onboarding_sessions (021) stays the application record: provisioning writes one row
--     per organization with plan, plan_hash and applied_result, linked to its request.
--   * public.role_pack_install (M2b, ADR-114) installs the pack; public.organization_root_gaps()
--     (M1, ADR-102) proves the kernel and console records exist before commit.
--   * public.feature_flags (018) holds the self-serve switch, seeded OFF and locked.
--   * organization_invitations is the database form of lib/onboarding/invitations.ts, which had
--     no persistence until now. It stores the first-admin invitation; delivery stays with the
--     communications layer (P10) and is NOT done here.
--
-- Who may call: every function below is EXECUTE for service_role only (the console server, after
-- it has verified the session, AAL2 and the passkey step-up). The acting staff member is passed
-- as p_actor and is re-checked here against platform_staff / platform_roles, so a forged id that
-- is not an active staff member with the capability is refused. Capabilities used (existing):
--   platform.onboarding.read   read the queue            (onboarding role)
--   platform.onboarding.handle assign, generate and edit (onboarding role)
--   platform.tenants.manage    approve and provision     (operations role)
-- Super admins are NOT implicitly allowed, matching assertConsoleCapability() in the console.
--
-- Plan hash: sha-256 (hex) of the stored plan's canonical jsonb text, computed by the database
-- whenever the plan changes. The console binds the passkey challenge to it; approve and provision
-- both refuse a hash that is not the current one.
--
-- Separation of duties: the staff member who last EDITED the plan cannot approve it. A plan that
-- is exactly the generated plan has no editor and may be approved by any holder of
-- platform.tenants.manage.
-- =============================================================================

DO $$
DECLARE missing text[] := ARRAY[]::text[];
BEGIN
  IF to_regclass('public.onboarding_requests') IS NULL THEN missing := missing || 'public.onboarding_requests'::text; END IF;
  IF to_regclass('public.reality_interview_sessions') IS NULL THEN missing := missing || 'public.reality_interview_sessions'::text; END IF;
  IF to_regclass('public.onboarding_sessions') IS NULL THEN missing := missing || 'public.onboarding_sessions'::text; END IF;
  IF to_regclass('public.institution_profile') IS NULL THEN missing := missing || 'public.institution_profile'::text; END IF;
  IF to_regclass('public.feature_flags') IS NULL THEN missing := missing || 'public.feature_flags'::text; END IF;
  IF to_regclass('public.websites') IS NULL THEN missing := missing || 'public.websites'::text; END IF;
  IF to_regprocedure('public.organization_root_gaps()') IS NULL THEN missing := missing || 'public.organization_root_gaps()'::text; END IF;
  IF to_regprocedure('public.role_pack_install(uuid,text,text)') IS NULL THEN missing := missing || 'public.role_pack_install(uuid,text,text)'::text; END IF;
  IF to_regprocedure('public._website_validate(jsonb)') IS NULL THEN missing := missing || 'public._website_validate(jsonb)'::text; END IF;
  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'M6 requires M1, M2b, M5b, 018, 021 and the website engine; missing: %',
      array_to_string(missing, ', ') USING ERRCODE = '55000';
  END IF;
END $$;

-- 1. Review state on the request ------------------------------------------------------------
ALTER TABLE public.onboarding_requests
  ADD COLUMN IF NOT EXISTS generated_plan      jsonb,
  ADD COLUMN IF NOT EXISTS review_plan         jsonb,
  ADD COLUMN IF NOT EXISTS plan_hash           text,
  ADD COLUMN IF NOT EXISTS plan_revision       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS plan_graph_version  text,
  ADD COLUMN IF NOT EXISTS plan_edited_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS plan_edited_at      timestamptz,
  ADD COLUMN IF NOT EXISTS approved_plan_hash  text,
  ADD COLUMN IF NOT EXISTS approved_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at         timestamptz,
  ADD COLUMN IF NOT EXISTS approval_step_up    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS provisioned_org_id  uuid REFERENCES public.schools(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provisioned_at      timestamptz;

ALTER TABLE public.onboarding_requests DROP CONSTRAINT IF EXISTS onboarding_requests_m6_plan_shape;
ALTER TABLE public.onboarding_requests ADD CONSTRAINT onboarding_requests_m6_plan_shape CHECK (
  (generated_plan IS NULL OR (jsonb_typeof(generated_plan) = 'object' AND octet_length(generated_plan::text) <= 65536))
  AND (review_plan IS NULL OR (jsonb_typeof(review_plan) = 'object' AND octet_length(review_plan::text) <= 65536))
  AND (plan_hash IS NULL OR plan_hash ~ '^[0-9a-f]{64}$')
  AND (approved_plan_hash IS NULL OR approved_plan_hash ~ '^[0-9a-f]{64}$')
  AND (plan_graph_version IS NULL OR plan_graph_version ~ '^[A-Za-z0-9._-]{1,32}$')
  AND plan_revision >= 0
  AND ((review_plan IS NULL) = (plan_hash IS NULL)));
ALTER TABLE public.onboarding_requests DROP CONSTRAINT IF EXISTS onboarding_requests_m6_approval_shape;
ALTER TABLE public.onboarding_requests ADD CONSTRAINT onboarding_requests_m6_approval_shape CHECK (
  (status NOT IN ('approved', 'provisioned')
     OR (approved_plan_hash IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND approval_step_up))
  AND (status <> 'provisioned' OR (provisioned_org_id IS NOT NULL OR provisioned_at IS NOT NULL))) NOT VALID;
-- NOT VALID: checked for every new write. Rows approved before a rollback and re-apply of this
-- file lost their approval columns with the rollback and are not re-checked.
CREATE UNIQUE INDEX IF NOT EXISTS onboarding_requests_one_org
  ON public.onboarding_requests (provisioned_org_id) WHERE provisioned_org_id IS NOT NULL;

-- 2. The application record links back to its request (idempotency key) --------------------------
ALTER TABLE public.onboarding_sessions
  ADD COLUMN IF NOT EXISTS onboarding_request_id uuid REFERENCES public.onboarding_requests(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS onboarding_sessions_one_per_request
  ON public.onboarding_sessions (onboarding_request_id) WHERE onboarding_request_id IS NOT NULL;

-- 3. First-admin invitations (database form of lib/onboarding/invitations.ts) -----------------------
CREATE TABLE IF NOT EXISTS public.organization_invitations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  workspace_unit_id uuid NOT NULL,
  inviter_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  intended_role     text NOT NULL CHECK (intended_role ~ '^[a-z][a-z0-9_]{0,79}$'),
  invitee_email     text NOT NULL CHECK (length(invitee_email) BETWEEN 6 AND 254
                                         AND invitee_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  channel_ref       text CHECK (channel_ref IS NULL OR length(channel_ref) <= 120),
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  expires_at        timestamptz NOT NULL,
  accepted_at       timestamptz,
  accepted_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_request_id uuid REFERENCES public.onboarding_requests(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_invitations_unit_fk FOREIGN KEY (workspace_unit_id, org_id)
    REFERENCES public.workspace_org_units (id, org_id) ON DELETE CASCADE,
  CONSTRAINT organization_invitations_expiry CHECK (expires_at > created_at),
  CONSTRAINT organization_invitations_accepted CHECK ((status = 'accepted') = (accepted_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS organization_invitations_org_idx ON public.organization_invitations (org_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS organization_invitations_one_per_request
  ON public.organization_invitations (source_request_id) WHERE source_request_id IS NOT NULL;

ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invitations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.organization_invitations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.organization_invitations TO service_role;
DROP POLICY IF EXISTS organization_invitations_service ON public.organization_invitations;
CREATE POLICY organization_invitations_service ON public.organization_invitations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP TRIGGER IF EXISTS trg_organization_invitations_audit ON public.organization_invitations;
CREATE TRIGGER trg_organization_invitations_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.organization_invitations
  FOR EACH ROW EXECUTE FUNCTION public.scholar_audit();

-- 4. Self-serve provisioning switch: OFF and locked (only a reviewed migration can change it) -------
INSERT INTO public.feature_flags (key, enabled, locked, description)
SELECT 'self_serve_provisioning', false, true,
       'Self-serve organization provisioning without staff review. OFF; enable only with the founder''s written decision, by a reviewed migration.'
 WHERE NOT EXISTS (SELECT 1 FROM public.feature_flags f WHERE f.key = 'self_serve_provisioning' AND f.org_id IS NULL);

-- 5. Helpers (internal) ----------------------------------------------------------------------------
-- Trusted server context: the service role, or a direct database session (migrations, psql).
CREATE OR REPLACE FUNCTION public.onboarding_m6_caller_is_service()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(auth.role(), '') = 'service_role'
      OR (auth.uid() IS NULL AND coalesce(auth.role(), '') = ''
          AND session_user NOT IN ('authenticator', 'anon', 'authenticated'));
$$;

-- Same rule as has_internal_console_capability(), but for an actor id the server verified.
CREATE OR REPLACE FUNCTION public.onboarding_m6_actor_can(p_actor uuid, p_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_actor IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.platform_staff s
      JOIN public.platform_staff_roles sr ON sr.staff_id = s.id
      JOIN public.platform_roles r ON r.code = sr.role_code
     WHERE s.id = p_actor AND s.status = 'active' AND p_capability = ANY (r.capabilities));
$$;

CREATE OR REPLACE FUNCTION public.onboarding_m6_require(p_actor uuid, p_capabilities text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE c text;
BEGIN
  IF NOT public.onboarding_m6_caller_is_service() THEN
    RAISE EXCEPTION 'onboarding review runs through the console server only' USING ERRCODE = '42501';
  END IF;
  FOREACH c IN ARRAY p_capabilities LOOP
    IF public.onboarding_m6_actor_can(p_actor, c) THEN RETURN; END IF;
  END LOOP;
  RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
END $$;

CREATE OR REPLACE FUNCTION public.onboarding_m6_plan_hash(p_plan jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT encode(pg_catalog.sha256(convert_to(p_plan::text, 'UTF8')), 'hex');
$$;

-- Platform audit row: no organization, no personal data. The staff actor is recorded in the
-- detail (audit_logs.user_id references tenant users, which staff usually are not).
CREATE OR REPLACE FUNCTION public.onboarding_m6_audit(
  p_org uuid, p_actor uuid, p_action text, p_record uuid, p_detail jsonb)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.audit_logs (school_id, user_id, action, table_name, record_id, new_value)
  VALUES (p_org, (SELECT u.id FROM public.users u WHERE u.id = p_actor), p_action,
          'onboarding_requests', p_record,
          coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('actor', p_actor));
$$;

-- 6. Queue actions -------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.onboarding_review_assign(p_request uuid, p_actor uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_status text;
BEGIN
  PERFORM public.onboarding_m6_require(p_actor, ARRAY['platform.onboarding.handle', 'platform.tenants.manage']);
  SELECT r.status INTO v_status FROM public.onboarding_requests r WHERE r.id = p_request FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found' USING ERRCODE = 'PT404'; END IF;
  IF v_status IN ('provisioned', 'rejected') THEN
    RAISE EXCEPTION 'request is closed' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.onboarding_requests SET assigned_staff = p_actor, updated_at = now() WHERE id = p_request;
  PERFORM public.onboarding_m6_audit(NULL, p_actor, 'platform.onboarding.assign', p_request,
    jsonb_build_object('assigned_to', p_actor));
  RETURN p_actor;
END $$;

-- Store a plan for review. p_kind 'generated' replaces the generated plan and the plan under
-- review (the console server produced it from the interview answers); 'edited' replaces only the
-- plan under review and records the editor. Optimistic: p_expected_revision must be current.
CREATE OR REPLACE FUNCTION public.onboarding_review_set_plan(
  p_request uuid, p_actor uuid, p_kind text, p_plan jsonb, p_graph_version text, p_expected_revision integer)
RETURNS TABLE (plan_hash text, plan_revision integer, status text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.onboarding_requests%ROWTYPE; v_hash text; v_status text;
BEGIN
  PERFORM public.onboarding_m6_require(p_actor, ARRAY['platform.onboarding.handle']);
  IF p_kind NOT IN ('generated', 'edited') THEN RAISE EXCEPTION 'unknown plan kind' USING ERRCODE = '22023'; END IF;
  IF p_plan IS NULL OR jsonb_typeof(p_plan) <> 'object'
     OR NOT (p_plan ?& ARRAY['rolePack', 'orgUnits', 'institutionProfile', 'modules', 'admissions']) THEN
    RAISE EXCEPTION 'plan is not a provisioning plan' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.onboarding_requests q WHERE q.id = p_request FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found' USING ERRCODE = 'PT404'; END IF;
  IF r.status IN ('provisioned', 'rejected') THEN RAISE EXCEPTION 'request is closed' USING ERRCODE = 'PT409'; END IF;
  IF r.plan_revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'plan changed since you loaded it' USING ERRCODE = 'PT409';
  END IF;
  IF p_kind = 'edited' AND r.generated_plan IS NULL THEN
    RAISE EXCEPTION 'generate the plan before editing it' USING ERRCODE = 'PT409';
  END IF;
  v_hash := public.onboarding_m6_plan_hash(p_plan);
  v_status := CASE WHEN p_kind = 'generated' THEN 'plan_ready' ELSE 'under_review' END;
  -- Any change to the plan withdraws an earlier approval.
  UPDATE public.onboarding_requests q SET
      generated_plan     = CASE WHEN p_kind = 'generated' THEN p_plan ELSE q.generated_plan END,
      plan_graph_version = CASE WHEN p_kind = 'generated' THEN p_graph_version ELSE q.plan_graph_version END,
      review_plan        = p_plan,
      plan_hash          = v_hash,
      plan_revision      = q.plan_revision + 1,
      plan_edited_by     = CASE WHEN p_kind = 'edited' AND p_plan IS DISTINCT FROM q.generated_plan THEN p_actor END,
      plan_edited_at     = CASE WHEN p_kind = 'edited' AND p_plan IS DISTINCT FROM q.generated_plan THEN now() END,
      approved_plan_hash = NULL, approved_by = NULL, approved_at = NULL, approval_step_up = false,
      status             = v_status,
      updated_at         = now()
   WHERE q.id = p_request;
  PERFORM public.onboarding_m6_audit(NULL, p_actor, 'platform.onboarding.plan_' || p_kind, p_request,
    jsonb_build_object('plan_hash', v_hash, 'revision', r.plan_revision + 1,
                       'previous_hash', r.plan_hash, 'withdrew_approval', r.status = 'approved'));
  RETURN QUERY SELECT v_hash, r.plan_revision + 1, v_status;
END $$;

-- Approve the plan under review. The console server calls this only after it verified a passkey
-- assertion bound to this request and this plan hash; p_step_up_verified records that, and a
-- false value is refused.
CREATE OR REPLACE FUNCTION public.onboarding_review_approve(
  p_request uuid, p_actor uuid, p_expected_plan_hash text, p_step_up_verified boolean)
RETURNS TABLE (plan_hash text, approved_at timestamptz, replay boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.onboarding_requests%ROWTYPE;
BEGIN
  PERFORM public.onboarding_m6_require(p_actor, ARRAY['platform.tenants.manage']);
  IF p_step_up_verified IS NOT TRUE THEN
    RAISE EXCEPTION 'a passkey step-up is required to approve' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.onboarding_requests q WHERE q.id = p_request FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found' USING ERRCODE = 'PT404'; END IF;
  IF r.plan_hash IS NULL OR r.plan_hash IS DISTINCT FROM p_expected_plan_hash THEN
    RAISE EXCEPTION 'plan changed since you reviewed it' USING ERRCODE = 'PT409';
  END IF;
  IF r.status IN ('approved', 'provisioned') AND r.approved_plan_hash = p_expected_plan_hash THEN
    RETURN QUERY SELECT r.approved_plan_hash, r.approved_at, true;
    RETURN;
  END IF;
  IF r.status NOT IN ('plan_ready', 'under_review') THEN
    RAISE EXCEPTION 'request is not awaiting approval' USING ERRCODE = 'PT409';
  END IF;
  IF r.plan_edited_by IS NOT NULL AND r.plan_edited_by = p_actor THEN
    RAISE EXCEPTION 'the editor of a plan cannot approve it' USING ERRCODE = '42501';
  END IF;
  UPDATE public.onboarding_requests q
     SET status = 'approved', approved_plan_hash = r.plan_hash, approved_by = p_actor,
         approved_at = now(), approval_step_up = true, updated_at = now()
   WHERE q.id = p_request;
  PERFORM public.onboarding_m6_audit(NULL, p_actor, 'platform.onboarding.approve', p_request,
    jsonb_build_object('plan_hash', r.plan_hash, 'revision', r.plan_revision, 'step_up', true,
                       'editor', r.plan_edited_by));
  RETURN QUERY SELECT r.plan_hash, now(), false;
END $$;

-- 7. Provisioning ---------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.onboarding_m6_slug(p_name text)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE base text; cand text; i int := 1;
BEGIN
  base := btrim(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g'), '-');
  base := btrim(left(base, 44), '-');
  IF length(base) < 3 THEN base := 'org-' || coalesce(nullif(base, ''), 'new'); END IF;
  cand := base;
  WHILE EXISTS (SELECT 1 FROM public.schools s WHERE s.slug = cand)
     OR EXISTS (SELECT 1 FROM public.cg_tenant t WHERE t.slug = cand)
     OR EXISTS (SELECT 1 FROM public.platform_organization p WHERE p.slug = cand) LOOP
    i := i + 1;
    IF i > 50 THEN RAISE EXCEPTION 'no free slug for this name' USING ERRCODE = '23505'; END IF;
    cand := base || '-' || i;
  END LOOP;
  RETURN cand;
END $$;

-- Provision the approved plan. ONE transaction: any error rolls back every row written here,
-- including the pack installation, the invitation and the website draft. Running it again for a
-- provisioned request returns the first result and writes nothing.
--
-- p_channel 'console' is staff provisioning. 'self_serve' is refused unless the locked flag
-- self_serve_provisioning is on; even then only a private institution whose contact has a
-- confirmed account with the same email may provision, and a staff-approved plan is still needed.
--
-- p_website_draft is the draft site document the console server generated from the plan (no
-- client input reaches it); it is validated by the website engine's own validator. NULL records
-- the website as pending.
CREATE OR REPLACE FUNCTION public.onboarding_provision_from_plan(
  p_request uuid, p_actor uuid, p_expected_plan_hash text, p_website_draft jsonb DEFAULT NULL,
  p_channel text DEFAULT 'console')
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.onboarding_requests%ROWTYPE;
  p jsonb; prof jsonb;
  v_org uuid; v_slug text; v_existing jsonb;
  v_ownership text; v_calendar text; v_type text; v_grading text; v_category text;
  v_unit jsonb; v_unit_id uuid; v_parent uuid; v_root uuid; v_units jsonb := '{}'::jsonb; v_kind text;
  v_pack jsonb; v_invite uuid; v_website text; v_answers jsonb; v_result jsonb; v_prev_sub text;
  v_session uuid; v_po uuid; v_lifecycle text := 'ready_for_activation';
BEGIN
  IF NOT public.onboarding_m6_caller_is_service() THEN
    RAISE EXCEPTION 'provisioning runs through the console server only' USING ERRCODE = '42501';
  END IF;
  IF p_channel = 'console' THEN
    PERFORM public.onboarding_m6_require(p_actor, ARRAY['platform.tenants.manage']);
  ELSIF p_channel = 'self_serve' THEN
    IF NOT coalesce(public.flag_on('self_serve_provisioning', NULL), false) THEN
      RAISE EXCEPTION 'self-serve provisioning is off' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'unknown channel' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO r FROM public.onboarding_requests q WHERE q.id = p_request FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found' USING ERRCODE = 'PT404'; END IF;

  -- Idempotent replay: the first result, nothing new.
  IF r.status = 'provisioned' THEN
    IF r.approved_plan_hash IS DISTINCT FROM p_expected_plan_hash THEN
      RAISE EXCEPTION 'plan changed since you reviewed it' USING ERRCODE = 'PT409';
    END IF;
    SELECT s.applied_result INTO v_existing FROM public.onboarding_sessions s
     WHERE s.onboarding_request_id = p_request;
    RETURN coalesce(v_existing, '{}'::jsonb) || jsonb_build_object('replay', true);
  END IF;
  IF r.status <> 'approved' OR r.approved_plan_hash IS NULL
     OR r.plan_hash IS DISTINCT FROM r.approved_plan_hash
     OR r.approved_plan_hash IS DISTINCT FROM p_expected_plan_hash
     OR public.onboarding_m6_plan_hash(r.review_plan) IS DISTINCT FROM r.approved_plan_hash THEN
    RAISE EXCEPTION 'plan changed since you reviewed it, or it is not approved' USING ERRCODE = 'PT409';
  END IF;
  IF p_channel = 'self_serve' AND NOT EXISTS (
       SELECT 1 FROM auth.users u WHERE u.id = p_actor AND lower(u.email) = lower(r.contact_email)
          AND u.email_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  -- Validate and map the plan before any write.
  p := r.review_plan;
  prof := p->'institutionProfile';
  v_type := prof->>'institution_type';
  IF v_type IS NULL OR v_type !~ '^[a-z][a-z0-9_]{1,60}$' THEN
    RAISE EXCEPTION 'plan has no institution type' USING ERRCODE = '22023';
  END IF;
  v_ownership := CASE prof->>'ownership'
    WHEN 'federal' THEN 'public_federal' WHEN 'state' THEN 'public_state'
    WHEN 'local_government' THEN 'public_lga' WHEN 'private' THEN 'private'
    WHEN 'faith_based' THEN 'mission'
    WHEN 'public_federal' THEN 'public_federal' WHEN 'public_state' THEN 'public_state'
    WHEN 'public_lga' THEN 'public_lga' WHEN 'mission' THEN 'mission' WHEN 'community' THEN 'community'
    WHEN 'military' THEN 'military' WHEN 'ngo' THEN 'ngo' END;
  IF v_ownership IS NULL THEN
    RAISE EXCEPTION 'plan ownership % cannot be provisioned; set a specific ownership', prof->>'ownership'
      USING ERRCODE = '22023';
  END IF;
  IF p_channel = 'self_serve' AND v_ownership <> 'private' THEN
    RAISE EXCEPTION 'self-serve provisioning is for private institutions only' USING ERRCODE = '42501';
  END IF;
  v_calendar := CASE coalesce(prof->>'calendar_model', p->>'calendarModel')
    WHEN 'three_term' THEN 'term' WHEN 'term' THEN 'term'
    WHEN 'two_semester' THEN 'semester' WHEN 'semester' THEN 'semester'
    WHEN 'trimester' THEN 'trimester' WHEN 'three_semester' THEN 'trimester' END;
  IF v_calendar IS NULL THEN
    RAISE EXCEPTION 'plan calendar model % cannot be provisioned', coalesce(prof->>'calendar_model', p->>'calendarModel')
      USING ERRCODE = '22023';
  END IF;
  v_grading := coalesce(prof->>'grading_system', p->>'gradingSystem');
  IF v_grading IS NULL OR v_grading !~ '^[a-z][a-z0-9_]{1,60}$' THEN
    RAISE EXCEPTION 'plan assessment system is not valid' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p->'orgUnits') <> 'array' OR jsonb_array_length(p->'orgUnits') NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'plan must list 1 to 200 units' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p->'rolePack') <> 'object' OR coalesce(p#>>'{rolePack,code}', '') = '' THEN
    RAISE EXCEPTION 'plan names no role pack' USING ERRCODE = '22023';
  END IF;
  v_category := CASE WHEN v_type LIKE 'university%' THEN 'university'
                     WHEN v_type LIKE 'polytechnic%' THEN 'polytechnic' ELSE 'other' END;
  v_slug := public.onboarding_m6_slug(r.org_name);

  -- (a) the organization root
  INSERT INTO public.schools (name, slug, email, phone, is_active, onboarding_completed, institution_category)
  VALUES (left(btrim(r.org_name), 160), v_slug, r.contact_email, r.contact_phone, false, false, v_category)
  RETURNING id INTO v_org;

  -- (b) the kernel record (same id, by convention) and its map
  INSERT INTO public.cg_tenant (id, tenant_type, name, slug, status)
  VALUES (v_org, 'organization', left(btrim(r.org_name), 200), v_slug, 'PROVISIONING');
  INSERT INTO public.school_tenant_map (school_id, tenant_id) VALUES (v_org, v_org) ON CONFLICT DO NOTHING;

  -- (c) the console record
  INSERT INTO public.platform_organization (slug, display_name, legal_name, country, region, city,
      lifecycle_state, questionnaire, questionnaire_step, enabled_runtime, outstanding_requirements,
      created_by, reviewed_by, reviewed_at, provisioned_at, school_id)
  VALUES (v_slug, left(btrim(r.org_name), 120),
      CASE WHEN length(btrim(r.org_name)) BETWEEN 2 AND 160 THEN btrim(r.org_name) END,
      'Nigeria', r.state, r.lga, v_lifecycle,
      jsonb_build_object('source', 'onboarding_request', 'request_id', r.id, 'institution_type', v_type),
      'review', 'scholar', '["deliver_first_admin_invitation"]'::jsonb,
      p_actor, r.approved_by, r.approved_at, now(), v_org)
  RETURNING id INTO v_po;
  INSERT INTO public.platform_organization_transition (organization_id, from_state, to_state, actor_id, reason)
  VALUES (v_po, NULL, v_lifecycle, p_actor, 'provisioned from approved onboarding plan');

  -- (d) the institution profile
  INSERT INTO public.institution_profile (org_id, institution_type, ownership, regulators, calendar_model,
      grading_system, curricula, languages, created_by)
  VALUES (v_org, v_type, v_ownership,
      coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(prof->'regulators', '[]'::jsonb))), '{}'),
      v_calendar, v_grading,
      coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(prof->'curricula', p->'curricula', '[]'::jsonb))), '{}'),
      coalesce(nullif(ARRAY(SELECT jsonb_array_elements_text(coalesce(prof->'languages', '[]'::jsonb))), '{}'), ARRAY['en']),
      p_actor);

  -- (e) org units from the plan. The unit tree's audit trigger needs an acting identity, so the
  -- verified staff id is the request identity for these inserts only, then restored.
  v_prev_sub := current_setting('request.jwt.claim.sub', true);
  PERFORM set_config('request.jwt.claim.sub', p_actor::text, true);
  FOR v_unit IN SELECT * FROM jsonb_array_elements(p->'orgUnits') LOOP
    v_kind := CASE v_unit->>'kind'
      WHEN 'organization' THEN 'institution' WHEN 'school' THEN 'school_college' WHEN 'trade' THEN 'programme'
      ELSE v_unit->>'kind' END;
    IF v_unit->>'parentKey' IS NULL THEN
      v_parent := NULL;
    ELSE
      v_parent := (v_units->>(v_unit->>'parentKey'))::uuid;
      IF v_parent IS NULL THEN
        RAISE EXCEPTION 'unit % names a parent that is not listed before it', v_unit->>'key' USING ERRCODE = '22023';
      END IF;
    END IF;
    IF v_units ? (v_unit->>'key') THEN
      RAISE EXCEPTION 'unit key % appears twice', v_unit->>'key' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.workspace_org_units (org_id, parent_unit_id, unit_type, code, name)
    VALUES (v_org, v_parent, v_kind, replace(v_unit->>'key', '_', '-'),
            left(initcap(replace(coalesce(nullif(v_unit->>'name', ''), v_unit->>'key'), '_', ' ')), 120))
    RETURNING id INTO v_unit_id;
    v_units := v_units || jsonb_build_object(v_unit->>'key', v_unit_id);
    IF v_root IS NULL AND v_parent IS NULL THEN v_root := v_unit_id; END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_prev_sub, ''), true);
  IF v_root IS NULL THEN RAISE EXCEPTION 'plan has no root unit' USING ERRCODE = '22023'; END IF;

  -- (f) the role pack (M2b). Unpublished or placeholder packs are refused there.
  v_pack := public.role_pack_install(v_org, p#>>'{rolePack,code}', p#>>'{rolePack,version}');

  -- (g) first-admin invitation (delivery is the communications layer's job)
  INSERT INTO public.organization_invitations (org_id, workspace_unit_id, inviter_id, intended_role,
      invitee_email, expires_at, source_request_id)
  VALUES (v_org, v_root, coalesce(r.approved_by, p_actor), 'org_administrator', r.contact_email,
          now() + interval '14 days', r.id)
  RETURNING id INTO v_invite;

  -- (h) website draft (table exists on master); admissions settings have no table on master yet.
  IF p_website_draft IS NOT NULL THEN
    PERFORM public._website_validate(p_website_draft);
    INSERT INTO public.websites (school_id, draft, draft_rev, updated_by) VALUES (v_org, p_website_draft, 1, p_actor);
    INSERT INTO public.website_audit (school_id, actor, action) VALUES (v_org, p_actor, 'create');
    v_website := 'drafted';
  ELSE
    v_website := 'pending';
  END IF;

  SELECT s.answers INTO v_answers FROM public.reality_interview_sessions s
   WHERE s.request_id = r.id ORDER BY s.completed_at DESC NULLS LAST, s.updated_at DESC LIMIT 1;

  v_result := jsonb_build_object(
    'organization_id', v_org,
    'slug', v_slug,
    'kernel_record', v_org,
    'console_record', v_po,
    'console_lifecycle', v_lifecycle,
    'institution_profile', jsonb_build_object('institution_type', v_type, 'ownership', v_ownership,
                                              'calendar_model', v_calendar, 'grading_system', v_grading),
    'org_units', v_units,
    'role_pack', v_pack,
    'first_admin_invitation', jsonb_build_object('id', v_invite, 'status', 'pending', 'delivery', 'pending'),
    'website', jsonb_build_object('status', v_website),
    'admissions', jsonb_build_object('status', 'pending', 'reason', 'no admissions settings table on master',
                                     'planned', p->'admissions'),
    'authority_links', jsonb_build_object('status', 'pending', 'candidates', coalesce(p->'authorityLinkCandidates', '[]'::jsonb)),
    'plan_hash', r.approved_plan_hash,
    'approved_by', r.approved_by,
    'provisioned_by', p_actor,
    'channel', p_channel);

  -- (i) the application record and the request
  INSERT INTO public.onboarding_sessions (school_id, answers, status, plan, plan_hash, applied_at,
      applied_result, created_by, onboarding_request_id)
  VALUES (v_org, coalesce(v_answers, '{}'::jsonb), 'applied', p, r.approved_plan_hash, now(), v_result,
          p_actor, r.id)
  RETURNING id INTO v_session;
  UPDATE public.onboarding_requests q
     SET status = 'provisioned', provisioned_org_id = v_org, provisioned_at = now(), updated_at = now()
   WHERE q.id = r.id;

  -- (j) no partial tenant: every root record must exist before commit.
  IF EXISTS (SELECT 1 FROM public.organization_root_gaps() g WHERE g.org_id = v_org) THEN
    RAISE EXCEPTION 'organization % is incomplete: %', v_org,
      (SELECT string_agg(g.missing, ', ') FROM public.organization_root_gaps() g WHERE g.org_id = v_org)
      USING ERRCODE = '55000';
  END IF;

  PERFORM public.onboarding_m6_audit(v_org, p_actor, 'platform.onboarding.provision', r.id,
    jsonb_build_object('plan_hash', r.approved_plan_hash, 'approved_by', r.approved_by,
                       'session_id', v_session, 'channel', p_channel, 'units', jsonb_array_length(p->'orgUnits'),
                       'pack', v_pack->>'outcome', 'website', v_website));
  RETURN v_result || jsonb_build_object('replay', false);
END $$;

-- 8. Privileges: service role only -----------------------------------------------------------------
REVOKE ALL ON FUNCTION public.onboarding_m6_caller_is_service() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.onboarding_m6_actor_can(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.onboarding_m6_require(uuid, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.onboarding_m6_plan_hash(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.onboarding_m6_audit(uuid, uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.onboarding_m6_slug(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.onboarding_review_assign(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.onboarding_review_set_plan(uuid, uuid, text, jsonb, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.onboarding_review_approve(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.onboarding_provision_from_plan(uuid, uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.onboarding_m6_caller_is_service() TO service_role;
GRANT EXECUTE ON FUNCTION public.onboarding_m6_actor_can(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.onboarding_m6_require(uuid, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.onboarding_m6_plan_hash(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.onboarding_review_assign(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.onboarding_review_set_plan(uuid, uuid, text, jsonb, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.onboarding_review_approve(uuid, uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.onboarding_provision_from_plan(uuid, uuid, text, jsonb, text) TO service_role;

-- Verification after an apply (read-only):
--   SELECT enabled, locked FROM public.feature_flags WHERE key = 'self_serve_provisioning' AND org_id IS NULL; [false, true]
--   SELECT has_function_privilege('authenticated', 'public.onboarding_provision_from_plan(uuid,uuid,text,jsonb,text)', 'EXECUTE'); [false]
--   SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.organization_invitations'::regclass; [true]
--   SELECT count(*) FROM public.organization_root_gaps(); [0]
