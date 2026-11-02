import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  reversal: {
    provider_ref: "refund-a",
    reference: "payment-a",
    amount_minor: 1000,
    currency: "NGN",
    state: "processing",
  },
  rpc: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => fixtures.rpc(...args),
    from: () => ({ insert: (...args: unknown[]) => fixtures.insert(...args) }),
  },
}));
vi.mock("@/lib/security/public-rate-limit.server", () => ({
  checkPublicRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
}));

import { Route } from "../../frontend/src/routes/api/public/webhooks/paystack";

const TEST_KEY = "sk_test_refund_fixture";
const handlers = (
  Route as unknown as {
    options: { server: { handlers: { POST: (args: { request: Request }) => Promise<Response> } } };
  }
).options.server.handlers;

function refundEvent(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    event: "refund.processed",
    data: {
      id: "refund-a",
      amount: 1000,
      currency: "NGN",
      transaction: { reference: "payment-a" },
      ...overrides,
    },
  });
}

function signedRequest(body: string, key = TEST_KEY): Request {
  const signature = createHmac("sha512", key).update(body, "utf8").digest("hex");
  return new Request("http://test.local/api/public/webhooks/paystack", {
    method: "POST",
    body,
    headers: { "x-paystack-signature": signature },
  });
}

async function post(body: string, key = TEST_KEY): Promise<Response> {
  return handlers.POST({ request: signedRequest(body, key) });
}

describe("Paystack refund webhook reconciliation", () => {
  beforeEach(() => {
    process.env.PAYSTACK_SECRET_KEY = TEST_KEY;
    fixtures.reversal.state = "processing";
    fixtures.rpc.mockReset();
    fixtures.insert.mockReset().mockResolvedValue({ error: null });
    fixtures.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name !== "cg_financial_record_refund") {
        return { data: null, error: { message: `unexpected rpc ${name}` } };
      }
      if (
        args.p_provider_ref !== fixtures.reversal.provider_ref ||
        args.p_reference !== fixtures.reversal.reference
      ) {
        return { data: { outcome: "unknown_reference" }, error: null };
      }
      if (
        args.p_amount_minor !== fixtures.reversal.amount_minor ||
        args.p_currency !== fixtures.reversal.currency
      ) {
        return { data: { outcome: "amount_or_currency_mismatch" }, error: null };
      }
      if (fixtures.reversal.state === "processed") {
        return { data: { outcome: "duplicate" }, error: null };
      }
      fixtures.reversal.state = "processed";
      return { data: { outcome: "processed" }, error: null };
    });
  });

  it("rejects forged refund webhooks before any ledger RPC", async () => {
    const body = refundEvent();
    const response = await post(body, "sk_test_attacker_fixture");
    expect(response.status).toBe(401);
    expect(fixtures.rpc).not.toHaveBeenCalled();
    expect(fixtures.reversal.state).toBe("processing");
  });

  it("rejects tampered amounts and cross-payment refund references without processing", async () => {
    const tampered = await post(refundEvent({ amount: 999 }));
    expect(tampered.status).toBe(200);
    expect(fixtures.reversal.state).toBe("processing");

    const crossPayment = await post(refundEvent({ transaction: { reference: "payment-b" } }));
    expect(crossPayment.status).toBe(200);
    expect(fixtures.reversal.state).toBe("processing");
    expect(fixtures.rpc).toHaveBeenCalledTimes(2);
  });

  it("requires complete refund facts before reconciliation", async () => {
    const response = await post(
      JSON.stringify({
        event: "refund.processed",
        data: { id: "refund-a", transaction: { reference: "payment-a" } },
      }),
    );
    expect(response.status).toBe(200);
    expect(fixtures.rpc).not.toHaveBeenCalled();
    expect(fixtures.reversal.state).toBe("processing");
  });

  it("processes a valid refund once and treats a duplicate webhook as a no-op", async () => {
    const body = refundEvent();
    expect((await post(body)).status).toBe(200);
    expect(fixtures.reversal.state).toBe("processed");
    expect((await post(body)).status).toBe(200);
    expect(fixtures.reversal.state).toBe("processed");
    expect(fixtures.rpc).toHaveBeenCalledTimes(2);
  });
});
