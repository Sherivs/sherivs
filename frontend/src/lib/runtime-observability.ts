/**
 * CoreGrid — Core Application Runtime observability.
 *
 * Implements `architecture/phase-05-core-application-runtime.md`:
 * - Structured logs with correlation (Sections I–J, 35 AGENTS.md).
 * - Observability testing: every critical operation traceable (Section DM).
 * - Privacy: logs and telemetry avoid unnecessary personal data (Section GU).
 * - PII redaction: structured redaction of sensitive fields (Section GV).
 * - Metrics: p50/p95/p99 latency, throughput (Section DK).
 * - Never log secrets (AGENTS.md 36).
 */

import type { TenantId } from "./tenant-core";
import type { CorrelationId, TraceId } from "./runtime-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Structured log model
 * ────────────────────────────────────────────────────────────*/

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error", "fatal"] as const;

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId: CorrelationId;
  traceId: TraceId;
  tenantId: TenantId | null;
  actorId: string | null;
  capability: string | null;
  operation: string | null;
  /** Additional structured context. */
  context: Record<string, unknown>;
  /** Error details (only if safe). */
  error: { message: string; category: string } | null;
}

export interface LogSink {
  write(entry: LogEntry): void;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>, error?: unknown): void;
  setContext(context: {
    tenantId?: TenantId | null;
    actorId?: string | null;
    correlationId?: CorrelationId;
    traceId?: TraceId;
  }): void;
  log(level: LogLevel, message: string, context?: Record<string, unknown>): void;
}

export function createLogger(
  sink: LogSink,
  initialContext: {
    correlationId: CorrelationId;
    traceId: TraceId;
    tenantId?: TenantId | null;
    actorId?: string | null;
    capability?: string | null;
    operation?: string | null;
  },
): Logger {
  let ctx = {
    correlationId: initialContext.correlationId,
    traceId: initialContext.traceId,
    tenantId: initialContext.tenantId ?? null,
    actorId: initialContext.actorId ?? null,
    capability: initialContext.capability ?? null,
    operation: initialContext.operation ?? null,
  };

  const emit = (
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: unknown,
  ) => {
    const errorInfo = error
      ? {
          message: error instanceof Error ? error.message : String(error),
          category: error instanceof Error ? "error" : "unknown",
        }
      : null;

    sink.write({
      timestamp: timeAuthority.now().at,
      level,
      message,
      correlationId: ctx.correlationId,
      traceId: ctx.traceId,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      capability: ctx.capability,
      operation: ctx.operation,
      context: redactSensitiveFields(context ?? {}),
      error: errorInfo,
    });
  };

  return {
    log(level, message, context) {
      emit(level, message, context);
    },
    debug(message, context) {
      emit("debug", message, context);
    },
    info(message, context) {
      emit("info", message, context);
    },
    warn(message, context) {
      emit("warn", message, context);
    },
    error(message, context, error) {
      emit("error", message, context, error);
    },
    setContext(newCtx) {
      ctx = { ...ctx, ...newCtx };
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * PII redaction (Section GV, GU)
 * ────────────────────────────────────────────────────────────*/

const SENSITIVE_FIELD_PATTERNS: readonly RegExp[] = [
  /password/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /authorization/i,
  /cookie/i,
  /session/i,
  /private[_-]?key/i,
  /phone/i,
  /email/i,
  /credit[_-]?card/i,
  /ssn/i,
  /national[_-]?id/i,
];

/** Redacts sensitive fields from log context (Sections GV, GU, AGENTS.md 36). */
export function redactSensitiveFields(data: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(key))) {
      redacted[key] = "[REDACTED]";
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      redacted[key] = redactSensitiveFields(value as Record<string, unknown>);
      continue;
    }
    // Redact values that are too long (potential secrets/log spills).
    if (typeof value === "string" && value.length > 500) {
      redacted[key] = `${value.slice(0, 100)}...[REDACTED]`;
      continue;
    }
    redacted[key] = value;
  }
  return redacted;
}

/* ─────────────────────────────────────────────────────────────
 * Metrics (Performance testing section)
 * ────────────────────────────────────────────────────────────*/

export interface Metric {
  name: string;
  value: number;
  tenantId: TenantId | null;
  capability: string | null;
  labels: Record<string, string>;
  timestamp: string;
}

export interface MetricsCollector {
  record(
    name: string,
    value: number,
    labels?: Record<string, string>,
    tenantId?: TenantId | null,
    capability?: string | null,
  ): void;
  snapshot(): Metric[];
  /** Compute p50/p95/p99 latency. */
  percentiles(name: string): { p50: number; p95: number; p99: number; count: number } | null;
}

export function createMetricsCollector(): MetricsCollector {
  const metrics: Metric[] = [];

  return {
    record(name, value, labels = {}, tenantId = null, capability = null) {
      metrics.push({
        name,
        value,
        tenantId,
        capability,
        labels,
        timestamp: timeAuthority.now().at,
      });
    },
    snapshot() {
      return metrics;
    },
    percentiles(name) {
      const values = metrics
        .filter((m) => m.name === name)
        .map((m) => m.value)
        .sort((a, b) => a - b);
      if (values.length === 0) return null;
      const at = (pct: number) =>
        values[Math.floor((values.length - 1) * pct)] ?? values[values.length - 1] ?? 0;
      return { p50: at(0.5), p95: at(0.95), p99: at(0.99), count: values.length };
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Health (Sections DS, GB)
 * ────────────────────────────────────────────────────────────*/

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  checks: Record<
    string,
    { status: "healthy" | "degraded" | "unhealthy"; detail: string | null; checkedAt: string }
  >;
  checkedAt: string;
}

export function createHealthStatus(
  checks: Record<string, { status: "healthy" | "degraded" | "unhealthy"; detail?: string | null }>,
): HealthStatus {
  const entries: HealthStatus["checks"] = {};
  let overall: HealthStatus["status"] = "healthy";
  for (const [name, check] of Object.entries(checks)) {
    entries[name] = {
      status: check.status,
      detail: check.detail ?? null,
      checkedAt: timeAuthority.now().at,
    };
    if (check.status === "unhealthy") overall = "unhealthy";
    else if (check.status === "degraded" && overall === "healthy") overall = "degraded";
  }
  return { status: overall, checks: entries, checkedAt: timeAuthority.now().at };
}
