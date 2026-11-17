/**
 * Owner alert delivery through the JARVIS channel gates (ENGINE-09, ADR-087; amended 2026-11-16).
 *
 * ENGINE-04 decides WHAT to tell the owner and on which channels by severity (content,
 * safe console link, dedupe, rate limit). This module decides WHETHER each external
 * channel may be used, and adds no send capability of its own: it only returns a plan.
 *
 * Rules:
 *  - the console is always deliverable (in-app);
 *  - WhatsApp, voice, SMS and email each need per-channel owner enablement; in live mode
 *    each also needs an unexpired authorization that names that channel and carries an
 *    approver. Missing either means the channel is skipped with a reason, never sent;
 *  - SMS and email were activated by the owner's recorded instruction of 2026-11-16 and
 *    follow exactly the same gate as WhatsApp and voice (this replaces the earlier rule
 *    that SMS was never deliverable);
 *  - in test mode every external channel goes to a synthetic sink, never a contact;
 *  - an S1 alert still breaks quiet hours (ENGINE-04); approvals follow the ladder's
 *    quiet-hours rules instead, because they can wait.
 */
import {
  planOwnerAlert,
  type AlertChannel,
  type AlertInput,
} from "../jarvis-executive/owner-alert";

export type OwnerExternalChannel = Exclude<AlertChannel, "console">;

export interface OwnerAlertConfig {
  readonly mode: "test" | "live";
  /** A channel that is absent counts as disabled. */
  readonly ownerEnabled: Readonly<Partial<Record<OwnerExternalChannel, boolean>>>;
}

export interface OwnerLiveAuthorization {
  readonly approvalRef: string;
  readonly approvedBy: string;
  readonly channels: readonly OwnerExternalChannel[];
  readonly expiresAt: string;
}

export type SkipCode = "channel_not_enabled" | "external_send_not_authorized";

export interface DeliveryItem {
  readonly channel: AlertChannel;
  readonly destination:
    | { readonly kind: "in_app" }
    | { readonly kind: "test_sink"; readonly sink: string }
    | { readonly kind: "registered_contact" };
  readonly idempotencyKey: string;
}

export type DeliveryPlan =
  | {
      readonly send: true;
      readonly body: string;
      readonly link: string;
      readonly deliveries: readonly DeliveryItem[];
      readonly skipped: ReadonlyArray<{ readonly channel: AlertChannel; readonly code: SkipCode }>;
    }
  | {
      readonly send: false;
      readonly reason: "quiet_hours" | "deduped" | "rate_limited" | "unsafe_link";
    };

function authorized(
  channel: OwnerExternalChannel,
  auth: OwnerLiveAuthorization | undefined,
  nowMs: number,
): boolean {
  return (
    auth !== undefined &&
    typeof auth.approvalRef === "string" &&
    auth.approvalRef.trim().length > 0 &&
    typeof auth.approvedBy === "string" &&
    auth.approvedBy.trim().length > 0 &&
    auth.channels.includes(channel) &&
    Date.parse(auth.expiresAt) > nowMs
  );
}

export function planAlertDelivery(
  input: AlertInput & { readonly alertId: string },
  config: OwnerAlertConfig,
  liveOutbound?: OwnerLiveAuthorization,
): DeliveryPlan {
  const plan = planOwnerAlert(input);
  if (!plan.send) return plan;

  const deliveries: DeliveryItem[] = [];
  const skipped: Array<{ channel: AlertChannel; code: SkipCode }> = [];
  for (const channel of plan.channels) {
    const idempotencyKey = `${input.alertId}:${channel}`;
    if (channel === "console") {
      deliveries.push({ channel, destination: { kind: "in_app" }, idempotencyKey });
      continue;
    }
    if (config.ownerEnabled[channel] !== true) {
      skipped.push({ channel, code: "channel_not_enabled" });
      continue;
    }
    if (config.mode === "live" && !authorized(channel, liveOutbound, input.nowMs)) {
      skipped.push({ channel, code: "external_send_not_authorized" });
      continue;
    }
    deliveries.push({
      channel,
      destination:
        config.mode === "test"
          ? { kind: "test_sink", sink: `test-sink:${channel}` }
          : { kind: "registered_contact" },
      idempotencyKey,
    });
  }
  return { send: true, body: plan.body, link: plan.link, deliveries, skipped };
}
