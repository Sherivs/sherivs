/**
 * CoreGrid — Core Application Runtime approval state.
 *
 * Implements `architecture/phase-05-core-application-runtime.md`:
 * - Human oversight (Section CI): sensitive operations may require human approval.
 * - Application approval state (Section CJ): approval-required execution states.
 * - Asynchronous approval (Section CK): long-running operations must not require
 *   an HTTP connection to remain open.
 * - Operation tracking (Section CM): track long-running operations.
 */

import type { TenantId } from "./tenant-core";
import type { CorrelationId, OperationId } from "./runtime-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Approval state (Section CJ)
 * ────────────────────────────────────────────────────────────*/

export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled" | "expired";

export interface ApprovalRequest {
  id: string;
  operationId: OperationId;
  commandName: string;
  tenantId: TenantId | null;
  correlationId: CorrelationId;
  requestedBy: string;
  requestedAt: string;
  status: ApprovalStatus;
  reason: string;
  payload: Record<string, unknown>;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  expiresAt: string | null;
}

export interface CreateApprovalRequestInput {
  operationId: OperationId;
  commandName: string;
  tenantId: TenantId | null;
  correlationId: CorrelationId;
  requestedBy: string;
  reason: string;
  payload: Record<string, unknown>;
  expiresAt?: string | null;
  now: string;
}

export function createApprovalRequest(input: CreateApprovalRequestInput): ApprovalRequest {
  return {
    id: `apr-${input.now}-${Math.random().toString(36).slice(2, 10)}`,
    operationId: input.operationId,
    commandName: input.commandName,
    tenantId: input.tenantId,
    correlationId: input.correlationId,
    requestedBy: input.requestedBy,
    requestedAt: input.now,
    status: "pending",
    reason: input.reason,
    payload: input.payload,
    approvedBy: null,
    approvedAt: null,
    rejectionReason: null,
    expiresAt: input.expiresAt ?? null,
  };
}

export interface ApprovalService {
  requests: ApprovalRequest[];
  request(input: CreateApprovalRequestInput): ApprovalRequest;
  approve(
    id: string,
    approver: string,
    now: string,
  ): { ok: true; request: ApprovalRequest } | { ok: false; error: string };
  reject(
    id: string,
    approver: string,
    reason: string,
    now: string,
  ): { ok: true; request: ApprovalRequest } | { ok: false; error: string };
  cancel(
    id: string,
    actor: string,
  ): { ok: true; request: ApprovalRequest } | { ok: false; error: string };
  find(id: string): ApprovalRequest | null;
  /** Check if an approval has expired (Section CJ). */
  isExpired(request: ApprovalRequest, now: string): boolean;
}

export function createApprovalService(): ApprovalService {
  const requests: ApprovalRequest[] = [];

  return {
    requests,
    request(input) {
      const req = createApprovalRequest(input);
      requests.push(req);
      return req;
    },
    approve(id, approver, now) {
      const req = requests.find((r) => r.id === id);
      if (!req) return { ok: false, error: "Approval request not found" };
      if (req.status !== "pending")
        return { ok: false, error: `Cannot approve request in status: ${req.status}` };
      if (req.expiresAt && Date.parse(now) > Date.parse(req.expiresAt)) {
        req.status = "expired";
        return { ok: false, error: "Approval request has expired" };
      }
      req.status = "approved";
      req.approvedBy = approver;
      req.approvedAt = now;
      return { ok: true, request: req };
    },
    reject(id, approver, reason, now) {
      const req = requests.find((r) => r.id === id);
      if (!req) return { ok: false, error: "Approval request not found" };
      if (req.status !== "pending")
        return { ok: false, error: `Cannot reject request in status: ${req.status}` };
      req.status = "rejected";
      req.approvedBy = approver;
      req.approvedAt = now;
      req.rejectionReason = reason;
      return { ok: true, request: req };
    },
    cancel(id, actor) {
      const req = requests.find((r) => r.id === id);
      if (!req) return { ok: false, error: "Approval request not found" };
      if (req.status !== "pending")
        return { ok: false, error: `Cannot cancel request in status: ${req.status}` };
      req.status = "cancelled";
      req.approvedBy = actor;
      req.approvedAt = timeAuthority.now().at;
      return { ok: true, request: req };
    },
    find(id) {
      return requests.find((r) => r.id === id) ?? null;
    },
    isExpired(request, now) {
      if (!request.expiresAt) return false;
      return Date.parse(now) > Date.parse(request.expiresAt);
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Operation tracking (Section CM)
 * ────────────────────────────────────────────────────────────*/

export type OperationStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export interface TrackedOperation {
  operationId: OperationId;
  commandName: string;
  tenantId: TenantId | null;
  correlationId: CorrelationId;
  status: OperationStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  result: unknown;
  error: string | null;
}

export interface OperationTracker {
  operations: TrackedOperation[];
  start(input: {
    operationId: OperationId;
    commandName: string;
    tenantId: TenantId | null;
    correlationId: CorrelationId;
    now: string;
  }): TrackedOperation;
  complete(operationId: OperationId, result: unknown, now: string): boolean;
  fail(operationId: OperationId, error: string, now: string): boolean;
  find(operationId: OperationId): TrackedOperation | null;
}

export function createOperationTracker(): OperationTracker {
  const operations: TrackedOperation[] = [];

  return {
    operations,
    start(input) {
      const op: TrackedOperation = {
        operationId: input.operationId,
        commandName: input.commandName,
        tenantId: input.tenantId,
        correlationId: input.correlationId,
        status: "running",
        createdAt: input.now,
        updatedAt: input.now,
        completedAt: null,
        result: null,
        error: null,
      };
      operations.push(op);
      return op;
    },
    complete(operationId, result, now) {
      const op = operations.find((o) => o.operationId === operationId);
      if (!op) return false;
      op.status = "succeeded";
      op.result = result;
      op.completedAt = now;
      op.updatedAt = now;
      return true;
    },
    fail(operationId, error, now) {
      const op = operations.find((o) => o.operationId === operationId);
      if (!op) return false;
      op.status = "failed";
      op.error = error;
      op.completedAt = now;
      op.updatedAt = now;
      return true;
    },
    find(operationId) {
      return operations.find((o) => o.operationId === operationId) ?? null;
    },
  };
}
