/**
 * CoreGrid — email adapter contract tests (stub never claims success).
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMAIL_FAILURE_POLICY,
  RECORD_ONLY_EMAIL_ADAPTER_ID,
  createRecordOnlyEmailAdapter,
  evaluateEmailPreSend,
  isEmailDeliveryReceipt,
  withEmailFailurePolicy,
  type EmailAdapter,
  type EmailDeliveryReceipt,
  type EmailProviderRegistry,
  type EmailSendCommand,
} from "../../frontend/src/lib/notifications/email-adapter-contract";
import type { Notification } from "../../frontend/src/lib/notifications/notification-contract";
import {
  createAdapterFailurePolicy,
  type AdapterClock,
} from "../../frontend/src/lib/adapters/failure-policy";

/** Deferred-delay clock: the timeout fires only when the test fires it. */
function manualClock(startMs = 1_000_000) {
  const now = startMs;
  const pending: (() => void)[] = [];
  const clock: AdapterClock = {
    nowMs: () => now,
    delay: () =>
      new Promise<void>((resolve) => {
        pending.push(resolve);
      }),
  };
  return {
    clock,
    fireDelays(): void {
      const all = pending.splice(0, pending.length);
      for (const fire of all) fire();
    },
  };
}

/** Flush queued microtasks so the policy has registered its timeout delay. */
const tick = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

function testPolicy(clock?: AdapterClock) {
  return createAdapterFailurePolicy({
    provider: "resend-email",
    timeoutMs: 1_000,
    maxAttempts: 1,
    backoffBaseMs: 100,
    backoffCapMs: 1_000,
    degradedAfterFailures: 2,
    degradedWindowMs: 10_000,
    breakerFailureThreshold: 3,
    breakerResetMs: 5_000,
    ...(clock ? { clock } : {}),
  });
}

function receiptFor(notificationId: string): EmailDeliveryReceipt {
  return {
    notificationId,
    channel: "email",
    providerId: "resend",
    providerMessageId: `provider-msg-${notificationId}`,
    confirmedAt: "2026-10-01T00:00:00.000Z",
  };
}

/** A healthy provider adapter that always confirms delivery. */
function healthyAdapter(): EmailAdapter {
  return {
    providerId: "resend",
    send: async (command) => receiptFor(command.notification.id),
  };
}

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "notif-200",
    tenantRef: "tenant-a",
    recipientRef: "user-1",
    audienceKind: "user",
    category: "general",
    subject: "Attendance summary",
    body: "Weekly attendance summary is ready.",
    actionRef: null,
    state: "queued",
    createdAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeCommand(overrides: Partial<EmailSendCommand> = {}): EmailSendCommand {
  return {
    notification: makeNotification(),
    recipientAddress: "parent@example.edu",
    subject: "Attendance summary",
    body: "Weekly attendance summary is ready.",
    ...overrides,
  };
}

const configuredRegistry: EmailProviderRegistry = {
  isProviderConfigured: () => true,
  credentialReferenceFor: () => "secret://email/resend",
};

const unconfiguredRegistry: EmailProviderRegistry = {
  isProviderConfigured: () => false,
  credentialReferenceFor: () => null,
};

describe("record-only stub adapter (NOT_FOR_LIVE_USE)", () => {
  it("always resolves to undeliverable(provider_not_configured), never a receipt", async () => {
    const adapter = createRecordOnlyEmailAdapter();
    const result = await adapter.send(makeCommand(), configuredRegistry);
    expect(isEmailDeliveryReceipt(result)).toBe(false);
    expect(result).toEqual({
      outcome: "undeliverable",
      code: "provider_not_configured",
      reason: expect.stringContaining("NOT_FOR_LIVE_USE"),
    });
  });

  it("refuses to send even when the registry reports the provider configured", async () => {
    const adapter = createRecordOnlyEmailAdapter();
    const result = await adapter.send(makeCommand(), configuredRegistry);
    expect(isEmailDeliveryReceipt(result)).toBe(false);
    if (!isEmailDeliveryReceipt(result)) {
      expect(result.outcome).toBe("undeliverable");
    }
    expect("providerMessageId" in result).toBe(false);
  });

  it("never fabricates a delivery receipt for any notification", async () => {
    const adapter = createRecordOnlyEmailAdapter();
    const result = await adapter.send(
      makeCommand({ notification: makeNotification({ id: "notif-999" }) }),
      unconfiguredRegistry,
    );
    expect(isEmailDeliveryReceipt(result)).toBe(false);
    expect(JSON.stringify(result)).not.toContain("notif-999-delivered");
    expect(JSON.stringify(result)).not.toContain("providerMessageId");
  });

  it("declares itself as the record-only provider id", () => {
    expect(createRecordOnlyEmailAdapter().providerId).toBe(RECORD_ONLY_EMAIL_ADAPTER_ID);
  });
});

describe("evaluateEmailPreSend (shared fail-closed checks)", () => {
  it("blocks a restricted category from the email channel", () => {
    const failure = evaluateEmailPreSend(
      makeCommand({ notification: makeNotification({ category: "approval_request" }) }),
      configuredRegistry,
      "resend",
    );
    expect(failure).toEqual({
      outcome: "undeliverable",
      code: "category_not_permitted",
      reason: expect.stringContaining("fail closed to in_app"),
    });
  });

  it("blocks an empty recipient address", () => {
    const failure = evaluateEmailPreSend(
      makeCommand({ recipientAddress: "   " }),
      configuredRegistry,
      "resend",
    );
    expect(failure).toEqual({
      outcome: "undeliverable",
      code: "recipient_invalid",
      reason: expect.stringContaining("Recipient address is empty"),
    });
  });

  it("blocks when the provider has no server-side configuration", () => {
    const failure = evaluateEmailPreSend(makeCommand(), unconfiguredRegistry, "resend");
    expect(failure).toEqual({
      outcome: "undeliverable",
      code: "provider_not_configured",
      reason: expect.stringContaining("no server-side configuration"),
    });
  });

  it("passes a valid, configured, non-restricted command", () => {
    expect(evaluateEmailPreSend(makeCommand(), configuredRegistry, "resend")).toBeNull();
  });
});

/* ─────────────────────────────────────────────────────────────
 * J-045 failure-policy composition (additive)
 * ────────────────────────────────────────────────────────────*/

describe("withEmailFailurePolicy (J-045 composition)", () => {
  it("passes structured provider results through unchanged", async () => {
    const wrapped = withEmailFailurePolicy(createRecordOnlyEmailAdapter(), testPolicy());
    expect(wrapped.providerId).toBe(RECORD_ONLY_EMAIL_ADAPTER_ID);
    const result = await wrapped.send(makeCommand(), configuredRegistry);
    expect(isEmailDeliveryReceipt(result)).toBe(false);
    expect(result).toEqual({
      outcome: "undeliverable",
      code: "provider_not_configured",
      reason: expect.stringContaining("NOT_FOR_LIVE_USE"),
    });
  });

  it("passes a provider receipt through and records success on the policy", async () => {
    const policy = testPolicy();
    const wrapped = withEmailFailurePolicy(healthyAdapter(), policy);
    const result = await wrapped.send(makeCommand(), configuredRegistry);
    expect(isEmailDeliveryReceipt(result)).toBe(true);
    if (isEmailDeliveryReceipt(result)) {
      expect(result.providerMessageId).toBe("provider-msg-notif-200");
    }
    expect(policy.snapshot()).toMatchObject({ totalCalls: 1, totalFailures: 0 });
  });

  it("contains a throwing provider as a failed(provider_error) result, never a rejection", async () => {
    const policy = testPolicy();
    const hostile: EmailAdapter = {
      providerId: "resend",
      send: async () => {
        throw new Error("smtp relay unreachable");
      },
    };
    const wrapped = withEmailFailurePolicy(hostile, policy);
    const result = await wrapped.send(makeCommand(), configuredRegistry);
    expect(isEmailDeliveryReceipt(result)).toBe(false);
    if (!isEmailDeliveryReceipt(result)) {
      expect(result).toMatchObject({
        outcome: "failed",
        code: "provider_error",
        retryable: true,
      });
      expect(result.reason).toContain("notif-200");
      expect(result.reason).toContain("smtp relay unreachable");
    }
    expect(policy.snapshot()).toMatchObject({ totalCalls: 1, totalFailures: 1 });
  });

  it("enforces the per-call timeout on a hung provider", async () => {
    const time = manualClock();
    const policy = testPolicy(time.clock);
    const hung: EmailAdapter = {
      providerId: "resend",
      send: () => new Promise<never>(() => {}),
    };
    const wrapped = withEmailFailurePolicy(hung, policy);
    const pendingSend = wrapped.send(makeCommand(), configuredRegistry);
    await tick();
    time.fireDelays();
    const result = await pendingSend;
    expect(isEmailDeliveryReceipt(result)).toBe(false);
    if (!isEmailDeliveryReceipt(result)) {
      expect(result).toMatchObject({ outcome: "failed", code: "provider_error", retryable: true });
      expect(result.reason).toContain("timeout");
    }
  });

  it("feeds provider failure history into the trust recommendation (E-060)", async () => {
    const policy = testPolicy();
    const hostile: EmailAdapter = {
      providerId: "resend",
      send: async () => {
        throw new Error("smtp relay unreachable");
      },
    };
    const wrapped = withEmailFailurePolicy(hostile, policy);
    for (let i = 0; i < 3; i += 1) {
      await wrapped.send(makeCommand(), configuredRegistry);
    }
    expect(policy.trustBasis()).toMatchObject({
      provider: "resend-email",
      totalCalls: 3,
      totalFailures: 3,
      consecutiveFailures: 3,
    });
    expect(policy.recommendTrust().verdict).toBe("untrusted");
  });

  it("declares the default email policy instance", () => {
    expect(DEFAULT_EMAIL_FAILURE_POLICY.snapshot().provider).toBe("email");
    expect(DEFAULT_EMAIL_FAILURE_POLICY.snapshot().declared.timeoutMs).toBe(8_000);
    expect(DEFAULT_EMAIL_FAILURE_POLICY.snapshot().declared.maxAttempts).toBe(1);
  });
});
