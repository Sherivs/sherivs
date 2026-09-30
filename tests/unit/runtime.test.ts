/**
 * CoreGrid Scholar — Phase 05 Core Application Runtime unit tests.
 *
 * Validates:
 * - Execution context validation (Sections DA, DB, DD).
 * - Command validation, including agent idempotency (Section CG).
 * - Query filtering/sorting allow-lists (Sections M5, M6).
 * - Event idempotency and dead-letter processing (Sections S, V).
 * - Job retry policies and backoff (Sections W1–W2, X4).
 * - Capability registry availability (Sections DA, DD).
 * - Log PII redaction (Section GV).
 */

import { describe, expect, it } from "vitest";
import { createExecutionContext, validateExecutionContext } from "@/lib/runtime-core";
import {
  createCommand,
  createRuntimeError,
  createCommandDispatcher,
  validateCommand,
  validatePagination,
  validateQueryFilters,
  validateQuerySorts,
} from "@/lib/runtime-command-query";
import {
  createApplicationEvent,
  createDuplicateDetector,
  createEventDispatcher,
  createDeadLetterQueue,
  createOutboxMessage,
} from "@/lib/runtime-events";
import { createJob, computeBackoffDelay, shouldRetry, runJob } from "@/lib/runtime-jobs";
import { createCapabilityRegistry } from "@/lib/runtime-capabilities";
import {
  redactSensitiveFields,
  createHealthStatus,
  createMetricsCollector,
} from "@/lib/runtime-observability";
import { tenantId } from "@/lib/tenant-core";
import { correlationId, operationId } from "@/lib/runtime-core";

/* ─────────────────────────────────────────────────────────────
 * ExecutionContext (Sections DA, DD)
 * ────────────────────────────────────────────────────────────*/

describe("ExecutionContext", () => {
  const tid = tenantId("tenant-1");

  it("accepts valid tenant-scoped context", () => {
    const ctx = createExecutionContext({
      source: "api",
      actorId: "user-1",
      tenantId: tid,
      tenantRequired: true,
      now: "2026-01-01T00:00:00Z",
    });
    const result = validateExecutionContext(ctx);
    expect(result.ok).toBe(true);
  });

  it("rejects tenant-scoped operation without tenant", () => {
    const ctx = createExecutionContext({
      source: "api",
      actorId: "user-1",
      tenantId: null,
      tenantRequired: true,
      now: "2026-01-01T00:00:00Z",
    });
    const result = validateExecutionContext(ctx);
    expect(result.ok).toBe(false);
  });

  it("rejects platform operation carrying tenant context", () => {
    const ctx = createExecutionContext({
      source: "internal",
      actorId: "platform-user",
      tenantId: tid,
      tenantRequired: false,
      isPlatformOperation: true,
      now: "2026-01-01T00:00:00Z",
    });
    const result = validateExecutionContext(ctx);
    expect(result.ok).toBe(false);
  });

  it("allows valid platform operation without tenant", () => {
    const ctx = createExecutionContext({
      source: "internal",
      actorId: "platform-user",
      tenantId: null,
      tenantRequired: false,
      isPlatformOperation: true,
      now: "2026-01-01T00:00:00Z",
    });
    const result = validateExecutionContext(ctx);
    expect(result.ok).toBe(true);
  });

  it("requires correlation ID", () => {
    const ctx = createExecutionContext({
      source: "api",
      actorId: null,
      tenantId: null,
      tenantRequired: false,
      now: "2026-01-01T00:00:00Z",
    });
    (ctx as unknown as { correlationId: string }).correlationId = "";
    const result = validateExecutionContext(ctx);
    expect(result.ok).toBe(false);
  });

  it("rejects cross-tenant operation without elevated authority", () => {
    const ctx = createExecutionContext({
      source: "api",
      actorId: "user-1",
      tenantId: tid,
      tenantRequired: true,
      isCrossTenantOperation: true,
      now: "2026-01-01T00:00:00Z",
    });
    const result = validateExecutionContext(ctx);
    expect(result.ok).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Command/Query
 * ────────────────────────────────────────────────────────────*/

describe("CommandValidation", () => {
  it("accepts valid command", () => {
    const cmd = createCommand("EnrollStudent", 1, { studentId: "s-1" }, "idem-1", false);
    const result = validateCommand(cmd);
    expect(result.valid).toBe(true);
  });

  it("rejects empty command name", () => {
    const cmd = createCommand("", 1, {});
    const result = validateCommand(cmd);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Command name is required");
  });

  it("rejects agent command without idempotency key", () => {
    const cmd = createCommand("EnrollStudent", 1, {}, null, true);
    const result = validateCommand(cmd);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Agent commands must include an idempotency key");
  });

  it("requires idempotency key when configured", () => {
    const cmd = createCommand("EnrollStudent", 1, {});
    const result = validateCommand(cmd, { requireIdempotencyKey: true });
    expect(result.valid).toBe(false);
  });

  it("rejects unsupported version", () => {
    const cmd = createCommand("EnrollStudent", 2, {});
    const result = validateCommand(cmd, { allowedVersions: [1] });
    expect(result.valid).toBe(false);
  });
});

describe("CommandDispatcher", () => {
  it("dispatches to registered handler", () => {
    const dispatcher = createCommandDispatcher();
    dispatcher.register({
      commandName: "TestCommand",
      execute: () => ({ ok: true as const, data: { x: 1 }, auditEvent: null as never }),
    });
    const result = dispatcher.dispatch(createCommand("TestCommand", 1, {}), null as never);
    expect(result.ok).toBe(true);
  });

  it("returns error for unregistered command", () => {
    const dispatcher = createCommandDispatcher();
    const result = dispatcher.dispatch(createCommand("Unknown", 1, {}), null as never);
    expect(result.ok).toBe(false);
  });
});

describe("QueryValidation", () => {
  it("allows only approved filter fields", () => {
    const filters = [
      { field: "name", operator: "eq" as const, value: "X" },
      { field: "privateData", operator: "eq" as const, value: "Y" },
    ];
    const result = validateQueryFilters(filters, ["name"]);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Filter field "privateData" is not allowed');
  });

  it("allows only approved sort fields", () => {
    const sorts = [
      { field: "name", direction: "asc" as const },
      { field: "salary", direction: "desc" as const },
    ];
    const result = validateQuerySorts(sorts, ["name"]);
    expect(result.valid).toBe(false);
  });

  it("validates pagination limits", () => {
    const ok = validatePagination({ cursor: null, limit: 20 });
    expect(ok.ok).toBe(true);

    const bad = validatePagination({ cursor: null, limit: 1000 });
    expect(bad.ok).toBe(false);
  });

  it("validates zero page size", () => {
    const bad = validatePagination({ cursor: null, limit: 0 });
    expect(bad.ok).toBe(false);
  });
});

describe("RuntimeError", () => {
  it("marks transient errors as retryable", () => {
    const err = createRuntimeError("timeout", "timeout", "Timed out", "corr-1");
    expect(err.retryable).toBe(true);
  });

  it("marks internal errors as not safe to expose", () => {
    const err = createRuntimeError("db-down", "internal", "Internal", "corr-1");
    expect(err.safeToExpose).toBe(false);
  });

  it("marks authorization errors as safe", () => {
    const err = createRuntimeError("denied", "authorization", "Denied", "corr-1");
    expect(err.safeToExpose).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Events
 * ────────────────────────────────────────────────────────────*/

describe("Events", () => {
  it("creates event with default version 1", () => {
    const evt = createApplicationEvent({
      name: "StudentEnrolled",
      payload: { studentId: "s-1" },
      producer: "EducationReality",
      tenantId: tenantId("t-1"),
      occurredAt: "2026-01-01T00:00:00Z",
    });
    expect(evt.version).toBe(1);
  });

  it("creates events with stable ID prefix", () => {
    const evt = createApplicationEvent({
      name: "Test",
      version: 3,
      payload: {},
      producer: "p",
      tenantId: null,
      occurredAt: "now",
    });
    expect(evt.id.startsWith("evt-")).toBe(true);
    expect(evt.version).toBe(3);
  });

  it("deduplicates events", () => {
    const detector = createDuplicateDetector();
    const evt = createApplicationEvent({
      name: "Test",
      payload: {},
      producer: "p",
      tenantId: null,
      occurredAt: "now",
    });
    detector.record(evt.id, "ConsumerA", "success");
    expect(detector.hasSeen(evt.id, "ConsumerA")).toBe(true);
    expect(detector.hasSeen(evt.id, "ConsumerB")).toBe(false);
  });

  it("dispatches events to subscribed consumers", () => {
    const dispatcher = createEventDispatcher();
    const detector = createDuplicateDetector();
    let received = 0;
    dispatcher.subscribe({
      eventName: "StudentEnrolled",
      consumer: "Analytics",
      handleEvent: () => {
        received += 1;
      },
    });
    const evt = createApplicationEvent({
      name: "StudentEnrolled",
      payload: {},
      producer: "Education",
      tenantId: null,
      occurredAt: "now",
    });
    dispatcher.publish(evt, detector);
    expect(received).toBe(1);
  });

  it("handles duplicate event consumption gracefully", () => {
    const dispatcher = createEventDispatcher();
    const detector = createDuplicateDetector();
    let received = 0;
    dispatcher.subscribe({
      eventName: "Test",
      consumer: "C",
      handleEvent: () => {
        received += 1;
      },
    });
    const evt = createApplicationEvent({
      name: "Test",
      payload: {},
      producer: "p",
      tenantId: null,
      occurredAt: "now",
    });
    dispatcher.publish(evt, detector);
    dispatcher.publish(evt, detector);
    expect(received).toBe(1);
  });

  it("records dead letter failures", () => {
    const queue = createDeadLetterQueue();
    const evt = createApplicationEvent({
      name: "Test",
      payload: {},
      producer: "p",
      tenantId: null,
      occurredAt: "now",
    });
    queue.record(evt, "ConsumerA", "Processing failed", "2026-01-01T00:00:00Z");
    expect(queue.deadLetters.length).toBe(1);
    expect(queue.deadLetters[0].status).toBe("queued");
    expect(queue.deadLetters[0].attempts).toBe(1);
  });

  it("dismisses dead letter entries", () => {
    const queue = createDeadLetterQueue();
    const evt = createApplicationEvent({
      name: "Test",
      payload: {},
      producer: "p",
      tenantId: null,
      occurredAt: "now",
    });
    queue.record(evt, "C", "Error", "now");
    queue.dismiss(evt.id, "C");
    expect(queue.deadLetters[0].status).toBe("discarded");
  });

  it("creates outbox messages with pending status", () => {
    const msg = createOutboxMessage({
      eventName: "Test",
      eventVersion: 1,
      payload: {},
      tenantId: null,
      correlationId: "corr-1",
      publisher: "p",
      consumer: "c",
      now: "2026-01-01T00:00:00Z",
    });
    expect(msg.status).toBe("pending");
    expect(msg.publishedAt).toBeNull();
  });
});

/* ─────────────────────────────────────────────────────────────
 * Jobs
 * ────────────────────────────────────────────────────────────*/

describe("Jobs", () => {
  const policy = {
    strategy: "fixed" as const,
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 1000,
    retryableCategories: ["transient", "timeout"],
  };

  it("allows retry within max attempts", () => {
    expect(shouldRetry(1, "transient", policy)).toBe(true);
    expect(shouldRetry(3, "transient", policy)).toBe(false);
  });

  it("does not retry non-retryable categories", () => {
    expect(shouldRetry(1, "validation", policy)).toBe(false);
  });

  it("computes exponential backoff delay", () => {
    const expPolicy = {
      strategy: "exponential_backoff" as const,
      maxAttempts: 5,
      baseDelayMs: 100,
      maxDelayMs: 1000,
      retryableCategories: ["transient"],
    };
    expect(computeBackoffDelay(1, expPolicy)).toBe(100);
    expect(computeBackoffDelay(2, expPolicy)).toBe(200);
    expect(computeBackoffDelay(5, expPolicy)).toBe(1000);
  });

  it("marks job as retrying then failed after max attempts", () => {
    const job = createJob({
      name: "ImportStudents",
      tenantId: null,
      payload: {},
      correlationId: correlationId("corr"),
      operationId: operationId("op"),
      maxAttempts: 2,
      now: "2026-01-01T00:00:00Z",
    });
    const policy = {
      strategy: "fixed" as const,
      maxAttempts: 2,
      baseDelayMs: 10,
      maxDelayMs: 100,
      retryableCategories: ["transient"],
    };

    // First attempt fails transiently
    const r1 = runJob(
      job,
      { execute: () => ({ ok: false as const, errorCategory: "transient", error: "e1" }) },
      policy,
    );
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.job.status).toBe("retrying");

    // Second attempt fails permanently (max reached)
    const r2 = runJob(
      r1.ok ? job : r1.job,
      { execute: () => ({ ok: false as const, errorCategory: "permanent", error: "e2" }) },
      policy,
    );
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.job.status).toBe("failed");
  });

  it("records success with no retries", () => {
    const job = createJob({
      name: "Sync",
      tenantId: null,
      payload: {},
      correlationId: correlationId("corr"),
      operationId: operationId("op"),
      now: "2026-01-01T00:00:00Z",
    });
    const policy = {
      strategy: "fixed" as const,
      maxAttempts: 3,
      baseDelayMs: 0,
      maxDelayMs: 0,
      retryableCategories: ["transient"],
    };
    const r = runJob(
      job,
      { execute: () => ({ ok: true as const, result: { done: true } }) },
      policy,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.job.status).toBe("succeeded");
  });
});

/* ─────────────────────────────────────────────────────────────
 * Capabilities
 * ────────────────────────────────────────────────────────────*/

describe("CapabilityRegistry", () => {
  it("registers and finds capabilities", () => {
    const registry = createCapabilityRegistry();
    registry.register({
      name: "AcademicIntelligence",
      version: "1.0.0",
      status: "active",
      owningPhase: "phase-11",
      description: "Academic analytics",
      commands: [],
      queries: [],
      events: { producedEventNames: [], consumedEventNames: [] },
      agentExposed: true,
      sensitive: false,
      health: { status: "healthy", lastCheckedAt: "now", detail: null },
      requiresTenantContext: true,
      isPlatformOnly: false,
      deprecation: null,
    });
    expect(registry.find("AcademicIntelligence")?.owningPhase).toBe("phase-11");
  });

  it("enforces tenant context requirement", () => {
    const registry = createCapabilityRegistry();
    registry.register({
      name: "TenantScoped",
      version: "1.0",
      status: "active",
      owningPhase: "phase-04",
      description: "",
      commands: [],
      queries: [],
      events: { producedEventNames: [], consumedEventNames: [] },
      agentExposed: false,
      sensitive: false,
      health: { status: "healthy", lastCheckedAt: "now", detail: null },
      requiresTenantContext: true,
      isPlatformOnly: false,
      deprecation: null,
    });
    expect(registry.isAvailable("TenantScoped", tenantId("t-1"))).toBe(true);
    expect(registry.isAvailable("TenantScoped", null)).toBe(false);
  });

  it("enforces platform-only isolation", () => {
    const registry = createCapabilityRegistry();
    registry.register({
      name: "PlatformOnly",
      version: "1.0",
      status: "active",
      owningPhase: "phase-08",
      description: "",
      commands: [],
      queries: [],
      events: { producedEventNames: [], consumedEventNames: [] },
      agentExposed: false,
      sensitive: true,
      health: { status: "healthy", lastCheckedAt: "now", detail: null },
      requiresTenantContext: false,
      isPlatformOnly: true,
      deprecation: null,
    });
    expect(registry.isAvailable("PlatformOnly", null)).toBe(true);
    expect(registry.isAvailable("PlatformOnly", tenantId("t-1"))).toBe(false);
  });

  it("does not expose deprecated capabilities", () => {
    const registry = createCapabilityRegistry();
    registry.register({
      name: "Deprecated",
      version: "0.0.1",
      status: "deprecated",
      owningPhase: "phase-05",
      description: "",
      commands: [],
      queries: [],
      events: { producedEventNames: [], consumedEventNames: [] },
      agentExposed: false,
      sensitive: false,
      health: { status: "unknown", lastCheckedAt: "now", detail: null },
      requiresTenantContext: false,
      isPlatformOnly: false,
      deprecation: null,
    });
    expect(registry.isAvailable("Deprecated", null)).toBe(false);
  });

  it("discovery returns capability views", () => {
    const registry = createCapabilityRegistry();
    registry.register({
      name: "Analytics",
      version: "1.0",
      status: "active",
      owningPhase: "phase-18",
      description: "Analytics",
      commands: [],
      queries: [{ name: "RunQuery", version: 1, description: "" }],
      events: { producedEventNames: [], consumedEventNames: [] },
      agentExposed: true,
      sensitive: false,
      health: { status: "healthy", lastCheckedAt: "now", detail: null },
      requiresTenantContext: true,
      isPlatformOnly: false,
      deprecation: null,
    });
    const views = registry.discover(true);
    expect(views.some((v) => v.name === "Analytics" && v.queries[0].name === "RunQuery")).toBe(
      true,
    );
  });
});

/* ─────────────────────────────────────────────────────────────
 * Observability
 * ──────────────────────────────────────────────────────────── */

describe("Runtime Observability", () => {
  it("redacts sensitive fields from logs", () => {
    const redacted = redactSensitiveFields({
      studentName: "John",
      email: "john@example.com",
      password: "secret123",
      apiKey: "abc",
    });
    expect(redacted.password).toBe("[REDACTED]");
    expect(redacted.email).toBe("[REDACTED]");
    expect(redacted.apiKey).toBe("[REDACTED]");
    expect(redacted.studentName).toBe("John");
  });

  it("redacts recursively", () => {
    const redacted = redactSensitiveFields({
      user: { email: "a@b.com", name: "Alice" },
    });
    expect(redacted.user).toEqual({ email: "[REDACTED]", name: "Alice" });
  });

  it("records metrics and computes percentiles", () => {
    const metrics = createMetricsCollector();
    metrics.record("latency", 10);
    metrics.record("latency", 20);
    metrics.record("latency", 30);
    metrics.record("latency", 100);
    const p = metrics.percentiles("latency");
    expect(p).not.toBeNull();
    if (p) {
      expect(p.count).toBe(4);
      expect(p.p50).toBe(20);
    }
  });

  it("creates healthy/degraded health status", () => {
    const h = createHealthStatus({
      database: { status: "healthy" },
      identity: { status: "degraded" },
    });
    expect(h.status).toBe("degraded");
  });

  it("creates unhealthy status when critical fails", () => {
    const h = createHealthStatus({
      database: { status: "healthy" },
      core: { status: "unhealthy" },
    });
    expect(h.status).toBe("unhealthy");
  });
});
