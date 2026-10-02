/**
 * CoreGrid — AI gateway tests (V5.3 MISSION-V1-010: fail-closed decisions,
 * rate-limit boundaries, budget denial, unconfigured-key denial, attribution
 * completeness, and redaction — no key material in any log output).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAiGatewayProvider,
  createRateLimiter,
  invokeAiGateway,
  AI_GATEWAY_FAILURE_POLICY,
  type AiGatewayInvokeRequest,
  type AiGatewayProvider,
} from "../../frontend/src/lib/ai-gateway.server";
import {
  GATEWAY_PURPOSES,
  UsageLedger,
  type ModelRateTable,
  type UsageRecord,
} from "../../frontend/src/lib/metering/usage-ledger";
import type { LogSink } from "../../frontend/src/lib/observability/structured-log";
import {
  createAdapterFailurePolicy,
  type AdapterClock,
} from "../../frontend/src/lib/adapters/failure-policy";
import {
  ModelRegistry,
  type DeclaredModel,
} from "../../frontend/src/lib/ai-gateway/model-registry";
import {
  ReasoningProvenanceError,
  digestContent,
  validateIntelligenceSnapshot,
  type IntelligenceSnapshot,
} from "../../frontend/src/lib/ai-gateway/reasoning-provenance";

/** Deferred-delay clock: the timeout fires only when the test fires it. */
function manualClock(startMs = 1_000_000) {
  const now = startMs;
  const pending: (() => void)[] = [];
  const clock: AdapterClock = {
    nowMs: () => now,
    delay: () =>
      new Promise<void>((resolve) => {
        pending.push(resolve);
      }),
  };
  return {
    clock,
    fireDelays(): void {
      const all = pending.splice(0, pending.length);
      for (const fire of all) fire();
    },
  };
}

/** Flush queued microtasks so the policy has registered its timeout delay. */
const tick = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Fixture credential marker. Every redaction assertion in this file checks
 * that this exact string never appears in any captured log line.
 */
const FIXTURE_KEY = "sk-fixture-secret-marker-COREGRID-9f2a7c31";
const RATES: ModelRateTable = {
  "coregrid/flash": {
    provider: "provider-x",
    inputUsdPerMillionTokens: 1,
    outputUsdPerMillionTokens: 2,
  },
};

function captureSink(): { lines: string[]; sink: LogSink } {
  const lines: string[] = [];
  return { lines, sink: (line) => lines.push(line) };
}

function seededLedger(overrides: Partial<UsageRecord> = {}): UsageLedger {
  const ledger = new UsageLedger(RATES);
  ledger.recordUsage({
    tenantRef: "tenant-a",
    actorRef: "user-1",
    agentRef: null,
    missionRef: null,
    model: "coregrid/flash",
    provider: "provider-x",
    purpose: "summarization",
    tokensIn: 1_000_000,
    tokensOut: 500_000,
    durationMs: 120,
    ...overrides,
  });
  return ledger;
}

type TestRequest = Omit<AiGatewayInvokeRequest<{ ok: boolean }>, "apiKey"> & {
  apiKey?: string;
};

function baseRequest(overrides: Partial<TestRequest> = {}): TestRequest {
  return {
    tenantRef: "tenant-a",
    actorRef: "user-1",
    model: "coregrid/flash",
    provider: "provider-x",
    purpose: "summarization",
    apiKey: FIXTURE_KEY,
    invoke: vi.fn(async () => ({ payload: { ok: true }, tokensIn: 100, tokensOut: 40 })),
    ...overrides,
  };
}

const ORIGINAL_AI_API_KEY = process.env.AI_API_KEY;

afterEach(() => {
  if (ORIGINAL_AI_API_KEY === undefined) {
    delete process.env.AI_API_KEY;
  } else {
    process.env.AI_API_KEY = ORIGINAL_AI_API_KEY;
  }
});

describe("createAiGatewayProvider (existing export signature preserved)", () => {
  it("still returns a callable provider factory", () => {
    const provider = createAiGatewayProvider(FIXTURE_KEY);
    expect(typeof provider).toBe("function");
  });
});

describe("unconfigured gateway denial (BLK-2, fail closed)", () => {
  it("denies with code 'unconfigured' when no key is resolvable", async () => {
    delete process.env.AI_API_KEY;
    const request = baseRequest({ apiKey: undefined });
    const outcome = await invokeAiGateway(request);
    expect(outcome.decision).toBe("deny");
    if (outcome.decision === "deny") {
      expect(outcome.code).toBe("unconfigured");
      expect(outcome.reason).toContain("BLK-2");
    }
    expect(request.invoke as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("denies on empty-string and whitespace-only keys without invoking", async () => {
    delete process.env.AI_API_KEY;
    for (const apiKey of ["", "   "]) {
      const request = baseRequest({ apiKey });
      const outcome = await invokeAiGateway(request);
      expect(outcome.decision).toBe("deny");
      if (outcome.decision === "deny") {
        expect(outcome.code).toBe("unconfigured");
      }
      expect(request.invoke as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    }
  });

  it("logs the unconfigured decision without leaking any key material", async () => {
    delete process.env.AI_API_KEY;
    const { lines, sink } = captureSink();
    await invokeAiGateway(baseRequest({ apiKey: "", logSink: sink }));
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('"msg":"gateway.decision.deny"');
    expect(lines[0]).toContain('"code":"unconfigured"');
    expect(lines[0]).not.toContain(FIXTURE_KEY);
  });
});

describe("redaction (no key values in any log output)", () => {
  it("never emits the key on the allow path, even when refs embed it", async () => {
    const { lines, sink } = captureSink();
    const outcome = await invokeAiGateway(
      baseRequest({
        logSink: sink,
        missionRef: `mission-with-${FIXTURE_KEY}`,
        agentRef: `agent-with-${FIXTURE_KEY}`,
      }),
    );
    expect(outcome.decision).toBe("allow");
    expect(lines.some((line) => line.includes("gateway.invoke.start"))).toBe(true);
    expect(lines.some((line) => line.includes("gateway.invoke.end"))).toBe(true);
    for (const line of lines) {
      expect(line).not.toContain(FIXTURE_KEY);
    }
    const start = lines.find((line) => line.includes("gateway.invoke.start")) ?? "";
    expect(start).toContain('"mission_ref":"mission-with-[REDACTED]"');
    expect(start).toContain('"agent_ref":"agent-with-[REDACTED]"');
  });

  it("scrubs a key sourced from the environment fallback", async () => {
    process.env.AI_API_KEY = FIXTURE_KEY;
    const { lines, sink } = captureSink();
    const outcome = await invokeAiGateway(baseRequest({ apiKey: undefined, logSink: sink }));
    expect(outcome.decision).toBe("allow");
    for (const line of lines) {
      expect(line).not.toContain(FIXTURE_KEY);
    }
  });

  it("never leaks the key through invocation-error logs", async () => {
    const { lines, sink } = captureSink();
    const failing = baseRequest({
      logSink: sink,
      invoke: vi.fn(async () => {
        throw new Error(`provider exploded with ${FIXTURE_KEY}`);
      }),
    });
    await expect(invokeAiGateway(failing)).rejects.toThrow(/provider exploded/);
    for (const line of lines) {
      expect(line).not.toContain(FIXTURE_KEY);
    }
    const errorLine = lines.find((line) => line.includes("gateway.invoke.error")) ?? "";
    expect(errorLine).toContain("Error: provider exploded with");
  });
});

describe("budget pre-check (ledger consulted before invocation)", () => {
  it("denies with code 'budget_exhausted' when the request budget is spent", async () => {
    const ledger = seededLedger();
    const request = baseRequest({ ledger, budget: { maxRequests: 1 } });
    const outcome = await invokeAiGateway(request);
    expect(outcome.decision).toBe("deny");
    if (outcome.decision === "deny") {
      expect(outcome.code).toBe("budget_exhausted");
      expect(outcome.reason).toContain("Request budget exhausted");
    }
    expect(request.invoke as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("denies on token and cost budgets", async () => {
    const tokenBudget = seededLedger();
    const tokenOutcome = await invokeAiGateway(
      baseRequest({ ledger: tokenBudget, budget: { maxTokensIn: 1_000_000 } }),
    );
    expect(tokenOutcome.decision).toBe("deny");
    if (tokenOutcome.decision === "deny") {
      expect(tokenOutcome.code).toBe("budget_exhausted");
      expect(tokenOutcome.reason).toContain("Input token budget exhausted");
    }

    const costBudget = seededLedger();
    const costOutcome = await invokeAiGateway(
      baseRequest({ ledger: costBudget, budget: { maxCostUsd: 2 } }),
    );
    expect(costOutcome.decision).toBe("deny");
    if (costOutcome.decision === "deny") {
      expect(costOutcome.reason).toContain("Cost budget exhausted");
    }
  });

  it("allows and meters when the budget still has headroom", async () => {
    const ledger = seededLedger();
    const request = baseRequest({
      ledger,
      budget: { maxRequests: 5, maxCostUsd: 100 },
      rates: RATES,
    });
    const outcome = await invokeAiGateway(request);
    expect(outcome.decision).toBe("allow");
    expect(ledger.all().length).toBe(2);
  });

  it("does not consult a budget when no ledger is supplied", async () => {
    const outcome = await invokeAiGateway(baseRequest({ budget: { maxRequests: 0 } }));
    expect(outcome.decision).toBe("allow");
  });
});

describe("rate limiting (sliding window, boundary cases)", () => {
  it("allows maxRequests then denies the next within the window", async () => {
    const clock = 1_000_000;
    const limiter = createRateLimiter({ maxRequests: 2, windowMs: 1_000 });
    const first = await invokeAiGateway(baseRequest({ rateLimiter: limiter, now: () => clock }));
    const second = await invokeAiGateway(baseRequest({ rateLimiter: limiter, now: () => clock }));
    const invoke = baseRequest({ rateLimiter: limiter, now: () => clock });
    const third = await invokeAiGateway(invoke);
    expect(first.decision).toBe("allow");
    expect(second.decision).toBe("allow");
    expect(third.decision).toBe("deny");
    if (third.decision === "deny") {
      expect(third.code).toBe("rate_limited");
      expect(third.reason).toContain("retry after");
    }
    expect(invoke.invoke as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("re-allows once the window has elapsed", async () => {
    let clock = 1_000_000;
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 500 });
    const now = () => clock;
    expect((await invokeAiGateway(baseRequest({ rateLimiter: limiter, now }))).decision).toBe(
      "allow",
    );
    expect((await invokeAiGateway(baseRequest({ rateLimiter: limiter, now }))).decision).toBe(
      "deny",
    );
    clock += 501;
    expect((await invokeAiGateway(baseRequest({ rateLimiter: limiter, now }))).decision).toBe(
      "allow",
    );
  });

  it("reports a positive retryAfterMs at the boundary", () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 1_000 });
    expect(limiter.check("tenant-a:user-1", 10_000)).toEqual({ decision: "allow" });
    const denied = limiter.check("tenant-a:user-1", 10_000);
    expect(denied.decision).toBe("deny");
    if (denied.decision === "deny") {
      expect(denied.retryAfterMs).toBeGreaterThan(0);
      expect(denied.retryAfterMs).toBeLessThanOrEqual(1_000);
    }
  });

  it("isolates windows per tenantRef:actorRef", () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 1_000 });
    expect(limiter.check("tenant-a:user-1", 1).decision).toBe("allow");
    expect(limiter.check("tenant-a:user-1", 1).decision).toBe("deny");
    expect(limiter.check("tenant-b:user-1", 1).decision).toBe("allow");
    expect(limiter.check("tenant-a:user-2", 1).decision).toBe("allow");
  });

  it("fails closed on zero or malformed configuration", () => {
    const zero = createRateLimiter({ maxRequests: 0, windowMs: 1_000 });
    const noWindow = createRateLimiter({ maxRequests: 5, windowMs: 0 });
    const badWindow = createRateLimiter({ maxRequests: 5, windowMs: Number.NaN });
    for (const limiter of [zero, noWindow, badWindow]) {
      const denied = limiter.check("tenant-a:user-1", 1);
      expect(denied.decision).toBe("deny");
      if (denied.decision === "deny") expect(denied.retryAfterMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("floors fractional maxRequests instead of rounding up", () => {
    const limiter = createRateLimiter({ maxRequests: 1.9, windowMs: 1_000 });
    expect(limiter.check("k", 1).decision).toBe("allow");
    expect(limiter.check("k", 1).decision).toBe("deny");
  });
});

describe("metering hooks and attribution completeness (Part 49)", () => {
  it("emits start/end hooks with duration and usage on the end line", async () => {
    const { lines, sink } = captureSink();
    let clock = 5_000;
    const outcome = await invokeAiGateway(
      baseRequest({
        logSink: sink,
        rates: RATES,
        now: () => {
          clock += 150;
          return clock;
        },
      }),
    );
    expect(outcome.decision).toBe("allow");
    const end = lines.find((line) => line.includes("gateway.invoke.end")) ?? "";
    expect(end).toContain('"duration_ms":150');
    expect(end).toContain('"usage_in":100');
    expect(end).toContain('"usage_out":40');
    expect(end).toContain('"estimated_cost_usd":0.00018');
  });

  it("records fully attributed usage for every invocation", async () => {
    const ledger = new UsageLedger(RATES);
    await invokeAiGateway(
      baseRequest({
        ledger,
        rates: RATES,
        agentRef: "agent-1",
        missionRef: "mission-42",
      }),
    );
    await invokeAiGateway(
      baseRequest({
        ledger,
        rates: RATES,
        tenantRef: "tenant-b",
        actorRef: "user-2",
        purpose: "classification",
      }),
    );
    const records = ledger.all();
    expect(records.length).toBe(2);
    for (const record of records) {
      expect(record.tenantRef.trim().length).toBeGreaterThan(0);
      expect(record.actorRef.trim().length).toBeGreaterThan(0);
      expect(record.model.trim().length).toBeGreaterThan(0);
      expect(record.provider.trim().length).toBeGreaterThan(0);
      expect(GATEWAY_PURPOSES).toContain(record.purpose);
      expect(record.tokensIn).toBeGreaterThanOrEqual(0);
      expect(record.tokensOut).toBeGreaterThanOrEqual(0);
    }
    expect(ledger.tenantTotals("tenant-a").requests).toBe(1);
    expect(ledger.tenantTotals("tenant-b").requests).toBe(1);
    expect(ledger.agentTotals("agent-1").requests).toBe(1);
    expect(ledger.missionTotals("mission-42").requests).toBe(1);
  });

  it("returns usage matching the ledger record and rate-table estimate", async () => {
    const ledger = new UsageLedger(RATES);
    const outcome = await invokeAiGateway(
      baseRequest({ ledger, rates: RATES, missionRef: "mission-7" }),
    );
    if (outcome.decision !== "allow") {
      throw new Error("expected allow outcome");
    }
    const usage: UsageRecord = outcome.usage;
    expect(usage.estimatedCostUsd).toBeCloseTo((100 / 1e6) * 1 + (40 / 1e6) * 2, 12);
    expect(ledger.all()[0]).toEqual(usage);
    expect(outcome.payload).toEqual({ ok: true });
  });

  it("leaves estimatedCostUsd null without a rate table", async () => {
    const outcome = await invokeAiGateway(baseRequest({}));
    if (outcome.decision !== "allow") {
      throw new Error("expected allow outcome");
    }
    expect(outcome.usage.estimatedCostUsd).toBeNull();
  });

  it("records no usage when the invocation fails, and rethrows", async () => {
    const ledger = new UsageLedger(RATES);
    const failing = baseRequest({
      ledger,
      invoke: vi.fn(async () => {
        throw new Error("provider down");
      }),
    });
    await expect(invokeAiGateway(failing)).rejects.toThrow("provider down");
    expect(ledger.all().length).toBe(0);
  });

  it("passes a live provider factory to the invoke callback", async () => {
    let received: AiGatewayProvider | null = null;
    const outcome = await invokeAiGateway(
      baseRequest({
        invoke: async (provider) => {
          received = provider;
          return { payload: { ok: true }, tokensIn: 1, tokensOut: 1 };
        },
      }),
    );
    expect(outcome.decision).toBe("allow");
    expect(typeof received).toBe("function");
  });
});

/* ─────────────────────────────────────────────────────────────
 * J-045 failure-policy wiring (additive; legacy path unchanged)
 * ────────────────────────────────────────────────────────────*/

describe("adapter failure policy wiring (J-045)", () => {
  function wiredPolicy() {
    return createAdapterFailurePolicy({
      provider: "ai-gateway",
      timeoutMs: 1_000,
      maxAttempts: 1,
      backoffBaseMs: 100,
      backoffCapMs: 1_000,
      degradedAfterFailures: 2,
      degradedWindowMs: 10_000,
      breakerFailureThreshold: 3,
      breakerResetMs: 5_000,
    });
  }

  it("declares the module-level gateway policy", () => {
    expect(AI_GATEWAY_FAILURE_POLICY.snapshot().provider).toBe("ai-gateway");
    expect(AI_GATEWAY_FAILURE_POLICY.snapshot().declared.maxAttempts).toBe(1);
  });

  it("returns a contained provider_failed denial instead of rethrowing", async () => {
    const policy = wiredPolicy();
    const ledger = new UsageLedger(RATES);
    const outcome = await invokeAiGateway(
      baseRequest({
        ledger,
        failurePolicy: policy,
        invoke: async () => {
          throw new Error("provider down");
        },
      }),
    );
    expect(outcome.decision).toBe("deny");
    if (outcome.decision === "deny") {
      expect(outcome.code).toBe("provider_failed");
      expect(outcome.reason).toContain("provider down");
      expect(outcome.reason).toContain("adapter boundary");
    }
    expect(ledger.all()).toHaveLength(0);
    expect(policy.snapshot()).toMatchObject({
      provider: "ai-gateway",
      totalCalls: 1,
      totalFailures: 1,
      consecutiveFailures: 1,
    });
    expect(policy.trustBasis().totalFailures).toBe(1);
  });

  it("enforces the per-call timeout on a hung provider", async () => {
    const time = manualClock();
    const policy = createAdapterFailurePolicy({
      provider: "ai-gateway",
      timeoutMs: 1_000,
      maxAttempts: 1,
      backoffBaseMs: 100,
      backoffCapMs: 1_000,
      degradedAfterFailures: 2,
      degradedWindowMs: 10_000,
      breakerFailureThreshold: 3,
      breakerResetMs: 5_000,
      clock: time.clock,
    });
    const pendingInvoke = invokeAiGateway(
      baseRequest({
        failurePolicy: policy,
        invoke: () => new Promise<never>(() => {}),
      }),
    );
    await tick();
    time.fireDelays();
    const outcome = await pendingInvoke;
    expect(outcome.decision).toBe("deny");
    if (outcome.decision === "deny") {
      expect(outcome.code).toBe("provider_failed");
      expect(outcome.reason).toContain("timeout");
    }
  });

  it("still meters usage on success through the policy path", async () => {
    const policy = wiredPolicy();
    const ledger = new UsageLedger(RATES);
    const outcome = await invokeAiGateway(
      baseRequest({ ledger, rates: RATES, failurePolicy: policy }),
    );
    expect(outcome.decision).toBe("allow");
    expect(ledger.all()).toHaveLength(1);
    expect(policy.snapshot()).toMatchObject({ totalCalls: 1, totalFailures: 0 });
  });

  it("arms degraded mode after repeated contained failures", async () => {
    const policy = wiredPolicy();
    for (let i = 0; i < 2; i += 1) {
      await invokeAiGateway(
        baseRequest({
          failurePolicy: policy,
          invoke: async () => {
            throw new Error("provider down");
          },
        }),
      );
    }
    const snap = policy.snapshot();
    expect(snap.mode).toBe("degraded");
    expect(snap.degradedActive).toBe(true);
    // Two failures stay below the trust floor (breaker threshold 3).
    expect(policy.recommendTrust().verdict).toBe("unproven");
    await invokeAiGateway(
      baseRequest({
        failurePolicy: policy,
        invoke: async () => {
          throw new Error("provider down");
        },
      }),
    );
    expect(policy.recommendTrust().verdict).toBe("untrusted");
  });
});

/* ─────────────────────────────────────────────────────────────
 * J-014 model registry routing (additive; legacy path unchanged)
 * ────────────────────────────────────────────────────────────*/

describe("model registry routing inside the gateway (J-014, V1CAP-028)", () => {
  const REGISTRY_RATES: ModelRateTable = {
    "coregrid/flash": RATES["coregrid/flash"],
    "coregrid/deep": {
      provider: "provider-y",
      inputUsdPerMillionTokens: 5,
      outputUsdPerMillionTokens: 10,
    },
  };

  function smallPolicy() {
    return createAdapterFailurePolicy({
      provider: "ai-gateway",
      timeoutMs: 1_000,
      maxAttempts: 1,
      backoffBaseMs: 100,
      backoffCapMs: 1_000,
      degradedAfterFailures: 2,
      degradedWindowMs: 10_000,
      breakerFailureThreshold: 3,
      breakerResetMs: 5_000,
    });
  }

  function registryModel(id: string, overrides: Partial<DeclaredModel> = {}): DeclaredModel {
    return {
      id,
      providerClass: "small-fast",
      profile: { contextWindowTokens: 128_000, latencyTier: "low", costTier: "low" },
      ...overrides,
    };
  }

  function testRegistry(): ModelRegistry {
    return new ModelRegistry({
      models: [
        registryModel("coregrid/flash"),
        registryModel("coregrid/deep", {
          providerClass: "deep-reasoning",
          profile: { contextWindowTokens: 200_000, latencyTier: "high", costTier: "high" },
        }),
      ],
      fallbackChains: { summarization: ["coregrid/flash", "coregrid/deep"] },
    });
  }

  it("routes the declared model through the registry and hands the resolved context to invoke", async () => {
    const ledger = new UsageLedger(REGISTRY_RATES);
    let context: { model: string; providerClass: string | null } | null = null;
    const outcome = await invokeAiGateway(
      baseRequest({
        ledger,
        rates: REGISTRY_RATES,
        modelRegistry: testRegistry(),
        failurePolicy: smallPolicy(),
        invoke: async (_provider, ctx) => {
          context = ctx;
          return { payload: { ok: true }, tokensIn: 100, tokensOut: 40 };
        },
      }),
    );
    expect(outcome.decision).toBe("allow");
    expect(context).toEqual({ model: "coregrid/flash", providerClass: "small-fast" });
    expect(ledger.all()).toHaveLength(1);
    expect(ledger.all()[0].model).toBe("coregrid/flash");
    if (outcome.decision === "allow") expect(outcome.usage.model).toBe("coregrid/flash");
  });

  it("keeps the legacy declared path: invoke receives the declared model with a null provider class", async () => {
    let context: { model: string; providerClass: string | null } | null = null;
    const outcome = await invokeAiGateway(
      baseRequest({
        invoke: async (_provider, ctx) => {
          context = ctx;
          return { payload: { ok: true }, tokensIn: 1, tokensOut: 1 };
        },
      }),
    );
    expect(outcome.decision).toBe("allow");
    expect(context).toEqual({ model: "coregrid/flash", providerClass: null });
  });

  it("denies an unregistered declared model, fail closed, without any provider contact", async () => {
    const request = baseRequest({
      model: "vendor/unlisted",
      modelRegistry: testRegistry(),
      failurePolicy: smallPolicy(),
    });
    const outcome = await invokeAiGateway(request);
    expect(outcome.decision).toBe("deny");
    if (outcome.decision === "deny") {
      expect(outcome.code).toBe("model_unroutable");
      expect(outcome.reason).toContain("not registered");
    }
    expect(request.invoke as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("routes by declared requirements, skipping a declared model that does not satisfy them", async () => {
    const seen: string[] = [];
    const outcome = await invokeAiGateway(
      baseRequest({
        model: "coregrid/deep",
        modelRegistry: testRegistry(),
        failurePolicy: smallPolicy(),
        routingRequirements: { maxLatencyTier: "low" },
        invoke: async (_provider, ctx) => {
          seen.push(ctx.model);
          return { payload: { ok: true }, tokensIn: 1, tokensOut: 1 };
        },
      }),
    );
    expect(outcome.decision).toBe("allow");
    expect(seen).toEqual(["coregrid/flash"]);
  });

  it("falls back to the next healthy candidate on failure, metering only the successful attempt", async () => {
    const registry = testRegistry();
    const ledger = new UsageLedger(REGISTRY_RATES);
    const attempted: string[] = [];
    const outcome = await invokeAiGateway(
      baseRequest({
        ledger,
        rates: REGISTRY_RATES,
        modelRegistry: registry,
        failurePolicy: smallPolicy(),
        invoke: async (_provider, ctx) => {
          attempted.push(ctx.model);
          if (ctx.model === "coregrid/flash") throw new Error("provider down");
          return { payload: { ok: true }, tokensIn: 10, tokensOut: 5 };
        },
      }),
    );
    expect(outcome.decision).toBe("allow");
    expect(attempted).toEqual(["coregrid/flash", "coregrid/deep"]);
    expect(ledger.all()).toHaveLength(1);
    expect(ledger.all()[0].model).toBe("coregrid/deep");
    expect(ledger.all()[0].estimatedCostUsd).toBeCloseTo((10 / 1e6) * 5 + (5 / 1e6) * 10, 12);
    expect(registry.healthOf("coregrid/flash")).toBe("degraded");
    expect(registry.healthOf("coregrid/deep")).toBe("healthy");
  });

  it("denies with provider_failed when every routed candidate fails, degrading each model", async () => {
    const registry = testRegistry();
    const ledger = new UsageLedger(REGISTRY_RATES);
    const attempted: string[] = [];
    const outcome = await invokeAiGateway(
      baseRequest({
        ledger,
        modelRegistry: registry,
        failurePolicy: smallPolicy(),
        invoke: async (_provider, ctx) => {
          attempted.push(ctx.model);
          throw new Error("provider down");
        },
      }),
    );
    expect(outcome.decision).toBe("deny");
    if (outcome.decision === "deny") {
      expect(outcome.code).toBe("provider_failed");
      expect(outcome.reason).toContain("provider down");
      expect(outcome.reason).toContain("coregrid/flash");
    }
    expect(attempted).toEqual(["coregrid/flash", "coregrid/deep"]);
    expect(ledger.all()).toHaveLength(0);
    expect(registry.healthOf("coregrid/flash")).toBe("degraded");
    expect(registry.healthOf("coregrid/deep")).toBe("degraded");
  });

  it("re-applies the rate limit per fallback attempt (governed path, no provider escape)", async () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 1_000 });
    const registry = testRegistry();
    const attempted: string[] = [];
    const outcome = await invokeAiGateway(
      baseRequest({
        modelRegistry: registry,
        failurePolicy: smallPolicy(),
        rateLimiter: limiter,
        now: () => 1_000_000,
        invoke: async (_provider, ctx) => {
          attempted.push(ctx.model);
          if (ctx.model === "coregrid/flash") throw new Error("provider down");
          return { payload: { ok: true }, tokensIn: 1, tokensOut: 1 };
        },
      }),
    );
    expect(outcome.decision).toBe("deny");
    if (outcome.decision === "deny") {
      expect(outcome.code).toBe("rate_limited");
      expect(outcome.reason).toContain("retry after");
    }
    expect(attempted).toEqual(["coregrid/flash"]);
    expect(registry.healthOf("coregrid/flash")).toBe("degraded");
    expect(registry.healthOf("coregrid/deep")).toBe("healthy");
  });

  it("applies the budget pre-check to the routed path before any provider contact", async () => {
    const ledger = seededLedger();
    const request = baseRequest({
      ledger,
      budget: { maxRequests: 1 },
      modelRegistry: testRegistry(),
      failurePolicy: smallPolicy(),
    });
    const outcome = await invokeAiGateway(request);
    expect(outcome.decision).toBe("deny");
    if (outcome.decision === "deny") {
      expect(outcome.code).toBe("budget_exhausted");
      expect(outcome.reason).toContain("Request budget exhausted");
    }
    expect(request.invoke as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("denies with model_unroutable when no routed candidate is healthy, without invoking", async () => {
    const registry = testRegistry();
    registry.declareHealth("coregrid/flash", "isolated");
    registry.declareHealth("coregrid/deep", "isolated");
    const request = baseRequest({
      modelRegistry: registry,
      failurePolicy: smallPolicy(),
    });
    const outcome = await invokeAiGateway(request);
    expect(outcome.decision).toBe("deny");
    if (outcome.decision === "deny") {
      expect(outcome.code).toBe("model_unroutable");
      expect(outcome.reason).toContain("unhealthy");
    }
    expect(request.invoke as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("clears a degraded model back to healthy after recovery", async () => {
    const registry = testRegistry();
    registry.recordFailure("coregrid/flash");
    const attempted: string[] = [];
    await invokeAiGateway(
      baseRequest({
        modelRegistry: registry,
        failurePolicy: smallPolicy(),
        invoke: async (_provider, ctx) => {
          attempted.push(ctx.model);
          return { payload: { ok: true }, tokensIn: 1, tokensOut: 1 };
        },
      }),
    );
    expect(attempted).toEqual(["coregrid/deep"]);
    // Recovery: the failed primary is declared healthy again (operator or
    // upstream success signal), so the deterministic primary route resumes.
    registry.recordSuccess("coregrid/flash");
    const recovery: string[] = [];
    await invokeAiGateway(
      baseRequest({
        modelRegistry: registry,
        failurePolicy: smallPolicy(),
        invoke: async (_provider, ctx) => {
          recovery.push(ctx.model);
          return { payload: { ok: true }, tokensIn: 1, tokensOut: 1 };
        },
      }),
    );
    expect(recovery).toEqual(["coregrid/flash"]);
  });
});

/* ─────────────────────────────────────────────────────────────
 * J-015 reasoning provenance — intelligence snapshots (additive)
 * ────────────────────────────────────────────────────────────*/

describe("reasoning provenance — intelligence snapshots (J-015, V1CAP-029)", () => {
  const CONTEXT = {
    traceId: "ctx-trace-4a7d1ed414474e4033ac29ccb8653d9b",
    assembledContent: "the exact assembled governed context",
  };

  function snapshotPolicy() {
    return createAdapterFailurePolicy({
      provider: "ai-gateway",
      timeoutMs: 1_000,
      maxAttempts: 1,
      backoffBaseMs: 100,
      backoffCapMs: 1_000,
      degradedAfterFailures: 2,
      degradedWindowMs: 10_000,
      breakerFailureThreshold: 3,
      breakerResetMs: 5_000,
    });
  }

  function snapshotRegistry(): ModelRegistry {
    return new ModelRegistry({
      models: [
        {
          id: "coregrid/flash",
          providerClass: "small-fast",
          profile: { contextWindowTokens: 128_000, latencyTier: "low", costTier: "low" },
        },
        {
          id: "coregrid/deep",
          providerClass: "deep-reasoning",
          profile: { contextWindowTokens: 200_000, latencyTier: "high", costTier: "high" },
        },
      ],
      fallbackChains: { summarization: ["coregrid/flash", "coregrid/deep"] },
    });
  }

  it("stamps a complete snapshot on the legacy declared path, with an explicitly absent context version", async () => {
    const outcome = await invokeAiGateway(baseRequest({}));
    expect(outcome.decision).toBe("allow");
    if (outcome.decision !== "allow") return;
    expect(() => validateIntelligenceSnapshot(outcome.intelligence)).not.toThrow();
    expect(outcome.intelligence.model).toEqual({ id: "coregrid/flash", providerClass: null });
    expect(outcome.intelligence.routing.routedViaRegistry).toBe(false);
    expect(outcome.intelligence.routing.rationale).toHaveLength(1);
    expect(outcome.intelligence.routing.rationale[0]).toMatchObject({
      stage: "legacy_declared_path",
      model: "coregrid/flash",
    });
    expect(outcome.intelligence.contextVersion).toEqual({ traceId: null, contentDigest: null });
    expect(outcome.intelligence.outputDigest).toBe(digestContent({ ok: true }));
    expect(outcome.intelligence.usage).toEqual({
      tokensIn: 100,
      tokensOut: 40,
      estimatedCostUsd: null,
    });
    expect(outcome.intelligence.evidenceClass).toBe("generated");
    expect(outcome.intelligence.generatedByAi).toBe(true);
  });

  it("records the declared context version (trace id + content digest of the exact assembled context)", async () => {
    const outcome = await invokeAiGateway(baseRequest({ intelligenceContext: CONTEXT }));
    expect(outcome.decision).toBe("allow");
    if (outcome.decision !== "allow") return;
    expect(outcome.intelligence.contextVersion).toEqual({
      traceId: CONTEXT.traceId,
      contentDigest: digestContent(CONTEXT.assembledContent),
    });
  });

  it("flows the snapshot into the usage-ledger record for the invocation", async () => {
    const ledger = new UsageLedger(RATES);
    const outcome = await invokeAiGateway(baseRequest({ ledger, rates: RATES }));
    expect(outcome.decision).toBe("allow");
    if (outcome.decision !== "allow") return;
    const records = ledger.all();
    expect(records).toHaveLength(1);
    const stored = records[0] as UsageRecord & { intelligence: IntelligenceSnapshot };
    expect(stored.intelligence).toEqual(outcome.intelligence);
    expect(stored).toEqual(outcome.usage);
  });

  it("attributes the fallback winner's own snapshot with the full routing rationale chain", async () => {
    const registry = snapshotRegistry();
    const outcome = await invokeAiGateway(
      baseRequest({
        modelRegistry: registry,
        failurePolicy: snapshotPolicy(),
        intelligenceContext: CONTEXT,
        invoke: async (_provider, ctx) => {
          if (ctx.model === "coregrid/flash") throw new Error("provider down");
          return { payload: { ok: true, via: ctx.model }, tokensIn: 10, tokensOut: 5 };
        },
      }),
    );
    expect(outcome.decision).toBe("allow");
    if (outcome.decision !== "allow") return;
    expect(() => validateIntelligenceSnapshot(outcome.intelligence)).not.toThrow();
    expect(outcome.intelligence.model).toEqual({
      id: "coregrid/deep",
      providerClass: "deep-reasoning",
    });
    expect(outcome.intelligence.routing.routedViaRegistry).toBe(true);
    const stages = outcome.intelligence.routing.rationale.map((step) => step.stage);
    expect(stages).toEqual([
      "registry_route_resolved",
      "fallback_attempt_failed",
      "provider_success",
    ]);
    expect(outcome.intelligence.routing.rationale[1]).toMatchObject({
      stage: "fallback_attempt_failed",
      model: "coregrid/flash",
    });
    expect(outcome.intelligence.routing.rationale[2]).toMatchObject({
      stage: "provider_success",
      model: "coregrid/deep",
    });
    expect(outcome.intelligence.outputDigest).toBe(
      digestContent({ ok: true, via: "coregrid/deep" }),
    );
    expect(outcome.intelligence.contextVersion).toEqual({
      traceId: CONTEXT.traceId,
      contentDigest: digestContent(CONTEXT.assembledContent),
    });
  });

  it("makes unattributed output impossible: a result snapshot missing fields fails downstream", async () => {
    const outcome = await invokeAiGateway(baseRequest({}));
    expect(outcome.decision).toBe("allow");
    if (outcome.decision !== "allow") return;
    const { outputDigest: _stripped, ...withoutDigest } = outcome.intelligence;
    expect(() => validateIntelligenceSnapshot(withoutDigest)).toThrow(
      new ReasoningProvenanceError(
        "missing_provenance_field",
        "outputDigest",
        "intelligence snapshot is missing the output digest",
      ),
    );
    // Tampering with the model attribution fails the same gate.
    const unattributed = {
      ...outcome.intelligence,
      model: { id: "", providerClass: null },
    };
    expect(() => validateIntelligenceSnapshot(unattributed)).toThrow(/model/);
  });
});
