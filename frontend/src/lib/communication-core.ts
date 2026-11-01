/**
 * Sherivs — Communication Platform core (Phase 10).
 *
 * Implements `architecture/phase-10-communication-platform.md`:
 * - Message contract (F.1): message ID, tenant ID, sender, recipients,
 *   channel, subject, content, template reference, priority, classification,
 *   correlation ID, idempotency key, timestamp, expiration, metadata.
 * - Notification contract (F.2): notification ID, recipient, event source,
 *   category, priority, message, channels, preferences, delivery state,
 *   acknowledgement requirement.
 * - Priority (Y): LOW, NORMAL, HIGH, URGENT, CRITICAL. Priority must not
 *   bypass security controls.
 * - Idempotency (X): communication operations must be idempotent to prevent
 *   duplicate delivery from retries, network failures, worker restarts,
 *   provider timeouts, duplicate events.
 * - Data classification (DM): PUBLIC, INTERNAL, CONFIDENTIAL, RESTRICTED,
 *   HIGHLY_RESTRICTED.
 * - Tenant isolation (DN): every tenant-scoped communication carries a
 *   tenant ID and preserves participant/recipient boundaries.
 *
 * Boundaries:
 * - D.1 Phase 02 owns identity; this module consumes identity references.
 * - D.2 Phase 03 owns tenancy; this module enforces tenant-aware boundaries.
 * - D.5 Phase 08 owns authorization/enforcement; this module does not make
 *   security decisions.
 * - D.7 Phase 11 owns academic meaning; this module owns delivery only.
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Communication priorities (Y)
 * ────────────────────────────────────────────────────────────*/

export type CommunicationPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT" | "CRITICAL";

export const COMMUNICATION_PRIORITIES: readonly CommunicationPriority[] = [
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT",
  "CRITICAL",
] as const;

/** Priority must never bypass security controls (Y): ordering exists only
 * for routing/scheduling decisions. */
export function priorityRank(priority: CommunicationPriority): number {
  switch (priority) {
    case "LOW":
      return 0;
    case "NORMAL":
      return 1;
    case "HIGH":
      return 2;
    case "URGENT":
      return 3;
    case "CRITICAL":
      return 4;
  }
}

export type CommunicationChannelType =
  "in_app" | "email" | "sms" | "whatsapp" | "push" | "voice" | "external";

export const COMMUNICATION_CHANNEL_TYPES: readonly CommunicationChannelType[] = [
  "in_app",
  "email",
  "sms",
  "whatsapp",
  "push",
  "voice",
  "external",
] as const;

/* ─────────────────────────────────────────────────────────────
 * Message contract (F.1)
 * ────────────────────────────────────────────────────────────*/

export type MessageClassification =
  "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED" | "HIGHLY_RESTRICTED";

export const MESSAGE_CLASSIFICATIONS: readonly MessageClassification[] = [
  "PUBLIC",
  "INTERNAL",
  "CONFIDENTIAL",
  "RESTRICTED",
  "HIGHLY_RESTRICTED",
] as const;

export interface CommunicationMessage {
  id: string;
  /** Existing tenant binding; V1 organizations use the same tenant ID. */
  tenantId: TenantId;
  orgId: TenantId;
  sender: string;
  recipientUserIds: string[];
  channel: CommunicationChannelType;
  subject: string;
  content: string;
  templateRef: string | null;
  priority: CommunicationPriority;
  classification: MessageClassification;
  correlationId: string;
  idempotencyKey: string;
  createdAt: string;
  expiresAt: string | null;
  metadata: Record<string, string | number | boolean | null>;
}

export interface CreateMessageInput {
  tenantId: TenantId;
  orgId: TenantId;
  sender: string;
  recipientUserIds: string[];
  channel: CommunicationChannelType;
  subject: string;
  content: string;
  templateRef?: string | null;
  priority?: CommunicationPriority;
  classification?: MessageClassification;
  correlationId: string;
  idempotencyKey: string;
  now: string;
  expiresAt?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}

export type CreateMessageResult =
  { ok: true; message: CommunicationMessage } | { ok: false; error: string };

export function createMessage(input: CreateMessageInput): CreateMessageResult {
  if (input.tenantId.trim() === "" || input.orgId.trim() === "" || input.orgId !== input.tenantId) {
    return { ok: false, error: "Message organization must match its tenant (DN)" };
  }
  if (input.sender.trim() === "") {
    return { ok: false, error: "Message sender is required (F.1)" };
  }
  if (
    input.recipientUserIds.length === 0 ||
    input.recipientUserIds.some((id) => id.trim() === "")
  ) {
    return { ok: false, error: "Message requires at least one recipient (F.1)" };
  }
  if (input.subject.trim() === "" && input.content.trim() === "") {
    return { ok: false, error: "Message requires a subject or content (F.1)" };
  }
  if (input.correlationId.trim() === "") {
    return { ok: false, error: "Correlation ID is required (CB)" };
  }
  if (input.idempotencyKey.trim() === "") {
    return { ok: false, error: "Idempotency key is required (X)" };
  }
  return {
    ok: true,
    message: {
      id: `msg-${input.idempotencyKey}-${input.now}`,
      tenantId: input.tenantId,
      orgId: input.orgId,
      sender: input.sender,
      recipientUserIds: input.recipientUserIds,
      channel: input.channel,
      subject: input.subject,
      content: input.content,
      templateRef: input.templateRef ?? null,
      priority: input.priority ?? "NORMAL",
      classification: input.classification ?? "INTERNAL",
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      createdAt: input.now,
      expiresAt: input.expiresAt ?? null,
      metadata: input.metadata ?? {},
    },
  };
}

/** Messages must not cross tenant boundaries implicitly (DN). */
export function isMessageTenantConsistent(
  message: CommunicationMessage,
  tenantId: TenantId,
): boolean {
  return message.orgId === tenantId && message.tenantId === tenantId;
}

/** Expired messages must not be delivered (message expiration in F.1). */
export function isMessageExpired(message: CommunicationMessage, now: string): boolean {
  return message.expiresAt !== null && Date.parse(now) >= Date.parse(message.expiresAt);
}

/* ─────────────────────────────────────────────────────────────
 * Notification contract (F.2)
 * ────────────────────────────────────────────────────────────*/

export type NotificationDeliveryState =
  "pending" | "queued" | "delivered" | "failed" | "suppressed" | "acknowledged";

export const NOTIFICATION_DELIVERY_STATES: readonly NotificationDeliveryState[] = [
  "pending",
  "queued",
  "delivered",
  "failed",
  "suppressed",
  "acknowledged",
] as const;

export interface Notification {
  id: string;
  recipient: string;
  eventSource: string;
  category: string;
  priority: CommunicationPriority;
  message: string;
  channels: CommunicationChannelType[];
  deliveryState: NotificationDeliveryState;
  requiresAcknowledgement: boolean;
  acknowledgedAt: string | null;
  createdAt: string;
}

export interface CreateNotificationInput {
  recipient: string;
  eventSource: string;
  category: string;
  priority?: CommunicationPriority;
  message: string;
  channels: CommunicationChannelType[];
  requiresAcknowledgement?: boolean;
  now: string;
}

export type CreateNotificationResult =
  { ok: true; notification: Notification } | { ok: false; error: string };

export function createNotification(input: CreateNotificationInput): CreateNotificationResult {
  if (input.recipient.trim() === "") {
    return { ok: false, error: "Notification recipient is required (F.2)" };
  }
  if (input.eventSource.trim() === "") {
    return { ok: false, error: "Notification event source is required (F.2)" };
  }
  if (input.channels.length === 0) {
    return { ok: false, error: "Notification requires at least one channel (F.2)" };
  }
  return {
    ok: true,
    notification: {
      id: `notif-${input.eventSource}-${input.recipient}-${input.now}`,
      recipient: input.recipient,
      eventSource: input.eventSource,
      category: input.category,
      priority: input.priority ?? "NORMAL",
      message: input.message,
      channels: input.channels,
      deliveryState: "pending",
      requiresAcknowledgement: input.requiresAcknowledgement ?? false,
      acknowledgedAt: null,
      createdAt: input.now,
    },
  };
}

const NOTIFICATION_TRANSITIONS: Readonly<
  Record<NotificationDeliveryState, readonly NotificationDeliveryState[]>
> = {
  pending: ["queued", "suppressed", "failed"],
  queued: ["delivered", "failed", "suppressed"],
  delivered: ["acknowledged"],
  failed: ["queued"],
  suppressed: [],
  acknowledged: [],
};

export function transitionNotification(
  notification: Notification,
  to: NotificationDeliveryState,
  now: string,
): { ok: true; notification: Notification } | { ok: false; error: string } {
  if (!NOTIFICATION_TRANSITIONS[notification.deliveryState].includes(to)) {
    return {
      ok: false,
      error: `Notification transition ${notification.deliveryState} -> ${to} is not allowed`,
    };
  }
  return {
    ok: true,
    notification: {
      ...notification,
      deliveryState: to,
      acknowledgedAt: to === "acknowledged" ? now : notification.acknowledgedAt,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Idempotency (X)
 * ────────────────────────────────────────────────────────────*/

export interface IdempotencyRecord {
  key: string;
  result: "created" | "duplicate";
  firstSeenAt: string;
}

/**
 * Idempotency guard: the same idempotency key must never produce a second
 * send (Section X). Returns the record with "duplicate" for replays so the
 * caller can short-circuit before provider dispatch.
 */
export function checkIdempotency(
  key: string,
  seen: Map<string, IdempotencyRecord>,
  now: string,
): { record: IdempotencyRecord; proceed: boolean } {
  const existing = seen.get(key);
  if (existing) {
    // Surface the replay as a duplicate so callers can short-circuit before
    // provider dispatch (Section X). The first-seen timestamp is preserved.
    const duplicate: IdempotencyRecord = { ...existing, result: "duplicate" };
    seen.set(key, duplicate);
    return { record: duplicate, proceed: false };
  }
  const record: IdempotencyRecord = { key, result: "created", firstSeenAt: now };
  seen.set(key, record);
  return { record, proceed: true };
}
