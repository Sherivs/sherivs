# Posture Adjudication — `cg_worker_capability` (team H3-033, Squad D / D-033)

Role: Posture Adjudication Engineer (org/worker family). Wave: H3, mission
D-033. Scope of this document: the RLS posture of
`public.cg_worker_capability` ONLY. Nothing is applied; the posture JSON
files remain untouched (team J-099 merges rationales later).

## OWNERSHIP

- **Creating migration:** `database/supabase/migrations/20261002000002_coregrid_v1_worker_definitions.sql`
  (MISSION-R-40 / J-027 / CTO RULING-3; status header: AUTHORED, NOT
  APPLIED). `cg_worker_capability` is created at lines 186–208 as the
  "owned capability set: explicit declarations, one row per capability."
  Rollback: `database/supabase/rollbacks/20261002000002_coregrid_v1_worker_definitions.sql`
  (drops the table before its parent `cg_worker_definition`).
- **Domain contracts:** the capability declarations surface is owned by
  `frontend/src/lib/workforce/worker-definition.ts` (effective authority =
  delegated ∩ declared; undeclared capabilities are denied by name) and
  composed for matching by `frontend/src/lib/workforce/capability-registry.ts`
  (module header: "worker definitions come from `worker-definition.ts`";
  boundary: pure data + pure functions, no persistence, no I/O) and
  `frontend/src/lib/agent-runtime/capability-matching.ts` (J-028
  delegation-contract matching depth). J-028's law is capability-over-
  agent-count: workers are matched by declaration id, never by worker name.
- **Server paths (traced via rg):** no server function reads or writes
  `cg_worker_capability` today — `rg '\.from\("cg_worker'` over
  `frontend/src/` returns zero matches. Writes belong (by design) to
  service-role server functions administering a worker definition's
  declaration set; reads happen in-process through the pure contracts, which
  receive declaration data as typed inputs rather than querying the data
  plane. The battery and the migration-coherence suite
  (`tests/unit/worker-definition.test.ts`) are the only other consumers,
  both static/privileged tooling.

## EVIDENCE

1. **Battery scope (read-only confirmation):**
   `scripts/verify-rls-isolation-battery.mjs`, `BUILTIN_TABLE_POSTURES`
   line 238: `{ name: "cg_worker_capability", source: "20261002000002_coregrid_v1_worker_definitions.sql", posture: "zero-policy" }`.
   No `rls-table-postures-*.json` entry overrides it — the built-in
   canonical zero-policy posture is operative.
2. **Battery-proven live:** `architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md`
   §7 result table, row `cg_worker_capability`: posture zero-policy,
   `relrowsecurity = true`, `relforcerowsecurity = false (INFO)`, permissive
   policies 0, denial forms 401 / 42501 — **PASS** (36/36, canonical
   2026-10-02).
3. **Migration enforcement text (§4, lines 242–260):** `ALTER TABLE
   public.cg_worker_capability ENABLE ROW LEVEL SECURITY;` and `REVOKE ALL
   ON public.cg_worker_capability FROM anon, authenticated;`; zero `CREATE
   POLICY` and zero client `GRANT` statements in the file (mechanically
   asserted by `tests/unit/worker-definition.test.ts` lines 427–439).
4. **Cross-tenant integrity is database-enforced:** the composite FK
   `cg_worker_capability_definition_fk` ((definition_id, tenant_id) →
   cg_worker_definition (id, tenant_id), ON DELETE CASCADE) makes a
   cross-tenant capability pointer impossible at the database level — the
   same-tenant invariant holds even with zero policies (Constitution §28).
5. **Deny-by-default is the table's semantic role:** migration table comment
   (lines 200–205): "Explicit and documented only: a capability absent here
   is unclaimable by any runtime instance (deny-by-default, untrusted
   new-worker posture). Matched by declaration id, never by worker name
   (J-028 capability-over-agent-count)."

## DECISION

**ZERO-POLICY-BY-DESIGN — adjudicated, unchanged.** No client-facing RLS
policy for `cg_worker_capability` is authorized in V1. A narrow PROPOSED
read-visibility direction is recorded below, strictly tied to the
`cg_worker_definition` proposal's conditions; nothing is applied.

## RATIONALE

1. **The capability table IS the deny-by-default substrate of worker
   authority.** Every row is an authority declaration: a capability present
   here is claimable (within delegation and bounds); a capability absent is
   structurally unclaimable. Any client-facing policy changes the meaning
   of the security boundary itself, not just visibility.
2. **A tenant-wide read policy would be an escalation-reconnaissance
   surface.** Publishing every worker's full capability inventory to every
   authenticated tenant member exposes exactly the information an attacker
   (or an over-ambitious worker) needs to plan a claim that intersects
   delegations with undeclared-but-existing capabilities (Constitution §31:
   agent cannot exceed permissions). Untrusted-by-default (§5) implies
   capability inventories of OTHER workers are not a legitimate client
   read.
3. **Writes must never be client-reachable in any posture.** A capability
   row is a grant-in-kind: inserting one is a critical action under §21
   (proposal → validation → policy check → approval → execution → audit).
   An authenticated INSERT/UPDATE policy would let any tenant administrator
   bypass the definition-revision governance and silently expand worker
   authority — precisely the §6/§37 prohibition (agents cannot silently
   increase permissions; agents may not expand permissions). Declaration
   changes must therefore remain service-role gated: a declaration-set
   change is an approved definition revision, not a row write.
4. **Why no client-facing policy is legitimate in V1:** no V1 client
   contract consumes the table (traced: zero `.from("cg_worker...")`
   usages); matching happens server-side/in-process through the pure
   contracts (`capability-registry.ts`, `capability-matching.ts`) that
   receive declarations as inputs. With zero consumer, zero policy is the
   exact correct posture — the battery's strongest-form derivation (no
   policy expression can evaluate true) guarantees no accidental surface
   appears either.
5. **The zero-policy posture composes correctly with the sibling tables:**
   `cg_worker_definition` (zero-policy, adjudicated in this mission) and
   `cg_worker_delegation` (zero-policy, owned by D-034) mean the entire
   worker authority substrate denies at the data plane; authority still
   flows exclusively through the shared identity-actor primitives. This is
   the coherent whole-of-family posture, not three unrelated decisions.

## CONSTITUTION SECTIONS

- §5 Agent Identity Model / §6 Agent Lifecycle — untrusted by default;
  capability declarations are the mechanism that keeps default authority
  zero, so the table itself must not become a readable/writable side door.
- §16 Authorization Model / §17 Database Security — RLS ENABLED, zero
  policies; the strongest deny-by-default form; service-role functions are
  the sanctioned path.
- §21 AI Output Trust — capability writes are critical actions requiring
  validation and approval; no client policy may shortcut the approval flow.
- §26 API Governance / §27 Server Function Rule — gated server functions
  only; never trust client-supplied capability claims.
- §28 Database Law — composite FK same-tenant integrity + RLS + revocable
  grants over application logic.
- §31 Testing Standard — "agent cannot exceed permissions" enforced at the
  contract layer (H3-016) and at the data plane (battery zero-policy
  strongest-form derivation).
- §37 Autonomous Coding Agent Rules — agents may not expand permissions;
  the capability ledger must be neither readable into an escalation plan
  nor writable without approval.

## PROPOSED-POLICY-IF-ANY

**PROPOSED (non-binding, nothing applied, strictly condition-gated):** adopt
visibility only as a dependent clause of the `cg_worker_definition`
proposal (see `cg_worker_definition.md`): when a client-facing worker-self
read surface is authorized AND the H3-016 FINDING-1 delegation-history
linkage is enforced, author (in the 20261002000013 exemplar form, FORCE RLS)
a `SELECT` policy joining visibility to the actor's OWN definition via the
same neutral self-derivation pin + `public.get_my_tenant_id()` scoping — a
worker (and its tenant administrators) see the declarations of that worker
only. **No write policy is ever proposed**: capability INSERT/UPDATE/DELETE
remain service-role-only for the table's entire lifetime, and the posture
entry (when declared) should encode `absentPolicies` for all write commands
in the substrate convention. Until the parent conditions hold, zero-policy
is the adjudicated V1 posture by design.