/**
 * CoreGrid — adapter failure-semantics contract tests (J-045, V1CAP-080,
 * MISSION-R-72). Bounded timeouts, error containment, degraded-mode state
 * machine, retry caps + deterministic backoff, circuit-breaker transitions,
 * and per-provider trust decision recording (E-060).
 *
 * All tests run on injected clocks: a deferred manual clock for timeout and
 * breaker timing, and an immediate clock for retry loops — the whole policy
 * engine is exercised without real timers.
 */
import { describe, expect, it } from "vitest";
import {
  computeBackoffMs,
  createAdapterFailurePolicy,
  type AdapterClock,
  type AdapterPolicyEvent,
} from "../../frontend/src/lib/adapters/failure-policy";

/** Deferred-delay clock: time only passes when the test fires the delays. */
function manualClock(startMs = 1_000_000) {
  let now = startMs;
  const pending: { ms: number; resolve: () => void }[] = [];
  const clock: AdapterClock = {
    nowMs: () => now,
    delay: (ms: number) =>
      new Promise<void>((resolve) => {
        pending.push({ ms, resolve });
      }),
  };
  return {
    clock,
    advance(ms: number): void {
      now += ms;
    },
    at(): number {
      return now;
    },
    pendingDelays(): number[] {
      return pending.map((d) => d.ms);
    },
    fireDelays(): void {
      const all = pending.splice(0, pending.length);
      for (const d of all) d.resolve();
    },
  };
}

/** Resolves delays instantly and records the requested backoff values. */
function immediateClock(startMs = 1_000_000) {
  let now = startMs;
  const requested: number[] = [];
  const clock: AdapterClock = {
    nowMs: () => now,
    delay: (ms: number) => {
      requested.push(ms);
      return Promise.resolve();
    },
  };
  return {
    clock,
    advance(ms: number): void {
      now += ms;
    },
    at(): number {
      return now;
    },
    requestedDelays(): readonly number[] {
      return requested;
    },
  };
}

/** Let queued microtasks (and any pending policy setup) flush. */
const tick = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

function baseConfig(overrides: Partial<Parameters<typeof createAdapterFailurePolicy>[0]> = {}) {
  return {
    provider: "test-provider",
    timeoutMs: 1_000,
    maxAttempts: 3,
    backoffBaseMs: 100,
    backoffCapMs: 1_000,
    degradedAfterFailures: 3,
    degradedWindowMs: 10_000,
    breakerFailureThreshold: 5,
    breakerResetMs: 15_000,
    ...overrides,
  };
}

function neverSettles<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

describe("construction validates configuration (fail fast on misconfiguration)", () => {
  it("accepts a valid configuration and declares it on the snapshot", () => {
    const policy = createAdapterFailurePolicy(baseConfig({ timeoutMs: 2_500, maxAttempts: 4 }));
    const declared = policy.snapshot().declared;
    expect(declared.timeoutMs).toBe(2_500);
    expect(declared.maxAttempts).toBe(4);
    expect(declared.breakerFailureThreshold).toBe(5);
  });

  it("rejects non-positive, non-finite and non-integer thresholds", () => {
    expect(() => createAdapterFailurePolicy(baseConfig({ provider: "  " }))).toThrow(TypeError);
    for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createAdapterFailurePolicy(baseConfig({ timeoutMs }))).toThrow(TypeError);
    }
    expect(() => createAdapterFailurePolicy(baseConfig({ maxAttempts: 0 }))).toThrow(TypeError);
    expect(() => createAdapterFailurePolicy(baseConfig({ maxAttempts: 2.5 }))).toThrow(TypeError);
    expect(() => createAdapterFailurePolicy(baseConfig({ backoffCapMs: 50 }))).toThrow(TypeError); // below base
    expect(() => createAdapterFailurePolicy(baseConfig({ degradedWindowMs: 0 }))).toThrow(
      TypeError,
    );
    expect(() => createAdapterFailurePolicy(baseConfig({ breakerResetMs: 0 }))).toThrow(TypeError);
  });

  it("requires degraded mode to engage no later than isolation", () => {
    expect(() =>
      createAdapterFailurePolicy(
        baseConfig({ degradedAfterFailures: 6, breakerFailureThreshold: 5 }),
      ),
    ).toThrow(TypeError);
  });
});

describe("bounded timeouts (enforced per call)", () => {
  it("converts a hung provider into a contained timeout error", async () => {
    const time = manualClock();
    const policy = createAdapterFailurePolicy(baseConfig({ clock: time.clock, maxAttempts: 1 }));
    const pendingRun = policy.run({ operation: "op.hang", call: () => neverSettles<string>() });
    await tick();
    expect(time.pendingDelays()).toEqual([1_000]);
    time.fireDelays();
    const result = await pendingRun;
    expect(result.outcome).toBe("error");
    if (result.outcome === "error") {
      expect(result.code).toBe("timeout");
      expect(result.reason).toContain("exceeded the 1000ms adapter timeout");
    }
  });

  it("counts timeouts in the snapshot and never records usage of the hung call as success", async () => {
    const time = manualClock();
    const policy = createAdapterFailurePolicy(baseConfig({ clock: time.clock, maxAttempts: 1 }));
    const pendingRun = policy.run({ operation: "op.hang", call: neverSettles });
    await tick();
    time.fireDelays();
    await pendingRun;
    const snap = policy.snapshot();
    expect(snap.totalTimeouts).toBe(1);
    expect(snap.totalFailures).toBe(1);
    expect(snap.lastError?.code).toBe("timeout");
  });

  it("abandons the losing promise: a late provider rejection stays contained", async () => {
    const time = manualClock();
    const policy = createAdapterFailurePolicy(baseConfig({ clock: time.clock, maxAttempts: 1 }));
    const late = policy.run({
      operation: "op.late",
      call: () =>
        new Promise<string>((_, reject) => {
          setTimeout(() => reject(new Error("late provider failure")), 5);
        }),
    });
    await tick();
    time.fireDelays();
    const result = await late;
    expect(result.outcome).toBe("error");
    if (result.outcome === "error") expect(result.code).toBe("timeout");
  });
});

describe("error containment (failures never escape the call boundary)", () => {
  it("contains an async provider rejection as a structured result", async () => {
    const time = immediateClock();
    const policy = createAdapterFailurePolicy(baseConfig({ clock: time.clock, maxAttempts: 1 }));
    const result = await policy.run({
      operation: "op.reject",
      call: async () => {
        throw new Error("provider exploded");
      },
    });
    expect(result.outcome).toBe("error");
    if (result.outcome === "error") {
      expect(result.code).toBe("provider_error");
      expect(result.reason).toBe("provider exploded");
      expect(result.cause).toBe("provider exploded");
    }
  });

  it("contains synchronous provider throws through the same path", async () => {
    const time = immediateClock();
    const policy = createAdapterFailurePolicy(baseConfig({ clock: time.clock, maxAttempts: 1 }));
    const result = await policy.run({
      operation: "op.sync-throw",
      call: (): Promise<string> => {
        throw new Error("sync boom");
      },
    });
    expect(result.outcome).toBe("error");
    if (result.outcome === "error") {
      expect(result.code).toBe("provider_error");
      expect(result.reason).toBe("sync boom");
    }
    expect(policy.snapshot().totalFailures).toBe(1);
  });

  it("contains non-Error throwables (strings and objects)", async () => {
    const time = immediateClock();
    const policy = createAdapterFailurePolicy(baseConfig({ clock: time.clock, maxAttempts: 1 }));
    const stringResult = await policy.run({
      operation: "op.string",
      call: async () => {
        throw "plain string failure";
      },
    });
    expect(stringResult.outcome).toBe("error");
    if (stringResult.outcome === "error") expect(stringResult.reason).toBe("plain string failure");

    const objectResult = await policy.run({
      operation: "op.object",
      call: async () => {
        throw { weird: true };
      },
    });
    expect(objectResult.outcome).toBe("error");
    if (objectResult.outcome === "error") expect(objectResult.reason).toContain("weird");
  });

  it("containSync never throws and records the outcome", () => {
    const policy = createAdapterFailurePolicy(baseConfig());
    const ok = policy.containSync("op.ok", () => 42);
    expect(ok).toEqual({ outcome: "ok", value: 42, attempts: 1, durationMs: 0, mode: "healthy" });

    const contained = policy.containSync("op.bad", () => {
      throw new Error("local defect");
    });
    expect(contained.outcome).toBe("error");
    if (contained.outcome === "error") {
      expect(contained.code).toBe("provider_error");
      expect(contained.reason).toContain("local defect");
    }
    const snap = policy.snapshot();
    expect(snap.totalCalls).toBe(2);
    expect(snap.totalFailures).toBe(1);
  });
});

describe("degraded mode (explicit, observable, time-bounded, never silent)", () => {
  it("arms degraded mode after the failure threshold with a recorded window", () => {
    const time = manualClock();
    const events: AdapterPolicyEvent[] = [];
    const policy = createAdapterFailurePolicy(
      baseConfig({
        clock: time.clock,
        degradedAfterFailures: 2,
        breakerFailureThreshold: 5,
        onEvent: (e) => events.push(e),
      }),
    );
    policy.containSync("op.a", () => {
      throw new Error("fail-1");
    });
    expect(policy.snapshot().mode).toBe("healthy");
    policy.containSync("op.b", () => {
      throw new Error("fail-2");
    });
    const snap = policy.snapshot();
    expect(snap.mode).toBe("degraded");
    expect(snap.degradedActive).toBe(true);
    expect(snap.degradedSinceMs).toBe(time.at());
    expect(snap.degradedUntilMs).toBe(time.at() + 10_000);
    expect(snap.degradedExpired).toBe(false);
    const change = events.find((e) => e.kind === "mode_change");
    expect(change).toBeDefined();
    if (change?.kind === "mode_change") {
      expect(change.from).toBe("healthy");
      expect(change.to).toBe("degraded");
      expect(change.reason).toContain("consecutive failures");
    }
  });

  it("clears degraded mode on the first success", () => {
    const time = immediateClock();
    const policy = createAdapterFailurePolicy(
      baseConfig({ clock: time.clock, degradedAfterFailures: 1, breakerFailureThreshold: 5 }),
    );
    policy.containSync("op.a", () => {
      throw new Error("fail");
    });
    expect(policy.snapshot().mode).toBe("degraded");
    const ok = policy.containSync("op.b", () => "recovered");
    expect(ok.outcome).toBe("ok");
    const snap = policy.snapshot();
    expect(snap.mode).toBe("healthy");
    expect(snap.degradedActive).toBe(false);
    expect(snap.consecutiveFailures).toBe(0);
    expect(snap.consecutiveSuccesses).toBe(1);
  });

  it("re-arms the window on further failures (episodes stay bounded)", () => {
    const time = manualClock();
    const policy = createAdapterFailurePolicy(
      baseConfig({ clock: time.clock, degradedAfterFailures: 2, breakerFailureThreshold: 5 }),
    );
    policy.containSync("op.a", () => {
      throw new Error("fail-1");
    });
    policy.containSync("op.b", () => {
      throw new Error("fail-2");
    });
    const firstUntil = policy.snapshot().degradedUntilMs;
    time.advance(4_000);
    policy.containSync("op.c", () => {
      throw new Error("fail-3");
    });
    const snap = policy.snapshot();
    expect(snap.degradedUntilMs).toBe(time.at() + 10_000);
    expect(snap.degradedUntilMs).not.toBe(firstUntil);
    expect(snap.degradedExpired).toBe(false);
  });

  it("expires with the window: degraded state is time-bounded, never permanent", () => {
    const time = manualClock();
    const policy = createAdapterFailurePolicy(
      baseConfig({ clock: time.clock, degradedAfterFailures: 1, breakerFailureThreshold: 5 }),
    );
    policy.containSync("op.a", () => {
      throw new Error("fail");
    });
    expect(policy.snapshot().mode).toBe("degraded");
    const later = policy.snapshot(time.at() + 10_001);
    expect(later.degradedActive).toBe(true);
    expect(later.degradedExpired).toBe(true);
    expect(later.mode).toBe("healthy");
  });

  it("isolated overrides degraded while the breaker is open", () => {
    const time = immediateClock();
    const policy = createAdapterFailurePolicy(
      baseConfig({
        clock: time.clock,
        degradedAfterFailures: 1,
        breakerFailureThreshold: 2,
        maxAttempts: 1,
      }),
    );
    policy.containSync("op.a", () => {
      throw new Error("fail-1");
    });
    policy.containSync("op.b", () => {
      throw new Error("fail-2");
    });
    const snap = policy.snapshot();
    expect(snap.degradedActive).toBe(true);
    expect(snap.mode).toBe("isolated");
  });
});

describe("retry policy with caps + deterministic backoff", () => {
  it("caps total attempts and schedules pure exponential backoff", async () => {
    const time = immediateClock();
    const policy = createAdapterFailurePolicy(
      baseConfig({ clock: time.clock, maxAttempts: 3, backoffBaseMs: 100, backoffCapMs: 1_000 }),
    );
    let calls = 0;
    const result = await policy.run({
      operation: "op.always-fails",
      call: async () => {
        calls += 1;
        throw new Error("down");
      },
    });
    expect(result.outcome).toBe("error");
    if (result.outcome === "error") {
      expect(result.code).toBe("provider_error");
      expect(result.reason).toBe("down");
      expect(result.attempts).toBe(3);
    }
    expect(calls).toBe(3);
    // Filter out the per-attempt timeout delays (cfg.timeoutMs = 1_000).
    expect(time.requestedDelays().filter((ms) => ms !== 1_000)).toEqual([100, 200]);
  });

  it("clamps backoff at the cap", async () => {
    const time = immediateClock();
    const policy = createAdapterFailurePolicy(
      baseConfig({ clock: time.clock, maxAttempts: 4, backoffBaseMs: 100, backoffCapMs: 150 }),
    );
    await policy.run({
      operation: "op.always-fails",
      call: async () => {
        throw new Error("down");
      },
    });
    expect(time.requestedDelays().filter((ms) => ms !== 1_000)).toEqual([100, 150, 150]);
    expect(computeBackoffMs(1, 100, 1_000)).toBe(100);
    expect(computeBackoffMs(3, 100, 1_000)).toBe(400);
    expect(computeBackoffMs(10, 100, 150)).toBe(150);
    expect(computeBackoffMs(0, 100, 1_000)).toBe(100);
  });

  it("returns ok with the successful attempt number when a retry lands", async () => {
    const time = immediateClock();
    const policy = createAdapterFailurePolicy(baseConfig({ clock: time.clock, maxAttempts: 3 }));
    let calls = 0;
    const result = await policy.run({
      operation: "op.flaky",
      call: async () => {
        calls += 1;
        if (calls < 3) throw new Error("transient");
        return "landed";
      },
    });
    expect(result).toMatchObject({ outcome: "ok", value: "landed", attempts: 3 });
    expect(time.requestedDelays().filter((ms) => ms !== 1_000)).toEqual([100, 200]);
  });

  it("honors a per-call retryability predicate (non-retryable stops at attempt 1)", async () => {
    const time = immediateClock();
    const policy = createAdapterFailurePolicy(baseConfig({ clock: time.clock, maxAttempts: 3 }));
    let calls = 0;
    const result = await policy.run({
      operation: "op.no-retry",
      call: async () => {
        calls += 1;
        throw new Error("permanent");
      },
      retryable: (code) => code !== "provider_error",
    });
    expect(result.outcome).toBe("error");
    if (result.outcome === "error") expect(result.attempts).toBe(1);
    expect(calls).toBe(1);
    expect(time.requestedDelays().filter((ms) => ms !== 1_000)).toEqual([]);
  });

  it("per-call maxAttempts override takes precedence over the declared value", async () => {
    const time = immediateClock();
    const policy = createAdapterFailurePolicy(baseConfig({ clock: time.clock, maxAttempts: 5 }));
    let calls = 0;
    await policy.run({
      operation: "op.override",
      call: async () => {
        calls += 1;
        throw new Error("down");
      },
      maxAttempts: 2,
    });
    expect(calls).toBe(2);
  });
});

describe("circuit breaker (open → half-open probe → closed)", () => {
  it("opens after the failure threshold and denies further calls without provider contact", async () => {
    const time = immediateClock();
    const events: AdapterPolicyEvent[] = [];
    const policy = createAdapterFailurePolicy(
      baseConfig({
        clock: time.clock,
        maxAttempts: 1,
        degradedAfterFailures: 2,
        breakerFailureThreshold: 2,
        onEvent: (e) => events.push(e),
      }),
    );
    let calls = 0;
    const failingCall = async (): Promise<string> => {
      calls += 1;
      throw new Error("down");
    };
    for (let i = 0; i < 2; i += 1) {
      await policy.run({ operation: "op.fail", call: failingCall });
    }
    const snap = policy.snapshot();
    expect(snap.breaker).toBe("open");
    expect(snap.mode).toBe("isolated");
    expect(snap.breakerOpenedAtMs).not.toBeNull();
    expect(snap.breakerNextProbeAtMs).not.toBeNull();

    const denied = await policy.run({ operation: "op.denied", call: failingCall });
    expect(denied.outcome).toBe("error");
    if (denied.outcome === "error") {
      expect(denied.code).toBe("breaker_open");
      expect(denied.reason).toContain("circuit is open");
      expect(denied.attempts).toBe(0);
    }
    expect(calls).toBe(2);
    const change = events.find((e) => e.kind === "breaker_change");
    expect(change).toBeDefined();
  });

  it("admits a single half-open probe after the reset window and closes on success", async () => {
    const time = manualClock();
    const policy = createAdapterFailurePolicy(
      baseConfig({
        clock: time.clock,
        maxAttempts: 1,
        degradedAfterFailures: 2,
        breakerFailureThreshold: 2,
        breakerResetMs: 5_000,
      }),
    );
    for (let i = 0; i < 2; i += 1) {
      await policy.run({
        operation: "op.fail",
        call: async () => {
          throw new Error("down");
        },
      });
    }
    expect(policy.snapshot().breaker).toBe("open");
    time.advance(5_000);
    const probe = await policy.run({ operation: "op.probe", call: async () => "healthy-again" });
    expect(probe).toMatchObject({ outcome: "ok", value: "healthy-again" });
    const snap = policy.snapshot();
    expect(snap.breaker).toBe("closed");
    expect(snap.breakerOpenedAtMs).toBeNull();
    expect(snap.breakerNextProbeAtMs).toBeNull();
    expect(snap.mode).toBe("healthy");
  });

  it("re-opens when the half-open probe fails and schedules the next probe", async () => {
    const time = manualClock();
    const policy = createAdapterFailurePolicy(
      baseConfig({
        clock: time.clock,
        maxAttempts: 1,
        degradedAfterFailures: 2,
        breakerFailureThreshold: 2,
        breakerResetMs: 5_000,
      }),
    );
    for (let i = 0; i < 2; i += 1) {
      await policy.run({
        operation: "op.fail",
        call: async () => {
          throw new Error("down");
        },
      });
    }
    time.advance(5_000);
    const probe = await policy.run({
      operation: "op.probe",
      call: async () => {
        throw new Error("still down");
      },
    });
    expect(probe.outcome).toBe("error");
    const snap = policy.snapshot();
    expect(snap.breaker).toBe("open");
    expect(snap.breakerNextProbeAtMs).toBe(time.at() + 5_000);
  });

  it("denies concurrent half-open probes (exactly one probe in flight)", async () => {
    const time = manualClock();
    const policy = createAdapterFailurePolicy(
      baseConfig({
        clock: time.clock,
        maxAttempts: 1,
        degradedAfterFailures: 1,
        breakerFailureThreshold: 1,
        breakerResetMs: 5_000,
      }),
    );
    await policy.run({
      operation: "op.fail",
      call: async () => {
        throw new Error("down");
      },
    });
    expect(policy.snapshot().breaker).toBe("open");
    time.advance(5_000);
    const first = policy.run({ operation: "op.probe-1", call: () => neverSettles<string>() });
    await tick();
    expect(policy.snapshot().breaker).toBe("half_open");
    const second = await policy.run({
      operation: "op.probe-2",
      call: async () => "should be denied",
    });
    expect(second.outcome).toBe("error");
    if (second.outcome === "error") {
      expect(second.code).toBe("breaker_open");
      expect(second.reason).toContain("probe is already in flight");
    }
    time.fireDelays();
    const result = await first;
    expect(result.outcome).toBe("error"); // the hanging probe times out
    expect(policy.snapshot().breaker).toBe("open"); // failed probe re-opens
  });

  it("stops retrying and reports the actual failure when a retry trips the breaker", async () => {
    const time = immediateClock();
    const policy = createAdapterFailurePolicy(
      baseConfig({
        clock: time.clock,
        maxAttempts: 3,
        degradedAfterFailures: 2,
        breakerFailureThreshold: 2,
      }),
    );
    let calls = 0;
    const result = await policy.run({
      operation: "op.fail",
      call: async () => {
        calls += 1;
        throw new Error("down");
      },
    });
    expect(result.outcome).toBe("error");
    if (result.outcome === "error") expect(result.code).toBe("provider_error");
    expect(calls).toBe(2); // retry loop stops once the breaker opens
    expect(policy.snapshot().breaker).toBe("open");
  });
});

describe("per-provider trust decisions (E-060: never automatically trusted)", () => {
  it("starts unproven and never recommends trust without explicit action", () => {
    const time = immediateClock();
    const policy = createAdapterFailurePolicy(baseConfig({ clock: time.clock }));
    const recommendation = policy.recommendTrust();
    expect(recommendation.verdict).toBe("unproven");
    expect(recommendation.reason).toContain("never automatically trusted");
    expect(recommendation.basis.totalCalls).toBe(0);
    expect(recommendation.basis.failureRate).toBeNull();
    expect(policy.currentTrustVerdict()).toBe("unproven");
    expect(policy.trustDecisions()).toEqual([]);
  });

  it("success history alone never produces a 'trusted' recommendation", () => {
    const time = immediateClock();
    const policy = createAdapterFailurePolicy(baseConfig({ clock: time.clock }));
    for (let i = 0; i < 10; i += 1) {
      policy.containSync("op.ok", () => "fine");
    }
    const recommendation = policy.recommendTrust();
    expect(recommendation.verdict).not.toBe("trusted");
    expect(recommendation.verdict).toBe("unproven");
  });

  it("computes an untrusted recommendation from the failure history", () => {
    const time = immediateClock();
    const policy = createAdapterFailurePolicy(
      baseConfig({ clock: time.clock, maxAttempts: 1, breakerFailureThreshold: 3 }),
    );
    for (let i = 0; i < 3; i += 1) {
      policy.containSync("op.fail", () => {
        throw new Error("down");
      });
    }
    const recommendation = policy.recommendTrust();
    expect(recommendation.verdict).toBe("untrusted");
    expect(recommendation.reason).toContain("trust floor");
    expect(recommendation.basis.totalCalls).toBe(3);
    expect(recommendation.basis.totalFailures).toBe(3);
    expect(recommendation.basis.consecutiveFailures).toBe(3);
    expect(recommendation.basis.failureRate).toBe(1);
    expect(recommendation.basis.lastFailureAtMs).not.toBeNull();
  });

  it("records explicit decisions with full provenance and emits an event", () => {
    const time = manualClock();
    const events: AdapterPolicyEvent[] = [];
    const policy = createAdapterFailurePolicy(
      baseConfig({ clock: time.clock, onEvent: (e) => events.push(e) }),
    );
    const decision = policy.recordTrustDecision({
      verdict: "untrusted",
      reason: "operator decision after repeated timeouts",
      decidedBy: "ops-console:mission-r-72",
    });
    expect(decision.provider).toBe("test-provider");
    expect(decision.verdict).toBe("untrusted");
    expect(decision.decidedAtMs).toBe(time.at());
    expect(decision.decidedBy).toBe("ops-console:mission-r-72");
    expect(decision.basis).toEqual(policy.trustBasis());
    expect(policy.currentTrustVerdict()).toBe("untrusted");
    expect(policy.trustDecisions()).toHaveLength(1);
    const event = events.find((e) => e.kind === "trust_decision");
    expect(event).toBeDefined();
    if (event?.kind === "trust_decision") expect(event.verdict).toBe("untrusted");
  });

  it("only an explicit record may set 'trusted' — the API makes automation impossible", () => {
    const time = immediateClock();
    const policy = createAdapterFailurePolicy(baseConfig({ clock: time.clock }));
    for (let i = 0; i < 10; i += 1) {
      policy.containSync("op.ok", () => "fine");
    }
    expect(policy.recommendTrust().verdict).toBe("unproven");
    policy.recordTrustDecision({
      verdict: "trusted",
      reason: "explicit operator grant after review",
      decidedBy: "ops-console:mission-r-72",
    });
    expect(policy.currentTrustVerdict()).toBe("trusted");
    expect(policy.trustDecisions()[0]?.basis.totalCalls).toBe(10);
  });
});

describe("observability events and snapshots", () => {
  it("emits call outcomes and declared policy facts in the snapshot", async () => {
    const time = immediateClock();
    const events: AdapterPolicyEvent[] = [];
    const policy = createAdapterFailurePolicy(
      baseConfig({ clock: time.clock, maxAttempts: 1, onEvent: (e) => events.push(e) }),
    );
    await policy.run({ operation: "op.ok", call: async () => "fine" });
    await policy.run({
      operation: "op.fail",
      call: async () => {
        throw new Error("down");
      },
    });
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("call_succeeded");
    expect(kinds).toContain("call_failed");
    const failed = events.find((e) => e.kind === "call_failed");
    if (failed?.kind === "call_failed") {
      expect(failed.operation).toBe("op.fail");
      expect(failed.code).toBe("provider_error");
      expect(failed.attempt).toBe(1);
    }
    const snap = policy.snapshot();
    expect(snap.provider).toBe("test-provider");
    expect(snap.totalCalls).toBe(2);
    expect(snap.totalFailures).toBe(1);
    expect(snap.lastError).toMatchObject({ code: "provider_error", reason: "down" });
  });

  it("a throwing event sink can never break containment", async () => {
    const time = immediateClock();
    const policy = createAdapterFailurePolicy(
      baseConfig({
        clock: time.clock,
        maxAttempts: 1,
        onEvent: () => {
          throw new Error("sink is broken");
        },
      }),
    );
    const result = await policy.run({ operation: "op.ok", call: async () => "fine" });
    expect(result.outcome).toBe("ok");
  });
});
