/**
 * JARVIS-LIVE-01: the real senders behind the owner-alert tick (Authority: Owner; Origin: owner
 * instruction of 2026-11-16; Creator: Claude; Created: 2026-11-16; Status: Active).
 *
 * Channels: Resend (email), WhatsApp Cloud (existing adapters), BulkSMS (SMS) and Africa's
 * Talking (voice). Each channel is dormant (returns a code, makes no network
 * call) until BOTH the owner's destination and that provider's secrets are present in server
 * configuration:
 *
 *   OWNER_ALERT_EMAIL      owner's email address            (with RESEND_API_KEY, RESEND_FROM_ADDRESS)
 *   OWNER_ALERT_WHATSAPP   owner's WhatsApp number, E.164   (with WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID,
 *                                                            OWNER_ALERT_WHATSAPP_TEMPLATE [+ _LANGUAGE])
 *   OWNER_ALERT_PHONE      owner's phone number, E.164      (SMS: with BULKSMS_TOKEN_ID, BULKSMS_TOKEN_SECRET; voice: with
 *                                                            AT_USERNAME, AT_API_KEY, AT_VOICE_FROM_NUMBER,
 *                                                            AT_VOICE_WEBHOOK_TOKEN, OWNER_ALERT_VOICE_CALLBACK_URL)
 *
 * A destination is never stored in the database, never logged and never returned: outcomes carry
 * a code only. WhatsApp uses an approved template because a business-initiated message outside a
 * 24-hour customer window is refused by the platform, and free text would fail silently there.
 * The spoken script and the SMS/email body carry the severity and a console link only. They hold
 * no approval link, code or secret.
 */
import {
  createResendEmailAdapter,
  createResendEmailProviderRegistry,
  resendEmailConfigFromEnv,
} from "@/lib/communications/resend-email.server";
import { WhatsAppCloudAdapter } from "@/lib/communications/whatsapp-cloud.server";
import { sendBulkSms } from "./owner-alert-bulksms.server";
import { placeOwnerAlertCall, voiceScript as ownerVoiceScript } from "./owner-alert-voice.server";
import { isEmailDeliveryReceipt } from "@/lib/notifications/email-adapter-contract";
import { SystemClock, TimeAuthority } from "@/lib/kernel/time-authority";
import type { SendOutcome, SendRequest } from "./owner-alert-tick";

type Env = Record<string, string | undefined>;

const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^\s@<>()[\],;:"]{1,64}@[^\s@<>()[\],;:"]{1,255}\.[A-Za-z]{2,}$/;

export const OWNER_ALERT_EMAIL_ENV = "OWNER_ALERT_EMAIL";
export const OWNER_ALERT_PHONE_ENV = "OWNER_ALERT_PHONE";
export const OWNER_ALERT_WHATSAPP_ENV = "OWNER_ALERT_WHATSAPP";
export const OWNER_ALERT_WHATSAPP_TEMPLATE_ENV = "OWNER_ALERT_WHATSAPP_TEMPLATE";
export const OWNER_ALERT_WHATSAPP_LANGUAGE_ENV = "OWNER_ALERT_WHATSAPP_LANGUAGE";

const clock = new TimeAuthority(new SystemClock());

const clean = (v: string | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

export interface OwnerContacts {
  readonly email: string | null;
  readonly phone: string | null;
  readonly whatsapp: string | null;
}

/** Validated destinations from server configuration. An invalid value counts as absent. */
export function ownerContactsFromEnv(env: Env): OwnerContacts {
  const email = clean(env[OWNER_ALERT_EMAIL_ENV]);
  const phone = clean(env[OWNER_ALERT_PHONE_ENV]);
  const whatsapp = clean(env[OWNER_ALERT_WHATSAPP_ENV]);
  return {
    email: email && EMAIL.test(email) ? email : null,
    phone: phone && E164.test(phone) ? phone : null,
    whatsapp: whatsapp && E164.test(whatsapp) ? whatsapp : null,
  };
}

export const voiceScript = ownerVoiceScript;

export interface OwnerAlertSenderOptions {
  readonly env: Env;
  /** Used for the WhatsApp and SMS transports. Email and voice use the adapters' own fetch. */
  readonly fetcher?: typeof fetch;
}

export function createOwnerAlertSender(
  options: OwnerAlertSenderOptions,
): (request: SendRequest) => Promise<SendOutcome> {
  const { env } = options;
  const fetcher = options.fetcher ?? fetch;

  return async (request: SendRequest): Promise<SendOutcome> => {
    const contacts = ownerContactsFromEnv(env);
    switch (request.channel) {
      case "email": {
        if (!contacts.email) return { ok: false, code: "contact_not_configured" };
        const config = resendEmailConfigFromEnv(env);
        const adapter = createResendEmailAdapter(config);
        const result = await adapter.send(
          {
            notification: {
              id: request.idempotencyKey,
              tenantRef: "platform",
              recipientRef: "owner",
              audienceKind: "user",
              category: "system",
              subject: "Sherivs owner alert",
              body: request.body,
              actionRef: null,
              state: "queued",
              createdAt: clock.now().at,
            },
            recipientAddress: contacts.email,
            subject: `[${request.severity}] Sherivs owner alert`,
            body: request.body,
          },
          createResendEmailProviderRegistry(env),
        );
        return isEmailDeliveryReceipt(result)
          ? { ok: true, providerRef: null }
          : { ok: false, code: result.code };
      }
      case "whatsapp": {
        if (!contacts.whatsapp) return { ok: false, code: "contact_not_configured" };
        const template = clean(env[OWNER_ALERT_WHATSAPP_TEMPLATE_ENV]);
        if (!template) return { ok: false, code: "template_not_configured" };
        const adapter = new WhatsAppCloudAdapter(
          env.WHATSAPP_TOKEN,
          env.WHATSAPP_PHONE_NUMBER_ID,
          fetcher,
        );
        if (!adapter.live) return { ok: false, code: "provider_not_configured" };
        // Template parameters may not contain newlines, so the body goes in as one line.
        const result = await adapter.send(contacts.whatsapp, request.body, {
          template,
          language: clean(env[OWNER_ALERT_WHATSAPP_LANGUAGE_ENV]) ?? "en",
          parameters: [request.body.replace(/\s+/g, " ").slice(0, 900)],
        });
        return result.ok
          ? { ok: true, providerRef: result.providerRef }
          : { ok: false, code: "provider_error" };
      }
      case "sms": {
        if (!contacts.phone) return { ok: false, code: "contact_not_configured" };
        const result = await sendBulkSms(env, { to: contacts.phone, body: request.body }, fetcher);
        return result.ok
          ? { ok: true, providerRef: result.providerRef }
          : { ok: false, code: result.code };
      }
      case "voice": {
        if (!contacts.phone) return { ok: false, code: "contact_not_configured" };
        const result = await placeOwnerAlertCall(
          env,
          {
            to: contacts.phone,
            severity: request.severity,
            idempotencyKey: request.idempotencyKey,
          },
          fetcher,
        );
        return result.ok
          ? { ok: true, providerRef: result.providerRef }
          : { ok: false, code: result.code };
      }
    }
  };
}
