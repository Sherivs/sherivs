# Posture Adjudication — `cg_observation` (team H3-032, Squad D / D-032)

Role: Posture Adjudication Engineer (observation/workspace family). Wave: H3,
mission D-032. Scope of this document: the RLS posture of
`public.cg_observation` ONLY. Nothing is applied; the posture JSON files
remain untouched (team J-099 merges rationales later).

## OWNERSHIP

- **Creating migration:** `database/supabase/migrations/20260903000000_coregrid_universal_kernel_substrate.sql`
  (Phase 33 Universal Reality Intelligence Kernel, slice S2). Table defined at
  lines 150–181; RLS enabled at line 213; `REVOKE ALL ... FROM anon,
  authenticated` at lines 219–220; `GRANT ALL ... TO service_role` at lines
  221–222. No `CREATE POLICY` statement exists anywhere in the file.
- **Writing server path (traced via rg):**
  `frontend/src/lib/kernel-reality.functions.ts` — the `writeObservation`
  server function (`createServerFn`) inserts into `.from("cg_observation")`
  (line 288). Its security posture is stated in the file header (lines 13–26):
  RLS deny-by-default on `cg_*`; writes go through the service-role
  `kernel-admin-client` only; `requireSupabaseAuth` then the canonical
  school-admin gate resolves the actor's OWN tenant scope — client-supplied
  tenant ids are never trusted; every observed entity is verified to belong to
  the actor's resolved tenant in code at the same boundary (service role
  bypasses RLS, so the tenant check is enforced there).
- **Read-side consumers (server/domain, not client data plane):**
  `frontend/src/lib/kernel/reconciliation.ts` (state reconciliation and
  contradiction engine over `cg_observation` drafts — pure domain logic),
  `frontend/src/lib/kernel/reality.ts` (pure observation drafts, bi-temporal
  envelope contracts), `frontend/src/lib/kernel/phase-contracts/phase-33-reality-kernel.ts`
  (substrate ownership contract: `cg_observation` listed among the kernel-owned
  substrates, migration cited).
- **Canonical enrichment:** `scripts/apply-canonical-mr100.mjs` (coordinator
  run) adds the `trace_id`/`object_type`/valid-time columns and record-time
  immutability triggers on `cg_observation` — schema hardening, not a policy
  change.
- **Battery seed path:** `scripts/verify-rls-isolation-battery.mjs` references
  the table only in its built-in posture registry (line 197) — never a client
  path.

## EVIDENCE

1. **Battery scope (read-only confirmation):**
   `scripts/verify-rls-isolation-battery.mjs`, `BUILTIN_TABLE_POSTURES` line
   197: `{ name: "cg_observation", source: "20260903000000_coregrid_universal_kernel_substrate.sql", posture: "zero-policy" }`.
   Neither `scripts/verification/rls-table-postures-substrate.json` nor
   `...-transport.json` contains a `cg_observation` entry, so no posture file
   overrides or extends the built-in canonical zero-policy posture
   (`postureSource=builtin-canonical`; confirmed via the offline
   `--dry-parse-scope` registry resolution — no credentials, no network, no
   live database).
2. **Battery-proven live:** `architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md`
   §7 result tables, rows `cg_observation`: posture zero-policy,
   `relrowsecurity = true`, `relforcerowsecurity = false (INFO)`, permissive
   policies 0, denial forms 401 / 42501 — **PASS** (36/36, canonical
   2026-10-02).
3. **Migration enforcement text (lines 210–222):** `ENABLE ROW LEVEL SECURITY`
   on `cg_observation`, zero policies, `REVOKE ALL` from anon/authenticated,
   `GRANT ALL` to `service_role` — the migration's own header (lines 22–26)
   declares the intended writer class: "Access is limited to the service role
   (server functions). Consuming domain runtimes author their own scoped
   policies against these tables when installed."
4. **rg ownership trace:** every repository reference to `cg_observation`
   outside the migration/battery/governance corpus is one of: the server
   function above, the pure kernel domain modules, or the canonical-apply
   hardening script. No client-facing read or write surface exists.

## DECISION

**ZERO-POLICY-BY-DESIGN — adjudicated, unchanged.** The zero-policy posture is
the deliberate, documented, battery-proven V1 posture of `cg_observation`.
A non-binding future policy direction is recorded below; nothing is pending
for V1 and nothing is applied.

## RATIONALE

1. **Truth-hierarchy data is intelligence-layer, not a client surface.**
   `cg_observation` stores the five distinct reality kinds (`observed`,
   `reported`, `inferred`, `predicted`, `simulated` — migration lines 153,
   170–173). Under the Canonical Truth Principle, AI/inferred/predicted
   content must never silently overwrite canonical truth; exposing the raw
   observation stream to client-role reads would collapse exactly the
   distinction the kind column exists to preserve. Consumption belongs behind
   server-side gates (reconciliation engine, consumption gates).
2. **The only writer is a gated server function.** `writeObservation`
   authenticates, resolves the tenant from the actor's own bindings (never
   client-supplied), authorizes through the school-admin gate, validates with
   Zod, and executes through the service-role client — the §27 server-function
   sequence. The in-code tenant verification at that boundary is required
   precisely because the service role bypasses RLS.
3. **No client-facing policy is legitimate in V1** because no V1 contract
   exposes `cg_observation` reads to client roles. Authoring a SELECT policy
   now would create an attack surface with zero authorized consumers — pure
   surface expansion. The substrate migration itself states the extension law:
   consuming domain runtimes author their own scoped policies when installed;
   no such installation has been authorized for this table.
4. **The zero-policy posture is the strongest form of deny-by-default**
   (RLS_ISOLATION_BATTERY.md §7 dual-posture model): RLS enabled with zero
   policies means no policy expression anywhere can evaluate true — no
   identity (any tenant, any role) can read a single row through the client
   data plane. This is strictly stronger than any tenant-scoped policy
   authorable today, and it is battery-proven, not reasoned.
5. **A nullable `tenant_id` is a further conversion blocker:** the substrate
   defines `cg_observation.tenant_id` as nullable text (migration line 157).
   The battery's §4.4 cross-tenant probe law filters on a declared
   `tenantColumn`; a policy conversion would first need a substrate decision
   on tenant-nullability (kernel observations may be control-plane scoped),
   which is outside this mission's authority.

## CONSTITUTION SECTIONS

- §9 Canonical Truth Principle — intelligence kinds (inferred/predicted/
  simulated) must never silently overwrite reality; kind separation is
  enforced by keeping the raw stream off the client data plane.
- §13 Multi-Tenancy Law — every request must have tenant context; today that
  context is resolved server-side per §27, not by a client-visible policy.
- §16 Authorization Model — layered authorization; no client path's decision
  inputs are defined for this table, so the data plane denies.
- §17 Database Security — RLS mandatory and enabled; zero policies is the
  strongest deny-by-default expression; service-role code is gated by the
  §27 server-function sequence, so application code is never the sole layer.
- §19 AI Privacy Law — observation records feed AI context only through
  authorized, minimized server paths.
- §26 API Governance / §27 Server Function Rule — never trust client-supplied
  tenant/identity; `writeObservation` implements the full sequence.
- §28 Database Law — RLS + revocable grants over application logic; CHECK
  constraints and FKs carry integrity in the migration.
- §34 Frontend Security — the UI is not security; deny at the data plane.

## PROPOSED-POLICY-IF-ANY

**PROPOSED (non-binding, nothing applied, not required for V1):** if and when a
client-facing observation read surface is authorized AND the substrate decides
`tenant_id` nullability for kernel observations, author a follow-up migration
in the 20261002000013 (J-005/J-006 neutral membership policies) exemplar form:
FORCE RLS; `SELECT` policy scoped by the neutral
`public.get_my_tenant_id()` predicate; writes remain server-only (no client
INSERT policy — observations enter through gated server functions); zero
`anon`/`PUBLIC` grants; declare the entry in a posture JSON with
`tenantColumn` and a §4.4 probe recipe (probeSeedRows + probeInsertPayload) so
the battery's genuine cross-tenant probe stage covers it. Until both
authorizations exist, this table stays zero-policy — deny-by-default is the
correct V1 answer, not a debt marker.
