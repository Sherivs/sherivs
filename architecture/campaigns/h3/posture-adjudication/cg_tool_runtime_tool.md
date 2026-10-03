# RLS Posture Adjudication — `cg_tool_runtime_tool`

- **Mission:** D-040 (H3 wave, Squad D — Posture Adjudication Engineer, tool/transport family)
- **Adjudicated posture:** `zero-policy` (RLS enabled, zero policies, anon/authenticated privileges revoked, `relforcerowsecurity = false` — the zero-policy INFO convention)
- **Decision date:** 2026-10-03
- **Applied state:** nothing applied by this mission. This doc records the adjudication only; J-099 merges the rationale into the posture JSONs.

## OWNERSHIP

| Question | Answer |
| --- | --- |
| Created by | `database/supabase/migrations/20261002000012_coregrid_v1_tool_runtime.sql` (J-008 / V1CAP-056 / MISSION-R-62, wave 3) — §1, `CREATE TABLE IF NOT EXISTS public.cg_tool_runtime_tool` |
| Contract owner | `frontend/src/lib/workforce/tool-runtime.ts` — the governed tool runtime & sandbox; "THE ONLY way workers execute tools" (migration header authority block) |
| Server paths that write it | `frontend/src/lib/adapters/tool-runtime-store.adapter.ts` — `createToolRuntimeStore(...)` registration path (`INSERT INTO public.cg_tool_runtime_tool ... ON CONFLICT DO NOTHING`, adapter line 616). The adapter is the ONLY place vendor/DB calls appear for this family (Constitution §24/§25) and accepts an injected **service-role** minimal client surface only (adapter header: "no policy-bearing client is accepted") |
| Server paths that read it | Same adapter, `SELECT * FROM public.cg_tool_runtime_tool WHERE tenant_id = $1` (line 675) — tenant-pinned, service-role |
| Who may NOT touch it | `anon`, `authenticated`, `PUBLIC` — `REVOKE ALL ON public.cg_tool_runtime_tool FROM anon, authenticated;` (migration lines 205-206) |
| Security gating upstream | E-035 capability gate (registered AND declared, evaluated fresh), J-007 lease mediation (credential refs + purposes only, never secret material), E-045 / Constitution §21 delegation bounding, runtime tenant gate (cross-tenant invocations refused — contract step 4) |

## EVIDENCE

1. **Battery scope, zero-policy:** `scripts/verify-rls-isolation-battery.mjs` TABLES registry, line 262: `{ name: "cg_tool_runtime_tool", source: "20261002000012_coregrid_v1_tool_runtime.sql", posture: "zero-policy" }`.
2. **Posture declaration:** `scripts/verification/rls-table-postures-substrate.json`, table entry `cg_tool_runtime_tool` (`"posture": "zero-policy"`) and `batteryExpectations.zeroPolicyTables` contains it.
3. **Live canonical proof:** `architecture/proofs/CANONICAL_APPLY_RECORD_HARDENING.json` entry: `{"table": "cg_tool_runtime_tool", "posture": "zero-policy (deny-by-default)", "rlsEnabled": true, "rlsForced": false, "policies": 0, "ok": true}`.
4. **Battery ratification record:** `architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md` line 310: zero-policy, RLS true, force false (INFO), 0 policies, 401/42501 denial, **PASS**.
5. **Migration posture:** migration §3 "Deny-by-default security posture": `ALTER TABLE public.cg_tool_runtime_tool ENABLE ROW LEVEL SECURITY;` + `REVOKE ALL ... FROM anon, authenticated;` and the header states "RLS policies: ZERO policies authored (deny-by-default strongest form)".
6. **Data classification:** governance-config family, non-personal — "carries NO subject-identifying personal values by design (tool/credential/capability references only)" (migration retention-posture block). Credential requirements are REFERENCE data (refs + declared purposes), never secret material (J-007).

## DECISION

**Zero-policy by design — CONFIRMED for V1.** No client-facing RLS policy is authored now.

## RATIONALE

1. **The only access path is the service-role adapter.** RLS policies govern client roles (`anon`/`authenticated`). This table's sole reader/writer is `tool-runtime-store.adapter.ts`, which by construction accepts only a minimal service-role client; `anon`/`authenticated` privileges are fully revoked. A client policy would either be dead code (no client privilege to filter) or, worse, would require granting client privileges first — a strict widening of the posture. Zero-policy + revoked grants is the strongest form: deny-by-default with no policy expression that could be weakened later.
2. **§21 AI-proposal posture is enforced upstream of the data plane.** Tool invocations are gated by the AI-proposal chain (E-035 capability gate evaluated fresh per invocation, J-007 credential lease mediation, E-045 delegation bounding valid as-of the invocation instant). The persistence layer records the outcomes of that chain; it is not the enforcement point. Exposing client-readable registrations would duplicate (and potentially diverge from) the gate's source of truth without adding enforcement.
3. **Invocation records are tenant-sensitive security audit data.** The migration's posture block states this explicitly; a policy that provably cannot widen reads beyond the record's tenant does not yet exist under the COND-003 unresolved tenant-id parameterization (`tenant_id` is `text`, not uuid, pending MISSION-R-02). Authoring a tenant-scoped policy on an unstable tenant-id type would risk the exact widening the posture forbids.
4. **Platform posture law:** RULING-2 deny-by-default approved posture and RLS_ISOLATION_BATTERY.md §7 dual-posture model both recognize zero-policy as a legitimate, verifiable posture; the battery probes it live (anon REST denial 401/42501) and the canonical apply record proves it.

## CONSTITUTION SECTIONS

- §16 (layered authorization — decision happens at the runtime gate + service-role path, not a data-plane policy)
- §17 (RLS mandatory — RLS IS enabled; zero policies is a posture within the battery's dual-posture model, application code never the only layer since grants are revoked at the database level)
- §21 (AI output trust — AI-proposal gating precedes persistence)
- §26 (never trust client-supplied identity/tenant/role — no client path exists at all)
- §28 (database law — grants/revokes and CHECK constraints carry the invariants)
- §29 (observability — every invocation audited; this table is the registration half)
- §19 (AI privacy — credential refs + purposes only, never secret material)

## PROPOSED-POLICY-IF-ANY

**None for V1.** If COND-003 parameterizes `tenant_id` to uuid (MISSION-R-02) and a legitimate tenant-facing surface for tool registrations is ever authorized, the conversion path is: one migration that (a) converts the substrate tenant reference, (b) authors FORCE RLS + `SELECT`-only `tenant_id = public.get_my_tenant_id()` (and admin-insert per the `is_tenant_admin` pattern) using only the J-005/J-006 neutral predicate vocabulary per the `20261002000013_coregrid_v1_neutral_membership_policies.sql` exemplar, and (c) updates the posture JSON in the same change — never silently (migration posture block: "Policies may be authored by a follow-up migration under explicit authorization, never silently").