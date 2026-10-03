# POSTURE ADJUDICATION — `cg_event`

Team: H3-031 (Posture Adjudication Engineer, Squad D, kernel family) — mission D-031.
Status: ADJUDICATED 2026-10-03. Nothing applied; decision input for J-099 rationale merge.

TABLE: cg_event
SOURCE MIGRATION: 20260903000000_coregrid_universal_kernel_substrate.sql
BATTERY POSTURE: zero-policy
DECISION: zero-policy-by-design

## OWNERSHIP

- Schema owner: Phase 33 Universal Reality Intelligence Kernel (URIK) substrate, S2 slice.
- Creating migration: `database/supabase/migrations/20260903000000_coregrid_universal_kernel_substrate.sql` (§3 "Versioned event / outbox registry"; comment: "Versioned event/outbox registry. Idempotency keys, correlation ids and a delivery state machine support exactly-once intent at the application layer."; header declares the zero-policy service-role posture for the whole substrate).
- Writing server paths (all service-role via `asKernelAdmin(supabaseAdmin)`, all behind `requireSupabaseAuth` + tenant authorization):
  - `frontend/src/lib/kernel-reality.functions.ts` — `recordEvent` server function: authenticates, resolves tenant via `requireSchoolAdminScope`, derives `actor_identity` from the authenticated context (`context.userId`, never client-supplied), pins `tenant_id` to the resolved school scope, enforces idempotency via the unique `idempotency_key` (dedup read + insert with concurrent-duplicate backstop).
  - `frontend/src/lib/runtime/scholar/scholar-foundation-loop.functions.ts` — `executeScholarFoundationLoop`: inserts the audit event row (`admin.from("cg_event").insert(eventRow)`).
  - `frontend/src/lib/runtime/scholar/scholar-institution-config.functions.ts` — `publishInstitutionOperatingModel`: inserts the audit event (`admin.from("cg_event").insert(audit)`).
- Reading server paths: `recordEvent` idempotency reads; the governed delivery plane `scripts/event-fabric.mjs` — "Governed, observable one-pass delivery over the live `cg_event` outbox" — which advances the pending → published/failed/acknowledged/dead state machine through the service-role client (privileged, logged, explicit).
- Client surface: NONE. Events are an internal command-query-event record plus outbox delivery state; clients never read or write this table.

## EVIDENCE

- Battery scope: `scripts/verify-rls-isolation-battery.mjs` `BUILTIN_TABLE_POSTURES` — `{ name: "cg_event", source: "20260903000000_coregrid_universal_kernel_substrate.sql", posture: "zero-policy" }` (builtin-canonical entry).
- Posture files: `scripts/verification/rls-table-postures-substrate.json` and `rls-table-postures-transport.json` declare NO entry for `cg_event` (the routing/event-security families' tables are separate entries, all also zero-policy) — the merged registry resolves this table solely from the built-in canonical posture, zero-policy, with zero overrides.
- Battery-proven live: `architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md` §7 canonical 2026-10-02 — `cg_event | zero-policy | relrowsecurity=true | relforcerowsecurity=false (INFO) | 0 policies | PASS`.
- Migration security posture (same file, §5): `ALTER TABLE public.cg_event ENABLE ROW LEVEL SECURITY;`, `REVOKE ALL ... FROM anon, authenticated;`, `GRANT ALL ... TO service_role;` — zero `CREATE POLICY` statements in the whole migration.

## DECISION

**zero-policy-by-design.** RLS enabled, zero policies, nothing granted to anon/authenticated/PUBLIC. Deny-by-default in its strongest form. No client-facing policy is added in V1; nothing is applied by this mission.

## RATIONALE

1. `cg_event` is canonical-truth plumbing, not a client product surface (§9 Canonical Truth): the event/outbox record is the system's verified record of what happened, and the delivery state machine is routing-plane truth. Realtime/client exposure would violate §35 (never broadcast unauthorized events) — with zero policies there is provably zero client-visible realtime event flow.
2. No authorized client surface exists in V1: every insert comes from a gated server function (authenticate → resolve tenant → authorize → validate → execute → audit, §27). `recordEvent` derives the actor from the verified session and pins the tenant server-side; a client INSERT policy would re-introduce exactly the client-trusted-identity path §26 forbids.
3. The outbox delivery plane is service-role by design: `scripts/event-fabric.mjs` advances delivery state through the only privileged path (explicit, logged, observed). Granting authenticated roles any privilege here would create a second, ungoverned path to mutate delivery state (pending/published/failed/dead), breaking exactly-once intent at the application layer.
4. Same substrate constraint as the sibling kernel tables: `tenant_id` is a free `text` column predating the J-005/J-006 neutral policy primitives; deny-by-default (RULING-2, battery §7) remains the strongest correct posture, and the §31 negative proofs hold by construction (zero policies ⇒ zero identity can read).

## CONSTITUTION SECTIONS

- §9 Canonical Truth Principle — event records are verified system truth; AI/consumer inference never overwrites them without validation.
- §13 Multi-Tenancy — tenant_id pinned server-side on every write.
- §16 Authorization Model — layered decision lives in the server path + delivery plane; data plane denies all else.
- §17 Database Security — RLS enabled; database-level denial independent of application correctness.
- §26 API Governance — client identity never trusted; actor_identity derived from the verified session server-side.
- §27 Server Function Rule — recordEvent and audit-insert paths follow the full server-function discipline.
- §28 Database Law — unique idempotency key, state-machine CHECK, FKs/indices, RLS, REVOKE/GRANT discipline.
- §31 Testing Standard — unauthenticated/revoked/expired access denied at the data plane, proven by battery.
- §35 Realtime Security — zero policies ⇒ zero client-visible realtime events for this table.
- §45 V1 Execution Boundary — no client-facing policy authorized for kernel substrates in V1.

## PROPOSED-POLICY-IF-ANY

NONE — zero-policy-by-design is affirmed for V1. Future direction (PROPOSED only, not applied): if a tenant-scoped event feed is ever authorized as a product surface, the conversion must be a NEW exemplar-following migration (20261002000013 pattern) with `FORCE ROW LEVEL SECURITY`, a SELECT policy restricted to the neutral tenant reference AND a declared sensitivity/purpose gate (events carry cross-aggregate payloads; tenant scoping alone is not a sufficient predicate), authenticated = SELECT only (the outbox state machine must remain service-role writable), anon/PUBLIC untouched, plus a declared cross-tenant probe stage. Until that authority exists, zero-policy remains the proven, strongest posture.