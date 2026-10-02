/**
 * CoreGrid — Verification independence enforcement
 * (J-038 / V1CAP-060 / MISSION-R-92).
 *
 * E-027 structural law: a verification record whose verifier identity equals —
 * or is PROVEN EQUIVALENT to — the executor identity of the verified work is
 * INVALID and cannot be recorded. Independence is a STRUCTURAL property,
 * enforced as a typed rejection at capture time, never a downstream warning
 * (Constitution §21: AI output is untrusted; CONTROL-PLANE-09: critical claims
 * require appropriately independent verification).
 *
 * Declarative equivalence classes: independence is evaluated against an
 * injected registry of identity → effective-identity bindings (the delegation /
 * agent-identity model — AGENTS.md §5). Delegated work names its TRUE acting
 * identity: a worker identity delegated by an operator resolves to that
 * operator's identity, so the operator cannot "verify" the delegated work
 * under a second identity. An unregistered identity is its own effective identity.
 *
 * AI verifiers: an identity known to be an AI identity (registry kind
 * `ai_agent`, or an identityRef carrying AI provenance markers per the
 * evidence-capture marker vocabulary) may verify only NON-critical work.
 * Critical work requires a PROVABLY human verifier — registered with kind
 * `human` and carrying no AI marker. Work criticality REUSES the trust
 * fabric's severity vocabulary (`FailureSeverity`), so "critical" means the
 * same thing everywhere; critical work follows the same escalation law as
 * critical incidents: it ends at a human, never at the machine that did it.
 *
 * Every recorded verification carries its independence evidence: BOTH
 * identities, the equivalence-class resolution (resolved effective-identity refs) and
 * the verdict.
 *
 * Boundary: pure contract, no persistence, no wall-clock sampling (time is
 * always a supplied parameter), no state.
 */

import type { IdentityKind } from "./identity";
import { provenanceCarriesAiMarkers } from "./evidence/capture";
import { isContractTimestamp } from "./mission/mission-contract";
import type { VerificationDecisionName } from "./control-plane/foundation-mission";
import type { FailureSeverity } from "./reliability/failure-architecture";
import { isEnvelopeRef } from "./kernel/reality";

/* ─────────────────────────────────────────────────────────────
 * Work criticality (trust-fabric severity vocabulary — no fork)
 * ────────────────────────────────────────────────────────────*/

/** Reuses the trust fabric severity vocabulary (reliability/failure-architecture). */
export type WorkCriticality = FailureSeverity;

export const WORK_CRITICALITIES: readonly WorkCriticality[] = ["critical", "major", "minor"];

export function isWorkCriticality(value: unknown): value is WorkCriticality {
  return (WORK_CRITICALITIES as readonly unknown[]).includes(value);
}

/** Critical work requires a provably human verifier (enforced, not advisory). */
export function isCriticalWork(criticality: WorkCriticality): boolean {
  return criticality === "critical";
}

/* ─────────────────────────────────────────────────────────────
 * Identity → effective-identity equivalence-class registry
 * ────────────────────────────────────────────────────────────*/

/**
 * One equivalence-class binding: `identityRef` (the acting identity, possibly
 * a delegated worker or agent identity) resolves to `effectiveIdentityRef` (the
 * underlying identity it acts for, per the delegation / agent identity
 * model). The registry is declarative and injected — this module owns no
 * identities.
 */
export interface IdentityEquivalenceBinding {
  readonly identityRef: string;
  readonly effectiveIdentityRef: string;
  readonly identityKind: IdentityKind;
}

export type IdentityEquivalenceRegistry = readonly IdentityEquivalenceBinding[];

function findBinding(
  registry: IdentityEquivalenceRegistry,
  identityRef: string,
): IdentityEquivalenceBinding | null {
  return registry.find((binding) => binding.identityRef.trim() === identityRef) ?? null;
}

/**
 * Equivalence-class resolution: a registered identity resolves to its
 * declared effective identity; an unregistered identity IS its own effective identity (an
 * identity cannot alias itself to escape the comparison — aliasing requires a
 * recorded binding, which is exactly the delegation record).
 */
export function resolveEffectiveIdentity(
  registry: IdentityEquivalenceRegistry,
  identityRef: string,
): string {
  const trimmed = identityRef.trim();
  return findBinding(registry, trimmed)?.effectiveIdentityRef.trim() ?? trimmed;
}

/**
 * True when the identity is known to be an AI identity: registered with kind
 * `ai_agent`, OR its identityRef carries AI provenance markers (the evidence
 * capture marker vocabulary — a registry entry cannot launder an
 * `ai:`-prefixed identity into a human).
 */
export function identityIsAi(
  registry: IdentityEquivalenceRegistry,
  identityRef: string,
): boolean {
  const trimmed = identityRef.trim();
  const binding = findBinding(registry, trimmed);
  if (binding !== null && binding.identityKind === "ai_agent") return true;
  return provenanceCarriesAiMarkers({ source: trimmed });
}

/**
 * True when the identity is PROVABLY human: registered with kind `human` and
 * carrying no AI provenance marker. An unregistered identity is not provably
 * human — the absence of a registration is never evidence of humanity.
 */
export function identityIsProvablyHuman(
  registry: IdentityEquivalenceRegistry,
  identityRef: string,
): boolean {
  const trimmed = identityRef.trim();
  if (provenanceCarriesAiMarkers({ source: trimmed })) return false;
  return findBinding(registry, trimmed)?.identityKind === "human";
}

/* ─────────────────────────────────────────────────────────────
 * The independence check (structural, declarative)
 * ────────────────────────────────────────────────────────────*/

export type IndependenceRejectionCode =
  | "invalid_independence_input"
  | "self_verification_rejected"
  | "equivalent_identity_rejected"
  | "ai_verifier_rejected_on_critical"
  | "human_verifier_required";

/**
 * The independence evidence carried by every verification record: both
 * identities, the equivalence-class resolution of each (resolved effective
 * identity refs), the work criticality, and the verdict.
 */
export interface VerificationIndependenceEvidence {
  readonly verifierIdentityRef: string;
  readonly executorIdentityRef: string;
  readonly verifierEffectiveRef: string;
  readonly executorEffectiveRef: string;
  readonly workCriticality: WorkCriticality;
  readonly verdict: "independent" | "rejected";
  readonly rejectionCode: IndependenceRejectionCode | null;
}

export interface IndependenceCheckInput {
  readonly verifierIdentityRef: string;
  readonly executorIdentityRef: string;
  readonly workCriticality: WorkCriticality;
  readonly identityRegistry: IdentityEquivalenceRegistry;
}

export interface IndependenceCheckResult {
  readonly independent: boolean;
  readonly rejectionCode: IndependenceRejectionCode | null;
  readonly reason: string;
  readonly evidence: VerificationIndependenceEvidence;
}

/**
 * Evaluate verification independence for one verification act. Fail-closed
 * and deterministic:
 * - malformed identities or unknown criticality -> `invalid_independence_input`;
 * - verifier identity equals the executor identity -> `self_verification_rejected`;
 * - both identities resolve to the SAME effective identity (delegated executor naming
 *   its true acting identity) -> `equivalent_identity_rejected`;
 * - critical work verified by an AI identity -> `ai_verifier_rejected_on_critical`;
 * - critical work whose verifier is not PROVABLY human -> `human_verifier_required`.
 */
export function checkVerificationIndependence(input: IndependenceCheckInput): IndependenceCheckResult {
  const build = (
    independent: boolean,
    rejectionCode: IndependenceRejectionCode | null,
    reason: string,
    verifierIdentityRef: string,
    executorIdentityRef: string,
    workCriticality: WorkCriticality,
    verifierEffectiveRef: string,
    executorEffectiveRef: string,
  ): IndependenceCheckResult => ({
    independent,
    rejectionCode,
    reason,
    evidence: {
      verifierIdentityRef,
      executorIdentityRef,
      verifierEffectiveRef,
      executorEffectiveRef,
      workCriticality,
      verdict: independent ? "independent" : "rejected",
      rejectionCode,
    },
  });

  if (!isWorkCriticality(input.workCriticality)) {
    return build(
      false,
      "invalid_independence_input",
      `work criticality "${String(input.workCriticality)}" is not a registered work criticality`,
      "",
      "",
      "minor",
      "",
      "",
    );
  }
  const verifierIdentityRef = typeof input.verifierIdentityRef === "string" ? input.verifierIdentityRef.trim() : "";
  const executorIdentityRef =
    typeof input.executorIdentityRef === "string" ? input.executorIdentityRef.trim() : "";
  if (
    verifierIdentityRef.length === 0 ||
    executorIdentityRef.length === 0 ||
    !isEnvelopeRef(verifierIdentityRef, 160) ||
    !isEnvelopeRef(executorIdentityRef, 160)
  ) {
    return build(
      false,
      "invalid_independence_input",
      "independence check requires non-empty verifier and executor identity refs (1–160 characters)",
      verifierIdentityRef,
      executorIdentityRef,
      input.workCriticality,
      "",
      "",
    );
  }

  const verifierEffectiveRef = resolveEffectiveIdentity(input.identityRegistry, verifierIdentityRef);
  const executorEffectiveRef = resolveEffectiveIdentity(input.identityRegistry, executorIdentityRef);

  if (verifierIdentityRef === executorIdentityRef) {
    return build(
      false,
      "self_verification_rejected",
      `verifier identity "${verifierIdentityRef}" equals the executor identity of the verified work — self-verification is invalid (E-027 structural law), not a warning`,
      verifierIdentityRef,
      executorIdentityRef,
      input.workCriticality,
      verifierEffectiveRef,
      executorEffectiveRef,
    );
  }
  if (verifierEffectiveRef === executorEffectiveRef) {
    return build(
      false,
      "equivalent_identity_rejected",
      `verifier identity "${verifierIdentityRef}" resolves to effective identity "${verifierEffectiveRef}", which is the acting identity of the verified work's executor (executor "${executorIdentityRef}") — equivalent identities cannot verify each other's work`,
      verifierIdentityRef,
      executorIdentityRef,
      input.workCriticality,
      verifierEffectiveRef,
      executorEffectiveRef,
    );
  }
  if (isCriticalWork(input.workCriticality)) {
    if (identityIsAi(input.identityRegistry, verifierIdentityRef)) {
      return build(
        false,
        "ai_verifier_rejected_on_critical",
        `verifier "${verifierIdentityRef}" is an AI identity — AI verifiers may verify only non-critical work; critical work requires a human verifier (Constitution §21)`,
        verifierIdentityRef,
        executorIdentityRef,
        input.workCriticality,
        verifierEffectiveRef,
        executorEffectiveRef,
      );
    }
    if (!identityIsProvablyHuman(input.identityRegistry, verifierIdentityRef)) {
      return build(
        false,
        "human_verifier_required",
        `verifier "${verifierIdentityRef}" is not provably human (no human-kind registry binding) — critical work requires a provably human verifier`,
        verifierIdentityRef,
        executorIdentityRef,
        input.workCriticality,
        verifierEffectiveRef,
        executorEffectiveRef,
      );
    }
  }

  return build(
    true,
    null,
    "verifier identity is structurally independent of the executor identity",
    verifierIdentityRef,
    executorIdentityRef,
    input.workCriticality,
    verifierEffectiveRef,
    executorEffectiveRef,
  );
}

/* ─────────────────────────────────────────────────────────────
 * Typed rejection at capture time
 * ────────────────────────────────────────────────────────────*/

export type VerificationRecordErrorCode = IndependenceRejectionCode;

export class VerificationIndependenceError extends Error {
  readonly code: VerificationRecordErrorCode;
  readonly evidence: VerificationIndependenceEvidence;

  constructor(code: VerificationRecordErrorCode, message: string, evidence: VerificationIndependenceEvidence) {
    super(message);
    this.name = "VerificationIndependenceError";
    this.code = code;
    this.evidence = evidence;
  }
}

/* ─────────────────────────────────────────────────────────────
 * Verification records
 * ────────────────────────────────────────────────────────────*/

/**
 * An independent verification record. The decision vocabulary is the ONE
 * canonical verification vocabulary (`VerificationDecisionName` — mechanism
 * 09), reused, not forked. Every record carries its independence evidence.
 */
export interface VerificationRecord {
  readonly verificationId: string;
  readonly executionId: string;
  readonly tenantId: string;
  readonly decision: VerificationDecisionName;
  readonly reason: string;
  readonly workCriticality: WorkCriticality;
  readonly verifiedAt: string;
  /** The executor identity of the verified work (who did the work). */
  readonly executorIdentityRef: string;
  /** The verifier identity (who verified the work). */
  readonly verifierIdentityRef: string;
  readonly evidenceIds: readonly string[];
  /** Independence evidence: both identities + equivalence resolution + verdict. */
  readonly independence: VerificationIndependenceEvidence;
}

export interface VerificationRecordInput {
  verificationId: string;
  executionId: string;
  tenantId: string;
  decision: VerificationDecisionName;
  reason: string;
  workCriticality: WorkCriticality;
  verifiedAt: string;
  executorIdentityRef: string;
  verifierIdentityRef: string;
  evidenceIds?: readonly string[];
  identityRegistry: IdentityEquivalenceRegistry;
}

/**
 * Capture one verification record. A record whose verification fails the
 * independence check is INVALID and CANNOT be recorded: the rejection is a
 * typed `VerificationIndependenceError` at capture time (fail closed), never
 * a downstream warning. Malformed records are likewise rejected at capture.
 */
export function captureVerificationRecord(input: VerificationRecordInput): VerificationRecord {
  if (!isEnvelopeRef(input.verificationId, 160)) {
    throw new VerificationIndependenceError(
      "invalid_independence_input",
      "verificationId must be 1–160 characters",
      emptyEvidence(),
    );
  }
  if (!isEnvelopeRef(input.executionId, 160)) {
    throw new VerificationIndependenceError(
      "invalid_independence_input",
      "executionId must be 1–160 characters",
      emptyEvidence(),
    );
  }
  if (!isEnvelopeRef(input.tenantId, 160)) {
    throw new VerificationIndependenceError(
      "invalid_independence_input",
      "tenantId must be 1–160 characters",
      emptyEvidence(),
    );
  }
  if (input.reason.trim().length === 0) {
    throw new VerificationIndependenceError(
      "invalid_independence_input",
      "a verification record requires a non-empty reason",
      emptyEvidence(),
    );
  }
  if (!isContractTimestamp(input.verifiedAt)) {
    throw new VerificationIndependenceError(
      "invalid_independence_input",
      "verifiedAt must be a parseable timestamp",
      emptyEvidence(),
    );
  }
  const evidenceIds = input.evidenceIds ?? [];
  for (const id of evidenceIds) {
    if (!isEnvelopeRef(id, 160)) {
      throw new VerificationIndependenceError(
        "invalid_independence_input",
        "evidence ids must be 1–160 characters",
        emptyEvidence(),
      );
    }
  }

  // THE structural gate (E-027): independence is checked BEFORE the record
  // exists — an invalid record is never built, never recorded, never warned.
  const check = checkVerificationIndependence({
    verifierIdentityRef: input.verifierIdentityRef,
    executorIdentityRef: input.executorIdentityRef,
    workCriticality: input.workCriticality,
    identityRegistry: input.identityRegistry,
  });
  if (!check.independent || check.rejectionCode !== null || check.evidence.verifierIdentityRef === "") {
    throw new VerificationIndependenceError(
      check.rejectionCode ?? "invalid_independence_input",
      `verification record rejected: ${check.reason}`,
      check.evidence,
    );
  }

  return {
    verificationId: input.verificationId.trim(),
    executionId: input.executionId.trim(),
    tenantId: input.tenantId.trim(),
    decision: input.decision,
    reason: input.reason.trim(),
    workCriticality: input.workCriticality,
    verifiedAt: input.verifiedAt.trim(),
    executorIdentityRef: input.executorIdentityRef.trim(),
    verifierIdentityRef: input.verifierIdentityRef.trim(),
    evidenceIds: [...evidenceIds],
    independence: check.evidence,
  };
}

function emptyEvidence(): VerificationIndependenceEvidence {
  return {
    verifierIdentityRef: "",
    executorIdentityRef: "",
    verifierEffectiveRef: "",
    executorEffectiveRef: "",
    workCriticality: "minor",
    verdict: "rejected",
    rejectionCode: "invalid_independence_input",
  };
}
