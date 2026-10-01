/**
 * CoreGrid — persistent governed worker definition substrate
 * (V1CAP-048 / J-027 / MISSION-R-40, wave 2).
 *
 * CTO RULING-3 (binding): workers are governed actors, an extension of the
 * CoreGrid actor/delegation model — NOT merely LLM/process/container/script.
 * PERSISTENT (this module): definition, capability declarations, authority
 * boundary, delegation history. EPHEMERAL (owned by
 * `agent-runtime/ephemeral-lifecycle.ts`): the runtime instance. A worker
 * process can die and restart; the definition survives it (G-014).
 *
 * Chain (RULING-3): Definition -> Delegation -> Mission Assignment ->
 * Ephemeral Runtime -> Execution -> Evidence -> Verification -> Outcome ->
 * Terminate. This module owns the PERSISTENT head of that chain and the
 * binding contract at the Definition -> Ephemeral Runtime edge.
 *
 * Workers are ACTORS — there is no separate worker authorization path. Every
 * claim resolves through the SAME identity-actor primitive human identities
 * resolve through (`resolveIdentityActor` from `identity-actor.ts`), the
 * worker's lifecycle states are a subset of the identity lifecycle model
 * (`identity.ts`), and a runtime instance claims authority ONLY by
 * intersecting an explicit delegation with the definition's declared
 * capability set and authority bounds. Claimed authority beyond the
 * definition is DENIED, never clamped — escalation is structurally
 * impossible because no API accepts an authority input that is not first
 * checked against the persistent definition.
 *
 * Persistent record shape: envelope-bearing (V1CAP-002) via the kernel
 * envelope primitives — an unstamped (anonymous) worker definition row can
 * never be produced or accepted.
 *
 * Boundary: pure data + pure functions. No persistence, no I/O, no vendor.
 * Database truth for the substrate is authored (NOT applied) in
 * `database/supabase/migrations/20261002000002_coregrid_v1_worker_definitions.sql`.
 */

import {
  IDENTITY_LIFECYCLE_STATES,
  isIdentityUsable,
  type IdentityLifecycleState,
} from "../identity";
import {
  actorScope,
  resolveIdentityActor,
  type IdentityActor,
  type IdentityActorSource,
} from "../identity-actor";
import {
  AGENT_RISK_CLASSIFICATIONS,
  agentDefinitionId,
  type AgentPermission,
  type AgentRiskClassification,
} from "../agent-core";
import type { AgentDefinition, RuntimeBudget } from "../agent-runtime/ephemeral-lifecycle";
import {
  isDataClassification,
  stampKernelDraft,
  validateKernelRowEnvelope,
  type KernelObjectEnvelopeInput,
} from "../kernel/reality";

/** The risk vocabulary as a set, for fail-closed membership checks. */
const AGENT_RISK_CLASSIFICATION_SET: ReadonlySet<string> = new Set<string>(
  AGENT_RISK_CLASSIFICATIONS,
);

/* ─────────────────────────────────────────────────────────────
 * Vocabularies
 * ────────────────────────────────────────────────────────────*/

/** Whether the governed worker is a human operator or an AI agent. */
export type WorkerClassification = "human" | "ai";

export const WORKER_CLASSIFICATIONS: readonly WorkerClassification[] = ["human", "ai"] as const;

/**
 * Worker definition lifecycle — a SUBSET of the identity lifecycle model
 * (identity.ts): the states a cg_identity row can actually hold
 * (provisioned/active/suspended/archived/deleted). There is no worker-specific
 * lifecycle vocabulary; the definition is aligned with, not parallel to, the
 * identity model. The subset relation is asserted at module load.
 */
export const WORKER_DEFINITION_LIFECYCLE_STATES = [
  "provisioned",
  "active",
  "suspended",
  "archived",
  "deleted",
] as const;

export type WorkerDefinitionLifecycleState = (typeof WORKER_DEFINITION_LIFECYCLE_STATES)[number];

for (const state of WORKER_DEFINITION_LIFECYCLE_STATES) {
  if (!(IDENTITY_LIFECYCLE_STATES as readonly IdentityLifecycleState[]).includes(state)) {
    throw new Error(
      `worker definition lifecycle state "${state}" is not part of the identity lifecycle model`,
    );
  }
}

/** Canonical kernel object type of the persistent definition record. */
export const WORKER_DEFINITION_OBJECT_TYPE = "worker_definition";

/** Risk-class ordering used for bound enforcement (low is weakest). */
const RISK_CLASS_RANK: Readonly<Record<AgentRiskClassification, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export function riskClassRank(riskClass: AgentRiskClassification): number {
  return RISK_CLASS_RANK[riskClass];
}

/* ─────────────────────────────────────────────────────────────
 * Definition shape (PERSISTENT half of RULING-3)
 * ────────────────────────────────────────────────────────────*/

/** One owned capability declaration. Declarations are explicit and documented. */
export interface WorkerCapabilityDeclaration {
  capabilityId: string;
  description: string;
}

/**
 * Authority bounds of the worker. The tenant scope IS the definition's
 * tenant (every worker is tenant-scoped; there is no cross-tenant worker),
 * so the bounds carry the risk ceiling and resource scopes.
 */
export interface WorkerAuthorityBounds {
  /** Ceiling: no delegation may claim a higher risk class than this. */
  maxRiskClass: AgentRiskClassification;
  /** Resource scopes the worker may ever be delegated; deny by default. */
  resourceScopes: readonly string[];
}

/**
 * The persistent governed worker definition. Everything here SURVIVES worker
 * process termination; only the runtime lease is ephemeral.
 */
export interface WorkerDefinition {
  id: string;
  /** Tenant scope of the worker (multi-tenancy law: never null, never client-asserted). */
  tenantScope: string;
  /** Reference to the worker's cg_identity row — the worker IS an identity. */
  identityRef: string;
  classification: WorkerClassification;
  /** Owned capability set: explicit declarations, zero implicit authority. */
  capabilities: readonly WorkerCapabilityDeclaration[];
  authorityBounds: WorkerAuthorityBounds;
  /** References into the persistent delegation history (RULING-3). */
  delegationHistoryRefs: readonly string[];
  lifecycle: WorkerDefinitionLifecycleState;
}

export interface WorkerDefinitionInput {
  id: string;
  tenantScope: string;
  identityRef: string;
  classification: WorkerClassification;
  capabilities: readonly WorkerCapabilityDeclaration[];
  authorityBounds: WorkerAuthorityBounds;
  delegationHistoryRefs?: readonly string[];
  lifecycle?: WorkerDefinitionLifecycleState;
}

export type WorkerDefinitionValidationResult =
  { ok: true; definition: WorkerDefinition } | { ok: false; errors: readonly string[] };

function isNonEmptyTrimmed(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= maxLength;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/**
 * Fail-closed definition validation. A fresh worker with an EMPTY capability
 * set is valid and has ZERO authority (untrusted by default, mission T3):
 * emptiness denies nothing at definition time and every action at claim time.
 */
export function defineWorkerDefinition(
  input: WorkerDefinitionInput,
): WorkerDefinitionValidationResult {
  const errors: string[] = [];
  if (!isNonEmptyTrimmed(input.id, 160)) {
    errors.push("worker definition id must be 1–160 characters");
  }
  if (!isNonEmptyTrimmed(input.tenantScope, 128)) {
    errors.push("worker tenant scope must be 1–128 characters");
  }
  if (!isNonEmptyTrimmed(input.identityRef, 160)) {
    errors.push("worker identityRef must be 1–160 characters");
  }
  if (!WORKER_CLASSIFICATIONS.includes(input.classification)) {
    errors.push("worker classification must be 'human' or 'ai'");
  }
  if (!Array.isArray(input.capabilities)) {
    errors.push("worker capabilities must be an array of declarations");
  } else {
    const seen = new Set<string>();
    input.capabilities.forEach((declaration, index) => {
      if (!isNonEmptyTrimmed(declaration?.capabilityId, 160)) {
        errors.push(`capability declaration #${index} requires a capabilityId (1–160 characters)`);
      } else if (seen.has(declaration.capabilityId)) {
        errors.push(`duplicate capabilityId "${declaration.capabilityId}"`);
      } else {
        seen.add(declaration.capabilityId);
      }
      if (!isNonEmptyTrimmed(declaration?.description, 500)) {
        errors.push(`capability declaration #${index} requires a description (1–500 characters)`);
      }
    });
  }
  if (
    !input.authorityBounds ||
    !(AGENT_RISK_CLASSIFICATION_SET as ReadonlySet<string>).has(input.authorityBounds.maxRiskClass)
  ) {
    errors.push("authority bounds require a maxRiskClass in the agent risk vocabulary");
  }
  if (!isStringArray(input.authorityBounds?.resourceScopes)) {
    errors.push("authority bounds resourceScopes must be an array of strings");
  } else {
    input.authorityBounds.resourceScopes.forEach((scope, index) => {
      if (!isNonEmptyTrimmed(scope, 200)) {
        errors.push(`resource scope #${index} must be 1–200 characters`);
      }
    });
  }
  if (input.delegationHistoryRefs !== undefined && !isStringArray(input.delegationHistoryRefs)) {
    errors.push("delegationHistoryRefs must be an array of delegation record references");
  }
  if (
    input.lifecycle !== undefined &&
    !(WORKER_DEFINITION_LIFECYCLE_STATES as readonly string[]).includes(input.lifecycle)
  ) {
    errors.push(
      `worker lifecycle "${String(input.lifecycle)}" is not in the identity-aligned worker lifecycle vocabulary`,
    );
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    definition: {
      id: (input.id as string).trim(),
      tenantScope: (input.tenantScope as string).trim(),
      identityRef: (input.identityRef as string).trim(),
      classification: input.classification,
      capabilities: input.capabilities,
      authorityBounds: {
        maxRiskClass: input.authorityBounds.maxRiskClass,
        resourceScopes: input.authorityBounds.resourceScopes,
      },
      delegationHistoryRefs: input.delegationHistoryRefs ?? [],
      lifecycle: input.lifecycle ?? "provisioned",
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Envelope-bearing persistent record shape (V1CAP-002)
 * ────────────────────────────────────────────────────────────*/

/** Insert-ready persistent row for a worker definition, envelope stamped. */
export type WorkerDefinitionRow = {
  id: string;
  tenant_id: string;
  identity_ref: string;
  classification: WorkerClassification;
  capabilities: readonly WorkerCapabilityDeclaration[];
  max_risk_class: AgentRiskClassification;
  resource_scopes: readonly string[];
  delegation_history_refs: readonly string[];
  lifecycle_state: WorkerDefinitionLifecycleState;
} & ReturnType<typeof stampKernelDraft>;

/**
 * Stamp a worker definition into its persistent row shape. The envelope is
 * MANDATORY (no anonymous persistent worker definition exists) and its
 * object_type MUST be the canonical worker-definition type.
 */
export function workerDefinitionRow(
  definition: WorkerDefinition,
  envelope: Omit<KernelObjectEnvelopeInput, "objectType"> & { objectType?: string },
): WorkerDefinitionRow {
  if (envelope.objectType !== undefined && envelope.objectType !== WORKER_DEFINITION_OBJECT_TYPE) {
    throw new Error(
      `worker definition envelope object_type must be "${WORKER_DEFINITION_OBJECT_TYPE}"`,
    );
  }
  return stampKernelDraft(
    {
      id: definition.id,
      tenant_id: definition.tenantScope,
      identity_ref: definition.identityRef,
      classification: definition.classification,
      capabilities: [...definition.capabilities],
      max_risk_class: definition.authorityBounds.maxRiskClass,
      resource_scopes: [...definition.authorityBounds.resourceScopes],
      delegation_history_refs: [...definition.delegationHistoryRefs],
      lifecycle_state: definition.lifecycle,
    },
    { ...envelope, objectType: WORKER_DEFINITION_OBJECT_TYPE },
  );
}

/**
 * Re-read a persistent worker definition row (persistence round-trip).
 * Fails closed on anonymous/half-stamped rows and on envelope rows whose
 * substantive columns disagree with the definition fields they carry.
 */
export function readWorkerDefinitionRow(row: Record<string, unknown>): WorkerDefinition {
  validateKernelRowEnvelope(row);
  const validated = defineWorkerDefinition({
    id: row.id as string,
    tenantScope: row.tenant_id as string,
    identityRef: row.identity_ref as string,
    classification: row.classification as WorkerClassification,
    capabilities: row.capabilities as readonly WorkerCapabilityDeclaration[],
    authorityBounds: {
      maxRiskClass: row.max_risk_class as AgentRiskClassification,
      resourceScopes: row.resource_scopes as readonly string[],
    },
    delegationHistoryRefs: row.delegation_history_refs as readonly string[],
    lifecycle: row.lifecycle_state as WorkerDefinitionLifecycleState,
  });
  if (!validated.ok) {
    throw new Error(`persistent worker definition row rejected: ${validated.errors.join("; ")}`);
  }
  if (row.object_type !== WORKER_DEFINITION_OBJECT_TYPE) {
    throw new Error(
      `persistent worker definition row object_type must be "${WORKER_DEFINITION_OBJECT_TYPE}"`,
    );
  }
  return validated.definition;
}

/* ─────────────────────────────────────────────────────────────
 * Actor resolution — the SAME primitives as human identities
 * ────────────────────────────────────────────────────────────*/

export type WorkerActorResolution =
  { ok: true; actor: IdentityActor; definition: WorkerDefinition } | { ok: false; reason: string };

/**
 * Resolve a worker through the identity-actor primitive. The delegating
 * actor source is resolved EXACTLY as a human identity's would be
 * (`resolveIdentityActor` — fail-closed on lifecycle/session/role), and the
 * worker definition's own lifecycle is checked against the same usable-state
 * predicate the identity model uses. A suspended, archived or deleted worker
 * can never resolve. The actor's tenant scope must equal the definition's
 * tenant scope (multi-tenancy law).
 */
export function resolveWorkerActor(
  definition: WorkerDefinition,
  delegatingActorSource: IdentityActorSource,
): WorkerActorResolution {
  if (!isIdentityUsable({ lifecycle: definition.lifecycle })) {
    return {
      ok: false,
      reason: `worker_definition_lifecycle_unusable:${definition.lifecycle}`,
    };
  }
  const actorResolution = resolveIdentityActor(delegatingActorSource);
  if (!actorResolution.ok) {
    return { ok: false, reason: `delegating_actor_denied:${actorResolution.reason}` };
  }
  const actor = actorResolution.actor;
  if (actorScope(actor) !== definition.tenantScope) {
    return { ok: false, reason: "delegating_actor_tenant_scope_mismatch" };
  }
  return { ok: true, actor, definition };
}

/* ─────────────────────────────────────────────────────────────
 * Definition <-> ephemeral-runtime binding contract
 * ────────────────────────────────────────────────────────────*/

/**
 * A runtime instance claims a definition. The claim input carries a
 * delegation (capability ids, risk class, resource scopes) that must fit
 * INSIDE the persistent definition; the resulting authority is computed
 * only from checked inputs and is handed to the ephemeral lifecycle as its
 * `AgentDefinition` (additive integration — the ephemeral module's exports
 * are consumed, never modified).
 */
export interface WorkerRuntimeClaimInput {
  /** The ephemeral runtime instance claiming the definition. */
  runtimeInstanceId: string;
  definition: WorkerDefinition;
  /** Resolved through the SAME actor primitives as human identities. */
  delegatingActor: IdentityActorSource;
  /** Reference to the delegation record in the persistent history. */
  delegationRef: string;
  /** Capability ids the delegation grants (must be a subset of the owned set). */
  delegatedCapabilities: readonly string[];
  /** Risk class the delegation grants (must be ≤ the definition ceiling). */
  claimedRiskClass: AgentRiskClassification;
  /** Resource scopes the delegation grants (must be a subset of the bounds). */
  claimedResourceScopes: readonly string[];
  /** Ephemeral lease parameters (owned by the ephemeral lifecycle, not authority). */
  timeLimitMs: number;
  actionLimit: number;
  budget?: RuntimeBudget;
  evidenceRequirements?: readonly string[];
  /** Monotonic-ish claim instant (ms); carried on the claim for observability. */
  nowMs: number;
}

/** The bound claim: persistent definition x explicit delegation x runtime instance. */
export interface WorkerRuntimeClaim {
  claimId: string;
  runtimeInstanceId: string;
  definitionId: string;
  identityRef: string;
  tenantRef: string;
  delegationRef: string;
  actor: IdentityActor;
  /** Exactly the delegated ∩ declared set — the ONLY authority that exists. */
  effectiveCapabilities: readonly string[];
  effectiveMaxRiskClass: AgentRiskClassification;
  effectiveResourceScopes: readonly string[];
  /** The ephemeral lifecycle's definition view, bounded by the claim. */
  agentDefinition: AgentDefinition;
  claimedAtMs: number;
}

export type WorkerRuntimeClaimResult =
  { ok: true; claim: WorkerRuntimeClaim } | { ok: false; reason: string };

/**
 * Claim a persistent definition for an ephemeral runtime instance.
 * Fails closed on every escalation attempt:
 *  - worker definition lifecycle unusable (suspended/archived/deleted) — denied;
 *  - delegating actor unresolved by the shared identity-actor primitive — denied;
 *  - cross-tenant claim — denied;
 *  - a delegated capability NOT declared in the owned capability set — denied;
 *  - a risk class above the definition ceiling — denied (never clamped);
 *  - a resource scope outside the definition bounds — denied.
 */
export function claimWorkerRuntime(input: WorkerRuntimeClaimInput): WorkerRuntimeClaimResult {
  const actorResolution = resolveWorkerActor(input.definition, input.delegatingActor);
  if (!actorResolution.ok) {
    return { ok: false, reason: actorResolution.reason };
  }
  if (!isNonEmptyTrimmed(input.runtimeInstanceId, 200)) {
    return { ok: false, reason: "runtime_instance_id_required" };
  }
  if (!isNonEmptyTrimmed(input.delegationRef, 200)) {
    return { ok: false, reason: "delegation_ref_required" };
  }
  if (!isStringArray(input.delegatedCapabilities)) {
    return { ok: false, reason: "delegated_capabilities_must_be_strings" };
  }
  if (!isStringArray(input.claimedResourceScopes)) {
    return { ok: false, reason: "claimed_resource_scopes_must_be_strings" };
  }
  if (!(AGENT_RISK_CLASSIFICATION_SET as ReadonlySet<string>).has(input.claimedRiskClass)) {
    return { ok: false, reason: "claimed_risk_class_unknown" };
  }

  const declared = new Set<string>(
    input.definition.capabilities.map((declaration) => declaration.capabilityId),
  );
  for (const capabilityId of input.delegatedCapabilities) {
    if (!declared.has(capabilityId)) {
      return {
        ok: false,
        reason: `capability_escalation_denied:${capabilityId}_not_in_owned_set`,
      };
    }
  }
  for (const scope of input.claimedResourceScopes) {
    if (!(input.definition.authorityBounds.resourceScopes as readonly string[]).includes(scope)) {
      return {
        ok: false,
        reason: `resource_scope_escalation_denied:${scope}_outside_authority_bounds`,
      };
    }
  }
  if (
    riskClassRank(input.claimedRiskClass) >
    riskClassRank(input.definition.authorityBounds.maxRiskClass)
  ) {
    return {
      ok: false,
      reason: `risk_class_escalation_denied:${input.claimedRiskClass}_above_${input.definition.authorityBounds.maxRiskClass}`,
    };
  }

  const deduplicatedCapabilities = [...new Set(input.delegatedCapabilities)];
  const deduplicatedScopes = [...new Set(input.claimedResourceScopes)];

  // The ephemeral definition view carries ONLY the bounded authority. Tool
  // access is never derived from capabilities: allowedTools stays empty here —
  // tool grants are a separate, explicit declaration surface.
  const agentDefinition: AgentDefinition = {
    id: agentDefinitionId(input.definition.id),
    tenantRef: input.definition.tenantScope,
    capabilities: deduplicatedCapabilities,
    allowedTools: [],
    permissions: deduplicatedCapabilities.map((capabilityId): AgentPermission => ({
      kind: "capability",
      capabilityId,
    })),
    budget: input.budget ?? { maxTokens: null, maxFinancialCost: null },
    timeLimitMs: input.timeLimitMs,
    actionLimit: input.actionLimit,
    evidenceRequirements: input.evidenceRequirements ?? [],
  };

  return {
    ok: true,
    claim: {
      claimId: `claim:${input.definition.id}:${input.runtimeInstanceId}`,
      runtimeInstanceId: (input.runtimeInstanceId as string).trim(),
      definitionId: input.definition.id,
      identityRef: input.definition.identityRef,
      tenantRef: input.definition.tenantScope,
      delegationRef: (input.delegationRef as string).trim(),
      actor: actorResolution.actor,
      effectiveCapabilities: deduplicatedCapabilities,
      effectiveMaxRiskClass: input.claimedRiskClass,
      effectiveResourceScopes: deduplicatedScopes,
      agentDefinition,
      claimedAtMs: input.nowMs,
    },
  };
}

/**
 * Record a delegation into the persistent history (returns the refs the
 * definition carries). History rows are append-only references; this helper
 * exists so callers never mutate a definition's history silently.
 */
export function recordDelegation(
  definition: WorkerDefinition,
  delegationRef: string,
): WorkerDefinitionValidationResult {
  if (!isNonEmptyTrimmed(delegationRef, 200)) {
    return { ok: false, errors: ["delegation ref must be 1–200 characters"] };
  }
  return defineWorkerDefinition({
    id: definition.id,
    tenantScope: definition.tenantScope,
    identityRef: definition.identityRef,
    classification: definition.classification,
    capabilities: definition.capabilities,
    authorityBounds: definition.authorityBounds,
    delegationHistoryRefs: [...definition.delegationHistoryRefs, (delegationRef as string).trim()],
    lifecycle: definition.lifecycle,
  });
}

/** Provenance guard for AI-classified workers (Constitution §12). */
export function isAiWorker(definition: WorkerDefinition): boolean {
  return definition.classification === "ai";
}

/** Data classification re-export guard: definitions never carry classified payloads. */
export function isRegisteredDataClassification(value: unknown): boolean {
  return isDataClassification(value);
}
