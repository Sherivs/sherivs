/**
 * WF-15a3: renders a registry message for one payer. Pure: the caller supplies the values it resolved from the
 * invoice (guardian, student, school, pay link, balance) and the event payload (amount, due date); this module only
 * refuses anything unresolved, oversized or unexpected, so a half-filled message can never be handed to a channel.
 */
import {
  ALLOWED_VARIABLES,
  FEE_MESSAGE_REGISTRY,
  messageVariables,
  type RegistryMessage,
} from "./fee-message-registry";

export type FeeMessageValues = Partial<Record<(typeof ALLOWED_VARIABLES)[number], string>>;
export type RenderResult =
  | { ok: true; text: string; channel: RegistryMessage["channel"]; whatsappParams?: string[] }
  | { ok: false; error: string };

const MAX_VALUE_CHARS = 120;
/** A value may not smuggle a variable, a control character or a link into a field that is not the pay link. */
function isUnsafe(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x20 || value[i] === "{" || value[i] === "}") return true;
  }
  return false;
}
const PAY_LINK = /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\/[A-Za-z0-9_\-/]{1,80}$/;

const NAIRA = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 });
export function formatNaira(kobo: number): string {
  if (!Number.isInteger(kobo) || kobo < 0)
    throw new Error("amount must be a non-negative integer of kobo");
  return `NGN ${NAIRA.format(Math.floor(kobo / 100))}`;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** `2026-12-04` becomes `4 Dec 2026`; anything else is refused. */
export function formatDueDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error("due date must be YYYY-MM-DD");
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new Error("due date month out of range");
  return `${Number(m[3])} ${MONTHS[month - 1]} ${m[1]}`;
}

export function renderFeeMessage(
  templateRef: string,
  values: FeeMessageValues,
  registry: Readonly<Record<string, RegistryMessage>> = FEE_MESSAGE_REGISTRY,
): RenderResult {
  const entry = registry[templateRef];
  if (!entry) return { ok: false, error: "unknown_template" };
  const needed = messageVariables(entry.body);
  for (const v of needed) {
    const value = values[v as keyof FeeMessageValues];
    if (value === undefined || value.trim() === "") return { ok: false, error: `missing_${v}` };
    if (value.length > MAX_VALUE_CHARS || isUnsafe(value))
      return { ok: false, error: `unsafe_${v}` };
    if (v === "pay_link" && !PAY_LINK.test(value)) return { ok: false, error: "unsafe_pay_link" };
    if (v !== "pay_link" && /https?:\/\//i.test(value)) return { ok: false, error: `unsafe_${v}` };
  }
  const text = entry.body.replace(
    /\{\{([a-z_]+)\}\}/g,
    (_, k: string) => values[k as keyof FeeMessageValues] as string,
  );
  if (entry.channel === "sms" && text.length > 306) return { ok: false, error: "sms_too_long" };
  const result: RenderResult = { ok: true, text, channel: entry.channel };
  if (entry.whatsapp) {
    result.whatsappParams = entry.whatsapp.params.map(
      (p) => values[p as keyof FeeMessageValues] as string,
    );
    // The button carries only the short token after the base link, never the whole link.
    const link = values.pay_link as string;
    result.whatsappParams[result.whatsappParams.length - 1] = link.slice(link.lastIndexOf("/") + 1);
  }
  return result;
}
