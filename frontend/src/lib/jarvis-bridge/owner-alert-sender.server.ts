/**
 * JARVIS-LIVE-01: the real senders behind the owner-alert tick (Authority: Owner; Origin: owner
 * instruction of 2026-11-16; Creator: Claude; Created: 2026-11-16; Status: Active).
 *
 * Channels: Resend (email), WhatsApp Cloud (existing adapters), the one SMS port (M22: BulkSMS
 * Nigeria or BulkSMS.com, chosen by SMS_PROVIDER) and Africa's Talking (voice, paused).
 * M22 (ADR-120): email, SMS and WhatsApp go through the same shared send paths the tenant fabric
 * uses (no second sender), and every SMS/WhatsApp/email attempt records `cg_delivery_evidence`
 * under the tenant reference `platform`. Each channel is dormant (returns a code, makes no network
 * call) until BOTH the owner's destination and that provider's secrets are present in server
 * configuration:
 *
 *   OWNER_ALERT_EMAIL      owner's email address            (with RESEND_API_KEY, RESEND_FROM_ADDRESS)
 *   OWNER_ALERT_WHATSAPP   owner's WhatsApp number, E.164   (with WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID,
 *                                                            OWNER_ALERT_WHATSAPP_TEMPLATE [+ _LANGUAGE])
 *   OWNER_ALERT_PHONE      owner's phone number, E.164      (SMS: with SMS_PROVIDER + that provider's keys; voice: with
 *                                                            AT_USERNAME, AT_API_KEY, AT_VOICE_FROM_NUMBER,
 *                                                            AT_VOICE_WEBHOOK_TOKEN, OWNER_ALERT_VOICE_CALLBACK_URL)
 *
 * A destination is never stored in the database, never logged and never returned: outcomes carry
 * a code only. WhatsApp uses an approved template because a business-initiated message outside a
 * 24-hour customer window is refused by the platform, and free text would fail silently there.
 * The spoken script and the SMS/email body carry the severity and a console link only. They hold
 * no approval link, code or secret.
 */
import { createTransactionalEmailSender } from "@/lib/communications/email-send.server";
import { WhatsAppCloudAdapter } from "@/lib/communications/whatsapp-cloud.server";
import { selectSmsGateway } from "@/lib/communications/sms-gateway.server";
import {
  OWNER_ALERT_WHATSAPP_LANGUAGE_ENV,
  OWNER_ALERT_WHATSAPP_TEMPLATE_ENV,
  platformWhatsAppTemplate,
  sendProactiveWhatsApp,
} from "@/lib/communications/whatsapp-template-registry";
import {
  attemptEvidenceRecord,
  deliveryEvidenceSinkFromEnv,
  recordDeliveryEvidence,
  redactPhoneRecipient,
  type DeliveryEvidenceSink,
} from "@/lib/communications/delivery-evidence.server";
import { placeOwnerAlertCall, voiceScript as ownerVoiceScript } from "./owner-alert-voice.server";
import type { SendOutcome, SendRequest } from "./owner-alert-tick";

type Env = Record<string, string | undefined>;

const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^\s@<>()[\],;:"]{1,64}@[^\s@<>()[\],;:"]{1,255}\.[A-Za-z]{2,}$/;

export const OWNER_ALERT_EMAIL_ENV = "OWNER_ALERT_EMAIL";
export const OWNER_ALERT_PHONE_ENV = "OWNER_ALERT_PHONE";
export const OWNER_ALERT_WHATSAPP_ENV = "OWNER_ALERT_WHATSAPP";
export { OWNER_ALERT_WHATSAPP_LANGUAGE_ENV, OWNER_ALERT_WHATSAPP_TEMPLATE_ENV };

/** Owner alerts are platform messages: evidence is filed under this tenant reference, never a tenant's. */
export const OWNER_ALERT_EVIDENCE_TENANT = "platform";

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
  /** Delivery-evidence sink. Undefined = from env (SUPABASE_URL + service key); null = none. */
  readonly evidence?: DeliveryEvidenceSink | null;
}

export function createOwnerAlertSender(
  options: OwnerAlertSenderOptions,
): (request: SendRequest) => Promise<SendOutcome> {
  const { env } = options;
  const fetcher = options.fetcher ?? fetch;

  const evidence =
    options.evidence === undefined ? deliveryEvidenceSinkFromEnv(env) : options.evidence;
  const phoneEvidence = (
    channel: "sms" | "whatsapp",
    adapter: string,
    to: string,
    request: SendRequest,
    attempt: Parameters<typeof attemptEvidenceRecord>[1],
  ) =>
    recordDeliveryEvidence(
      evidence,
      attemptEvidenceRecord(
        {
          tenantId: OWNER_ALERT_EVIDENCE_TENANT,
          channel,
          adapter,
          notificationRef: request.idempotencyKey.slice(0, 160),
          recipientRedacted: redactPhoneRecipient(to),
          triggerSource: `owner-alert.${channel}:${adapter}`,
          triggeredBy: "jarvis-owner-alert-tick",
        },
        attempt,
      ),
    );

  return async (request: SendRequest): Promise<SendOutcome> => {
    const contacts = ownerContactsFromEnv(env);
    switch (request.channel) {
      case "email": {
        if (!contacts.email) return { ok: false, code: "contact_not_configured" };
        // The one transactional email path (Resend + evidence), shared with the ENGINE-23 worker.
        const out = await createTransactionalEmailSender(
          env,
          evidence,
        )({
          id: request.idempotencyKey,
          tenantRef: OWNER_ALERT_EVIDENCE_TENANT,
          recipientRef: "owner",
          category: "system",
          to: contacts.email,
          subject: `[${request.severity}] Sherivs owner alert`,
          body: request.body,
        });
        return out.ok ? { ok: true, providerRef: null } : { ok: false, code: out.code };
      }
      case "whatsapp": {
        if (!contacts.whatsapp) return { ok: false, code: "contact_not_configured" };
        // Proactive: only through the template registry gate (approved template, exact parameter count).
        const template = platformWhatsAppTemplate("owner_alert", env);
        if (template.status !== "approved") return { ok: false, code: "template_not_configured" };
        const adapter = new WhatsAppCloudAdapter(
          env.WHATSAPP_TOKEN,
          env.WHATSAPP_PHONE_NUMBER_ID,
          fetcher,
        );
        if (!adapter.live) return { ok: false, code: "provider_not_configured" };
        // Template parameters may not contain newlines, so the body goes in as one line.
        const result = await sendProactiveWhatsApp(adapter, {
          to: contacts.whatsapp,
          template,
          parameters: [request.body.replace(/\s+/g, " ").trim().slice(0, 900)],
        });
        await phoneEvidence(
          "whatsapp",
          adapter.name,
          contacts.whatsapp,
          request,
          result.ok
            ? { outcome: "delivered", providerMessageId: result.providerRef }
            : { outcome: "failed", code: "refusal" in result ? result.refusal : "provider_error", reason: "owner alert WhatsApp not accepted" },
        );
        return result.ok
          ? { ok: true, providerRef: result.providerRef }
          : { ok: false, code: "refusal" in result ? result.refusal : "provider_error" };
      }
      case "sms": {
        if (!contacts.phone) return { ok: false, code: "contact_not_configured" };
        // The ONE SMS port (SMS_PROVIDER), shared with the tenant fabric. No delivery-report callback:
        // an owner alert has no outbound_messages row. Platform cost: never metered to a tenant.
        const selection = selectSmsGateway(env, fetcher);
        if (!selection.ok) return { ok: false, code: selection.code };
        const result = await selection.gateway.send({
          messageId: request.idempotencyKey,
          recipient: contacts.phone,
          body: request.body.slice(0, 600),
          deliveryReport: false,
        });
        await phoneEvidence(
          "sms",
          selection.gateway.providerId,
          contacts.phone,
          request,
          result.outcome === "sent"
            ? { outcome: "delivered", providerMessageId: result.providerMessageId }
            : { outcome: result.outcome, code: result.code, reason: result.reason },
        );
        return result.outcome === "sent"
          ? { ok: true, providerRef: result.providerMessageId }
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
