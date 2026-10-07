/**
 * CoreGrid — DB-backed organization sender store over
 * `cg_org_communication_sender` (PLATFORM-019, DECISIONS.md #210).
 *
 * SERVER module. The table is zero-policy (RLS enabled, zero policies,
 * anon/authenticated fully revoked — see the migration): this adapter runs
 * on the SERVICE-ROLE client and is the only reader/writer. Every row read
 * back is validated against the pure contract (untrusted reads fail closed,
 * §26) before it can influence a send decision.
 *
 * Composition law: platform Twilio credentials (account SID + auth token)
 * are platform-level environment facts; the org sender contributes ONLY the
 * FROM identity. `twilioConfigForOrg` is the single governed composition
 * point: it resolves the org's active identity (falling back to the platform
 * default number) and merges it with the platform credentials — returning
 * null (fail closed) when either side is missing. No reason string ever
 * carries a secret value (§30).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { SystemClock, TimeAuthority } from "../kernel/time-authority";
import {
  ORG_SENDER_CHANNELS,
  ORG_SENDER_PROVIDERS,
  ORG_SENDER_STATUSES,
  resolveSenderForOrg,
  validateOrgCommunicationSender,
  type OrgCommunicationSender,
  type OrgSenderChannel,
} from "./org-sender-config";
import { TWILIO_FROM_NUMBER_ENV, type ServerEnv, type TwilioSmsConfig, twilioSmsConfigFromEnv } from "./twilio-sms.server";

/** Service-role client shape (injected — never created at module scope). */
export type OrgSenderServiceClient = SupabaseClient;

/** Kernel time authority — no direct wall-clock samples (J-023 discipline). */
const timeAuthority = new TimeAuthority(new SystemClock());

/** Zod view of one storage row (snake_case DB → camelCase contract). */
const OrgSenderRowSchema = z.object({
  sender_ref: z.string().trim().min(1).max(160),
  tenant_id: z.string().trim().min(1).max(128),
  org_ref: z.string().trim().min(1).max(160),
  channel: z.enum(ORG_SENDER_CHANNELS),
  provider: z.enum(ORG_SENDER_PROVIDERS),
  from_number: z.string().trim().regex(/^\+[1-9][0-9]{1,14}$/),
  credential_ref: z.string().trim().regex(/^env:\/\/[A-Z][A-Z0-9_]{2,127}$/),
  status: z.enum(ORG_SENDER_STATUSES),
  provenance: z.object({
    createdBy: z.string().trim().min(1).max(160),
    createdAt: z.string(),
    authorityRef: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
  }),
});

export type OrgSenderStoreOutcome<T> =
  | { outcome: "ok"; value: T }
  | { outcome: "blocked"; code: "service_client_unavailable"; reason: string }
  | { outcome: "blocked"; code: "row_rejected"; reason: string }
  | { outcome: "blocked"; code: "store_error"; reason: string };

function toContract(row: z.infer<typeof OrgSenderRowSchema>): OrgCommunicationSender {
  return {
    senderRef: row.sender_ref,
    tenantId: row.tenant_id,
    orgRef: row.org_ref,
    channel: row.channel,
    provider: row.provider,
    fromNumber: row.from_number,
    credentialRef: row.credential_ref,
    status: row.status,
    provenance: {
      createdBy: row.provenance.createdBy,
      createdAt: row.provenance.createdAt,
      authorityRef: row.provenance.authorityRef ?? null,
      note: row.provenance.note ?? null,
    },
  };
}

/**
 * All sender identities of one organization (any status). Rows failing the
 * contract are EXCLUDED and counted — never repaired, never trusted.
 */
export async function listOrgSenders(
  client: OrgSenderServiceClient | null,
  tenantId: string,
  orgRef: string,
  channel: OrgSenderChannel = "sms",
): Promise<OrgSenderStoreOutcome<{ senders: OrgCommunicationSender[]; rejectedRows: number }>> {
  if (!client) {
    return {
      outcome: "blocked",
      code: "service_client_unavailable",
      reason: "no service-role client — organization sender identities are unreadable (fail closed)",
    };
  }
  const { data, error } = await client
    .from("cg_org_communication_sender")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("org_ref", orgRef)
    .eq("channel", channel)
    .order("created_at", { ascending: true });
  if (error !== null) {
    return { outcome: "blocked", code: "store_error", reason: `sender store read failed: ${error.message}` };
  }
  const senders: OrgCommunicationSender[] = [];
  let rejectedRows = 0;
  for (const row of data ?? []) {
    const parsed = OrgSenderRowSchema.safeParse(row);
    if (!parsed.success) {
      rejectedRows += 1;
      continue;
    }
    senders.push(toContract(parsed.data));
  }
  return { outcome: "ok", value: { senders, rejectedRows } };
}

export interface UpsertOrgSenderInput {
  senderRef: string;
  tenantId: string;
  orgRef: string;
  channel: OrgSenderChannel;
  provider: "twilio";
  fromNumber: string;
  credentialRef: string;
  createdBy: string;
  authorityRef: string | null;
  note: string | null;
  /** ISO instant the identity becomes recorded (caller's TimeAuthority). */
  createdAt: string;
}

/**
 * Declare an organization sender identity as ACTIVE. Enforces the
 * one-active-identity invariant at the application boundary as well as the
 * database's partial unique index: an existing ACTIVE row for the same key
 * is demoted to `suspended` first (with provenance), then the new row is
 * inserted — the caller receives the resulting record. Contract violations
 * (bad E.164, non-env:// credentialRef, missing provenance) fail closed.
 */
export async function upsertOrgSender(
  client: OrgSenderServiceClient | null,
  input: UpsertOrgSenderInput,
): Promise<OrgSenderStoreOutcome<OrgCommunicationSender>> {
  if (!client) {
    return {
      outcome: "blocked",
      code: "service_client_unavailable",
      reason: "no service-role client — organization sender identities are unwritable (fail closed)",
    };
  }
  const candidate: OrgCommunicationSender = {
    senderRef: input.senderRef,
    tenantId: input.tenantId,
    orgRef: input.orgRef,
    channel: input.channel,
    provider: input.provider,
    fromNumber: input.fromNumber,
    credentialRef: input.credentialRef,
    status: "active",
    provenance: {
      createdBy: input.createdBy,
      createdAt: input.createdAt,
      authorityRef: input.authorityRef,
      note: input.note,
    },
  };
  const problems = validateOrgCommunicationSender(candidate);
  if (problems.length > 0) {
    return { outcome: "blocked", code: "row_rejected", reason: `sender record rejected: ${problems.join("; ")}` };
  }

  // Demote any prior ACTIVE identity for the same key (deterministic order:
  // demote, then insert — the partial unique index is the final authority).
  const { error: demoteError } = await client
    .from("cg_org_communication_sender")
    .update({ status: "suspended", updated_at: timeAuthority.now().at })
    .eq("tenant_id", input.tenantId)
    .eq("org_ref", input.orgRef)
    .eq("channel", input.channel)
    .eq("provider", input.provider)
    .eq("status", "active");
  if (demoteError !== null) {
    return { outcome: "blocked", code: "store_error", reason: `prior identity demotion failed: ${demoteError.message}` };
  }

  const { data, error } = await client
    .from("cg_org_communication_sender")
    .insert({
      sender_ref: candidate.senderRef,
      tenant_id: candidate.tenantId,
      org_ref: candidate.orgRef,
      channel: candidate.channel,
      provider: candidate.provider,
      from_number: candidate.fromNumber,
      credential_ref: candidate.credentialRef,
      status: candidate.status,
      provenance: candidate.provenance,
    })
    .select("*")
    .single();
  if (error !== null) {
    return { outcome: "blocked", code: "store_error", reason: `sender insert failed: ${error.message}` };
  }
  const parsed = OrgSenderRowSchema.safeParse(data);
  if (!parsed.success) {
    return { outcome: "blocked", code: "row_rejected", reason: "stored sender row failed contract validation after write (fail closed)" };
  }
  return { outcome: "ok", value: toContract(parsed.data) };
}

/**
 * Compose the Twilio SMS configuration for one organization: the org's
 * active sender identity supplies the FROM number (falling back to the
 * platform default env number); platform credentials come from the env.
 * Returns null when either side is missing — the adapter's fail-closed
 * signal (no provider call is ever attempted without a full config).
 */
export function twilioConfigForOrg(
  env: ServerEnv,
  tenantId: string,
  orgRef: string,
  senders: readonly OrgCommunicationSender[],
): TwilioSmsConfig | null {
  const platform = twilioSmsConfigFromEnv(env);
  if (platform === null) return null;
  const resolution = resolveSenderForOrg({
    tenantId,
    orgRef,
    senders,
    platformFromNumber: env[TWILIO_FROM_NUMBER_ENV] ?? null,
  });
  if (!resolution.resolved) return null;
  return {
    accountSid: platform.accountSid,
    authToken: platform.authToken,
    fromNumber: resolution.fromNumber,
  };
}