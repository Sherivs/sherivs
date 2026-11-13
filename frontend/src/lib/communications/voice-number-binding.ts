/**
 * COMMS-01 — server-side voice number and recipient binding.
 *
 * Africa's Talking numbers and call recipients are resolved from tenant-owned
 * records. Client and AI callers may name a member id; they may not supply a
 * raw phone number or a sender number.
 */

import { z } from "zod";

/** Public Sherivs support line. Not a secret. Pinned so escalation cannot drift. */
export const PLATFORM_VOICE_SUPPORT_NUMBER = "+2349015056201";

/** Fixed platform tenant from ADR-042. A public identifier, not a credential. */
export const PLATFORM_VOICE_TENANT_REF = "3c0d0f9a-56bb-4a3e-8e02-b1a426f1c201";

const RAW_NUMBER_KEYS = [
  "recipientPhone",
  "providerNumber",
  "phone",
  "to",
  "from",
  "provider_number",
  "p_recipient_phone",
  "p_provider_number",
] as const;

const recipientId = z.string().uuid();
const e164 = /^\+[1-9][0-9]{7,14}$/;

export function voiceSttProviderFromEnv(env: Record<string, string | undefined>): string {
  const value = env.VOICE_STT_PROVIDER?.trim();
  return value ? value : "openai";
}

export function voiceTtsProviderFromEnv(env: Record<string, string | undefined>): string {
  const value = env.VOICE_TTS_PROVIDER?.trim();
  return value ? value : "africas_talking";
}

export function assertNoRawVoiceNumber(input: unknown): void {
  if (!input || typeof input !== "object") return;
  for (const key of RAW_NUMBER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      throw new Error("Raw phone numbers are not accepted from the client or an AI caller.");
    }
  }
}

export function parseVoiceRecipientRef(value: string): string {
  const trimmed = value.trim();
  if (e164.test(trimmed) || /^\+?[0-9]{7,20}$/.test(trimmed)) {
    throw new Error("Raw phone numbers are not accepted from the client or an AI caller.");
  }
  return recipientId.parse(trimmed);
}

export const voiceAgentConfigureInput = z
  .object({
    enabled: z.boolean(),
    extension: z
      .string()
      .trim()
      .max(12)
      .regex(/^[0-9A-Za-z*#]{1,12}$/)
      .optional()
      .or(z.literal("")),
  })
  .strict();

export const voiceCallRequestInput = z
  .object({
    category: z.enum(["fee_reminder", "absence_alert"]),
    recipientUserId: z.string().uuid(),
  })
  .strict();

export function assertVoiceNumberTenant(
  binding: {
    orgId: string | null;
    tenantRef: string | null;
    bindingRole: "platform_support" | "organization";
  },
  callerTenantRef: string,
): void {
  if (binding.bindingRole !== "organization") {
    throw new Error("Voice number is not bound to this organization.");
  }
  const bound = binding.tenantRef ?? binding.orgId;
  if (!bound || bound !== callerTenantRef) {
    throw new Error("Voice number is not bound to this organization.");
  }
}

export function assertRecipientMembership(
  membershipOrgIds: readonly string[],
  callerOrgId: string,
): void {
  if (!membershipOrgIds.includes(callerOrgId)) {
    throw new Error("Recipient is not a member of this organization.");
  }
}

/** Digits only, with a Nigerian local 080… number rewritten to 234…. */
export function canonicalVoiceDigits(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (/^0\d{10}$/.test(digits)) return `234${digits.slice(1)}`;
  return digits;
}

export function normalizeStoredVoicePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (e164.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (/^234[0-9]{10}$/.test(digits)) return `+${digits}`;
  if (/^0[0-9]{10}$/.test(digits)) return `+234${digits.slice(1)}`;
  return null;
}

export function decideVoiceConsent(input: {
  recipientUserId: string;
  callerOrgId: string;
  membershipOrgIds: readonly string[];
  phone: string | null;
  phoneConfirmed: boolean;
  optedIn: boolean;
}): void {
  parseVoiceRecipientRef(input.recipientUserId);
  assertRecipientMembership(input.membershipOrgIds, input.callerOrgId);
  if (!input.phoneConfirmed || !normalizeStoredVoicePhone(input.phone)) {
    throw new Error("Recipient has no confirmed voice number.");
  }
  if (!input.optedIn) {
    throw new Error("Recipient has not opted in to voice calls.");
  }
}
