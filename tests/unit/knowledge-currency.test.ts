/**
 * MISSION-R-71 / J-019 (V1CAP-040) — knowledge freshness, invalidation &
 * source reliability registry, composed over the phase-36 memory tier.
 *
 * Proves, at unit level, that:
 *  1. freshness boundaries are exact: a record is CURRENT at its freshUntil
 *     instant (inclusive) and STALE strictly after it (exclusive) — E-018
 *     invariants 25-26: stale stays distinguishable from current;
 *  2. invalidation is an explicit, evidence-bearing act (who, why, evidence
 *     ref) and records are NEVER deleted — the memory record and its
 *     freshness contract survive the act (ADR-005 append-only posture);
 *  3. invalidated knowledge can never re-enter Observation as current, even
 *     while its freshness window is still open (T1 evidence);
 *  4. staleness is SURFACED, never silent: retrieval partitions stale
 *     records with their stale-since marking and never serves them inside
 *     `current` (T2 evidence: stale record served only with stale marking);
 *  5. source reliability propagates on downgrade: records from a downgraded
 *     source become flagged with the source's current tier, the downgrade
 *     act is evidence-bearing, and trust never rises silently;
 *  6. retrieval filters by minimum tier, listing excluded records instead of
 *     silently dropping them;
 *  7. cross-tenant isolation holds across registration, invalidation,
 *     downgrade, and retrieval;
 *  8. the layer composes with real memory-store types + envelope: records
 *     written through `writeMemoryRecord` register cleanly, records absent
 *     from the memory tier or stamped with a foreign object_type are
 *     rejected.
 */

import { describe, expect, it } from "vitest";
import {
  declareMemoryScope,
  createMemoryTierStore,
  writeMemoryRecord,
  type MemoryRecord,
  type MemoryTierStore,
  type MemoryWriteRequest,
} from "@/lib/memory/memory-store";
import {
  REVALIDATION_REQUIREMENTS,
  SOURCE_RELIABILITY_TIERS,
  createKnowledgeCurrencyStore,
  declareSource,
  downgradeSourceReliability,
  invalidateKnowledge,
  knowledgeCurrencyStatus,
  recordReliability,
  registerKnowledgeRecord,
  retrieveKnowledge,
  sourceEffectiveTier,
  type KnowledgeCurrencyStore,
} from "@/lib/memory/knowledge-currency";

const TENANT_A = "tenant-alpha";
const TENANT_B = "tenant-beta";
const ACTOR_A = "01970000-0000-7000-8000-0000000000a1";
const ACTOR_B = "01970000-0000-7000-8000-0000000000b1";
const SCOPE_A = "scope:alpha:field-ops";
const SCOPE_B = "scope:beta:field-ops";
const NOW = "2026-10-01T12:00:00Z";
const FRESH_UNTIL = "2026-10-02T12:00:00Z";
const SOURCE_A = "source:alpha:gazette";
const SOURCE_B = "source:beta:gazette";

function scopeA() {
  return {
    scopeId: SCOPE_A,
    tenantId: TENANT_A,
    missionRef: "mission:MISSION-R-71" as string | null,
    actorScope: [ACTOR_A],
    domains: ["field-ops"],
    maxSensitivity: "internal" as const,
  };
}

function envelopeInput(overrides?: Record<string, unknown>) {
  return {
    objectType: "memory_record",
    schemaVersion: "1.0",
    status: "active" as const,
    createdBy: ACTOR_A,
    updatedBy: ACTOR_A,
    provenance: { source: "workforce:field-agent", originTenantId: TENANT_A, verified: false },
    policyContext: { purpose: "field-operations" },
    traceId: "trace:knowledge-1",
    correlationId: "corr:knowledge-1",
    declaredOrigin: "mission:MISSION-R-71",
    ...overrides,
  };
}

function writeRequest(overrides?: Partial<MemoryWriteRequest>): MemoryWriteRequest {
  return {
    recordId: "mem:alpha:001",
    scopeId: SCOPE_A,
    identityRef: ACTOR_A,
    tenantId: TENANT_A,
    missionRef: "mission:MISSION-R-71",
    memoryClass: "practical",
    domain: "field-ops",
    content: "Route B is closed for maintenance until Friday",
    sensitivity: "internal",
    requiredPermission: null,
    freshnessAt: NOW,
    recordedAt: NOW,
    biTemporal: { validFrom: NOW },
    envelope: envelopeInput(),
    ...overrides,
  };
}

/** A memory-tier store with both tenants' scopes declared. */
function memoryStoreWithScopes(): MemoryTierStore {
  const base = createMemoryTierStore();
  const withA = declareMemoryScope(base, scopeA());
  if (!withA.ok) throw new Error(withA.error);
  const withB = declareMemoryScope(withA.store, {
    scopeId: SCOPE_B,
    tenantId: TENANT_B,
    missionRef: null,
    actorScope: [ACTOR_B],
    domains: ["field-ops"],
    maxSensitivity: "internal",
  });
  if (!withB.ok) throw new Error(withB.error);
  return withB.store;
}

/**
 * Write one record through the REAL memory-tier write path, threading the
 * returned store forward — the updated memory tier is the one the currency
 * layer must compose with.
 */
function writeInto(
  memory: MemoryTierStore,
  overrides?: Partial<MemoryWriteRequest>,
): { memory: MemoryTierStore; record: MemoryRecord } {
  const result = writeMemoryRecord(memory, writeRequest(overrides));
  if (!result.ok) throw new Error(`fixture memory record rejected: ${result.error}`);
  return { memory: result.store, record: result.record };
}

function betaRecordOverrides(): Partial<MemoryWriteRequest> {
  return {
    recordId: "mem:beta:001",
    scopeId: SCOPE_B,
    identityRef: ACTOR_B,
    tenantId: TENANT_B,
    missionRef: null,
    envelope: envelopeInput({ provenance: { source: "beta", originTenantId: TENANT_B } }),
  };
}

function sourceA(overrides?: Record<string, unknown>) {
  return {
    sourceId: SOURCE_A,
    tenantId: TENANT_A,
    tier: "verified" as const,
    description: "Alpha field-operations gazette",
    evidenceRef: "ev:alpha:gazette-tier",
    declaredBy: ACTOR_A,
    declaredAt: NOW,
    ...overrides,
  };
}

/** Currency store over a memory tier holding one tenant-A record. */
function currencyWithRecord(overrides?: Partial<MemoryWriteRequest>): {
  currency: KnowledgeCurrencyStore;
  memory: MemoryTierStore;
  record: MemoryRecord;
} {
  const written = writeInto(memoryStoreWithScopes(), overrides);
  return {
    currency: createKnowledgeCurrencyStore(written.memory),
    memory: written.memory,
    record: written.record,
  };
}

/** Currency store with the tenant-A source declared and one record registered. */
function currencyWithRegistered(
  sourceOverrides?: Record<string, unknown>,
  recordOverrides?: Partial<MemoryWriteRequest>,
  registrationOverrides?: Record<string, unknown>,
): { store: KnowledgeCurrencyStore; record: MemoryRecord } {
  const base = currencyWithRecord(recordOverrides);
  const declared = declareSource(base.currency, sourceA(sourceOverrides));
  if (!declared.ok) throw new Error(`fixture source rejected: ${declared.error}`);
  const registered = registerKnowledgeRecord(declared.store, {
    record: base.record,
    sourceId: SOURCE_A,
    freshUntil: FRESH_UNTIL,
    revalidation: "before_use",
    registeredAt: NOW,
    ...registrationOverrides,
  });
  if (!registered.ok) throw new Error(`fixture registration rejected: ${registered.error}`);
  return { store: registered.store, record: base.record };
}

/**
 * Register tenant B's own source + record into an existing currency store,
 * threading the memory tier forward through both the write and the binding.
 */
function registerBeta(
  store: KnowledgeCurrencyStore,
  overrides?: Partial<MemoryWriteRequest>,
): { store: KnowledgeCurrencyStore; record: MemoryRecord } {
  const declared = declareSource(store, {
    sourceId: SOURCE_B,
    tenantId: TENANT_B,
    tier: "verified" as const,
    description: "Beta field-operations gazette",
    evidenceRef: "ev:beta:gazette-tier",
    declaredBy: ACTOR_B,
    declaredAt: NOW,
  });
  if (!declared.ok) throw new Error(`fixture beta source rejected: ${declared.error}`);
  const written = writeInto(declared.store.memory, {
    ...betaRecordOverrides(),
    ...overrides,
  });
  const registered = registerKnowledgeRecord(
    { ...declared.store, memory: written.memory },
    {
      record: written.record,
      sourceId: SOURCE_B,
      freshUntil: FRESH_UNTIL,
      revalidation: "before_use",
      registeredAt: NOW,
    },
  );
  if (!registered.ok) throw new Error(`fixture beta registration rejected: ${registered.error}`);
  return { store: registered.store, record: written.record };
}

function retrieval(overrides?: Record<string, unknown>) {
  return {
    tenantId: TENANT_A,
    purpose: "loop re-entry observation",
    ...overrides,
  };
}

/* ─────────────────────────────────────────────────────────────
 * 1. Freshness boundaries — inclusive fresh, exclusive stale
 * ────────────────────────────────────────────────────────────*/

describe("freshness boundaries (inclusive/exclusive)", () => {
  it("registers exactly the declared vocabularies", () => {
    expect([...REVALIDATION_REQUIREMENTS].sort()).toEqual(["before_use", "none", "periodic"]);
    expect([...SOURCE_RELIABILITY_TIERS].sort()).toEqual([
      "authoritative",
      "provisional",
      "unverified",
      "verified",
    ]);
  });

  it("treats a record as CURRENT exactly at its freshUntil instant (inclusive)", () => {
    const { store } = currencyWithRegistered();
    expect(knowledgeCurrencyStatus(store, "mem:alpha:001", FRESH_UNTIL)).toBe("current");
    const result = retrieveKnowledge(store, retrieval(), { now: FRESH_UNTIL });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.current.map((v) => v.record.id)).toEqual(["mem:alpha:001"]);
      expect(result.current[0]?.status).toBe("current");
      expect(result.current[0]?.staleSince).toBeNull();
      expect(result.stale).toEqual([]);
    }
  });

  it("treats a record as STALE strictly after its freshUntil instant (exclusive)", () => {
    const { store } = currencyWithRegistered();
    const after = "2026-10-02T12:00:00.001Z";
    expect(knowledgeCurrencyStatus(store, "mem:alpha:001", after)).toBe("stale");
    const result = retrieveKnowledge(store, retrieval(), { now: after });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.current).toEqual([]);
      expect(result.stale).toHaveLength(1);
      expect(result.stale[0]?.status).toBe("stale");
      expect(result.stale[0]?.staleSince).toBe(FRESH_UNTIL);
    }
  });

  it("rejects a freshness contract with a malformed freshUntil or an unknown revalidation", () => {
    const base = currencyWithRecord();
    const declared = declareSource(base.currency, sourceA());
    expect(declared.ok).toBe(true);
    if (!declared.ok) return;
    const badTime = registerKnowledgeRecord(declared.store, {
      record: base.record,
      sourceId: SOURCE_A,
      freshUntil: "not-a-timestamp",
      revalidation: "before_use",
      registeredAt: NOW,
    });
    expect(badTime.ok).toBe(false);
    if (!badTime.ok) expect(badTime.error).toContain("freshUntil must be an ISO-8601 timestamp");

    const badRevalidation = registerKnowledgeRecord(declared.store, {
      record: base.record,
      sourceId: SOURCE_A,
      freshUntil: FRESH_UNTIL,
      revalidation: "whenever" as "none",
      registeredAt: NOW,
    });
    expect(badRevalidation.ok).toBe(false);
    if (!badRevalidation.ok) {
      expect(badRevalidation.error).toContain("not a registered revalidation requirement");
    }
  });

  it("requires a positive interval for periodic revalidation and forbids it otherwise", () => {
    const base = currencyWithRecord();
    const declared = declareSource(base.currency, sourceA());
    expect(declared.ok).toBe(true);
    if (!declared.ok) return;
    const missingInterval = registerKnowledgeRecord(declared.store, {
      record: base.record,
      sourceId: SOURCE_A,
      freshUntil: FRESH_UNTIL,
      revalidation: "periodic",
      registeredAt: NOW,
    });
    expect(missingInterval.ok).toBe(false);
    if (!missingInterval.ok) expect(missingInterval.error).toContain("positive integer");

    const strayInterval = registerKnowledgeRecord(declared.store, {
      record: base.record,
      sourceId: SOURCE_A,
      freshUntil: FRESH_UNTIL,
      revalidation: "before_use",
      revalidateAfterSeconds: 3600,
      registeredAt: NOW,
    });
    expect(strayInterval.ok).toBe(false);
    if (!strayInterval.ok) expect(strayInterval.error).toContain('only to the "periodic"');
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Explicit invalidation — append-only act, no deletion
 * ────────────────────────────────────────────────────────────*/

describe("explicit invalidation flow (no deletion, ADR-005)", () => {
  it("appends an evidence-bearing act and keeps the record and contract in place", () => {
    const { store: before } = currencyWithRegistered();
    const memoryBefore = before.memory.records;
    const result = invalidateKnowledge(before, {
      invalidationId: "inv:alpha:001",
      recordId: "mem:alpha:001",
      tenantId: TENANT_A,
      invalidatedBy: ACTOR_A,
      reason: "Route reopened by public works notice",
      evidenceRef: "ev:alpha:reopening-notice",
      invalidatedAt: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.store;
    // Nothing was deleted: memory record, contract, and sources all survive.
    expect(after.memory.records).toEqual(memoryBefore);
    expect(after.contracts).toHaveLength(1);
    expect(after.sources).toHaveLength(1);
    expect(after.invalidations).toMatchObject([
      {
        invalidationId: "inv:alpha:001",
        recordId: "mem:alpha:001",
        tenantId: TENANT_A,
        invalidatedBy: ACTOR_A,
        reason: "Route reopened by public works notice",
        evidenceRef: "ev:alpha:reopening-notice",
        invalidatedAt: NOW,
      },
    ]);
  });

  it("marks the record invalid even while its freshness window is still open", () => {
    const { store } = currencyWithRegistered();
    // NOW is strictly before FRESH_UNTIL: the record is fresh, yet the
    // explicit act wins — invalidation is not a staleness side effect.
    expect(knowledgeCurrencyStatus(store, "mem:alpha:001", NOW)).toBe("current");
    const invalidated = invalidateKnowledge(store, {
      invalidationId: "inv:alpha:early",
      recordId: "mem:alpha:001",
      tenantId: TENANT_A,
      invalidatedBy: ACTOR_A,
      reason: "Source retracted the claim",
      evidenceRef: "ev:alpha:retraction",
      invalidatedAt: NOW,
    });
    expect(invalidated.ok).toBe(true);
    if (!invalidated.ok) return;
    expect(knowledgeCurrencyStatus(invalidated.store, "mem:alpha:001", NOW)).toBe("invalidated");
    expect(knowledgeCurrencyStatus(invalidated.store, "mem:alpha:001", FRESH_UNTIL)).toBe(
      "invalidated",
    );
  });

  it("never lets invalidated knowledge re-enter Observation as current (T1 evidence)", () => {
    const { store } = currencyWithRegistered();
    const invalidated = invalidateKnowledge(store, {
      invalidationId: "inv:alpha:002",
      recordId: "mem:alpha:001",
      tenantId: TENANT_A,
      invalidatedBy: ACTOR_A,
      reason: "Contradicted by direct observation",
      evidenceRef: "ev:alpha:contradiction",
      invalidatedAt: NOW,
    });
    expect(invalidated.ok).toBe(true);
    if (!invalidated.ok) return;
    // Even at the freshest instant of the window, the record surfaces ONLY
    // in the invalidated partition — never inside `current`.
    const result = retrieveKnowledge(invalidated.store, retrieval(), { now: FRESH_UNTIL });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.current).toEqual([]);
      expect(result.stale).toEqual([]);
      expect(result.invalidated).toMatchObject([
        {
          recordId: "mem:alpha:001",
          invalidatedBy: ACTOR_A,
          reason: "Contradicted by direct observation",
          evidenceRef: "ev:alpha:contradiction",
        },
      ]);
    }
  });

  it("rejects a second invalidation of an already-invalidated record", () => {
    const { store } = currencyWithRegistered();
    const first = invalidateKnowledge(store, {
      invalidationId: "inv:alpha:first",
      recordId: "mem:alpha:001",
      tenantId: TENANT_A,
      invalidatedBy: ACTOR_A,
      reason: "Retracted",
      evidenceRef: "ev:alpha:retract-1",
      invalidatedAt: NOW,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = invalidateKnowledge(first.store, {
      invalidationId: "inv:alpha:second",
      recordId: "mem:alpha:001",
      tenantId: TENANT_A,
      invalidatedBy: ACTOR_A,
      reason: "Duplicate attempt",
      evidenceRef: "ev:alpha:retract-2",
      invalidatedAt: NOW,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toContain("already invalidated");
  });

  it("fails closed on a missing who, why, or evidence ref", () => {
    const { store } = currencyWithRegistered();
    const noActor = invalidateKnowledge(store, {
      invalidationId: "inv:alpha:noactor",
      recordId: "mem:alpha:001",
      tenantId: TENANT_A,
      invalidatedBy: "",
      reason: "Retracted",
      evidenceRef: "ev:alpha:retraction",
      invalidatedAt: NOW,
    });
    expect(noActor.ok).toBe(false);
    if (!noActor.ok) expect(noActor.error).toContain("invalidatedBy");

    const noReason = invalidateKnowledge(store, {
      invalidationId: "inv:alpha:noreason",
      recordId: "mem:alpha:001",
      tenantId: TENANT_A,
      invalidatedBy: ACTOR_A,
      reason: "",
      evidenceRef: "ev:alpha:retraction",
      invalidatedAt: NOW,
    });
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.error).toContain("reason");

    const noEvidence = invalidateKnowledge(store, {
      invalidationId: "inv:alpha:noevidence",
      recordId: "mem:alpha:001",
      tenantId: TENANT_A,
      invalidatedBy: ACTOR_A,
      reason: "Retracted",
      evidenceRef: "",
      invalidatedAt: NOW,
    });
    expect(noEvidence.ok).toBe(false);
    if (!noEvidence.ok) expect(noEvidence.error).toContain("evidenceRef");
  });

  it("rejects invalidating knowledge that carries no freshness contract", () => {
    const { currency } = currencyWithRecord();
    const result = invalidateKnowledge(currency, {
      invalidationId: "inv:alpha:unknown",
      recordId: "mem:alpha:001",
      tenantId: TENANT_A,
      invalidatedBy: ACTOR_A,
      reason: "Unregistered knowledge",
      evidenceRef: "ev:alpha:x",
      invalidatedAt: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("no freshness contract");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Staleness surfaced — never silently served as current
 * ────────────────────────────────────────────────────────────*/

describe("staleness surfaced (never silent, T2 evidence)", () => {
  it("partitions stale records explicitly and never returns them inside current", () => {
    const { store } = currencyWithRegistered(undefined, {
      freshnessAt: "2026-09-01T00:00:00Z",
      biTemporal: { validFrom: "2026-09-01T00:00:00Z" },
    });
    const result = retrieveKnowledge(store, retrieval(), { now: "2026-10-05T00:00:00Z" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.current).toEqual([]);
    expect(result.stale).toHaveLength(1);
    const view = result.stale[0];
    expect(view?.status).toBe("stale");
    expect(view?.staleSince).toBe(FRESH_UNTIL);
    expect(view?.record.id).toBe("mem:alpha:001");
  });

  it("keeps the stale marking on every surfaced stale record across loop re-entry", () => {
    const { store } = currencyWithRegistered();
    for (const at of ["2026-10-03T00:00:00Z", "2026-10-04T00:00:00Z", "2026-10-05T00:00:00Z"]) {
      const result = retrieveKnowledge(store, retrieval(), { now: at });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.current).toEqual([]);
      for (const view of result.stale) {
        expect(view.status).toBe("stale");
        expect(view.staleSince).toBe(FRESH_UNTIL);
      }
    }
  });

  it("denies retrieval with no tenant, before any record is evaluated", () => {
    const { store } = currencyWithRegistered();
    const result = retrieveKnowledge(store, retrieval({ tenantId: "" }), { now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.outcome).toBe("denied");
      expect(result.tenantId).toBeNull();
      expect(result.denialReason).toContain("no tenant");
      expect(result.current).toEqual([]);
    }
  });

  it("denies retrieval with a malformed `now` or an unknown minimum tier", () => {
    const { store } = currencyWithRegistered();
    const badNow = retrieveKnowledge(store, retrieval(), { now: "yesterday" });
    expect(badNow.ok).toBe(false);
    if (!badNow.ok) expect(badNow.denialReason).toContain("not a valid ISO-8601 timestamp");

    const badTier = retrieveKnowledge(store, retrieval({ minTier: "legendary" as "verified" }), {
      now: NOW,
    });
    expect(badTier.ok).toBe(false);
    if (!badTier.ok) expect(badTier.denialReason).toContain("not a registered reliability tier");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. Source reliability registry + downgrade propagation
 * ────────────────────────────────────────────────────────────*/

describe("source reliability registry and downgrade propagation", () => {
  it("records inherit their source's tier at registration", () => {
    const { store } = currencyWithRegistered();
    const reliability = recordReliability(store, "mem:alpha:001");
    expect(reliability).toMatchObject({
      recordId: "mem:alpha:001",
      sourceId: SOURCE_A,
      effectiveTier: "verified",
      flagged: false,
      tierAtRegistration: "verified",
    });
    expect(sourceEffectiveTier(store, SOURCE_A)).toBe("verified");
  });

  it("rejects registration against an undeclared or cross-tenant source", () => {
    const base = currencyWithRecord();
    const undeclared = registerKnowledgeRecord(base.currency, {
      record: base.record,
      sourceId: SOURCE_A,
      freshUntil: FRESH_UNTIL,
      revalidation: "before_use",
      registeredAt: NOW,
    });
    expect(undeclared.ok).toBe(false);
    if (!undeclared.ok) expect(undeclared.error).toContain("is not declared");

    const declared = declareSource(base.currency, sourceA());
    expect(declared.ok).toBe(true);
    if (!declared.ok) return;
    const crossTenant = registerKnowledgeRecord(declared.store, {
      record: { ...base.record, tenantId: TENANT_B },
      sourceId: SOURCE_A,
      freshUntil: FRESH_UNTIL,
      revalidation: "before_use",
      registeredAt: NOW,
    });
    expect(crossTenant.ok).toBe(false);
    if (!crossTenant.ok) expect(crossTenant.error).toContain("cross-tenant");
  });

  it("rejects a duplicate sourceId and an unknown declared tier", () => {
    const base = currencyWithRecord();
    const first = declareSource(base.currency, sourceA());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const duplicate = declareSource(first.store, sourceA());
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.error).toContain("already declared");

    const unknownTier = declareSource(
      first.store,
      sourceA({ sourceId: "source:alpha:other", tier: "oracle" as "verified" }),
    );
    expect(unknownTier.ok).toBe(false);
    if (!unknownTier.ok) expect(unknownTier.error).toContain("not a registered reliability tier");
  });

  it("propagates a downgrade: records become flagged with the source's current tier", () => {
    const { store: before } = currencyWithRegistered();
    const downgrade = downgradeSourceReliability(before, {
      downgradeId: "dg:alpha:001",
      sourceId: SOURCE_A,
      tenantId: TENANT_A,
      fromTier: "verified",
      toTier: "provisional",
      downgradedBy: ACTOR_A,
      reason: "Repeated contradictions found in the gazette",
      evidenceRef: "ev:alpha:gazette-contradictions",
      downgradedAt: NOW,
    });
    expect(downgrade.ok).toBe(true);
    if (!downgrade.ok) return;
    const after = downgrade.store;
    expect(sourceEffectiveTier(after, SOURCE_A)).toBe("provisional");
    expect(recordReliability(after, "mem:alpha:001")).toMatchObject({
      effectiveTier: "provisional",
      tierAtRegistration: "verified",
      flagged: true,
    });
    const result = retrieveKnowledge(after, retrieval(), { now: NOW });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.current[0]?.reliabilityTier).toBe("provisional");
      expect(result.current[0]?.reliabilityFlagged).toBe(true);
    }
  });

  it("records the from-tier mechanically and refuses to raise trust silently", () => {
    const { store } = currencyWithRegistered();
    const authoritative = declareSource(store, {
      sourceId: "source:alpha:secondary",
      tenantId: TENANT_A,
      tier: "authoritative" as const,
      description: "Alpha regulator feed",
      evidenceRef: "ev:alpha:regulator",
      declaredBy: ACTOR_A,
      declaredAt: NOW,
    });
    expect(authoritative.ok).toBe(true);
    if (!authoritative.ok) return;
    const promotion = downgradeSourceReliability(authoritative.store, {
      downgradeId: "dg:alpha:up",
      sourceId: "source:alpha:secondary",
      tenantId: TENANT_A,
      fromTier: "unverified",
      toTier: "authoritative",
      downgradedBy: ACTOR_A,
      reason: "Attempted silent promotion",
      evidenceRef: "ev:alpha:x",
      downgradedAt: NOW,
    });
    expect(promotion.ok).toBe(false);
    if (!promotion.ok) expect(promotion.error).toContain("strictly below");
  });

  it("requires a who, why, and evidence ref on every downgrade act", () => {
    const { store } = currencyWithRegistered();
    const noEvidence = downgradeSourceReliability(store, {
      downgradeId: "dg:alpha:noevidence",
      sourceId: SOURCE_A,
      tenantId: TENANT_A,
      fromTier: "verified",
      toTier: "provisional",
      downgradedBy: ACTOR_A,
      reason: "Contradictions",
      evidenceRef: "",
      downgradedAt: NOW,
    });
    expect(noEvidence.ok).toBe(false);
    if (!noEvidence.ok) expect(noEvidence.error).toContain("evidenceRef");
  });

  it("rejects an unknown source, cross-tenant downgrade, and duplicate downgradeId", () => {
    const { store } = currencyWithRegistered();
    const unknown = downgradeSourceReliability(store, {
      downgradeId: "dg:alpha:ghost",
      sourceId: "source:ghost",
      tenantId: TENANT_A,
      fromTier: "verified",
      toTier: "provisional",
      downgradedBy: ACTOR_A,
      reason: "Ghost source",
      evidenceRef: "ev:alpha:x",
      downgradedAt: NOW,
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error).toContain("not declared");

    const crossTenant = downgradeSourceReliability(store, {
      downgradeId: "dg:alpha:cross",
      sourceId: SOURCE_A,
      tenantId: TENANT_B,
      fromTier: "verified",
      toTier: "provisional",
      downgradedBy: ACTOR_B,
      reason: "Cross-tenant attempt",
      evidenceRef: "ev:beta:x",
      downgradedAt: NOW,
    });
    expect(crossTenant.ok).toBe(false);
    if (!crossTenant.ok) expect(crossTenant.error).toContain("cross-tenant");

    const first = downgradeSourceReliability(store, {
      downgradeId: "dg:alpha:first",
      sourceId: SOURCE_A,
      tenantId: TENANT_A,
      fromTier: "verified",
      toTier: "provisional",
      downgradedBy: ACTOR_A,
      reason: "First downgrade",
      evidenceRef: "ev:alpha:dg1",
      downgradedAt: NOW,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const duplicate = downgradeSourceReliability(first.store, {
      downgradeId: "dg:alpha:first",
      sourceId: SOURCE_A,
      tenantId: TENANT_A,
      fromTier: "provisional",
      toTier: "unverified",
      downgradedBy: ACTOR_A,
      reason: "Second downgrade, same id",
      evidenceRef: "ev:alpha:dg2",
      downgradedAt: NOW,
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.error).toContain("already recorded");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. Retrieval filtering by minimum tier
 * ────────────────────────────────────────────────────────────*/

describe("retrieval filtering by minimum tier", () => {
  /** SOURCE_A (verified) + a provisional rumor source, each with one record. */
  function storeWithTwoSources(): KnowledgeCurrencyStore {
    const base = currencyWithRegistered();
    const secondSource = declareSource(base.store, {
      sourceId: "source:alpha:rumor",
      tenantId: TENANT_A,
      tier: "provisional" as const,
      description: "Alpha rumor mill",
      evidenceRef: "ev:alpha:rumor",
      declaredBy: ACTOR_A,
      declaredAt: NOW,
    });
    if (!secondSource.ok) throw new Error(secondSource.error);
    const written = writeInto(secondSource.store.memory, { recordId: "mem:alpha:rumor" });
    const registered = registerKnowledgeRecord(
      { ...secondSource.store, memory: written.memory },
      {
        record: written.record,
        sourceId: "source:alpha:rumor",
        freshUntil: FRESH_UNTIL,
        revalidation: "none",
        registeredAt: NOW,
      },
    );
    if (!registered.ok) throw new Error(registered.error);
    return registered.store;
  }

  it("excludes records below the minimum tier and lists them, never silently", () => {
    const store = storeWithTwoSources();
    const result = retrieveKnowledge(store, retrieval({ minTier: "verified" }), { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.current.map((v) => v.record.id)).toEqual(["mem:alpha:001"]);
    expect(result.excludedByTier).toMatchObject([
      {
        recordId: "mem:alpha:rumor",
        status: "current",
        effectiveTier: "provisional",
        minimumTier: "verified",
      },
    ]);
  });

  it("without a minimum tier returns records of every tier", () => {
    const store = storeWithTwoSources();
    const result = retrieveKnowledge(store, retrieval(), { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.current).toHaveLength(2);
    expect(result.excludedByTier).toEqual([]);
    expect(result.minTier).toBeNull();
  });

  it("surfaces tier-excluded STALE records with their status intact", () => {
    const store = storeWithTwoSources();
    const result = retrieveKnowledge(store, retrieval({ minTier: "authoritative" }), {
      now: "2026-10-05T00:00:00Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.current).toEqual([]);
    expect(result.stale).toEqual([]);
    expect(result.excludedByTier).toHaveLength(2);
    for (const excluded of result.excludedByTier) {
      expect(excluded.status).toBe("stale");
      expect(excluded.minimumTier).toBe("authoritative");
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 6. Cross-tenant isolation
 * ────────────────────────────────────────────────────────────*/

describe("cross-tenant isolation", () => {
  it("never returns another tenant's records, invalidations, or downgrades", () => {
    const { store: alpha } = currencyWithRegistered();
    const invalidated = invalidateKnowledge(alpha, {
      invalidationId: "inv:alpha:iso",
      recordId: "mem:alpha:001",
      tenantId: TENANT_A,
      invalidatedBy: ACTOR_A,
      reason: "Tenant A retraction",
      evidenceRef: "ev:alpha:iso",
      invalidatedAt: NOW,
    });
    expect(invalidated.ok).toBe(true);
    if (!invalidated.ok) return;

    const beta = registerBeta(invalidated.store);
    const store = beta.store;

    // Tenant B's view: only tenant B knowledge; tenant A's invalidation and
    // source are invisible.
    const betaView = retrieveKnowledge(store, retrieval({ tenantId: TENANT_B }), { now: NOW });
    expect(betaView.ok).toBe(true);
    if (betaView.ok) {
      expect(betaView.current.map((v) => v.record.id)).toEqual(["mem:beta:001"]);
      expect(betaView.invalidated).toEqual([]);
      expect(
        betaView.current.every(
          (v) => v.record.tenantId === TENANT_B && v.contract.tenantId === TENANT_B,
        ),
      ).toBe(true);
    }

    // Tenant A's view: only tenant A knowledge.
    const alphaView = retrieveKnowledge(store, retrieval(), { now: NOW });
    expect(alphaView.ok).toBe(true);
    if (alphaView.ok) {
      expect(alphaView.invalidated.map((i) => i.recordId)).toEqual(["mem:alpha:001"]);
      expect(alphaView.current).toEqual([]);
      expect(alphaView.stale.every((v) => v.record.tenantId === TENANT_A)).toBe(true);
    }
  });

  it("rejects a cross-tenant invalidation act", () => {
    const { store } = currencyWithRegistered();
    const result = invalidateKnowledge(store, {
      invalidationId: "inv:beta:cross",
      recordId: "mem:alpha:001",
      tenantId: TENANT_B,
      invalidatedBy: ACTOR_B,
      reason: "Cross-tenant attempt",
      evidenceRef: "ev:beta:cross",
      invalidatedAt: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("cross-tenant");
  });

  it("rejects a registration whose source is bound to another tenant", () => {
    const { store } = currencyWithRegistered();
    // Tenant B record written through the memory tier, then offered to
    // tenant A's declared source.
    const written = writeInto(store.memory, betaRecordOverrides());
    const result = registerKnowledgeRecord({ ...store, memory: written.memory }, {
      record: written.record,
      sourceId: SOURCE_A,
      freshUntil: FRESH_UNTIL,
      revalidation: "before_use",
      registeredAt: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("cross-tenant");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 7. Compatibility with memory-store types + envelope
 * ────────────────────────────────────────────────────────────*/

describe("memory-store composition (types + envelope)", () => {
  it("registers a REAL MemoryRecord written through the memory-tier write path", () => {
    const { store, record } = currencyWithRegistered();
    expect(record.envelope.object_type).toBe("memory_record");
    expect(record.biTemporal.valid_time_known).toBe(true);
    const result = retrieveKnowledge(store, retrieval(), { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const view = result.current[0];
    expect(view?.record).toEqual(record);
    expect(view?.contract).toMatchObject({
      recordId: record.id,
      tenantId: TENANT_A,
      sourceId: SOURCE_A,
      freshUntil: FRESH_UNTIL,
      revalidation: "before_use",
      revalidateAfterSeconds: null,
      registeredAt: NOW,
      tierAtRegistration: "verified",
    });
  });

  it("rejects registering knowledge absent from the memory tier", () => {
    const base = currencyWithRecord();
    const declared = declareSource(base.currency, sourceA());
    expect(declared.ok).toBe(true);
    if (!declared.ok) return;
    const ghost: MemoryRecord = {
      ...base.record,
      id: "mem:alpha:ghost",
      envelope: { ...base.record.envelope, causation_id: null, declared_origin: "mission:ghost" },
    };
    const result = registerKnowledgeRecord(declared.store, {
      record: ghost,
      sourceId: SOURCE_A,
      freshUntil: FRESH_UNTIL,
      revalidation: "before_use",
      registeredAt: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("does not exist in the memory tier");
  });

  it("rejects a record whose envelope carries a foreign object_type", () => {
    const base = currencyWithRecord();
    const declared = declareSource(base.currency, sourceA());
    expect(declared.ok).toBe(true);
    if (!declared.ok) return;
    const laundered: MemoryRecord = {
      ...base.record,
      envelope: { ...base.record.envelope, object_type: "core.evidence" },
    };
    const result = registerKnowledgeRecord(declared.store, {
      record: laundered,
      sourceId: SOURCE_A,
      freshUntil: FRESH_UNTIL,
      revalidation: "before_use",
      registeredAt: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('must be "memory_record"');
  });

  it("rejects a duplicate freshness contract for the same record", () => {
    const { store, record } = currencyWithRegistered();
    const result = registerKnowledgeRecord(store, {
      record,
      sourceId: SOURCE_A,
      freshUntil: FRESH_UNTIL,
      revalidation: "none",
      registeredAt: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("already carries a freshness contract");
  });

  it("never mutates the underlying memory tier through currency operations", () => {
    const { store } = currencyWithRegistered();
    const memoryBefore = store.memory;
    const downgraded = downgradeSourceReliability(store, {
      downgradeId: "dg:alpha:iso",
      sourceId: SOURCE_A,
      tenantId: TENANT_A,
      fromTier: "verified",
      toTier: "unverified",
      downgradedBy: ACTOR_A,
      reason: "Trust collapse",
      evidenceRef: "ev:alpha:collapse",
      downgradedAt: NOW,
    });
    expect(downgraded.ok).toBe(true);
    if (!downgraded.ok) return;
    // The memory tier (scopes, records, access log) is untouched by design.
    expect(downgraded.store.memory).toEqual(memoryBefore);
  });
});