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
import { assertSplitTestKey, buildFeeInitializeBody, type FeeCheckoutPlan } from "../../payments/fee-split";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

const initSchema = z.object({ fee_id: z.string().uuid(), email: z.string().email() });

type PaystackInitResponse = {
  status: boolean;
  message: string;
  data?: { authorization_url: string; access_code: string; reference: string };
};

function paystackSecret(): string {
  const k = process.env.PAYSTACK_SECRET_KEY;
  if (!k) throw new Error("Payments are not configured: missing PAYSTACK_SECRET_KEY");
  return k;
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
    const { data: due, error: dueErr } = await supabase.rpc("fee_amount_due" as never, { p_fee: fee.id } as never);
    if (dueErr) throw new Error(dueErr.message);
    const outstanding = Number(due ?? 0);
    if (outstanding <= 0) throw new Error("Nothing to pay on this invoice");

    const reference = `uos_${fee.id.replace(/-/g, "").slice(0, 16)}_${timeAuthority.now().atMs}`;
    // SHERIVS-PAY-SPLIT: the server plans the split (school subaccount, Sherivs term share once per
    // student per term, bearer = main account). Amount is fee_amount_due again, checked against `outstanding`.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: plan, error: planErr } = await (supabaseAdmin as unknown as {
      rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: FeeCheckoutPlan | null; error: { message: string } | null }>;
    }).rpc("fee_checkout_split", { p_fee: fee.id, p_reference: reference });
    if (planErr || !plan) throw new Error(planErr?.message ?? "Could not plan the payment");
    const secret = paystackSecret();
    if (plan.split) assertSplitTestKey(secret);
    const initBody = buildFeeInitializeBody(plan, {
      email: data.email,
      reference,
      expectedKobo: Math.round(outstanding * 100),
      metadata: {
        fee_id: fee.id,
        student_id: fee.student_id,
        school_id: fee.school_id,
        initiated_by: userId,
        fee_type: fee.fee_type,
        term: fee.term,
      },
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
      throw new Error(body.message || `Paystack init failed (${res.status})`);
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

const verifySchema = z.object({ reference: z.string().min(6).max(200) });

export const verifyFeePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => verifySchema.parse(i))
  .handler(async ({ data, context }) => {
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
        metadata?: { fee_id?: string; school_id?: string; sherivs_share_kobo?: number; sherivs_split?: boolean } | null;
        subaccount?: { subaccount_code?: string } | null;
      };
      message?: string;
    };
    if (!res.ok || !body.status || !body.data) {
      throw new Error(body.message || "Verification failed");
    }

    // The caller must be able to see the invoice (RLS-scoped read) before the
    // server settles it with elevated privileges.
    const { data: visible } = await context.supabase
      .from("fees")
      .select("id")
      .eq("paystack_reference", data.reference)
      .maybeSingle();
    if (!visible) throw new Error("Payment reference not found");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const result = await settlePaystackCharge(supabaseAdmin as unknown as SettlementDb, {
      reference: data.reference,
      status: body.data.status,
      amountKobo: body.data.amount,
      currency: body.data.currency,
      metadata: body.data.metadata,
      subaccountCode: body.data.subaccount?.subaccount_code ?? null,
    });
    if (result.outcome === "rejected") throw new Error("Payment verification failed");
    const paid = result.outcome === "settled" || result.outcome === "duplicate";
    return { paid, reference: data.reference };
  });
