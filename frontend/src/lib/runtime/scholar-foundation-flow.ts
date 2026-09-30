/**
 * Scholar foundation validation flow (Gate 14, bounded).
 *
 * Scholar is the first domain-runtime validation of the universal foundation
 * slice: a Scholar entity is recorded through the UNIVERSAL kernel entity
 * contract (`kernel/reality.ts` entityDraft via `runtime/scholar-reality.ts`)
 * and then carried through the verified foundation loop
 * (`control-plane/foundation-loop.ts`) to an independent verification record.
 *
 * This module is pure. It persists nothing and owns no capability. Scholar
 * vocabulary lives here and in the Scholar runtime modules; the kernel never
 * imports it (kernel-purity test).
 */
import { SCHOLAR_RUNTIME_MANIFEST } from "@/lib/runtime/scholar";
import { scholarEntityDraft, scholarRelationshipDraft } from "@/lib/runtime/scholar-reality";
import {
  scholarEventAggregateType,
  scholarEventDraft,
  type ScholarEventType,
} from "@/lib/runtime/scholar-events";
import { SCHOLAR_RUNTIME_ID } from "@/lib/runtime/scholar-consumption";
import type { FoundationLoopRequest } from "@/lib/control-plane/foundation-loop";

export const SCHOLAR_FOUNDATION_MISSION_ID = "COREGRID-SCHOLAR-FOUNDATION-VALIDATION-001";
export const SCHOLAR_FOUNDATION_ACTION = "record-observation" as const;

export interface ScholarFoundationEntityInput {
  entityType: string;
  state?: string | null;
  attributes?: Record<string, unknown>;
}

/** Build an insert-ready cg_entity row through the Scholar ontology boundary. */
export function buildScholarFoundationEntity(
  input: ScholarFoundationEntityInput,
  tenantId: string,
  now: string,
) {
  return scholarEntityDraft(
    input.entityType,
    {
      tenantId,
      state: input.state ?? null,
      classification: "INTERNAL",
      attributes: input.attributes ?? {},
      sourceType: `cg:${SCHOLAR_RUNTIME_ID}:foundation-validation`,
    },
    now,
  );
}

/** Governed mission envelope for the Scholar validation loop. */
export function scholarFoundationRequest(input: {
  executionId: string;
  idempotencyKey: string;
  requestedAt: string;
}): FoundationLoopRequest {
  return {
    executionId: input.executionId,
    idempotencyKey: input.idempotencyKey,
    missionId: SCHOLAR_FOUNDATION_MISSION_ID,
    version: "1",
    purpose: "scholar-domain-foundation-validation",
    authorityRef: "CONTROL-PLANE-06",
    contextRef: "scholar-foundation-validation",
    ownerRef: `RUNTIME.md / ${SCHOLAR_RUNTIME_ID}`,
    action: SCHOLAR_FOUNDATION_ACTION,
    requestedAt: input.requestedAt,
  };
}

/** Declared Scholar entity types exposed for validation surfaces. */
export const SCHOLAR_FOUNDATION_ENTITY_TYPES: readonly string[] =
  SCHOLAR_RUNTIME_MANIFEST.ontology.entityTypes.map((type) => type.name);

/**
 * Declared relationship vocabulary for the Scholar validation loop. Bounded to
 * the handoff-authorized subset (`enrolls`, `teaches`); the full ontology
 * remains available through the runtime boundary for future governed flows.
 */
export const SCHOLAR_FOUNDATION_RELATIONSHIP_TYPES: readonly string[] = ["enrolls", "teaches"];

const RELATIONSHIP_BY_NAME = new Map(
  SCHOLAR_RUNTIME_MANIFEST.ontology.relationshipTypes.map((relation) => [relation.name, relation]),
);

/**
 * Ontology type check for a Scholar relationship: the relation must be
 * declared, the created entity's type must be a legal source, and the
 * referenced target entity's actual stored type must be a legal target.
 */
export function assertScholarRelationshipVocabulary(
  relationType: string,
  sourceEntityType: string,
  targetEntityType: string,
): void {
  const relation = RELATIONSHIP_BY_NAME.get(relationType);
  if (!relation) {
    throw new Error(`"${relationType}" is not declared in the Scholar ontology`);
  }
  if (!relation.sourceTypes.includes(sourceEntityType)) {
    throw new Error(
      `relation "${relationType}" does not accept source entity type "${sourceEntityType}"`,
    );
  }
  if (!relation.targetTypes.includes(targetEntityType)) {
    throw new Error(
      `relation "${relationType}" does not accept target entity type "${targetEntityType}"`,
    );
  }
}

export interface ScholarFoundationRelationshipInput {
  relationType: string;
  sourceEntityId: string;
  targetEntityId: string;
  attributes?: Record<string, unknown>;
}

/** Build an insert-ready cg_relationship row through the Scholar ontology boundary. */
export function buildScholarFoundationRelationship(
  input: ScholarFoundationRelationshipInput,
  tenantId: string,
  now: string,
) {
  return scholarRelationshipDraft(
    input.relationType,
    {
      sourceEntityId: input.sourceEntityId,
      targetEntityId: input.targetEntityId,
      tenantId,
      attributes: input.attributes ?? {},
      sourceRef: `cg:${SCHOLAR_RUNTIME_ID}:foundation-validation`,
    },
    now,
  );
}

/**
 * Scholar domain events may only be recorded against an entity whose ontology
 * type is the event's declared aggregate — an event can never be attached to
 * state of a different kind.
 */
export function assertScholarEventForEntity(
  eventType: ScholarEventType,
  entityEntityType: string,
): void {
  const aggregateType = scholarEventAggregateType(eventType);
  if (aggregateType !== entityEntityType) {
    throw new Error(
      `event "${eventType}" aggregates on "${aggregateType}", not the created entity type "${entityEntityType}"`,
    );
  }
}

export interface ScholarFoundationEventInput {
  eventType: ScholarEventType;
  aggregateId: string;
  actorIdentity?: string | null;
  correlationId?: string | null;
  idempotencyKey?: string | null;
}

/** Build an insert-ready cg_event row through the Scholar event vocabulary. */
export function buildScholarFoundationEvent(
  input: ScholarFoundationEventInput,
  tenantId: string,
  now: string,
) {
  return scholarEventDraft(input.eventType, input.aggregateId, {
    now,
    tenantId,
    actorIdentity: input.actorIdentity ?? null,
    correlationId: input.correlationId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
  });
}
