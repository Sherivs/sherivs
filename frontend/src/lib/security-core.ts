/**
 * CoreGrid — Security Engine core (Phase 08).
 *
 * Implements `architecture/phase-08-security-engine.md`:
 * - Security Decision Contract (Section F.1): every decision carries request,
 *   actor, tenant, resource, action, context, policy version, risk score,
 *   decision, reason, timestamp, expiration, correlation ID.
 * - Decision states (Section F.2): ALLOW, DENY, CHALLENGE, STEP_UP, REVIEW,
 *   QUARANTINE, RATE_LIMIT, BLOCK, DEFER.
 * - Security Gateway (Section H): first enforcement boundary; validates
 *   identity, tenant context, session state, authorization, rate limits.
 * - Default Security Rule (Section I.5): fail closed.
 * - Architectural Invariants (Section AT): security cannot be bypassed by
 *   application code or AI agents; tenant boundaries cannot be disabled by
 *   ordinary application logic; failures must not silently become grants.
 *
 * Boundaries (Section D):
 * - Phase 02 owns identity; this module consumes identity assertions only.
 * - Phase 03 owns tenant architecture; this module enforces tenant security
 *   boundaries but does not own tenant records.
 * - Phase 07 owns the agent operating system; this module controls agent
 *   permissions/tool authorization but does not own agent runtime state.
 * - Phase 09 owns trust state and evidence; this module only records, on the
 *   decision, the trust-evidence set the decision consumed (ADR-002 Option A,
 *   COND-007/V1CAP-022). The consumption contract is the pure function
 *   `consumeTrustEvidence` in `security/trust-fabric.ts` — the engine adopts
 *   it at one call site and attaches the returned citation below. The field
 *   is optional, so the wiring is additive and reversible without a forced
 *   refactor.
 */

import type { TenantId } from "./tenant-core";
import type { CorrelationId } from "./runtime-core";

/* ─────────────────────────────────────────────────────────────
 * Security decision states (Section F.2)
 * ────────────────────────────────────────────────────────────*/

export type SecurityDecisionState =
  | "ALLOW"
  | "DENY"
  | "CHALLENGE"
  | "STEP_UP"
  | "REVIEW"
  | "QUARANTINE"
  | "RATE_LIMIT"
  | "BLOCK"
  | "DEFER";

export const SECURITY_DECISION_STATES: readonly SecurityDecisionState[] = [
  "ALLOW",
  "DENY",
  "CHALLENGE",
  "STEP_UP",
  "REVIEW",
  "QUARANTINE",
  "RATE_LIMIT",
  "BLOCK",
  "DEFER",
] as const;

/** Decision states that must never grant access to the requested resource. */
export const NON_GRANTING_DECISION_STATES: readonly SecurityDecisionState[] = [
  "DENY",
  "CHALLENGE",
  "STEP_UP",
  "REVIEW",
  "QUARANTINE",
  "RATE_LIMIT",
  "BLOCK",
  "DEFER",
] as const;

export function isGrantingDecision(state: SecurityDecisionState): boolean {
  return state === "ALLOW";
}

/* ─────────────────────────────────────────────────────────────
 * Security Decision Contract (Section F.1)
 * ────────────────────────────────────────────────────────────*/

export type ActorType = "human" | "ai_agent" | "service" | "device" | "system";

/* ─────────────────────────────────────────────────────────────
 * Trust-evidence citation (ADR-002 Option A, COND-007/V1CAP-022)
 * ────────────────────────────────────────────────────────────*/

/**
 * Outcome of consuming the phase-09 trust fabric at decision time:
 * - backed: the decision stands, cited against usable trust evidence.
 * - unavailable: evidence could not be resolved or carries no elevation;
 *   a granting decision must have been flipped to DENY (fail-closed).
 * - stale: consumed evidence was past its validity window; flipped closed.
 * - revoked: consumed evidence was revoked; the decision was flipped
 *   (revocation-flips-decision, AGENTS §31).
 * - not_applicable: the decision does not grant, so it consumes no trust.
 */
export type TrustEvidenceOutcome =
  | "backed"
  | "unavailable"
  | "stale"
  | "revoked"
  | "not_applicable";

/**
 * The trust-evidence set a security decision was derived from (ADR-002
 * constraint 2): assertion IDs, the trust-fabric state-machine version, the
 * consumption time, and the outcome. Producing the citation is the
 * responsibility of `consumeTrustEvidence` in `security/trust-fabric.ts`.
 */
export interface TrustEvidenceCitation {
  assertionIds: readonly string[];
  stateMachineVersion: string;
  evaluatedAt: string;
  outcome: TrustEvidenceOutcome;
}

export interface SecurityDecisionContext {
  requestId: string;
  actorId: string;
  actorType: ActorType;
  tenantId: TenantId | null;
  resource: string;
  action: string;
  /** Free-form context: device, location, time, purpose, etc. */
  context: Record<string, string | number | boolean | null>;
  policyVersion: string;
  riskScore: number;
  correlationId: CorrelationId;
  now: string;
  /** Decisions expire; a stale decision must be re-evaluated (Section F.1). */
  ttlSeconds: number;
  /**
   * Optional trust-evidence citation produced by the trust-fabric consumption
   * contract (security/trust-fabric.ts, ADR-002 Option A). When provided, it
   * is carried verbatim onto the decision record.
   */
  trustEvidence?: TrustEvidenceCitation;
}

export interface SecurityDecision {
  requestId: string;
  actorId: string;
  actorType: ActorType;
  tenantId: TenantId | null;
  resource: string;
  action: string;
  context: Record<string, string | number | boolean | null>;
  policyVersion: string;
  riskScore: number;
  decision: SecurityDecisionState;
  reason: string;
  timestamp: string;
  expiresAt: string;
  correlationId: CorrelationId;
  /**
   * Trust-evidence citation (ADR-002 constraint 2): the phase-09 trust-evidence
   * set (assertion IDs + state-machine version) this decision was derived
   * from, plus the consumption outcome. Absent for decisions that did not
   * consume the trust fabric; present and complete whenever the engine
   * adopts `consumeTrustEvidence` (security/trust-fabric.ts).
   */
  trustEvidence?: TrustEvidenceCitation;
}

export function createSecurityDecision(
  ctx: SecurityDecisionContext,
  decision: SecurityDecisionState,
  reason: string,
): SecurityDecision {
  const expiresAt = new Date(Date.parse(ctx.now) + ctx.ttlSeconds * 1000).toISOString();
  return {
    requestId: ctx.requestId,
    actorId: ctx.actorId,
    actorType: ctx.actorType,
    tenantId: ctx.tenantId,
    resource: ctx.resource,
    action: ctx.action,
    context: ctx.context,
    policyVersion: ctx.policyVersion,
    riskScore: ctx.riskScore,
    decision,
    reason,
    timestamp: ctx.now,
    expiresAt,
    correlationId: ctx.correlationId,
    trustEvidence: ctx.trustEvidence,
  };
}

export function isSecurityDecisionExpired(decision: SecurityDecision, now: string): boolean {
  return Date.parse(now) >= Date.parse(decision.expiresAt);
}

/* ─────────────────────────────────────────────────────────────
 * Security Gateway (Section H) — first enforcement boundary.
 * ────────────────────────────────────────────────────────────*/

export interface SecurityGatewayInput {
  /** Whether the actor's identity assertion is valid and current (Phase 02). */
  identityValid: boolean;
  /** Whether tenant context resolution succeeded (Phase 03). */
  tenantContextValid: boolean;
  /** Whether the session (if any) is active and not expired/revoked. */
  sessionValid: boolean;
  /** Whether the request passed rate-limit checks. */
  withinRateLimit: boolean;
  /** Whether request integrity checks (schema, signature) passed. */
  requestIntegrityValid: boolean;
  /** Upstream authorization decision, e.g. from Phase 02's authorize(). */
  authorizationDecision: "ALLOW" | "DENY" | "REDACT" | "ESCALATE" | "REQUIRE_APPROVAL";
}

export type SecurityGatewayDecision = "allow" | "deny" | "challenge" | "throttle" | "quarantine";

/**
 * Evaluate the Security Gateway's first-boundary decision (Section H.3).
 *
 * Default Security Rule (Section I.5): fail closed. Any missing or invalid
 * upstream signal results in "deny", never a silent "allow" (Section AT.9).
 */
export function evaluateSecurityGateway(input: SecurityGatewayInput): {
  decision: SecurityGatewayDecision;
  reason: string;
} {
  if (!input.identityValid) {
    return { decision: "deny", reason: "Identity assertion is invalid or missing" };
  }
  if (!input.tenantContextValid) {
    return { decision: "deny", reason: "Tenant context could not be resolved (Invariant 02)" };
  }
  if (!input.requestIntegrityValid) {
    return { decision: "deny", reason: "Request integrity validation failed" };
  }
  if (!input.sessionValid) {
    return { decision: "challenge", reason: "Session is not active; step-up required" };
  }
  if (!input.withinRateLimit) {
    return { decision: "throttle", reason: "Rate limit exceeded" };
  }
  switch (input.authorizationDecision) {
    case "ALLOW":
      return { decision: "allow", reason: "Authorization granted" };
    case "DENY":
      return { decision: "deny", reason: "Authorization denied" };
    case "REQUIRE_APPROVAL":
      return { decision: "challenge", reason: "Authorization requires human approval" };
    case "ESCALATE":
      return { decision: "quarantine", reason: "Authorization escalated for review" };
    case "REDACT":
      // A REDACT decision still allows the request through the gateway; the
      // resource layer is responsible for field-level redaction. The gateway
      // itself never silently upgrades REDACT to a full ALLOW/DENY of its own.
      return { decision: "allow", reason: "Authorization allowed with redaction" };
    default:
      // Fail closed on any unrecognized decision (Section AT.9).
      return { decision: "deny", reason: "Unrecognized authorization decision" };
  }
}
