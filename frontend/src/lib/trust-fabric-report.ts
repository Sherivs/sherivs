/**
 * CoreGrid — Security & Trust Fabric self-report (Phase 09).
 *
 * A control-plane view of the trust fabric that EXERCISES the shipped state
 * machines instead of describing them. Every invariant below is checked by
 * calling the real functions; a check that stops holding makes this page say so.
 *
 * Ownership (BS): Phase 08 answers "may this action happen?" — Phase 09 answers
 * "how much should CoreGrid trust the entities, evidence and relationships
 * involved?". This module therefore produces TRUST, never permission: it can
 * recommend restrictions, and it never grants one.
 *
 * Domain-neutral: imports only kernel trust modules. A runtime is a consumer of
 * these contracts, never a subject of them, and nothing runtime-specific is
 * named here.
 */
import {
  TRUST_RELATIONSHIP_TYPES,
  TRUST_SCORE_FACTORS,
  TRUST_STATES,
  TRUST_SUBJECT_TYPES,
  createTrustSubject,
  createTrustRelationship,
  evaluateTrustScore,
  isTrustRelationshipActive,
  isTrustTransitionAllowed,
  isUsableTrustState,
  recommendedTrustStateForScore,
  revokeTrustRelationship,
  transitionTrustState,
  type TrustState,
} from "./trust-core";
import {
  TRUST_ASSERTION_TYPES,
  TRUST_REVOCATION_REASONS,
  buildProvenanceChain,
  createTrustAssertion,
  createTrustEvidence,
  createTrustRevocation,
  isTrustEvidenceFresh,
  revokeTrustAssertion,
  verifyTrustAssertion,
} from "./trust-assertions";
import {
  evaluateAgentTrust,
  evaluateDeviceTrust,
  evaluateWorkloadTrust,
  registerModelTrust,
  registerSoftwareProvenance,
  supplyChainTrustState,
  verifyArtifactIntegrity,
} from "./trust-entities";
import {
  createFederation,
  createTrustDelegation,
  createTrustPolicy,
  evaluateCertificateTrust,
  evaluateTrustPolicy,
  evaluateZeroTrust,
  isDelegationActive,
  isFederationActive,
  isKeyTrustUsable,
  registerCertificateTrust,
  registerKeyTrust,
  registerTrustAnchor,
  revokeTrustAnchor,
  trustStateToUsable,
} from "./trust-governance";
import { tenantId } from "./tenant-core";

/** The phase capability this report speaks for (a distinctive reference). */
export const TRUST_FABRIC_CAPABILITY = "trust-fabric";

/** A trust decision's evidence basis, in the fabric's own currency. */
const NOW = "2026-09-16T09:00:00.000Z";
const LATER = "2027-09-16T09:00:00.000Z";
const TENANT = tenantId("tenant-demo");

export interface TrustInvariantCheck {
  /** The invariant being checked (BR list or a stated behaviour). */
  id: string;
  statement: string;
  /** Did the real code hold the line? */
  holds: boolean;
  /** What the check actually observed. */
  observed: string;
}

export interface TrustExercise {
  id: string;
  area: string;
  outcome: string;
  /** The trust state the shipped code produced. */
  state: TrustState | null;
  /** True when the code refused the operation — the safe direction. */
  refused: boolean;
}

export interface TrustFabricGap {
  id: string;
  area: string;
  /** DECLARED = vocabulary or contract exists; no executable enforcement yet. */
  status: "DECLARED";
  detail: string;
}

export interface TrustFabricReport {
  generatedAt: string;
  capability: string;
  vocabulary: {
    states: number;
    subjectTypes: number;
    relationshipTypes: number;
    assertionTypes: number;
    scoreFactors: number;
    revocationReasons: number;
  };
  invariants: readonly TrustInvariantCheck[];
  exercises: readonly TrustExercise[];
  gaps: readonly TrustFabricGap[];
  usability: {
    /** `isUsableTrustState` — the fabric's own reading. */
    usableStates: readonly TrustState[];
    /** `trustStateToUsable` — the Phase 08 integration reading (AL). */
    phase08UsableStates: readonly TrustState[];
    /** Two definitions of "usable" exist; the difference is reported, not hidden. */
    differOn: readonly TrustState[];
    terminalStates: readonly TrustState[];
  };
  verdict: { invariantCount: number; satisfied: number; reported: number };
}

/* ─────────────────────────────────────────────────────────────
 * Invariant checks — each one calls the shipped machine.
 * ────────────────────────────────────────────────────────────*/

/** Run every invariant the fabric claims, using the fabric's own functions. */
export function trustInvariantChecks(): readonly TrustInvariantCheck[] {
  const checks: TrustInvariantCheck[] = [];

  const created = createTrustSubject({
    id: "subject-fresh",
    type: "device",
    tenantId: TENANT,
    now: NOW,
  });
  checks.push({
    id: "BR.1",
    statement: "A registered subject is UNKNOWN — existence is not trust.",
    holds: created.ok && created.subject.state === "UNKNOWN" && !isUsableTrustState("UNKNOWN"),
    observed: created.ok
      ? `state=${created.subject.state}, usable=${isUsableTrustState(created.subject.state)}`
      : "creation refused",
  });

  if (created.ok) {
    const direct = transitionTrustState(
      created.subject,
      "TRUSTED",
      "evidence-1",
      "actor-auditor",
      NOW,
    );
    const toUnverified = transitionTrustState(
      created.subject,
      "UNVERIFIED",
      "",
      "actor-auditor",
      NOW,
    );
    const skip = toUnverified.ok
      ? transitionTrustState(toUnverified.subject, "TRUSTED", "evidence-1", "actor-auditor", NOW)
      : null;
    checks.push({
      id: "BR.10",
      statement: "UNKNOWN cannot become TRUSTED directly or by skipping a step.",
      holds: !direct.ok && skip !== null && !skip.ok,
      observed: "UNKNOWN→TRUSTED refused; UNVERIFIED→TRUSTED refused (VERIFIED is required)",
    });

    const quarantined = transitionTrustState(
      created.subject,
      "QUARANTINED",
      "",
      "actor-auditor",
      NOW,
    );
    checks.push({
      id: "BR.2",
      statement: "Trust that is withdrawn requires evidence of the reason.",
      holds: !quarantined.ok,
      observed: quarantined.ok
        ? "quarantine accepted without evidence"
        : `refused: ${quarantined.error}`,
    });
  }

  const revokedTerminal = TRUST_STATES.every(
    (state) => !isTrustTransitionAllowed("REVOKED", state),
  );
  checks.push({
    id: "BR.4",
    statement: "REVOKED is terminal: no transition leaves it.",
    holds: revokedTerminal,
    observed: `${TRUST_STATES.length} target states checked`,
  });

  const unattributable = createTrustRevocation({
    subjectId: "subject-fresh",
    reason: "compromise",
    kind: "permanent_revocation",
    revokedBy: "   ",
    now: NOW,
  });
  checks.push({
    id: "BR.14",
    statement: "Revocation is attributable — it cannot be recorded anonymously.",
    holds: !unattributable.ok,
    observed: unattributable.ok
      ? "anonymous revocation accepted"
      : `refused: ${unattributable.error}`,
  });

  const relationship = createTrustRelationship({
    type: "TRUSTS",
    subjectId: "subject-issuer",
    targetId: "subject-subject",
    tenantId: TENANT,
    evidenceRef: "evidence-relationship",
    expiresAt: "2026-09-16T12:00:00.000Z",
    now: NOW,
  });
  const activeNow = relationship.ok && isTrustRelationshipActive(relationship.relationship, NOW);
  const activeLater =
    relationship.ok && isTrustRelationshipActive(relationship.relationship, LATER);
  const revoked = relationship.ok ? revokeTrustRelationship(relationship.relationship, NOW) : null;
  const activeAfterRevocation = revoked !== null && isTrustRelationshipActive(revoked, NOW);
  checks.push({
    id: "BR.6",
    statement: "Trust relationships expire, and revocation takes effect immediately (BR.11).",
    holds: activeNow && !activeLater && !activeAfterRevocation,
    observed: `active at issue=${activeNow}, active after expiry=${activeLater}, active after revocation=${activeAfterRevocation}`,
  });

  const evidenceFree = createTrustRelationship({
    type: "TRUSTS",
    subjectId: "subject-issuer",
    targetId: "subject-subject",
    tenantId: TENANT,
    evidenceRef: "   ",
    now: NOW,
  });
  checks.push({
    id: "BR.2b",
    statement: "A trust relationship without evidence is refused.",
    holds: !evidenceFree.ok,
    observed: evidenceFree.ok
      ? "evidence-free relationship accepted"
      : `refused: ${evidenceFree.error}`,
  });

  const selfRelationship = createTrustRelationship({
    type: "TRUSTS",
    subjectId: "subject-loop",
    targetId: "subject-loop",
    tenantId: TENANT,
    evidenceRef: "evidence-loop",
    now: NOW,
  });
  checks.push({
    id: "AK.5",
    statement: "Implicit relationships are minimised: a subject cannot trust itself.",
    holds: !selfRelationship.ok,
    observed: selfRelationship.ok
      ? "self-relationship accepted"
      : `refused: ${selfRelationship.error}`,
  });

  const noFactors = evaluateTrustScore({
    factors: [],
    confidence: 0.5,
    context: "control-plane",
    now: NOW,
  });
  const badConfidence = evaluateTrustScore({
    factors: [
      { factor: "identity_assurance", score: 90, weight: 1, evidenceRef: "evidence-score" },
    ],
    confidence: 2,
    context: "control-plane",
    now: NOW,
  });
  const scored = evaluateTrustScore({
    factors: [
      { factor: "identity_assurance", score: 90, weight: 2, evidenceRef: "evidence-identity" },
      { factor: "device_assurance", score: 50, weight: 1, evidenceRef: "evidence-device" },
      { factor: "recent_incidents", score: 20, weight: 1, evidenceRef: "evidence-incidents" },
    ],
    confidence: 0.8,
    context: "control-plane",
    now: NOW,
  });
  checks.push({
    id: "BR.9",
    statement:
      "A trust score is evidence-weighted confidence, never truth: it refuses to exist without factors and always carries its breakdown.",
    holds:
      !noFactors.ok && !badConfidence.ok && scored.ok && scored.score.evidenceRefs.length === 3,
    observed: scored.ok
      ? `score=${scored.score.score}, evidenceRefs=${scored.score.evidenceRefs.length}, version=${scored.score.version}, recommended=${recommendedTrustStateForScore(scored.score.score)}`
      : "scoring refused",
  });

  return checks;
}

/* ─────────────────────────────────────────────────────────────
 * Exercises — the fabric's write and verify paths, end to end.
 * ────────────────────────────────────────────────────────────*/

/** Exercise the write and verify paths with real calls, not descriptions. */
export function trustExercises(): readonly TrustExercise[] {
  const exercises: TrustExercise[] = [];

  const assertionInput = {
    issuer: "issuer-identity-provider",
    subject: "subject-device-1",
    type: "device" as const,
    trustLevel: "high" as const,
    evidence: ["evidence-attestation-1"],
    scope: "device-enrolment",
    tenantId: TENANT,
    integrityReference: "signature-ref-1",
    provenanceRef: "provenance-ref-1",
    issuedAt: NOW,
    expiresAt: "2026-09-30T00:00:00.000Z",
  };

  const assertion = createTrustAssertion(assertionInput);
  const evidenceFree = createTrustAssertion({ ...assertionInput, evidence: [] });
  exercises.push({
    id: "assertion-contract",
    area: "Trust assertion contract (F.1, L.2)",
    outcome: assertion.ok ? `issued ${assertion.assertion.id}` : "issue refused",
    state: null,
    refused: !evidenceFree.ok,
  });

  if (assertion.ok) {
    const issuers = ["issuer-identity-provider"];
    const inScope = verifyTrustAssertion(
      assertion.assertion,
      true,
      issuers,
      "device-enrolment",
      NOW,
    );
    const uncheckedIntegrity = verifyTrustAssertion(
      assertion.assertion,
      false,
      issuers,
      "device-enrolment",
      NOW,
    );
    const wrongScope = verifyTrustAssertion(
      assertion.assertion,
      true,
      issuers,
      "payment-scope",
      NOW,
    );
    const expired = verifyTrustAssertion(
      assertion.assertion,
      true,
      issuers,
      "device-enrolment",
      LATER,
    );
    const unacceptedIssuer = verifyTrustAssertion(
      assertion.assertion,
      true,
      ["issuer-elsewhere"],
      "device-enrolment",
      NOW,
    );
    const revoked = verifyTrustAssertion(
      revokeTrustAssertion(assertion.assertion, NOW),
      true,
      issuers,
      "device-enrolment",
      NOW,
    );
    exercises.push({
      id: "assertion-verification",
      area: "Assertion verification (L, O.2, AB, BR.7)",
      outcome: `in-scope=${inScope.ok} · unchecked integrity=${uncheckedIntegrity.ok} · wrong scope=${wrongScope.ok} · expired=${expired.ok} · unaccepted issuer=${unacceptedIssuer.ok} · revoked=${revoked.ok}`,
      state: null,
      refused:
        inScope.ok &&
        !uncheckedIntegrity.ok &&
        !wrongScope.ok &&
        !expired.ok &&
        !unacceptedIssuer.ok &&
        !revoked.ok,
    });
  }

  const evidence = createTrustEvidence({
    id: "evidence-attestation-1",
    source: "device-attestation-input",
    capturedAt: NOW,
    freshnessMs: 60 * 60 * 1000,
    reliability: 0.9,
    integrityRef: "signature-ref-1",
    provenanceRef: "provenance-ref-1",
    confidence: 0.85,
  });
  exercises.push({
    id: "evidence-freshness",
    area: "Trust evidence (M.2, AB)",
    outcome: evidence.ok
      ? `fresh now=${isTrustEvidenceFresh(evidence.evidence, NOW)} · fresh a year later=${isTrustEvidenceFresh(evidence.evidence, LATER)}`
      : "evidence refused",
    state: null,
    refused: evidence.ok && !isTrustEvidenceFresh(evidence.evidence, LATER),
  });

  const evidenceFreeChain = buildProvenanceChain([
    { kind: "trust_decision", id: "decision-1", detail: "trust decision", at: NOW },
  ]);
  const chain = buildProvenanceChain([
    { kind: "trust_decision", id: "decision-1", detail: "trust decision", at: NOW },
    { kind: "trust_assertion", id: "assertion-1", detail: "device assertion", at: NOW },
    { kind: "issuer", id: "issuer-identity-provider", detail: "accepted issuer", at: NOW },
    { kind: "evidence", id: "evidence-attestation-1", detail: "attestation evidence", at: NOW },
    {
      kind: "verification_method",
      id: "method-signature",
      detail: "signature verification",
      at: NOW,
    },
    { kind: "source", id: "source-device", detail: "device telemetry", at: NOW },
  ]);
  exercises.push({
    id: "provenance-chain",
    area: "Trust provenance (N.2, N.3)",
    outcome: chain.ok
      ? `chain resolves ${chain.chain[0].kind} → ${chain.chain[chain.chain.length - 1].kind} in ${chain.chain.length} links`
      : "chain refused",
    state: null,
    refused: !evidenceFreeChain.ok,
  });

  const deviceTrusted = evaluateDeviceTrust({
    deviceId: "device-1",
    tenantId: TENANT,
    enrolled: true,
    postureOk: true,
    osIntegrityOk: true,
    encryptionEnabled: true,
    attestationVerified: true,
    recentAnomalies: 0,
    now: NOW,
  });
  const deviceUnattested = evaluateDeviceTrust({
    deviceId: "device-2",
    tenantId: TENANT,
    enrolled: true,
    postureOk: true,
    osIntegrityOk: true,
    encryptionEnabled: true,
    attestationVerified: false,
    recentAnomalies: 0,
    now: NOW,
  });
  exercises.push({
    id: "device-trust",
    area: "Device trust (S)",
    outcome: `enrolled+attested=${deviceTrusted.trustState} · unattested=${deviceUnattested.trustState}`,
    state: deviceTrusted.trustState,
    refused: deviceUnattested.trustState !== "TRUSTED",
  });

  const workloadComplete = evaluateWorkloadTrust({
    workloadId: "workload-1",
    deploymentOriginVerified: true,
    artifactIntegrityVerified: true,
    imageProvenanceVerified: true,
    configurationIntegrityVerified: true,
    now: NOW,
  });
  const workloadPartial = evaluateWorkloadTrust({
    workloadId: "workload-2",
    deploymentOriginVerified: false,
    artifactIntegrityVerified: true,
    imageProvenanceVerified: false,
    configurationIntegrityVerified: true,
    now: NOW,
  });
  exercises.push({
    id: "workload-trust",
    area: "Workload trust (T)",
    outcome: `fully verified=${workloadComplete.trustState} · artifact-only=${workloadPartial.trustState}`,
    state: workloadComplete.trustState,
    refused: workloadPartial.trustState !== "TRUSTED",
  });

  const agentClean = evaluateAgentTrust({
    agentId: "agent-1",
    identityVerified: true,
    policyCompliant: true,
    toolBehaviorSuspicious: false,
    executionHistoryClean: true,
    promptIntegrityOk: true,
    now: NOW,
  });
  const agentSuspicious = evaluateAgentTrust({
    agentId: "agent-2",
    identityVerified: true,
    policyCompliant: true,
    toolBehaviorSuspicious: true,
    executionHistoryClean: true,
    promptIntegrityOk: true,
    now: NOW,
  });
  const model = registerModelTrust({
    modelId: "model-1",
    version: "1.4.0",
    provenanceVerified: true,
    integrityVerified: true,
    evaluationPassed: true,
    approvedUseScope: "lesson-planning",
    rollbackVersion: "1.3.2",
  });
  exercises.push({
    id: "agent-and-model-trust",
    area: "Agent trust (U) and model trust (V)",
    outcome: `compliant agent=${agentClean.trustState} · suspicious tool behaviour=${agentSuspicious.trustState} · model=${model.trustState} (rollback ${model.rollbackVersion})`,
    state: agentSuspicious.trustState,
    refused: agentSuspicious.trustState === "QUARANTINED" && model.trustState === "TRUSTED",
  });

  const provenance = registerSoftwareProvenance({
    artifactId: "artifact-1",
    sourceRepository: "github.com/coregrid/coregrid",
    commit: "9f1c2ab",
    buildId: "build-4471",
    dependencyVersions: ["react@19.0.0"],
    signer: "signer-release-authority",
    deploymentEnvironment: "production",
    deployedAt: NOW,
  });
  const integrity = verifyArtifactIntegrity({
    artifactId: "artifact-1",
    expectedHash: "sha256:abc",
    actualHash: "sha256:abc",
    signatureVerified: true,
    sourceVerified: true,
    buildIdentityVerified: true,
  });
  const integrityMismatch = verifyArtifactIntegrity({
    artifactId: "artifact-2",
    expectedHash: "sha256:abc",
    actualHash: "sha256:def",
    signatureVerified: true,
    sourceVerified: true,
    buildIdentityVerified: true,
  });
  exercises.push({
    id: "supply-chain",
    area: "Software provenance, artifact integrity and supply chain (W, X, Y)",
    outcome: `provenance recorded=${provenance.ok} · integrity verified=${integrity.verified} · hash mismatch=${integrityMismatch.verified} · supply chain=${supplyChainTrustState(true, true)} / ${supplyChainTrustState(true, false)} / ${supplyChainTrustState(false, false)}`,
    state: supplyChainTrustState(true, true),
    refused:
      !integrityMismatch.verified &&
      supplyChainTrustState(false, false) === "UNVERIFIED" &&
      supplyChainTrustState(true, false) === "DEGRADED",
  });

  const key = registerKeyTrust({
    keyId: "key-1",
    kind: "signing",
    fingerprint: "SHA256:9f2c…",
    subjectId: "subject-release-authority",
    expiresAt: "2027-01-01T00:00:00.000Z",
    now: NOW,
  });
  const expiredKey = registerKeyTrust({
    keyId: "key-2",
    kind: "device",
    fingerprint: "SHA256:ab19…",
    subjectId: "subject-device-1",
    expiresAt: "2026-01-01T00:00:00.000Z",
    now: NOW,
  });
  exercises.push({
    id: "key-trust",
    area: "Key trust registry (P) — metadata only, never private material",
    outcome:
      key.ok && expiredKey.ok
        ? `active key usable=${isKeyTrustUsable(key.record, NOW)} · expired key usable=${isKeyTrustUsable(expiredKey.record, NOW)}`
        : "key registration refused",
    state: null,
    refused: key.ok && expiredKey.ok && !isKeyTrustUsable(expiredKey.record, NOW),
  });

  const certificate = registerCertificateTrust({
    certificateId: "cert-1",
    subjectId: "subject-service-1",
    issuerId: "issuer-authority",
    chainVerified: true,
    expiresAt: "2027-01-01T00:00:00.000Z",
    now: NOW,
  });
  const alreadyExpired = registerCertificateTrust({
    certificateId: "cert-2",
    subjectId: "subject-service-2",
    issuerId: "issuer-authority",
    chainVerified: true,
    expiresAt: "2026-01-01T00:00:00.000Z",
    now: NOW,
  });
  const validNow = certificate.ok ? evaluateCertificateTrust(certificate.record, NOW) : null;
  const expiredLater = certificate.ok ? evaluateCertificateTrust(certificate.record, LATER) : null;
  const revokedCertificate = certificate.ok
    ? evaluateCertificateTrust({ ...certificate.record, status: "revoked" }, NOW)
    : null;
  const unverifiedChain = certificate.ok
    ? evaluateCertificateTrust({ ...certificate.record, chainVerified: false }, NOW)
    : null;
  exercises.push({
    id: "certificate-trust",
    area: "Certificate trust (Q)",
    outcome: `already-expired refused=${!alreadyExpired.ok} · valid now=${validNow?.ok} · valid a year later=${expiredLater?.ok} · revoked=${revokedCertificate?.ok} · chain unverified=${unverifiedChain?.ok}`,
    state: null,
    refused:
      !alreadyExpired.ok &&
      validNow?.ok === true &&
      expiredLater?.ok === false &&
      revokedCertificate?.ok === false &&
      unverifiedChain?.ok === false,
  });

  const federationInput = {
    parties: ["org-coregrid", "org-partner-university"] as [string, string],
    trustScope: "credential-verification",
    acceptedAssertionTypes: ["credential"],
    verificationMethods: ["signature"],
    expiresAt: "2027-01-01T00:00:00.000Z",
    auditRequired: true,
    now: NOW,
  };
  const federation = createFederation(federationInput);
  const selfFederation = createFederation({
    ...federationInput,
    parties: ["org-coregrid", "org-coregrid"] as [string, string],
  });
  const expiredFederation = createFederation({
    ...federationInput,
    expiresAt: "2026-01-01T00:00:00.000Z",
  });
  exercises.push({
    id: "federation",
    area: "Trust federation and external trust (AC, AD) — never unrestricted internal trust",
    outcome: federation.ok
      ? `scope=${federation.relationship.trustScope} · active now=${isFederationActive(federation.relationship, NOW)} · active a year later=${isFederationActive(federation.relationship, LATER)} · self-federation refused=${!selfFederation.ok} · already-expired refused=${!expiredFederation.ok}`
      : "federation refused",
    state: null,
    refused:
      federation.ok &&
      !selfFederation.ok &&
      !expiredFederation.ok &&
      isFederationActive(federation.relationship, NOW) &&
      !isFederationActive(federation.relationship, LATER),
  });

  const delegationInput = {
    delegatorId: "subject-institution-1",
    delegateId: "subject-service-1",
    authority: "verify-enrolment-claims",
    scope: "enrolment",
    expiresAt: "2027-01-01T00:00:00.000Z",
    restrictions: ["no-bulk-export"],
    now: NOW,
  };
  const delegation = createTrustDelegation(delegationInput);
  const selfDelegation = createTrustDelegation({
    ...delegationInput,
    delegateId: "subject-institution-1",
  });
  exercises.push({
    id: "delegation",
    area: "Trust delegation (AG) — bounded, expiring, restricted",
    outcome: delegation.ok
      ? `delegation active=${isDelegationActive(delegation.delegation, NOW)} · restrictions=${delegation.delegation.restrictions.length} · self-delegation refused=${!selfDelegation.ok}`
      : "delegation refused",
    state: null,
    refused: delegation.ok && !selfDelegation.ok,
  });

  const anchor = registerTrustAnchor({
    id: "anchor-root-ca",
    kind: "root_certificate",
    managedBy: "administrator-platform",
    now: NOW,
  });
  const unmanagedAnchor = registerTrustAnchor({
    id: "anchor-root-key",
    kind: "root_key",
    managedBy: "   ",
    now: NOW,
  });
  const revokedAnchor = anchor.ok ? revokeTrustAnchor(anchor.anchor, NOW) : null;
  exercises.push({
    id: "trust-anchors",
    area: "Trust anchor management (AI) — elevated protection",
    outcome: `anchor registered=${anchor.ok} · unmanaged anchor refused=${!unmanagedAnchor.ok} · revocation recorded=${revokedAnchor?.revokedAt === NOW}`,
    state: null,
    refused: anchor.ok && !unmanagedAnchor.ok && revokedAnchor?.revokedAt === NOW,
  });

  const policyInput = {
    id: "policy-1",
    version: 1,
    acceptedIssuers: ["issuer-identity-provider"],
    acceptableEvidenceKinds: ["attestation"],
    defaultTrustLifetimeMs: 90 * 24 * 60 * 60 * 1000,
    minimumAssurance: 0.6,
    requireAttestation: true,
    effectiveAt: NOW,
  };
  const policy = createTrustPolicy(policyInput);
  const issuerlessPolicy = createTrustPolicy({ ...policyInput, acceptedIssuers: [] });
  const satisfied = policy.ok
    ? evaluateTrustPolicy({
        policy: policy.policy,
        assurance: 0.9,
        issuerAccepted: true,
        evidenceAccepted: true,
        attestationOk: true,
      })
    : null;
  const missingAttestation = policy.ok
    ? evaluateTrustPolicy({
        policy: policy.policy,
        assurance: 0.9,
        issuerAccepted: true,
        evidenceAccepted: true,
        attestationOk: false,
      })
    : null;
  const lowAssurance = policy.ok
    ? evaluateTrustPolicy({
        policy: policy.policy,
        assurance: 0.2,
        issuerAccepted: true,
        evidenceAccepted: true,
        attestationOk: true,
      })
    : null;
  exercises.push({
    id: "trust-policy",
    area: "Trust policy registry (AE) — versioned requirements",
    outcome: `policy v${policy.ok ? policy.policy.version : "—"} · satisfied=${satisfied?.ok} · attestation missing=${missingAttestation?.ok} · assurance below minimum=${lowAssurance?.ok} · issuerless policy refused=${!issuerlessPolicy.ok}`,
    state: null,
    refused:
      !issuerlessPolicy.ok &&
      satisfied?.ok === true &&
      missingAttestation?.ok === false &&
      lowAssurance?.ok === false,
  });

  const denyVerdict = evaluateZeroTrust({
    identityVerified: false,
    deviceTrusted: true,
    sessionValid: true,
    riskAction: "allow",
  });
  const challengeVerdict = evaluateZeroTrust({
    identityVerified: true,
    deviceTrusted: false,
    sessionValid: true,
    riskAction: "allow",
  });
  const breachVerdict = evaluateZeroTrust({
    identityVerified: true,
    deviceTrusted: true,
    sessionValid: true,
    riskAction: "quarantine",
  });
  const passVerdict = evaluateZeroTrust({
    identityVerified: true,
    deviceTrusted: true,
    sessionValid: true,
    riskAction: "allow",
  });
  exercises.push({
    id: "zero-trust",
    area: "Zero-trust evaluation (AK) — verdicts, never enforcement (BS)",
    outcome: `unverified identity=${denyVerdict.verdict} · untrusted device=${challengeVerdict.verdict} · risk quarantine=${breachVerdict.verdict} · all verified=${passVerdict.verdict}`,
    state: null,
    refused:
      denyVerdict.verdict === "deny" &&
      challengeVerdict.verdict === "challenge" &&
      passVerdict.verdict === "trusted",
  });

  return exercises;
}

/* ─────────────────────────────────────────────────────────────
 * What the fabric does NOT do yet — reported, never implied.
 * ────────────────────────────────────────────────────────────*/

/** Capabilities the document requires that have no executable enforcement. */
export function trustFabricGaps(): readonly TrustFabricGap[] {
  return [
    {
      id: "P09-1",
      area: "Cryptographic trust service (O, AX)",
      status: "DECLARED",
      detail:
        "No signature verification exists: verifyTrustAssertion takes integrityVerified as a caller-supplied boolean, so an assertion is only as trustworthy as whoever passed that flag. Keys, certificates and artifacts record fingerprints and hashes, but nothing verifies a signature.",
    },
    {
      id: "P09-2",
      area: "Attestation engine (R)",
      status: "DECLARED",
      detail:
        "Device, workload and agent trust accept attestation facts as input; nothing requests evidence, verifies it, or records the attestation lifecycle (request → evidence → verification → assertion → trust update).",
    },
    {
      id: "P09-3",
      area: "Trust graph traversal and revocation propagation (I, BR.11)",
      status: "DECLARED",
      detail:
        "Relationship records exist with 13 relationship types, but nothing traverses the graph: revocation marks one record, and dependent subjects are not re-evaluated because of it.",
    },
    {
      id: "P09-4",
      area: "Trust persistence (AO, AP)",
      status: "DECLARED",
      detail:
        "No trust tables exist. Subjects, assertions, evidence, revocations, keys, certificates, federations, delegations, anchors and policies are in-memory records with immutable ids; the durable substrate is the kernel event and audit ledger (Phase 33).",
    },
    {
      id: "P09-5",
      area: "Phase 08 consumption (AL, BS)",
      status: "DECLARED",
      detail:
        "The integration contract is stated (trust.get_state, get_score, verify_assertion, verify_provenance, check_attestation, check_revocation) and evaluateZeroTrust produces verdicts, but the Security Engine's gate does not call the fabric: zero import sites exist outside the four trust modules.",
    },
    {
      id: "P09-6",
      area: "Service trust and security posture records (G.16, Z)",
      status: "DECLARED",
      detail:
        "Score factors include security_posture, but there is no ServiceTrustRecord and no SecurityPostureRecord: posture enters only as a caller-supplied factor score.",
    },
    {
      id: "P09-7",
      area: "Trust telemetry and observability (BA)",
      status: "DECLARED",
      detail:
        "No trust metric is emitted: evaluation latency, state changes, assertion failures, revocations, attestation failures, provenance failures, certificate expiry and score instability are unmeasured (the shared finding P01-1/P03-3/P05-4/P08-5).",
    },
    {
      id: "P09-8",
      area: "Federation with real providers (AC, AD, AS)",
      status: "DECLARED",
      detail:
        "Federation relationships are recorded with parties, scope, accepted assertions, verification methods and expiry, but no external identity provider, certificate authority, signing infrastructure or webhook delivery is integrated.",
    },
    {
      id: "P09-9",
      area: "Trust agents, MCP surfaces and adversarial testing (AU, AT, BF, BG)",
      status: "DECLARED",
      detail:
        "No trust agent, MCP capability or adversarial suite (forged assertions, replay, chain poisoning, stale evidence) exists; the fabric's invariants are exercised in-process by this report and its unit suites only.",
    },
    {
      id: "P09-10",
      area: "Disaster recovery and trust-anchor rotation (BD, BL)",
      status: "DECLARED",
      detail:
        "No backup, restore test, anchor-rotation drill or compromised-issuer procedure has been performed; anchor rotation is supported by registering a new anchor, not by a rehearsed procedure.",
    },
  ];
}

/* ─────────────────────────────────────────────────────────────
 * The report — everything the fabric claims, exercised.
 * ────────────────────────────────────────────────────────────*/

/** Assemble the control-plane report: vocabulary, invariants, exercises, gaps. */
export function trustFabricReport(): TrustFabricReport {
  const invariants = trustInvariantChecks();
  const exercises = trustExercises();
  const gaps = trustFabricGaps();

  const usableStates = TRUST_STATES.filter((state) => isUsableTrustState(state));
  const phase08UsableStates = TRUST_STATES.filter((state) => trustStateToUsable(state));

  return {
    generatedAt: NOW,
    capability: TRUST_FABRIC_CAPABILITY,
    vocabulary: {
      states: TRUST_STATES.length,
      subjectTypes: TRUST_SUBJECT_TYPES.length,
      relationshipTypes: TRUST_RELATIONSHIP_TYPES.length,
      assertionTypes: TRUST_ASSERTION_TYPES.length,
      scoreFactors: TRUST_SCORE_FACTORS.length,
      revocationReasons: TRUST_REVOCATION_REASONS.length,
    },
    invariants,
    exercises,
    gaps,
    usability: {
      usableStates,
      phase08UsableStates,
      /** VERIFIED is usable to the fabric but not to the enforcement surface. */
      differOn: usableStates.filter((state) => !phase08UsableStates.includes(state)),
      terminalStates: TRUST_STATES.filter((state) =>
        TRUST_STATES.every((target) => !isTrustTransitionAllowed(state, target)),
      ),
    },
    verdict: {
      invariantCount: invariants.length,
      satisfied: invariants.filter((check) => check.holds).length,
      reported: gaps.length,
    },
  };
}
