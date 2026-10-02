/**
 * CoreGrid — reasoning provenance & intelligence snapshots (J-015, V1CAP-029,
 * MISSION-R-33; Constitution §9 canonical truth, §12 data provenance, §20 AI
 * gateway, §21 AI output trust).
 *
 * Every AI output that leaves the gateway carries an INTELLIGENCE SNAPSHOT:
 * an immutable, serializable record of
 *
 * - WHICH model produced it — the model-registry id and its vendor-neutral
 *   provider class (§25);
 * - WHICH context version it drew on — the context package's trace id
 *   (context-assembly J-011) plus a deterministic content digest of the exact
 *   assembled context that entered the invocation;
 * - WHICH policy/routing decision produced it — the routing rationale chain
 *   (registry route resolution, requirement filtering, health gates, fallback
 *   attempts) or the explicit legacy declared path;
 * - token/cost attribution — the metered usage of THIS output;
 * - a deterministic output digest — the intelligence snapshot's content
 *   identity, plus a snapshot id digesting the whole snapshot body.
 *
 * Design laws honored here:
 * - §9 (Reality vs Intelligence): a snapshot is derived-intelligence
 *   provenance, never canonical truth. It classifies its output as the
 *   quarantine evidence class "generated" (J-034) and carries the kernel
 *   provenance fields with `generatedByAi: true`, so downstream Evidence
 *   capture classes AI output correctly and Verification can audit decisions
 *   (E-017: AI output can never silently become direct observation).
 * - §12 (data provenance): every snapshot answers where the output came from,
 *   who produced it, whether it was AI-generated, and whether it is verified
 *   (`false` — AI output is untrusted by default, §21).
 * - §21 (AI output trust): the snapshot records what happened; it validates
 *   nothing. Promotion of AI-derived material is Evidence's recorded act.
 * - Fail-closed (envelope law, V1CAP-002): an output that cannot carry a
 *   complete snapshot is not publishable intelligence — the builder and the
 *   downstream validation gate reject incomplete provenance with typed
 *   errors. Unattributed output is structurally impossible past this gate.
 * - Immutability: built snapshots are deep-frozen; nothing mutates them in
 *   place. Supersession happens by producing a new snapshot.
 * - Purity: no I/O, no environment reads, no wall-clock sampling — `now`
 *   (recordedAt) is always a supplied parameter; digests are deterministic
 *   SHA-256 over canonical JSON (stable key order).
 */

import { createHash } from "node:crypto";

/** Snapshot contract version (bump on breaking shape changes). */
export const INTELLIGENCE_SNAPSHOT_SCHEMA_VERSION = "1.0";

/**
 * The evidence class (J-034 vocabulary) every AI output is captured as:
 * a quarantine class — never direct_observation without a recorded
 * promotion act.
 */
export const INTELLIGENCE_EVIDENCE_CLASS = "generated";

/**
 * Provenance source marker carried on every snapshot. Contains the
 * `model-generated` AI-provenance marker (evidence/capture AI_PROVENANCE_
 * MARKERS) so class-laundering detection recognizes AI origin even when the
 * explicit flag is dropped in transit.
 */
export const INTELLIGENCE_PROVENANCE_SOURCE = "ai-gateway:model-generated";

/* ─────────────────────────────────────────────────────────────
 * Typed rejection
 * ────────────────────────────────────────────────────────────*/

export type ReasoningProvenanceErrorCode =
  | "missing_provenance_field"
  | "invalid_provenance_field";

export class ReasoningProvenanceError extends Error {
  readonly code: ReasoningProvenanceErrorCode;
  /** The snapshot field that failed the fail-closed gate. */
  readonly field: string;

  constructor(code: ReasoningProvenanceErrorCode, field: string, message: string) {
    super(message);
    this.name = "ReasoningProvenanceError";
    this.code = code;
    this.field = field;
  }
}

/* ─────────────────────────────────────────────────────────────
 * Snapshot vocabulary
 * ────────────────────────────────────────────────────────────*/

/** WHICH model: registry model id + vendor-neutral provider class (§25). */
export interface SnapshotModelAttribution {
  readonly id: string;
  /** Null on the legacy declared path (no registry wired). */
  readonly providerClass: string | null;
}

/** WHICH context version: trace id + digest of the exact assembled context. */
export interface SnapshotContextVersion {
  /** The context package's trace id (context-assembly J-011); null when the caller declared no governed context package. */
  readonly traceId: string | null;
  /** Deterministic digest of the exact assembled context; null when none was declared. */
  readonly contentDigest: string | null;
}

/** The routing rationale chain: every policy decision that produced the output. */
export type RoutingRationaleStage =
  | "legacy_declared_path"
  | "registry_route_resolved"
  | "requirements_filter"
  | "health_gate_skip"
  | "fallback_attempt_failed"
  | "provider_success";

export interface RoutingRationaleStep {
  readonly stage: RoutingRationaleStage;
  /** The model the step concerns; null when the step is route-level. */
  readonly model: string | null;
  readonly detail: string;
}

export interface SnapshotRoutingDecision {
  /** True when the model was resolved through the model registry (J-014). */
  readonly routedViaRegistry: boolean;
  readonly rationale: readonly RoutingRationaleStep[];
}

/** WHO the output is attributed to (tenant/actor/agent/mission/purpose). */
export interface SnapshotAttribution {
  readonly tenantRef: string;
  readonly actorRef: string;
  readonly agentRef: string | null;
  readonly missionRef: string | null;
  readonly purpose: string;
}

/** Token/cost attribution of THIS output (metering Part 49). */
export interface SnapshotUsageAttribution {
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly estimatedCostUsd: number | null;
}

/**
 * Kernel-envelope provenance fields (V1CAP-002 shape): the snapshot is
 * envelope-bearing so it can be stamped onto persistent kernel objects and
 * evidence records without translation.
 */
export interface SnapshotProvenance {
  readonly source: string;
  readonly sourceRef: string | null;
  readonly recordedBy: string | null;
  readonly originTenantId: string | null;
  readonly generatedByAi: true;
  /** AI output is untrusted by default (§21); only a recorded validation act verifies it. */
  readonly verified: false;
}

/* ─────────────────────────────────────────────────────────────
 * Deterministic canonical serialization + digests
 * ────────────────────────────────────────────────────────────*/

/** Stable-key-order JSON: equal content always serializes identically. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`)
    .join(",")}}`;
}

/** Deterministic SHA-256 content digest, prefixed with its algorithm. */
export function digestContent(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

/* ─────────────────────────────────────────────────────────────
 * Build input
 * ────────────────────────────────────────────────────────────*/

export interface IntelligenceSnapshotInput {
  tenantRef: string;
  actorRef: string;
  agentRef?: string | null;
  missionRef?: string | null;
  purpose: string;
  model: SnapshotModelAttribution;
  /**
   * The governed context package the invocation drew on. When omitted or
   * null, the snapshot records an EXPLICIT absent context version (null
   * trace id and digest — never silently assumed to be empty).
   */
  contextVersion?: { traceId?: string | null; assembledContent?: string | null } | null;
  routing: SnapshotRoutingDecision;
  usage: SnapshotUsageAttribution;
  /** The exact AI output; digested deterministically into `outputDigest`. */
  output: unknown;
  /** Snapshot instant (ISO-8601, supplied — purity, never wall-clock sampled). */
  recordedAt: string;
}

export interface IntelligenceSnapshot {
  readonly schemaVersion: string;
  /** Deterministic identity of the whole snapshot body (self-digest, id excluded). */
  readonly snapshotId: string;
  /** J-034 marker: AI output is quarantine-class "generated" evidence. */
  readonly evidenceClass: typeof INTELLIGENCE_EVIDENCE_CLASS;
  readonly generatedByAi: true;
  readonly model: SnapshotModelAttribution;
  readonly contextVersion: SnapshotContextVersion;
  readonly routing: SnapshotRoutingDecision;
  readonly attribution: SnapshotAttribution;
  readonly usage: SnapshotUsageAttribution;
  /** Deterministic digest of the exact output payload. */
  readonly outputDigest: string;
  readonly provenance: SnapshotProvenance;
  readonly recordedAt: string;
}

/* ─────────────────────────────────────────────────────────────
 * Fail-closed field gates
 * ────────────────────────────────────────────────────────────*/

function requireNonEmptyString(field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ReasoningProvenanceError(
      "missing_provenance_field",
      field,
      `intelligence snapshot requires a non-empty ${field}`,
    );
  }
  return value.trim();
}

function requireOptionalNonEmptyString(field: string, value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ReasoningProvenanceError(
      "invalid_provenance_field",
      field,
      `intelligence snapshot ${field} must be null or a non-empty string`,
    );
  }
  return value.trim();
}

function requireFiniteNonNegative(field: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ReasoningProvenanceError(
      "invalid_provenance_field",
      field,
      `intelligence snapshot ${field} must be a finite non-negative number`,
    );
  }
  return value;
}

function requireOptionalFiniteNonNegative(field: string, value: unknown): number | null {
  if (value == null) return null;
  return requireFiniteNonNegative(field, value);
}

function requireRationale(value: unknown): RoutingRationaleStep[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ReasoningProvenanceError(
      "missing_provenance_field",
      "routing.rationale",
      "intelligence snapshot requires a non-empty routing rationale chain — an output must name the policy decision that produced it",
    );
  }
  return value.map((step, index) => {
    const entry = step as Partial<RoutingRationaleStep> | null;
    if (typeof entry !== "object" || entry === null) {
      throw new ReasoningProvenanceError(
        "invalid_provenance_field",
        `routing.rationale[${index}]`,
        "rationale steps must be objects",
      );
    }
    if (typeof entry.stage !== "string" || entry.stage.trim().length === 0) {
      throw new ReasoningProvenanceError(
        "invalid_provenance_field",
        `routing.rationale[${index}].stage`,
        "rationale steps require a non-empty stage",
      );
    }
    if (typeof entry.detail !== "string" || entry.detail.trim().length === 0) {
      throw new ReasoningProvenanceError(
        "invalid_provenance_field",
        `routing.rationale[${index}].detail`,
        "rationale steps require a non-empty detail",
      );
    }
    return {
      stage: entry.stage.trim() as RoutingRationaleStage,
      model: requireOptionalNonEmptyString(`routing.rationale[${index}].model`, entry.model),
      detail: entry.detail.trim(),
    };
  });
}

function requireRecordedAt(value: unknown): string {
  const recordedAt = requireNonEmptyString("recordedAt", value);
  if (Number.isNaN(Date.parse(recordedAt))) {
    throw new ReasoningProvenanceError(
      "invalid_provenance_field",
      "recordedAt",
      "intelligence snapshot recordedAt must be a valid ISO-8601 timestamp",
    );
  }
  return recordedAt;
}

/**
 * Build one immutable intelligence snapshot. Fail closed: any missing or
 * malformed provenance field is a typed rejection, never a guess — an
 * incomplete snapshot can never silently represent AI output.
 */
export function buildIntelligenceSnapshot(input: IntelligenceSnapshotInput): IntelligenceSnapshot {
  const model = input.model as Partial<SnapshotModelAttribution> | null | undefined;
  if (typeof model !== "object" || model === null) {
    throw new ReasoningProvenanceError(
      "missing_provenance_field",
      "model",
      "intelligence snapshot requires a model attribution",
    );
  }
  const modelId = requireNonEmptyString("model.id", model.id);
  const providerClass = requireOptionalNonEmptyString("model.providerClass", model.providerClass);

  const context = input.contextVersion ?? null;
  const traceId = requireOptionalNonEmptyString("contextVersion.traceId", context?.traceId);
  const assembledContent = requireOptionalNonEmptyString(
    "contextVersion.assembledContent",
    context?.assembledContent,
  );

  const usage = input.usage as Partial<SnapshotUsageAttribution> | null | undefined;
  if (typeof usage !== "object" || usage === null) {
    throw new ReasoningProvenanceError(
      "missing_provenance_field",
      "usage",
      "intelligence snapshot requires usage attribution",
    );
  }

  const routing = input.routing as Partial<SnapshotRoutingDecision> | null | undefined;
  if (typeof routing !== "object" || routing === null) {
    throw new ReasoningProvenanceError(
      "missing_provenance_field",
      "routing",
      "intelligence snapshot requires a routing decision",
    );
  }

  const snapshot: IntelligenceSnapshot = {
    schemaVersion: INTELLIGENCE_SNAPSHOT_SCHEMA_VERSION,
    snapshotId: "",
    evidenceClass: INTELLIGENCE_EVIDENCE_CLASS,
    generatedByAi: true,
    model: { id: modelId, providerClass },
    contextVersion: {
      traceId,
      contentDigest: assembledContent === null ? null : digestContent(assembledContent),
    },
    routing: {
      routedViaRegistry: routing.routedViaRegistry === true,
      rationale: Object.freeze(requireRationale(routing.rationale)),
    },
    attribution: {
      tenantRef: requireNonEmptyString("tenantRef", input.tenantRef),
      actorRef: requireNonEmptyString("actorRef", input.actorRef),
      agentRef: requireOptionalNonEmptyString("agentRef", input.agentRef),
      missionRef: requireOptionalNonEmptyString("missionRef", input.missionRef),
      purpose: requireNonEmptyString("purpose", input.purpose),
    },
    usage: {
      tokensIn: requireFiniteNonNegative("usage.tokensIn", usage.tokensIn),
      tokensOut: requireFiniteNonNegative("usage.tokensOut", usage.tokensOut),
      estimatedCostUsd: requireOptionalFiniteNonNegative(
        "usage.estimatedCostUsd",
        usage.estimatedCostUsd,
      ),
    },
    outputDigest: digestContent(input.output),
    provenance: {
      source: INTELLIGENCE_PROVENANCE_SOURCE,
      sourceRef: null,
      recordedBy: requireOptionalNonEmptyString("recordedBy", input.agentRef ?? input.actorRef),
      originTenantId: requireNonEmptyString("tenantRef", input.tenantRef),
      generatedByAi: true,
      verified: false,
    },
    recordedAt: requireRecordedAt(input.recordedAt),
  };

  return deepFreeze({ ...snapshot, snapshotId: digestContent(snapshot) });
}

/* ─────────────────────────────────────────────────────────────
 * Downstream fail-closed gate (Evidence -> Verification)
 * ────────────────────────────────────────────────────────────*/

/**
 * Fail-closed conformance gate for any value claiming to be an intelligence
 * snapshot (the unit Evidence capture and later Verification consume). A
 * value missing any snapshot field — model, context version, routing
 * decision, attribution, usage, output digest, AI markers — is REJECTED with
 * a typed error, so unattributed output can never pass downstream. Returns
 * the value narrowed to IntelligenceSnapshot.
 */
export function validateIntelligenceSnapshot(value: unknown): IntelligenceSnapshot {
  const snapshot = value as Partial<IntelligenceSnapshot> | null | undefined;
  if (typeof snapshot !== "object" || snapshot === null) {
    throw new ReasoningProvenanceError(
      "missing_provenance_field",
      "snapshot",
      "value is not an intelligence snapshot (no snapshot object)",
    );
  }
  if (typeof snapshot.schemaVersion !== "string" || snapshot.schemaVersion.length === 0) {
    throw new ReasoningProvenanceError(
      "missing_provenance_field",
      "schemaVersion",
      "intelligence snapshot is missing schemaVersion",
    );
  }
  if (typeof snapshot.snapshotId !== "string" || snapshot.snapshotId.trim().length === 0) {
    throw new ReasoningProvenanceError(
      "missing_provenance_field",
      "snapshotId",
      "intelligence snapshot is missing snapshotId",
    );
  }
  if (snapshot.evidenceClass !== INTELLIGENCE_EVIDENCE_CLASS) {
    throw new ReasoningProvenanceError(
      "missing_provenance_field",
      "evidenceClass",
      `intelligence snapshot is missing the generated evidence-class marker (expected "${INTELLIGENCE_EVIDENCE_CLASS}")`,
    );
  }
  if (snapshot.generatedByAi !== true) {
    throw new ReasoningProvenanceError(
      "missing_provenance_field",
      "generatedByAi",
      "intelligence snapshot is missing the generatedByAi marker — AI provenance is not declarable as absent",
    );
  }
  const model = snapshot.model as Partial<SnapshotModelAttribution> | null | undefined;
  if (typeof model !== "object" || model === null || typeof model.id !== "string" || model.id.trim().length === 0) {
    throw new ReasoningProvenanceError(
      "missing_provenance_field",
      "model",
      "intelligence snapshot is missing the model attribution",
    );
  }
  const context = snapshot.contextVersion as Partial<SnapshotContextVersion> | null | undefined;
  if (
    typeof context !== "object" ||
    context === null ||
    !("traceId" in context) ||
    !("contentDigest" in context)
  ) {
    throw new ReasoningProvenanceError(
      "missing_provenance_field",
      "contextVersion",
      "intelligence snapshot is missing the context version (traceId + contentDigest must be stated, null when declared absent)",
    );
  }
  const routing = snapshot.routing as Partial<SnapshotRoutingDecision> | null | undefined;
  if (
    typeof routing !== "object" ||
    routing === null ||
    typeof routing.routedViaRegistry !== "boolean" ||
    !Array.isArray(routing.rationale) ||
    routing.rationale.length === 0
  ) {
    throw new ReasoningProvenanceError(
      "missing_provenance_field",
      "routing",
      "intelligence snapshot is missing the routing decision (routedViaRegistry + non-empty rationale chain required)",
    );
  }
  const attribution = snapshot.attribution as Partial<SnapshotAttribution> | null | undefined;
  if (typeof attribution !== "object" || attribution === null) {
    throw new ReasoningProvenanceError(
      "missing_provenance_field",
      "attribution",
      "intelligence snapshot is missing attribution",
    );
  }
  requireNonEmptyString("attribution.tenantRef", attribution.tenantRef);
  requireNonEmptyString("attribution.actorRef", attribution.actorRef);
  requireNonEmptyString("attribution.purpose", attribution.purpose);
  const usage = snapshot.usage as Partial<SnapshotUsageAttribution> | null | undefined;
  if (typeof usage !== "object" || usage === null) {
    throw new ReasoningProvenanceError(
      "missing_provenance_field",
      "usage",
      "intelligence snapshot is missing usage attribution",
    );
  }
  requireFiniteNonNegative("usage.tokensIn", usage.tokensIn);
  requireFiniteNonNegative("usage.tokensOut", usage.tokensOut);
  requireOptionalFiniteNonNegative("usage.estimatedCostUsd", usage.estimatedCostUsd);
  if (typeof snapshot.outputDigest !== "string" || snapshot.outputDigest.trim().length === 0) {
    throw new ReasoningProvenanceError(
      "missing_provenance_field",
      "outputDigest",
      "intelligence snapshot is missing the output digest",
    );
  }
  const provenance = snapshot.provenance as Partial<SnapshotProvenance> | null | undefined;
  if (
    typeof provenance !== "object" ||
    provenance === null ||
    provenance.generatedByAi !== true
  ) {
    throw new ReasoningProvenanceError(
      "missing_provenance_field",
      "provenance",
      "intelligence snapshot is missing envelope provenance with generatedByAi: true",
    );
  }
  requireRecordedAt(snapshot.recordedAt);
  return snapshot as IntelligenceSnapshot;
}

/* ─────────────────────────────────────────────────────────────
 * Immutability
 * ────────────────────────────────────────────────────────────*/

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const member of Object.values(value as Record<string, unknown>)) {
      deepFreeze(member);
    }
    return Object.freeze(value);
  }
  return value;
}
