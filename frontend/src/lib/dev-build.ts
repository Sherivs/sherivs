/**
 * CoreGrid Developer Platform — build, package, and release domain.
 *
 * Implements `architecture/phase-28-developer-platform.md`:
 * - Project scaffolding (28): templates for applications, integrations, agents,
 *   AI capabilities, automation, connectors, dashboards, educational extensions,
 *   hardware adapters.
 * - Package builder (48): convert projects into standardized CoreGrid packages.
 * - Package validation (BB): manifest, dependencies, permissions, schemas, APIs,
 *   security, compatibility. Package signing (BC): production packages signed.
 * - Supply-chain security (BD): provenance, SBOM, dependency lockfiles, signatures,
 *   reproducible builds where possible. Software bill of materials (BE).
 * - Static analysis (BF): linting, type checking, security analysis, dependency
 *   analysis, code quality. Dynamic analysis (BG). Security scanning (BH).
 * - CI/CD integration (BI): Commit → Build → Unit Test → Security Scan →
 *   Integration Test → Compatibility Test → Package → Sign → Publish.
 * - Git integration (BK), branching (BL), code review (BM), PR validation (BN).
 * - Testing platform (BO): unit/integration/contract/E2E/security/performance/
 *   compatibility/tenant isolation tests. Contract testing (BP) against
 *   authoritative CoreGrid contracts. Backward compatibility (BQ), migration
 *   assistance (BR).
 * - Version management (BS): semantic versioning, API/schema/package/dependency
 *   versions. Release channels (BT): experimental, alpha, beta, stable, LTS.
 * - Preview environments (BU), canary deployment (BV), feature flags (BW).
 * - Reproducible builds (ES), build artifacts (ET), artifact registry (EU),
 *   container support (EV), image security (EW), runtime compatibility (EX),
 *   compatibility matrix (EY), test matrix (EZ), release approval (FA),
 *   policy-as-code (FB-FC).
 */

import type { TenantId } from "./tenant-core";
import type { DeveloperProjectType } from "./dev-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type ProjectTemplateId = string & { readonly __brand: "ProjectTemplateId" };
export type BuildArtifactId = string & { readonly __brand: "BuildArtifactId" };
export type DevPackageId = string & { readonly __brand: "DevPackageId" };
export type ReleaseChannelId = string & { readonly __brand: "ReleaseChannelId" };
export type TestResultId = string & { readonly __brand: "TestResultId" };

export function projectTemplateId(raw: string): ProjectTemplateId {
  return raw as ProjectTemplateId;
}
export function buildArtifactId(raw: string): BuildArtifactId {
  return raw as BuildArtifactId;
}
export function devPackageId(raw: string): DevPackageId {
  return raw as DevPackageId;
}
export function releaseChannelId(raw: string): ReleaseChannelId {
  return raw as ReleaseChannelId;
}
export function testResultId(raw: string): TestResultId {
  return raw as TestResultId;
}

/* ─────────────────────────────────────────────────────────────
 * Project scaffolding (Section 28)
 * ────────────────────────────────────────────────────────────*/

export interface ProjectTemplate {
  id: ProjectTemplateId;
  projectType: DeveloperProjectType;
  name: string;
  /** Files the template scaffolds. */
  files: string[];
  isActive: boolean;
}

export function registerProjectTemplate(input: {
  id: ProjectTemplateId;
  projectType: DeveloperProjectType;
  name: string;
  files?: string[];
  isActive?: boolean;
}): ProjectTemplate {
  return {
    id: input.id,
    projectType: input.projectType,
    name: input.name,
    files: input.files ?? ["coregrid.yaml", "source/", "tests/"],
    isActive: input.isActive ?? false,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Static + dynamic analysis (BF, BG, BH)
 * ────────────────────────────────────────────────────────────*/

export type StaticAnalysisCheck =
  "linting" | "type_checking" | "security_analysis" | "dependency_analysis" | "code_quality";

export const STATIC_ANALYSIS_CHECKS: readonly StaticAnalysisCheck[] = [
  "linting",
  "type_checking",
  "security_analysis",
  "dependency_analysis",
  "code_quality",
] as const;

export interface StaticAnalysisResult {
  passed: boolean;
  failingChecks: StaticAnalysisCheck[];
  analyzedAt: string;
}

export function evaluateStaticAnalysis(input: {
  failingChecks?: StaticAnalysisCheck[];
  now?: string;
}): StaticAnalysisResult {
  return {
    passed: (input.failingChecks ?? []).length === 0,
    failingChecks: input.failingChecks ?? [],
    analyzedAt: input.now ?? timeAuthority.now().at,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Package builder + validation (Sections 48, BB)
 * ────────────────────────────────────────────────────────────*/

export interface DevPackage {
  id: DevPackageId;
  projectRef: string;
  version: string;
  manifestRef: string;
  /** Whether the package is cryptographically signed (Section BC). */
  signed: boolean;
  /** SBOM ref (Section BE). */
  sbomRef: string | null;
  /** Provenance ref (Section BD). */
  provenanceRef: string | null;
  /** Whether the build was reproducible (Section ES). */
  reproducible: boolean;
  createdAt: string;
}

export interface PackageValidationResult {
  ok: boolean;
  failures: string[];
}

/**
 * Package validation (Section BB): validate manifest, dependencies, permissions,
 * schemas, APIs, security, compatibility before release.
 */
export function validateDevPackage(input: {
  manifestValid: boolean;
  dependenciesResolved: boolean;
  permissionsApproved: boolean;
  schemasValid: boolean;
  apisCompatible: boolean;
  securityScanPassed: boolean;
}): PackageValidationResult {
  const failures: string[] = [];
  if (!input.manifestValid) failures.push("manifest");
  if (!input.dependenciesResolved) failures.push("dependencies");
  if (!input.permissionsApproved) failures.push("permissions");
  if (!input.schemasValid) failures.push("schemas");
  if (!input.apisCompatible) failures.push("apis");
  if (!input.securityScanPassed) failures.push("security");
  return { ok: failures.length === 0, failures };
}

export function buildDevPackage(input: {
  id: DevPackageId;
  projectRef: string;
  version: string;
  manifestRef: string;
  signed?: boolean;
  sbomRef?: string | null;
  provenanceRef?: string | null;
  reproducible?: boolean;
  now?: string;
}): DevPackage {
  return {
    id: input.id,
    projectRef: input.projectRef,
    version: input.version,
    manifestRef: input.manifestRef,
    signed: input.signed ?? false,
    sbomRef: input.sbomRef ?? null,
    provenanceRef: input.provenanceRef ?? null,
    reproducible: input.reproducible ?? false,
    createdAt: input.now ?? timeAuthority.now().at,
  };
}

/* ─────────────────────────────────────────────────────────────
 * CI/CD pipeline (Section BI)
 * ────────────────────────────────────────────────────────────*/

export type CiStage =
  | "commit"
  | "build"
  | "unit_test"
  | "security_scan"
  | "integration_test"
  | "compatibility_test"
  | "package"
  | "sign"
  | "publish";

export const CI_STAGES: readonly CiStage[] = [
  "commit",
  "build",
  "unit_test",
  "security_scan",
  "integration_test",
  "compatibility_test",
  "package",
  "sign",
  "publish",
] as const;

export interface CiRun {
  id: string;
  projectRef: string;
  stagesPassed: CiStage[];
  currentStage: CiStage;
  passed: boolean;
  startedAt: string;
}

export function createCiRun(input: { id: string; projectRef: string; now?: string }): CiRun {
  return {
    id: input.id,
    projectRef: input.projectRef,
    stagesPassed: [],
    currentStage: "commit",
    passed: false,
    startedAt: input.now ?? timeAuthority.now().at,
  };
}

/** A CI run advances one stage at a time in order (Section BI). */
export function canAdvanceCiStage(current: CiStage, next: CiStage): boolean {
  return CI_STAGES.indexOf(next) === CI_STAGES.indexOf(current) + 1;
}

/* ─────────────────────────────────────────────────────────────
 * Version management (BS) + release channels (BT)
 * ────────────────────────────────────────────────────────────*/

export type ReleaseChannelKind = "experimental" | "alpha" | "beta" | "stable" | "lts";

export const RELEASE_CHANNEL_KINDS: readonly ReleaseChannelKind[] = [
  "experimental",
  "alpha",
  "beta",
  "stable",
  "lts",
] as const;

export const RELEASE_CHANNEL_RANK: Record<ReleaseChannelKind, number> = {
  experimental: 0,
  alpha: 1,
  beta: 2,
  stable: 3,
  lts: 4,
};

export interface ReleaseChannel {
  id: ReleaseChannelId;
  projectRef: string;
  kind: ReleaseChannelKind;
  isActive: boolean;
}

export function createReleaseChannel(input: {
  id: ReleaseChannelId;
  projectRef: string;
  kind: ReleaseChannelKind;
  isActive?: boolean;
}): ReleaseChannel {
  return {
    id: input.id,
    projectRef: input.projectRef,
    kind: input.kind,
    isActive: input.isActive ?? false,
  };
}

/** Section BT: a release can only advance to a more stable channel. */
export function canPromoteReleaseChannel(
  current: ReleaseChannelKind,
  next: ReleaseChannelKind,
): boolean {
  return RELEASE_CHANNEL_RANK[next] > RELEASE_CHANNEL_RANK[current];
}

/** Semantic versioning (Section BS): MAJOR.MINOR.PATCH. */
export function isSemanticVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

/* ─────────────────────────────────────────────────────────────
 * Preview + canary (BU, BV) + feature flags (BW)
 * ────────────────────────────────────────────────────────────*/

export interface CanaryDeployment {
  projectRef: string;
  releaseRef: string;
  /** Fraction of traffic on the canary (0-1). */
  trafficFraction: number;
  maxTrafficFraction: number;
}

export function createCanaryDeployment(input: {
  projectRef: string;
  releaseRef: string;
  trafficFraction?: number;
  maxTrafficFraction?: number;
}): { ok: true; canary: CanaryDeployment } | { ok: false; error: string } {
  const fraction = input.trafficFraction ?? 0.05;
  const max = input.maxTrafficFraction ?? 0.2;
  if (fraction <= 0 || fraction > max) {
    return {
      ok: false,
      error: "Canary traffic fraction must be within the configured limit (Section BV)",
    };
  }
  return {
    ok: true,
    canary: {
      projectRef: input.projectRef,
      releaseRef: input.releaseRef,
      trafficFraction: fraction,
      maxTrafficFraction: max,
    },
  };
}

export interface DevFeatureFlag {
  key: string;
  projectRef: string;
  enabled: boolean;
}

export function setDevFeatureFlag(input: {
  key: string;
  projectRef: string;
  enabled: boolean;
}): DevFeatureFlag {
  return { key: input.key, projectRef: input.projectRef, enabled: input.enabled };
}
