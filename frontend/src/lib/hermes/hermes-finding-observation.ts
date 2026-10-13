/**
 * CoreGrid — Hermes FINDING → JarvisObservation translator (honest stamps).
 *
 * Translates already-stamped Hermes findings into JarvisObservation objects.
 * This module never runs Hermes, never invents findings, never starts a
 * resident process, and never un-freezes Phase 52: it is a pure mapping
 * over evidence Hermes already produced.
 *
 * Honesty law (§9 Intelligence, never Reality):
 * - Empty findings or a blank tenantRef yield zero observations.
 * - Findings with a blank findingId / subjectRef / summary / observedAt
 *   are skipped — never synthesized.
 * - Cross-tenant findings (tenantId !== tenantRef) are dropped.
 * - Unknown kinds are skipped; they are not invented into DETECTABLE_CONDITIONS.
 * - Missing, empty, or all-blank evidenceRefs are skipped. No evidence = not a stamp.
 * - Invalid severity is skipped.
 * - claimClass is NEVER VERIFIED and NEVER EXECUTED. Findings are Intelligence
 *   even when claim.verified is true (that flag is about the underlying DB
 *   fact, not the finding):
 *     OBSERVED when claim.source !== "hermes_memory" and evidence exists
 *     INFERRED when claim.source === "hermes_memory"
 *
 * Kind mapping onto DETECTABLE_CONDITIONS — only honest matches; everything
 * else keeps a Hermes-prefixed kind (briefing only, no Jarvis mission):
 *   mission_stuck       → mission_timeout            (stuck/stale/lease expired IS a timeout)
 *   worker_quarantined  → worker_failure             (quarantined after failures IS worker failure)
 *   mission_failed      → hermes_mission_failed      (Hermes owns operational repair)
 *   mission_denied      → hermes_mission_denied
 *   evidence_unverified → hermes_evidence_unverified (unverified evidence is not a regression condition)
 *   worker_suspended    → hermes_worker_suspended
 *
 * Structural source type only — do not import the Hermes cycle driver
 * (Hermes remains the operational driver). Never import server-only modules.
 *
 * Pure in-process contract: no I/O, no vendors, no secrets, no invented metrics.
 */

import type { JarvisObservation } from "../jarvis/enterprise-loop";

export const HERMES_FINDING_OBSERVATION_SOURCE = "hermes-finding" as const;

export const HERMES_FINDING_KINDS = [
  "mission_stuck",
  "mission_failed",
  "mission_denied",
  "evidence_unverified",
  "worker_quarantined",
  "worker_suspended",
] as const;
export type HermesFindingKindName = (typeof HERMES_FINDING_KINDS)[number];

export interface HermesFindingObservationSource {
  readonly findingId: string;
  readonly kind: HermesFindingKindName | string;
  readonly tenantId: string;
  readonly subjectRef: string;
  readonly severity: "info" | "warning" | "critical";
  readonly summary: string;
  readonly evidenceRefs: readonly string[];
  readonly observedAt: string;
  readonly claim: {
    readonly source: string;
    readonly sourceRef: string;
    readonly observedAt: string;
    readonly verified: boolean;
    readonly confidence: string;
    readonly claim: string;
  };
}

const HERMES_FINDING_KIND_SET: ReadonlySet<string> = new Set(HERMES_FINDING_KINDS);

const INCIDENT_SEVERITIES: ReadonlySet<string> = new Set(["info", "warning", "critical"]);

const SUMMARY_BOUND = 300;

const HERMES_MEMORY_SOURCE = "hermes_memory";

function isBlank(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

function isHermesFindingKind(value: unknown): value is HermesFindingKindName {
  return typeof value === "string" && HERMES_FINDING_KIND_SET.has(value);
}

function isIncidentSeverity(value: unknown): value is JarvisObservation["severity"] {
  return typeof value === "string" && INCIDENT_SEVERITIES.has(value);
}

function firstNonBlankEvidenceRef(refs: unknown): string | null {
  if (!Array.isArray(refs) || refs.length === 0) return null;
  for (const ref of refs) {
    if (typeof ref === "string" && ref.trim().length > 0) return ref;
  }
  return null;
}

function mapKind(kind: HermesFindingKindName): string {
  switch (kind) {
    case "mission_stuck":
      return "mission_timeout";
    case "worker_quarantined":
      return "worker_failure";
    case "mission_failed":
      return "hermes_mission_failed";
    case "mission_denied":
      return "hermes_mission_denied";
    case "evidence_unverified":
      return "hermes_evidence_unverified";
    case "worker_suspended":
      return "hermes_worker_suspended";
  }
}

function claimClassOf(finding: HermesFindingObservationSource): JarvisObservation["claimClass"] {
  const claim = finding.claim;
  if (claim !== null && typeof claim === "object" && claim.source === HERMES_MEMORY_SOURCE) {
    return "INFERRED";
  }
  return "OBSERVED";
}

function stampOne(
  tenantRef: string,
  finding: HermesFindingObservationSource,
): JarvisObservation | null {
  if (
    isBlank(finding.findingId) ||
    isBlank(finding.subjectRef) ||
    isBlank(finding.summary) ||
    isBlank(finding.observedAt)
  ) {
    return null;
  }
  if (typeof finding.tenantId !== "string" || finding.tenantId !== tenantRef) {
    return null;
  }
  if (!isHermesFindingKind(finding.kind)) {
    return null;
  }
  if (!isIncidentSeverity(finding.severity)) {
    return null;
  }
  const evidenceRef = firstNonBlankEvidenceRef(finding.evidenceRefs);
  if (evidenceRef === null) {
    return null;
  }
  return {
    observationId: `hermes-finding:${finding.findingId}`,
    tenantRef,
    at: finding.observedAt,
    kind: mapKind(finding.kind),
    severity: finding.severity,
    summary: finding.summary.slice(0, SUMMARY_BOUND),
    evidenceRef,
    claimClass: claimClassOf(finding),
  };
}

export function stampHermesFindings(input: {
  readonly tenantRef: string;
  readonly findings: readonly HermesFindingObservationSource[];
}): readonly JarvisObservation[] {
  if (input === null || typeof input !== "object") return [];
  const tenantRef = typeof input.tenantRef === "string" ? input.tenantRef : "";
  if (tenantRef.trim().length === 0) return [];
  if (!Array.isArray(input.findings) || input.findings.length === 0) return [];

  const observations: JarvisObservation[] = [];
  for (const finding of input.findings) {
    if (finding === null || typeof finding !== "object") continue;
    const observation = stampOne(tenantRef, finding);
    if (observation !== null) observations.push(observation);
  }
  return observations;
}
