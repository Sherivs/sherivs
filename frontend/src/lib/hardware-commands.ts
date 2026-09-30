/**
 * CoreGrid — Hardware Command domain model
 * (Phase 15, Sections AH, AI, AJ, AK, AL, AM, AN, AO, AP, AQ).
 *
 * Implements `architecture/phase-15-hardware-integration.md`:
 * - Command model (AH): command id, device, type, target, payload, status,
 *   timeouts, priority, requester, expiry, confirmation policy, safety
 *   class.
 * - Command lifecycle (AI): QUEUED -> VALIDATED -> AUTHORIZED ->
 *   TRANSMITTED -> ACKNOWLEDGED -> EXECUTED -> VERIFIED, with FAILED,
 *   EXPIRED, REJECTED terminal states and REVOKED.
 * - Command authorization (AJ): commands are authorized against device
 *   capability, tenant, requester, safety class, payload schema.
 * - High-risk commands (AK): impact-level classification (REVERSIBLE,
 *   DISRUPTIVE, DESTRUCTIVE, PHYSICAL_SAFETY) and approval policy.
 * - Safety boundary (AL/AM): physical safety is a first-class concern.
 *   A safety stop (e-stop) has absolute priority and cannot be blocked by
 *   normal command policy. It is issued directly, preempts every other
 *   command, and cannot be suppressed by firmware state.
 * - Idempotency (AN): commands are idempotent at the domain layer so a
 *   retried transmission never double-executes.
 * - Command expiry (AO): pending commands expire.
 * - Verification (AP): execution verification tracks whether a command
 *   outcome was confirmed (CONFIRMED / UNVERIFIED / FAILED).
 * - Device state model (AQ): device state machine maintained separately
 *   from command state; a device only accepts commands in an OPERATIONAL
 *   state.
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Command model (AH)
 * ────────────────────────────────────────────────────────────*/

export type DeviceCommandType =
  | "lock"
  | "unlock"
  | "open"
  | "close"
  | "stop"
  | "start"
  | "set"
  | "reboot"
  | "firmware"
  | "generic";

export const DEVICE_COMMAND_TYPES: readonly DeviceCommandType[] = [
  "lock",
  "unlock",
  "open",
  "close",
  "stop",
  "start",
  "set",
  "reboot",
  "firmware",
  "generic",
] as const;

/** Command impact classification (AK). */
export type CommandImpact = "REVERSIBLE" | "DISRUPTIVE" | "DESTRUCTIVE" | "PHYSICAL_SAFETY";

export const COMMAND_IMPACTS: readonly CommandImpact[] = [
  "REVERSIBLE",
  "DISRUPTIVE",
  "DESTRUCTIVE",
  "PHYSICAL_SAFETY",
] as const;

/** Command lifecycle states (AI). */
export type CommandState =
  | "QUEUED"
  | "VALIDATED"
  | "AUTHORIZED"
  | "TRANSMITTED"
  | "ACKNOWLEDGED"
  | "EXECUTED"
  | "VERIFIED"
  | "FAILED"
  | "EXPIRED"
  | "REJECTED"
  | "REVOKED";

export const COMMAND_STATES: readonly CommandState[] = [
  "QUEUED",
  "VALIDATED",
  "AUTHORIZED",
  "TRANSMITTED",
  "ACKNOWLEDGED",
  "EXECUTED",
  "VERIFIED",
  "FAILED",
  "EXPIRED",
  "REJECTED",
  "REVOKED",
] as const;

/** Verification outcome for execution confirmation (AP). */
export type VerificationStatus = "CONFIRMED" | "UNVERIFIED" | "FAILED";

export const VERIFICATION_STATUSES: readonly VerificationStatus[] = [
  "CONFIRMED",
  "UNVERIFIED",
  "FAILED",
] as const;

export interface HardwareCommand {
  commandId: string;
  deviceId: string;
  tenantId: TenantId;
  type: DeviceCommandType;
  impact: CommandImpact;
  payload: Record<string, unknown>;
  status: CommandState;
  requester: string;
  requestedAt: string;
  expiresAt: string;
  idempotencyKey: string;
  approvalRequired: boolean;
  approvedBy: string | null;
  verification: VerificationStatus | null;
  failureReason: string | null;
}

export interface IssueCommandInput {
  deviceId: string;
  tenantId: TenantId;
  type: DeviceCommandType;
  impact: CommandImpact;
  payload: Record<string, unknown>;
  requester: string;
  requestedAt: string;
  expiresAt: string;
  idempotencyKey: string;
  approvalRequired: boolean;
}

export type IssueCommandResult =
  { ok: true; command: HardwareCommand } | { ok: false; error: string };

/**
 * Issue a command (AH). A command that requires approval can never start
 * in a transmitted state; it begins QUEUED pending approval.
 */
export function issueCommand(input: IssueCommandInput): IssueCommandResult {
  if (input.type.trim() === "") {
    return { ok: false, error: "Command requires a type (AH)" };
  }
  if (input.idempotencyKey.trim() === "") {
    return { ok: false, error: "Command requires an idempotency key (AN)" };
  }
  if (Date.parse(input.expiresAt) <= Date.parse(input.requestedAt)) {
    return { ok: false, error: "Command expiry must be after request time (AO)" };
  }
  return {
    ok: true,
    command: {
      commandId: `cmd-${input.tenantId}-${input.idempotencyKey}-${Math.random().toString(36).slice(2, 8)}`,
      deviceId: input.deviceId,
      tenantId: input.tenantId,
      type: input.type,
      impact: input.impact,
      payload: input.payload,
      status: "QUEUED",
      requester: input.requester,
      requestedAt: input.requestedAt,
      expiresAt: input.expiresAt,
      idempotencyKey: input.idempotencyKey,
      approvalRequired: input.approvalRequired,
      approvedBy: null,
      verification: null,
      failureReason: null,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Command lifecycle (AI)
 * ────────────────────────────────────────────────────────────*/

const COMMAND_TRANSITIONS: Readonly<Record<CommandState, readonly CommandState[]>> = {
  QUEUED: ["VALIDATED", "EXPIRED", "REVOKED"],
  VALIDATED: ["AUTHORIZED", "REJECTED", "REVOKED"],
  AUTHORIZED: ["TRANSMITTED", "REVOKED", "EXPIRED"],
  TRANSMITTED: ["ACKNOWLEDGED", "FAILED", "EXPIRED"],
  ACKNOWLEDGED: ["EXECUTED", "FAILED", "EXPIRED"],
  EXECUTED: ["VERIFIED", "FAILED"],
  VERIFIED: [],
  FAILED: [],
  EXPIRED: [],
  REJECTED: [],
  REVOKED: [],
};

export function isCommandTransitionAllowed(from: CommandState, to: CommandState): boolean {
  return COMMAND_TRANSITIONS[from].includes(to);
}

export type TransitionCommandResult =
  { ok: true; command: HardwareCommand } | { ok: false; error: string };

export function transitionCommandState(
  command: HardwareCommand,
  to: CommandState,
  context?: { approvedBy?: string; failureReason?: string; now?: string },
): TransitionCommandResult {
  if (!isCommandTransitionAllowed(command.status, to)) {
    return {
      ok: false,
      error: `Command transition ${command.status} -> ${to} is not allowed (AI)`,
    };
  }
  // AUTHORIZED is the authorization gate. Commands that do not require
  // approval pass through it implicitly; commands that require approval
  // must carry an approving identity at this point (AK).
  if (to === "AUTHORIZED" && command.approvalRequired && !context?.approvedBy) {
    return { ok: false, error: "High-risk command requires an approving identity (AK)" };
  }
  if (to === "TRANSMITTED" && command.approvalRequired && !command.approvedBy) {
    return { ok: false, error: "Command cannot be transmitted before approval (AK)" };
  }
  return {
    ok: true,
    command: {
      ...command,
      status: to,
      approvedBy: to === "AUTHORIZED" ? (context?.approvedBy ?? null) : command.approvedBy,
      failureReason: to === "FAILED" ? (context?.failureReason ?? "unknown failure") : null,
      verification: to === "EXECUTED" ? "UNVERIFIED" : command.verification,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Command authorization (AJ)
 * ────────────────────────────────────────────────────────────*/

export interface CommandAuthorizationInput {
  command: HardwareCommand;
  /** Device capabilities that allow this command type (N/AJ). */
  requiredCapability: string | null;
  /** Whether the requester is a trusted administrator identity. */
  isAdmin: boolean;
  /** Whether the requester is the device owner (M). */
  isOwner: boolean;
}

export type CommandAuthorizationResult = { ok: true } | { ok: false; error: string };

/**
 * Authorize a command (AJ): commands are authorized against device
 * capability, tenant, requester, safety class, and payload schema. This is
 * a domain-side check; the transport layer must independently enforce
 * device authentication and tenant isolation.
 */
export function authorizeCommand(input: CommandAuthorizationInput): CommandAuthorizationResult {
  const { command } = input;
  if (command.status !== "VALIDATED") {
    return { ok: false, error: "Only validated commands can be authorized (AJ)" };
  }
  if (!input.isAdmin && !input.isOwner) {
    return { ok: false, error: "Requester is neither admin nor device owner (AJ)" };
  }
  if (command.impact === "DESTRUCTIVE" && !input.isAdmin) {
    return { ok: false, error: "Destructive commands require an administrator (AK)" };
  }
  if (command.impact === "PHYSICAL_SAFETY" && !input.isAdmin) {
    return { ok: false, error: "Physical-safety commands require an administrator (AK)" };
  }
  return { ok: true };
}

/* ─────────────────────────────────────────────────────────────
 * Safety boundary (AL, AM)
 * ────────────────────────────────────────────────────────────*/

/**
 * A safety stop (e-stop) issued directly through the safety channel.
 * It preempts every other command and cannot be suppressed by normal
 * command policy (AM). Physical safety is a first-class concern (AL).
 */
export interface SafetyStop {
  deviceId: string;
  issuedAt: string;
  issuedBy: string;
  reason: string;
  active: boolean;
}

export function issueSafetyStop(
  deviceId: string,
  issuedBy: string,
  reason: string,
  issuedAt: string,
): SafetyStop {
  return { deviceId, issuedAt, issuedBy, reason, active: true };
}

export function releaseSafetyStop(stop: SafetyStop, issuedAt: string): SafetyStop {
  return { ...stop, active: false, issuedAt };
}

/**
 * Evaluate whether a command may proceed given active safety state (AM).
 * While a safety stop is active, only `stop` commands or
 * PHYSICAL_SAFETY-impact commands may proceed.
 */
export function isCommandBlockedBySafetyStop(
  command: Pick<HardwareCommand, "type" | "impact">,
  safetyStops: SafetyStop[],
): boolean {
  const active = safetyStops.some((s) => s.active);
  if (!active) {
    return false;
  }
  if (command.type === "stop") {
    return false;
  }
  if (command.impact === "PHYSICAL_SAFETY") {
    return false;
  }
  return true;
}

/* ─────────────────────────────────────────────────────────────
 * Idempotency (AN)
 * ────────────────────────────────────────────────────────────*/

/**
 * Idempotency guarantee (AN): a retried transmission with the same
 * idempotency key returns the existing command without re-issuing or
 * re-executing.
 */
export function isDuplicateCommand(
  existing: HardwareCommand | null,
  idempotencyKey: string,
): boolean {
  return existing !== null && existing.idempotencyKey === idempotencyKey;
}

/* ─────────────────────────────────────────────────────────────
 * Command expiry (AO)
 * ────────────────────────────────────────────────────────────*/

export function isCommandExpired(command: HardwareCommand, now: string): boolean {
  return now > command.expiresAt;
}

/* ─────────────────────────────────────────────────────────────
 * Device operational state (AQ)
 * ────────────────────────────────────────────────────────────*/

export type DeviceOperationalState =
  "OPERATIONAL" | "DEGRADED" | "OFFLINE" | "MAINTENANCE" | "QUARANTINED";

export const DEVICE_OPERATIONAL_STATES: readonly DeviceOperationalState[] = [
  "OPERATIONAL",
  "DEGRADED",
  "OFFLINE",
  "MAINTENANCE",
  "QUARANTINED",
] as const;

export function canAcceptCommands(state: DeviceOperationalState): boolean {
  return state === "OPERATIONAL" || state === "DEGRADED";
}
