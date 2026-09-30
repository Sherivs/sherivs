// ─── Phase 22 — Mobile Platform: platform-offline & observability ────
import { describe, it, expect } from "vitest";
import {
  createSyncOperation,
  createCacheEntry,
  isCacheExpired,
  markAsStale,
  computeEviction,
  shouldUseLowBandwidth,
  shouldThrottleSync,
} from "@/lib/platform-offline";
import {
  createTelemetryEvent,
  checkVersionCompatibility,
  createAIInteraction,
  createClientAuditEvent,
  evaluateOTAUpdateState,
} from "@/lib/platform-observability";

describe("platform-offline — Sync Operation", () => {
  it("creates pending sync operation", () => {
    const op = createSyncOperation({
      entityType: "grade",
      entityId: "grade-123",
      operation: "update",
      payload: { score: 85 },
    });
    expect(op.status).toBe("pending");
    expect(op.entityType).toBe("grade");
    expect(op.retryCount).toBe(0);
  });

  it("rejects missing entity type", () => {
    expect(() =>
      createSyncOperation({ entityType: "", entityId: "x", operation: "create", payload: {} }),
    ).toThrow();
  });
});

describe("platform-offline — Cache Entry", () => {
  it("creates non-expired cache entry", () => {
    const e = createCacheEntry({ id: "grade-123", data: { score: 85 }, ttlMs: 60000 });
    expect(e.version).toBe(1);
    expect(e.stale).toBe(false);
    expect(isCacheExpired(e)).toBe(false);
  });

  it("marks entry as stale", () => {
    const e = createCacheEntry({ id: "x", data: {}, ttlMs: 60000 });
    const stale = markAsStale(e);
    expect(stale.stale).toBe(true);
  });
});

describe("platform-offline — Eviction", () => {
  it("does not evict when under limit", () => {
    const r = computeEviction(500, 1000, "lru");
    expect(r.needsEviction).toBe(false);
  });

  it("evicts when over limit", () => {
    const r = computeEviction(1500, 1000, "lru");
    expect(r.needsEviction).toBe(true);
    expect(r.bytesToFree).toBe(500);
  });
});

describe("platform-offline — Bandwidth & Power", () => {
  it("uses low bandwidth on cellular with weak signal", () => {
    expect(shouldUseLowBandwidth({ type: "cellular", strength: 2 })).toBe(true);
  });

  it("does not use low bandwidth on wifi", () => {
    expect(shouldUseLowBandwidth({ type: "wifi", strength: 5 })).toBe(false);
  });

  it("throttles sync on low power mode", () => {
    expect(shouldThrottleSync(true, 0.5)).toBe(true);
  });

  it("throttles sync on low battery", () => {
    expect(shouldThrottleSync(false, 0.15)).toBe(true);
  });

  it("does not throttle when battery is healthy", () => {
    expect(shouldThrottleSync(false, 0.8)).toBe(false);
  });
});

describe("platform-observability — Telemetry", () => {
  it("creates anonymized telemetry event", () => {
    const e = createTelemetryEvent({
      eventType: "screen_view",
      category: "screen_view",
      properties: { screen: "grades" },
    });
    expect(e.anonymized).toBe(true);
    expect(e.category).toBe("screen_view");
  });
});

describe("platform-observability — Version Compatibility", () => {
  it("compatible when app version meets minimum", () => {
    const r = checkVersionCompatibility("2.5.0", "2.0.0", "1.0.0");
    expect(r.compatible).toBe(true);
    expect(r.requiredUpgrade).toBe(false);
  });

  it("incompatible when app version is below minimum", () => {
    const r = checkVersionCompatibility("1.9.0", "2.0.0", "1.0.0");
    expect(r.compatible).toBe(false);
    expect(r.requiredUpgrade).toBe(true);
  });
});

describe("platform-observability — AI Interaction", () => {
  it("creates AI interaction record", () => {
    const ai = createAIInteraction({
      agentId: "agent-1",
      prompt: "Hello",
      response: "Hi there",
      durationMs: 1500,
      streaming: true,
    });
    expect(ai.agentId).toBe("agent-1");
    expect(ai.streaming).toBe(true);
  });
});

describe("platform-observability — Client Audit", () => {
  it("creates client audit event", () => {
    const e = createClientAuditEvent({
      eventType: "payment_initiated",
      actorId: "user-1",
      action: "view",
      resourceType: "invoice",
      resourceId: "INV-001",
    });
    expect(e.actorId).toBe("user-1");
    expect(e.offlineGenerated).toBe(false);
  });
});

describe("platform-observability — OTA Update State", () => {
  it("evaluates download state", () => {
    const s = evaluateOTAUpdateState(true, true, 50);
    expect(s.available).toBe(true);
    expect(s.downloading).toBe(true);
    expect(s.downloaded).toBe(false);
  });

  it("marks as downloaded when complete", () => {
    const s = evaluateOTAUpdateState(true, false, 100);
    expect(s.downloaded).toBe(true);
  });
});
