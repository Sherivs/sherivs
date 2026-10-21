/**
 * Sherivs Developer Platform — developer governance domain.
 *
 * Implements `architecture/phase-28-developer-platform.md`:
 * - Developer quotas (CA): API calls, storage, compute, sandbox usage, AI
 *   inference, event volume. Rate limit testing (CB). Failure simulation (CC):
 *   timeout, network failure, API failure, dependency failure, authorization
 *   failure, quota exhaustion.
 * - Developer observability (BX-BY): logs, metrics, traces, errors, deployment
 *   events, API usage; debugging without exposing protected production data.
 * - African developer ecosystem (49): documentation, tutorials, examples,
 *   low-cost sandbox tiers, localized resources, regional support. Educational
 *   developer program (CH). Open source (CI).
 * - Documentation platform (CK-CM): guides, API reference, tutorials,
 *   architecture, examples, troubleshooting, migration guides, security guidance;
 *   versioned; examples tested automatically. Developer learning (CN).
 * - Developer AI assistant (CO-CP): API discovery, code generation, debugging,
 *   architecture explanation, migration, test generation, documentation — must
 *   not automatically deploy destructive production changes.
 * - Project audit (CT): project creation, membership changes, credential
 *   creation, deployments, releases, publishing, security events.
 * - Governance gates (FF): Code → Tests → Security → Compatibility → Policy →
 *   Approval → Release. Release approval (FA): high-risk products require
 *   manual approval. Marketplace submission (FG): one-click/API submission to
 *   Phase 27. Marketplace feedback (FH), certification (FI), artifacts (FJ).
 * - Developer exit (FT-FU): export project metadata/artifacts; retain source
 *   ownership; avoid lock-in.
 * - Dependency policy (EQ-ER): organizations restrict dependencies; approved
 *   dependency registries. Artifact registry (EU-EW). Compatibility matrix
 *   (EY-EZ). Policy-as-code (FB-FC), compliance-as-code (FE).
 */

import type { TenantId } from "./tenant-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type DevQuotaId = string & { readonly __brand: "DevQuotaId" };
export type DevAuditEventId = string & { readonly __brand: "DevAuditEventId" };
export type DevCertificationId = string & { readonly __brand: "DevCertificationId" };

export function devQuotaId(raw: string): DevQuotaId {
  return raw as DevQuotaId;
}
export function devAuditEventId(raw: string): DevAuditEventId {
  return raw as DevAuditEventId;
}
export function devCertificationId(raw: string): DevCertificationId {
  return raw as DevCertificationId;
}

/* ─────────────────────────────────────────────────────────────
 * Developer quotas (Section CA) + rate limit testing (CB)
 * ────────────────────────────────────────────────────────────*/

export type DevQuotaKind =
  "api_calls" | "storage" | "compute" | "sandbox_usage" | "ai_inference" | "event_volume";

export const DEV_QUOTA_KINDS: readonly DevQuotaKind[] = [
  "api_calls",
  "storage",
  "compute",
  "sandbox_usage",
  "ai_inference",
  "event_volume",
] as const;

export interface DevQuota {
  id: DevQuotaId;
  projectRef: string;
  kind: DevQuotaKind;
  limit: number;
  used: number;
  windowRef: string;
}

export function consumeDevQuota(
  quota: DevQuota,
  amount: number,
): { ok: true; quota: DevQuota } | { ok: false; error: string } {
  if (quota.used + amount > quota.limit) {
    return { ok: false, error: `Developer quota exhausted for ${quota.kind} (Section CA)` };
  }
  return { ok: true, quota: { ...quota, used: quota.used + amount } };
}

/**
 * Rate limit testing (Section CB): developers test behavior under rate limits.
 * Returns the allowed/exceeded decision for the current burst.
 */
export function evaluateRateLimitBehavior(
  requestsInWindow: number,
  limit: number,
): { allowed: boolean; exceeded: boolean } {
  return { allowed: requestsInWindow <= limit, exceeded: requestsInWindow > limit };
}

/* ─────────────────────────────────────────────────────────────
 * Failure simulation (Section CC)
 * ────────────────────────────────────────────────────────────*/

export type FailureSimulationKind =
  | "timeout"
  | "network_failure"
  | "api_failure"
  | "dependency_failure"
  | "authorization_failure"
  | "quota_exhaustion";

export const FAILURE_SIMULATION_KINDS: readonly FailureSimulationKind[] = [
  "timeout",
  "network_failure",
  "api_failure",
  "dependency_failure",
  "authorization_failure",
  "quota_exhaustion",
] as const;

/** Failure injection is permitted only in non-production environments (CC). */
export function canInjectFailure(environmentKind: string): boolean {
  return environmentKind !== "production";
}

/* ─────────────────────────────────────────────────────────────
 * Developer observability (BX, BY)
 * ────────────────────────────────────────────────────────────*/

export interface DevTelemetryEvent {
  projectRef: string;
  environmentKind: string;
  kind: "log" | "metric" | "trace" | "error" | "deployment" | "api_usage";
  /** Must not expose protected production data (Section BY). */
  sanitized: boolean;
  occurredAt: string;
}

export function recordDevTelemetry(input: {
  projectRef: string;
  environmentKind: string;
  kind: DevTelemetryEvent["kind"];
  sanitized?: boolean;
  now?: string;
}): DevTelemetryEvent {
  return {
    projectRef: input.projectRef,
    environmentKind: input.environmentKind,
    kind: input.kind,
    sanitized: input.sanitized ?? true,
    occurredAt: input.now ?? timeAuthority.now().at,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Project audit (CT)
 * ────────────────────────────────────────────────────────────*/

export type DevAuditEventType =
  | "project_created"
  | "membership_changed"
  | "credential_created"
  | "deployment"
  | "release"
  | "publishing"
  | "security_event";

export const DEV_AUDIT_EVENT_TYPES: readonly DevAuditEventType[] = [
  "project_created",
  "membership_changed",
  "credential_created",
  "deployment",
  "release",
  "publishing",
  "security_event",
] as const;

export interface DevAuditEvent {
  id: DevAuditEventId;
  tenantId: TenantId;
  projectRef: string;
  type: DevAuditEventType;
  actorRef: string;
  occurredAt: string;
  metadata: Record<string, string | number | boolean | null>;
}

export function recordDevAuditEvent(input: {
  id: DevAuditEventId;
  tenantId: TenantId;
  projectRef: string;
  type: DevAuditEventType;
  actorRef: string;
  metadata?: Record<string, string | number | boolean | null>;
  now?: string;
}): DevAuditEvent {
  return {
    id: input.id,
    tenantId: input.tenantId,
    projectRef: input.projectRef,
    type: input.type,
    actorRef: input.actorRef,
    occurredAt: input.now ?? timeAuthority.now().at,
    metadata: input.metadata ?? {},
  };
}

/* ─────────────────────────────────────────────────────────────
 * Governance gates (FF) + release approval (FA)
 * ────────────────────────────────────────────────────────────*/

export type GovernanceGate =
  "code" | "tests" | "security" | "compatibility" | "policy" | "approval" | "release";

export const GOVERNANCE_GATES: readonly GovernanceGate[] = [
  "code",
  "tests",
  "security",
  "compatibility",
  "policy",
  "approval",
  "release",
] as const;

/**
 * Governance gates (Section FF): a production release passes only when every
 * gate passes in order.
 */
export function evaluateGovernanceGates(passedGates: GovernanceGate[]): {
  releaseable: boolean;
  missing: GovernanceGate[];
} {
  const missing = GOVERNANCE_GATES.filter((g) => !passedGates.includes(g));
  return { releaseable: missing.length === 0, missing };
}

/** Release approval (FA): high-risk products require manual approval. */
export function isReleaseApproved(input: {
  highRisk: boolean;
  manualApprovalGranted: boolean;
}): boolean {
  if (!input.highRisk) return true;
  return input.manualApprovalGranted;
}

/* ─────────────────────────────────────────────────────────────
 * Certification (FI, FJ)
 * ────────────────────────────────────────────────────────────*/

export type DevCertificationKind = "security" | "compatibility" | "enterprise" | "educational";

export const DEV_CERTIFICATION_KINDS: readonly DevCertificationKind[] = [
  "security",
  "compatibility",
  "enterprise",
  "educational",
] as const;

export interface DevCertification {
  id: DevCertificationId;
  projectRef: string;
  kind: DevCertificationKind;
  /** Versioned + auditable certification results (FJ). */
  version: number;
  passed: boolean;
  grantedAt: string;
}

export function grantDevCertification(input: {
  id: DevCertificationId;
  projectRef: string;
  kind: DevCertificationKind;
  version?: number;
  passed: boolean;
  now?: string;
}): DevCertification {
  return {
    id: input.id,
    projectRef: input.projectRef,
    kind: input.kind,
    version: input.version ?? 1,
    passed: input.passed,
    grantedAt: input.now ?? timeAuthority.now().at,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Developer AI assistant boundary (CO, CP, CQ, CR)
 * ────────────────────────────────────────────────────────────*/

export type DevAiAssistCapability =
  | "api_discovery"
  | "code_generation"
  | "debugging"
  | "architecture_explanation"
  | "migration"
  | "test_generation"
  | "documentation";

export const DEV_AI_ASSIST_CAPABILITIES: readonly DevAiAssistCapability[] = [
  "api_discovery",
  "code_generation",
  "debugging",
  "architecture_explanation",
  "migration",
  "test_generation",
  "documentation",
] as const;

/**
 * AI assistant boundary (Section CP): the assistant must not automatically deploy
 * destructive production changes without appropriate authorization.
 */
export function isDevAiDeploymentPermitted(input: {
  destructive: boolean;
  explicitAuthorization: boolean;
  environmentKind: string;
}): boolean {
  if (input.environmentKind === "production" && input.destructive) {
    return input.explicitAuthorization;
  }
  return true;
}

/** Generated code must be inspectable, editable, testable, attributable (CQ). */
export function isGeneratedCodeCompliant(input: {
  inspectable: boolean;
  editable: boolean;
  testable: boolean;
  attributable: boolean;
}): boolean {
  return input.inspectable && input.editable && input.testable && input.attributable;
}

/* ─────────────────────────────────────────────────────────────
 * Dependency policy (EQ, ER) + artifact registry (EU, EV, EW)
 * ────────────────────────────────────────────────────────────*/

/**
 * Dependency policy (Section EQ): organizations restrict dependencies.
 * An approved dependency registry (ER) gates what may be used.
 */
export function isDependencyApproved(input: {
  dependencyKey: string;
  approvedDependencies: string[];
  restrictedDependencies: string[];
}): { approved: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (input.restrictedDependencies.includes(input.dependencyKey)) {
    reasons.push("Dependency is restricted by organization policy (Section EQ)");
  }
  if (
    !input.approvedDependencies.includes(input.dependencyKey) &&
    input.approvedDependencies.length > 0
  ) {
    reasons.push("Dependency is not on the approved registry (Section ER)");
  }
  return { approved: reasons.length === 0, reasons };
}

export interface BuildArtifact {
  id: string;
  projectRef: string;
  version: string;
  /** Integrity protection (Section ET). */
  checksumRef: string;
  /** Whether the container image passed security scanning (Section EW). */
  imageScanPassed: boolean;
  createdAt: string;
}

export function registerBuildArtifact(input: {
  id: string;
  projectRef: string;
  version: string;
  checksumRef: string;
  imageScanPassed?: boolean;
  now?: string;
}): BuildArtifact {
  return {
    id: input.id,
    projectRef: input.projectRef,
    version: input.version,
    checksumRef: input.checksumRef,
    imageScanPassed: input.imageScanPassed ?? false,
    createdAt: input.now ?? timeAuthority.now().at,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Developer exit (FT, FU) + platform lock-in reduction
 * ────────────────────────────────────────────────────────────*/

/**
 * Developer exit (Section FT): developers may export appropriate project metadata
 * and artifacts; source ownership is retained (FU).
 */
export function isDeveloperExitPermitted(input: {
  metadataExportable: boolean;
  artifactsExportable: boolean;
  sourceOwnedByDeveloper: boolean;
}): boolean {
  return input.metadataExportable && input.artifactsExportable && input.sourceOwnedByDeveloper;
}

/* ─────────────────────────────────────────────────────────────
 * Compatibility matrix (EY, EZ)
 * ────────────────────────────────────────────────────────────*/

export interface CompatibilityCell {
  sherivsVersion: string;
  sdkVersion: string;
  apiVersion: string;
  schemaVersion: string;
  runtimeVersion: string;
  productVersion: string;
}

/**
 * Compatibility matrix (Section EY): a cell is compatible only when every
 * dimension's version matches the supported set.
 */
export function isCompatibilityCellValid(
  cell: CompatibilityCell,
  supportedVersions: Record<string, string[]>,
): boolean {
  for (const [dimension, value] of Object.entries(cell)) {
    const supported = supportedVersions[dimension];
    if (supported && supported.length > 0 && !supported.includes(value)) return false;
  }
  return true;
}
