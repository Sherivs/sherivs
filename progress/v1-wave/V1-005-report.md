# MISSION V1-005 — DB-backed memory tier adapter (§42 report)

Date: 2026-10-03 | Team: MEMORY | Repo: /workspace | Branch: `cursor/p08-foundation-loop-classification-fe86` (no git commands run, per mission law)

## Implemented

The adapter boundary documented in `frontend/src/lib/memory/memory-store.ts:227`
("an adapter layer (future, service-role) will persist these rows into the
cg_memory_* tables; this contract owns none of that I/O") is now closed:

1. **Adapter contract + in-memory fallback** (`frontend/src/lib/memory/memory-adapter.ts`,
   pure — no I/O, no vendor, no env, no wall clock):
   - `MemoryTierAdapter` interface with `load()` / `declareScope()` / `writeRecord()` /
     `retrieve()` — the same operation surface as the in-memory store's pure
     functions (`declareMemoryScope` / `writeMemoryRecord` / `retrieveMemory`),
     result types reused verbatim (`MemoryScopeDeclareResult`,
     `MemoryWriteResult`, `MemoryRetrievalResult`).
   - `createInMemoryMemoryTierAdapter()` — the fallback backend: delegates to
     the pure contract functions over an in-process `MemoryTierStore`.
     Semantics are exactly `memory-store.ts`; it is the default for tests.
2. **DB-backed adapter** (`frontend/src/lib/memory/memory-db-adapter.server.ts`,
   server-only module per repo conventions):
   - Persists into the EXISTING cg_memory_* tables authored (NOT applied) by
     `database/supabase/migrations/20261002000004_coregrid_v1_memory_tier.sql`.
     NO new migrations were authored; the migration file is untouched.
   - `declareScope` → `cg_memory_scope` (with `declared_by` provenance, §12;
     `declared_at` is database record time — never backdated).
   - `writeRecord` → `cg_memory_record` with the full canonical CoreObject
     envelope (V1CAP-002: `object_type`, `schema_version`, `status`,
     `created_by`, `updated_by`, `provenance` jsonb, `policy_context`,
     `trace_id`, `correlation_id`, causation root) and bi-temporal validity
     (V1CAP-004: `valid_from`, `valid_until`, `valid_time_known`, `supersedes`).
   - `retrieve` → runs the pure contract and appends ONE
     `cg_memory_access_log` row per attempt — granted, partial AND denied —
     with identity_ref, scope_id, purpose, returned ids, exclusion ledger,
     denial reason, audit instant (Constitution §12/§29). Audit-persist
     failure fails retrieval CLOSED (no record is served without its audit).
   - Runs on the service-role client (`client.server.ts` `supabaseAdmin`),
     the canonical pattern for `*.functions.ts`/server modules, injected for
     testability. RLS on cg_memory_* is deny-by-default (enabled, zero
     policies, no grants) per the migration, so authorization is enforced
     exclusively by the pure `memory-store.ts` gates — the adapter runs them
     BEFORE any row is read into contract state or written back. Tenant
     scoping is enforced in the SQL query itself (strictly stronger than the
     pure contract's defense-in-depth `tenant_mismatch` exclusion).
   - Untrusted reads: every row read back is Zod-validated (row schemas
     mirroring the migration CHECKs) and re-validated through the contract's
     own `validateKernelObjectEnvelope` before re-entering
     `MemoryTierStore` — malformed rows fail the load, never coerced.
   - Error discipline: contract rejections are typed `{ ok: false, error }`;
     infrastructure failures throw (mutating ops) or return typed
     `{ ok: false, error }` (`load` only).
3. **Selection** — `createMemoryTierAdapter()` reads `MEMORY_TIER_BACKEND`
   (`"memory"` | `"db"`, default/blank → `"memory"`, the test fallback;
   unknown values throw rather than silently degrading durability),
   following the repo's `process.env` server-module conventions.
   `resolveMemoryTierBackend()` is exported and unit-tested.

## Files Changed

- `frontend/src/lib/memory/memory-adapter.ts` — NEW (pure adapter contract +
  in-memory fallback).
- `frontend/src/lib/memory/memory-db-adapter.server.ts` — NEW (DB adapter +
  env-selectable factory).
- `tests/unit/memory-db-adapter.test.ts` — NEW (21 unit tests).
- `memory-store.ts`, `knowledge-currency.ts`, all migrations — UNTOUCHED.

## Architecture Impact

- Additive only. The pure memory contract remains the sole authorization
  layer (J-017 identity AND tenant AND scope AND policy); adapters cannot
  bypass it because every operation routes through the pure functions.
- Provider-agnostic seam (Constitution §25): `MemoryTierAdapter` is the
  interface; `SupabaseClient` appears only inside the `.server.ts` adapter.
- Access-log ids load globally (the contract generates them from store state;
  `cg_memory_access_log.id` is a global PK) — access-id continuity is
  cross-tenant; scopes/records load tenant-scoped.
- Worker memory sessions (J-007/V1CAP-016): NO cg_memory_* substrate exists
  for `workerSessions` / `sessionAuditLog`; adapters report them empty on
  load and session lifecycle remains in-contract state only.

## Config change required elsewhere (reported, not edited — file ownership)

- Consumers opt into durability by calling
  `createMemoryTierAdapter()` from `memory-db-adapter.server.ts` with
  `MEMORY_TIER_BACKEND=db`. No call site currently constructs it (none
  existed for the tier), so no wiring was edited. If a config module should
  own the env constant, that edit belongs to the config owner.

## Schema gaps discovered (reported, NOT migrated — outside ownership)

1. `cg_memory_record` authors NO subject column, but the contract carries
   `MemoryRecord.subjectRef` (worker-session vocabulary, J-007). The adapter
   is FAIL-CLOSED: a write naming a `subjectRef` is rejected (never silently
   dropped — provenance law §12); a follow-up migration must author the
   column before subject-scoped writes can persist.
2. `cg_memory_scope` requires `declared_by`/`declared_at` provenance that the
   TS `MemoryScopeDeclaration` shape does not carry; the adapter takes
   `declaredBy` as an explicit input and leaves `declared_at` to the DB
   default. A contract-level provenance field could be authored by the owner.
3. No `cg_memory_worker_session` / `cg_memory_session_audit` tables are
   authored; session persistence requires a migration under explicit
   authorization.

## Tests

- `npx vitest run tests/unit/memory-db-adapter.test.ts` → **21/21 passed**.
  Covers: backend selection (default fallback, `db`, unknown-throws, factory
  both backends); in-memory fallback round trip and typed rejections;
  scope persistence with `declared_by` provenance (no backdated
  `declared_at`); duplicate-scope rejection writes nothing; full
  envelope + bi-temporal persistence; pure-contract out-of-scope write
  touches NO table; subjectRef fail-closed; granted retrieval audited;
  DENIED retrieval audited with denial reason; audit-persist failure fails
  retrieval closed; global access-id continuity; round-trip read-back
  (envelope re-validated); backend failure as typed load error; malformed
  row fails closed; empty backend loads an empty contract store.
- Regression (existing memory suites, unmodified):
  `memory-store.test.ts` (40), `memory-worker-scopes.test.ts` (37),
  `h3-029-memory-retrieval-authz.test.ts` (39), `h3-018-memory-scoping.test.ts`
  (29), `knowledge-currency.test.ts` (33), `h3-034-posture-adjudication.test.ts`
  (20) → **7 files, 219/219 passed**.
- `npx tsc --noEmit`: zero errors in the new files (repo has PRE-EXISTING
  errors in `frontend/src/lib/communications/resend-email.server.ts` and
  `tests/unit/communications/*` — untouched, not mine).
- `npx eslint --fix` on the three new files: clean.
- No real database touched; no migrations authored; full `npm run verify`
  NOT run (mission law).

## Security Validation

- Retrieval authorization (identity AND tenant AND scope) and write scope
  bounds remain solely in the pure contract; the adapter cannot return a
  record that the pure gates did not return.
- Service-role client only (RLS deny-by-default on cg_memory_*); server-only
  module; no client-reachable surface.
- Client/backend data is untrusted: Zod row schemas + contract envelope
  re-validation on every read; malformed rows fail the load.
- Denials audited (cg_memory_access_log) including attempts; audit loss
  fails closed. No secrets logged; no secrets committed.

## Known Risks

- Subject-named writes cannot persist until gap 1 is migrated (fail-closed,
  reported above).
- `load()` (full/global reads) and the global access-log scan are correct but
  unoptimized; production follow-up should move access-id generation to the
  database or add cursor pagination.
- cg_memory_* migration is AUTHORED, NOT APPLIED — end-to-end behavior is
  proven against the mocked client only; live verification (MISSION-R-85
  RLS battery hooks) remains gated on apply authorization.

## Remaining Work

- Owner decisions on the three schema gaps (subject_ref column, scope
  provenance fields, session substrate tables).
- Wire `createMemoryTierAdapter()` into runtime consumers when the loop
  tail (Outcome → Memory → Observation) opts into durability.
