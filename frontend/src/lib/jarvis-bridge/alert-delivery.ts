/**
 * Owner alert delivery through the JARVIS channel gates (ENGINE-09, ADR-087).
 *
 * ENGINE-04 decides WHAT to tell the owner and on which channels by severity (content,
 * safe console link, dedupe, rate limit). The JARVIS ladder (ADR-037) owns WHETHER an
 * external channel may be used at all: test mode by default, per-channel owner
 * enablement, and a recorded live-outbound authorization. This module applies the
 * second to the first and adds no send capability of its own: it only returns a plan.
 *
 * Rules:
 *  - the console is always deliverable (in-app);
 *  - WhatsApp and voice need owner enablement; in live mode they also need an
 *    unexpired authorization that names the channel and carries an approver;
 *  - SMS is never deliverable here: its activation is an owner decision that has not
 *    been recorded in the ladder's authorization model;
 *  - in test mode every external channel goes to a synthetic sink, never a contact;
 *  - an S1 alert still breaks quiet hours (ENGINE-04); approvals follow the ladder's
 *    quiet-hours rules instead, because they can wait.
 */
import type {
  EscalationConfig,
  ExternalLadderChannel,
  LiveOutboundAuthorization,
} from "../jarvis/inbox-escalation";
import {
  planOwnerAlert,
  type AlertChannel,
  type AlertInput,
} from "../jarvis-executive/owner-alert";

export type SkipCode = "channel_not_enabled" | "external_send_not_authorized" | "sms_not_activated";

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

const isExternalLadder = (c: AlertChannel): c is ExternalLadderChannel =>
  c === "whatsapp" || c === "voice";

function authorized(
  channel: ExternalLadderChannel,
  auth: LiveOutboundAuthorization | undefined,
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
  config: Pick<EscalationConfig, "mode" | "ownerEnabled">,
  liveOutbound?: LiveOutboundAuthorization,
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
    if (!isExternalLadder(channel)) {
      skipped.push({ channel, code: "sms_not_activated" });
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
