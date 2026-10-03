/**
 * CoreGrid — H3-065 AI Compute clearance-contract tests (mission G-065,
 * phase 45). Proves the fail-closed semantics of the phase-45 compute-offer
 * clearance surface:
 *   - compute is clearance-gated: only `available`, tenant-owned offers
 *     admit workloads, with typed denial reasons otherwise;
 *   - compute is METERED: a request without a resolvable metering key,
 *     budget commitment or sufficient remaining period budget is refused;
 *   - AI operations route through the centralized gateway (§20): an allowed
 *     allocation carries invocationPath "gateway" and never mints a second
 *     path to models;
 *   - the tenant, offer snapshot and metering ledger come only from the
 *     server-resolved context (§26); tenant A cannot act on tenant B (§31);
 *   - declarations are bounded, provenance is mandatory, and the
 *     capacity-status read projection is tenant-scoped;
 *   - the module stays pure, typed and domain-neutral (J-037).
 * Pure offline: no network, no database, no secrets.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ALLOWED_INVOCATION_PATH,
  COMPUTE_GATEWAY_PURPOSES,
  COMPUTE_OFFER_STATUSES,
  DENIAL_REASONS,
  MAX_DURATION_SECONDS,
  MAX_OFFER_CAPACITY_UNITS,
  OFFER_STATUS_TRANSITIONS,
  WORKLOAD_KINDS,
  canTransitionOfferStatus,
  capacityStatusForTenant,
  computeOfferStatusSchema,
  decideComputeClearance,
  parseComputeClearanceContext,
  parseComputeClearanceDecision,
  parseComputeAllocationRequest,
  parseComputeOfferDescriptor,
  projectAllocationCostUsd,
  workloadKindSchema,
  type ComputeClearanceContext,
  type ComputeOfferDescriptor,
  type OfferSnapshotRow,
} from "../../frontend/src/lib/ai-compute/contracts";
import { GATEWAY_PURPOSES } from "../../frontend/src/lib/metering/usage-ledger";
import { isValidManifestId } from "../../frontend/src/lib/kernel/domain-manifest";

/* ─────────────────────────────────────────────────────────────
 * Fixtures
 * ────────────────────────────────────────────────────────────*/

const INSTANT = "2026-10-03T00:00:00.000Z";

function offerRow(overrides: Partial<OfferSnapshotRow> = {}): OfferSnapshotRow {
  return {
    offerRef: "compute:alpha",
    tenantRef: "tenant_a",
    status: "available",
    workloadKinds: ["serving", "training"],
    availableConcurrency: 8,
    unitRateUsdPerHour: 2,
    allowedRegions: ["region_eu_1", "region_us_1"],
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    workloadKind: "serving",
    gatewayPurpose: "classification",
    offerRef: "compute:alpha",
    requestedConcurrency: 4,
    maxDurationSeconds: 3600,
    requiredRegion: "region_eu_1",
    budget: { maxCostUsd: 100, meteringKey: "key_main" },
    provenance: {
      requestedBy: "role:compute-administrator",
      authority: "AGENTS.md §42 / H3 wave mission G-065",
      requestedAt: INSTANT,
      justification: "Schedule governed serving capacity under the phase-45 contract.",
    },
    ...overrides,
  };
}

function context(overrides: Partial<ComputeClearanceContext> = {}): ComputeClearanceContext {
  return {
    actorRef: "role:compute-administrator",
    resolvedTenantRef: "tenant_a",
    observedAt: INSTANT,
    offerSnapshot: [offerRow()],
    meteringLedger: [
      { meteringKey: "key_main", consumedCostUsd: 10, periodBudgetUsd: 1000 },
    ],
    ...overrides,
  };
}

function descriptor(overrides: Partial<ComputeOfferDescriptor> = {}): ComputeOfferDescriptor {
  return {
    offerRef: "compute:alpha",
    name: "Alpha Capacity",
    summary: "A neutral compute offer used to prove the clearance contract.",
    workloadKinds: ["serving", "training"],
    capacity: { maxConcurrentWorkloads: 64, unitRateUsdPerHour: 2 },
    residency: { mode: "pinned_regions", allowedRegions: ["region_eu_1", "region_us_1"] },
    isolation: { tenantScoped: true, egress: "none" },
    ...overrides,
  };
}

function reasonSet(decision: ReturnType<typeof decideComputeClearance>): string[] {
  return decision.outcome === "deny" ? [...decision.reasons] : [];
}

/* ─────────────────────────────────────────────────────────────
 * Clearance: governed, metered, gateway-bound
 * ────────────────────────────────────────────────────────────*/

describe("G-065 compute clearance", () => {
  it("allows a valid allocation and meters the projected cost", () => {
    const decision = decideComputeClearance(request(), context());
    expect(decision.outcome).toBe("allow");
    if (decision.outcome === "allow") {
      // 4 units × 1 hour × $2/unit-hour = $8
      expect(decision.projectedCostUsd).toBe(8);
      expect(decision.reservedConcurrency).toBe(4);
      expect(decision.tenantRef).toBe("tenant_a");
      expect(decision.meteringKey).toBe("key_main");
      expect(decision.decidedAt).toBe(INSTANT);
      expect(decision.invocationPath).toBe(ALLOWED_INVOCATION_PATH);
      expect(decision.invocationPath).toBe("gateway");
    }
    expect(parseComputeClearanceDecision(decision).ok).toBe(true);
  });

  it("projects cost as concurrency × hours × declared unit rate", () => {
    // 2 units × 0.5 hours × $3/unit-hour = $3
    expect(projectAllocationCostUsd(2, 1800, 3)).toBe(3);
    // fractional hours round to the ledger precision (6 decimals), never drift
    expect(projectAllocationCostUsd(1, 60, 0.5)).toBe(0.008333);
    // sub-precision costs round down to zero — never a fabricated charge
    expect(projectAllocationCostUsd(1, 1, 0.001)).toBe(0);
  });

  it("denies an unparseable allocation request with typed reasons and detail", () => {
    const decision = decideComputeClearance({ workloadKind: "serving" }, context());
    expect(decision.outcome).toBe("deny");
    if (decision.outcome === "deny") {
      expect(decision.reasons).toContain("invalid_request_shape");
      expect(decision.detail.length).toBeGreaterThan(0);
      expect(decision.meteringKey).toBeUndefined();
    }
  });

  it("denies unknown keys (strict shape — fail closed, never ignore)", () => {
    const decision = decideComputeClearance(request({ tenantId: "tenant_a" }), context());
    expect(reasonSet(decision)).toContain("invalid_request_shape");
  });

  it("denies everything when the context is malformed or unresolvable", () => {
    const noTenant = context();
    delete (noTenant as Partial<ComputeClearanceContext>).resolvedTenantRef;
    const decision = decideComputeClearance(request(), noTenant);
    expect(decision.outcome).toBe("deny");
    if (decision.outcome === "deny") {
      expect(decision.reasons).toContain("invalid_context");
      expect(decision.tenantRef).toBeUndefined();
    }
    expect(decideComputeClearance(request(), { actorRef: "role:x" }).outcome).toBe("deny");
  });

  it("rejects a duplicate offerRef or meteringKey in the server-resolved context", () => {
    const dupOffers = context({
      offerSnapshot: [offerRow(), offerRow({ availableConcurrency: 3 })],
    });
    expect(parseComputeClearanceContext(dupOffers).ok).toBe(false);
    const dupKeys = context({
      meteringLedger: [
        { meteringKey: "key_main", consumedCostUsd: 1, periodBudgetUsd: 10 },
        { meteringKey: "key_main", consumedCostUsd: 2, periodBudgetUsd: 10 },
      ],
    });
    expect(parseComputeClearanceContext(dupKeys).ok).toBe(false);
  });

  it("denies an allocation against an offer outside the resolved snapshot", () => {
    const decision = decideComputeClearance(request({ offerRef: "compute:ghost" }), context());
    expect(reasonSet(decision)).toContain("unknown_offer");
  });

  it("denies tenant A allocating tenant B's offer (AGENTS §31)", () => {
    const ctx = context({ offerSnapshot: [offerRow({ tenantRef: "tenant_b" })] });
    const decision = decideComputeClearance(request(), ctx);
    expect(decision.outcome).toBe("deny");
    if (decision.outcome === "deny") {
      expect(decision.reasons).toContain("tenant_mismatch");
      // the denial names the RESOLVED tenant, never the foreign tenant
      expect(decision.tenantRef).toBe("tenant_a");
    }
  });

  it("admits only `available` offers — every other lifecycle state refuses", () => {
    for (const status of COMPUTE_OFFER_STATUSES) {
      if (status === "available") continue;
      const ctx = context({ offerSnapshot: [offerRow({ status })] });
      const decision = decideComputeClearance(request(), ctx);
      expect(reasonSet(decision), `status: ${status}`).toContain("offer_not_available");
    }
  });

  it("denies a workload kind the offer does not support", () => {
    const decision = decideComputeClearance(request({ workloadKind: "batch" }), context());
    expect(reasonSet(decision)).toContain("workload_kind_unsupported");
  });

  it("enforces the offer's residency scope", () => {
    const decision = decideComputeClearance(
      request({ requiredRegion: "region_ap_1" }),
      context(),
    );
    expect(reasonSet(decision)).toContain("residency_violation");
  });

  it("denies when requested concurrency exceeds available capacity", () => {
    const ctx = context({ offerSnapshot: [offerRow({ availableConcurrency: 3 })] });
    expect(reasonSet(decideComputeClearance(request(), ctx))).toContain("capacity_exhausted");
    const boundary = context({ offerSnapshot: [offerRow({ availableConcurrency: 4 })] });
    expect(decideComputeClearance(request(), boundary).outcome).toBe("allow");
  });
});

/* ─────────────────────────────────────────────────────────────
 * Metering: unmetered compute is refused; budgets bind
 * ────────────────────────────────────────────────────────────*/

describe("G-065 metering law", () => {
  it("refuses a request whose metering key has no ledger row", () => {
    const decision = decideComputeClearance(
      request({ budget: { maxCostUsd: 100, meteringKey: "key_unknown" } }),
      context(),
    );
    expect(reasonSet(decision)).toContain("unmetered_request");
  });

  it("requires a positive finite per-allocation budget commitment", () => {
    for (const maxCostUsd of [0, -1, Number.POSITIVE_INFINITY]) {
      const parsed = parseComputeAllocationRequest(
        request({ budget: { maxCostUsd, meteringKey: "key_main" } }),
      );
      expect(parsed.ok, `maxCostUsd: ${maxCostUsd}`).toBe(false);
    }
  });

  it("denies when the period budget for the key is exhausted", () => {
    const ctx = context({
      meteringLedger: [
        { meteringKey: "key_main", consumedCostUsd: 1000, periodBudgetUsd: 1000 },
      ],
    });
    expect(reasonSet(decideComputeClearance(request(), ctx))).toContain("budget_exhausted");
  });

  it("denies when the projection exceeds the per-allocation budget", () => {
    const decision = decideComputeClearance(
      request({ budget: { maxCostUsd: 5, meteringKey: "key_main" } }),
      context(),
    );
    expect(reasonSet(decision)).toContain("budget_exhausted");
    if (decision.outcome === "deny") {
      expect(decision.detail.join(" ")).toContain("per-allocation budget");
    }
  });

  it("denies when the projection exceeds the remaining period budget", () => {
    const ctx = context({
      meteringLedger: [
        { meteringKey: "key_main", consumedCostUsd: 995, periodBudgetUsd: 1000 },
      ],
    });
    const decision = decideComputeClearance(request(), ctx);
    expect(reasonSet(decision)).toContain("budget_exhausted");
    if (decision.outcome === "deny") {
      expect(decision.detail.join(" ")).toContain("remaining period budget");
    }
  });

  it("admits exactly at the budget boundary and never round-drifts past it", () => {
    const ctx = context({
      meteringLedger: [
        { meteringKey: "key_main", consumedCostUsd: 992, periodBudgetUsd: 1000 },
      ],
    });
    expect(decideComputeClearance(request(), ctx).outcome).toBe("allow");
  });
});

/* ─────────────────────────────────────────────────────────────
 * Gateway routing law (§20): capacity, never a second path to models
 * ────────────────────────────────────────────────────────────*/

describe("G-065 gateway routing law", () => {
  it("requires a gateway purpose on every allocation request", () => {
    const parsed = parseComputeAllocationRequest(request({ gatewayPurpose: undefined }));
    expect(parsed.ok).toBe(false);
    const unknownPurpose = parseComputeAllocationRequest(
      request({ gatewayPurpose: "anything_else" }),
    );
    expect(unknownPurpose.ok).toBe(false);
  });

  it("an allowed allocation carries invocationPath `gateway` as a literal", () => {
    const allow = decideComputeClearance(request(), context());
    if (allow.outcome === "allow") {
      expect(allow.invocationPath).toBe("gateway");
    }
    const forged = { ...(allow as object), invocationPath: "direct" };
    expect(parseComputeClearanceDecision(forged).ok).toBe(false);
  });

  it("the allow branch has no caller-settable path field (§20 literal)", () => {
    const allow = decideComputeClearance(request(), context());
    if (allow.outcome !== "allow") throw new Error("expected allow");
    expect(Object.keys(allow).sort()).toEqual(
      [
        "decidedAt",
        "decidedBy",
        "gatewayPurpose",
        "invocationPath",
        "meteringKey",
        "offerRef",
        "outcome",
        "projectedCostUsd",
        "reservedConcurrency",
        "tenantRef",
        "workloadKind",
      ].sort(),
    );
  });
});

/* ─────────────────────────────────────────────────────────────
 * Offer descriptor: bounded, metered-by-declaration, fail closed
 * ────────────────────────────────────────────────────────────*/

describe("G-065 offer descriptor", () => {
  it("parses a valid descriptor", () => {
    expect(parseComputeOfferDescriptor(descriptor()).ok).toBe(true);
  });

  it("refuses an offer that does not explicitly declare tenant scoping", () => {
    const scopedOff = descriptor({
      isolation: { tenantScoped: false, egress: "none" },
    } as unknown as Partial<ComputeOfferDescriptor>);
    expect(parseComputeOfferDescriptor(scopedOff).ok).toBe(false);
    const missing = { ...descriptor() } as Record<string, unknown>;
    delete missing.isolation;
    expect(parseComputeOfferDescriptor(missing).ok).toBe(false);
  });

  it("refuses unmetered offers (no rate, zero rate, negative rate)", () => {
    const missing = { ...descriptor() } as Record<string, unknown>;
    delete missing.capacity;
    expect(parseComputeOfferDescriptor(missing).ok).toBe(false);
    for (const rate of [0, -2]) {
      expect(
        parseComputeOfferDescriptor(
          descriptor({ capacity: { maxConcurrentWorkloads: 8, unitRateUsdPerHour: rate } }),
        ).ok,
        `rate: ${rate}`,
      ).toBe(false);
    }
  });

  it("refuses bounded-capacity violations and empty workload kinds", () => {
    expect(
      parseComputeOfferDescriptor(
        descriptor({ capacity: { maxConcurrentWorkloads: MAX_OFFER_CAPACITY_UNITS + 1, unitRateUsdPerHour: 1 } }),
      ).ok,
    ).toBe(false);
    expect(
      parseComputeOfferDescriptor(
        descriptor({ maxDurationSeconds: MAX_DURATION_SECONDS + 1 } as unknown as Partial<ComputeOfferDescriptor>),
      ).ok,
    ).toBe(false);
    expect(parseComputeOfferDescriptor(descriptor({ workloadKinds: [] })).ok).toBe(false);
    const badKind = descriptor() as unknown as Record<string, unknown>;
    badKind.workloadKinds = ["teleport"];
    expect(parseComputeOfferDescriptor(badKind).ok).toBe(false);
  });

  it("refuses duplicate residency regions and duplicate workload kinds", () => {
    expect(
      parseComputeOfferDescriptor(
        descriptor({
          residency: { mode: "pinned_regions", allowedRegions: ["region_eu_1", "region_eu_1"] },
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseComputeOfferDescriptor(
        descriptor({ workloadKinds: ["serving", "serving"] as unknown as ComputeOfferDescriptor["workloadKinds"] }),
      ).ok,
    ).toBe(false);
  });

  it("pins offer refs to the canonical compute: namespace (kernel ref law)", () => {
    expect(isValidManifestId("compute:alpha")).toBe(true);
    expect(parseComputeOfferDescriptor(descriptor({ offerRef: "not-canonical" })).ok).toBe(false);
    expect(parseComputeOfferDescriptor(descriptor({ offerRef: "widget:alpha" })).ok).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Offer lifecycle transition law
 * ────────────────────────────────────────────────────────────*/

describe("G-065 offer lifecycle law", () => {
  it("moves registered → validated → available and never skips clearance gating", () => {
    expect(canTransitionOfferStatus("registered", "validated")).toBe(true);
    expect(canTransitionOfferStatus("validated", "available")).toBe(true);
    expect(canTransitionOfferStatus("registered", "available")).toBe(false);
  });

  it("retirement is reachable from every non-retired state and terminal", () => {
    for (const status of COMPUTE_OFFER_STATUSES) {
      if (status === "retired") continue;
      expect(canTransitionOfferStatus(status, "retired"), `retire from ${status}`).toBe(true);
    }
    expect(canTransitionOfferStatus("retired", "retired")).toBe(false);
    expect(canTransitionOfferStatus("retired", "available")).toBe(false);
  });

  it("covers every status in the transition map with no orphan vocabulary", () => {
    expect(Object.keys(OFFER_STATUS_TRANSITIONS).sort()).toEqual(
      [...COMPUTE_OFFER_STATUSES].sort(),
    );
    for (const targets of Object.values(OFFER_STATUS_TRANSITIONS)) {
      for (const target of targets) {
        expect((COMPUTE_OFFER_STATUSES as readonly string[]).includes(target)).toBe(true);
      }
    }
    const schemaStatuses = computeOfferStatusSchema.options;
    expect([...schemaStatuses].sort()).toEqual([...COMPUTE_OFFER_STATUSES].sort());
  });
});

/* ─────────────────────────────────────────────────────────────
 * Capacity-status read projection (§27: return permitted data)
 * ────────────────────────────────────────────────────────────*/

describe("G-065 capacity-status projection", () => {
  it("returns only the resolved tenant's rows, never cross-tenant rows", () => {
    const ctx = context({
      offerSnapshot: [
        offerRow(),
        offerRow({ offerRef: "compute:beta", tenantRef: "tenant_b" }),
      ],
    });
    const rows = capacityStatusForTenant(ctx);
    expect(rows.map((row) => row.offerRef)).toEqual(["compute:alpha"]);
  });

  it("derives posture without optimism: non-available offers are unavailable", () => {
    const ctx = context({
      offerSnapshot: [
        offerRow(),
        offerRow({ offerRef: "compute:drained", availableConcurrency: 0 }),
        offerRow({ offerRef: "compute:halted", status: "maintenance" }),
      ],
    });
    const byRef = new Map(capacityStatusForTenant(ctx).map((row) => [row.offerRef, row]));
    expect(byRef.get("compute:alpha")?.posture).toBe("available");
    expect(byRef.get("compute:drained")?.posture).toBe("capacity_exhausted");
    expect(byRef.get("compute:halted")?.posture).toBe("unavailable");
  });

  it("round-trips every projected row through the row schema", () => {
    const ctx = context({
      offerSnapshot: [offerRow(), offerRow({ offerRef: "compute:drained", availableConcurrency: 0 })],
    });
    for (const row of capacityStatusForTenant(ctx)) {
      expect(workloadKindSchema.safeParse(row.workloadKinds[0]).success).toBe(true);
      expect(computeOfferStatusSchema.safeParse(row.status).success).toBe(true);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * Vocabulary lockstep (read-only composition)
 * ────────────────────────────────────────────────────────────*/

describe("G-065 vocabulary lockstep", () => {
  it("gateway-purpose vocabulary matches the metering usage ledger exactly", () => {
    expect([...COMPUTE_GATEWAY_PURPOSES]).toEqual([...GATEWAY_PURPOSES]);
  });

  it("workload-kind vocabulary is bounded and closed", () => {
    expect(WORKLOAD_KINDS.length).toBe(4);
    expect(new Set(WORKLOAD_KINDS).size).toBe(WORKLOAD_KINDS.length);
  });

  it("exposes a complete typed denial-reason vocabulary (no silent failures)", () => {
    expect(DENIAL_REASONS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(DENIAL_REASONS).size).toBe(DENIAL_REASONS.length);
  });

  it("allow and deny decisions round-trip through the decision schema", () => {
    const allow = decideComputeClearance(request(), context());
    expect(parseComputeClearanceDecision(allow).ok).toBe(true);
    const denyDecision = decideComputeClearance({ workloadKind: "serving" }, context());
    expect(parseComputeClearanceDecision(denyDecision).ok).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Module hygiene: pure, typed, vendor-free, domain-neutral (J-037)
 * ────────────────────────────────────────────────────────────*/

describe("G-065 module hygiene", () => {
  const CONTRACT_PATH = join(__dirname, "../../frontend/src/lib/ai-compute/contracts.ts");
  const source = readFileSync(CONTRACT_PATH, "utf8");

  it("contains no `any` and no z.any (strict TypeScript law)", () => {
    expect(source).not.toMatch(/\bz\.any\b/);
    expect(source).not.toMatch(/:\s*any\b/);
    expect(source).not.toMatch(/\bas any\b/);
    expect(source).not.toMatch(/\bany\[\]/);
  });

  it("contains no I/O, no vendor imports, no timers, no environment reads", () => {
    expect(source).not.toMatch(/from\s+["']node:/);
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/\b(createClient|setTimeout|setInterval)\b/);
    expect(source).not.toMatch(/process\.env/);
    for (const vendor of ["supabase", "stripe", "paystack", "openai", "anthropic", "axios"]) {
      expect(source.toLowerCase()).not.toContain(vendor);
    }
  });

  it("contains no domain vocabulary (J-037 neutrality token list)", () => {
    const tokens = [
      "scholar",
      "student",
      "teacher",
      "school",
      "classroom",
      "curriculum",
      "exam",
      "examination",
      "grading",
      "attendance",
      "tuition",
      "timetable",
      "admission",
      "lesson",
      "homework",
      "hostel",
      "bursar",
      "principal",
      "guardian",
      "enrollment",
      "enrolment",
      "academic",
      "payroll",
      "textbook",
      "vibeora",
    ];
    for (const token of tokens) {
      expect(new RegExp(`\\b${token}\\b`, "i").test(source), `token: ${token}`).toBe(false);
    }
    for (const literal of ["'parent'", '"parent"', "'staff'", '"staff"', "'driver'", '"driver"']) {
      expect(source).not.toContain(literal);
    }
  });

  it("never handles secrets or credential-shaped fields", () => {
    expect(source).not.toMatch(/\b(apiKey|api_key|secret|password|token_value|privateKey)\b/);
  });

  it("references the centralized gateway as the only invocation path (§20)", () => {
    expect(source).toContain('ALLOWED_INVOCATION_PATH = "gateway"');
  });
});