/**
 * Sherivs — notification contract tests (state machine, receipts, policy, tenant).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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
import {
  digestWindowKey,
  filterDigestNotifications,
  isMandatoryNotificationType,
  isWithinQuietHours,
  shouldDeliverInAppNotification,
} from "../../frontend/src/lib/notifications/delivery-policy";
import { selectActiveMembershipRecipientIds } from "../../frontend/src/lib/notifications/membership-recipients";
import { createNotificationIdempotencyKey } from "../../frontend/src/lib/notifications/delivery-key.server";

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

describe("notification contract (tenant isolation, §17)", () => {
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

  describe("V1 notification delivery policy", () => {
    it("honors category opt-outs and quiet hours, including windows crossing midnight", () => {
      expect(
        shouldDeliverInAppNotification("grades_published", "grades", { inapp_grades: false }, 600),
      ).toBe(false);
      expect(isWithinQuietHours("22:00:00", "07:00:00", 30)).toBe(true);
      expect(
        shouldDeliverInAppNotification(
          "grades_published",
          "grades",
          { quiet_hours_start: "22:00:00", quiet_hours_end: "07:00:00" },
          30,
        ),
      ).toBe(false);
      expect(shouldDeliverInAppNotification("grades_published", "grades", undefined, 600)).toBe(
        true,
      );
    });

    it("defines security and emergency notices as mandatory and excludes them from digests", () => {
      const optedOutAndQuiet = {
        inapp_messages: false,
        quiet_hours_start: "22:00",
        quiet_hours_end: "07:00",
      };
      expect(isMandatoryNotificationType("security")).toBe(true);
      expect(isMandatoryNotificationType("emergency")).toBe(true);
      expect(shouldDeliverInAppNotification("security", "messages", optedOutAndQuiet, 30)).toBe(
        true,
      );
      expect(
        filterDigestNotifications(
          [
            { type: "grades_published" },
            { type: "security" },
            { type: "emergency" },
            { type: "unknown" },
          ],
          optedOutAndQuiet,
          600,
        ),
      ).toEqual([{ type: "grades_published" }]);
    });

    it("uses stable per-period and per-event keys for replay-safe inserts", () => {
      const monday = Date.parse("2026-11-02T12:00:00.000Z");
      const laterMonday = Date.parse("2026-11-02T18:00:00.000Z");
      expect(digestWindowKey("daily", monday)).toBe("2026-11-02");
      expect(digestWindowKey("weekly", monday)).toBe("2026-11-02");
      expect(digestWindowKey("weekly", laterMonday)).toBe("2026-11-02");
      expect(createNotificationIdempotencyKey("grades", "class-a:term-1:2026")).toBe(
        createNotificationIdempotencyKey("grades", "class-a:term-1:2026"),
      );
      expect(createNotificationIdempotencyKey("grades", "class-a:term-1:2026")).not.toBe(
        createNotificationIdempotencyKey("grades", "class-a:term-2:2026"),
      );
    });

    it("keeps CORE-19 runtime in-app only and preserves database tenant/idempotency guards", () => {
      const fanout = readFileSync(
        new URL(
          "../../frontend/src/lib/runtime/scholar/notifications-fanout.functions.ts",
          import.meta.url,
        ),
        "utf8",
      );
      const writer = fanout.slice(
        fanout.indexOf("async function insertNotificationRows"),
        fanout.indexOf("// ---------------- Grades published"),
      );
      const digest = readFileSync(
        new URL(
          "../../frontend/src/lib/runtime/scholar/notification-digest.functions.ts",
          import.meta.url,
        ),
        "utf8",
      );
      const migration = readFileSync(
        new URL(
          "../../database/supabase/migrations/20261103143000_core19_notification_delivery.sql",
          import.meta.url,
        ),
        "utf8",
      );
      const notificationPolicies = readFileSync(
        new URL(
          "../../database/supabase/migrations/20260622044140_557cda0e-ae5c-4abc-b1ef-51ea89d09ff5.sql",
          import.meta.url,
        ),
        "utf8",
      );
      const preferencePolicies = readFileSync(
        new URL(
          "../../database/supabase/migrations/20260623054451_c6c2ad41-5c74-4c10-9920-f6ef5546d4e6.sql",
          import.meta.url,
        ),
        "utf8",
      );
      const rollback = readFileSync(
        new URL(
          "../../database/supabase/rollbacks/20261103143000_core19_notification_delivery.sql",
          import.meta.url,
        ),
        "utf8",
      );
      const membershipSwitch = readFileSync(
        new URL("../../frontend/src/lib/identity/memberships.functions.ts", import.meta.url),
        "utf8",
      );

      expect(fanout).not.toContain("deliverPushToUsers");
      expect(fanout).not.toContain("@/lib/push.server");
      expect(fanout).toContain("listActiveMembershipUserIds(schoolId");
      expect(fanout).toContain('.from("organization_memberships")');
      expect(fanout).toContain('.eq("school_id", schoolId)');
      expect(fanout).toContain('onConflict: "school_id,user_id,idempotency_key"');
      expect(fanout).toContain("ignoreDuplicates: true");
      expect(fanout).toContain("await writeAuditRecord");
      expect(writer).toContain(".upsert(rows,");
      expect(writer).toContain("await writeAuditRecord");
      expect(digest).toContain('.from("organization_memberships")');
      expect(digest).toContain('.eq("user_id", uid)');
      expect(digest).toContain('onConflict: "school_id,user_id,idempotency_key"');
      expect(digest).toContain("await writeAuditRecord");
      expect(migration).toContain("core19_validate_notification_membership");
      expect(migration).toContain("public.organization_memberships");
      expect(migration).toContain("m.is_active IS TRUE");
      expect(migration).not.toContain("users_id_school_notification_uq");
      expect(migration).not.toContain("REFERENCES public.users (id, school_id)");
      expect(migration).toContain("notifications_school_user_idempotency_key_uq");
      expect(migration).toContain("ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY");
      expect(migration).toContain(
        "ALTER TABLE public.notification_preferences FORCE ROW LEVEL SECURITY",
      );
      expect(migration).not.toMatch(/CREATE\s+TABLE/i);
      expect(migration).not.toMatch(/CREATE\s+POLICY/i);
      expect(notificationPolicies.match(/CREATE POLICY.*ON public\.notifications/g)).toHaveLength(
        3,
      );
      expect(
        preferencePolicies.match(/CREATE POLICY.*ON public\.notification_preferences/g),
      ).toHaveLength(3);
      expect(membershipSwitch).toContain('.from("organization_memberships")');
      expect(membershipSwitch).toContain(
        ".update({ school_id: data.organizationId, role: membershipRole })",
      );
      expect(rollback).toContain("DROP COLUMN idempotency_key");
      expect(rollback).toContain("DROP TRIGGER core19_notification_membership_guard");
      expect(rollback).toContain("NO FORCE ROW LEVEL SECURITY");
      expect(
        rollback.indexOf("DROP INDEX public.notifications_school_user_idempotency_key_uq"),
      ).toBeLessThan(rollback.indexOf("DROP COLUMN idempotency_key"));
    });

    it("accepts active members regardless of active context and rejects non-members", () => {
      const activeContext = { user_id: "multi-member", school_id: "school-b" };
      const candidates = ["multi-member", "non-member"];
      const activeUsers = ["multi-member", "non-member"];
      const memberships = [
        { user_id: "multi-member", school_id: "school-a", is_active: true },
        { user_id: "multi-member", school_id: "school-b", is_active: true },
        { user_id: "non-member", school_id: "school-a", is_active: false },
        { user_id: "non-member", school_id: "school-c", is_active: true },
      ];

      expect(
        selectActiveMembershipRecipientIds(candidates, activeUsers, memberships, "school-a"),
      ).toEqual(["multi-member"]);
      expect(activeContext.school_id).not.toBe("school-a");
      expect(
        selectActiveMembershipRecipientIds(candidates, activeUsers, memberships, "school-b"),
      ).toEqual(["multi-member"]);
    });

    it("allows switching active organization without moving existing notifications", () => {
      const migration = readFileSync(
        new URL(
          "../../database/supabase/migrations/20261103143000_core19_notification_delivery.sql",
          import.meta.url,
        ),
        "utf8",
      );
      const switchFunction = readFileSync(
        new URL("../../frontend/src/lib/identity/memberships.functions.ts", import.meta.url),
        "utf8",
      );
      const memberships = [
        { user_id: "multi-member", school_id: "school-a", is_active: true },
        { user_id: "multi-member", school_id: "school-b", is_active: true },
      ];
      const notification = { user_id: "multi-member", school_id: "school-a" };
      const switchedContext = memberships.find(
        (membership) => membership.school_id === "school-b" && membership.is_active,
      );

      expect(switchedContext).toBeDefined();
      expect(switchFunction).toContain(
        ".update({ school_id: data.organizationId, role: membershipRole })",
      );
      expect(migration).not.toContain("REFERENCES public.users (id, school_id)");
      expect(notification.school_id).toBe("school-a");
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
