/**
 * CoreGrid — Paystack TEST-MODE live client tests (MISSION-R-32).
 *
 * All provider I/O runs through an injected transport — no test touches the
 * network. Security focus (AGENTS §36 + §26): test-key-class enforcement,
 * audit-before-execute, canonical ownership validation, idempotency-key
 * registration, circuit-breaker denial without provider contact, and
 * secret-free deny reasons.
 */
import { describe, expect, it, vi } from "vitest";
import {
  initializePaystackTestTransaction,
  paystackTestModeFromEnv,
  validateTestModeKey,
  verifyOwnedPayment,
  type PaystackAuditEntry,
  type PaystackTestModeConfig,
} from "../../frontend/src/lib/payments/paystack-testmode.server";
import { money } from "../../frontend/src/lib/financial-core";
import { tenantId } from "../../frontend/src/lib/tenant-core";
import {
  createAdapterFailurePolicy,
  type AdapterClock,
  type AdapterFailurePolicy,
} from "../../frontend/src/lib/adapters/failure-policy";

const TEST_KEY = "sk_test_fixture_key_not_a_real_credential";
const LIVE_KEY = "sk_live_fixture_key_not_a_real_credential";

function reference(amountMinor = 15_000, currency = "NGN") {
  return {
    tenantId: tenantId("tenant-a"),
    payerRef: "user-0001",
    amount: money(amountMinor, currency),
    purpose: { kind: "fee_payment" as const, ref: "fee-0001" },
  };
}

/** Collect audit entries; also lets a test make the sink throw. */
function auditSink(entries: PaystackAuditEntry[], throwOn?: number) {
  let calls = 0;
  return (entry: PaystackAuditEntry): void => {
    calls += 1;
    if (throwOn !== undefined && calls >= throwOn) throw new Error("audit store down");
    entries.push(entry);
  };
}

function config(
  overrides: Partial<PaystackTestModeConfig> & { auditThrowOn?: number; entries?: PaystackAuditEntry[] } = {},
): PaystackTestModeConfig {
  const entries = overrides.entries ?? [];
  return {
    ...overrides,
    secretKey: overrides.secretKey ?? TEST_KEY,
    transport: overrides.transport ?? ((): Promise<Response> => {
      throw new Error("transport must be injected in unit tests");
    }),
    audit: overrides.audit ?? auditSink(entries, overrides.auditThrowOn),
    failurePolicy: overrides.failurePolicy,
    baseUrl: overrides.baseUrl,
  };
}

function jsonResponse(status: number, body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  }));
}

const INIT_OK = { status: true, message: "Authorization created", data: {
  authorization_url: "https://checkout.paystack.com/abc123",
  access_code: "abc123",
  reference: "cg_tenant-a_user-0001_fee_payment_fee-0001_NGN_15000",
} };

describe("credential class enforcement (test rails only)", () => {
  it("accepts sk_test keys and refuses every other class with a secret-free reason", () => {
    expect(validateTestModeKey("sk_test_abc123")).toEqual({ ok: true });
    for (const key of ["", "  ", LIVE_KEY, "pk_test_abc", "rsk_abc", "sk_abc", "sk Livetest"]) {
      const check = validateTestModeKey(key);
      expect(check.ok).toBe(false);
      if (!check.ok) {
        expect(["missing_key", "non_test_key"]).toContain(check.code);
        if (key.trim() !== "") expect(check.reason).not.toContain(key);
      }
    }
  });

  it("denies every operation before any provider contact when the key is not test-class", async () => {
    const transport = vi.fn(() => jsonResponse(200, INIT_OK));
    const cfg = config({ secretKey: LIVE_KEY, transport: transport as unknown as PaystackTestModeConfig["transport"] });
    const init = await initializePaystackTestTransaction(cfg, reference(), "payer@example.com");
    expect(init).toMatchObject({ ok: false, code: "non_test_key" });
    expect(transport).not.toHaveBeenCalled();

    const verify = await verifyOwnedPayment(cfg, "some-ref", { amount: money(15_000, "NGN") });
    expect(verify).toMatchObject({ ok: false, code: "non_test_key" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("environment composition root fails closed on absent or non-test keys", () => {
    const absent = paystackTestModeFromEnv(() => undefined, {});
    expect(absent).toMatchObject({ ok: false, code: "missing_key" });
    const live = paystackTestModeFromEnv(() => undefined, { PAYSTACK_SECRET_KEY: LIVE_KEY });
    expect(live).toMatchObject({ ok: false, code: "non_test_key" });
  });
});

describe("audit-before-execute (AGENTS §36)", () => {
  it("writes the audit record BEFORE the provider call and on success", async () => {
    const entries: PaystackAuditEntry[] = [];
    const order: string[] = [];
    const cfg = config({
      entries,
      audit: (entry) => {
        order.push("audit");
        entries.push(entry);
      },
      transport: () => {
        order.push("provider");
        return jsonResponse(200, INIT_OK);
      },
    });
    const result = await initializePaystackTestTransaction(cfg, reference(), "payer@example.com");
    expect(result.ok).toBe(true);
    expect(order).toEqual(["audit", "provider"]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: "paystack.transaction.initialize",
      provider: "paystack",
      mode: "test",
      tenantId: "tenant-a",
      purposeRef: "fee-0001",
      idempotencyKey: "cg_tenant-a_user-0001_fee_payment_fee-0001_NGN_15000",
      amountMinor: 15_000,
      currency: "NGN",
    });
    expect(JSON.stringify(entries[0])).not.toContain(TEST_KEY);
  });

  it("denies the mutation when the audit sink throws — no provider contact", async () => {
    const transport = vi.fn(() => jsonResponse(200, INIT_OK));
    const cfg = config({
      auditThrowOn: 1,
      transport: transport as unknown as PaystackTestModeConfig["transport"],
    });
    const result = await initializePaystackTestTransaction(cfg, reference(), "payer@example.com");
    expect(result).toMatchObject({ ok: false, code: "audit_failed" });
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("initialize transaction (injected transport)", () => {
  it("registers the derived idempotency key as the provider-side reference with canonical amount/currency", async () => {
    const transport = vi.fn(() => jsonResponse(200, INIT_OK));
    const cfg = config({ transport: transport as unknown as PaystackTestModeConfig["transport"] });
    const result = await initializePaystackTestTransaction(cfg, reference(), "payer@example.com");
    expect(result.ok).toBe(true);
    const [, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.reference).toBe("cg_tenant-a_user-0001_fee_payment_fee-0001_NGN_15000");
    expect(body.amount).toBe(15_000);
    expect(body.currency).toBe("NGN");
    expect(body.metadata).toMatchObject({ tenant_id: "tenant-a", purpose_ref: "fee-0001" });
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TEST_KEY}`);
  });

  it("translates the provider success payload", async () => {
    const cfg = config({ transport: () => jsonResponse(200, INIT_OK) });
    const result = await initializePaystackTestTransaction(cfg, reference(), "payer@example.com");
    if (!result.ok) throw new Error(result.reason);
    expect(result.value).toMatchObject({
      provider: "paystack",
      mode: "test",
      authorizationUrl: "https://checkout.paystack.com/abc123",
      accessCode: "abc123",
    });
  });

  it("contains provider errors as structured results (never throws)", async () => {
    const cfg = config({ transport: () => jsonResponse(401, { status: false, message: "Invalid key" }) });
    const result = await initializePaystackTestTransaction(cfg, reference(), "payer@example.com");
    expect(result).toMatchObject({ ok: false, code: "provider_error" });
    if (!result.ok) expect(result.reason).toContain("401");
  });

  it("denies invalid references before audit and transport", async () => {
    const transport = vi.fn(() => jsonResponse(200, INIT_OK));
    const entries: PaystackAuditEntry[] = [];
    const cfg = config({
      entries,
      transport: transport as unknown as PaystackTestModeConfig["transport"],
    });
    const bad = await initializePaystackTestTransaction(
      cfg,
      { ...reference(), amount: money(0, "NGN") },
      "payer@example.com",
    );
    expect(bad).toMatchObject({ ok: false, code: "invalid_reference" });
    const badEmail = await initializePaystackTestTransaction(cfg, reference(), "not-an-email");
    expect(badEmail).toMatchObject({ ok: false, code: "invalid_reference" });
    expect(entries).toHaveLength(0);
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("ownership validation (verify before any financial effect)", () => {
  const VERIFY_OK = (amountMinor: number, currency: string) => ({
    status: true,
    data: { status: "success", reference: "cg_x", amount: amountMinor, currency },
  });

  it("accepts a provider record that matches the canonical reference", async () => {
    const cfg = config({ transport: () => jsonResponse(200, VERIFY_OK(15_000, "NGN")) });
    const result = await verifyOwnedPayment(cfg, "cg_x", { amount: money(15_000, "NGN") });
    if (!result.ok) throw new Error(result.reason);
    expect(result.value).toMatchObject({ status: "success", amountMinor: 15_000, currency: "NGN" });
  });

  it("denies amount and currency mismatches as ownership_mismatch", async () => {
    const wrongAmount = config({ transport: () => jsonResponse(200, VERIFY_OK(99_999, "NGN")) });
    const wrongCurrency = config({ transport: () => jsonResponse(200, VERIFY_OK(15_000, "GHS")) });
    const amountResult = await verifyOwnedPayment(wrongAmount, "cg_x", { amount: money(15_000, "NGN") });
    expect(amountResult).toMatchObject({ ok: false, code: "ownership_mismatch" });
    const currencyResult = await verifyOwnedPayment(wrongCurrency, "cg_x", { amount: money(15_000, "NGN") });
    expect(currencyResult).toMatchObject({ ok: false, code: "ownership_mismatch" });
  });

  it("denies malformed provider payloads (fail closed)", async () => {
    const cfg = config({ transport: () => jsonResponse(200, { status: true, data: { hello: true } }) });
    const result = await verifyOwnedPayment(cfg, "cg_x", { amount: money(15_000, "NGN") });
    expect(result).toMatchObject({ ok: false, code: "malformed_response" });
  });

  it("uses the verification endpoint with the encoded reference", async () => {
    const transport = vi.fn(() => jsonResponse(200, VERIFY_OK(15_000, "NGN")));
    const cfg = config({ transport: transport as unknown as PaystackTestModeConfig["transport"] });
    await verifyOwnedPayment(cfg, "cg/ref with space", { amount: money(15_000, "NGN") });
    const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/transaction/verify/cg%2Fref%20with%20space");
    expect(init.method).toBe("GET");
  });
});

describe("failure policy + circuit breaker (declared semantics)", () => {
  function testPolicy(clock: AdapterClock): AdapterFailurePolicy {
    return createAdapterFailurePolicy({
      provider: "paystack-testmode",
      timeoutMs: 1_000,
      maxAttempts: 2,
      backoffBaseMs: 100,
      backoffCapMs: 1_000,
      degradedAfterFailures: 2,
      degradedWindowMs: 10_000,
      breakerFailureThreshold: 2,
      breakerResetMs: 5_000,
      clock,
    });
  }

  it("converts a hung provider into a contained timeout", async () => {
    let now = 1_000_000;
    const pending: (() => void)[] = [];
    const clock: AdapterClock = {
      nowMs: () => now,
      delay: () => new Promise<void>((r) => pending.push(r)),
    };
    const cfg = config({
      failurePolicy: testPolicy(clock),
      transport: () => new Promise<Response>(() => {}),
    });
    const pendingCall = initializePaystackTestTransaction(cfg, reference(), "payer@example.com");
    await new Promise<void>((r) => setTimeout(r, 0));
    now += 2_000;
    for (const fire of pending) fire();
    const result = await pendingCall;
    expect(result).toMatchObject({ ok: false, code: "timeout" });
  });

  it("opens after repeated failures, then denies WITHOUT provider contact", async () => {
    const clock: AdapterClock = { nowMs: () => 1_000, delay: () => Promise.resolve() };
    const transport = vi.fn(() => jsonResponse(500, { status: false, message: "down" }));
    const cfg = config({
      failurePolicy: testPolicy(clock),
      transport: transport as unknown as PaystackTestModeConfig["transport"],
    });
    // Audit always succeeds; the provider keeps failing.
    for (let i = 0; i < 2; i += 1) {
      const result = await initializePaystackTestTransaction(cfg, reference(), "payer@example.com");
      expect(result.ok).toBe(false);
    }
    expect(cfg.failurePolicy?.snapshot().breaker).toBe("open");
    transport.mockClear();
    const denied = await initializePaystackTestTransaction(cfg, reference(), "payer@example.com");
    expect(denied).toMatchObject({ ok: false, code: "breaker_open" });
    expect(transport).not.toHaveBeenCalled();
  });
});
