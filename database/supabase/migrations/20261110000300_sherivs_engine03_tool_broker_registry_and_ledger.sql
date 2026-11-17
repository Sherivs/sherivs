-- =============================================================================
-- ENGINE-03 (ADR-081): Tool Broker registry, connector bindings, call ledger.
--
-- * cg_tool_registry      versioned tool definitions; tier is floored by effect;
--                         T4 is not registrable; only `enabled` may change.
-- * cg_connector_binding  REFERENCES to secrets (vault://...), never secrets.
-- * cg_tool_call_ledger   append-only: one `decision` row per brokered call and
--                         `outcome` rows that point at it. T3 can only succeed
--                         with a sheriff approval; a T4 call can only be denied.
-- Forward-only. Exact inverse in rollbacks/20261110000300_*.sql.
-- Deny-by-default: FORCE RLS, no policies, clients have no privilege.
-- =============================================================================

-- ---- helpers ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cg_tool_tier_rank(p_tier text)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $f$
  SELECT CASE p_tier WHEN 'T0' THEN 0 WHEN 'T1' THEN 1 WHEN 'T2' THEN 2
                     WHEN 'T3' THEN 3 WHEN 'T4' THEN 4 ELSE NULL END
$f$;

CREATE OR REPLACE FUNCTION public.cg_tool_effect_floor(p_effect text)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $f$
  SELECT CASE p_effect WHEN 'none' THEN 0 WHEN 'internal_state' THEN 1
                       WHEN 'customer_visible' THEN 2
                       WHEN 'public_post' THEN 3 WHEN 'money' THEN 3
                       WHEN 'prod_config' THEN 3 WHEN 'access_grant' THEN 3
                       WHEN 'legal' THEN 3 ELSE NULL END
$f$;

-- True when any key, at any depth, looks like a secret name.
CREATE OR REPLACE FUNCTION public.cg_tool_jsonb_has_secret_key(p jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $f$
DECLARE r record; hit boolean := false;
BEGIN
  IF p IS NULL THEN RETURN false; END IF;
  IF jsonb_typeof(p) = 'object' THEN
    FOR r IN SELECT key, value FROM jsonb_each(p) LOOP
      IF r.key ~* '(pass(word|wd)?|secret|token|api[-_]?key|authorization|credential|private[-_]?key|cookie|session[-_]?id)'
         OR public.cg_tool_jsonb_has_secret_key(r.value) THEN
        RETURN true;
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(p) = 'array' THEN
    FOR r IN SELECT value FROM jsonb_array_elements(p) LOOP
      IF public.cg_tool_jsonb_has_secret_key(r.value) THEN RETURN true; END IF;
    END LOOP;
  END IF;
  RETURN hit;
END
$f$;

-- ---- 1. tool registry ------------------------------------------------------
CREATE TABLE public.cg_tool_registry (
  tool_id            text NOT NULL CHECK (tool_id ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  version            text NOT NULL CHECK (version ~ '^\d+\.\d+\.\d+$'),
  title              text NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
  connector          text NOT NULL CHECK (connector ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  direction          text NOT NULL CHECK (direction IN ('read', 'write')),
  effect             text NOT NULL CHECK (effect IN ('none','internal_state','customer_visible','public_post','money','prod_config','access_grant','legal')),
  tier               text NOT NULL CHECK (tier IN ('T0','T1','T2','T3')),
  idempotent         boolean NOT NULL,
  max_calls_per_hour int NOT NULL CHECK (max_calls_per_hour BETWEEN 1 AND 10000),
  platform_only      boolean NOT NULL,
  enabled            boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at         timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (tool_id, version),
  CONSTRAINT cg_tool_registry_floor
    CHECK (public.cg_tool_tier_rank(tier) >= public.cg_tool_effect_floor(effect)),
  CONSTRAINT cg_tool_registry_direction_effect
    CHECK ((direction = 'read' AND effect = 'none') OR (direction = 'write' AND effect <> 'none')),
  CONSTRAINT cg_tool_registry_t3_idempotent
    CHECK (tier <> 'T3' OR direction = 'read' OR idempotent),
  CONSTRAINT cg_tool_registry_platform_only
    CHECK (effect NOT IN ('public_post','money','access_grant') OR platform_only)
);

CREATE OR REPLACE FUNCTION public.cg_tool_registry_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $f$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'cg_tool_registry rows are never deleted; disable the tool instead' USING ERRCODE = '42501';
  END IF;
  IF (NEW.tool_id, NEW.version, NEW.title, NEW.connector, NEW.direction, NEW.effect, NEW.tier,
      NEW.idempotent, NEW.max_calls_per_hour, NEW.platform_only, NEW.created_at)
     IS DISTINCT FROM
     (OLD.tool_id, OLD.version, OLD.title, OLD.connector, OLD.direction, OLD.effect, OLD.tier,
      OLD.idempotent, OLD.max_calls_per_hour, OLD.platform_only, OLD.created_at) THEN
    RAISE EXCEPTION 'cg_tool_registry definitions are immutable; publish a new version' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END
$f$;
CREATE TRIGGER cg_tool_registry_guard BEFORE UPDATE OR DELETE ON public.cg_tool_registry
  FOR EACH ROW EXECUTE FUNCTION public.cg_tool_registry_guard();

-- ---- 2. connector bindings (references only) -------------------------------
CREATE TABLE public.cg_connector_binding (
  id          uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  connector   text NOT NULL CHECK (connector ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  scope       text NOT NULL CHECK (scope IN ('platform', 'tenant')),
  tenant_ref  text CHECK (tenant_ref IS NULL OR length(tenant_ref) BETWEEN 1 AND 128),
  secret_ref  text NOT NULL CHECK (secret_ref ~ '^vault://[a-z][a-z0-9-]{1,39}/[a-z][a-z0-9_-]{1,63}#v[1-9][0-9]{0,3}$'),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'rotating')),
  created_at  timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at  timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT cg_connector_binding_scope_tenant
    CHECK ((scope = 'platform' AND tenant_ref IS NULL) OR (scope = 'tenant' AND tenant_ref IS NOT NULL)),
  CONSTRAINT cg_connector_binding_not_secret_shaped
    CHECK (secret_ref !~* '(ghp_|gho_|ghs_|ghu_|sk_live|sk_test|pk_live|pk_test|xox[abprs]-|akia[0-9a-z]{16}|bearer|[0-9a-f]{32,})'),
  CONSTRAINT cg_connector_binding_namespace
    CHECK (split_part(substr(secret_ref, 9), '/', 1) = split_part(split_part(connector, '.', 1), ':', 1))
);
CREATE UNIQUE INDEX cg_connector_binding_one_active
  ON public.cg_connector_binding (connector, scope, COALESCE(tenant_ref, ''))
  WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.cg_connector_binding_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $f$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'cg_connector_binding rows are never deleted; revoke instead' USING ERRCODE = '42501';
  END IF;
  IF (NEW.connector, NEW.scope, NEW.tenant_ref, NEW.secret_ref)
     IS DISTINCT FROM (OLD.connector, OLD.scope, OLD.tenant_ref, OLD.secret_ref) THEN
    RAISE EXCEPTION 'cg_connector_binding reference is immutable; rotate by adding a new binding' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'revoked' AND NEW.status <> 'revoked' THEN
    RAISE EXCEPTION 'a revoked binding cannot be reactivated' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END
$f$;
CREATE TRIGGER cg_connector_binding_guard BEFORE UPDATE OR DELETE ON public.cg_connector_binding
  FOR EACH ROW EXECUTE FUNCTION public.cg_connector_binding_guard();

-- ---- 3. call ledger (append-only) ------------------------------------------
CREATE TABLE public.cg_tool_call_ledger (
  id               uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  kind             text NOT NULL CHECK (kind IN ('decision', 'outcome')),
  parent_id        uuid REFERENCES public.cg_tool_call_ledger(id),
  twin_context_id  uuid NOT NULL REFERENCES public.cg_twin_context(id),
  tenant_ref       text NOT NULL,
  tool_id          text NOT NULL,
  tool_version     text NOT NULL,
  tier             text NOT NULL CHECK (tier IN ('T0','T1','T2','T3','T4')),
  verdict          text CHECK (verdict IN ('execute','shadow','propose','queue_approval','sheriff_passkey','deny')),
  deny_code        text CHECK (deny_code IS NULL OR deny_code ~ '^[a-z_]{3,40}$'),
  reasons          jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reasons) = 'array' AND pg_column_size(reasons) < 8192),
  args_digest      text NOT NULL CHECK (args_digest ~ '^[0-9a-f]{64}$'),
  args_redacted    jsonb NOT NULL DEFAULT '{}'::jsonb
                     CHECK (pg_column_size(args_redacted) < 16384 AND NOT public.cg_tool_jsonb_has_secret_key(args_redacted)),
  idempotency_key  text CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 128),
  approval_ref     text CHECK (approval_ref IS NULL OR length(approval_ref) BETWEEN 1 AND 128),
  approver_kind    text CHECK (approver_kind IS NULL OR approver_kind IN ('role_owner', 'platform_staff', 'sheriff')),
  outcome          text CHECK (outcome IS NULL OR outcome IN ('succeeded', 'failed', 'aborted')),
  created_at       timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT cg_tool_ledger_registry_fk FOREIGN KEY (tool_id, tool_version)
    REFERENCES public.cg_tool_registry (tool_id, version),
  CONSTRAINT cg_tool_ledger_shape CHECK (
    (kind = 'decision' AND verdict IS NOT NULL AND outcome IS NULL AND parent_id IS NULL)
    OR (kind = 'outcome' AND verdict IS NULL AND outcome IS NOT NULL AND parent_id IS NOT NULL)
  ),
  CONSTRAINT cg_tool_ledger_deny_code CHECK ((verdict = 'deny') = (deny_code IS NOT NULL) OR kind = 'outcome'),
  CONSTRAINT cg_tool_ledger_t4_denied CHECK (tier <> 'T4' OR verdict = 'deny')
);
CREATE UNIQUE INDEX cg_tool_ledger_idempotency
  ON public.cg_tool_call_ledger (twin_context_id, tool_id, idempotency_key)
  WHERE kind = 'decision' AND idempotency_key IS NOT NULL;
CREATE INDEX cg_tool_ledger_parent_idx ON public.cg_tool_call_ledger (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX cg_tool_ledger_ctx_time_idx ON public.cg_tool_call_ledger (twin_context_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.cg_tool_ledger_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $f$
DECLARE
  v_tier text; v_ctx_tenant text; v_ctx_status text;
  p public.cg_tool_call_ledger%ROWTYPE;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'cg_tool_call_ledger is append-only' USING ERRCODE = '42501';
  END IF;
  -- The logged tier and tenant must be the registry's and the context's, not the caller's.
  SELECT tier INTO v_tier FROM public.cg_tool_registry WHERE tool_id = NEW.tool_id AND version = NEW.tool_version;
  IF v_tier IS DISTINCT FROM NEW.tier THEN
    RAISE EXCEPTION 'ledger tier % does not match registry tier % for %', NEW.tier, v_tier, NEW.tool_id USING ERRCODE = '23514';
  END IF;
  SELECT tenant_ref, status INTO v_ctx_tenant, v_ctx_status FROM public.cg_twin_context WHERE id = NEW.twin_context_id;
  IF v_ctx_tenant IS DISTINCT FROM NEW.tenant_ref THEN
    RAISE EXCEPTION 'ledger tenant does not match the acting context tenant' USING ERRCODE = '23514';
  END IF;
  IF NEW.kind = 'decision' THEN
    IF NEW.verdict IN ('execute', 'queue_approval', 'sheriff_passkey') AND v_ctx_status <> 'active' THEN
      RAISE EXCEPTION 'only an active context may be cleared to act' USING ERRCODE = '23514';
    END IF;
    IF NEW.tier = 'T3' AND NEW.verdict NOT IN ('sheriff_passkey', 'deny') THEN
      RAISE EXCEPTION 'a T3 call can only be sheriff_passkey or deny' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  -- outcome
  SELECT * INTO p FROM public.cg_tool_call_ledger WHERE id = NEW.parent_id;
  IF NOT FOUND OR p.kind <> 'decision' THEN
    RAISE EXCEPTION 'an outcome must point at a decision' USING ERRCODE = '23514';
  END IF;
  IF (p.twin_context_id, p.tool_id, p.tool_version, p.tenant_ref, p.tier, p.args_digest)
     IS DISTINCT FROM (NEW.twin_context_id, NEW.tool_id, NEW.tool_version, NEW.tenant_ref, NEW.tier, NEW.args_digest) THEN
    RAISE EXCEPTION 'an outcome must repeat its decision''s context, tool, tier and argument digest' USING ERRCODE = '23514';
  END IF;
  IF NEW.outcome = 'succeeded' THEN
    IF p.verdict NOT IN ('execute', 'queue_approval', 'sheriff_passkey') THEN
      RAISE EXCEPTION 'a % decision can never produce a successful side effect', p.verdict USING ERRCODE = '23514';
    END IF;
    IF p.verdict = 'sheriff_passkey' AND (NEW.approval_ref IS NULL OR NEW.approver_kind IS DISTINCT FROM 'sheriff') THEN
      RAISE EXCEPTION 'a T3 success needs a sheriff approval' USING ERRCODE = '23514';
    END IF;
    IF p.verdict = 'queue_approval' AND (NEW.approval_ref IS NULL OR NEW.approver_kind IS NULL) THEN
      RAISE EXCEPTION 'an approved action needs its approval reference' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM public.cg_tool_call_ledger o
               WHERE o.parent_id = p.id AND o.outcome = 'succeeded') THEN
      RAISE EXCEPTION 'a decision can succeed only once' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$f$;
CREATE TRIGGER cg_tool_ledger_guard BEFORE INSERT OR UPDATE OR DELETE ON public.cg_tool_call_ledger
  FOR EACH ROW EXECUTE FUNCTION public.cg_tool_ledger_guard();
CREATE TRIGGER cg_tool_ledger_no_truncate BEFORE TRUNCATE ON public.cg_tool_call_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION public.cg_tool_ledger_guard();

-- ---- posture ---------------------------------------------------------------
ALTER TABLE public.cg_tool_registry     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_tool_registry     FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.cg_connector_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_connector_binding FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.cg_tool_call_ledger  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_tool_call_ledger  FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON public.cg_tool_registry, public.cg_connector_binding, public.cg_tool_call_ledger
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.cg_tool_registry TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.cg_connector_binding TO service_role;
GRANT SELECT, INSERT ON public.cg_tool_call_ledger TO service_role;
REVOKE ALL ON FUNCTION public.cg_tool_tier_rank(text), public.cg_tool_effect_floor(text),
  public.cg_tool_jsonb_has_secret_key(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_tool_tier_rank(text), public.cg_tool_effect_floor(text),
  public.cg_tool_jsonb_has_secret_key(jsonb) TO service_role;

COMMENT ON TABLE public.cg_tool_call_ledger IS
  'ENGINE-03 / ADR-081: append-only record of every brokered call (decision) and its outcome. Holds digests and redacted summaries only; never a credential.';
COMMENT ON TABLE public.cg_connector_binding IS
  'ENGINE-03 / ADR-081: references (vault://...) to secrets held in the owner''s secret manager. Never a secret value.';
