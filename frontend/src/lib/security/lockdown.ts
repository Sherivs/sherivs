/**
 * CoreGrid — Emergency lockdown contracts at the authorization-decision
 * boundary (J-010 / G-034, AGENTS §5 / §18 / §31, J-035 independence spirit).
 *
 * The credential broker (`credential-broker.ts`) owns the per-lease kill
 * switch: revoking outstanding credential leases for a locked-out agent or
 * tenant. THIS module owns the other half of the emergency path: a typed,
 * bounded, fail-closed LOCKDOWN that denies execution at the
 * authorization-decision boundary itself.
 *
 * The law of this module:
 *
 * 1. Guardian-only declaration (§5: agents are untrusted by default). A
 *    lockdown may only be declared by an identity on the caller-supplied
 *    authorized-guardian allowlist. There is no implicit, inferred or
 *    self-claimed guardian authority anywhere in this contract.
 * 2. Bounded scopes. A lockdown is exactly one of: global platform,
 *    per-tenant, per-agent, or per-capability (optionally narrowed to one
 *    tenant). Scopes with no matching discriminator are refused; a global
 *    lockdown carrying narrowing refs is refused as contradictory.
 * 3. Immediate fail-closed effect. Once a declaration is active, EVERY
 *    request in its scope is DENIED at the lockdown check — which by
 *    contract runs BEFORE role/capability evaluation — unless the request
 *    matches an enumerated exemption. The lockdown check never grants; a
 *    CLEAR outcome only means "not denied by lockdown", and the real
 *    authorization decision still happens downstream. An expired or lifted
 *    lockdown never denies.
 * 4. Enumerated exemptions, never wildcards. Exemptions are exact,
 *    conjunction-matched field tuples validated at declaration time (no "*",
 *    no blank fields, every exemption carries a reason). Declarations and
 *    their exemption lists are frozen at creation; there is no runtime
 *    widening API — the only mutation is lift.
 * 5. Mandatory audit (§18 lifecycle). Declaration, every denied request,
 *    every exempted request, lift, and every denied declaration/lift
 *    invocation flows through the caller-supplied audit sink. The sink is a
 *    structural parameter: there is no unlogged lockdown.
 * 6. Independent lift (J-035 spirit). The lifter must be an authorized
 *    guardian AND must not be the declarer. An agent under lockdown cannot
 *    lift its own lockdown. A non-empty lift reason is mandatory.
 * 7. Pure in-process contract. Time is supplied by the caller; nothing runs
 *    implicitly; nothing is persisted; no I/O. All checks FAIL CLOSED.
 * 8. Emergency revocation depth (B-011). A lockdown ends exactly three ways:
 *    independent LIFT (second guardian, incident adjudicated), bounded
 *    RENEWAL (a different guardian extends the window under a mandatory
 *    expiry ceiling and renewal cap — no self-extension), or emergency
 *    KILL-SWITCH REVOCATION (any authorized guardian including the declarer
 *    throws the off-switch; the locked-out agent can never revoke, lift or
 *    renew). Revocation only stops a deny — it never grants anything. Every
 *    path is audited and every check fails closed.
 */

/* ─────────────────────────────────────────────────────────────
 * Vocabulary
 * ────────────────────────────────────────────────────────────*/

import { z } from "zod";

/** Version of the lockdown contract semantics recorded on declarations. */
export const LOCKDOWN_CONTRACT_VERSION = "lockdown-v1";

/** The bounded lockdown scopes (J-010). */
export const LOCKDOWN_SCOPES = ["global", "tenant", "agent", "capability"] as const;
export type LockdownScope = (typeof LOCKDOWN_SCOPES)[number];

/**
 * Boundary outcome vocabulary. `DENY` is the fail-closed effect; `CLEAR` is
 * deliberately NOT an allow — it only means the lockdown layer does not deny
 * and the ordinary authorization decision must still run.
 */
export const LOCKDOWN_DECISIONS = ["DENY", "CLEAR"] as const;
export type LockdownDecision = (typeof LOCKDOWN_DECISIONS)[number];

/** Lifecycle of a declaration as observed at a point in time. */
export const LOCKDOWN_STATES = ["active", "expired", "lifted", "revoked"] as const;
export type LockdownState = (typeof LOCKDOWN_STATES)[number];

/* ─────────────────────────────────────────────────────────────
 * Contracts
 * ────────────────────────────────────────────────────────────*/

/**
 * An enumerated exemption: an exact, conjunction-matched tuple. Every present
 * field must equal the request field exactly; absent fields match anything.
 * Wildcards and blank fields are refused at declaration time, so an
 * exemption can never silently widen.
 */
export interface LockdownExemption {
  readonly identityRef?: string;
  readonly tenantRef?: string;
  readonly capabilityRef?: string;
  /** Why this principal is exempt — audit evidence (§18). */
  readonly reason: string;
}

/** A declared emergency lockdown. Frozen at creation. */
export interface LockdownDeclaration {
  readonly id: string;
  readonly scope: LockdownScope;
  /** Per-tenant discriminator (tenant scope; capability-scope narrowing). */
  readonly tenantRef: string | null;
  /** Per-agent discriminator (agent scope). */
  readonly agentRef: string | null;
  /** Per-capability discriminator (capability scope). */
  readonly capabilityRef: string | null;
  readonly declaredBy: string;
  readonly declaredAt: string;
  /** Evidence-bearing incident reason (mandatory, §18). */
  readonly reason: string;
  /** Bounded window: an emergency lockdown always decays (G-034). */
  readonly expiresAt: string;
  readonly exemptions: readonly LockdownExemption[];
  readonly contractVersion: string;
  readonly liftedAt: string | null;
  readonly liftedBy: string | null;
  readonly liftReason: string | null;
  /**
   * Emergency kill-switch revocation record (B-011 depth). Present-but-null on
   * a fresh declaration; a revocation is distinct from a lift — it is the
   * fast emergency off-switch any authorized guardian (including the
   * declarer) may throw, never the locked-out agent itself.
   */
  readonly revokedAt?: string | null;
  readonly revokedBy?: string | null;
  readonly revokeReason?: string | null;
  /**
   * Bounded renewal ledger (B-011 depth): every extension of the emergency
   * window is counted, attributed and reason-bearing, and capped.
   */
  readonly renewalCount?: number;
  readonly lastRenewedAt?: string | null;
  readonly lastRenewedBy?: string | null;
  readonly lastRenewalReason?: string | null;
}

/** The request a lockdown boundary check evaluates. */
export interface LockdownRequest {
  readonly identityRef: string;
  readonly tenantRef: string;
  readonly capabilityRef: string;
}

export type LockdownDeclarationResult =
  | { readonly ok: true; readonly lockdown: LockdownDeclaration }
  | { readonly ok: false; readonly error: string };

export type LockdownLiftResult =
  | { readonly ok: true; readonly lockdown: LockdownDeclaration }
  | { readonly ok: false; readonly error: string };

export type LockdownBoundaryOutcome =
  | {
      readonly decision: "DENY";
      readonly lockdownId: string;
      readonly scope: LockdownScope;
      readonly reason: string;
    }
  | {
      readonly decision: "CLEAR";
      readonly exempted: boolean;
      readonly exemptedByLockdownId: string | null;
      readonly reason: string;
    };

/* ─────────────────────────────────────────────────────────────
 * Audit events + sink (§18: mandatory, structural)
 * ────────────────────────────────────────────────────────────*/

export type LockdownAuditEvent =
  | {
      readonly kind: "LOCKDOWN_DECLARED";
      readonly at: string;
      readonly lockdownId: string;
      readonly scope: LockdownScope;
      readonly targetRef: string | null;
      readonly declaredBy: string;
      readonly reason: string;
      readonly expiresAt: string;
      readonly exemptionCount: number;
    }
  | {
      readonly kind: "LOCKDOWN_DECLARE_DENIED";
      readonly at: string;
      readonly guardianRef: string;
      readonly scope: LockdownScope | null;
      readonly denyReason: string;
    }
  | {
      readonly kind: "LOCKDOWN_REQUEST_DENIED";
      readonly at: string;
      readonly lockdownId: string;
      readonly scope: LockdownScope;
      readonly identityRef: string;
      readonly tenantRef: string;
      readonly capabilityRef: string;
    }
  | {
      readonly kind: "LOCKDOWN_REQUEST_EXEMPTED";
      readonly at: string;
      readonly lockdownId: string;
      readonly identityRef: string;
      readonly tenantRef: string;
      readonly capabilityRef: string;
    }
  | {
      readonly kind: "LOCKDOWN_LIFTED";
      readonly at: string;
      readonly lockdownId: string;
      readonly liftedBy: string;
      readonly reason: string;
    }
  | {
      readonly kind: "LOCKDOWN_LIFT_DENIED";
      readonly at: string;
      readonly guardianRef: string;
      readonly lockdownId: string | null;
      readonly denyReason: string;
    }
  | {
      readonly kind: "LOCKDOWN_REVOKED";
      readonly at: string;
      readonly lockdownId: string;
      readonly revokedBy: string;
      readonly reason: string;
    }
  | {
      readonly kind: "LOCKDOWN_REVOKE_DENIED";
      readonly at: string;
      readonly guardianRef: string;
      readonly lockdownId: string | null;
      readonly denyReason: string;
    }
  | {
      readonly kind: "LOCKDOWN_RENEWED";
      readonly at: string;
      readonly lockdownId: string;
      readonly renewedBy: string;
      readonly reason: string;
      readonly newExpiresAt: string;
      readonly renewalCount: number;
    }
  | {
      readonly kind: "LOCKDOWN_RENEW_DENIED";
      readonly at: string;
      readonly guardianRef: string;
      readonly lockdownId: string | null;
      readonly denyReason: string;
    };

export interface LockdownAuditSink {
  append(event: LockdownAuditEvent): void;
}

/** In-process reference sink (V1). DB-backed sinks implement the interface. */
export class InMemoryLockdownAuditSink implements LockdownAuditSink {
  private readonly log: LockdownAuditEvent[] = [];

  append(event: LockdownAuditEvent): void {
    this.log.push(event);
  }

  get events(): readonly LockdownAuditEvent[] {
    return this.log;
  }
}

/* ─────────────────────────────────────────────────────────────
 * Validation helpers (all fail closed)
 * ────────────────────────────────────────────────────────────*/

function isNonEmptyTrimmed(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
}

function carriesWildcard(value: string): boolean {
  return value.includes("*");
}

function isParseableFutureTimestamp(value: unknown, nowMs: number): value is string {
  if (typeof value !== "string") return false;
  const ms = Date.parse(value);
  return !Number.isNaN(ms) && ms > nowMs;
}

/* ─────────────────────────────────────────────────────────────
 * Declaration
 * ────────────────────────────────────────────────────────────*/

export interface DeclareLockdownInput {
  readonly id: string;
  readonly guardianRef: string;
  readonly scope: LockdownScope;
  readonly tenantRef?: string;
  readonly agentRef?: string;
  readonly capabilityRef?: string;
  readonly reason: string;
  readonly expiresAt: string;
  readonly exemptions?: readonly LockdownExemption[];
  /** The authoritative guardian allowlist for this invocation (§5). */
  readonly authorizedGuardians: readonly string[];
  /** Existing declarations, so an active id can never be shadowed. */
  readonly existingLockdowns?: readonly LockdownDeclaration[];
  readonly now: string;
}

function targetRefFor(scope: LockdownScope, input: DeclareLockdownInput): string | null {
  switch (scope) {
    case "tenant":
      return input.tenantRef ?? null;
    case "agent":
      return input.agentRef ?? null;
    case "capability":
      return input.capabilityRef ?? null;
    case "global":
      return null;
  }
}

function validateExemptions(exemptions: readonly LockdownExemption[]): string | null {
  for (const exemption of exemptions) {
    if (!isNonEmptyTrimmed(exemption.reason, 500)) {
      return "exemption_reason_required";
    }
    for (const field of [exemption.identityRef, exemption.tenantRef, exemption.capabilityRef]) {
      if (field === undefined) continue;
      if (!isNonEmptyTrimmed(field, 200)) return "exemption_field_invalid";
      if (carriesWildcard(field)) return "exemption_wildcard_denied";
    }
    if (
      exemption.identityRef === undefined &&
      exemption.tenantRef === undefined &&
      exemption.capabilityRef === undefined
    ) {
      return "exemption_must_name_a_principal";
    }
  }
  return null;
}

/**
 * Declare an emergency lockdown. Fails closed on: non-guardian declarer,
 * scope/discriminator contradictions, wildcard or blank targets/exemptions,
 * missing reason, unbounded or past expiry, and id collision with an
 * existing declaration (so an active lockdown's exemption list can never be
 * shadowed by a wider re-declaration). Denied attempts are audited.
 */
export function declareLockdown(
  input: DeclareLockdownInput,
  audit: LockdownAuditSink,
): LockdownDeclarationResult {
  const deny = (denyReason: string, scope: LockdownScope | null): LockdownDeclarationResult => {
    audit.append({
      kind: "LOCKDOWN_DECLARE_DENIED",
      at: input.now,
      guardianRef: typeof input.guardianRef === "string" ? input.guardianRef : "",
      scope,
      denyReason,
    });
    return { ok: false, error: denyReason };
  };

  if (!isNonEmptyTrimmed(input.id, 128)) return deny("lockdown_id_required", input.scope);
  if (!isNonEmptyTrimmed(input.guardianRef, 200)) return deny("guardian_ref_required", input.scope);
  if (!LOCKDOWN_SCOPES.includes(input.scope)) return deny("lockdown_scope_invalid", null);
  if (!isNonEmptyTrimmed(input.reason, 500)) return deny("lockdown_reason_required", input.scope);
  if (
    !Array.isArray(input.authorizedGuardians) ||
    !input.authorizedGuardians.includes(input.guardianRef)
  ) {
    return deny("guardian_not_authorized", input.scope);
  }
  if (!isParseableFutureTimestamp(input.expiresAt, Date.parse(input.now))) {
    return deny("lockdown_expiry_required_bounded", input.scope);
  }

  const hasTenant = input.tenantRef !== undefined;
  const hasAgent = input.agentRef !== undefined;
  const hasCapability = input.capabilityRef !== undefined;

  if (input.scope === "global" && (hasTenant || hasAgent || hasCapability)) {
    return deny("lockdown_scope_contradiction", input.scope);
  }
  if (input.scope === "tenant") {
    if (!hasTenant || !isNonEmptyTrimmed(input.tenantRef, 128)) {
      return deny("lockdown_target_required", input.scope);
    }
    if (hasAgent || hasCapability) return deny("lockdown_scope_contradiction", input.scope);
  }
  if (input.scope === "agent") {
    if (!hasAgent || !isNonEmptyTrimmed(input.agentRef, 200)) {
      return deny("lockdown_target_required", input.scope);
    }
    if (hasTenant || hasCapability) return deny("lockdown_scope_contradiction", input.scope);
  }
  if (input.scope === "capability") {
    if (!hasCapability || !isNonEmptyTrimmed(input.capabilityRef, 200)) {
      return deny("lockdown_target_required", input.scope);
    }
    if (hasAgent) return deny("lockdown_scope_contradiction", input.scope);
    if (hasTenant && !isNonEmptyTrimmed(input.tenantRef, 128)) {
      return deny("lockdown_target_required", input.scope);
    }
  }

  for (const ref of [input.tenantRef, input.agentRef, input.capabilityRef]) {
    if (ref !== undefined && carriesWildcard(ref))
      return deny("lockdown_wildcard_denied", input.scope);
  }

  // An agent is untrusted by default (§5): it can never declare the lockdown
  // that targets itself.
  if (input.scope === "agent" && input.agentRef === input.guardianRef) {
    return deny("self_lockdown_denied", input.scope);
  }

  const exemptions = input.exemptions ?? [];
  if (!Array.isArray(exemptions)) return deny("exemptions_invalid", input.scope);
  const exemptionError = validateExemptions(exemptions);
  if (exemptionError !== null) return deny(exemptionError, input.scope);

  if (
    (input.existingLockdowns ?? []).some(
      (existing) => existing.id === input.id && existing.liftedAt === null,
    )
  ) {
    return deny("lockdown_id_conflict", input.scope);
  }

  const lockdown: LockdownDeclaration = Object.freeze({
    id: input.id.trim(),
    scope: input.scope,
    tenantRef: input.tenantRef?.trim() ?? null,
    agentRef: input.agentRef?.trim() ?? null,
    capabilityRef: input.capabilityRef?.trim() ?? null,
    declaredBy: input.guardianRef.trim(),
    declaredAt: input.now,
    reason: input.reason.trim(),
    expiresAt: input.expiresAt,
    exemptions: Object.freeze([...exemptions]),
    contractVersion: LOCKDOWN_CONTRACT_VERSION,
    liftedAt: null,
    liftedBy: null,
    liftReason: null,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    renewalCount: 0,
    lastRenewedAt: null,
    lastRenewedBy: null,
    lastRenewalReason: null,
  });

  audit.append({
    kind: "LOCKDOWN_DECLARED",
    at: input.now,
    lockdownId: lockdown.id,
    scope: lockdown.scope,
    targetRef: targetRefFor(lockdown.scope, input),
    declaredBy: lockdown.declaredBy,
    reason: lockdown.reason,
    expiresAt: lockdown.expiresAt,
    exemptionCount: lockdown.exemptions.length,
  });
  return { ok: true, lockdown };
}

/* ─────────────────────────────────────────────────────────────
 * Lifecycle observation
 * ────────────────────────────────────────────────────────────*/

/** Observed lifecycle state at `now`: lifted, revoked, decayed, or actively denying. */
export function lockdownState(lockdown: LockdownDeclaration, now: string): LockdownState {
  if (lockdown.liftedAt !== null) return "lifted";
  if (lockdown.revokedAt !== undefined && lockdown.revokedAt !== null) return "revoked";
  const nowMs = Date.parse(now);
  const expiresMs = Date.parse(lockdown.expiresAt);
  if (Number.isNaN(nowMs) || Number.isNaN(expiresMs) || nowMs >= expiresMs) {
    return "expired";
  }
  return "active";
}

export function isLockdownActive(lockdown: LockdownDeclaration, now: string): boolean {
  return lockdownState(lockdown, now) === "active";
}

/* ─────────────────────────────────────────────────────────────
 * Boundary evaluation — runs BEFORE role/capability evaluation
 * ────────────────────────────────────────────────────────────*/

function lockdownAppliesTo(lockdown: LockdownDeclaration, request: LockdownRequest): boolean {
  switch (lockdown.scope) {
    case "global":
      return true;
    case "tenant":
      return lockdown.tenantRef === request.tenantRef;
    case "agent":
      return lockdown.agentRef === request.identityRef;
    case "capability":
      return (
        lockdown.capabilityRef === request.capabilityRef &&
        (lockdown.tenantRef === null || lockdown.tenantRef === request.tenantRef)
      );
  }
}

function exemptionMatches(exemption: LockdownExemption, request: LockdownRequest): boolean {
  if (exemption.identityRef !== undefined && exemption.identityRef !== request.identityRef) {
    return false;
  }
  if (exemption.tenantRef !== undefined && exemption.tenantRef !== request.tenantRef) {
    return false;
  }
  if (exemption.capabilityRef !== undefined && exemption.capabilityRef !== request.capabilityRef) {
    return false;
  }
  return true;
}

export interface EvaluateLockdownBoundaryInput {
  readonly lockdowns: readonly LockdownDeclaration[];
  readonly request: LockdownRequest;
  readonly now: string;
}

/**
 * The lockdown check. By contract the caller runs this BEFORE any role or
 * capability evaluation: a DENY terminates the decision without consulting
 * roles or capabilities at all. Everything in an active lockdown's scope is
 * denied unless it matches an enumerated exemption of that lockdown; a
 * request exempt from one lockdown is still denied by any other applicable
 * lockdown. Every deny and every exemption is audited; a CLEAR with no
 * applicable lockdown records no event (nothing happened).
 */
export function evaluateLockdownBoundary(
  input: EvaluateLockdownBoundaryInput,
  audit: LockdownAuditSink,
): LockdownBoundaryOutcome {
  // Every applicable active lockdown is consulted: an exemption granted by
  // one lockdown never bypasses another lockdown that also matches the
  // request (the deny wins over any exemption).
  let exemptedBy: string | null = null;
  for (const lockdown of input.lockdowns) {
    if (!isLockdownActive(lockdown, input.now)) continue;
    if (!lockdownAppliesTo(lockdown, input.request)) continue;

    const exemption = lockdown.exemptions.find((e) => exemptionMatches(e, input.request));
    if (exemption !== undefined) {
      exemptedBy ??= lockdown.id;
      continue;
    }

    audit.append({
      kind: "LOCKDOWN_REQUEST_DENIED",
      at: input.now,
      lockdownId: lockdown.id,
      scope: lockdown.scope,
      identityRef: input.request.identityRef,
      tenantRef: input.request.tenantRef,
      capabilityRef: input.request.capabilityRef,
    });
    return {
      decision: "DENY",
      lockdownId: lockdown.id,
      scope: lockdown.scope,
      reason: `Emergency lockdown ${lockdown.id} is active: all access in scope is denied pending lift (fail-closed)`,
    };
  }

  if (exemptedBy !== null) {
    audit.append({
      kind: "LOCKDOWN_REQUEST_EXEMPTED",
      at: input.now,
      lockdownId: exemptedBy,
      identityRef: input.request.identityRef,
      tenantRef: input.request.tenantRef,
      capabilityRef: input.request.capabilityRef,
    });
    return {
      decision: "CLEAR",
      exempted: true,
      exemptedByLockdownId: exemptedBy,
      reason: `Explicitly exempted from lockdown ${exemptedBy} (enumerated exemption)`,
    };
  }

  return {
    decision: "CLEAR",
    exempted: false,
    exemptedByLockdownId: null,
    reason: "No active lockdown applies; proceed to ordinary authorization",
  };
}

/* ─────────────────────────────────────────────────────────────
 * Lift — independent authorization (J-035 spirit)
 * ────────────────────────────────────────────────────────────*/

export interface LiftLockdownInput {
  readonly lockdown: LockdownDeclaration;
  readonly guardianRef: string;
  readonly reason: string;
  readonly authorizedGuardians: readonly string[];
  readonly now: string;
}

/**
 * Lift an active lockdown. The lifter must be an authorized guardian, must
 * NOT be the declarer, must not be the agent targeted by an agent-scope
 * lockdown, and must give a non-empty reason. Every attempt — granted or
 * denied — is audited. The lift returns a NEW frozen declaration; the caller
 * replaces the active one (pure contract, no in-place mutation).
 */
export function liftLockdown(
  input: LiftLockdownInput,
  audit: LockdownAuditSink,
): LockdownLiftResult {
  const deny = (denyReason: string, lockdownId: string | null): LockdownLiftResult => {
    audit.append({
      kind: "LOCKDOWN_LIFT_DENIED",
      at: input.now,
      guardianRef: typeof input.guardianRef === "string" ? input.guardianRef : "",
      lockdownId,
      denyReason,
    });
    return { ok: false, error: denyReason };
  };

  if (!isNonEmptyTrimmed(input.guardianRef, 200)) return deny("guardian_ref_required", null);
  if (!isNonEmptyTrimmed(input.reason, 500)) return deny("lift_reason_required", input.lockdown.id);
  if (
    !Array.isArray(input.authorizedGuardians) ||
    !input.authorizedGuardians.includes(input.guardianRef)
  ) {
    return deny("guardian_not_authorized", input.lockdown.id);
  }
  if (lockdownState(input.lockdown, input.now) !== "active") {
    return deny("lockdown_not_active", input.lockdown.id);
  }
  // Independence: the emergency authority that declared the incident does not
  // adjudicate its own end.
  if (input.guardianRef === input.lockdown.declaredBy) {
    return deny("lift_independence_denied", input.lockdown.id);
  }
  if (input.lockdown.scope === "agent" && input.guardianRef === input.lockdown.agentRef) {
    return deny("self_lift_denied", input.lockdown.id);
  }

  const lifted: LockdownDeclaration = Object.freeze({
    ...input.lockdown,
    exemptions: Object.freeze([...input.lockdown.exemptions]),
    liftedAt: input.now,
    liftedBy: input.guardianRef.trim(),
    liftReason: input.reason.trim(),
  });

  audit.append({
    kind: "LOCKDOWN_LIFTED",
    at: input.now,
    lockdownId: lifted.id,
    liftedBy: lifted.liftedBy ?? "",
    reason: lifted.liftReason ?? "",
  });
  return { ok: true, lockdown: lifted };
}

/* ─────────────────────────────────────────────────────────────
 * B-011 depth: deny-wins coverage view
 * ────────────────────────────────────────────────────────────*/

/**
 * The full deny-wins blast-radius view: every ACTIVE declaration whose scope
 * covers the request at `now` — including declarations whose exemption would
 * clear the request, because an exemption granted by one lockdown never
 * bypasses another lockdown that also matches (the deny wins). Purely
 * observational: returns the same frozen declaration objects.
 */
export function activeApplicableLockdowns(
  lockdowns: readonly LockdownDeclaration[],
  request: LockdownRequest,
  now: string,
): readonly LockdownDeclaration[] {
  return lockdowns.filter(
    (lockdown) => isLockdownActive(lockdown, now) && lockdownAppliesTo(lockdown, request),
  );
}

/* ─────────────────────────────────────────────────────────────
 * B-011 depth: emergency kill-switch revocation
 * ────────────────────────────────────────────────────────────*/

export interface RevokeLockdownInput {
  readonly lockdown: LockdownDeclaration;
  readonly guardianRef: string;
  readonly reason: string;
  readonly authorizedGuardians: readonly string[];
  readonly now: string;
}

export type LockdownRevokeResult =
  | { readonly ok: true; readonly lockdown: LockdownDeclaration }
  | { readonly ok: false; readonly error: string };

/**
 * The emergency kill-switch RELEASE (distinct from lift). Semantics:
 *
 * - ANY authorized guardian may revoke, INCLUDING the declarer. Lift is the
 *   independent, second-guardian adjudication that the incident is over;
 *   revocation is the fast off-switch for a false alarm, a mis-scoped
 *   lockdown, or a lockdown that is itself blocking incident responders.
 *   Revocation only STOPS a deny — it never grants anything, so the looser
 *   authority is safe by construction.
 * - The locked-out agent can NEVER revoke its own lockdown (§5: agents are
 *   untrusted), even when listed as an authorized guardian.
 * - A non-empty reason is mandatory; the lockdown must still be active;
 *   every attempt — granted or denied — is audited.
 * - Pure: returns a NEW frozen declaration; the original is never mutated.
 *   A revoked lockdown is terminal: no further revoke, lift or renewal.
 */
export function revokeLockdown(
  input: RevokeLockdownInput,
  audit: LockdownAuditSink,
): LockdownRevokeResult {
  const deny = (denyReason: string, lockdownId: string | null): LockdownRevokeResult => {
    audit.append({
      kind: "LOCKDOWN_REVOKE_DENIED",
      at: input.now,
      guardianRef: typeof input.guardianRef === "string" ? input.guardianRef : "",
      lockdownId,
      denyReason,
    });
    return { ok: false, error: denyReason };
  };

  if (!isNonEmptyTrimmed(input.guardianRef, 200)) return deny("guardian_ref_required", null);
  if (!isNonEmptyTrimmed(input.reason, 500)) return deny("revoke_reason_required", input.lockdown.id);
  if (
    !Array.isArray(input.authorizedGuardians) ||
    !input.authorizedGuardians.includes(input.guardianRef)
  ) {
    return deny("guardian_not_authorized", input.lockdown.id);
  }
  if (lockdownState(input.lockdown, input.now) !== "active") {
    return deny("lockdown_not_active", input.lockdown.id);
  }
  if (input.lockdown.scope === "agent" && input.guardianRef === input.lockdown.agentRef) {
    return deny("self_revoke_denied", input.lockdown.id);
  }

  const revoked: LockdownDeclaration = Object.freeze({
    ...input.lockdown,
    exemptions: Object.freeze([...input.lockdown.exemptions]),
    revokedAt: input.now,
    revokedBy: input.guardianRef.trim(),
    revokeReason: input.reason.trim(),
  });

  audit.append({
    kind: "LOCKDOWN_REVOKED",
    at: input.now,
    lockdownId: revoked.id,
    revokedBy: revoked.revokedBy ?? "",
    reason: revoked.revokeReason ?? "",
  });
  return { ok: true, lockdown: revoked };
}

/* ─────────────────────────────────────────────────────────────
 * B-011 depth: bounded emergency-window renewal
 * ────────────────────────────────────────────────────────────*/

export interface RenewLockdownInput {
  readonly lockdown: LockdownDeclaration;
  readonly guardianRef: string;
  readonly reason: string;
  readonly authorizedGuardians: readonly string[];
  /** The new expiry: must parse, be strictly after the current expiry… */
  readonly newExpiresAt: string;
  /** …and no later than this mandatory ceiling. */
  readonly maxExpiresAt: string;
  /** Mandatory positive-integer cap on total renewals of this declaration. */
  readonly maxRenewals: number;
  readonly now: string;
}

export type LockdownRenewResult =
  | { readonly ok: true; readonly lockdown: LockdownDeclaration }
  | { readonly ok: false; readonly error: string };

/**
 * Bounded renewal of an ACTIVE lockdown's emergency window. Semantics:
 *
 * - Renewal is a re-adjudication of an ongoing emergency, so — like lift —
 *   it requires INDEPENDENCE: the declarer cannot renew their own lockdown,
 *   and a targeted agent can never renew it. There is no path by which one
 *   guardian extends their own emergency power indefinitely.
 * - The new expiry must strictly extend the current expiry and must not
 *   exceed the caller-supplied ceiling; renewals are also capped by count.
 *   An emergency window can decay, never grow without bound.
 * - A non-empty reason is mandatory; every attempt is audited; the result is
 *   a NEW frozen declaration (pure contract, caller swaps the reference).
 */
export function renewLockdown(
  input: RenewLockdownInput,
  audit: LockdownAuditSink,
): LockdownRenewResult {
  const deny = (denyReason: string, lockdownId: string | null): LockdownRenewResult => {
    audit.append({
      kind: "LOCKDOWN_RENEW_DENIED",
      at: input.now,
      guardianRef: typeof input.guardianRef === "string" ? input.guardianRef : "",
      lockdownId,
      denyReason,
    });
    return { ok: false, error: denyReason };
  };

  if (!isNonEmptyTrimmed(input.guardianRef, 200)) return deny("guardian_ref_required", null);
  if (!isNonEmptyTrimmed(input.reason, 500)) return deny("renewal_reason_required", input.lockdown.id);
  if (
    !Array.isArray(input.authorizedGuardians) ||
    !input.authorizedGuardians.includes(input.guardianRef)
  ) {
    return deny("guardian_not_authorized", input.lockdown.id);
  }
  if (lockdownState(input.lockdown, input.now) !== "active") {
    return deny("lockdown_not_active", input.lockdown.id);
  }
  if (input.guardianRef === input.lockdown.declaredBy) {
    return deny("renewal_independence_denied", input.lockdown.id);
  }
  if (input.lockdown.scope === "agent" && input.guardianRef === input.lockdown.agentRef) {
    return deny("self_renew_denied", input.lockdown.id);
  }
  if (!Number.isInteger(input.maxRenewals) || input.maxRenewals < 1) {
    return deny("renewal_cap_invalid", input.lockdown.id);
  }
  const currentCount = input.lockdown.renewalCount ?? 0;
  if (currentCount >= input.maxRenewals) {
    return deny("renewal_cap_reached", input.lockdown.id);
  }
  if (!isParseableFutureTimestamp(input.maxExpiresAt, Date.parse(input.now))) {
    return deny("renewal_cap_invalid", input.lockdown.id);
  }
  const currentExpiryMs = Date.parse(input.lockdown.expiresAt);
  const newExpiryMs = Date.parse(input.newExpiresAt);
  if (Number.isNaN(newExpiryMs) || newExpiryMs <= currentExpiryMs) {
    return deny("renewal_expiry_invalid", input.lockdown.id);
  }
  if (newExpiryMs > Date.parse(input.maxExpiresAt)) {
    return deny("renewal_expiry_exceeds_cap", input.lockdown.id);
  }

  const renewed: LockdownDeclaration = Object.freeze({
    ...input.lockdown,
    exemptions: Object.freeze([...input.lockdown.exemptions]),
    expiresAt: input.newExpiresAt,
    renewalCount: currentCount + 1,
    lastRenewedAt: input.now,
    lastRenewedBy: input.guardianRef.trim(),
    lastRenewalReason: input.reason.trim(),
  });

  audit.append({
    kind: "LOCKDOWN_RENEWED",
    at: input.now,
    lockdownId: renewed.id,
    renewedBy: renewed.lastRenewedBy ?? "",
    reason: renewed.lastRenewalReason ?? "",
    newExpiresAt: renewed.expiresAt,
    renewalCount: renewed.renewalCount ?? 0,
  });
  return { ok: true, lockdown: renewed };
}

/* ─────────────────────────────────────────────────────────────
 * B-011 depth: Zod contract layer (fail-closed parse of the
 * lockdown artifacts as they cross a trust boundary)
 * ────────────────────────────────────────────────────────────*/

export const lockdownExemptionSchema = z.strictObject({
  identityRef: z.string().min(1).max(200).optional(),
  tenantRef: z.string().min(1).max(128).optional(),
  capabilityRef: z.string().min(1).max(200).optional(),
  reason: z.string().min(1).max(500),
});

export const lockdownRequestSchema = z.strictObject({
  identityRef: z.string().min(1).max(200),
  tenantRef: z.string().min(1).max(200),
  capabilityRef: z.string().min(1).max(200),
});

export const lockdownDeclarationSchema = z.strictObject({
  id: z.string().min(1).max(128),
  scope: z.enum(LOCKDOWN_SCOPES),
  tenantRef: z.string().max(200).nullable(),
  agentRef: z.string().max(300).nullable(),
  capabilityRef: z.string().max(300).nullable(),
  declaredBy: z.string().min(1).max(200),
  declaredAt: z.string().min(1),
  reason: z.string().min(1).max(500),
  expiresAt: z.string().min(1),
  exemptions: z.array(lockdownExemptionSchema),
  contractVersion: z.string().min(1),
  liftedAt: z.string().nullable(),
  liftedBy: z.string().max(200).nullable(),
  liftReason: z.string().max(500).nullable(),
  revokedAt: z.string().nullable().optional(),
  revokedBy: z.string().max(200).nullable().optional(),
  revokeReason: z.string().max(500).nullable().optional(),
  renewalCount: z.number().int().nonnegative().optional(),
  lastRenewedAt: z.string().nullable().optional(),
  lastRenewedBy: z.string().max(200).nullable().optional(),
  lastRenewalReason: z.string().max(500).nullable().optional(),
});

export const lockdownAuditEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("LOCKDOWN_DECLARED"),
    at: z.string().min(1),
    lockdownId: z.string().min(1),
    scope: z.enum(LOCKDOWN_SCOPES),
    targetRef: z.string().max(300).nullable(),
    declaredBy: z.string().min(1).max(200),
    reason: z.string().min(1).max(500),
    expiresAt: z.string().min(1),
    exemptionCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal("LOCKDOWN_DECLARE_DENIED"),
    at: z.string().min(1),
    guardianRef: z.string().max(200),
    scope: z.enum(LOCKDOWN_SCOPES).nullable(),
    denyReason: z.string().min(1).max(200),
  }),
  z.strictObject({
    kind: z.literal("LOCKDOWN_REQUEST_DENIED"),
    at: z.string().min(1),
    lockdownId: z.string().min(1),
    scope: z.enum(LOCKDOWN_SCOPES),
    identityRef: z.string().min(1).max(200),
    tenantRef: z.string().min(1).max(200),
    capabilityRef: z.string().min(1).max(200),
  }),
  z.strictObject({
    kind: z.literal("LOCKDOWN_REQUEST_EXEMPTED"),
    at: z.string().min(1),
    lockdownId: z.string().min(1),
    identityRef: z.string().min(1).max(200),
    tenantRef: z.string().min(1).max(200),
    capabilityRef: z.string().min(1).max(200),
  }),
  z.strictObject({
    kind: z.literal("LOCKDOWN_LIFTED"),
    at: z.string().min(1),
    lockdownId: z.string().min(1),
    liftedBy: z.string().min(1).max(200),
    reason: z.string().min(1).max(500),
  }),
  z.strictObject({
    kind: z.literal("LOCKDOWN_LIFT_DENIED"),
    at: z.string().min(1),
    guardianRef: z.string().max(200),
    lockdownId: z.string().max(128).nullable(),
    denyReason: z.string().min(1).max(200),
  }),
  z.strictObject({
    kind: z.literal("LOCKDOWN_REVOKED"),
    at: z.string().min(1),
    lockdownId: z.string().min(1),
    revokedBy: z.string().min(1).max(200),
    reason: z.string().min(1).max(500),
  }),
  z.strictObject({
    kind: z.literal("LOCKDOWN_REVOKE_DENIED"),
    at: z.string().min(1),
    guardianRef: z.string().max(200),
    lockdownId: z.string().max(128).nullable(),
    denyReason: z.string().min(1).max(200),
  }),
  z.strictObject({
    kind: z.literal("LOCKDOWN_RENEWED"),
    at: z.string().min(1),
    lockdownId: z.string().min(1),
    renewedBy: z.string().min(1).max(200),
    reason: z.string().min(1).max(500),
    newExpiresAt: z.string().min(1),
    renewalCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal("LOCKDOWN_RENEW_DENIED"),
    at: z.string().min(1),
    guardianRef: z.string().max(200),
    lockdownId: z.string().max(128).nullable(),
    denyReason: z.string().min(1).max(200),
  }),
]);

export type LockdownParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

/** Fail-closed parse of a declaration crossing a trust boundary. */
export function parseLockdownDeclaration(value: unknown): LockdownParseResult<LockdownDeclaration> {
  const result = lockdownDeclarationSchema.safeParse(value);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: "lockdown_declaration_invalid" };
}

/** Fail-closed parse of an audit event crossing a trust boundary. */
export function parseLockdownAuditEvent(value: unknown): LockdownParseResult<LockdownAuditEvent> {
  const result = lockdownAuditEventSchema.safeParse(value);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: "lockdown_audit_event_invalid" };
}

/** Fail-closed parse of a boundary request crossing a trust boundary. */
export function parseLockdownRequest(value: unknown): LockdownParseResult<LockdownRequest> {
  const result = lockdownRequestSchema.safeParse(value);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: "lockdown_request_invalid" };
}
