/**
 * CoreGrid Scholar — African Education Runtime: reality flows.
 *
 * Completes the runtime → kernel consumption story: Scholar entities,
 * relationships and observations are recorded through the UNIVERSAL kernel
 * draft contracts (`kernel/reality.ts`), with every type/relation validated
 * against the Scholar ontology declared in `runtime/scholar.ts`. Events were
 * already bound via `runtime/scholar-events.ts`; this module binds the other
 * three primitives. The kernel stays generic — this runtime owns vocabulary.
 */

import {
  entityDraft,
  observationDraft,
  relationshipDraft,
  type EntityDraftInput,
} from "@/lib/kernel/reality";
import { SCHOLAR_RUNTIME_MANIFEST } from "@/lib/runtime/scholar";

export const SCHOLAR_ENTITY_TYPES: readonly string[] =
  SCHOLAR_RUNTIME_MANIFEST.ontology.entityTypes.map((t) => t.name);

export const SCHOLAR_RELATIONSHIP_TYPES: readonly string[] =
  SCHOLAR_RUNTIME_MANIFEST.ontology.relationshipTypes.map((r) => r.name);

const DECLARED_ENTITY_TYPES = new Set<string>(SCHOLAR_ENTITY_TYPES);
const DECLARED_RELATIONSHIP_TYPES = new Set<string>(SCHOLAR_RELATIONSHIP_TYPES);

function assertDeclaredEntityType(entityType: string): void {
  if (!DECLARED_ENTITY_TYPES.has(entityType)) {
    throw new Error(`"${entityType}" is not declared in the Scholar ontology`);
  }
}

function assertDeclaredRelationshipType(relationType: string): void {
  if (!DECLARED_RELATIONSHIP_TYPES.has(relationType)) {
    throw new Error(`"${relationType}" is not declared in the Scholar ontology`);
  }
}

/** Record a Scholar entity through the kernel entity contract. */
export function scholarEntityDraft(
  entityType: string,
  input: Omit<EntityDraftInput, "entityType">,
  now: string,
) {
  assertDeclaredEntityType(entityType);
  return entityDraft({ ...input, entityType }, now);
}

export interface ScholarRelationshipInput {
  sourceEntityId: string;
  targetEntityId: string;
  tenantId?: string | null;
  attributes?: Record<string, unknown>;
  sourceRef?: string | null;
  observedAt?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
}

/** Record a Scholar relationship through the kernel relationship contract. */
export function scholarRelationshipDraft(
  relationType: string,
  input: ScholarRelationshipInput,
  now: string,
) {
  assertDeclaredRelationshipType(relationType);
  return relationshipDraft({ ...input, relationType }, now);
}

export interface ScholarObservationInput {
  subjectEntityId: string;
  observerIdentity?: string | null;
  tenantId?: string | null;
  sourceType?: string | null;
  sourceRef?: string | null;
  confidence?: number | null;
  observedAt?: string | null;
}

/** Record a Scholar observation through the kernel observation contract. */
export function scholarObservationDraft(
  subjectType: string,
  kind: "observed" | "reported" | "inferred" | "predicted" | "simulated",
  input: ScholarObservationInput,
  now: string,
) {
  // The observed subject must be a Scholar ontology entity.
  assertDeclaredEntityType(subjectType);
  return observationDraft({ ...input, kind }, now);
}
