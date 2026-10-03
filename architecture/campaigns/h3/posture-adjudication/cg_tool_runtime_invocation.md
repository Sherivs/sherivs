# RLS Posture Adjudication — `cg_tool_runtime_invocation`

- **Mission:** D-040 (H3 wave, Squad D — Posture Adjudication Engineer, tool/transport family)
- **Adjudicated posture:** `zero-policy` (RLS enabled, zero policies, anon/authenticated privileges revoked, `relforcerowsecurity = false` — the zero-policy INFO convention)
- **Decision date:** 2026-10-03
- **Applied state:** nothing applied by this mission. This doc records the adjudication only; J-099 merges the rationale into the posture JSONs.

## OWNERSHIP

| Question | Answer |
| --- | --- |
| Created by | `database/supabase/migrations/20261002000012_coregrid_v1_tool_runtime.sql` (J-008 / V1CAP-056 / MISSION-R-62, wave 3) — §2, `CREATE TABLE IF NOT EXISTS public.cg_tool_runtime_invocation` |
| Contract owner | `frontend/src/lib/workforce/tool-runtime.ts` — the governed tool runtime & sandbox; "THE ONLY way workers execute tools" |
| Server paths that write it | `frontend/src/lib/adapters/tool-runtime-store.adapter.ts` — `createToolRuntimeStore(...)` invocation-record path (`INSERT INTO public.cg_tool_runtime_invocation ...`, adapter line 644). Append-only, idempotent (`ON CONFLICT DO NOTHING`), never transport-retried (maxAttempts: 1). Service-role minimal client only |
| Server paths that read it | Same adapter, `SELECT * FROM public.cg_tool_runtime_invocation WHERE tenant_id = $1` (line 703) — tenant-pinned, service-role |
| Who may NOT touch it | `anon`, `authenticated`, `PUBLIC` — `REVOKE ALL ON public.cg_tool_runtime_invocation FROM anon, authenticated;` (migration lines 205-206) |
| Security gating upstream | E-035 capability gate, J-007 lease mediation (lease handle REFERENCES only — never handles, never secrets), E-045 / Constitution §21 delegation bounding, runtime tenant gate (`cross_tenant_invocation_denied` is itself a recorded reason code) |

## EVIDENCE

1. **Battery scope, zero-policy:** `scripts/verify-rls-isolation-battery.mjs` TABLES registry, line 263: `{ name: "cg_tool_runtime_invocation", source: "20261002000012_coregrid_v1_tool_runtime.sql", posture: "zero-policy" }`.
2. **Posture declaration:** `scripts/verification/rls-table-postures-substrate.json`, table entry `cg_tool_runtime_invocation` (`"posture": "zero-policy"`) and `batteryExpectations.zeroPolicyTables` contains it.
3. **Live canonical proof:** `architecture/proofs/CANONICAL_APPLY_RECORD_HARDENING.json` entry: `{"table": "cg_tool_runtime_invocation", "posture": "zero-policy (deny-by-default)", "rlsEnabled": true, "rlsForced": false, "policies": 0, "ok": true}`.
4. **Battery ratification record:** `architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md` line 311: zero-policy, RLS true, force false (INFO), 0 policies, 401/42501 denial, **PASS**.
5. **Migration posture:** §3 "Deny-by-default security posture" — RLS ENABLED with ZERO policies and all anon/authenticated privileges REVOKED; the migration text states the rationale verbatim: "invocation records are tenant-sensitive security audit data (Constitution §17/§29/§35) and no tenant-scoped policy yet exists that provably cannot widen reads beyond the record's tenant — access runs through service-role server functions that enforce the runtime's tenant gate through the adapter."
6. **Data classification:** audit record family row (`RP-AUDIT-EDU` / `RP-AUDIT-ORG` / `RP-AUDIT-PLT`, 2555-day retention); REDACTED params only; result summary refuses live secret material (fails closed with `result_secret_material_detected`); closed 17-code reason vocabulary with outcome-law CHECK constraints.

## DECISION

**Zero-policy by design — CONFIRMED for V1.** This is an append-only audit ledger; no client-facing RLS policy is authored now, and no client write policy is ever appropriate for this table.

## RATIONALE

1. **The only access path is the service-role adapter.** As with the registration surface, the sole reader/writer is `tool-runtime-store.adapter.ts` with a service-role minimal client; `anon`/`authenticated` privileges are fully revoked. Zero policies + revoked grants means the ledger is reachable only by the governed runtime — the exact tenant gate the migration cites.
2. **§21 AI-proposal posture: invocations are the audited OUTPUT of the proposal chain, not a client surface.** Every invocation row is the durable evidence of a governed AI-action decision (capability gate, delegation bounding, credential lease mediation, risk-class bounding, rate/budget guards). Per Constitution §21, AI-proposed actions are validated and approved before execution; the ledger records the verdicts. A client-facing SELECT policy would let any authenticated tenant member read the full tool-invocation history of their tenant (including rejection reasons and delegation refs) through the data plane without any of the purpose/policy context the gate carries — a needless widening while no consumer requires it.
3. **Audit immutability law (§28):** the ledger's value is that it is unwritable and unerazable except by sanctioned server paths. Any INSERT/UPDATE/DELETE policy — even tenant-scoped — would create a client-writable audit trail and violate the append-only record law the migration's outcome-law and lease-law CHECK constraints encode.
4. **Tenant-id parameterization is unresolved (COND-003 / MISSION-R-02).** `tenant_id` is `text NOT NULL CHECK (length 1..128)`; authoring a tenant-scoped policy on an unstable type risks the widening the posture forbids. The runtime refuses cross-tenant invocations (contract step 4), so records are single-tenant by construction, and the adapter's reads are `WHERE tenant_id = $1` anyway.

## CONSTITUTION SECTIONS

- §16 (layered authorization — the runtime gate + service-role path decides; no data-plane policy)
- §17 (RLS mandatory — RLS IS enabled; deny enforced by zero policies + revoked grants, application code never the only layer)
- §21 (AI output trust — the ledger records gated AI-action outcomes)
- §26 (never trust client-supplied identity/tenant/role — no client path exists)
- §28 (database law — append-only ledger, immutable audit records, CHECK-encoded invariants)
- §29 (observability — "every invocation — executed, rejected or failed — is an audited record with REDACTED params")
- §19/§6 (AI privacy & provenance — redacted params, lease-handle references only, record-family retention)

## PROPOSED-POLICY-IF-ANY

**None for V1.** A future tenant-scoped read policy (e.g. `SELECT` for tenant members via `tenant_id = public.get_my_tenant_id()`) may be proposed only after (a) COND-003 resolves the tenant-id type, and (b) a legitimate client consumer of invocation history is authorized with purpose-limitation review (§19). Write policies are permanently excluded: this is an append-only audit ledger and no client INSERT/UPDATE/DELETE policy is ever authored for it. Any conversion must follow the single-migration FORCE RLS pattern of `20261002000013_coregrid_v1_neutral_membership_policies.sql` and update the posture JSON in the same change.