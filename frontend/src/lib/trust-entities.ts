/**
 * CoreGrid — Security & Trust Fabric entity trust records and
 * software provenance (Phase 09, Sections S, T, U, V, W, X, Y).
 *
 * Implements `architecture/phase-09-security-trust-fabric.md`:
 * - Device Trust (S): device identity, ownership, enrollment, posture, OS
 *   state, security status, encryption status, attestation, recent anomalies.
 *   Device trust must remain separate from device functionality.
 * - Workload Trust (T): workload identity, deployment origin, artifact
 *   integrity, image provenance, configuration integrity, runtime identity.
 * - Agent Trust (U): agent identity, model identity, configuration, tool
 *   permissions, execution history, policy compliance, prompt integrity,
 *   tool behavior, deployment provenance, security posture. Trust
 *   degradation must not automatically grant additional permissions.
 * - Model Trust (V): provenance, version, deployment source, evaluation
 *   history, integrity, approved-use scope, rollback version.
 * - Software Provenance (W): source repo, commit, build, dependencies,
 *   artifact, signer, deployment, environment.
 * - Artifact Integrity (X): hash, signature, provenance, source, build
 *   identity.
 * - Supply-Chain Trust (Y): suspicious or unverifiable provenance must
 *   reduce trust.
 */

import type { TenantId } from "./tenant-core";
import type { TrustState } from "./trust-core";

/* ─────────────────────────────────────────────────────────────
 * Device trust (S)
 * ────────────────────────────────────────────────────────────*/

export interface DeviceTrustRecord {
  deviceId: string;
  tenantId: TenantId | null;
  enrolled: boolean;
  postureOk: boolean;
  osIntegrityOk: boolean;
  encryptionEnabled: boolean;
  attestationVerified: boolean;
  recentAnomalies: number;
  trustState: TrustState;
  lastEvaluatedAt: string;
}

export interface EvaluateDeviceTrustInput {
  deviceId: string;
  tenantId: TenantId | null;
  enrolled: boolean;
  postureOk: boolean;
  osIntegrityOk: boolean;
  encryptionEnabled: boolean;
  attestationVerified: boolean;
  recentAnomalies: number;
  now: string;
}

/**
 * Evaluate device trust. Device trust is computed from security-relevant
 * facts only; it remains separate from device functionality (S). Missing
 * enrollment or failed attestation must never produce a trusted state.
 */
export function evaluateDeviceTrust(input: EvaluateDeviceTrustInput): DeviceTrustRecord {
  let trustState: TrustState;
  if (!input.enrolled || !input.attestationVerified) {
    trustState = "UNVERIFIED";
  } else if (input.recentAnomalies > 2 || !input.postureOk || !input.osIntegrityOk) {
    trustState = "DEGRADED";
  } else if (input.encryptionEnabled && input.postureOk) {
    trustState = "TRUSTED";
  } else {
    trustState = "CONDITIONALLY_TRUSTED";
  }
  return {
    deviceId: input.deviceId,
    tenantId: input.tenantId,
    enrolled: input.enrolled,
    postureOk: input.postureOk,
    osIntegrityOk: input.osIntegrityOk,
    encryptionEnabled: input.encryptionEnabled,
    attestationVerified: input.attestationVerified,
    recentAnomalies: input.recentAnomalies,
    trustState,
    lastEvaluatedAt: input.now,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Workload trust (T)
 * ────────────────────────────────────────────────────────────*/

export interface WorkloadTrustRecord {
  workloadId: string;
  deploymentOriginVerified: boolean;
  artifactIntegrityVerified: boolean;
  imageProvenanceVerified: boolean;
  configurationIntegrityVerified: boolean;
  trustState: TrustState;
  lastEvaluatedAt: string;
}

export interface EvaluateWorkloadTrustInput {
  workloadId: string;
  deploymentOriginVerified: boolean;
  artifactIntegrityVerified: boolean;
  imageProvenanceVerified: boolean;
  configurationIntegrityVerified: boolean;
  now: string;
}

export function evaluateWorkloadTrust(input: EvaluateWorkloadTrustInput): WorkloadTrustRecord {
  const allVerified =
    input.deploymentOriginVerified &&
    input.artifactIntegrityVerified &&
    input.imageProvenanceVerified &&
    input.configurationIntegrityVerified;
  return {
    workloadId: input.workloadId,
    deploymentOriginVerified: input.deploymentOriginVerified,
    artifactIntegrityVerified: input.artifactIntegrityVerified,
    imageProvenanceVerified: input.imageProvenanceVerified,
    configurationIntegrityVerified: input.configurationIntegrityVerified,
    trustState: allVerified
      ? "TRUSTED"
      : input.artifactIntegrityVerified
        ? "CONDITIONALLY_TRUSTED"
        : "UNVERIFIED",
    lastEvaluatedAt: input.now,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Agent trust (U)
 * ────────────────────────────────────────────────────────────*/

export interface AgentTrustRecord {
  agentId: string;
  identityVerified: boolean;
  policyCompliant: boolean;
  toolBehaviorSuspicious: boolean;
  executionHistoryClean: boolean;
  promptIntegrityOk: boolean;
  trustState: TrustState;
  lastEvaluatedAt: string;
}

export interface EvaluateAgentTrustInput {
  agentId: string;
  identityVerified: boolean;
  policyCompliant: boolean;
  toolBehaviorSuspicious: boolean;
  executionHistoryClean: boolean;
  promptIntegrityOk: boolean;
  now: string;
}

/**
 * Evaluate agent trust. Trust degradation must not automatically grant
 * additional permissions (U.3) — this function only produces trust state;
 * permission changes remain Phase 07/08 concerns.
 */
export function evaluateAgentTrust(input: EvaluateAgentTrustInput): AgentTrustRecord {
  let trustState: TrustState;
  if (!input.identityVerified) {
    trustState = "UNVERIFIED";
  } else if (input.toolBehaviorSuspicious || !input.promptIntegrityOk) {
    trustState = "QUARANTINED";
  } else if (!input.policyCompliant || !input.executionHistoryClean) {
    trustState = "DEGRADED";
  } else {
    trustState = "TRUSTED";
  }
  return {
    agentId: input.agentId,
    identityVerified: input.identityVerified,
    policyCompliant: input.policyCompliant,
    toolBehaviorSuspicious: input.toolBehaviorSuspicious,
    executionHistoryClean: input.executionHistoryClean,
    promptIntegrityOk: input.promptIntegrityOk,
    trustState,
    lastEvaluatedAt: input.now,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Model trust (V)
 * ────────────────────────────────────────────────────────────*/

export interface ModelTrustRecord {
  modelId: string;
  version: string;
  provenanceVerified: boolean;
  integrityVerified: boolean;
  evaluationPassed: boolean;
  approvedUseScope: string | null;
  rollbackVersion: string | null;
  trustState: TrustState;
}

export interface RegisterModelTrustInput {
  modelId: string;
  version: string;
  provenanceVerified: boolean;
  integrityVerified: boolean;
  evaluationPassed: boolean;
  approvedUseScope: string | null;
  rollbackVersion: string | null;
}

export function registerModelTrust(input: RegisterModelTrustInput): ModelTrustRecord {
  const usable = input.provenanceVerified && input.integrityVerified && input.evaluationPassed;
  return {
    modelId: input.modelId,
    version: input.version,
    provenanceVerified: input.provenanceVerified,
    integrityVerified: input.integrityVerified,
    evaluationPassed: input.evaluationPassed,
    approvedUseScope: input.approvedUseScope,
    rollbackVersion: input.rollbackVersion,
    trustState: usable ? "TRUSTED" : "UNVERIFIED",
  };
}

/* ─────────────────────────────────────────────────────────────
 * Software provenance (W) and artifact integrity (X)
 * ────────────────────────────────────────────────────────────*/

export interface SoftwareProvenanceRecord {
  artifactId: string;
  sourceRepository: string;
  commit: string;
  buildId: string;
  dependencyVersions: string[];
  signer: string;
  deploymentEnvironment: string;
  deployedAt: string;
}

export interface RegisterSoftwareProvenanceInput {
  artifactId: string;
  sourceRepository: string;
  commit: string;
  buildId: string;
  dependencyVersions: string[];
  signer: string;
  deploymentEnvironment: string;
  deployedAt: string;
}

export type RegisterSoftwareProvenanceResult =
  { ok: true; record: SoftwareProvenanceRecord } | { ok: false; error: string };

export function registerSoftwareProvenance(
  input: RegisterSoftwareProvenanceInput,
): RegisterSoftwareProvenanceResult {
  if (input.artifactId.trim() === "") {
    return { ok: false, error: "Artifact id is required (W)" };
  }
  if (input.sourceRepository.trim() === "" || input.commit.trim() === "") {
    return { ok: false, error: "Source repository and commit are required for provenance (W)" };
  }
  return { ok: true, record: { ...input } };
}

export interface ArtifactIntegrityRecord {
  artifactId: string;
  /** Hash of the artifact (X). */
  hash: string;
  signatureVerified: boolean;
  sourceVerified: boolean;
  buildIdentityVerified: boolean;
}

export interface VerifyArtifactIntegrityInput {
  artifactId: string;
  /** Expected hash. */
  expectedHash: string;
  /** Actual hash computed over the artifact bytes. */
  actualHash: string;
  signatureVerified: boolean;
  sourceVerified: boolean;
  buildIdentityVerified: boolean;
}

export interface ArtifactIntegrityVerdict {
  record: ArtifactIntegrityRecord;
  verified: boolean;
  reason: string;
}

/**
 * Verify artifact integrity (X). A hash mismatch or missing signature
 * invalidates the artifact regardless of other checks.
 */
export function verifyArtifactIntegrity(
  input: VerifyArtifactIntegrityInput,
): ArtifactIntegrityVerdict {
  const hashMatches = input.expectedHash.trim() !== "" && input.expectedHash === input.actualHash;
  const verified =
    hashMatches && input.signatureVerified && input.sourceVerified && input.buildIdentityVerified;
  return {
    record: {
      artifactId: input.artifactId,
      hash: input.actualHash,
      signatureVerified: input.signatureVerified,
      sourceVerified: input.sourceVerified,
      buildIdentityVerified: input.buildIdentityVerified,
    },
    verified,
    reason: verified
      ? "Artifact integrity verified"
      : hashMatches
        ? "Artifact hash matches but signature/source/build identity not fully verified"
        : "Artifact hash mismatch — integrity check failed (X)",
  };
}

/**
 * Supply-chain trust (Y): suspicious or unverifiable provenance must reduce
 * trust. An artifact with no verified provenance is never considered
 * trusted; it is UNVERIFIED at best.
 */
export function supplyChainTrustState(
  provenanceVerified: boolean,
  integrityVerified: boolean,
): TrustState {
  if (!provenanceVerified) return "UNVERIFIED";
  if (!integrityVerified) return "DEGRADED";
  return "TRUSTED";
}
