/**
 * CoreGrid Scholar — Core Application Runtime extended module tests.
 *
 * Covers:
 * - runtime-webhooks.ts: signature validation, delivery tracking, retry
 * - runtime-integrations.ts: adapter registry, availability, anti-corruption
 * - runtime-resilience.ts: circuit breakers, rate limiting, timeouts, bulkheads
 * - runtime-feature-flags.ts: rollout, tenant overrides, kill switch
 * - runtime-approval.ts: approval lifecycle, operation tracking
 * - runtime-bulk.ts: batch limits, partial failure, transfer tracking
 */

import { describe, expect, it } from "vitest";

import {
  createWebhookDelivery,
  createWebhookDeliveryTracker,
  processWebhookDelivery,
  validateWebhookSignature,
  computeWebhookSignature,
  type WebhookSender,
} from "@/lib/runtime-webhooks";

import {
  createIntegrationRegistry,
  transformExternalToCanonical,
  transformCanonicalToExternal,
  type IntegrationAdapter,
  type IntegrationAdapterHandler,
} from "@/lib/runtime-integrations";

import {
  createCircuitBreaker,
  createRateLimiter,
  createBulkhead,
  resolveTimeout,
  type TimeoutPolicy,
} from "@/lib/runtime-resilience";

import { createFeatureFlagService, type FeatureFlag } from "@/lib/runtime-feature-flags";

import { createApprovalService, createOperationTracker } from "@/lib/runtime-approval";

import {
  createBulkOperationService,
  createTransferTracker,
  type BulkItemInput,
  type BulkProcessor,
} from "@/lib/runtime-bulk";

const NOW = "2026-08-22T12:00:00.000Z";

/* ─────────────────────────────────────────────────────────────
 * Webhook tests
 * ────────────────────────────────────────────────────────────*/

describe("runtime-webhooks", () => {
  describe("validateWebhookSignature", () => {
    const config = {
      secret: "test-secret",
      maxTimestampSkewMs: 60_000,
      allowedVersions: ["v1"],
    };

    it("accepts a valid signature", () => {
      const result = validateWebhookSignature(
        { signature: "a".repeat(16), timestamp: NOW, version: "v1" },
        config,
        NOW,
      );
      expect(result.valid).toBe(true);
    });

    it("rejects unsupported version", () => {
      const result = validateWebhookSignature(
        { signature: "a".repeat(16), timestamp: NOW, version: "v2" },
        config,
        NOW,
      );
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain("version");
    });

    it("rejects timestamp outside skew (replay protection)", () => {
      const result = validateWebhookSignature(
        { signature: "a".repeat(16), timestamp: "2026-08-22T10:00:00.000Z", version: "v1" },
        config,
        NOW,
      );
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain("skew");
    });

    it("rejects short signature", () => {
      const result = validateWebhookSignature(
        { signature: "short", timestamp: NOW, version: "v1" },
        config,
        NOW,
      );
      expect(result.valid).toBe(false);
    });
  });

  describe("computeWebhookSignature", () => {
    it("produces a deterministic signature", () => {
      const s1 = computeWebhookSignature({ a: 1 }, "secret", NOW);
      const s2 = computeWebhookSignature({ a: 1 }, "secret", NOW);
      expect(s1).toBe(s2);
      expect(s1.length).toBeGreaterThanOrEqual(16);
    });

    it("produces different signatures for different payloads", () => {
      const s1 = computeWebhookSignature({ a: 1 }, "secret", NOW);
      const s2 = computeWebhookSignature({ a: 2 }, "secret", NOW);
      expect(s1).not.toBe(s2);
    });
  });

  describe("webhook delivery", () => {
    it("creates a delivery with pending status", () => {
      const delivery = createWebhookDelivery({
        endpoint: "https://example.com/hook",
        eventName: "student.enrolled",
        eventId: "evt-1",
        tenantId: null,
        correlationId: "corr-1" as never,
        payload: { studentId: "s1" },
        now: NOW,
      });
      expect(delivery.status).toBe("pending");
      expect(delivery.attempts).toHaveLength(0);
      expect(delivery.maxAttempts).toBe(3);
    });

    it("tracks delivery and marks delivered on success", async () => {
      const tracker = createWebhookDeliveryTracker();
      const delivery = createWebhookDelivery({
        endpoint: "https://example.com/hook",
        eventName: "student.enrolled",
        eventId: "evt-1",
        tenantId: null,
        correlationId: "corr-1" as never,
        payload: {},
        now: NOW,
      });
      tracker.record(delivery);

      const sender: WebhookSender = {
        async send() {
          return { ok: true, status: 200, body: "{}" };
        },
      };

      const result = await processWebhookDelivery(delivery, sender, NOW);
      expect(result.status).toBe("delivered");
      expect(result.attempts).toHaveLength(1);
      expect(result.attempts[0].responseStatus).toBe(200);
      expect(result.attempts[0].retryDecision).toBe("delivered");
    });

    it("moves to dead-letter after max attempts", async () => {
      const tracker = createWebhookDeliveryTracker();
      const delivery = createWebhookDelivery({
        endpoint: "https://example.com/hook",
        eventName: "student.enrolled",
        eventId: "evt-1",
        tenantId: null,
        correlationId: "corr-1" as never,
        payload: {},
        maxAttempts: 2,
        now: NOW,
      });
      tracker.record(delivery);

      const sender: WebhookSender = {
        async send() {
          return { ok: false, error: "Connection refused" };
        },
      };

      // First attempt: retry
      let result = await processWebhookDelivery(delivery, sender, NOW);
      expect(result.status).toBe("retrying");
      expect(result.attempts).toHaveLength(1);

      // Second attempt: dead-letter
      result = await processWebhookDelivery(delivery, sender, NOW);
      expect(result.status).toBe("dead_lettered");
      expect(result.attempts).toHaveLength(2);
      expect(result.attempts[1].retryDecision).toBe("permanent_failure");
    });
  });
});

/* ─────────────────────────────────────────────────────────────
 * Integration tests
 * ────────────────────────────────────────────────────────────*/

describe("runtime-integrations", () => {
  it("registers and finds adapters", () => {
    const registry = createIntegrationRegistry();
    const adapter: IntegrationAdapter = {
      name: "paystack",
      version: "1.0.0",
      status: "active",
      requiresTenantContext: true,
      isPlatformOnly: false,
      handlesSensitiveData: true,
      sensitive: true,
    };
    const handler: IntegrationAdapterHandler = {
      async execute() {
        return { ok: true, data: { status: "ok" } };
      },
    };
    registry.register(adapter, handler);
    expect(registry.find("paystack")).toBe(adapter);
    expect(registry.find("unknown")).toBeNull();
  });

  it("enforces tenant context for tenant-scoped adapters", () => {
    const registry = createIntegrationRegistry();
    const adapter: IntegrationAdapter = {
      name: "paystack",
      version: "1.0.0",
      status: "active",
      requiresTenantContext: true,
      isPlatformOnly: false,
      handlesSensitiveData: true,
      sensitive: true,
    };
    registry.register(adapter, {
      async execute() {
        return { ok: true, data: {} };
      },
    });
    expect(registry.isAvailable("paystack", null)).toBe(false);
    expect(registry.isAvailable("paystack", "tenant-1" as never)).toBe(true);
  });

  it("blocks disabled adapters", () => {
    const registry = createIntegrationRegistry();
    const adapter: IntegrationAdapter = {
      name: "twilio",
      version: "1.0.0",
      status: "disabled",
      requiresTenantContext: false,
      isPlatformOnly: false,
      handlesSensitiveData: false,
      sensitive: false,
    };
    registry.register(adapter, {
      async execute() {
        return { ok: true, data: {} };
      },
    });
    expect(registry.isAvailable("twilio", null)).toBe(false);
  });

  it("transforms external data to canonical (anti-corruption)", () => {
    const external = { external_id: "123", external_name: "John" };
    const canonical = transformExternalToCanonical(external, (e: unknown) => {
      const raw = e as typeof external;
      return { id: raw.external_id, name: raw.external_name };
    });
    expect(canonical).toEqual({ id: "123", name: "John" });
  });

  it("transforms canonical data to external", () => {
    const canonical = { id: "123", name: "John" };
    const external = transformCanonicalToExternal(canonical, (c: unknown) => {
      const raw = c as typeof canonical;
      return { external_id: raw.id, external_name: raw.name };
    });
    expect(external).toEqual({ external_id: "123", external_name: "John" });
  });
});

/* ─────────────────────────────────────────────────────────────
 * Resilience tests
 * ────────────────────────────────────────────────────────────*/

describe("runtime-resilience", () => {
  describe("circuit breaker", () => {
    it("starts closed and allows calls", () => {
      const cb = createCircuitBreaker({
        failureThreshold: 3,
        resetTimeoutMs: 1000,
        successThreshold: 2,
      });
      expect(cb.state).toBe("closed");
      expect(cb.allowCall(NOW)).toBe(true);
    });

    it("opens after failure threshold", () => {
      const cb = createCircuitBreaker({
        failureThreshold: 3,
        resetTimeoutMs: 1000,
        successThreshold: 2,
      });
      cb.recordFailure(NOW);
      cb.recordFailure(NOW);
      expect(cb.state).toBe("closed");
      cb.recordFailure(NOW);
      expect(cb.state).toBe("open");
      expect(cb.allowCall(NOW)).toBe(false);
    });

    it("transitions to half-open after reset timeout", () => {
      const cb = createCircuitBreaker({
        failureThreshold: 1,
        resetTimeoutMs: 1000,
        successThreshold: 2,
      });
      cb.recordFailure(NOW);
      expect(cb.state).toBe("open");
      const later = "2026-08-22T12:00:02.000Z";
      expect(cb.allowCall(later)).toBe(true);
      expect(cb.state).toBe("half_open");
    });

    it("closes after success threshold in half-open", () => {
      const cb = createCircuitBreaker({
        failureThreshold: 1,
        resetTimeoutMs: 1000,
        successThreshold: 2,
      });
      cb.recordFailure(NOW);
      const later = "2026-08-22T12:00:02.000Z";
      cb.allowCall(later);
      cb.recordSuccess(later);
      expect(cb.state).toBe("half_open");
      cb.recordSuccess(later);
      expect(cb.state).toBe("closed");
    });
  });

  describe("rate limiter", () => {
    it("allows requests within limit", () => {
      const rl = createRateLimiter();
      const rule = { scope: "tenant" as const, scopeId: "t1", limit: 3, windowMs: 60_000 };
      expect(rl.check(rule, NOW).allowed).toBe(true);
      expect(rl.check(rule, NOW).allowed).toBe(true);
      expect(rl.check(rule, NOW).allowed).toBe(true);
    });

    it("blocks requests over limit", () => {
      const rl = createRateLimiter();
      const rule = { scope: "tenant" as const, scopeId: "t1", limit: 2, windowMs: 60_000 };
      rl.check(rule, NOW);
      rl.check(rule, NOW);
      const result = rl.check(rule, NOW);
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).not.toBeNull();
    });

    it("resets window after timeout", () => {
      const rl = createRateLimiter();
      const rule = { scope: "tenant" as const, scopeId: "t1", limit: 1, windowMs: 1000 };
      rl.check(rule, NOW);
      const later = "2026-08-22T12:00:02.000Z";
      expect(rl.check(rule, later).allowed).toBe(true);
    });

    it("resets manually", () => {
      const rl = createRateLimiter();
      const rule = { scope: "tenant" as const, scopeId: "t1", limit: 1, windowMs: 60_000 };
      rl.check(rule, NOW);
      rl.reset("tenant", "t1");
      expect(rl.check(rule, NOW).allowed).toBe(true);
    });
  });

  describe("timeout policy", () => {
    it("resolves default timeout", () => {
      const policy: TimeoutPolicy = { defaultTimeoutMs: 5000, overrides: {}, maxTimeoutMs: 30_000 };
      expect(resolveTimeout(policy, "any")).toBe(5000);
    });

    it("resolves override", () => {
      const policy: TimeoutPolicy = {
        defaultTimeoutMs: 5000,
        overrides: { slow: 10_000 },
        maxTimeoutMs: 30_000,
      };
      expect(resolveTimeout(policy, "slow")).toBe(10_000);
    });

    it("caps at max timeout", () => {
      const policy: TimeoutPolicy = {
        defaultTimeoutMs: 5000,
        overrides: { slow: 60_000 },
        maxTimeoutMs: 30_000,
      };
      expect(resolveTimeout(policy, "slow")).toBe(30_000);
    });
  });

  describe("bulkhead", () => {
    it("limits concurrent calls", () => {
      const bh = createBulkhead({ maxConcurrent: 2, maxQueueSize: 1 });
      expect(bh.tryAcquire()).toBe(true);
      expect(bh.tryAcquire()).toBe(true);
      expect(bh.tryAcquire()).toBe(true); // queued
      expect(bh.tryAcquire()).toBe(false); // full
      expect(bh.activeCount()).toBe(2);
      expect(bh.queuedCount()).toBe(1);
    });

    it("releases slots", () => {
      const bh = createBulkhead({ maxConcurrent: 1, maxQueueSize: 1 });
      bh.tryAcquire();
      bh.tryAcquire(); // queued
      bh.release();
      expect(bh.queuedCount()).toBe(0);
      expect(bh.activeCount()).toBe(1);
    });
  });
});

/* ─────────────────────────────────────────────────────────────
 * Feature flag tests
 * ────────────────────────────────────────────────────────────*/

describe("runtime-feature-flags", () => {
  it("enables by default", () => {
    const svc = createFeatureFlagService();
    const flag: FeatureFlag = {
      name: "ai-tutor",
      status: "enabled",
      enabledByDefault: true,
      tenantOverrides: {},
      rolloutPercentage: 100,
      killSwitchEnabled: true,
      killSwitched: false,
      description: "AI tutor",
    };
    svc.register(flag);
    expect(svc.isEnabled("ai-tutor", { tenantId: null, rolloutKey: "user-1" })).toBe(true);
  });

  it("disables when status is disabled", () => {
    const svc = createFeatureFlagService();
    const flag: FeatureFlag = {
      name: "ai-tutor",
      status: "disabled",
      enabledByDefault: true,
      tenantOverrides: {},
      rolloutPercentage: 100,
      killSwitchEnabled: true,
      killSwitched: false,
      description: "AI tutor",
    };
    svc.register(flag);
    expect(svc.isEnabled("ai-tutor", { tenantId: null, rolloutKey: "user-1" })).toBe(false);
  });

  it("applies tenant overrides", () => {
    const svc = createFeatureFlagService();
    const flag: FeatureFlag = {
      name: "ai-tutor",
      status: "enabled",
      enabledByDefault: false,
      tenantOverrides: {},
      rolloutPercentage: 100,
      killSwitchEnabled: true,
      killSwitched: false,
      description: "AI tutor",
    };
    svc.register(flag);
    svc.setTenantOverride("ai-tutor", "tenant-1", true);
    expect(svc.isEnabled("ai-tutor", { tenantId: "tenant-1" as never, rolloutKey: "user-1" })).toBe(
      true,
    );
    expect(svc.isEnabled("ai-tutor", { tenantId: "tenant-2" as never, rolloutKey: "user-1" })).toBe(
      false,
    );
  });

  it("kill switch disables feature", () => {
    const svc = createFeatureFlagService();
    const flag: FeatureFlag = {
      name: "ai-tutor",
      status: "enabled",
      enabledByDefault: true,
      tenantOverrides: {},
      rolloutPercentage: 100,
      killSwitchEnabled: true,
      killSwitched: false,
      description: "AI tutor",
    };
    svc.register(flag);
    expect(svc.emergencyDisable("ai-tutor")).toBe(true);
    expect(svc.isEnabled("ai-tutor", { tenantId: null, rolloutKey: "user-1" })).toBe(false);
    expect(svc.emergencyEnable("ai-tutor")).toBe(true);
    expect(svc.isEnabled("ai-tutor", { tenantId: null, rolloutKey: "user-1" })).toBe(true);
  });

  it("respects percentage rollout", () => {
    const svc = createFeatureFlagService();
    const flag: FeatureFlag = {
      name: "beta-feature",
      status: "enabled",
      enabledByDefault: true,
      tenantOverrides: {},
      rolloutPercentage: 0,
      killSwitchEnabled: false,
      killSwitched: false,
      description: "Beta",
    };
    svc.register(flag);
    expect(svc.isEnabled("beta-feature", { tenantId: null, rolloutKey: "user-1" })).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Approval tests
 * ────────────────────────────────────────────────────────────*/

describe("runtime-approval", () => {
  it("creates a pending approval request", () => {
    const svc = createApprovalService();
    const req = svc.request({
      operationId: "op-1" as never,
      commandName: "DeleteStudent",
      tenantId: null,
      correlationId: "corr-1" as never,
      requestedBy: "user-1",
      reason: "Sensitive operation",
      payload: { studentId: "s1" },
      now: NOW,
    });
    expect(req.status).toBe("pending");
    expect(req.approvedBy).toBeNull();
  });

  it("approves a pending request", () => {
    const svc = createApprovalService();
    const req = svc.request({
      operationId: "op-1" as never,
      commandName: "DeleteStudent",
      tenantId: null,
      correlationId: "corr-1" as never,
      requestedBy: "user-1",
      reason: "Sensitive",
      payload: {},
      now: NOW,
    });
    const result = svc.approve(req.id, "admin-1", NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.status).toBe("approved");
      expect(result.request.approvedBy).toBe("admin-1");
    }
  });

  it("rejects a pending request", () => {
    const svc = createApprovalService();
    const req = svc.request({
      operationId: "op-1" as never,
      commandName: "DeleteStudent",
      tenantId: null,
      correlationId: "corr-1" as never,
      requestedBy: "user-1",
      reason: "Sensitive",
      payload: {},
      now: NOW,
    });
    const result = svc.reject(req.id, "admin-1", "Not authorized", NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.status).toBe("rejected");
      expect(result.request.rejectionReason).toBe("Not authorized");
    }
  });

  it("cannot approve an already-approved request", () => {
    const svc = createApprovalService();
    const req = svc.request({
      operationId: "op-1" as never,
      commandName: "DeleteStudent",
      tenantId: null,
      correlationId: "corr-1" as never,
      requestedBy: "user-1",
      reason: "Sensitive",
      payload: {},
      now: NOW,
    });
    svc.approve(req.id, "admin-1", NOW);
    const result = svc.approve(req.id, "admin-2", NOW);
    expect(result.ok).toBe(false);
  });

  it("expires requests past expiry", () => {
    const svc = createApprovalService();
    const req = svc.request({
      operationId: "op-1" as never,
      commandName: "DeleteStudent",
      tenantId: null,
      correlationId: "corr-1" as never,
      requestedBy: "user-1",
      reason: "Sensitive",
      payload: {},
      expiresAt: "2026-08-22T11:00:00.000Z",
      now: NOW,
    });
    expect(svc.isExpired(req, NOW)).toBe(true);
    const result = svc.approve(req.id, "admin-1", NOW);
    expect(result.ok).toBe(false);
  });

  describe("operation tracker", () => {
    it("tracks operation lifecycle", () => {
      const tracker = createOperationTracker();
      const op = tracker.start({
        operationId: "op-1" as never,
        commandName: "EnrollStudent",
        tenantId: null,
        correlationId: "corr-1" as never,
        now: NOW,
      });
      expect(op.status).toBe("running");

      expect(tracker.complete("op-1" as never, { id: "s1" }, NOW)).toBe(true);
      const found = tracker.find("op-1" as never);
      expect(found?.status).toBe("succeeded");
      expect(found?.result).toEqual({ id: "s1" });
    });

    it("tracks failures", () => {
      const tracker = createOperationTracker();
      tracker.start({
        operationId: "op-1" as never,
        commandName: "EnrollStudent",
        tenantId: null,
        correlationId: "corr-1" as never,
        now: NOW,
      });
      expect(tracker.fail("op-1" as never, "Validation failed", NOW)).toBe(true);
      const found = tracker.find("op-1" as never);
      expect(found?.status).toBe("failed");
      expect(found?.error).toBe("Validation failed");
    });
  });
});

/* ─────────────────────────────────────────────────────────────
 * Bulk operation tests
 * ────────────────────────────────────────────────────────────*/

describe("runtime-bulk", () => {
  it("enforces maximum batch size", async () => {
    const svc = createBulkOperationService();
    const items: BulkItemInput[] = Array.from({ length: 10 }, (_, i) => ({
      itemId: `item-${i}`,
      payload: i,
    }));
    const processor: BulkProcessor = {
      async processItem(item: BulkItemInput) {
        return {
          index: 0,
          itemId: item.itemId,
          status: "succeeded",
          result: item.payload,
          error: null,
        };
      },
    };
    const result = await svc.execute(
      items,
      processor,
      { maxBatchSize: 3, allowPartialFailure: true, idempotent: true },
      {
        tenantId: null,
        correlationId: "corr-1" as never,
        now: NOW,
      },
    );
    expect(result.totalItems).toBe(3);
    expect(result.succeededCount).toBe(3);
  });

  it("reports partial failure", async () => {
    const svc = createBulkOperationService();
    const items: BulkItemInput[] = [
      { itemId: "ok", payload: 1 },
      { itemId: "bad", payload: 2 },
    ];
    const processor: BulkProcessor = {
      async processItem(item: BulkItemInput) {
        if (item.itemId === "bad") {
          return {
            index: 1,
            itemId: item.itemId,
            status: "failed",
            result: null,
            error: "Invalid",
          };
        }
        return {
          index: 0,
          itemId: item.itemId,
          status: "succeeded",
          result: item.payload,
          error: null,
        };
      },
    };
    const result = await svc.execute(
      items,
      processor,
      { maxBatchSize: 10, allowPartialFailure: true, idempotent: true },
      {
        tenantId: null,
        correlationId: "corr-1" as never,
        now: NOW,
      },
    );
    expect(result.succeededCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.hasPartialFailure).toBe(true);
    expect(result.allSucceeded).toBe(false);
  });

  it("catches processor exceptions", async () => {
    const svc = createBulkOperationService();
    const items: BulkItemInput[] = [{ itemId: "bad", payload: 1 }];
    const processor: BulkProcessor = {
      async processItem() {
        throw new Error("Boom");
      },
    };
    const result = await svc.execute(
      items,
      processor,
      { maxBatchSize: 10, allowPartialFailure: true, idempotent: true },
      {
        tenantId: null,
        correlationId: "corr-1" as never,
        now: NOW,
      },
    );
    expect(result.failedCount).toBe(1);
    expect(result.items[0].error).toBe("Boom");
  });

  describe("transfer tracker", () => {
    it("tracks import/export progress", () => {
      const tracker = createTransferTracker();
      const job = tracker.create({
        type: "import",
        tenantId: null,
        correlationId: "corr-1" as never,
        totalItems: 100,
        now: NOW,
      });
      expect(job.status).toBe("pending");

      expect(tracker.updateProgress(job.id, 50, NOW)).toBe(true);
      expect(tracker.find(job.id)?.processedItems).toBe(50);
      expect(tracker.find(job.id)?.status).toBe("running");

      expect(tracker.complete(job.id, NOW)).toBe(true);
      expect(tracker.find(job.id)?.status).toBe("succeeded");
    });

    it("tracks failures", () => {
      const tracker = createTransferTracker();
      const job = tracker.create({
        type: "export",
        tenantId: null,
        correlationId: "corr-1" as never,
        totalItems: 10,
        now: NOW,
      });
      expect(tracker.fail(job.id, "Storage error", NOW)).toBe(true);
      expect(tracker.find(job.id)?.status).toBe("failed");
      expect(tracker.find(job.id)?.error).toBe("Storage error");
    });
  });
});
