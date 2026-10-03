/**
 * CoreGrid — governed worker identity registry, pure contract
 * (MISSION V1-003, team WORKFORCE).
 *
 * The REGISTRATION + AUTHORITY-RESOLUTION half of the governed worker
 * lifecycle, wired onto the persistent worker-definition substrate
 * (`worker-definition.ts`, MISSION-R-40) and the mission execution path's
 * authorization contribution (`missions/mission-authorization.ts`, V1-004).
 *
 * §28 separation enforced here:
 *   • GOVERNED WORKER IDENTITY — the persistent definition (capability
 *     claims, authority bounds, delegation history) that survives process
 *     termination. Registration is validated, envelope-bearing, deny-by-
 *     default: an empty capability set is valid and has ZERO authority.
 *   • EPHEMERAL RUNTIME INSTANCE — the short-lived process that claims the
 *     definition at WAKE. It is NEVER an authority source: the actor context
 *     resolved here carries the DEFINITION's identity; the runtime instance
 *     id is observability only (evidence provenance), never authorization.
 *
 * Delegation grants map onto the NEUTRAL RBAC core (Wave-1 `lib/rbac/`) via
 * V1-004's `mission-authorization.ts` contribution: a delegation grant's
 * capability claims (`mission:<action>:<missionId|*>`) resolve into the
 * actor's `extraPermissions` at the engine's tenant-embedded scope
 * (`<tenantId>:mission:<missionId>`). AI-classified workers act under
 * `isAgent` — Invariant 12 makes role membership worthless for them, so ALL
 * their authority flows through these explicit grants, and every grant is
 * checked against the definition's declared capability set and risk ceiling
 * BEFORE it can reach the engine (escalation is denied, never clamped).
 *
 * Quarantine: a worker whose failure count crosses its configured bound is
 * quarantined (recorded by the DB registry) and is no longer leased to —
 * `workerQuarantineDecision` is the pure bound check the host applies.
 *
 * Boundary: pure data + pure functions. No persistence, no I/O, no vendor.
 * Database persistence lives in `worker-registry-db.server.ts`.
 */

import { z } from "zod";
import { isIdentityUsable, type IdentityKind } from "../identity";
import { AGENT_RISK_CLASSIFICATIONS, type AgentRiskClassification } from "../agent-core";
import { defineWorkerDefinition, type WorkerDefinition } from "./worker-definition";
import type { MissionActorContext } from "../missions/mission-authorization";
import { missionActorContextSchema } from "../missions/mission-authorization";

const AGENT_RISK_CLASSIFICATION_SET: ReadonlySet<string> = new Set<string>(
  AGENT_RISK_CLASSIFICATIONS,
);

function riskClassRank(riskClass: AgentRiskClassification): number {
  return AGENT_RISK_CLASSIFICATIONS.indexOf(riskClass);
}

/* ─────────────────────────────────────────────────────────────
 * Mission capability vocabulary (the delegation surface)
 * ────────────────────────────────────────────────────────────*/

/**
 * A worker capability claim that maps onto the mission domain's RBAC
 * contribution: `mission:<create|execute|verify>:<missionId>`, or the
 * tenant-wide `mission:<create|execute|verify>:*`. Anything else is a
 * capability this module cannot resolve — it contributes NOTHING to
 * authority (deny by default), and only ever maps to the mission domain's
 * own permission resource.
 */
export const WORKER_MISSION_CAPABILITY_PATTERN = /^mission:(create|execute|verify):([^:]+)$/;

export type WorkerMissionCapabilityAction = "create" | "execute" | "verify";

export function parseWorkerMissionCapability(
  capabilityId: string,
): { action: WorkerMissionCapabilityAction; missionId: string } | null {
  const match = WORKER_MISSION_CAPABILITY_PATTERN.exec(capabilityId);
  if (match === null) return null;
  const action = match[1] as WorkerMissionCapabilityAction;
  const missionId = match[2] ?? "";
  return { action, missionId };
}

/* ─────────────────────────────────────────────────────────────
 * Input schemas (Zod — everything crossing the trust boundary)
 * ────────────────────────────────────────────────────────────*/

const riskClassSchema = z.custom<AgentRiskClassification>(
  (value) => typeof value === "string" && AGENT_RISK_CLASSIFICATION_SET.has(value),
  { message: "must be an agent risk classification" },
);

export const workerCapabilityClaimSchema = z
  .object({
    capabilityId: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(500),
  })
  .strict();

export const workerRegistrationInputSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(128),
    definitionId: z.string().trim().min(1).max(160),
    /** Reference to the worker's cg_identity row — the worker IS an identity. */
    identityRef: z.string().trim().min(1).max(160),
    classification: z.enum(["human", "ai"]),
    /** Explicit capability claims. Empty is valid and carries ZERO authority. */
    capabilities: z.array(workerCapabilityClaimSchema).max(256),
    maxRiskClass: riskClassSchema,
    resourceScopes: z.array(z.string().trim().min(1).max(200)).max(64),
    createdBy: z.string().trim().min(1).max(160),
    /** Kernel envelope (V1CAP-002): a registration must be traceable. */
    schemaVersion: z
      .string()
      .trim()
      .regex(/^\d+\.\d$/, "schemaVersion must match MAJOR.MINOR")
      .default("1.0"),
    traceId: z.string().trim().min(1).max(200),
    correlationId: z.string().trim().min(1).max(200),
    declaredOrigin: z.string().trim().min(1).max(200).default("workforce.worker-registration"),
  })
  .strict();

export type WorkerRegistrationInput = z.input<typeof workerRegistrationInputSchema>;

export const delegationGrantInputSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(128),
    definitionId: z.string().trim().min(1).max(160),
    grantId: z.string().trim().min(1).max(160),
    delegationRef: z.string().trim().min(1).max(200),
    delegatedCapabilities: z.array(z.string().trim().min(1).max(160)).max(64),
    maxGrantedRiskClass: riskClassSchema,
    grantedBy: z.string().trim().min(1).max(160),
  })
  .strict();

export type DelegationGrantInput = z.infer<typeof delegationGrantInputSchema>;

/** The live delegation-grant state as resolved from the DB (untrusted input). */
export const workerDelegationGrantStateSchema = z
  .object({
    grantId: z.string().trim().min(1).max(160),
    definitionId: z.string().trim().min(1).max(160),
    delegationRef: z.string().trim().min(1).max(200),
    delegatedCapabilities: z.array(z.string().trim().min(1).max(160)).max(64),
    maxGrantedRiskClass: riskClassSchema,
    state: z.enum(["active", "revoked"]),
  })
  .strict();

export type WorkerDelegationGrantState = z.infer<typeof workerDelegationGrantStateSchema>;

/* ─────────────────────────────────────────────────────────────
 * Registration (persistent identity half of §28)
 * ────────────────────────────────────────────────────────────*/

export type WorkerRegistrationResult =
  { ok: true; definition: WorkerDefinition } | { ok: false; errors: readonly string[] };

/**
 * Validate a governed worker registration. Delegates the substantive
 * definition law to the wave-2 substrate (`defineWorkerDefinition` — untrusted
 * new-worker posture, deny-by-default capability set) behind a Zod trust
 * boundary. No persistence here; the DB registry persists the validated shape.
 */
export function validateWorkerRegistration(
  input: WorkerRegistrationInput,
): WorkerRegistrationResult {
  const parsed = workerRegistrationInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: [`registration rejected: ${parsed.error.message}`] };
  }
  const data = parsed.data;
  const validated = defineWorkerDefinition({
    id: data.definitionId,
    tenantScope: data.tenantId,
    identityRef: data.identityRef,
    classification: data.classification,
    capabilities: data.capabilities,
    authorityBounds: {
      maxRiskClass: data.maxRiskClass,
      resourceScopes: data.resourceScopes,
    },
    lifecycle: "provisioned",
  });
  if (!validated.ok) return { ok: false, errors: validated.errors };
  return { ok: true, definition: validated.definition };
}

/* ─────────────────────────────────────────────────────────────
 * Delegation grant resolution → neutral RBAC / mission contribution
 * ────────────────────────────────────────────────────────────*/

export type WorkerAuthorityResolution =
  | {
      ok: true;
      /** The SERVER-resolved actor context for the mission path. */
      actor: MissionActorContext;
      /** delegated ∩ declared mission capabilities that produced the grants. */
      effectiveCapabilities: readonly string[];
    }
  | { ok: false; reason: string };

/**
 * Resolve a governed worker's mission authority for ONE (tenant, mission):
 *   1. Zod-validated inputs (trust boundary);
 *   2. tenant scope of every grant and the definition must equal the
 *      requested tenant (multi-tenancy law, §13);
 *   3. definition lifecycle must be USABLE (`isIdentityUsable` — a suspended,
 *      archived or deleted worker — e.g. a quarantined one — never resolves);
 *   4. only `state === "active"` grants count; a grant naming another
 *      definition or a malformed shape FAILS THE RESOLUTION (fail closed —
 *      untrusted input is never silently skipped);
 *   5. escalation checks per grant: every delegated capability must be in the
 *      definition's DECLARED capability set, and the granted risk class must
 *      be at or below the definition's ceiling (denied, never clamped);
 *   6. mission capability claims map to `extraPermissions` at the
 *      tenant-embedded scope the mission engine requests
 *      (`<tenantId>:mission:<missionId>`); claims for OTHER missions
 *      contribute nothing here;
 *   7. the resolved actor is Zod-validated before it is returned.
 *
 * AI-classified workers act under `isAgent: true` (Invariant 12: role
 * membership is never a source of agent authority — only these explicit
 * delegation grants are). A resolution with zero effective grants still
 * yields an actor: the authorization engine then denies with its
 * agent-specific reason, which keeps the denial observable at the engine.
 */
export function buildWorkerMissionActor(input: {
  definition: WorkerDefinition;
  grants: readonly WorkerDelegationGrantState[];
  tenantId: string;
  missionId: string;
}): WorkerAuthorityResolution {
  const tenantCheck = z.string().trim().min(1).max(128).safeParse(input.tenantId);
  const missionCheck = z.string().trim().min(1).max(160).safeParse(input.missionId);
  if (!tenantCheck.success || !missionCheck.success) {
    return { ok: false, reason: "invalid_scope:tenant and mission ids are required" };
  }
  const tenantId = tenantCheck.data;
  const missionId = missionCheck.data;

  if (input.definition.tenantScope !== tenantId) {
    return { ok: false, reason: "cross_tenant:worker definition tenant scope mismatch" };
  }
  if (!isIdentityUsable({ lifecycle: input.definition.lifecycle })) {
    return {
      ok: false,
      reason: `worker_lifecycle_unusable:${input.definition.lifecycle}`,
    };
  }

  const declared = new Set<string>(
    input.definition.capabilities.map((claim) => claim.capabilityId),
  );
  const extraPermissions: { resource: string; action: string; scope: string }[] = [];
  const effective: string[] = [];

  for (const grant of input.grants) {
    const grantCheck = workerDelegationGrantStateSchema.safeParse(grant);
    if (!grantCheck.success) {
      return { ok: false, reason: `invalid_grant:${grantCheck.error.message}` };
    }
    const state = grantCheck.data;
    if (state.definitionId !== input.definition.id) {
      // Fail closed: a grant for another definition must never be silently
      // skipped — the caller passed untrusted or crossed registry data.
      return {
        ok: false,
        reason: `grant_definition_mismatch:${state.grantId}`,
      };
    }
    if (state.state !== "active") continue; // revocation: effective immediately

    for (const capabilityId of state.delegatedCapabilities) {
      if (!declared.has(capabilityId)) {
        return {
          ok: false,
          reason: `capability_escalation_denied:${capabilityId}_not_in_owned_set`,
        };
      }
    }
    if (
      riskClassRank(state.maxGrantedRiskClass) >
      riskClassRank(input.definition.authorityBounds.maxRiskClass)
    ) {
      return {
        ok: false,
        reason: `risk_class_escalation_denied:${state.maxGrantedRiskClass}_above_${input.definition.authorityBounds.maxRiskClass}`,
      };
    }

    for (const capabilityId of state.delegatedCapabilities) {
      if (effective.includes(capabilityId)) continue;
      const missionClaim = parseWorkerMissionCapability(capabilityId);
      if (missionClaim === null) continue; // non-mission claims grant nothing here
      if (missionClaim.missionId !== "*" && missionClaim.missionId !== missionId) {
        continue; // scoped to another mission — contributes nothing here
      }
      effective.push(capabilityId);
      extraPermissions.push({
        resource: "mission",
        action: missionClaim.action,
        scope: `${tenantId}:mission:${missionId}`,
      });
    }
  }

  const actorCandidate: MissionActorContext = {
    actorId: input.definition.id,
    tenantId,
    identityKind: (input.definition.classification === "ai" ? "ai_agent" : "human") as IdentityKind,
    lifecycle: input.definition.lifecycle,
    role: "mission_operator",
    isAgent: input.definition.classification === "ai",
    extraPermissions,
  };
  const actorCheck = missionActorContextSchema.safeParse(actorCandidate);
  if (!actorCheck.success) {
    return { ok: false, reason: `actor_context_rejected:${actorCheck.error.message}` };
  }
  return { ok: true, actor: actorCheck.data, effectiveCapabilities: effective };
}

/* ─────────────────────────────────────────────────────────────
 * Quarantine bound (§16 decision: recorded, no longer leased to)
 * ────────────────────────────────────────────────────────────*/

export interface WorkerQuarantineDecision {
  readonly quarantined: boolean;
  readonly failureCount: number;
  readonly threshold: number;
  readonly reason: string | null;
}

export const quarantineDecisionInputSchema = z
  .object({
    failureCount: z.number().int().min(0).max(1_000_000),
    threshold: z.number().int().min(1).max(1_000_000),
  })
  .strict();

/**
 * The pure quarantine bound: a worker whose failure count has reached the
 * configured threshold is quarantined. The host applies this AFTER a failed
 * execution and the DB registry records the ledger row (and suspends the
 * definition's lifecycle, so the freeze is persistent and immediate).
 */
export function workerQuarantineDecision(input: {
  failureCount: number;
  threshold: number;
}): WorkerQuarantineDecision {
  const parsed = quarantineDecisionInputSchema.safeParse(input);
  if (!parsed.success) {
    // Untrusted counters fail closed INTO quarantine: a malformed failure
    // accounting must never keep a misbehaving worker eligible.
    return {
      quarantined: true,
      failureCount: Number.NaN,
      threshold: input.threshold,
      reason: `quarantine_input_invalid:${parsed.error.message}`,
    };
  }
  const { failureCount, threshold } = parsed.data;
  if (failureCount >= threshold) {
    return {
      quarantined: true,
      failureCount,
      threshold,
      reason: `failure_count_${failureCount}_reached_threshold_${threshold}`,
    };
  }
  return { quarantined: false, failureCount, threshold, reason: null };
}
