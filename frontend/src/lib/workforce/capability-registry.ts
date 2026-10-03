/**
 * CoreGrid — worker capability registry & delegation-contract matching
 * (V1CAP-049 / J-028 / MISSION-R-41, wave 3).
 *
 * E-035: workers only CLAIM, DECLARE, and EXERCISE capabilities — never
 * more. This module is the registry those declarations resolve against:
 *
 * - REGISTRY INTEGRITY: a capability is a first-class registered object
 *   (stable id, contract description, risk classification, evidence
 *   requirements). A worker declaration that references an unregistered
 *   capability id is an integrity FAILURE — fail closed, never silently
 *   accepted.
 * - CAPABILITY-OVER-AGENT MATCHING (E-033/E-046): given a task requirement
 *   (required capability ids + a max risk-class ceiling), the matcher
 *   returns every qualified worker whose DECLARED capabilities satisfy the
 *   requirement with declared risk ≤ the required ceiling. Assignment is
 *   never name-based: two workers with equal capability declarations are
 *   interchangeable to the matcher (model neutrality, T2).
 * - DELEGATION-CONTRACT COMPATIBILITY: given a delegation's authority
 *   requirement (authorizedActions / authorizedRoles / maxRiskClass — the
 *   Delegation vocabulary from `mission/delegation-contract.ts`), the
 *   evaluator produces an explicit compatible/incompatible verdict with a
 *   PER-AXIS reason list. There is no silent pass: every axis that fails is
 *   named (tenant, lifecycle, registry integrity, capability, risk, role).
 * - REVOCATION PROPAGATION: match results are computed FRESH from the
 *   inputs on every call — nothing is cached past revocation. A worker
 *   definition whose lifecycle becomes suspended/archived/deleted, or a
 *   capability removed from the registry, is immediately disqualified on
 *   the next evaluation with the reason named.
 * - NO ESCALATION: a match can never GRANT capability. The returned match
 *   carries exactly the required ∩ declared ∩ registered set; nothing in
 *   the matcher's output widens a worker's declared authority.
 *
 * Composition: worker definitions come from `worker-definition.ts`
 * (persistent governed definitions), the risk vocabulary from
 * `agent-core.ts`, and the role vocabulary from `universal-roles.ts`. This
 * module owns none of those vocabularies — it matches against them.
 *
 * Boundary: pure data + pure functions. No persistence, no I/O, no vendor.
 */

import { AGENT_RISK_CLASSIFICATIONS, type AgentRiskClassification } from "../agent-core";
import { UNIVERSAL_ROLE_SET, type UniversalRole } from "../universal-roles";
import { riskClassRank, type WorkerDefinition } from "./worker-definition";

/** The risk vocabulary as a set, for fail-closed membership checks. */
const AGENT_RISK_CLASSIFICATION_SET: ReadonlySet<string> = new Set<string>(
  AGENT_RISK_CLASSIFICATIONS,
);

/* ─────────────────────────────────────────────────────────────
 * Registered capability shape
 * ────────────────────────────────────────────────────────────*/

/** One registered capability: stable id, contract, risk, evidence duty. */
export interface RegisteredCapability {
  /** Stable capability id — the ONLY join key between registry and declarations. */
  readonly capabilityId: string;
  /** The contract description: what exercising this capability means. */
  readonly contract: string;
  /** Risk classification of exercising the capability (ceiling source). */
  readonly riskClass: AgentRiskClassification;
  /** Evidence that MUST be produced when the capability is exercised. */
  readonly evidenceRequirements: readonly string[];
}

export interface CapabilityRegistrationInput {
  readonly capabilityId: string;
  readonly contract: string;
  readonly riskClass: AgentRiskClassification;
  readonly evidenceRequirements: readonly string[];
}

/** The registry: capability ids are unique keys (immutable map semantics). */
export type CapabilityRegistry = ReadonlyMap<string, RegisteredCapability>;

export type CapabilityRegistrationResult =
  { ok: true; registry: CapabilityRegistry } | { ok: false; errors: readonly string[] };

function isNonEmptyTrimmed(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= maxLength;
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

/**
 * Register a capability into the registry. Fails closed on: an empty or
 * oversized id, an empty contract description, a risk class outside the
 * agent risk vocabulary, or an empty evidence-requirement set (a capability
 * that can be exercised without producing evidence must not exist).
 */
export function registerCapability(
  registry: CapabilityRegistry,
  input: CapabilityRegistrationInput,
): CapabilityRegistrationResult {
  const errors: string[] = [];
  if (!isNonEmptyTrimmed(input.capabilityId, 160)) {
    errors.push("capabilityId must be 1–160 characters");
  } else if (registry.has(input.capabilityId.trim())) {
    errors.push(`capabilityId "${input.capabilityId.trim()}" is already registered`);
  }
  if (!isNonEmptyTrimmed(input.contract, 500)) {
    errors.push("capability contract must be 1–500 characters");
  }
  if (!(AGENT_RISK_CLASSIFICATION_SET as ReadonlySet<string>).has(input.riskClass)) {
    errors.push("capability riskClass must be in the agent risk vocabulary");
  }
  if (!Array.isArray(input.evidenceRequirements) || input.evidenceRequirements.length === 0) {
    errors.push("a registered capability requires at least one evidence requirement");
  } else {
    const evidence = normalizeStringList(input.evidenceRequirements);
    if (evidence.length === 0) {
      errors.push("evidenceRequirements must contain at least one distinct non-empty entry");
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const capabilityId = (input.capabilityId as string).trim();
  const registered: RegisteredCapability = {
    capabilityId,
    contract: (input.contract as string).trim(),
    riskClass: input.riskClass,
    evidenceRequirements: normalizeStringList(input.evidenceRequirements),
  };
  const next = new Map(registry);
  next.set(capabilityId, registered);
  return { ok: true, registry: next };
}

/** Build a registry from an ordered list of registrations (fail closed). */
export function createCapabilityRegistry(
  inputs: readonly CapabilityRegistrationInput[],
): CapabilityRegistrationResult {
  let registry: CapabilityRegistry = new Map<string, RegisteredCapability>();
  for (const input of inputs) {
    const result = registerCapability(registry, input);
    if (!result.ok) return result;
    registry = result.registry;
  }
  return { ok: true, registry };
}

/* ─────────────────────────────────────────────────────────────
 * Registry integrity — declarations resolve against registrations
 * ────────────────────────────────────────────────────────────*/

export type WorkerCapabilityIntegrityCheck =
  | { ok: true; workerId: string }
  | { ok: false; workerId: string; unregisteredCapabilityIds: readonly string[] };

/**
 * Registry integrity check: every capability a worker DECLARES must be
 * registered. An unregistered declaration is an integrity failure — the
 * worker can never qualify for a match while it holds one (fail closed,
 * never silently accepted).
 */
export function checkWorkerCapabilityIntegrity(
  registry: CapabilityRegistry,
  worker: WorkerDefinition,
): WorkerCapabilityIntegrityCheck {
  const unregistered = worker.capabilities
    .map((declaration) => declaration.capabilityId)
    .filter((capabilityId) => !registry.has(capabilityId));
  if (unregistered.length > 0) {
    return { ok: false, workerId: worker.id, unregisteredCapabilityIds: unregistered };
  }
  return { ok: true, workerId: worker.id };
}

/* ─────────────────────────────────────────────────────────────
 * Capability-over-agent matching (E-033/E-046)
 * ────────────────────────────────────────────────────────────*/

/** A task requirement expressed in capability vocabulary. */
export interface CapabilityRequirement {
  /** Tenant the task is scoped to (multi-tenancy law: never null). */
  readonly tenantId: string;
  /** The closed set of capability ids the task requires. */
  readonly requiredCapabilityIds: readonly string[];
  /** Ceiling: no required capability may exceed this risk class. */
  readonly maxRiskClass: AgentRiskClassification;
}

/** The axes a worker can fail a match on — every denial names its axis. */
export type CapabilityMatchAxis =
  "tenant" | "lifecycle" | "registry_integrity" | "capability" | "risk";

export interface CapabilityMatchFailure {
  readonly workerId: string;
  readonly axis: CapabilityMatchAxis;
  readonly reason: string;
}

export interface WorkerCapabilityMatch {
  readonly workerId: string;
  readonly tenantScope: string;
  /** Exactly the required ∩ declared ∩ registered set — never more. */
  readonly matchedCapabilities: readonly string[];
  /** Max risk over the matched capabilities (the match's effective risk). */
  readonly effectiveRiskClass: AgentRiskClassification;
}

export interface CapabilityMatchResult {
  readonly qualified: readonly WorkerCapabilityMatch[];
  readonly disqualified: readonly CapabilityMatchFailure[];
}

function usableLifecycle(worker: WorkerDefinition): boolean {
  return worker.lifecycle === "active" || worker.lifecycle === "provisioned";
}

function declaredCapabilityIds(worker: WorkerDefinition): ReadonlySet<string> {
  return new Set(worker.capabilities.map((declaration) => declaration.capabilityId));
}

/**
 * Match a capability requirement against worker definitions. Per worker,
 * every non-allow path fails closed with the failing axis and reason:
 *  - tenant — the worker is scoped to another tenant (cross-tenant never
 *    matches);
 *  - lifecycle — suspended/archived/deleted workers are disqualified
 *    immediately (revocation propagation: evaluation happens fresh at
 *    call time, so a lifecycle change disqualifies the next evaluation);
 *  - registry_integrity — the worker declares an unregistered capability;
 *  - capability — a required capability is not declared by the worker;
 *  - risk — a required capability's registered risk exceeds the
 *    requirement ceiling or the worker's own authority ceiling (denied,
 *    never clamped).
 */
export function matchWorkersForCapabilityRequirement(
  registry: CapabilityRegistry,
  workers: readonly WorkerDefinition[],
  requirement: CapabilityRequirement,
): CapabilityMatchResult {
  const requiredIds = normalizeStringList(requirement.requiredCapabilityIds);
  if (requiredIds.length === 0) {
    throw new Error("capability requirement must list at least one required capability");
  }
  if (!(AGENT_RISK_CLASSIFICATION_SET as ReadonlySet<string>).has(requirement.maxRiskClass)) {
    throw new Error("capability requirement maxRiskClass must be in the agent risk vocabulary");
  }
  const unregisteredRequired = requiredIds.filter((capabilityId) => !registry.has(capabilityId));
  if (unregisteredRequired.length > 0) {
    throw new Error(
      `capability requirement references unregistered capabilities: ${unregisteredRequired.join(", ")}`,
    );
  }
  if (!isNonEmptyTrimmed(requirement.tenantId, 128)) {
    throw new Error("capability requirement tenantId must be 1–128 characters");
  }

  const requirementCeiling = riskClassRank(requirement.maxRiskClass);
  const qualified: WorkerCapabilityMatch[] = [];
  const disqualified: CapabilityMatchFailure[] = [];

  for (const worker of workers) {
    if (worker.tenantScope !== requirement.tenantId.trim()) {
      disqualified.push({
        workerId: worker.id,
        axis: "tenant",
        reason: `worker tenant scope "${worker.tenantScope}" does not match requirement tenant "${requirement.tenantId.trim()}"`,
      });
      continue;
    }
    if (!usableLifecycle(worker)) {
      disqualified.push({
        workerId: worker.id,
        axis: "lifecycle",
        reason: `worker lifecycle "${worker.lifecycle}" is unusable (revocation propagated)`,
      });
      continue;
    }
    const integrity = checkWorkerCapabilityIntegrity(registry, worker);
    if (!integrity.ok) {
      disqualified.push({
        workerId: worker.id,
        axis: "registry_integrity",
        reason: `worker declares unregistered capabilities: ${integrity.unregisteredCapabilityIds.join(", ")}`,
      });
      continue;
    }
    const declared = declaredCapabilityIds(worker);
    const missing = requiredIds.filter((capabilityId) => !declared.has(capabilityId));
    if (missing.length > 0) {
      disqualified.push({
        workerId: worker.id,
        axis: "capability",
        reason: `required capabilities not declared: ${missing.join(", ")}`,
      });
      continue;
    }
    let effectiveRank = 0;
    let effectiveRiskClass: AgentRiskClassification = "low";
    let riskFailure: string | null = null;
    for (const capabilityId of requiredIds) {
      const capability = registry.get(capabilityId);
      if (capability === undefined) {
        riskFailure = `required capability "${capabilityId}" vanished from the registry at evaluation time`;
        break;
      }
      const rank = riskClassRank(capability.riskClass);
      if (rank > requirementCeiling) {
        riskFailure = `required capability "${capabilityId}" risk "${capability.riskClass}" exceeds requirement ceiling "${requirement.maxRiskClass}"`;
        break;
      }
      const workerCeiling = riskClassRank(worker.authorityBounds.maxRiskClass);
      if (rank > workerCeiling) {
        riskFailure = `required capability "${capabilityId}" risk "${capability.riskClass}" exceeds worker authority ceiling "${worker.authorityBounds.maxRiskClass}"`;
        break;
      }
      if (rank > effectiveRank) {
        effectiveRank = rank;
        effectiveRiskClass = capability.riskClass;
      }
    }
    if (riskFailure !== null) {
      disqualified.push({ workerId: worker.id, axis: "risk", reason: riskFailure });
      continue;
    }
    qualified.push({
      workerId: worker.id,
      tenantScope: worker.tenantScope,
      matchedCapabilities: requiredIds,
      effectiveRiskClass,
    });
  }

  return { qualified, disqualified };
}

/* ─────────────────────────────────────────────────────────────
 * Delegation-contract compatibility
 * ────────────────────────────────────────────────────────────*/

/**
 * The authority slice a delegation would place on a worker, expressed in
 * the Delegation contract's vocabulary (`mission/delegation-contract.ts`):
 * authorizedActions (capability ids), authorizedRoles (universal roles,
 * RULING-4), and the delegation's risk ceiling.
 */
export interface DelegationAuthorityRequirement {
  readonly tenantId: string;
  readonly authorizedActions: readonly string[];
  readonly authorizedRoles: readonly UniversalRole[];
  readonly maxRiskClass: AgentRiskClassification;
}

/** The axes a delegation compatibility verdict evaluates. */
export type DelegationCompatibilityAxis =
  "tenant" | "lifecycle" | "registry_integrity" | "capability" | "risk" | "role";

export interface DelegationCompatibilityReason {
  readonly axis: DelegationCompatibilityAxis;
  readonly reason: string;
}

export type DelegationCompatibilityVerdict =
  | {
      compatible: true;
      /** The capability ids exercised under the delegation (declared ∩ registered ∩ authorized). */
      exercisedCapabilities: readonly string[];
      /** Max risk over the exercised capabilities. */
      effectiveRiskClass: AgentRiskClassification;
    }
  | { compatible: false; reasons: readonly DelegationCompatibilityReason[] };

/**
 * Evaluate whether a worker's declared capability set satisfies a
 * delegation's authority requirement. The verdict is EXPLICIT on every
 * axis — a compatible verdict exists only when all axes pass, and an
 * incompatible verdict names every failing axis with a reason (never a
 * silent pass):
 *  - tenant: the delegation's tenant must equal the worker's tenant scope;
 *  - lifecycle: suspended/archived/deleted workers satisfy nothing
 *    (revocation propagation — evaluated fresh at call time);
 *  - registry_integrity: every declared capability must be registered;
 *  - capability: every authorizedAction must be a capability the worker
 *    DECLARES (an undeclared action is escalation, denied never clamped);
 *  - risk: every authorized action's registered risk must fit under BOTH
 *    the delegation ceiling and the worker's own authority ceiling;
 *  - role: the roles claimed for the worker under this delegation must be
 *    a subset of the delegation's authorizedRoles (E-035: a worker never
 *    exercises a role the delegation does not authorize).
 */
export function evaluateDelegationCompatibility(
  registry: CapabilityRegistry,
  worker: WorkerDefinition,
  requirement: DelegationAuthorityRequirement,
  claimedRoles: readonly UniversalRole[],
): DelegationCompatibilityVerdict {
  const reasons: DelegationCompatibilityReason[] = [];

  const authorizedActions = normalizeStringList(requirement.authorizedActions);
  if (authorizedActions.length === 0) {
    reasons.push({ axis: "capability", reason: "a delegation authorizes at least one action" });
  }
  if (!(AGENT_RISK_CLASSIFICATION_SET as ReadonlySet<string>).has(requirement.maxRiskClass)) {
    reasons.push({
      axis: "risk",
      reason: "delegation maxRiskClass must be in the agent risk vocabulary",
    });
  }
  for (const role of claimedRoles) {
    if (!UNIVERSAL_ROLE_SET.has(role)) {
      reasons.push({ axis: "role", reason: `claimed role "${role}" is not a universal role` });
    }
  }
  if (reasons.length > 0) return { compatible: false, reasons };

  if (requirement.tenantId !== worker.tenantScope) {
    reasons.push({
      axis: "tenant",
      reason: `delegation tenant "${requirement.tenantId}" does not match worker tenant scope "${worker.tenantScope}"`,
    });
  }
  if (!usableLifecycle(worker)) {
    reasons.push({
      axis: "lifecycle",
      reason: `worker lifecycle "${worker.lifecycle}" is unusable (revocation propagated)`,
    });
  }
  const integrity = checkWorkerCapabilityIntegrity(registry, worker);
  if (!integrity.ok) {
    reasons.push({
      axis: "registry_integrity",
      reason: `worker declares unregistered capabilities: ${integrity.unregisteredCapabilityIds.join(", ")}`,
    });
  }

  const declared = declaredCapabilityIds(worker);
  const exercised: string[] = [];
  for (const action of authorizedActions) {
    if (!declared.has(action)) {
      reasons.push({
        axis: "capability",
        reason: `authorized action "${action}" is not a declared worker capability (escalation denied)`,
      });
      continue;
    }
    const capability = registry.get(action);
    if (capability === undefined) {
      reasons.push({
        axis: "registry_integrity",
        reason: `authorized action "${action}" is not registered in the capability registry`,
      });
      continue;
    }
    if (riskClassRank(capability.riskClass) > riskClassRank(requirement.maxRiskClass)) {
      reasons.push({
        axis: "risk",
        reason: `authorized action "${action}" risk "${capability.riskClass}" exceeds delegation ceiling "${requirement.maxRiskClass}"`,
      });
      continue;
    }
    if (riskClassRank(capability.riskClass) > riskClassRank(worker.authorityBounds.maxRiskClass)) {
      reasons.push({
        axis: "risk",
        reason: `authorized action "${action}" risk "${capability.riskClass}" exceeds worker authority ceiling "${worker.authorityBounds.maxRiskClass}"`,
      });
      continue;
    }
    exercised.push(action);
  }

  for (const role of claimedRoles) {
    if (!requirement.authorizedRoles.includes(role)) {
      reasons.push({
        axis: "role",
        reason: `claimed role "${role}" is not in the delegation's authorizedRoles (escalation denied)`,
      });
    }
  }

  if (reasons.length > 0) return { compatible: false, reasons };

  let effectiveRank = 0;
  let effectiveRiskClass: AgentRiskClassification = "low";
  for (const action of exercised) {
    const capability = registry.get(action);
    if (capability === undefined) continue;
    const rank = riskClassRank(capability.riskClass);
    if (rank > effectiveRank) {
      effectiveRank = rank;
      effectiveRiskClass = capability.riskClass;
    }
  }
  return {
    compatible: true,
    exercisedCapabilities: normalizeStringList(exercised),
    effectiveRiskClass,
  };
}
