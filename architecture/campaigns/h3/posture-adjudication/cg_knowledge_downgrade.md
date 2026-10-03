# RLS Posture Adjudication — `cg_knowledge_downgrade`

Mission: H3-039 (Squad D, knowledge family). Role: Posture Adjudication Engineer.
Adjudication date: 2026-10-03. Status: ZERO-POLICY-BY-DESIGN — CONFIRMED (nothing applied).

## OWNERSHIP

| Question | Answer |
| --- | --- |
| Creating migration | `database/supabase/migrations/20261002000011_coregrid_v1_knowledge_currency.sql` (J-019 / V1CAP-040 / MISSION-R-71 — AUTHORED, NOT APPLIED) |
| Rollback | `database/supabase/rollbacks/20261002000011_coregrid_v1_knowledge_currency.sql` |
| Owning contract (domain) | `frontend/src/lib/memory/knowledge-currency.ts` — `ReliabilityDowngradeAct` record family (G-047/G-052: trust never rises silently; downgrades only) |
| Only server write/read path | `frontend/src/lib/adapters/knowledge-currency-store.adapter.ts` — service-role injected client; act persistence is append-only idempotent (`ON CONFLICT (id, tenant_id) DO NOTHING`); reads strictly `WHERE tenant_id = $1` (`loadDowngrades`) |
| Registry/apply provenance | `scripts/apply-canonical-hardening.mjs` declares the table + index `cg_knowledge_downgrade_tenant_idx` for migration 20261002000011 |
| Battery owner (not us) | `scripts/verify-rls-isolation-battery.mjs` TABLES registry, line 261: `{ name: "cg_knowledge_downgrade", source: "20261002000011_…", posture: "zero-policy" }` |
| Posture file owner (not us) | `scripts/verification/rls-table-postures-substrate.json` — entry `cg_knowledge_downgrade`, `posture: "zero-policy"`, source 20261002000011 |

No client-facing surface references this table; the only `frontend/src` occurrence of `cg_knowledge_downgrade` is the server adapter's table constant.

## EVIDENCE

1. **Battery scope (read-only dry parse, run 2026-10-03):**
   `node scripts/verify-rls-isolation-battery.mjs --dry-parse-scope` → exit 0, `DRY_PARSE_OK tables=37 zero-policy=30 policy-backed=7`, line:
   `cg_knowledge_downgrade posture=zero-policy forceRls=false policies=0 tenantColumn=n/a source=20261002000011_coregrid_v1_knowledge_currency.sql postureSource=rls-table-postures-substrate.json`
2. **Posture JSON (READ-ONLY):** `rls-table-postures-substrate.json` tables entry `posture: "zero-policy"`; `batteryExpectations.zeroPolicyTables` includes `cg_knowledge_downgrade`.
3. **Migration DDL:** `ENABLE ROW LEVEL SECURITY` (line 263), `REVOKE ALL ON public.cg_knowledge_downgrade FROM anon, authenticated` (line 267), zero `CREATE POLICY` statements anywhere in the migration; §5 documents the deny-by-default posture (lines 246–267).
4. **Substrate-enforced act law:** `cg_knowledge_downgrade_strict_down` CHECK ranks `authoritative > verified > provisional > unverified` and requires `to_tier` strictly BELOW `from_tier` (lines 218–225) — a no-op or upgrade downgrade act cannot exist in the substrate; `reason` and `evidence_ref` are NOT NULL (lines 211–212); composite FK `(source_id, tenant_id) → cg_knowledge_source (id, tenant_id)` ON DELETE RESTRICT makes cross-tenant downgrades unbindable (lines 227–231).
5. **Retention posture:** record family `audit` (RETENTION_POLICY_SCHEDULE.json: RP-AUDIT-EDU/ORG/PLT) per the migration comment (lines 233–240).
6. **Migration integrity pinning already exists:** `tests/unit/adapter-knowledge-currency.test.ts` pins migration/rollback text for 20261002000011 including the per-table REVOKE and the strict-down/tombstone/same-tenant laws.

## DECISION

**ZERO-POLICY-BY-DESIGN — CONFIRMED, with the strongest formulation: no client write policy is EVER authored for this table.** The downgrade act ledger is the tamper-evidence substrate for reliability-tier authority (§9/§21); nothing is applied this wave.

## RATIONALE

- `cg_knowledge_downgrade` records **who demoted a knowledge source's reliability tier, why, and with what evidence** — the append-only act that makes the tier system governable rather than advisory. It is the enforcement record behind G-047/G-052 ("trust never rises silently"): propagation is structural (records inherit the source's CURRENT tier at query time), so the act ledger must be immune to client tampering or the tier system itself collapses into client opinion — a direct §9 canonical-truth violation and an §21 AI-output-trust violation (untrusted output could launder its own provenance by demoting authoritative sources or, worse, by making downgrade evidence disappear).
- The database already enforces the act's semantics (strict-down CHECK, evidence requirement, same-tenant composite FK); the zero-policy + privilege-revocation posture is the matching access-level control: nobody can write, mutate, or erase a downgrade act through any client path (§17/§28). This mirrors H2-04's adjudicated rationale for the sibling audit ledgers (`cg_evidence_lifecycle_act`, `cg_event_security_denial`): "the act ledger is the tamper-evidence substrate."
- There is no V1 client surface: downgrades flow through the server adapter under §27 server-function law, with actor, reason, and evidence supplied server-side (§26 — never client-trusted identity). RLS ENABLED + all anon/authenticated privileges revoked is the strongest deny-by-default form; the only privileged path is the audited service-role adapter (§16 layered authorization).
- The migration deliberately scopes policies OUT ("policies come later from the policy team and the RLS battery", lines 73–74) — this doc is that later adjudication, confirming the deferral was correct.

## CONSTITUTION SECTIONS

§9 (canonical truth — reliability tiers gate intelligence against reality), §11/§12 (provenance — evidence_ref, actor, instant required), §16 (layered authorization on the service-role path), §17 (RLS enabled, zero-policy deny-by-default), §21 (AI output trust — demotion evidence cannot be erased by the systems it governs), §26 (client identity never trusted), §27 (server-function law), §28 (immutable audit records, CHECK-ranked strict-down, composite FKs), §34 (UI is not security), §45 (V1 boundary).

## PROPOSED-POLICY-IF-ANY

**None applied. Direction only (PROPOSED, requires explicit human authorization per §8/§40):**

1. **No client write policy, ever.** An INSERT/UPDATE/DELETE policy on a downgrade act ledger would violate §28's immutable-audit law; this absence is recorded as permanent for V1.
2. *If* a future phase authorizes a tenant-facing reliability-history view, the only defensible form is a SELECT-only tenant-equality policy (`tenant_id = public.get_my_tenant_id()`) to `authenticated`, anon still revoked — proposed independently of the other knowledge-currency tables and battery-proven before any posture-file edit (owner: J-099/coordinator, not this team).
3. Until then the zero-policy posture stands unchanged; this doc supplies the rationale string J-099 merges into `rls-table-postures-substrate.json` (rationale fields only).