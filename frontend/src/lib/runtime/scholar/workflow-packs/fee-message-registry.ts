/**
 * WF-15a2: the message registry for the private-school pack. Pure data and validation, no I/O.
 *
 * Every `templateRef` a pack template uses resolves here to the exact words a school sends. A WhatsApp entry also names
 * the Meta template it must match (Meta approves wording, so wording lives in one reviewed place). Variables are
 * either bound from the WF-05 event payload or derived by the sender from the invoice id; nothing else can appear.
 * Strategy of 26 Nov 2026 (founder decisions D-01, D-02): one message per payer, pay link in every message,
 * minimal personal data (no surname, grade or health detail), STOP wording on SMS.
 */
export type MessageChannel = "sms" | "whatsapp" | "in_app" | "email" | "task";

/** Variables the sender fills from the invoice id. They never come from the event payload. */
export const DERIVED_VARIABLES = ["guardian", "student", "school", "pay_link", "balance"] as const;
/** Variables the pack binds from the event payload (amount_kobo, due_at). */
export const PAYLOAD_VARIABLES = ["amount", "due_date"] as const;
export const ALLOWED_VARIABLES: readonly string[] = [...DERIVED_VARIABLES, ...PAYLOAD_VARIABLES];

export interface WhatsAppBinding {
  /** Name registered in WhatsApp Manager. */
  name: string;
  language: "en";
  category: "UTILITY";
  /** Variable order for {{1}}..{{n}}. */
  params: readonly string[];
  /** Updated by hand when Meta decides; nothing here talks to Meta. */
  status: "not_submitted" | "submitted" | "approved" | "rejected";
}

export interface RegistryMessage {
  channel: MessageChannel;
  audience: "payer" | "bursar" | "guardian";
  body: string;
  whatsapp?: WhatsAppBinding;
}

const STOP = " Reply STOP to opt out.";

export const FEE_MESSAGE_REGISTRY: Readonly<Record<string, RegistryMessage>> = Object.freeze({
  "ps.fee.invoice_notice": {
    channel: "email",
    audience: "payer",
    body: "Hello {{guardian}}, a fee invoice of {{amount}} for {{student}} at {{school}} is due on {{due_date}}. Pay online: {{pay_link}}",
  },
  "ps.fee.week_start.push": {
    channel: "in_app",
    audience: "payer",
    body: "{{amount}} for {{student}} is due on {{due_date}}. Tap to pay.",
  },
  "ps.fee.week_start.sms": {
    channel: "sms",
    audience: "payer",
    body: `{{school}}: fees of {{amount}} for {{student}} are due on {{due_date}}. Pay: {{pay_link}}${STOP}`,
  },
  "ps.fee.week_end.push": {
    channel: "in_app",
    audience: "payer",
    body: "Reminder: {{amount}} for {{student}} is due on {{due_date}}. Tap to pay.",
  },
  "ps.fee.due_day.push": {
    channel: "in_app",
    audience: "payer",
    body: "{{amount}} for {{student}} is due today. Tap to pay.",
  },
  "ps.fee.due_day.sms": {
    channel: "sms",
    audience: "payer",
    body: `{{school}}: fees of {{amount}} for {{student}} are due today. Pay: {{pay_link}}${STOP}`,
  },
  "ps.fee.due_day.whatsapp": {
    channel: "whatsapp",
    audience: "payer",
    body: "Hello {{guardian}}, school fees of {{amount}} for {{student}} at {{school}} are due today, {{due_date}}. If you have already paid, please ignore this message.",
    whatsapp: {
      name: "fee_due_today",
      language: "en",
      category: "UTILITY",
      params: ["guardian", "amount", "student", "school", "due_date", "pay_link"],
      status: "not_submitted",
    },
  },
  "ps.fee.overdue.push": {
    channel: "in_app",
    audience: "payer",
    body: "The balance of {{balance}} for {{student}} was due on {{due_date}}. Tap to pay or ask about a plan.",
  },
  "ps.fee.overdue.sms": {
    channel: "sms",
    audience: "payer",
    body: `{{school}}: balance of {{balance}} for {{student}} was due on {{due_date}}. Pay or ask about a plan: {{pay_link}}${STOP}`,
  },
  "ps.fee.overdue.whatsapp": {
    channel: "whatsapp",
    audience: "payer",
    body: "Hello {{guardian}}, the balance of {{balance}} for {{student}} at {{school}} was due on {{due_date}}. You can pay or ask about a payment plan using the button below. If you have paid, thank you and please ignore this message.",
    whatsapp: {
      name: "fee_overdue_weekly",
      language: "en",
      category: "UTILITY",
      params: ["guardian", "balance", "student", "school", "due_date", "pay_link"],
      status: "not_submitted",
    },
  },
  "ps.fee.review_unpaid": {
    channel: "task",
    audience: "bursar",
    body: "Invoice for {{student}} is four weeks overdue (balance {{balance}}). Contact the payer and agree a plan or escalate.",
  },
  "ps.payment.receipt": {
    channel: "email",
    audience: "payer",
    body: "Hello {{guardian}}, we received {{amount}} for {{student}} at {{school}}. Thank you.",
  },
  "ps.payment.recorded": {
    channel: "in_app",
    audience: "bursar",
    body: "A payment of {{amount}} was recorded for {{student}}.",
  },
  "ps.absence.guardian_alert": {
    channel: "email",
    audience: "guardian",
    body: "Hello {{guardian}}, {{student}} was marked absent from {{school}} today. Please contact the school if this is unexpected.",
  },
  "ps.absence.follow_up": {
    channel: "task",
    audience: "bursar",
    body: "Follow up the absence of {{student}} with the guardian.",
  },
});

const PROMOTIONAL =
  /\b(free|offer|discount|win|prize|limited time|hurry|congratulations|click now)\b/i;
// GSM 03.38 basic set plus the euro-less extension we do not use: keeps every SMS to cheap 7-bit segments.
const GSM7 = /^[A-Za-z0-9 @£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà\r\n{}]*$/;
const SAMPLE: Record<string, string> = {
  guardian: "Amina",
  student: "Fatima",
  school: "Bright Future School",
  pay_link: "https://pay.sherivs.com/abc123",
  balance: "NGN 85,000",
  amount: "NGN 85,000",
  due_date: "28 Nov 2026",
};

export function messageVariables(body: string): string[] {
  return [...body.matchAll(/\{\{([a-z_]+)\}\}/g)].map((m) => m[1]);
}
export function renderSample(body: string): string {
  return body.replace(/\{\{([a-z_]+)\}\}/g, (_, k: string) => SAMPLE[k] ?? "?");
}

export function validateFeeMessageRegistry(
  registry: Readonly<Record<string, RegistryMessage>> = FEE_MESSAGE_REGISTRY,
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const metaNames = new Set<string>();
  for (const [ref, m] of Object.entries(registry)) {
    if (!/^ps\.[a-z_]+\.[a-z_.]+$/.test(ref)) errors.push(`${ref}: bad reference`);
    for (const v of messageVariables(m.body))
      if (!ALLOWED_VARIABLES.includes(v)) errors.push(`${ref}: unknown variable ${v}`);
    if (/\{\{[^a-z_}]|\{\{[a-z_]*$/.test(m.body)) errors.push(`${ref}: malformed variable`);
    if (PROMOTIONAL.test(m.body)) errors.push(`${ref}: promotional wording`);
    if (/\{\{[a-z_]+\}\}\{\{[a-z_]+\}\}/.test(m.body)) errors.push(`${ref}: adjacent variables`);
    const rendered = renderSample(m.body);
    if (m.channel === "sms") {
      if (!GSM7.test(rendered)) errors.push(`${ref}: sms must be GSM-7 only`);
      if (rendered.length > 306) errors.push(`${ref}: sms longer than two segments`);
      if (!m.body.includes("{{pay_link}}")) errors.push(`${ref}: sms must carry the pay link`);
      if (!/Reply STOP/.test(m.body)) errors.push(`${ref}: sms must carry the STOP wording`);
    }
    if (m.channel === "in_app" && rendered.length > 140)
      errors.push(`${ref}: push text over 140 characters`);
    if (m.channel === "whatsapp") {
      const w = m.whatsapp;
      if (!w) {
        errors.push(`${ref}: whatsapp entry needs its Meta binding`);
        continue;
      }
      if (!/^[a-z][a-z0-9_]{0,511}$/.test(w.name)) errors.push(`${ref}: bad Meta template name`);
      if (metaNames.has(w.name)) errors.push(`${ref}: duplicate Meta template name`);
      metaNames.add(w.name);
      if (w.category !== "UTILITY") errors.push(`${ref}: category must be UTILITY`);
      if (m.body.length > 1024) errors.push(`${ref}: body over 1024 characters`);
      const used = messageVariables(m.body);
      // the pay link rides on the URL button, not in the body
      const bodyParams = w.params.filter((p) => p !== "pay_link");
      if (used.length !== bodyParams.length || used.some((v, i) => v !== bodyParams[i]))
        errors.push(`${ref}: body variables must match the Meta parameter order`);
      if (used.includes("pay_link")) errors.push(`${ref}: the pay link belongs on the button`);
      if (/^\{\{|\}\}$/.test(m.body.trim()))
        errors.push(`${ref}: whatsapp body cannot start or end with a variable`);
    } else if (m.whatsapp) {
      errors.push(`${ref}: only whatsapp entries carry a Meta binding`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}
