-- Capture of three tables that exist in production but were created outside the
-- repo (PLATFORM-019: cg_api_key, cg_org_communication_sender; Sherivs membership:
-- organization_memberships). Captured read-only from prod (pg_dump --schema-only,
-- no data) on 2026-10-20 for SHERIVS-005.
--
-- Production already has these objects: the ledger repair records this version as
-- APPLIED there, so it never runs on prod. Elsewhere (local, staging, fresh
-- environments) it recreates them exactly. Idempotent: safe to re-run.


CREATE TABLE IF NOT EXISTS public.cg_api_key (

    api_key_ref text NOT NULL,
    tenant_id text NOT NULL,
    type text NOT NULL,
    key_hash text NOT NULL,
    key_preview text NOT NULL,
    fingerprint text NOT NULL,
    scopes text[] NOT NULL,
    status text NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    revoked_by text,
    revoke_reason text,
    note text,
    CONSTRAINT cg_api_key_api_key_ref_check CHECK (((length(api_key_ref) >= 1) AND (length(api_key_ref) <= 160))),
    CONSTRAINT cg_api_key_created_by_check CHECK (((length(created_by) >= 1) AND (length(created_by) <= 160))),
    CONSTRAINT cg_api_key_fingerprint_check CHECK ((fingerprint ~ '^[0-9a-f]{12}$'::text)),
    CONSTRAINT cg_api_key_key_hash_check CHECK ((key_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT cg_api_key_key_preview_check CHECK (((length(key_preview) >= 1) AND (length(key_preview) <= 32))),
    CONSTRAINT cg_api_key_revocation_coherence CHECK ((((status = 'revoked'::text) AND (revoked_at IS NOT NULL) AND (revoked_by IS NOT NULL)) OR ((status = 'active'::text) AND (revoked_at IS NULL) AND (revoked_by IS NULL)))),
    CONSTRAINT cg_api_key_revoked_by_check CHECK (((length(revoked_by) >= 1) AND (length(revoked_by) <= 160))),
    CONSTRAINT cg_api_key_scopes_check CHECK ((array_length(scopes, 1) >= 1)),
    CONSTRAINT cg_api_key_status_check CHECK ((status = ANY (ARRAY['active'::text, 'revoked'::text]))),
    CONSTRAINT cg_api_key_tenant_id_check CHECK (((length(tenant_id) >= 1) AND (length(tenant_id) <= 128))),
    CONSTRAINT cg_api_key_type_check CHECK ((type = ANY (ARRAY['publishable'::text, 'secret'::text]))),
    CONSTRAINT cg_api_key_key_hash_key UNIQUE (key_hash),
    CONSTRAINT cg_api_key_pkey PRIMARY KEY (api_key_ref)
);

CREATE TABLE IF NOT EXISTS public.cg_org_communication_sender (

    sender_ref text NOT NULL,
    tenant_id text NOT NULL,
    org_ref text NOT NULL,
    channel text NOT NULL,
    provider text NOT NULL,
    from_number text NOT NULL,
    credential_ref text NOT NULL,
    status text NOT NULL,
    provenance jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cg_org_communication_sender_channel_check CHECK ((channel = 'sms'::text)),
    CONSTRAINT cg_org_communication_sender_credential_ref_check CHECK ((credential_ref ~ '^env://[A-Z][A-Z0-9_]{2,127}$'::text)),
    CONSTRAINT cg_org_communication_sender_from_number_check CHECK ((from_number ~ '^\+[1-9][0-9]{1,14}$'::text)),
    CONSTRAINT cg_org_communication_sender_org_ref_check CHECK (((length(org_ref) >= 1) AND (length(org_ref) <= 160))),
    CONSTRAINT cg_org_communication_sender_provenance_check CHECK (((jsonb_typeof(provenance) = 'object'::text) AND (provenance ? 'createdBy'::text) AND (provenance ? 'createdAt'::text))),
    CONSTRAINT cg_org_communication_sender_provider_check CHECK ((provider = 'twilio'::text)),
    CONSTRAINT cg_org_communication_sender_sender_ref_check CHECK (((length(sender_ref) >= 1) AND (length(sender_ref) <= 160))),
    CONSTRAINT cg_org_communication_sender_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'pending_provision'::text]))),
    CONSTRAINT cg_org_communication_sender_tenant_id_check CHECK (((length(tenant_id) >= 1) AND (length(tenant_id) <= 128))),
    CONSTRAINT cg_org_communication_sender_pkey PRIMARY KEY (sender_ref)
);

CREATE TABLE IF NOT EXISTS public.organization_memberships (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    school_id uuid NOT NULL,
    role text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_memberships_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'principal'::text, 'teacher'::text, 'parent'::text, 'student'::text, 'bursar'::text, 'hq'::text, 'alumni'::text, 'driver'::text]))),
    CONSTRAINT organization_memberships_pkey PRIMARY KEY (id),
    CONSTRAINT organization_memberships_user_school_unique UNIQUE (user_id, school_id),
    CONSTRAINT organization_memberships_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE,
    CONSTRAINT organization_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.cg_api_key IS 'PLATFORM-019 platform API-key
substrate: Supabase-style key classes (cg_publishable_ client-safe,
cg_secret_ server-privileged) bound to one organization and an explicit
scope vector. The plaintext key is NEVER stored — key_hash is sha256 of the
full key; key_preview and fingerprint are non-secret display forms.
Revocation is terminal and must carry who/when (CHECK-enforced). RLS enabled
with zero policies; service-role server functions are the only writer and
reader.';

COMMENT ON TABLE public.cg_org_communication_sender IS 'PLATFORM-019
organization sender identity: which E.164 FROM number an organization''''s
outbound messages use per channel. credential_ref is an env:// POINTER —
secret values are never stored in tenant data (AGENTS.md §30). Only one row
per (tenant_id, org_ref, channel, provider) may be status=''''active'''' (partial
unique index). RLS enabled with zero policies; service-role server functions
are the only writer and reader.';

ALTER TABLE ONLY public.organization_memberships FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE public.organization_memberships IS 'Sherivs organization membership set (§11): every organization an actor is affiliated with, under a declared tenant role. The ACTIVE membership is public.users.school_id/role (switchable server-side); membership rows never grant authorization by themselves — every tenant RLS predicate still resolves through the identity-store helpers below.';

CREATE INDEX IF NOT EXISTS cg_api_key_tenant_status_idx ON public.cg_api_key USING btree (tenant_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS cg_org_communication_sender_active_unique ON public.cg_org_communication_sender USING btree (tenant_id, org_ref, channel, provider) WHERE (status = 'active'::text);

CREATE INDEX IF NOT EXISTS cg_org_communication_sender_tenant_org_idx ON public.cg_org_communication_sender USING btree (tenant_id, org_ref, channel);

CREATE INDEX IF NOT EXISTS idx_organization_memberships_school ON public.organization_memberships USING btree (school_id);

CREATE INDEX IF NOT EXISTS idx_organization_memberships_user ON public.organization_memberships USING btree (user_id) WHERE (is_active = true);

CREATE UNIQUE INDEX IF NOT EXISTS organization_memberships_single_primary ON public.organization_memberships USING btree (user_id) WHERE (is_primary = true);

CREATE OR REPLACE TRIGGER organization_memberships_touch BEFORE UPDATE ON public.organization_memberships FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.cg_api_key ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.cg_org_communication_sender ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_memberships_delete ON public.organization_memberships;

CREATE POLICY organization_memberships_delete ON public.organization_memberships FOR DELETE USING ((public.is_super_admin() OR (public.is_school_admin() AND (school_id = public.get_my_school_id()))));

DROP POLICY IF EXISTS organization_memberships_insert ON public.organization_memberships;

CREATE POLICY organization_memberships_insert ON public.organization_memberships FOR INSERT WITH CHECK ((public.is_super_admin() OR (public.is_school_admin() AND (school_id = public.get_my_school_id()))));

DROP POLICY IF EXISTS organization_memberships_select ON public.organization_memberships;

CREATE POLICY organization_memberships_select ON public.organization_memberships FOR SELECT USING (((auth.uid() = user_id) OR public.is_super_admin() OR (public.is_school_admin() AND (school_id = public.get_my_school_id()))));

DROP POLICY IF EXISTS organization_memberships_update ON public.organization_memberships;

CREATE POLICY organization_memberships_update ON public.organization_memberships FOR UPDATE USING ((public.is_super_admin() OR (public.is_school_admin() AND (school_id = public.get_my_school_id())))) WITH CHECK ((public.is_super_admin() OR (public.is_school_admin() AND (school_id = public.get_my_school_id()))));

-- Match production grants exactly (override Supabase default privileges).
REVOKE ALL ON TABLE public.cg_api_key FROM anon, authenticated;
REVOKE ALL ON TABLE public.cg_org_communication_sender FROM anon, authenticated;
REVOKE ALL ON TABLE public.organization_memberships FROM anon, authenticated;
GRANT ALL ON TABLE public.cg_api_key TO service_role;

GRANT ALL ON TABLE public.cg_org_communication_sender TO service_role;

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.organization_memberships TO authenticated;

GRANT ALL ON TABLE public.organization_memberships TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- Out-of-band function / trigger / constraint state found on production
-- (captured verbatim, read-only, 2026-10-20). Production keeps these; this
-- section makes every other environment match production exactly.
-- ───────────────────────────────────────────────────────────────────────────

-- touch_updated_at: production stores this body with CRLF line endings; the repo is LF-only
-- (.gitattributes), so rebuild the CRLF body at apply time for an exact match.
DO $do_touch_updated_at$
BEGIN
  EXECUTE replace($cap_touch_updated_at$CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$$cap_touch_updated_at$, chr(10), chr(13) || chr(10));
END
$do_touch_updated_at$;

GRANT ALL ON FUNCTION public.touch_updated_at() TO anon;

GRANT ALL ON FUNCTION public.touch_updated_at() TO authenticated;

GRANT ALL ON FUNCTION public.touch_updated_at() TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_memberships() RETURNS TABLE(school_id uuid, role text, is_primary boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT m.school_id, m.role, m.is_primary
  FROM public.organization_memberships m
  WHERE m.user_id = auth.uid() AND m.is_active = true
  ORDER BY m.is_primary DESC, m.created_at ASC;
$$;

REVOKE ALL ON FUNCTION public.get_my_memberships() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_memberships() FROM anon;

GRANT ALL ON FUNCTION public.get_my_memberships() TO authenticated;

GRANT ALL ON FUNCTION public.get_my_memberships() TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_role() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

GRANT ALL ON FUNCTION public.get_my_role() TO anon;

GRANT ALL ON FUNCTION public.get_my_role() TO authenticated;

GRANT ALL ON FUNCTION public.get_my_role() TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_school_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

GRANT ALL ON FUNCTION public.get_my_school_id() TO anon;

GRANT ALL ON FUNCTION public.get_my_school_id() TO authenticated;

GRANT ALL ON FUNCTION public.get_my_school_id() TO service_role;

-- get_my_primary_workforce_position: production stores this body with CRLF line endings; the repo is LF-only
-- (.gitattributes), so rebuild the CRLF body at apply time for an exact match.
DO $do_get_my_primary_workforce_position$
BEGIN
  EXECUTE replace($cap_get_my_primary_workforce_position$CREATE OR REPLACE FUNCTION public.get_my_primary_workforce_position() RETURNS TABLE(id uuid, identity_ref text, kind_code text, kind_title text, family text, employment_type text, started_on date, ended_on date, status text, is_primary boolean, authority_group text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT w.id, w.identity_ref, w.kind_code, k.title, k.family,
         w.employment_type, w.started_on, w.ended_on, w.status, w.is_primary,
         k.authority_group
  FROM public.cg_workforce_position w
  JOIN public.cg_workforce_kind k
    ON k.runtime_ref = w.runtime_ref AND k.kind_code = w.kind_code
  WHERE w.identity_ref = auth.uid()::text
    AND w.is_primary
    AND w.status IN ('active','on_leave')
  ORDER BY w.started_on DESC, w.created_at DESC
  LIMIT 1;
$$$cap_get_my_primary_workforce_position$, chr(10), chr(13) || chr(10));
END
$do_get_my_primary_workforce_position$;

GRANT ALL ON FUNCTION public.get_my_primary_workforce_position() TO anon;

GRANT ALL ON FUNCTION public.get_my_primary_workforce_position() TO authenticated;

GRANT ALL ON FUNCTION public.get_my_primary_workforce_position() TO service_role;

CREATE OR REPLACE FUNCTION public.sync_organization_membership_on_user_write() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

GRANT ALL ON FUNCTION public.sync_organization_membership_on_user_write() TO anon;

GRANT ALL ON FUNCTION public.sync_organization_membership_on_user_write() TO authenticated;

GRANT ALL ON FUNCTION public.sync_organization_membership_on_user_write() TO service_role;

CREATE OR REPLACE FUNCTION public.create_organization_with_founder(p_org_name text, p_org_slug text, p_full_name text, p_runtime text DEFAULT 'scholar'::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
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
$_$;

COMMENT ON FUNCTION public.create_organization_with_founder(p_org_name text, p_org_slug text, p_full_name text, p_runtime text) IS 'Sherivs organization onboarding: sole customer path that provisions an organization and its founder identity (§21). Unlinked authenticated accounts only; fail-closed.';

REVOKE ALL ON FUNCTION public.create_organization_with_founder(p_org_name text, p_org_slug text, p_full_name text, p_runtime text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_organization_with_founder(p_org_name text, p_org_slug text, p_full_name text, p_runtime text) FROM anon;

GRANT ALL ON FUNCTION public.create_organization_with_founder(p_org_name text, p_org_slug text, p_full_name text, p_runtime text) TO authenticated;

GRANT ALL ON FUNCTION public.create_organization_with_founder(p_org_name text, p_org_slug text, p_full_name text, p_runtime text) TO service_role;

CREATE OR REPLACE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;

GRANT ALL ON FUNCTION public.rls_auto_enable() TO anon;

GRANT ALL ON FUNCTION public.rls_auto_enable() TO authenticated;

GRANT ALL ON FUNCTION public.rls_auto_enable() TO service_role;

CREATE OR REPLACE TRIGGER organization_memberships_sync AFTER INSERT OR UPDATE OF school_id, role, is_active ON public.users FOR EACH ROW EXECUTE FUNCTION public.sync_organization_membership_on_user_write();

ALTER TABLE public.cg_execution_history DROP CONSTRAINT IF EXISTS cg_execution_history_status_check;
ALTER TABLE public.cg_execution_history DROP CONSTRAINT IF EXISTS cg_execution_history_status_vocab_check;
ALTER TABLE public.cg_execution_history ADD CONSTRAINT cg_execution_history_status_vocab_check CHECK ((status = ANY (ARRAY['admitted'::text, 'denied'::text, 'rolled_back'::text, 'assigned'::text, 'leased'::text, 'evidenced'::text, 'verified'::text, 'requeued'::text, 'exhausted'::text])));

COMMENT ON CONSTRAINT cg_execution_history_status_vocab_check ON public.cg_execution_history IS 'HUMAN AUTHORIZED 2026-10-13 ACTIVE-V1: append-only history uses the same status vocabulary as cg_execution_record.';

ALTER TABLE public.cg_execution_record DROP CONSTRAINT IF EXISTS cg_execution_record_status_check;
ALTER TABLE public.cg_execution_record DROP CONSTRAINT IF EXISTS cg_execution_record_status_vocab_check;
ALTER TABLE public.cg_execution_record ADD CONSTRAINT cg_execution_record_status_vocab_check CHECK ((status = ANY (ARRAY['admitted'::text, 'denied'::text, 'rolled_back'::text, 'assigned'::text, 'leased'::text, 'evidenced'::text, 'verified'::text, 'requeued'::text, 'exhausted'::text])));

COMMENT ON CONSTRAINT cg_execution_record_status_vocab_check ON public.cg_execution_record IS 'HUMAN AUTHORIZED 2026-10-13 ACTIVE-V1: execution-path stages plus the original admission vocabulary. Does not edit 20261003000019. External-effect coupling CHECKs stay.';

COMMENT ON POLICY role_grant_insert_tenant_admin ON public.cg_role_grant IS 'J-005/J-006: neutral ADMINISTRATOR binding in the tenant under test,
  AND granted_by must equal auth.uid()::text — the grantor identity is
  always the acting principal, never a client-supplied value (Constitution
  §26).';

ALTER TABLE public.cg_idempotency_record ENABLE ROW LEVEL SECURITY;

-- Supabase "auto-enable RLS on new tables" event trigger, as on production.
-- Creating event triggers needs elevated rights; skip quietly where not allowed.
DO $evt$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'ensure_rls') THEN
    CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
      WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      EXECUTE FUNCTION public.rls_auto_enable();
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ensure_rls event trigger not created (insufficient privilege)';
END
$evt$;
