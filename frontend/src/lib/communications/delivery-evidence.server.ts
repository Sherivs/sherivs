/**
 * CoreGrid — delivery-evidence recording (R6 follow-up to V1-009, team COMMS).
 *
 * Durable proof that an outbound communication ATTEMPT happened — including
 * the attempt that was BLOCKED for missing credentials. That a send was
 * blocked is itself evidence (fail-closed, never fail-open): the absence of
 * a row is the anomaly, not the blocked attempt.
 *
 * Laws honored:
 * - §12 Data provenance: every row carries who/what triggered it, whether it
 *   was AI-generated (always false here — adapters are deterministic
 *   infrastructure, not intelligence) and the bounded provenance of the
 *   attempt itself (channel, adapter, outcome, provider message id).
 * - §28 Database law: the substrate table (cg_delivery_evidence) is
 *   append-only evidence — no UPDATE/DELETE path exists; rows are never
 *   overwritten.
 * - §29 Observability: evidence-write failures are REPORTED through the
 *   structured log path, never silently swallowed.
 * - §24/§25 Architecture: adapters depend on the `DeliveryEvidenceSink`
 *   PORT, never on a vendor. The concrete PostgREST sink is one bounded
 *   fetch, exactly like the provider adapters themselves.
 * - §19/§30 Privacy: recipients are REDACTED before they can enter any
 *   evidence row (local-part/number masking); secret values never appear in
 *   any reason string or log line.
 *
 * Failure posture: recording is NON-FATAL to the communication result. If
 * the sink throws or the substrate is absent, the adapter still resolves to
 * its exact typed result and the evidence-write failure is surfaced as a
 * structured warn log (`evidence_write_failed`). Fail-closed, never
 * fail-open: a missing substrate NEVER upgrades a blocked attempt into a
 * delivery.
 */

import { SystemClock, TimeAuthority } from "../kernel/time-authority";
import { logStructured } from "../observability/structured-log";
import {
  isEmailDeliveryReceipt,
  type EmailAdapter,
  type EmailDeliveryResult,
  type EmailSendCommand,
} from "../notifications/email-adapter-contract";
import {
  isTelephonyCallReceipt,
  type TelephonyAdapter,
  type TelephonyCallCommand,
  type TelephonyCallResult,
} from "./telephony-adapter-contract";

/** J-023: time enters only via the kernel time-authority. */
const evidenceTimeAuthority = new TimeAuthority(new SystemClock());

/** Component tag for structured evidence-write diagnostics (§29). */
export const DELIVERY_EVIDENCE_COMPONENT = "communications.delivery-evidence";

/** The PostgREST table the concrete sink appends to. */
export const DELIVERY_EVIDENCE_TABLE = "cg_delivery_evidence";

/** Environment variables the concrete sink resolves (names only, §30). */
export const SUPABASE_URL_ENV = "SUPABASE_URL";
export const SUPABASE_SERVICE_ROLE_KEY_ENV = "SUPABASE_SERVICE_ROLE_KEY";

/** Bounds mirrored from the substrate table's CHECK constraints. */
export const DELIVERY_EVIDENCE_MAX = {
  reason: 1_000,
  triggerSource: 120,
  triggeredBy: 160,
} as const;

/** One outbound delivery attempt — the unit of evidence. */
export interface DeliveryEvidenceRecord {
  /** Evidence row id (uuid v4, generated at record time). */
  id: string;
  /** Tenant the attempted communication belongs to (resolved server-side). */
  tenantId: string;
  /** Communication channel the attempt ran on. */
  channel: "email" | "voice";
  /** The adapter that performed the attempt (registry provider id). */
  adapter: string;
  /** Correlation to the originating notification, when one exists. */
  notificationRef: string | null;
  /** Redacted recipient — the full address/number NEVER enters evidence. */
  recipientRedacted: string;
  /** Provider message/call id on a provider-confirmed result; null otherwise. */
  providerMessageId: string | null;
  /** Terminal posture of THIS attempt (a blocked attempt is `undeliverable`). */
  outcome: "delivered" | "failed" | "undeliverable";
  /** The typed failure code, or "delivered" on a receipt. */
  outcomeCode: string;
  /** Bounded human-readable provenance of the attempt (secret-free). */
  reason: string;
  /** Identity of the actor that triggered the attempt. */
  triggeredBy: string;
  /** Where in the system the attempt originated (operation tag). */
  triggerSource: string;
  /** §12 provenance: adapters are not intelligence — pinned false here. */
  aiGenerated: boolean;
  /** ISO-8601 instant issued by the kernel time authority at record time. */
  createdAt: string;
}

/** The PORT adapters depend on (§24): append one evidence row, that is all. */
export type DeliveryEvidenceSink = {
  readonly kind: string;
  record(record: DeliveryEvidenceRecord): Promise<void>;
};

/** Read-only view over the server environment (never a secret carrier). */
export type ServerEnv = Record<string, string | undefined>;

/* ─────────────────────────────────────────────────────────────
 * Recipient redaction (§19 minimization — enforced BEFORE persistence)
 * ────────────────────────────────────────────────────────────*/

/**
 * Mask an email recipient to `f***@domain` (first local-part character
 * only). Unparseable inputs degrade to the fully-opaque sentinel — the
 * redaction law is never skipped for a shape the masking code did not
 * expect.
 */
export function redactEmailRecipient(recipient: string): string {
  const trimmed = recipient.trim();
  const at = trimmed.indexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return "***";
  return `${trimmed.slice(0, 1)}***${trimmed.slice(at)}`;
}

/**
 * Mask a phone recipient to its dialing prefix and last two digits
 * (`+15***67`). Anything too short to mask safely degrades to `***`.
 */
export function redactPhoneRecipient(recipient: string): string {
  const trimmed = recipient.trim();
  if (trimmed.length < 6) return "***";
  return `${trimmed.slice(0, 3)}***${trimmed.slice(-2)}`;
}

/* ─────────────────────────────────────────────────────────────
 * Evidence construction from typed adapter results
 * ────────────────────────────────────────────────────────────*/

function truncateReason(reason: string): string {
  return reason.length > DELIVERY_EVIDENCE_MAX.reason
    ? `${reason.slice(0, DELIVERY_EVIDENCE_MAX.reason - 3)}...`
    : reason;
}

export interface DeliveryEvidenceAttemptFacts {
  tenantId: string;
  channel: "email" | "voice";
  adapter: string;
  notificationRef: string | null;
  recipientRedacted: string;
  triggerSource: string;
  triggeredBy?: string;
}

function deliveredRecord(facts: DeliveryEvidenceAttemptFacts, providerMessageId: string | null): DeliveryEvidenceRecord {
  return {
    id: crypto.randomUUID(),
    tenantId: facts.tenantId,
    channel: facts.channel,
    adapter: facts.adapter,
    notificationRef: facts.notificationRef,
    recipientRedacted: facts.recipientRedacted,
    providerMessageId,
    outcome: "delivered",
    outcomeCode: "delivered",
    reason: "provider-confirmed receipt",
    triggeredBy: facts.triggeredBy ?? "communications-adapter",
    triggerSource: facts.triggerSource,
    aiGenerated: false,
    createdAt: evidenceTimeAuthority.now().at,
  };
}

function failureRecord(
  facts: DeliveryEvidenceAttemptFacts,
  failure: { outcome: "failed" | "undeliverable"; code: string; reason: string },
): DeliveryEvidenceRecord {
  return {
    id: crypto.randomUUID(),
    tenantId: facts.tenantId,
    channel: facts.channel,
    adapter: facts.adapter,
    notificationRef: facts.notificationRef,
    recipientRedacted: facts.recipientRedacted,
    providerMessageId: null,
    outcome: failure.outcome,
    outcomeCode: failure.code,
    reason: truncateReason(failure.reason),
    triggeredBy: facts.triggeredBy ?? "communications-adapter",
    triggerSource: facts.triggerSource,
    aiGenerated: false,
    createdAt: evidenceTimeAuthority.now().at,
  };
}

/** Email result → evidence record (receipt or typed failure). */
export function emailEvidenceRecord(
  command: EmailSendCommand,
  adapterId: string,
  result: EmailDeliveryResult,
): DeliveryEvidenceRecord {
  const facts: DeliveryEvidenceAttemptFacts = {
    tenantId: command.notification.tenantRef,
    channel: "email",
    adapter: adapterId,
    notificationRef: command.notification.id,
    recipientRedacted: redactEmailRecipient(command.recipientAddress),
    triggerSource: `email.send:${adapterId}`,
  };
  return isEmailDeliveryReceipt(result)
    ? deliveredRecord(facts, result.providerMessageId)
    : failureRecord(facts, result);
}

/** Telephony result → evidence record (receipt or typed failure). */
export function telephonyEvidenceRecord(
  command: TelephonyCallCommand,
  adapterId: string,
  result: TelephonyCallResult,
): DeliveryEvidenceRecord {
  const facts: DeliveryEvidenceAttemptFacts = {
    tenantId: command.tenantRef,
    channel: "voice",
    adapter: adapterId,
    notificationRef: command.triggerEvent,
    recipientRedacted: redactPhoneRecipient(command.recipientPhone),
    triggerSource: `telephony.placeCall:${adapterId}`,
  };
  return isTelephonyCallReceipt(result)
    ? deliveredRecord(facts, result.callId)
    : failureRecord(facts, result);
}

/* ─────────────────────────────────────────────────────────────
 * J-045-style composition: evidence wrap (non-fatal, fail-closed)
 * ────────────────────────────────────────────────────────────*/

/**
 * Wrap an `EmailAdapter` so EVERY send records one evidence row — success,
 * structured failure, or typed BLOCKED_NO_CREDENTIAL block. Recording is
 * non-fatal: a sink error never changes the send's typed result; it is
 * reported through the structured log path (§29) as `evidence_write_failed`.
 * When no sink is configured (substrate absent), the adapter is returned
 * unchanged — the send result stays exactly as typed.
 */
export function withEmailDeliveryEvidence(adapter: EmailAdapter, sink: DeliveryEvidenceSink | null): EmailAdapter {
  if (sink === null) return adapter;
  return {
    providerId: adapter.providerId,
    async send(command: EmailSendCommand, registry) {
      const result = await adapter.send(command, registry);
      try {
        await sink.record(emailEvidenceRecord(command, adapter.providerId, result));
      } catch (err) {
        logStructured({
          level: "warn",
          msg: "evidence_write_failed: delivery attempt completed but its evidence row could not be recorded",
          component: DELIVERY_EVIDENCE_COMPONENT,
          tenant_id: command.notification.tenantRef,
          err,
          notification_ref: command.notification.id,
          evidence_outcome: "providerMessageId" in result && !("outcome" in result) ? "delivered" : "not_delivered",
        });
      }
      return result;
    },
  };
}

/**
 * Telephony twin of `withEmailDeliveryEvidence`: every placeCall — receipt,
 * structured failure, or typed BLOCKED_NO_CREDENTIAL — records one evidence
 * row through the sink, non-fatally. A null sink returns the adapter
 * unchanged.
 */
export function withTelephonyDeliveryEvidence(
  adapter: TelephonyAdapter,
  sink: DeliveryEvidenceSink | null,
): TelephonyAdapter {
  if (sink === null) return adapter;
  return {
    providerId: adapter.providerId,
    async placeCall(command: TelephonyCallCommand, registry) {
      const result = await adapter.placeCall(command, registry);
      try {
        await sink.record(telephonyEvidenceRecord(command, adapter.providerId, result));
      } catch (err) {
        logStructured({
          level: "warn",
          msg: "evidence_write_failed: call attempt completed but its evidence row could not be recorded",
          component: DELIVERY_EVIDENCE_COMPONENT,
          tenant_id: command.tenantRef,
          err,
          notification_ref: command.triggerEvent,
          evidence_outcome: "callId" in result && !("outcome" in result) ? "delivered" : "not_delivered",
        });
      }
      return result;
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Concrete sink: PostgREST append via service-role credentials (§25)
 * ────────────────────────────────────────────────────────────*/

/** The evidence row exactly as the substrate table's columns expect. */
export type DeliveryEvidenceRow = ReturnType<typeof toDeliveryEvidenceRow>;

/** Map a record to the snake_case substrate row (no field added, none dropped). */
export function toDeliveryEvidenceRow(record: DeliveryEvidenceRecord): Record<string, unknown> {
  return {
    id: record.id,
    tenant_id: record.tenantId,
    channel: record.channel,
    adapter: record.adapter,
    notification_ref: record.notificationRef,
    recipient_redacted: record.recipientRedacted,
    provider_message_id: record.providerMessageId,
    outcome: record.outcome,
    outcome_code: record.outcomeCode,
    reason: record.reason,
    triggered_by: record.triggeredBy,
    trigger_source: record.triggerSource,
    ai_generated: record.aiGenerated,
    created_at: record.createdAt,
  };
}

export interface PostgrestDeliveryEvidenceConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
}

/**
 * Environment-derived sink configuration. Returns null when the substrate
 * credentials are absent — the caller's fail-closed signal that evidence
 * recording is UNAVAILABLE (attempts still surface their typed results; the
 * missing substrate is visible in structured logs at composition time).
 */
export function deliveryEvidenceConfigFromEnv(env: ServerEnv): PostgrestDeliveryEvidenceConfig | null {
  const supabaseUrl = env[SUPABASE_URL_ENV];
  const serviceRoleKey = env[SUPABASE_SERVICE_ROLE_KEY_ENV];
  if (!supabaseUrl || supabaseUrl.trim().length === 0) return null;
  if (!serviceRoleKey || serviceRoleKey.trim().length === 0) return null;
  return { supabaseUrl: supabaseUrl.trim(), serviceRoleKey };
}

/**
 * Build the concrete sink: ONE bounded fetch appending the row through
 * PostgREST under service-role credentials (the only writer posture of the
 * zero-policy substrate). The key value is carried in memory only and is
 * never logged. No vendor SDK import — the substrate is reached the same
 * adapter way the providers are (§25).
 */
export function createPostgrestDeliveryEvidenceSink(config: PostgrestDeliveryEvidenceConfig): DeliveryEvidenceSink {
  return {
    kind: "postgrest",
    async record(record: DeliveryEvidenceRecord): Promise<void> {
      const response = await fetch(
        `${config.supabaseUrl}/rest/v1/${DELIVERY_EVIDENCE_TABLE}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.serviceRoleKey}`,
            apikey: config.serviceRoleKey,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify(toDeliveryEvidenceRow(record)),
        },
      );
      if (!response.ok) {
        // The response body is untrusted and may echo tenant data; report
        // only the status. Secret values never enter this message (§30).
        throw new Error(
          `delivery-evidence append rejected by the substrate (http ${response.status})`,
        );
      }
    },
  };
}

/** Compose the env-backed sink, or null when the substrate is not configured. */
export function deliveryEvidenceSinkFromEnv(env: ServerEnv): DeliveryEvidenceSink | null {
  const config = deliveryEvidenceConfigFromEnv(env);
  return config === null ? null : createPostgrestDeliveryEvidenceSink(config);
}
