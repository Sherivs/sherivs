# ADR-021: Practical Memory and the Authorized Model-Context Boundary (CORE-06)

| Field | Value |
|---|---|
|| Status | PROPOSED (operator ratification required before deployment) |
|| Date | 2026-11-03 |
|| Author | copilot-swe-agent[bot] / AI CONTEXT |
|| Mission | CORE-06 (V1 organizational capability envelope; AI CONTEXT) |
|| Capabilities | V1 practical/organizational memory retrieval and governed AI context assembly |
|| Supersedes-in-part | None |
|| Cites | [CORE-06 issue #277](https://github.com/vibeoraai-bit/coregrid-scholar-migration/issues/277); [repository memory migration](../../database/supabase/migrations/20261002000004_coregrid_v1_memory_tier.sql); [memory store](../../frontend/src/lib/memory/memory-store.ts); [database adapter](../../frontend/src/lib/memory/memory-db-adapter.server.ts); [context assembler](../../frontend/src/lib/context-assembly.ts); [AI gateway](../../frontend/src/lib/ai-gateway.server.ts); [V1 gap report](../../docs/v1/V1-GAP-REPORT.md); AGENTS.md §§17, 19, 20, 25, 31, 45 |
|| Minimal ownership artifact | This ADR and the server-side memory-context assembly/gateway boundary |

## Context

The repository contains migration `20261002000004_coregrid_v1_memory_tier.sql` and its rollback for the existing `cg_memory_scope`, `cg_memory_record`, and `cg_memory_access_log` tables. The migration file labels itself “AUTHORED, NOT APPLIED”; its SQL enables RLS, revokes `anon`/`authenticated` table privileges, and authors zero policies, but does not state `FORCE ROW LEVEL SECURITY`.

The read-only production facts recorded in CORE-06 issue #277 report a `schema_migrations` row for `20261002000004 coregrid_v1_memory_tier` and all three existing tables with RLS and FORCE RLS enabled and zero policies. This change did not connect to, query, or modify a production database. The issue report is the evidence source for production state; the migration header describes the repository artifact and is not current production evidence.

The memory contract and service-role database adapter already enforce identity, tenant, declared-scope, permission, sensitivity, freshness, and audit rules. Before this change, the record retrieval gate did not require a record's `scope_id` to equal the requested scope, the context assembler was not connected to memory retrieval, and the production backend default could select process-local memory.

## Options

### Option 1 — Recreate or rename memory tables (rejected)

Create a new memory schema or use legacy `digital_twin_*` tables.

- **Consequences:** duplicates the production substrate, splits audit history, and bypasses the repository's existing memory contract. Rejected under CORE-06's no-new-table constraint and AGENTS §39.

### Option 2 — Add client RLS policies (rejected)

Grant `anon` or `authenticated` scoped access to the three memory tables.

- **Consequences:** would broaden the current zero-policy boundary and expose authorization inputs and access logs to client roles. Server-side scope checks and mandatory auditing already provide the required access path; no client policy is needed.

### Option 3 — Reuse the tables through an explicit server-only scope (ruled)

Require a declared scope, tenant, identity, permission set, requested domain set, freshness bound, and context budget for memory-enabled gateway requests. Retrieve through the existing adapter, persist the access result before returning, re-check and minimize candidates through context assembly, and pass only the assembled payload into the model callback.

- **Consequences:** preserves the existing tables and zero-policy posture and closes the same-tenant cross-scope gap. Callers without an explicit declared scope receive no memory. The service-role adapter remains security-critical and any retrieval/audit failure denies the gateway call.

## Recommendation (decision)

**Use Option 3. Do not create or rename any `cg_memory_*` table, do not use `digital_twin_*` tables, and do not add client policies. Memory-enabled calls must name an explicit declared scope; the gateway supplies the request tenant, actor, purpose, and time, and the memory adapter must persist every retrieval audit before context is returned. Only the resulting context-assembly envelope may be passed to model callbacks. Production must use the database backend; the in-memory backend is limited to non-production environments.**

No SQL migration is required for this application integration: production already reports the three tables and the stronger FORCE RLS/zero-policy posture, and this change adds no database objects or policies. The repository migration's lack of FORCE remains a documented repository/production difference; this change does not undo the production posture or edit the historical migration/rollback. Any future DDL reconciliation requires a separately authorized forward-only migration and a security-preserving rollback.

## Consequences (summary)

- **Positive:** Same-tenant records from another `scope_id` are excluded and audited; memory reads used for model context persist `cg_memory_access_log` evidence; the context package is constrained by explicit source, domain, sensitivity, permission, freshness, and budget gates.
- **Negative / obligations:** Existing model callers must only opt into memory with a server-resolved declared scope and permission set. Current Scholar call sites have no domain-specific declared scope mapping and therefore remain memory-free; no scope is synthesized. Missing scope, failed retrieval, malformed context, or failed access-log persistence must never fall back to unscoped context.
- **For the wave/program specifically:** CORE-06 reuses phase 36 memory ownership and phase 26 context/gateway enforcement. CORE-05 worker session lifecycle remains separately governed; this ADR does not broaden worker access or implement frozen V2/V3 capabilities.

## Golden Questions

- **WHO?** Phase 36 owns practical/organizational memory; phase 26 owns context and gateway enforcement; the operator ratifies this proposed ADR.
- **WHAT?** Model context may include persistent memory only after an explicitly scoped, authorized, audited retrieval and context assembly.
- **WHERE?** This ADR; `cg_memory_scope`, `cg_memory_record`, and `cg_memory_access_log`; `memory-context.server.ts`; `ai-gateway.server.ts`; their unit and local SQL isolation tests.
- **WHY?** CORE-06 found stale repository-vs-production migration status, no end-to-end memory/context/gateway wiring, and a missing record-scope equality check.
- **UNDER WHICH POLICY?** CORE-06 hard constraints; AGENTS §§17, 19, 20, 25, 31, 39, 42, 45; the existing zero-policy deny-by-default memory posture.

## UNKNOWNs

- This change does not independently verify production schema state; the reconciliation relies on the read-only facts in issue #277. A future live verification requires explicit human authorization and must remain read-only.
- Production model inference and deployment are not claimed or tested here.
- The production FORCE RLS clause is absent from the repository's original migration source. Any future repository replay parity change requires explicit authorization that preserves FORCE RLS and the zero-policy/client-deny posture.
