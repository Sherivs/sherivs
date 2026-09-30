/**
 * CoreGrid — Core Application Runtime capability registry.
 *
 * Implements `architecture/phase-05-core-application-runtime.md`:
 * - Application capability registry: identifies capabilities (Section FZ).
 * - Capability discovery: authorized internal consumers may discover capabilities (Section GA).
 * - Capability health: capabilities expose operational health (Section GB).
 * - Capability versioning: independent evolution where possible (Section GC).
 * - The registry identifies capabilities; it does not replace their domain ownership (Section FZ).
 * - No microservice theatre: capabilities remain logical boundaries (Section FQ).
 * - No god service: no single service owns every domain (Section FR).
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Capability model (Sections FZ–GC)
 * ────────────────────────────────────────────────────────────*/

export type CapabilityStatus = "active" | "degraded" | "disabled" | "deprecated" | "incubating";

export const CAPABILITY_STATUSES: readonly CapabilityStatus[] = [
  "active",
  "degraded",
  "disabled",
  "deprecated",
  "incubating",
] as const;

export interface CapabilityCommand {
  name: string;
  version: number;
  description: string;
  /** Whether this command requires human approval (Section CJ). */
  requiresApproval: boolean;
}

export interface CapabilityQuery {
  name: string;
  version: number;
  description: string;
}

export interface CapabilityEvent {
  /** Event names produced by this capability. */
  producedEventNames: string[];
  /** Event names consumed by this capability. */
  consumedEventNames: string[];
}

export interface CapabilityHealth {
  status: "healthy" | "degraded" | "unhealthy" | "unknown";
  lastCheckedAt: string;
  detail: string | null;
}

export interface ApplicationCapability {
  /** Capability name, e.g. "AcademicIntelligence". */
  name: string;
  /** Capability version (Section GC). */
  version: string;
  /** Capability status. */
  status: CapabilityStatus;
  /** Owning phase (architectural ownership). */
  owningPhase: string;
  /** Capability description. */
  description: string;
  /** Available commands (Section GA). */
  commands: CapabilityCommand[];
  /** Available queries (Section GA). */
  queries: CapabilityQuery[];
  /** Event contracts (Section GA). */
  events: CapabilityEvent;
  /** Whether this capability is exposed to agents. */
  agentExposed: boolean;
  /** Whether this capability requires human approval for sensitive operations (Section CI). */
  sensitive: boolean;
  /** Operational health (Section GB). */
  health: CapabilityHealth;
  /** Whether a tenant context is required for this capability (Section DA). */
  requiresTenantContext: boolean;
  /** Whether this is a platform-only capability (Section DD). */
  isPlatformOnly: boolean;
  /** Deprecation information. */
  deprecation: {
    deprecatedAt: string | null;
    replacement: string | null;
    removalCriteria: string | null;
  } | null;
}

export type CapabilityDiscoveryView = {
  name: string;
  version: string;
  status: CapabilityStatus;
  owningPhase: string;
  commands: Pick<CapabilityCommand, "name" | "version">[];
  queries: Pick<CapabilityQuery, "name" | "version">[];
};

export interface CapabilityRegistry {
  register(capability: ApplicationCapability): void;
  find(name: string): ApplicationCapability | null;
  /** Authorized consumers may discover capabilities (Section GA). */
  discover(authorized: boolean): CapabilityDiscoveryView[];
  /** Whether a capability is usable in the given context. */
  isAvailable(name: string, tenantId: TenantId | null): boolean;
  /** Update capability health (Section GB). */
  updateHealth(name: string, health: CapabilityHealth): boolean;
}

export function createCapabilityRegistry(): CapabilityRegistry {
  const capabilities = new Map<string, ApplicationCapability>();

  return {
    register(capability) {
      capabilities.set(capability.name, capability);
    },
    find(name) {
      return capabilities.get(name) ?? null;
    },
    discover(authorized) {
      const result: CapabilityDiscoveryView[] = [];
      for (const cap of capabilities.values()) {
        if (!authorized && cap.status === "disabled") continue;
        result.push({
          name: cap.name,
          version: cap.version,
          status: cap.status,
          owningPhase: cap.owningPhase,
          commands: cap.commands.map((c) => ({ name: c.name, version: c.version })),
          queries: cap.queries.map((q) => ({ name: q.name, version: q.version })),
        });
      }
      return result;
    },
    isAvailable(name, tenantId) {
      const cap = capabilities.get(name);
      if (!cap) return false;
      if (cap.status === "disabled" || cap.status === "deprecated") return false;
      // A tenant must exist for tenant-scoped capabilities (Section DA).
      if (cap.requiresTenantContext && tenantId === null) return false;
      // Platform capabilities must not run with ordinary tenant privileges (Section DD).
      if (cap.isPlatformOnly && tenantId !== null) return false;
      return true;
    },
    updateHealth(name, health) {
      const cap = capabilities.get(name);
      if (!cap) return false;
      cap.health = health;
      return true;
    },
  };
}
