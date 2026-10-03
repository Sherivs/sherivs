/**
 * CoreGrid — Memory tier persistence adapter contract (MISSION V1-005).
 *
 * This module closes the adapter boundary documented in `memory-store.ts`
 * ("an adapter layer (future, service-role) will persist these rows into the
 * cg_memory_* tables; this contract owns none of that I/O"). It defines the
 * SELECTABLE persistence seam for the durable practical/organizational memory
 * tier WITHOUT modifying the pure contract: `memory-store.ts` stays the
 * canonical, fail-closed authorization layer (J-017 identity AND tenant AND
 * scope gates, no-silent-memory-expansion writes, audited retrieval), and every
 * adapter runs the SAME pure functions over backend-loaded state before any
 * row is persisted. Authorization can never be bypassed by choosing a backend.
 *
 * Adapters implement ONE interface:
 *
 *   - `declareScope`  — declare a scope (persisted into cg_memory_scope by the
 *     db backend; carried in the in-memory store by the fallback backend).
 *   - `writeRecord`   — write one memory record through the pure contract
 *     (persisted into cg_memory_record by the db backend).
 *   - `retrieve`      — authorization-gated retrieval (the access record is
 *     persisted into cg_memory_access_log by the db backend — granted AND
 *     denied attempts, Constitution §12/§29).
 *   - `load`          — reconstruct the full in-contract state from the
 *     backend (read-only; used for introspection and tests).
 *
 * Error discipline:
 *   - CONTRACT rejections (out-of-scope write, undeclared scope, cross-tenant
 *     act, ...) are returned as the typed `{ ok: false, error }` results of
 *     the pure contract — never thrown, never clamped.
 *   - INFRASTRUCTURE failures (unreachable backend, failed persistence) throw
 *     from the mutating operations: a caller must never receive records that
 *     were not durably persisted, and an audit record must never be silently
 *     dropped (the db adapter fails retrieval closed when its access-log
 *     persist fails). `load` alone reports failures as `{ ok: false, error }`.
 *
 * Backend selection (Constitution §25 — provider-agnostic adapters): callers
 * obtain an adapter through a backend factory; the in-memory adapter here is
 * the FALLBACK for tests and unconfigured environments. The db-backed adapter
 * and the environment-driven factory live in `memory-db-adapter.server.ts`
 * (server-only: it reads configuration and owns the service-role client).
 *
 * Worker memory sessions (J-007/V1CAP-016): no cg_memory_* substrate is
 * authored for the session registry or session audit log, so adapters report
 * `workerSessions: []` / `sessionAuditLog: []` on load and session lifecycle
 * remains in-contract state only. Session persistence requires an authored
 * migration under explicit authorization (never silently).
 *
 * Boundary: pure data + pure functions over the memory contract. No I/O, no
 * vendor imports, no environment reads, no wall-clock sampling.
 */

import {
  createMemoryTierStore,
  declareMemoryScope,
  retrieveMemory,
  writeMemoryRecord,
  type MemoryRetrievalConfig,
  type MemoryRetrievalRequest,
  type MemoryRetrievalResult,
  type MemoryScopeDeclareResult,
  type MemoryScopeDeclaration,
  type MemoryTierStore,
  type MemoryWriteRequest,
  type MemoryWriteResult,
} from "./memory-store";

/* ─────────────────────────────────────────────────────────────
 * Adapter contract
 * ────────────────────────────────────────────────────────────*/

/** Registered memory tier backends. "memory" is the default/test fallback. */
export type MemoryTierBackend = "memory" | "db";

/**
 * Scope declaration input. `declaredBy` is REQUIRED provenance (AGENTS §12):
 * the db backend persists it as cg_memory_scope.declared_by (NOT NULL), so a
 * scope can always answer WHO declared it. The declared instant is backend
 * record time (declared_at defaults to the database clock) — never backdated.
 */
export interface MemoryScopeDeclareInput {
  scope: MemoryScopeDeclaration;
  /** Provenance: the identity that declared the scope (1–160 characters). */
  declaredBy: string;
}

export type MemoryTierLoadResult =
  { ok: true; store: MemoryTierStore } | { ok: false; error: string };

/**
 * The persistence seam of the durable memory tier. Every implementation is
 * backed by the pure contract: state is loaded from the backend, validated,
 * evaluated by `declareMemoryScope`/`writeMemoryRecord`/`retrieveMemory`, and
 * only contract-accepted state is persisted. Adapter results reuse the pure
 * contract's result types (their `store` field is the post-operation
 * in-contract snapshot the backend now durably reflects).
 */
export interface MemoryTierAdapter {
  readonly backend: MemoryTierBackend;
  /** Reconstruct the full in-contract state from the backend. Never throws. */
  load(): Promise<MemoryTierLoadResult>;
  declareScope(input: MemoryScopeDeclareInput): Promise<MemoryScopeDeclareResult>;
  writeRecord(request: MemoryWriteRequest): Promise<MemoryWriteResult>;
  retrieve(
    request: MemoryRetrievalRequest,
    config: MemoryRetrievalConfig,
  ): Promise<MemoryRetrievalResult>;
}

/** Mirrors the memory contract's ref grammar (1–bound characters, trimmed). */
function isRef(value: unknown, maxLength: number): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= maxLength;
}

/* ─────────────────────────────────────────────────────────────
 * In-memory adapter — the fallback backend (tests / unconfigured)
 * ────────────────────────────────────────────────────────────*/

/**
 * Backend adapter over the pure contract's in-process store. This is the
 * DEFAULT backend: tests and unconfigured environments keep the exact
 * `memory-store.ts` semantics (pure, no I/O) behind the adapter interface.
 * It is NOT durable — state lives and dies with the adapter instance.
 */
export function createInMemoryMemoryTierAdapter(initial?: MemoryTierStore): MemoryTierAdapter {
  let store: MemoryTierStore = initial ?? createMemoryTierStore();
  return {
    backend: "memory",
    async load() {
      return { ok: true as const, store };
    },
    async declareScope(input: MemoryScopeDeclareInput) {
      if (!isRef(input.declaredBy, 160)) {
        return { ok: false as const, error: "memory scope declaredBy must be 1–160 characters" };
      }
      const result = declareMemoryScope(store, input.scope);
      if (result.ok) store = result.store;
      return result;
    },
    async writeRecord(request: MemoryWriteRequest) {
      const result = writeMemoryRecord(store, request);
      if (result.ok) store = result.store;
      return result;
    },
    async retrieve(request: MemoryRetrievalRequest, config: MemoryRetrievalConfig) {
      const result = retrieveMemory(store, request, config);
      store = result.store;
      return result;
    },
  };
}
