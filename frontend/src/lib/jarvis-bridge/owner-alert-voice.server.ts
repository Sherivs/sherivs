/**
 * JARVIS-LIVE-01: owner-alert voice calls through Africa's Talking.
 * Authority: Owner (comms stack decision of 2026-11-16). Origin: Claude Code agent, mission E-002
 * (JARVIS-LIVE-01). Creator: Claude Code agent. Created: 2026-11-16. Status: Active, dormant until
 * AT_USERNAME, AT_API_KEY, AT_VOICE_FROM_NUMBER, AT_VOICE_WEBHOOK_TOKEN and
 * OWNER_ALERT_VOICE_CALLBACK_URL exist.
 *
 * Africa's Talking answers an outbound call by asking a callback URL what to say. This module
 * places the call and answers that callback with one fixed sentence. The callback URL carries an
 * HMAC over the call id and severity, so only a call this server placed can fetch a script, and
 * the script is built here from the severity alone. It holds no approval link, code or secret.
 */
import { createHmac, createHash, timingSafeEqual } from "node:crypto";

type Env = Record<string, string | undefined>;
type Severity = "S1" | "S2" | "S3" | "S4";

const AT_CALL_URL = "https://voice.africastalking.com/call";
const SEVERITIES: readonly Severity[] = ["S1", "S2", "S3", "S4"];
const SEVERITY_WORDS = { S1: "one", S2: "two", S3: "three", S4: "four" } as const;

export const OWNER_ALERT_VOICE_CALLBACK_URL_ENV = "OWNER_ALERT_VOICE_CALLBACK_URL";
export const AT_VOICE_FROM_NUMBER_ENV = "AT_VOICE_FROM_NUMBER";

const clean = (v: string | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

export function voiceScript(severity: Severity): string {
  return (
    `This is a Sherivs priority alert. Severity ${SEVERITY_WORDS[severity]}. ` +
    "Please open your Sherivs console to review it. This call cannot approve anything."
  );
}

export function ownerAlertCallId(idempotencyKey: string): string {
  return createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32);
}

export function ownerAlertVoiceToken(secret: string, callId: string, severity: Severity): string {
  return createHmac("sha256", secret)
    .update(`owner-alert-voice|${callId}|${severity}`)
    .digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const xml = (text: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")}</Say><Hangup/></Response>`;

export type VoiceCallResult =
  | { readonly ok: true; readonly providerRef: string | null }
  | {
      readonly ok: false;
      readonly code: "provider_not_configured" | "provider_error";
    };

export async function placeOwnerAlertCall(
  env: Env,
  call: { readonly to: string; readonly severity: Severity; readonly idempotencyKey: string },
  fetcher: typeof fetch = fetch,
): Promise<VoiceCallResult> {
  const username = clean(env.AT_USERNAME);
  const apiKey = clean(env.AT_API_KEY);
  const from = clean(env[AT_VOICE_FROM_NUMBER_ENV]);
  const secret = clean(env.AT_VOICE_WEBHOOK_TOKEN);
  const base = clean(env[OWNER_ALERT_VOICE_CALLBACK_URL_ENV]);
  if (!username || !apiKey || !from || !secret || secret.length < 32 || !base) {
    return { ok: false, code: "provider_not_configured" };
  }
  let callback: URL;
  try {
    callback = new URL(base);
  } catch {
    return { ok: false, code: "provider_not_configured" };
  }
  if (callback.protocol !== "https:" || callback.username || callback.password) {
    return { ok: false, code: "provider_not_configured" };
  }
  const callId = ownerAlertCallId(call.idempotencyKey);
  callback.searchParams.set("call_id", callId);
  callback.searchParams.set("s", call.severity);
  callback.searchParams.set("token", ownerAlertVoiceToken(secret, callId, call.severity));
  try {
    const response = await fetcher(AT_CALL_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        apikey: apiKey,
      },
      body: new URLSearchParams({
        username,
        from,
        to: call.to,
        callbackUrl: callback.toString(),
        clientRequestId: callId,
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      entries?: { status?: unknown; sessionId?: unknown }[];
    } | null;
    const entry = payload?.entries?.[0];
    if (!response.ok || !entry || !/^queued$/i.test(String(entry.status ?? ""))) {
      return { ok: false, code: "provider_error" };
    }
    return {
      ok: true,
      providerRef: typeof entry.sessionId === "string" ? entry.sessionId.slice(0, 120) : null,
    };
  } catch {
    return { ok: false, code: "provider_error" };
  }
}

/** Answers Africa's Talking's callback for a call this server placed. Anything else is refused. */
export function answerOwnerAlertCallback(request: Request, env: Env): Response {
  const secret = clean(env.AT_VOICE_WEBHOOK_TOKEN);
  const url = new URL(request.url);
  const callId = url.searchParams.get("call_id") ?? "";
  const severity = url.searchParams.get("s") ?? "";
  const token = url.searchParams.get("token") ?? "";
  if (
    request.method !== "POST" ||
    !secret ||
    secret.length < 32 ||
    !/^[a-f0-9]{32}$/.test(callId) ||
    !SEVERITIES.includes(severity as Severity) ||
    !safeEqualHex(token, ownerAlertVoiceToken(secret, callId, severity as Severity))
  ) {
    return new Response("Forbidden", { status: 403 });
  }
  return new Response(xml(voiceScript(severity as Severity)), {
    status: 200,
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" },
  });
}
