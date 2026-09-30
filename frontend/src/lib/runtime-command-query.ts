/**
 * CoreGrid — Core Application Runtime command/query architecture.
 *
 * Implements `architecture/phase-05-core-application-runtime.md`:
 * - Command: an intention to change application state (Section L1).
 * - Command handler: executes one application command (Section L2).
 * - Command validation: schema, required fields, authorization, tenant context,
 *   domain constraints (Section L3).
 * - Idempotency: commands that may be retried must support idempotency (Section L4).
 * - Command result: structured result (Section L5).
 * - Query: request for information without intentionally changing state (Section M1).
 * - Query handler: executes query logic (Section M2).
 * - Query authorization: identity, tenant, role, relationship, resource sensitivity (Section M3).
 * - Query pagination: large result sets must support pagination (Section M4).
 * - Query filtering: controlled and validated (Section M5).
 * - Query sorting: approved fields only (Section M6).
 * - CQRS boundary: commands change state, queries retrieve state (Section CS).
 * - No accidental state mutation inside queries (Section CS).
 * - Agents must use explicit commands rather than arbitrary database writes (Section CF).
 * - Agent-generated operations must be safe against retries (Section CG).
 * - Agent operations must record actor, capability, command, tenant, result (Section CH).
 */

import type { TenantId } from "./tenant-core";
import type { ExecutionContext, OperationId } from "./runtime-core";

/* ─────────────────────────────────────────────────────────────
 * Command (Section L1)
 * ────────────────────────────────────────────────────────────*/

export interface Command {
  /** Command name, e.g. "EnrollStudent". */
  readonly name: string;
  /** Command version. */
  readonly version: number;
  /** Command payload. */
  readonly payload: Record<string, unknown>;
  /** Idempotency key (Section L4). */
  readonly idempotencyKey: string | null;
  /** Whether this command was issued by an agent (Section CF). */
  readonly isAgentInitiated: boolean;
}

export function createCommand(
  name: string,
  version: number,
  payload: Record<string, unknown>,
  idempotencyKey: string | null = null,
  isAgentInitiated = false,
): Command {
  return { name, version, payload, idempotencyKey, isAgentInitiated };
}

/* ─────────────────────────────────────────────────────────────
 * Command validation (Section L3)
 * ────────────────────────────────────────────────────────────*/

export interface CommandValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a command before execution (Section L3).
 * - Command name is required.
 * - Command version is positive.
 * - Idempotency key is required for retryable commands.
 * - Agent commands must be idempotent (Section CG).
 */
export function validateCommand(
  command: Command,
  options: {
    requireIdempotencyKey?: boolean;
    allowedVersions?: number[];
  } = {},
): CommandValidationResult {
  const errors: string[] = [];

  if (command.name.trim() === "") {
    errors.push("Command name is required");
  }

  if (command.version <= 0) {
    errors.push("Command version must be positive");
  }

  if (options.allowedVersions && !options.allowedVersions.includes(command.version)) {
    errors.push(`Command version ${command.version} is not supported`);
  }

  if (options.requireIdempotencyKey && command.idempotencyKey === null) {
    errors.push("Idempotency key is required for retryable commands");
  }

  // Agent-generated operations must be safe against retries (Section CG).
  if (command.isAgentInitiated && command.idempotencyKey === null) {
    errors.push("Agent commands must include an idempotency key");
  }

  return { valid: errors.length === 0, errors };
}

/* ─────────────────────────────────────────────────────────────
 * Command handler (Section L2)
 * ────────────────────────────────────────────────────────────*/

export interface CommandContext {
  executionContext: ExecutionContext;
  operationId: OperationId;
}

export type CommandResult<T = unknown> =
  | { ok: true; data: T; auditEvent: RuntimeAuditEvent }
  | { ok: false; error: string; errorCategory: RuntimeErrorCategory };

export interface CommandHandler<TCommand extends Command, TResult> {
  /** The command name this handler supports. */
  readonly commandName: string;
  /** Execute the command. */
  execute(command: TCommand, context: CommandContext): CommandResult<TResult>;
}

/* ─────────────────────────────────────────────────────────────
 * Query (Section M1)
 * ────────────────────────────────────────────────────────────*/

export interface Query {
  /** Query name, e.g. "ListStudents". */
  readonly name: string;
  /** Query version. */
  readonly version: number;
  /** Query parameters. */
  readonly params: Record<string, unknown>;
}

export function createQuery(name: string, version: number, params: Record<string, unknown>): Query {
  return { name, version, params };
}

/* ─────────────────────────────────────────────────────────────
 * Query pagination (Section M4)
 * ────────────────────────────────────────────────────────────*/

export interface Pagination {
  /** Cursor for cursor-based pagination. */
  cursor: string | null;
  /** Page size. */
  limit: number;
}

export interface Page<T> {
  items: T[];
  /** Next cursor, or null if no more results. */
  nextCursor: string | null;
  /** Whether there are more results. */
  hasMore: boolean;
}

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

export function validatePagination(
  pagination: Pagination,
  maxLimit: number = MAX_PAGE_SIZE,
): { ok: true; pagination: Pagination } | { ok: false; error: string } {
  if (pagination.limit <= 0) {
    return { ok: false, error: "Page size must be positive" };
  }

  if (pagination.limit > maxLimit) {
    return { ok: false, error: `Page size exceeds maximum of ${maxLimit}` };
  }

  return { ok: true, pagination };
}

/* ─────────────────────────────────────────────────────────────
 * Query filtering (Section M5)
 * ────────────────────────────────────────────────────────────*/

export interface QueryFilter {
  field: string;
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "in";
  value: unknown;
}

export interface FilterValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate query filters (Section M5).
 * Only approved fields may be filtered.
 */
export function validateQueryFilters(
  filters: QueryFilter[],
  allowedFields: string[],
): FilterValidationResult {
  const errors: string[] = [];
  const allowed = new Set(allowedFields);

  for (const filter of filters) {
    if (!allowed.has(filter.field)) {
      errors.push(`Filter field "${filter.field}" is not allowed`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/* ─────────────────────────────────────────────────────────────
 * Query sorting (Section M6)
 * ────────────────────────────────────────────────────────────*/

export interface QuerySort {
  field: string;
  direction: "asc" | "desc";
}

export function validateQuerySorts(
  sorts: QuerySort[],
  allowedFields: string[],
): FilterValidationResult {
  const errors: string[] = [];
  const allowed = new Set(allowedFields);

  for (const sort of sorts) {
    if (!allowed.has(sort.field)) {
      errors.push(`Sort field "${sort.field}" is not allowed`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/* ─────────────────────────────────────────────────────────────
 * Query handler (Section M2)
 * ────────────────────────────────────────────────────────────*/

export type QueryResult<T = unknown> =
  { ok: true; data: T } | { ok: false; error: string; errorCategory: RuntimeErrorCategory };

export interface QueryHandler<TQuery extends Query, TResult> {
  /** The query name this handler supports. */
  readonly queryName: string;
  /** Execute the query. */
  execute(query: TQuery, context: CommandContext): QueryResult<TResult>;
}

/* ─────────────────────────────────────────────────────────────
 * Error model (Sections AQ–AS)
 * ────────────────────────────────────────────────────────────*/

export type RuntimeErrorCategory =
  | "validation"
  | "authorization"
  | "authentication"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "timeout"
  | "transient"
  | "permanent"
  | "internal";

export const RUNTIME_ERROR_CATEGORIES: readonly RuntimeErrorCategory[] = [
  "validation",
  "authorization",
  "authentication",
  "not_found",
  "conflict",
  "rate_limited",
  "timeout",
  "transient",
  "permanent",
  "internal",
] as const;

export interface RuntimeError {
  code: string;
  category: RuntimeErrorCategory;
  message: string;
  /** Whether this error is retryable (Section W1–W2). */
  retryable: boolean;
  /** Correlation ID for tracing. */
  correlationId: string;
  /** Whether this error is safe to expose to clients (Section AS). */
  safeToExpose: boolean;
}

export function createRuntimeError(
  code: string,
  category: RuntimeErrorCategory,
  message: string,
  correlationId: string,
): RuntimeError {
  // Errors must not expose secrets, internal credentials, sensitive database
  // information, private student data, or stack traces to untrusted clients (Section AS).
  const safeToExpose =
    category === "validation" ||
    category === "authorization" ||
    category === "authentication" ||
    category === "not_found" ||
    category === "conflict" ||
    category === "rate_limited";

  // Retryable failures: network timeout, temporary database failure,
  // transient external service failure (Section W1).
  const retryable =
    category === "timeout" || category === "transient" || category === "rate_limited";

  return { code, category, message, retryable, correlationId, safeToExpose };
}

/* ─────────────────────────────────────────────────────────────
 * Audit event (Section BU, CH)
 * ────────────────────────────────────────────────────────────*/

export interface RuntimeAuditEvent {
  id: string;
  type: "CommandExecuted" | "QueryExecuted" | "OperationApproved" | "OperationRejected";
  tenantId: TenantId | null;
  actorId: string | null;
  capability: string;
  command: string | null;
  query: string | null;
  operationId: OperationId;
  correlationId: string;
  occurredAt: string;
  result: "success" | "failure";
  /** Whether this was agent-initiated (Section CH). */
  isAgentInitiated: boolean;
  metadata: Record<string, unknown>;
}

export function createRuntimeAuditEvent(input: {
  tenantId: TenantId | null;
  actorId: string | null;
  capability: string;
  command: string | null;
  query: string | null;
  operationId: OperationId;
  correlationId: string;
  occurredAt: string;
  result: "success" | "failure";
  isAgentInitiated: boolean;
  metadata?: Record<string, unknown>;
}): RuntimeAuditEvent {
  return {
    id: `audit-${input.occurredAt}-${input.operationId}`,
    type: input.command ? "CommandExecuted" : "QueryExecuted",
    tenantId: input.tenantId,
    actorId: input.actorId,
    capability: input.capability,
    command: input.command,
    query: input.query,
    operationId: input.operationId,
    correlationId: input.correlationId,
    occurredAt: input.occurredAt,
    result: input.result,
    isAgentInitiated: input.isAgentInitiated,
    metadata: input.metadata ?? {},
  };
}

/* ─────────────────────────────────────────────────────────────
 * Command dispatcher
 * ────────────────────────────────────────────────────────────*/

export interface CommandDispatcher {
  /** Register a command handler. */
  register(handler: CommandHandler<Command, unknown>): void;
  /** Dispatch a command to its handler. */
  dispatch(command: Command, context: CommandContext): CommandResult<unknown>;
  /** Whether a handler exists for the given command name. */
  hasHandler(commandName: string): boolean;
}

export function createCommandDispatcher(): CommandDispatcher {
  const handlers = new Map<string, CommandHandler<Command, unknown>>();

  return {
    register(handler) {
      handlers.set(handler.commandName, handler);
    },
    dispatch(command, context) {
      const handler = handlers.get(command.name);
      if (!handler) {
        return {
          ok: false,
          error: `No handler registered for command "${command.name}"`,
          errorCategory: "permanent",
        };
      }
      return handler.execute(command, context);
    },
    hasHandler(commandName) {
      return handlers.has(commandName);
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Query dispatcher
 * ────────────────────────────────────────────────────────────*/

export interface QueryDispatcher {
  /** Register a query handler. */
  register(handler: QueryHandler<Query, unknown>): void;
  /** Execute a query. */
  execute(query: Query, context: CommandContext): QueryResult<unknown>;
  /** Whether a handler exists for the given query name. */
  hasHandler(queryName: string): boolean;
}

export function createQueryDispatcher(): QueryDispatcher {
  const handlers = new Map<string, QueryHandler<Query, unknown>>();

  return {
    register(handler) {
      handlers.set(handler.queryName, handler);
    },
    execute(query, context) {
      const handler = handlers.get(query.name);
      if (!handler) {
        return {
          ok: false,
          error: `No handler registered for query "${query.name}"`,
          errorCategory: "permanent",
        };
      }
      return handler.execute(query, context);
    },
    hasHandler(queryName) {
      return handlers.has(queryName);
    },
  };
}
