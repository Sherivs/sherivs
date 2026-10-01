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
 */

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
  | "item_budget";

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
}

export function createMemoryTierStore(): MemoryTierStore {
  return { scopes: [], records: [], accessLog: [] };
}

export type MemoryScopeDeclareResult =
  | { ok: true; store: MemoryTierStore }
  | { ok: false; error: string };

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
  | { ok: true; store: MemoryTierStore; record: MemoryRecord }
  | { ok: false; error: string };

/**
 * Write one memory record through a declared scope. REJECTS (never clamps):
 * an unknown scope, a cross-tenant write, an actor outside the scope's
 * actorScope, a mission mismatch, a domain outside the scope's domains, a
 * sensitivity above the scope's ceiling, an unstamped envelope, an unknown
 * object type for this substrate, non-explicit bi-temporal validity, a
 * dangling or cross-tenant `supersedes` pointer, or a duplicate record id.
 * This is the J-017/E-027 no-silent-memory-expansion guard on the write path.
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
  const supersededIds = new Set(
    store.records
      .filter((r) => r.tenantId === request.tenantId && r.biTemporal.supersedes != null)
      .map((r) => r.biTemporal.supersedes as string),
  );
  const returned: MemoryRecord[] = [];
  for (const record of candidates) {
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
