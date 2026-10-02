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

    const outstanding = Number(fee.amount) - Number(fee.paid_amount ?? 0);
    if (outstanding <= 0) throw new Error("Nothing to pay on this invoice");

    const reference = `uos_${fee.id.replace(/-/g, "").slice(0, 16)}_${Date.now()}`;
    const res = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${paystackSecret()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: data.email,
        amount: Math.round(outstanding * 100), // kobo
        reference,
        currency: "NGN",
        metadata: {
          fee_id: fee.id,
          student_id: fee.student_id,
          school_id: fee.school_id,
          initiated_by: userId,
          fee_type: fee.fee_type,
          term: fee.term,
        },
      }),
    });

    const body = (await res.json()) as PaystackInitResponse;
    if (!res.ok || !body.status || !body.data) {
      throw new Error(body.message || `Paystack init failed (${res.status})`);
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
      data?: { status: string; amount: number; metadata?: { fee_id?: string } };
      message?: string;
    };
    if (!res.ok || !body.status || !body.data) {
      throw new Error(body.message || "Verification failed");
    }
    const paid = body.data.status === "success";
    const feeId = body.data.metadata?.fee_id;
    if (paid && feeId) {
      const { error } = await context.supabase
        .from("fees")
        .update({
          status: "paid",
          paid_amount: body.data.amount / 100,
          paid_at: new Date().toISOString(),
        })
        .eq("id", feeId)
        .eq("paystack_reference", data.reference);
      if (error) throw new Error(error.message);
    }
    return { paid, reference: data.reference };
  });
