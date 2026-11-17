-- ENGINE-01 — Entity Engine: Person Passport, membership contexts, Role Packs.
-- Status: AUTHORED, NOT APPLIED. No production database was accessed.
-- Rollback: database/supabase/rollbacks/20261110000100_sherivs_engine01_person_twin_and_role_packs.sql
--
-- One person has ONE twin (cg_twin_person). Every membership the person holds
-- is an isolated CONTEXT of that twin (cg_twin_context), bound to a versioned
-- Role Pack (cg_role_pack). Trust per capability starts in shadow and moves one
-- rung at a time (cg_twin_trust). Provisioning is automatic: triggers on the
-- membership and platform-staff tables create the person, the context and the
-- trust rows the moment a membership becomes active (never at invitation time).
-- Memory reuses the existing cg_memory_scope substrate (no parallel store).

-- -----------------------------------------------------------------------------
-- 1. Role Packs: versioned, immutable once published
-- -----------------------------------------------------------------------------
CREATE TABLE public.cg_role_pack (
  code           text NOT NULL CHECK (code ~ '^[a-z][a-z0-9-]{1,39}$'),
  version        text NOT NULL CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  kind           text NOT NULL CHECK (kind IN ('tenant_role', 'platform_role')),
  applies_to     text[] NOT NULL CHECK (cardinality(applies_to) BETWEEN 1 AND 16),
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  definition     jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  -- Digest set by the guard trigger so the stored definition can always be re-verified.
  definition_digest text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT pg_catalog.now(),
  published_at   timestamptz,
  PRIMARY KEY (code, version)
);

COMMENT ON TABLE public.cg_role_pack IS
  'ENGINE-01 Role Pack registry. A published pack is immutable; it can only be '
  'retired. The definition is the declarative ceiling for a twin agent; it never '
  'grants authority by itself.';

CREATE FUNCTION public.cg_role_pack_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_cap jsonb;
  v_max_rank int;
  v_rank int;
  v_prior text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'role pack % % is % and cannot be deleted', OLD.code, OLD.version, OLD.status
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  NEW.definition_digest := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(NEW.definition::text, 'UTF8')), 'hex');

  IF TG_OP = 'UPDATE' AND OLD.status IN ('published', 'retired') THEN
    IF NEW.definition_digest IS DISTINCT FROM OLD.definition_digest
       OR NEW.code IS DISTINCT FROM OLD.code
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.applies_to IS DISTINCT FROM OLD.applies_to
       OR NEW.definition IS DISTINCT FROM OLD.definition
       OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
      RAISE EXCEPTION 'role pack % % is immutable once published', OLD.code, OLD.version
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NOT (OLD.status = 'published' AND NEW.status = 'retired') AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'role pack status may only move published -> retired'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- Draft or new rows: validate the hard invariants (defence in depth; the
  -- complete validator runs in the application before any publish).
  IF NEW.definition->>'schema' IS DISTINCT FROM 'sherivs.role-pack.v1'
     OR NEW.definition->>'code' IS DISTINCT FROM NEW.code
     OR NEW.definition->>'version' IS DISTINCT FROM NEW.version
     OR NEW.definition->>'kind' IS DISTINCT FROM NEW.kind THEN
    RAISE EXCEPTION 'role pack definition does not match its identity columns';
  END IF;
  IF (NEW.definition->>'startsInShadow') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'role pack must start in shadow';
  END IF;
  IF (NEW.definition->'memory'->>'crossTenant') IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'role pack must not declare cross-tenant memory';
  END IF;
  IF jsonb_typeof(NEW.definition->'capabilities') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'role pack capabilities must be an array';
  END IF;

  v_max_rank := CASE NEW.kind WHEN 'tenant_role' THEN 2 ELSE 3 END;
  FOR v_cap IN SELECT * FROM jsonb_array_elements(NEW.definition->'capabilities') LOOP
    v_rank := CASE v_cap->>'tier'
      WHEN 'T0' THEN 0 WHEN 'T1' THEN 1 WHEN 'T2' THEN 2 WHEN 'T3' THEN 3 WHEN 'T4' THEN 4 ELSE NULL END;
    IF v_rank IS NULL OR v_rank >= 4 THEN
      RAISE EXCEPTION 'capability % has an undeclarable tier', v_cap->>'id';
    END IF;
    IF v_rank > v_max_rank THEN
      RAISE EXCEPTION 'capability % exceeds the tier ceiling for %', v_cap->>'id', NEW.kind;
    END IF;
    IF v_cap->>'autonomy' = 'act_autonomously' AND v_rank > 1 THEN
      RAISE EXCEPTION 'capability % may not be declared autonomous above T1', v_cap->>'id';
    END IF;
  END LOOP;

  IF TG_OP = 'INSERT' AND NEW.status = 'published' THEN
    NEW.published_at := COALESCE(NEW.published_at, pg_catalog.now());
    SELECT p.version INTO v_prior
    FROM public.cg_role_pack p
    WHERE p.code = NEW.code AND p.status IN ('published', 'retired')
    ORDER BY string_to_array(p.version, '.')::int[] DESC
    LIMIT 1;
    IF v_prior IS NOT NULL
       AND string_to_array(NEW.version, '.')::int[] <= string_to_array(v_prior, '.')::int[] THEN
      RAISE EXCEPTION 'role pack % version % must exceed published version %', NEW.code, NEW.version, v_prior;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'draft' AND NEW.status = 'published' THEN
    NEW.published_at := COALESCE(NEW.published_at, pg_catalog.now());
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER cg_role_pack_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.cg_role_pack
  FOR EACH ROW EXECUTE FUNCTION public.cg_role_pack_guard();

ALTER TABLE public.cg_role_pack ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_role_pack FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cg_role_pack FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.cg_role_pack TO service_role;

-- -----------------------------------------------------------------------------
-- 2. Person Passport: exactly one twin per identity
-- -----------------------------------------------------------------------------
CREATE TABLE public.cg_twin_person (
  id                 uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  identity_id        uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  memory_scope_id    text NOT NULL UNIQUE,
  memory_tenant_ref  text NOT NULL,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_at         timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT cg_twin_person_memory_scope_fk
    FOREIGN KEY (memory_scope_id, memory_tenant_ref)
    REFERENCES public.cg_memory_scope (id, tenant_id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.cg_twin_person IS
  'ENGINE-01 Person Passport: one twin per identity across every membership. '
  'Personal memory is the person''s own scope; tenant data never enters it '
  'without tenant policy and the person''s consent.';

-- -----------------------------------------------------------------------------
-- 3. Membership contexts: isolated, one per (membership role)
-- -----------------------------------------------------------------------------
CREATE TABLE public.cg_twin_context (
  id                   uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  twin_id              uuid NOT NULL REFERENCES public.cg_twin_person(id) ON DELETE CASCADE,
  identity_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  context_kind         text NOT NULL CHECK (context_kind IN ('tenant_membership', 'platform_staff')),
  tenant_ref           text NOT NULL CHECK (length(tenant_ref) BETWEEN 1 AND 128),
  role_code            text NOT NULL CHECK (length(role_code) BETWEEN 1 AND 64),
  source_ref           text NOT NULL CHECK (length(source_ref) BETWEEN 1 AND 128),
  status               text NOT NULL DEFAULT 'pending_pack'
                         CHECK (status IN ('active', 'pending_pack', 'suspended')),
  pack_code            text,
  pack_version         text,
  memory_scope_id      text NOT NULL,
  -- Filled by the Conductor when a governed worker definition is issued.
  agent_definition_ref text,
  created_at           timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at           timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT cg_twin_context_unique UNIQUE (twin_id, context_kind, tenant_ref, role_code),
  CONSTRAINT cg_twin_context_pack_fk
    FOREIGN KEY (pack_code, pack_version) REFERENCES public.cg_role_pack (code, version),
  CONSTRAINT cg_twin_context_pack_pair CHECK ((pack_code IS NULL) = (pack_version IS NULL)),
  CONSTRAINT cg_twin_context_memory_scope_fk
    FOREIGN KEY (memory_scope_id, tenant_ref)
    REFERENCES public.cg_memory_scope (id, tenant_id) ON DELETE RESTRICT
);

CREATE INDEX cg_twin_context_identity_idx ON public.cg_twin_context (identity_id);
CREATE INDEX cg_twin_context_pending_idx ON public.cg_twin_context (role_code) WHERE status = 'pending_pack';

COMMENT ON TABLE public.cg_twin_context IS
  'ENGINE-01 membership context: the twin acting in one role of one tenant (or '
  'the platform). Its memory scope is distinct per context, so nothing carries '
  'over between tenants.';

-- -----------------------------------------------------------------------------
-- 4. Trust per capability: earned autonomy, one rung at a time
-- -----------------------------------------------------------------------------
CREATE TABLE public.cg_twin_trust (
  context_id            uuid NOT NULL REFERENCES public.cg_twin_context(id) ON DELETE CASCADE,
  capability_id         text NOT NULL CHECK (length(capability_id) BETWEEN 2 AND 64),
  tier                  text NOT NULL CHECK (tier IN ('T0', 'T1', 'T2', 'T3')),
  state                 text NOT NULL DEFAULT 'shadow'
                          CHECK (state IN ('shadow', 'propose', 'assist', 'autonomous')),
  sheriff_promotion_id  text CHECK (sheriff_promotion_id IS NULL OR length(sheriff_promotion_id) BETWEEN 1 AND 128),
  evidence              jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  updated_at            timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (context_id, capability_id)
);

CREATE FUNCTION public.cg_twin_trust_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_old int;
  v_new int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'shadow' THEN
      RAISE EXCEPTION 'every capability starts in shadow';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.context_id IS DISTINCT FROM OLD.context_id
     OR NEW.capability_id IS DISTINCT FROM OLD.capability_id
     OR NEW.tier IS DISTINCT FROM OLD.tier THEN
    RAISE EXCEPTION 'trust identity and tier are immutable';
  END IF;
  v_old := CASE OLD.state WHEN 'shadow' THEN 0 WHEN 'propose' THEN 1 WHEN 'assist' THEN 2 ELSE 3 END;
  v_new := CASE NEW.state WHEN 'shadow' THEN 0 WHEN 'propose' THEN 1 WHEN 'assist' THEN 2 ELSE 3 END;
  IF v_new > v_old + 1 THEN
    RAISE EXCEPTION 'trust may climb one rung at a time (% -> %)', OLD.state, NEW.state;
  END IF;
  IF NEW.state = 'autonomous' THEN
    IF NEW.tier = 'T3' THEN
      RAISE EXCEPTION 'T3 capabilities can never be autonomous';
    END IF;
    IF NEW.tier = 'T2' AND NEW.sheriff_promotion_id IS NULL THEN
      RAISE EXCEPTION 'T2 autonomy requires a sheriff promotion record';
    END IF;
  END IF;
  IF NEW.state <> 'autonomous' THEN
    NEW.sheriff_promotion_id := NULL;
  END IF;
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END
$function$;

CREATE TRIGGER cg_twin_trust_guard_trg
  BEFORE INSERT OR UPDATE ON public.cg_twin_trust
  FOR EACH ROW EXECUTE FUNCTION public.cg_twin_trust_guard();

-- -----------------------------------------------------------------------------
-- 5. Row-level security: a person reads only their own passport
-- -----------------------------------------------------------------------------
ALTER TABLE public.cg_twin_person ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_twin_person FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cg_twin_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_twin_context FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cg_twin_trust ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_twin_trust FORCE ROW LEVEL SECURITY;

CREATE POLICY cg_twin_person_select_own ON public.cg_twin_person
  FOR SELECT TO authenticated
  USING (identity_id = (SELECT auth.uid()));

CREATE POLICY cg_twin_context_select_own ON public.cg_twin_context
  FOR SELECT TO authenticated
  USING (identity_id = (SELECT auth.uid()));

CREATE POLICY cg_twin_trust_select_own ON public.cg_twin_trust
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cg_twin_context c
    WHERE c.id = cg_twin_trust.context_id AND c.identity_id = (SELECT auth.uid())
  ));

REVOKE ALL ON TABLE public.cg_twin_person, public.cg_twin_context, public.cg_twin_trust
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.cg_twin_person, public.cg_twin_context, public.cg_twin_trust TO authenticated;
GRANT ALL ON TABLE public.cg_twin_person, public.cg_twin_context, public.cg_twin_trust TO service_role;

-- -----------------------------------------------------------------------------
-- 6. Provisioning functions (idempotent; service-role only)
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.cg_twin_platform_tenant()
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$ SELECT 'sherivs-platform'::text $$;

CREATE FUNCTION public.cg_twin_ensure_person(p_identity uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_scope text;
  v_ref text;
  v_id uuid;
BEGIN
  IF p_identity IS NULL THEN
    RAISE EXCEPTION 'identity is required';
  END IF;
  v_scope := 'twin-person:' || p_identity::text;
  v_ref := 'person:' || p_identity::text;
  INSERT INTO public.cg_memory_scope (id, tenant_id, mission_ref, actor_scope, domains, max_sensitivity, declared_by)
  VALUES (v_scope, v_ref, NULL, pg_catalog.jsonb_build_array(p_identity::text),
          '["twin-person"]'::jsonb, 'restricted', 'twin-engine')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.cg_twin_person (identity_id, memory_scope_id, memory_tenant_ref)
  VALUES (p_identity, v_scope, v_ref)
  ON CONFLICT (identity_id) DO NOTHING;
  SELECT id INTO v_id FROM public.cg_twin_person WHERE identity_id = p_identity;
  RETURN v_id;
END
$function$;

CREATE FUNCTION public.cg_twin_latest_pack(p_kind text, p_role text)
RETURNS public.cg_role_pack
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT p.*
  FROM public.cg_role_pack p
  WHERE p.status = 'published'
    AND p.kind = CASE p_kind WHEN 'platform_staff' THEN 'platform_role' ELSE 'tenant_role' END
    AND p_role = ANY (p.applies_to)
  ORDER BY string_to_array(p.version, '.')::int[] DESC
  LIMIT 1
$$;

CREATE FUNCTION public.cg_twin_seed_trust(p_context uuid, p_code text, p_version text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_n integer;
BEGIN
  INSERT INTO public.cg_twin_trust (context_id, capability_id, tier, state)
  SELECT p_context, c->>'id', c->>'tier', 'shadow'
  FROM public.cg_role_pack p, jsonb_array_elements(p.definition->'capabilities') c
  WHERE p.code = p_code AND p.version = p_version
  ON CONFLICT (context_id, capability_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$function$;

CREATE FUNCTION public.cg_twin_audit(
  p_identity uuid, p_tenant_ref text, p_kind text, p_action text, p_detail jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_school uuid;
  v_user uuid;
BEGIN
  IF p_kind = 'tenant_membership' THEN
    SELECT s.id INTO v_school FROM public.schools s WHERE s.id::text = p_tenant_ref;
  END IF;
  -- audit_logs.user_id references the profile table; an identity without a
  -- profile row is still audited, by identity id in the payload.
  SELECT u.id INTO v_user FROM public.users u WHERE u.id = p_identity;
  INSERT INTO public.audit_logs (school_id, user_id, action, table_name, record_id, old_value, new_value)
  VALUES (v_school, v_user, p_action, 'cg_twin_context', NULL, NULL,
          p_detail || pg_catalog.jsonb_build_object('tenant_ref', p_tenant_ref, 'identity_id', p_identity,
                                                    'recorded_at', pg_catalog.now()));
END
$function$;

CREATE FUNCTION public.cg_twin_ensure_context(
  p_identity uuid, p_kind text, p_tenant_ref text, p_role text, p_source_ref text, p_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_twin uuid;
  v_pack public.cg_role_pack;
  v_ctx public.cg_twin_context%ROWTYPE;
  v_scope text;
  v_created boolean := false;
  v_n integer;
  v_domains jsonb;
  v_sens text;
BEGIN
  IF p_identity IS NULL OR p_tenant_ref IS NULL OR p_role IS NULL OR p_source_ref IS NULL
     OR p_kind NOT IN ('tenant_membership', 'platform_staff') THEN
    RAISE EXCEPTION 'twin context requires identity, kind, tenant, role and source';
  END IF;

  IF NOT p_active THEN
    UPDATE public.cg_twin_context c
       SET status = 'suspended', updated_at = pg_catalog.now()
      FROM public.cg_twin_person t
     WHERE c.twin_id = t.id AND t.identity_id = p_identity
       AND c.context_kind = p_kind AND c.tenant_ref = p_tenant_ref AND c.role_code = p_role
       AND c.status <> 'suspended';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN
      PERFORM public.cg_twin_audit(p_identity, p_tenant_ref, p_kind, 'twin.context.suspend',
        pg_catalog.jsonb_build_object('role', p_role, 'reason', 'membership_inactive'));
    END IF;
    RETURN pg_catalog.jsonb_build_object('outcome', 'suspended', 'count', v_n);
  END IF;

  v_twin := public.cg_twin_ensure_person(p_identity);
  v_pack := public.cg_twin_latest_pack(p_kind, p_role);
  v_scope := 'twin-context:' || p_identity::text || ':' || p_tenant_ref || ':' || p_role;
  v_domains := CASE WHEN v_pack.code IS NULL THEN '["twin-context"]'::jsonb
                    ELSE v_pack.definition->'memory'->'domains' END;
  v_sens := CASE WHEN v_pack.code IS NULL THEN 'internal'
                 ELSE v_pack.definition->'memory'->>'maxSensitivity' END;

  INSERT INTO public.cg_memory_scope (id, tenant_id, mission_ref, actor_scope, domains, max_sensitivity, declared_by)
  VALUES (v_scope, p_tenant_ref, NULL, pg_catalog.jsonb_build_array(p_identity::text),
          v_domains, v_sens, 'twin-engine')
  ON CONFLICT (id) DO NOTHING;

  SELECT * INTO v_ctx FROM public.cg_twin_context
   WHERE twin_id = v_twin AND context_kind = p_kind AND tenant_ref = p_tenant_ref AND role_code = p_role
   FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.cg_twin_context
      (twin_id, identity_id, context_kind, tenant_ref, role_code, source_ref, status,
       pack_code, pack_version, memory_scope_id)
    VALUES
      (v_twin, p_identity, p_kind, p_tenant_ref, p_role, p_source_ref,
       CASE WHEN v_pack.code IS NULL THEN 'pending_pack' ELSE 'active' END,
       v_pack.code, v_pack.version, v_scope)
    RETURNING * INTO v_ctx;
    v_created := true;
  ELSE
    -- Reactivation keeps the bound pack version; a pack is bound only while unbound.
    UPDATE public.cg_twin_context c
       SET status = CASE WHEN COALESCE(c.pack_code, v_pack.code) IS NULL THEN 'pending_pack' ELSE 'active' END,
           pack_code = COALESCE(c.pack_code, v_pack.code),
           pack_version = COALESCE(c.pack_version, v_pack.version),
           source_ref = p_source_ref,
           updated_at = pg_catalog.now()
     WHERE c.id = v_ctx.id
    RETURNING * INTO v_ctx;
  END IF;

  IF v_ctx.pack_code IS NOT NULL THEN
    PERFORM public.cg_twin_seed_trust(v_ctx.id, v_ctx.pack_code, v_ctx.pack_version);
  END IF;

  PERFORM public.cg_twin_audit(p_identity, p_tenant_ref, p_kind, 'twin.context.ensure',
    pg_catalog.jsonb_build_object('role', p_role, 'created', v_created, 'status', v_ctx.status,
      'pack_code', v_ctx.pack_code, 'pack_version', v_ctx.pack_version));
  RETURN pg_catalog.jsonb_build_object('outcome', 'ensured', 'twin_id', v_twin, 'context_id', v_ctx.id,
    'status', v_ctx.status, 'created', v_created);
END
$function$;

-- Bind contexts that were waiting for a pack as soon as one is published.
CREATE FUNCTION public.cg_twin_bind_pending_contexts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  r record;
  v_pack public.cg_role_pack;
  v_count integer := 0;
BEGIN
  FOR r IN SELECT c.id, c.context_kind, c.role_code FROM public.cg_twin_context c WHERE c.status = 'pending_pack' LOOP
    v_pack := public.cg_twin_latest_pack(r.context_kind, r.role_code);
    IF v_pack.code IS NOT NULL THEN
      UPDATE public.cg_twin_context
         SET pack_code = v_pack.code, pack_version = v_pack.version, status = 'active',
             updated_at = pg_catalog.now()
       WHERE id = r.id;
      PERFORM public.cg_twin_seed_trust(r.id, v_pack.code, v_pack.version);
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END
$function$;

CREATE FUNCTION public.cg_role_pack_after_publish()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.status = 'published' THEN
    PERFORM public.cg_twin_bind_pending_contexts();
  END IF;
  RETURN NULL;
END
$function$;

CREATE TRIGGER cg_role_pack_after_publish_trg
  AFTER INSERT OR UPDATE OF status ON public.cg_role_pack
  FOR EACH ROW EXECUTE FUNCTION public.cg_role_pack_after_publish();

-- -----------------------------------------------------------------------------
-- 7. Automatic provisioning triggers
--    A provisioning failure never blocks the membership change: it is audited
--    and the reconcile job repairs it. Provisioning is driven by an ACTIVE
--    membership, never by an unaccepted invitation.
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.cg_twin_on_membership_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_state text;
  v_msg text;
BEGIN
  BEGIN
    IF TG_OP = 'UPDATE' AND OLD.role IS DISTINCT FROM NEW.role THEN
      PERFORM public.cg_twin_ensure_context(OLD.user_id, 'tenant_membership', OLD.school_id::text,
                                            OLD.role, OLD.id::text, false);
    END IF;
    PERFORM public.cg_twin_ensure_context(NEW.user_id, 'tenant_membership', NEW.school_id::text,
                                          NEW.role, NEW.id::text, NEW.is_active);
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
    v_msg := SQLERRM;
    BEGIN
      INSERT INTO public.audit_logs (school_id, user_id, action, table_name, record_id, old_value, new_value)
      VALUES (NEW.school_id, (SELECT u.id FROM public.users u WHERE u.id = NEW.user_id),
              'twin.provision.failed', 'organization_memberships', NEW.id, NULL,
              pg_catalog.jsonb_build_object('sqlstate', v_state, 'message', v_msg, 'identity_id', NEW.user_id,
                                            'role', NEW.role, 'recorded_at', pg_catalog.now()));
    EXCEPTION WHEN OTHERS THEN
      NULL; -- the failure record itself must never block the membership change
    END;
  END;
  RETURN NEW;
END
$function$;

CREATE TRIGGER cg_twin_on_membership_change_trg
  AFTER INSERT OR UPDATE OF is_active, role ON public.organization_memberships
  FOR EACH ROW EXECUTE FUNCTION public.cg_twin_on_membership_change();

CREATE FUNCTION public.cg_twin_on_staff_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  r record;
  v_state text;
  v_msg text;
BEGIN
  BEGIN
    IF NEW.status = 'active' THEN
      PERFORM public.cg_twin_ensure_person(NEW.id);
      FOR r IN SELECT role_code FROM public.platform_staff_roles WHERE staff_id = NEW.id LOOP
        PERFORM public.cg_twin_ensure_context(NEW.id, 'platform_staff', public.cg_twin_platform_tenant(),
                                              r.role_code, NEW.id::text, true);
      END LOOP;
    ELSIF NEW.status IN ('suspended', 'revoked') THEN
      FOR r IN SELECT role_code FROM public.platform_staff_roles WHERE staff_id = NEW.id LOOP
        PERFORM public.cg_twin_ensure_context(NEW.id, 'platform_staff', public.cg_twin_platform_tenant(),
                                              r.role_code, NEW.id::text, false);
      END LOOP;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
    v_msg := SQLERRM;
    BEGIN
      INSERT INTO public.audit_logs (school_id, user_id, action, table_name, record_id, old_value, new_value)
      VALUES (NULL, (SELECT u.id FROM public.users u WHERE u.id = NEW.id),
              'twin.provision.failed', 'platform_staff', NEW.id, NULL,
              pg_catalog.jsonb_build_object('sqlstate', v_state, 'message', v_msg, 'identity_id', NEW.id,
                                            'recorded_at', pg_catalog.now()));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END;
  RETURN NEW;
END
$function$;

CREATE TRIGGER cg_twin_on_staff_change_trg
  AFTER INSERT OR UPDATE OF status ON public.platform_staff
  FOR EACH ROW EXECUTE FUNCTION public.cg_twin_on_staff_change();

CREATE FUNCTION public.cg_twin_on_staff_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_status text;
  v_staff uuid := COALESCE(NEW.staff_id, OLD.staff_id);
  v_role text := COALESCE(NEW.role_code, OLD.role_code);
  v_state text;
  v_msg text;
BEGIN
  BEGIN
    SELECT s.status INTO v_status FROM public.platform_staff s WHERE s.id = v_staff;
    IF TG_OP = 'DELETE' THEN
      PERFORM public.cg_twin_ensure_context(v_staff, 'platform_staff', public.cg_twin_platform_tenant(),
                                            v_role, v_staff::text, false);
    ELSIF v_status = 'active' THEN
      PERFORM public.cg_twin_ensure_context(v_staff, 'platform_staff', public.cg_twin_platform_tenant(),
                                            v_role, v_staff::text, true);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
    v_msg := SQLERRM;
    BEGIN
      INSERT INTO public.audit_logs (school_id, user_id, action, table_name, record_id, old_value, new_value)
      VALUES (NULL, (SELECT u.id FROM public.users u WHERE u.id = v_staff),
              'twin.provision.failed', 'platform_staff_roles', NULL, NULL,
              pg_catalog.jsonb_build_object('sqlstate', v_state, 'message', v_msg, 'identity_id', v_staff,
                                            'recorded_at', pg_catalog.now()));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END;
  RETURN NULL;
END
$function$;

CREATE TRIGGER cg_twin_on_staff_role_change_trg
  AFTER INSERT OR DELETE ON public.platform_staff_roles
  FOR EACH ROW EXECUTE FUNCTION public.cg_twin_on_staff_role_change();

-- -----------------------------------------------------------------------------
-- 8. Reconcile: repairs any gap (a failed trigger, a backfill, a new pack)
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.cg_twin_reconcile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  r record;
  v_ctx integer := 0;
  v_bound integer;
BEGIN
  FOR r IN
    SELECT m.user_id, m.school_id, m.role, m.id FROM public.organization_memberships m WHERE m.is_active
  LOOP
    PERFORM public.cg_twin_ensure_context(r.user_id, 'tenant_membership', r.school_id::text, r.role, r.id::text, true);
    v_ctx := v_ctx + 1;
  END LOOP;
  FOR r IN
    SELECT s.id, sr.role_code
    FROM public.platform_staff s JOIN public.platform_staff_roles sr ON sr.staff_id = s.id
    WHERE s.status = 'active'
  LOOP
    PERFORM public.cg_twin_ensure_context(r.id, 'platform_staff', public.cg_twin_platform_tenant(), r.role_code, r.id::text, true);
    v_ctx := v_ctx + 1;
  END LOOP;
  v_bound := public.cg_twin_bind_pending_contexts();
  RETURN pg_catalog.jsonb_build_object('contexts_ensured', v_ctx, 'contexts_bound', v_bound);
END
$function$;

REVOKE ALL ON FUNCTION
  public.cg_role_pack_guard(),
  public.cg_twin_trust_guard(),
  public.cg_twin_platform_tenant(),
  public.cg_twin_ensure_person(uuid),
  public.cg_twin_latest_pack(text, text),
  public.cg_twin_seed_trust(uuid, text, text),
  public.cg_twin_audit(uuid, text, text, text, jsonb),
  public.cg_twin_ensure_context(uuid, text, text, text, text, boolean),
  public.cg_twin_bind_pending_contexts(),
  public.cg_role_pack_after_publish(),
  public.cg_twin_on_membership_change(),
  public.cg_twin_on_staff_change(),
  public.cg_twin_on_staff_role_change(),
  public.cg_twin_reconcile()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.cg_twin_ensure_person(uuid),
  public.cg_twin_ensure_context(uuid, text, text, text, text, boolean),
  public.cg_twin_bind_pending_contexts(),
  public.cg_twin_reconcile(),
  public.cg_twin_latest_pack(text, text)
  TO service_role;
