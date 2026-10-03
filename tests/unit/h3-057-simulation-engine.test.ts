/**
 * CoreGrid — H3-057 simulation-engine contract tests (mission G-057).
 *
 * Proves the phase-37 substrate contracts are Zod-typed, fail-closed,
 * and domain-neutral, and that the §9 truth boundary is enforced by
 * construction: simulation output is derived intelligence that can
 * never overwrite canonical truth — every outcome is literal-labelled
 * "derived", expires, and the only bridge toward a canonical surface
 * is a governed writeback decision that fails closed (DENY /
 * REQUIRE_APPROVAL) without policy, matching non-expired approval and
 * an audit destination.
 * Pure offline: no network, no database, no secrets.
 */
import { describe, expect, it } from "vitest";
import {
  DERIVED_ORIGIN,
  SIMULATION_CONTRACT_SCHEMA_VERSION,
  SimulationRunBundleSchema,
  SimulatedOutcomeSchema,
  ScenarioDefinitionSchema,
  compareAgainstObservation,
  decideSimulatedWriteback,
  usabilityForDecisionSupport,
  validateSimulationRunBundle,
  type SimulationRunBundle,
  type SimulatedOutcome,
} from "../../frontend/src/lib/simulation-engine/contracts";

const NOW_MS = 1_767_225_600_000; // 2026-01-01T00:00:00.000Z — injected, never the wall clock

const PROVENANCE = {
  declaredBy: "role:contract-architect",
  authority: "AGENTS.md §42 / H3 wave mission G-057",
  recordedAtMs: NOW_MS - 60_000,
};

function scenario(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: SIMULATION_CONTRACT_SCHEMA_VERSION,
    scenarioId: "scenario-1",
    tenantRef: "tenant-a",
    title: "bounded forward model",
    status: "approved",
    subjectRefs: ["subject:1", "subject:2"],
    assumptions: [
      {
        assumptionId: "a-1",
        statement: "input rates remain within the declared band",
        provenance: PROVENANCE,
      },
    ],
    parameters: [{ key: "rate", value: 0.5, unit: "per-step" }],
    horizonSteps: 10,
    maxRuns: 5,
    canonicalWriteback: false,
    provenance: PROVENANCE,
    ...overrides,
  };
}

function run(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: "run-1",
    scenarioId: "scenario-1",
    tenantRef: "tenant-a",
    seed: 42,
    horizonSteps: 10,
    purpose: "decision-support evaluation",
    requestedBy: "role:simulation-operator",
    requestedAtMs: NOW_MS - 30_000,
    executionIsolation: "isolated",
    ...overrides,
  };
}

function outcome(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    outcomeId: "outcome-1",
    runId: "run-1",
    tenantRef: "tenant-a",
    origin: DERIVED_ORIGIN,
    subjectRefs: ["subject:1"],
    horizonStep: 5,
    estimate: 100,
    lowerBound: 90,
    upperBound: 110,
    confidence: 0.8,
    generatedAtMs: NOW_MS - 10_000,
    validUntilMs: NOW_MS + 60_000,
    auditRef: "audit:run-1",
    provenance: PROVENANCE,
    ...overrides,
  };
}

function bundle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: SIMULATION_CONTRACT_SCHEMA_VERSION,
    scenario: scenario(),
    run: run(),
    status: "completed",
    outcomes: [outcome()],
    ...overrides,
  };
}

function parseBundle(raw: Record<string, unknown>): SimulationRunBundle {
  const parsed = SimulationRunBundleSchema.parse(raw);
  return parsed;
}

describe("scenario definition schema", () => {
  it("accepts a complete, approved, tenant-scoped scenario", () => {
    const parsed = ScenarioDefinitionSchema.safeParse(scenario());
    expect(parsed.success).toBe(true);
  });

  it("rejects a scenario without assumptions — assumptions are explicit or nothing runs", () => {
    const raw = scenario();
    delete (raw as Record<string, unknown>).assumptions;
    expect(ScenarioDefinitionSchema.safeParse(raw).success).toBe(false);
  });

  it("rejects a scenario with an empty assumptions array", () => {
    expect(
      ScenarioDefinitionSchema.safeParse(scenario({ assumptions: [] })).success,
    ).toBe(false);
  });

  it("rejects anonymous scenarios — provenance is mandatory (AGENTS §12)", () => {
    const raw = scenario();
    delete (raw as Record<string, unknown>).provenance;
    expect(ScenarioDefinitionSchema.safeParse(raw).success).toBe(false);
  });

  it("fails closed on canonical writeback: the literal admits only `false` (AGENTS §9)", () => {
    expect(
      ScenarioDefinitionSchema.safeParse(scenario({ canonicalWriteback: true })).success,
    ).toBe(false);
    expect(
      ScenarioDefinitionSchema.safeParse(scenario({ canonicalWriteback: "approved" })).success,
    ).toBe(false);
  });

  it("rejects unbounded scenarios — zero or negative horizon and run caps are invalid", () => {
    expect(ScenarioDefinitionSchema.safeParse(scenario({ horizonSteps: 0 })).success).toBe(false);
    expect(ScenarioDefinitionSchema.safeParse(scenario({ maxRuns: 0 })).success).toBe(false);
  });

  it("rejects a scenario that names no subjects — a scenario reads something specific", () => {
    expect(
      ScenarioDefinitionSchema.safeParse(scenario({ subjectRefs: [] })).success,
    ).toBe(false);
  });
});

describe("run request schema", () => {
  it("rejects an unisolated execution — only `isolated` parses (fail-closed literal)", () => {
    expect(
      SimulationRunBundleSchema.safeParse(
        bundle({ run: run({ executionIsolation: "shared" }) }),
      ).success,
    ).toBe(false);
  });

  it("rejects an unseeded run — reproducibility is mandatory", () => {
    const raw = run();
    delete (raw as Record<string, unknown>).seed;
    expect(
      SimulationRunBundleSchema.safeParse(bundle({ run: raw })).success,
    ).toBe(false);
  });

  it("rejects a run without a declared purpose (purpose limitation, AGENTS §16)", () => {
    const raw = run();
    delete (raw as Record<string, unknown>).purpose;
    expect(
      SimulationRunBundleSchema.safeParse(bundle({ run: raw })).success,
    ).toBe(false);
  });
});

describe("simulated outcome schema", () => {
  it("accepts a well-formed derived outcome with bounds, confidence and audit ref", () => {
    const parsed = SimulatedOutcomeSchema.safeParse(outcome());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.origin).toBe("derived");
    }
  });

  it("fails closed on origin forgery — simulated output can never self-label as observed or canonical", () => {
    expect(
      SimulatedOutcomeSchema.safeParse(outcome({ origin: "observed" })).success,
    ).toBe(false);
    expect(
      SimulatedOutcomeSchema.safeParse(outcome({ origin: "canonical" })).success,
    ).toBe(false);
    expect(
      SimulatedOutcomeSchema.safeParse(outcome({ origin: undefined })).success,
    ).toBe(false);
  });

  it("rejects confidence outside [0, 1]", () => {
    expect(SimulatedOutcomeSchema.safeParse(outcome({ confidence: 1.01 })).success).toBe(false);
    expect(SimulatedOutcomeSchema.safeParse(outcome({ confidence: -0.01 })).success).toBe(false);
  });

  it("rejects outcomes without an audit reference — everything important is auditable (AGENTS §29)", () => {
    const raw = outcome();
    delete (raw as Record<string, unknown>).auditRef;
    expect(SimulatedOutcomeSchema.safeParse(raw).success).toBe(false);
  });
});

describe("bundle cross-field validation (fail closed, typed issues)", () => {
  it("accepts a fully consistent completed bundle", () => {
    const result = validateSimulationRunBundle(bundle(), { nowMs: NOW_MS });
    expect(result.ok).toBe(true);
  });

  it("denies a bundle whose run references a different scenario", () => {
    const result = validateSimulationRunBundle(
      bundle({ run: run({ scenarioId: "scenario-other" }) }),
      { nowMs: NOW_MS },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.code)).toContain("scenario_mismatch");
    }
  });

  it("denies cross-tenant artifacts — tenant isolation fails closed (AGENTS §13)", () => {
    const result = validateSimulationRunBundle(
      bundle({
        run: run({ tenantRef: "tenant-b" }),
        outcomes: [outcome({ tenantRef: "tenant-b" })],
      }),
      { nowMs: NOW_MS },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("tenant_mismatch");
      expect(codes.filter((c) => c === "tenant_mismatch").length).toBeGreaterThanOrEqual(2);
    }
  });

  it("denies a run whose horizon exceeds the scenario bound and any governed maximum", () => {
    const exceeded = validateSimulationRunBundle(
      bundle({ run: run({ horizonSteps: 11 }) }),
      { nowMs: NOW_MS },
    );
    expect(exceeded.ok).toBe(false);
    if (!exceeded.ok) expect(exceeded.issues.map((i) => i.code)).toContain("horizon_exceeded");

    const capped = validateSimulationRunBundle(bundle(), {
      nowMs: NOW_MS,
      maxHorizonSteps: 5,
    });
    expect(capped.ok).toBe(false);
    if (!capped.ok) expect(capped.issues.map((i) => i.code)).toContain("horizon_exceeded");
  });

  it("denies runs of a draft or retired scenario — only approved scenarios may run", () => {
    for (const status of ["draft", "retired"]) {
      const result = validateSimulationRunBundle(
        bundle({ scenario: scenario({ status }) }),
        { nowMs: NOW_MS },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((i) => i.code)).toContain("scenario_not_approved");
      }
    }
  });

  it("denies outcomes attached to a run that did not complete", () => {
    for (const status of ["pending", "running", "failed"]) {
      const result = validateSimulationRunBundle(bundle({ status }), { nowMs: NOW_MS });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((i) => i.code)).toContain("outcomes_before_completion");
      }
    }
  });

  it("denies outcomes referencing subjects the scenario does not read", () => {
    const result = validateSimulationRunBundle(
      bundle({ outcomes: [outcome({ subjectRefs: ["subject:unknown"] })] }),
      { nowMs: NOW_MS },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((i) => i.code)).toContain("unknown_subject");
  });

  it("collects duplicate outcome ids instead of silently absorbing them", () => {
    const result = validateSimulationRunBundle(
      bundle({ outcomes: [outcome(), outcome({ horizonStep: 6 })] }),
      { nowMs: NOW_MS },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.filter((i) => i.code === "duplicate_outcome").length).toBe(1);
    }
  });

  it("denies inverted validity lifetimes and expired derived intelligence (clock injected)", () => {
    const inverted = validateSimulationRunBundle(
      bundle({ outcomes: [outcome({ validUntilMs: NOW_MS - 20_000, generatedAtMs: NOW_MS - 10_000 })] }),
      {},
    );
    expect(inverted.ok).toBe(false);
    if (!inverted.ok) {
      expect(inverted.issues.map((i) => i.code)).toContain("inverted_validity");
    }

    const expired = validateSimulationRunBundle(bundle(), { nowMs: NOW_MS + 120_000 });
    expect(expired.ok).toBe(false);
    if (!expired.ok) {
      expect(expired.issues.map((i) => i.code)).toContain("inverted_validity");
    }
  });

  it("denies uncertainty bands that do not contain the estimate", () => {
    const result = validateSimulationRunBundle(
      bundle({ outcomes: [outcome({ lowerBound: 101, upperBound: 110 })] }),
      { nowMs: NOW_MS },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.code)).toContain("bounds_exclude_estimate");
    }
  });

  it("fails closed on unknown schema versions and non-object input", () => {
    const wrongVersion = validateSimulationRunBundle(
      bundle({ schemaVersion: SIMULATION_CONTRACT_SCHEMA_VERSION + 1 }),
      {},
    );
    expect(wrongVersion.ok).toBe(false);
    if (!wrongVersion.ok) {
      expect(wrongVersion.issues[0]?.code).toBe("schema_version_unsupported");
    }

    const garbage = validateSimulationRunBundle("not-a-bundle", {});
    expect(garbage.ok).toBe(false);
    if (!garbage.ok) expect(garbage.issues[0]?.code).toBe("invalid_input");
  });
});

describe("decision-support usability (clock-injected, fail-closed)", () => {
  const validBundle: SimulationRunBundle = parseBundle(bundle());
  const validOutcome: SimulatedOutcome = parseBundle(bundle()).outcomes[0] as SimulatedOutcome;

  it("marks a completed, fresh, confident outcome usable", () => {
    const verdict = usabilityForDecisionSupport(validBundle, validOutcome, {
      nowMs: NOW_MS,
      minConfidence: 0.7,
    });
    expect(verdict).toEqual({ usable: true, reason: null });
  });

  it("refuses usability for an incomplete run", () => {
    const pending = parseBundle(bundle({ status: "running", outcomes: [] }));
    const verdict = usabilityForDecisionSupport(pending, validOutcome, { nowMs: NOW_MS });
    expect(verdict).toEqual({ usable: false, reason: "not_completed" });
  });

  it("refuses usability for expired derived intelligence", () => {
    const verdict = usabilityForDecisionSupport(validBundle, validOutcome, {
      nowMs: NOW_MS + 61_000,
    });
    expect(verdict).toEqual({ usable: false, reason: "expired" });
  });

  it("refuses usability below a declared confidence threshold", () => {
    const verdict = usabilityForDecisionSupport(validBundle, validOutcome, {
      nowMs: NOW_MS,
      minConfidence: 0.9,
    });
    expect(verdict).toEqual({ usable: false, reason: "confidence_below_threshold" });
  });
});

describe("comparison against observation (read-only diagnostic)", () => {
  const parsed: SimulatedOutcome = parseBundle(bundle()).outcomes[0] as SimulatedOutcome;

  it("labels the comparison itself as derived — diagnostics never become canonical truth", () => {
    const comparison = compareAgainstObservation(parsed, 105);
    expect(comparison.label).toBe("derived");
    expect(comparison.withinPredictedBounds).toBe(true);
    expect(comparison.divergence).toBe(5);
  });

  it("reports divergence outside the predicted band without mutating anything", () => {
    const comparison = compareAgainstObservation(parsed, 150);
    expect(comparison.withinPredictedBounds).toBe(false);
    expect(comparison.divergence).toBe(50);
  });
});

describe("the only bridge toward canonical surfaces: writeback decision (§9/§16/§21)", () => {
  const proposal = () => ({
    proposalId: "prop-1",
    tenantRef: "tenant-a",
    targetSubjectRef: "subject:1",
    purpose: "reconciliation support",
    policyRef: "policy:derived-writeback",
    auditDestinationRef: "audit:writeback",
    outcome: outcome(),
  });

  const approval = (overrides: Record<string, unknown> = {}) => ({
    approvalId: "appr-1",
    approvedBy: "principal:human-operator",
    approvedAtMs: NOW_MS - 60_000,
    expiresAtMs: NOW_MS + 60_000,
    tenantRef: "tenant-a",
    subjectRefs: ["subject:1"],
    revoked: false,
    ...overrides,
  });

  it("denies unparseable proposals outright", () => {
    const decision = decideSimulatedWriteback({ junk: true }, { nowMs: NOW_MS });
    expect(decision).toEqual({ decision: "DENY", reason: "invalid_input" });
  });

  it("requires approval before anything else — absence of approval is REQUIRE_APPROVAL, never a write", () => {
    const decision = decideSimulatedWriteback(proposal(), { nowMs: NOW_MS });
    expect(decision).toEqual({ decision: "REQUIRE_APPROVAL" });
  });

  it("allows a fully governed proposal: policy, matching approval, audit destination, derived label", () => {
    const decision = decideSimulatedWriteback(proposal(), {
      nowMs: NOW_MS,
      approval: approval(),
    });
    expect(decision).toEqual({ decision: "ALLOW" });
  });

  it("denies when no audit destination is declared — an unaudited write is no write (AGENTS §29)", () => {
    const raw = proposal();
    delete (raw as Record<string, unknown>).auditDestinationRef;
    const decision = decideSimulatedWriteback(raw, { nowMs: NOW_MS, approval: approval() });
    expect(decision).toEqual({ decision: "DENY", reason: "no_audit_destination" });
  });

  it("denies when no governing policy is declared — no policy, no decision surface (AGENTS §16)", () => {
    const raw = proposal();
    delete (raw as Record<string, unknown>).policyRef;
    const decision = decideSimulatedWriteback(raw, { nowMs: NOW_MS, approval: approval() });
    expect(decision).toEqual({ decision: "DENY", reason: "no_policy" });
  });

  it("denies approvals scoped to a different tenant — tenant isolation extends to approvals (AGENTS §31)", () => {
    const decision = decideSimulatedWriteback(proposal(), {
      nowMs: NOW_MS,
      approval: approval({ tenantRef: "tenant-b" }),
    });
    expect(decision).toEqual({ decision: "DENY", reason: "approval_mismatch_tenant" });
  });

  it("denies approvals that do not cover the target subject", () => {
    const decision = decideSimulatedWriteback(proposal(), {
      nowMs: NOW_MS,
      approval: approval({ subjectRefs: ["subject:2"] }),
    });
    expect(decision).toEqual({ decision: "DENY", reason: "approval_mismatch_subject" });
  });

  it("denies expired approvals (AGENTS §31: expired access fails)", () => {
    const decision = decideSimulatedWriteback(proposal(), {
      nowMs: NOW_MS,
      approval: approval({ expiresAtMs: NOW_MS - 1 }),
    });
    expect(decision).toEqual({ decision: "DENY", reason: "approval_expired" });
  });

  it("denies revoked approvals (AGENTS §31: revoked access fails)", () => {
    const decision = decideSimulatedWriteback(proposal(), {
      nowMs: NOW_MS,
      approval: approval({ revoked: true }),
    });
    expect(decision).toEqual({ decision: "DENY", reason: "approval_revoked" });
  });

  it("presents an unlabelled artifact as unparseable — the truth label cannot be forged into the bridge", () => {
    const raw = proposal();
    (raw.outcome as Record<string, unknown>).origin = "canonical";
    const decision = decideSimulatedWriteback(raw, { nowMs: NOW_MS, approval: approval() });
    expect(decision).toEqual({ decision: "DENY", reason: "invalid_input" });
  });
});

describe("module hygiene", () => {
  it("is pure: the contract module imports no vendors, no I/O, no environment reads", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.promises.readFile(
        new URL("../../frontend/src/lib/simulation-engine/contracts.ts", import.meta.url),
        "utf8",
      ),
    );
    expect(source).toMatch(/import \{ z \} from "zod";/);
    expect(source).not.toMatch(/from "(?!zod")/);
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/fetch\(|\.query\(|\.insert\(|createClient/);
  });

  it("never claims canonical authority: no schema admits origin other than derived", () => {
    const forgeries = ["observed", "canonical", "measured", "recorded", "derived-by-writeback"];
    for (const forgery of forgeries) {
      expect(
        SimulatedOutcomeSchema.safeParse(outcome({ origin: forgery })).success,
      ).toBe(false);
    }
  });
});
