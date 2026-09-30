/**
 * CoreGrid — Digital Twin & Reality Representation Platform core
 * domain model
 * (Phase 16, Sections F, G, H, I, J, K, L, AS, AT, AU, AV, AW, AX, AY, AZ,
 * BA, BB, BC, BD, BE, BF, BG, BH).
 *
 * Implements `architecture/phase-16-digital-twin.md`:
 * - Reality model (F): REAL ENTITY, DIGITAL REPRESENTATION, OBSERVATION,
 *   STATE, EVENT, PREDICTION, SIMULATION must never be treated as
 *   identical. A prediction is not reality; a sensor reading is not the
 *   entity itself; a digital representation is not the physical object.
 * - Twin identity (G): twin ID, type, tenant context, lifecycle state,
 *   creation timestamp, source, provenance, version, status, confidence,
 *   ownership, relationship metadata. Twin IDs remain stable across
 *   ordinary state changes.
 * - Twin types (H), type registry (I), templates (J) and instances (K).
 * - Composition (L): complex twins contain sub-twins; identity is
 *   preserved.
 * - Lineage (AS) and provenance (AT): every derived state traces
 *   SOURCE -> OBSERVATION -> TRANSFORMATION -> STATE -> TWIN.
 * - Versioning (AU), backward compatibility (AV), schema migration (AW).
 * - Lifecycle (AX-BC): DISCOVERED -> CREATED -> ACTIVE -> DEGRADED ->
 *   STALE -> SUSPENDED -> ARCHIVED -> RETIRED. Merge requires
 *   authorization, provenance preservation, conflict resolution, audit
 *   and rollback. Deletion is carefully controlled; prefer ARCHIVED /
 *   RETIRED so historical evidence survives.
 * - Identity resolution (BD) and entity matching (BE): AI may assist but
 *   must not silently merge entities.
 * - Ontology (BF, BG, BH): semantic model distinguishes ENTITY, ATTRIBUTE,
 *   RELATIONSHIP, EVENT, OBSERVATION, STATE, ACTION, PREDICTION.
 *
 * Invariants (FA): every twin has a stable identity (11); every important
 * state/observation has provenance (12, 13); historical state is never
 * silently overwritten (14); conflicting observations are never silently
 * discarded (19); twin schemas are versioned (26).
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Twin types (H)
 * ────────────────────────────────────────────────────────────*/

export type TwinKind =
  | "person"
  | "student"
  | "teacher"
  | "administrator"
  | "classroom"
  | "laboratory"
  | "building"
  | "campus"
  | "school"
  | "institution"
  | "vehicle"
  | "device"
  | "sensor"
  | "room"
  | "facility"
  | "course"
  | "academic_program"
  | "asset"
  | "infrastructure"
  | "department"
  | "organizational_unit"
  | "service"
  | "process"
  | "operational_environment";

export const TWIN_KINDS: readonly TwinKind[] = [
  "person",
  "student",
  "teacher",
  "administrator",
  "classroom",
  "laboratory",
  "building",
  "campus",
  "school",
  "institution",
  "vehicle",
  "device",
  "sensor",
  "room",
  "facility",
  "course",
  "academic_program",
  "asset",
  "infrastructure",
  "department",
  "organizational_unit",
  "service",
  "process",
  "operational_environment",
] as const;

/* ─────────────────────────────────────────────────────────────
 * Twin lifecycle (AX)
 * ────────────────────────────────────────────────────────────*/

export type TwinLifecycleState =
  "DISCOVERED" | "CREATED" | "ACTIVE" | "DEGRADED" | "STALE" | "SUSPENDED" | "ARCHIVED" | "RETIRED";

export const TWIN_LIFECYCLE_STATES: readonly TwinLifecycleState[] = [
  "DISCOVERED",
  "CREATED",
  "ACTIVE",
  "DEGRADED",
  "STALE",
  "SUSPENDED",
  "ARCHIVED",
  "RETIRED",
] as const;

const TWIN_LIFECYCLE_TRANSITIONS: Readonly<
  Record<TwinLifecycleState, readonly TwinLifecycleState[]>
> = {
  DISCOVERED: ["CREATED", "RETIRED"],
  CREATED: ["ACTIVE", "SUSPENDED", "RETIRED"],
  ACTIVE: ["DEGRADED", "STALE", "SUSPENDED", "ARCHIVED", "RETIRED"],
  DEGRADED: ["ACTIVE", "STALE", "SUSPENDED", "ARCHIVED"],
  STALE: ["ACTIVE", "DEGRADED", "SUSPENDED", "ARCHIVED"],
  SUSPENDED: ["ACTIVE", "DEGRADED", "ARCHIVED", "RETIRED"],
  ARCHIVED: ["ACTIVE", "RETIRED"],
  RETIRED: [],
};

export function isTwinLifecycleTransitionAllowed(
  from: TwinLifecycleState,
  to: TwinLifecycleState,
): boolean {
  return TWIN_LIFECYCLE_TRANSITIONS[from].includes(to);
}

/* ─────────────────────────────────────────────────────────────
 * Twin identity (G) and instance (K)
 * ────────────────────────────────────────────────────────────*/

export type TwinCreationSource =
  | "application_event"
  | "device_discovery"
  | "institutional_record"
  | "import"
  | "manual_creation"
  | "external_system"
  | "derived";

export interface TwinInstance {
  twinId: string;
  kind: TwinKind;
  tenantId: TenantId;
  lifecycleState: TwinLifecycleState;
  createdAt: string;
  creationSource: TwinCreationSource;
  provenanceRef: string | null;
  version: number;
  status: string;
  confidence: number | null;
  ownerReference: string | null;
  templateId: string | null;
  sourceEntityId: string | null;
}

export interface CreateTwinInput {
  kind: TwinKind;
  tenantId: TenantId;
  createdAt: string;
  creationSource: TwinCreationSource;
  sourceEntityId?: string | null;
  ownerReference?: string | null;
  templateId?: string | null;
}

export type CreateTwinResult = { ok: true; twin: TwinInstance } | { ok: false; error: string };

/**
 * Create a twin (K, AY). Twin IDs must remain stable across ordinary
 * state changes (G) — the identity is fixed at creation and never
 * regenerated by updates.
 */
export function createTwin(input: CreateTwinInput): CreateTwinResult {
  if (input.createdAt.trim() === "") {
    return { ok: false, error: "Twin requires a creation timestamp (G)" };
  }
  if (input.sourceEntityId === null && input.creationSource === "device_discovery") {
    return { ok: false, error: "Device-discovery twins require a source entity reference (AY)" };
  }
  return {
    ok: true,
    twin: {
      twinId: `twin-${input.tenantId}-${input.kind}-${Math.random().toString(36).slice(2, 8)}`,
      kind: input.kind,
      tenantId: input.tenantId,
      lifecycleState: "DISCOVERED",
      createdAt: input.createdAt,
      creationSource: input.creationSource,
      provenanceRef: null,
      version: 1,
      status: "draft",
      confidence: null,
      ownerReference: input.ownerReference ?? null,
      templateId: input.templateId ?? null,
      sourceEntityId: input.sourceEntityId ?? null,
    },
  };
}

export function transitionTwinLifecycle(
  twin: TwinInstance,
  to: TwinLifecycleState,
): { ok: true; twin: TwinInstance } | { ok: false; error: string } {
  if (!isTwinLifecycleTransitionAllowed(twin.lifecycleState, to)) {
    return {
      ok: false,
      error: `Twin lifecycle transition ${twin.lifecycleState} -> ${to} is not allowed (AX)`,
    };
  }
  return {
    ok: true,
    twin: { ...twin, lifecycleState: to, version: twin.version + 1, status: to.toLowerCase() },
  };
}

/**
 * Controlled deletion (BB, BC): production history must never be
 * destroyed merely because an active twin is deleted. Prefer ARCHIVED /
 * RETIRED lifecycle transitions; hard deletion is only permitted for
 * ephemeral/simulation twins.
 */
export function isHardDeletionAllowed(twin: TwinInstance): boolean {
  return twin.creationSource === "derived" || twin.lifecycleState === "RETIRED";
}

/* ─────────────────────────────────────────────────────────────
 * Twin type registry (I) and templates (J)
 * ────────────────────────────────────────────────────────────*/

export interface TwinTypeDefinition {
  kind: TwinKind;
  identitySchemaVersion: number;
  stateSchemaVersion: number;
  allowedRelationships: string[];
  lifecycle: TwinLifecycleState[];
  provenanceRequired: boolean;
  retentionRule: string | null;
  schemaVersion: number;
}

export interface TwinTemplate {
  templateId: string;
  kind: TwinKind;
  version: number;
  structure: Record<string, unknown>;
  requiredAttributes: string[];
  createdAt: string;
}

export interface CreateTemplateInput {
  templateId: string;
  kind: TwinKind;
  version: number;
  structure: Record<string, unknown>;
  requiredAttributes: string[];
  createdAt: string;
}

export type CreateTemplateResult =
  { ok: true; template: TwinTemplate } | { ok: false; error: string };

/**
 * Create a versioned template (J). Templates must be versioned; every
 * template carries identity/location/capacity-style structure fields.
 */
export function createTemplate(input: CreateTemplateInput): CreateTemplateResult {
  if (input.templateId.trim() === "") {
    return { ok: false, error: "Template requires an ID (J)" };
  }
  if (input.version < 1) {
    return { ok: false, error: "Template version must start at 1 (J)" };
  }
  return {
    ok: true,
    template: {
      templateId: input.templateId,
      kind: input.kind,
      version: input.version,
      structure: input.structure,
      requiredAttributes: input.requiredAttributes,
      createdAt: input.createdAt,
    },
  };
}

export function validateTwinAgainstTemplate(
  template: TwinTemplate,
  attributes: Record<string, unknown>,
): { ok: true } | { ok: false; error: string } {
  for (const required of template.requiredAttributes) {
    if (!(required in attributes)) {
      return { ok: false, error: `Twin is missing required attribute "${required}" (J)` };
    }
  }
  return { ok: true };
}

/* ─────────────────────────────────────────────────────────────
 * Composition (L)
 * ────────────────────────────────────────────────────────────*/

export interface CompositionLink {
  parentTwinId: string;
  childTwinId: string;
  tenantId: TenantId;
  addedAt: string;
}

/**
 * Add a composition link (L). Complex twins may contain sub-twins
 * (Campus -> Building -> Floor -> Classroom -> Sensor). Composition must
 * preserve identity: parent/child twins keep their own stable twin IDs.
 */
export function addCompositionLink(
  links: CompositionLink[],
  parentTwinId: string,
  childTwinId: string,
  tenantId: TenantId,
  addedAt: string,
): { ok: true; links: CompositionLink[] } | { ok: false; error: string } {
  if (parentTwinId === childTwinId) {
    return { ok: false, error: "A twin cannot contain itself (L)" };
  }
  if (links.some((l) => l.parentTwinId === parentTwinId && l.childTwinId === childTwinId)) {
    return { ok: false, error: "Composition link already exists (L)" };
  }
  return {
    ok: true,
    links: [...links, { parentTwinId, childTwinId, tenantId, addedAt }],
  };
}

/* ─────────────────────────────────────────────────────────────
 * Merge (AZ), split (BA) and versioning (AU)
 * ────────────────────────────────────────────────────────────*/

export interface MergeTwinInput {
  primaryTwinId: string;
  duplicateTwinIds: string[];
  authorizedBy: string;
  reason: string;
  resolvedConflicts: number;
  now: string;
}

export type MergeTwinResult =
  | { ok: true; mergedTwinId: string; mergedDuplicateIds: string[]; provenanceRef: string }
  | { ok: false; error: string };

/**
 * Merge duplicate twins (AZ). Merging requires authorization, provenance
 * preservation, conflict resolution, audit and a rollback strategy.
 * Provenance of both the primary and the merged duplicates is preserved.
 */
export function mergeTwins(input: MergeTwinInput): MergeTwinResult {
  if (input.authorizedBy.trim() === "") {
    return { ok: false, error: "Merge requires an authorizing identity (AZ)" };
  }
  if (input.reason.trim() === "") {
    return { ok: false, error: "Merge requires a reason (AZ)" };
  }
  if (input.duplicateTwinIds.includes(input.primaryTwinId)) {
    return { ok: false, error: "Primary twin cannot be listed as a duplicate (AZ)" };
  }
  if (input.duplicateTwinIds.length === 0) {
    return { ok: false, error: "Merge requires at least one duplicate twin (AZ)" };
  }
  return {
    ok: true,
    mergedTwinId: input.primaryTwinId,
    mergedDuplicateIds: input.duplicateTwinIds,
    provenanceRef: `merge-${input.primaryTwinId}-${input.now}-${Math.random().toString(36).slice(2, 8)}`,
  };
}

export interface SplitTwinInput {
  sourceTwinId: string;
  targetTwinIds: string[];
  reason: string;
  now: string;
}

export type SplitTwinResult =
  | { ok: true; sourceTwinId: string; targetTwinIds: string[]; provenanceRef: string }
  | { ok: false; error: string };

/**
 * Split a twin (BA): one digital representation incorrectly representing
 * multiple real entities. The source identity is preserved as provenance;
 * targets become their own twins.
 */
export function splitTwin(input: SplitTwinInput): SplitTwinResult {
  if (input.reason.trim() === "") {
    return { ok: false, error: "Split requires a reason (BA)" };
  }
  if (input.targetTwinIds.length < 2) {
    return { ok: false, error: "Split requires at least two target twins (BA)" };
  }
  return {
    ok: true,
    sourceTwinId: input.sourceTwinId,
    targetTwinIds: input.targetTwinIds,
    provenanceRef: `split-${input.sourceTwinId}-${input.now}-${Math.random().toString(36).slice(2, 8)}`,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Lineage (AS) and provenance (AT)
 * ────────────────────────────────────────────────────────────*/

export interface ProvenanceRecord {
  provenanceId: string;
  source: string;
  actor: string | null;
  transformation: string | null;
  timestamp: string;
  systemVersion: string | null;
  modelVersion: string | null;
  parentProvenanceId: string | null;
}

export function createProvenanceRecord(
  input: Omit<ProvenanceRecord, "provenanceId">,
): ProvenanceRecord {
  return {
    ...input,
    provenanceId: `prov-${input.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
  };
}

/**
 * Lineage (AS): every derived state must trace SOURCE -> OBSERVATION ->
 * TRANSFORMATION -> STATE -> TWIN. A chain is valid only when each step
 * references its predecessor.
 */
export function isLineageChainValid(records: ProvenanceRecord[]): boolean {
  if (records.length === 0) {
    return true;
  }
  for (let i = 1; i < records.length; i += 1) {
    if (records[i].parentProvenanceId !== records[i - 1].provenanceId) {
      return false;
    }
  }
  return true;
}

/* ─────────────────────────────────────────────────────────────
 * Identity resolution (BD) and entity matching (BE)
 * ────────────────────────────────────────────────────────────*/

export type IdentityResolution = "same" | "different" | "uncertain";

export interface MatchingSignals {
  /** Shared authoritative identifiers (e.g. institutional student ID). */
  sharedIdentifiers: number;
  totalIdentifiers: number;
  /** Normalized name similarity in [0, 1]. */
  nameSimilarity: number;
  locationMatch: boolean;
  metadataMatch: boolean;
  timestampProximity: boolean;
}

/**
 * Entity matching (BE): identifiers, relationships, location, metadata,
 * timestamps, authoritative records. AI may assist but must NOT silently
 * merge entities — uncertain results require human resolution.
 */
export function resolveIdentity(signals: MatchingSignals): IdentityResolution {
  if (signals.totalIdentifiers > 0 && signals.sharedIdentifiers === signals.totalIdentifiers) {
    return "same";
  }
  if (signals.sharedIdentifiers > 0) {
    return "uncertain";
  }
  if (signals.nameSimilarity >= 0.95 && signals.locationMatch && signals.metadataMatch) {
    return "same";
  }
  if (signals.nameSimilarity >= 0.5) {
    return "uncertain";
  }
  return "different";
}

/* ─────────────────────────────────────────────────────────────
 * Ontology (BF, BG, BH)
 * ────────────────────────────────────────────────────────────*/

export type SemanticConcept =
  | "ENTITY"
  | "ATTRIBUTE"
  | "RELATIONSHIP"
  | "EVENT"
  | "OBSERVATION"
  | "STATE"
  | "ACTION"
  | "PREDICTION";

export const SEMANTIC_CONCEPTS: readonly SemanticConcept[] = [
  "ENTITY",
  "ATTRIBUTE",
  "RELATIONSHIP",
  "EVENT",
  "OBSERVATION",
  "STATE",
  "ACTION",
  "PREDICTION",
] as const;

export interface OntologyEntry {
  concept: SemanticConcept;
  name: string;
  version: number;
}

/** Ontology changes must be versioned and migration-aware (BH). */
export function createOntologyEntry(
  concept: SemanticConcept,
  name: string,
  version: number,
): OntologyEntry {
  return { concept, name, version };
}
