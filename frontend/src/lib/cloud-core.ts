// ─── CoreGrid Phase 21 — Global Cloud Fabric ─────────────────────────
// cloud-core.ts — Infrastructure identity, intent, provider abstraction,
//                 regions, zones, placement, residency, cloud models
// ──────────────────────────────────────────────────────────────────────

export type InfrastructureId = string & { __brand: "InfrastructureId" };
export type ProviderId = string & { __brand: "ProviderId" };
export type RegionId = string & { __brand: "RegionId" };
export type ZoneId = string & { __brand: "ZoneId" };
export type ClusterId = string & { __brand: "ClusterId" };

// ─── E. Architectural Model / F. Infrastructure Intent ──────────────
export type InfrastructureIntent = {
  readonly compute: { cpu: number; memory: number; gpu?: number };
  readonly storage: { capacity: number; class: string };
  readonly network: { bandwidth: number; latency: number };
  readonly residency: string[];
  readonly availability: number;
  readonly sovereignty: string | null;
};

export type InfrastructurePlan = {
  readonly id: InfrastructureId;
  readonly intent: InfrastructureIntent;
  readonly provider: ProviderId;
  readonly region: RegionId;
  readonly zones: ZoneId[];
  readonly estimatedCost: number;
  readonly status: "pending" | "approved" | "rejected" | "provisioning" | "active" | "failed";
};

// ─── H–K. Provider Abstraction & Adapter Contract ───────────────────
export interface ProviderCapability {
  readonly name: string;
  readonly supported: boolean;
  readonly details: string | null;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly name: string;
  readonly version: string;
  readonly capabilities: ProviderCapability[];
  readonly status: "active" | "deprecated" | "unsupported";
}

// ─── L–M. Cloud Account & Organization Model ────────────────────────
export interface CloudAccount {
  readonly id: string;
  readonly provider: ProviderId;
  readonly accountId: string;
  readonly organization: string;
  readonly environment: "production" | "staging" | "development" | "sandbox";
  readonly status: "active" | "suspended" | "closed";
}

// ─── N–P. Region, Zone & Placement ──────────────────────────────────
export interface Region {
  readonly id: RegionId;
  readonly name: string;
  readonly provider: ProviderId;
  readonly geographicalArea: string;
  readonly sovereign: boolean;
  readonly status: "active" | "restricted" | "retiring";
}

export interface AvailabilityZone {
  readonly id: ZoneId;
  readonly region: RegionId;
  readonly name: string;
  readonly status: "active" | "degraded" | "unavailable";
}

export interface PlacementPolicy {
  readonly name: string;
  readonly strategy: "latency" | "cost" | "residency" | "spread" | "failover";
  readonly constraints: string[];
}

// ─── Q–S. Residency & Sovereign Deployment ──────────────────────────
export interface SovereignDeployment {
  readonly id: string;
  readonly jurisdiction: string;
  readonly provider: ProviderId;
  readonly region: RegionId;
  readonly dataResidency: boolean;
  readonly operationalIndependence: boolean;
  readonly status: "provisioning" | "active" | "degraded" | "failed";
}

// ─── T–X. Cloud Models & Portability ────────────────────────────────
export type CloudDeploymentType =
  "public" | "private" | "hybrid" | "multi" | "sovereign" | "on_premise" | "edge";

export interface CloudDeployment {
  readonly id: string;
  readonly type: CloudDeploymentType;
  readonly providers: ProviderId[];
  readonly primaryRegion: RegionId;
  readonly status: "active" | "degraded" | "failed";
}

export type PortabilityLevel = "none" | "container" | "platform" | "full";

// ─── Y–AC. IaC & Drift ───────────────────────────────────────────────
export interface InfrastructureState {
  readonly id: InfrastructureId;
  readonly desiredState: Record<string, unknown>;
  readonly currentState: Record<string, unknown>;
  readonly driftDetected: boolean;
  readonly lastReconciled: string | null;
  readonly status: "synced" | "drifted" | "reconciling" | "unknown";
}

// ─── AD. Infrastructure Lifecycle ────────────────────────────────────
export type InfrastructureLifecycleStatus =
  "defined" | "provisioning" | "available" | "degraded" | "deprecated" | "decommissioned";

export interface InfrastructureResource {
  readonly id: string;
  readonly type: string;
  readonly provider: ProviderId;
  readonly region: RegionId;
  readonly lifecycleStatus: InfrastructureLifecycleStatus;
  readonly tags: Record<string, string>;
  readonly owner: string;
}

// ─── AH–AO. Compute / Container / Cluster / GPU / Capacity ─────────
export interface ComputeCluster {
  readonly id: ClusterId;
  readonly name: string;
  readonly provider: ProviderId;
  readonly region: RegionId;
  readonly version: string;
  readonly nodeCount: number;
  readonly status: "active" | "degraded" | "unavailable" | "provisioning";
}

export interface NodePool {
  readonly id: string;
  readonly clusterId: ClusterId;
  readonly nodeType: string;
  readonly minNodes: number;
  readonly maxNodes: number;
  readonly currentNodes: number;
  readonly gpuEnabled: boolean;
}

export interface CapacityReservation {
  readonly id: string;
  readonly resourceType: string;
  readonly reservedUnits: number;
  readonly region: RegionId;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly status: "active" | "expired" | "cancelled";
}

// ─── AP–AS. Storage Fabric & Backup ─────────────────────────────────
export interface StorageClass {
  readonly name: string;
  readonly provider: ProviderId;
  readonly durability: number;
  readonly iops: number;
  readonly costPerGB: number;
}

export interface BackupPolicy {
  readonly id: string;
  readonly schedule: string;
  readonly retention: number;
  readonly targetRegion: RegionId | null;
  readonly status: "active" | "paused" | "failed";
}

// ─── AT–AW. Network Fabric ───────────────────────────────────────────
export interface NetworkSegment {
  readonly id: string;
  readonly name: string;
  readonly cidr: string;
  readonly region: RegionId;
  readonly type: "vpc" | "subnet" | "private" | "public" | "isolated";
}

export interface ServiceConnectivity {
  readonly id: string;
  readonly sourceService: string;
  readonly targetService: string;
  readonly protocol: string;
  readonly port: number;
  readonly encryption: boolean;
  readonly status: "active" | "blocked" | "pending";
}

// ─── AX–AY. Edge Fabric ───────────────────────────────────────────────
export interface EdgeLocation {
  readonly id: string;
  readonly name: string;
  readonly region: string;
  readonly provider: ProviderId;
  readonly capabilities: string[];
  readonly status: "active" | "degraded" | "unavailable";
}
// ─── AZ–BF. DR & Failover ──────────────────────────────────────────
export interface DisasterRecoveryPlan {
  readonly id: string;
  readonly rpo: number;
  readonly rto: number;
  readonly primaryRegion: RegionId;
  readonly secondaryRegion: RegionId;
  readonly failoverType: "manual" | "automated" | "supervised";
  readonly status: "tested" | "untested" | "failed";
}

export interface FailoverPolicy {
  readonly id: string;
  readonly priority: number;
  readonly condition: string;
  readonly action: "failover" | "degrade" | "maintain";
  readonly targetRegion: RegionId;
  readonly autoRollback: boolean;
}

// ─── Functions ────────────────────────────────────────────────────────
export function createInfrastructurePlan(params: {
  id: InfrastructureId;
  intent: InfrastructureIntent;
  provider: ProviderId;
  region: RegionId;
  zones: ZoneId[];
  estimatedCost: number;
}): InfrastructurePlan {
  if (params.zones.length === 0) throw new Error("Plan requires at least one availability zone");
  return { ...params, status: "pending" as const };
}

export function approvePlan(plan: InfrastructurePlan): InfrastructurePlan {
  if (plan.status !== "pending") throw new Error("Only pending plans can be approved");
  return { ...plan, status: "approved" as const };
}

export function createRegion(params: {
  id: RegionId;
  name: string;
  provider: ProviderId;
  geographicalArea: string;
  sovereign?: boolean;
}): Region {
  if (!params.id || !params.name) throw new Error("Region requires id and name");
  return { ...params, status: "active" as const, sovereign: params.sovereign ?? false };
}

export function registerProvider(params: {
  id: ProviderId;
  name: string;
  version: string;
  capabilities: ProviderCapability[];
}): ProviderAdapter {
  if (params.capabilities.length === 0)
    throw new Error("Provider must have at least one capability");
  return { ...params, status: "active" as const };
}

export function createDeployment(params: {
  id: string;
  type: CloudDeploymentType;
  providers: ProviderId[];
  primaryRegion: RegionId;
}): CloudDeployment {
  if (params.providers.length === 0) throw new Error("Deployment must have at least one provider");
  return { ...params, status: "active" as const };
}

export function createDisasterRecoveryPlan(params: {
  id: string;
  rpo: number;
  rto: number;
  primaryRegion: RegionId;
  secondaryRegion: RegionId;
  failoverType: DisasterRecoveryPlan["failoverType"];
}): DisasterRecoveryPlan {
  if (params.rpo <= 0) throw new Error("RPO must be positive");
  if (params.rto <= 0) throw new Error("RTO must be positive");
  return { ...params, status: "untested" as const };
}

export function detectDrift(
  current: Record<string, unknown>,
  desired: Record<string, unknown>,
): boolean {
  const sortKey = (o: Record<string, unknown>): string =>
    JSON.stringify(
      Object.keys(o)
        .sort()
        .reduce((acc: Record<string, unknown>, k) => {
          acc[k] = o[k];
          return acc;
        }, {}),
    );
  return sortKey(current) !== sortKey(desired);
}
