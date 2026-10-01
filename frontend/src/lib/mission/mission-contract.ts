/**
 * CoreGrid — Mission object contract (J-025 / V1CAP-046, MISSION-R-50).
 *
 * The Mission is a FIRST-CLASS governed object, generalizing (never
 * duplicating) the live-verified foundation loop substrate
 * `control-plane/foundation-mission.ts` (`cg_mission_intent`). A mission
 * declares: an objective (the declared outcome), a tenant scope, an
 * accountable owner and its authorized actors, a decomposition into Tasks,
 * admission gates, success criteria, mission-level provenance, and a bounded
 * lifetime. A mission that lacks any required element is REJECTED at the
 * contract boundary (fail closed, Constitution §26/§31).
 *
 * Lifecycle vocabulary is REUSED, not redefined (CTO RULING-5 / V1CAP-052):
 * the mission lifecycle mirrors the ONE canonical workflow lifecycle
 * (DEFINED..ARCHIVED, 15 states) recorded in
 * `COREGRID_V1_RECONSTRUCTED_ARCHITECTURE.json#V1CAP-052`. Phase 17 remains
 * the sole owner of the canonical workflow state machine; the mission
 * lifecycle COMPOSES with it through the typed mapping
 * `MISSION_LIFECYCLE_MAPPING_TO_FOUNDATION` onto the foundation loop
 * vocabulary (`MissionLifecycle`), and never forks it. The composition
 * mapping is a compile-time obligation: if the foundation vocabulary
 * changes, this mapping fails to type-check.
 *
 * Every persistent mission object carries the canonical kernel envelope
 * (V1CAP-002) via the existing `KernelObjectEnvelope` types from
 * `kernel/reality.ts` — no anonymous persistent mission exists. Envelope
 * conformance is re-checked fail-closed with a per-contract object-type
 * allowlist (`MISSION_KERNEL_OBJECT_TYPES`); the live kernel registry
 * (MISSION-R-11) remains the platform-level gate at the write API.
 *
 * Boundary: pure contracts + validation + state machines. No persistence,
 * no I/O, no vendor imports. Execution authorization remains owned by the
 * foundation loop admission path; this contract never admits execution
 * itself.
 */

import { validateKernelObjectEnvelope, type KernelObjectEnvelope, type KernelObjectEnvelopeInput } from "../kernel/reality";
import type { MissionLifecycle } from "../control-plane/foundation-mission";
import { UNIVERSAL_ROLE_SET, type UniversalRole } from "../universal-roles";

/* ─────────────────────────────────────────────────────────────
 * Shared contract vocabulary (consumed by sibling mission contracts)
 * ────────────────────────────────────────────────────────────*/

export type ContractValidation = { ok: true } | { ok: false; error: string };

/** Fail-closed timestamp check: non-empty and parseable (bounded time math). */
export function isContractTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Number.isFinite(Date.parse(value.trim()))
  );
}

/**
 * Re-validate an EMBEDDED kernel envelope against a per-contract allowlist
 * and reject cross-tenant provenance. Shared by every mission-family
 * contract so the envelope law (V1CAP-002) is enforced through ONE
 * implementation.
 */
export function validateEmbeddedKernelEnvelope(
  envelope: KernelObjectEnvelope,
  tenantId: string,
  knownObjectTypes: readonly string[],
): string | null {
  try {
    validateKernelObjectEnvelope(
      {
        objectType: envelope.object_type,
        schemaVersion: envelope.schema_version,
        status: envelope.status,
        createdBy: envelope.created_by,
        updatedBy: envelope.updated_by,
        provenance: envelope.provenance,
        policyContext: envelope.policy_context,
        traceId: envelope.trace_id,
        correlationId: envelope.correlation_id,
        causationId: envelope.causation_id,
        parentEventId: envelope.parent_event_id,
        declaredOrigin: envelope.declared_origin,
      },
      knownObjectTypes,
    );
  } catch (error) {
    return error instanceof Error ? error.message : "kernel envelope is invalid";
  }
  const originTenantId = envelope.provenance.originTenantId;
  if (originTenantId !== null && originTenantId !== tenantId) {
    return `kernel envelope provenance is cross-tenant: origin "${originTenantId}" does not match object tenant "${tenantId}"`;
  }
  return null;
}

/* ─────────────────────────────────────────────────────────────
 * Lifecycle: the ONE canonical workflow vocabulary (RULING-5)
 * ────────────────────────────────────────────────────────────*/

/**
 * The 15 canonical states of the RULING-5 workflow lifecycle
 * (V1CAP-052). Mirrored here so missions execute through the one
 * canonical state machine vocabulary; phase 17 owns the machine.
 */
export const MISSION_LIFECYCLE_STATES = [
  "DEFINED",
  "READY",
  "QUEUED",
  "RUNNING",
  "WAITING",
  "PAUSED",
  "RETRYING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
  "COMPENSATING",
  "COMPENSATED",
  "QUARANTINED",
  "ARCHIVED",
] as const;

export type MissionLifecycleState = (typeof MISSION_LIFECYCLE_STATES)[number];

const MISSION_TRANSITIONS: Readonly<Record<MissionLifecycleState, readonly MissionLifecycleState[]>> = {
  DEFINED: ["READY", "CANCELLED"],
  READY: ["QUEUED", "CANCELLED", "QUARANTINED"],
  QUEUED: ["RUNNING", "CANCELLED", "QUARANTINED"],
  RUNNING: ["WAITING", "PAUSED", "SUCCEEDED", "FAILED", "COMPENSATING", "TIMED_OUT", "QUARANTINED", "CANCELLED"],
  WAITING: ["RUNNING", "PAUSED", "FAILED", "QUARANTINED", "CANCELLED"],
  PAUSED: ["RUNNING", "CANCELLED", "QUARANTINED"],
  RETRYING: ["RUNNING", "FAILED", "CANCELLED"],
  SUCCEEDED: ["ARCHIVED"],
  FAILED: ["RETRYING", "COMPENSATING", "CANCELLED"],
  CANCELLED: ["ARCHIVED"],
  TIMED_OUT: ["COMPENSATING", "FAILED", "CANCELLED"],
  COMPENSATING: ["COMPENSATED", "FAILED"],
  COMPENSATED: ["ARCHIVED"],
  QUARANTINED: ["ARCHIVED"],
  ARCHIVED: [],
};

/** Fail-closed transition check over the canonical vocabulary. */
export function isMissionTransitionAllowed(from: MissionLifecycleState, to: MissionLifecycleState): boolean {
  return MISSION_TRANSITIONS[from].includes(to);
}

/**
 * Composition mapping (V1CAP-052 <-> V1CAP-046): the mission lifecycle
 * composes with the ONE canonical workflow machine and maps onto the
 * foundation loop vocabulary. Typed against `MissionLifecycle`, so a
 * change to the foundation vocabulary breaks this mapping at compile time
 * instead of silently forking the lifecycle.
 */
export const MISSION_LIFECYCLE_MAPPING_TO_FOUNDATION: Readonly<
  Partial<Record<MissionLifecycleState, MissionLifecycle>>
> = {
  DEFINED: "proposed",
  READY: "authorized",
  CANCELLED: "revoked",
  ARCHIVED: "closed",
};

/* ─────────────────────────────────────────────────────────────
 * Mission elements
 * ────────────────────────────────────────────────────────────*/

/**
 * Admission gates (J-026 taxonomy: definition/security/verification/
 * closure). Declarative at the contract level; gate machinery with
 * evidence-bearing waivers is MISSION-R-51 and is NOT built here.
 */
export type MissionGateKind = "definition" | "security" | "verification" | "closure";

export interface MissionAdmissionGate {
  readonly gateId: string;
  readonly kind: MissionGateKind;
  /** What the gate asserts; a gate that cannot be explained must not exist. */
  readonly reason: string;
}

/**
 * A Task is the mission's decomposition unit. A task can never authorize an
 * action outside the mission's own `authorizedActions` (containment
 * invariant, mirroring WorkflowStep.authorizedActions in the workflow
 * contract and MissionIntent.authorizedActions in the foundation loop).
 */
export interface MissionTask {
  readonly taskId: string;
  readonly title: string;
  readonly authorizedActions: readonly string[];
  /** Evidence kinds required before this task may count toward the objective. */
  readonly requiredEvidenceKinds: readonly string[];
}

/** Mission provenance (Constitution §12): where the mission declaration came from. */
export interface MissionProvenance {
  readonly declaredBy: string;
  readonly declaredAt: string;
  /** The authorization source for the mission (admission-gate element). */
  readonly authorityRef: string;
  readonly contextRef: string | null;
  readonly sourceRef: string | null;
  readonly generatedByAi: boolean;
  readonly verified: boolean;
}

/**
 * Mission-scoped evidence vocabulary, mirroring the foundation loop
 * EvidenceRecord (producer, actor, tenant, provenance, integrity,
 * usable-or-not, lifecycle).
 */
export interface MissionEvidenceRecord {
  readonly evidenceId: string;
  readonly missionId: string;
  /** null = mission-level evidence. */
  readonly taskId: string | null;
  readonly evidenceKind: string;
  readonly producer: string;
  readonly actorId: string;
  readonly tenantId: string;
  readonly recordedAt: string;
  readonly provenance: string;
  readonly integrity: string;
  readonly lifecycle: "active" | "superseded" | "revoked";
}

/* ─────────────────────────────────────────────────────────────
 * The Mission object
 * ────────────────────────────────────────────────────────────*/

/** Envelope-stamped mission fields (everything but the envelope itself). */
export interface MissionContractCore {
  readonly missionId: string;
  readonly schemaVersion: string;
  readonly tenantId: string;
  /** The declared outcome. A mission without an objective is not a mission. */
  readonly objective: string;
  /** Explicit out-of-scope declaration; scope and non-scope never intersect. */
  readonly nonScope: readonly string[];
  readonly ownerRef: string;
  /** Actors authorized to act under this mission (at least one). */
  readonly actorRefs: readonly string[];
  /** The closed set of actions the mission may ever involve. */
  readonly authorizedActions: readonly string[];
  readonly tasks: readonly MissionTask[];
  readonly admissionGates: readonly MissionAdmissionGate[];
  readonly successCriteria: readonly string[];
  readonly requiredEvidenceKinds: readonly string[];
  readonly lifecycle: MissionLifecycleState;
  /** Bounded lifetime; null means unbounded (owner-accountable). */
  readonly expiresAt: string | null;
  readonly provenance: MissionProvenance;
}

/** Canonical kernel object types owned by THIS contract (per-contract allowlist). */
export const MISSION_KERNEL_OBJECT_TYPES = ["mission_intent"] as const;

export const MISSION_CONTRACT_SCHEMA_VERSION = "1.0";

/** The persistent Mission object: core + canonical kernel envelope (V1CAP-002). */
export interface MissionContract extends MissionContractCore {
  readonly envelope: KernelObjectEnvelope;
}

/** Input for the fail-closed stamping write path. */
export interface MissionContractInput extends MissionContractCore {
  readonly envelope: KernelObjectEnvelopeInput;
}

/* ─────────────────────────────────────────────────────────────
 * Validation (fail closed; a mission missing a required element is rejected)
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

function normalizeMissionCore(core: MissionContractCore): MissionContractCore {
  return {
    ...core,
    missionId: core.missionId.trim(),
    schemaVersion: core.schemaVersion.trim(),
    tenantId: core.tenantId.trim(),
    objective: core.objective.trim(),
    nonScope: normalizeStringList(core.nonScope),
    ownerRef: core.ownerRef.trim(),
    actorRefs: normalizeStringList(core.actorRefs),
    authorizedActions: normalizeStringList(core.authorizedActions),
    tasks: core.tasks.map((task) => ({
      taskId: task.taskId.trim(),
      title: task.title.trim(),
      authorizedActions: normalizeStringList(task.authorizedActions),
      requiredEvidenceKinds: normalizeStringList(task.requiredEvidenceKinds),
    })),
    admissionGates: core.admissionGates.map((gate) => ({
      gateId: gate.gateId.trim(),
      kind: gate.kind,
      reason: gate.reason.trim(),
    })),
    successCriteria: normalizeStringList(core.successCriteria),
    requiredEvidenceKinds: normalizeStringList(core.requiredEvidenceKinds),
    lifecycle: core.lifecycle,
    expiresAt: core.expiresAt === null ? null : core.expiresAt.trim(),
    provenance: {
      declaredBy: core.provenance.declaredBy.trim(),
      declaredAt: core.provenance.declaredAt.trim(),
      authorityRef: core.provenance.authorityRef.trim(),
      contextRef: core.provenance.contextRef === null ? null : core.provenance.contextRef.trim(),
      sourceRef: core.provenance.sourceRef === null ? null : core.provenance.sourceRef.trim(),
      generatedByAi: core.provenance.generatedByAi === true,
      verified: core.provenance.verified === true,
    },
  };
}

/** Returns an error string for the first violated contract law, else null. */
export function validateMissionCore(core: MissionContractCore): string | null {
  if (!nonEmpty(core.missionId)) return "missionId is required";
  if (!/^\d+\.\d+$/.test(core.schemaVersion)) return "schemaVersion must match MAJOR.MINOR (e.g. 1.0)";
  if (!nonEmpty(core.tenantId)) return "tenantId (tenant scope) is required";
  if (!nonEmpty(core.objective)) return "objective (declared outcome) is required";
  if (!nonEmpty(core.ownerRef)) return "ownerRef (accountable owner) is required";
  if (core.actorRefs.length === 0) return "a mission requires at least one authorized actor";
  if (!distinctNonEmpty(core.actorRefs)) return "actorRefs must be non-empty and distinct";
  if (core.authorizedActions.length === 0) return "a mission must declare at least one authorized action";
  if (!distinctNonEmpty(core.authorizedActions)) return "authorizedActions must be non-empty and distinct";
  if (!distinctNonEmpty(core.nonScope)) return "nonScope entries must be non-empty and distinct";
  for (const action of core.authorizedActions) {
    if (core.nonScope.includes(action)) {
      return `action "${action}" cannot be both authorized and non-scope`;
    }
  }
  if (core.tasks.length === 0) return "a mission decomposes into at least one task";
  const taskIds = new Set<string>();
  for (const task of core.tasks) {
    if (!nonEmpty(task.taskId)) return "every task requires a taskId";
    if (taskIds.has(task.taskId)) return `duplicate taskId "${task.taskId}"`;
    taskIds.add(task.taskId);
    if (!nonEmpty(task.title)) return `task "${task.taskId}" requires a title`;
    if (task.authorizedActions.length === 0) {
      return `task "${task.taskId}" must declare at least one authorized action`;
    }
    for (const action of task.authorizedActions) {
      if (!core.authorizedActions.includes(action)) {
        return `task "${task.taskId}" authorizes "${action}" outside the mission scope (containment invariant)`;
      }
    }
    if (task.requiredEvidenceKinds.length === 0) {
      return `task "${task.taskId}" must require at least one evidence kind`;
    }
    if (!distinctNonEmpty(task.requiredEvidenceKinds)) {
      return `task "${task.taskId}" requiredEvidenceKinds must be non-empty and distinct`;
    }
  }
  if (core.admissionGates.length === 0) return "a mission declares at least one admission gate";
  const gateIds = new Set<string>();
  for (const gate of core.admissionGates) {
    if (!nonEmpty(gate.gateId)) return "every admission gate requires a gateId";
    if (gateIds.has(gate.gateId)) return `duplicate gateId "${gate.gateId}"`;
    gateIds.add(gate.gateId);
    if (!nonEmpty(gate.reason)) return `gate "${gate.gateId}" requires a reason`;
  }
  if (core.successCriteria.length === 0) return "a mission requires at least one success criterion";
  if (!distinctNonEmpty(core.successCriteria)) return "successCriteria must be non-empty and distinct";
  if (core.requiredEvidenceKinds.length === 0) return "a mission requires at least one evidence kind";
  if (!distinctNonEmpty(core.requiredEvidenceKinds)) return "requiredEvidenceKinds must be non-empty and distinct";
  if (!(MISSION_LIFECYCLE_STATES as readonly string[]).includes(core.lifecycle)) {
    return `lifecycle "${String(core.lifecycle)}" is not a canonical mission lifecycle state`;
  }
  if (core.expiresAt !== null && !isContractTimestamp(core.expiresAt)) {
    return "expiresAt must be a parseable timestamp when present";
  }
  if (!nonEmpty(core.provenance.declaredBy)) return "provenance.declaredBy is required";
  if (!isContractTimestamp(core.provenance.declaredAt)) return "provenance.declaredAt must be a parseable timestamp";
  if (!nonEmpty(core.provenance.authorityRef)) return "provenance.authorityRef (authorization source) is required";
  return null;
}

/** Full contract validation: core laws + embedded kernel envelope conformance. */
export function validateMissionContract(mission: MissionContract): ContractValidation {
  const coreError = validateMissionCore(mission);
  if (coreError !== null) return { ok: false, error: coreError };
  const envelopeError = validateEmbeddedKernelEnvelope(
    mission.envelope,
    mission.tenantId,
    MISSION_KERNEL_OBJECT_TYPES,
  );
  if (envelopeError !== null) return { ok: false, error: envelopeError };
  return { ok: true };
}

/**
 * Fail-closed stamping write path: normalizes, validates every contract law,
 * and validates the canonical kernel envelope against the per-contract
 * object-type allowlist. Throws when any required element is missing —
 * a mission that lacks a required element is rejected, never repaired.
 */
export function stampMissionContract(
  input: MissionContractInput,
  knownObjectTypes: readonly string[] = MISSION_KERNEL_OBJECT_TYPES,
): MissionContract {
  const core = normalizeMissionCore(input);
  const coreError = validateMissionCore(core);
  if (coreError !== null) {
    throw new Error(`mission contract rejected: ${coreError}`);
  }
  const envelope = validateKernelObjectEnvelope(input.envelope, knownObjectTypes);
  const envelopeError = validateEmbeddedKernelEnvelope(envelope, core.tenantId, knownObjectTypes);
  if (envelopeError !== null) {
    throw new Error(`mission contract rejected: ${envelopeError}`);
  }
  return { ...core, envelope };
}

/* ─────────────────────────────────────────────────────────────
 * Admission gates (declarative evaluation; machinery is M-R-51)
 * ────────────────────────────────────────────────────────────*/

export interface MissionGateFailure {
  readonly gateId: string;
  readonly kind: MissionGateKind;
  readonly reason: string;
}

export type MissionGateEvaluation =
  | { ok: true }
  | { ok: false; failedGates: readonly MissionGateFailure[] };

/**
 * Evaluate every declared admission gate against the mission's declared
 * content. Every non-allow path fails closed with the failing gate named.
 */
export function evaluateMissionAdmissionGates(core: MissionContractCore): MissionGateEvaluation {
  const failed: MissionGateFailure[] = [];
  const objectiveIsDeclared = nonEmpty(core.objective);
  const taskDeclared = core.tasks.length > 0;
  const criteriaDeclared = core.successCriteria.length > 0;
  const scopeIsConsistent = core.authorizedActions.every((action) => !core.nonScope.includes(action));
  const authorityDeclared =
    nonEmpty(core.provenance.authorityRef) && nonEmpty(core.ownerRef) && core.actorRefs.length > 0;
  const verificationDeclared = core.requiredEvidenceKinds.length > 0;

  for (const gate of core.admissionGates) {
    let passes: boolean;
    switch (gate.kind) {
      case "definition":
        passes = objectiveIsDeclared && taskDeclared;
        break;
      case "security":
        passes = core.authorizedActions.length > 0 && scopeIsConsistent;
        break;
      case "verification":
        passes = verificationDeclared && core.tasks.every((task) => task.requiredEvidenceKinds.length > 0);
        break;
      case "closure":
        passes = criteriaDeclared;
        break;
    }
    if (!passes) failed.push({ gateId: gate.gateId, kind: gate.kind, reason: gate.reason });
  }
  if (failed.length > 0) return { ok: false, failedGates: failed };
  if (!authorityDeclared) {
    return {
      ok: false,
      failedGates: [
        {
          gateId: "<authority>",
          kind: "definition",
          reason: "mission lacks authorityRef, owner, or authorized actors",
        },
      ],
    };
  }
  return { ok: true };
}

/* ─────────────────────────────────────────────────────────────
 * Evidence usability and success-criteria coverage
 * ────────────────────────────────────────────────────────────*/

/** Mirrors the foundation loop evidenceIsUsable (usable-or-not, fail closed). */
export function missionEvidenceIsUsable(record: MissionEvidenceRecord): boolean {
  return (
    record.lifecycle === "active" &&
    nonEmpty(record.evidenceId) &&
    nonEmpty(record.missionId) &&
    nonEmpty(record.evidenceKind) &&
    nonEmpty(record.producer) &&
    nonEmpty(record.actorId) &&
    nonEmpty(record.tenantId) &&
    isContractTimestamp(record.recordedAt) &&
    nonEmpty(record.provenance) &&
    nonEmpty(record.integrity)
  );
}

/**
 * EVIDENCE before SUCCESS: every mission-level required evidence kind AND
 * every task's required evidence kinds must be covered by usable evidence
 * from the same mission and tenant. Missing, revoked, superseded, or
 * cross-tenant evidence is not coverage.
 */
export function missionEvidenceCovers(
  core: MissionContractCore,
  records: readonly MissionEvidenceRecord[],
): boolean {
  const usable = records.filter(
    (record) =>
      missionEvidenceIsUsable(record) &&
      record.missionId === core.missionId &&
      record.tenantId === core.tenantId,
  );
  const coveredKinds = new Set(usable.map((record) => record.evidenceKind));
  const requiredKinds = [
    ...core.requiredEvidenceKinds,
    ...core.tasks.flatMap((task) => task.requiredEvidenceKinds),
  ];
  return requiredKinds.every((kind) => coveredKinds.has(kind));
}

/* ─────────────────────────────────────────────────────────────
 * Mission state machine (transitions fail closed)
 * ────────────────────────────────────────────────────────────*/

export interface MissionTransitionContext {
  readonly now: string;
  /** Evidence considered for the SUCCEEDED gate (EVIDENCE before SUCCESS). */
  readonly evidence?: readonly MissionEvidenceRecord[];
}

export type MissionTransitionResult =
  | { ok: true; mission: MissionContract }
  | { ok: false; denyReason: string; error: string };

/**
 * Transition a mission through the canonical lifecycle. Fails closed on:
 * illegal transitions, terminal-state mutation, an invalid contract, an
 * expired mission entering an executing state, admission gates not
 * satisfied before READY, and SUCCEEDED without complete evidence.
 */
export function transitionMission(
  mission: MissionContract,
  to: MissionLifecycleState,
  ctx: MissionTransitionContext,
): MissionTransitionResult {
  const validation = validateMissionContract(mission);
  if (!validation.ok) {
    return { ok: false, denyReason: "invalid_contract", error: validation.error };
  }
  if (!isContractTimestamp(ctx.now)) {
    return { ok: false, denyReason: "invalid_context", error: "transition clock is not a parseable timestamp" };
  }
  if (mission.lifecycle === "ARCHIVED") {
    return {
      ok: false,
      denyReason: "terminal_immutable",
      error: "ARCHIVED is terminal — archived missions are immutable",
    };
  }
  if (!isMissionTransitionAllowed(mission.lifecycle, to)) {
    return {
      ok: false,
      denyReason: "illegal_transition",
      error: `transition ${mission.lifecycle} -> ${to} is not allowed by the canonical lifecycle`,
    };
  }
  if (to === "READY") {
    const gates = evaluateMissionAdmissionGates(mission);
    if (!gates.ok) {
      const named = gates.failedGates.map((gate) => `${gate.gateId}(${gate.kind})`).join(", ");
      return {
        ok: false,
        denyReason: "gates_not_satisfied",
        error: `mission cannot reach READY — admission gates failed: ${named}`,
      };
    }
  }
  if (to === "QUEUED" || to === "RUNNING" || to === "RETRYING") {
    if (mission.expiresAt !== null && mission.expiresAt <= ctx.now) {
      return {
        ok: false,
        denyReason: "expired",
        error: `mission expired at ${mission.expiresAt} — cannot enter ${to}`,
      };
    }
  }
  if (to === "SUCCEEDED") {
    if (!missionEvidenceCovers(mission, ctx.evidence ?? [])) {
      return {
        ok: false,
        denyReason: "evidence_incomplete",
        error: "EVIDENCE before SUCCESS — required evidence kinds are not covered by usable evidence",
      };
    }
  }
  return { ok: true, mission: { ...mission, lifecycle: to } };
}

/* ─────────────────────────────────────────────────────────────
 * Actor vocabulary bridge (RULING-4): mission actors hold universal roles
 * ────────────────────────────────────────────────────────────*/

/**
 * The universal roles a mission's actors may hold. Mission actors are
 * platform actors: the vocabulary is the closed universal role list; a
 * domain role name can never appear here.
 */
export function missionActorRoleIsWellFormed(role: UniversalRole): boolean {
  return UNIVERSAL_ROLE_SET.has(role);
}