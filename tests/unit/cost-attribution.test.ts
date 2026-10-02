/**
 * CoreGrid — cost-attribution tests (J-043 / V1CAP-078, MISSION-R-70):
 * conservation of the roll-up partition, unattributed-record detection (never
 * absorbed), bi-temporal period boundaries, boundary-inclusive quota
 * evaluation, and double-count impossibility.
 */
import { describe, expect, it } from "vitest";
import {
  emptyAttributionTotals,
  evaluateTenantQuota,
  rollUpCosts,
  type AttributableUsageRecord,
  type AttributionPeriod,
  type AttributionTotals,
  type CostRollUp,
  type TenantQuota,
} from "../../frontend/src/lib/metering/cost-attribution";
import { UNASSIGNED_REF_KEY, type UsageRecord } from "../../frontend/src/lib/metering/usage-ledger";

function recordFixture(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    tenantRef: "tenant-1",
    actorRef: "actor-1",
    agentRef: null,
    missionRef: null,
    model: "coregrid/flash",
    provider: "provider-x",
    purpose: "summarization",
    tokensIn: 1_000_000,
    tokensOut: 500_000,
    durationMs: 250,
    estimatedCostUsd: 7.5,
    at: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A fixture record WITH mission attribution (the J-043 happy path). */
function attributedFixture(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return recordFixture({ missionRef: "mission-9", ...overrides });
}

/** Sum a field over every bucket of a dimension. */
function bucketSum(buckets: Record<string, AttributionTotals>, field: keyof AttributionTotals): number {
  return Object.values(buckets).reduce((total, bucket) => total + bucket[field], 0);
}

const CONSERVED_FIELDS: readonly (keyof AttributionTotals)[] = [
  "requests",
  "tokensIn",
  "tokensOut",
  "durationMs",
  "estimatedCostUsd",
  "unpricedRequests",
];

function expectConserves(rollUp: CostRollUp): void {
  for (const field of CONSERVED_FIELDS) {
    expect(bucketSum(rollUp.byTenant, field)).toBeCloseTo(rollUp.grandTotal[field], 6);
    expect(bucketSum(rollUp.byMission, field)).toBeCloseTo(rollUp.grandTotal[field], 6);
    expect(bucketSum(rollUp.byActor, field)).toBeCloseTo(rollUp.grandTotal[field], 6);
    expect(bucketSum(rollUp.byModel, field)).toBeCloseTo(rollUp.grandTotal[field], 6);
    expect(bucketSum(rollUp.byPurpose, field)).toBeCloseTo(rollUp.grandTotal[field], 6);
    expect(bucketSum(rollUp.byTenantMission, field)).toBeCloseTo(rollUp.grandTotal[field], 6);
  }
}

describe("roll-up correctness and conservation (partition property)", () => {
  const records: UsageRecord[] = [
    attributedFixture({ tenantRef: "tenant-1", actorRef: "actor-1", estimatedCostUsd: 7.5 }),
    attributedFixture({
      tenantRef: "tenant-1",
      actorRef: "actor-2",
      model: "coregrid/deep",
      missionRef: "mission-9",
      purpose: "classification",
      estimatedCostUsd: 2.25,
      tokensIn: 100,
      tokensOut: 50,
    }),
    attributedFixture({
      tenantRef: "tenant-2",
      actorRef: "actor-1",
      missionRef: "mission-11",
      estimatedCostUsd: 0,
      tokensIn: 10,
      tokensOut: 10,
      durationMs: 5,
    }),
  ];

  it("attributes every record to exactly one (tenant, mission) pair (MISSION-R-70 T1)", () => {
    const rollUp = rollUpCosts(records);
    expect(rollUp.integrity.ok).toBe(true);
    expect(Object.keys(rollUp.byTenantMission).sort()).toEqual([
      "tenant-1::mission-9",
      "tenant-2::mission-11",
    ]);
    expect(rollUp.byTenantMission["tenant-1::mission-9"].requests).toBe(2);
    expect(rollUp.byTenantMission["tenant-2::mission-11"].requests).toBe(1);
  });

  it("produces per-dimension cost roll-ups with correct bucket sums", () => {
    const rollUp = rollUpCosts(records);
    expect(rollUp.byTenant["tenant-1"].estimatedCostUsd).toBe(9.75);
    expect(rollUp.byTenant["tenant-2"].estimatedCostUsd).toBe(0);
    expect(rollUp.byMission["mission-9"].requests).toBe(2);
    expect(rollUp.byMission["mission-11"].estimatedCostUsd).toBe(0);
    expect(rollUp.byActor["actor-1"].requests).toBe(2);
    expect(rollUp.byModel["coregrid/deep"].estimatedCostUsd).toBe(2.25);
    expect(rollUp.byPurpose["classification"].requests).toBe(1);
    expect(rollUp.grandTotal.requests).toBe(3);
    expect(rollUp.grandTotal.estimatedCostUsd).toBe(9.75);
  });

  it("conserves: every dimension's bucket sums reconcile to the grand total", () => {
    expectConserves(rollUpCosts(records));
  });

  it("conserves on an empty ledger (all dimensions reconcile to zero)", () => {
    const rollUp = rollUpCosts([]);
    expect(rollUp.integrity.ok).toBe(true);
    expect(rollUp.grandTotal).toEqual(emptyAttributionTotals());
    expectConserves(rollUp);
  });
});

describe("unattributed records (data defects: surfaced, never absorbed, never guessed)", () => {
  it("buckets a null-mission record under UNASSIGNED_REF_KEY and fails integrity", () => {
    const rollUp = rollUpCosts([attributedFixture(), recordFixture({ missionRef: null })]);
    expect(rollUp.byMission[UNASSIGNED_REF_KEY].requests).toBe(1);
    expect(rollUp.byMission["mission-9"].requests).toBe(1);
    expect(rollUp.integrity.ok).toBe(false);
    const reasons = rollUp.integrity.defects.map((defect) => defect.reason);
    expect(reasons).toContain("missing_mission");
    // never absorbed: the record still counts in the grand total and in its tenant bucket
    expect(rollUp.grandTotal.requests).toBe(2);
    expect(rollUp.byTenant["tenant-1"].requests).toBe(2);
    expect(rollUp.byTenantMission["tenant-1::(unassigned)"].requests).toBe(1);
  });

  it("flags a blank tenantRef as missing_tenant without guessing a tenant", () => {
    const rollUp = rollUpCosts([recordFixture({ tenantRef: "   " })]);
    expect(rollUp.byTenant[UNASSIGNED_REF_KEY].requests).toBe(1);
    expect(Object.keys(rollUp.byTenant)).toEqual([UNASSIGNED_REF_KEY]);
    expect(rollUp.integrity.defects.map((defect) => defect.reason)).toContain("missing_tenant");
    expect(rollUp.integrity.ok).toBe(false);
  });

  it("surfaces null-cost usage as unpriced instead of silently billing it as free", () => {
    const rollUp = rollUpCosts([
      attributedFixture({ estimatedCostUsd: null, missionRef: "mission-9" }),
      attributedFixture({ estimatedCostUsd: 3, missionRef: "mission-9" }),
    ]);
    expect(rollUp.integrity.ok).toBe(true);
    expect(rollUp.grandTotal.unpricedRequests).toBe(1);
    expect(rollUp.grandTotal.estimatedCostUsd).toBe(3);
    expect(rollUp.byMission["mission-9"].unpricedRequests).toBe(1);
  });

  it("collects every dimension defect for one record (no silent partial attribution)", () => {
    const rollUp = rollUpCosts([recordFixture({ tenantRef: "", missionRef: null, actorRef: " " })]);
    const reasons = rollUp.integrity.defects.map((defect) => defect.reason).sort();
    expect(reasons).toEqual(["missing_actor", "missing_mission", "missing_tenant"]);
  });
});

describe("period boundaries (half-open [from, to), bi-temporal)", () => {
  const period: AttributionPeriod = {
    from: "2026-10-01T00:00:00.000Z",
    to: "2026-10-02T00:00:00.000Z",
  };

  it("includes a record at exactly `from` (inclusive)", () => {
    const rollUp = rollUpCosts([attributedFixture({ at: period.from })], period);
    expect(rollUp.grandTotal.requests).toBe(1);
    expect(rollUp.integrity.ok).toBe(true);
  });

  it("excludes a record at exactly `to` (exclusive) so adjacent periods cannot double-count", () => {
    const rollUp = rollUpCosts([attributedFixture({ at: period.to })], period);
    expect(rollUp.grandTotal.requests).toBe(0);
    expect(rollUp.integrity.ok).toBe(true);
  });

  it("includes a record just before `to` and excludes one just before `from`", () => {
    const inside = rollUpCosts(
      [attributedFixture({ at: "2026-10-01T23:59:59.999Z" })],
      period,
    );
    expect(inside.grandTotal.requests).toBe(1);
    const before = rollUpCosts(
      [attributedFixture({ at: "2026-09-30T23:59:59.999Z" })],
      period,
    );
    expect(before.grandTotal.requests).toBe(0);
  });

  it("excludes records outside the window from every bucket (they belong to other periods)", () => {
    const rollUp = rollUpCosts(
      [
        attributedFixture({ at: "2026-09-30T00:00:00.000Z" }),
        attributedFixture({ at: "2026-10-01T12:00:00.000Z" }),
        attributedFixture({ at: "2026-10-03T00:00:00.000Z" }),
      ],
      period,
    );
    expect(rollUp.grandTotal.requests).toBe(1);
    expect(rollUp.byMission["mission-9"].requests).toBe(1);
    expect(rollUp.integrity.ok).toBe(true);
  });

  it("surfaces an unparseable valid time as a defect instead of placing it", () => {
    const rollUp = rollUpCosts([attributedFixture({ at: "not-a-date" })], period);
    expect(rollUp.grandTotal.requests).toBe(0);
    expect(rollUp.integrity.ok).toBe(false);
    expect(rollUp.integrity.defects.map((defect) => defect.reason)).toContain(
      "unparseable_valid_time",
    );
  });

  it("filters on transaction time (recordedAt) when bi-temporal bounds are declared", () => {
    const biTemporal: AttributionPeriod = {
      ...period,
      recordedFrom: "2026-10-05T00:00:00.000Z",
      recordedTo: "2026-10-06T00:00:00.000Z",
    };
    const record = (recordedAt: string): AttributableUsageRecord => ({
      ...attributedFixture({ at: "2026-10-01T12:00:00.000Z" }),
      recordedAt,
    });
    expect(rollUpCosts([record("2026-10-05T09:00:00.000Z")], biTemporal).grandTotal.requests).toBe(1);
    expect(rollUpCosts([record("2026-10-06T00:00:00.000Z")], biTemporal).grandTotal.requests).toBe(0);
    expect(rollUpCosts([record("2026-10-04T23:59:59.999Z")], biTemporal).grandTotal.requests).toBe(0);
  });

  it("refuses to guess freshness: a record without recordedAt under transaction bounds is a defect", () => {
    const biTemporal: AttributionPeriod = {
      ...period,
      recordedFrom: "2026-10-05T00:00:00.000Z",
    };
    const rollUp = rollUpCosts([attributedFixture()], biTemporal);
    expect(rollUp.grandTotal.requests).toBe(0);
    expect(rollUp.integrity.defects.map((defect) => defect.reason)).toContain(
      "missing_transaction_time",
    );
    const malformed = rollUpCosts(
      [{ ...attributedFixture(), recordedAt: "garbage" }],
      biTemporal,
    );
    expect(malformed.integrity.defects.map((defect) => defect.reason)).toContain(
      "unparseable_transaction_time",
    );
  });

  it("throws on a malformed period (fail closed at the boundary)", () => {
    expect(() => rollUpCosts([], { from: "nope", to: period.to })).toThrow(TypeError);
    expect(() => rollUpCosts([], { from: period.to, to: period.from })).toThrow(TypeError);
    expect(() =>
      rollUpCosts([], { ...period, recordedFrom: "garbage" }),
    ).toThrow(TypeError);
  });
});

describe("quota evaluation (boundary-inclusive, fail-closed on defective roll-ups)", () => {
  const quota: TenantQuota = {
    tenantRef: "tenant-1",
    maxRequests: 10,
    maxTokensIn: 100_000,
    maxTokensOut: 50_000,
    maxCostUsd: 5,
  };

  it("is within quota when usage is below every declared cap", () => {
    const rollUp = rollUpCosts([attributedFixture({ estimatedCostUsd: 1.25, tokensIn: 40_000, tokensOut: 20_000 })]);
    const outcome = evaluateTenantQuota(rollUp, quota);
    expect(outcome.decision).toBe("within");
    if (outcome.decision === "within") {
      expect(outcome.remaining).toEqual({ requests: 9, tokensIn: 60_000, tokensOut: 30_000, costUsd: 3.75 });
    }
  });

  it("is within quota when the tenant has no usage at all", () => {
    const rollUp = rollUpCosts([attributedFixture({ tenantRef: "tenant-2" })]);
    const outcome = evaluateTenantQuota(rollUp, quota);
    expect(outcome.decision).toBe("within");
    if (outcome.decision === "within") {
      expect(outcome.usage).toEqual(emptyAttributionTotals());
    }
  });

  it("is within quota when no limits are declared", () => {
    const rollUp = rollUpCosts([attributedFixture()]);
    const outcome = evaluateTenantQuota(rollUp, { tenantRef: "tenant-1" });
    expect(outcome.decision).toBe("within");
    if (outcome.decision === "within") {
      expect(outcome.remaining).toEqual({ requests: null, tokensIn: null, tokensOut: null, costUsd: null });
    }
  });

  it("denies at the exact boundary of every dimension (boundary-inclusive, pre-check semantics)", () => {
    const single: UsageRecord = attributedFixture({
      estimatedCostUsd: 1,
      tokensIn: 10,
      tokensOut: 10,
    });
    const atLimit: ReadonlyArray<[TenantQuota, number]> = [
      [{ tenantRef: "tenant-1", maxRequests: 1 }, 1],
      [{ tenantRef: "tenant-1", maxTokensIn: 10 }, 10],
      [{ tenantRef: "tenant-1", maxTokensOut: 10 }, 10],
      [{ tenantRef: "tenant-1", maxCostUsd: 1 }, 1],
    ];
    for (const [soleQuota, limit] of atLimit) {
      const rollUp = rollUpCosts([single]);
      const outcome = evaluateTenantQuota(rollUp, soleQuota);
      expect(outcome.decision).toBe("quota_exceeded");
      if (outcome.decision === "quota_exceeded") {
        expect(outcome.limit).toBe(limit);
        expect(outcome.usage.requests).toBe(1);
      }
    }
  });

  it("reports the specific exceeded dimension with evidence (limit + usage)", () => {
    const rollUp = rollUpCosts([attributedFixture({ estimatedCostUsd: 7.5, tokensIn: 1_000_000, tokensOut: 500_000 })]);
    const costOutcome = evaluateTenantQuota(rollUp, { tenantRef: "tenant-1", maxCostUsd: 5 });
    expect(costOutcome.decision).toBe("quota_exceeded");
    if (costOutcome.decision === "quota_exceeded") {
      expect(costOutcome.code).toBe("cost_quota");
      expect(costOutcome.limit).toBe(5);
      expect(costOutcome.usage.estimatedCostUsd).toBe(7.5);
      expect(costOutcome.reason).toContain("cost quota exceeded");
    }
    const tokenOutcome = evaluateTenantQuota(rollUp, { tenantRef: "tenant-1", maxTokensIn: 500_000 });
    expect(tokenOutcome.decision).toBe("quota_exceeded");
    if (tokenOutcome.decision === "quota_exceeded") {
      expect(tokenOutcome.code).toBe("token_in_quota");
    }
  });

  it("refuses fail-closed on a misconfigured quota (negative, non-finite, blank tenant)", () => {
    const rollUp = rollUpCosts([]);
    for (const bad of [
      { tenantRef: "tenant-1", maxRequests: -1 },
      { tenantRef: "tenant-1", maxCostUsd: Number.NaN },
      { tenantRef: "  ", maxRequests: 10 },
    ]) {
      const outcome = evaluateTenantQuota(rollUp, bad);
      expect(outcome.decision).toBe("refused");
      if (outcome.decision === "refused") {
        expect(outcome.code).toBe("misconfigured_quota");
      }
    }
  });

  it("refuses fail-closed on a non-integral roll-up instead of enforcing against defects", () => {
    const rollUp = rollUpCosts([attributedFixture(), recordFixture({ missionRef: null })]);
    expect(rollUp.integrity.ok).toBe(false);
    const outcome = evaluateTenantQuota(rollUp, quota);
    expect(outcome.decision).toBe("refused");
    if (outcome.decision === "refused") {
      expect(outcome.code).toBe("non_integral_rollup");
      expect(outcome.integrity.defects.length).toBeGreaterThan(0);
    }
  });
});

describe("double-count impossibility", () => {
  const recordAt = (at: string): UsageRecord => attributedFixture({ at });

  it("counts a record exactly once across adjacent half-open periods", () => {
    const boundaryRecord = recordAt("2026-10-02T00:00:00.000Z");
    const earlier = rollUpCosts([boundaryRecord], {
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-02T00:00:00.000Z",
    });
    const later = rollUpCosts([boundaryRecord], {
      from: "2026-10-02T00:00:00.000Z",
      to: "2026-10-03T00:00:00.000Z",
    });
    expect(earlier.grandTotal.requests).toBe(0);
    expect(later.grandTotal.requests).toBe(1);
  });

  it("partitions the union window: adjacent period sums equal the union roll-up", () => {
    const records = [
      recordAt("2026-10-01T06:00:00.000Z"),
      recordAt("2026-10-01T18:00:00.000Z"),
      recordAt("2026-10-02T06:00:00.000Z"),
    ];
    const union = rollUpCosts(records, {
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-03T00:00:00.000Z",
    });
    const first = rollUpCosts(records, {
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-02T00:00:00.000Z",
    });
    const second = rollUpCosts(records, {
      from: "2026-10-02T00:00:00.000Z",
      to: "2026-10-03T00:00:00.000Z",
    });
    expect(union.grandTotal.requests).toBe(3);
    expect(first.grandTotal.requests + second.grandTotal.requests).toBe(3);
    expect(
      first.grandTotal.estimatedCostUsd + second.grandTotal.estimatedCostUsd,
    ).toBeCloseTo(union.grandTotal.estimatedCostUsd, 6);
  });

  it("attributes each record to exactly one bucket per dimension (partition, not overlap)", () => {
    const records = [
      attributedFixture({ tenantRef: "tenant-1", missionRef: "mission-9", actorRef: "actor-1" }),
      attributedFixture({ tenantRef: "tenant-1", missionRef: "mission-11", actorRef: "actor-2", model: "coregrid/deep" }),
      attributedFixture({ tenantRef: "tenant-2", missionRef: "mission-9", actorRef: "actor-1", purpose: "support" }),
    ];
    const rollUp = rollUpCosts(records);
    expect(rollUp.grandTotal.requests).toBe(3);
    expect(rollUp.byTenant["tenant-1"].requests + rollUp.byTenant["tenant-2"].requests).toBe(3);
    expect(rollUp.byMission["mission-9"].requests + rollUp.byMission["mission-11"].requests).toBe(3);
    expect(rollUp.byActor["actor-1"].requests + rollUp.byActor["actor-2"].requests).toBe(3);
    // every tenant x mission cell holds a disjoint record set
    expect(rollUp.byTenantMission["tenant-1::mission-9"].requests).toBe(1);
    expect(rollUp.byTenantMission["tenant-1::mission-11"].requests).toBe(1);
    expect(rollUp.byTenantMission["tenant-2::mission-9"].requests).toBe(1);
  });
});
