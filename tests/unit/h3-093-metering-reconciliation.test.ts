/**
 * CoreGrid — H3-093 Metering Reconciliation Engineer (Squad I, J-043 roll-up
 * conservation depth).
 *
 * Mission: prove at depth that the metering roll-up
 * (`frontend/src/lib/metering/cost-attribution.ts` over
 * `frontend/src/lib/metering/usage-ledger.ts`) is a true PARTITION:
 *
 * 1. Every in-scope metered record lands in EXACTLY ONE bucket per
 *    dimension (tenant, mission, actor, model, purpose, tenant x mission) —
 *    verified here against an independent expected-bucket computation, not
 *    just bucket-sum reconciliation.
 * 2. Every dimension's bucket sums reconcile to the grand total across all
 *    six conserved fields (requests, tokensIn, tokensOut, durationMs,
 *    estimatedCostUsd, unpricedRequests) — including under randomized usage.
 * 3. Defects SURFACE, never absorb: every attribution/temporal defect reason
 *    is named, indexed and detailed; an unattributed record is still counted
 *    (under UNASSIGNED_REF_KEY), never dropped and never duplicated; a record
 *    outside a declared period is excluded from every bucket of that period
 *    and adjacent periods still count it exactly once.
 * 4. Enforcement is fail-closed: a quota evaluation refuses a non-integral
 *    roll-up instead of running on a defective ledger.
 *
 * READ-ONLY on the metering modules (campaign law 3): any behavioral gap
 * found here is recorded as a FINDING in progress/h3-wave/H3-093.report.md,
 * never patched from this suite.
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
  type RollupIntegrity,
  type TenantQuota,
} from "../../frontend/src/lib/metering/cost-attribution";
import {
  aggregateBy,
  aggregateByAgent,
  aggregateByMission,
  aggregateByTenant,
  aggregateTotals,
  GATEWAY_PURPOSES,
  UNASSIGNED_REF_KEY,
  UsageLedger,
  type GatewayPurpose,
  type ModelRateTable,
  type UsageRecord,
} from "../../frontend/src/lib/metering/usage-ledger";

/* ─────────────────────────────────────────────────────────────
 * Fixtures & pure helpers (no I/O; deterministic)
 * ────────────────────────────────────────────────────────────*/

function recordFixture(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    tenantRef: "tenant-1",
    actorRef: "actor-1",
    agentRef: null,
    missionRef: "mission-9",
    model: "coregrid/flash",
    provider: "provider-x",
    purpose: "summarization",
    tokensIn: 1_000,
    tokensOut: 500,
    durationMs: 250,
    estimatedCostUsd: 1.5,
    at: "2026-10-01T12:00:00.000Z",
    ...overrides,
  };
}

type ConservedField = keyof AttributionTotals;

const CONSERVED_FIELDS: readonly ConservedField[] = [
  "requests",
  "tokensIn",
  "tokensOut",
  "durationMs",
  "estimatedCostUsd",
  "unpricedRequests",
];

type RollupDimension =
  | "tenant"
  | "mission"
  | "actor"
  | "model"
  | "purpose"
  | "tenantMission";

const ROLLUP_DIMENSIONS: readonly RollupDimension[] = [
  "tenant",
  "mission",
  "actor",
  "model",
  "purpose",
  "tenantMission",
];

function dimensionBuckets(
  rollUp: CostRollUp,
  dimension: RollupDimension,
): Record<string, AttributionTotals> {
  switch (dimension) {
    case "tenant":
      return rollUp.byTenant;
    case "mission":
      return rollUp.byMission;
    case "actor":
      return rollUp.byActor;
    case "model":
      return rollUp.byModel;
    case "purpose":
      return rollUp.byPurpose;
    case "tenantMission":
      return rollUp.byTenantMission;
  }
}

function isNonBlank(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Independent re-derivation of the module's dimension-key semantics
 * (trimmed ref, or UNASSIGNED_REF_KEY when missing/blank). The composite
 * tenant x mission key mirrors the module's `${tenant}::${mission}` shape.
 */
function expectedDimensionKey(
  record: AttributableUsageRecord,
  dimension: RollupDimension,
): string {
  const tenantKey = isNonBlank(record.tenantRef)
    ? record.tenantRef.trim()
    : UNASSIGNED_REF_KEY;
  const missionKey = isNonBlank(record.missionRef)
    ? record.missionRef.trim()
    : UNASSIGNED_REF_KEY;
  switch (dimension) {
    case "tenant":
      return tenantKey;
    case "mission":
      return missionKey;
    case "actor":
      return isNonBlank(record.actorRef) ? record.actorRef.trim() : UNASSIGNED_REF_KEY;
    case "model":
      return isNonBlank(record.model) ? record.model.trim() : UNASSIGNED_REF_KEY;
    case "purpose":
      return GATEWAY_PURPOSES.includes(record.purpose)
        ? record.purpose
        : UNASSIGNED_REF_KEY;
    case "tenantMission":
      return `${tenantKey}::${missionKey}`;
  }
}

/** Expected bucket totals computed independently of the module's partitioner. */
function expectedBuckets(
  records: readonly AttributableUsageRecord[],
  dimension: RollupDimension,
): Record<string, AttributionTotals> {
  const groups = new Map<string, AttributableUsageRecord[]>();
  for (const record of records) {
    const key = expectedDimensionKey(record, dimension);
    const bucket = groups.get(key) ?? [];
    bucket.push(record);
    groups.set(key, bucket);
  }
  const buckets: Record<string, AttributionTotals> = {};
  for (const [key, bucket] of groups) {
    const totals = aggregateTotals(bucket);
    let unpriced = 0;
    for (const record of bucket) {
      if (record.estimatedCostUsd === null) unpriced += 1;
    }
    buckets[key] = { ...totals, unpricedRequests: unpriced };
  }
  return buckets;
}

function bucketSum(
  buckets: Record<string, AttributionTotals>,
  field: ConservedField,
): number {
  return Object.values(buckets).reduce((total, bucket) => total + bucket[field], 0);
}

function expectConserves(rollUp: CostRollUp): void {
  for (const dimension of ROLLUP_DIMENSIONS) {
    const buckets = dimensionBuckets(rollUp, dimension);
    for (const field of CONSERVED_FIELDS) {
      expect(
        bucketSum(buckets, field),
        `${dimension}.${field} must reconcile to the grand total`,
      ).toBeCloseTo(rollUp.grandTotal[field], 6);
    }
  }
}

/** Partition exclusivity: actual buckets match the independent expectation exactly. */
function expectExactPartition(
  records: readonly AttributableUsageRecord[],
  rollUp: CostRollUp,
  dimensions: readonly RollupDimension[],
): void {
  for (const dimension of dimensions) {
    const actual = dimensionBuckets(rollUp, dimension);
    const expected = expectedBuckets(records, dimension);
    expect(
      Object.keys(actual).sort(),
      `${dimension} bucket keys must match the expected partition`,
    ).toEqual(Object.keys(expected).sort());
    for (const key of Object.keys(expected)) {
      expect(actual[key], `${dimension}[${key}] totals`).toEqual(expected[key]);
    }
  }
}

function expectCleanIntegrity(integrity: RollupIntegrity): void {
  expect(integrity.ok).toBe(true);
  expect(integrity.conserves).toBe(true);
  expect(integrity.defects).toEqual([]);
  expect(integrity.problems).toEqual([]);
}

/** Deterministic PRNG (LCG) — no dependency on Math.random flakiness. */
function makePrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const RANDOM_BASE_MS = Date.parse("2026-10-01T00:00:00.000Z");

function randomRecords(seed: number, count: number): AttributableUsageRecord[] {
  const rand = makePrng(seed);
  const tenants = ["tenant-a", "tenant-b", "tenant-c", " tenant-b "];
  const actors = ["actor-1", "actor-2", " actor-2 "];
  const missions = ["m-1", "m-2", " m-1 "];
  const models = ["coregrid/flash", "coregrid/deep"];
  const costs = [null, 0, 1.25, 2.5, 0.0001, 10.0001] as const;
  const records: AttributableUsageRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = new Date(RANDOM_BASE_MS + Math.floor(rand() * 86_400_000)).toISOString();
    records.push({
      tenantRef: tenants[Math.floor(rand() * tenants.length)],
      actorRef: actors[Math.floor(rand() * actors.length)],
      agentRef: null,
      missionRef: missions[Math.floor(rand() * missions.length)],
      model: models[Math.floor(rand() * models.length)],
      provider: "provider-x",
      purpose: GATEWAY_PURPOSES[Math.floor(rand() * GATEWAY_PURPOSES.length)],
      tokensIn: Math.floor(rand() * 1_000_000),
      tokensOut: Math.floor(rand() * 500_000),
      durationMs: Math.floor(rand() * 5_000),
      estimatedCostUsd: costs[Math.floor(rand() * costs.length)],
      at,
    });
  }
  return records;
}

/* ─────────────────────────────────────────────────────────────
 * 1. Partition exclusivity (the "exactly one bucket" property)
 * ────────────────────────────────────────────────────────────*/

describe("partition exclusivity: every record lands in exactly one bucket per dimension", () => {
  const records: AttributableUsageRecord[] = [
    recordFixture({ tenantRef: "tenant-1", missionRef: "mission-9", estimatedCostUsd: 3.5 }),
    recordFixture({ tenantRef: " tenant-1 ", missionRef: " mission-9", estimatedCostUsd: 0.25 }),
    recordFixture({ tenantRef: "tenant-1\t", missionRef: "mission-11", model: "coregrid/deep", estimatedCostUsd: null }),
    recordFixture({ tenantRef: "tenant-2", actorRef: "actor-2", missionRef: null, purpose: "support", estimatedCostUsd: 2 }),
    recordFixture({ tenantRef: "  ", missionRef: null, estimatedCostUsd: 0.5 }),
    recordFixture({ tenantRef: "", missionRef: "mission-9", purpose: "extraction", estimatedCostUsd: null }),
    recordFixture({ tenantRef: "tenant-2", missionRef: "mission-9", actorRef: "actor-1", model: "coregrid/deep", purpose: "workflow_assistance", estimatedCostUsd: 9.999999 }),
  ];

  it("matches the independently computed partition on every dimension (keys and totals)", () => {
    const rollUp = rollUpCosts(records);
    // Two records lack mission attribution and two lack tenant attribution;
    // every defect must surface, yet the partition still covers every record
    // exactly once.
    const reasons = rollUp.integrity.defects.map((defect) => defect.reason);
    expect(reasons.filter((reason) => reason === "missing_mission").length).toBe(2);
    expect(reasons.filter((reason) => reason === "missing_tenant").length).toBe(2);
    expect(rollUp.integrity.defects.length).toBe(4);
    expect(rollUp.integrity.ok).toBe(false);
    expect(rollUp.integrity.conserves).toBe(true);
    expectExactPartition(records, rollUp, ROLLUP_DIMENSIONS);
  });

  it("merges whitespace-padded refs into the trimmed bucket (no bucket duplication)", () => {
    const rollUp = rollUpCosts(records);
    expect(rollUp.byTenant["tenant-1"].requests).toBe(3);
    expect(Object.keys(rollUp.byTenant).sort()).toEqual([
      UNASSIGNED_REF_KEY,
      "tenant-1",
      "tenant-2",
    ]);
    expect(rollUp.byMission["mission-9"].requests).toBe(4);
    expect(Object.keys(rollUp.byMission).sort()).toEqual([
      UNASSIGNED_REF_KEY,
      "mission-11",
      "mission-9",
    ]);
  });

  it("counts each record exactly once in the composite tenant x mission matrix", () => {
    const rollUp = rollUpCosts(records);
    expect(rollUp.grandTotal.requests).toBe(records.length);
    expect(bucketSum(rollUp.byTenantMission, "requests")).toBe(records.length);
    expect(rollUp.byTenantMission[`${UNASSIGNED_REF_KEY}::${UNASSIGNED_REF_KEY}`].requests).toBe(1);
    expect(rollUp.byTenantMission["tenant-1::mission-9"].requests).toBe(2);
    expect(rollUp.byTenantMission["tenant-2::mission-9"].requests).toBe(1);
  });

  it("conserves all six fields across all six dimensions", () => {
    expectConserves(rollUpCosts(records));
  });

  it("keeps the grand total independent of bucket construction (flat aggregation agreement)", () => {
    const rollUp = rollUpCosts(records);
    const flat = { ...aggregateTotals(records) };
    let unpriced = 0;
    for (const record of records) {
      if (record.estimatedCostUsd === null) unpriced += 1;
    }
    expect(rollUp.grandTotal).toEqual({ ...flat, unpricedRequests: unpriced });
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Randomized conservation property (deterministic seeds)
 * ────────────────────────────────────────────────────────────*/

describe("randomized conservation property (120 deterministic usage sets)", () => {
  it("conserves and partitions exactly for every generated clean ledger", () => {
    for (let seed = 1; seed <= 120; seed += 1) {
      const records = randomRecords(seed, 1 + (seed % 12));
      const rollUp = rollUpCosts(records);
      expectCleanIntegrity(rollUp.integrity);
      expect(rollUp.period).toBeNull();
      expect(rollUp.grandTotal.requests).toBe(records.length);
      expectConserves(rollUp);
      expectExactPartition(records, rollUp, ROLLUP_DIMENSIONS);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Defect surfacing matrix (defects surface, never absorb)
 * ────────────────────────────────────────────────────────────*/

describe("defect surfacing: every defect reason is named, indexed and detailed", () => {
  const ATTRIBUTION_DEFECT_CASES: readonly {
    reason: "missing_tenant" | "missing_mission" | "missing_actor" | "missing_model" | "invalid_purpose";
    overrides: Partial<UsageRecord>;
  }[] = [
    { reason: "missing_tenant", overrides: { tenantRef: "   " } },
    { reason: "missing_mission", overrides: { missionRef: null } },
    { reason: "missing_actor", overrides: { actorRef: "" } },
    { reason: "missing_model", overrides: { model: " " } },
    { reason: "invalid_purpose", overrides: { purpose: "geophysics" as GatewayPurpose } },
  ];

  it("surfaces each attribution defect exactly once with index, verbatim timestamp and detail", () => {
    for (const defectCase of ATTRIBUTION_DEFECT_CASES) {
      const record = recordFixture({ at: "2026-10-01T08:30:00.000Z", ...defectCase.overrides });
      const rollUp = rollUpCosts([record]);
      expect(rollUp.integrity.ok, defectCase.reason).toBe(false);
      expect(rollUp.integrity.conserves, `${defectCase.reason} must not break conservation`).toBe(true);
      expect(rollUp.integrity.defects.length, defectCase.reason).toBe(1);
      const defect = rollUp.integrity.defects[0];
      expect(defect.reason).toBe(defectCase.reason);
      expect(defect.index).toBe(0);
      expect(defect.at).toBe("2026-10-01T08:30:00.000Z");
      expect(defect.detail).toContain(`record #0`);
      expect(rollUp.integrity.problems.length).toBe(1);
      expect(rollUp.integrity.problems[0]).toContain(defectCase.reason);
    }
  });

  it("never absorbs an unattributed record: it still counts in the grand total and its buckets", () => {
    const rollUp = rollUpCosts([
      recordFixture({ missionRef: null, estimatedCostUsd: 4.5, tokensIn: 700, tokensOut: 300 }),
    ]);
    expect(rollUp.grandTotal.requests).toBe(1);
    expect(rollUp.grandTotal.estimatedCostUsd).toBe(4.5);
    expect(rollUp.grandTotal.tokensIn).toBe(700);
    expect(rollUp.byMission[UNASSIGNED_REF_KEY].requests).toBe(1);
    expect(rollUp.byTenant["tenant-1"].requests).toBe(1);
    expect(rollUp.byActor["actor-1"].requests).toBe(1);
    expect(rollUp.byTenantMission["tenant-1::(unassigned)"].requests).toBe(1);
  });

  it("collects every dimension defect for a multiply-defective record (no silent partial attribution)", () => {
    const rollUp = rollUpCosts([
      recordFixture({
        tenantRef: " ",
        missionRef: null,
        actorRef: "",
        model: "",
        purpose: "geophysics" as GatewayPurpose,
      }),
    ]);
    const reasons = rollUp.integrity.defects.map((defect) => defect.reason).sort();
    expect(reasons).toEqual([
      "invalid_purpose",
      "missing_actor",
      "missing_mission",
      "missing_model",
      "missing_tenant",
    ]);
    expect(rollUp.integrity.ok).toBe(false);
    expect(rollUp.grandTotal.requests).toBe(1);
  });

  it("reports the exact input indexes of defective records among clean ones", () => {
    const rollUp = rollUpCosts([
      recordFixture({}),
      recordFixture({ missionRef: null }),
      recordFixture({}),
      recordFixture({ missionRef: null }),
    ]);
    const missionDefectIndexes = rollUp.integrity.defects
      .filter((defect) => defect.reason === "missing_mission")
      .map((defect) => defect.index);
    expect(missionDefectIndexes).toEqual([1, 3]);
  });

  it("surfaces unpriced usage as counted-but-not-free (unpricedRequests conserves)", () => {
    const rollUp = rollUpCosts([
      recordFixture({ estimatedCostUsd: null }),
      recordFixture({ estimatedCostUsd: null, tenantRef: "tenant-2", missionRef: "mission-11" }),
      recordFixture({ estimatedCostUsd: 2 }),
    ]);
    expectCleanIntegrity(rollUp.integrity);
    expect(rollUp.grandTotal.unpricedRequests).toBe(2);
    expect(rollUp.grandTotal.requests).toBe(3);
    expect(rollUp.grandTotal.estimatedCostUsd).toBe(2);
    expect(rollUp.byTenant["tenant-1"].unpricedRequests).toBe(1);
    expect(rollUp.byTenant["tenant-2"].unpricedRequests).toBe(1);
    expect(bucketSum(rollUp.byMission, "unpricedRequests")).toBe(2);
    expect(bucketSum(rollUp.byTenantMission, "unpricedRequests")).toBe(2);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. Temporal defects and timeline partitioning
 * ────────────────────────────────────────────────────────────*/

describe("temporal defects: out-of-scope never means silently dropped", () => {
  const period: AttributionPeriod = {
    from: "2026-10-01T00:00:00.000Z",
    to: "2026-10-02T00:00:00.000Z",
  };

  it("surfaces an unparseable valid time instead of placing or dropping the record", () => {
    const rollUp = rollUpCosts([recordFixture({ at: "not-a-timestamp" })], period);
    expect(rollUp.grandTotal.requests).toBe(0);
    expect(Object.keys(rollUp.byTenant)).toEqual([]);
    expect(rollUp.integrity.ok).toBe(false);
    expect(rollUp.integrity.conserves).toBe(true);
    expect(rollUp.integrity.defects.length).toBe(1);
    expect(rollUp.integrity.defects[0].reason).toBe("unparseable_valid_time");
    expect(rollUp.integrity.defects[0].at).toBe("not-a-timestamp");
    expect(rollUp.integrity.defects[0].index).toBe(0);
  });

  it("surfaces a missing transaction time when bi-temporal bounds are declared (never guesses freshness)", () => {
    const biTemporal: AttributionPeriod = { ...period, recordedFrom: "2026-10-05T00:00:00.000Z" };
    const rollUp = rollUpCosts([recordFixture({ at: "2026-10-01T06:00:00.000Z" })], biTemporal);
    expect(rollUp.grandTotal.requests).toBe(0);
    expect(rollUp.integrity.defects.map((defect) => defect.reason)).toEqual([
      "missing_transaction_time",
    ]);
  });

  it("surfaces an unparseable transaction time instead of placing the record", () => {
    const biTemporal: AttributionPeriod = {
      ...period,
      recordedFrom: "2026-10-05T00:00:00.000Z",
      recordedTo: "2026-10-06T00:00:00.000Z",
    };
    const rollUp = rollUpCosts(
      [{ ...recordFixture({ at: "2026-10-01T06:00:00.000Z" }), recordedAt: "garbage" }],
      biTemporal,
    );
    expect(rollUp.grandTotal.requests).toBe(0);
    expect(rollUp.integrity.defects.map((defect) => defect.reason)).toEqual([
      "unparseable_transaction_time",
    ]);
  });

  it("places a bi-temporally complete record only when BOTH coordinates fall in scope", () => {
    const biTemporal: AttributionPeriod = {
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-02T00:00:00.000Z",
      recordedFrom: "2026-10-05T00:00:00.000Z",
      recordedTo: "2026-10-06T00:00:00.000Z",
    };
    const record = (at: string, recordedAt: string): AttributableUsageRecord => ({
      ...recordFixture({ at }),
      recordedAt,
    });
    const inside = rollUpCosts(
      [record("2026-10-01T06:00:00.000Z", "2026-10-05T12:00:00.000Z")],
      biTemporal,
    );
    expectCleanIntegrity(inside.integrity);
    expect(inside.grandTotal.requests).toBe(1);
    const staleValidTime = rollUpCosts(
      [record("2026-10-03T06:00:00.000Z", "2026-10-05T12:00:00.000Z")],
      biTemporal,
    );
    expect(staleValidTime.grandTotal.requests).toBe(0);
    expect(staleValidTime.integrity.defects).toEqual([]);
  });
});

describe("timeline partitioning: adjacent half-open periods count each record exactly once", () => {
  const DAY_MS = 86_400_000;
  const windows: readonly AttributionPeriod[] = [0, 1, 2, 3, 4, 5].map((day) => ({
    from: new Date(RANDOM_BASE_MS + day * DAY_MS).toISOString(),
    to: new Date(RANDOM_BASE_MS + (day + 1) * DAY_MS).toISOString(),
  }));

  it("partitions a six-day span: window sums equal the record count, no double-count", () => {
    const records = randomRecords(77, 40);
    let placedRequests = 0;
    for (const window of windows) {
      const rollUp = rollUpCosts(records, window);
      expectCleanIntegrity(rollUp.integrity);
      expectConserves(rollUp);
      // The partition expectation covers only the records the period places
      // (these fixtures carry valid time only, so placement is a valid-time
      // check): out-of-period records belong to other periods, not this one.
      const fromMs = Date.parse(window.from);
      const toMs = Date.parse(window.to);
      const inScope = records.filter((record) => {
        const validMs = Date.parse(record.at);
        return Number.isFinite(validMs) && validMs >= fromMs && validMs < toMs;
      });
      expectExactPartition(inScope, rollUp, ["tenant", "mission", "tenantMission"]);
      placedRequests += rollUp.grandTotal.requests;
    }
    expect(placedRequests).toBe(records.length);
  });

  it("counts a boundary-exact record in exactly one of two adjacent windows", () => {
    const boundary = "2026-10-02T00:00:00.000Z";
    const record = recordFixture({ at: boundary });
    const first = rollUpCosts([record], windows[0]);
    const second = rollUpCosts([record], windows[1]);
    expect(first.grandTotal.requests).toBe(0);
    expect(second.grandTotal.requests).toBe(1);
    expect(first.integrity.ok).toBe(true);
    expect(second.integrity.ok).toBe(true);
  });

  it("respects transaction-time boundaries across adjacent bi-temporal windows", () => {
    const record: AttributableUsageRecord = {
      ...recordFixture({ at: "2026-10-01T06:00:00.000Z" }),
      recordedAt: "2026-10-02T00:00:00.000Z",
    };
    const earlierWindow: AttributionPeriod = {
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-02T00:00:00.000Z",
      recordedFrom: "2026-10-01T00:00:00.000Z",
      recordedTo: "2026-10-02T00:00:00.000Z",
    };
    const laterWindow: AttributionPeriod = {
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-02T00:00:00.000Z",
      recordedFrom: "2026-10-02T00:00:00.000Z",
      recordedTo: "2026-10-03T00:00:00.000Z",
    };
    expect(rollUpCosts([record], earlierWindow).grandTotal.requests).toBe(0);
    expect(rollUpCosts([record], laterWindow).grandTotal.requests).toBe(1);
  });

  it("keeps defect indexes aligned to the original input sequence under a declared period", () => {
    const records: AttributableUsageRecord[] = [
      { ...recordFixture({ at: "2026-10-01T06:00:00.000Z" }), recordedAt: "2026-10-05T06:00:00.000Z" },
      recordFixture({ at: "2026-10-01T07:00:00.000Z" }),
      recordFixture({ at: "2026-10-09T06:00:00.000Z" }),
      { ...recordFixture({ at: "2026-10-01T08:00:00.000Z", missionRef: null }), recordedAt: "2026-10-05T07:00:00.000Z" },
    ];
    const biTemporal: AttributionPeriod = {
      ...windows[0],
      recordedFrom: "2026-10-05T00:00:00.000Z",
    };
    const rollUp = rollUpCosts(records, biTemporal);
    // Records #0 and #3 carry complete transaction times and fall in scope;
    // #1 lacks transaction time (defect, never placed), #2 is out of period
    // (no defect — it belongs to another period).
    expect(rollUp.grandTotal.requests).toBe(2);
    expect(rollUp.integrity.defects.map((defect) => [defect.index, defect.reason])).toEqual([
      [1, "missing_transaction_time"],
      [3, "missing_mission"],
    ]);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. Quota enforcement is fail-closed on defective roll-ups
 * ────────────────────────────────────────────────────────────*/

describe("quota enforcement refuses non-integral roll-ups (defects block, never absorb)", () => {
  const quota: TenantQuota = {
    tenantRef: "tenant-1",
    maxRequests: 10,
    maxCostUsd: 100,
  };

  it("refuses enforcement while ANY record carries an attribution defect", () => {
    const rollUp = rollUpCosts([
      recordFixture({ estimatedCostUsd: 1 }),
      recordFixture({ tenantRef: "tenant-9", missionRef: null, estimatedCostUsd: 1 }),
    ]);
    expect(rollUp.integrity.ok).toBe(false);
    const outcome = evaluateTenantQuota(rollUp, quota);
    expect(outcome.decision).toBe("refused");
    if (outcome.decision === "refused") {
      expect(outcome.code).toBe("non_integral_rollup");
      expect(outcome.integrity.defects.map((defect) => defect.reason)).toContain(
        "missing_mission",
      );
    }
  });

  it("refuses enforcement for every tenant when one record is defective (global fail closed)", () => {
    const rollUp = rollUpCosts([recordFixture({ tenantRef: "   " })]);
    const cleanTenant = evaluateTenantQuota(rollUp, { tenantRef: "tenant-1", maxRequests: 5 });
    expect(cleanTenant.decision).toBe("refused");
    if (cleanTenant.decision === "refused") {
      expect(cleanTenant.code).toBe("non_integral_rollup");
    }
  });

  it("evaluates normally once the ledger is integral (within-quota evidence preserved)", () => {
    const rollUp = rollUpCosts([
      recordFixture({ estimatedCostUsd: 2, tokensIn: 1_000, tokensOut: 500 }),
    ]);
    expectCleanIntegrity(rollUp.integrity);
    const outcome = evaluateTenantQuota(rollUp, quota);
    expect(outcome.decision).toBe("within");
    if (outcome.decision === "within") {
      expect(outcome.usage.requests).toBe(1);
      expect(outcome.usage.estimatedCostUsd).toBe(2);
      expect(outcome.remaining).toEqual({ requests: 9, tokensIn: null, tokensOut: null, costUsd: 98 });
    }
  });

  it("treats an unknown tenant as zero usage without inventing consumption", () => {
    const rollUp = rollUpCosts([recordFixture({ tenantRef: "tenant-1" })]);
    const outcome = evaluateTenantQuota(rollUp, { tenantRef: "tenant-unknown", maxRequests: 5 });
    expect(outcome.decision).toBe("within");
    if (outcome.decision === "within") {
      expect(outcome.usage).toEqual(emptyAttributionTotals());
    }
  });

  it("checks misconfiguration before integrity (both fail-closed refusals are deterministic)", () => {
    const defective = rollUpCosts([recordFixture({ missionRef: null })]);
    const bothBroken = evaluateTenantQuota(defective, { tenantRef: "tenant-1", maxRequests: -1 });
    expect(bothBroken.decision).toBe("refused");
    if (bothBroken.decision === "refused") {
      expect(bothBroken.code).toBe("misconfigured_quota");
    }
    const integrityOnly = evaluateTenantQuota(defective, quota);
    expect(integrityOnly.decision).toBe("refused");
    if (integrityOnly.decision === "refused") {
      expect(integrityOnly.code).toBe("non_integral_rollup");
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 6. Ledger-to-roll-up reconciliation (ingestion gate agreement)
 * ────────────────────────────────────────────────────────────*/

describe("ledger-to-roll-up reconciliation: ingestion is fail-closed, roll-up conserves", () => {
  const RATES: ModelRateTable = {
    "coregrid/flash": {
      provider: "provider-x",
      inputUsdPerMillionTokens: 2.5,
      outputUsdPerMillionTokens: 10,
    },
  };

  it("keeps unattributable records out of the ledger entirely (no silent absorb at ingestion)", () => {
    const ledger = new UsageLedger(RATES);
    ledger.recordUsage({
      tenantRef: "tenant-1",
      actorRef: "actor-1",
      agentRef: null,
      missionRef: "mission-9",
      model: "coregrid/flash",
      provider: "provider-x",
      purpose: "classification",
      tokensIn: 1_000_000,
      tokensOut: 0,
      durationMs: 10,
    });
    expect(() =>
      ledger.recordUsage({
        tenantRef: "  ",
        actorRef: "actor-1",
        agentRef: null,
        missionRef: "mission-9",
        model: "coregrid/flash",
        provider: "provider-x",
        purpose: "classification",
        tokensIn: 10,
        tokensOut: 10,
        durationMs: 10,
      }),
    ).toThrow(/Usage record rejected/);
    expect(ledger.all().length).toBe(1);
  });

  it("reconciles ledger-derived costs into an integral, conserving roll-up", () => {
    const ledger = new UsageLedger(RATES);
    ledger.recordUsage({
      tenantRef: "tenant-1",
      actorRef: "actor-1",
      agentRef: null,
      missionRef: "mission-9",
      model: "coregrid/flash",
      provider: "provider-x",
      purpose: "classification",
      tokensIn: 1_000_000,
      tokensOut: 500_000,
      durationMs: 100,
    });
    ledger.recordUsage({
      tenantRef: "tenant-1",
      actorRef: "actor-2",
      agentRef: null,
      missionRef: "mission-9",
      model: "coregrid/flash",
      provider: "provider-x",
      purpose: "drafting",
      tokensIn: 400_000,
      tokensOut: 100_000,
      durationMs: 50,
    });
    ledger.recordUsage({
      tenantRef: "tenant-2",
      actorRef: "actor-1",
      agentRef: null,
      missionRef: "mission-11",
      model: "coregrid/mystery",
      provider: "provider-y",
      purpose: "support",
      tokensIn: 999,
      tokensOut: 1,
      durationMs: 5,
    });
    const rollUp = rollUpCosts(ledger.all());
    expectCleanIntegrity(rollUp.integrity);
    expectConserves(rollUp);
    // 1M in x 2.5 + 0.5M out x 10 = 7.5; 0.4M in x 2.5 + 0.1M out x 10 = 2
    expect(rollUp.byTenant["tenant-1"].estimatedCostUsd).toBe(9.5);
    // unknown model rate -> null cost: counted, surfaced as unpriced, never billed as free
    expect(rollUp.byTenant["tenant-2"].estimatedCostUsd).toBe(0);
    expect(rollUp.byTenant["tenant-2"].unpricedRequests).toBe(1);
    expect(rollUp.grandTotal.unpricedRequests).toBe(1);
    expect(rollUp.grandTotal.estimatedCostUsd).toBe(9.5);
  });

  it("reconciles the ledger's own dimension groupings against flat totals (no drop in aggregateBy)", () => {
    const records: UsageRecord[] = [
      recordFixture({ agentRef: null, missionRef: null, estimatedCostUsd: 1 }),
      recordFixture({ agentRef: "agent-7", missionRef: "mission-9", estimatedCostUsd: 2 }),
      recordFixture({ agentRef: null, missionRef: "mission-9", estimatedCostUsd: null }),
    ];
    const flat = aggregateTotals(records);
    const dimensions: readonly [string, Record<string, UsageTotalsShape>][] = [
      ["tenant", aggregateByTenant(records)],
      ["agent", aggregateByAgent(records)],
      ["mission", aggregateByMission(records)],
    ];
    for (const [label, grouped] of dimensions) {
      let requests = 0;
      let tokensIn = 0;
      let tokensOut = 0;
      let durationMs = 0;
      let cost = 0;
      for (const totals of Object.values(grouped)) {
        requests += totals.requests;
        tokensIn += totals.tokensIn;
        tokensOut += totals.tokensOut;
        durationMs += totals.durationMs;
        cost += totals.estimatedCostUsd;
      }
      expect(requests, `${label} request conservation`).toBe(flat.requests);
      expect(tokensIn, `${label} input-token conservation`).toBe(flat.tokensIn);
      expect(tokensOut, `${label} output-token conservation`).toBe(flat.tokensOut);
      expect(durationMs, `${label} duration conservation`).toBe(flat.durationMs);
      expect(cost, `${label} cost conservation`).toBeCloseTo(flat.estimatedCostUsd, 6);
    }
    expect(aggregateBy(records, "agent")[UNASSIGNED_REF_KEY].requests).toBe(2);
    expect(aggregateBy(records, "mission")[UNASSIGNED_REF_KEY].requests).toBe(1);
  });
});

/** Structural alias keeping the reconciliation table declaration readable. */
type UsageTotalsShape = {
  requests: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  estimatedCostUsd: number;
};