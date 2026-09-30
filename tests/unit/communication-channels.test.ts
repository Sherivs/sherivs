/**
 * CoreGrid Scholar — Phase 10 Communication Platform unit tests
 * (communication-channels).
 *
 * Validates:
 * - Channel routing with configuration, disablement, and provider presence.
 * - Bounded retry with exponential backoff and dead-letter (BR).
 * - Provider failover (BR).
 * - Mass communication protection: permission, preview, confirmation,
 *   recipient limits, external recipient limits, human approval (BO, BN, DP).
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  routeChannels,
  decideRetry,
  failoverProvider,
  evaluateMassCommunication,
  type ChannelConfig,
} from "@/lib/communication-channels";

const TENANT_A = tenantId("tenant-a");

const CHANNEL_CONFIGS: ChannelConfig[] = [
  { channel: "in_app", enabled: true, provider: "inapp", priorityOrder: 1 },
  { channel: "push", enabled: true, provider: "webpush", priorityOrder: 2 },
  { channel: "email", enabled: false, provider: null, priorityOrder: 3 },
  { channel: "sms", enabled: true, provider: "twilio", priorityOrder: 4 },
];

describe("routeChannels", () => {
  it("routes to enabled channels with providers in priority order", () => {
    const result = routeChannels(["email", "push", "in_app", "sms"], CHANNEL_CONFIGS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const usable = result.decisions.filter((d) => d.provider !== null).map((d) => d.channel);
      expect(usable).toEqual(["in_app", "push", "sms"]); // email disabled
    }
  });

  it("fails when no usable channel/provider is available", () => {
    const result = routeChannels(["email"], CHANNEL_CONFIGS);
    expect(result.ok).toBe(false);
  });

  it("fails when no channel is requested", () => {
    const result = routeChannels([], CHANNEL_CONFIGS);
    expect(result.ok).toBe(false);
  });
});

describe("decideRetry (BR)", () => {
  it("does not retry a succeeded delivery", () => {
    const decision = decideRetry(1, "succeeded", { maxAttempts: 3, baseDelayMs: 1000 });
    expect(decision.shouldRetry).toBe(false);
  });

  it("retries failures with exponential backoff until max attempts", () => {
    const policy = { maxAttempts: 3, baseDelayMs: 1000 };
    expect(decideRetry(1, "failed", policy).shouldRetry).toBe(true);
    expect(decideRetry(2, "failed", policy).shouldRetry).toBe(true);
    const final = decideRetry(3, "failed", policy);
    expect(final.shouldRetry).toBe(false);
    expect(final.reason).toMatch(/dead-letter/i);
  });

  it("never retries indefinitely", () => {
    let attempt = 1;
    const policy = { maxAttempts: 5, baseDelayMs: 100 };
    let decision = decideRetry(attempt, "failed", policy);
    while (decision.shouldRetry && attempt < 100) {
      attempt = decision.nextAttempt;
      decision = decideRetry(attempt, "failed", policy);
    }
    expect(decision.shouldRetry).toBe(false);
    expect(attempt).toBe(5);
  });
});

describe("failoverProvider (BR)", () => {
  it("fails over to the next available provider", () => {
    const result = failoverProvider("twilio", ["twilio", "messagebird"]);
    expect(result.provider).toBe("messagebird");
  });

  it("returns null when no failover provider exists", () => {
    const result = failoverProvider("twilio", ["twilio"]);
    expect(result.provider).toBeNull();
  });
});

describe("evaluateMassCommunication (BO, BN, DP)", () => {
  function baseRequest(overrides: Partial<Parameters<typeof evaluateMassCommunication>[0]> = {}) {
    return {
      tenantId: TENANT_A,
      audienceSize: 100,
      channels: ["in_app", "push"] as Parameters<typeof evaluateMassCommunication>[0]["channels"],
      priority: "NORMAL" as Parameters<typeof evaluateMassCommunication>[0]["priority"],
      externalRecipientCount: 0,
      hasExplicitPermission: true,
      hasPreview: true,
      hasConfirmation: true,
      maxRecipients: 500,
      maxExternalRecipients: 10,
      ...overrides,
    };
  }

  it("approves a normal internal mass communication", () => {
    const verdict = evaluateMassCommunication(baseRequest());
    expect(verdict.verdict).toBe("approved");
    if (verdict.verdict === "approved") {
      expect(verdict.requiresHumanApproval).toBe(false);
    }
  });

  it("blocks without explicit permission (BO)", () => {
    const verdict = evaluateMassCommunication(baseRequest({ hasExplicitPermission: false }));
    expect(verdict.verdict).toBe("blocked");
  });

  it("blocks without preview or confirmation (BO)", () => {
    expect(evaluateMassCommunication(baseRequest({ hasPreview: false })).verdict).toBe("blocked");
    expect(evaluateMassCommunication(baseRequest({ hasConfirmation: false })).verdict).toBe(
      "blocked",
    );
  });

  it("blocks an audience exceeding the recipient limit (BN)", () => {
    const verdict = evaluateMassCommunication(baseRequest({ audienceSize: 501 }));
    expect(verdict.verdict).toBe("blocked");
  });

  it("blocks external recipients above the allowed limit (DP)", () => {
    const verdict = evaluateMassCommunication(baseRequest({ externalRecipientCount: 12 }));
    expect(verdict.verdict).toBe("blocked");
  });

  it("rejects an invalid external recipient count (DP)", () => {
    expect(evaluateMassCommunication(baseRequest({ externalRecipientCount: -1 })).verdict).toBe(
      "blocked",
    );
    expect(evaluateMassCommunication(baseRequest({ externalRecipientCount: 5000 })).verdict).toBe(
      "blocked",
    );
  });

  it("requires human approval for critical mass communication (BO)", () => {
    const verdict = evaluateMassCommunication(baseRequest({ priority: "CRITICAL" }));
    expect(verdict.verdict).toBe("approved");
    if (verdict.verdict === "approved") {
      expect(verdict.requiresHumanApproval).toBe(true);
    }
  });

  it("requires human approval when the audience approaches the limit", () => {
    const verdict = evaluateMassCommunication(baseRequest({ audienceSize: 400 }));
    expect(verdict.verdict).toBe("approved");
    if (verdict.verdict === "approved") {
      expect(verdict.requiresHumanApproval).toBe(true);
    }
  });

  it("requires human approval when any external recipient is included", () => {
    const verdict = evaluateMassCommunication(baseRequest({ externalRecipientCount: 1 }));
    expect(verdict.verdict).toBe("approved");
    if (verdict.verdict === "approved") {
      expect(verdict.requiresHumanApproval).toBe(true);
    }
  });
});
