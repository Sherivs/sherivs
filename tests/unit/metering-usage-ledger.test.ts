/**
 * CoreGrid — usage-ledger tests (V5.3 Part 49: attribution completeness,
 * config-driven estimation, aggregation, budget denial as discriminated union).
 */
import { describe, expect, it } from "vitest";
import {
  aggregateByAgent,
  aggregateByMission,
  aggregateByTenant,
  aggregateTotals,
  evaluateBudget,
  estimateCostUsd,
  GATEWAY_PURPOSES,
  UNASSIGNED_REF_KEY,
  UsageLedger,
  validateUsageRecord,
  type GatewayPurpose,
  type ModelRateTable,
  type UsageRecord,
} from "../../frontend/src/lib/metering/usage-ledger";

const RATES: ModelRateTable = {
  "coregrid/flash": {
    provider: "provider-x",
    inputUsdPerMillionTokens: 2.5,
    outputUsdPerMillionTokens: 10,
  },
  "coregrid/free": {
    provider: "provider-x",
    inputUsdPerMillionTokens: 0,
    outputUsdPerMillionTokens: 0,
  },
};

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

describe("GATEWAY_PURPOSES (V5.3 scope: organizational intelligence only)", () => {
  it("contains exactly the six allowed purposes", () => {
    expect(GATEWAY_PURPOSES).toEqual([
      "summarization",
      "classification",
      "drafting",
      "extraction",
      "support",
      "workflow_assistance",
    ]);
  });
});

describe("estimateCostUsd (rate table passed as config, never hard-coded)", () => {
  it("prices input and output tokens from the table", () => {
    expect(
      estimateCostUsd(
        { model: "coregrid/flash", tokensIn: 1_000_000, tokensOut: 500_000 },
        RATES,
      ),
    ).toBe(7.5);
  });

  it("returns null for unknown models instead of guessing a price", () => {
    expect(
      estimateCostUsd({ model: "unknown-model", tokensIn: 10, tokensOut: 10 }, RATES),
    ).toBeNull();
  });

  it("supports zero-rate models and partial-token precision", () => {
    expect(
      estimateCostUsd(
        { model: "coregrid/free", tokensIn: 999_999, tokensOut: 123 },
        RATES,
      ),
    ).toBe(0);
    expect(
      estimateCostUsd({ model: "coregrid/flash", tokensIn: 123_456, tokensOut: 0 }, RATES),
    ).toBeCloseTo((123_456 / 1_000_000) * 2.5, 10);
  });

  it("fails closed on malformed rate entries", () => {
    const broken: ModelRateTable = {
      "bad/model": {
        provider: "provider-x",
        inputUsdPerMillionTokens: Number.NaN,
        outputUsdPerMillionTokens: 10,
      },
    };
    expect(
      estimateCostUsd({ model: "bad/model", tokensIn: 10, tokensOut: 10 }, broken),
    ).toBeNull();
  });
});

describe("validateUsageRecord (attribution completeness, fail-closed)", () => {
  it("accepts a fully attributed record", () => {
    expect(validateUsageRecord(recordFixture())).toEqual([]);
  });

  it("rejects missing tenant/actor/model/provider attribution", () => {
    const problems = validateUsageRecord(
      recordFixture({ tenantRef: "", actorRef: "  ", model: "", provider: "" }),
    );
    expect(problems).toContain("tenantRef is required");
    expect(problems).toContain("actorRef is required");
    expect(problems).toContain("model is required");
    expect(problems).toContain("provider is required");
  });

  it("rejects purposes outside the organizational-intelligence vocabulary", () => {
    const problems = validateUsageRecord(
      recordFixture({ purpose: "geophysics" as GatewayPurpose }),
    );
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain("organizational-intelligence purpose");
  });

  it("rejects negative or non-finite usage figures and malformed timestamps", () => {
    const problems = validateUsageRecord(
      recordFixture({
        tokensIn: -1,
        tokensOut: Number.NaN,
        durationMs: -5,
        estimatedCostUsd: -0.01,
        at: "not-a-date",
      }),
    );
    expect(problems).toContain("tokensIn must be a finite non-negative number");
    expect(problems).toContain("tokensOut must be a finite non-negative number");
    expect(problems).toContain("durationMs must be a finite non-negative number");
    expect(problems).toContain(
      "estimatedCostUsd must be null or a finite non-negative number",
    );
    expect(problems).toContain("at must be an ISO-8601 timestamp string");
  });

  it("allows null refs and null cost, rejects empty-string refs", () => {
    expect(
      validateUsageRecord(
        recordFixture({ agentRef: null, missionRef: null, estimatedCostUsd: null }),
      ),
    ).toEqual([]);
    expect(
      validateUsageRecord(recordFixture({ agentRef: "", missionRef: "" })),
    ).toContain("agentRef must be null or a non-empty string");
  });
});

describe("UsageLedger (in-process, pure, fail-closed ingestion)", () => {
  it("fills missing at/cost from clock and rate table", () => {
    const ledger = new UsageLedger(RATES);
    const stored = ledger.recordUsage({
      tenantRef: "tenant-1",
      actorRef: "actor-1",
      agentRef: null,
      missionRef: null,
      model: "coregrid/flash",
      provider: "provider-x",
      purpose: "classification",
      tokensIn: 1_000_000,
      tokensOut: 0,
      durationMs: 10,
    });
    expect(stored.at).toBeTruthy();
    expect(new Date(stored.at).toString()).not.toBe("Invalid Date");
    expect(stored.estimatedCostUsd).toBe(2.5);
  });

  it("respects an explicitly null estimated cost (canonical usage, derived price)", () => {
    const ledger = new UsageLedger(RATES);
    const stored = ledger.recordUsage({
      tenantRef: "tenant-1",
      actorRef: "actor-1",
      agentRef: null,
      missionRef: null,
      model: "coregrid/flash",
      provider: "provider-x",
      purpose: "drafting",
      tokensIn: 10,
      tokensOut: 10,
      durationMs: 5,
      estimatedCostUsd: null,
    });
    expect(stored.estimatedCostUsd).toBeNull();
  });

  it("throws instead of storing unattributable records", () => {
    const ledger = new UsageLedger(RATES);
    expect(() =>
      ledger.recordUsage({
        tenantRef: "",
        actorRef: "actor-1",
        agentRef: null,
        missionRef: null,
        model: "coregrid/flash",
        provider: "provider-x",
        purpose: "support",
        tokensIn: 1,
        tokensOut: 1,
        durationMs: 1,
      }),
    ).toThrow(/Usage record rejected: tenantRef is required/);
    expect(ledger.all().length).toBe(0);
  });

  it("throws on out-of-vocabulary purposes", () => {
    const ledger = new UsageLedger();
    expect(() =>
      ledger.recordUsage({
        tenantRef: "tenant-1",
        actorRef: "actor-1",
        agentRef: null,
        missionRef: null,
        model: "m",
        provider: "p",
        purpose: "planetary_simulation" as GatewayPurpose,
        tokensIn: 1,
        tokensOut: 1,
        durationMs: 1,
      }),
    ).toThrow(/organizational-intelligence purpose/);
  });

  it("stores frozen records (immutable audit trail)", () => {
    const ledger = new UsageLedger();
    const stored = ledger.recordUsage({
      tenantRef: "tenant-1",
      actorRef: "actor-1",
      agentRef: null,
      missionRef: null,
      model: "m",
      provider: "p",
      purpose: "extraction",
      tokensIn: 1,
      tokensOut: 1,
      durationMs: 1,
    });
    expect(Object.isFrozen(stored)).toBe(true);
  });
});

describe("aggregation (per tenant / agent / mission totals)", () => {
  const records: UsageRecord[] = [
    recordFixture(),
    recordFixture({
      tenantRef: "tenant-2",
      actorRef: "actor-2",
      model: "coregrid/free",
      estimatedCostUsd: 0,
      durationMs: 100,
    }),
    recordFixture({
      agentRef: "agent-7",
      missionRef: "mission-9",
      tokensIn: 2_000_000,
      tokensOut: 0,
      durationMs: 650,
      estimatedCostUsd: 5,
    }),
  ];

  it("sums flat totals", () => {
    const totals = aggregateTotals(records);
    expect(totals.requests).toBe(3);
    expect(totals.tokensIn).toBe(4_000_000);
    expect(totals.tokensOut).toBe(1_000_000);
    expect(totals.durationMs).toBe(1000);
    expect(totals.estimatedCostUsd).toBe(12.5);
  });

  it("groups by tenant", () => {
    const byTenant = aggregateByTenant(records);
    expect(Object.keys(byTenant).sort()).toEqual(["tenant-1", "tenant-2"]);
    expect(byTenant["tenant-1"].requests).toBe(2);
    expect(byTenant["tenant-2"].requests).toBe(1);
  });

  it("groups by agent, bucketing null refs under UNASSIGNED_REF_KEY", () => {
    const byAgent = aggregateByAgent(records);
    expect(Object.keys(byAgent).sort()).toEqual([UNASSIGNED_REF_KEY, "agent-7"]);
    expect(byAgent[UNASSIGNED_REF_KEY].requests).toBe(2);
    expect(byAgent["agent-7"].requests).toBe(1);
  });

  it("groups by mission, bucketing null refs under UNASSIGNED_REF_KEY", () => {
    const byMission = aggregateByMission(records);
    expect(Object.keys(byMission).sort()).toEqual([UNASSIGNED_REF_KEY, "mission-9"]);
    expect(byMission["mission-9"].estimatedCostUsd).toBe(5);
  });

  it("exposes the same grouping through ledger totals methods", () => {
    const ledger = new UsageLedger(RATES);
    for (const record of records) {
      ledger.recordUsage(record);
    }
    expect(ledger.tenantTotals("tenant-2").requests).toBe(1);
    expect(ledger.agentTotals("agent-7").tokensIn).toBe(2_000_000);
    expect(ledger.missionTotals("mission-9").requests).toBe(1);
    expect(ledger.tenantTotals("tenant-none").requests).toBe(0);
  });
});

describe("evaluateBudget (config-driven limits, deny reasons as discriminated union)", () => {
  it("allows when no limits are configured", () => {
    const outcome = evaluateBudget({}, { requests: 9, tokensIn: 9, tokensOut: 9, durationMs: 0, estimatedCostUsd: 9 });
    expect(outcome.decision).toBe("allow");
  });

  it("denies at the request limit (pre-check semantics: used >= limit)", () => {
    const totals = { requests: 2, tokensIn: 0, tokensOut: 0, durationMs: 0, estimatedCostUsd: 0 };
    expect(evaluateBudget({ maxRequests: 2 }, totals)).toMatchObject({
      decision: "deny",
      code: "request_limit",
    });
    expect(evaluateBudget({ maxRequests: 3 }, totals).decision).toBe("allow");
  });

  it("denies each token dimension independently", () => {
    const totals = { requests: 0, tokensIn: 500, tokensOut: 250, durationMs: 0, estimatedCostUsd: 0 };
    expect(evaluateBudget({ maxTokensIn: 500 }, totals)).toMatchObject({
      decision: "deny",
      code: "token_in_limit",
    });
    expect(evaluateBudget({ maxTokensOut: 250 }, totals)).toMatchObject({
      decision: "deny",
      code: "token_out_limit",
    });
    expect(evaluateBudget({ maxTokensIn: 501, maxTokensOut: 251 }, totals).decision).toBe(
      "allow",
    );
  });

  it("denies on cost budget exhaustion", () => {
    const totals = { requests: 0, tokensIn: 0, tokensOut: 0, durationMs: 0, estimatedCostUsd: 7.5 };
    const outcome = evaluateBudget({ maxCostUsd: 7 }, totals);
    expect(outcome.decision).toBe("deny");
    if (outcome.decision === "deny") {
      expect(outcome.code).toBe("cost_limit");
      expect(outcome.reason).toContain("Cost budget exhausted");
    }
  });

  it("fails closed on misconfigured (negative/non-finite) limits", () => {
    const totals = { requests: 0, tokensIn: 0, tokensOut: 0, durationMs: 0, estimatedCostUsd: 0 };
    const negative = evaluateBudget({ maxRequests: -1 }, totals);
    const nonFinite = evaluateBudget({ maxCostUsd: Number.NaN }, totals);
    expect(negative.decision).toBe("deny");
    expect(nonFinite.decision).toBe("deny");
    if (negative.decision === "deny" && nonFinite.decision === "deny") {
      expect(negative.reason).toContain("misconfigured");
      expect(nonFinite.reason).toContain("misconfigured");
    }
  });
});