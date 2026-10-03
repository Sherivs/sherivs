# Posture Adjudication — `cg_worker_definition` (team H3-033, Squad D / D-033)

Role: Posture Adjudication Engineer (org/worker family). Wave: H3, mission
D-033. Scope of this document: the RLS posture of `public.cg_worker_definition`
ONLY. Nothing is applied; the posture JSON files remain untouched (team J-099
merges rationales later).

## OWNERSHIP

- **Creating migration:** `database/supabase/migrations/20261002000002_coregrid_v1_worker_definitions.sql`
  (MISSION-R-40, blocking J-027 / V1CAP-048; CTO RULING-3 binding: workers are
  governed actors, an extension of the CoreGrid actor/delegation model).
  Status header: AUTHORED, NOT APPLIED. Rollback:
  `database/supabase/rollbacks/20261002000002_coregrid_v1_worker_definitions.sql`
  (drops `cg_worker_delegation`, `cg_worker_capability`, `cg_worker_definition`
  in child-first order).
- **Domain contracts:** `frontend/src/lib/workforce/worker-definition.ts` —
  the persistent-half contract (authority bounds, capability intersection,
  delegation history refs); pure data + pure functions, explicitly "No
  persistence, no I/O, no vendor" (module header, line 32), with database
  truth authored-not-applied in the migration above. Companion pure modules:
  `frontend/src/lib/workforce/capability-registry.ts` (J-028 matching
  composition) and `frontend/src/lib/agent-runtime/capability-matching.ts`
  (delegation-contract matching depth).
- **Server paths (traced via rg):** no server function reads or writes
  `cg_worker_definition` today — `rg '\.from\("cg_worker'` over
  `frontend/src/` returns zero matches. Authorization is resolved through the
  SHARED identity-actor primitives (`frontend/src/lib/identity-actor.ts`,
  `resolveIdentityActor`), not through any worker-specific path: the
  migration states there is deliberately NO worker-specific role, permission
  or authorization table (lines 38–45). Worker administration is designed to
  run through service-role server functions only (migration posture note,
  lines 244–251). The apply tooling (`scripts/apply-canonical-mr100.mjs`,
  lines 134–136) verifies tables/indexes/triggers exist post-apply; the
  enforcement battery pins the migration text mechanically
  (`tests/unit/worker-definition.test.ts`, migration-coherence suite).

## EVIDENCE

1. **Battery scope (read-only confirmation):**
   `scripts/verify-rls-isolation-battery.mjs`, `BUILTIN_TABLE_POSTURES`
   line 237: `{ name: "cg_worker_definition", source: "20261002000002_coregrid_v1_worker_definitions.sql", posture: "zero-policy" }`.
   No `rls-table-postures-*.json` entry overrides it — the built-in canonical
   zero-policy posture is operative.
2. **Battery-proven live:** `architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md`
   §7 result table, row `cg_worker_definition`: posture zero-policy,
   `relrowsecurity = true`, `relforcerowsecurity = false (INFO)`, permissive
   policies 0, denial forms 401 / 42501 — **PASS** (36/36, canonical
   2026-10-02).
3. **Migration enforcement text (§4, lines 242–260):** all three worker
   substrate tables get `ENABLE ROW LEVEL SECURITY`; `REVOKE ALL ... FROM
   anon, authenticated` on each; the file contains zero `CREATE POLICY` and
   zero client `GRANT` statements (mechanically asserted by
   `tests/unit/worker-definition.test.ts` lines 427–439).
4. **Envelope atomicity makes anonymous rows unsatisfiable:** `created_by`
   is NOT NULL and the `cg_worker_definition_envelope_atomic` CHECK requires
   the complete kernel envelope (V1CAP-002), so every row is fully stamped —
   the provenance law (Constitution §12) holds at the database level even
   under a purely service-role write path.
5. **H3-016 enforcement evidence (read-only input, cited):**
   `progress/h3-wave/H3-016.report.md` FINDING-1 — `claimWorkerRuntime`
   never cross-checks `delegationRef` against
   `definition.delegationHistoryRefs`; a claim citing a delegation record
   absent from the persistent history is accepted. The delegation-history
   linkage between `cg_worker_definition.delegation_history_refs` and
   `cg_worker_delegation` is therefore UNENFORCED at the claim boundary in
   the contract layer.

## DECISION

**ZERO-POLICY-BY-DESIGN — adjudicated, unchanged.** No client-facing RLS
policy for `cg_worker_definition` is authorized in V1; worker administration
remains service-role server functions only. A PROPOSED policy direction is
recorded below as a condition-gated future path, not a pending V1 action.

## RATIONALE

1. **A worker definition is a governance-critical authority record.** Per
   RULING-3 and the migration's own posture note (lines 244–251): "worker
   definitions are governance-critical authority records, and no tenant-scoped
   policy exists yet that provably cannot widen worker authority." A
   tenant-wide authenticated SELECT policy would publish every worker's
   identity linkage, authority bounds (`max_risk_class`,
   `resource_scopes`), capability surface and delegation history to every
   authenticated member of the tenant — a reconnaissance surface that
   directly aids escalation planning (Constitution §31: agent cannot exceed
   permissions — helping someone plan to exceed them is also a posture
   failure).
2. **Authority flows through the shared identity-actor layer, never through
   the substrate.** The tables "grant nothing by themselves"; authorization
   resolves through `resolveIdentityActor` at request time (migration lines
   38–45; contract header lines 17–26). Client-visible authority derivation
   therefore never needs to read this table; a policy would add a read path
   the authorization model does not use.
3. **Why no client-facing policy is legitimate in V1:** there is no V1
   client contract that consumes worker definitions (traced: zero
   `.from("cg_worker...")` usages). V1 worker administration is
   service-role server functions executing the §27 sequence
   (authenticate → resolve tenant → authorize → validate → execute → audit)
   with RLS deny-by-default as the guaranteed second layer behind them
   (§17). Deny-by-default at the data plane cannot under-serve a surface
   that does not exist.
4. **H3-016 FINDING-1 makes a broader read surface actively unsafe today.**
   Because the delegation-history linkage is unenforced at the claim
   boundary, the persistent record (`delegation_history_refs`, mirrored in
   `cg_worker_delegation`) is currently DESCRIPTIVE rather than BINDING.
   Widening read access before that linkage is enforced would expose a
   history that a forged claim could cite without contradiction. The
   posture should stay closed until the claim boundary binds claims to the
   persisted history (or a persistence-layer gate closes the gap); this is
   the same ordering discipline as Constitution §21 (AI proposal →
   validation → policy check → approval → execution): enforcement first,
   visibility later.
5. **Lifecycle alignment keeps the closed posture safe:** `lifecycle_state`
   mirrors the `cg_identity` lifecycle exactly, and suspended/archived/
   deleted workers can never claim a runtime — so a closed read surface
   never hides a live governance state that a client would legitimately
   need; identity state itself is surfaced through the identity layer.

## CONSTITUTION SECTIONS

- §5 Agent Identity Model / §6 Agent Lifecycle — agents are untrusted by
  default and cannot silently increase permissions; the zero-policy posture
  is the data-plane expression of "agents cannot silently increase
  permissions" (§6).
- §7 AI Sovereignty Boundary — AI systems may propose; the definition table
  records governed authority, so client-side visibility of it is an
  authorization question, not a convenience question.
- §16 Authorization Model / §17 Database Security — RLS ENABLED, zero
  policies: the strongest deny-by-default form; service-role server
  functions are the sanctioned bypass-parity path (20260907000800 §3
  convention).
- §21 AI Output Trust — changes to worker authority are critical actions
  requiring validation/approval before execution; the write path must stay
  gated, and the read path must not leak the inputs to that gating.
- §26 API Governance / §27 Server Function Rule — never trust client
  identity/role; all worker-substrate access goes through gated server
  functions.
- §28 Database Law — constraints (envelope atomicity, causation root,
  object-type pin, composite FKs) + RLS + revocable grants over application
  logic.
- §31 Testing Standard — "agent cannot exceed permissions" is proven at the
  contract layer by H3-016 and at the data plane by the battery's zero-policy
  strongest-form derivation.
- §12 Data Provenance — the fully-stamped envelope (unsatisfiable anonymous
  row) keeps provenance intact under the closed posture.

## PROPOSED-POLICY-IF-ANY

**PROPOSED (non-binding, nothing applied, condition-gated):** when (a) a
client-facing worker-self read surface is authorized AND (b) the H3-016
FINDING-1 linkage is enforced (claims validated against the persisted
delegation history at the claim boundary or by a persistence gate), author a
follow-up migration in the 20261002000013 exemplar form with the STRICTEST
useful shape:

- FORCE RLS;
- `SELECT` restricted to the actor's OWN worker rows via a neutral
  self-derivation pin in the substrate convention style
  (`identity_id` ↔ the acting identity), tenant-scoped by
  `public.get_my_tenant_id()` — a worker sees its own definition, never the
  tenant's full worker inventory;
- `INSERT`/`UPDATE` gated by `public.is_tenant_admin(tenant_id)` only, with
  delegation-history writes remaining service-role append-only;
- declare the entry in a posture JSON so the battery's genuine cross-tenant
  probe stage covers it.

Until both conditions hold, zero-policy remains the adjudicated posture —
it is a designed V1 state, not deferred debt.