/**
 * CoreGrid Tenant Topology Engine (H8 + R).
 *
 * Implements `architecture/phase-03-multi-tenancy.md`:
 * - Hierarchical tenancy: Parent → Child (R1).
 * - Peer tenancy: Independent tenants may participate in controlled collaboration (R2).
 * - Federated tenancy: Tenants may participate in trusted external networks (R3).
 * - Tenant hierarchy does not automatically grant unrestricted descendant access (Invariant 14).
 * - Cross-tenant operations must be explicit, authorized, and auditable (Invariants 07, 08).
 */

import type { TenantId, TenantTopologyEdge, TopologyRelation } from "./tenant-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Topology edge creation
 * ────────────────────────────────────────────────────────────*/

export interface CreateTopologyEdgeInput {
  fromTenantId: TenantId;
  toTenantId: TenantId;
  relation: TopologyRelation;
  /** Explicit authorization required for cross-tenant access (Invariant 07). */
  authorized: boolean;
}

export type CreateTopologyEdgeResult =
  { ok: true; edge: TenantTopologyEdge } | { ok: false; error: string };

export function createTopologyEdge(
  input: CreateTopologyEdgeInput,
  now: string = timeAuthority.now().at,
): CreateTopologyEdgeResult {
  // Self-loops are not allowed.
  if (input.fromTenantId === input.toTenantId) {
    return { ok: false, error: "Tenant topology edge cannot connect a tenant to itself" };
  }

  // Parent/child edges must be explicitly authorized.
  if (input.relation === "parent" || input.relation === "child") {
    if (!input.authorized) {
      return {
        ok: false,
        error: "Parent/child topology edges require explicit authorization",
      };
    }
  }

  const edge: TenantTopologyEdge = {
    fromTenantId: input.fromTenantId,
    toTenantId: input.toTenantId,
    relation: input.relation,
    authorized: input.authorized,
    createdAt: now,
  };

  return { ok: true, edge };
}

/* ─────────────────────────────────────────────────────────────
 * Topology queries
 * ────────────────────────────────────────────────────────────*/

export function getChildren(edges: TenantTopologyEdge[], parentTenantId: TenantId): TenantId[] {
  return edges
    .filter((e) => e.relation === "child" && e.fromTenantId === parentTenantId)
    .map((e) => e.toTenantId);
}

export function getParents(edges: TenantTopologyEdge[], childTenantId: TenantId): TenantId[] {
  return edges
    .filter(
      (e) =>
        (e.relation === "parent" && e.toTenantId === childTenantId) ||
        (e.relation === "child" && e.toTenantId === childTenantId),
    )
    .map((e) => e.fromTenantId);
}

export function getPeers(edges: TenantTopologyEdge[], tenantId: TenantId): TenantId[] {
  const peerIds = new Set<TenantId>();
  for (const edge of edges) {
    if (edge.relation === "peer") {
      if (edge.fromTenantId === tenantId) peerIds.add(edge.toTenantId);
      if (edge.toTenantId === tenantId) peerIds.add(edge.fromTenantId);
    }
  }
  return [...peerIds];
}

/* ─────────────────────────────────────────────────────────────
 * Access control (Invariant 14)
 * ────────────────────────────────────────────────────────────*/

/**
 * Determine if a tenant can access another tenant's resources.
 * Invariant 14: Tenant hierarchy does not automatically grant unrestricted descendant access.
 * Invariant 07: Cross-tenant operations must be explicit.
 */
export function canAccessTenant(
  edges: TenantTopologyEdge[],
  fromTenantId: TenantId,
  toTenantId: TenantId,
): boolean {
  if (fromTenantId === toTenantId) return true;

  // Only authorized edges grant access.
  return edges.some(
    (e) =>
      e.authorized &&
      ((e.fromTenantId === fromTenantId && e.toTenantId === toTenantId) ||
        (e.fromTenantId === toTenantId && e.toTenantId === fromTenantId)),
  );
}

/* ─────────────────────────────────────────────────────────────
 * Cycle detection
 * ────────────────────────────────────────────────────────────*/

/**
 * Detect cycles in the tenant topology graph.
 * Prevents infinite hierarchy loops.
 */
export function hasCycle(edges: TenantTopologyEdge[], startTenantId: TenantId): boolean {
  const visited = new Set<TenantId>();
  const stack = new Set<TenantId>();

  function dfs(node: TenantId): boolean {
    if (stack.has(node)) return true;
    if (visited.has(node)) return false;

    visited.add(node);
    stack.add(node);

    const neighbors = edges.filter((e) => e.fromTenantId === node).map((e) => e.toTenantId);

    for (const neighbor of neighbors) {
      if (dfs(neighbor)) return true;
    }

    stack.delete(node);
    return false;
  }

  return dfs(startTenantId);
}

/* ─────────────────────────────────────────────────────────────
 * Topology validation
 * ────────────────────────────────────────────────────────────*/

export function validateTopology(
  edges: TenantTopologyEdge[],
  tenantIds: TenantId[],
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // All edge endpoints must reference known tenants.
  const known = new Set(tenantIds);
  for (const edge of edges) {
    if (!known.has(edge.fromTenantId)) {
      errors.push(`Edge references unknown tenant: ${edge.fromTenantId}`);
    }
    if (!known.has(edge.toTenantId)) {
      errors.push(`Edge references unknown tenant: ${edge.toTenantId}`);
    }
  }

  // No self-loops.
  for (const edge of edges) {
    if (edge.fromTenantId === edge.toTenantId) {
      errors.push(`Self-loop detected: ${edge.fromTenantId}`);
    }
  }

  // No cycles in parent/child relationships.
  for (const tenantId of tenantIds) {
    const hierarchyEdges = edges.filter((e) => e.relation === "parent" || e.relation === "child");
    if (hasCycle(hierarchyEdges, tenantId)) {
      errors.push(`Cycle detected in tenant hierarchy involving ${tenantId}`);
      break;
    }
  }

  return { valid: errors.length === 0, errors };
}
