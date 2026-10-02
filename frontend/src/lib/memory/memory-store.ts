/**
 * CoreGrid — Phase 36 durable practical/organizational memory tier
 * (V1CAP-034/035/036, J-016/J-017, MISSION-R-36, wave 2).
 *
 * D1 ownership (DOSSIER_D1_MEMORY_OWNER.md): phase 36 is the canonical owner
 * of the practical/organizational memory tier; phase 07's in-process model
 * (`agent-memory.ts`) is a CONSUMER-side implementation, not the durable tier.
 * This module is the durable tier's authorization-gated contract. It does not
 * replace or modify `agent-memory.ts` — that integration is a consumer
 * concern (phase 07 scope enforcement, J-018) recorded at the integration
 * point, additively.
 *
 * Laws enforced structurally (G-015, G-060/G-061, E-027, L-H-007):
 * - Retrieval REQUIRES identity AND tenant AND declared scope. Any of the
 *   three missing is a DENIAL before any record is evaluated (fail-closed).
 *   There is NO vector/semantic-similarity surface anywhere in this contract:
 *   similarity can never return a record — only an authorized, scoped
 *   retrieval can (G-015: "memory must not be vector-only retrieval").
 * - Every retrieval — granted, partial, or DENIED — appends one auditable
 *   access record. In-scope records withheld by authorization are recorded as
 *   first-class exclusions (the memory twin of context-assembly's drop
 *   ledger): nothing is withheld silently, and nothing is returned silently.
 * - No silent memory expansion (J-017 guard, E-027, AGENTS §6/§8): writes are
 *   bounded by a DECLARED scope. A write whose actor, tenant, mission,
 *   domain, or sensitivity exceeds the declared scope is REJECTED, never
 *   clamped. An undeclared scope grants nothing.
 * - Memory is platform-owned data, never agent-owned (G-061, L-H-007): the
 *   store carries no agent-authority concept; every access resolves through
 *   the caller's independently resolved permission set.
 *
 * Record shape: canonical CoreObject envelope (V1CAP-002, via
 * `kernel/reality.ts` — an unstamped memory record can never be written),
 * bi-temporal validity (V1CAP-004: explicit valid time vs record time,
 * unknown-validity flagged, append-only supersession), scope declaration
 * (tenant, mission/actor scope, domains, sensitivity ceiling per the
 * context-assembly vocabulary), freshness, and provenance (inside the
 * envelope, Constitution §12).
 *
 * Boundary: pure data + pure functions. No persistence, no I/O, no vendor,
 * no wall-clock sampling — time is always supplied. Database truth for this
 * tier is authored (NOT applied) in
 * `database/supabase/migrations/20261002000004_coregrid_v1_memory_tier.sql`
 * with deny-by-default RLS (enabled, zero policies, no anon/authenticated
 * grants); application code is never the only security layer
 * (Constitution §17).
 *
 * Worker memory sessions (J-007 / V1CAP-016, MISSION-R-42, wave 3): a worker's
 * memory session is bounded by its DECLARED memory scope (AGENTS §5 — memory
 * scope is a declared identity field), resolved against a governed worker
 * definition. Every write and retrieval through a session is evaluated against
 * that scope; out-of-scope writes are REJECTED (never dropped, never coerced),
 * out-of-scope reads return nothing with a first-class audit exclusion record,
 * scope escalation is structurally impossible (a session cannot widen its own
 * scope — widening requires a new governed worker-definition revision), and
 * session termination (worker lifecycle end) invalidates the session's live
 * handles. Every scope decision — open, write, retrieve, terminate, grant and
 * denial — is appended to an auditable session decision log (Constitution §12).
 */

import { isIdentityUsable } from "../identity";
import type {
  WorkerDefinition,
  WorkerDefinitionLifecycleState,
} from "../workforce/worker-definition";
import {
  biTemporalColumns,
  isTimestamp,
  validateKernelObjectEnvelope,
  type KernelBiTemporalColumns,
  type KernelBiTemporalInput,
  type KernelObjectEnvelope,
  type KernelObjectEnvelopeInput,
} from "../kernel/reality";
import type { ContextSensitivity } from "../context-assembly";

/* ─────────────────────────────────────────────────────────────
 * Vocabularies
 * ────────────────────────────────────────────────────────────*/

/**
 * The V1 memory-tier classes (D1 tier split, V1CAP-034): practical memory
 * (task/episode-level working knowledge) and organizational memory
 * (institution-level durable knowledge). The civilization-scale tier is
 * V2 (V2CAP-020) and has NO representation in this contract.
 */
export type MemoryTierClass = "practical" | "organizational";

export const MEMORY_TIER_CLASSES: readonly MemoryTierClass[] = [
  "practical",
  "organizational",
] as const;

/**
 * Sensitivity vocabulary — reused from the context-assembly domain
 * (public/internal/restricted), never redefined. Rank order is the same
 * ceiling comparison context-assembly enforces on its own packages.
 */
export type MemorySensitivity = ContextSensitivity;

const SENSITIVITY_RANK: Record<MemorySensitivity, 0 | 1 | 2> = {
  public: 0,
  internal: 1,
  restricted: 2,
};

/** The object_type this substrate owns (pinned by the migration CHECK). */
export const MEMORY_RECORD_OBJECT_TYPE = "memory_record";

/** Mirrors the migration CHECK (length between 1 and the bound). */
function isRecordRef(value: unknown, maxLength: number): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= maxLength;
}

/* ─────────────────────────────────────────────────────────────
 * Scope declarations (the boundary of every read AND write)
 * ────────────────────────────────────────────────────────────*/

/**
 * A declared memory scope: the upper bound of what may be WRITTEN through it
 * and DRAWN ON by retrievals that name it. Empty `actorScope` or empty
 * `domains` are legal and grant NOTHING (deny-by-default): a scope is an
 * explicit boundary, never an implicit wildcard.
 */
export interface MemoryScopeDeclaration {
  scopeId: string;
  tenantId: string;
  /** Owning mission ref, or null when the scope is not mission-scoped. */
  missionRef: string | null;
  /** Actor identities bounded by the scope. Empty bounds nothing. */
  actorScope: readonly string[];
  /** Memory domains the scope covers. Empty covers nothing. */
  domains: readonly string[];
  /** Sensitivity ceiling — writes above it are rejected, retrievals exclude. */
  maxSensitivity: MemorySensitivity;
}

/* ─────────────────────────────────────────────────────────────
 * Records
 * ────────────────────────────────────────────────────────────*/

/**
 * A durable memory record. Written ONLY through a declared scope, fully
 * envelope-stamped (V1CAP-002) and bi-temporally explicit (V1CAP-004).
 */
export interface MemoryRecord {
  id: string;
  tenantId: string;
  /** The declared scope the record was written through. */
  scopeId: string;
  missionRef: string | null;
  memoryClass: MemoryTierClass;
  domain: string;
  /** Subject the record concerns; null when the write named no subject. */
  subjectRef: string | null;
  content: string;
  sensitivity: MemorySensitivity;
  /** Permission a retriever must hold; null means no additional policy gate. */
  requiredPermission: string | null;
  /** Freshness instant (J-019 posture: stale is distinguishable from current). */
  freshnessAt: string;
  /** Record time — when the system learned it (never backdated). */
  recordedAt: string;
  biTemporal: KernelBiTemporalColumns;
  envelope: KernelObjectEnvelope;
}

/* ─────────────────────────────────────────────────────────────
 * Exclusions + access records (the audit surface)
 * ────────────────────────────────────────────────────────────*/

/** Why an in-scope record was withheld from a retrieval (nothing drops silently). */
export type MemoryExclusionReason =
  | "tenant_mismatch"
  | "outside_declared_scope"
  | "exceeds_declared_sensitivity"
  | "permission_denied"
  | "stale"
  | "validity_expired"
  | "superseded"
  | "item_budget"
  /** Worker-session binding gate (J-007/V1CAP-016): namespace outside the binding. */
  | "outside_binding_namespace"
  /** Worker-session binding gate (J-007/V1CAP-016): tier not readable via the binding. */
  | "binding_tier_not_readable";

/**
 * The memory twin of context-assembly's exclusion record: a record that was
 * IN the retrieval's candidate set but withheld, with the reason and the
 * audit instant.
 */
export interface MemoryExclusionRecord {
  recordId: string;
  tenantId: string;
  reason: MemoryExclusionReason;
  detail: string;
  requiredPermission: string | null;
  recordedAt: string;
}

/**
 * ONE auditable access record per retrieval — appended on granted, partial,
 * AND denied outcomes. Proves WHO accessed (or was denied) WHAT memory, UNDER
 * WHICH scope and purpose, WHEN (Constitution §12/§29).
 */
export interface MemoryAccessRecord {
  id: string;
  tenantId: string | null;
  identityRef: string | null;
  scopeId: string | null;
  purpose: string;
  outcome: "granted" | "partial" | "denied";
  returnedRecordIds: readonly string[];
  exclusions: readonly MemoryExclusionRecord[];
  denialReason: string | null;
  /** Audit instant — the retrieval config's `now`, never wall-clock sampled. */
  recordedAt: string;
}

/* ─────────────────────────────────────────────────────────────
 * Store
 * ────────────────────────────────────────────────────────────*/

/**
 * The durable memory tier's in-contract state. Pure data: an adapter layer
 * (future, service-role) will persist these rows into the cg_memory_* tables;
 * this contract owns none of that I/O.
 */
export interface MemoryTierStore {
  readonly scopes: readonly MemoryScopeDeclaration[];
  readonly records: readonly MemoryRecord[];
  readonly accessLog: readonly MemoryAccessRecord[];
  /**
   * Registry of worker memory sessions (J-007/V1CAP-016). Session operations
   * resolve their binding from THIS registry by session id — a caller-held
   * handle is only a key, so a tampered or widened handle has no authority
   * (no self-widening).
   */
  readonly workerSessions: readonly WorkerMemorySession[];
  /**
   * Audit of every worker-session scope decision — open, write, retrieve,
   * terminate; grants AND denials (Constitution §12: who accessed what, under
   * which declared scope, when).
   */
  readonly sessionAuditLog: readonly WorkerMemoryAuditRecord[];
}

export function createMemoryTierStore(): MemoryTierStore {
  return {
    scopes: [],
    records: [],
    accessLog: [],
    workerSessions: [],
    sessionAuditLog: [],
  };
}

export type MemoryScopeDeclareResult =
  { ok: true; store: MemoryTierStore } | { ok: false; error: string };

/** Fails closed on: missing ids/tenant, malformed refs, duplicate scopeId. */
export function declareMemoryScope(
  store: MemoryTierStore,
  scope: MemoryScopeDeclaration,
): MemoryScopeDeclareResult {
  if (!isRecordRef(scope.scopeId, 160)) {
    return { ok: false, error: "memory scope scopeId must be 1–160 characters" };
  }
  if (!isRecordRef(scope.tenantId, 128)) {
    return { ok: false, error: "memory scope tenantId must be 1–128 characters" };
  }
  if (scope.missionRef != null && !isRecordRef(scope.missionRef, 200)) {
    return { ok: false, error: "memory scope missionRef must be 1–200 characters when present" };
  }
  for (const actor of scope.actorScope) {
    if (!isRecordRef(actor, 160)) {
      return { ok: false, error: "memory scope actorScope entries must be 1–160 characters" };
    }
  }
  for (const domain of scope.domains) {
    if (!isRecordRef(domain, 128)) {
      return { ok: false, error: "memory scope domain entries must be 1–128 characters" };
    }
  }
  if (store.scopes.some((existing) => existing.scopeId === scope.scopeId)) {
    return { ok: false, error: `memory scope "${scope.scopeId}" is already declared` };
  }
  return {
    ok: true,
    store: { ...store, scopes: [...store.scopes, { ...scope }] },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Writes — bounded by the declared scope (J-017 guard)
 * ────────────────────────────────────────────────────────────*/

export interface MemoryWriteRequest {
  recordId: string;
  /** The DECLARED scope this write is bounded by. */
  scopeId: string;
  identityRef: string;
  tenantId: string;
  missionRef: string | null;
  memoryClass: MemoryTierClass;
  domain: string;
  /**
   * Subject the record concerns (worker-session vocabulary, J-007). When
   * present, a worker-session write must name a subject declared in the
   * session binding's subject scope; absent means no subject constraint.
   */
  subjectRef?: string | null;
  content: string;
  sensitivity: MemorySensitivity;
  requiredPermission: string | null;
  freshnessAt: string;
  /** Record time — supplied, never sampled. */
  recordedAt: string;
  /** Explicit bi-temporal validity (V1CAP-004); validated fail-closed. */
  biTemporal: KernelBiTemporalInput;
  /** Canonical CoreObject envelope — an unstamped write is rejected. */
  envelope: KernelObjectEnvelopeInput;
}

export type MemoryWriteResult =
  { ok: true; store: MemoryTierStore; record: MemoryRecord } | { ok: false; error: string };

/**
 * Write one memory record through a declared scope. REJECTS (never clamps):
 * an unknown scope, a cross-tenant write, an actor outside the scope's
 * actorScope, a mission mismatch, a domain outside the scope's domains, a
 * sensitivity above the scope's ceiling, an unstamped envelope, an unknown
 * object type for this substrate, non-explicit bi-temporal validity, a
 * dangling or cross-tenant `supersedes` pointer, or a duplicate record id.
 * This is the J-017/E-027 no-silent-memory-expansion guard on the write path.
 *
 * Governance surface (J-007/V1CAP-016): this is the tier's own primitive.
 * WORKER RUNTIME code paths must NOT call it directly — they write memory only
 * through `writeMemoryThroughWorkerSession`, whose session binding is resolved
 * from the store's session registry against the worker's DECLARED memory scope
 * (AGENTS §5). Raw tier access from runtime code is a governance violation.
 */
export function writeMemoryRecord(
  store: MemoryTierStore,
  request: MemoryWriteRequest,
): MemoryWriteResult {
  if (!isRecordRef(request.recordId, 160)) {
    return { ok: false, error: "memory record id must be 1–160 characters" };
  }
  if (store.records.some((existing) => existing.id === request.recordId)) {
    return { ok: false, error: `memory record "${request.recordId}" already exists` };
  }
  if (!isRecordRef(request.identityRef, 160)) {
    return { ok: false, error: "memory write requires an identity (fail-closed)" };
  }
  if (!isRecordRef(request.tenantId, 128)) {
    return { ok: false, error: "memory write requires a tenant (fail-closed)" };
  }
  const scope = store.scopes.find((s) => s.scopeId === request.scopeId);
  if (scope == null) {
    return {
      ok: false,
      error: `memory write scope "${request.scopeId}" is not declared — no silent scope expansion`,
    };
  }
  if (scope.tenantId !== request.tenantId) {
    return {
      ok: false,
      error: `memory write is cross-tenant: scope "${scope.scopeId}" is bound to tenant "${scope.tenantId}", write declared tenant "${request.tenantId}"`,
    };
  }
  if (!scope.actorScope.includes(request.identityRef)) {
    return {
      ok: false,
      error: `memory write actor "${request.identityRef}" is outside the declared scope's actorScope — no silent scope expansion`,
    };
  }
  const scopeMission = scope.missionRef;
  const writeMission = request.missionRef?.trim() || null;
  if (scopeMission !== writeMission) {
    return {
      ok: false,
      error: `memory write mission "${writeMission ?? "null"}" does not match the declared scope's mission "${scopeMission ?? "null"}" — no silent scope expansion`,
    };
  }
  if (!(MEMORY_TIER_CLASSES as readonly unknown[]).includes(request.memoryClass)) {
    return {
      ok: false,
      error: `memory class "${String(request.memoryClass)}" is not a registered V1 memory tier class`,
    };
  }
  if (!isRecordRef(request.domain, 128)) {
    return { ok: false, error: "memory record domain must be 1–128 characters" };
  }
  if (!scope.domains.includes(request.domain)) {
    return {
      ok: false,
      error: `memory write domain "${request.domain}" is outside the declared scope's domains — no silent scope expansion`,
    };
  }
  if (SENSITIVITY_RANK[request.sensitivity] > SENSITIVITY_RANK[scope.maxSensitivity]) {
    return {
      ok: false,
      error: `memory write sensitivity "${request.sensitivity}" exceeds the declared scope ceiling "${scope.maxSensitivity}" — no silent scope expansion`,
    };
  }
  if (request.content.trim().length === 0) {
    return { ok: false, error: "memory record content is required" };
  }
  if (!isTimestamp(request.recordedAt)) {
    return { ok: false, error: "memory write recordedAt must be an ISO-8601 timestamp" };
  }
  if (!isTimestamp(request.freshnessAt)) {
    return { ok: false, error: "memory record freshnessAt must be an ISO-8601 timestamp" };
  }
  if (request.requiredPermission != null && !isRecordRef(request.requiredPermission, 200)) {
    return {
      ok: false,
      error: "memory record requiredPermission must be 1–200 characters when present",
    };
  }

  let biTemporal: KernelBiTemporalColumns;
  try {
    biTemporal = biTemporalColumns(request.biTemporal);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  if (biTemporal.supersedes != null) {
    const superseded = store.records.find((r) => r.id === biTemporal.supersedes);
    if (superseded == null) {
      return {
        ok: false,
        error: `memory record supersedes "${biTemporal.supersedes}" which does not exist in the store`,
      };
    }
    if (superseded.tenantId !== request.tenantId) {
      return {
        ok: false,
        error: `memory supersession is cross-tenant: record "${request.recordId}" (tenant "${request.tenantId}") cannot supersede "${superseded.id}" (tenant "${superseded.tenantId}")`,
      };
    }
  }

  let envelope: KernelObjectEnvelope;
  try {
    envelope = validateKernelObjectEnvelope(request.envelope);
  } catch (error) {
    return { ok: false, error: `memory record envelope rejected: ${(error as Error).message}` };
  }
  if (envelope.object_type !== MEMORY_RECORD_OBJECT_TYPE) {
    return {
      ok: false,
      error: `memory record envelope object_type must be "${MEMORY_RECORD_OBJECT_TYPE}", got "${envelope.object_type}"`,
    };
  }
  const originTenant = envelope.provenance.originTenantId;
  if (originTenant != null && originTenant !== request.tenantId) {
    return {
      ok: false,
      error: `memory record envelope provenance is cross-tenant: origin "${originTenant}" does not match record tenant "${request.tenantId}"`,
    };
  }

  const record: MemoryRecord = {
    id: request.recordId,
    tenantId: request.tenantId,
    scopeId: scope.scopeId,
    missionRef: writeMission,
    memoryClass: request.memoryClass,
    domain: request.domain,
    subjectRef: request.subjectRef ?? null,
    content: request.content,
    sensitivity: request.sensitivity,
    requiredPermission: request.requiredPermission,
    freshnessAt: request.freshnessAt,
    recordedAt: request.recordedAt,
    biTemporal,
    envelope,
  };
  return { ok: true, store: { ...store, records: [...store.records, record] }, record };
}

/* ─────────────────────────────────────────────────────────────
 * Retrieval — identity AND tenant AND scope, fail-closed (J-017)
 * ────────────────────────────────────────────────────────────*/

/**
 * A retrieval request. There is deliberately NO embedding, no similarity
 * vector, and no semantic-search field on this contract (G-015): retrieval is
 * authorization-gated and scope-bounded, and a record that fails
 * authorization is never returned regardless of any textual overlap with the
 * declared purpose.
 */
export interface MemoryRetrievalRequest {
  /** REQUIRED — absent/empty identity denies before any record is evaluated. */
  identityRef: string;
  /** REQUIRED — absent/empty tenant denies before any record is evaluated. */
  tenantId: string;
  /** REQUIRED — the DECLARED scope this retrieval draws on. */
  scopeId: string;
  /** Server-side resolved permission set of the identity; read-only input. */
  permissions: readonly string[];
  purpose: string;
  /** Freshness window in seconds relative to `now`; stale records are excluded. */
  maxAgeSeconds?: number;
  /** Item budget; in-scope authorized records beyond it are excluded, not dropped. */
  maxResults?: number;
  /**
   * Worker-session binding gate (J-007/V1CAP-016): when present, only records
   * whose tier class is listed are readable; every other record is withheld
   * with an audited `binding_tier_not_readable` exclusion.
   */
  requireReadableTierClasses?: readonly MemoryTierClass[];
  /**
   * Worker-session binding gate (J-007/V1CAP-016): when present, only records
   * whose domain (namespace) is listed are readable; every other record is
   * withheld with an audited `outside_binding_namespace` exclusion.
   */
  requireNamespaces?: readonly string[];
}

export interface MemoryRetrievalConfig {
  /** Retrieval instant (ISO-8601). Required for purity. */
  now: string;
}

export type MemoryRetrievalResult =
  | {
      ok: true;
      outcome: "granted" | "partial";
      records: readonly MemoryRecord[];
      exclusions: readonly MemoryExclusionRecord[];
      accessRecord: MemoryAccessRecord;
      store: MemoryTierStore;
    }
  | {
      ok: false;
      outcome: "partial" | "denied";
      records: readonly MemoryRecord[];
      exclusions: readonly MemoryExclusionRecord[];
      accessRecord: MemoryAccessRecord;
      store: MemoryTierStore;
    };

function accessRecordId(store: MemoryTierStore): string {
  return `mem-access-${String(store.accessLog.length + 1).padStart(6, "0")}`;
}

function appendAccess(store: MemoryTierStore, accessRecord: MemoryAccessRecord): MemoryTierStore {
  return { ...store, accessLog: [...store.accessLog, accessRecord] };
}

/**
 * Authorization-gated, scope-bounded, non-vector-only retrieval (J-017,
 * V1CAP-036). Gate order:
 *
 * 1. FAIL-CLOSED PRECONDITIONS — identity, tenant, and declared scope must
 *    ALL be present and mutually consistent before any record is evaluated.
 *    Denials still append an access record (audit of the attempt).
 * 2. CANDIDATE SET — every record of the tenant (defense-in-depth:
 *    a foreign-tenant record is recorded as a `tenant_mismatch` exclusion,
 *    never returned).
 * 3. PER-RECORD AUTHORIZATION — declared-domain membership, sensitivity
 *    ceiling, required permission, freshness, bi-temporal validity, and
 *    supersession. Every withheld record is a first-class exclusion record.
 *
 * The result is NEVER a bare record list: it always carries the exclusions
 * and the access record, so minimization is auditable (Constitution §19).
 *
 * Governance surface (J-007/V1CAP-016): this is the tier's own primitive.
 * WORKER RUNTIME code paths must NOT call it directly — they retrieve memory
 * only through `retrieveMemoryThroughWorkerSession`, which gates every record
 * against the session binding's declared namespaces and readable tiers.
 */
export function retrieveMemory(
  store: MemoryTierStore,
  request: MemoryRetrievalRequest,
  config: MemoryRetrievalConfig,
): MemoryRetrievalResult {
  const accessId = accessRecordId(store);
  const finishDenied = (
    identityRef: string | null,
    tenantId: string | null,
    scopeId: string | null,
    denialReason: string,
  ): MemoryRetrievalResult => {
    const accessRecord: MemoryAccessRecord = {
      id: accessId,
      tenantId,
      identityRef,
      scopeId,
      purpose: request.purpose,
      outcome: "denied",
      returnedRecordIds: [],
      exclusions: [],
      denialReason,
      recordedAt: config.now,
    };
    return {
      ok: false,
      outcome: "denied",
      records: [],
      exclusions: [],
      accessRecord,
      store: appendAccess(store, accessRecord),
    };
  };

  if (!isTimestamp(config.now)) {
    return finishDenied(
      request.identityRef || null,
      request.tenantId || null,
      request.scopeId || null,
      "Retrieval config `now` is not a valid ISO-8601 timestamp",
    );
  }

  // 1. Fail-closed preconditions — identity AND tenant AND scope (J-017).
  if (!isRecordRef(request.identityRef, 160)) {
    return finishDenied(
      null,
      request.tenantId || null,
      request.scopeId || null,
      "Retrieval denied: no identity — fail-closed (J-017)",
    );
  }
  if (!isRecordRef(request.tenantId, 128)) {
    return finishDenied(
      request.identityRef,
      null,
      request.scopeId || null,
      "Retrieval denied: no tenant — fail-closed (J-017)",
    );
  }
  if (!isRecordRef(request.scopeId, 160)) {
    return finishDenied(
      request.identityRef,
      request.tenantId,
      null,
      "Retrieval denied: no declared scope — fail-closed (J-017)",
    );
  }
  const scope = store.scopes.find((s) => s.scopeId === request.scopeId);
  if (scope == null) {
    return finishDenied(
      request.identityRef,
      request.tenantId,
      request.scopeId,
      `Retrieval denied: scope "${request.scopeId}" is not declared`,
    );
  }
  if (scope.tenantId !== request.tenantId) {
    return finishDenied(
      request.identityRef,
      request.tenantId,
      request.scopeId,
      `Retrieval denied: scope "${scope.scopeId}" is bound to tenant "${scope.tenantId}", not "${request.tenantId}"`,
    );
  }
  if (!scope.actorScope.includes(request.identityRef)) {
    return finishDenied(
      request.identityRef,
      request.tenantId,
      request.scopeId,
      `Retrieval denied: identity "${request.identityRef}" is outside the declared scope's actorScope`,
    );
  }

  const nowMs = Date.parse(config.now);
  const exclusions: MemoryExclusionRecord[] = [];
  const recordExclusion = (
    recordId: string,
    tenantId: string,
    reason: MemoryExclusionReason,
    detail: string,
    requiredPermission: string | null,
  ): MemoryExclusionRecord => {
    const complete: MemoryExclusionRecord = {
      recordId,
      tenantId,
      reason,
      detail,
      requiredPermission,
      recordedAt: config.now,
    };
    exclusions.push(complete);
    return complete;
  };

  // 2. Candidate set: the tenant's records; foreign tenants never pass.
  const candidates = store.records.filter((record) => {
    if (record.tenantId !== request.tenantId) {
      recordExclusion(
        record.id,
        record.tenantId,
        "tenant_mismatch",
        `Record tenant "${record.tenantId}" does not match retrieval tenant "${request.tenantId}" (defense-in-depth)`,
        null,
      );
      return false;
    }
    return true;
  });

  // 3. Per-record authorization gates, in a fixed deterministic order.
  const maxAgeSeconds = request.maxAgeSeconds ?? null;
  const maxResults = request.maxResults ?? null;
  const requireNamespaces = request.requireNamespaces ?? null;
  const requireReadableTiers = request.requireReadableTierClasses ?? null;
  const supersededIds = new Set(
    store.records
      .filter((r) => r.tenantId === request.tenantId && r.biTemporal.supersedes != null)
      .map((r) => r.biTemporal.supersedes as string),
  );
  const returned: MemoryRecord[] = [];
  for (const record of candidates) {
    // Worker-session binding gates run FIRST (outermost boundary): a record the
    // session binding cannot see is excluded with an audit record before any
    // other gate is evaluated (J-007/V1CAP-016).
    if (requireNamespaces != null && !requireNamespaces.includes(record.domain)) {
      recordExclusion(
        record.id,
        record.tenantId,
        "outside_binding_namespace",
        `Record namespace "${record.domain}" is outside the session binding's declared namespaces`,
        null,
      );
      continue;
    }
    if (requireReadableTiers != null && !requireReadableTiers.includes(record.memoryClass)) {
      recordExclusion(
        record.id,
        record.tenantId,
        "binding_tier_not_readable",
        `Record tier class "${record.memoryClass}" is not readable through the session binding's declared tier set`,
        null,
      );
      continue;
    }
    if (!scope.domains.includes(record.domain)) {
      recordExclusion(
        record.id,
        record.tenantId,
        "outside_declared_scope",
        `Record domain "${record.domain}" is outside the declared scope's domains`,
        null,
      );
      continue;
    }
    if (SENSITIVITY_RANK[record.sensitivity] > SENSITIVITY_RANK[scope.maxSensitivity]) {
      recordExclusion(
        record.id,
        record.tenantId,
        "exceeds_declared_sensitivity",
        `Record sensitivity "${record.sensitivity}" exceeds the declared scope ceiling "${scope.maxSensitivity}"`,
        null,
      );
      continue;
    }
    if (
      record.requiredPermission !== null &&
      !request.permissions.includes(record.requiredPermission)
    ) {
      recordExclusion(
        record.id,
        record.tenantId,
        "permission_denied",
        `Identity "${request.identityRef}" lacks required permission "${record.requiredPermission}"`,
        record.requiredPermission,
      );
      continue;
    }
    const freshMs = Date.parse(record.freshnessAt);
    if (
      maxAgeSeconds != null &&
      (Number.isNaN(freshMs) || nowMs - freshMs > maxAgeSeconds * 1000)
    ) {
      recordExclusion(
        record.id,
        record.tenantId,
        "stale",
        Number.isNaN(freshMs)
          ? "Record freshness timestamp is not a valid ISO-8601 timestamp"
          : `Record age exceeds maxAgeSeconds=${maxAgeSeconds}`,
        null,
      );
      continue;
    }
    if (
      record.biTemporal.valid_time_known &&
      record.biTemporal.valid_until != null &&
      Date.parse(record.biTemporal.valid_until) <= nowMs
    ) {
      recordExclusion(
        record.id,
        record.tenantId,
        "validity_expired",
        `Record validity ended at "${record.biTemporal.valid_until}" (before ${config.now})`,
        null,
      );
      continue;
    }
    if (supersededIds.has(record.id)) {
      recordExclusion(
        record.id,
        record.tenantId,
        "superseded",
        "Record has been superseded by an append-only correction in the same tenant",
        null,
      );
      continue;
    }
    if (maxResults != null && returned.length >= maxResults) {
      recordExclusion(
        record.id,
        record.tenantId,
        "item_budget",
        `Item budget exhausted (maxResults=${maxResults})`,
        null,
      );
      continue;
    }
    returned.push(record);
  }

  const outcome: "granted" | "partial" =
    returned.length > 0 && exclusions.length === 0 ? "granted" : "partial";
  const accessRecord: MemoryAccessRecord = {
    id: accessId,
    tenantId: request.tenantId,
    identityRef: request.identityRef,
    scopeId: request.scopeId,
    purpose: request.purpose,
    outcome,
    returnedRecordIds: returned.map((r) => r.id),
    exclusions,
    denialReason:
      returned.length === 0 ? "No authorized record survived the retrieval gates" : null,
    recordedAt: config.now,
  };
  const storeWithAccess = appendAccess(store, accessRecord);
  if (returned.length === 0) {
    return {
      ok: false,
      outcome: "partial",
      records: [],
      exclusions,
      accessRecord,
      store: storeWithAccess,
    };
  }
  return {
    ok: true,
    outcome,
    records: returned,
    exclusions,
    accessRecord,
    store: storeWithAccess,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Worker memory sessions — the governed memory boundary
 * (J-007 / V1CAP-016, MISSION-R-42, wave 3; AGENTS §5)
 * ────────────────────────────────────────────────────────────*/

/**
 * The declared memory scope of a worker, resolved against a governed worker
 * definition at session-open time. Empty tier sets, namespaces or subjects
 * grant NOTHING (deny-by-default): a declared boundary is never an implicit
 * wildcard (AGENTS §5 — memory scope is a declared identity field).
 */
export interface WorkerMemoryScopeInput {
  /** The DECLARED memory scope (in the store) the session draws on. */
  scopeId: string;
  /** Tier classes the worker may WRITE. Empty writes nothing. */
  writableTierClasses: readonly MemoryTierClass[];
  /** Tier classes the worker may READ. Empty reads nothing. */
  readableTierClasses: readonly MemoryTierClass[];
  /** Memory domains (namespaces) the session may touch; must be a subset of the underlying scope's domains. */
  namespaces: readonly string[];
  /** Subjects a session write may name. Empty permits no named subject. */
  subjects: readonly string[];
  /** Sensitivity ceiling — must be at or below the underlying scope's ceiling. */
  maxSensitivity: MemorySensitivity;
}

/**
 * The immutable binding a session is opened with. Derived from the worker
 * definition (identity, tenant, definition ref) and the declared scope; the
 * mission ref is inherited from the underlying scope. Frozen at open time —
 * a session cannot widen its own scope (widening requires a new governed
 * worker-definition revision that re-declares a scope and opens a new session).
 */
export interface WorkerMemoryScopeBinding {
  workerDefinitionId: string;
  identityRef: string;
  tenantId: string;
  scopeId: string;
  missionRef: string | null;
  readonly writableTierClasses: readonly MemoryTierClass[];
  readonly readableTierClasses: readonly MemoryTierClass[];
  readonly namespaces: readonly string[];
  readonly subjects: readonly string[];
  maxSensitivity: MemorySensitivity;
}

export type WorkerMemorySessionState = "open" | "terminated";

/** A live worker memory session handle. Registered in the store; frozen. */
export interface WorkerMemorySession {
  sessionId: string;
  binding: WorkerMemoryScopeBinding;
  /** Definition lifecycle snapshot at open time (open refuses unusable workers). */
  workerLifecycle: WorkerDefinitionLifecycleState;
  state: WorkerMemorySessionState;
  openedAt: string;
  terminatedAt: string | null;
  terminationReason: string | null;
}

/** Which worker-session operation an audit record evidences. */
export type WorkerMemorySessionOperation = "open" | "write" | "retrieve" | "terminate";

/**
 * ONE auditable record per worker-session scope decision — granted AND
 * denied (Constitution §12/§29: who, what, under which declared scope, when).
 */
export interface WorkerMemoryAuditRecord {
  id: string;
  sessionId: string;
  workerDefinitionId: string;
  identityRef: string;
  tenantId: string;
  scopeId: string;
  operation: WorkerMemorySessionOperation;
  allowed: boolean;
  /** Record id for write decisions; null for open/retrieve/terminate. */
  recordId: string | null;
  /** Explicit denial reason; null when allowed. */
  reason: string | null;
  recordedAt: string;
}

export interface WorkerMemorySessionOpenInput {
  sessionId: string;
  /** The governed worker definition the session is bound to. */
  workerDefinition: WorkerDefinition;
  /** The worker's DECLARED memory scope (from the definition revision). */
  scope: WorkerMemoryScopeInput;
  /** Open instant (ISO-8601) — supplied, never sampled. */
  openedAt: string;
}

export type WorkerMemorySessionOpenResult =
  | { ok: true; store: MemoryTierStore; session: WorkerMemorySession }
  | { ok: false; error: string; store: MemoryTierStore };

export type WorkerMemoryWriteResult =
  | { ok: true; store: MemoryTierStore; record: MemoryRecord }
  | { ok: false; error: string; store: MemoryTierStore };

export type WorkerMemoryRetrievalResult =
  | {
      ok: true;
      outcome: "granted" | "partial";
      records: readonly MemoryRecord[];
      exclusions: readonly MemoryExclusionRecord[];
      accessRecord: MemoryAccessRecord;
      session: WorkerMemorySession;
      store: MemoryTierStore;
    }
  | {
      ok: false;
      outcome: "denied";
      records: readonly MemoryRecord[];
      exclusions: readonly MemoryExclusionRecord[];
      /** Null when the session layer denied before any record was evaluated. */
      accessRecord: MemoryAccessRecord | null;
      denialReason: string;
      session: WorkerMemorySession | null;
      store: MemoryTierStore;
    };

export interface WorkerMemorySessionTerminateInput {
  terminatedAt: string;
  reason: string;
}

export type WorkerMemorySessionTerminateResult =
  | { ok: true; store: MemoryTierStore; session: WorkerMemorySession }
  | { ok: false; error: string; store: MemoryTierStore };

function sessionAuditRecordId(store: MemoryTierStore): string {
  return `mem-session-audit-${String(store.sessionAuditLog.length + 1).padStart(6, "0")}`;
}

function appendSessionAudit(
  store: MemoryTierStore,
  entry: Omit<WorkerMemoryAuditRecord, "id">,
): MemoryTierStore {
  return {
    ...store,
    sessionAuditLog: [...store.sessionAuditLog, { id: sessionAuditRecordId(store), ...entry }],
  };
}

function auditSessionDecision(
  store: MemoryTierStore,
  session: WorkerMemorySession,
  operation: WorkerMemorySessionOperation,
  allowed: boolean,
  reason: string | null,
  recordId: string | null,
  recordedAt: string,
): MemoryTierStore {
  return appendSessionAudit(store, {
    sessionId: session.sessionId,
    workerDefinitionId: session.binding.workerDefinitionId,
    identityRef: session.binding.identityRef,
    tenantId: session.binding.tenantId,
    scopeId: session.binding.scopeId,
    operation,
    allowed,
    recordId,
    reason,
    recordedAt,
  });
}

function registeredWorkerSession(
  store: MemoryTierStore,
  handle: Pick<WorkerMemorySession, "sessionId">,
): WorkerMemorySession | null {
  return store.workerSessions.find((s) => s.sessionId === handle.sessionId) ?? null;
}

/**
 * Open a worker memory session bounded by the worker's DECLARED memory scope.
 * Fails closed (audited) on: an unusable worker-definition lifecycle
 * (suspended/archived/deleted), an unknown underlying scope, a cross-tenant
 * scope, a worker identity outside the scope's actorScope, a namespace outside
 * the scope's domains, a ceiling above the scope's ceiling, an unknown tier
 * class, or a duplicate session id. The binding is FROZEN: a session cannot
 * widen its own scope.
 */
export function openWorkerMemorySession(
  store: MemoryTierStore,
  input: WorkerMemorySessionOpenInput,
): WorkerMemorySessionOpenResult {
  const denied = (reason: string): WorkerMemorySessionOpenResult => {
    const audited = appendSessionAudit(store, {
      sessionId: input.sessionId,
      workerDefinitionId: input.workerDefinition.id,
      identityRef: input.workerDefinition.identityRef,
      tenantId: input.workerDefinition.tenantScope,
      scopeId: input.scope.scopeId,
      operation: "open",
      allowed: false,
      recordId: null,
      reason,
      recordedAt: input.openedAt,
    });
    return { ok: false, error: reason, store: audited };
  };
  const failed = (error: string): WorkerMemorySessionOpenResult => ({
    ok: false,
    error,
    store,
  });

  if (!isRecordRef(input.sessionId, 160)) {
    return failed("worker memory session id must be 1–160 characters");
  }
  if (store.workerSessions.some((s) => s.sessionId === input.sessionId)) {
    return denied(`worker memory session "${input.sessionId}" is already registered`);
  }
  if (!isTimestamp(input.openedAt)) {
    return failed("worker memory session openedAt must be an ISO-8601 timestamp");
  }
  if (!isIdentityUsable({ lifecycle: input.workerDefinition.lifecycle })) {
    return denied(
      `worker definition lifecycle "${input.workerDefinition.lifecycle}" is unusable — memory session denied (fail-closed)`,
    );
  }
  for (const tier of [...input.scope.writableTierClasses, ...input.scope.readableTierClasses]) {
    if (!(MEMORY_TIER_CLASSES as readonly unknown[]).includes(tier)) {
      return failed(`memory tier class "${String(tier)}" is not a registered V1 memory tier class`);
    }
  }
  for (const namespace of input.scope.namespaces) {
    if (!isRecordRef(namespace, 128)) {
      return failed("worker memory scope namespace entries must be 1–128 characters");
    }
  }
  for (const subject of input.scope.subjects) {
    if (!isRecordRef(subject, 160)) {
      return failed("worker memory scope subject entries must be 1–160 characters");
    }
  }
  if (!(input.scope.maxSensitivity in SENSITIVITY_RANK)) {
    return failed(
      `worker memory scope maxSensitivity "${String(input.scope.maxSensitivity)}" is not a registered sensitivity`,
    );
  }

  const underlyingScope = store.scopes.find((s) => s.scopeId === input.scope.scopeId);
  if (underlyingScope == null) {
    return denied(
      `worker memory scope "${input.scope.scopeId}" is not declared — no silent scope expansion`,
    );
  }
  if (underlyingScope.tenantId !== input.workerDefinition.tenantScope) {
    return denied(
      `worker memory scope "${underlyingScope.scopeId}" is bound to tenant "${underlyingScope.tenantId}", worker definition tenant is "${input.workerDefinition.tenantScope}" — cross-tenant denied`,
    );
  }
  if (!underlyingScope.actorScope.includes(input.workerDefinition.identityRef)) {
    return denied(
      `worker identity "${input.workerDefinition.identityRef}" is outside the declared scope's actorScope — no silent scope expansion`,
    );
  }
  for (const namespace of input.scope.namespaces) {
    if (!underlyingScope.domains.includes(namespace)) {
      return denied(
        `worker memory scope namespace "${namespace}" is outside the declared scope's domains — scope escalation denied`,
      );
    }
  }
  if (
    SENSITIVITY_RANK[input.scope.maxSensitivity] > SENSITIVITY_RANK[underlyingScope.maxSensitivity]
  ) {
    return denied(
      `worker memory scope ceiling "${input.scope.maxSensitivity}" exceeds the declared scope ceiling "${underlyingScope.maxSensitivity}" — scope escalation denied`,
    );
  }

  const binding: WorkerMemoryScopeBinding = Object.freeze({
    workerDefinitionId: input.workerDefinition.id,
    identityRef: input.workerDefinition.identityRef,
    tenantId: input.workerDefinition.tenantScope,
    scopeId: underlyingScope.scopeId,
    missionRef: underlyingScope.missionRef,
    writableTierClasses: Object.freeze([...input.scope.writableTierClasses]),
    readableTierClasses: Object.freeze([...input.scope.readableTierClasses]),
    namespaces: Object.freeze([...input.scope.namespaces]),
    subjects: Object.freeze([...input.scope.subjects]),
    maxSensitivity: input.scope.maxSensitivity,
  });
  const session: WorkerMemorySession = Object.freeze({
    sessionId: input.sessionId,
    binding,
    workerLifecycle: input.workerDefinition.lifecycle,
    state: "open",
    openedAt: input.openedAt,
    terminatedAt: null,
    terminationReason: null,
  });
  const storeWithSession: MemoryTierStore = {
    ...store,
    workerSessions: [...store.workerSessions, session],
  };
  const audited = auditSessionDecision(
    storeWithSession,
    session,
    "open",
    true,
    null,
    null,
    input.openedAt,
  );
  return { ok: true, store: audited, session };
}

/**
 * Write one memory record THROUGH a worker memory session. The binding is
 * resolved from the store's session registry by session id — the handle is
 * only a key, so a tampered or widened handle has no authority (no
 * self-widening). Out-of-scope writes are REJECTED (never dropped, never
 * coerced) and every rejection is appended to the session audit log. Scope
 * axes enforced at the session layer: session state, identity, tenant,
 * mission, writable tier, namespace, subject, sensitivity ceiling. The
 * remaining tier invariants (envelope stamp, bi-temporal validity,
 * supersession, duplicate ids) remain the tier's own fail-closed gates.
 */
export function writeMemoryThroughWorkerSession(
  store: MemoryTierStore,
  session: Pick<WorkerMemorySession, "sessionId">,
  request: MemoryWriteRequest,
): WorkerMemoryWriteResult {
  const registered = registeredWorkerSession(store, session);
  const deny = (reason: string): WorkerMemoryWriteResult => {
    const auditSession = registered ?? fallbackSession(store, session);
    const audited = auditSessionDecision(
      store,
      auditSession,
      "write",
      false,
      reason,
      request.recordId,
      request.recordedAt,
    );
    return { ok: false, error: reason, store: audited };
  };
  if (registered == null) {
    return deny(
      `worker memory session "${session.sessionId}" is not registered in this store — fail-closed`,
    );
  }
  if (registered.state === "terminated") {
    return deny(
      `worker memory session "${registered.sessionId}" is terminated ("${registered.terminationReason}") — live handles invalidated`,
    );
  }
  const binding = registered.binding;
  if (request.identityRef !== binding.identityRef) {
    return deny(
      `write identity "${request.identityRef}" does not match the session binding's worker identity "${binding.identityRef}"`,
    );
  }
  if (request.tenantId !== binding.tenantId) {
    return deny(
      `write tenant "${request.tenantId}" does not match the session binding's tenant "${binding.tenantId}" — cross-tenant denied`,
    );
  }
  const writeMission = request.missionRef?.trim() || null;
  if (binding.missionRef !== writeMission) {
    return deny(
      `write mission "${writeMission ?? "null"}" does not match the session binding's mission "${binding.missionRef ?? "null"}" — no silent scope expansion`,
    );
  }
  if (!binding.writableTierClasses.includes(request.memoryClass)) {
    return deny(
      `memory class "${request.memoryClass}" is not writable through the session binding's declared tier set — no silent scope expansion`,
    );
  }
  if (!binding.namespaces.includes(request.domain)) {
    return deny(
      `write namespace "${request.domain}" is outside the session binding's declared namespaces — no silent scope expansion`,
    );
  }
  if (request.subjectRef != null && !binding.subjects.includes(request.subjectRef)) {
    return deny(
      `write subject "${request.subjectRef}" is not declared in the session binding's subject scope`,
    );
  }
  if (SENSITIVITY_RANK[request.sensitivity] > SENSITIVITY_RANK[binding.maxSensitivity]) {
    return deny(
      `write sensitivity "${request.sensitivity}" exceeds the session binding's declared ceiling "${binding.maxSensitivity}" — no silent scope expansion`,
    );
  }
  const writeResult = writeMemoryRecord(store, request);
  if (!writeResult.ok) {
    return { ok: false, error: writeResult.error, store };
  }
  const audited = auditSessionDecision(
    writeResult.store,
    registered,
    "write",
    true,
    null,
    writeResult.record.id,
    request.recordedAt,
  );
  return { ok: true, store: audited, record: writeResult.record };
}

/** Fallback audit view for a handle that is not registered in this store. */
function fallbackSession(
  store: MemoryTierStore,
  handle: Pick<WorkerMemorySession, "sessionId">,
): WorkerMemorySession {
  const registered = registeredWorkerSession(store, handle);
  if (registered != null) return registered;
  return Object.freeze({
    sessionId: handle.sessionId,
    binding: Object.freeze({
      workerDefinitionId: "unknown",
      identityRef: "unknown",
      tenantId: "unknown",
      scopeId: "unknown",
      missionRef: null,
      writableTierClasses: Object.freeze([]),
      readableTierClasses: Object.freeze([]),
      namespaces: Object.freeze([]),
      subjects: Object.freeze([]),
      maxSensitivity: "public",
    }),
    workerLifecycle: "deleted",
    state: "terminated",
    openedAt: "",
    terminatedAt: null,
    terminationReason: "unregistered_handle",
  });
}

/**
 * Retrieve memory THROUGH a worker memory session. The binding gates every
 * candidate record: records outside the binding's namespaces or above its
 * readable tier set are withheld with first-class audit exclusion records
 * (`outside_binding_namespace`, `binding_tier_not_readable`) inside the
 * retrieval's access record — out-of-scope reads return nothing, and nothing
 * is withheld silently. Session-layer denials (unregistered/terminated
 * session, identity/tenant/scope mismatch) are appended to the session audit
 * log; the tier's own denials remain audited in the access record.
 */
export function retrieveMemoryThroughWorkerSession(
  store: MemoryTierStore,
  session: Pick<WorkerMemorySession, "sessionId">,
  request: MemoryRetrievalRequest,
  config: MemoryRetrievalConfig,
): WorkerMemoryRetrievalResult {
  const registered = registeredWorkerSession(store, session);
  const deny = (reason: string): WorkerMemoryRetrievalResult => {
    const auditSession = registered ?? fallbackSession(store, session);
    const audited = auditSessionDecision(
      store,
      auditSession,
      "retrieve",
      false,
      reason,
      null,
      config.now,
    );
    return {
      ok: false,
      outcome: "denied",
      records: [],
      exclusions: [],
      accessRecord: null,
      denialReason: reason,
      session: null,
      store: audited,
    };
  };
  if (registered == null) {
    return deny(
      `worker memory session "${session.sessionId}" is not registered in this store — fail-closed`,
    );
  }
  if (registered.state === "terminated") {
    return deny(
      `worker memory session "${registered.sessionId}" is terminated ("${registered.terminationReason}") — live handles invalidated`,
    );
  }
  const binding = registered.binding;
  if (request.identityRef !== binding.identityRef) {
    return deny(
      `retrieval identity "${request.identityRef}" does not match the session binding's worker identity "${binding.identityRef}"`,
    );
  }
  if (request.tenantId !== binding.tenantId) {
    return deny(
      `retrieval tenant "${request.tenantId}" does not match the session binding's tenant "${binding.tenantId}" — cross-tenant denied`,
    );
  }
  if (request.scopeId !== binding.scopeId) {
    return deny(
      `retrieval scope "${request.scopeId}" does not match the session binding's declared scope "${binding.scopeId}"`,
    );
  }
  const result = retrieveMemory(
    store,
    {
      ...request,
      requireReadableTierClasses: binding.readableTierClasses,
      requireNamespaces: binding.namespaces,
    },
    config,
  );
  const audited = auditSessionDecision(
    result.store,
    registered,
    "retrieve",
    result.ok,
    result.ok ? null : (result.accessRecord.denialReason ?? "retrieval denied at the tier gate"),
    null,
    config.now,
  );
  if (result.ok) {
    return {
      ok: true,
      outcome: result.outcome,
      records: result.records,
      exclusions: result.exclusions,
      accessRecord: result.accessRecord,
      session: registered,
      store: audited,
    };
  }
  return {
    ok: false,
    outcome: "denied",
    records: result.records,
    exclusions: result.exclusions,
    accessRecord: result.accessRecord,
    denialReason: result.accessRecord.denialReason ?? "retrieval denied at the tier gate",
    session: registered,
    store: audited,
  };
}

/**
 * Terminate a worker memory session (worker lifecycle end). Termination is
 * permanent — no resurrection — and invalidates every live handle: session
 * operations resolve the binding from THIS store's registry, so any handle
 * bearing the terminated session id is denied from then on. Termination and
 * every post-termination denial are audited.
 */
export function terminateWorkerMemorySession(
  store: MemoryTierStore,
  sessionId: string,
  input: WorkerMemorySessionTerminateInput,
): WorkerMemorySessionTerminateResult {
  if (!isRecordRef(sessionId, 160)) {
    return { ok: false, error: "worker memory session id must be 1–160 characters", store };
  }
  const registered = registeredWorkerSession(store, { sessionId });
  if (registered == null) {
    return {
      ok: false,
      error: `worker memory session "${sessionId}" is not registered in this store`,
      store,
    };
  }
  if (!isTimestamp(input.terminatedAt)) {
    return {
      ok: false,
      error: "worker memory session terminatedAt must be an ISO-8601 timestamp",
      store,
    };
  }
  if (!isRecordRef(input.reason, 200)) {
    return {
      ok: false,
      error: "worker memory session termination reason must be 1–200 characters",
      store,
    };
  }
  if (registered.state === "terminated") {
    return {
      ok: false,
      error: `worker memory session "${sessionId}" is already terminated — no resurrection`,
      store,
    };
  }
  const terminated: WorkerMemorySession = Object.freeze({
    ...registered,
    state: "terminated",
    terminatedAt: input.terminatedAt,
    terminationReason: input.reason,
  });
  const storeWithTerminated: MemoryTierStore = {
    ...store,
    workerSessions: store.workerSessions.map((s) => (s.sessionId === sessionId ? terminated : s)),
  };
  const audited = auditSessionDecision(
    storeWithTerminated,
    terminated,
    "terminate",
    true,
    null,
    null,
    input.terminatedAt,
  );
  return { ok: true, store: audited, session: terminated };
}
