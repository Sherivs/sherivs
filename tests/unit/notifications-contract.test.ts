/**
 * CoreGrid — notification contract tests (state machine, receipts, policy, tenant).
 */
import { describe, expect, it } from "vitest";
import {
  allowedChannelsForCategory,
  evaluateNotificationAccess,
  isCategoryAllowedOnChannel,
  isNotificationTransitionAllowed,
  markDelivered,
  transitionNotification,
  type DeliveryReceipt,
  type Notification,
} from "../../frontend/src/lib/notifications/notification-contract";

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "notif-001",
    tenantRef: "tenant-a",
    recipientRef: "user-1",
    audienceKind: "user",
    category: "general",
    subject: "Mission result ready",
    body: "Your mission result has been published.",
    actionRef: null,
    state: "draft",
    createdAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeReceipt(overrides: Partial<DeliveryReceipt> = {}): DeliveryReceipt {
  return {
    notificationId: "notif-001",
    channel: "email",
    providerId: "resend",
    providerMessageId: "provider-msg-1",
    confirmedAt: "2026-10-01T00:01:00.000Z",
    ...overrides,
  };
}

describe("notification state machine (fail closed)", () => {
  it("walks draft → queued", () => {
    const result = transitionNotification(makeNotification(), "queued");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.notification.state).toBe("queued");
  });

  it("cannot claim delivered from draft without queueing", () => {
    expect(isNotificationTransitionAllowed("draft", "delivered")).toBe(false);
    const result = transitionNotification(makeNotification(), "delivered");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("not permitted");
  });

  it("cannot jump to delivered, failed or undeliverable from draft", () => {
    expect(transitionNotification(makeNotification(), "failed").ok).toBe(false);
    expect(transitionNotification(makeNotification(), "undeliverable").ok).toBe(false);
  });

  it("terminal states accept no further transitions", () => {
    for (const terminal of ["delivered", "failed", "undeliverable"] as const) {
      const notification = makeNotification({ state: terminal });
      expect(transitionNotification(notification, "queued").ok).toBe(false);
      expect(transitionNotification(notification, "delivered").ok).toBe(false);
      expect(transitionNotification(notification, "failed").ok).toBe(false);
      expect(transitionNotification(notification, "undeliverable").ok).toBe(false);
    }
  });

  it("rejects unknown states outright", () => {
    const result = transitionNotification(makeNotification(), "read_by_everyone" as never);
    expect(result.ok).toBe(false);
  });
});

describe("markDelivered (delivered only via a provider receipt)", () => {
  it("moves queued → delivered with a matching receipt", () => {
    const queued = makeNotification({ state: "queued" });
    const result = markDelivered(queued, makeReceipt());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.notification.state).toBe("delivered");
  });

  it("cannot mark delivered without a receipt", () => {
    const queued = makeNotification({ state: "queued" });
    const result = markDelivered(queued, undefined as unknown as DeliveryReceipt);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("receipt is required");
  });

  it("cannot mark delivered with a receipt for a different notification", () => {
    const queued = makeNotification({ state: "queued" });
    const result = markDelivered(queued, makeReceipt({ notificationId: "notif-other" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("notif-other");
  });

  it("cannot mark delivered from draft even with a receipt", () => {
    const result = markDelivered(makeNotification(), makeReceipt());
    expect(result.ok).toBe(false);
  });
});

describe("channel/category policy (restricted categories fail closed to in_app)", () => {
  it("permits every category on in_app", () => {
    for (const category of [
      "escalation",
      "approval_request",
      "mission_result",
      "system",
      "general",
    ] as const) {
      expect(isCategoryAllowedOnChannel(category, "in_app")).toBe(true);
    }
  });

  it("denies restricted categories on email, sms and web_push", () => {
    for (const category of ["escalation", "approval_request"] as const) {
      expect(isCategoryAllowedOnChannel(category, "email")).toBe(false);
      expect(isCategoryAllowedOnChannel(category, "sms")).toBe(false);
      expect(isCategoryAllowedOnChannel(category, "web_push")).toBe(false);
      expect(allowedChannelsForCategory(category)).toEqual(["in_app"]);
    }
  });

  it("permits non-restricted categories on external channels", () => {
    expect(allowedChannelsForCategory("general")).toEqual(["in_app", "email", "sms", "web_push"]);
    expect(isCategoryAllowedOnChannel("mission_result", "email")).toBe(true);
  });
});

describe("evaluateNotificationAccess (tenant isolation, §17)", () => {
  it("allows same-tenant same-recipient access", () => {
    const decision = evaluateNotificationAccess(makeNotification(), {
      tenantRef: "tenant-a",
      recipientRef: "user-1",
    });
    expect(decision.decision).toBe("allow");
  });

  it("rejects cross-tenant notifications outright", () => {
    const decision = evaluateNotificationAccess(makeNotification(), {
      tenantRef: "tenant-b",
      recipientRef: "user-1",
    });
    expect(decision).toEqual({
      decision: "deny",
      code: "cross_tenant",
      reason: "Notification belongs to a different tenant",
    });
  });

  it("rejects a user-addressed notification opened by another recipient", () => {
    const decision = evaluateNotificationAccess(makeNotification(), {
      tenantRef: "tenant-a",
      recipientRef: "user-2",
    });
    expect(decision).toEqual({
      decision: "deny",
      code: "recipient_mismatch",
      reason: "User-addressed notification belongs to a different recipient",
    });
  });

  it("allows any member of the tenant to see role/org_unit audience notifications", () => {
    const roleNotification = makeNotification({ audienceKind: "role", recipientRef: "role-admin" });
    expect(
      evaluateNotificationAccess(roleNotification, {
        tenantRef: "tenant-a",
        recipientRef: "user-2",
      }).decision,
    ).toBe("allow");
  });
});
