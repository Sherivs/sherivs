/**
 * Paystack server functions.
 *
 * - initFeePayment: bursar/parent kicks off a transaction for a fee row.
 *   We call Paystack /transaction/initialize with the platform secret key
 *   (PAYSTACK_SECRET_KEY) and store the returned reference on the fee row.
 *
 * - verifyFeePayment: client-side callback that asks Paystack to verify the
 *   reference. This is a defence in depth path — the webhook
 *   (/api/public/webhooks/paystack) is the source of truth.
 *
 * Tenant isolation: the authenticated supabase client is used for fee reads,
 * so RLS enforces school_id scoping. We re-check after fetching too.
 */
import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SystemClock, TimeAuthority } from "../../kernel/time-authority";
import {
  PAYSTACK_CURRENCY,
  settlePaystackCharge,
  type SettlementDb,
} from "../../payments/paystack-settlement";
import { canInitiateFeePayment } from "../../payments/fee-payment-access";
import { type FeeCheckoutPlan } from "../../payments/fee-split";
import { requirePaystackTestKey } from "../../payments/paystack-testmode.server";
import {
  createFinancialIntent,
  createFinancialPlan,
  failFinancialIntent,
  finishFinancialReversal,
  requestFinancialReversal,
  reconcileFinancialPayment,
  recordFinancialSettlement,
  resolveFinancialRoute,
  type FinancialLifecycleDb,
} from "./payment-lifecycle.server";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

const initSchema = z.object({
  fee_id: z.string().uuid(),
  email: z.string().email(),
  plan_part_id: z.string().uuid().optional(),
});
const planSchema = z.object({
  fee_id: z.string().uuid(),
  parts: z
    .array(
      z.object({
        amount_minor: z.number().int().positive(),
        due_at: z.iso.datetime({ offset: true }),
      }),
    )
    .min(2)
    .max(24),
});
const receiptSchema = z.object({ reference: z.string().min(6).max(200) });
const reversalSchema = z.object({
  reference: z.string().min(6).max(200),
  amount_minor: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
  idempotency_key: z.string().trim().min(1).max(100),
});

type PaystackInitResponse = {
  status: boolean;
  message: string;
  data?: { authorization_url: string; access_code: string; reference: string };
};

function paystackSecret(): string {
  return requirePaystackTestKey(process.env.PAYSTACK_SECRET_KEY);
}

function isPaystackCheckoutUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname === "checkout.paystack.com";
  } catch {
    return false;
  }
}

export const initFeePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => initSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const secret = paystackSecret();
    const authorization = ["Bearer", secret].join(" ");
    const { data: fee, error } = await supabase
      .from("fees")
      .select("id, amount, paid_amount, status, school_id, student_id, fee_type, term")
      .eq("id", data.fee_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!fee) throw new Error("Fee not found or not visible to this user");
    if (fee.status === "paid") throw new Error("This invoice is already paid");
    if (!(await canInitiateFeePayment(supabase, userId, fee))) {
      throw new Error("Not allowed to pay this invoice");
    }

    // SHERIVS-A05b: charge what is owed after approved discounts, scholarships and waivers
    // (the same server function settlement checks against), never the gross row amount.
    const { data: due, error: dueErr } = await supabase.rpc(
      "fee_amount_due" as never,
      { p_fee: fee.id } as never,
    );
    if (dueErr) throw new Error(dueErr.message);
    const outstanding = Number(due ?? 0);
    if (outstanding <= 0) throw new Error("Nothing to pay on this invoice");

    const reference = `uos_${fee.id.replace(/-/g, "").slice(0, 16)}_${timeAuthority.now().atMs}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const lifecycleDb = supabaseAdmin as unknown as FinancialLifecycleDb;
    const route = await resolveFinancialRoute(lifecycleDb, fee.school_id);
    if (!route) throw new Error("Organization payment route is not configured");

    let amountMinor = Math.round(outstanding * 100);
    if (data.plan_part_id) {
      const { data: part, error: partError } = await (
        supabaseAdmin as unknown as {
          from(table: "cg_financial_plan_part"): {
            select(columns: string): {
              eq(
                column: string,
                value: string,
              ): {
                maybeSingle(): PromiseLike<{
                  data: {
                    id: string;
                    scope_ref: string;
                    tenant_id: string;
                    org_ref: string;
                    subject_ref: string;
                    principal_ref: string;
                    due_minor: number;
                    applied_minor: number;
                    due_at: string;
                    state: string;
                  } | null;
                  error: { message: string } | null;
                }>;
              };
            };
          };
        }
      )
        .from("cg_financial_plan_part")
        .select(
          "id, scope_ref, tenant_id, org_ref, subject_ref, principal_ref, due_minor, applied_minor, due_at, state",
        )
        .eq("id", data.plan_part_id)
        .maybeSingle();
      if (partError) throw new Error(partError.message);
      if (
        !part ||
        part.scope_ref !== fee.school_id ||
        part.tenant_id !== route.tenant_id ||
        part.org_ref !== route.org_ref ||
        part.subject_ref !== fee.id ||
        part.principal_ref !== userId ||
        !["pending", "partial"].includes(part.state) ||
        Date.parse(part.due_at) > timeAuthority.now().atMs
      ) {
        throw new Error("Payment plan part is not available to this payer");
      }
      amountMinor = Number(part.due_minor) - Number(part.applied_minor);
      if (
        !Number.isSafeInteger(amountMinor) ||
        amountMinor <= 0 ||
        amountMinor > Math.round(outstanding * 100)
      ) {
        throw new Error("Payment plan part exceeds the current balance");
      }
    }

    let splitPlan: FeeCheckoutPlan | null = null;
    if (!data.plan_part_id) {
      const { data: plan, error: planError } = await (
        supabaseAdmin as unknown as {
          rpc(
            fn: string,
            args: Record<string, unknown>,
          ): PromiseLike<{ data: FeeCheckoutPlan | null; error: { message: string } | null }>;
        }
      ).rpc("fee_checkout_split", { p_fee: fee.id, p_reference: reference });
      if (planError || !plan) throw new Error(planError?.message ?? "Could not plan the payment");
      splitPlan = plan;
      if (splitPlan.amount_kobo !== amountMinor)
        throw new Error("Payment amount changed during checkout");
    }

    if (!/^ACCT_[A-Za-z0-9]+$/.test(route.subaccount_code)) {
      throw new Error("Organization payment route is invalid");
    }
    const shareKobo = splitPlan?.split ? splitPlan.share_kobo : 0;
    if (!Number.isInteger(shareKobo) || shareKobo < 0 || shareKobo >= amountMinor) {
      throw new Error("Invalid organization settlement share");
    }
    const initBody = {
      email: data.email.trim(),
      amount: amountMinor,
      reference,
      currency: PAYSTACK_CURRENCY,
      subaccount: route.subaccount_code,
      transaction_charge: shareKobo,
      bearer: "account" as const,
      metadata: {
        fee_id: fee.id,
        student_id: fee.student_id,
        school_id: fee.school_id,
        initiated_by: userId,
        fee_type: fee.fee_type,
        term: fee.term,
        tenant_id: route.tenant_id,
        org_ref: route.org_ref,
        sherivs_share_kobo: shareKobo,
        sherivs_split: Boolean(splitPlan?.split),
      },
    };
    await createFinancialIntent(lifecycleDb, {
      reference,
      scopeRef: fee.school_id,
      subjectRef: fee.id,
      principalRef: userId,
      amountMinor,
      currency: PAYSTACK_CURRENCY,
      planPartId: data.plan_part_id,
    });
    const res = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(initBody),
    });

    const body = (await res.json()) as PaystackInitResponse;
    if (!res.ok || !body.status || !body.data) {
      if (res.status < 500 && body.status === false) {
        await failFinancialIntent(lifecycleDb, reference);
      }
      throw new Error(body.message || `Paystack init failed (${res.status})`);
    }

    if (body.data.reference !== reference) {
      throw new Error("Paystack returned an unexpected reference");
    }
    if (!isPaystackCheckoutUrl(body.data.authorization_url)) {
      throw new Error("Paystack returned an unexpected checkout URL");
    }

    const { error: upErr } = await supabase
      .from("fees")
      .update({
        paystack_reference: body.data.reference,
        paystack_access_code: body.data.access_code,
      })
      .eq("id", fee.id);
    if (upErr) throw new Error(upErr.message);

    return {
      authorization_url: body.data.authorization_url,
      access_code: body.data.access_code,
      reference: body.data.reference,
    };
  });

export const createFeePaymentPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => planSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: fee, error } = await context.supabase
      .from("fees")
      .select("id, amount, paid_amount, status, school_id, student_id")
      .eq("id", data.fee_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!fee) throw new Error("Fee not found or not visible to this user");
    if (fee.status === "paid") throw new Error("This invoice is already paid");
    if (!(await canInitiateFeePayment(context.supabase, context.userId, fee))) {
      throw new Error("Not allowed to create a payment plan for this invoice");
    }

    const { data: due, error: dueError } = await context.supabase.rpc(
      "fee_amount_due" as never,
      { p_fee: fee.id } as never,
    );
    if (dueError) throw new Error(dueError.message);
    const totalMinor = Math.round(Number(due ?? 0) * 100);
    if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) {
      throw new Error("Nothing is due on this invoice");
    }
    let previousDueAt = 0;
    for (const part of data.parts) {
      const dueAt = Date.parse(part.due_at);
      if (!Number.isFinite(dueAt) || dueAt <= previousDueAt || dueAt <= timeAuthority.now().atMs) {
        throw new Error("Payment plan dates must be future and strictly increasing");
      }
      previousDueAt = dueAt;
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const id = await createFinancialPlan(supabaseAdmin as unknown as FinancialLifecycleDb, {
      scopeRef: fee.school_id,
      subjectRef: fee.id,
      principalRef: context.userId,
      totalMinor,
      currency: PAYSTACK_CURRENCY,
      parts: data.parts,
    });
    return { id, total_minor: totalMinor, currency: PAYSTACK_CURRENCY };
  });

export const listFeePaymentReceipts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => receiptSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as {
      from(table: "cg_financial_evidence"): {
        select(columns: string): {
          eq(
            column: string,
            value: string,
          ): PromiseLike<{
            data: Array<{
              id: string;
              reference: string;
              amount_minor: number;
              currency: string;
              issued_at: string;
            }> | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
    const { data: receipts, error } = await db
      .from("cg_financial_evidence")
      .select("id, reference, amount_minor, currency, issued_at")
      .eq("reference", data.reference);
    if (error) throw new Error(error.message);
    return receipts ?? [];
  });

export const requestFeeRefund = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => reversalSchema.parse(input))
  .handler(async ({ data, context }) => {
    const actorDb = context.supabase as unknown as {
      from(table: "cg_financial_entry"): {
        select(columns: string): {
          eq(
            column: string,
            value: string,
          ): {
            maybeSingle(): PromiseLike<{
              data: {
                id: string;
                reference: string;
                tenant_id: string;
                amount_minor: number;
                currency: string;
              } | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
      rpc(
        name: "is_tenant_admin",
        args: { p_tenant: string },
      ): PromiseLike<{ data: boolean | null; error: { message: string } | null }>;
    };
    const { data: entry, error: entryError } = await actorDb
      .from("cg_financial_entry")
      .select("id, reference, tenant_id, amount_minor, currency")
      .eq("reference", data.reference)
      .maybeSingle();
    if (entryError) throw new Error(entryError.message);
    if (!entry || entry.reference !== data.reference) throw new Error("Payment not found");
    const { data: isTenantAdmin, error: authorizationError } = await actorDb.rpc(
      "is_tenant_admin",
      { p_tenant: entry.tenant_id },
    );
    if (authorizationError) throw new Error(authorizationError.message);
    if (!isTenantAdmin) throw new Error("Tenant administrator approval is required");

    const secret = paystackSecret();
    const authorization = ["Bearer", secret].join(" ");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const lifecycleDb = supabaseAdmin as unknown as FinancialLifecycleDb;
    const reversal = await requestFinancialReversal(lifecycleDb, {
      entryId: entry.id,
      amountMinor: data.amount_minor,
      reason: data.reason,
      idempotencyKey: `${entry.id}:${context.userId}:${data.idempotency_key}`,
      requestedBy: context.userId,
    });
    if (reversal.duplicate) return { id: reversal.id, state: reversal.state, duplicate: true };

    await finishFinancialReversal(lifecycleDb, { id: reversal.id, state: "processing" });
    let response: Response;
    try {
      response = await fetch("https://api.paystack.co/refund", {
        method: "POST",
        headers: { Authorization: authorization, "Content-Type": "application/json" },
        body: JSON.stringify({ transaction: entry.reference, amount: data.amount_minor }),
      });
    } catch {
      throw new Error("TEST-mode refund outcome is unknown and requires reconciliation");
    }

    let result: {
      status?: boolean;
      message?: string;
      data?: { id?: string | number; status?: string };
    };
    try {
      result = (await response.json()) as typeof result;
    } catch {
      throw new Error("TEST-mode refund outcome is unknown and requires reconciliation");
    }
    if (!response.ok || result.status !== true || result.data?.id === undefined) {
      if (response.status < 500 && result.status === false) {
        await finishFinancialReversal(lifecycleDb, { id: reversal.id, state: "failed" });
      }
      throw new Error("TEST-mode refund was not accepted or requires reconciliation");
    }
    const completed = ["processed", "success"].includes(result.data.status ?? "");
    await finishFinancialReversal(lifecycleDb, {
      id: reversal.id,
      state: completed ? "processed" : "processing",
      providerRef: String(result.data.id),
    });
    return { id: reversal.id, state: completed ? "processed" : "processing", duplicate: false };
  });

const verifySchema = z.object({ reference: z.string().min(6).max(200) });

export const verifyFeePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => verifySchema.parse(i))
  .handler(async ({ data, context }) => {
    const actorDb = context.supabase as unknown as {
      from(table: "cg_financial_intent"): {
        select(columns: string): {
          eq(
            column: string,
            value: string,
          ): {
            maybeSingle(): PromiseLike<{
              data: { subject_ref: string; scope_ref: string } | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    };
    const { data: intent, error: intentError } = await actorDb
      .from("cg_financial_intent")
      .select("subject_ref, scope_ref")
      .eq("reference", data.reference)
      .maybeSingle();
    if (intentError) throw new Error(intentError.message);
    const feeQuery = intent
      ? context.supabase
          .from("fees")
          .select("id, school_id")
          .eq("id", intent.subject_ref)
          .maybeSingle()
      : context.supabase
          .from("fees")
          .select("id, school_id")
          .eq("paystack_reference", data.reference)
          .maybeSingle();
    const { data: visible, error: feeError } = await feeQuery;
    if (feeError) throw new Error(feeError.message);
    if (
      !visible ||
      (intent && (visible.id !== intent.subject_ref || visible.school_id !== intent.scope_ref))
    ) {
      throw new Error("Payment reference not found");
    }

    const secret = paystackSecret();
    const res = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(data.reference)}`,
      { headers: { Authorization: `Bearer ${paystackSecret()}` } },
    );
    const body = (await res.json()) as {
      status: boolean;
      data?: {
        status: string;
        amount: number;
        currency?: string;
        reference?: string;
        paid_at?: string;
        metadata?: {
          fee_id?: string;
          school_id?: string;
          sherivs_share_kobo?: number;
          sherivs_split?: boolean;
        } | null;
        subaccount?: { subaccount_code?: string } | null;
      };
      message?: string;
    };
    if (!res.ok || !body.status || !body.data) {
      throw new Error(body.message || "Verification failed");
    }
    if (body.data.reference !== data.reference) throw new Error("Verification reference mismatch");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const lifecycleDb = supabaseAdmin as unknown as FinancialLifecycleDb;
    const providerEventRef = `charge.success:${data.reference}`;
    let canonicalAmountKobo: number | undefined;
    let canonicalFeeId: string | undefined;
    let canonicalScopeRef: string | undefined;
    let hasFinancialIntent = false;
    if (body.data.status === "success" && intent) {
      const reconciliation = await reconcileFinancialPayment(lifecycleDb, {
        reference: data.reference,
        providerEventRef,
        amountMinor: body.data.amount,
        currency: body.data.currency ?? "",
        paidAt: body.data.paid_at ?? null,
      });
      if (
        reconciliation.verdict !== "matched" ||
        !Number.isSafeInteger(reconciliation.expected_minor) ||
        reconciliation.subject_ref !== intent.subject_ref ||
        reconciliation.scope_ref !== intent.scope_ref
      ) {
        throw new Error("Payment verification failed");
      }
      hasFinancialIntent = true;
      canonicalAmountKobo = reconciliation.expected_minor;
      canonicalFeeId = reconciliation.subject_ref;
      canonicalScopeRef = reconciliation.scope_ref;
    }
    const result = await settlePaystackCharge(supabaseAdmin as unknown as SettlementDb, {
      reference: data.reference,
      status: body.data.status,
      amountKobo: body.data.amount,
      currency: body.data.currency,
      paidAt: body.data.paid_at,
      canonicalAmountKobo,
      canonicalFeeId,
      canonicalScopeRef,
      metadata: body.data.metadata,
      subaccountCode: body.data.subaccount?.subaccount_code ?? null,
    });
    if (hasFinancialIntent) {
      const ledgerResult = await recordFinancialSettlement(lifecycleDb, {
        reference: data.reference,
        providerEventRef,
        amountMinor: body.data.amount,
        currency: body.data.currency ?? "",
        paidAt: body.data.paid_at ?? null,
      });
      if (!["settled", "duplicate"].includes(ledgerResult.outcome)) {
        throw new Error("Payment ledger reconciliation failed");
      }
    }
    if (result.outcome === "rejected") throw new Error("Payment verification failed");
    const paid = result.outcome === "settled" || result.outcome === "duplicate";
    return { paid, reference: data.reference };
  });
