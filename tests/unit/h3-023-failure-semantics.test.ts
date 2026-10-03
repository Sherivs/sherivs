/**
 * CoreGrid — H3-023 external-adapter failure-semantics contract tests
 * (mission B-023 / J-045). Layered semantics on the read-only
 * AdapterFailurePolicy: fail-closed per-provider gates (unknown provider,
 * invalid call spec, trust gate, degraded denial), bounded declared budgets,
 * strict provider isolation, contained timeouts, and E-060 trust decisions
 * (external systems are never automatically trusted).
 *
 * Pure offline: no network, no database, no secrets. All time flows from
 * injected clocks — a deferred manual clock for timeout timing and an
 * immediate clock for retry/breaker loops.
 */
import { describe, expect, it } from "vitest";
import type { AdapterClock, AdapterPolicyEvent } from "../../frontend/src/lib/adapters/failure-policy";
import {
  MAX_ATTEMPTS_PER_CALL,
  MAX_BACKOFF_MS,
  MAX_BREAKER_RESET_MS,
  MAX_BREAKER_THRESHOLD,
  MAX_DEGRADED_WINDOW_MS,
  MAX_PROVIDER_TIMEOUT_MS,
  parseProviderFailureProfiles,
  AdapterFailureSemantics,
  type AdapterSemanticsAuditEvent,
  type AdapterSemanticsEventSink,
  type ProviderFailureProfile,
} from "../../frontend/src/lib/adapters/failure-semantics";

/* Injectable clocks: nothing runs implicitly. */

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
      now += ms;
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

const PROVENANCE = {
  declaredBy: "role:adapter-failure-semantics-engineer",
  authority: "AGENTS.md §42 / H3 wave mission B-023",
  declaredAt: "2026-10-03T00:00:00.000Z",
};

function profile(overrides: Partial<ProviderFailureProfile> = {}): ProviderFailureProfile {
  return {
    provider: "provider_a",
    timeoutMs: 1_000,
    maxAttempts: 3,
    backoffBaseMs: 100,
    backoffCapMs: 1_000,
    degradedAfterFailures: 2,
    degradedWindowMs: 10_000,
    breakerFailureThreshold: 4,
    breakerResetMs: 15_000,
    whileDegraded: "admit",
    provenance: PROVENANCE,
    ...overrides,
  };
}

function registry(...profiles: ProviderFailureProfile[]) {
  return parseProviderFailureProfiles({ profiles });
}

function semantics(
  profiles: ProviderFailureProfile[],
  options: { clock?: AdapterClock; onEvent?: AdapterSemanticsEventSink } = {},
): AdapterFailureSemantics {
  const parsed = registry(...profiles);
  if (!parsed.ok) throw new Error(`test registry invalid: ${parsed.issues.join("; ")}`);
  return new AdapterFailureSemantics({
    registry: parsed.registry,
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
    ...(options.onEvent !== undefined ? { onEvent: options.onEvent } : {}),
  });
}

function expectPolicyError<T>(
  result: { denied: boolean; policy?: unknown },
  code: string,
): asserts result is { denied: false; policy: { outcome: "error"; code: string } } {
  expect(result.denied).toBe(false);
  const policy = result.policy as { outcome: string; code: string };
  expect(policy.outcome).toBe("error");
  expect(policy.code).toBe(code);
}

const neverSettles = <T>(): Promise<T> => new Promise<T>(() => {});

describe("registry parsing (fail-closed, bounded, provenanced declarations)", () => {
  it("accepts a valid profile registry", () => {
    const parsed = registry(profile(), profile({ provider: "provider_b" }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.registry.profiles).toHaveLength(2);
  });

  it("rejects an empty or absent registry", () => {
    expect(parseProviderFailureProfiles({ profiles: [] }).ok).toBe(false);
    expect(parseProviderFailureProfiles({}).ok).toBe(false);
    expect(parseProviderFailureProfiles(null).ok).toBe(false);
    expect(parseProviderFailureProfiles(undefined).ok).toBe(false);
  });

  it("rejects duplicate providers — one profile per provider (strict isolation)", () => {
    const parsed = registry(profile(), profile({ timeoutMs: 500 }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues[0]).toContain("duplicate failure profile");
  });

  it("rejects anonymous profiles — provenance is mandatory (AGENTS §12)", () => {
    const anonymous = profile({
      provenance: { ...PROVENANCE, declaredBy: "   " },
    });
    expect(registry(anonymous).ok).toBe(false);
  });

  it("rejects unbounded budgets — timeouts, attempts, backoff, windows", () => {
    expect(registry(profile({ timeoutMs: MAX_PROVIDER_TIMEOUT_MS + 1 })).ok).toBe(false);
    expect(registry(profile({ timeoutMs: 0 })).ok).toBe(false);
    expect(registry(profile({ maxAttempts: MAX_ATTEMPTS_PER_CALL + 1 })).ok).toBe(false);
    expect(registry(profile({ backoffBaseMs: MAX_BACKOFF_MS + 1 })).ok).toBe(false);
    expect(registry(profile({ backoffCapMs: MAX_BACKOFF_MS + 1 })).ok).toBe(false);
    expect(registry(profile({ degradedWindowMs: MAX_DEGRADED_WINDOW_MS + 1 })).ok).toBe(false);
    expect(registry(profile({ breakerResetMs: MAX_BREAKER_RESET_MS + 1 })).ok).toBe(false);
    expect(registry(profile({ breakerFailureThreshold: MAX_BREAKER_THRESHOLD + 1 })).ok).toBe(false);
  });

  it("rejects backoffCapMs < backoffBaseMs as a structured parse failure", () => {
    const parsed = registry(profile({ backoffBaseMs: 500, backoffCapMs: 100 }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues[0]).toContain("backoffCapMs must be >= backoffBaseMs");
  });

  it("rejects degradedAfterFailures > breakerFailureThreshold", () => {
    const parsed = registry(profile({ degradedAfterFailures: 3, breakerFailureThreshold: 2 }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issues[0]).toContain("degradedAfterFailures must be <= breakerFailureThreshold");
    }
  });

  it("rejects malformed provider identities", () => {
    expect(registry(profile({ provider: "Provider_A" })).ok).toBe(false);
    expect(registry(profile({ provider: "" })).ok).toBe(false);
    expect(registry(profile({ provider: "a".repeat(129) })).ok).toBe(false);
  });

  it("rejects undeclared degraded behavior values", () => {
    expect(
      registry(profile({ whileDegraded: "ignore" as unknown as "admit" })).ok,
    ).toBe(false);
  });
});

describe("fail-closed admission gates (denials happen before provider contact)", () => {
  it("denies an undeclared provider with unknown_provider and never invokes the call", async () => {
    const called: string[] = [];
    const gate = semantics([profile()]);
    const result = await gate.run("provider_x", {
      operation: "op",
      call: () => {
        called.push("provider_x");
        return Promise.resolve("value");
      },
    });
    expect(called).toHaveLength(0);
    expect(result.denied).toBe(true);
    if (result.denied) expect(result.gate).toBe("unknown_provider");
    expect(gate.providers()).toEqual(["provider_a"]);
  });

  it("denies an invalid call spec: blank operation", async () => {
    const called: string[] = [];
    const gate = semantics([profile()]);
    const result = await gate.run("provider_a", {
      operation: "  ",
      call: () => {
        called.push("provider_a");
        return Promise.resolve("value");
      },
    });
    expect(called).toHaveLength(0);
    expect(result.denied).toBe(true);
    if (result.denied) expect(result.gate).toBe("invalid_call_spec");
  });

  it("denies an invalid call spec: call is not a function", async () => {
    const gate = semantics([profile()]);
    const result = await gate.run("provider_a", {
      operation: "op",
      call: undefined as unknown as () => Promise<string>,
    });
    expect(result.denied).toBe(true);
    if (result.denied) expect(result.gate).toBe("invalid_call_spec");
  });

  it("denies an attempts override above the declared cap — tighten, never expand", async () => {
    const called: string[] = [];
    const gate = semantics([profile({ maxAttempts: 3 })]);
    const result = await gate.run("provider_a", {
      operation: "op",
      maxAttempts: 4,
      call: () => {
        called.push("provider_a");
        return Promise.resolve("value");
      },
    });
    expect(called).toHaveLength(0);
    expect(result.denied).toBe(true);
    if (result.denied) {
      expect(result.gate).toBe("invalid_call_spec");
      expect(result.detail).toContain("never expanded");
    }
  });

  it("admits a per-call attempts override within the declared cap", async () => {
    let attempts = 0;
    const gate = semantics([profile({ maxAttempts: 3 })], { clock: immediateClock().clock });
    const result = await gate.run("provider_a", {
      operation: "op",
      maxAttempts: 1,
      call: () => {
        attempts += 1;
        return Promise.reject(new Error("down"));
      },
    });
    expect(attempts).toBe(1);
    expectPolicyError(result, "provider_error");
  });

  it("records every gate denial in the audit trail (never silent)", async () => {
    const gate = semantics([profile()]);
    await gate.run("provider_x", { operation: "op", call: () => Promise.resolve(1) });
    const trail = gate.auditTrail();
    const denial = trail.find(
      (e): e is Extract<AdapterSemanticsAuditEvent, { source: "semantics" }> =>
        e.source === "semantics" && e.event.kind === "call_denied",
    );
    expect(denial).toBeDefined();
    if (denial && denial.event.kind === "call_denied") {
      expect(denial.event.gate).toBe("unknown_provider");
    }
  });
});

describe("bounded timeouts (a hung provider can never hang the host loop)", () => {
  it("contains a hanging call as a structured timeout at the declared deadline", async () => {
    const clock = manualClock();
    const gate = semantics([profile({ timeoutMs: 1_000, maxAttempts: 1 })], { clock: clock.clock });
    const pending = gate.run("provider_a", {
      operation: "op",
      call: () => neverSettles<string>(),
    });
    expect(clock.pendingDelays()).toEqual([1_000]);
    clock.advance(1_000);
    clock.fireDelays();
    const result = await pending;
    expectPolicyError(result, "timeout");
    if (!result.denied) {
      expect(result.policy.reason).toContain("exceeded the 1000ms adapter timeout");
      expect(result.policy.attempts).toBe(1);
    }
  });

  it("exposes the declared timeout budget on the snapshot", () => {
    const gate = semantics([profile({ timeoutMs: 2_500 })], { clock: immediateClock().clock });
    const snapshot = gate.snapshot("provider_a");
    expect(snapshot).not.toBeNull();
    if (snapshot) expect(snapshot.policy.declared.timeoutMs).toBe(2_500);
  });

  it("admits a call that resolves inside the deadline", async () => {
    const clock = manualClock();
    const gate = semantics([profile({ timeoutMs: 1_000, maxAttempts: 1 })], { clock: clock.clock });
    const result = await gate.run("provider_a", {
      operation: "op",
      call: () => Promise.resolve("on time"),
    });
    expect(result.denied).toBe(false);
    if (!result.denied && result.policy.outcome === "ok") {
      expect(result.policy.value).toBe("on time");
    }
  });
});

describe("error containment (a throwing provider can never crash the host loop)", () => {
  it("contains a synchronously throwing provider as a structured error", async () => {
    const gate = semantics([profile({ maxAttempts: 1 })], { clock: immediateClock().clock });
    const result = await gate.run("provider_a", {
      operation: "op",
      call: (): Promise<string> => {
        throw new Error("sync blast");
      },
    });
    expectPolicyError(result, "provider_error");
    if (!result.denied) expect(result.policy.cause).toBe("sync blast");
  });

  it("contains non-Error rejection values without throwing", async () => {
    const gate = semantics([profile({ maxAttempts: 1 })], { clock: immediateClock().clock });
    const result = await gate.run("provider_a", {
      operation: "op",
      call: () => Promise.reject(42),
    });
    expect(result.denied).toBe(false);
    if (!result.denied) expect(result.policy.outcome).toBe("error");
  });

  it("containSync denies an undeclared provider", () => {
    const gate = semantics([profile()]);
    const result = gate.containSync("provider_x", "local_op", () => 1);
    expect(result.denied).toBe(true);
    if (result.denied) expect(result.gate).toBe("unknown_provider");
  });

  it("containSync contains a throwing local operation as a structured error", () => {
    const gate = semantics([profile()], { clock: immediateClock().clock });
    const result = gate.containSync("provider_a", "local_op", () => {
      throw new Error("local defect");
    });
    expect(result.denied).toBe(false);
    if (!result.denied && result.policy.outcome === "error") {
      expect(result.policy.reason).toContain("contained");
    }
  });

  it("containSync returns the value of a healthy local operation", () => {
    const gate = semantics([profile()], { clock: immediateClock().clock });
    const result = gate.containSync("provider_a", "local_op", () => 7);
    expect(result.denied).toBe(false);
    if (!result.denied && result.policy.outcome === "ok") expect(result.policy.value).toBe(7);
  });

  it("containSync keeps working while the provider is distrusted (local never gates)", () => {
    const clock = immediateClock();
    const gate = semantics([profile({ breakerFailureThreshold: 1, degradedAfterFailures: 1 })], {
      clock: clock.clock,
    });
    const failing = gate.containSync("provider_a", "local_op", () => {
      throw new Error("boom");
    });
    expect(failing.denied).toBe(false);
    const snapshot = gate.snapshot("provider_a");
    if (snapshot) expect(snapshot.effectiveTrustVerdict).toBe("untrusted");
    const local = gate.containSync("provider_a", "local_op", () => 7);
    expect(local.denied).toBe(false);
    if (!local.denied && local.policy.outcome === "ok") expect(local.policy.value).toBe(7);
  });
});

describe("degraded-mode behavior (explicit, declared, fail-closed)", () => {
  it("whileDegraded=admit keeps calling through a degraded episode", async () => {
    const clock = immediateClock();
    let failures = 0;
    const gate = semantics(
      [profile({ degradedAfterFailures: 2, breakerFailureThreshold: 6, whileDegraded: "admit" })],
      { clock: clock.clock },
    );
    for (let i = 0; i < 2; i += 1) {
      const result = await gate.run("provider_a", {
        operation: "op",
        maxAttempts: 1,
        call: () => {
          failures += 1;
          return Promise.reject(new Error("down"));
        },
      });
      expect(result.denied).toBe(false);
    }
    const snapshot = gate.snapshot("provider_a");
    if (snapshot) expect(snapshot.policy.mode).toBe("degraded");
    const result = await gate.run("provider_a", {
      operation: "op",
      maxAttempts: 1,
      call: () => Promise.reject(new Error("still down")),
    });
    // The call reached the policy (not gated) and failed there: contact count
    // stays at 2 (the third call body does not count itself), and the result
    // is a structured policy error — degraded mode admitted the call.
    expect(result.denied).toBe(false);
    if (!result.denied) expect(result.policy.outcome).toBe("error");
  });

  it("whileDegraded=deny fails closed during the episode without provider contact", async () => {
    const clock = immediateClock();
    let contacts = 0;
    const gate = semantics(
      [profile({ degradedAfterFailures: 2, breakerFailureThreshold: 6, whileDegraded: "deny" })],
      { clock: clock.clock },
    );
    for (let i = 0; i < 2; i += 1) {
      await gate.run("provider_a", {
        operation: "op",
        maxAttempts: 1,
        call: () => {
          contacts += 1;
          return Promise.reject(new Error("down"));
        },
      });
    }
    expect(contacts).toBe(2);
    const denied = await gate.run("provider_a", {
      operation: "op",
      maxAttempts: 1,
      call: () => {
        contacts += 1;
        return Promise.resolve("reached");
      },
    });
    expect(contacts).toBe(2);
    expect(denied.denied).toBe(true);
    if (denied.denied) {
      expect(denied.gate).toBe("degraded_denied");
      expect(denied.detail).toContain("whileDegraded=deny");
    }
  });

  it("whileDegraded=deny admits again once the degraded episode expires", async () => {
    const clock = immediateClock();
    const gate = semantics(
      [profile({ degradedAfterFailures: 2, breakerFailureThreshold: 6, degradedWindowMs: 5_000, whileDegraded: "deny" })],
      { clock: clock.clock },
    );
    for (let i = 0; i < 2; i += 1) {
      await gate.run("provider_a", {
        operation: "op",
        maxAttempts: 1,
        call: () => Promise.reject(new Error("down")),
      });
    }
    clock.advance(5_000);
    const snapshot = gate.snapshot("provider_a");
    if (snapshot) expect(snapshot.policy.mode).toBe("healthy");
    let contacts = 0;
    const admitted = await gate.run("provider_a", {
      operation: "op",
      maxAttempts: 1,
      call: () => {
        contacts += 1;
        return Promise.resolve("back");
      },
    });
    expect(contacts).toBe(1);
    expect(admitted.denied).toBe(false);
  });

  it("a cleared episode (first success) re-admits a whileDegraded=deny provider", async () => {
    const clock = immediateClock();
    const gate = semantics(
      [profile({ degradedAfterFailures: 2, breakerFailureThreshold: 6, whileDegraded: "deny" })],
      { clock: clock.clock },
    );
    for (let i = 0; i < 2; i += 1) {
      await gate.run("provider_a", {
        operation: "op",
        maxAttempts: 1,
        call: () => Promise.reject(new Error("down")),
      });
    }
    let denied = await gate.run("provider_a", {
      operation: "op",
      maxAttempts: 1,
      call: () => Promise.resolve("x"),
    });
    expect(denied.denied).toBe(true);
    clock.advance(60_000);
    const recovered = await gate.run("provider_a", {
      operation: "op",
      maxAttempts: 1,
      call: () => Promise.resolve("healthy again"),
    });
    expect(recovered.denied).toBe(false);
    if (!recovered.denied && recovered.policy.outcome === "ok") {
      expect(recovered.policy.mode).not.toBe("degraded");
    }
    denied = await gate.run("provider_a", {
      operation: "op",
      maxAttempts: 1,
      call: () => Promise.resolve("x"),
    });
    expect(denied.denied).toBe(false);
  });
});

describe("per-provider trust decisions (E-060: never automatically trusted)", () => {
  it("admits a fresh provider while its history is unproven", async () => {
    const gate = semantics([profile()], { clock: immediateClock().clock });
    const result = await gate.run("provider_a", {
      operation: "op",
      call: () => Promise.resolve("ok"),
    });
    expect(result.denied).toBe(false);
    const snapshot = gate.snapshot("provider_a");
    if (snapshot) {
      expect(snapshot.effectiveTrustVerdict).toBe("unproven");
      expect(snapshot.trustGateSource.kind).toBe("recommendation");
    }
  });

  it("never promotes a provider to trusted from success history alone", async () => {
    const clock = immediateClock();
    const gate = semantics([profile({ breakerFailureThreshold: MAX_BREAKER_THRESHOLD })], {
      clock: clock.clock,
    });
    for (let i = 0; i < 50; i += 1) {
      const result = await gate.run("provider_a", {
        operation: "op",
        maxAttempts: 1,
        call: () => Promise.resolve("up"),
      });
      expect(result.denied).toBe(false);
    }
    const snapshot = gate.snapshot("provider_a");
    if (snapshot) expect(snapshot.effectiveTrustVerdict).toBe("unproven");
    const trail = gate.auditTrail();
    expect(
      trail.some((e) => e.source === "semantics" && e.event.kind === "trust_decision_recorded"),
    ).toBe(false);
  });

  it("denies calls at the trust gate once the failure history exceeds the floor", async () => {
    const clock = immediateClock();
    let contacts = 0;
    const gate = semantics([profile({ breakerFailureThreshold: 2, degradedAfterFailures: 1 })], {
      clock: clock.clock,
    });
    for (let i = 0; i < 2; i += 1) {
      await gate.run("provider_a", {
        operation: "op",
        maxAttempts: 1,
        call: () => {
          contacts += 1;
          return Promise.reject(new Error("down"));
        },
      });
    }
    const snapshot = gate.snapshot("provider_a");
    if (snapshot) expect(snapshot.effectiveTrustVerdict).toBe("untrusted");
    const denied = await gate.run("provider_a", {
      operation: "op",
      maxAttempts: 1,
      call: () => {
        contacts += 1;
        return Promise.resolve("reached");
      },
    });
    expect(contacts).toBe(2);
    expect(denied.denied).toBe(true);
    if (denied.denied) {
      expect(denied.gate).toBe("trust_gate");
      expect(denied.detail).toContain("E-060");
    }
    const trail = gate.auditTrail();
    const recommendation = trail.find(
      (e): e is Extract<AdapterSemanticsAuditEvent, { source: "semantics" }> =>
        e.source === "semantics" && e.event.kind === "trust_recommendation",
    );
    expect(recommendation).toBeDefined();
    if (recommendation && recommendation.event.kind === "trust_recommendation") {
      expect(recommendation.event.verdict).toBe("untrusted");
    }
  });

  it("denies on aggregate failure-rate evidence even without consecutive failures", async () => {
    const clock = immediateClock();
    const gate = semantics(
      [profile({ breakerFailureThreshold: 5, degradedAfterFailures: 5, whileDegraded: "admit" })],
      { clock: clock.clock },
    );
    const fail = (): Promise<number> => Promise.reject(new Error("down"));
    const win = (): Promise<number> => Promise.resolve(1);
    for (const call of [fail, fail, fail, win, win]) {
      await gate.run("provider_a", { operation: "op", maxAttempts: 1, call });
    }
    const denied = await gate.run("provider_a", {
      operation: "op",
      maxAttempts: 1,
      call: win,
    });
    expect(denied.denied).toBe(true);
    if (denied.denied) expect(denied.gate).toBe("trust_gate");
  });

  it("re-admits a distrusted provider only through an explicit governed decision", async () => {
    const clock = immediateClock();
    const gate = semantics([profile({ breakerFailureThreshold: 2, degradedAfterFailures: 1 })], {
      clock: clock.clock,
    });
    for (let i = 0; i < 2; i += 1) {
      await gate.run("provider_a", {
        operation: "op",
        maxAttempts: 1,
        call: () => Promise.reject(new Error("down")),
      });
    }
    const blocked = await gate.run("provider_a", {
      operation: "op",
      maxAttempts: 1,
      call: () => Promise.resolve("x"),
    });
    expect(blocked.denied).toBe(true);

    const rejected = gate.recordTrustDecision("provider_a", {
      verdict: "trusted",
      reason: "",
      decidedBy: "role:operator",
    });
    expect(rejected.ok).toBe(false);

    const decision = gate.recordTrustDecision("provider_a", {
      verdict: "trusted",
      reason: "operator verified recovery out of band",
      decidedBy: "role:operator",
    });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.decision.decidedBy).toBe("role:operator");
      expect(decision.decision.basis.totalFailures).toBe(2);
    }
    const snapshot = gate.snapshot("provider_a");
    if (snapshot) {
      expect(snapshot.effectiveTrustVerdict).toBe("trusted");
      expect(snapshot.trustGateSource.kind).toBe("explicit_decision");
    }
    const admitted = await gate.run("provider_a", {
      operation: "op",
      maxAttempts: 1,
      call: () => Promise.resolve("governed"),
    });
    expect(admitted.denied).toBe(false);
    const trail = gate.auditTrail();
    expect(
      trail.some((e) => e.source === "policy" && e.event.kind === "trust_decision"),
    ).toBe(true);
  });

  it("fails closed on a trust decision for an undeclared provider", () => {
    const gate = semantics([profile()], { clock: immediateClock().clock });
    const result = gate.recordTrustDecision("provider_x", {
      verdict: "trusted",
      reason: "n/a",
      decidedBy: "role:operator",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unknown_provider");
  });

  it("rejects malformed decisions and records the rejection", () => {
    const gate = semantics([profile()], { clock: immediateClock().clock });
    const badVerdict = gate.recordTrustDecision("provider_a", {
      verdict: "automatic" as unknown as "trusted",
      reason: "self-promotion",
      decidedBy: "agent:x",
    });
    expect(badVerdict.ok).toBe(false);
    if (!badVerdict.ok) expect(badVerdict.reason).toBe("invalid_decision");
    const badDecidedBy = gate.recordTrustDecision("provider_a", {
      verdict: "trusted",
      reason: "r",
      decidedBy: " ",
    });
    expect(badDecidedBy.ok).toBe(false);
    const trail = gate.auditTrail();
    expect(
      trail.some((e) => e.source === "semantics" && e.event.kind === "trust_decision_rejected"),
    ).toBe(true);
    const snapshot = gate.snapshot("provider_a");
    if (snapshot) expect(snapshot.effectiveTrustVerdict).toBe("unproven");
  });
});

describe("provider isolation and observability", () => {
  it("one provider's failure history never contaminates another", async () => {
    const clock = immediateClock();
    const gate = semantics(
      [
        profile({ provider: "provider_a", breakerFailureThreshold: 2, degradedAfterFailures: 1 }),
        profile({ provider: "provider_b", breakerFailureThreshold: 2, degradedAfterFailures: 1 }),
      ],
      { clock: clock.clock },
    );
    for (let i = 0; i < 2; i += 1) {
      await gate.run("provider_a", {
        operation: "op",
        maxAttempts: 1,
        call: () => Promise.reject(new Error("down")),
      });
    }
    const blocked = await gate.run("provider_a", {
      operation: "op",
      maxAttempts: 1,
      call: () => Promise.resolve("x"),
    });
    expect(blocked.denied).toBe(true);
    if (blocked.denied) expect(blocked.gate).toBe("trust_gate");

    let bContacts = 0;
    const bResult = await gate.run("provider_b", {
      operation: "op",
      maxAttempts: 1,
      call: () => {
        bContacts += 1;
        return Promise.resolve("independent");
      },
    });
    expect(bContacts).toBe(1);
    expect(bResult.denied).toBe(false);
    const bSnapshot = gate.snapshot("provider_b");
    if (bSnapshot) {
      expect(bSnapshot.effectiveTrustVerdict).toBe("unproven");
      expect(bSnapshot.policy.mode).toBe("healthy");
    }
  });

  it("forwards policy events into the audit trail and the injected sink", async () => {
    const seen: AdapterSemanticsAuditEvent[] = [];
    const clock = immediateClock();
    const gate = semantics([profile({ maxAttempts: 1 })], {
      clock: clock.clock,
      onEvent: (event) => {
        seen.push(event);
      },
    });
    await gate.run("provider_a", {
      operation: "op",
      call: () => Promise.reject(new Error("down")),
    });
    const policyFailures = seen.filter(
      (e): e is { source: "policy"; event: AdapterPolicyEvent } =>
        e.source === "policy" && e.event.kind === "call_failed",
    );
    expect(policyFailures).toHaveLength(1);
    const semanticsDenials = seen.filter(
      (e) => e.source === "semantics" && e.event.kind === "call_denied",
    );
    expect(semanticsDenials).toHaveLength(0);
  });

  it("never lets a throwing observability sink break containment", async () => {
    const clock = immediateClock();
    const gate = semantics([profile({ maxAttempts: 1 })], {
      clock: clock.clock,
      onEvent: () => {
        throw new Error("sink defect");
      },
    });
    const result = await gate.run("provider_a", {
      operation: "op",
      call: () => Promise.resolve("fine"),
    });
    expect(result.denied).toBe(false);
    if (!result.denied) expect(result.policy.outcome).toBe("ok");
  });

  it("returns an immutable audit trail copy", () => {
    const gate = semantics([profile()], { clock: immediateClock().clock });
    const before = gate.auditTrail().length;
    const trail = gate.auditTrail();
    (trail as AdapterSemanticsAuditEvent[]).push({
      source: "semantics",
      event: { kind: "call_denied", provider: "forged", gate: "unknown_provider", detail: "forged", atMs: 0 },
    });
    expect(gate.auditTrail().length).toBe(before);
  });

  it("returns null (never a default) for an undeclared provider snapshot", () => {
    const gate = semantics([profile()], { clock: immediateClock().clock });
    expect(gate.snapshot("provider_x")).toBeNull();
  });
});
