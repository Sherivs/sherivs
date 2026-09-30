/**
 * CoreGrid — Data Platform lineage, retention, archival, masking,
 * pseudonymization, query governance, and residency (Phase 14, Sections AK,
 * AL, AW, BA, BG, BH, BK, BN, BU).
 *
 * Implements `architecture/phase-14-data-platform.md`:
 * - Data lineage (AK, AL): source-to-target tracing, transformation
 *   lineage, dependency graph, pipeline version, dataset version.
 * - Conflict resolution (AW): strategies must be explicit — source-of-truth
 *   precedence, version precedence, timestamp policy, human review,
 *   deterministic merge. Never silently overwrite conflicting authoritative
 *   data.
 * - Query governance (BA): protect against unbounded queries, accidental
 *   full-table scans, cross-tenant queries, sensitive-field exposure,
 *   excessive analytical workloads.
 * - Data masking (BG): mask sensitive data in logs, development
 *   environments, analytics, support tooling.
 * - Pseudonymization (BH): separate identity from the analytical identifier.
 * - Retention (BK) and archival (BN): retention depends on legal, domain,
 *   operational, analytical, and privacy requirements; archive cold data to
 *   lower-cost storage while preserving integrity and provenance.
 * - Data residency (BU): some data must remain within specific jurisdictions;
 *   residency requirements are represented in data policies.
 *
 * Boundaries: this module defines governance contracts; storage and pipeline
 * execution remain infrastructure concerns.
 */

import type { TenantId } from "./tenant-core";
import type { DataClassification } from "./data-core";
import { classificationRank } from "./data-core";

/* ─────────────────────────────────────────────────────────────
 * Data lineage (AK, AL)
 * ────────────────────────────────────────────────────────────*/

export type LineageNodeType =
  "source" | "pipeline" | "dataset" | "transformation" | "dashboard" | "model" | "api";

export const LINEAGE_NODE_TYPES: readonly LineageNodeType[] = [
  "source",
  "pipeline",
  "dataset",
  "transformation",
  "dashboard",
  "model",
  "api",
] as const;

export interface LineageNode {
  id: string;
  tenantId: TenantId;
  type: LineageNodeType;
  name: string;
}

export interface LineageEdge {
  id: string;
  tenantId: TenantId;
  fromNodeId: string;
  toNodeId: string;
  pipelineVersion: string | null;
}

export interface CreateLineageNodeInput {
  id: string;
  tenantId: TenantId;
  type: LineageNodeType;
  name: string;
}

export type CreateLineageNodeResult =
  { ok: true; node: LineageNode } | { ok: false; error: string };

export function createLineageNode(input: CreateLineageNodeInput): CreateLineageNodeResult {
  if (input.name.trim() === "") {
    return { ok: false, error: "Lineage node requires a name (AL)" };
  }
  return {
    ok: true,
    node: { id: input.id, tenantId: input.tenantId, type: input.type, name: input.name },
  };
}

export interface CreateLineageEdgeInput {
  id: string;
  tenantId: TenantId;
  fromNodeId: string;
  toNodeId: string;
  pipelineVersion?: string | null;
}

export type CreateLineageEdgeResult =
  { ok: true; edge: LineageEdge } | { ok: false; error: string };

export function createLineageEdge(input: CreateLineageEdgeInput): CreateLineageEdgeResult {
  if (input.fromNodeId === input.toNodeId) {
    return { ok: false, error: "Lineage edges cannot connect a node to itself (AL)" };
  }
  return {
    ok: true,
    edge: {
      id: input.id,
      tenantId: input.tenantId,
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      pipelineVersion: input.pipelineVersion ?? null,
    },
  };
}

/** Trace source-to-target lineage (AL): BFS from the start node across
 * edges, always tenant-scoped. */
export function traceLineage(
  startNodeId: string,
  nodes: LineageNode[],
  edges: LineageEdge[],
  tenantId: TenantId,
): { traced: string[]; terminal: string[] } {
  const nodeIds = new Set(nodes.filter((n) => n.tenantId === tenantId).map((n) => n.id));
  const outbound = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.tenantId !== tenantId) continue;
    const list = outbound.get(edge.fromNodeId) ?? [];
    list.push(edge.toNodeId);
    outbound.set(edge.fromNodeId, list);
  }
  const traced: string[] = [];
  const terminal: string[] = [];
  const visited = new Set<string>();
  const queue = [startNodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    traced.push(current);
    const next = (outbound.get(current) ?? []).filter((n) => nodeIds.has(n));
    if (next.length === 0) {
      terminal.push(current);
    } else {
      queue.push(...next);
    }
  }
  return { traced, terminal };
}

/* ─────────────────────────────────────────────────────────────
 * Conflict resolution (AW)
 * ────────────────────────────────────────────────────────────*/

export type ConflictResolutionStrategy =
  | "source_of_truth_precedence"
  | "version_precedence"
  | "timestamp_policy"
  | "human_review"
  | "deterministic_merge";

export const CONFLICT_RESOLUTION_STRATEGIES: readonly ConflictResolutionStrategy[] = [
  "source_of_truth_precedence",
  "version_precedence",
  "timestamp_policy",
  "human_review",
  "deterministic_merge",
] as const;

export interface ConflictResolutionPolicy {
  tenantId: TenantId;
  datasetName: string;
  strategy: ConflictResolutionStrategy;
  /** For source_of_truth_precedence: which source wins. */
  authoritativeSource: string | null;
  requiresHumanReview: boolean;
}

export interface CreateConflictResolutionPolicyInput {
  tenantId: TenantId;
  datasetName: string;
  strategy: ConflictResolutionStrategy;
  authoritativeSource?: string | null;
  requiresHumanReview?: boolean;
}

export type CreateConflictResolutionPolicyResult =
  { ok: true; policy: ConflictResolutionPolicy } | { ok: false; error: string };

export function createConflictResolutionPolicy(
  input: CreateConflictResolutionPolicyInput,
): CreateConflictResolutionPolicyResult {
  if (
    input.strategy === "source_of_truth_precedence" &&
    (input.authoritativeSource ?? "").trim() === ""
  ) {
    return { ok: false, error: "Source-of-truth precedence requires an authoritative source (AW)" };
  }
  if (input.strategy === "human_review") {
    return {
      ok: true,
      policy: {
        tenantId: input.tenantId,
        datasetName: input.datasetName,
        strategy: input.strategy,
        authoritativeSource: null,
        requiresHumanReview: true,
      },
    };
  }
  return {
    ok: true,
    policy: {
      tenantId: input.tenantId,
      datasetName: input.datasetName,
      strategy: input.strategy,
      authoritativeSource: input.authoritativeSource ?? null,
      requiresHumanReview: input.requiresHumanReview ?? false,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Query governance (BA)
 * ────────────────────────────────────────────────────────────*/

export interface QueryGovernancePolicy {
  tenantId: TenantId;
  maxResultRows: number;
  requireTenantFilter: boolean;
  maxSensitivityExposure: DataClassification;
}

export interface EvaluateQueryInput {
  policy: QueryGovernancePolicy;
  estimatedRows: number;
  hasTenantFilter: boolean;
  exposure: DataClassification;
}

export type QueryGovernanceVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Query governance (BA): protects against unbounded queries, accidental
 * full-table scans, cross-tenant queries, and sensitive-field exposure.
 */
export function evaluateQueryGovernance(input: EvaluateQueryInput): QueryGovernanceVerdict {
  if (input.policy.requireTenantFilter && !input.hasTenantFilter) {
    return { ok: false, reason: "Query requires an explicit tenant filter (BA)" };
  }
  if (input.estimatedRows > input.policy.maxResultRows) {
    return { ok: false, reason: "Query exceeds the maximum result rows (BA)" };
  }
  if (
    classificationRank(input.exposure) > classificationRank(input.policy.maxSensitivityExposure)
  ) {
    return { ok: false, reason: "Query would expose fields above the allowed sensitivity (BA)" };
  }
  return { ok: true };
}

/* ─────────────────────────────────────────────────────────────
 * Data masking (BG) and pseudonymization (BH)
 * ────────────────────────────────────────────────────────────*/

/** Mask a sensitive string value for logs/development/analytics (BG). */
export function maskValue(value: string, visiblePrefix: number, visibleSuffix: number): string {
  if (value.length <= visiblePrefix + visibleSuffix) {
    return "*".repeat(value.length);
  }
  return (
    value.slice(0, visiblePrefix) +
    "*".repeat(value.length - visiblePrefix - visibleSuffix) +
    value.slice(-visibleSuffix)
  );
}

export interface PseudonymizationRegistry {
  identifiers: Map<string, string>;
}

/**
 * Pseudonymization (BH): separate identity from the analytical identifier.
 * The mapping is stored in a controlled registry; analytical data uses only
 * the pseudonym.
 */
export function pseudonymize(identityValue: string, registry: PseudonymizationRegistry): string {
  const existing = registry.identifiers.get(identityValue);
  if (existing) return existing;
  const pseudonym = `pseudo-${Buffer.from(identityValue).toString("base64url").slice(0, 12)}`;
  registry.identifiers.set(identityValue, pseudonym);
  return pseudonym;
}

/* ─────────────────────────────────────────────────────────────
 * Retention (BK) and archival (BN)
 * ────────────────────────────────────────────────────────────*/

export interface RetentionPolicy {
  datasetName: string;
  tenantId: TenantId;
  retentionDays: number;
  legalHold: boolean;
  archivalAfterDays: number | null;
}

export interface CreateRetentionPolicyInput {
  datasetName: string;
  tenantId: TenantId;
  retentionDays: number;
  legalHold?: boolean;
  archivalAfterDays?: number | null;
}

export type CreateRetentionPolicyResult =
  { ok: true; policy: RetentionPolicy } | { ok: false; error: string };

export function createRetentionPolicy(
  input: CreateRetentionPolicyInput,
): CreateRetentionPolicyResult {
  if (input.retentionDays <= 0) {
    return { ok: false, error: "Retention days must be positive (BK)" };
  }
  if (
    input.archivalAfterDays !== null &&
    input.archivalAfterDays !== undefined &&
    input.archivalAfterDays > input.retentionDays
  ) {
    return { ok: false, error: "Archival must occur within the retention period (BN)" };
  }
  return {
    ok: true,
    policy: {
      datasetName: input.datasetName,
      tenantId: input.tenantId,
      retentionDays: input.retentionDays,
      legalHold: input.legalHold ?? false,
      archivalAfterDays: input.archivalAfterDays ?? null,
    },
  };
}

/** A legal hold suspends deletion regardless of retention (BK/BL). */
export function isSubjectToRetention(
  policy: RetentionPolicy,
  ageDays: number,
  nowLegalHoldActive: boolean,
): boolean {
  if (policy.legalHold || nowLegalHoldActive) return true;
  return ageDays < policy.retentionDays;
}

export interface ArchiveRequest {
  datasetName: string;
  tenantId: TenantId;
  archivedAt: string;
  archivedBy: string;
  integrityRef: string;
}

export function createArchiveRequest(
  datasetName: string,
  tenantId: TenantId,
  archivedBy: string,
  integrityRef: string,
  now: string,
): ArchiveRequest {
  return { datasetName, tenantId, archivedAt: now, archivedBy, integrityRef };
}

/* ─────────────────────────────────────────────────────────────
 * Data residency (BU)
 * ────────────────────────────────────────────────────────────*/

export interface ResidencyRequirement {
  datasetName: string;
  tenantId: TenantId;
  /** Jurisdiction codes the data must remain within. */
  allowedJurisdictions: string[];
  prohibitCrossBorderTransfer: boolean;
}

export interface CreateResidencyRequirementInput {
  datasetName: string;
  tenantId: TenantId;
  allowedJurisdictions: string[];
  prohibitCrossBorderTransfer?: boolean;
}

export type CreateResidencyRequirementResult =
  { ok: true; requirement: ResidencyRequirement } | { ok: false; error: string };

export function createResidencyRequirement(
  input: CreateResidencyRequirementInput,
): CreateResidencyRequirementResult {
  if (input.allowedJurisdictions.length === 0) {
    return { ok: false, error: "Residency requires at least one allowed jurisdiction (BU)" };
  }
  return {
    ok: true,
    requirement: {
      datasetName: input.datasetName,
      tenantId: input.tenantId,
      allowedJurisdictions: input.allowedJurisdictions,
      prohibitCrossBorderTransfer: input.prohibitCrossBorderTransfer ?? false,
    },
  };
}

/** Data sovereignty (FO, BU): a transfer is governed when the destination
 * jurisdiction is not allowed or cross-border transfer is prohibited. */
export function isTransferGoverned(
  requirement: ResidencyRequirement,
  destinationJurisdiction: string,
): boolean {
  if (requirement.prohibitCrossBorderTransfer) return true;
  return !requirement.allowedJurisdictions.includes(destinationJurisdiction);
}
