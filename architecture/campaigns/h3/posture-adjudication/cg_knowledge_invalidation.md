# RLS Posture Adjudication — `cg_knowledge_invalidation`

Mission: H3-039 (Squad D, knowledge family). Role: Posture Adjudication Engineer.
Adjudication date: 2026-10-03. Status: ZERO-POLICY-BY-DESIGN — CONFIRMED (nothing applied).

## OWNERSHIP

| Question | Answer |
| --- | --- |
| Creating migration | `database/supabase/migrations/20261002000011_coregrid_v1_knowledge_currency.sql` (J-019 / V1CAP-040 / MISSION-R-71 — AUTHORED, NOT APPLIED) |
| Rollback | `database/supabase/rollbacks/20261002000011_coregrid_v1_knowledge_currency.sql` |
| Owning contract (domain) | `frontend/src/lib/memory/knowledge-currency.ts` — `InvalidationAct` record family (ADR-005 append-only tombstone law) |
| Only server write/read path | `frontend/src/lib/adapters/knowledge-currency-store.adapter.ts` — service-role injected client; act persistence is append-only idempotent (`ON CONFLICT (tenant_id, record_id) DO NOTHING`); reads strictly `WHERE tenant_id = $1` (`loadInvalidations`) |
| Registry/apply provenance | `scripts/apply-canonical-hardening.mjs` declares the table + index `cg_knowledge_invalidation_tenant_idx` for migration 20261002000011 |
| Battery owner (not us) | `scripts/verify-rls-isolation-battery.mjs` TABLES registry, line 260: `{ name: "cg_knowledge_invalidation", source: "20261002000011_…", posture: "zero-policy" }` |
| Posture file owner (not us) | `scripts/verification/rls-table-postures-substrate.json` — entry `cg_knowledge_invalidation`, `posture: "zero-policy"`, source 20261002000011 |

No client-facing surface references this table; the only `frontend/src` occurrence of `cg_knowledge_invalidation` is the server adapter's table constant.

## EVIDENCE

1. **Battery scope (read-only dry parse, run 2026-10-03):**
   `node scripts/verify-rls-isolation-battery.mjs --dry-parse-scope` → exit 0, `DRY_PARSE_OK tables=37 zero-policy=30 policy-backed=7`, line:
   `cg_knowledge_invalidation posture=zero-policy forceRls=false policies=0 tenantColumn=n/a source=20261002000011_coregrid_v1_knowledge_currency.sql postureSource=rls-table-postures-substrate.json`
2. **Posture JSON (READ-ONLY):** `rls-table-postures-substrate.json` tables entry `posture: "zero-policy"`; `batteryExpectations.zeroPolicyTables` includes `cg_knowledge_invalidation`.
3. **Migration DDL:** `ENABLE ROW LEVEL SECURITY` (line 262), `REVOKE ALL ON public.cg_knowledge_invalidation FROM anon, authenticated` (line 266), zero `CREATE POLICY` statements anywhere in the migration; §5 explicitly documents the deny-by-default posture (lines 246–267).
4. **Substrate-enforced act law:** `UNIQUE (tenant_id, record_id)` (exactly ONE invalidation act per record — the first act stands, line 177), `evidence_ref NOT NULL` (line 172), and composite FK `(record_id, tenant_id) → cg_knowledge_freshness_contract (record_id, tenant_id)` ON DELETE RESTRICT makes cross-tenant acts unbindable (lines 179–183). No UPDATE/DELETE path exists anywhere in the adapter (append-only law, ADR-005).
5. **Retention posture:** record family `audit` (RETENTION_POLICY_SCHEDULE.json: RP-AUDIT-EDU/ORG/PLT, 2555-day duration) — the migration comment (lines 185–192) and table comment pin it as an immutable, evidence-bearing audit act ledger.
6. **Migration integrity pinning already exists:** `tests/unit/adapter-knowledge-currency.test.ts` pins migration/rollback text for 20261002000011 including the per-table REVOKE.

## DECISION

**ZERO-POLICY-BY-DESIGN — CONFIRMED, with the strongest formulation: no client write policy is EVER authored for this table.** The invalidation act ledger is audit substrate (Constitution §28 immutable audit records); rows are unwritable and unerazable by clients in any version. The zero-policy posture stands unchanged — nothing is applied this wave.

## RATIONALE

- `cg_knowledge_invalidation` is the **tombstone act** that removes a knowledge record from "current" without deleting it (ADR-005). This is precisely the §9 canonical-truth mechanism: invalidation is a verified Reality statement about a record ("this is no longer trustworthy"), not Intelligence; if it were client-mutable or client-erasable, stale knowledge could be resurrected or valid knowledge silently killed — both break the canonical-truth boundary. Database-enforced uniqueness (one act per record) + evidence requirement + zero client privilege make the ledger tamper-evident by posture, not by application discipline.
- In H2-04's own precedent posture entries, identical audit act ledgers (`cg_event_security_denial`, `cg_evidence_lifecycle_act`, `cg_event_route_outcome`) were adjudicated zero-policy with the explicit rationale "every denial must remain an unwritable, unerazable audit record". This table is the knowledge-family analogue and inherits the same reasoning.
- There is no V1 client surface: invalidation flows through the server adapter under §27 server-function law; every act carries `invalidated_by`, `reason`, `evidence_ref`, `invalidated_at` as supplied parameters (no wall-clock sampling, no client-trusted identity — §26).
- RLS is ENABLED and all anon/authenticated privileges are REVOKED, so §17 ("application code must never be the only security layer") is satisfied by the strongest deny-by-default form; the composite FK guarantees tenant integrity even on the privileged path.

## CONSTITUTION SECTIONS

§9 (canonical truth — invalidation is verified reality about currency), §11/§12 (provenance — evidence_ref required, actor recorded), §17 (RLS enabled, zero-policy deny-by-default), §19 (redaction/withholding posture alignment), §26 (client identity never trusted — actor recorded server-side), §27 (server-function law on the adapter path), §28 (immutable audit records, append-only law, constraints over application logic), §34 (UI is not security), §45 (V1 boundary).

## PROPOSED-POLICY-IF-ANY

**None applied. Direction only (PROPOSED, requires explicit human authorization per §8/§40):**

1. **No client write policy, ever.** This adjudication records the deliberate absence as permanent for V1: an INSERT/UPDATE/DELETE policy on this table would be an architecture violation (§28), not an upgrade.
2. *If* a future phase authorizes a tenant-facing invalidation history view, the only defensible form is a SELECT-only tenant-equality policy (`tenant_id = public.get_my_tenant_id()`) to `authenticated`, anon still revoked — proposed separately from the freshness-contract direction and battery-proven before any posture-file edit (owner: J-099/coordinator, not this team).
3. Until then the zero-policy posture stands unchanged; this doc supplies the rationale string J-099 merges into `rls-table-postures-substrate.json` (rationale fields only).