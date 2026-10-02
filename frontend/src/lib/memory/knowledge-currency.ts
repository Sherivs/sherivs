/**
 * CoreGrid — Knowledge freshness, invalidation & source reliability registry
 * (J-019 / V1CAP-040 / MISSION-R-71, wave 3).
 *
 * This layer COMPOSES WITH the phase-36 durable memory tier
 * (`./memory-store.ts` — which is NOT modified): every knowledge record is a
 * real `MemoryRecord` written through the memory tier's authorization-gated,
 * scope-bounded, envelope-stamped write path. On top of it this contract
 * binds a FRESHNESS CONTRACT per record, an append-only EXPLICIT
 * INVALIDATION ledger, and a per-tenant SOURCE RELIABILITY registry.
 *
 * Laws enforced structurally (E-018 invariants 25-26, G-047/G-052, ADR-005):
 * - Every knowledge record carries a freshness contract: a fresh-until
 *   instant, a revalidation requirement, and the declared source it inherits
 *   reliability from. The boundary is INCLUSIVE on the fresh side: a record
 *   is FRESH at its freshUntil instant, and STALE strictly after it — stale
 *   is never silently conflated with current (E-018 invariant 25/26: stale
 *   stays distinguishable from current on loop re-entry).
 * - Invalidation is an EXPLICIT, evidence-bearing act (who, why, evidence
 *   ref, when). Invalidated records are NEVER deleted — records stay, marked
 *   invalid (ADR-005 retention-vs-immutable-audit: append-only, tombstone,
 *   no destructive erasure). An invalidated record can never re-enter
 *   Observation as current, regardless of its freshness window.
 * - Staleness is surfaced, never silent: retrieval partitions results into
 *   `current` (fresh, not invalidated) and `stale` (past freshUntil, NOT
 *   invalidated, explicitly marked with its stale-since instant). No path
 *   returns a stale record inside `current`.
 * - Source reliability: sources declare a reliability tier WITH evidence
 *   provenance; records inherit their source's tier at registration. A
 *   source's reliability DOWNGRADE is itself an evidence-bearing act (who,
 *   why, evidence ref, from→to tier) and PROPAGATES: records from that
 *   source become flagged (effective tier below the tier they were
 *   registered with) and retrieval can filter by a minimum tier. Downgrades
 *   only — this layer never silently raises trust.
 * - Tenant isolation: every registry entry, contract, invalidation and
 *   downgrade act carries a tenant, and every cross-tenant act is rejected
 *   (memory tier + envelope law defense-in-depth).
 *
 * Boundary: pure data + pure functions over the composed memory tier. No
 * persistence, no I/O, no vendor, no wall-clock sampling — time is always
 * supplied. Authorization to READ/WRITE the underlying memory records remains
 * the memory tier's job (`retrieveMemory`/`writeMemoryRecord`); this layer
 * adds currency over records that already exist there.
 */

import {
  MEMORY_RECORD_OBJECT_TYPE,
  createMemoryTierStore,
  type MemoryRecord,
  type MemoryTierStore,
} from "./memory-store";
import { isTimestamp } from "../kernel/reality";

/* ─────────────────────────────────────────────────────────────
 * Vocabularies
 * ────────────────────────────────────────────────────────────*/

/**
 * Source reliability tiers (G-047/G-052 posture). Rank order is the
 * minimum-tier comparison retrieval enforces: a record is only filtered OUT
 * when its effective tier rank is strictly below the requested minimum.
 */
export type SourceReliabilityTier =
  | "authoritative"
  | "verified"
  | "provisional"
  | "unverified";

export const SOURCE_RELIABILITY_TIERS: readonly SourceReliabilityTier[] = [
  "authoritative",
  "verified",
  "provisional",
  "unverified",
] as const;

const TIER_RANK: Record<SourceReliabilityTier, 0 | 1 | 2 | 3> = {
  authoritative: 3,
  verified: 2,
  provisional: 1,
  unverified: 0,
};

/**
 * The revalidation duty declared with the freshness contract. Surfaced on
 * every retrieval view — a `before_use` record must not be consumed as
 * current without revalidation; a `periodic` record carries its interval.
 */
export type RevalidationRequirement = "none" | "before_use" | "periodic";

export const REVALIDATION_REQUIREMENTS: readonly RevalidationRequirement[] = [
  "none",
  "before_use",
  "periodic",
] as const;

/**
 * Currency status of a knowledge record at an instant. Three states, never
 * collapsed: EXPLICITLY invalidated (act-recorded), STALE (past freshUntil),
 * CURRENT (fresh and not invalidated).
 */
export type KnowledgeCurrencyStatus = "current" | "stale" | "invalidated";

/** Mirrors the memory tier's ref grammar (1–bound characters, trimmed). */
function isRef(value: unknown, maxLength: number): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= maxLength;
}

function isPositiveSeconds(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value > 0
  );
}

/* ─────────────────────────────────────────────────────────────
 * Source reliability registry
 * ────────────────────────────────────────────────────────────*/

/**
 * A declared knowledge source. The tier is declared WITH evidence
 * provenance — a tier is a claim, and the claim carries its evidence.
 */
export interface SourceDeclaration {
  sourceId: string;
  tenantId: string;
  /** Reliability tier at declaration time (downgrades move it, never up). */
  tier: SourceReliabilityTier;
  /** Human/agent-readable description of what the source is. */
  description: string;
  /** Evidence provenance for the declared tier (evidence record/ref id). */
  evidenceRef: string | null;
  declaredBy: string;
  declaredAt: string;
}

/**
 * An evidence-bearing reliability DOWNGRADE act. Records from the source
 * become flagged the moment this act is appended; retrieval can filter by
 * minimum tier. There is no silent or upward movement of trust through this
 * contract.
 */
export interface ReliabilityDowngradeAct {
  downgradeId: string;
  sourceId: string;
  /** Must equal the source's tenant — downgrades never cross tenants. */
  tenantId: string;
  fromTier: SourceReliabilityTier;
  /** Strictly lower than the source's CURRENT tier at act time. */
  toTier: SourceReliabilityTier;
  downgradedBy: string;
  /** Why the downgrade happened (required — nothing downgrades silently). */
  reason: string;
  /** Evidence ref backing the downgrade decision (required). */
  evidenceRef: string;
  downgradedAt: string;
}

/* ─────────────────────────────────────────────────────────────
 * Freshness contracts (per knowledge record)
 * ────────────────────────────────────────────────────────────*/

/**
 * The freshness contract bound to one knowledge record (a real
 * `MemoryRecord` from the memory tier). `freshUntil` is the INCLUSIVE fresh
 * boundary: fresh at the instant itself, stale strictly after.
 */
export interface FreshnessContract {
  recordId: string;
  tenantId: string;
  /** The declared source the record inherits reliability tier from. */
  sourceId: string;
  /** Fresh-until instant (inclusive): fresh at it, stale strictly after. */
  freshUntil: string;
  revalidation: RevalidationRequirement;
  /** Required positive integer when revalidation is "periodic"; else null. */
  revalidateAfterSeconds: number | null;
  registeredAt: string;
  /** The source tier the record inherited at registration (for flagging). */
  tierAtRegistration: SourceReliabilityTier;
}

export interface KnowledgeRecordRegistration {
  /** The REAL memory record (already written through the memory tier). */
  record: MemoryRecord;
  sourceId: string;
  freshUntil: string;
  revalidation: RevalidationRequirement;
  revalidateAfterSeconds?: number | null;
  registeredAt: string;
}

/* ─────────────────────────────────────────────────────────────
 * Invalidation acts (explicit; records stay, marked invalid)
 * ────────────────────────────────────────────────────────────*/

/**
 * An explicit invalidation of one knowledge record. Per ADR-005 the record
 * is NEVER deleted: it stays in the memory tier, marked invalid through this
 * appended act. Who, why, evidence ref, when — all required.
 */
export interface InvalidationAct {
  invalidationId: string;
  recordId: string;
  /** Must equal the record's tenant — invalidation never crosses tenants. */
  tenantId: string;
  invalidatedBy: string;
  /** Why the knowledge is invalidated (required — nothing drops silently). */
  reason: string;
  /** Evidence ref backing the invalidation decision (required). */
  evidenceRef: string;
  invalidatedAt: string;
}

/* ─────────────────────────────────────────────────────────────
 * Store (composes the memory tier — never mutates its records)
 * ────────────────────────────────────────────────────────────*/

export interface KnowledgeCurrencyStore {
  /** The underlying memory tier; its records are the knowledge substrate. */
  readonly memory: MemoryTierStore;
  readonly sources: readonly SourceDeclaration[];
  readonly contracts: readonly FreshnessContract[];
  readonly invalidations: readonly InvalidationAct[];
  readonly downgrades: readonly ReliabilityDowngradeAct[];
}

export function createKnowledgeCurrencyStore(
  memory: MemoryTierStore = createMemoryTierStore(),
): KnowledgeCurrencyStore {
  return {
    memory,
    sources: [],
    contracts: [],
    invalidations: [],
    downgrades: [],
  };
}

/* ─────────────────────────────────────────────────────────────
 * Source registry writes
 * ────────────────────────────────────────────────────────────*/

export type KnowledgeSourceDeclareResult =
  | { ok: true; store: KnowledgeCurrencyStore; source: SourceDeclaration }
  | { ok: false; error: string };

/** Fails closed on: missing ids/tenant/description, unknown tier, duplicate sourceId, bad timestamps. */
export function declareSource(
  store: KnowledgeCurrencyStore,
  source: SourceDeclaration,
): KnowledgeSourceDeclareResult {
  if (!isRef(source.sourceId, 160)) {
    return { ok: false, error: "source sourceId must be 1–160 characters" };
  }
  if (!isRef(source.tenantId, 128)) {
    return { ok: false, error: "source tenantId must be 1–128 characters" };
  }
  if (!(SOURCE_RELIABILITY_TIERS as readonly unknown[]).includes(source.tier)) {
    return {
      ok: false,
      error: `source tier "${String(source.tier)}" is not a registered reliability tier`,
    };
  }
  if (!isRef(source.description, 500)) {
    return { ok: false, error: "source description must be 1–500 characters" };
  }
  if (source.evidenceRef != null && !isRef(source.evidenceRef, 200)) {
    return {
      ok: false,
      error: "source evidenceRef must be 1–200 characters when present",
    };
  }
  if (!isRef(source.declaredBy, 160)) {
    return { ok: false, error: "source declaredBy must be 1–160 characters" };
  }
  if (!isTimestamp(source.declaredAt)) {
    return { ok: false, error: "source declaredAt must be an ISO-8601 timestamp" };
  }
  if (store.sources.some((existing) => existing.sourceId === source.sourceId)) {
    return {
      ok: false,
      error: `source "${source.sourceId}" is already declared`,
    };
  }
  const declared: SourceDeclaration = { ...source };
  return { ok: true, store: { ...store, sources: [...store.sources, declared] }, source: declared };
}

export type KnowledgeDowngradeResult =
  | { ok: true; store: KnowledgeCurrencyStore; act: ReliabilityDowngradeAct }
  | { ok: false; error: string };

/**
 * Append an evidence-bearing reliability downgrade for one source. Fails
 * closed on: unknown source, cross-tenant act, unknown tier, a target tier
 * not strictly below the source's CURRENT tier (no silent upgrade / no-op),
 * duplicate downgradeId, missing reason or evidence ref, bad timestamps.
 * Propagation is structural: records inherit the source's CURRENT tier at
 * query time, so every record from this source is flagged and filterable
 * the moment the act lands.
 */
export function downgradeSourceReliability(
  store: KnowledgeCurrencyStore,
  act: ReliabilityDowngradeAct,
): KnowledgeDowngradeResult {
  if (!isRef(act.downgradeId, 160)) {
    return { ok: false, error: "downgrade downgradeId must be 1–160 characters" };
  }
  if (store.downgrades.some((existing) => existing.downgradeId === act.downgradeId)) {
    return {
      ok: false,
      error: `downgrade "${act.downgradeId}" is already recorded`,
    };
  }
  if (!isRef(act.sourceId, 160)) {
    return { ok: false, error: "downgrade sourceId must be 1–160 characters" };
  }
  const source = store.sources.find((s) => s.sourceId === act.sourceId);
  if (source == null) {
    return {
      ok: false,
      error: `downgrade source "${act.sourceId}" is not declared — no silent reliability movement`,
    };
  }
  if (act.tenantId !== source.tenantId) {
    return {
      ok: false,
      error: `downgrade is cross-tenant: source "${source.sourceId}" is bound to tenant "${source.tenantId}", act declared tenant "${act.tenantId}"`,
    };
  }
  if (!(SOURCE_RELIABILITY_TIERS as readonly unknown[]).includes(act.toTier)) {
    return {
      ok: false,
      error: `downgrade tier "${String(act.toTier)}" is not a registered reliability tier`,
    };
  }
  if (TIER_RANK[act.toTier] >= TIER_RANK[source.tier]) {
    return {
      ok: false,
      error: `downgrade target tier "${act.toTier}" must be strictly below the source's current tier "${source.tier}" — trust never rises silently through this contract`,
    };
  }
  if (!isRef(act.downgradedBy, 160)) {
    return { ok: false, error: "downgrade downgradedBy must be 1–160 characters" };
  }
  if (!isRef(act.reason, 500)) {
    return { ok: false, error: "downgrade reason must be 1–500 characters" };
  }
  if (!isRef(act.evidenceRef, 200)) {
    return {
      ok: false,
      error: "downgrade evidenceRef is required (1–200 characters) — the act is evidence-bearing",
    };
  }
  if (!isTimestamp(act.downgradedAt)) {
    return { ok: false, error: "downgrade downgradedAt must be an ISO-8601 timestamp" };
  }
  const fromTier = source.tier;
  const recorded: ReliabilityDowngradeAct = { ...act, fromTier };
  const sources = store.sources.map((s) =>
    s.sourceId === source.sourceId ? { ...s, tier: act.toTier } : s,
  );
  return {
    ok: true,
    store: { ...store, sources, downgrades: [...store.downgrades, recorded] },
    act: recorded,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Knowledge record registration (freshness contract binding)
 * ────────────────────────────────────────────────────────────*/

export type KnowledgeRegisterResult =
  | { ok: true; store: KnowledgeCurrencyStore; contract: FreshnessContract }
  | { ok: false; error: string };

/**
 * Bind a freshness contract to a REAL memory record. Fails closed on: a
 * record that does not exist in the composed memory tier (currency composes,
 * it does not invent records), a record whose envelope is not the memory
 * substrate's type, a cross-tenant source, an unknown source, a duplicate
 * contract for the record, a missing/malformed freshUntil or registeredAt,
 * an unknown revalidation requirement, or a periodic requirement without a
 * positive integer interval.
 */
export function registerKnowledgeRecord(
  store: KnowledgeCurrencyStore,
  registration: KnowledgeRecordRegistration,
): KnowledgeRegisterResult {
  const record = registration.record;
  if (record == null || !isRef(record?.id, 160)) {
    return { ok: false, error: "knowledge registration requires a record id (1–160 characters)" };
  }
  if (store.contracts.some((existing) => existing.recordId === record.id)) {
    return {
      ok: false,
      error: `knowledge record "${record.id}" already carries a freshness contract`,
    };
  }
  const memoryRecord = store.memory.records.find((r) => r.id === record.id);
  if (memoryRecord == null) {
    return {
      ok: false,
      error: `knowledge record "${record.id}" does not exist in the memory tier — currency composes with memory, it never invents records`,
    };
  }
  if (record.tenantId !== memoryRecord.tenantId) {
    return {
      ok: false,
      error: `knowledge registration is cross-tenant: record "${record.id}" is bound to tenant "${memoryRecord.tenantId}", registration declared tenant "${record.tenantId}"`,
    };
  }
  if (record.envelope.object_type !== MEMORY_RECORD_OBJECT_TYPE) {
    return {
      ok: false,
      error: `knowledge record envelope object_type must be "${MEMORY_RECORD_OBJECT_TYPE}", got "${record.envelope.object_type}"`,
    };
  }
  if (!isRef(registration.sourceId, 160)) {
    return { ok: false, error: "knowledge registration sourceId must be 1–160 characters" };
  }
  const source = store.sources.find((s) => s.sourceId === registration.sourceId);
  if (source == null) {
    return {
      ok: false,
      error: `knowledge registration source "${registration.sourceId}" is not declared — records inherit tier from a DECLARED source only`,
    };
  }
  if (source.tenantId !== memoryRecord.tenantId) {
    return {
      ok: false,
      error: `knowledge registration is cross-tenant: source "${source.sourceId}" is bound to tenant "${source.tenantId}", record tenant is "${memoryRecord.tenantId}"`,
    };
  }
  if (!isTimestamp(registration.freshUntil)) {
    return { ok: false, error: "freshness contract freshUntil must be an ISO-8601 timestamp" };
  }
  if (!(REVALIDATION_REQUIREMENTS as readonly unknown[]).includes(registration.revalidation)) {
    return {
      ok: false,
      error: `revalidation requirement "${String(registration.revalidation)}" is not a registered revalidation requirement`,
    };
  }
  const revalidateAfterSeconds = registration.revalidateAfterSeconds ?? null;
  if (registration.revalidation === "periodic" && !isPositiveSeconds(revalidateAfterSeconds)) {
    return {
      ok: false,
      error: 'a "periodic" revalidation requirement requires a positive integer revalidateAfterSeconds',
    };
  }
  if (registration.revalidation !== "periodic" && revalidateAfterSeconds != null) {
    return {
      ok: false,
      error: 'revalidateAfterSeconds applies only to the "periodic" revalidation requirement',
    };
  }
  if (!isTimestamp(registration.registeredAt)) {
    return { ok: false, error: "knowledge registration registeredAt must be an ISO-8601 timestamp" };
  }

  const contract: FreshnessContract = {
    recordId: memoryRecord.id,
    tenantId: memoryRecord.tenantId,
    sourceId: source.sourceId,
    freshUntil: registration.freshUntil.trim(),
    revalidation: registration.revalidation,
    revalidateAfterSeconds,
    registeredAt: registration.registeredAt.trim(),
    tierAtRegistration: source.tier,
  };
  return {
    ok: true,
    store: { ...store, contracts: [...store.contracts, contract] },
    contract,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Explicit invalidation (append-only; records stay, marked invalid)
 * ────────────────────────────────────────────────────────────*/

export type KnowledgeInvalidateResult =
  | { ok: true; store: KnowledgeCurrencyStore; act: InvalidationAct }
  | { ok: false; error: string };

/**
 * Explicitly invalidate one knowledge record. The record is NEVER deleted —
 * it stays in the memory tier and in this layer's contract set, marked
 * invalid by the appended act; invalidated knowledge can never re-enter
 * Observation as current. Fails closed on: unknown record (no contract),
 * cross-tenant act, duplicate invalidationId, an already-invalidated record,
 * missing who/why/evidence, bad timestamps.
 */
export function invalidateKnowledge(
  store: KnowledgeCurrencyStore,
  act: InvalidationAct,
): KnowledgeInvalidateResult {
  if (!isRef(act.invalidationId, 160)) {
    return { ok: false, error: "invalidation invalidationId must be 1–160 characters" };
  }
  if (store.invalidations.some((existing) => existing.invalidationId === act.invalidationId)) {
    return {
      ok: false,
      error: `invalidation "${act.invalidationId}" is already recorded`,
    };
  }
  if (!isRef(act.recordId, 160)) {
    return { ok: false, error: "invalidation recordId must be 1–160 characters" };
  }
  const contract = store.contracts.find((c) => c.recordId === act.recordId);
  if (contract == null) {
    return {
      ok: false,
      error: `invalidation target "${act.recordId}" carries no freshness contract — only registered knowledge can be invalidated`,
    };
  }
  if (act.tenantId !== contract.tenantId) {
    return {
      ok: false,
      error: `invalidation is cross-tenant: record "${act.recordId}" is bound to tenant "${contract.tenantId}", act declared tenant "${act.tenantId}"`,
    };
  }
  if (store.invalidations.some((existing) => existing.recordId === act.recordId)) {
    return {
      ok: false,
      error: `knowledge record "${act.recordId}" is already invalidated — the existing act stands (append-only)`,
    };
  }
  if (store.memory.records.find((r) => r.id === act.recordId) == null) {
    return {
      ok: false,
      error: `invalidation target "${act.recordId}" no longer exists in the memory tier — records are never deleted, so this is a store-integrity violation`,
    };
  }
  if (!isRef(act.invalidatedBy, 160)) {
    return { ok: false, error: "invalidation invalidatedBy must be 1–160 characters" };
  }
  if (!isRef(act.reason, 500)) {
    return { ok: false, error: "invalidation reason must be 1–500 characters" };
  }
  if (!isRef(act.evidenceRef, 200)) {
    return {
      ok: false,
      error: "invalidation evidenceRef is required (1–200 characters) — the act is evidence-bearing",
    };
  }
  if (!isTimestamp(act.invalidatedAt)) {
    return { ok: false, error: "invalidation invalidatedAt must be an ISO-8601 timestamp" };
  }
  const recorded: InvalidationAct = { ...act };
  return {
    ok: true,
    store: { ...store, invalidations: [...store.invalidations, recorded] },
    act: recorded,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Currency + reliability reads
 * ────────────────────────────────────────────────────────────*/

/**
 * Current reliability of a declared source, or null when undeclared.
 */
export function sourceEffectiveTier(
  store: KnowledgeCurrencyStore,
  sourceId: string,
): SourceReliabilityTier | null {
  return store.sources.find((s) => s.sourceId === sourceId)?.tier ?? null;
}

export interface RecordReliability {
  recordId: string;
  sourceId: string;
  /** The source's CURRENT tier (post-downgrades) — what the record inherits. */
  effectiveTier: SourceReliabilityTier;
  /** True when a downgrade act landed after the record was registered. */
  flagged: boolean;
  tierAtRegistration: SourceReliabilityTier;
}

/**
 * Reliability view of one registered knowledge record: the source's current
 * tier, plus a flag when that tier has been DOWNGRADED below the tier the
 * record was registered with (the propagation surface).
 */
export function recordReliability(
  store: KnowledgeCurrencyStore,
  recordId: string,
): RecordReliability | null {
  const contract = store.contracts.find((c) => c.recordId === recordId);
  if (contract == null) return null;
  const source = store.sources.find((s) => s.sourceId === contract.sourceId);
  const effectiveTier = source?.tier ?? null;
  if (effectiveTier == null) return null;
  return {
    recordId,
    sourceId: contract.sourceId,
    effectiveTier,
    flagged: TIER_RANK[effectiveTier] < TIER_RANK[contract.tierAtRegistration],
    tierAtRegistration: contract.tierAtRegistration,
  };
}

/**
 * Currency status of one registered knowledge record at instant `at`.
 * Order of resolution: an explicit invalidation act WINS over the freshness
 * window (invalidated stays invalidated forever); otherwise the INCLUSIVE
 * freshness boundary decides — fresh at `freshUntil` itself, stale strictly
 * after. Returns null when the record carries no contract.
 */
export function knowledgeCurrencyStatus(
  store: KnowledgeCurrencyStore,
  recordId: string,
  at: string,
): KnowledgeCurrencyStatus | null {
  if (!isTimestamp(at)) return null;
  const contract = store.contracts.find((c) => c.recordId === recordId);
  if (contract == null) return null;
  if (store.invalidations.some((existing) => existing.recordId === recordId)) {
    return "invalidated";
  }
  return Date.parse(at) <= Date.parse(contract.freshUntil) ? "current" : "stale";
}

/* ─────────────────────────────────────────────────────────────
 * Retrieval — currency-partitioned, tier-filtered, staleness surfaced
 * ────────────────────────────────────────────────────────────*/

export interface KnowledgeRetrievalRequest {
  /** REQUIRED — a retrieval without a tenant is denied before any record is evaluated. */
  tenantId: string;
  purpose: string;
  /** Minimum reliability tier (inclusive): records below it are excluded, listed, never silent. */
  minTier?: SourceReliabilityTier;
}

export interface KnowledgeRetrievalConfig {
  /** Retrieval instant (ISO-8601). Required for purity. */
  now: string;
}

/** One surfaced knowledge record with its currency and reliability markings. */
export interface KnowledgeViewRecord {
  readonly record: MemoryRecord;
  readonly status: "current" | "stale";
  /** The instant the record went stale (its freshUntil); null while current. */
  readonly staleSince: string | null;
  readonly contract: FreshnessContract;
  /** The source's CURRENT tier — the tier the record inherits right now. */
  readonly reliabilityTier: SourceReliabilityTier;
  /** True when the source was downgraded below the registration-time tier. */
  readonly reliabilityFlagged: boolean;
}

/** An invalidated record surfaced by retrieval — never served, never silent. */
export interface InvalidatedKnowledgeSurface {
  readonly recordId: string;
  readonly invalidatedAt: string;
  readonly invalidatedBy: string;
  readonly reason: string;
  readonly evidenceRef: string;
}

/** A tier-filtered record surfaced by retrieval — withheld, never silent. */
export interface TierExcludedKnowledgeSurface {
  readonly recordId: string;
  readonly status: KnowledgeCurrencyStatus;
  readonly effectiveTier: SourceReliabilityTier;
  readonly minimumTier: SourceReliabilityTier;
}

export type KnowledgeRetrievalResult =
  | {
      ok: true;
      tenantId: string;
      at: string;
      purpose: string;
      minTier: SourceReliabilityTier | null;
      /** Fresh, not invalidated — the ONLY list safe to serve as current. */
      current: readonly KnowledgeViewRecord[];
      /** Past freshUntil, NOT invalidated — explicitly marked stale, never merged into current. */
      stale: readonly KnowledgeViewRecord[];
      invalidated: readonly InvalidatedKnowledgeSurface[];
      excludedByTier: readonly TierExcludedKnowledgeSurface[];
    }
  | {
      ok: false;
      outcome: "denied";
      tenantId: string | null;
      denialReason: string;
      current: [];
      stale: [];
      invalidated: [];
      excludedByTier: [];
    };

/**
 * Currency-aware retrieval over registered knowledge records of ONE tenant.
 * Fail-closed on: a missing/empty tenant, a non-timestamp `now`, or an
 * unknown minimum tier. Partitioning is deterministic and explicit:
 * invalidated records are surfaced with their act (never served, never
 * deleted); stale records are surfaced with their stale-since marking (never
 * served inside `current` — E-018 invariants 25-26); tier-excluded records
 * are listed with the tier that excluded them.
 */
export function retrieveKnowledge(
  store: KnowledgeCurrencyStore,
  request: KnowledgeRetrievalRequest,
  config: KnowledgeRetrievalConfig,
): KnowledgeRetrievalResult {
  const denied = (tenantId: string | null, denialReason: string): KnowledgeRetrievalResult => ({
    ok: false,
    outcome: "denied",
    tenantId,
    denialReason,
    current: [],
    stale: [],
    invalidated: [],
    excludedByTier: [],
  });

  if (!isRef(request.tenantId, 128)) {
    return denied(null, "Retrieval denied: no tenant — fail-closed (J-019)");
  }
  if (!isTimestamp(config.now)) {
    return denied(request.tenantId, "Retrieval config `now` is not a valid ISO-8601 timestamp");
  }
  const minTier = request.minTier ?? null;
  if (minTier != null && !(SOURCE_RELIABILITY_TIERS as readonly unknown[]).includes(minTier)) {
    return denied(request.tenantId, `minimum tier "${String(minTier)}" is not a registered reliability tier`);
  }

  const nowMs = Date.parse(config.now);
  const current: KnowledgeViewRecord[] = [];
  const stale: KnowledgeViewRecord[] = [];
  const invalidated: InvalidatedKnowledgeSurface[] = [];
  const excludedByTier: TierExcludedKnowledgeSurface[] = [];

  const invalidationByRecord = new Map<string, InvalidationAct>();
  for (const act of store.invalidations) invalidationByRecord.set(act.recordId, act);

  for (const contract of store.contracts) {
    if (contract.tenantId !== request.tenantId) continue;

    const record = store.memory.records.find((r) => r.id === contract.recordId);
    if (record == null) continue; // store-integrity invariant; invalidateKnowledge rejects vanished records

    const source = store.sources.find((s) => s.sourceId === contract.sourceId);
    if (source == null) continue; // contract binding guarantees a declared source

    const invalidation = invalidationByRecord.get(contract.recordId);
    if (invalidation != null) {
      invalidated.push({
        recordId: contract.recordId,
        invalidatedAt: invalidation.invalidatedAt,
        invalidatedBy: invalidation.invalidatedBy,
        reason: invalidation.reason,
        evidenceRef: invalidation.evidenceRef,
      });
      continue;
    }

    const reliabilityTier = source.tier;
    const reliabilityFlagged = TIER_RANK[reliabilityTier] < TIER_RANK[contract.tierAtRegistration];
    const isStale = nowMs > Date.parse(contract.freshUntil);
    const status: "current" | "stale" = isStale ? "stale" : "current";
    const view: KnowledgeViewRecord = {
      record,
      status,
      staleSince: isStale ? contract.freshUntil : null,
      contract,
      reliabilityTier,
      reliabilityFlagged,
    };

    if (minTier != null && TIER_RANK[reliabilityTier] < TIER_RANK[minTier]) {
      excludedByTier.push({
        recordId: contract.recordId,
        status,
        effectiveTier: reliabilityTier,
        minimumTier: minTier,
      });
      continue;
    }

    if (isStale) stale.push(view);
    else current.push(view);
  }

  return {
    ok: true,
    tenantId: request.tenantId,
    at: config.now.trim(),
    purpose: request.purpose,
    minTier,
    current,
    stale,
    invalidated,
    excludedByTier,
  };
}