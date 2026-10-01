-- =============================================================================
-- CoreGrid V1 — Universal organization model (V1-minimal, MISSION-V1-006)
-- =============================================================================
-- Status: AUTHORED, NOT APPLIED. Do not treat this file as a live database.
-- Apply only with an explicit human authorization decision (governance law):
--   supabase db push --workdir database/supabase
-- Rollback (not applied by this migration):
--   database/supabase/rollbacks/20261001000000_coregrid_v1_org_model.sql
--
-- Authority:
--   V5.3 Part 7.2  — organizations dynamically configurable, domain-neutral
--                    (org creation, profile, settings, departments, teams,
--                    branches, locations, roles, members, managers)
--   V5.3 Part 46   — no domain contamination: no "school" (or any other
--                    domain) vocabulary appears in this universal model
--   Mission: MISSION-V1-006 organization + entity runtime
--   Style exemplar: 20260930000000_coregrid_v1_workspace_persistence.sql
--
-- Scope:
--   cg_org_unit       — universal org-tree node (kind: organization |
--                       department | team | branch | location) with parent
--                       self-reference, typed-lifecycle state and a
--                       domain-neutral JSON profile payload
--   cg_org_membership — binding of a principal (human or workforce position
--                       ref) to an org unit under a declared role
--
-- Domain-neutral: kind and lifecycle vocabularies mirror org-model.ts
-- ORG_UNIT_KINDS / ORG_UNIT_LIFECYCLE_STATES / ORG_MEMBERSHIP_STATES. The
-- profile column stores JSON objects the kernel never interprets (same
-- posture as cg_org_profile). Principal and role refs are opaque text.
--
-- Tenant reference: tenant_id is `text NOT NULL CHECK (length 1..128)`,
-- copying the EXACT tenant style of the workspace persistence exemplar
-- (20260930000000) and the substrate-wide convention (cg_identity.tenant_id,
-- cg_org_profile.tenant_ref). Those are text, while cg_tenant.id is uuid, so
-- a hard FK to cg_tenant(id) is not type-compatible without a substrate-wide
-- migration; that decision is deferred to the operator.
--
-- Same-tenant tree integrity: a composite FK
-- (parent_org_unit_id, tenant_id) -> cg_org_unit (id, tenant_id) makes a
-- cross-tenant parent impossible at the database level, not only in the
-- application model.
--
-- Security: deny-by-default, following the exemplar posture exactly — RLS is
-- ENABLED with ZERO policies and all anon/authenticated privileges are
-- REVOKED, so those roles are fully denied; service-role server functions
-- are the only intended writers. NOTE (operator decision recorded here):
-- tenant-scoped policies for authenticated members were deliberately NOT
-- authored because the only existing membership helpers
-- (get_my_school_id / is_school_admin) are Scholar-domain vocabulary; wiring
-- them into the universal organization model would violate Part 46. If and
-- when a domain-neutral tenant-membership helper exists, policies may be
-- added by a follow-up migration.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.cg_org_unit (
  id                  text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  tenant_id           text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  kind                text NOT NULL CHECK (kind IN ('organization','department','team','branch','location')),
  parent_org_unit_id  text REFERENCES public.cg_org_unit (id) ON DELETE RESTRICT,
  lifecycle_state     text NOT NULL DEFAULT 'active'
                        CHECK (lifecycle_state IN ('draft','active','suspended','archived','deleted')),
  profile             jsonb NOT NULL DEFAULT '{}'::jsonb
                        CHECK (jsonb_typeof(profile) = 'object'),
  created_by          text NOT NULL CHECK (length(created_by) BETWEEN 1 AND 160),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  CONSTRAINT cg_org_unit_parent_same_tenant_fk
    FOREIGN KEY (parent_org_unit_id, tenant_id)
    REFERENCES public.cg_org_unit (id, tenant_id)
    ON DELETE RESTRICT
);

COMMENT ON TABLE public.cg_org_unit IS
  'CoreGrid V1 universal organization unit (V5.3 Part 7.2). Domain-neutral '
  'org tree: kind vocabulary organization|department|team|branch|location. '
  'Profile payloads are never interpreted by the kernel. Membership rows and '
  'this table never grant authorization by themselves; permissions are '
  'resolved through the authorization layer at request time.';

CREATE INDEX IF NOT EXISTS cg_org_unit_tenant_idx
  ON public.cg_org_unit (tenant_id, lifecycle_state);

CREATE INDEX IF NOT EXISTS cg_org_unit_parent_idx
  ON public.cg_org_unit (parent_org_unit_id);

DROP TRIGGER IF EXISTS cg_org_unit_touch ON public.cg_org_unit;
CREATE TRIGGER cg_org_unit_touch
  BEFORE UPDATE ON public.cg_org_unit
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.cg_org_membership (
  id              text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  tenant_id       text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  org_unit_id     text NOT NULL REFERENCES public.cg_org_unit (id) ON DELETE CASCADE,
  principal_ref   text NOT NULL CHECK (length(principal_ref) BETWEEN 1 AND 160),
  role_ref        text NOT NULL CHECK (length(role_ref) BETWEEN 1 AND 160),
  state           text NOT NULL DEFAULT 'active'
                    CHECK (state IN ('invited','active','suspended','removed')),
  created_by      text CHECK (length(created_by) BETWEEN 1 AND 160),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cg_org_membership IS
  'CoreGrid V1 organization membership (V5.3 Part 7.2). Binding a principal '
  '(human or workforce position ref) to an org unit under a declared role '
  'never grants authorization by itself; permissions are resolved through '
  'the authorization layer (capability gates / RLS / server functions) at '
  'request time.';

-- One live membership per (unit, principal); suspended/removed rows allow
-- re-adding the principal later (mirrors the model-level duplicate rule).
CREATE UNIQUE INDEX IF NOT EXISTS cg_org_membership_live_unique
  ON public.cg_org_membership (org_unit_id, principal_ref)
  WHERE state IN ('invited', 'active');

CREATE INDEX IF NOT EXISTS cg_org_membership_tenant_idx
  ON public.cg_org_membership (tenant_id, principal_ref, state);

CREATE INDEX IF NOT EXISTS cg_org_membership_unit_idx
  ON public.cg_org_membership (tenant_id, org_unit_id);

DROP TRIGGER IF EXISTS cg_org_membership_touch ON public.cg_org_membership;
CREATE TRIGGER cg_org_membership_touch
  BEFORE UPDATE ON public.cg_org_membership
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Deny-by-default: RLS on, zero policies (mirrors the workspace persistence
-- exemplar and the foundation + kernel substrate security posture; verified
-- by the RLS isolation check).
ALTER TABLE public.cg_org_unit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_org_membership ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cg_org_unit FROM anon, authenticated;
REVOKE ALL ON public.cg_org_membership FROM anon, authenticated;
