/**
 * SV1-JARVIS-03 — escalation ladder and inbound verification.
 * Offline and deterministic: fixed instants, synthetic identities, no I/O.
 */
import { describe, expect, it } from "vitest";
import {
  createApprovalRequest,
  decideApproval,
  EMPTY_APPROVAL_INBOX,
  type ApprovalInboxState,
} from "../../frontend/src/lib/jarvis/approval-inbox";
import {
  DEFAULT_ESCALATION_CONFIG,
  inQuietHours,
  planEscalation,
  verifyInboundReply,
  type EscalationAttempt,
  type EscalationConfig,
  type InboundChallenge,
  type InboundReply,
  type LiveOutboundAuthorization,
} from "../../frontend/src/lib/jarvis/inbox-escalation";

// Lagos is UTC+1; quiet hours 22:00-07:00 local = 21:00-06:00 UTC.
const REQUESTED = "2026-11-04T10:00:00.000Z"; // 11:00 local, not quiet
const EXPIRES = "2026-11-04T18:00:00.000Z";
const AP = "approval-1";

const TEST_CFG: EscalationConfig = {
  ...DEFAULT_ESCALATION_CONFIG,
  ownerEnabled: { whatsapp: true, voice: true },
};
const LIVE_CFG: EscalationConfig = { ...TEST_CFG, mode: "live" };

function inbox(expiresAt = EXPIRES, actionId = "change_subscription"): ApprovalInboxState {
  const r = createApprovalRequest(
    EMPTY_APPROVAL_INBOX,
    {
      approvalId: AP,
      idempotencyKey: "k1",
      actionId,
      actionRef: "ref-1",
      agentDefinitionId: "agent-ops",
      requesterRef: "identity-agent-ops",
      platformRef: "coregrid",
      preconditionsDigest: "d1",
      expiresAt,
    },
    REQUESTED,
  );
  if (!r.ok) throw new Error(r.code);
  return r.state;
}

const at = (iso: string, channel: "console" | "whatsapp" | "voice"): EscalationAttempt => ({
  approvalId: AP,
  channel,
  attemptedAt: iso,
});

const LIVE_AUTH: LiveOutboundAuthorization = {
  approvalRef: "outbound-approval-1",
  approvedBy: "human-sheriff",
  channels: ["whatsapp", "voice"],
  expiresAt: EXPIRES,
};

describe("ladder order and timing", () => {
  it("starts with the console inbox (in-app, never external)", () => {
    const p = planEscalation({
      state: inbox(),
      approvalId: AP,
      attempts: [],
      now: REQUESTED,
      config: TEST_CFG,
    });
    expect(p).toMatchObject({
      action: "send",
      channel: "console",
      destination: { kind: "in_app" },
    });
  });

  it("waits the rung delay, then sends WhatsApp, then voice", () => {
    const base = { state: inbox(), approvalId: AP, config: TEST_CFG };
    const attempts = [at(REQUESTED, "console")];
    const early = planEscalation({ ...base, attempts, now: "2026-11-04T10:10:00.000Z" });
    expect(early).toMatchObject({
      action: "wait",
      reason: "rung_delay",
      until: "2026-11-04T10:15:00.000Z",
    });
    const wa = planEscalation({ ...base, attempts, now: "2026-11-04T10:15:00.000Z" });
    expect(wa).toMatchObject({ action: "send", channel: "whatsapp" });
    const withWa = [...attempts, at("2026-11-04T10:15:00.000Z", "whatsapp")];
    const voice = planEscalation({ ...base, attempts: withWa, now: "2026-11-04T10:30:00.000Z" });
    expect(voice).toMatchObject({ action: "send", channel: "voice" });
    const done = planEscalation({
      ...base,
      attempts: [...withWa, at("2026-11-04T10:30:00.000Z", "voice")],
      now: "2026-11-04T10:45:00.000Z",
    });
    expect(done).toMatchObject({ action: "stop", reason: "ladder_complete" });
  });

  it("is idempotent: an already-attempted rung is never planned again", () => {
    const p = planEscalation({
      state: inbox(),
      approvalId: AP,
      attempts: [at(REQUESTED, "console"), at(REQUESTED, "console")],
      now: REQUESTED,
      config: TEST_CFG,
    });
    expect(p.action).not.toBe("send");
  });

  it("rejects malformed configs (console must be the only first rung)", () => {
    const bad: EscalationConfig = {
      ...TEST_CFG,
      rungs: [{ channel: "whatsapp", delayMs: 0 }],
    };
    const p = planEscalation({
      state: inbox(),
      approvalId: AP,
      attempts: [],
      now: REQUESTED,
      config: bad,
    });
    expect(p).toMatchObject({ action: "stop", reason: "invalid_input" });
  });
});

describe("test mode never contacts real recipients", () => {
  it("routes external rungs to synthetic sinks only", () => {
    const p = planEscalation({
      state: inbox(),
      approvalId: AP,
      attempts: [at(REQUESTED, "console")],
      now: "2026-11-04T10:15:00.000Z",
      config: TEST_CFG,
    });
    expect(p).toMatchObject({
      action: "send",
      destination: { kind: "test_sink", sink: "test-sink:whatsapp" },
    });
  });

  it("test mode ignores a live authorization (still a sink)", () => {
    const p = planEscalation({
      state: inbox(),
      approvalId: AP,
      attempts: [at(REQUESTED, "console")],
      now: "2026-11-04T10:15:00.000Z",
      config: TEST_CFG,
      liveOutbound: LIVE_AUTH,
    });
    expect(p).toMatchObject({ destination: { kind: "test_sink" } });
  });

  it("no plan in test mode ever resolves a registered (real) contact", () => {
    const attempts: EscalationAttempt[] = [];
    const times = [REQUESTED, "2026-11-04T10:15:00.000Z", "2026-11-04T10:30:00.000Z"];
    for (const now of times) {
      const p = planEscalation({ state: inbox(), approvalId: AP, attempts, now, config: TEST_CFG });
      if (p.action !== "send") continue;
      expect(p.destination.kind).not.toBe("registered_contact");
      attempts.push(at(now, p.channel));
    }
    expect(attempts).toHaveLength(3);
  });
});

describe("live mode needs a recorded human authorization and owner enablement", () => {
  const afterConsole = [at(REQUESTED, "console")];
  const now = "2026-11-04T10:15:00.000Z";

  it("skips external rungs without authorization (no autonomous external send)", () => {
    const p = planEscalation({
      state: inbox(),
      approvalId: AP,
      attempts: afterConsole,
      now,
      config: LIVE_CFG,
    });
    expect(p).toMatchObject({ action: "stop", reason: "ladder_complete" });
    expect(p.skipped.map((s) => s.code)).toEqual([
      "external_send_not_authorized",
      "external_send_not_authorized",
    ]);
  });

  it("skips channels the owner has not enabled, even with authorization", () => {
    const cfg: EscalationConfig = { ...LIVE_CFG, ownerEnabled: { whatsapp: false, voice: false } };
    const p = planEscalation({
      state: inbox(),
      approvalId: AP,
      attempts: afterConsole,
      now,
      config: cfg,
      liveOutbound: LIVE_AUTH,
    });
    expect(p.action).toBe("stop");
    expect(p.skipped.map((s) => s.code)).toEqual(["channel_not_enabled", "channel_not_enabled"]);
  });

  it("allows a registered contact only with authorization for that channel", () => {
    const auth = { ...LIVE_AUTH, channels: ["whatsapp"] as const };
    const p = planEscalation({
      state: inbox(),
      approvalId: AP,
      attempts: afterConsole,
      now,
      config: LIVE_CFG,
      liveOutbound: auth,
    });
    expect(p).toMatchObject({
      action: "send",
      channel: "whatsapp",
      destination: { kind: "registered_contact" },
    });
  });

  it("an expired or blank authorization is not authorization", () => {
    for (const auth of [
      { ...LIVE_AUTH, expiresAt: "2026-11-04T10:00:00.000Z" },
      { ...LIVE_AUTH, approvalRef: " " },
      { ...LIVE_AUTH, approvedBy: "" },
    ]) {
      const p = planEscalation({
        state: inbox(),
        approvalId: AP,
        attempts: afterConsole,
        now,
        config: LIVE_CFG,
        liveOutbound: auth,
      });
      expect(p.action).toBe("stop");
    }
  });
});

describe("quiet hours and expiry", () => {
  it("classifies quiet hours across midnight in the configured offset", () => {
    const q = DEFAULT_ESCALATION_CONFIG.quietHours;
    expect(inQuietHours(Date.parse("2026-11-04T21:00:00Z"), q)).toBe(true); // 22:00 local
    expect(inQuietHours(Date.parse("2026-11-04T05:59:00Z"), q)).toBe(true); // 06:59 local
    expect(inQuietHours(Date.parse("2026-11-04T06:00:00Z"), q)).toBe(false); // 07:00 local
    expect(inQuietHours(Date.parse("2026-11-04T20:59:00Z"), q)).toBe(false); // 21:59 local
    expect(inQuietHours(Date.parse("2026-11-04T03:00:00Z"), null)).toBe(false);
  });

  it("defers an external rung to the end of quiet hours but never the console", () => {
    const requested = "2026-11-04T20:50:00.000Z";
    const created = createApprovalRequest(
      EMPTY_APPROVAL_INBOX,
      {
        approvalId: AP,
        idempotencyKey: "k",
        actionId: "change_subscription",
        actionRef: "r",
        agentDefinitionId: "a",
        requesterRef: "ia",
        platformRef: "coregrid",
        preconditionsDigest: "d",
        expiresAt: "2026-11-05T08:00:00.000Z",
      },
      requested,
    );
    if (!created.ok) throw new Error(created.code);
    const base = { state: created.state, approvalId: AP, config: TEST_CFG };
    const console1 = planEscalation({ ...base, attempts: [], now: requested });
    expect(console1).toMatchObject({ action: "send", channel: "console" });
    const waWait = planEscalation({
      ...base,
      attempts: [at(requested, "console")],
      now: "2026-11-04T21:05:00.000Z", // 22:05 local, quiet
    });
    expect(waWait).toMatchObject({
      action: "wait",
      reason: "quiet_hours",
      until: "2026-11-05T06:00:00.000Z",
    });
  });

  it("stops rather than send after expiry, and when quiet hours outlast the request", () => {
    const expired = planEscalation({
      state: inbox(),
      approvalId: AP,
      attempts: [],
      now: EXPIRES,
      config: TEST_CFG,
    });
    expect(expired).toMatchObject({ action: "stop", reason: "expired" });
    const short = "2026-11-04T22:00:00.000Z";
    const created = createApprovalRequest(
      EMPTY_APPROVAL_INBOX,
      {
        approvalId: AP,
        idempotencyKey: "k",
        actionId: "change_subscription",
        actionRef: "r",
        agentDefinitionId: "a",
        requesterRef: "ia",
        platformRef: "coregrid",
        preconditionsDigest: "d",
        expiresAt: "2026-11-05T01:00:00.000Z",
      },
      "2026-11-04T21:10:00.000Z",
    );
    if (!created.ok) throw new Error(created.code);
    const p = planEscalation({
      state: created.state,
      approvalId: AP,
      attempts: [at("2026-11-04T21:10:00.000Z", "console")],
      now: short,
      config: {
        ...TEST_CFG,
        rungs: [
          { channel: "console", delayMs: 0 },
          { channel: "whatsapp", delayMs: 0 },
        ],
      },
    });
    expect(p).toMatchObject({ action: "stop", reason: "expiry_during_quiet_hours" });
  });
});

describe("the ladder stops on acknowledge, deny, decision and expiry", () => {
  const sheriff = (
    decision: "acknowledge" | "deny" | "approve",
    channel: "console" | "voice" = "voice",
  ) => ({
    approvalId: AP,
    decision,
    channel,
    approverId: "human-sheriff",
    approverRole: "sheriff" as const,
    identityKind: "human" as const,
    humanIdentityVerified: true,
    passkeyStepUpVerified: channel === "console",
  });
  const plan = (state: ApprovalInboxState) =>
    planEscalation({
      state,
      approvalId: AP,
      attempts: [at(REQUESTED, "console")],
      now: "2026-11-04T10:15:00.000Z",
      config: TEST_CFG,
    });

  it("stops after an acknowledgement", () => {
    const r = decideApproval(inbox(), sheriff("acknowledge"), "2026-11-04T10:05:00.000Z");
    if (!r.ok) throw new Error(r.code);
    expect(plan(r.state)).toMatchObject({ action: "stop", reason: "acknowledged" });
  });
  it("stops after a deny", () => {
    const r = decideApproval(inbox(), sheriff("deny"), "2026-11-04T10:05:00.000Z");
    if (!r.ok) throw new Error(r.code);
    expect(plan(r.state)).toMatchObject({ action: "stop", reason: "decided" });
  });
  it("stops after a console approval", () => {
    const r = decideApproval(inbox(), sheriff("approve", "console"), "2026-11-04T10:05:00.000Z");
    if (!r.ok) throw new Error(r.code);
    expect(plan(r.state)).toMatchObject({ action: "stop", reason: "decided" });
  });
  it("stops for an unknown approval", () => {
    const p = planEscalation({
      state: EMPTY_APPROVAL_INBOX,
      approvalId: AP,
      attempts: [],
      now: REQUESTED,
      config: TEST_CFG,
    });
    expect(p).toMatchObject({ action: "stop", reason: "not_found" });
  });
});

describe("inbound verification rejects spoofing and cannot approve", () => {
  const issued = "2026-11-04T10:15:00.000Z";
  const challenge: InboundChallenge = {
    approvalId: AP,
    channel: "whatsapp",
    tokenDigest: "digest-1",
    issuedAt: issued,
    expiresAt: "2026-11-04T11:15:00.000Z",
    consumed: false,
    bound: { approverId: "human-sheriff", approverRole: "sheriff", address: "test-sink:sheriff" },
  };
  const reply = (over: Partial<InboundReply> = {}): InboundReply => ({
    approvalId: AP,
    channel: "whatsapp",
    from: "test-sink:sheriff",
    intent: "deny",
    signatureValid: true,
    tokenDigest: "digest-1",
    receivedAt: "2026-11-04T10:20:00.000Z",
    ...over,
  });
  const verify = (r: InboundReply, mode: "test" | "live" = "test", cs = [challenge]) =>
    verifyInboundReply({ reply: r, challenges: cs, mode });

  it("accepts a signed, bound, unexpired reply and maps it to a decision input", () => {
    const v = verify(reply());
    expect(v.accepted && v.decision).toMatchObject({
      decision: "deny",
      channel: "whatsapp",
      approverId: "human-sheriff",
    });
    expect(v.accepted && v.consumedChallenge.consumed).toBe(true);
  });

  it("rejects a spoofed signature, unknown token, wrong sender, replay and expiry", () => {
    expect(!verify(reply({ signatureValid: false })).accepted).toBe(true);
    const codes = [
      [reply({ signatureValid: false }), "spoofed_signature"],
      [reply({ tokenDigest: "forged" }), "unknown_challenge"],
      [reply({ from: "test-sink:attacker" }), "sender_mismatch"],
      [reply({ receivedAt: "2026-11-04T11:15:00.000Z" }), "challenge_expired"],
      [reply({ approvalId: "other" }), "unknown_challenge"],
      [reply({ channel: "voice" }), "unknown_challenge"],
      [reply({ intent: "unknown" }), "unknown_intent"],
    ] as const;
    for (const [r, code] of codes) {
      const v = verify(r);
      expect(!v.accepted && v.code).toBe(code);
    }
    const consumed = verify(reply(), "test", [{ ...challenge, consumed: true }]);
    expect(!consumed.accepted && consumed.code).toBe("challenge_consumed");
  });

  it("test mode rejects any sender that is not a synthetic sink", () => {
    const real: InboundChallenge = {
      ...challenge,
      bound: { ...challenge.bound, address: "+2348000000000" },
    };
    const v = verify(reply({ from: "+2348000000000" }), "test", [real]);
    expect(!v.accepted && v.code).toBe("test_mode_real_sender");
  });

  it("an 'approve' reply is only an acknowledgement and can never approve a T3 request", () => {
    const v = verify(reply({ intent: "approve" }));
    expect(v.accepted && v.approveIntentIgnored).toBe(true);
    if (!v.accepted) return;
    expect(v.decision.decision).toBe("acknowledge");
    const applied = decideApproval(inbox(), v.decision, "2026-11-04T10:20:00.000Z");
    expect(applied.ok && applied.request.status).toBe("pending");
    // And forcing an approve decision through a phone channel is refused by the inbox itself.
    const forced = decideApproval(
      inbox(),
      { ...v.decision, decision: "approve", passkeyStepUpVerified: true },
      "2026-11-04T10:20:00.000Z",
    );
    expect(!forced.ok && forced.code).toBe("channel_cannot_approve");
  });

  it("a verified deny reply closes the request through the inbox", () => {
    const v = verify(reply());
    if (!v.accepted) throw new Error(v.code);
    const applied = decideApproval(inbox(), v.decision, "2026-11-04T10:20:00.000Z");
    expect(applied.ok && applied.request.status).toBe("denied");
  });
});

describe("module is send-free", () => {
  it("imports nothing that can perform I/O", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("frontend/src/lib/jarvis/inbox-escalation.ts", "utf8");
    expect(src).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket|process\.env|require\()/);
    expect(src).not.toMatch(/from\s+["'](?!\.\/)[^"']+["']/); // only relative type imports
  });
});
