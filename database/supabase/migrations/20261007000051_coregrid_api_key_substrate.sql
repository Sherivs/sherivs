-- =============================================================================
-- CoreGrid V1 — platform API-key substrate (PLATFORM-019)
-- =============================================================================
-- Status: AUTHORED for checksummed apply. Apply with:
--   node scripts/db-apply-one.mjs 20261007000051
-- Rollback:
--   database/supabase/rollbacks/20261007000051_coregrid_api_key_substrate.sql
--
-- Authority:
--   DECISIONS.md #210 (PLATFORM-019, 2026-10-07) — CoreGrid's own
--     Supabase-style key model: distinct key classes with distinct functions
--     (cg_publishable_… client-safe identifier; cg_secret_… server-side
--     privileged), each bound to one organization and an explicit scope
--     vector.
--   AGENTS.md §13 (multi-tenancy: tenant_id on every row),
--   AGENTS.md §16 (layered authorization — a key is one layer, never the
--     whole decision),
--   AGENTS.md §17 (RLS mandatory; application code never the only layer),
--   AGENTS.md §28 (immutable audit: revocation provenance is mandatory),
--   AGENTS.md §30 (the platform NEVER stores a key — only sha256 hashes).
--
-- Scope:
--   cg_api_key — one platform key: class (publishable|secret), sha256 hash
--     of the full key (the ONLY lookup form — plaintext is returned exactly
--     once at issuance and never stored), safe preview, stable fingerprint,
--     scope vector, lifecycle status, and full issuance/revocation
--     provenance. Rotation is re-issuance; revocation is terminal.
--
-- Domain-neutral: scope names are capability vocabulary (org/missions/
-- communications/webhooks) mirrored from
-- frontend/src/lib/apikeys/apikey-contract.ts COREGRID_KEY_SCOPES. No
-- domain-contaminated vocabulary anywhere (V5.3 Part 46).
--
-- Security: deny-by-default strongest form — RLS ENABLED with ZERO policies
-- and all anon/authenticated privileges REVOKED. API keys are authority
-- data (Invariant: agent authority flows only through explicit grants)
-- and are read/written exclusively through service-role server
-- functions (frontend/src/lib/apikeys/apikey-service.server.ts), which
-- Zod-validate every row read back (untrusted reads fail closed). Policies
-- may be authored by a follow-up migration under explicit authorization,
-- never silently.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.cg_api_key (
  api_key_ref   text PRIMARY KEY CHECK (length(api_key_ref) BETWEEN 1 AND 160),
  tenant_id     text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  type          text NOT NULL CHECK (type IN ('publishable','secret')),
  -- sha256 hex of the FULL key; the plaintext never enters this table.
  key_hash      text NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  -- prefix + first 4 material chars: safe display, non-secret.
  key_preview   text NOT NULL CHECK (length(key_preview) BETWEEN 1 AND 32),
  -- first 12 hex of key_hash: stable public identifier.
  fingerprint   text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{12}$'),
  scopes        text[] NOT NULL CHECK (array_length(scopes, 1) >= 1),
  status        text NOT NULL CHECK (status IN ('active','revoked')),
  created_by    text NOT NULL CHECK (length(created_by) BETWEEN 1 AND 160),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz,
  revoked_at    timestamptz,
  revoked_by    text CHECK (length(revoked_by) BETWEEN 1 AND 160),
  revoke_reason text,
  note          text,
  -- Revocation coherence at the database level, not only in the app:
  -- a revoked row MUST carry who/when; an active row MUST NOT.
  CONSTRAINT cg_api_key_revocation_coherence CHECK (
    (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
    OR
    (status = 'active' AND revoked_at IS NULL AND revoked_by IS NULL)
  )
);

COMMENT ON TABLE public.cg_api_key IS $comment$PLATFORM-019 platform API-key
substrate: Supabase-style key classes (cg_publishable_ client-safe,
cg_secret_ server-privileged) bound to one organization and an explicit
scope vector. The plaintext key is NEVER stored — key_hash is sha256 of the
full key; key_preview and fingerprint are non-secret display forms.
Revocation is terminal and must carry who/when (CHECK-enforced). RLS enabled
with zero policies; service-role server functions are the only writer and
reader.$comment$;

CREATE INDEX IF NOT EXISTS cg_api_key_tenant_status_idx
  ON public.cg_api_key (tenant_id, status);

-- -----------------------------------------------------------------------------
-- Deny-by-default security posture
-- -----------------------------------------------------------------------------
ALTER TABLE public.cg_api_key ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cg_api_key FROM anon, authenticated;

-- =============================================================================
-- End of migration. Verification (run after apply):
--   • table exists with relrowsecurity = true and zero rows in pg_policies;
--   • anon/authenticated hold NO privileges;
--   • a key_hash that is not sha256 hex is rejected (CHECK);
--   • a revoked row without who/when is rejected (coherence CHECK);
--   • an active row carrying revocation provenance is rejected (coherence);
--   • the same full key cannot be stored twice (key_hash UNIQUE).
-- =============================================================================