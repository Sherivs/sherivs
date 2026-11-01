/**
 * Sherivs Scholar — Phase 10 Communication Platform unit tests
 * (communication-core).
 *
 * Validates:
 * - Message contract creation and validation (F.1).
 * - Tenant consistency and message expiration (DN, F.1).
 * - Notification contract creation and state transitions (F.2, Y).
 * - Idempotency guard (X).
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  createMessage,
  isMessageTenantConsistent,
  isMessageExpired,
  priorityRank,
  createNotification,
  transitionNotification,
  checkIdempotency,
  type CommunicationMessage,
  type IdempotencyRecord,
  type Notification,
} from "@/lib/communication-core";

const TENANT_A = tenantId("tenant-a");
const TENANT_B = tenantId("tenant-b");
const NOW = "2026-01-01T00:00:00Z";

function makeMessage(overrides: Partial<CommunicationMessage> = {}): CommunicationMessage {
  const created = createMessage({
    tenantId: TENANT_A,
    orgId: TENANT_A,
    sender: "admin-1",
    recipientUserIds: ["user-1", "user-2"],
    channel: "in_app",
    subject: "Staff meeting",
    content: "Tomorrow 10am",
    correlationId: "corr-1",
    idempotencyKey: "idem-1",
    now: NOW,
  });
  if (!created.ok) throw new Error("fixture failed");
  return { ...created.message, ...overrides };
}

describe("createMessage (F.1)", () => {
  it("creates a message with all contract fields", () => {
    const message = makeMessage();
    expect(message.sender).toBe("admin-1");
    expect(message.orgId).toBe(TENANT_A);
    expect(message.priority).toBe("NORMAL");
    expect(message.classification).toBe("INTERNAL");
    expect(message.recipientUserIds).toHaveLength(2);
  });

  it("rejects a message without a sender", () => {
    const result = createMessage({
      tenantId: TENANT_A,
      orgId: TENANT_A,
      sender: "",
      recipientUserIds: ["user-1"],
      channel: "in_app",
      subject: "Hi",
      content: "",
      correlationId: "corr-1",
      idempotencyKey: "idem-1",
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a message with no recipients", () => {
    const result = createMessage({
      tenantId: TENANT_A,
      orgId: TENANT_A,
      sender: "admin-1",
      recipientUserIds: [],
      channel: "in_app",
      subject: "Hi",
      content: "",
      correlationId: "corr-1",
      idempotencyKey: "idem-1",
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a message with neither subject nor content", () => {
    const result = createMessage({
      tenantId: TENANT_A,
      orgId: TENANT_A,
      sender: "admin-1",
      recipientUserIds: ["user-1"],
      channel: "in_app",
      subject: "",
      content: "",
      correlationId: "corr-1",
      idempotencyKey: "idem-1",
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a message without a correlation id (CB)", () => {
    const result = createMessage({
      tenantId: TENANT_A,
      orgId: TENANT_A,
      sender: "admin-1",
      recipientUserIds: ["user-1"],
      channel: "in_app",
      subject: "Hi",
      content: "",
      correlationId: "",
      idempotencyKey: "idem-1",
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an org mismatch and blank recipient identifiers", () => {
    const mismatch = createMessage({
      tenantId: TENANT_A,
      orgId: TENANT_B,
      sender: "admin-1",
      recipientUserIds: ["user-1"],
      channel: "whatsapp",
      subject: "Hi",
      content: "",
      correlationId: "corr-1",
      idempotencyKey: "idem-1",
      now: NOW,
    });
    const blankRecipient = createMessage({
      tenantId: TENANT_A,
      orgId: TENANT_A,
      sender: "admin-1",
      recipientUserIds: [" "],
      channel: "whatsapp",
      subject: "Hi",
      content: "",
      correlationId: "corr-1",
      idempotencyKey: "idem-2",
      now: NOW,
    });
    expect(mismatch.ok).toBe(false);
    expect(blankRecipient.ok).toBe(false);
  });
});

describe("Tenant consistency and expiration (DN, F.1)", () => {
  it("is consistent only within the same tenant", () => {
    expect(isMessageTenantConsistent(makeMessage(), TENANT_A)).toBe(true);
    expect(isMessageTenantConsistent(makeMessage(), TENANT_B)).toBe(false);
  });

  it("detects an expired message", () => {
    const expired = makeMessage({ expiresAt: "2025-12-31T00:00:00Z" });
    expect(isMessageExpired(expired, NOW)).toBe(true);
    expect(isMessageExpired(makeMessage(), NOW)).toBe(false);
  });
});

describe("priorityRank (Y)", () => {
  it("orders priorities without implying security bypass", () => {
    expect(priorityRank("LOW")).toBeLessThan(priorityRank("NORMAL"));
    expect(priorityRank("NORMAL")).toBeLessThan(priorityRank("HIGH"));
    expect(priorityRank("HIGH")).toBeLessThan(priorityRank("URGENT"));
    expect(priorityRank("URGENT")).toBeLessThan(priorityRank("CRITICAL"));
  });
});

describe("createNotification / transitionNotification (F.2)", () => {
  function makeNotification(overrides: Partial<Notification> = {}): Notification {
    const created = createNotification({
      recipient: "user-1",
      eventSource: "assignment.created",
      category: "academic",
      message: "New feedback available",
      channels: ["in_app", "push"],
      requiresAcknowledgement: true,
      now: NOW,
    });
    if (!created.ok) throw new Error("fixture failed");
    return { ...created.notification, ...overrides };
  }

  it("creates a pending notification with acknowledgement requirement", () => {
    const notification = makeNotification();
    expect(notification.deliveryState).toBe("pending");
    expect(notification.requiresAcknowledgement).toBe(true);
  });

  it("rejects a notification without a recipient or event source", () => {
    const noRecipient = createNotification({
      recipient: "",
      eventSource: "x",
      category: "c",
      message: "m",
      channels: ["in_app"],
      now: NOW,
    });
    expect(noRecipient.ok).toBe(false);

    const noSource = createNotification({
      recipient: "user-1",
      eventSource: "",
      category: "c",
      message: "m",
      channels: ["in_app"],
      now: NOW,
    });
    expect(noSource.ok).toBe(false);
  });

  it("moves pending -> queued -> delivered -> acknowledged", () => {
    const notification = makeNotification();
    const queued = transitionNotification(notification, "queued", NOW);
    if (!queued.ok) throw new Error("fixture failed");
    const delivered = transitionNotification(queued.notification, "delivered", NOW);
    if (!delivered.ok) throw new Error("fixture failed");
    const acknowledged = transitionNotification(delivered.notification, "acknowledged", NOW);
    expect(acknowledged.ok).toBe(true);
    if (acknowledged.ok) {
      expect(acknowledged.notification.acknowledgedAt).toBe(NOW);
    }
  });

  it("rejects an invalid transition (pending -> acknowledged)", () => {
    const notification = makeNotification();
    const result = transitionNotification(notification, "acknowledged", NOW);
    expect(result.ok).toBe(false);
  });

  it("allows failed -> queued retry and suppresses", () => {
    const notification = makeNotification();
    const failed = transitionNotification(notification, "failed", NOW);
    if (!failed.ok) throw new Error("fixture failed");
    const retried = transitionNotification(failed.notification, "queued", NOW);
    expect(retried.ok).toBe(true);

    const suppressed = transitionNotification(makeNotification(), "suppressed", NOW);
    expect(suppressed.ok).toBe(true);
  });
});

describe("checkIdempotency (X)", () => {
  function makeRegistry(): Map<string, IdempotencyRecord> {
    return new Map<string, IdempotencyRecord>();
  }

  it("allows the first call and blocks a replay with the same key", () => {
    const seen = makeRegistry();
    const first = checkIdempotency("idem-key-1", seen, NOW);
    expect(first.proceed).toBe(true);
    const replay = checkIdempotency("idem-key-1", seen, NOW);
    expect(replay.proceed).toBe(false);
    expect(replay.record.result).toBe("duplicate");
  });

  it("allows distinct idempotency keys", () => {
    const seen = makeRegistry();
    expect(checkIdempotency("idem-key-1", seen, NOW).proceed).toBe(true);
    expect(checkIdempotency("idem-key-2", seen, NOW).proceed).toBe(true);
  });
});
