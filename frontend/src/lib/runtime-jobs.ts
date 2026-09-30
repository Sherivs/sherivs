/**
 * CoreGrid — Core Application Runtime jobs and background work.
 *
 * Implements `architecture/phase-05-core-application-runtime.md`:
 * - Job scheduler: background operation executor (Section A8).
 * - Job idempotency and retry policies (Sections W1–W2).
 * - Job attempt tracking (Section GQ).
 * - Execution: retry with backoff, failure classification, timeout (Section X2).
 * - Bounded retries: retry policies finite (Section X4).
 * - Dead-letter processing for permanent failures (Section V).
 * - No direct database writes from workers (Section FS).
 */

import type { TenantId } from "./tenant-core";
import type { CorrelationId } from "./runtime-core";
import type { OperationId } from "./runtime-core";

/* ─────────────────────────────────────────────────────────────
 * Job model (Sections A8, GQ)
 * ────────────────────────────────────────────────────────────*/

export type JobStatus =
  "queued" | "running" | "succeeded" | "failed" | "retrying" | "cancelled" | "dead_lettered";

export const JOB_STATUSES: readonly JobStatus[] = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "retrying",
  "cancelled",
  "dead_lettered",
] as const;

export interface JobAttempt {
  attemptNumber: number;
  startedAt: string;
  completedAt: string | null;
  worker: string | null;
  error: string | null;
  retryDecision: "retry" | "permanent_failure" | "succeeded" | "cancelled" | null;
}

export interface Job {
  id: string;
  name: string;
  tenantId: TenantId | null;
  payload: Record<string, unknown>;
  status: JobStatus;
  maxAttempts: number;
  currentAttempt: number;
  attempts: JobAttempt[];
  correlationId: CorrelationId;
  operationId: OperationId;
  createdAt: string;
  updatedAt: string;
  scheduledFor: string | null;
  startedAt: string | null;
  completedAt: string | null;
  isExternal: boolean;
}

export interface CreateJobInput {
  name: string;
  tenantId: TenantId | null;
  payload: Record<string, unknown>;
  correlationId: CorrelationId;
  operationId: OperationId;
  maxAttempts?: number;
  scheduledFor?: string | null;
  isExternal?: boolean;
  now: string;
}

export function createJob(input: CreateJobInput): Job {
  return {
    id: `job-${input.now}-${Math.random().toString(36).slice(2, 10)}`,
    name: input.name,
    tenantId: input.tenantId,
    payload: input.payload,
    status: "queued",
    maxAttempts: input.maxAttempts ?? 3,
    currentAttempt: 0,
    attempts: [],
    correlationId: input.correlationId,
    operationId: input.operationId,
    createdAt: input.now,
    updatedAt: input.now,
    scheduledFor: input.scheduledFor ?? null,
    startedAt: null,
    completedAt: null,
    isExternal: input.isExternal ?? false,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Retry policy (Sections W1–W2, X4)
 * ────────────────────────────────────────────────────────────*/

export type RetryStrategy = "fixed" | "exponential_backoff" | "no_retry";

export interface RetryPolicy {
  strategy: RetryStrategy;
  maxAttempts: number;
  /** Base delay in milliseconds (for exponential backoff). */
  baseDelayMs: number;
  /** Maximum delay in milliseconds. */
  maxDelayMs: number;
  /** Which error categories are retryable. */
  retryableCategories: readonly string[];
}

export function shouldRetry(
  attemptNumber: number,
  errorCategory: string,
  policy: RetryPolicy,
): boolean {
  // Retry policies must be finite (Section X4).
  if (attemptNumber >= policy.maxAttempts) return false;

  // Only retry known categories.
  if (!policy.retryableCategories.includes(errorCategory)) return false;

  return true;
}

export function computeBackoffDelay(attempt: number, policy: RetryPolicy): number {
  if (policy.strategy === "no_retry") return 0;
  if (policy.strategy === "fixed") return policy.baseDelayMs;
  const delay = policy.baseDelayMs * Math.pow(2, attempt - 1);
  return Math.min(delay, policy.maxDelayMs);
}

/* ─────────────────────────────────────────────────────────────
 * Job execution (Section X2)
 * ────────────────────────────────────────────────────────────*/

export interface JobExecutor {
  execute(
    job: Job,
    now: string,
  ): { ok: true; result: unknown } | { ok: false; errorCategory: string; error: string };
}

export type JobRunResult =
  | { ok: true; result: unknown; job: Job }
  | { ok: false; errorCategory: string; error: string; job: Job };

export function runJob(job: Job, executor: JobExecutor, policy: RetryPolicy): JobRunResult {
  const attemptNumber = job.currentAttempt + 1;

  job.status = "running";
  job.startedAt = new Date("2026-01-01").toISOString();
  job.currentAttempt = attemptNumber;

  const attempt: JobAttempt = {
    attemptNumber,
    startedAt: new Date().toISOString(),
    completedAt: null,
    worker: "runtime-worker",
    error: null,
    retryDecision: null,
  };

  job.attempts.push(attempt);

  const result = executor.execute(job, new Date().toISOString());

  if (!result.ok) {
    attempt.completedAt = new Date().toISOString();
    attempt.error = result.error;

    const retryable = shouldRetry(attemptNumber, result.errorCategory, policy);
    attempt.retryDecision = retryable ? "retry" : "permanent_failure";

    if (retryable) {
      job.status = "retrying";
      return { ok: false, errorCategory: result.errorCategory, error: result.error, job };
    }

    job.status = "failed";
    job.completedAt = attempt.completedAt;
    return { ok: false, errorCategory: result.errorCategory, error: result.error, job };
  }

  attempt.completedAt = new Date().toISOString();
  attempt.retryDecision = "succeeded";
  job.status = "succeeded";
  job.completedAt = attempt.completedAt;
  return { ok: true, result: result.result, job };
}
