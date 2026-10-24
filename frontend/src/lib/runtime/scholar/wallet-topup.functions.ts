/**
 * SHERIVS-026 — school wallet top-up through Paystack (TEST KEY ONLY).
 *
 * initWalletTopup: a staff member with wallet.topup creates an intent in the DB
 * (wallet_topup_intent_create checks the permission, amount and email), then we
 * call Paystack /transaction/initialize with the intent's reference and amount.
 * The amount always comes from the DB intent, never from the client after creation.
 *
 * Crediting happens only in wallet_topup_settle (service role), fed by the
 * verified Paystack webhook or verifyWalletTopup below. Live keys are refused
 * until the operator explicitly switches Paystack to live.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const WALLET_TOPUP_PREFIX = "wtp_";

function testSecret(): string {
  const k = process.env.PAYSTACK_SECRET_KEY;
  if (!k) throw new Error("Payments are not configured");
  if (!k.startsWith("sk_test_")) throw new Error("Wallet top-up is limited to Paystack test mode for now");
  return k;
}

const initSchema = z.object({
  school_id: z.string().uuid(),
  amount: z.number().min(100).max(10_000_000),
  email: z.string().email().max(200),
});

export const initWalletTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => initSchema.parse(i))
  .handler(async ({ data, context }) => {
    const secret = testSecret();
    const { data: intent, error } = await (context.supabase as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
    }).rpc("wallet_topup_intent_create", { p_school: data.school_id, p_amount: data.amount, p_email: data.email });
    if (error) throw new Error(error.message);
    const it = intent as { reference: string; amount_kobo: number; school_id: string };
    const res = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: data.email,
        amount: it.amount_kobo,
        reference: it.reference,
        currency: "NGN",
        metadata: { kind: "wallet_topup", school_id: it.school_id },
      }),
    });
    const body = (await res.json()) as { status: boolean; message: string; data?: { authorization_url: string; reference: string } };
    if (!res.ok || !body.status || !body.data) throw new Error(body.message || `Paystack init failed (${res.status})`);
    const url = new URL(body.data.authorization_url);
    if (url.protocol !== "https:" || url.hostname !== "checkout.paystack.com") throw new Error("Unexpected checkout URL");
    return { authorization_url: body.data.authorization_url, reference: it.reference };
  });

type AdminRpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> };

/** Shared settlement used by the webhook and the verify callback. */
export async function settleWalletTopup(
  admin: unknown,
  facts: { reference: string; status?: string; amountKobo?: number; currency?: string },
): Promise<{ outcome: string; school_id?: string; reason?: string }> {
  const { data, error } = await (admin as AdminRpc).rpc("wallet_topup_settle", {
    p_reference: facts.reference,
    p_status: facts.status ?? "",
    p_amount_kobo: facts.amountKobo ?? null,
    p_currency: facts.currency ?? "",
  });
  if (error) throw new Error(error.message);
  return data as { outcome: string; school_id?: string; reason?: string };
}

const verifySchema = z.object({ reference: z.string().regex(/^wtp_[0-9a-f]{32}$/) });

export const verifyWalletTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => verifySchema.parse(i))
  .handler(async ({ data, context }) => {
    // Caller must be able to see the intent (RLS: wallet.view) before we settle with elevated rights.
    const { data: visible } = await context.supabase
      .from("wallet_topup_intents" as never)
      .select("id")
      .eq("reference", data.reference)
      .maybeSingle();
    if (!visible) throw new Error("Top-up not found");
    const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(data.reference)}`, {
      headers: { Authorization: `Bearer ${testSecret()}` },
    });
    const body = (await res.json()) as { status: boolean; data?: { status: string; amount: number; currency?: string } };
    if (!res.ok || !body.status || !body.data) throw new Error("Verification failed");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const r = await settleWalletTopup(supabaseAdmin, {
      reference: data.reference, status: body.data.status, amountKobo: body.data.amount, currency: body.data.currency,
    });
    return { paid: r.outcome === "settled" || r.outcome === "duplicate", outcome: r.outcome };
  });
