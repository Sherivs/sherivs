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
