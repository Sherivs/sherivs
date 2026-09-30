/**
 * CoreGrid — Core Application Runtime bulk operations.
 *
 * Implements `architecture/phase-05-core-application-runtime.md`:
 * - Bulk operations (Section CV): maximum batch size, partial failure behavior,
 *   idempotency, transaction semantics, progress reporting.
 * - Partial failure (Section CW): bulk operations must clearly report successful
 *   and failed items.
 * - Import execution (Section CX): imports should execute asynchronously when large.
 * - Export execution (Section CY): exports should execute asynchronously when large
 *   or sensitive.
 */

import type { TenantId } from "./tenant-core";
import type { CorrelationId } from "./runtime-core";

/* ─────────────────────────────────────────────────────────────
 * Bulk operation model (Section CV)
 * ────────────────────────────────────────────────────────────*/

export interface BulkItemResult<T = unknown> {
  index: number;
  itemId: string | null;
  status: "succeeded" | "failed" | "skipped";
  result: T | null;
  error: string | null;
}

export interface BulkOperationResult<T = unknown> {
  operationId: string;
  totalItems: number;
  succeededCount: number;
  failedCount: number;
  skippedCount: number;
  items: BulkItemResult<T>[];
  /** Whether the entire batch succeeded. */
  allSucceeded: boolean;
  /** Whether any items failed. */
  hasPartialFailure: boolean;
}

export interface BulkOperationConfig {
  /** Maximum batch size (Section CV). */
  maxBatchSize: number;
  /** Whether partial failure is allowed (Section CW). */
  allowPartialFailure: boolean;
  /** Whether the operation is idempotent (Section CV). */
  idempotent: boolean;
}

export interface BulkItemInput {
  itemId: string | null;
  payload: unknown;
}

export interface BulkProcessor<T = unknown> {
  processItem(item: BulkItemInput, index: number): Promise<BulkItemResult<T>>;
}

export interface BulkOperationService {
  execute<T>(
    items: BulkItemInput[],
    processor: BulkProcessor<T>,
    config: BulkOperationConfig,
    context: { tenantId: TenantId | null; correlationId: CorrelationId; now: string },
  ): Promise<BulkOperationResult<T>>;
}

export function createBulkOperationService(): BulkOperationService {
  return {
    async execute<T>(
      items: BulkItemInput[],
      processor: BulkProcessor<T>,
      config: BulkOperationConfig,
      context: { tenantId: TenantId | null; correlationId: CorrelationId; now: string },
    ) {
      // Enforce maximum batch size (Section CV).
      const batch = items.slice(0, config.maxBatchSize);
      const results: BulkItemResult<T>[] = [];

      for (let i = 0; i < batch.length; i++) {
        try {
          const result = await processor.processItem(batch[i], i);
          results.push(result);
        } catch (error) {
          results.push({
            index: i,
            itemId: batch[i].itemId,
            status: "failed",
            result: null,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      const succeededCount = results.filter((r) => r.status === "succeeded").length;
      const failedCount = results.filter((r) => r.status === "failed").length;
      const skippedCount = results.filter((r) => r.status === "skipped").length;

      return {
        operationId: `bulk-${context.now}-${Math.random().toString(36).slice(2, 10)}`,
        totalItems: batch.length,
        succeededCount,
        failedCount,
        skippedCount,
        items: results,
        allSucceeded: failedCount === 0,
        hasPartialFailure: failedCount > 0 && succeededCount > 0,
      };
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Import/Export execution (Sections CX, CY)
 * ────────────────────────────────────────────────────────────*/

export type TransferStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export interface TransferJob {
  id: string;
  type: "import" | "export";
  tenantId: TenantId | null;
  correlationId: CorrelationId;
  status: TransferStatus;
  totalItems: number;
  processedItems: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
}

export interface TransferTracker {
  jobs: TransferJob[];
  create(input: {
    type: "import" | "export";
    tenantId: TenantId | null;
    correlationId: CorrelationId;
    totalItems: number;
    now: string;
  }): TransferJob;
  updateProgress(id: string, processedItems: number, now: string): boolean;
  complete(id: string, now: string): boolean;
  fail(id: string, error: string, now: string): boolean;
  find(id: string): TransferJob | null;
}

export function createTransferTracker(): TransferTracker {
  const jobs: TransferJob[] = [];

  return {
    jobs,
    create(input) {
      const job: TransferJob = {
        id: `transfer-${input.now}-${Math.random().toString(36).slice(2, 10)}`,
        type: input.type,
        tenantId: input.tenantId,
        correlationId: input.correlationId,
        status: "pending",
        totalItems: input.totalItems,
        processedItems: 0,
        createdAt: input.now,
        updatedAt: input.now,
        completedAt: null,
        error: null,
      };
      jobs.push(job);
      return job;
    },
    updateProgress(id, processedItems, now) {
      const job = jobs.find((j) => j.id === id);
      if (!job) return false;
      job.processedItems = processedItems;
      job.status = "running";
      job.updatedAt = now;
      return true;
    },
    complete(id, now) {
      const job = jobs.find((j) => j.id === id);
      if (!job) return false;
      job.status = "succeeded";
      job.completedAt = now;
      job.updatedAt = now;
      return true;
    },
    fail(id, error, now) {
      const job = jobs.find((j) => j.id === id);
      if (!job) return false;
      job.status = "failed";
      job.error = error;
      job.completedAt = now;
      job.updatedAt = now;
      return true;
    },
    find(id) {
      return jobs.find((j) => j.id === id) ?? null;
    },
  };
}
