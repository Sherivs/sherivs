/**
 * CoreGrid — Core Application Runtime integration adapters.
 *
 * Implements `architecture/phase-05-core-application-runtime.md`:
 * - Integration runtime (Section BJ): integrations use adapters.
 * - Vendor isolation (Section BK): application code must not become tightly
 *   coupled to one vendor's SDK where avoidable.
 * - Adapter contracts (Section BL): every external integration exposes an
 *   internal normalized interface.
 * - Anti-corruption layer (Section BM): external data models must not
 *   automatically become CoreGrid's canonical models.
 * - Data transformation (Section BN): integration adapters may transform data.
 */

import type { TenantId } from "./tenant-core";
import type { CorrelationId } from "./runtime-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Integration adapter contract (Section BL)
 * ────────────────────────────────────────────────────────────*/

export type IntegrationStatus = "active" | "disabled" | "degraded" | "deprecated";

export interface IntegrationAdapter {
  /** Integration name, e.g. "Paystack", "Twilio". */
  name: string;
  /** Adapter version. */
  version: string;
  /** Integration status. */
  status: IntegrationStatus;
  /** Whether this integration is tenant-scoped. */
  requiresTenantContext: boolean;
  /** Whether this integration is platform-only. */
  isPlatformOnly: boolean;
  /** Whether this integration handles sensitive data. */
  handlesSensitiveData: boolean;
  /** Whether this integration requires human approval for sensitive operations. */
  sensitive: boolean;
}

export interface IntegrationRequest {
  adapterName: string;
  operation: string;
  tenantId: TenantId | null;
  correlationId: CorrelationId;
  /** Normalized internal payload (Section BL). */
  payload: Record<string, unknown>;
  /** Timeout in milliseconds (Section Y). */
  timeoutMs: number;
}

export type IntegrationResponse =
  | { ok: true; data: Record<string, unknown> }
  | {
      ok: false;
      errorCategory: "transient" | "permanent" | "authorization" | "validation" | "timeout";
      error: string;
    };

export interface IntegrationAdapterHandler {
  /** Executes a normalized operation against the external provider. */
  execute(request: IntegrationRequest): Promise<IntegrationResponse>;
}

/* ─────────────────────────────────────────────────────────────
 * Integration registry (Section BJ)
 * ────────────────────────────────────────────────────────────*/

export interface IntegrationRegistry {
  register(adapter: IntegrationAdapter, handler: IntegrationAdapterHandler): void;
  find(name: string): IntegrationAdapter | null;
  isAvailable(name: string, tenantId: TenantId | null): boolean;
  execute(request: IntegrationRequest): Promise<IntegrationResponse>;
}

export function createIntegrationRegistry(): IntegrationRegistry {
  const adapters = new Map<
    string,
    { adapter: IntegrationAdapter; handler: IntegrationAdapterHandler }
  >();

  return {
    register(adapter, handler) {
      adapters.set(adapter.name, { adapter, handler });
    },
    find(name) {
      return adapters.get(name)?.adapter ?? null;
    },
    isAvailable(name, tenantId) {
      const entry = adapters.get(name);
      if (!entry) return false;
      if (entry.adapter.status === "disabled" || entry.adapter.status === "deprecated")
        return false;
      if (entry.adapter.requiresTenantContext && tenantId === null) return false;
      if (entry.adapter.isPlatformOnly && tenantId !== null) return false;
      return true;
    },
    async execute(request) {
      const entry = adapters.get(request.adapterName);
      if (!entry) {
        return {
          ok: false,
          errorCategory: "permanent",
          error: `Unknown integration: ${request.adapterName}`,
        };
      }
      if (!this.isAvailable(request.adapterName, request.tenantId)) {
        return {
          ok: false,
          errorCategory: "authorization",
          error: `Integration not available: ${request.adapterName}`,
        };
      }
      return entry.handler.execute(request);
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Anti-corruption layer (Section BM)
 * ────────────────────────────────────────────────────────────*/

/**
 * Transforms external data into CoreGrid's canonical shape (Section BM).
 * External data models must not automatically become CoreGrid's canonical models.
 */
export function transformExternalToCanonical<T>(
  external: unknown,
  mapper: (external: unknown) => T,
): T {
  return mapper(external);
}

/**
 * Transforms CoreGrid data into an external provider's expected shape (Section BN).
 */
export function transformCanonicalToExternal<T>(
  canonical: unknown,
  mapper: (canonical: unknown) => T,
): T {
  return mapper(canonical);
}

/* ─────────────────────────────────────────────────────────────
 * Integration health (Section GB)
 * ────────────────────────────────────────────────────────────*/

export interface IntegrationHealth {
  adapterName: string;
  status: "healthy" | "degraded" | "unhealthy" | "unknown";
  lastCheckedAt: string;
  lastError: string | null;
  consecutiveFailures: number;
}

export function createIntegrationHealth(
  adapterName: string,
  status: IntegrationHealth["status"] = "unknown",
  lastError: string | null = null,
): IntegrationHealth {
  return {
    adapterName,
    status,
    lastCheckedAt: timeAuthority.now().at,
    lastError,
    consecutiveFailures: 0,
  };
}
