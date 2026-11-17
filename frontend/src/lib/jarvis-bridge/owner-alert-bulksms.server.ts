/**
 * JARVIS-LIVE-01: owner-alert SMS through BulkSMS (https://api.bulksms.com/v1/messages).
 * Authority: Owner (comms stack decision of 2026-11-16). Origin: Claude Code agent, mission E-002
 * (JARVIS-LIVE-01). Creator: Claude Code agent. Created: 2026-11-16. Status: Active, dormant until
 * both BULKSMS_TOKEN_ID and BULKSMS_TOKEN_SECRET exist.
 *
 * HTTP Basic with a BulkSMS API token (id and secret). The message carries the severity and a
 * console link only. The destination and credentials are never logged or returned.
 */
type Env = Record<string, string | undefined>;

export const BULKSMS_TOKEN_ID_ENV = "BULKSMS_TOKEN_ID";
export const BULKSMS_TOKEN_SECRET_ENV = "BULKSMS_TOKEN_SECRET";
export const BULKSMS_SENDER_ENV = "BULKSMS_SENDER";
const BULKSMS_URL = "https://api.bulksms.com/v1/messages";

export type BulkSmsResult =
  | { readonly ok: true; readonly providerRef: string | null }
  | { readonly ok: false; readonly code: "provider_not_configured" | "provider_error" };

const clean = (v: string | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

export async function sendBulkSms(
  env: Env,
  message: { readonly to: string; readonly body: string },
  fetcher: typeof fetch = fetch,
): Promise<BulkSmsResult> {
  const id = clean(env[BULKSMS_TOKEN_ID_ENV]);
  const secret = clean(env[BULKSMS_TOKEN_SECRET_ENV]);
  if (!id || !secret || id.length > 200 || secret.length > 400) {
    return { ok: false, code: "provider_not_configured" };
  }
  const sender = clean(env[BULKSMS_SENDER_ENV]);
  const payload: Record<string, unknown> = {
    to: message.to,
    body: message.body.slice(0, 600),
  };
  if (sender && /^[A-Za-z0-9 ]{1,11}$|^\+?[0-9]{3,15}$/.test(sender)) payload.from = sender;
  try {
    const response = await fetcher(BULKSMS_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) return { ok: false, code: "provider_error" };
    const parsed: unknown = await response.json().catch(() => null);
    const first = Array.isArray(parsed) ? (parsed[0] as { id?: unknown } | undefined) : undefined;
    const ref = typeof first?.id === "string" ? first.id.slice(0, 120) : null;
    return { ok: true, providerRef: ref };
  } catch {
    return { ok: false, code: "provider_error" };
  }
}
