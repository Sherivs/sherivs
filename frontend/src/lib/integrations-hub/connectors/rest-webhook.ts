/**
 * Generic REST / webhook connector.
 * Inbound push: the school's system POSTs canonical records to
 *   /api/public/webhooks/integrations/<webhook_id>
 * with headers
 *   x-sherivs-timestamp: <unix seconds>
 *   x-sherivs-signature: sha256=<hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`)>
 *   idempotency-key: <unique per batch>   (optional; defaults to a hash of the body)
 * The signing secret is issued once to the admin and stored only in the Sherivs Vault.
 * Inbound pull (scheduler): GET <base_url>/<entity>?updated_since=<cursor> with the vault API key (follow-up).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ConnectorManifest } from "../sdk";

export const restWebhookManifest: ConnectorManifest = {
  key: "rest-webhook",
  name: "Generic REST / webhook",
  version: "1.0.0",
  category: "api",
  auth_type: "hmac_webhook",
  entities: ["student", "staff", "guardian", "class", "result", "fee_invoice", "payment"],
  directions: ["inbound", "outbound"],
  status: "beta",
};
export const MAX_SKEW_SECONDS = 300;

export function signWebhook(secret: string, timestamp: string, rawBody: string): string {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

/** Constant-time verification with replay window. Fails closed on anything malformed. */
export function verifyWebhook(
  secret: string | null,
  timestamp: string | null,
  signature: string | null,
  rawBody: string,
  nowSeconds: number,
): boolean {
  if (!secret || !timestamp || !signature || !/^\d{9,11}$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > MAX_SKEW_SECONDS) return false;
  const m = signature.match(/^sha256=([0-9a-f]{64})$/i);
  if (!m) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  return timingSafeEqual(Buffer.from(m[1], "hex"), expected);
}
