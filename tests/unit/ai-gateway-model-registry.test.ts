/**
 * CoreGrid — model registry unit tests (J-014, V1CAP-028, MISSION-R-31).
 *
 * Proves the registry's fail-closed construction, deterministic routing by
 * declared purpose requirements (capability/cost/latency), health-state
 * handoff (a failing model moves healthy -> degraded -> isolated and routing
 * skips it), purpose-scoped fallback chains, and typed denials for
 * unknown/unregistered/unsatisfiable routes. Pure contract tests: no I/O,
 * no provider, no live key (MISSION-R-31 T2 fault injection is a sibling of
 * the gateway wiring suite in ai-gateway.test.ts).
 */
import { describe, expect, it } from "vitest";
import {
  ModelRegistry,
  type DeclaredModel,
  type ModelRoutingRequirements,
} from "../../frontend/src/lib/ai-gateway/model-registry";

function model(overrides: Partial<DeclaredModel> = {}): DeclaredModel {
  return {
    id: "coregrid/flash",
    providerClass: "small-fast",
    profile: { contextWindowTokens: 128_000, latencyTier: "low", costTier: "low" },
    ...overrides,
  };
}

function registryWith(
  models: DeclaredModel[],
  options: { chains?: Record<string, string[]>; health?: { degraded?: number; isolated?: number } } = {},
): ModelRegistry {
  return new ModelRegistry({
    models,
    fallbackChains: options.chains as never,
    health: {
      degradedAfterFailures: options.health?.degraded ?? 1,
      isolatedAfterFailures: options.health?.isolated ?? 3,
    },
  });
}

describe("fail-closed construction", () => {
  it("rejects duplicate model ids", () => {
    expect(
      () =>
        new ModelRegistry({
          models: [model(), model({ providerClass: "other" })],
        }),
    ).toThrow(/duplicate model id/);
  });

  it("rejects malformed profiles and empty identities", () => {
    expect(
      () =>
        new ModelRegistry({
          models: [model({ profile: { contextWindowTokens: 0, latencyTier: "low", costTier: "low" } })],
        }),
    ).toThrow(/contextWindowTokens/);
    expect(
      () =>
        new ModelRegistry({
          models: [model({ profile: { contextWindowTokens: 1000, latencyTier: "instant" as never, costTier: "low" } })],
        }),
    ).toThrow(/latencyTier/);
    expect(() => new ModelRegistry({ models: [model({ id: "   " })] })).toThrow(/non-empty/);
    expect(() => new ModelRegistry({ models: [model({ providerClass: "" })] })).toThrow(/non-empty/);
  });

  it("rejects fallback chains naming unregistered models or unknown purposes", () => {
    expect(
      () =>
        new ModelRegistry({
          models: [model()],
          fallbackChains: { summarization: ["coregrid/flash", "coregrid/deep"] },
        }),
    ).toThrow(/not a registered model/);
    expect(
      () =>
        new ModelRegistry({
          models: [model()],
          fallbackChains: { geophysics: ["coregrid/flash"] } as never,
        }),
    ).toThrow(/unknown purpose/);
  });

  it("rejects inverted health thresholds", () => {
    expect(
      () =>
        new ModelRegistry({
          models: [model()],
          health: { degradedAfterFailures: 5, isolatedAfterFailures: 2 },
        }),
    ).toThrow(/degradedAfterFailures must be <= isolatedAfterFailures/);
  });
});

describe("deterministic routing by purpose requirements", () => {
  const models: DeclaredModel[] = [
    model({ id: "coregrid/deep", providerClass: "deep-reasoning", profile: { contextWindowTokens: 200_000, latencyTier: "high", costTier: "high" } }),
    model({ id: "coregrid/flash", providerClass: "small-fast", profile: { contextWindowTokens: 128_000, latencyTier: "low", costTier: "low" } }),
    model({ id: "coregrid/mid", providerClass: "balanced", profile: { contextWindowTokens: 160_000, latencyTier: "medium", costTier: "medium" } }),
  ];

  it("prefers the lowest latency and cost tiers matching the requirements, deterministically", () => {
    const registry = registryWith(models);
    const requirements: ModelRoutingRequirements = {
      maxLatencyTier: "medium",
      maxCostTier: "medium",
    };
    const first = registry.resolveModel({ purpose: "classification", requirements });
    const second = registry.resolveModel({ purpose: "classification", requirements });
    expect(first.decision).toBe("allow");
    expect(second).toEqual(first);
    if (first.decision === "allow") {
      expect(first.modelId).toBe("coregrid/flash");
      expect(first.candidates).toEqual(["coregrid/flash", "coregrid/mid"]);
      expect(first.providerClass).toBe("small-fast");
    }
  });

  it("filters by minimum context window", () => {
    const registry = registryWith(models);
    const outcome = registry.resolveModel({
      purpose: "summarization",
      requirements: { minContextWindowTokens: 150_000 },
    });
    expect(outcome.decision).toBe("allow");
    if (outcome.decision === "allow") {
      expect(outcome.modelId).toBe("coregrid/deep");
      expect(outcome.candidates).toEqual(["coregrid/deep", "coregrid/mid"]);
    }
  });

  it("uses registration order as the deterministic base when no requirements are declared", () => {
    const registry = registryWith(models);
    const outcome = registry.resolveModel({ purpose: "drafting" });
    expect(outcome.decision).toBe("allow");
    if (outcome.decision === "allow") {
      expect(outcome.modelId).toBe("coregrid/deep");
      expect(outcome.candidates).toEqual(["coregrid/deep", "coregrid/flash", "coregrid/mid"]);
    }
  });

  it("denies with a typed code when no model satisfies the requirements", () => {
    const registry = registryWith(models);
    const outcome = registry.resolveModel({
      purpose: "extraction",
      requirements: { maxLatencyTier: "low", maxCostTier: "low", minContextWindowTokens: 150_000 },
    });
    expect(outcome.decision).toBe("deny");
    if (outcome.decision === "deny") {
      expect(outcome.code).toBe("no_routable_model");
      expect(outcome.reason).toContain("satisfies the declared requirements");
    }
  });
});

describe("fallback chains per purpose", () => {
  const models: DeclaredModel[] = [
    model({ id: "coregrid/primary" }),
    model({ id: "coregrid/secondary", providerClass: "balanced", profile: { contextWindowTokens: 100_000, latencyTier: "medium", costTier: "medium" } }),
    model({ id: "coregrid/tertiary", providerClass: "deep-reasoning", profile: { contextWindowTokens: 200_000, latencyTier: "high", costTier: "high" } }),
  ];

  it("routes through the declared chain order when no model is explicitly declared", () => {
    const registry = registryWith(models, {
      chains: { support: ["coregrid/secondary", "coregrid/tertiary"] },
    });
    expect(registry.fallbackChainFor("support")).toEqual(["coregrid/secondary", "coregrid/tertiary"]);
    const outcome = registry.resolveModel({ purpose: "support" });
    expect(outcome.decision).toBe("allow");
    if (outcome.decision === "allow") {
      expect(outcome.candidates).toEqual(["coregrid/secondary", "coregrid/tertiary"]);
    }
  });

  it("prepends an explicitly declared registered model ahead of the chain", () => {
    const registry = registryWith(models, {
      chains: { support: ["coregrid/secondary", "coregrid/tertiary"] },
    });
    const outcome = registry.resolveModel({ purpose: "support", declaredModel: "coregrid/tertiary" });
    expect(outcome.decision).toBe("allow");
    if (outcome.decision === "allow") {
      expect(outcome.candidates).toEqual(["coregrid/tertiary", "coregrid/secondary"]);
    }
  });

  it("applies requirements to chain candidates", () => {
    const registry = registryWith(models, {
      chains: { support: ["coregrid/secondary", "coregrid/tertiary"] },
    });
    const outcome = registry.resolveModel({
      purpose: "support",
      requirements: { maxLatencyTier: "low" },
    });
    expect(outcome.decision).toBe("deny");
    if (outcome.decision === "deny") expect(outcome.code).toBe("no_routable_model");
  });
});

describe("health state machine and unhealthy-model skip", () => {
  const models: DeclaredModel[] = [
    model({ id: "coregrid/primary" }),
    model({ id: "coregrid/fallback", providerClass: "balanced", profile: { contextWindowTokens: 100_000, latencyTier: "medium", costTier: "medium" } }),
  ];

  it("moves a failing model healthy -> degraded -> isolated per thresholds", () => {
    const registry = registryWith(models, { health: { degraded: 1, isolated: 3 } });
    expect(registry.healthOf("coregrid/primary")).toBe("healthy");
    expect(registry.recordFailure("coregrid/primary")).toBe("degraded");
    expect(registry.recordFailure("coregrid/primary")).toBe("degraded");
    expect(registry.recordFailure("coregrid/primary")).toBe("isolated");
    const snap = registry.healthSnapshot().find((s) => s.id === "coregrid/primary");
    expect(snap).toMatchObject({
      id: "coregrid/primary",
      health: "isolated",
      consecutiveFailures: 3,
    });
  });

  it("resets a model to healthy on success", () => {
    const registry = registryWith(models);
    registry.recordFailure("coregrid/primary");
    expect(registry.healthOf("coregrid/primary")).toBe("degraded");
    expect(registry.recordSuccess("coregrid/primary")).toBe("healthy");
    expect(registry.healthOf("coregrid/primary")).toBe("healthy");
  });

  it("routing skips unhealthy models and selects the next healthy candidate", () => {
    const registry = registryWith(models);
    registry.recordFailure("coregrid/primary");
    const outcome = registry.resolveModel({ purpose: "classification" });
    expect(outcome.decision).toBe("allow");
    if (outcome.decision === "allow") {
      expect(outcome.modelId).toBe("coregrid/fallback");
      expect(outcome.candidates).toEqual(["coregrid/fallback"]);
    }
  });

  it("denies with a typed code when every matching model is unhealthy", () => {
    const registry = registryWith(models);
    registry.recordFailure("coregrid/primary");
    registry.recordFailure("coregrid/fallback");
    const outcome = registry.resolveModel({ purpose: "classification" });
    expect(outcome.decision).toBe("deny");
    if (outcome.decision === "deny") {
      expect(outcome.code).toBe("no_routable_model");
      expect(outcome.reason).toContain("unhealthy");
    }
  });

  it("supports operator-declared health (quarantine) and re-arms the state machine", () => {
    const registry = registryWith(models);
    expect(registry.declareHealth("coregrid/primary", "isolated")).toBe("isolated");
    const quarantined = registry.resolveModel({ purpose: "classification" });
    expect(quarantined.decision).toBe("allow");
    if (quarantined.decision === "allow") {
      expect(quarantined.modelId).toBe("coregrid/fallback");
    }
    expect(registry.recordSuccess("coregrid/primary")).toBe("healthy");
    const outcome = registry.resolveModel({ purpose: "classification" });
    expect(outcome.decision).toBe("allow");
    if (outcome.decision === "allow") expect(outcome.modelId).toBe("coregrid/primary");
  });

  it("honors initialHealth declared on a model", () => {
    const registry = registryWith([
      model({ id: "coregrid/primary", initialHealth: "isolated" }),
      model({ id: "coregrid/fallback", providerClass: "balanced", profile: { contextWindowTokens: 100_000, latencyTier: "medium", costTier: "medium" } }),
    ]);
    expect(registry.healthOf("coregrid/primary")).toBe("isolated");
    const outcome = registry.resolveModel({ purpose: "classification" });
    expect(outcome.decision).toBe("allow");
    if (outcome.decision === "allow") expect(outcome.modelId).toBe("coregrid/fallback");
  });

  it("throws on unknown model ids (programming errors are never health verdicts)", () => {
    const registry = registryWith(models);
    expect(() => registry.healthOf("coregrid/unknown")).toThrow(/unknown model/);
    expect(() => registry.recordFailure("coregrid/unknown")).toThrow(/unknown model/);
    expect(() => registry.recordSuccess("coregrid/unknown")).toThrow(/unknown model/);
    expect(() => registry.describeModel("coregrid/unknown")).toThrow(/unknown model/);
  });
});

describe("typed routing denials (fail closed)", () => {
  const registry = registryWith([model()]);

  it("denies unknown purposes", () => {
    const outcome = registry.resolveModel({ purpose: "geophysics" as never });
    expect(outcome.decision).toBe("deny");
    if (outcome.decision === "deny") {
      expect(outcome.code).toBe("unknown_purpose");
      expect(outcome.reason).toContain("not an organizational-intelligence purpose");
    }
  });

  it("denies unregistered declared models", () => {
    const outcome = registry.resolveModel({ purpose: "summarization", declaredModel: "vendor/unlisted" });
    expect(outcome.decision).toBe("deny");
    if (outcome.decision === "deny") {
      expect(outcome.code).toBe("unregistered_model");
      expect(outcome.reason).toContain("not registered");
    }
  });

  it("denies when the registry declares no models", () => {
    const empty = new ModelRegistry({ models: [] });
    const outcome = empty.resolveModel({ purpose: "summarization" });
    expect(outcome.decision).toBe("deny");
    if (outcome.decision === "deny") expect(outcome.code).toBe("no_registered_model");
  });

  it("rejects a fallback chain set post-construction that names unknown models", () => {
    const late = registryWith([model()]);
    expect(() => late.setFallbackChain("support", ["coregrid/ghost"])).toThrow(
      /not a registered model/,
    );
    expect(() => late.setFallbackChain("support", ["coregrid/flash", "coregrid/flash"])).toThrow(
      /duplicate entry/,
    );
  });
});