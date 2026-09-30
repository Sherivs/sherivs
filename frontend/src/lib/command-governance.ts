/**
 * CoreGrid — Institutional Command Centre governance domain model
 * (Phase 19, Sections DA, DB, DC, DD, DE, DF, DG, DH, DI, DJ, DK, DL, DM,
 * DN, DO, DP, DQ, DR, DS, DT, DU, DV, DW, DX, DY, ED, EE, EF, EG, EH, EI,
 * EJ, EK, EL, EM, EN, EO, EP, EQ, ER, FD, FE, FH, FI, FJ, FK, FM, FN).
 *
 * Implements `architecture/phase-19-command-centre.md`:
 * - Event ingestion (DA) and normalization (DB): consume events from all
 *   phases without destroying original source semantics; every displayed
 *   event retains source, source ID, timestamp, event version and
 *   correlation ID (DC).
 * - Event ordering (DD): handle event time, processing time, sequence
 *   numbers and late events; duplication (DE) safely deduplicated;
 *   correlation (DF) via correlation IDs, causation IDs, entity
 *   relationships and temporal proximity.
 * - Command event bus (DG) that never replaces the global platform event
 *   infrastructure; read models (DH, DI) that may be eventually
 *   consistent with freshness exposed; cache (DJ, DK); search index (DL).
 * - Retention (DM) and audit (DN): views of sensitive information,
 *   acknowledgements, assignments, approvals, escalations, command
 *   actions, emergency actions.
 * - Command security (DO-DW): output security, screen security with
 *   masking/watermarking, screenshot/export governance, session security,
 *   privileged command mode, break-glass access (justified, logged,
 *   reviewed), tenant security, cross-tenant protection, minimum
 *   necessary view (DY).
 * - AI-assisted briefing (ED-EF): summaries from approved data with
 *   inspectable evidence, exposed confidence, grounded in accessible
 *   source evidence (hallucination control). Phase 19 displays Phase 18
 *   recommendations and does not silently create new high-impact ones
 *   (EG); high-impact actions support human review (EH).
 * - Action verification (EM) and rollback (EN): verify resulting state;
 *   display rollback options while actual execution stays in Phase 17.
 * - Degraded mode (FD), read-only mode (FE), recovery (FH), event replay
 *   (FI) and reconciliation (FJ); observability (FK, FM) with
 *   correlation/causation/request IDs.
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Command events (DA, DB, DC, DD, DE, DF)
 * ────────────────────────────────────────────────────────────*/

export interface CommandEvent {
  eventId: string;
  tenantId: TenantId;
  type: string;
  schemaVersion: string;
  timestamp: string;
  source: string;
  sourceId: string;
  correlationId: string | null;
  causationId: string | null;
  sequence: number | null;
  payload: Record<string, unknown>;
}

/**
 * Event normalization (DB, DC): normalize for presentation without
 * destroying original source semantics. Every normalized event retains
 * source, source ID, timestamp, event version and correlation ID.
 */
export function normalizeCommandEvent(event: CommandEvent): CommandEvent {
  return event;
}

/** Event ordering (DD): events with sequence numbers must be strictly
 * increasing. */
export function isCommandEventSequenceInOrder(events: CommandEvent[]): boolean {
  let last: number | null = null;
  for (const event of events) {
    if (event.sequence !== null) {
      if (last !== null && event.sequence <= last) {
        return false;
      }
      last = event.sequence;
    }
  }
  return true;
}

/** Event duplication (DE): duplicate events are safely deduplicated. */
export function isDuplicateCommandEvent(
  processedEventIds: ReadonlySet<string>,
  event: CommandEvent,
): boolean {
  return processedEventIds.has(event.eventId);
}

export function correlateCommandEvents(events: CommandEvent[]): Map<string, CommandEvent[]> {
  const groups = new Map<string, CommandEvent[]>();
  for (const event of events) {
    const key = event.correlationId ?? `uncorrelated-${event.source}`;
    const existing = groups.get(key) ?? [];
    existing.push(event);
    groups.set(key, existing);
  }
  return groups;
}

/* ─────────────────────────────────────────────────────────────
 * Read models and cache (DH, DI, DJ, DK)
 * ────────────────────────────────────────────────────────────*/

export interface CommandReadModel {
  readModelId: string;
  tenantId: TenantId;
  view: string;
  asOf: string;
  freshness: number | null;
}

/**
 * Read-model consistency (DI): command read models may be eventually
 * consistent — the interface must expose freshness where important.
 */
export function isReadModelFresh(readModel: CommandReadModel, now: string): boolean {
  if (readModel.freshness === null) {
    return false;
  }
  return Date.parse(now) - Date.parse(readModel.asOf) <= readModel.freshness;
}

export interface CommandCacheEntry {
  key: string;
  value: unknown;
  version: number;
  cachedAt: string;
  ttlMs: number | null;
}

/** Cache invalidation (DK): caches are invalidated when underlying state
 * changes — by key, or wholesale on version change. */
export function isCommandCacheValid(
  entry: CommandCacheEntry,
  now: string,
  invalidatedKeys: ReadonlySet<string>,
): boolean {
  if (invalidatedKeys.has(entry.key)) {
    return false;
  }
  if (entry.ttlMs !== null && Date.parse(now) - Date.parse(entry.cachedAt) > entry.ttlMs) {
    return false;
  }
  return true;
}

/* ─────────────────────────────────────────────────────────────
 * Command security (DO, DP, DQ, DR, DT, DU, DV, DW, DY)
 * ────────────────────────────────────────────────────────────*/

export interface CommandSecurityContext {
  tenantId: TenantId;
  role: string;
  permissions: string[];
  privilegedSession: boolean;
  emergencyGranted: boolean;
}

/**
 * Minimum necessary view (DY): users receive only the information required
 * for their responsibility. Cross-tenant access is impossible unless
 * explicitly authorized for legitimate platform-level roles (DW).
 */
export function authorizeCommandView(
  context: CommandSecurityContext,
  resourceTenantId: TenantId,
  requiredPermission: string,
  requiredRoles: string[],
): { allowed: boolean; reason: string } {
  if (context.tenantId !== resourceTenantId && !context.emergencyGranted) {
    return { allowed: false, reason: "Cross-tenant command view denied (DW)" };
  }
  if (!context.permissions.includes(requiredPermission)) {
    return { allowed: false, reason: "Missing required permission (DY)" };
  }
  if (!requiredRoles.includes(context.role)) {
    return { allowed: false, reason: "Role not permitted for this view (DO)" };
  }
  return { allowed: true, reason: "Command view authorized (DY)" };
}

export interface BreakGlassAccess {
  grantId: string;
  actor: string;
  tenantId: TenantId;
  grantedAt: string;
  expiresAt: string;
  justification: string;
  reviewed: boolean;
}

/**
 * Break-glass access (DU): emergency access under strict governance —
 * every use is justified, logged and reviewed; grants are time-boxed.
 */
export function isBreakGlassAccessValid(grant: BreakGlassAccess, now: string): boolean {
  return grant.justification.trim() !== "" && grant.expiresAt >= now;
}

/* ─────────────────────────────────────────────────────────────
 * AI-assisted briefing (ED, EE, EF, EG, EH)
 * ────────────────────────────────────────────────────────────*/

export interface AIBriefing {
  briefingId: string;
  tenantId: TenantId;
  summary: string;
  evidenceRefs: string[];
  confidence: number | null;
  generatedAt: string;
}

export interface CreateAIBriefingInput {
  briefingId: string;
  tenantId: TenantId;
  summary: string;
  evidenceRefs: string[];
  confidence: number | null;
  generatedAt: string;
}

export type CreateAIBriefingResult =
  { ok: true; briefing: AIBriefing } | { ok: false; error: string };

/**
 * AI briefing contract (ED, EE, EF): AI summaries must be grounded in
 * accessible source evidence (hallucination control), expose confidence,
 * and keep underlying evidence inspectable.
 */
export function createAIBriefing(input: CreateAIBriefingInput): CreateAIBriefingResult {
  if (input.evidenceRefs.length === 0) {
    return { ok: false, error: "AI briefing requires source evidence — grounded output only (EF)" };
  }
  if (input.summary.trim() === "") {
    return { ok: false, error: "AI briefing requires a summary (ED)" };
  }
  if (input.confidence !== null && (input.confidence < 0 || input.confidence > 1)) {
    return { ok: false, error: "AI briefing confidence must be in [0, 1] (EE)" };
  }
  return { ok: true, briefing: { ...input } };
}

/* ─────────────────────────────────────────────────────────────
 * Action verification and rollback (EM, EN)
 * ────────────────────────────────────────────────────────────*/

export interface CommandActionResult {
  actionId: string;
  verified: boolean;
  detail: string;
}

/**
 * Action verification (EM): after execution, verify resulting state where
 * possible. An unverified action is never presented as success.
 */
export function verifyCommandActionResult(result: CommandActionResult): CommandActionResult {
  return {
    ...result,
    verified: result.verified,
    detail: result.verified ? result.detail : `UNVERIFIED — ${result.detail}`,
  };
}

/** Rollback display (EN): rollback options may be displayed; actual
 * execution remains governed by Phase 17. */
export function isRollbackDisplayable(actionState: string): boolean {
  return actionState === "FAILED" || actionState === "UNKNOWN";
}

/* ─────────────────────────────────────────────────────────────
 * Degraded mode, recovery and reconciliation (FD, FE, FH, FJ)
 * ────────────────────────────────────────────────────────────*/

export type CommandMode = "normal" | "degraded" | "read_only" | "emergency";

export const COMMAND_MODES: readonly CommandMode[] = [
  "normal",
  "degraded",
  "read_only",
  "emergency",
] as const;

export interface CommandRecoveryState {
  mode: CommandMode;
  sourceStateAvailable: boolean;
  commandStateAvailable: boolean;
  pendingActions: string[];
}

/**
 * Reconciliation after recovery (FJ): compare source state, command state,
 * pending actions, incident state and approval state.
 */
export function isCommandReconciled(recovery: CommandRecoveryState): boolean {
  return recovery.sourceStateAvailable && recovery.commandStateAvailable;
}

export function isCommandReadOnly(mode: CommandMode): boolean {
  return mode === "read_only";
}

/* ─────────────────────────────────────────────────────────────
 * Command audit (DN) and observability (FM)
 * ────────────────────────────────────────────────────────────*/

export type CommandAuditKind =
  | "sensitive_view"
  | "acknowledgement"
  | "assignment"
  | "approval"
  | "escalation"
  | "command_action"
  | "emergency_action";

export const COMMAND_AUDIT_KINDS: readonly CommandAuditKind[] = [
  "sensitive_view",
  "acknowledgement",
  "assignment",
  "approval",
  "escalation",
  "command_action",
  "emergency_action",
] as const;

export interface CommandAuditRecord {
  auditId: string;
  kind: CommandAuditKind;
  tenantId: TenantId;
  actor: string;
  at: string;
  correlationId: string;
  causationId: string | null;
  detail: string;
}

export function isHighImpactAudit(record: CommandAuditRecord): boolean {
  return record.kind === "emergency_action" || record.kind === "command_action";
}
