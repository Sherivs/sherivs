import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createFinancialIntent,
  createFinancialPlan,
  failFinancialIntent,
  finishFinancialReversal,
  recordFinancialRefund,
  recordFinancialSettlement,
  reconcileFinancialPayment,
  requestFinancialReversal,
  resolveFinancialRoute,
  type FinancialLifecycleDb,
} from "../../frontend/src/lib/runtime/scholar/payment-lifecycle.server";

function db(result: unknown = null) {
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
    data: result,
    error: null,
  }));
  return { client: { rpc } as unknown as FinancialLifecycleDb, rpc };
}

describe("tenant-bound server financial lifecycle RPCs", () => {
  it("resolves the provider route from the server-bound scope, not caller org input", async () => {
    const route = { tenant_id: "tenant-a", org_ref: "org-a", subaccount_code: "ACCT_testA" };
    const { client, rpc } = db([route]);
    expect(await resolveFinancialRoute(client, "scope-a")).toEqual(route);
    expect(rpc).toHaveBeenCalledWith("cg_financial_route_for_scope", { p_scope_ref: "scope-a" });
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_org_ref");
  });

  it("creates an intent with server-resolved input only and supports installment references", async () => {
    const intent = {
      reference: "ref-a",
      tenant_id: "tenant-a",
      org_ref: "org-a",
      amount_minor: 2500,
      currency: "NGN",
      expires_at: "2026-11-02T00:00:00.000Z",
    };
    const { client, rpc } = db(intent);
    expect(
      await createFinancialIntent(client, {
        reference: "ref-a",
        scopeRef: "scope-a",
        subjectRef: "subject-a",
        principalRef: "payer-a",
        amountMinor: 2500,
        currency: "NGN",
        planPartId: "part-a",
      }),
    ).toEqual(intent);
    expect(rpc).toHaveBeenCalledWith("cg_financial_create_intent", {
      p_reference: "ref-a",
      p_scope_ref: "scope-a",
      p_subject_ref: "subject-a",
      p_principal_ref: "payer-a",
      p_amount_minor: 2500,
      p_currency: "NGN",
      p_plan_part_id: "part-a",
    });
  });

  it("releases a pending intent only after a confirmed provider initialization failure", async () => {
    const { client, rpc } = db();
    await failFinancialIntent(client, "ref-a");
    expect(rpc).toHaveBeenCalledWith("cg_financial_fail_intent", {
      p_reference: "ref-a",
    });
  });

  it("creates plans from server-supplied total and schedules", async () => {
    const { client, rpc } = db("plan-a");
    const parts = [
      { amount_minor: 2500, due_at: "2026-11-10T00:00:00.000Z" },
      { amount_minor: 2500, due_at: "2026-12-10T00:00:00.000Z" },
    ];
    await expect(
      createFinancialPlan(client, {
        scopeRef: "scope-a",
        subjectRef: "subject-a",
        principalRef: "payer-a",
        totalMinor: 5000,
        currency: "NGN",
        parts,
      }),
    ).resolves.toBe("plan-a");
    expect(rpc).toHaveBeenCalledWith(
      "cg_financial_create_plan",
      expect.objectContaining({ p_total_minor: 5000, p_parts: parts }),
    );
  });

  it("returns server-held expected totals from reconciliation, not client amounts", async () => {
    const { client, rpc } = db({
      verdict: "matched",
      expected_minor: 2500,
      currency: "NGN",
      tenant_id: "tenant-a",
      org_ref: "org-a",
    });
    const result = await reconcileFinancialPayment(client, {
      reference: "ref-a",
      providerEventRef: "charge.success:ref-a",
      amountMinor: 2500,
      currency: "NGN",
      paidAt: null,
    });
    expect(result.expected_minor).toBe(2500);
    expect(rpc.mock.calls[0]?.[0]).toBe("cg_financial_record_reconciliation");
  });

  it("records only verified settlement facts and passes idempotency identity", async () => {
    const { client, rpc } = db({ outcome: "settled" });
    const result = await recordFinancialSettlement(client, {
      reference: "ref-a",
      providerEventRef: "charge.success:ref-a",
      amountMinor: 2500,
      currency: "NGN",
      paidAt: null,
    });
    expect(result.outcome).toBe("settled");
    expect(rpc).toHaveBeenCalledWith(
      "cg_financial_record_settlement",
      expect.objectContaining({
        p_reference: "ref-a",
        p_provider_event_ref: "charge.success:ref-a",
        p_amount_minor: 2500,
      }),
    );
  });

  it("scopes reversal requests to the authenticated actor and forwards terminal updates server-side", async () => {
    const { client, rpc } = db({ id: "reversal-a", state: "requested" });
    await requestFinancialReversal(client, {
      entryId: "entry-a",
      amountMinor: 1000,
      reason: "approved adjustment",
      idempotencyKey: "entry-a:payer-a:key-a",
      requestedBy: "payer-a",
    });
    expect(rpc).toHaveBeenCalledWith(
      "cg_financial_request_reversal",
      expect.objectContaining({ p_requested_by: "payer-a" }),
    );
    await finishFinancialReversal(client, {
      id: "reversal-a",
      state: "processed",
      providerRef: "refund-provider-a",
    });
    expect(rpc).toHaveBeenLastCalledWith("cg_financial_finish_reversal", {
      p_id: "reversal-a",
      p_state: "processed",
      p_provider_ref: "refund-provider-a",
    });
  });

  it("reconciles refund callbacks against provider id, payment reference, amount, and currency", async () => {
    const { client, rpc } = db({ outcome: "processed" });
    await expect(
      recordFinancialRefund(client, {
        providerReference: "refund-a",
        reference: "payment-a",
        amountMinor: 1000,
        currency: "NGN",
      }),
    ).resolves.toEqual({ outcome: "processed" });
    expect(rpc).toHaveBeenCalledWith("cg_financial_record_refund", {
      p_provider_ref: "refund-a",
      p_reference: "payment-a",
      p_amount_minor: 1000,
      p_currency: "NGN",
    });
  });

  it("keeps client schemas free of neutral org bindings and payment amounts", () => {
    const source = readFileSync("frontend/src/lib/runtime/scholar/paystack.functions.ts", "utf8");
    const initSchema = source.slice(
      source.indexOf("const initSchema"),
      source.indexOf("const planSchema"),
    );
    expect(initSchema).toContain("fee_id: z.string().uuid()");
    expect(initSchema).not.toMatch(/org_ref|tenant_id|amount/);
    expect(source).toContain("resolveFinancialRoute(lifecycleDb, fee.school_id)");
    expect(source).toContain("route.org_ref");
    expect(source).toContain("requirePaystackTestKey(process.env.PAYSTACK_SECRET_KEY)");
    expect(source).toContain("Tenant administrator approval is required");
  });

  it("verifies webhook signatures before parsing or settling and gates to TEST credentials", () => {
    const source = readFileSync("frontend/src/routes/api/public/webhooks/paystack.ts", "utf8");
    expect(source.indexOf("verifyHmacHexSignature")).toBeLessThan(
      source.indexOf("JSON.parse(raw)"),
    );
    expect(source).toContain("requirePaystackTestKey(process.env.PAYSTACK_SECRET_KEY)");
    expect(source).toContain("charge.success:${event.data.reference}");
    expect(source).toContain("reconcileFinancialPayment");
    expect(source).toContain("recordFinancialSettlement");
    expect(source).toContain('event.event === "refund.processed"');
    expect(source).toContain("recordFinancialRefund");
    expect(source).toContain("amountMinor: refund.amount");
    expect(source).toContain("currency: refund.currency");
    expect(source).toContain('reconciliation.verdict === "unknown_reference"');
  });

  it("retains the RLS-scoped legacy callback path for valid pre-intent references", () => {
    const source = readFileSync("frontend/src/lib/runtime/scholar/paystack.functions.ts", "utf8");
    expect(source).toContain('.eq("paystack_reference", data.reference)');
    expect(source).toContain("hasFinancialIntent");
    expect(source).toContain("failFinancialIntent(lifecycleDb, reference)");
  });
});
