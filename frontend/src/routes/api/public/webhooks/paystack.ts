/**
 * Paystack webhook receiver.
 *
 * Public site auth bypasses /api/public/*, so we verify the payload
 * signature ourselves. Paystack signs the raw request body with HMAC-SHA512
 * using the merchant secret key and sends `x-paystack-signature`.
 *
 * On `charge.success`, we mark the fee row paid by reference.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

/**
 * Bounded event contract (§26): an authenticated-but-malformed payload is
 * refused, never parsed with a blind cast. Only the fields the handler
 * consumes survive; anything else is ignored, not trusted.
 */
const PaystackEventSchema = z.object({
  event: z.string().max(64),
  data: z
    .object({
      reference: z.string().min(1).max(200).optional(),
      amount: z.number().int().nonnegative().max(100_000_000).optional(),
      status: z.string().max(32).optional(),
      metadata: z
        .object({
          fee_id: z.string().uuid().optional(),
          school_id: z.string().max(64).optional(),
        })
        .partial()
        .nullish(),
    })
    .partial()
    .nullish(),
});

export const Route = createFileRoute("/api/public/webhooks/paystack")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.PAYSTACK_SECRET_KEY;
        if (!secret) return new Response("Payments not configured", { status: 503 });

        const raw = await request.text();
        const signature = request.headers.get("x-paystack-signature") ?? "";
        const expected = createHmac("sha512", secret).update(raw).digest("hex");

        const sig = Buffer.from(signature);
        const exp = Buffer.from(expected);
        if (sig.length !== exp.length || !timingSafeEqual(sig, exp)) {
          return new Response("Invalid signature", { status: 401 });
        }

        type PaystackEvent = z.infer<typeof PaystackEventSchema>;
        let event: PaystackEvent | null = null;
        try {
          event = PaystackEventSchema.parse(JSON.parse(raw));
        } catch {
          return new Response("Invalid JSON or event shape", { status: 400 });
        }
        if (!event) return new Response("ok");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const schoolId = event.data?.metadata?.school_id ?? null;
        if (schoolId) {
          await supabaseAdmin.from("webhook_logs").insert({
            school_id: schoolId,
            provider: "paystack",
            event_type: event.event,
            payload: JSON.parse(JSON.stringify(event)),
            processing_status: "received",
          });
        }

        if (event.event === "charge.success" && event.data?.reference) {
          const feeId = event.data.metadata?.fee_id;
          const amount = event.data.amount ? event.data.amount / 100 : null;
          // Idempotency note: the update is keyed by the provider reference, so
          // a provider redelivery rewrites the same terminal state — the
          // financial effect stays exactly-once in substance.
          const upd = {
            status: "paid",
            paid_at: new Date().toISOString(),
            ...(amount != null ? { paid_amount: amount } : {}),
          };
          const query = supabaseAdmin
            .from("fees")
            .update(upd)
            .eq("paystack_reference", event.data.reference);
          if (feeId) await query.eq("id", feeId);
          else await query;
        }
        return new Response("ok");
      },
      // Paystack does not preflight, but be polite to debuggers.
      GET: async () => new Response("Paystack webhook endpoint", { status: 200 }),
    },
  },
});
