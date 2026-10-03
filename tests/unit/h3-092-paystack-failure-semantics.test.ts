/**
 * CoreGrid — H3-092 Paystack failure-semantics tests (mission I-092,
 * Squad I — Payments & economics).
 *
 * Pins the REAL failure paths of the Paystack adapter stack (read-only on
 * the adapter; AGENTS §23 — understand before modifying):
 *
 * 1. Declared failure policy wiring (J-045): the BLK-4 contract adapter and
 *    the TEST-MODE live client each carry an explicit, validated policy —
 *    injected instances pass through, defaults are the declared budgets,
 *    and misconfiguration fails fast instead of silently weakening policy.
 * 2. Degraded mode: explicit (mode_change events, never silent), armed at
 *    the declared threshold, time-bounded, re-armed by further failures,
 *    cleared by the first success.
 * 3. Circuit breaker: opens at the declared threshold, denies WITHOUT
 *    provider contact, admits exactly one half-open probe after the reset
 *    window, denies concurrent probes, closes on success, re-opens on
 *    probe failure.
 * 4. Local containment never gates: webhook signature verification, webhook
 *    parsing and intent creation stay available while the provider is
 *    degraded or isolated — local verification must keep working even when
 *    the provider is distrusted. Every failure is a structured result,
 *    never a thrown host-loop crash.
 * 5. Trust ledger (E-060): the computed recommendation is "unproven" or
 *    "untrusted" only — no failure/success history ever grants "trusted"
 *    automatically; no implicit trust decision is ever recorded.
 * 6. TEST-MODE live client (offline via injected transport + clock):
 *    bounded timeouts contain hung providers; mutations are attempted
 *    exactly once (replay protection — no transport retry); idempotent
 *    verification retries within the declared budget with deterministic
 *    backoff; provider failures and malformed responses are contained
 *    with secret-free reasons; ownership is re-checked against the
 *    canonical reference (the provider's word alone is never ownership
 *    evidence — AGENTS §36).
 *
 * Pure offline: no network, no database, no secrets. All time flows from
 * injected clocks — a deferred manual clock for timeout timing, an
 * immediate clock for retry/breaker loops. Every credential below is a
 * clearly-marked fixture, never a real key.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createAdapterFailurePolicy,
  type AdapterClock,
  type AdapterPolicyEvent,
} from "../../frontend/src/lib/adapters/failure-policy";
import {
  createPaystackAdapter,
  paystackRefundUnsupported,
  PAYSTACK_FAILURE_POLICY,
} from "../../frontend/src/lib/payments/paystack-adapter";
import {
  createPaystackTestModePolicy,
  initializePaystackTestTransaction,
  verifyOwnedPayment,
  type PaystackAuditEntry,
  type PaystackTestModeConfig,
} from "../../frontend/src/lib/payments/paystack-testmode.server";
import type {
  PaymentReference,
  WebhookRequest,
} from "../../frontend/src/lib/payments/payment-contract";
import { money } from "../../frontend/src/lib/financial-core";
import { tenantId } from "../../frontend/src/lib/tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Fixtures (clearly marked; never real credentials)
 * ────────────────────────────────────────────────────────────*/

const FIXTURE_SECRET = "h3-092-fixture-secret-not-a-real-credential";
const TEST_KEY = "sk_test_h3_092_fixture_not_a_real_credential";
const RECEIVED_AT_SEC = 1_727_740_000;

function reference(): PaymentReference {
  return {
    tenantId: tenantId("tenant-a"),
    payerRef: "user-0001",
    amount: money(15_000, "NGN"),
    purpose: { kind: "fee_payment", ref: "fee-0001" },
  };
}

const SUCCESS_BODY = JSON.stringify({
  event: "charge.success",
  data: {
    reference: "uos_fee0001_1727740000",
    amount: 15_000,
    currency: "NGN",
    metadata: { school_id: "scholar-tenant-a", fee_id: "fee-0001" },
  },
});

function signedRequest(body: string, secret: string = FIXTURE_SECRET): WebhookRequest {
  const signature = createHmac("sha512", secret).update(body, "utf8").digest("hex");
  return {
    rawBody: new TextEncoder().encode(body),
    headers: { "x-paystack-signature": signature },
    receivedAtSec: RECEIVED_AT_SEC,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Injectable clocks: nothing runs implicitly
 * ────────────────────────────────────────────────────────────*/

/** Deferred-delay clock: time only passes when the test fires the delays. */
function manualClock(startMs = 1_000_000): {
  clock: AdapterClock;
  at(): number;
  advance(ms: number): void;
  fireDelays(): void;
} {
  let now = startMs;
  const pending: { resolve: () => void }[] = [];
  const clock: AdapterClock = {
    nowMs: () => now,
    delay: (_ms: number) =>
      new Promise<void>((resolve) => {
        pending.push({ resolve });
      }),
  };
  return {
    clock,
    at(): number {
      return now;
    },
    advance(ms: number): void {
      now += ms;
    },
    fireDelays(): void {
      const all = pending.splice(0, pending.length);
      for (const d of all) d.resolve();
    },
  };
}

/**
 * Macrotask-delay clock: virtual time advances instantly and backoff values
 * are recorded, but a requested delay only settles on the NEXT macrotask —
 * so a fast-settling injected transport always wins the policy's
 * timeout race in a microtask, while retry loops still complete.
 */
function macroTaskClock(startMs = 1_000_000): {
  clock: AdapterClock;
  at(): number;
  advance(ms: number): void;
  requestedDelays(): number[];
} {
  let now = startMs;
  const requested: number[] = [];
  const clock: AdapterClock = {
    nowMs: () => now,
    delay: (ms: number) => {
      requested.push(ms);
      now += ms;
      return new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    },
  };
  return {
    clock,
    at(): number {
      return now;
    },
    advance(ms: number): void {
      now += ms;
    },
    requestedDelays(): number[] {
      return requested;
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Harnesses
 * ────────────────────────────────────────────────────────────*/

/** The adapter's declared BLK-4 budgets, mirrored for injection. */
const ADAPTER_POLICY_BUDGETS = {
  provider: "paystack",
  timeoutMs: 5_000,
  maxAttempts: 1,
  backoffBaseMs: 250,
  backoffCapMs: 4_000,
  degradedAfterFailures: 3,
  degradedWindowMs: 60_000,
  breakerFailureThreshold: 5,
  breakerResetMs: 30_000,
} as const;

function makeAdapterHarness(startMs = 1_000_000): {
  adapter: ReturnType<typeof createPaystackAdapter>;
  policy: ReturnType<typeof createAdapterFailurePolicy>;
  clock: ReturnType<typeof manualClock>;
  events: AdapterPolicyEvent[];
  driveFailure(reason: string): void;
  driveSuccess(value: number): void;
} {
  const events: AdapterPolicyEvent[] = [];
  const clock = manualClock(startMs);
  const policy = createAdapterFailurePolicy({
    ...ADAPTER_POLICY_BUDGETS,
    clock: clock.clock,
    onEvent: (event) => events.push(event),
  });
  const adapter = createPaystackAdapter({ secretKey: FIXTURE_SECRET, failurePolicy: policy });
  return {
    adapter,
    policy,
    clock,
    events,
    driveFailure(reason: string): void {
      policy.containSync("h3-092.driver", () => {
        throw new Error(reason);
      });
    },
    driveSuccess(value: number): void {
      policy.containSync("h3-092.driver-ok", () => value);
    },
  };
}

const VERIFY_OK = {
  status: true,
  message: "Verification successful",
  data: { status: "success", amount: 15_000, currency: "NGN" },
};

const INIT_OK = {
  status: true,
  message: "Authorization created",
  data: {
    authorization_url: "https://checkout.paystack.com/abc123",
    access_code: "abc123",
  },
};

function jsonResponse(status: number, body: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function testModeConfig(
  overrides: Partial<PaystackTestModeConfig> & { entries?: PaystackAuditEntry[] } = {},
): PaystackTestModeConfig {
  const entries = overrides.entries ?? [];
  return {
    secretKey: overrides.secretKey ?? TEST_KEY,
    transport:
      overrides.transport ??
      (() => Promise.reject(new Error("transport must be injected in unit tests"))),
    audit:
      overrides.audit ??
      ((entry: PaystackAuditEntry) => {
        entries.push(entry);
      }),
    failurePolicy: overrides.failurePolicy,
    baseUrl: overrides.baseUrl,
  };
}

function testModePolicy(
  clock: AdapterClock,
  breakerFailureThreshold = 5,
  degradedAfterFailures = 3,
): ReturnType<typeof createAdapterFailurePolicy> {
  return createAdapterFailurePolicy({
    provider: "paystack-testmode",
    timeoutMs: 10_000,
    maxAttempts: 2,
    backoffBaseMs: 250,
    backoffCapMs: 4_000,
    degradedAfterFailures,
    degradedWindowMs: 60_000,
    breakerFailureThreshold,
    breakerResetMs: 30_000,
    clock,
  });
}

/* ─────────────────────────────────────────────────────────────
 * 1. Declared failure-policy wiring (J-045)
 * ────────────────────────────────────────────────────────────*/

describe("declared failure-policy wiring", () => {
  it("the BLK-4 adapter carries the declared paystack budgets and starts healthy and unproven", () => {
    const snapshot = PAYSTACK_FAILURE_POLICY.snapshot();
    expect(snapshot.provider).toBe("paystack");
    expect(snapshot.mode).toBe("healthy");
    expect(snapshot.breaker).toBe("closed");
    expect(snapshot.degradedActive).toBe(false);
    expect(snapshot.trustVerdict).toBe("unproven");
    expect(snapshot.declared).toEqual({
      timeoutMs: 5_000,
      maxAttempts: 1,
      degradedAfterFailures: 3,
      degradedWindowMs: 60_000,
      breakerFailureThreshold: 5,
      breakerResetMs: 30_000,
    });
    // Degraded must engage no later than isolation (policy invariant).
    expect(snapshot.declared.degradedAfterFailures).toBeLessThanOrEqual(
      snapshot.declared.breakerFailureThreshold,
    );
  });

  it("injected policies pass through unchanged; the default is exactly the declared module policy", () => {
    const adapterDefault = createPaystackAdapter({ secretKey: FIXTURE_SECRET });
    expect(adapterDefault.failurePolicy).toBe(PAYSTACK_FAILURE_POLICY);
    expect(adapterDefault.provider).toBe("paystack");

    const injected = createAdapterFailurePolicy({ ...ADAPTER_POLICY_BUDGETS });
    const adapterInjected = createPaystackAdapter({
      secretKey: FIXTURE_SECRET,
      failurePolicy: injected,
    });
    expect(adapterInjected.failurePolicy).toBe(injected);
  });

  it("the TEST-MODE client declares its own bounded budgets (10s timeout, 2 attempts)", () => {
    const snapshot = createPaystackTestModePolicy().snapshot();
    expect(snapshot.provider).toBe("paystack-testmode");
    expect(snapshot.declared).toEqual({
      timeoutMs: 10_000,
      maxAttempts: 2,
      degradedAfterFailures: 3,
      degradedWindowMs: 60_000,
      breakerFailureThreshold: 5,
      breakerResetMs: 30_000,
    });
    expect(snapshot.declared.degradedAfterFailures).toBeLessThanOrEqual(
      snapshot.declared.breakerFailureThreshold,
    );
  });

  it("misconfiguration fails fast — policy can never silently weaken itself", () => {
    expect(() =>
      createAdapterFailurePolicy({
        ...ADAPTER_POLICY_BUDGETS,
        degradedAfterFailures: 6,
        breakerFailureThreshold: 5,
      }),
    ).toThrow(TypeError);
    expect(() =>
      createAdapterFailurePolicy({ ...ADAPTER_POLICY_BUDGETS, timeoutMs: 0 }),
    ).toThrow(TypeError);
    expect(() =>
      createAdapterFailurePolicy({ ...ADAPTER_POLICY_BUDGETS, maxAttempts: 0 }),
    ).toThrow(TypeError);
    expect(() =>
      createAdapterFailurePolicy({
        ...ADAPTER_POLICY_BUDGETS,
        backoffBaseMs: 4_000,
        backoffCapMs: 250,
      }),
    ).toThrow(TypeError);
  });

  it("refund capability stays BLK-4 blocked — the contract never promises what it cannot deliver", () => {
    const adapter = createPaystackAdapter({ secretKey: FIXTURE_SECRET });
    expect(adapter.capabilities.refunds).toBe(false);
    expect(adapter.refund).toBeUndefined();
    expect(paystackRefundUnsupported()).toEqual({
      ok: false,
      code: "unsupported",
      reason: "Paystack refunds are BLK-4 blocked in V1",
    });
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Degraded mode: explicit, recorded, time-bounded
 * ────────────────────────────────────────────────────────────*/

describe("degraded mode semantics (declared: 3 failures / 60s window)", () => {
  it("arms after the declared consecutive-failure threshold and announces it on the event sink", () => {
    const { policy, events, driveFailure } = makeAdapterHarness();

    driveFailure("driver 1");
    driveFailure("driver 2");
    expect(policy.snapshot().mode).toBe("healthy");
    expect(policy.snapshot().degradedActive).toBe(false);

    driveFailure("driver 3");
    const snapshot = policy.snapshot();
    expect(snapshot.mode).toBe("degraded");
    expect(snapshot.degradedActive).toBe(true);
    expect(snapshot.degradedExpired).toBe(false);
    expect(snapshot.consecutiveFailures).toBe(3);
    expect(snapshot.declared.degradedWindowMs).toBe(60_000);

    const armed = events.find(
      (event) => event.kind === "mode_change" && event.to === "degraded",
    );
    expect(armed).toBeDefined();
    if (armed?.kind === "mode_change") {
      expect(armed.from).toBe("healthy");
      expect(armed.reason).toContain("degraded threshold (3)");
    }
  });

  it("is time-bounded: the recorded episode expires after the declared window", () => {
    const { policy, clock, driveFailure } = makeAdapterHarness();

    driveFailure("f1");
    driveFailure("f2");
    driveFailure("f3");
    expect(policy.snapshot().mode).toBe("degraded");

    clock.advance(60_000);
    const expired = policy.snapshot();
    expect(expired.degradedActive).toBe(true);
    expect(expired.degradedExpired).toBe(true);
    expect(expired.mode).toBe("healthy");
  });

  it("is cleared by the first success and re-armed (never silent) by further failures", () => {
    const { policy, events, clock, driveFailure, driveSuccess } = makeAdapterHarness();

    driveFailure("f1");
    driveFailure("f2");
    driveFailure("f3");
    expect(policy.snapshot().mode).toBe("degraded");

    driveSuccess(1);
    const cleared = policy.snapshot();
    expect(cleared.degradedActive).toBe(false);
    expect(cleared.mode).toBe("healthy");
    expect(cleared.consecutiveFailures).toBe(0);
    const clearedEvent = events.find(
      (event) =>
        event.kind === "mode_change" && event.from === "degraded" && event.to === "healthy",
    );
    expect(clearedEvent).toBeDefined();

    // Re-arm: a fresh episode starts from a fresh window, announced again.
    clock.advance(1_000);
    driveFailure("r1");
    driveFailure("r2");
    driveFailure("r3");
    const reArmed = policy.snapshot();
    expect(reArmed.degradedActive).toBe(true);
    expect(reArmed.mode).toBe("degraded");
    expect(reArmed.degradedExpired).toBe(false);
    const reArmEvents = events.filter(
      (event) => event.kind === "mode_change" && event.to === "degraded",
    );
    expect(reArmEvents).toHaveLength(2);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Circuit breaker: deny without provider contact
 * ────────────────────────────────────────────────────────────*/

describe("circuit breaker semantics (declared: 5 failures / 30s reset)", () => {
  it("opens at the declared threshold and denies external calls WITHOUT provider contact", async () => {
    const { policy, clock, events, driveFailure } = makeAdapterHarness();

    for (let i = 1; i <= 5; i += 1) driveFailure(`f${i}`);
    const snapshot = policy.snapshot();
    expect(snapshot.breaker).toBe("open");
    expect(snapshot.mode).toBe("isolated");
    expect(snapshot.breakerNextProbeAtMs).toBe(clock.at() /* start */ + 30_000);
    const opened = events.find(
      (event) => event.kind === "breaker_change" && event.to === "open",
    );
    expect(opened).toBeDefined();

    let contacted = 0;
    const denied = await policy.run({
      operation: "external.paystack-call",
      call: async () => {
        contacted += 1;
        return 1;
      },
    });
    expect(denied.outcome).toBe("error");
    expect(contacted).toBe(0);
    if (denied.outcome === "error") {
      expect(denied.code).toBe("breaker_open");
      expect(denied.reason).toContain("without provider contact");
      expect(denied.attempts).toBe(0);
      expect(denied.mode).toBe("isolated");
    }
  });

  it("admits exactly one half-open probe after the reset window; success closes the breaker", async () => {
    const { policy, clock, driveFailure } = makeAdapterHarness();

    for (let i = 1; i <= 5; i += 1) driveFailure(`f${i}`);
    expect(policy.snapshot().breaker).toBe("open");

    clock.advance(30_000);
    const probe = await policy.run({
      operation: "external.paystack-call",
      call: async () => 42,
    });
    expect(probe.outcome).toBe("ok");
    expect(policy.snapshot().breaker).toBe("closed");
    expect(policy.snapshot().mode).toBe("healthy");
  });

  it("denies concurrent half-open probes; a failed probe re-opens the breaker", async () => {
    const { policy, clock, driveFailure } = makeAdapterHarness();

    for (let i = 1; i <= 5; i += 1) driveFailure(`f${i}`);
    expect(policy.snapshot().breaker).toBe("open");
    clock.advance(30_000);

    let resolveProbe!: (value: number) => void;
    const inFlightCall = new Promise<number>((resolve) => {
      resolveProbe = resolve;
    });
    let probeContacted = 0;
    const probeRun = policy.run({
      operation: "external.probe",
      call: () => {
        probeContacted += 1;
        return inFlightCall;
      },
    });

    const concurrent = await policy.run({
      operation: "external.probe",
      call: async () => 7,
    });
    expect(concurrent.outcome).toBe("error");
    expect(probeContacted).toBe(1);
    if (concurrent.outcome === "error") {
      expect(concurrent.code).toBe("breaker_open");
      expect(concurrent.reason).toContain("half-open probe");
    }

    resolveProbe(7);
    const probeResult = await probeRun;
    expect(probeResult.outcome).toBe("ok");
    expect(policy.snapshot().breaker).toBe("closed");

    // A failed probe after the next reset window re-opens the breaker.
    for (let i = 1; i <= 5; i += 1) driveFailure(`g${i}`);
    expect(policy.snapshot().breaker).toBe("open");
    clock.advance(30_000);
    const failedProbe = await policy.run({
      operation: "external.probe",
      call: async () => {
        throw new Error("probe failure fixture");
      },
    });
    expect(failedProbe.outcome).toBe("error");
    const reOpened = policy.snapshot();
    expect(reOpened.breaker).toBe("open");
    expect(reOpened.breakerNextProbeAtMs).toBe(clock.at() + 30_000);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. Local containment never gates
 * ────────────────────────────────────────────────────────────*/

describe("local webhook/intent operations under provider distrust", () => {
  it("local operations keep working while the provider is degraded", () => {
    const { policy, adapter, driveFailure } = makeAdapterHarness();
    driveFailure("f1");
    driveFailure("f2");
    driveFailure("f3");
    expect(policy.snapshot().mode).toBe("degraded");

    expect(adapter.verifySignature(signedRequest(SUCCESS_BODY)).ok).toBe(true);
    expect(adapter.parseWebhook(signedRequest(SUCCESS_BODY)).ok).toBe(true);
    const intent = adapter.createIntent(reference(), "2026-10-03T00:00:00.000Z");
    expect(intent.ok).toBe(true);
  });

  it("local operations keep working while the breaker is open (isolated) — containment never gates", () => {
    const { policy, adapter, driveFailure } = makeAdapterHarness();
    for (let i = 1; i <= 5; i += 1) driveFailure(`f${i}`);
    expect(policy.snapshot().mode).toBe("isolated");
    expect(policy.snapshot().breaker).toBe("open");

    expect(adapter.verifySignature(signedRequest(SUCCESS_BODY)).ok).toBe(true);
    expect(adapter.parseWebhook(signedRequest(SUCCESS_BODY)).ok).toBe(true);
    const intent = adapter.createIntent(reference(), "2026-10-03T00:00:00.000Z");
    expect(intent.ok).toBe(true);
    // Local successes never close an open breaker — only the half-open probe does.
    expect(policy.snapshot().breaker).toBe("open");
  });

  it("every webhook failure is a structured result — the adapter never throws into the host loop", () => {
    const adapter = createPaystackAdapter({ secretKey: FIXTURE_SECRET });

    const unsigned: WebhookRequest = {
      rawBody: new TextEncoder().encode(SUCCESS_BODY),
      headers: {},
      receivedAtSec: RECEIVED_AT_SEC,
    };
    const unsignedResult = adapter.parseWebhook(unsigned);
    expect(unsignedResult).toMatchObject({ ok: false, code: "signature_invalid" });

    const forged = signedRequest(SUCCESS_BODY, "attacker-fixture-secret");
    expect(adapter.parseWebhook(forged)).toMatchObject({ ok: false, code: "signature_invalid" });

    const garbage = signedRequest("this is not json at all");
    expect(adapter.parseWebhook(garbage)).toMatchObject({ ok: false, code: "malformed_payload" });

    const unknownEvent = signedRequest(
      JSON.stringify({ event: "subscription.create", data: { reference: "r", amount: 1, currency: "NGN" } }),
    );
    expect(adapter.parseWebhook(unknownEvent)).toMatchObject({ ok: false, code: "unknown_event" });

    const badAmount = signedRequest(
      JSON.stringify({
        event: "charge.success",
        data: { reference: "r", amount: 15.5, currency: "NGN" },
      }),
    );
    expect(adapter.parseWebhook(badAmount)).toMatchObject({ ok: false, code: "malformed_payload" });

    // Invalid references fail closed without fabricating an intent.
    const invalid = adapter.createIntent(
      { ...reference(), amount: money(0, "NGN") },
      "2026-10-03T00:00:00.000Z",
    );
    expect(invalid).toMatchObject({ ok: false, code: "invalid_reference" });
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. Trust ledger (E-060: external systems are never automatically trusted)
 * ────────────────────────────────────────────────────────────*/

describe("provider trust ledger (E-060)", () => {
  it("recommendations start unproven, become untrusted after breaker-level failures, and never become trusted automatically", () => {
    const { policy, driveFailure, driveSuccess } = makeAdapterHarness();

    const initial = policy.recommendTrust();
    expect(initial.verdict).toBe("unproven");
    expect(initial.reason).toContain("never automatically trusted");

    for (let i = 1; i <= 5; i += 1) driveFailure(`f${i}`);
    const recommendation = policy.recommendTrust();
    expect(recommendation.basis.consecutiveFailures).toBe(5);
    expect(recommendation.basis.totalCalls).toBe(5);
    // Compile-time pin: the recommendation verdict space excludes "trusted".
    const verdict: "untrusted" | "unproven" = recommendation.verdict;
    expect(verdict).toBe("untrusted");

    driveSuccess(1);
    // A single success does not absorb the failure-rate evidence (5/6 ≥ 0.5
    // still warrants distrust) — and trust is never granted automatically
    // in any case; no decision is recorded implicitly.
    const after = policy.recommendTrust();
    expect(after.basis.totalFailures).toBe(5);
    expect(after.basis.totalCalls).toBe(6);
    expect(after.verdict).toBe("untrusted");
    expect(policy.currentTrustVerdict()).toBe("unproven");
    expect(policy.trustDecisions()).toHaveLength(0);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 6. TEST-MODE client: bounded timeout containment
 * ────────────────────────────────────────────────────────────*/

describe("TEST-MODE: bounded timeout containment", () => {
  it("a hung provider is contained as a timeout; the mutation is attempted exactly once and the audit evidence survives", async () => {
    const clock = manualClock();
    const policy = testModePolicy(clock.clock);
    const entries: PaystackAuditEntry[] = [];
    let transportCalls = 0;
    const config = testModeConfig({
      failurePolicy: policy,
      entries,
      transport: () => {
        transportCalls += 1;
        return new Promise<Response>(() => {
          /* hung provider fixture — never settles */
        });
      },
    });

    const pending = initializePaystackTestTransaction(config, reference(), "payer@example.com");
    // Let the call reach the policy's timeout race before firing the clock.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    clock.fireDelays();
    const result = await pending;

    expect(result).toMatchObject({ ok: false, code: "timeout" });
    if (!result.ok) {
      expect(result.reason).toContain("exceeded the 10000ms adapter timeout");
      expect(result.reason).not.toContain(TEST_KEY);
    }
    // Mutations are never retried at the transport — replay protection.
    expect(transportCalls).toBe(1);
    // The audit-before-execute record survives the provider failure.
    expect(entries).toHaveLength(1);
    expect(policy.snapshot().totalTimeouts).toBe(1);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 7. TEST-MODE client: contained provider failures
 * ────────────────────────────────────────────────────────────*/

describe("TEST-MODE: contained provider failures and no mutation retry", () => {
  it("a transport rejection on initialize is contained as provider_error with exactly one attempt", async () => {
    const clock = macroTaskClock();
    let transportCalls = 0;
    const config = testModeConfig({
      failurePolicy: testModePolicy(clock.clock),
      transport: () => {
        transportCalls += 1;
        return Promise.reject(new Error("ECONNRESET fixture"));
      },
    });

    const result = await initializePaystackTestTransaction(config, reference(), "payer@example.com");
    expect(result).toMatchObject({ ok: false, code: "provider_error" });
    expect(transportCalls).toBe(1);
    if (!result.ok) {
      expect(result.reason).toContain("ECONNRESET fixture");
      expect(result.reason).not.toContain(TEST_KEY);
    }
  });

  it("an HTTP failure is contained with the provider's message and never the secret key", async () => {
    const clock = macroTaskClock();
    const config = testModeConfig({
      failurePolicy: testModePolicy(clock.clock),
      transport: () => jsonResponse(500, { status: false, message: "gateway unavailable" }),
    });

    const result = await initializePaystackTestTransaction(config, reference(), "payer@example.com");
    expect(result).toMatchObject({ ok: false, code: "provider_error" });
    if (!result.ok) {
      expect(result.reason).toContain("paystack api 500");
      expect(result.reason).toContain("gateway unavailable");
      expect(result.reason).not.toContain(TEST_KEY);
    }
  });

  it("a 200 response without the expected authorization payload is denied as malformed_response", async () => {
    const clock = macroTaskClock();
    const config = testModeConfig({
      failurePolicy: testModePolicy(clock.clock),
      transport: () => jsonResponse(200, { status: false, message: "declined by fixture" }),
    });

    const result = await initializePaystackTestTransaction(config, reference(), "payer@example.com");
    expect(result).toMatchObject({ ok: false, code: "malformed_response" });
  });
});

/* ─────────────────────────────────────────────────────────────
 * 8. TEST-MODE client: bounded retry for idempotent verification
 * ────────────────────────────────────────────────────────────*/

describe("TEST-MODE: idempotent verification retries within the declared budget", () => {
  it("retries a transient failure with deterministic backoff and succeeds on attempt 2", async () => {
    const clock = macroTaskClock();
    let transportCalls = 0;
    const config = testModeConfig({
      failurePolicy: testModePolicy(clock.clock),
      transport: (url) => {
        transportCalls += 1;
        if (transportCalls === 1) return Promise.reject(new Error("flaky fixture"));
        expect(url).toContain("/transaction/verify/ref-0001");
        return jsonResponse(200, VERIFY_OK);
      },
    });

    const result = await verifyOwnedPayment(config, "  ref-0001  ", { amount: money(15_000, "NGN") });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("success");
      expect(result.value.amountMinor).toBe(15_000);
      expect(result.value.currency).toBe("NGN");
    }
    expect(transportCalls).toBe(2);
    // Deterministic retry budget: attempt-1 timeout race, 250ms backoff, attempt-2 timeout race.
    expect(clock.requestedDelays()).toEqual([10_000, 250, 10_000]);
  });

  it("exhausts the declared 2-attempt budget and returns provider_error — never a throw", async () => {
    const clock = macroTaskClock();
    let transportCalls = 0;
    const config = testModeConfig({
      failurePolicy: testModePolicy(clock.clock),
      transport: () => {
        transportCalls += 1;
        return Promise.reject(new Error("persistent outage fixture"));
      },
    });

    const result = await verifyOwnedPayment(config, "ref-0001", { amount: money(15_000, "NGN") });
    expect(result).toMatchObject({ ok: false, code: "provider_error" });
    expect(transportCalls).toBe(2);
    expect(clock.requestedDelays()).toEqual([10_000, 250, 10_000]);
  });

  it("ownership is re-checked against the canonical reference — the provider's word is never ownership evidence", async () => {
    const clock = macroTaskClock();
    const policy = testModePolicy(clock.clock);
    const amountMismatch = testModeConfig({
      failurePolicy: policy,
      transport: () =>
        jsonResponse(200, {
          status: true,
          data: { status: "success", amount: 9_999, currency: "NGN" },
        }),
    });
    const amountResult = await verifyOwnedPayment(amountMismatch, "ref-0001", {
      amount: money(15_000, "NGN"),
    });
    expect(amountResult).toMatchObject({ ok: false, code: "ownership_mismatch" });

    const currencyMismatch = testModeConfig({
      failurePolicy: policy,
      transport: () =>
        jsonResponse(200, {
          status: true,
          data: { status: "success", amount: 15_000, currency: "USD" },
        }),
    });
    const currencyResult = await verifyOwnedPayment(currencyMismatch, "ref-0001", {
      amount: money(15_000, "NGN"),
    });
    expect(currencyResult).toMatchObject({ ok: false, code: "ownership_mismatch" });

    const malformed = testModeConfig({
      failurePolicy: policy,
      transport: () => jsonResponse(200, { status: true, data: { status: 5 } }),
    });
    const malformedResult = await verifyOwnedPayment(malformed, "ref-0001", {
      amount: money(15_000, "NGN"),
    });
    expect(malformedResult).toMatchObject({ ok: false, code: "malformed_response" });
  });
});

/* ─────────────────────────────────────────────────────────────
 * 9. TEST-MODE client: audit-before-execute under failure
 * ────────────────────────────────────────────────────────────*/

describe("TEST-MODE: audit-before-execute under failure (AGENTS §36)", () => {
  it("the audit record precedes the provider call even when the provider fails", async () => {
    const clock = macroTaskClock();
    const entries: PaystackAuditEntry[] = [];
    const order: string[] = [];
    const config = testModeConfig({
      entries,
      failurePolicy: testModePolicy(clock.clock),
      audit: (entry) => {
        order.push("audit");
        entries.push(entry);
      },
      transport: () => {
        order.push("provider");
        return Promise.reject(new Error("outage fixture"));
      },
    });

    const result = await initializePaystackTestTransaction(config, reference(), "payer@example.com");
    expect(result).toMatchObject({ ok: false, code: "provider_error" });
    expect(order).toEqual(["audit", "provider"]);
    expect(entries).toHaveLength(1);
    if (entries[0]) {
      expect(entries[0]).toMatchObject({
        action: "paystack.transaction.initialize",
        provider: "paystack",
        mode: "test",
        tenantId: "tenant-a",
        purposeRef: "fee-0001",
        amountMinor: 15_000,
        currency: "NGN",
      });
    }
  });

  it("a throwing audit sink denies the mutation before any provider contact", async () => {
    const clock = macroTaskClock();
    let transportCalls = 0;
    const config = testModeConfig({
      failurePolicy: testModePolicy(clock.clock),
      audit: () => {
        throw new Error("audit store down fixture");
      },
      transport: () => {
        transportCalls += 1;
        return jsonResponse(200, INIT_OK);
      },
    });

    const result = await initializePaystackTestTransaction(config, reference(), "payer@example.com");
    expect(result).toMatchObject({ ok: false, code: "audit_failed" });
    expect(transportCalls).toBe(0);
    if (!result.ok) {
      expect(result.reason).toContain("audit");
      expect(result.reason).not.toContain(TEST_KEY);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 10. TEST-MODE client: breaker denial without provider contact
 * ────────────────────────────────────────────────────────────*/

describe("TEST-MODE: circuit breaker on the live-call surface", () => {
  it("after the failure threshold, verification is denied without provider contact; the probe closes the breaker", async () => {
    const clock = macroTaskClock();
    const policy = testModePolicy(clock.clock, 2, 2);
    let transportCalls = 0;
    let failTransport = true;
    const config = testModeConfig({
      failurePolicy: policy,
      transport: () => {
        transportCalls += 1;
        return failTransport
          ? Promise.reject(new Error("outage fixture"))
          : jsonResponse(200, VERIFY_OK);
      },
    });

    const first = await verifyOwnedPayment(config, "ref-0001", { amount: money(15_000, "NGN") });
    expect(first).toMatchObject({ ok: false, code: "provider_error" });
    expect(transportCalls).toBe(2);
    expect(policy.snapshot().breaker).toBe("open");
    expect(policy.snapshot().mode).toBe("isolated");

    const denied = await verifyOwnedPayment(config, "ref-0001", { amount: money(15_000, "NGN") });
    expect(denied).toMatchObject({ ok: false, code: "breaker_open" });
    expect(transportCalls).toBe(2);
    if (!denied.ok) {
      expect(denied.reason).toContain("without provider contact");
    }

    // After the reset window, a successful half-open probe closes the breaker.
    failTransport = false;
    clock.advance(30_000);
    const probe = await verifyOwnedPayment(config, "ref-0001", { amount: money(15_000, "NGN") });
    expect(probe.ok).toBe(true);
    expect(policy.snapshot().breaker).toBe("closed");
    expect(policy.snapshot().mode).toBe("healthy");
  });

  it("a failed half-open probe re-opens the breaker and further calls are denied again", async () => {
    const clock = macroTaskClock();
    const policy = testModePolicy(clock.clock, 2, 2);
    const config = testModeConfig({
      failurePolicy: policy,
      transport: () => Promise.reject(new Error("outage fixture")),
    });

    await verifyOwnedPayment(config, "ref-0001", { amount: money(15_000, "NGN") });
    expect(policy.snapshot().breaker).toBe("open");

    clock.advance(30_000);
    const probe = await verifyOwnedPayment(config, "ref-0001", { amount: money(15_000, "NGN") });
    expect(probe).toMatchObject({ ok: false, code: "provider_error" });
    expect(policy.snapshot().breaker).toBe("open");
    expect(policy.snapshot().breakerNextProbeAtMs).toBe(clock.at() + 30_000);

    const denied = await verifyOwnedPayment(config, "ref-0001", { amount: money(15_000, "NGN") });
    expect(denied).toMatchObject({ ok: false, code: "breaker_open" });
    if (!denied.ok) expect(denied.reason).toContain("without provider contact");
  });
});