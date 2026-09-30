/**
 * CoreGrid Multi-Tenancy Platform — Tenant Core domain model.
 *
 * Implements `architecture/phase-03-multi-tenancy.md`:
 * - A tenant is an independently governed logical environment within CoreGrid.
 * - Tenant IDs are canonical and stable (Invariant 09).
 * - Tenant names are mutable metadata (Invariant 10).
 * - Identity and tenancy are separate concepts (Invariant 03).
 * - Tenant hierarchy does not automatically grant unrestricted descendant access (Invariant 14).
 */

/* ─────────────────────────────────────────────────────────────
 * Tenant types (A7)
 * ────────────────────────────────────────────────────────────*/

export type TenantType =
  | "educational_institution"
  | "school"
  | "university"
  | "college"
  | "education_network"
  | "government_ministry"
  | "government_agency"
  | "enterprise"
  | "ngo"
  | "research_organization"
  | "partner_organization"
  | "platform_managed"
  | "internal_coregrid";

export const TENANT_TYPES: readonly TenantType[] = [
  "educational_institution",
  "school",
  "university",
  "college",
  "education_network",
  "government_ministry",
  "government_agency",
  "enterprise",
  "ngo",
  "research_organization",
  "partner_organization",
  "platform_managed",
  "internal_coregrid",
] as const;

/* ─────────────────────────────────────────────────────────────
 * Tenant lifecycle status (H2)
 * ────────────────────────────────────────────────────────────*/

export type TenantStatus =
  | "PROVISIONING"
  | "ACTIVE"
  | "RESTRICTED"
  | "SUSPENDED"
  | "MIGRATING"
  | "ARCHIVED"
  | "TERMINATING"
  | "TERMINATED";

export const TENANT_STATUSES: readonly TenantStatus[] = [
  "PROVISIONING",
  "ACTIVE",
  "RESTRICTED",
  "SUSPENDED",
  "MIGRATING",
  "ARCHIVED",
  "TERMINATING",
  "TERMINATED",
] as const;

/** Allowed lifecycle transitions (G3 Tenant Lifecycle Engine). */
export const TENANT_LIFECYCLE_TRANSITIONS: Readonly<Record<TenantStatus, readonly TenantStatus[]>> =
  {
    PROVISIONING: ["ACTIVE", "SUSPENDED", "TERMINATING"],
    ACTIVE: ["RESTRICTED", "SUSPENDED", "MIGRATING", "ARCHIVED", "TERMINATING"],
    RESTRICTED: ["ACTIVE", "SUSPENDED", "TERMINATING"],
    SUSPENDED: ["ACTIVE", "ARCHIVED", "TERMINATING"],
    MIGRATING: ["ACTIVE", "SUSPENDED", "TERMINATING"],
    ARCHIVED: ["ACTIVE", "TERMINATING"],
    TERMINATING: ["TERMINATED", "ACTIVE"],
    TERMINATED: [],
  } as const;

export function canTransitionTenant(from: TenantStatus, to: TenantStatus): boolean {
  return TENANT_LIFECYCLE_TRANSITIONS[from].includes(to);
}

/* ─────────────────────────────────────────────────────────────
 * Tenant entity (H1)
 * ────────────────────────────────────────────────────────────*/

export type TenantId = string & { readonly __brand: "TenantId" };

export function tenantId(raw: string): TenantId {
  return raw as TenantId;
}

export interface CoreGridTenant {
  /** Canonical, immutable tenant ID (Invariant 09). */
  id: TenantId;
  type: TenantType;
  /** Mutable display name (Invariant 10). */
  name: string;
  status: TenantStatus;
  /** Optional parent tenant (topology). */
  parentTenantId: TenantId | null;
  /** Deployment region. */
  region: string;
  /** Runtime environment. */
  environment: "production" | "staging" | "test" | "development";
  /** Phase 02 identity reference for the tenant owner. */
  ownerIdentityId: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────────────────────────────────────────────────
 * Tenant context contract (F2)
 * ────────────────────────────────────────────────────────────*/

export type TenantScope =
  | { kind: "tenant"; tenantId: TenantId }
  | { kind: "platform_scope" }
  | { kind: "public_scope" }
  | { kind: "cross_tenant_scope"; tenantIds: TenantId[] };

export interface TenantContext {
  tenantId: TenantId | null;
  actorId: string | null;
  requestId: string | null;
  region: string | null;
  environment: string | null;
  /** Derived or verified — never blindly trusted from client (Invariant 02). */
  source: "derived" | "verified" | "platform";
}

/* ─────────────────────────────────────────────────────────────
 * Tenant resource contract (F5)
 * ────────────────────────────────────────────────────────────*/

export interface TenantResource {
  resourceId: string;
  tenantId: TenantId;
  resourceType: string;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────────────────────────────────────────────────
 * Data classification (H22)
 * ────────────────────────────────────────────────────────────*/

export type DataClassification =
  "PUBLIC" | "TENANT_INTERNAL" | "CONFIDENTIAL" | "SENSITIVE" | "RESTRICTED";

export const DATA_CLASSIFICATIONS: readonly DataClassification[] = [
  "PUBLIC",
  "TENANT_INTERNAL",
  "CONFIDENTIAL",
  "SENSITIVE",
  "RESTRICTED",
] as const;

export function classificationRank(c: DataClassification): number {
  switch (c) {
    case "PUBLIC":
      return 0;
    case "TENANT_INTERNAL":
      return 1;
    case "CONFIDENTIAL":
      return 2;
    case "SENSITIVE":
      return 3;
    case "RESTRICTED":
      return 4;
  }
}

/* ─────────────────────────────────────────────────────────────
 * Tenant event contract (F8)
 * ────────────────────────────────────────────────────────────*/

export type TenantEventType =
  | "TenantCreated"
  | "TenantProvisioned"
  | "TenantActivated"
  | "TenantSuspended"
  | "TenantMigrated"
  | "TenantArchived"
  | "TenantTerminated";

export interface TenantEvent {
  id: string;
  type: TenantEventType;
  tenantId: TenantId;
  actorId: string | null;
  occurredAt: string;
  result: "success" | "failure" | "partial";
  metadata: Record<string, unknown>;
}

/* ─────────────────────────────────────────────────────────────
 * Tenant configuration (H3 + Q)
 * ────────────────────────────────────────────────────────────*/

export interface TenantConfiguration {
  tenantId: TenantId;
  version: number;
  localization: {
    timezone: string;
    locale: string;
  };
  features: Record<string, boolean>;
  integrationRefs: string[];
  operationalPreferences: Record<string, string | number | boolean>;
  updatedAt: string;
}

/* ─────────────────────────────────────────────────────────────
 * Tenant entitlement (H4 + O)
 * ────────────────────────────────────────────────────────────*/

export type TenantCapability =
  | "AI"
  | "Analytics"
  | "Automation"
  | "Marketplace"
  | "DeveloperAPIs"
  | "AdvancedHardware"
  | "EnterpriseFeatures";

export const TENANT_CAPABILITIES: readonly TenantCapability[] = [
  "AI",
  "Analytics",
  "Automation",
  "Marketplace",
  "DeveloperAPIs",
  "AdvancedHardware",
  "EnterpriseFeatures",
] as const;

export interface TenantEntitlement {
  tenantId: TenantId;
  capability: TenantCapability;
  status: "enabled" | "disabled" | "expired";
  effectiveFrom: string;
  effectiveUntil: string | null;
}

/* ─────────────────────────────────────────────────────────────
 * Tenant quota (H5 + P)
 * ────────────────────────────────────────────────────────────*/

export type QuotaResource =
  | "storage"
  | "compute"
  | "api_requests"
  | "ai_inference"
  | "agent_execution"
  | "messaging"
  | "database_capacity"
  | "file_storage";

export const QUOTA_RESOURCES: readonly QuotaResource[] = [
  "storage",
  "compute",
  "api_requests",
  "ai_inference",
  "agent_execution",
  "messaging",
  "database_capacity",
  "file_storage",
] as const;

export interface TenantQuota {
  tenantId: TenantId;
  resource: QuotaResource;
  limit: number;
  currentUsage: number;
  period: "daily" | "monthly" | "lifetime";
  /** Soft quota threshold (0..1 fraction of limit). */
  softThreshold: number;
}

/* ─────────────────────────────────────────────────────────────
 * Tenant topology (H8 + R)
 * ────────────────────────────────────────────────────────────*/

export type TopologyRelation = "parent" | "child" | "peer" | "regional" | "federated";

export interface TenantTopologyEdge {
  fromTenantId: TenantId;
  toTenantId: TenantId;
  relation: TopologyRelation;
  /** Explicit authorization required for cross-tenant access (Invariant 07). */
  authorized: boolean;
  createdAt: string;
}

/* ─────────────────────────────────────────────────────────────
 * Tenant migration record (H9)
 * ────────────────────────────────────────────────────────────*/

export type MigrationStatus =
  | "PLANNED"
  | "VALIDATING"
  | "SNAPSHOTTING"
  | "COPYING"
  | "VERIFYING"
  | "SWITCHING"
  | "COMPLETED"
  | "ROLLED_BACK"
  | "FAILED";

export interface TenantMigrationRecord {
  migrationId: string;
  tenantId: TenantId;
  source: string;
  destination: string;
  status: MigrationStatus;
  startedAt: string;
  completedAt: string | null;
  rollbackState: string | null;
}

/* ─────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────*/

/** Invariant 01: Every tenant-owned resource must have a determinable tenant boundary. */
export function hasTenantBoundary(resource: Pick<TenantResource, "tenantId">): boolean {
  return resource.tenantId.length > 0;
}

/** Invariant 05: Tenant isolation applies to synchronous and asynchronous operations. */
export function isTenantUsable(tenant: Pick<CoreGridTenant, "status">): boolean {
  return tenant.status === "ACTIVE" || tenant.status === "RESTRICTED";
}

/** Invariant 14: Tenant hierarchy does not automatically grant unrestricted descendant access. */
export function hierarchyGrantsAccess(edge: TenantTopologyEdge): boolean {
  return edge.authorized === true;
}
