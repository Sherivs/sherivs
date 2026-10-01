/**
 * CoreGrid — email adapter contract tests (stub never claims success).
 */
import { describe, expect, it } from "vitest";
import {
  RECORD_ONLY_EMAIL_ADAPTER_ID,
  createRecordOnlyEmailAdapter,
  evaluateEmailPreSend,
  isEmailDeliveryReceipt,
  type EmailProviderRegistry,
  type EmailSendCommand,
} from "../../frontend/src/lib/notifications/email-adapter-contract";
import type { Notification } from "../../frontend/src/lib/notifications/notification-contract";

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
