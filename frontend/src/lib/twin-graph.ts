/**
 * CoreGrid — Digital Twin Graph & Spatial domain model
 * (Phase 16, Sections M, N, O, P, Q, R, S, CQ).
 *
 * Implements `architecture/phase-16-digital-twin.md`:
 * - Relationships (M): contains, located_in, belongs_to, assigned_to,
 *   teaches, enrolled_in, connected_to, depends_on, controls, observes,
 *   managed_by, scheduled_for, powered_by, supplied_by, adjacent_to,
 *   parent_of, child_of.
 * - Relationship ownership (N): relationships belong to the twin graph
 *   only when they represent digital-world modeling relationships;
 *   domain-specific semantic ownership remains with the domain subsystem.
 * - Twin graph (O): supports traversal, filtering, relationship queries,
 *   dependency analysis, topology inspection, historical relationships.
 * - Graph consistency (P): prevent impossible cycles where prohibited,
 *   orphan relationships, dangling references, invalid entity types,
 *   unauthorized cross-tenant relationships.
 * - Spatial model (Q) and coordinate systems (R): latitude/longitude,
 *   local, building, floor, 3D; coordinate-system metadata preserved.
 * - Spatial hierarchy (S): COUNTRY -> REGION -> CITY -> CAMPUS ->
 *   BUILDING -> FLOOR -> ROOM -> ZONE -> ASSET (representation hierarchy,
 *   not a replacement for Phase 3 multi-tenancy).
 * - Cross-tenant relationships (CQ) require explicit governance.
 *
 * Invariants (FA): relationships must be explicitly modeled (15); invalid
 * relationships must be rejected (16); cross-tenant relationships require
 * governance (17).
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Relationship model (M)
 * ────────────────────────────────────────────────────────────*/

export type TwinRelationshipType =
  | "contains"
  | "located_in"
  | "belongs_to"
  | "assigned_to"
  | "teaches"
  | "enrolled_in"
  | "connected_to"
  | "depends_on"
  | "controls"
  | "observes"
  | "managed_by"
  | "scheduled_for"
  | "powered_by"
  | "supplied_by"
  | "adjacent_to"
  | "parent_of"
  | "child_of";

export const TWIN_RELATIONSHIP_TYPES: readonly TwinRelationshipType[] = [
  "contains",
  "located_in",
  "belongs_to",
  "assigned_to",
  "teaches",
  "enrolled_in",
  "connected_to",
  "depends_on",
  "controls",
  "observes",
  "managed_by",
  "scheduled_for",
  "powered_by",
  "supplied_by",
  "adjacent_to",
  "parent_of",
  "child_of",
] as const;

/** Relationship types that must never form cycles (P). */
export const ACYCLIC_RELATIONSHIP_TYPES: ReadonlySet<TwinRelationshipType> = new Set([
  "contains",
  "located_in",
  "belongs_to",
  "parent_of",
  "child_of",
  "controls",
  "powered_by",
  "supplied_by",
]);

export interface TwinRelationship {
  relationshipId: string;
  sourceTwinId: string;
  targetTwinId: string;
  type: TwinRelationshipType;
  tenantId: TenantId;
  sourceTenantId: TenantId;
  targetTenantId: TenantId;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface AddRelationshipInput {
  sourceTwinId: string;
  targetTwinId: string;
  type: TwinRelationshipType;
  tenantId: TenantId;
  createdAt: string;
  crossTenantAuthorized?: boolean;
  metadata?: Record<string, unknown>;
}

export type AddRelationshipResult =
  { ok: true; relationship: TwinRelationship } | { ok: false; error: string };

/**
 * Add a relationship (M, O). The platform must prevent (P): impossible
 * cycles where prohibited, orphan relationships, dangling references,
 * invalid entity types, and unauthorized cross-tenant relationships.
 */
export function addRelationship(
  existing: TwinRelationship[],
  input: AddRelationshipInput,
): AddRelationshipResult {
  if (input.sourceTwinId === input.targetTwinId) {
    return { ok: false, error: "A twin cannot relate to itself (P)" };
  }
  if (
    existing.some(
      (r) =>
        r.sourceTwinId === input.sourceTwinId &&
        r.targetTwinId === input.targetTwinId &&
        r.type === input.type,
    )
  ) {
    return { ok: false, error: "Duplicate relationship is rejected (P)" };
  }
  if (ACYCLIC_RELATIONSHIP_TYPES.has(input.type)) {
    if (wouldCreateCycle(existing, input, input.type)) {
      return { ok: false, error: `Relationship ${input.type} would create a prohibited cycle (P)` };
    }
  }
  const relationship: TwinRelationship = {
    relationshipId: `rel-${input.tenantId}-${input.type}-${Math.random().toString(36).slice(2, 8)}`,
    sourceTwinId: input.sourceTwinId,
    targetTwinId: input.targetTwinId,
    type: input.type,
    tenantId: input.tenantId,
    sourceTenantId: input.tenantId,
    targetTenantId: input.tenantId,
    createdAt: input.createdAt,
    metadata: input.metadata ?? {},
  };
  // Cross-tenant governance (CQ): if the target tenant differs from the
  // source tenant (represented via metadata), explicit authorization is
  // required; otherwise the relationship is rejected.
  const targetTenant = input.metadata?.targetTenant;
  if (targetTenant !== undefined && String(targetTenant) !== String(input.tenantId)) {
    if (!input.crossTenantAuthorized) {
      return { ok: false, error: "Cross-tenant relationship requires explicit governance (CQ)" };
    }
    relationship.targetTenantId = String(targetTenant) as TenantId;
  }
  return { ok: true, relationship };
}

/**
 * Cycle detection (P): DFS over the directed graph of existing
 * relationships of the given type to test whether source -> target
 * would create a cycle.
 */
export function wouldCreateCycle(
  existing: TwinRelationship[],
  proposed: Pick<AddRelationshipInput, "sourceTwinId" | "targetTwinId">,
  type: TwinRelationshipType,
): boolean {
  const adjacency = new Map<string, string[]>();
  for (const r of existing) {
    if (r.type !== type) {
      continue;
    }
    const from = r.sourceTwinId;
    const to = r.targetTwinId;
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from)!.push(to);
  }
  const start = proposed.targetTwinId;
  const goal = proposed.sourceTwinId;
  const visited = new Set<string>();
  const stack: string[] = [start];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node === goal) {
      return true;
    }
    if (visited.has(node)) {
      continue;
    }
    visited.add(node);
    for (const next of adjacency.get(node) ?? []) {
      stack.push(next);
    }
  }
  return false;
}

/* ─────────────────────────────────────────────────────────────
 * Graph queries (O, BJ)
 * ────────────────────────────────────────────────────────────*/

/**
 * Traverse the graph from a start twin following the given relationship
 * types, returning reachable twin IDs in traversal order.
 */
export function traverseGraph(
  relationships: TwinRelationship[],
  startTwinId: string,
  types: TwinRelationshipType[],
  direction: "outgoing" | "incoming" = "outgoing",
): string[] {
  const visited = new Set<string>([startTwinId]);
  const result: string[] = [];
  const queue: string[] = [startTwinId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const r of relationships) {
      if (!types.includes(r.type)) {
        continue;
      }
      const next =
        direction === "outgoing" && r.sourceTwinId === current
          ? r.targetTwinId
          : direction === "incoming" && r.targetTwinId === current
            ? r.sourceTwinId
            : null;
      if (next !== null && !visited.has(next)) {
        visited.add(next);
        result.push(next);
        queue.push(next);
      }
    }
  }
  return result;
}

export function findDependencies(
  relationships: TwinRelationship[],
  twinId: string,
): TwinRelationship[] {
  return relationships.filter(
    (r) => r.type === "depends_on" && (r.sourceTwinId === twinId || r.targetTwinId === twinId),
  );
}

export function isDanglingReference(
  relationship: TwinRelationship,
  knownTwinIds: Set<string>,
): boolean {
  return (
    !knownTwinIds.has(relationship.sourceTwinId) || !knownTwinIds.has(relationship.targetTwinId)
  );
}

/* ─────────────────────────────────────────────────────────────
 * Spatial model (Q, R, S)
 * ────────────────────────────────────────────────────────────*/

export type CoordinateSystem = "lat_long" | "local" | "building" | "floor" | "3d";

export const COORDINATE_SYSTEMS: readonly CoordinateSystem[] = [
  "lat_long",
  "local",
  "building",
  "floor",
  "3d",
] as const;

export interface SpatialPosition {
  coordinateSystem: CoordinateSystem;
  /** Coordinate values; meaning depends on the system (e.g. [lat, lon]). */
  coordinates: number[];
  metadata: Record<string, string>;
}

export interface SpatialLocation {
  country: string | null;
  region: string | null;
  city: string | null;
  campus: string | null;
  building: string | null;
  floor: string | null;
  room: string | null;
  zone: string | null;
  asset: string | null;
  position: SpatialPosition | null;
}

export const SPATIAL_HIERARCHY = [
  "country",
  "region",
  "city",
  "campus",
  "building",
  "floor",
  "room",
  "zone",
  "asset",
] as const;

/**
 * Validate a spatial location (S): every occupied level implies its
 * ancestors are present (no "room" without a "floor"/"building").
 */
export function isSpatialHierarchyValid(location: SpatialLocation): boolean {
  const levels: Array<keyof SpatialLocation> = [...SPATIAL_HIERARCHY];
  let seenAncestor = true;
  for (const level of levels) {
    const value = location[level] as string | null;
    if (value !== null && !seenAncestor) {
      return false;
    }
    if (value === null) {
      seenAncestor = false;
    }
  }
  return true;
}

/** Coordinate-system metadata must be preserved (R). */
export function createSpatialPosition(
  coordinateSystem: CoordinateSystem,
  coordinates: number[],
  metadata: Record<string, string> = {},
): SpatialPosition {
  return { coordinateSystem, coordinates, metadata };
}
