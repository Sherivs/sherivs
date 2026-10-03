-- =============================================================================
-- CoreGrid V1 — file-substrate table cg_file_object (MISSION H3-027 / L-T-011)
-- =============================================================================
-- Status: AUTHORED, NOT APPLIED. Do not treat this file as a live database.
-- Apply only with an explicit human authorization decision (governance law):
--   supabase db push --workdir database/supabase
-- Rollback (genuine inverse of this migration; the repository convention
--   stores rollbacks in the rollbacks/ directory under the migration's own
--   basename — see database/supabase/rollbacks/ contents):
--   database/supabase/rollbacks/20261003000016_coregrid_v1_file_substrate.sql
--
-- Authority:
--   MISSION H3-027 (Squad C / L-T-011 File Substrate Engineer), closing the
--   OPEN remainder of THREAT_MITIGATIONS_LT.md L-T-011 (file-plane path
--   escape): the V1 file plane had no substrate table, so the storage
--   adapter's path convention was the only tenant enforcement below the pure
--   access policy (InformationDisclosure, V1CAP-012, medium). This migration
--   gives the file plane a database substrate so the database — not only a
--   path convention — carries the tenant boundary.
--   Exemplar: 20261002000013_coregrid_v1_neutral_membership_policies.sql and
--   20261002000015_coregrid_v1_substrate_policies.sql — neutral-primitives-
--   only policy construction, FORCE RLS, exact policy sets, grant posture,
--   actor self-derivation pins, and the COMMENT documentation pattern are all
--   inherited from them.
--   J-005 neutral tenant primitives (20261002000001):
--   public.get_my_tenant_id() / public.is_tenant_admin() /
--   public.holds_tenant_role() are the ONLY tenant predicates referenced
--   below (plus the platform identity primitive auth.uid() for actor
--   self-derivation, the same allowance the exemplar posture grants).
--   Contract: frontend/src/lib/files/file-contract.ts (MISSION-V1-012,
--   V5.3 Part 22) — purpose/visibility vocabularies, size ceilings and the
--   descriptor shape; frontend/src/lib/files/storage-adapter.server.ts — the
--   `<tenant_id>/<purpose>/<filename>` object-path convention, mirrored here
--   as a table CHECK so the DB itself rejects a cross-tenant content ref.
--   AGENTS.md §13 (every request must have tenant context), §16 (layered
--   authorization), §17 (RLS mandatory; application code is never the only
--   security layer), §26 (never trust client-supplied identity, tenant or
--   role), §28 (immutable audit records — no DELETE path; removal is a
--   tombstone transition), §34 (the UI/policy layer is not the boundary).
--
-- -----------------------------------------------------------------------------
-- INTENDED POSTURE ENTRY (declarative; authored HERE ONLY — deliberately NOT
-- written into scripts/verification/rls-table-postures-*.json, which are
-- owned by other teams; the battery steward consumes them separately):
-- -----------------------------------------------------------------------------
--   {
--     "name": "cg_file_object",
--     "source": "20261003000016_coregrid_v1_file_substrate.sql",
--     "rollback":
--       "database/supabase/rollbacks/20261003000016_coregrid_v1_file_substrate.sql",
--     "posture": "policy-backed",
--     "zeroPolicy": false,
--     "forceRls": true,
--     "tenantColumn": "tenant_id",
--     "policySummary": "FORCE RLS with tenant-scoped policies built ONLY on
--       the J-005 neutral primitives: SELECT is tenant-equality via
--       public.get_my_tenant_id(); INSERT and UPDATE are tenant-equality AND
--       the actor self-derivation pin owner_ref = auth.uid()::text; DELETE
--       has NO policy (denied — tombstone via deleted_at, history preserved).
--       anon holds zero privileges; authenticated holds exactly SELECT +
--       INSERT + UPDATE; service_role holds the sanctioned bypass-path
--       parity grant."
--   }
--
-- =============================================================================
-- SCOPE
-- =============================================================================
-- Exactly ONE table is created and policy-backed:
--   cg_file_object — the V1 file plane's descriptor substrate: one row per
--       stored object, carrying the tenant, the owning actor, the purpose,
--       the content type and size, the sanitized filename, the sharing
--       visibility model, the grant refs for explicit sharing, and the
--       tenant-prefixed storage content ref.
--
-- Layered-boundary law (why the CHECK constraint below exists):
--   L-T-011 names three layers: the pure access policy
--   (frontend/src/lib/files/access-policy.ts, deny-by-default, already
--   adversarially tested), the adapter path convention
--   (storage-adapter.server.ts assertTenantScopedPath), and — until now
--   missing — the database boundary. This migration completes the layering:
--   the content_ref CHECK pins the row's storage path to the row's own
--   tenant prefix (`tenant_id/purpose/filename`, byte-for-byte the adapter's
--   buildObjectPath shape), so a row cannot even EXIST whose content ref
--   points outside its tenant, regardless of RLS, adapter, or client
--   behavior. RLS then bounds WHO may see or write such rows; the CHECK
--   bounds WHAT a lawful row may point at.
--
-- Sharing-model layering (what RLS deliberately does NOT decide):
--   RLS here is the TENANT boundary, not the per-actor sharing gate.
--   The in-tenant sharing model (private / org / explicit grant refs) stays
--   owned by the access policy + service path (file-contract.ts §31: the
--   module grants nothing by itself — RLS and the path convention remain the
--   boundary). Authoring per-row sharing predicates in RLS would duplicate —
--   and could drift from — the policy engine's decision surface. A future
--   per-actor SELECT refinement is a SEPARATE authorization decision
--   under explicit review, never an implied widening of this migration.
--
-- Write-posture deviation from the 20261002000013 exemplar (documented):
--   The exemplar gates INSERT/UPDATE on public.is_tenant_admin(tenant)
--   because its substrates are membership/assignment fabric administered by
--   tenant administrators. A file object's lawful writer is its OWNER
--   (file-contract.ts: the owner is "always allowed within its own
--   tenant"; members upload attachments/avatars/documents, not only
--   administrators). The INSERT/UPDATE predicates below are therefore
--   tenant-equality via get_my_tenant_id() AND the actor self-derivation pin
--   owner_ref = auth.uid()::text — the same pin pattern the mh-04 exemplar
--   (20261002000015) authors for subscriber_id/captured_by/created_by. A
--   client can never register a file object for another actor, and no
--   predicate trusts a client-supplied tenant. Uploading on behalf of
--   another actor is a server-function concern (service_role).
--
-- Deletion law (Constitution §28):
--   NO DELETE policy and no DELETE privilege are authored. Removal of a file
--   object is a tombstone transition (deleted_at), never a row erasure; the
--   audit story of "who stored what" survives.
--
-- COND-003 parameterization (tenant_id text vs uuid — UNRESOLVED):
--   tenant_id is `text NOT NULL CHECK (length 1..128)` per applied reality
--   (cg_identity.tenant_id, cg_org_membership.tenant_id, the event-routing
--   substrate 20261002000007 §Tenant posture). If COND-003 rules uuid
--   (MISSION-R-02), a follow-up migration converts the substrate column and
--   the neutral primitives keep working unchanged (uuid::text renders
--   canonically); no signature churn under either outcome.
--
-- Deliberately NOT in scope:
--   • Supabase Storage bucket/policy provisioning (storage.* schema) — the
--     bucket `coregrid-files` and its storage policies are infrastructure
--     configuration, not this substrate.
--   • Per-actor sharing RLS (see Sharing-model layering above).
--   • Grant records themselves (grant_refs hold refs only; a first-class
--     grant table would need its own mission and posture entry).
--   • Quotas/metering on storage growth (tracked in the hardening stream).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. cg_file_object — the file-plane descriptor substrate
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_file_object (
  -- Stable file id explicit grants point at (file-contract.ts fileId).
  id            text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  tenant_id     text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  -- Owner actor ref (user id). The INSERT/UPDATE policies pin it to the
  -- acting identity (Constitution §26 — a client can never assert another
  -- actor's ownership).
  owner_ref     text NOT NULL CHECK (length(owner_ref) BETWEEN 1 AND 200),
  -- Closed purpose vocabulary (file-contract.ts FILE_PURPOSES).
  purpose       text NOT NULL CHECK (purpose IN ('attachment','evidence','document','avatar')),
  content_type  text NOT NULL CHECK (length(content_type) BETWEEN 3 AND 255),
  -- Coarse DB-level size bound (the per-purpose ceilings — 25 MB / 5 MB —
  -- are enforced by the contract's validation; the DB bound exists so an
  -- out-of-band writer cannot store an unbounded size either).
  size_bytes    bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 268435456),
  -- Sanitized filename (file-contract.ts sanitizeFilename): no separators,
  -- no traversal segments — the DB repeats the adapter's refusal shapes.
  filename      text NOT NULL CHECK (
                  length(filename) BETWEEN 1 AND 180
                  AND position('/' in filename) = 0
                  AND position(chr(92) in filename) = 0
                  AND position('..' in filename) = 0
                ),
  -- Closed sharing vocabulary (file-contract.ts FileVisibility).
  visibility    text NOT NULL CHECK (visibility IN ('private','org','explicit')),
  -- Grant refs for explicit sharing (JSON array of grant id strings; empty
  -- unless visibility = 'explicit' — the service path validates the
  -- non-empty coupling; the DB only bounds the shape).
  grant_refs    jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(grant_refs) = 'array'),
  -- The storage object path. DB-level tenant boundary (L-T-011): the ref is
  -- pinned to the EXACT adapter path shape `<tenant_id>/<purpose>/<filename>`
  -- of the row's own tenant — a cross-tenant or traversal content ref can
  -- never satisfy the constraint, so the row can never exist.
  content_ref   text NOT NULL CHECK (
                  length(content_ref) BETWEEN 1 AND 600
                  AND content_ref = tenant_id || '/' || purpose || '/' || filename
                ),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- Tombstone instant: removal is a transition, never an erasure (§28).
  deleted_at    timestamptz
);

COMMENT ON TABLE public.cg_file_object IS
  $comment$MISSION H3-027 / L-T-011 V1 file-plane descriptor substrate. One row
  per stored object: tenant, owning actor, purpose, content type/size,
  sanitized filename, sharing visibility + grant refs, and the tenant-prefixed
  storage content_ref. The content_ref CHECK pins the storage path to the
  row's own tenant prefix (the adapter's <tenant>/<purpose>/<filename> shape,
  byte-for-byte) — the database, not only the adapter path convention, carries
  the L-T-011 tenant boundary. RLS FORCED with tenant-scoped policies built
  only on the J-005 neutral primitives (20261003000016): SELECT is
  tenant-equality via get_my_tenant_id(); INSERT/UPDATE additionally pin
  owner_ref = auth.uid()::text (actor self-derivation, Constitution §26);
  DELETE has no policy (denied — tombstone via deleted_at, history preserved).
  In-tenant sharing (private/org/explicit) stays owned by the access policy +
  service path; RLS is the tenant boundary, not the sharing gate. Rollback:
  database/supabase/rollbacks/20261003000016_coregrid_v1_file_substrate.sql.$comment$;

COMMENT ON COLUMN public.cg_file_object.content_ref IS
  $comment$Storage object path inside the coregrid-files bucket. CHECK-pinned
  to tenant_id || '/' || purpose || '/' || filename — the exact shape of the
  storage adapter's buildObjectPath — so a row whose content ref escapes its
  own tenant prefix cannot exist (L-T-011 database-layer boundary).$comment$;

CREATE UNIQUE INDEX IF NOT EXISTS cg_file_object_tenant_content_ref_idx
  ON public.cg_file_object (tenant_id, content_ref);

CREATE INDEX IF NOT EXISTS cg_file_object_tenant_owner_idx
  ON public.cg_file_object (tenant_id, owner_ref, created_at);

CREATE INDEX IF NOT EXISTS cg_file_object_tenant_purpose_idx
  ON public.cg_file_object (tenant_id, purpose, created_at);

-- -----------------------------------------------------------------------------
-- 2. FORCE ROW LEVEL SECURITY (the owner is bound by RLS for non-bypass
--    owners; the platform owner postgres holds the sanctioned BYPASSRLS
--    attribute per the exemplar's SECURITY DEFINER analysis, so the
--    service-role / definer path is unaffected).
-- -----------------------------------------------------------------------------

ALTER TABLE public.cg_file_object ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_file_object FORCE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 3. Table privileges — deny-by-default base posture first (zero policies
--    would otherwise already deny, but privileges are revoked explicitly so
--    the posture is defense-in-depth), then authenticated receives exactly
--    SELECT + INSERT + UPDATE (least privilege; no DELETE — tombstone law).
--    anon stays revoked (zero privileges, zero policy grants). service_role
--    holds the sanctioned server-only bypass-path parity grant (exemplar
--    20260907000800 §3 convention).
-- -----------------------------------------------------------------------------

REVOKE ALL ON public.cg_file_object FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.cg_file_object TO authenticated;
GRANT ALL ON TABLE public.cg_file_object TO service_role;

-- -----------------------------------------------------------------------------
-- 4. Policies — every predicate is a positive, per-row authorization test
--    built ONLY on the J-005 neutral primitives + auth.uid() self-derivation:
--      SELECT  USING tenant-equality: tenant_id = public.get_my_tenant_id()
--              (resolved from active neutral bindings; NULL for an unbound
--              actor filters every row; AMBIGUOUS_TENANCY raises —
--              fail-closed and observable, per NEUTRAL_TENANT_PRIMITIVES §8
--              risk 4);
--      INSERT  WITH CHECK tenant-equality AND owner_ref = auth.uid()::text
--              (an actor registers only its own objects in its own
--              tenant; no client-supplied tenant or owner is ever trusted —
--              Constitution §26);
--      UPDATE  USING + WITH CHECK tenant-equality AND the owner pin (a row
--              cannot be re-attributed to another actor nor moved into
--              a tenant the actor is not bound to);
--      DELETE  NO policy AND no privilege — denied twice over (tombstone
--              via deleted_at; history preserved, §28).
--    holds_tenant_role / is_tenant_admin are available but intentionally
--    UNUSED here: no file-plane client path requires an administrator gate
--    (owners are the lawful writers; administrative operations are
--    server-function concerns), and the only role reachable through the
--    primitives — the NEUTRAL 'role:administrator' token — would import a
--    role gate this layer does not need (J-006: domain role names never
--    enter the policy layer).
-- -----------------------------------------------------------------------------

CREATE POLICY file_object_select_own_tenant
  ON public.cg_file_object
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id());

CREATE POLICY file_object_insert_own_tenant
  ON public.cg_file_object
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_my_tenant_id()
    AND owner_ref = auth.uid()::text
  );

CREATE POLICY file_object_update_own_tenant
  ON public.cg_file_object
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND owner_ref = auth.uid()::text
  )
  WITH CHECK (
    tenant_id = public.get_my_tenant_id()
    AND owner_ref = auth.uid()::text
  );

COMMENT ON POLICY file_object_select_own_tenant ON public.cg_file_object IS
  $comment$J-005 tenant-equality: a file object is visible only when its
  tenant_id equals the actor's single active neutral binding resolved by
  get_my_tenant_id(). Unbound actor -> NULL -> zero rows;
  AMBIGUOUS_TENANCY raises (fail-closed, observable). Cannot widen access:
  the tenant ref comes from the neutral substrate, never from the client.
  The in-tenant sharing model (private/org/explicit) is enforced by the
  access policy above this tenant boundary — RLS does not decide sharing.$comment$;

COMMENT ON POLICY file_object_insert_own_tenant ON public.cg_file_object IS
  $comment$J-005 tenant-equality AND actor self-derivation (Constitution §26):
  an authenticated actor may register a file object only in its own resolved
  tenant and only with owner_ref = auth.uid()::text — no client-supplied
  tenant and no asserted other-actor ownership can satisfy the predicate.
  The content_ref CHECK additionally pins the storage path to the row's own
  tenant prefix (L-T-011).$comment$;

COMMENT ON POLICY file_object_update_own_tenant ON public.cg_file_object IS
  $comment$J-005 tenant-equality AND owner pin on BOTH USING and WITH CHECK:
  only the owning actor of the row's own tenant may update, and the
  updated row must still carry the acting owner and tenant — a file object
  cannot be re-attributed to another actor nor moved across tenants.
  No DELETE policy exists (tombstone via deleted_at; §28).$comment$;

-- =============================================================================
-- End of migration. Post-apply verification (in this order, after the
-- coordinator's apply authorization):
--   node scripts/verify-rls-isolation-battery.mjs  (cross-tenant probes;
--     NOTE: adding cg_file_object to the battery scope JSON is a posture-file
--     change owned by the battery steward — NOT part of this mission)
--   supabase-side catalog check: relforcerowsecurity = true, exactly the
--   three policies above in pg_policies, anon holds zero privileges,
--   authenticated holds SELECT/INSERT/UPDATE only.
-- The unit suite tests/unit/h3-027-file-substrate.test.ts pins this
-- migration text mechanically until live verification is authorized.
-- =============================================================================