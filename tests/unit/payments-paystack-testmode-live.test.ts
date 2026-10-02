/**
 * CoreGrid — MISSION-R-32 LIVE Paystack TEST-MODE verification (credential-gated).
 *
 * Executes one real initialize + verify round against api.paystack.co with
 * the injected sk_test key, proving: test-key-class gate passes for a real
 * test key, audit-before-execute with a real sink, idempotency-key
 * registration (initialize), provider-side record retrieval (verify), and
 * canonical ownership validation (amount/currency match + mismatch denial).
 *
 * Gating law: SKIPPED unless PAYSTACK_SECRET_KEY is injected AND is
 * test-class (sk_test_). Live keys NEVER enable this surface — a live key
 * in the environment is refused like any other (the gate re-validates).
 * No real money can move: test-mode transactions are never completed here
 * (no card is charged; the transaction stays pending provider-side).
 */
import { describe, expect, it } from "vitest";
import {
  initializePaystackTestTransaction,
  paystackTestModeFromEnv,
  verifyOwnedPayment,
  type PaystackAuditEntry,
} from "../../frontend/src/lib/payments/paystack-testmode.server";
import { money } from "../../frontend/src/lib/financial-core";
import { tenantId } from "../../frontend/src/lib/tenant-core";

const envKey = process.env.PAYSTACK_SECRET_KEY ?? "";
const LIVE_CREDENTIALS = envKey.startsWith("sk_test_");

describe.skipIf(!LIVE_CREDENTIALS)(
  "live: Paystack test rails through the governed client (MISSION-R-32)",
  () => {
    it(
      "initializes, verifies and ownership-validates one test transaction with audit evidence",
      { timeout: 60_000 },
      async () => {
        const entries: PaystackAuditEntry[] = [];
        const composed = paystackTestModeFromEnv((entry) => {
          entries.push(entry);
        });
        if (!composed.ok) throw new Error(`test-mode composition denied: ${composed.reason}`);
        const cfg = composed.config;

        // Uniqueness per run: the probe fee id carries a time component so
        // repeated runs register distinct, replay-safe references.
        const feeRef = `mr32-probe-${Date.now()}`;
        const reference = {
          tenantId: tenantId("cg-probe-mr32"),
          payerRef: "cg-probe-payer",
          amount: money(10_000, "NGN"),
          purpose: { kind: "fee_payment" as const, ref: feeRef },
        };

        const init = await initializePaystackTestTransaction(
          cfg,
          reference,
          "coregrid-mr32-probe@example.com",
        );
        if (!init.ok) throw new Error(`live initialize denied: ${init.code} ${init.reason}`);
        expect(init.value.idempotencyKey).toContain(feeRef);
        expect(init.value.authorizationUrl).toContain("paystack");
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ action: "paystack.transaction.initialize", mode: "test" });

        const verify = await verifyOwnedPayment(cfg, init.value.reference, {
          amount: money(10_000, "NGN"),
        });
        if (!verify.ok) throw new Error(`live verify denied: ${verify.code} ${verify.reason}`);
        expect(verify.value.amountMinor).toBe(10_000);
        expect(verify.value.currency).toBe("NGN");
        // A never-completed test transaction reports a non-success state.
        expect(verify.value.status).not.toBe("success");

        // Ownership law: a canonical reference that disagrees with the
        // provider record is denied (wrong amount can never be settled).
        const mismatch = await verifyOwnedPayment(cfg, init.value.reference, {
          amount: money(999_999, "NGN"),
        });
        expect(mismatch).toMatchObject({ ok: false, code: "ownership_mismatch" });
      },
    );
  },
);
