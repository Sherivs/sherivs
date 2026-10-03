# Posture Adjudication — `cg_reconciliation_verdict` (H3-035)

- **Team / Role:** H3-035, Posture Adjudication Engineer (Squad D — memory-audit/reconciliation family)
- **Date:** 2026-10-03
- **Adjudicated posture:** **ZERO-POLICY BY DESIGN — CONFIRMED, no change proposed, nothing applied.**
- **Method:** read-only. Battery script inspected and run offline only (`--dry-parse-scope`); posture JSONs read as data; ownership traced with `rg`. No database touched; no posture file, migration, or policy authored or modified.

## OWNERSHIP

| Question | Answer |
|---|---|
| Creating migration | `database/supabase/migrations/20261002000005_coregrid_v1_reconciliation.sql` (MISSION-R-14 / J-004, V1CAP-005). Creates `cg_reconciliation_verdict` (append-only reconciliation verdicts) and `cg_reconciliation_input` (retained decision-bearing input facts, composite FK `(verdict_row_id, tenant_id) → cg_reconciliation_verdict (id, tenant_id)`). |
| Posture authored by | The same migration §4 (lines 280–284): `ALTER TABLE public.cg_reconciliation_verdict ENABLE ROW LEVEL SECURITY;` + `REVOKE ALL ON public.cg_reconciliation_verdict FROM anon, authenticated;` — RLS enabled, **zero policies** on the verdict table. (Its sibling `cg_reconciliation_input` was later converted to policy-backed by H2-04; the verdict table was deliberately left zero-policy.) |
| Owning server path (writes/reads) | `frontend/src/lib/adapters/reconciliation-store.adapter.ts` (V1CAP-005 / J-004 / MISSION-R-14) — the ONLY place vendor/DB calls appear for this family (Constitution §24/§25 adapter law). Header states verbatim: "Service-role access only: the tables are zero-policy deny-by-default (RLS enabled, all anon/authenticated privileges revoked), so no policy-bearing client is accepted — the injected client is a minimal service-role surface." Writes are append-only and idempotent (`ON CONFLICT DO NOTHING`); "no UPDATE/DELETE path is authored here." |
| Posture file ownership of the entry | `scripts/verification/rls-table-postures-substrate.json` (H2-04) re-declares it zero-policy with rationale — the battery's single source of truth for this entry (`postureSource=rls-table-postures-substrate.json`). J-099 merges rationale strings only; posture values stay untouched. |

## EVIDENCE

1. **Battery scope (offline dry-parse, exit 0):**
   `cg_reconciliation_verdict posture=zero-policy forceRls=false policies=0 tenantColumn=n/a source=20261002000005_coregrid_v1_reconciliation.sql postureSource=rls-table-postures-substrate.json`
2. **Posture file** (`rls-table-postures-substrate.json`, lines 136–141): entry `{ name: "cg_reconciliation_verdict", posture: "zero-policy", rationale: "derived verdict records consumed via the service-role adapter; tenant-scoped client access not authorized by H2-04 — unchanged deny-by-default" }`; listed in `batteryExpectations.zeroPolicyTables`.
3. **Migration text** (§4 lines 280–284): RLS enabled + `REVOKE ALL ... FROM anon, authenticated`; no policy statement authored for the verdict table.
4. **Adapter text** (`reconciliation-store.adapter.ts` header): service-role only, append-only, ON CONFLICT DO NOTHING, non-transport-retried writes; AdapterFailurePolicy semantics (J-045).
5. **Sibling contrast:** H2-04 granted `cg_reconciliation_input` the policy-backed posture (SELECT own-tenant + INSERT tenant-admin, SELECT+INSERT privileges, §4.4 probe recipe) and uses `cg_reconciliation_verdict` only as a privileged probe-aux parent — i.e. the policy layer reaches *inputs*, never verdicts. This split is explicit posture data, not drift.
6. **Unit pin:** `tests/unit/mh-04-substrate-policies.test.ts` and `tests/unit/adapter-reconciliation-store.test.ts` pin the migration text and the adapter's service-role-only contract.

## DECISION

**ZERO-POLICY BY DESIGN — CONFIRMED. The verdict table stays deny-by-default (RLS enabled, zero policies, zero client grants). No policy migration is proposed for V1; nothing applied.**

## RATIONALE

1. **Derived intelligence, not a client surface (Canonical Truth Principle §9).** A reconciliation verdict is the *output* of the reconciliation engine — derived understanding about contradictions between observations, not canonical truth a client consumes directly. AI/engine-derived records are consumed through governed server paths; the Constitution places their exposure behind validation and authorization, and V1 authorizes no client read of verdicts.
2. **The owning server path is service-role-only and says so.** The only writer/reader (`reconciliation-store.adapter.ts`) is composed on a minimal injected service-role client and explicitly refuses "policy-bearing clients". Zero policy + zero grants is exactly the contract the adapter is built against; adding a client policy would widen the data plane beyond what any V1 consumer is authorized to hold.
3. **Append-only integrity favors zero-policy.** Verdicts are append-only by law (no UPDATE/DELETE path authored anywhere; supersession is new rows). A zero-policy posture grants nothing to mutate — stronger than any V1 policy set, which would at best grant SELECT+INSERT to tenant administrators and add a policy-expression surface without a legitimate consumer.
4. **Tenant-scoped client access was explicitly declined by the policy layer (H2-04).** When the substrate policies landed (20261002000015 / the posture file), the verdict table was deliberately excluded while its input sibling was included. That recorded decision is binding posture history, and this adjudication concurs with it: verdict visibility would leak resolution traces, applied-rule sets and residual uncertainty across a surface no V1 tenant flow requires.
5. **If the posture ever changes, the conversion path is defined:** a single authorized migration per the `20261002000013_coregrid_v1_neutral_membership_policies.sql` exemplar (FORCE RLS + exact declared policy set + least-privilege SELECT-only grants + a data-declared §4.4 probe recipe — note the probe-aux parent machinery for this table already exists in the posture file's `cg_reconciliation_input` recipe). Never a silent widening.

## CONSTITUTION SECTIONS

- **§9** Canonical truth vs intelligence — verdicts are derived intelligence; inference never overwrites canonical truth and is exposed only through governed paths.
- **§17** Database security — RLS enabled at the data plane; application code (the adapter's own guards) is never the only layer.
- **§24/§25** Architecture rule / external providers — all DB access isolated in the adapter; the posture keeps the data plane consistent with the adapter's service-role-only composition.
- **§16/§26** Authorization model / API governance — no authenticated role is granted any privilege; deny is unconditional and policy-free.
- **§28** Database law / append-only substrate — immutability enforced by absence of any client privilege, not by application discipline alone.
- **§12** Provenance — posture entry carries `source=20261002000005_coregrid_v1_reconciliation.sql`, `postureSource=rls-table-postures-substrate.json`.

## PROPOSED-POLICY-IF-ANY

**None for V1.** If a future phase authorizes tenant-scoped verdict reads, the sanctioned direction is: FORCE RLS + a SELECT-only `tenant_id = public.get_my_tenant_id()` policy (+ administrator INSERT if server-side tenant context is provable), declared least-privilege grants (SELECT only), and a §4.4 probe recipe with `probeAuxTables` no longer needed (verdict is the parent) — all in one authorized migration, J-005/J-006 predicate vocabulary only. Nothing is pre-authored here.