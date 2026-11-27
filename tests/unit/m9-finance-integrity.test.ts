/**
 * M9 (ADR-150) integrity at the webhook boundary, driving the REAL Paystack route:
 * - a forged or unsigned charge.success never reaches a ledger RPC;
 * - a live-mode secret disables the endpoint (TEST mode only);
 * - the amount that settles comes from the server-held intent, never from the payload or its metadata;
 * - a tampered amount is refused before settlement;
 * - a replayed delivery is idempotent (one settlement, one ledger entry).
 * The database side of the same guarantees is proven in tests/sql/m9-finance-core.sql against the real functions.
 */
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  settle: vi.fn(),
  insert: vi.fn(),
  intent: { reference: "", amount_minor: 0, settled: false, ledgerWrites: 0 },
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => state.rpc(...args),
    from: () => ({ insert: (...args: unknown[]) => state.insert(...args) }),
  },
}));
vi.mock("@/lib/security/public-rate-limit.server", () => ({
  checkPublicRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
}));
vi.mock("@/lib/payments/paystack-settlement", () => ({
  settlePaystackCharge: (...args: unknown[]) => state.settle(...args),
}));

import { Route } from "../../frontend/src/routes/api/public/webhooks/paystack";

// Secret-shaped values are built at runtime so no literal key sits in the repository.
const TEST_KEY = ["sk", "test", "m9", "fixture"].join("_");
const LIVE_KEY = ["sk", "live", "m9", "fixture"].join("_");
const REFERENCE = "uos_0123456789abcdef_1763300000000_abcdef01";
const handlers = (
  Route as unknown as {
    options: { server: { handlers: { POST: (args: { request: Request }) => Promise<Response> } } };
  }
).options.server.handlers;

function charge(amount: number, metadata: Record<string, unknown> = {}) {
  return JSON.stringify({
    event: "charge.success",
    data: { reference: REFERENCE, amount, currency: "NGN", status: "success", metadata },
  });
}
function request(body: string, key: string | null = TEST_KEY): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) headers["x-paystack-signature"] = createHmac("sha512", key).update(body).digest("hex");
  return new Request("http://test.local/api/public/webhooks/paystack", {
    method: "POST",
    body,
    headers,
  });
}
const post = (body: string, key: string | null = TEST_KEY) =>
  handlers.POST({ request: request(body, key) });

describe("M9 Paystack webhook integrity (real route)", () => {
  beforeEach(() => {
    process.env.PAYSTACK_SECRET_KEY = TEST_KEY;
    state.intent = {
      reference: REFERENCE,
      amount_minor: 2_000_000,
      settled: false,
      ledgerWrites: 0,
    };
    state.insert.mockReset().mockResolvedValue({ error: null });
    state.rpc
      .mockReset()
      .mockImplementation(async (name: string, args: Record<string, unknown>) => {
        if (name === "cg_financial_record_reconciliation") {
          const matched =
            args.p_reference === state.intent.reference &&
            args.p_observed_minor === state.intent.amount_minor &&
            args.p_observed_currency === "NGN";
          return {
            data: {
              verdict: matched ? "matched" : "mismatch",
              expected_minor: state.intent.amount_minor,
              currency: "NGN",
              subject_ref: "fee-server-held",
              scope_ref: "scope-server-held",
            },
            error: null,
          };
        }
        if (name === "cg_financial_record_settlement") {
          if (state.intent.settled) return { data: { outcome: "duplicate" }, error: null };
          state.intent.settled = true;
          state.intent.ledgerWrites += 1;
          return { data: { outcome: "settled" }, error: null };
        }
        return { data: null, error: { message: `unexpected rpc ${name}` } };
      });
    let feeSettled = false;
    state.settle.mockReset().mockImplementation(async () => {
      if (feeSettled) return { outcome: "duplicate", feeId: "fee-server-held", schoolId: "org-a" };
      feeSettled = true;
      return { outcome: "settled", feeId: "fee-server-held", schoolId: "org-a" };
    });
  });

  it("refuses unsigned and forged deliveries before any database call", async () => {
    const body = charge(2_000_000);
    expect((await post(body, null)).status).toBe(401);
    expect((await post(body, ["sk", "test", "attacker"].join("_"))).status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.settle).not.toHaveBeenCalled();
    expect(state.insert).not.toHaveBeenCalled();
  });

  it("refuses a body altered after signing", async () => {
    const signed = request(charge(2_000_000));
    const signature = signed.headers.get("x-paystack-signature")!;
    const forged = new Request(signed.url, {
      method: "POST",
      body: charge(20_000_000),
      headers: { "x-paystack-signature": signature },
    });
    expect((await handlers.POST({ request: forged })).status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("stays in TEST mode: a live secret disables the endpoint", async () => {
    process.env.PAYSTACK_SECRET_KEY = LIVE_KEY;
    const body = charge(2_000_000);
    expect((await post(body, LIVE_KEY)).status).toBe(503);
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.settle).not.toHaveBeenCalled();
  });

  it("settles the server-held amount and identity, ignoring payload metadata", async () => {
    const body = charge(2_000_000, {
      fee_id: "11111111-1111-4111-8111-111111111111",
      school_id: "attacker-org",
      sherivs_share_kobo: 0,
    });
    expect((await post(body)).status).toBe(200);
    expect(state.settle).toHaveBeenCalledTimes(1);
    const facts = state.settle.mock.calls[0]![1] as Record<string, unknown>;
    expect(facts.canonicalAmountKobo).toBe(2_000_000);
    expect(facts.canonicalFeeId).toBe("fee-server-held");
    expect(facts.canonicalScopeRef).toBe("scope-server-held");
    expect(state.intent.ledgerWrites).toBe(1);
    // The organization recorded in the log is the settled fee's, never the payload's school_id.
    const logged = state.insert.mock.calls.map(
      (c) => (c[0] as { school_id: string | null }).school_id,
    );
    expect(logged).not.toContain("attacker-org");
  });

  it("refuses a tampered amount before settlement", async () => {
    expect((await post(charge(100))).status).toBe(200);
    expect(state.settle).not.toHaveBeenCalled();
    expect(state.intent.ledgerWrites).toBe(0);
    const rejection = state.insert.mock.calls[0]![0] as { processing_status: string };
    expect(rejection.processing_status).toBe("rejected");
  });

  it("is idempotent under replay: one settlement and one ledger entry", async () => {
    const body = charge(2_000_000);
    expect((await post(body)).status).toBe(200);
    expect((await post(body)).status).toBe(200);
    expect((await post(body)).status).toBe(200);
    expect(state.intent.ledgerWrites).toBe(1);
    const outcomes = await Promise.all(state.settle.mock.results.map((r) => r.value));
    expect(outcomes.map((o: { outcome: string }) => o.outcome)).toEqual([
      "settled",
      "duplicate",
      "duplicate",
    ]);
  });
});
