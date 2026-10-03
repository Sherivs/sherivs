/**
 * CoreGrid — Hermes event→observation adapter (V1 remediation wave, team
 * R4 / HERMES-PORT; follow-up of V1-002).
 *
 * The EVENT half of the Hermes observation surface: Hermes observations no
 * longer arrive only through direct calls — every observation may arrive
 * through the event substrate (`cg_event`, the kernel outbox's emission
 * half). This module is the consumption adapter: it maps kernel event
 * records into provenance-stamped Hermes observations and records them
 * through the observation port (`hermes-observation.ts`, DB-backed at the
 * server boundary via `hermes-event-source-db.server.ts`).
 *
 * Fail-closed consumption law (mirrors `kernel/event-semantics.ts`):
 *   - an event whose type is NOT registered in the event taxonomy is
 *     REJECTED — never silently classified into an observation;
 *   - an event without a parsable temporal coordinate (occurred_at or
 *     recorded_at) is REJECTED — an event without a temporal coordinate
 *     cannot be an observation;
 *   - an event WITHOUT tenant context (null tenant, or a tenant other than
 *     the ingestion tenant) is EXCLUDED — §13: every request must have
 *     tenant context;
 *   - a recorder failure (e.g. the observation substrate is absent) ABORTS
 *     the ingestion closed — events already rejected/recorded are reported,
 *     nothing further is consumed, and nothing is faked.
 *
 * §9/§12: the recorded observation is DERIVED INTELLIGENCE about the event
 * (AI-generated, unverified — stamped by the port, never by this module);
 * the event itself remains canonical in cg_event. Deterministic identity:
 * the observation id is derived from the event's content+cause digest
 * (`eventDedupDigest`), so duplicate deliveries replay (§10) onto the same
 * observation instead of double-recording.
 *
 * Boundary: pure logic over the kernel event read shape + the observation
 * port. No I/O of its own, no vendor, no clock (the record instant is
 * caller-supplied). Event delivery-state transitions remain owned by the
 * outbox (`kernel/outbox.ts`) — this module only READS.
 */

import {
  alertPolicyFor,
  classifyEvent,
  eventDedupDigest,
  isKnownEventType,
  orderEvents,
  type KernelEventRecord,
} from "../kernel/event-semantics";
import {
  hermesObservationInputSchema,
  type HermesObservationInput,
  type HermesObservationRecorder,
} from "./hermes-observation";

/** How this module declares itself in observation provenance (§12). */
export const HERMES_EVENT_SOURCE_ORIGIN = "hermes.event-source" as const;

/** Deterministic observation id of an event-sourced observation. */
export function hermesEventObservationId(event: KernelEventRecord): string {
  return `hermes:obs:event:${eventDedupDigest(event).slice(0, 32)}`;
}

/** The event identity used in provenance refs (id, or the digest stand-in). */
export function hermesEventRef(event: KernelEventRecord): string {
  const id = event.id?.trim();
  return id && id.length > 0 ? id : `digest:${eventDedupDigest(event).slice(0, 16)}`;
}

export type HermesEventObservationMapping =
  { ok: true; observation: HermesObservationInput } | { ok: false; reason: string };

/**
 * Map ONE kernel event into an observation input. Fails closed on: unknown
 * event types, missing aggregate coordinates, missing temporal coordinates,
 * non-object payloads, and events outside the ingestion tenant (§13).
 */
export function observationFromEvent(
  event: KernelEventRecord,
  ctx: { readonly tenantId: string; readonly hermesId: string },
): HermesEventObservationMapping {
  if (event.tenant_id !== ctx.tenantId) {
    return {
      ok: false,
      reason: `event tenant context missing or mismatched (§13): event tenant ${JSON.stringify(event.tenant_id)} vs ingestion tenant ${JSON.stringify(ctx.tenantId)}`,
    };
  }
  if (!isKnownEventType(event.event_type)) {
    return {
      ok: false,
      reason: `event type "${event.event_type}" is not registered in the event taxonomy — rejected fail-closed`,
    };
  }
  if (!event.aggregate_type?.trim() || !event.aggregate_id?.trim()) {
    return { ok: false, reason: "event carries no aggregate coordinates" };
  }
  if (
    event.payload != null &&
    (typeof event.payload !== "object" || Array.isArray(event.payload))
  ) {
    return { ok: false, reason: "event payload must be a JSON object" };
  }
  const occurredAt = event.occurred_at ?? event.recorded_at;
  if (typeof occurredAt !== "string" || !Number.isFinite(Date.parse(occurredAt))) {
    return { ok: false, reason: "event carries no parsable occurred_at/recorded_at" };
  }

  const eventRef = hermesEventRef(event);
  const observation = hermesObservationInputSchema.parse({
    observationId: hermesEventObservationId(event),
    tenantId: ctx.tenantId,
    kind: "event_observation",
    subjectRef: `cg_event:${event.aggregate_type}:${event.aggregate_id}`,
    // The statement is the derived intelligence ABOUT the event (§9); the
    // event row itself stays canonical in cg_event.
    statement: {
      eventType: event.event_type,
      aggregateType: event.aggregate_type,
      aggregateId: event.aggregate_id,
      occurredAt: event.occurred_at,
      recordedAt: event.recorded_at,
      payload: event.payload ?? {},
      // Taxonomy classification (closed vocabulary, declared at
      // registration) + the downstream alerting policy it maps to.
      significance: classifyEvent(event.event_type),
      alertPolicy: alertPolicyFor(classifyEvent(event.event_type)),
    },
    observedAt: occurredAt,
    source: "event",
    eventRef,
    traceId: null,
    correlationId: event.correlation_id ?? null,
    declaredOrigin: HERMES_EVENT_SOURCE_ORIGIN,
  });
  return { ok: true, observation };
}

/* ─────────────────────────────────────────────────────────────
 * Ingestion (map → order → dedupe → record, fail-closed)
 * ────────────────────────────────────────────────────────────*/

export interface HermesEventIngestion {
  readonly tenantId: string;
  readonly hermesId: string;
  readonly ingestedAt: string;
  /** Deliveries considered (before tenant scoping). */
  readonly considered: number;
  /** Deliveries excluded for missing/mismatched tenant context (§13). */
  readonly excludedOtherTenant: number;
  /** Duplicate deliveries collapsed onto an already-consumed event. */
  readonly collapsed: number;
  /** Deliveries rejected fail-closed (unknown type, no coordinates, …). */
  readonly rejected: readonly { readonly eventId: string; readonly reason: string }[];
  /** Observation ids newly recorded. */
  readonly recorded: readonly string[];
  /** Observation ids already on record — replayed verbatim (§10). */
  readonly replayed: readonly string[];
}

export type HermesEventIngestResult =
  | { ok: true; ingestion: HermesEventIngestion }
  | { ok: false; reason: string; ingestion: HermesEventIngestion };

/**
 * Ingest a batch of event deliveries as Hermes observations through the
 * port. Deterministic: deliveries may arrive duplicated and out of order —
 * the unique events (content+cause digest) are recorded exactly once, in
 * the substrate's total order. A recorder failure aborts closed with
 * `{ ok: false }` (the ingestion so far is reported; the port is
 * append-only, so nothing already recorded is rewritten).
 */
export async function ingestEventsAsObservations(
  observations: HermesObservationRecorder,
  events: readonly KernelEventRecord[],
  input: { readonly tenantId: string; readonly hermesId: string; readonly now: string },
): Promise<HermesEventIngestResult> {
  const rejected: { eventId: string; reason: string }[] = [];
  const mapped: KernelEventRecord[] = [];
  let excludedOtherTenant = 0;

  for (const event of events) {
    if (event.tenant_id !== input.tenantId) {
      excludedOtherTenant += 1;
      continue;
    }
    const mapping = observationFromEvent(event, input);
    if (!mapping.ok) {
      rejected.push({ eventId: hermesEventRef(event), reason: mapping.reason });
      continue;
    }
    mapped.push(event);
  }

  // Deterministic total order over the accepted events (all carry a
  // parsable temporal coordinate by construction above).
  const ordered = orderEvents(mapped, { tenantId: input.tenantId });

  // Duplicate deliveries collapse by content+cause digest — the substrate's
  // dedup identity. Only the FIRST delivery of each digest is recorded;
  // later deliveries replay onto the same observation id (§10).
  const seen = new Map<string, KernelEventRecord>();
  let collapsed = 0;
  for (const event of ordered) {
    const digest = eventDedupDigest(event);
    const existing = seen.get(digest);
    if (existing === undefined) {
      seen.set(digest, event);
    } else {
      collapsed += 1;
    }
  }

  const recordedIds: string[] = [];
  const replayedIds: string[] = [];
  const ingestion: HermesEventIngestion = {
    tenantId: input.tenantId,
    hermesId: input.hermesId,
    ingestedAt: input.now,
    considered: events.length,
    excludedOtherTenant,
    collapsed,
    rejected,
    recorded: recordedIds,
    replayed: replayedIds,
  };

  for (const event of seen.values()) {
    const mapping = observationFromEvent(event, input);
    if (!mapping.ok) {
      // Unreachable (mapped above), but never record through a failed mapping.
      rejected.push({ eventId: hermesEventRef(event), reason: mapping.reason });
      continue;
    }
    const recorded = await observations.recordObservation({
      observation: mapping.observation,
      observedBy: input.hermesId,
      now: input.now,
    });
    if (!recorded.ok) {
      return {
        ok: false,
        reason: `event ingestion failed closed after ${recordedIds.length} observation(s): ${recorded.error}`,
        ingestion,
      };
    }
    if (recorded.replayed) replayedIds.push(recorded.observationId);
    else recordedIds.push(recorded.observationId);
  }
  return { ok: true, ingestion };
}
