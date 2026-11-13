/**
 * JARVIS inbox-to-channel escalation ladder (SV1-JARVIS-03).
 *
 * Pure planning and verification only: this module never sends anything and
 * holds no credentials, so it cannot contact a real recipient. A caller may
 * only act on a `send` plan, and in live mode a `send` plan exists only with
 * both a recorded human outbound authorization and owner enablement.
 *
 * Ladder: console inbox -> WhatsApp -> voice. It respects request expiry and
 * quiet hours, stops on acknowledge/deny/decision, and phone channels can never
 * approve (they map onto acknowledge or deny only; see approval-inbox.ts).
 */

import type { ApprovalChannel, ApprovalInboxState, DecideApprovalInput } from "./approval-inbox";

export type LadderChannel = "console" | "whatsapp" | "voice";
export type ExternalLadderChannel = Exclude<LadderChannel, "console">;

export interface LadderRung {
  readonly channel: LadderChannel;
  /** Minimum wait after the previous rung's attempt (or the request for rung 0). */
  readonly delayMs: number;
}

export interface QuietHours {
  /** Minutes after local midnight, 0..1439. The window may wrap midnight. */
  readonly startMinute: number;
  readonly endMinute: number;
  readonly utcOffsetMinutes: number;
}

export interface EscalationConfig {
  /** `test` routes every external rung to a synthetic sink; it never resolves a real contact. */
  readonly mode: "test" | "live";
  readonly rungs: readonly LadderRung[];
  readonly quietHours: QuietHours | null;
  /** Owner enablement per external channel; false by default and required in live mode. */
  readonly ownerEnabled: Readonly<Record<ExternalLadderChannel, boolean>>;
}

/** A recorded human approval permitting real outbound contact (live mode only). */
export interface LiveOutboundAuthorization {
  readonly approvalRef: string;
  readonly approvedBy: string;
  readonly channels: readonly ExternalLadderChannel[];
  readonly expiresAt: string;
}

export interface EscalationAttempt {
  readonly approvalId: string;
  readonly channel: LadderChannel;
  readonly attemptedAt: string;
}

export const DEFAULT_ESCALATION_CONFIG: EscalationConfig = {
  mode: "test",
  rungs: [
    { channel: "console", delayMs: 0 },
    { channel: "whatsapp", delayMs: 15 * 60 * 1000 },
    { channel: "voice", delayMs: 15 * 60 * 1000 },
  ],
  quietHours: { startMinute: 22 * 60, endMinute: 7 * 60, utcOffsetMinutes: 60 },
  ownerEnabled: { whatsapp: false, voice: false },
};

export type EscalationStopReason =
  | "invalid_input"
  | "not_found"
  | "decided"
  | "acknowledged"
  | "expired"
  | "expiry_during_quiet_hours"
  | "ladder_complete";

export type SkippedRung = {
  readonly channel: ExternalLadderChannel;
  readonly code: "channel_not_enabled" | "external_send_not_authorized";
};

export type EscalationPlan =
  | {
      readonly action: "stop";
      readonly reason: EscalationStopReason;
      readonly skipped: readonly SkippedRung[];
    }
  | {
      readonly action: "wait";
      readonly until: string;
      readonly reason: "rung_delay" | "quiet_hours";
      readonly skipped: readonly SkippedRung[];
    }
  | {
      readonly action: "send";
      readonly channel: LadderChannel;
      readonly rungIndex: number;
      readonly destination:
        | { readonly kind: "in_app" }
        | { readonly kind: "test_sink"; readonly sink: string }
        | { readonly kind: "registered_contact" };
      readonly idempotencyKey: string;
      readonly skipped: readonly SkippedRung[];
    };

const instant = (v: unknown): number => (typeof v === "string" ? Date.parse(v) : Number.NaN);

function minuteOfDay(ms: number, offsetMinutes: number): number {
  const m = Math.floor(ms / 60000) + offsetMinutes;
  return ((m % 1440) + 1440) % 1440;
}

export function inQuietHours(ms: number, q: QuietHours | null): boolean {
  if (q === null) return false;
  const m = minuteOfDay(ms, q.utcOffsetMinutes);
  return q.startMinute <= q.endMinute
    ? m >= q.startMinute && m < q.endMinute
    : m >= q.startMinute || m < q.endMinute;
}

function quietHoursEnd(ms: number, q: QuietHours): number {
  const m = minuteOfDay(ms, q.utcOffsetMinutes);
  const delta = (q.endMinute - m + 1440) % 1440;
  return Math.floor(ms / 60000) * 60000 + delta * 60000;
}

function validConfig(c: EscalationConfig): boolean {
  if (c === null || typeof c !== "object") return false;
  if (c.mode !== "test" && c.mode !== "live") return false;
  if (!Array.isArray(c.rungs) || c.rungs.length === 0) return false;
  if (
    c.rungs.some(
      (r, i) =>
        !["console", "whatsapp", "voice"].includes(r.channel) ||
        !Number.isFinite(r.delayMs) ||
        r.delayMs < 0 ||
        (i === 0) !== (r.channel === "console"),
    )
  ) {
    return false; // the console inbox must be the first and only first rung
  }
  if (c.quietHours !== null) {
    const q = c.quietHours;
    if (
      ![q.startMinute, q.endMinute].every((n) => Number.isInteger(n) && n >= 0 && n < 1440) ||
      q.startMinute === q.endMinute ||
      !Number.isFinite(q.utcOffsetMinutes)
    ) {
      return false;
    }
  }
  return true;
}

export function planEscalation(input: {
  readonly state: ApprovalInboxState;
  readonly approvalId: string;
  readonly attempts: readonly EscalationAttempt[];
  readonly now: string;
  readonly config: EscalationConfig;
  readonly liveOutbound?: LiveOutboundAuthorization;
}): EscalationPlan {
  const stop = (reason: EscalationStopReason, skipped: SkippedRung[] = []): EscalationPlan => ({
    action: "stop",
    reason,
    skipped,
  });
  const now = instant(input?.now);
  if (
    !Number.isFinite(now) ||
    typeof input?.approvalId !== "string" ||
    !validConfig(input.config)
  ) {
    return stop("invalid_input");
  }
  const request = input.state.requests.find((r) => r.approvalId === input.approvalId);
  if (request === undefined) return stop("not_found");
  if (request.status !== "pending") {
    return stop(request.status === "expired" ? "expired" : "decided");
  }
  const expiresAt = instant(request.expiresAt);
  if (now >= expiresAt) return stop("expired");
  const eventKinds = input.state.events
    .filter((e) => e.approvalId === input.approvalId)
    .map((e) => e.kind);
  if (eventKinds.includes("acknowledge")) return stop("acknowledged");

  const mine = input.attempts.filter((a) => a.approvalId === input.approvalId);
  const skipped: SkippedRung[] = [];
  let previousAt = instant(request.requestedAt);

  for (let i = 0; i < input.config.rungs.length; i += 1) {
    const rung = input.config.rungs[i] as LadderRung;
    const attempt = mine.find((a) => a.channel === rung.channel);
    if (attempt !== undefined) {
      previousAt = instant(attempt.attemptedAt);
      continue;
    }
    if (rung.channel !== "console") {
      if (!input.config.ownerEnabled[rung.channel]) {
        skipped.push({ channel: rung.channel, code: "channel_not_enabled" });
        continue;
      }
      if (input.config.mode === "live") {
        const auth = input.liveOutbound;
        if (
          auth === undefined ||
          typeof auth.approvalRef !== "string" ||
          auth.approvalRef.trim().length === 0 ||
          typeof auth.approvedBy !== "string" ||
          auth.approvedBy.trim().length === 0 ||
          !auth.channels.includes(rung.channel) ||
          !(instant(auth.expiresAt) > now)
        ) {
          skipped.push({ channel: rung.channel, code: "external_send_not_authorized" });
          continue;
        }
      }
    }
    let due = previousAt + rung.delayMs;
    if (now < due) {
      return { action: "wait", until: new Date(due).toISOString(), reason: "rung_delay", skipped };
    }
    if (rung.channel !== "console" && input.config.quietHours !== null) {
      if (inQuietHours(now, input.config.quietHours)) {
        due = quietHoursEnd(now, input.config.quietHours);
        if (due >= expiresAt) return stop("expiry_during_quiet_hours", skipped);
        return {
          action: "wait",
          until: new Date(due).toISOString(),
          reason: "quiet_hours",
          skipped,
        };
      }
    }
    const destination: EscalationPlanDestination =
      rung.channel === "console"
        ? { kind: "in_app" }
        : input.config.mode === "test"
          ? { kind: "test_sink", sink: `test-sink:${rung.channel}` }
          : { kind: "registered_contact" };
    return {
      action: "send",
      channel: rung.channel,
      rungIndex: i,
      destination,
      idempotencyKey: `${input.approvalId}:${rung.channel}`,
      skipped,
    };
  }
  return stop("ladder_complete", skipped);
}

type EscalationPlanDestination = Extract<EscalationPlan, { action: "send" }>["destination"];

/* ── Inbound verification (spoof rejection) ─────────────────────────────── */

/** Issued when an external rung is sent; the token itself is never stored, only its digest. */
export interface InboundChallenge {
  readonly approvalId: string;
  readonly channel: Exclude<ApprovalChannel, "console">;
  readonly tokenDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly consumed: boolean;
  /** The approver contact registered for this challenge. */
  readonly bound: {
    readonly approverId: string;
    readonly approverRole: "platform_staff" | "sheriff";
    readonly address: string;
  };
}

export interface InboundReply {
  readonly approvalId: string;
  readonly channel: Exclude<ApprovalChannel, "console">;
  readonly from: string;
  readonly intent: "acknowledge" | "deny" | "approve" | "unknown";
  /** Result of the provider's signature check, computed by the webhook layer. */
  readonly signatureValid: boolean;
  readonly tokenDigest: string;
  readonly receivedAt: string;
}

export type InboundVerdict =
  | {
      readonly accepted: true;
      readonly decision: DecideApprovalInput;
      /** An "approve" reply is recorded as an acknowledgement only; approval needs the console. */
      readonly approveIntentIgnored: boolean;
      readonly consumedChallenge: InboundChallenge;
    }
  | {
      readonly accepted: false;
      readonly code:
        | "invalid_input"
        | "spoofed_signature"
        | "unknown_challenge"
        | "challenge_consumed"
        | "challenge_expired"
        | "sender_mismatch"
        | "unknown_intent"
        | "test_mode_real_sender";
    };

export function verifyInboundReply(input: {
  readonly reply: InboundReply;
  readonly challenges: readonly InboundChallenge[];
  readonly mode: "test" | "live";
}): InboundVerdict {
  const { reply } = input;
  const receivedAt = instant(reply?.receivedAt);
  if (
    reply === null ||
    typeof reply !== "object" ||
    !Number.isFinite(receivedAt) ||
    !["whatsapp", "voice", "sms", "email"].includes(reply.channel) ||
    typeof reply.from !== "string" ||
    reply.from.trim().length === 0 ||
    typeof reply.tokenDigest !== "string" ||
    reply.tokenDigest.length === 0
  ) {
    return { accepted: false, code: "invalid_input" };
  }
  if (reply.signatureValid !== true) return { accepted: false, code: "spoofed_signature" };
  if (input.mode === "test" && !reply.from.startsWith("test-sink:")) {
    return { accepted: false, code: "test_mode_real_sender" };
  }
  const challenge = input.challenges.find(
    (c) =>
      c.approvalId === reply.approvalId &&
      c.channel === reply.channel &&
      c.tokenDigest === reply.tokenDigest,
  );
  if (challenge === undefined) return { accepted: false, code: "unknown_challenge" };
  if (challenge.consumed) return { accepted: false, code: "challenge_consumed" };
  if (!(instant(challenge.expiresAt) > receivedAt)) {
    return { accepted: false, code: "challenge_expired" };
  }
  if (challenge.bound.address !== reply.from) return { accepted: false, code: "sender_mismatch" };
  if (!["acknowledge", "deny", "approve"].includes(reply.intent)) {
    return { accepted: false, code: "unknown_intent" };
  }
  const approveIntentIgnored = reply.intent === "approve";
  return {
    accepted: true,
    approveIntentIgnored,
    consumedChallenge: { ...challenge, consumed: true },
    decision: {
      approvalId: reply.approvalId,
      decision: reply.intent === "deny" ? "deny" : "acknowledge",
      channel: reply.channel,
      approverId: challenge.bound.approverId,
      approverRole: challenge.bound.approverRole,
      identityKind: "human",
      humanIdentityVerified: true,
      passkeyStepUpVerified: false,
    },
  };
}
