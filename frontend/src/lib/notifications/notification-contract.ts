/**
 * CoreGrid — Notification contract (V5.3 Part 20, in-app/email/SMS/voice work package).
 *
 * Pure module: no I/O, no provider imports, no secrets. It defines the shape of a
 * notification, its fail-closed state machine, the channel/category policy, and the
 * tenant/recipient authorization checks every dispatch path must pass through.
 *
 * Boundaries:
 * - Phase 10 (`communication-core.ts`) owns message/delivery authority; this module
 *   is the typed vocabulary Part 20 dispatch flows share. It does not send anything.
 * - Delivery truth lives in provider result records: `delivered` is NEVER asserted,
 *   it is only reachable through `markDelivered` with a matching provider receipt.
 * - Undelivered is an explicit state (`undeliverable`), never pretended success.
 * - Tenant isolation: every notification carries a `tenantRef`; cross-tenant access
 *   is denied here and must be re-enforced by RLS/server functions (Constitution §17).
 */

/* ─────────────────────────────────────────────────────────────
 * Vocabulary
 * ────────────────────────────────────────────────────────────*/

export type NotificationAudienceKind = "user" | "role" | "org_unit";

export const NOTIFICATION_AUDIENCE_KINDS: readonly NotificationAudienceKind[] = [
  "user",
  "role",
  "org_unit",
] as const;

export type NotificationCategory =
  | "escalation"
  | "approval_request"
  | "mission_result"
  | "system"
  | "general";

export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  "escalation",
  "approval_request",
  "mission_result",
  "system",
  "general",
] as const;

export type NotificationChannel = "in_app" | "email" | "sms" | "web_push";

export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = [
  "in_app",
  "email",
  "sms",
  "web_push",
] as const;

export type NotificationState = "draft" | "queued" | "delivered" | "failed" | "undeliverable";

export const NOTIFICATION_STATES: readonly NotificationState[] = [
  "draft",
  "queued",
  "delivered",
  "failed",
  "undeliverable",
] as const;

/* ─────────────────────────────────────────────────────────────
 * Notification record
 * ────────────────────────────────────────────────────────────*/

export interface Notification {
  id: string;
  /** Tenant the notification belongs to — resolved server-side, never client-asserted. */
  tenantRef: string;
  /**
   * Target reference; meaning is determined by `audienceKind` (user id, role id,
   * or org-unit id). Never a raw credential or contact secret.
   */
  recipientRef: string;
  audienceKind: NotificationAudienceKind;
  category: NotificationCategory;
  subject: string;
  body: string;
  /** Optional reference to the action this notification links to (route, record id). */
  actionRef: string | null;
  state: NotificationState;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
}

/* ─────────────────────────────────────────────────────────────
 * Fail-closed state machine: draft → queued → delivered | failed | undeliverable
 * ────────────────────────────────────────────────────────────*/

const STATE_TRANSITIONS: Readonly<Record<NotificationState, readonly NotificationState[]>> = {
  draft: ["queued"],
  queued: ["delivered", "failed", "undeliverable"],
  delivered: [],
  failed: [],
  undeliverable: [],
};

export function isNotificationState(value: string): value is NotificationState {
  return (NOTIFICATION_STATES as readonly string[]).includes(value);
}

export function isNotificationTransitionAllowed(
  from: NotificationState,
  to: NotificationState,
): boolean {
  return STATE_TRANSITIONS[from].includes(to);
}

export type NotificationTransitionResult =
  | { ok: true; notification: Notification }
  | { ok: false; reason: string };

/** Apply a state transition fail-closed: unknown or disallowed transitions are rejected. */
export function transitionNotification(
  notification: Notification,
  to: NotificationState,
): NotificationTransitionResult {
  if (!isNotificationState(to)) {
    return { ok: false, reason: `Unknown notification state "${to}"` };
  }
  if (!isNotificationTransitionAllowed(notification.state, to)) {
    return {
      ok: false,
      reason: `Transition ${notification.state} → ${to} is not permitted (fail closed)`,
    };
  }
  return { ok: true, notification: { ...notification, state: to } };
}

/* ─────────────────────────────────────────────────────────────
 * Delivery receipts — the only path to `delivered`
 * ────────────────────────────────────────────────────────────*/

/**
 * Provider-agnostic proof that a provider accepted/confirmed a send. Produced by
 * an adapter from a real provider result; never fabricated by dispatch code.
 */
export interface DeliveryReceipt {
  notificationId: string;
  channel: NotificationChannel;
  providerId: string;
  providerMessageId: string;
  /** ISO-8601 timestamp taken from the provider result record. */
  confirmedAt: string;
}

export function isNotificationChannel(value: string): value is NotificationChannel {
  return (NOTIFICATION_CHANNELS as readonly string[]).includes(value);
}

export function isDeliveryReceipt(value: unknown): value is DeliveryReceipt {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.notificationId === "string" &&
    candidate.notificationId.length > 0 &&
    typeof candidate.channel === "string" &&
    isNotificationChannel(candidate.channel) &&
    typeof candidate.providerId === "string" &&
    candidate.providerId.length > 0 &&
    typeof candidate.providerMessageId === "string" &&
    candidate.providerMessageId.length > 0 &&
    typeof candidate.confirmedAt === "string" &&
    candidate.confirmedAt.length > 0
  );
}

/**
 * Move a queued notification to `delivered`. Only a provider receipt for THIS
 * notification can do it — "delivered" without a receipt is not representable.
 */
export function markDelivered(
  notification: Notification,
  receipt: DeliveryReceipt,
): NotificationTransitionResult {
  if (!isDeliveryReceipt(receipt)) {
    return { ok: false, reason: "A valid provider delivery receipt is required to mark delivered" };
  }
  if (receipt.notificationId !== notification.id) {
    return {
      ok: false,
      reason: `Delivery receipt references notification ${receipt.notificationId}, not ${notification.id}`,
    };
  }
  return transitionNotification(notification, "delivered");
}

/* ─────────────────────────────────────────────────────────────
 * Per-channel category policy — restricted categories fail closed to in_app
 * ────────────────────────────────────────────────────────────*/

/**
 * Categories whose content is sensitive (approvals, escalations) may only be
 * delivered on the platform's own in-app channel, where authorization and
 * tenancy are already enforced.
 */
export const RESTRICTED_CATEGORIES: readonly NotificationCategory[] = [
  "escalation",
  "approval_request",
] as const;

export const CHANNEL_CATEGORY_POLICY: Readonly<
  Record<NotificationChannel, readonly NotificationCategory[]>
> = {
  in_app: [...NOTIFICATION_CATEGORIES],
  email: ["mission_result", "system", "general"],
  sms: ["mission_result", "general"],
  web_push: ["mission_result", "system", "general"],
};

export function isCategoryAllowedOnChannel(
  category: NotificationCategory,
  channel: NotificationChannel,
): boolean {
  return CHANNEL_CATEGORY_POLICY[channel].includes(category);
}

export function allowedChannelsForCategory(category: NotificationCategory): NotificationChannel[] {
  return NOTIFICATION_CHANNELS.filter((channel) => isCategoryAllowedOnChannel(category, channel));
}

/* ─────────────────────────────────────────────────────────────
 * Tenant / recipient authorization (defense in depth, §15–§17)
 * ────────────────────────────────────────────────────────────*/

export interface NotificationViewer {
  tenantRef: string;
  recipientRef: string;
}

export type NotificationAccessDecision =
  | { decision: "allow" }
  | { decision: "deny"; code: "cross_tenant" | "recipient_mismatch"; reason: string };

/**
 * Can this viewer read this notification? Tenant must always match; for a
 * user-addressed notification the recipient must match too. RLS and server
 * functions remain the enforcement boundary — this is a shared check, not the gate.
 */
export function evaluateNotificationAccess(
  notification: Notification,
  viewer: NotificationViewer,
): NotificationAccessDecision {
  if (notification.tenantRef !== viewer.tenantRef) {
    return {
      decision: "deny",
      code: "cross_tenant",
      reason: "Notification belongs to a different tenant",
    };
  }
  if (notification.audienceKind === "user" && notification.recipientRef !== viewer.recipientRef) {
    return {
      decision: "deny",
      code: "recipient_mismatch",
      reason: "User-addressed notification belongs to a different recipient",
    };
  }
  return { decision: "allow" };
}
