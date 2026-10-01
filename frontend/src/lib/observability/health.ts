/**
 * CoreGrid — pure health report builder (V5.3 Part 30 / LAUNCH_BLOCKER).
 *
 * The report is a fixed whitelist of fields (status, ts, uptime_s, memory,
 * version, checks). It never reads or emits environment variables, connection
 * strings, secrets or stack traces: dependency check authors may attach a
 * short human-safe `detail`, and errors are serialized as `Name: message`
 * only, via the shared log serializer.
 *
 * Fail-closed: a check result that does not match the expected shape, a check
 * that throws or rejects, and any unknown status all degrade to `failing`.
 */

import { serializeError } from "./structured-log";

export type HealthStatus = "ok" | "degraded" | "failing";

export interface DependencyCheckResult {
  name: string;
  status: HealthStatus;
  /** Caller-provided, human-safe note (never include secrets here). */
  detail?: string;
  /** Sanitized `Name: message` when the check failed or was malformed. */
  error?: string;
}

/** A named, pluggable dependency probe (database, queue, cache, …). */
export interface NamedDependencyCheck {
  name: string;
  check: () => DependencyCheckResult | Promise<DependencyCheckResult>;
}

export interface ProcessSnapshot {
  uptime_s: number;
  rss_mb: number;
  heap_used_mb: number;
}

/** Structural subset of Node's `process` the snapshot needs (injectable). */
export interface MinimalProcess {
  uptime(): number;
  memoryUsage(): { rss: number; heapUsed: number };
}

export interface HealthReport {
  status: HealthStatus;
  ts: string;
  uptime_s: number;
  memory: { rss_mb: number; heap_used_mb: number };
  version: string | null;
  checks: DependencyCheckResult[];
}

export interface BuildHealthReportInput {
  snapshot?: ProcessSnapshot;
  version?: string | null;
  dependencyChecks?: readonly NamedDependencyCheck[];
  /** Injectable clock (ISO string) so the builder stays testable. */
  now?: () => string;
}

const BYTES_PER_MB = 1024 * 1024;

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

export function snapshotProcess(proc: MinimalProcess = process): ProcessSnapshot {
  const memory = proc.memoryUsage();
  return {
    uptime_s: proc.uptime(),
    rss_mb: roundToOneDecimal(memory.rss / BYTES_PER_MB),
    heap_used_mb: roundToOneDecimal(memory.heapUsed / BYTES_PER_MB),
  };
}

export function isHealthStatus(value: unknown): value is HealthStatus {
  return value === "ok" || value === "degraded" || value === "failing";
}

export function aggregateStatus(statuses: readonly HealthStatus[]): HealthStatus {
  if (statuses.includes("failing")) return "failing";
  if (statuses.includes("degraded")) return "degraded";
  return "ok";
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Fail-closed: anything not matching the shape becomes a `failing` check. */
export function normalizeCheckResult(
  raw: unknown,
  fallbackName: string,
): DependencyCheckResult {
  if (typeof raw !== "object" || raw === null) {
    return { name: fallbackName, status: "failing", error: "invalid check result shape" };
  }
  const candidate = raw as Record<string, unknown>;
  const name = nonEmptyString(candidate.name) ? candidate.name.trim() : fallbackName;
  if (!isHealthStatus(candidate.status)) {
    return { name, status: "failing", error: "invalid check result status" };
  }
  const result: DependencyCheckResult = { name, status: candidate.status };
  if (typeof candidate.detail === "string") result.detail = candidate.detail;
  if (typeof candidate.error === "string") result.error = candidate.error;
  return result;
}

export async function buildHealthReport(
  input: BuildHealthReportInput = {},
): Promise<HealthReport> {
  const now = input.now ?? (() => new Date().toISOString());
  const snapshot = input.snapshot ?? snapshotProcess();
  const declaredChecks = input.dependencyChecks ?? [];

  const checks = await Promise.all(
    declaredChecks.map(async ({ name, check }): Promise<DependencyCheckResult> => {
      try {
        return normalizeCheckResult(await check(), name);
      } catch (err) {
        return { name, status: "failing", error: serializeError(err) };
      }
    }),
  );

  return {
    status: aggregateStatus(checks.map((check) => check.status)),
    ts: now(),
    uptime_s: snapshot.uptime_s,
    memory: { rss_mb: snapshot.rss_mb, heap_used_mb: snapshot.heap_used_mb },
    version: input.version ?? null,
    checks,
  };
}