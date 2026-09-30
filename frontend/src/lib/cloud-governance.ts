// ─── CoreGrid Phase 21 — Global Cloud Fabric ─────────────────────────
// cloud-governance.ts — Observability, SLOs, cost, security, compliance,
//                       CI/CD, policy-as-code, infra agents, control plane
// ──────────────────────────────────────────────────────────────────────

import type { RegionId } from "./cloud-core";

// ─── BH–BN. Infrastructure Observability & Incident Management ──────
export interface InfrastructureHealth {
  readonly componentId: string;
  readonly componentName: string;
  readonly status: "healthy" | "degraded" | "unhealthy" | "unknown";
  readonly lastChecked: string;
  readonly details: string | null;
}

export interface InfraSLO {
  readonly id: string;
  readonly serviceName: string;
  readonly target: number;
  readonly measurementPeriod: string;
  readonly currentValue: number | null;
  readonly errorBudget: number | null;
  readonly breaches: number;
}

export interface InfraAlert {
  readonly id: string;
  readonly componentId: string;
  readonly severity: "critical" | "high" | "medium" | "low";
  readonly message: string;
  readonly firedAt: string;
  readonly acknowledgedAt: string | null;
  readonly status: "firing" | "acknowledged" | "resolved";
}

export interface InfraIncident {
  readonly id: string;
  readonly alertId: string;
  readonly severity: string;
  readonly affectedComponents: string[];
  readonly runbookRef: string | null;
  readonly status: "detected" | "investigating" | "mitigating" | "resolved" | "post_mortem";
  readonly resolvedAt: string | null;
}

export interface InfraRunbook {
  readonly id: string;
  readonly title: string;
  readonly steps: string[];
  readonly category: "incident" | "deployment" | "recovery" | "maintenance";
  readonly tested: boolean;
}

// ─── BP–BT. Cloud Cost & FinOps ─────────────────────────────────────
export interface CloudCostVisibility {
  readonly provider: string;
  readonly period: string;
  readonly totalCost: number;
  readonly breakdown: { service: string; cost: number }[];
  readonly currency: string;
}

export interface CostAllocation {
  readonly id: string;
  readonly costCenter: string;
  readonly budget: number;
  readonly actual: number;
  readonly period: string;
}

export interface CostOptimization {
  readonly id: string;
  readonly resourceId: string;
  readonly recommendation: string;
  readonly estimatedSavings: number;
  readonly risk: "low" | "medium" | "high";
  readonly status: "identified" | "approved" | "implemented" | "rejected";
}

// ─── BZ–CD. Cloud Security, Secrets & Break-Glass ──────────────────
export interface CloudSecretReference {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly secretType: "api_key" | "credential" | "certificate" | "token";
  readonly rotatedAt: string | null;
  readonly expiresAt: string | null;
  readonly status: "active" | "expired" | "compromised" | "rotated";
}

export interface BreakGlassAccess {
  readonly id: string;
  readonly infrastructureId: string;
  readonly requester: string;
  readonly approver: string | null;
  readonly reason: string;
  readonly duration: number;
  readonly status: "requested" | "approved" | "active" | "expired" | "revoked";
  readonly expiresAt: string | null;
}
// ─── CJ–CK. Infrastructure Events ────────────────────────────────────
export interface InfraEvent {
  readonly id: string;
  readonly source: string;
  readonly type: string;
  readonly severity: "info" | "warning" | "error" | "critical";
  readonly message: string;
  readonly timestamp: string;
  readonly correlationId: string | null;
}

// ─── CM–CR. Infrastructure Policy & Compliance ─────────────────────
export interface InfraPolicy {
  readonly id: string;
  readonly name: string;
  readonly category: "security" | "cost" | "compliance" | "operations";
  readonly rules: string[];
  readonly enforcement: "hard" | "soft" | "advisory";
  readonly status: "active" | "deprecated" | "superseded";
  readonly version: number;
}

export interface PolicyViolation {
  readonly id: string;
  readonly policyId: string;
  readonly resourceId: string;
  readonly violation: string;
  readonly detectedAt: string;
  readonly status: "open" | "acknowledged" | "remediated" | "waived";
}

// ─── CT–CZ. Deployment, Migration & Cloud Exit ──────────────────────
export interface InfraDeployment {
  readonly id: string;
  readonly targetEnvironment: string;
  readonly version: string;
  readonly strategy: "rolling" | "blue_green" | "canary" | "recreate";
  readonly status: "pending" | "in_progress" | "completed" | "failed" | "rolled_back";
}

export interface CloudMigration {
  readonly id: string;
  readonly sourceProvider: string;
  readonly targetProvider: string;
  readonly resources: string[];
  readonly strategy: "lift_shift" | "replatform" | "refactor" | "retire";
  readonly status: "planned" | "in_progress" | "completed" | "failed" | "rolled_back";
}

export interface CloudExitPlan {
  readonly id: string;
  readonly provider: string;
  readonly dataExportRequired: boolean;
  readonly dataExportFormat: string | null;
  readonly timeline: string | null;
  readonly status: "draft" | "approved" | "in_progress" | "completed";
}

// ─── FH–FL. Autonomous Infrastructure & Kill Switch ──────────────────
export type InfraAutonomyLevel =
  "manual" | "supervised" | "semi_automated" | "fully_automated" | "autonomous";

export interface InfraKillSwitch {
  readonly id: string;
  readonly name: string;
  readonly targets: string[];
  readonly authorizedBy: string[];
  readonly status: "armed" | "disarmed" | "triggered";
}

// ─── FM–FR. Change Audit & Blast Radius ──────────────────────────────
export interface InfraChangeRecord {
  readonly id: string;
  readonly resourceId: string;
  readonly changeType: string;
  readonly previousState: string;
  readonly newState: string;
  readonly changedBy: string;
  readonly changedAt: string;
  readonly approvalRef: string | null;
}

export interface BlastRadius {
  readonly resourceId: string;
  readonly dependencies: string[];
  readonly dependents: string[];
  readonly riskScore: number;
}

// ─── FS–FU. Test Environments & Leak Detection ──────────────────────
export interface InfraTestEnvironment {
  readonly id: string;
  readonly name: string;
  readonly type: "ephemeral" | "persistent" | "shared";
  readonly expiresAt: string | null;
  readonly status: "provisioning" | "available" | "expired" | "decommissioning";
}

export interface ResourceLeakDetection {
  readonly id: string;
  readonly resourceId: string;
  readonly reason: string;
  readonly detectedAt: string;
  readonly status: "detected" | "investigating" | "cleaned" | "resolved";
}

// ─── FZ–GC. Global Topology & DNS ────────────────────────────────────
export interface GlobalInfraTopology {
  readonly id: string;
  readonly provider: string;
  readonly region: string;
  readonly services: string[];
  readonly connections: { source: string; target: string; type: string }[];
  readonly lastUpdated: string;
}

export interface GlobalDNS {
  readonly domain: string;
  readonly recordType: string;
  readonly value: string;
  readonly ttl: number;
  readonly provider: string;
  readonly status: "active" | "pending" | "failed";
}

// ─── GJ–GN. Compliance & Security Posture ────────────────────────────
export interface CloudSecurityPosture {
  readonly id: string;
  readonly provider: string;
  readonly score: number;
  readonly findings: { severity: string; description: string }[];
  readonly lastScanned: string;
  readonly status: "compliant" | "non_compliant" | "partial";
}

export interface VulnerabilityFinding {
  readonly id: string;
  readonly resourceId: string;
  readonly cve: string;
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly fixAvailable: boolean;
  readonly status: "open" | "fixing" | "fixed" | "accepted";
}

// ─── GO–GP. Policy-as-Code ────────────────────────────────────────────
export interface PolicyAsCode {
  readonly id: string;
  readonly name: string;
  readonly engine: string;
  readonly source: string;
  readonly version: string;
  readonly validatedAt: string | null;
  readonly status: "valid" | "invalid" | "unknown";
}

// ─── HC–HF. Global Health & Autonomy ──────────────────────────────────
export interface GlobalCloudFabricHealth {
  readonly status: "operational" | "degraded" | "major_outage" | "partial_outage";
  readonly regions: { region: string; status: string }[];
  readonly lastUpdated: string;
  readonly incidents: number;
}

// ─── HK–HN. Control Plane Model ──────────────────────────────────────
export interface ControlPlane {
  readonly id: string;
  readonly name: string;
  readonly type: "management" | "regional" | "edge";
  readonly status: "active" | "degraded" | "failed";
  readonly region: RegionId;
  readonly endpoints: string[];
}

export interface InfrastructureRequest {
  readonly id: string;
  readonly requester: string;
  readonly intent: string;
  readonly priority: "low" | "medium" | "high" | "critical";
  readonly status: "submitted" | "planning" | "approved" | "executing" | "completed" | "failed";
  readonly result: string | null;
}
