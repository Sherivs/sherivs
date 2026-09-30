/**
 * CoreGrid — Communication Platform channel routing, delivery
 * reliability, and mass-communication protection (Phase 10).
 *
 * Implements `architecture/phase-10-communication-platform.md`:
 * - Channel abstraction and routing (A.2, B.2): the platform abstracts
 *   communication channels away from individual business domains.
 * - Reliability (BR): queues, retries, dead-letter handling, provider
 *   failover, idempotency, durable state, delivery reconciliation.
 * - Delivery tracking (A.7): delivery attempts, delivery status, receipts.
 * - Mass Communication Protection (BO): mass sending requires explicit
 *   permission, audience validation, preview, estimated recipient count,
 *   channel validation, confirmation, audit record. Critical mass
 *   communication may require human approval.
 * - Abuse prevention (BN): recipient limits, mass-send protection.
 * - External recipients (DP) are treated separately from internal
 *   recipients.
 *
 * Boundaries:
 * - D.5 Phase 08 owns authorization; this module only produces routing and
 *   protection decisions for the caller to enforce.
 * - BR reliability primitives (queues, dead-letter) are Phase 05
 *   runtime concerns (runtime-resilience.ts); this module defines the
 *   communication-domain delivery state on top of them.
 */

import type { TenantId } from "./tenant-core";
import type { CommunicationChannelType, CommunicationPriority } from "./communication-core";

/* ─────────────────────────────────────────────────────────────
 * Channel routing
 * ────────────────────────────────────────────────────────────*/

export interface ChannelConfig {
  channel: CommunicationChannelType;
  enabled: boolean;
  provider: string | null;
  priorityOrder: number;
}

export interface RoutingDecision {
  channel: CommunicationChannelType;
  provider: string | null;
  reason: string;
}

export type RoutingResult =
  { ok: true; decisions: RoutingDecision[] } | { ok: false; error: string };

/**
 * Route a message to its ordered channel plan. Channels that are disabled or
 * lack a provider are skipped; the decision list preserves priority order.
 * At least one usable channel is required — never a silent "no channel".
 */
export function routeChannels(
  requested: CommunicationChannelType[],
  configs: ChannelConfig[],
): RoutingResult {
  if (requested.length === 0) {
    return { ok: false, error: "At least one requested channel is required" };
  }
  const decisions: RoutingDecision[] = [];
  for (const channel of requested) {
    const config = configs.find((c) => c.channel === channel);
    if (!config) {
      decisions.push({ channel, provider: null, reason: "No channel configuration" });
      continue;
    }
    if (!config.enabled) {
      decisions.push({ channel, provider: null, reason: "Channel disabled" });
      continue;
    }
    decisions.push({
      channel,
      provider: config.provider,
      reason: `Routed to ${config.provider ?? "default provider"}`,
    });
  }
  const usable = decisions.filter((d) => d.provider !== null);
  if (usable.length === 0) {
    return { ok: false, error: "No usable channel/provider is available for this message" };
  }
  return {
    ok: true,
    decisions: [...decisions].sort((a, b) => {
      const orderA = configs.find((c) => c.channel === a.channel)?.priorityOrder ?? 99;
      const orderB = configs.find((c) => c.channel === b.channel)?.priorityOrder ?? 99;
      return orderA - orderB;
    }),
  };
}

/* ─────────────────────────────────────────────────────────────
 * Delivery attempts & failover (BR)
 * ────────────────────────────────────────────────────────────*/

export interface DeliveryAttempt {
  messageId: string;
  channel: CommunicationChannelType;
  provider: string;
  attempt: number;
  status: "pending" | "succeeded" | "failed";
  attemptedAt: string;
  providerRequestId: string | null;
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
}

export interface RetryDecision {
  shouldRetry: boolean;
  nextAttempt: number;
  reason: string;
}

/**
 * Delivery retry with bounded attempts (BR): failures retry up to
 * maxAttempts; retries must never loop indefinitely.
 */
export function decideRetry(
  attemptNumber: number,
  status: "succeeded" | "failed",
  policy: RetryPolicy,
): RetryDecision {
  if (status === "succeeded") {
    return { shouldRetry: false, nextAttempt: attemptNumber, reason: "Delivery succeeded" };
  }
  if (attemptNumber >= policy.maxAttempts) {
    return {
      shouldRetry: false,
      nextAttempt: attemptNumber,
      reason: "Max attempts reached; dead-letter",
    };
  }
  return {
    shouldRetry: true,
    nextAttempt: attemptNumber + 1,
    reason: `Retry in ${policy.baseDelayMs * Math.pow(2, attemptNumber - 1)}ms (exponential backoff)`,
  };
}

/**
 * Provider failover (BR): if the primary provider fails, route to the next
 * configured provider for the same channel.
 */
export function failoverProvider(
  failedProvider: string,
  availableProviders: string[],
): { provider: string | null; reason: string } {
  const next = availableProviders.find((p) => p !== failedProvider);
  if (!next) {
    return { provider: null, reason: "No failover provider is available" };
  }
  return { provider: next, reason: `Failed over from ${failedProvider}` };
}

/* ─────────────────────────────────────────────────────────────
 * Mass communication protection (BO, BN, DP)
 * ────────────────────────────────────────────────────────────*/

export type RecipientKind = "internal" | "external";

export interface MassCommunicationRequest {
  tenantId: TenantId;
  audienceSize: number;
  channels: CommunicationChannelType[];
  priority: CommunicationPriority;
  /** Explicit count of external recipients (DP): external recipients are
   * treated separately from internal recipients. */
  externalRecipientCount: number;
  hasExplicitPermission: boolean;
  hasPreview: boolean;
  hasConfirmation: boolean;
  maxRecipients: number;
  maxExternalRecipients: number;
}

export type MassCommunicationVerdict =
  | { verdict: "approved"; reason: string; requiresHumanApproval: boolean }
  | { verdict: "blocked"; reason: string };

/**
 * Mass Communication Protection (BO): mass sending requires explicit
 * permission, audience validation, preview, estimated recipient count,
 * channel validation, confirmation, and an audit record. Critical mass
 * communication may require human approval.
 */
export function evaluateMassCommunication(
  request: MassCommunicationRequest,
): MassCommunicationVerdict {
  if (!request.hasExplicitPermission) {
    return { verdict: "blocked", reason: "Mass communication requires explicit permission (BO)" };
  }
  if (!request.hasPreview || !request.hasConfirmation) {
    return {
      verdict: "blocked",
      reason: "Mass communication requires preview and confirmation (BO)",
    };
  }
  if (request.audienceSize > request.maxRecipients) {
    return {
      verdict: "blocked",
      reason: `Audience (${request.audienceSize}) exceeds max recipients (${request.maxRecipients}) (BN)`,
    };
  }
  if (request.externalRecipientCount < 0 || request.externalRecipientCount > request.audienceSize) {
    return { verdict: "blocked", reason: "External recipient count is invalid (DP)" };
  }
  const externalCount = request.externalRecipientCount;
  if (externalCount > request.maxExternalRecipients) {
    return {
      verdict: "blocked",
      reason: `External recipients (${externalCount}) exceed the allowed limit (${request.maxExternalRecipients}) (DP)`,
    };
  }
  if (request.audienceSize === 0) {
    return { verdict: "blocked", reason: "Mass communication requires a non-empty audience" };
  }
  const requiresHumanApproval =
    request.priority === "URGENT" ||
    request.priority === "CRITICAL" ||
    request.audienceSize >= request.maxRecipients * 0.8 ||
    externalCount > 0;
  return {
    verdict: "approved",
    reason: requiresHumanApproval
      ? "Approved pending human approval (critical mass communication, BO)"
      : "Mass communication approved",
    requiresHumanApproval,
  };
}
