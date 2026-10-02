/**
 * CoreGrid — Delegation object contract (J-025 / V1CAP-046, MISSION-R-50).
 *
 * The Delegation is a FIRST-CLASS governed object: a delegator (an actor
 * with authority) grants a delegate a BOUNDED slice of that authority to
 * act ON BEHALF OF the delegator within one mission's scope.
 *
 * Security invariants (E-045, Constitution §16/§21), all enforced at the
 * contract boundary and fail closed:
 * - BOUNDED: authority is scope-limited (one mission, an optional closed
 *   task subset), capability-limited (a closed action set), role-limited
 *   (a closed subset of the universal role vocabulary, RULING-4), and
 *   TIME-limited (notBefore/expiresAt window). An expired or not-yet-
 *   effective delegation authorizes nothing.
 * - REVOCABLE: revocation PROPAGATES — revoking a grant revokes every
 *   delegation its delegate issued onward, transitively.
 * - NON-ESCALATING (the enforceable invariant): a delegate can never hold
 *   more authority than its delegator. Enforced twice: at grant time
 *   (an escalating delegation is DENIED, never repaired) and structurally
 *   over any chain (every record's claimed delegator authority must be
 *   contained in the union of what its parents granted; delegation cycles
 *   are rejected as privilege laundering).
 * - ACTING-ON-BEHALF-OF: execution records carry both the acting delegate
 *   and the accountable delegator identity; the grant's provenance must
 *   name the delegator as its grantor.
 * - IDEMPOTENT: delegation records and delegated-action records replay
 *   idempotently by key; a reused key with DIFFERENT content is rejected
 *   (replay protection, never silently overwritten).
 *
 * Every persistent delegation object carries the canonical kernel envelope
 * (V1CAP-002) via the existing `KernelObjectEnvelope` types from
 * `kernel/reality.ts`, re-checked fail-closed with the per-contract
 * allowlist `DELEGATION_KERNEL_OBJECT_TYPES` (shared implementation from
 * `mission-contract.ts`).
 *
 * Boundary: pure contracts + validation + state machines. No persistence,
 * no I/O, no vendor imports. Execution authorization remains owned by the
 * authorized runtime layers behind their own boundary (Constitution §21).
 */

import { validateKernelObjectEnvelope, type KernelObjectEnvelope, type KernelObjectEnvelopeInput } from "../kernel/reality";
import { UNIVERSAL_ROLE_SET, type UniversalRole } from "../universal-roles";
import {
  isContractTimestamp,
  validateEmbeddedKernelEnvelope,
  type ContractValidation,
} from "./mission-contract";

/* ─────────────────────────────────────────────────────────────
 * Delegation lifecycle
 * ────────────────────────────────────────────────────────────*/

export const DELEGATION_LIFECYCLE_STATES = ["active", "suspended", "revoked", "expired"] as const;

export type DelegationLifecycle = (typeof DELEGATION_LIFECYCLE_STATES)[number];

const DELEGATION_TRANSITIONS: Readonly<Record<DelegationLifecycle, readonly DelegationLifecycle[]>> = {
  active: ["suspended", "revoked", "expired"],
  suspended: ["active", "revoked", "expired"],
  revoked: [],
  expired: [],
};

export function isDelegationTransitionAllowed(from: DelegationLifecycle, to: DelegationLifecycle): boolean {
  return DELEGATION_TRANSITIONS[from].includes(to);
}

/* ─────────────────────────────────────────────────────────────
 * The Delegation object
 * ────────────────────────────────────────────────────────────*/

export interface DelegationProvenance {
  /** The grantor — must equal the delegator identity (acting-on-behalf-of linkage). */
  readonly grantedBy: string;
  readonly grantedAt: string;
  /** The delegator's own authorization source (delegation never self-authorizes). */
  readonly authorityRef: string;
  readonly sourceRef: string | null;
  readonly generatedByAi: boolean;
  readonly verified: boolean;
}

/** Envelope-stamped delegation fields (everything but the envelope itself). */
export interface MissionDelegationCore {
  readonly delegationId: string;
  readonly schemaVersion: string;
  readonly tenantId: string;
  /** Delegations are mission-scoped: bounded scope by construction. */
  readonly missionId: string;
  /** The authority holder. */
  readonly delegatorRef: string;
  /** The actor acting on behalf of the delegator. */
  readonly delegateRef: string;
  /** Capability bound: the closed set of actions the delegate may perform. */
  readonly grantedActions: readonly string[];
  /** Role bound: the closed set of universal roles the delegate may exercise. */
  readonly grantedRoles: readonly UniversalRole[];
  /**
   * The delegator's declared authority AT GRANT TIME — the non-escalation
   * ceiling. grantedActions/grantedRoles must be subsets of these.
   */
  readonly delegatorActions: readonly string[];
  readonly delegatorRoles: readonly UniversalRole[];
  /** Scope bound: null = every mission task; otherwise a closed task subset. */
  readonly taskRefs: readonly string[] | null;
  readonly notBefore: string | null;
  readonly expiresAt: string;
  readonly lifecycle: DelegationLifecycle;
  readonly revokedAt: string | null;
  readonly revokedBy: string | null;
  readonly revocationReason: string | null;
  /** Idempotency key for delegation records (re-delegation replay safety). */
  readonly idempotencyKey: string;
  readonly provenance: DelegationProvenance;
}

/** Canonical kernel object types owned by THIS contract (per-contract allowlist). */
export const DELEGATION_KERNEL_OBJECT_TYPES = ["mission_delegation"] as const;

export const DELEGATION_CONTRACT_SCHEMA_VERSION = "1.0";

/** The persistent Delegation object: core + canonical kernel envelope (V1CAP-002). */
export interface MissionDelegation extends MissionDelegationCore {
  readonly envelope: KernelObjectEnvelope;
}

export interface MissionDelegationInput extends MissionDelegationCore {
  readonly envelope: KernelObjectEnvelopeInput;
}

/* ─────────────────────────────────────────────────────────────
 * Non-escalation invariant (E-045) — enforceable at every layer
 * ────────────────────────────────────────────────────────────*/

function subsetOf(subset: readonly string[], superset: readonly string[]): boolean {
  return subset.every((value) => superset.includes(value));
}

function roleSubsetOf(subset: readonly UniversalRole[], superset: readonly UniversalRole[]): boolean {
  return subset.every((role) => superset.includes(role));
}

/**
 * THE non-escalation invariant: the delegate's granted authority never
 * exceeds the delegator's declared authority. Every delegation MUST satisfy
 * this at grant time; `createDelegation` denies escalation outright.
 */
export function isDelegationNonEscalating(delegation: MissionDelegationCore): boolean {
  return (
    subsetOf(delegation.grantedActions, delegation.delegatorActions) &&
    roleSubsetOf(delegation.grantedRoles, delegation.delegatorRoles)
  );
}

/**
 * Structural non-escalation over an ARBITRARY chain: for every record whose
 * delegator is itself a delegate in the chain, the claimed delegator
 * authority must be contained in the union of what its parents granted
 * (union-closed, so transitivity gives: every delegate's authority ⊆ the
 * root delegator's authority). Delegation cycles are rejected: a cycle is
 * privilege laundering with no external authority ceiling.
 */
export type DelegationChainCheck = { ok: true } | { ok: false; error: string };

export function delegationChainIsNonEscalating(chain: readonly MissionDelegation[]): DelegationChainCheck {
  for (const record of chain) {
    if (!isDelegationNonEscalating(record)) {
      return { ok: false, error: `delegation "${record.delegationId}" escalates beyond its delegator` };
    }
  }

  const parentsByDelegate = new Map<string, MissionDelegation[]>();
  for (const record of chain) {
    const list = parentsByDelegate.get(record.delegateRef) ?? [];
    list.push(record);
    parentsByDelegate.set(record.delegateRef, list);
  }

  // Cycle detection over delegator -> delegate edges (three-color DFS).
  const edges = new Map<string, string[]>();
  for (const record of chain) {
    const targets = edges.get(record.delegatorRef) ?? [];
    targets.push(record.delegateRef);
    edges.set(record.delegatorRef, targets);
  }
  const UNVISITED = 0;
  const IN_PROGRESS = 1;
  const DONE = 2;
  const color = new Map<string, number>();
  const dfs = (node: string): boolean => {
    color.set(node, IN_PROGRESS);
    for (const target of edges.get(node) ?? []) {
      const state = color.get(target) ?? UNVISITED;
      if (state === IN_PROGRESS) return false;
      if (state === UNVISITED && !dfs(target)) return false;
    }
    color.set(node, DONE);
    return true;
  };
  for (const node of edges.keys()) {
    if ((color.get(node) ?? UNVISITED) === UNVISITED && !dfs(node)) {
      return { ok: false, error: "delegation cycle detected — privilege laundering is rejected" };
    }
  }

  for (const record of chain) {
    const parents = parentsByDelegate.get(record.delegatorRef);
    if (parents === undefined || parents.length === 0) continue;
    const inheritedActions = new Set<string>();
    const inheritedRoles = new Set<string>();
    for (const parent of parents) {
      if (parent.tenantId !== record.tenantId) {
        return {
          ok: false,
          error: `delegation "${record.delegationId}" links across tenants via delegator "${record.delegatorRef}"`,
        };
      }
      for (const action of parent.grantedActions) inheritedActions.add(action);
      for (const role of parent.grantedRoles) inheritedRoles.add(role);
    }
    for (const action of record.delegatorActions) {
      if (!inheritedActions.has(action)) {
        return {
          ok: false,
          error: `delegation "${record.delegationId}" claims delegator action "${action}" its delegator never held`,
        };
      }
    }
    for (const role of record.delegatorRoles) {
      if (!inheritedRoles.has(role)) {
        return {
          ok: false,
          error: `delegation "${record.delegationId}" claims delegator role "${role}" its delegator never held`,
        };
      }
    }
  }
  return { ok: true };
}

/* ─────────────────────────────────────────────────────────────
 * Validation (fail closed)
 * ────────────────────────────────────────────────────────────*/

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function distinctNonEmpty(values: readonly string[]): boolean {
  const seen = new Set<string>();
  for (const value of values) {
    if (!nonEmpty(value)) return false;
    const trimmed = value.trim();
    if (seen.has(trimmed)) return false;
    seen.add(trimmed);
  }
  return true;
}

function normalizeStringList(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function normalizeDelegationCore(core: MissionDelegationCore): MissionDelegationCore {
  return {
    ...core,
    delegationId: core.delegationId.trim(),
    schemaVersion: core.schemaVersion.trim(),
    tenantId: core.tenantId.trim(),
    missionId: core.missionId.trim(),
    delegatorRef: core.delegatorRef.trim(),
    delegateRef: core.delegateRef.trim(),
    grantedActions: normalizeStringList(core.grantedActions),
    grantedRoles: [...new Set(core.grantedRoles)],
    delegatorActions: normalizeStringList(core.delegatorActions),
    delegatorRoles: [...new Set(core.delegatorRoles)],
    taskRefs: core.taskRefs === null ? null : normalizeStringList(core.taskRefs),
    notBefore: core.notBefore === null ? null : core.notBefore.trim(),
    expiresAt: core.expiresAt.trim(),
    lifecycle: core.lifecycle,
    revokedAt: core.revokedAt === null ? null : core.revokedAt.trim(),
    revokedBy: core.revokedBy === null ? null : core.revokedBy.trim(),
    revocationReason: core.revocationReason === null ? null : core.revocationReason.trim(),
    idempotencyKey: core.idempotencyKey.trim(),
    provenance: {
      grantedBy: core.provenance.grantedBy.trim(),
      grantedAt: core.provenance.grantedAt.trim(),
      authorityRef: core.provenance.authorityRef.trim(),
      sourceRef: core.provenance.sourceRef === null ? null : core.provenance.sourceRef.trim(),
      generatedByAi: core.provenance.generatedByAi === true,
      verified: core.provenance.verified === true,
    },
  };
}

/** Returns an error string for the first violated contract law, else null.
 *
 * The optional `now` instant enables the STRUCTURAL status law (DEFECT-4):
 * expiry is enforced, not just representable. Evaluated as-of an explicit
 * instant, a contract cannot declare a status its own time window forbids —
 * no implicit clock is consulted; the caller supplies time.
 */
export function validateDelegationCore(core: MissionDelegationCore, now?: string): string | null {
  if (!nonEmpty(core.delegationId)) return "delegationId is required";
  if (!/^\d+\.\d+$/.test(core.schemaVersion)) return "schemaVersion must match MAJOR.MINOR (e.g. 1.0)";
  if (!nonEmpty(core.tenantId)) return "tenantId is required";
  if (!nonEmpty(core.missionId)) return "missionId (scope bound) is required";
  if (!nonEmpty(core.delegatorRef)) return "delegatorRef is required";
  if (!nonEmpty(core.delegateRef)) return "delegateRef is required";
  if (core.delegatorRef === core.delegateRef) return "self-delegation is not delegation";
  if (core.grantedActions.length === 0) return "a delegation grants at least one action";
  if (!distinctNonEmpty(core.grantedActions)) return "grantedActions must be non-empty and distinct";
  if (!distinctNonEmpty(core.delegatorActions)) return "delegatorActions must be non-empty and distinct";
  if (core.grantedRoles.length > 0 && !distinctNonEmpty(core.grantedRoles)) {
    return "grantedRoles must be distinct";
  }
  if (!distinctNonEmpty(core.delegatorRoles)) return "delegatorRoles must be non-empty and distinct";
  for (const role of [...core.grantedRoles, ...core.delegatorRoles]) {
    if (!UNIVERSAL_ROLE_SET.has(role)) return `role "${String(role)}" is not a universal role (RULING-4)`;
  }
  if (!isDelegationNonEscalating(core)) {
    return "delegation escalates: granted authority exceeds the delegator's declared authority (E-045)";
  }
  if (core.taskRefs !== null) {
    if (core.taskRefs.length === 0) return "taskRefs, when bounded, lists at least one task";
    if (!distinctNonEmpty(core.taskRefs)) return "taskRefs entries must be non-empty and distinct";
  }
  if (!isContractTimestamp(core.expiresAt)) return "expiresAt must be a parseable timestamp";
  if (core.notBefore !== null && !isContractTimestamp(core.notBefore)) {
    return "notBefore must be a parseable timestamp when present";
  }
  if (core.notBefore !== null && core.notBefore >= core.expiresAt) {
    return "notBefore must precede expiresAt";
  }
  if (!nonEmpty(core.idempotencyKey)) return "idempotencyKey is required";
  if (!(DELEGATION_LIFECYCLE_STATES as readonly string[]).includes(core.lifecycle)) {
    return `lifecycle "${String(core.lifecycle)}" is not a delegation lifecycle state`;
  }
  if (core.lifecycle === "revoked") {
    if (!isContractTimestamp(core.revokedAt)) return "a revoked delegation records revokedAt";
    if (!nonEmpty(core.revokedBy ?? "")) return "a revoked delegation records revokedBy";
    if (!nonEmpty(core.revocationReason ?? "")) return "a revoked delegation records revocationReason";
  } else if (core.revokedAt !== null || core.revokedBy !== null || core.revocationReason !== null) {
    return "revocation fields must be null unless the delegation is revoked";
  }
  if (!nonEmpty(core.provenance.grantedBy)) return "provenance.grantedBy is required";
  if (core.provenance.grantedBy !== core.delegatorRef) {
    return "provenance.grantedBy must be the delegator (acting-on-behalf-of identity linkage)";
  }
  if (!isContractTimestamp(core.provenance.grantedAt)) return "provenance.grantedAt must be a parseable timestamp";
  if (!nonEmpty(core.provenance.authorityRef)) return "provenance.authorityRef is required";
  if (now !== undefined) {
    if (!isContractTimestamp(now)) return "the structural-law evaluation instant must be a parseable timestamp";
    if (core.lifecycle === "expired" && core.expiresAt > now) {
      return "delegation is marked expired before its expiresAt — expiry is enforced structurally, never pre-empted by state";
    }
    if ((core.lifecycle === "active" || core.lifecycle === "suspended") && core.expiresAt <= now) {
      return `delegation cannot be ${core.lifecycle} after its expiresAt — expired status is structural, never advisory (DEFECT-4)`;
    }
    if (core.lifecycle === "revoked" && core.revokedAt !== null && core.revokedAt > now) {
      return "delegation cannot be revoked at a future instant — revocation is structural, never pre-emptive";
    }
  }
  return null;
}

/** Full contract validation: core laws + embedded kernel envelope conformance.
 *
 * The optional `now` instant enables the structural status law (DEFECT-4):
 * see `validateDelegationCore`.
 */
export function validateDelegationContract(delegation: MissionDelegation, now?: string): ContractValidation {
  const coreError = validateDelegationCore(delegation, now);
  if (coreError !== null) return { ok: false, error: coreError };
  const envelopeError = validateEmbeddedKernelEnvelope(
    delegation.envelope,
    delegation.tenantId,
    DELEGATION_KERNEL_OBJECT_TYPES,
  );
  if (envelopeError !== null) return { ok: false, error: envelopeError };
  return { ok: true };
}

/**
 * Fail-closed stamping write path: normalizes, validates every contract law
 * (including the non-escalation invariant), and validates the canonical
 * kernel envelope against the per-contract object-type allowlist. Throws —
 * never repairs — on any violation.
 */
export function stampDelegationContract(
  input: MissionDelegationInput,
  knownObjectTypes: readonly string[] = DELEGATION_KERNEL_OBJECT_TYPES,
): MissionDelegation {
  const core = normalizeDelegationCore(input);
  const coreError = validateDelegationCore(core);
  if (coreError !== null) {
    throw new Error(`delegation contract rejected: ${coreError}`);
  }
  const envelope = validateKernelObjectEnvelope(input.envelope, knownObjectTypes);
  const envelopeError = validateEmbeddedKernelEnvelope(envelope, core.tenantId, knownObjectTypes);
  if (envelopeError !== null) {
    throw new Error(`delegation contract rejected: ${envelopeError}`);
  }
  return { ...core, envelope };
}

/* ─────────────────────────────────────────────────────────────
 * Delegation state machine (transitions fail closed)
 * ────────────────────────────────────────────────────────────*/

export interface DelegationTransitionContext {
  readonly now: string;
  /** Required for revocation. */
  readonly by?: string;
  /** Required for revocation. */
  readonly reason?: string;
}

export type DelegationTransitionResult =
  | { ok: true; delegation: MissionDelegation }
  | { ok: false; denyReason: string; error: string };

/**
 * Transition a delegation. Fails closed on: illegal transitions, terminal
 * mutation, early expiry (a delegation becomes "expired" only once its
 * expiresAt has actually passed), and unattributed revocation.
 */
export function transitionDelegation(
  delegation: MissionDelegation,
  to: DelegationLifecycle,
  ctx: DelegationTransitionContext,
): DelegationTransitionResult {
  const validation = validateDelegationContract(delegation);
  if (!validation.ok) {
    return { ok: false, denyReason: "invalid_contract", error: validation.error };
  }
  if (delegation.lifecycle === "revoked" || delegation.lifecycle === "expired") {
    return {
      ok: false,
      denyReason: "terminal_immutable",
      error: `${delegation.lifecycle} is terminal — delegations cannot leave it`,
    };
  }
  if (!isDelegationTransitionAllowed(delegation.lifecycle, to)) {
    return {
      ok: false,
      denyReason: "illegal_transition",
      error: `transition ${delegation.lifecycle} -> ${to} is not allowed`,
    };
  }
  if (to === "expired") {
    if (delegation.expiresAt > ctx.now) {
      return {
        ok: false,
        denyReason: "not_yet_expired",
        error: `delegation expires at ${delegation.expiresAt} — bounded expiry is enforced, never pre-empted by state`,
      };
    }
    return { ok: true, delegation: { ...delegation, lifecycle: "expired" } };
  }
  if (to === "revoked") {
    if (!nonEmpty(ctx.by ?? "")) return { ok: false, denyReason: "unattributed_revocation", error: "revocation requires an attributing actor (by)" };
    if (!nonEmpty(ctx.reason ?? "")) return { ok: false, denyReason: "unattributed_revocation", error: "revocation requires a reason" };
    return {
      ok: true,
      delegation: {
        ...delegation,
        lifecycle: "revoked",
        revokedAt: ctx.now,
        revokedBy: (ctx.by ?? "").trim(),
        revocationReason: (ctx.reason ?? "").trim(),
      },
    };
  }
  return { ok: true, delegation: { ...delegation, lifecycle: to } };
}

/* ─────────────────────────────────────────────────────────────
 * Idempotent delegation records
 * ────────────────────────────────────────────────────────────*/

export type DelegationCreationResult =
  | { ok: true; delegation: MissionDelegation; replay: boolean }
  | { ok: false; denyReason: "idempotent_conflict" | "escalation_denied" | "invalid"; error: string };

/**
 * Record a delegation idempotently. Replay semantics mirror the foundation
 * loop admission: the same idempotency key (+ tenant, mission, delegator,
 * delegate) returns the ORIGINAL record with `replay: true` and no new
 * effect. The same key with different content is a replay attack and is
 * rejected. Escalation attempts are denied outright (E-045).
 */
export function createDelegation(
  prior: readonly MissionDelegation[],
  input: MissionDelegationInput,
): DelegationCreationResult {
  const core = normalizeDelegationCore(input);
  const existing = prior.find(
    (record) =>
      record.idempotencyKey === core.idempotencyKey &&
      record.tenantId === core.tenantId &&
      record.missionId === core.missionId &&
      record.delegatorRef === core.delegatorRef &&
      record.delegateRef === core.delegateRef,
  );
  if (existing !== undefined) {
    const taskRefsMatch =
      existing.taskRefs === null
        ? core.taskRefs === null
        : core.taskRefs !== null && existing.taskRefs.join("\u0000") === core.taskRefs.join("\u0000");
    const contentMatches =
      existing.delegationId === core.delegationId &&
      existing.grantedActions.join("\u0000") === core.grantedActions.join("\u0000") &&
      existing.grantedRoles.join("\u0000") === core.grantedRoles.join("\u0000") &&
      taskRefsMatch &&
      existing.notBefore === core.notBefore &&
      existing.expiresAt === core.expiresAt;
    if (!contentMatches) {
      return {
        ok: false,
        denyReason: "idempotent_conflict",
        error: `idempotencyKey "${core.idempotencyKey}" already records a different delegation`,
      };
    }
    return { ok: true, delegation: existing, replay: true };
  }
  if (!isDelegationNonEscalating(core)) {
    return {
      ok: false,
      denyReason: "escalation_denied",
      error: "delegation escalates beyond the delegator's authority — denied (E-045)",
    };
  }
  const coreError = validateDelegationCore(core);
  if (coreError !== null) {
    return { ok: false, denyReason: "invalid", error: coreError };
  }
  try {
    return { ok: true, delegation: stampDelegationContract(input), replay: false };
  } catch (error) {
    return { ok: false, denyReason: "invalid", error: error instanceof Error ? error.message : "invalid delegation" };
  }
}

/* ─────────────────────────────────────────────────────────────
 * Bounded authorization: acting on behalf of
 * ────────────────────────────────────────────────────────────*/

export type DelegationDenyReason =
  | "revoked"
  | "suspended"
  | "expired"
  | "not_yet_effective"
  | "delegate_mismatch"
  | "cross_tenant"
  | "mission_mismatch"
  | "action_not_granted"
  | "task_out_of_scope";

export interface DelegatedActionAttempt {
  readonly delegateRef: string;
  readonly tenantId: string;
  readonly missionId: string;
  readonly action: string;
  /** null = mission-level action; otherwise the task it is performed under. */
  readonly taskRef: string | null;
}

export type DelegationAuthorization =
  | { ok: true; onBehalfOf: string }
  | { ok: false; denyReason: DelegationDenyReason };

/**
 * Authorize an action performed by the delegate. Every non-allow path fails
 * closed with a named deny reason: lifecycle, the time window (bounded
 * expiry + notBefore), identity, tenant, mission scope, capability bound,
 * and task scope.
 */
export function authorizeDelegatedAction(
  delegation: MissionDelegation,
  attempt: DelegatedActionAttempt,
  now: string,
): DelegationAuthorization {
  if (attempt.tenantId !== delegation.tenantId) {
    return { ok: false, denyReason: "cross_tenant" };
  }
  if (attempt.missionId !== delegation.missionId) {
    return { ok: false, denyReason: "mission_mismatch" };
  }
  if (attempt.delegateRef !== delegation.delegateRef) {
    return { ok: false, denyReason: "delegate_mismatch" };
  }
  if (delegation.lifecycle === "revoked") return { ok: false, denyReason: "revoked" };
  if (delegation.lifecycle === "expired") return { ok: false, denyReason: "expired" };
  if (delegation.lifecycle === "suspended") return { ok: false, denyReason: "suspended" };
  if (delegation.notBefore !== null && delegation.notBefore > now) {
    return { ok: false, denyReason: "not_yet_effective" };
  }
  if (delegation.expiresAt <= now) {
    return { ok: false, denyReason: "expired" };
  }
  if (!delegation.grantedActions.includes(attempt.action)) {
    return { ok: false, denyReason: "action_not_granted" };
  }
  if (attempt.taskRef !== null && delegation.taskRefs !== null && !delegation.taskRefs.includes(attempt.taskRef)) {
    return { ok: false, denyReason: "task_out_of_scope" };
  }
  return { ok: true, onBehalfOf: delegation.delegatorRef };
}

/** Delegated-action execution record: the delegate AND the accountable delegator. */
export interface DelegatedActionRecord {
  readonly recordId: string;
  readonly delegationId: string;
  readonly tenantId: string;
  readonly missionId: string;
  readonly delegateRef: string;
  /** Acting-on-behalf-of identity linkage. */
  readonly onBehalfOf: string;
  readonly action: string;
  readonly taskRef: string | null;
  readonly performedAt: string;
  readonly idempotencyKey: string;
}

export type DelegatedActionOutcome =
  | { ok: true; record: DelegatedActionRecord; replay: boolean }
  | { ok: false; denyReason: DelegationDenyReason | "invalid_attempt"; error: string };

export interface DelegatedActionInput extends DelegatedActionAttempt {
  readonly recordId: string;
  readonly idempotencyKey: string;
}

/**
 * Record a delegated action idempotently, gated by the delegation's bounded
 * authorization. Replay by key returns the original record with no new
 * effect; a new key with an unauthorized action is denied with the named
 * reason.
 */
export function recordDelegatedAction(
  delegation: MissionDelegation,
  prior: readonly DelegatedActionRecord[],
  input: DelegatedActionInput,
  now: string,
): DelegatedActionOutcome {
  const wellFormed =
    nonEmpty(input.recordId) &&
    nonEmpty(input.idempotencyKey) &&
    nonEmpty(input.action) &&
    nonEmpty(input.delegateRef) &&
    isContractTimestamp(now);
  if (!wellFormed) {
    return { ok: false, denyReason: "invalid_attempt", error: "delegated action attempt is malformed" };
  }
  const existing = prior.find(
    (record) =>
      record.idempotencyKey === input.idempotencyKey &&
      record.delegationId === delegation.delegationId &&
      record.delegateRef === input.delegateRef &&
      record.action === input.action,
  );
  if (existing !== undefined) {
    return { ok: true, record: existing, replay: true };
  }
  const authorization = authorizeDelegatedAction(delegation, input, now);
  if (!authorization.ok) {
    return { ok: false, denyReason: authorization.denyReason, error: `action denied: ${authorization.denyReason}` };
  }
  return {
    ok: true,
    record: {
      recordId: input.recordId.trim(),
      delegationId: delegation.delegationId,
      tenantId: delegation.tenantId,
      missionId: delegation.missionId,
      delegateRef: input.delegateRef.trim(),
      onBehalfOf: delegation.delegatorRef,
      action: input.action.trim(),
      taskRef: input.taskRef,
      performedAt: now,
      idempotencyKey: input.idempotencyKey.trim(),
    },
    replay: false,
  };
}

/* ─────────────────────────────────────────────────────────────
 * As-of evaluation: expiry is ENFORCED, not just representable
 * (DEFECT-4, MISSION-R-52 / V1CAP-021)
 * ────────────────────────────────────────────────────────────*/

export type DelegationAsOfEvaluation =
  | { ok: true; onBehalfOf: string }
  | { ok: false; denyReason: DelegationDenyReason | "invalid_contract"; error: string };

/**
 * Authoritative evaluation of a delegation AS-OF an explicit instant (the
 * contract receives time; no implicit Date.now()). The declared lifecycle
 * status is never trusted over the record's own time window or its
 * structural laws:
 * - an invalid contract denies (fail closed) — including the structural
 *   status law when the record carries a status its window forbids;
 * - a not-yet-effective (`notBefore` in the future) delegation denies,
 *   regardless of declared status;
 * - a delegation whose `expiresAt` has passed denies as expired, regardless
 *   of declared status (an "active" stamp cannot resurrect a lapsed grant);
 * - revoked, expired and suspended statuses deny.
 */
export function evaluateDelegationAsOf(delegation: MissionDelegation, now: string): DelegationAsOfEvaluation {
  if (!isContractTimestamp(now)) {
    return { ok: false, denyReason: "invalid_contract", error: "evaluation instant is not a parseable timestamp" };
  }
  const validation = validateDelegationContract(delegation);
  if (!validation.ok) {
    return { ok: false, denyReason: "invalid_contract", error: validation.error };
  }
  if (delegation.lifecycle === "revoked") {
    return { ok: false, denyReason: "revoked", error: `delegation "${delegation.delegationId}" is revoked` };
  }
  if (delegation.lifecycle === "expired") {
    return { ok: false, denyReason: "expired", error: `delegation "${delegation.delegationId}" is expired` };
  }
  if (delegation.lifecycle === "suspended") {
    return { ok: false, denyReason: "suspended", error: `delegation "${delegation.delegationId}" is suspended` };
  }
  if (delegation.notBefore !== null && delegation.notBefore > now) {
    return {
      ok: false,
      denyReason: "not_yet_effective",
      error: `delegation "${delegation.delegationId}" is not effective before ${delegation.notBefore}`,
    };
  }
  if (delegation.expiresAt <= now) {
    return {
      ok: false,
      denyReason: "expired",
      error: `delegation "${delegation.delegationId}" expired at ${delegation.expiresAt} (evaluated as-of ${now})`,
    };
  }
  return { ok: true, onBehalfOf: delegation.delegatorRef };
}

export type DelegationChainDenyReason =
  | DelegationDenyReason
  | "invalid_contract"
  | "record_not_found"
  | "chain_not_non_escalating";

export type DelegationChainEvaluation =
  | { ok: true; /** delegationIds on the evaluated ancestor closure, target first. */ path: readonly string[] }
  | { ok: false; denyReason: DelegationChainDenyReason; error: string; delegationId: string | null };

/**
 * Transitive law composing REVOCATION with EXPIRY over a delegation chain
 * (DEFECT-4): a delegation is usable as-of an instant only if EVERY record
 * in its ancestor closure (the record itself plus every grant its authority
 * transitively rests on) is usable as-of that instant. An expired, revoked,
 * suspended, not-yet-effective or structurally invalid link anywhere in the
 * closure invalidates the whole downstream path — a descendant cannot draw
 * authority through a dead link. Composition is fail closed: the chain must
 * first satisfy the structural non-escalation law (E-045), then every link
 * must pass `evaluateDelegationAsOf`.
 */
export function evaluateDelegationChainAsOf(
  chain: readonly MissionDelegation[],
  targetDelegationId: string,
  now: string,
): DelegationChainEvaluation {
  if (!isContractTimestamp(now)) {
    return {
      ok: false,
      denyReason: "invalid_contract",
      error: "chain evaluation instant is not a parseable timestamp",
      delegationId: null,
    };
  }
  const structure = delegationChainIsNonEscalating(chain);
  if (!structure.ok) {
    return { ok: false, denyReason: "chain_not_non_escalating", error: structure.error, delegationId: null };
  }
  const target = chain.find((record) => record.delegationId === targetDelegationId);
  if (target === undefined) {
    return {
      ok: false,
      denyReason: "record_not_found",
      error: `delegation "${targetDelegationId}" is not part of the evaluated chain`,
      delegationId: targetDelegationId,
    };
  }

  const byDelegate = new Map<string, MissionDelegation[]>();
  for (const record of chain) {
    const list = byDelegate.get(record.delegateRef) ?? [];
    list.push(record);
    byDelegate.set(record.delegateRef, list);
  }
  const path: MissionDelegation[] = [];
  const seen = new Set<string>([target.delegationId]);
  let frontier: readonly MissionDelegation[] = [target];
  while (frontier.length > 0) {
    const next: MissionDelegation[] = [];
    for (const record of frontier) {
      path.push(record);
      for (const parent of byDelegate.get(record.delegatorRef) ?? []) {
        if (!seen.has(parent.delegationId)) {
          seen.add(parent.delegationId);
          next.push(parent);
        }
      }
    }
    frontier = next;
  }

  for (const record of path) {
    const verdict = evaluateDelegationAsOf(record, now);
    if (!verdict.ok) {
      return {
        ok: false,
        denyReason: verdict.denyReason,
        error: `delegation chain broken at "${record.delegationId}": ${verdict.error}`,
        delegationId: record.delegationId,
      };
    }
  }
  return { ok: true, path: path.map((record) => record.delegationId) };
}

/* ─────────────────────────────────────────────────────────────
 * Bounded expiry and revocation propagation
 * ────────────────────────────────────────────────────────────*/

/**
 * Bounded expiry enforcement: non-terminal delegations (active OR suspended)
 * whose expiresAt has passed become "expired" — a lapsed grant can never
 * remain in a non-terminal status (DEFECT-4 structural law). Idempotent —
 * already-expired and revoked records are untouched.
 */
export function markExpiredDelegations(
  records: readonly MissionDelegation[],
  now: string,
): readonly MissionDelegation[] {
  return records.map((record) =>
    (record.lifecycle === "active" || record.lifecycle === "suspended") && record.expiresAt <= now
      ? { ...record, lifecycle: "expired" }
      : record,
  );
}

export type DelegationRevocationResult =
  | { ok: true; revoked: readonly MissionDelegation[] }
  | { ok: false; denyReason: string; error: string };

/**
 * Revoke a delegation AND PROPAGATE the revocation transitively: every
 * delegation granted by a revoked record's delegate (same tenant and
 * mission) is revoked, and so on down the chain. Propagation routes THROUGH
 * non-usable links as well: a descendant whose chain passes through an
 * expired or already-revoked link is revoked too, because it can no longer
 * draw authority through that link (DEFECT-4 — revocation composes with
 * expiry). Revocation is attributed (by + reason) on every affected record;
 * terminal records keep their status.
 */
export function revokeDelegationChain(
  root: MissionDelegation,
  candidates: readonly MissionDelegation[],
  ctx: { now: string; by: string; reason: string },
): DelegationRevocationResult {
  if (root.lifecycle === "revoked") {
    return { ok: false, denyReason: "already_revoked", error: `delegation "${root.delegationId}" is already revoked` };
  }
  if (root.lifecycle === "expired") {
    return { ok: false, denyReason: "already_expired", error: `delegation "${root.delegationId}" is expired — nothing to revoke` };
  }
  if (!nonEmpty(ctx.by)) return { ok: false, denyReason: "unattributed_revocation", error: "revocation requires an attributing actor (by)" };
  if (!nonEmpty(ctx.reason)) return { ok: false, denyReason: "unattributed_revocation", error: "revocation requires a reason" };

  const visitedIds = new Set<string>();
  const revokedIds = new Set<string>();
  const revoked: MissionDelegation[] = [];
  const visitRecord = (record: MissionDelegation): void => {
    visitedIds.add(record.delegationId);
    if (record.lifecycle === "active" || record.lifecycle === "suspended") {
      revokedIds.add(record.delegationId);
      revoked.push({
        ...record,
        lifecycle: "revoked",
        revokedAt: ctx.now,
        revokedBy: ctx.by.trim(),
        revocationReason: ctx.reason.trim(),
      });
    }
    // Expired and already-revoked links stay in their terminal status but
    // still PASS THE PROPAGATION FRONTIER THROUGH: descendants whose chains
    // route through a revoked or expired link are invalidated too (DEFECT-4
    // transitive law — revocation composes with expiry).
  };

  visitRecord(root);
  let frontier: readonly string[] = [root.delegateRef];
  while (frontier.length > 0) {
    const nextFrontier: string[] = [];
    for (const candidate of candidates) {
      if (visitedIds.has(candidate.delegationId)) continue;
      if (
        frontier.includes(candidate.delegatorRef) &&
        candidate.tenantId === root.tenantId &&
        candidate.missionId === root.missionId
      ) {
        visitRecord(candidate);
        nextFrontier.push(candidate.delegateRef);
      }
    }
    frontier = nextFrontier;
  }
  return { ok: true, revoked };
}