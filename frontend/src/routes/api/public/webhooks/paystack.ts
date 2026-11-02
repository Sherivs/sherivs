/**
 * Paystack webhook receiver.
 *
 * Public site auth bypasses /api/public/*, so we verify the payload
 * signature ourselves. Paystack signs the raw request body with HMAC-SHA512
 * using the merchant secret key and sends `x-paystack-signature`.
 *
 * On `charge.success`, the shared settlement path marks the fee paid only when
 * reference, currency and amount match the server-side fee row (SHERIVS-004).
 * Paystack sends no signed timestamp, so replay protection is idempotent
 * compare-and-set settlement keyed by the unique `paystack_reference`.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SystemClock, TimeAuthority } from "@/lib/kernel/time-authority";
import { settlePaystackCharge, type SettlementDb } from "@/lib/payments/paystack-settlement";
import { CONSOLE_SUBSCRIPTION_PREFIX } from "@/lib/internal-console/operations";
import {
  settleConsoleSubscription,
  type ConsoleSubscriptionDb,
} from "@/lib/payments/console-subscription-settlement";
import { clientIpFromHeaders } from "@/lib/security/request-safety";
import { verifyHmacHexSignature } from "@/lib/security/webhook-signature.server";
import {
  settleWalletTopup,
  WALLET_TOPUP_PREFIX,
} from "@/lib/runtime/scholar/wallet-topup.functions";
import { requirePaystackTestKey } from "@/lib/payments/paystack-testmode.server";
import {
  reconcileFinancialPayment,
  recordFinancialSettlement,
  recordFinancialRefund,
  type FinancialLifecycleDb,
} from "@/lib/runtime/scholar/payment-lifecycle.server";

/**
 * Bounded event contract (§26): an authenticated-but-malformed payload is
 * refused, never parsed with a blind cast. Only the fields the handler
 * consumes survive; anything else is ignored, not trusted.
 */
const timeAuthority = new TimeAuthority(new SystemClock());
const MAX_BODY_BYTES = 256 * 1024;

const PaystackEventSchema = z.object({
  event: z.string().max(64),
  data: z
    .object({
      reference: z.string().min(1).max(200).optional(),
      id: z.union([z.string().max(200), z.number().int().nonnegative()]).optional(),
      amount: z.number().int().nonnegative().max(100_000_000).optional(),
      currency: z.string().max(8).optional(),
      status: z.string().max(32).optional(),
      paid_at: z.string().datetime({ offset: true }).optional(),
      metadata: z
        .object({
          fee_id: z.string().uuid().optional(),
          school_id: z.string().max(64).optional(),
          subscription_id: z.string().uuid().optional(),
          organization_id: z.string().uuid().optional(),
          sherivs_share_kobo: z.number().int().nonnegative().max(100_000_000).optional(),
          sherivs_split: z.boolean().optional(),
        })
        .partial()
        .nullish(),
      subaccount: z
        .object({ subaccount_code: z.string().max(64).optional() })
        .partial()
        .nullish(),
      transaction: z
        .object({ reference: z.string().min(1).max(200).optional() })
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
        let secret: string;
        try {
          secret = requirePaystackTestKey(process.env.PAYSTACK_SECRET_KEY);
        } catch {
          return new Response("Payments not configured", { status: 503 });
        }

        const ip = clientIpFromHeaders(request.headers);
        const { checkPublicRateLimit } = await import("@/lib/security/public-rate-limit.server");
        const limited = await checkPublicRateLimit("paystack-webhook", ip, {
          maxRequests: 600,
          windowMs: 60_000,
        });
        if (!limited.allowed) {
          return new Response("Too many requests", {
            status: 429,
            headers: { "Retry-After": String(limited.retryAfterSeconds) },
          });
        }

        const raw = await request.text();
        if (raw.length > MAX_BODY_BYTES) return new Response("Payload too large", { status: 413 });
        const signature = request.headers.get("x-paystack-signature");
        if (!verifyHmacHexSignature(raw, signature, secret)) {
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

        let schoolId: string | null = null;
        let processingStatus = "ignored";
        let errorMessage: string | null = null;

        if (
          event.event === "charge.success" &&
          event.data?.reference?.startsWith(WALLET_TOPUP_PREFIX)
        ) {
          // SHERIVS-026: school wallet top-up. Settlement checks amount/currency against the DB intent.
          try {
            const r = await settleWalletTopup(supabaseAdmin, {
              reference: event.data.reference,
              status: event.data.status,
              amountKobo: event.data.amount,
              currency: event.data.currency,
            });
            schoolId = r.school_id ?? null;
            processingStatus = r.outcome;
            errorMessage = r.reason ?? null;
          } catch {
            return new Response("Processing error", { status: 500 });
          }
        } else if (
          event.event === "charge.success" &&
          event.data?.reference?.startsWith(CONSOLE_SUBSCRIPTION_PREFIX)
        ) {
          try {
            const result = await settleConsoleSubscription(
              supabaseAdmin as unknown as ConsoleSubscriptionDb,
              {
                reference: event.data.reference,
                status: event.data.status,
                amountKobo: event.data.amount,
                currency: event.data.currency,
              },
            );
            schoolId = "schoolId" in result ? (result.schoolId ?? null) : null;
            processingStatus = result.outcome;
            if (result.outcome === "rejected" || result.outcome === "ignored") {
              errorMessage = result.reason;
            }
          } catch (err) {
            await supabaseAdmin.from("webhook_logs").insert({
              school_id: null,
              provider: "paystack",
              event_type: event.event,
              payload: { reference: event.data.reference },
              processing_status: "error",
              error_message: err instanceof Error ? err.message.slice(0, 300) : "settlement error",
              processed_at: timeAuthority.now().at,
            });
            return new Response("Processing error", { status: 500 });
          }
        } else if (event.event === "charge.success" && event.data?.reference) {
          try {
            const lifecycleDb = supabaseAdmin as unknown as FinancialLifecycleDb;
            const providerEventRef = `charge.success:${event.data.reference}`;
            let canonicalAmountKobo: number | undefined;
            let canonicalFeeId: string | undefined;
            let canonicalScopeRef: string | undefined;
            let hasFinancialIntent = false;
            if (event.data.status === "success") {
              const reconciliation = await reconcileFinancialPayment(lifecycleDb, {
                reference: event.data.reference,
                providerEventRef,
                amountMinor: event.data.amount ?? 0,
                currency: event.data.currency ?? "",
                paidAt: event.data.paid_at ?? null,
              });
              if (reconciliation.verdict === "unknown_reference") {
                processingStatus = "legacy_reference";
              } else if (
                reconciliation.verdict !== "matched" ||
                !Number.isSafeInteger(reconciliation.expected_minor) ||
                !reconciliation.subject_ref ||
                !reconciliation.scope_ref
              ) {
                processingStatus = "rejected";
                errorMessage = `financial reconciliation: ${reconciliation.verdict}`;
                await supabaseAdmin.from("webhook_logs").insert({
                  school_id: null,
                  provider: "paystack",
                  event_type: event.event,
                  payload: { reference: event.data.reference },
                  processing_status: processingStatus,
                  error_message: errorMessage,
                  processed_at: timeAuthority.now().at,
                });
                return new Response("ok");
              } else {
                hasFinancialIntent = true;
                canonicalAmountKobo = reconciliation.expected_minor;
                canonicalFeeId = reconciliation.subject_ref;
                canonicalScopeRef = reconciliation.scope_ref;
              }
            }
            const result = await settlePaystackCharge(supabaseAdmin as unknown as SettlementDb, {
              reference: event.data.reference,
              status: event.data.status,
              amountKobo: event.data.amount,
              currency: event.data.currency,
              paidAt: event.data.paid_at,
              canonicalAmountKobo,
              canonicalFeeId,
              canonicalScopeRef,
              metadata: event.data.metadata,
              subaccountCode: event.data.subaccount?.subaccount_code ?? null,
            });
            // School id comes from the matched fee row, never from the payload.
            schoolId = "schoolId" in result ? (result.schoolId ?? null) : null;
            processingStatus = result.outcome;
            if (result.outcome === "rejected" || result.outcome === "ignored") {
              errorMessage = result.reason;
            } else if (result.outcome === "settled" && result.splitError) {
              errorMessage = `split: ${result.splitError}`;
            }
            if (hasFinancialIntent) {
              const ledgerResult = await recordFinancialSettlement(lifecycleDb, {
                reference: event.data.reference,
                providerEventRef,
                amountMinor: event.data.amount ?? 0,
                currency: event.data.currency ?? "",
                paidAt: event.data.paid_at ?? null,
              });
              if (!["settled", "duplicate"].includes(ledgerResult.outcome)) {
                throw new Error(`financial ledger: ${ledgerResult.outcome}`);
              }
            }
          } catch (err) {
            await supabaseAdmin.from("webhook_logs").insert({
              school_id: null,
              provider: "paystack",
              event_type: event.event,
              payload: { reference: event.data.reference },
              processing_status: "error",
              error_message: err instanceof Error ? err.message.slice(0, 300) : "settlement error",
              processed_at: timeAuthority.now().at,
            });
            // Non-2xx so Paystack redelivers; settlement is idempotent.
            return new Response("Processing error", { status: 500 });
          }
        } else if (event.event === "refund.processed") {
          try {
            const refund = event.data;
            if (
              refund?.id === undefined ||
              !refund.transaction?.reference ||
              refund.amount === undefined ||
              !refund.currency
            ) {
              processingStatus = "rejected";
              errorMessage = "invalid_refund_event";
            } else {
              const result = await recordFinancialRefund(
                supabaseAdmin as unknown as FinancialLifecycleDb,
                {
                  providerReference: String(refund.id),
                  reference: refund.transaction.reference,
                  amountMinor: refund.amount,
                  currency: refund.currency,
                },
              );
              processingStatus =
                result.outcome === "processed"
                  ? "processed"
                  : result.outcome === "duplicate"
                    ? "duplicate"
                    : result.outcome === "unknown_reference"
                      ? "ignored"
                      : "rejected";
              if (!["processed", "duplicate"].includes(result.outcome)) {
                errorMessage = result.outcome;
              }
            }
            await supabaseAdmin.from("webhook_logs").insert({
              school_id: null,
              provider: "paystack",
              event_type: event.event,
              payload: {
                provider_ref: refund?.id === undefined ? null : String(refund.id),
                reference: refund?.transaction?.reference ?? null,
              },
              processing_status: processingStatus,
              error_message: errorMessage,
              processed_at: timeAuthority.now().at,
            });
          } catch {
            return new Response("Processing error", { status: 500 });
          }
        }

        if (schoolId) {
          await supabaseAdmin.from("webhook_logs").insert({
            school_id: schoolId,
            provider: "paystack",
            event_type: event.event,
            payload: JSON.parse(JSON.stringify(event)),
            processing_status: processingStatus,
            error_message: errorMessage,
            processed_at: timeAuthority.now().at,
          });
        }
        return new Response("ok");
      },
      // Paystack does not preflight, but be polite to debuggers.
      GET: async () => new Response("Paystack webhook endpoint", { status: 200 }),
    },
  },
});
