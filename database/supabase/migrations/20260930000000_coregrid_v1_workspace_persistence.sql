-- =============================================================================
-- CoreGrid V1 — Workspace persistence (V1-minimal, MISSION-V1-007 step 3)
-- =============================================================================
-- Status: AUTHORED, NOT APPLIED. Do not treat this file as a live database.
-- Apply only with an explicit human authorization decision (governance law):
--   supabase db push --workdir database/supabase
--
-- Authority:
--   V5.3 Part 12  — workspaces are authorized projections, not source of truth
--   V5.3 Part 7.2 — organization structure, domain-neutral
--   Plan: architecture/coregrid-mvp-architecture/foundation/COREGRID_V1_MASTER_IMPLEMENTATION_PLAN.json (step 3)
--
-- Scope:
--   cg_workspace         — durable workspace record behind the existing
--                          workspace-core.ts domain model (Workspace interface)
--   cg_workspace_member  — workspace membership binding actors to workspaces
--
-- Domain-neutral: workspace type vocabulary mirrors workspace-core.ts
-- WORKSPACE_TYPES ("institution"|"campus"|"department"|"role"|"team"|
-- "personal"|"system"|"custom") — no Scholar-specific values. Lifecycle
-- vocabulary mirrors WORKSPACE_LIFECYCLE_STATES.
--
-- Security: domain-neutral. No anon or authenticated privileges. RLS is
-- enabled with zero policies, so those roles are denied. Service-role server
-- functions are the only intended writer and are not created here.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.cg_workspace (
  id                  text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  tenant_id           text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  name                text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  code                text NOT NULL CHECK (length(code) BETWEEN 1 AND 80),
  type                text NOT NULL CHECK (type IN ('institution','campus','department','role','team','personal','system','custom')),
  parent_workspace_id text REFERENCES public.cg_workspace (id) ON DELETE RESTRICT,
  lifecycle_state     text NOT NULL DEFAULT 'draft'
                        CHECK (lifecycle_state IN ('draft','active','suspended','archived','deleted')),
  module_ids          text[] NOT NULL DEFAULT '{}'::text[],
  default_page_id     text,
  is_discoverable     boolean NOT NULL DEFAULT false,
  region              text,
  timezone            text,
  locale              text,
  suspension_reason   text,
  archive_reason      text,
  config_version      integer NOT NULL DEFAULT 1 CHECK (config_version >= 1),
  created_by          text NOT NULL CHECK (length(created_by) BETWEEN 1 AND 160),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

COMMENT ON TABLE public.cg_workspace IS
  'CoreGrid V1 workspace record. Authorized projection backing store per '
  'V5.3 Part 12: never a source of organizational truth beyond its own '
  'configuration; never grants authority by existence.';

CREATE INDEX IF NOT EXISTS cg_workspace_tenant_idx
  ON public.cg_workspace (tenant_id, lifecycle_state);

CREATE INDEX IF NOT EXISTS cg_workspace_parent_idx
  ON public.cg_workspace (parent_workspace_id);

DROP TRIGGER IF EXISTS cg_workspace_touch ON public.cg_workspace;
CREATE TRIGGER cg_workspace_touch
  BEFORE UPDATE ON public.cg_workspace
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.cg_workspace_member (
  id              text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  tenant_id       text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  workspace_id    text NOT NULL REFERENCES public.cg_workspace (id) ON DELETE CASCADE,
  actor_id        text NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 160),
  member_role     text NOT NULL CHECK (length(member_role) BETWEEN 1 AND 80),
  state           text NOT NULL DEFAULT 'active'
                    CHECK (state IN ('invited','active','suspended','removed')),
  invited_by      text CHECK (length(invited_by) BETWEEN 1 AND 160),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, actor_id)
);

COMMENT ON TABLE public.cg_workspace_member IS
  'CoreGrid V1 workspace membership. Binding an actor to a workspace never '
  'grants authorization by itself; permissions are resolved through the '
  'authorization layer (cg_role_assignment / role gates) at request time.';

CREATE INDEX IF NOT EXISTS cg_workspace_member_actor_idx
  ON public.cg_workspace_member (tenant_id, actor_id, state);

DROP TRIGGER IF EXISTS cg_workspace_member_touch ON public.cg_workspace_member;
CREATE TRIGGER cg_workspace_member_touch
  BEFORE UPDATE ON public.cg_workspace_member
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Deny-by-default: RLS on, zero policies (mirrors the foundation + kernel
-- substrate security posture; verified by the RLS isolation check).
ALTER TABLE public.cg_workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_workspace_member ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cg_workspace FROM anon, authenticated;
REVOKE ALL ON public.cg_workspace_member FROM anon, authenticated;
