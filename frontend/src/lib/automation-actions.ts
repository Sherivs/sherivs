/**
 * CoreGrid — Controlled Automation Engine action domain model
 * (Phase 17, Sections Y, Z, AA, AB, BP, BQ, BR, BS, BT, BU, BV, BW, BX,
 * BY, BZ, CA, CB, CC, CD, CE, CF).
 *
 * Implements `architecture/phase-17-automation-engine.md`:
 * - Action registry (Y): every executable action is registered with ID,
 *   name, version, owner, input/output schema, permissions, risk level,
 *   timeout, retry policy, compensation and verification method.
 * - Action adapter (Z) and isolation (AA): actions execute through
 *   adapters; automation never directly manipulates other phases' internal
 *   databases.
 * - Action contract (AB): INPUT -> VALIDATION -> AUTHORIZATION ->
 *   EXECUTION -> RESULT -> ERROR -> EVIDENCE.
 * - Twin state verification (BP) and stale state protection (BQ):
 *   critical automation refuses to act on stale state unless explicitly
 *   permitted.
 * - Precondition checking (BR) and postcondition checking (BS): every
 *   critical action validates preconditions immediately before execution
 *   and verifies expected results afterward.
 * - Action verification (BT, BU): verification may use twin, API
 *   response, external confirmation or human confirmation; a failed
 *   verification never becomes success (FM.12).
 * - Escalation (BV) and incident creation (BW).
 * - Emergency stop (BX) with ACTION / WORKFLOW / AUTOMATION / TENANT /
 *   SYSTEM levels; kill-switch security (BY); emergency mode (BZ).
 * - Safe defaults (CA): when uncertain, DO NOT EXECUTE for high-risk
 *   actions.
 * - Dry run (CB), simulation (CC) and shadow mode (CD) must never create
 *   production side effects (FM.8, FM.9). Canary (CE) and progressive
 *   rollout (CF): DEV -> TEST -> SIMULATION -> SHADOW -> CANARY ->
 *   LIMITED PRODUCTION -> FULL PRODUCTION.
 */

import type { TenantId } from "./tenant-core";
import type { RiskLevel } from "./automation-core";

/* ─────────────────────────────────────────────────────────────
 * Action registry (Y) and contract (AB)
 * ────────────────────────────────────────────────────────────*/

export interface ActionDefinition {
  actionId: string;
  name: string;
  version: number;
  owner: string;
  tenantId: TenantId;
  inputSchemaVersion: number;
  outputSchemaVersion: number;
  riskLevel: RiskLevel;
  timeoutMs: number;
  maxRetries: number;
  compensationActionId: string | null;
  verificationMethod:
    "twin" | "api_response" | "external_confirmation" | "human_confirmation" | "none";
  idempotent: boolean;
  reversible: boolean;
}

export type ActionExecutionStatus = "EXECUTED" | "VERIFIED" | "FAILED" | "SKIPPED" | "NOT_EXECUTED";

export interface ActionExecutionRecord {
  actionId: string;
  executionId: string;
  tenantId: TenantId;
  status: ActionExecutionStatus;
  startedAt: string;
  finishedAt: string | null;
  result: unknown;
  error: string | null;
  evidence: unknown;
  verified: boolean;
}

export interface ActionContract {
  input: unknown;
  validate: (input: unknown) => { ok: true } | { ok: false; error: string };
  authorize: () => { ok: true } | { ok: false; error: string };
  execute: (input: unknown) => { result: unknown; evidence: unknown };
}

/**
 * Execute an action through its contract (AB): INPUT -> VALIDATION ->
 * AUTHORIZATION -> EXECUTION -> RESULT -> ERROR -> EVIDENCE. Authorization
 * and validation failures never reach execution (FM.1).
 */
export function executeActionContract(
  contract: ActionContract,
  executionId: string,
  actionId: string,
  tenantId: TenantId,
  startedAt: string,
): ActionExecutionRecord {
  const validation = contract.validate(contract.input);
  if (!validation.ok) {
    return {
      actionId,
      executionId,
      tenantId,
      status: "NOT_EXECUTED",
      startedAt,
      finishedAt: startedAt,
      result: null,
      error: validation.error,
      evidence: null,
      verified: false,
    };
  }
  const authorization = contract.authorize();
  if (!authorization.ok) {
    return {
      actionId,
      executionId,
      tenantId,
      status: "NOT_EXECUTED",
      startedAt,
      finishedAt: startedAt,
      result: null,
      error: authorization.error,
      evidence: null,
      verified: false,
    };
  }
  try {
    const { result, evidence } = contract.execute(contract.input);
    return {
      actionId,
      executionId,
      tenantId,
      status: "EXECUTED",
      startedAt,
      finishedAt: startedAt,
      result,
      error: null,
      evidence,
      verified: false,
    };
  } catch (err) {
    return {
      actionId,
      executionId,
      tenantId,
      status: "FAILED",
      startedAt,
      finishedAt: startedAt,
      result: null,
      error: err instanceof Error ? err.message : String(err),
      evidence: null,
      verified: false,
    };
  }
}

/* ─────────────────────────────────────────────────────────────
 * Verification, preconditions, postconditions (BR, BS, BT, BU)
 * ────────────────────────────────────────────────────────────*/

export function checkPreconditions(
  checks: Array<{ name: string; passed: boolean; detail: string }>,
): { ok: boolean; reason: string } {
  const failed = checks.find((c) => !c.passed);
  if (failed !== undefined) {
    return { ok: false, reason: `Precondition failed: ${failed.name} — ${failed.detail} (BR)` };
  }
  return { ok: true, reason: "All preconditions satisfied (BR)" };
}

export function checkPostconditions(
  checks: Array<{ name: string; passed: boolean; detail: string }>,
): { ok: boolean; reason: string } {
  const failed = checks.find((c) => !c.passed);
  if (failed !== undefined) {
    return { ok: false, reason: `Postcondition failed: ${failed.name} — ${failed.detail} (BS)` };
  }
  return { ok: true, reason: "All postconditions satisfied (BS)" };
}

/**
 * Action verification (BT, BU): a failed verification can never be
 * reported as successful execution (FM.12). Options are retry,
 * compensate or escalate — never silent success.
 */
export function verifyActionExecution(input: {
  execution: ActionExecutionRecord;
  verified: boolean;
  detail: string;
}): ActionExecutionRecord {
  if (!input.verified) {
    return {
      ...input.execution,
      status: "FAILED",
      error: input.execution.error ?? input.detail,
      verified: false,
    };
  }
  return {
    ...input.execution,
    status: "VERIFIED",
    verified: true,
    evidence: input.execution.evidence ?? input.detail,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Stale state protection (BP, BQ)
 * ────────────────────────────────────────────────────────────*/

/**
 * Stale state protection (BQ): critical automation must refuse to act on
 * stale state unless explicitly permitted. Unknown freshness fails safe.
 */
export function isStateFreshForExecution(input: {
  lastObservedAt: string | null;
  now: string;
  maxAgeMs: number;
  critical: boolean;
  allowStale: boolean;
}): { ok: boolean; reason: string } {
  if (input.lastObservedAt === null) {
    return { ok: false, reason: "No state observation available — cannot verify freshness (BQ)" };
  }
  const fresh = Date.parse(input.now) - Date.parse(input.lastObservedAt) <= input.maxAgeMs;
  if (fresh) {
    return { ok: true, reason: "State is fresh (BQ)" };
  }
  if (input.critical && !input.allowStale) {
    return { ok: false, reason: "Critical automation refuses stale state (BQ, FM.10)" };
  }
  return { ok: true, reason: "Stale state tolerated by explicit policy (BQ)" };
}

/* ─────────────────────────────────────────────────────────────
 * Escalation and incidents (BV, BW)
 * ────────────────────────────────────────────────────────────*/

export type EscalationTarget =
  | "human_operator"
  | "institution_administrator"
  | "security_team"
  | "system_owner"
  | "incident_system";

export interface EscalationPlan {
  target: EscalationTarget;
  afterRetries: number;
  createIncident: boolean;
}

export interface EscalationDecision {
  escalate: boolean;
  target: EscalationTarget | null;
  createIncident: boolean;
  reason: string;
}

export function decideEscalation(
  plan: EscalationPlan,
  retriesUsed: number,
  failureClass: string,
): EscalationDecision {
  if (retriesUsed >= plan.afterRetries) {
    return {
      escalate: true,
      target: plan.target,
      createIncident: plan.createIncident,
      reason: `Retries ${retriesUsed} exhausted — escalate to ${plan.target} (BV)`,
    };
  }
  if (failureClass === "AUTHORIZATION" || failureClass === "POLICY") {
    return {
      escalate: true,
      target: "institution_administrator",
      createIncident: false,
      reason: `${failureClass} failure — escalate to administrator (BV)`,
    };
  }
  return {
    escalate: false,
    target: null,
    createIncident: false,
    reason: "Retry window active (BV)",
  };
}

/* ─────────────────────────────────────────────────────────────
 * Emergency stop / kill switches (BX, BY, BZ)
 * ────────────────────────────────────────────────────────────*/

export type StopLevel = "ACTION" | "WORKFLOW" | "AUTOMATION" | "TENANT" | "SYSTEM";

export const STOP_LEVELS: readonly StopLevel[] = [
  "ACTION",
  "WORKFLOW",
  "AUTOMATION",
  "TENANT",
  "SYSTEM",
] as const;

export interface KillSwitchEvent {
  stopId: string;
  level: StopLevel;
  scopeId: string;
  issuedBy: string;
  reason: string;
  issuedAt: string;
  active: boolean;
}

/**
 * Kill switch (BX, BY): requires strong authorization and audit. A SYSTEM
 * stop blocks everything; a narrower stop blocks only its scope.
 */
export function isStopped(input: {
  stops: KillSwitchEvent[];
  scope: { level: StopLevel; id: string };
}): { stopped: boolean; reason: string } {
  const active = input.stops.filter((s) => s.active);
  if (active.some((s) => s.level === "SYSTEM")) {
    return { stopped: true, reason: "SYSTEM stop active (BX)" };
  }
  if (active.some((s) => s.level === "TENANT" && s.scopeId === input.scope.id)) {
    return { stopped: true, reason: `TENANT stop active for ${input.scope.id} (BX)` };
  }
  if (active.some((s) => s.level === input.scope.level && s.scopeId === input.scope.id)) {
    return { stopped: true, reason: `${input.scope.level} stop active for ${input.scope.id} (BX)` };
  }
  return { stopped: false, reason: "No active stop applies (BX)" };
}

/* ─────────────────────────────────────────────────────────────
 * Safe defaults and execution modes (CA, CB, CC, CD, CE, CF)
 * ────────────────────────────────────────────────────────────*/

export type ExecutionMode = "production" | "dry_run" | "simulation" | "shadow" | "canary";

export const EXECUTION_MODES: readonly ExecutionMode[] = [
  "production",
  "dry_run",
  "simulation",
  "shadow",
  "canary",
] as const;

/**
 * Safe defaults (CA) and mode isolation (CB, CC, CD): dry-run,
 * simulation and shadow modes must never create production side effects
 * (FM.8, FM.9). When uncertain, high-risk actions do not execute.
 */
export function shouldExecuteAction(input: {
  mode: ExecutionMode;
  riskLevel: RiskLevel;
  allowedInMode: boolean;
}): { execute: boolean; reason: string } {
  if (!input.allowedInMode) {
    return { execute: false, reason: `Action not allowed in ${input.mode} mode (CB/CC/CD)` };
  }
  if (input.mode !== "production" && input.mode !== "canary") {
    return {
      execute: false,
      reason: `${input.mode} mode never produces production side effects (FM.8/FM.9)`,
    };
  }
  if (input.riskLevel === "R4" && input.mode === "canary") {
    return { execute: false, reason: "R4 actions are not allowed in canary mode (CE)" };
  }
  return { execute: true, reason: "Execution permitted in this mode" };
}

export type RolloutStage =
  "DEV" | "TEST" | "SIMULATION" | "SHADOW" | "CANARY" | "LIMITED_PRODUCTION" | "FULL_PRODUCTION";

export const ROLLOUT_STAGES: readonly RolloutStage[] = [
  "DEV",
  "TEST",
  "SIMULATION",
  "SHADOW",
  "CANARY",
  "LIMITED_PRODUCTION",
  "FULL_PRODUCTION",
] as const;

/**
 * Progressive rollout (CF): automation deployment follows DEV -> TEST ->
 * SIMULATION -> SHADOW -> CANARY -> LIMITED PRODUCTION -> FULL PRODUCTION.
 * Stages are only advanced in order.
 */
export function isRolloutAdvanceAllowed(current: RolloutStage, next: RolloutStage): boolean {
  return ROLLOUT_STAGES.indexOf(next) === ROLLOUT_STAGES.indexOf(current) + 1;
}
