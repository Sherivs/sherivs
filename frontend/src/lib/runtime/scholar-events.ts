/**
 * CoreGrid Scholar — African Education Runtime: domain event vocabulary.
 *
 * Runtime events are recorded through the UNIVERSAL kernel event contract
 * (`kernel/reality.ts` → `eventDraft` → `cg_event` substrate). This module
 * declares the Scholar event vocabulary and binds every event to an aggregate
 * type declared in the Scholar ontology (`runtime/scholar.ts`). The kernel
 * remains generic: it validates structure; this runtime owns the domain
 * vocabulary. If Scholar disappears, this module disappears with it and the
 * kernel stays fully valid (Scholar Independence).
 *
 * Status: authored contract, NOT persisted — a server function will record
 * these events into `cg_event` once the substrate migration is applied.
 */

import { eventDraft, type EventDraftInput } from "@/lib/kernel/reality";
import { SCHOLAR_RUNTIME_MANIFEST } from "@/lib/runtime/scholar";

export const SCHOLAR_EVENT_TYPES = [
  "institution.registered",
  "institution.suspended",
  "campus.opened",
  "program.offered",
  "program.retired",
  "learner.enrolled",
  "learner.withdrawn",
  "guardian.assigned",
  "educator.assigned",
  "learning_group.formed",
] as const;

export type ScholarEventType = (typeof SCHOLAR_EVENT_TYPES)[number];

export function isScholarEventType(value: unknown): value is ScholarEventType {
  return (SCHOLAR_EVENT_TYPES as readonly unknown[]).includes(value);
}

/** Every declared event maps to an aggregate declared in the Scholar ontology. */
const AGGREGATE_BY_EVENT: Record<ScholarEventType, string> = {
  "institution.registered": "institution",
  "institution.suspended": "institution",
  "campus.opened": "campus",
  "program.offered": "program",
  "program.retired": "program",
  "learner.enrolled": "learner",
  "learner.withdrawn": "learner",
  "guardian.assigned": "learner",
  "educator.assigned": "educator",
  "learning_group.formed": "learning_group",
};

/** Aggregate type a Scholar event is bound to (flow-level binding checks). */
export function scholarEventAggregateType(eventType: ScholarEventType): string {
  return AGGREGATE_BY_EVENT[eventType];
}

const DECLARED_ENTITY_TYPES = new Set<string>(
  SCHOLAR_RUNTIME_MANIFEST.ontology.entityTypes.map((type) => type.name),
);

export interface ScholarEventOptions {
  now: string;
  tenantId?: string | null;
  actorIdentity?: string | null;
  correlationId?: string | null;
  idempotencyKey?: string | null;
  occurredAt?: string;
}

/**
 * Build a Scholar domain event through the universal kernel event contract.
 * The aggregate type is derived from the event vocabulary and must be declared
 * in the Scholar ontology — runtime events can never target undeclared state.
 */
export function scholarEventDraft(
  eventType: ScholarEventType,
  aggregateId: string,
  options: ScholarEventOptions,
) {
  if (!isScholarEventType(eventType)) {
    throw new Error(`event type "${eventType}" is not a registered Scholar event`);
  }
  const aggregateType = AGGREGATE_BY_EVENT[eventType];
  if (!DECLARED_ENTITY_TYPES.has(aggregateType)) {
    throw new Error(
      `aggregate type "${aggregateType}" for "${eventType}" is not declared in the Scholar ontology`,
    );
  }
  const input: EventDraftInput = {
    eventType,
    aggregateType,
    aggregateId,
    actorIdentity: options.actorIdentity ?? null,
    tenantId: options.tenantId ?? null,
    correlationId: options.correlationId ?? null,
    idempotencyKey: options.idempotencyKey ?? null,
    occurredAt: options.occurredAt,
  };
  return eventDraft(input, options.now);
}
