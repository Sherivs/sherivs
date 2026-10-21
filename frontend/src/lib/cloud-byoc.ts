import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

// ─── Sherivs Phase 21 — Global Cloud Fabric ─────────────────────────
// cloud-byoc.ts — Bring Your Own Cloud: registration, trust, credentials,
//                 networking, storage, encryption, observability
// ──────────────────────────────────────────────────────────────────────

export type BYOCDeploymentId = string & { __brand: "BYOCDeploymentId" };

// ─── DA–DC. BYOC Principle & Supported Models ────────────────────────
export type BYOCModel =
  "customer_managed" | "sherivs_managed" | "shared_management" | "air_gapped" | "hybrid";

export interface BYOCDeployment {
  readonly id: BYOCDeploymentId;
  readonly customerId: string;
  readonly model: BYOCModel;
  readonly provider: string;
  readonly region: string;
  readonly status:
    "registered" | "trust_establishing" | "active" | "degraded" | "disconnected" | "revoked";
}

// ─── DD–DE. BYOC Registration & Trust ────────────────────────────────
export interface BYOCRegistration {
  readonly deploymentId: BYOCDeploymentId;
  readonly customerOrg: string;
  readonly iamRole: string;
  readonly externalId: string;
  readonly registeredAt: string;
  readonly status: "pending" | "verified" | "failed";
}

export interface BYOCTrust {
  readonly deploymentId: BYOCDeploymentId;
  readonly oidcIssuer: string;
  readonly certificateThumbprint: string;
  readonly establishedAt: string;
  readonly expiresAt: string | null;
  readonly status: "active" | "expired" | "revoked";
}

// ─── DG–DK. BYOC Permission Manifest ────────────────────────────────
export interface BYOCPermissionManifest {
  readonly deploymentId: BYOCDeploymentId;
  readonly requiredPermissions: string[];
  readonly actualPermissions: string[];
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly status: "pending" | "approved" | "rejected" | "superseded";
}

// ─── DL–DO. BYOC Networking ───────────────────────────────────────────
export interface BYOCNetworkConfig {
  readonly deploymentId: BYOCDeploymentId;
  readonly vpcId: string;
  readonly subnetIds: string[];
  readonly cidrBlocks: string[];
  readonly networkType: "customer_managed" | "sherivs_managed" | "shared";
  readonly privateOnly: boolean;
  readonly encryptionRequired: boolean;
}

// ─── DP–DR. BYOC Storage & Encryption ──────────────────────────────
export interface BYOCStorageConfig {
  readonly deploymentId: BYOCDeploymentId;
  readonly storageClass: string;
  readonly encryptionAtRest: boolean;
  readonly customerManagedKeys: boolean;
  readonly keyManagementSystem: string | null;
}

export interface BYOCCustomerKey {
  readonly id: string;
  readonly deploymentId: BYOCDeploymentId;
  readonly keyArn: string;
  readonly keyType: "kms" | "hsm" | "external";
  readonly status: "active" | "rotated" | "compromised" | "retired";
}

// ─── DS–DW. BYOC Observability ──────────────────────────────────────
export interface BYOCObservabilityConfig {
  readonly deploymentId: BYOCDeploymentId;
  readonly logDelivery: "customer" | "sherivs" | "both";
  readonly monitoringRole: string | null;
  readonly metricsEnabled: boolean;
  readonly alertsEnabled: boolean;
}

// ─── DZ–EC. BYOC Lifecycle: Upgrades, Revocation ────────────────────
export interface BYOCUpgrade {
  readonly id: string;
  readonly deploymentId: BYOCDeploymentId;
  readonly targetVersion: string;
  readonly approvedBy: string | null;
  readonly approvalRequired: boolean;
  readonly status: "pending" | "approved" | "in_progress" | "completed" | "failed" | "rolled_back";
}

export interface BYOCRevocation {
  readonly id: string;
  readonly deploymentId: BYOCDeploymentId;
  readonly reason: string;
  readonly authorizedBy: string;
  readonly initiatedAt: string;
  readonly dataExportRequired: boolean;
  readonly status: "initiated" | "exporting" | "cleaning" | "completed";
}

// ─── EF–EI. BYOC DR & Health ────────────────────────────────────────
export interface BYOCDisasterRecovery {
  readonly deploymentId: BYOCDeploymentId;
  readonly plan: string | null;
  readonly rpo: number | null;
  readonly rto: number | null;
  readonly crossRegion: boolean;
  readonly status: "configured" | "untested" | "tested" | "failed";
}

export interface BYOCHealth {
  readonly deploymentId: BYOCDeploymentId;
  readonly controlPlaneConnected: boolean;
  readonly agentHealthy: boolean;
  readonly lastHeartbeat: string | null;
  readonly status: "healthy" | "degraded" | "unreachable" | "unknown";
}

// ─── EM–EN. BYOC Air-Gapped & Supply Chain ───────────────────────────
export interface BYOCAirGappedConfig {
  readonly deploymentId: BYOCDeploymentId;
  readonly internetAccess: boolean;
  readonly privateRegistry: string | null;
  readonly syncSchedule: string | null;
  readonly allowedImages: string[];
}

export interface BYOCSupplyChain {
  readonly deploymentId: BYOCDeploymentId;
  readonly imageRegistry: string;
  readonly imageSigningRequired: boolean;
  readonly sbomRequired: boolean;
  readonly vulnerabilityScanning: boolean;
}
// ─── Functions ────────────────────────────────────────────────────────
export function registerBYOC(params: {
  id: BYOCDeploymentId;
  customerId: string;
  model: BYOCModel;
  provider: string;
  region: string;
}): BYOCDeployment {
  if (!params.id || !params.customerId) throw new Error("BYOC requires id and customer");
  return { ...params, status: "registered" as const };
}

export function establishTrust(params: {
  deploymentId: BYOCDeploymentId;
  oidcIssuer: string;
  certificateThumbprint: string;
  expiresAt?: string;
}): BYOCTrust {
  if (!params.oidcIssuer) throw new Error("Trust requires OIDC issuer");
  return {
    deploymentId: params.deploymentId,
    oidcIssuer: params.oidcIssuer,
    certificateThumbprint: params.certificateThumbprint,
    establishedAt: timeAuthority.now().at,
    expiresAt: params.expiresAt ?? null,
    status: "active" as const,
  };
}

export function createPermissionManifest(params: {
  deploymentId: BYOCDeploymentId;
  requiredPermissions: string[];
  actualPermissions: string[];
  approvedBy: string;
}): BYOCPermissionManifest {
  if (params.requiredPermissions.length === 0)
    throw new Error("Manifest requires at least one permission");
  return {
    deploymentId: params.deploymentId,
    requiredPermissions: params.requiredPermissions,
    actualPermissions: params.actualPermissions,
    approvedBy: params.approvedBy,
    approvedAt: timeAuthority.now().at,
    status: "approved" as const,
  };
}

export function revokeBYOC(params: {
  deploymentId: BYOCDeploymentId;
  reason: string;
  authorizedBy: string;
  dataExportRequired?: boolean;
}): BYOCRevocation {
  if (!params.reason) throw new Error("Revocation requires a reason");
  return {
    id: `REV-${params.deploymentId}`,
    deploymentId: params.deploymentId,
    reason: params.reason,
    authorizedBy: params.authorizedBy,
    initiatedAt: timeAuthority.now().at,
    dataExportRequired: params.dataExportRequired ?? true,
    status: "initiated" as const,
  };
}

export function checkBYOCHealth(
  deployment: BYOCDeployment,
  controlPlaneConnected: boolean,
  agentHealthy: boolean,
): BYOCHealth {
  const status =
    controlPlaneConnected && agentHealthy
      ? ("healthy" as const)
      : controlPlaneConnected
        ? ("degraded" as const)
        : ("unknown" as const);
  return {
    deploymentId: deployment.id,
    controlPlaneConnected,
    agentHealthy,
    lastHeartbeat: timeAuthority.now().at,
    status,
  };
}
