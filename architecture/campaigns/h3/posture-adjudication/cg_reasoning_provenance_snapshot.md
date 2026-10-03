# Posture Adjudication — `cg_reasoning_provenance_snapshot` (H3-038, Squad D)

Role: Posture Adjudication Engineer (provenance/usage family). Mission D-038.
Status: ADJUDICATED — zero-policy-by-design. Nothing applied; no posture file, migration, or policy was modified.

## OWNERSHIP

- **Creating migration:** `database/supabase/migrations/20261002000009_coregrid_v1_reasoning_provenance.sql` (MISSION-R-33 / J-015 / V1CAP-029). Rollback: `database/supabase/rollbacks/20261002000009_coregrid_v1_reasoning_provenance.sql`.
- **Owning server paths (the only write/read paths found by `rg` repo-wide):**
  - Adapter: `frontend/src/lib/adapters/reasoning-provenance-store.adapter.ts` — exports `REASONING_PROVENANCE_SNAPSHOT_TABLE = "cg_reasoning_provenance_snapshot"`; service-role-only injected client; append-only, idempotent writes (`ON CONFLICT DO NOTHING`); no UPDATE/DELETE path authored.
  - Pure contract: `frontend/src/lib/ai-gateway/reasoning-provenance.ts` (J-015 / V1CAP-029) — the intelligence-snapshot contract validated fail-closed by `validateIntelligenceSnapshot` before any persistence.
  - Test pin: `tests/unit/adapter-reasoning-provenance.test.ts` (mechanically pins the migration text).
- **Client-facing surface:** none. No REST/UI path reads or writes this table; the adapter is the single vendor boundary (Constitution §24/§25).

## EVIDENCE

- **Battery scope (READ-ONLY confirmation):** `node scripts/verify-rls-isolation-battery.mjs --dry-parse-scope` (offline, no credentials) resolves
  `cg_reasoning_provenance_snapshot posture=zero-policy forceRls=false policies=0 tenantColumn=n/a source=20261002000009_coregrid_v1_reasoning_provenance.sql postureSource=rls-table-postures-substrate.json`.
- **Posture registry:** `scripts/verification/rls-table-postures-substrate.json` declares the table as `"posture": "zero-policy"` with rationale "reasoning provenance snapshots are derived-intelligence records consumed server-side; not authorized for tenant-scoped client access by H2-04 — unchanged deny-by-default". The battery's built-in canonical posture (`BUILTIN_TABLE_POSTURES`, source migration `20261002000009`) agrees.
- **Migration text:** `ENABLE ROW LEVEL SECURITY` with ZERO policies; `REVOKE ALL ... FROM anon, authenticated`. The migration header states under "Deliberately NOT in scope": "RLS policies: ZERO policies authored (deny-by-default strongest form; policies come later from the policy team and the RLS battery)" and under "Deny-by-default security posture": "no tenant-scoped policy yet exists that provably cannot widen reads beyond the snapshot's tenant — access runs through service-role server functions".
- **Policy layer:** migration `20261002000015_coregrid_v1_substrate_policies.sql` (H2-04) lists this table explicitly under "Unchanged (out of scope; remain zero-policy deny-by-default)".

## DECISION

**ZERO-POLICY-BY-DESIGN.** The zero-policy deny-by-default posture (RLS enabled, zero policies, no anon/authenticated grants) is correct and legitimate for V1. No client-facing policy is proposed.

## RATIONALE

1. **Integrity surface, not a client resource (§12/§15).** A snapshot row is a data-provenance record: WHICH model, WHICH context version, WHICH routing decisions, token/cost attribution, and deterministic digests — with `generated_by_ai` CHECK-pinned `true` and `verified` CHECK-pinned `false`. Any client-writable policy on an integrity surface invites forged provenance; any client-readable policy widens an AI-provenance ledger before an authorization model for it exists. The substrate itself enforces integrity (id = snapshot digest, tenant/origin agreement, envelope atomicity) — a policy layer adds row filtering, not integrity.
2. **Derived intelligence, never canonical truth (§9).** The snapshot is the Intelligence side of the Reality/Intelligence split; the canonical record it is stamped onto lives in the kernel substrate. Promotion of AI-derived material is the evidence lifecycle's recorded act (E-017), never this table's.
3. **No legitimate V1 client path.** The only consumer is the service-role server path (the adapter), which enforces the contract's per-tenant attribution by construction. Zero policies mean no policy expression anywhere can evaluate true — the strongest-form denial (battery §d ISOLATION_PROOF derivation); every client role is denied identically, and revoked/expired access fails closed.
4. **Fail-closed default (§17/§21).** The migration's own law and the H2-04 policy layer both preserve the posture: policies "may be authored by a follow-up migration under explicit authorization, never silently."

## CONSTITUTION SECTIONS

- §9 (Canonical truth vs Intelligence — snapshot is derived provenance, never truth)
- §12 (Data provenance — this table IS the provenance surface; provenance must be trustworthy, hence immutable and non-client-writable)
- §15 (Identity principle — verification state is pinned server-side; `verified = false` is untrusted-by-default identity of AI output)
- §17 (Database security — RLS enabled; deny-by-default; application/adapter is not the only layer because zero policies + zero grants is the database-level gate)
- §19 (AI privacy/minimization — output persisted as digest only)
- §20 (AI gateway — the gateway's persistence boundary owns access)
- §21 (AI output trust — untrusted by default; the table's markers cannot be flipped through any client path)
- §28 (Database law — append-only, CHECK-constrained, no UPDATE/DELETE path)

## PROPOSED-POLICY-IF-ANY

**None.** No client-facing policy is legitimate in V1: there is no client consumer, and a tenant-scoped SELECT policy on AI-provenance records would be a new authorization decision (whose administrators may read provenance? at what classification for actor/agent references?) that must be made under explicit authorization with the H2-04 policy-construction law (neutral primitives only, actor self-derivation pins, provenance columns never filtered). If a future phase introduces a client-facing provenance view, the direction would be: tenant-equality SELECT via `public.get_my_tenant_id()`, no INSERT/UPDATE/DELETE policy ever (the substrate is append-only by its own law), declared as posture-file data with a §4.4 probe recipe. Recorded here as direction only — nothing authored, nothing applied.
