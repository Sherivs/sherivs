/**
 * Platform-scoped authority projection over the canonical CORE-05 worker
 * definition, capability registry, and delegation grant. This is a request-
 * time context, not a second agent registry or a tenant identity.
 */

import type { AgentRiskClassification } from "../agent-core";
import { workerDelegationGrantStateSchema } from "./worker-registry";
import {
  checkWorkerCapabilityIntegrity,
  type CapabilityRegistry,
  type RegisteredCapability,
} from "./capability-registry";
import { defineWorkerDefinition, type WorkerDefinition } from "./worker-definition";

export const COREGRID_PLATFORM_REF = "coregrid" as const;
export const PLATFORM_AGENT_RESOURCE_SCOPE = "platform:control-plane" as const;

const RISK_CLASS_RANK: Readonly<Record<AgentRiskClassification, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export interface PlatformAgentAuthorityContext {
  readonly definitionId: string;
  readonly identityRef: string;
  readonly classification: "ai";
  readonly lifecycle: "active";
  readonly scope: {
    readonly kind: "platform";
    readonly platformRef: typeof COREGRID_PLATFORM_REF;
    readonly resourceScope: typeof PLATFORM_AGENT_RESOURCE_SCOPE;
    readonly tenantRef: null;
  };
  readonly grantId: string;
  readonly grantExpiresAt: string;
  readonly resolvedAt: string;
  readonly maxRiskClass: AgentRiskClassification;
  readonly capabilities: readonly RegisteredCapability[];
}

export type PlatformAgentAuthorityResult =
  | { readonly ok: true; readonly authority: PlatformAgentAuthorityContext }
  | { readonly ok: false; readonly reason: string };

export interface ServerResolvedPlatformScope {
  readonly kind: "platform";
  readonly platformRef: typeof COREGRID_PLATFORM_REF;
  readonly resourceScope: typeof PLATFORM_AGENT_RESOURCE_SCOPE;
  readonly tenantRef: null;
}

/**
 * Resolve authority from a server-loaded worker definition and live delegation.
 * The grant is revalidated for every decision; declared capabilities alone
 * never confer authority.
 */
export function resolvePlatformAgentAuthority(input: {
  readonly definition: WorkerDefinition;
  readonly grant: unknown;
  readonly capabilityRegistry: CapabilityRegistry;
  readonly platformScope: ServerResolvedPlatformScope;
  readonly resolvedAt: string;
}): PlatformAgentAuthorityResult {
  if (
    input.platformScope?.kind !== "platform" ||
    input.platformScope.platformRef !== COREGRID_PLATFORM_REF ||
    input.platformScope.resourceScope !== PLATFORM_AGENT_RESOURCE_SCOPE ||
    input.platformScope.tenantRef !== null
  ) {
    return { ok: false, reason: "server_resolved_platform_scope_required" };
  }
  const parsedDefinition = defineWorkerDefinition(input.definition);
  if (!parsedDefinition.ok) {
    return { ok: false, reason: `worker_definition_invalid:${parsedDefinition.errors.join("; ")}` };
  }
  const definition = parsedDefinition.definition;
  const parsedGrant = workerDelegationGrantStateSchema.safeParse(input.grant);
  if (!parsedGrant.success) {
    return { ok: false, reason: `worker_grant_invalid:${parsedGrant.error.message}` };
  }
  const grant = parsedGrant.data;
  const resolvedAt = Date.parse(input.resolvedAt);
  const grantedAt = Date.parse(grant.grantedAt);
  const expiresAt = grant.expiresAt === null ? Number.NaN : Date.parse(grant.expiresAt);

  if (!Number.isFinite(resolvedAt)) {
    return { ok: false, reason: "invalid_resolution_time" };
  }
  if (definition.classification !== "ai") {
    return { ok: false, reason: "worker_is_not_an_ai_agent" };
  }
  if (definition.lifecycle !== "active") {
    return { ok: false, reason: `worker_lifecycle_unusable:${definition.lifecycle}` };
  }
  if (!definition.authorityBounds.resourceScopes.includes(PLATFORM_AGENT_RESOURCE_SCOPE)) {
    return { ok: false, reason: "platform_resource_scope_not_declared" };
  }
  if (grant.definitionId !== definition.id) {
    return { ok: false, reason: "grant_definition_mismatch" };
  }
  if (
    grant.state !== "active" ||
    !Number.isFinite(grantedAt) ||
    !Number.isFinite(expiresAt) ||
    grantedAt > resolvedAt ||
    expiresAt <= resolvedAt
  ) {
    return { ok: false, reason: "worker_grant_inactive_or_expired" };
  }
  if (
    RISK_CLASS_RANK[grant.maxGrantedRiskClass] >
    RISK_CLASS_RANK[definition.authorityBounds.maxRiskClass]
  ) {
    return { ok: false, reason: "worker_grant_exceeds_definition_risk_ceiling" };
  }

  const integrity = checkWorkerCapabilityIntegrity(input.capabilityRegistry, definition);
  if (!integrity.ok) {
    return {
      ok: false,
      reason: `unregistered_worker_capability:${integrity.unregisteredCapabilityIds.join(",")}`,
    };
  }
  const declared = new Set(definition.capabilities.map((capability) => capability.capabilityId));
  const capabilities: RegisteredCapability[] = [];
  const seen = new Set<string>();
  for (const capabilityId of grant.delegatedCapabilities) {
    if (!declared.has(capabilityId) || seen.has(capabilityId)) {
      return { ok: false, reason: `grant_capability_not_declared_or_duplicated:${capabilityId}` };
    }
    const capability = input.capabilityRegistry.get(capabilityId);
    if (capability === undefined) {
      return { ok: false, reason: `grant_capability_unregistered:${capabilityId}` };
    }
    if (RISK_CLASS_RANK[capability.riskClass] > RISK_CLASS_RANK[grant.maxGrantedRiskClass]) {
      return { ok: false, reason: `grant_capability_exceeds_risk_ceiling:${capabilityId}` };
    }
    seen.add(capabilityId);
    capabilities.push(capability);
  }

  return {
    ok: true,
    authority: {
      definitionId: definition.id,
      identityRef: definition.identityRef,
      classification: "ai",
      lifecycle: "active",
      scope: {
        kind: "platform",
        platformRef: COREGRID_PLATFORM_REF,
        resourceScope: PLATFORM_AGENT_RESOURCE_SCOPE,
        tenantRef: null,
      },
      grantId: grant.grantId,
      grantExpiresAt: grant.expiresAt!,
      resolvedAt: input.resolvedAt,
      maxRiskClass: grant.maxGrantedRiskClass,
      capabilities,
    },
  };
}
