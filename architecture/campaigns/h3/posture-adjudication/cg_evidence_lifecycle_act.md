# Posture Adjudication — `cg_evidence_lifecycle_act`

- Team: H3-037 (Posture Adjudication Engineer, routing/evidence family, Squad D)
- Mission: D-037 (H3 wave campaign, `architecture/campaigns/H3-WAVE-CAMPAIGN.md`)
- Date: 2026-10-03
- Adjudication type: ZERO-POLICY-BY-DESIGN (append-only audit surface; no policy proposed)

## OWNERSHIP

- **Creating migration:** `database/supabase/migrations/20261002000008_coregrid_v1_evidence_lifecycle.sql` (§2, `CREATE TABLE IF NOT EXISTS public.cg_evidence_lifecycle_act`; the auditable evidence lifecycle act ledger — one row per `promotion` validation act, authorized `revocation` act, or declared `sufficiency_assessment` (J-033/J-034, MISSION-R-90/91, E-018), each pointing at its target evidence record via composite FK `(target_evidence_id, tenant_id) → cg_evidence_record(id, tenant_id) ON DELETE RESTRICT`, with the human `actor_id` (never AI — Constitution §21) and the recorded `act` payload; `UNIQUE (id, tenant_id)`).
- **Rollback:** `database/supabase/rollbacks/20261002000008_coregrid_v1_evidence_lifecycle.sql`.
- **Writing server path:** the service-role substrate adapter `frontend/src/lib/adapters/evidence-capture-store.adapter.ts` — exports `EVIDENCE_LIFECYCLE_ACT_TABLE = "cg_evidence_lifecycle_act"`; the adapter is the ONLY place DB calls for this table appear (Constitution §24/§25) and persists lifecycle act records with a deterministic id per act under the append-only law (capture, promotion, supersession and revocation produce NEW records; no UPDATE/DELETE path is authored for epistemic fields). The adapter implements the pure contract `frontend/src/lib/evidence/capture.ts` (J-034 / V1CAP-059 / MISSION-R-90 + J-033 / V1CAP-058 / MISSION-R-91).
- **Reading server path:** the same adapter (lifecycle reads for consumption/promotion decisions). No client-facing read path exists in V1; consumers are the adapter suite and the telemetry/failure batteries (`tests/unit/adapter-evidence-capture-store.test.ts`, `tests/unit/mh-27-substrate-telemetry.test.ts`, `tests/failure/mh-30-failure-battery.test.ts`). `scripts/verify-launch-criteria.mjs` cites the migration + adapter as the EVIDENCE launch-gate substrate.
- **rg evidence of writers:** `rg -l "EVIDENCE_LIFECYCLE_ACT_TABLE|cg_evidence_lifecycle_act"` resolves to the migration, its rollback, the adapter, the posture registry + battery, the canonical apply record, and the tests above — no frontend/API route or edge function reads or writes this table directly.

## EVIDENCE

1. **Battery scope (READ-ONLY confirmation).** `node scripts/verify-rls-isolation-battery.mjs --dry-parse-scope` (offline, exit 0, no credentials, no database) reports:
   `cg_evidence_lifecycle_act posture=zero-policy forceRls=false policies=0 tenantColumn=n/a source=20261002000008_coregrid_v1_evidence_lifecycle.sql postureSource=rls-table-postures-substrate.json`
2. **Posture registry entry.** `scripts/verification/rls-table-postures-substrate.json` declares `"name": "cg_evidence_lifecycle_act", "posture": "zero-policy"` with `auditAppendOnly: true`, `clientWritePolicy: "NONE — append-only lifecycle act ledger (Constitution §28): no client INSERT/UPDATE/DELETE policy is ever authored; promotion/revocation/assessment acts are immutable records with actor and instant; reads remain service-role only"`, and rationale "the act ledger is the tamper-evidence substrate of the evidence lifecycle"; the table appears in `batteryExpectations.zeroPolicyTables` and NOT in `batteryExpectations.policyBackedTables`.
3. **Migration posture.** The source migration §3 enables RLS with ZERO policies (`ALTER TABLE public.cg_evidence_lifecycle_act ENABLE ROW LEVEL SECURITY`) and revokes all anon/authenticated privileges, documenting the deliberate absence: evidence is the substrate of Verification and canonical truth (Constitution §9/§17) and access runs through service-role server functions that enforce the capture/consumption contract through the adapter.
4. **Unit test pin.** `tests/unit/h3-037-posture-adjudication.test.ts` asserts this adjudication's internal consistency.

## DECISION

**ZERO-POLICY-BY-DESIGN — upheld, with the strongest tier of justification: this is an append-only audit surface.** The declared posture (RLS enabled, zero policies, zero anon/authenticated privileges) is the correct V1 posture for `cg_evidence_lifecycle_act`. No client-facing policy of any command kind is legitimate in V1 and none is proposed.

## RATIONALE

- **Append-only audit law (Constitution §28, per AGENTS).** Lifecycle acts are records, never mutations: promotion requires a non-AI validator and a declared validation method; revocation requires an explicit authorization reference (no anonymous revocation, no self-granted authority). The target evidence is never altered in place — an act is a NEW immutable row with actor and instant. A client INSERT/UPDATE/DELETE policy would let a tenant actor forge validation history or erase a revocation — the exact tampering the ledger exists to make impossible. The absence of every client policy IS the security property.
- **Tamper-evidence substrate.** The evidence lifecycle's integrity (E-018 revocation retention, J-034 promotion validation) rests on this ledger being unwritable and unerazable by any client identity. Deny-by-default with zero policies is the strongest-form derivation: no policy expression anywhere can evaluate true, so no identity can read through any transport; reads remain service-role only behind the capture/consumption contract.
- **No client consumption need in V1.** Tenant-visible evidence is served by `cg_evidence_record` — which IS policy-backed (tenant-scoped SELECT + INSERT with `auth.uid()` self-derivation pins in the same posture registry). The act ledger is the platform's verification-of-verification substrate, not a tenant surface; any future "act history" viewer belongs behind a §27 server function.
- **`forceRls=false` is correct by posture law** (FORCE cannot strengthen a no-policy posture), and the migration documents the forward law: policies may be authored by a follow-up migration under explicit authorization, never silently.

## CONSTITUTION SECTIONS

- §9 (canonical truth: evidence substrate of Verification — acts must not be rewritable)
- §13 (multi-tenancy: tenant-scoped rows via `tenant_id` + composite FK)
- §16 (layered authorization: client decision is DENY for every command; the operative gate is the zero-policy deny)
- §17 (database security: RLS enabled — enforcement is not application-code-only)
- §21 (AI output trust: the actor behind an act is always the human `actor_id`, never AI)
- §26 (API governance: client-supplied identity never reaches this table)
- §28 (database law: immutable audit records — the table's core design purpose)
- §45 (V1 execution boundary)

## PROPOSED-POLICY-IF-ANY

**NONE for V1.** If a future phase authorizes a tenant-facing lifecycle-history viewer, the PROPOSED direction is a **read-only, tenant-scoped SELECT policy behind a §27 server function** (`tenant_id = public.get_my_tenant_id()`), arriving as a follow-up migration + posture JSON update + a battery cross-tenant probe stage before any policy becomes operative. WRITE policies remain permanently prohibited for this table: an append-only act ledger must never gain a client INSERT/UPDATE/DELETE policy — acts are appended only by the service-role capture/consumption path (Constitution §28).