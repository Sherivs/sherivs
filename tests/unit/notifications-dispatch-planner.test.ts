/**
 * CoreGrid — dispatch planner tests (fail-closed, explicit omissions).
 */
import { describe, expect, it } from "vitest";
import {
  planNotificationDispatch,
  type ChannelAvailability,
} from "../../frontend/src/lib/notifications/dispatch-planner";
import type { Notification } from "../../frontend/src/lib/notifications/notification-contract";

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "notif-100",
    tenantRef: "tenant-a",
    recipientRef: "user-1",
    audienceKind: "user",
    category: "general",
    subject: "Fee receipt ready",
    body: "Your receipt is available.",
    actionRef: null,
    state: "queued",
    createdAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

const ALL_CONFIGURED: ChannelAvailability = {
  in_app: true,
  email: true,
  sms: true,
  web_push: true,
};

const NONE_CONFIGURED: ChannelAvailability = {
  in_app: false,
  email: false,
  sms: false,
  web_push: false,
};

describe("planNotificationDispatch — dispatch path", () => {
  it("selects every configured, policy-permitted channel", () => {
    const plan = planNotificationDispatch(makeNotification(), ALL_CONFIGURED);
    expect(plan.decision).toBe("dispatch");
    if (plan.decision === "dispatch") {
      expect(plan.selectedChannels).toEqual(["in_app", "email", "sms", "web_push"]);
      expect(plan.omissions).toEqual([]);
    }
  });

  it("records unconfigured channels as explicit omissions, never silently", () => {
    const plan = planNotificationDispatch(makeNotification(), {
      in_app: true,
      email: false,
      sms: false,
      web_push: false,
    });
    expect(plan.decision).toBe("dispatch");
    if (plan.decision === "dispatch") {
      expect(plan.selectedChannels).toEqual(["in_app"]);
      expect(plan.omissions).toEqual([
        { channel: "email", reason: "channel_not_configured" },
        { channel: "sms", reason: "channel_not_configured" },
        { channel: "web_push", reason: "channel_not_configured" },
      ]);
    }
  });

  it("keeps in_app when email is configured for a non-restricted category", () => {
    const plan = planNotificationDispatch(makeNotification({ category: "system" }), {
      in_app: true,
      email: true,
      sms: false,
      web_push: false,
    });
    expect(plan.decision).toBe("dispatch");
    if (plan.decision === "dispatch") {
      expect(plan.selectedChannels).toEqual(["in_app", "email"]);
    }
  });
});

describe("planNotificationDispatch — fail-closed path", () => {
  it("fails closed when NO channel is available", () => {
    const plan = planNotificationDispatch(makeNotification(), NONE_CONFIGURED);
    expect(plan.decision).toBe("fail_closed");
    if (plan.decision === "fail_closed") {
      expect(plan.omissions).toEqual([
        { channel: "in_app", reason: "channel_not_configured" },
        { channel: "email", reason: "channel_not_configured" },
        { channel: "sms", reason: "channel_not_configured" },
        { channel: "web_push", reason: "channel_not_configured" },
      ]);
      expect(plan.reason).toContain("failing closed");
    }
  });

  it("fails closed when a restricted category meets only non-in_app channels", () => {
    const plan = planNotificationDispatch(makeNotification({ category: "escalation" }), {
      in_app: false,
      email: true,
      sms: true,
      web_push: true,
    });
    expect(plan.decision).toBe("fail_closed");
    if (plan.decision === "fail_closed") {
      expect(plan.omissions).toEqual([
        { channel: "in_app", reason: "channel_not_configured" },
        { channel: "email", reason: "category_not_permitted" },
        { channel: "sms", reason: "category_not_permitted" },
        { channel: "web_push", reason: "category_not_permitted" },
      ]);
    }
  });
});

describe("planNotificationDispatch — policy negatives", () => {
  it("denies a restricted category on sms while in_app still dispatches", () => {
    const plan = planNotificationDispatch(
      makeNotification({ category: "approval_request" }),
      ALL_CONFIGURED,
    );
    expect(plan.decision).toBe("dispatch");
    if (plan.decision === "dispatch") {
      expect(plan.selectedChannels).toEqual(["in_app"]);
      expect(plan.omissions).toEqual([
        { channel: "email", reason: "category_not_permitted" },
        { channel: "sms", reason: "category_not_permitted" },
        { channel: "web_push", reason: "category_not_permitted" },
      ]);
    }
  });

  it("denies direct channels for an org_unit audience", () => {
    const plan = planNotificationDispatch(
      makeNotification({ audienceKind: "org_unit", recipientRef: "org-unit-1" }),
      ALL_CONFIGURED,
    );
    expect(plan.decision).toBe("dispatch");
    if (plan.decision === "dispatch") {
      expect(plan.selectedChannels).toEqual(["in_app"]);
      expect(plan.omissions).toEqual([
        { channel: "email", reason: "audience_not_supported" },
        { channel: "sms", reason: "audience_not_supported" },
        { channel: "web_push", reason: "audience_not_supported" },
      ]);
    }
  });

  it("denies sms for a role audience", () => {
    const plan = planNotificationDispatch(
      makeNotification({ audienceKind: "role", recipientRef: "role-bursar" }),
      ALL_CONFIGURED,
    );
    expect(plan.decision).toBe("dispatch");
    if (plan.decision === "dispatch") {
      expect(plan.selectedChannels).toEqual(["in_app", "email"]);
      expect(plan.omissions).toEqual([
        { channel: "sms", reason: "audience_not_supported" },
        { channel: "web_push", reason: "audience_not_supported" },
      ]);
    }
  });
});
