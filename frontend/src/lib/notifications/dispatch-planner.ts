/**
 * CoreGrid — Notification dispatch planner (V5.3 Part 20).
 *
 * Pure module: given a notification and a channel-availability config (booleans
 * only — provider keys stay server-side and never reach this layer), it decides
 * which channels the notification may be dispatched on.
 *
 * Invariants:
 * - Every channel that is NOT selected appears in `omissions` with an explicit
 *   reason. Omissions are never silent.
 * - Restricted categories (escalation, approval_request) fail closed to in_app
 *   only, per `CHANNEL_CATEGORY_POLICY`.
 * - When no channel is selectable the plan is an explicit `fail_closed` decision,
 *   never an empty successful dispatch.
 * - The planner performs no I/O and asserts no delivery. Delivery truth remains
 *   with provider result records (see `notification-contract.ts`).
 */

import {
  NOTIFICATION_CHANNELS,
  isCategoryAllowedOnChannel,
  type Notification,
  type NotificationChannel,
} from "./notification-contract";

/** Which channel adapters the runtime reports as configured. Booleans only —
 * the planner never sees provider identities, keys or credentials. */
export interface ChannelAvailability {
  in_app: boolean;
  email: boolean;
  sms: boolean;
  web_push: boolean;
}

/** Audience-kind routing constraints: org-unit and role audiences resolve to
 * shared in-app surfaces; direct channels require a resolvable user recipient. */
export type AudienceChannelPolicy = Readonly<
  Record<Notification["audienceKind"], readonly NotificationChannel[]>
>;

export const AUDIENCE_CHANNEL_POLICY: AudienceChannelPolicy = {
  user: ["in_app", "email", "sms", "web_push"],
  role: ["in_app", "email"],
  org_unit: ["in_app"],
};

export type ChannelOmissionReason =
  | "channel_not_configured"
  | "category_not_permitted"
  | "audience_not_supported";

export interface ChannelOmission {
  channel: NotificationChannel;
  reason: ChannelOmissionReason;
}

export type DispatchPlan =
  | {
      decision: "dispatch";
      notificationId: string;
      tenantRef: string;
      category: Notification["category"];
      selectedChannels: NotificationChannel[];
      omissions: ChannelOmission[];
    }
  | {
      decision: "fail_closed";
      notificationId: string;
      tenantRef: string;
      category: Notification["category"];
      reason: string;
      omissions: ChannelOmission[];
    };

/** Is this channel available for this audience kind? */
function isChannelAllowedForAudience(
  audienceKind: Notification["audienceKind"],
  channel: NotificationChannel,
): boolean {
  return AUDIENCE_CHANNEL_POLICY[audienceKind].includes(channel);
}

/**
 * Plan the dispatch of one notification. Fail-closed: if no channel survives
 * policy + audience + availability, the result is `fail_closed` with the full
 * omission ledger attached.
 */
export function planNotificationDispatch(
  notification: Notification,
  availability: ChannelAvailability,
): DispatchPlan {
  const selectedChannels: NotificationChannel[] = [];
  const omissions: ChannelOmission[] = [];

  for (const channel of NOTIFICATION_CHANNELS) {
    if (!availability[channel]) {
      omissions.push({ channel, reason: "channel_not_configured" });
      continue;
    }
    if (!isCategoryAllowedOnChannel(notification.category, channel)) {
      omissions.push({ channel, reason: "category_not_permitted" });
      continue;
    }
    if (!isChannelAllowedForAudience(notification.audienceKind, channel)) {
      omissions.push({ channel, reason: "audience_not_supported" });
      continue;
    }
    selectedChannels.push(channel);
  }

  if (selectedChannels.length === 0) {
    return {
      decision: "fail_closed",
      notificationId: notification.id,
      tenantRef: notification.tenantRef,
      category: notification.category,
      reason:
        "No dispatch channel is both configured and permitted for this notification; failing closed rather than dispatching unpoliced",
      omissions,
    };
  }

  return {
    decision: "dispatch",
    notificationId: notification.id,
    tenantRef: notification.tenantRef,
    category: notification.category,
    selectedChannels,
    omissions,
  };
}
