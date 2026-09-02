/**
 * CoreGrid — Live Security Gateway (Phase 08 → server wiring; Stage S1).
 *
 * Converts the identity/session/tenant/authorization assertions a server
 * function can already obtain (requireSupabaseAuth claims + `is_school_admin`
 * / `get_my_school_id` RPC results) into the Phase 08 Security Gateway
 * contract (`security-core.ts`, Section H) and FAILS CLOSED.
 *
 * Intended use: server functions replace ad-hoc `throw new Error("Forbidden")`
 * checks with `runSecurityGateway(...)`. The gateway never silently upgrades a
 * missing signal to a grant (security-core Section I.5 / AT.9).
 *
 * Boundaries: Phase 02 owns identity, Phase 03 owns tenant records; this
 * module only enforces security boundaries over assertions supplied by those
 * phases' existing live primitives.
 */

import { evaluateSecurityGateway, type SecurityGatewayInput } from "./security-core";
import { tenantId, type TenantId } from "./tenant-core";

export type LiveGatewayRole = "super_admin" | "platform" | "school_admin" | null;

export interface LiveSecuritySignals {
  /** Authenticated actor id (from requireSupabaseAuth context). */
  actorId: string;
  /** Whether an active session/claims assertion was present. */
  hasActiveSession: boolean;
  /** `is_school_admin()` RPC result; `null` when the assertion errored. */
  schoolAdmin: boolean | null;
  /** `get_my_school_id()` RPC result; `null` when not resolvable. */
  schoolId: string | null;
  /** Platform role when known (informational; tenant scope still required). */
  role: LiveGatewayRole;
  withinRateLimit: boolean;
  requestIntegrityValid: boolean;
}

export type AuthorizationSignal = SecurityGatewayInput["authorizationDecision"];

/**
 * Map role/school-admin assertions to the authorization signal consumed by the
 * Phase 08 gateway. Default is DENY (fail closed).
 */
export function classifyAuthorizationSignal(signals: Pick<LiveSecuritySignals, "schoolAdmin" | "role">): AuthorizationSignal {
  if (signals.schoolAdmin === true) return "ALLOW";
  if (signals.role === "platform" || signals.role === "super_admin") return "ALLOW";
  return "DENY";
}

/** Build the Phase 08 SecurityGatewayInput from live signals (pure; tested). */
export function buildGatewayInput(signals: LiveSecuritySignals): SecurityGatewayInput {
  const actorPresent = signals.actorId.trim() !== "";
  return {
    identityValid: actorPresent && signals.hasActiveSession,
    tenantContextValid: signals.schoolId !== null && signals.schoolId.trim() !== "",
    sessionValid: signals.hasActiveSession,
    withinRateLimit: signals.withinRateLimit,
    requestIntegrityValid: signals.requestIntegrityValid,
    authorizationDecision: classifyAuthorizationSignal(signals),
  };
}

export type SecurityGatewayErrorCode =
  | "UNAUTHENTICATED"
  | "TENANT_REQUIRED"
  | "INVALID_REQUEST"
  | "CHALLENGE_REQUIRED"
  | "RATE_LIMITED"
  | "FORBIDDEN";

/** Structured gateway denial — thrown by runSecurityGateway on non-allow. */
export class SecurityGatewayError extends Error {
  readonly code: SecurityGatewayErrorCode;
  readonly actorId: string;
  readonly decision: string;

  constructor(code: SecurityGatewayErrorCode, message: string, actorId: string, decision: string) {
    super(message);
    this.name = "SecurityGatewayError";
    this.code = code;
    this.actorId = actorId;
    this.decision = decision;
  }
}

/**
 * Map a Phase 08 gateway result to a structured error code.
 * Evaluation order mirrors `evaluateSecurityGateway` (security-core.ts).
 */
export function gatewayErrorCodeFor(input: SecurityGatewayInput, actorId: string): SecurityGatewayErrorCode {
  if (!input.identityValid) return "UNAUTHENTICATED";
  if (!input.tenantContextValid) return "TENANT_REQUIRED";
  if (!input.requestIntegrityValid) return "INVALID_REQUEST";
  if (!input.sessionValid) return "CHALLENGE_REQUIRED";
  if (!input.withinRateLimit) return "RATE_LIMITED";
  return "FORBIDDEN";
}

export interface LiveGatewayAllow {
  decision: "allow";
  actorId: string;
  tenantId: TenantId;
  reason: string;
}

/**
 * Run the live security gateway over server-function signals.
 * Returns the resolved tenant on allow; throws SecurityGatewayError otherwise.
 */
export function runSecurityGateway(signals: LiveSecuritySignals): LiveGatewayAllow {
  const input = buildGatewayInput(signals);
  const { decision, reason } = evaluateSecurityGateway(input);
  if (decision !== "allow") {
    const code = gatewayErrorCodeFor(input, signals.actorId);
    throw new SecurityGatewayError(code, `Security gateway: ${reason}`, signals.actorId, decision);
  }
  if (signals.schoolId === null) {
    throw new SecurityGatewayError("TENANT_REQUIRED", "Security gateway: tenant could not be resolved", signals.actorId, "deny");
  }
  return {
    decision: "allow",
    actorId: signals.actorId,
    tenantId: tenantId(signals.schoolId),
    reason,
  };
}
