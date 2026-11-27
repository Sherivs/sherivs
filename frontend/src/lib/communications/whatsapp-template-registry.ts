/**
 * Sherivs — WhatsApp template registry and the proactive-send gate (M22, ADR-151).
 *
 * A business-initiated (proactive) WhatsApp message outside a 24-hour customer window must use a
 * template the platform has approved. Free text there is refused by the platform or, worse, fails
 * silently. So every proactive WhatsApp send in Sherivs goes through {@link sendProactiveWhatsApp},
 * and that function refuses to contact the provider unless the message carries a REGISTERED,
 * APPROVED template whose language is set and whose parameter count matches exactly.
 *
 * The registry has two sources, one shape:
 *  - tenant templates: `public.comms_templates` rows with channel `whatsapp` (template name in
 *    `wa_template_name`, `language`, `wa_param_count` added by migration 20261117003400, `status`).
 *    The database refuses an approved WhatsApp row whose name or parameter count is missing or wrong.
 *  - platform templates (sent by Sherivs itself, not by a tenant): {@link PLATFORM_WHATSAPP_TEMPLATES}.
 *    Their Meta-approved name and language come from server configuration; the parameter count is
 *    fixed in code because the sender builds the parameters.
 *
 * Inbound replies inside a customer-opened conversation (`sendWhatsAppMessage` in
 * `whatsapp-cloud.server.ts`, used by the WhatsApp webhooks) are NOT proactive and keep their own
 * conversation-bound path. A guard test pins that no other module calls the Cloud adapter.
 */
import type { WhatsAppCloudAdapter, WhatsAppSendResult } from "./whatsapp-cloud.server";

export interface WhatsAppTemplate {
  /** Registry code (`comms_templates.code`, or the platform code). */
  readonly code: string;
  /** Meta template name. */
  readonly name: string | null;
  /** Meta language code, e.g. `en`. */
  readonly language: string | null;
  /** Number of body parameters the approved template declares. */
  readonly paramCount: number | null;
  readonly status: "approved" | "draft" | "rejected" | string;
}

export type TemplateRefusal =
  | "template_not_registered"
  | "template_not_approved"
  | "template_name_invalid"
  | "template_language_missing"
  | "template_param_count_unknown"
  | "template_param_count_mismatch"
  | "template_param_invalid";

const NAME = /^[a-z0-9_]{1,512}$/;
const LANGUAGE = /^[a-z]{2,3}(?:[_-][A-Za-z0-9]{2,8})?$/;

/** Pure check: may this template carry these parameters in a proactive send? */
export function checkProactiveTemplate(
  template: WhatsAppTemplate | null | undefined,
  parameters: readonly string[],
): { ok: true; name: string; language: string } | { ok: false; code: TemplateRefusal } {
  if (!template) return { ok: false, code: "template_not_registered" };
  if (template.status !== "approved") return { ok: false, code: "template_not_approved" };
  if (!template.name || !NAME.test(template.name))
    return { ok: false, code: "template_name_invalid" };
  if (!template.language || !LANGUAGE.test(template.language)) {
    return { ok: false, code: "template_language_missing" };
  }
  if (template.paramCount === null || !Number.isInteger(template.paramCount)) {
    return { ok: false, code: "template_param_count_unknown" };
  }
  if (parameters.length !== template.paramCount) {
    return { ok: false, code: "template_param_count_mismatch" };
  }
  // The platform refuses newlines, tabs and runs of 4+ spaces in body parameters.
  if (parameters.some((p) => p.length < 1 || p.length > 1024 || /[\n\t]| {4,}/.test(p))) {
    return { ok: false, code: "template_param_invalid" };
  }
  return { ok: true, name: template.name, language: template.language };
}

/* ─────────────────────────────── platform templates ─────────────────────────────── */

type Env = Record<string, string | undefined>;

export const OWNER_ALERT_WHATSAPP_TEMPLATE_ENV = "OWNER_ALERT_WHATSAPP_TEMPLATE";
export const OWNER_ALERT_WHATSAPP_LANGUAGE_ENV = "OWNER_ALERT_WHATSAPP_LANGUAGE";

/**
 * Templates Sherivs itself sends. The name/language are configuration (the founder registers the
 * template with Meta and sets the name); the parameter count is code. Naming a template in
 * configuration is the operator's statement that Meta approved it; without a name it is not approved.
 */
export const PLATFORM_WHATSAPP_TEMPLATES = {
  owner_alert: {
    paramCount: 1,
    nameEnv: OWNER_ALERT_WHATSAPP_TEMPLATE_ENV,
    languageEnv: OWNER_ALERT_WHATSAPP_LANGUAGE_ENV,
  },
} as const;

export type PlatformTemplateCode = keyof typeof PLATFORM_WHATSAPP_TEMPLATES;

export function platformWhatsAppTemplate(code: PlatformTemplateCode, env: Env): WhatsAppTemplate {
  const spec = PLATFORM_WHATSAPP_TEMPLATES[code];
  const name = env[spec.nameEnv]?.trim() || null;
  return {
    code,
    name,
    language: env[spec.languageEnv]?.trim() || "en",
    paramCount: spec.paramCount,
    status: name ? "approved" : "draft",
  };
}

/** A `comms_templates` row (snake_case, as PostgREST returns it) → registry entry. */
export function tenantWhatsAppTemplate(row: {
  code: string;
  wa_template_name: string | null;
  language: string | null;
  wa_param_count: number | null;
  status: string;
}): WhatsAppTemplate {
  return {
    code: row.code,
    name: row.wa_template_name,
    language: row.language,
    paramCount: row.wa_param_count,
    status: row.status,
  };
}

/* ─────────────────────────────── the gate ─────────────────────────────── */

export type ProactiveWhatsAppResult =
  | WhatsAppSendResult
  | { ok: false; error: string; refusal: TemplateRefusal | "provider_not_configured" };

/**
 * The ONLY proactive WhatsApp send. Refuses (no network call) without an approved registered
 * template with the exact parameter count. One provider attempt: transient-retry is OFF, because a
 * WhatsApp send has no idempotency key and a retry after a 5xx can deliver the message twice.
 */
export async function sendProactiveWhatsApp(
  adapter: Pick<WhatsAppCloudAdapter, "send" | "live">,
  message: {
    readonly to: string;
    readonly template: WhatsAppTemplate | null | undefined;
    readonly parameters: readonly string[];
    readonly phoneNumberId?: string;
  },
): Promise<ProactiveWhatsAppResult> {
  const checked = checkProactiveTemplate(message.template, message.parameters);
  if (!checked.ok) {
    return {
      ok: false,
      error: "proactive WhatsApp refused: no approved template",
      refusal: checked.code,
    };
  }
  if (!adapter.live) {
    return { ok: false, error: "whatsapp not configured", refusal: "provider_not_configured" };
  }
  return adapter.send(message.to, "", {
    template: checked.name,
    language: checked.language,
    parameters: [...message.parameters],
    ...(message.phoneNumberId ? { phoneNumberId: message.phoneNumberId } : {}),
    retryTransient: false,
  });
}
