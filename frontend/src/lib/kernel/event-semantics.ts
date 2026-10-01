/**
 * CoreGrid — event kernel semantics over cg_event consumption (V1CAP-042 /
 * J-020 / MISSION-R-15), with the single time-source authority (V1CAP-045 /
 * J-023) as its ordering substrate.
 *
 * The outbox (kernel/outbox.ts) gives durable EMISSION over cg_event. G-042
 * demands the consumption half: taxonomy, deduplication, deterministic
 * ordering and significance classification — because the loop's
 * State Change -> Observation tail consumes events, and duplicate or
 * unordered events produce FALSE observations and unverifiable Evidence.
 * This module generalizes the foundation loop's verified idempotent replay
 * (control-plane/foundation-loop.ts) from the mission plane to the event
 * plane: a duplicate/out-of-order event stream replays to exactly the same
 * state as each unique event applied once, in total order.
 *
 * Law of this module:
 * - TAXONOMY (declarative, extensible): event types are registered per
 *   domain (`domainRef`, e.g. "runtime:scholar") through the public gate,
 *   each with a declared significance. The kernel knows only neutral
 *   builtin types. Ownership is exclusive; an UNKNOWN event type is
 *   rejected at consumption — never silently classified.
 * - SIGNIFICANCE: routine / notable / critical, declared at registration,
 *   mapped to downstream alerting policy (none / notify / escalate). The
 *   significance vocabulary is closed; unknown significance values are
 *   rejected at registration.
 * - DETERMINISTIC ORDERING: per-tenant logical ordering through the time
 *   authority — order is (issued atMs, issuance sequence, issuer, event
 *   identity), never wall readings alone, so concurrent writers that sample
 *   the same instant order deterministically and out-of-order writers
 *   cannot corrupt history. Events lacking issuance provenance are
 *   rejected when the strict option is set (the production posture).
 * - DEDUPLICATION: the content+cause digest — canonical content (type,
 *   tenant, aggregate, payload) PLUS the causation root (G-010: a chain
 *   either continues from a cause or declares its origin). Duplicate
 *   deliveries collapse; a same-content event with a DIFFERENT cause does
 *   NOT collapse (two identical independent actions are two events).
 *   Consumption is per-tenant: the tenant coordinate is in the digest, so
 *   cross-tenant look-alikes never collapse into each other.
 * - REPLAY: dedupe + total order + one reducer application per unique
 *   event. Idempotency under duplication and input permutation — the
 *   foundation loop's replay law, at event-plane scale.
 * - BI-TEMPORAL / ENVELOPE COMPATIBILITY: the event read shape accepts
 *   `eventDraft` rows from kernel/reality.ts verbatim — occurred_at is the
 *   valid-time coordinate, recorded_at the record-time coordinate, and the
 *   envelope causation fields (causation_id / parent_event_id /
 *   declared_origin) carry the cause for the digest. No envelope field is
 *   redefined here; composition, not modification.
 *
 * Boundary: pure module — no persistence, no I/O. DB persistence arrives
 * with the substrate; this layer is an authored contract, explicitly
 * incomplete at the persistence level.
 */

import { createHash } from "node:crypto";
import {
  compareIssued,
  isAuthorityTimestampShape,
  type IssuedTimestamp,
} from "./time-authority";

/* ─────────────────────────────────────────────────────────────
 * Event read shape (composition over kernel/reality.ts drafts)
 * ────────────────────────────────────────────────────────────*/

/**
 * The consumption-time read shape of a cg_event row. Field names mirror the
 * substrate columns so `eventDraft(...)` outputs (with or without envelope
 * and bi-temporal stamps) are structurally consumable as-is.
 */
export interface KernelEventRecord {
  /** Persistent event id when present; the digest stands in when absent. */
  readonly id?: string | null;
  readonly event_type: string;
  readonly tenant_id: string | null;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly payload: Record<string, unknown> | null;
  /** VALID time — when the event was true in reality (cg_event.occurred_at). */
  readonly occurred_at: string | null;
  /** RECORD time — when the system learned it (cg_event.recorded_at). */
  readonly recorded_at: string | null;
  /** Issuance sequence from the time authority (ordering provenance). */
  readonly sequence?: number | null;
  /** Issuer identity from the time authority (ordering provenance). */
  readonly issuer?: string | null;
  readonly correlation_id?: string | null;
  /** Envelope causation chain (G-010): the cause coordinates. */
  readonly causation_id?: string | null;
  readonly parent_event_id?: string | null;
  readonly declared_origin?: string | null;
  /** Bi-temporal validity knowledge flag (V1CAP-004), passthrough. */
  readonly valid_time_known?: boolean | null;
  /** Bi-temporal validity interval (V1CAP-004 columns), passthrough. */
  readonly valid_from?: string | null;
  readonly valid_until?: string | null;
}

/* ─────────────────────────────────────────────────────────────
 * Significance classification (closed vocabulary)
 * ────────────────────────────────────────────────────────────*/

export type EventSignificance = "routine" | "notable" | "critical";

export const EVENT_SIGNIFICANCES: readonly EventSignificance[] = [
  "routine",
  "notable",
  "critical",
] as const;

/**
 * Downstream alerting policy per significance. `critical` escalates,
 * `notable` notifies, `routine` raises nothing — the classification IS the
 * alerting decision's input, declared once in the taxonomy.
 */
export type EventAlertPolicy = "none" | "notify" | "escalate";

export function alertPolicyFor(significance: EventSignificance): EventAlertPolicy {
  switch (significance) {
    case "critical":
      return "escalate";
    case "notable":
      return "notify";
    case "routine":
      return "none";
  }
}

export function isEventSignificance(value: unknown): value is EventSignificance {
  return (EVENT_SIGNIFICANCES as readonly unknown[]).includes(value);
}

/* ─────────────────────────────────────────────────────────────
 * Event type registry (declarative, extensible, per domain)
 * ────────────────────────────────────────────────────────────*/

export interface EventTypeDeclaration {
  readonly eventType: string;
  readonly significance: EventSignificance;
}

export interface EventTypeRegistration {
  readonly domainRef: string;
  /** The event types this domain registered (sorted, deduplicated). */
  readonly eventTypes: readonly string[];
}

/** Typed rejection when an event's type is not registered by ANY domain. */
export class UnknownEventTypeError extends Error {
  readonly eventType: string;

  constructor(eventType: string) {
    super(`event_semantics: event_type "${eventType}" is not registered`);
    this.name = "UnknownEventTypeError";
    this.eventType = eventType;
  }
}

export function isUnknownEventTypeError(value: unknown): value is UnknownEventTypeError {
  return value instanceof UnknownEventTypeError;
}

/** Typed rejection when an event arrives without a causation chain root. */
export class EventWithoutCauseError extends Error {
  readonly eventId: string;

  constructor(eventId: string) {
    super(
      `event_semantics: event "${eventId}" carries no causation chain root ` +
        "(causation_id, parent_event_id or declared_origin) — an unrooted event cannot be deduplicated (G-010)",
    );
    this.name = "EventWithoutCauseError";
    this.eventId = eventId;
  }
}

/** Domain references are namespaced refs: "<namespace>:<name>". */
const DOMAIN_REF_PATTERN = /^[a-z][a-z0-9_]*:[a-z0-9_-]+$/;

function isDomainRef(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 100 && DOMAIN_REF_PATTERN.test(trimmed);
}

/** Mirrors the cg_event event_type constraint (1–200 characters). */
function normalizeEventType(value: unknown, domainRef: string): string {
  if (typeof value !== "string") {
    throw new Error(`event_semantics: domain "${domainRef}" declared a non-string event type`);
  }
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 200) {
    throw new Error(
      `event_semantics: domain "${domainRef}" declared an event_type violating the 1–200 character constraint`,
    );
  }
  return trimmed;
}

const registrationsByDomain = new Map<string, Map<string, EventSignificance>>();
const significanceByType = new Map<string, EventSignificance>();
const ownerByType = new Map<string, string>();

/**
 * Register (or idempotently refresh) a domain's event taxonomy under
 * `domainRef`. Fails closed on: an invalid domainRef, a malformed event
 * type (1–200 characters after trimming), an UNKNOWN significance value,
 * or a type already owned by a DIFFERENT domain — canonical ownership is
 * exclusive, mirroring the object-type registry.
 */
export function registerEventTypes(
  domainRef: string,
  declarations: readonly EventTypeDeclaration[],
): EventTypeRegistration {
  if (!isDomainRef(domainRef)) {
    throw new Error(
      `event_semantics: "${String(domainRef)}" is not a valid domainRef (<namespace>:<name>, e.g. "runtime:scholar")`,
    );
  }
  const ref = domainRef.trim();
  if (!Array.isArray(declarations)) {
    throw new Error(`event_semantics: domain "${ref}" must register an array of declarations`);
  }
  const declared = new Map<string, EventSignificance>();
  for (const raw of declarations) {
    const eventType = normalizeEventType(raw.eventType, ref);
    if (!isEventSignificance(raw.significance)) {
      throw new Error(
        `event_semantics: domain "${ref}" declared event type "${eventType}" with unknown significance ` +
          `"${String(raw.significance)}" — significance must be routine|notable|critical`,
      );
    }
    const owner = ownerByType.get(eventType);
    if (owner != null && owner !== ref) {
      throw new Error(
        `event_semantics: event type "${eventType}" is already owned by "${owner}" — rejected for "${ref}"`,
      );
    }
    declared.set(eventType, raw.significance);
  }
  const previous = registrationsByDomain.get(ref);
  if (previous != null) {
    for (const stale of previous.keys()) {
      if (ownerByType.get(stale) === ref) {
        ownerByType.delete(stale);
        significanceByType.delete(stale);
      }
    }
  }
  registrationsByDomain.set(ref, declared);
  for (const [eventType, significance] of declared) {
    ownerByType.set(eventType, ref);
    significanceByType.set(eventType, significance);
  }
  return {
    domainRef: ref,
    eventTypes: Object.freeze([...declared.keys()].sort()),
  };
}

/** Deregister a domain entirely; its vocabulary closes immediately. */
export function deregisterEventTypes(domainRef: string): boolean {
  const ref = typeof domainRef === "string" ? domainRef.trim() : "";
  const previous = registrationsByDomain.get(ref);
  if (previous == null) return false;
  for (const eventType of previous.keys()) {
    if (ownerByType.get(eventType) === ref) {
      ownerByType.delete(eventType);
      significanceByType.delete(eventType);
    }
  }
  registrationsByDomain.delete(ref);
  return true;
}

/** Is this event type registered by ANY domain? */
export function isKnownEventType(eventType: string): boolean {
  return typeof eventType === "string" && significanceByType.has(eventType.trim());
}

/** The domain that registered an event type, or undefined when unregistered. */
export function eventTypeOwner(eventType: string): string | undefined {
  return typeof eventType === "string" ? ownerByType.get(eventType.trim()) : undefined;
}

/** Registered domainRefs, sorted for deterministic consumption. */
export function registeredEventDomains(): readonly string[] {
  return Object.freeze(Array.from(registrationsByDomain.keys()).sort());
}

/**
 * Classify an event's significance from the taxonomy. FAILS CLOSED: an
 * unknown event type throws `UnknownEventTypeError` — unregistered events
 * are never silently classified (they cannot drive alerting they were
 * never declared to drive).
 */
export function classifyEvent(eventType: string): EventSignificance {
  const significance = typeof eventType === "string" ? significanceByType.get(eventType.trim()) : undefined;
  if (significance == null) throw new UnknownEventTypeError(eventType);
  return significance;
}

/**
 * Classify AND resolve the downstream alerting policy in one step.
 * Unknown event types fail closed through `classifyEvent`.
 */
export function eventAlertPolicy(eventType: string): EventAlertPolicy {
  return alertPolicyFor(classifyEvent(eventType));
}

/* ─────────────────────────────────────────────────────────────
 * Neutral builtin taxonomy (fail-closed bootstrap floor)
 * ────────────────────────────────────────────────────────────*/

export const KERNEL_CORE_EVENT_DOMAIN_REF = "kernel:core";

/** Neutral builtin event types — universal kernel vocabulary, no domain words. */
export const KERNEL_BUILTIN_EVENT_TYPES: readonly EventTypeDeclaration[] = Object.freeze([
  { eventType: "core.state.changed", significance: "routine" },
  { eventType: "core.observation.recorded", significance: "notable" },
  { eventType: "core.event.replayed", significance: "routine" },
  { eventType: "core.invariant.violated", significance: "critical" },
] as const);

registerEventTypes(KERNEL_CORE_EVENT_DOMAIN_REF, KERNEL_BUILTIN_EVENT_TYPES);

/* ─────────────────────────────────────────────────────────────
 * Canonical serialization + content+cause digest
 * ────────────────────────────────────────────────────────────*/

/**
 * Deterministic, order-independent serialization of a JSON value: object
 * keys sorted recursively (array order preserved — it is semantic), so
 * structurally identical payloads digest identically regardless of
 * construction order.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(",")}}`;
}

/**
 * The causation chain root of an event (G-010): the first present cause
 * coordinate among causation_id, parent_event_id, declared_origin — or null
 * when the event is unrooted. Unrooted events are rejected when the strict
 * dedup posture is on (the default): two identical unrooted events cannot
 * be distinguished from a duplicate, so they cannot be consumed safely.
 */
export function eventCause(event: KernelEventRecord): string | null {
  return (
    event.causation_id?.trim() ||
    event.parent_event_id?.trim() ||
    event.declared_origin?.trim() ||
    null
  );
}

/**
 * The content+cause digest: canonical content (type, tenant, aggregate,
 * payload) PLUS the causation root. This is the dedup identity — a duplicate
 * delivery digests equal and collapses; a same-content event with a
 * different cause digests differently and never collapses.
 */
export function eventDedupDigest(event: KernelEventRecord): string {
  const content = {
    event_type: event.event_type,
    tenant_id: event.tenant_id ?? null,
    aggregate_type: event.aggregate_type,
    aggregate_id: event.aggregate_id,
    payload: event.payload ?? {},
    cause: eventCause(event),
  };
  return createHash("sha256").update(canonicalJson(content)).digest("hex");
}

/* ─────────────────────────────────────────────────────────────
 * Deterministic ordering (time authority + sequence)
 * ────────────────────────────────────────────────────────────*/

/** Typed rejection for events lacking time-authority issuance provenance. */
export class UnauthoritativeTimeError extends Error {
  readonly eventId: string;

  constructor(eventId: string) {
    super(
      `event_semantics: event "${eventId}" carries no issuance provenance (sequence/issuer) — ` +
        "strict ordering consumes only time-authority-issued events",
    );
    this.name = "UnauthoritativeTimeError";
    this.eventId = eventId;
  }
}

export interface EventOrderOptions {
  /**
   * Tenant scope (defense-in-depth for in-memory consumption over
   * service-role record sets): events outside the scope — including
   * scope-less rows with a null tenant — are excluded entirely.
   */
  readonly tenantId?: string;
  /**
   * Production posture: require time-authority issuance provenance
   * (sequence/issuer) on every ordered event. Default false so contract
   * tests can order provenance-less fixtures; the DB consumption path
   * turns this ON — an event without issuance provenance cannot
   * participate in a guaranteed total order.
   */
  readonly requireAuthorityProvenance?: boolean;
}

/** The authoritative instant an event is ordered by (valid time, else record time). */
function eventInstantMs(event: KernelEventRecord): number {
  const instant = event.occurred_at ?? event.recorded_at;
  const parsed = typeof instant === "string" ? Date.parse(instant) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new Error(
      `event_semantics: event "${eventIdOf(event)}" has no parsable occurred_at/recorded_at — ` +
        "an event without a temporal coordinate cannot be ordered",
    );
  }
  return parsed;
}

function eventIdOf(event: KernelEventRecord): string {
  return event.id?.trim() || `digest:${eventDedupDigest(event).slice(0, 16)}`;
}

/**
 * The deterministic order key of an event: the time-authority coordinates
 * (instant, issuance sequence, issuer) plus the event identity as the final
 * tiebreak. Ordering never relies on arrival order or on IDs alone — the
 * same coordinates in ANY input permutation produce the SAME total order.
 */
export function compareEventOrder(a: KernelEventRecord, b: KernelEventRecord): number {
  const aMs = eventInstantMs(a);
  const bMs = eventInstantMs(b);
  if (aMs !== bMs) return aMs < bMs ? -1 : 1;
  const aSeq = a.sequence ?? -1;
  const bSeq = b.sequence ?? -1;
  if (aSeq !== bSeq) return aSeq < bSeq ? -1 : 1;
  const aIssuer = a.issuer ?? "";
  const bIssuer = b.issuer ?? "";
  if (aIssuer !== bIssuer) return aIssuer < bIssuer ? -1 : aIssuer > bIssuer ? 1 : 0;
  const aId = eventIdOf(a);
  const bId = eventIdOf(b);
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

/**
 * Total order over a (possibly duplicated, out-of-order) event stream.
 * Returns a NEW sorted array; the input is never mutated. Duplicates keep
 * their first-in-total-order representative — combined with deduplication
 * below, a duplicate never changes the applied sequence.
 */
export function orderEvents(
  events: readonly KernelEventRecord[],
  options: EventOrderOptions = {},
): KernelEventRecord[] {
  const scoped = events.filter((event) => {
    if (options.tenantId != null && (event.tenant_id ?? null) !== options.tenantId) return false;
    if (options.requireAuthorityProvenance === true && !hasIssuanceProvenance(event)) {
      throw new UnauthoritativeTimeError(eventIdOf(event));
    }
    return true;
  });
  return scoped.slice().sort(compareEventOrder);
}

/** True when the event carries time-authority issuance provenance (shape-valid). */
export function hasIssuanceProvenance(event: KernelEventRecord): boolean {
  return (
    typeof event.sequence === "number" &&
    Number.isInteger(event.sequence) &&
    event.sequence >= 0 &&
    typeof event.issuer === "string" &&
    event.issuer.trim().length > 0 &&
    isAuthorityTimestampShape({
      at: event.occurred_at ?? event.recorded_at ?? "",
      atMs: eventInstantMs(event),
      sequence: event.sequence,
      issuer: event.issuer,
    })
  );
}

/* ─────────────────────────────────────────────────────────────
 * Deduplication (content+cause digest)
 * ────────────────────────────────────────────────────────────*/

export interface DeduplicatedEvent {
  readonly event: KernelEventRecord;
  readonly digest: string;
  /** ids (or digest ids) of the duplicate deliveries that collapsed into this event. */
  readonly collapsed: readonly string[];
}

export interface DeduplicationResult {
  /** Unique events in total order, duplicates collapsed into the first. */
  readonly unique: readonly DeduplicatedEvent[];
  /** How many duplicate deliveries collapsed. */
  readonly duplicateCount: number;
  /** Total deliveries considered (before tenant scoping). */
  readonly totalSeen: number;
}

export interface DeduplicationOptions extends EventOrderOptions {
  /**
   * Require an explicit causation chain root (G-010) before an event may be
   * deduplicated. Default TRUE — fail-closed. An unrooted event cannot be
   * distinguished from a duplicate of an identical one, so it is rejected
   * rather than silently consumed.
   */
  readonly requireCause?: boolean;
}

/**
 * Deduplicate an event stream: order it (deterministic total order), then
 * collapse every event whose content+cause digest equals an earlier event's
 * into that earlier event. Deterministic: the SAME input in ANY permutation
 * produces the SAME unique set (the representative is the first event in
 * total order, not the first arrival).
 */
export function dedupeEvents(
  events: readonly KernelEventRecord[],
  options: DeduplicationOptions = {},
): DeduplicationResult {
  const requireCause = options.requireCause !== false;
  const ordered = orderEvents(events, options);
  const indexByDigest = new Map<string, number>();
  const unique: DeduplicatedEvent[] = [];
  let duplicateCount = 0;
  for (const event of ordered) {
    const id = eventIdOf(event);
    if (requireCause && eventCause(event) == null) {
      throw new EventWithoutCauseError(id);
    }
    const digest = eventDedupDigest(event);
    const existingIndex = indexByDigest.get(digest);
    if (existingIndex === undefined) {
      indexByDigest.set(digest, unique.length);
      unique.push({ event, digest, collapsed: Object.freeze([]) });
      continue;
    }
    duplicateCount += 1;
    const existing = unique[existingIndex];
    const representativeId = existing.event.id?.trim() ?? `digest:${existing.digest.slice(0, 16)}`;
    const collapsedId = id === representativeId ? `${id}:repeat` : id;
    unique[existingIndex] = {
      event: existing.event,
      digest: existing.digest,
      collapsed: Object.freeze([...existing.collapsed, collapsedId]),
    };
  }
  return Object.freeze({
    unique: Object.freeze(unique),
    duplicateCount,
    totalSeen: events.length,
  });
}

/* ─────────────────────────────────────────────────────────────
 * Replay (generalized foundation-loop idempotent replay)
 * ────────────────────────────────────────────────────────────*/

export interface ReplayResult<S> {
  /** The final state after applying each unique event exactly once. */
  readonly state: S;
  /** The unique events actually applied, in total order. */
  readonly applied: readonly KernelEventRecord[];
  /** How many duplicate deliveries collapsed without re-application. */
  readonly duplicateCount: number;
  /** Total deliveries considered. */
  readonly totalSeen: number;
  /** Tenant scope applied, when provided. */
  readonly tenantId: string | null;
}

export type ReplayOptions = DeduplicationOptions;

/**
 * Idempotent event replay — the event-plane generalization of the
 * foundation loop's verified idempotent replay: a stream that contains
 * duplicates, arrives out of order, or is replayed AGAIN produces EXACTLY
 * the same state as each unique event applied once, in total order. The
 * reducer is invoked once per unique event, never per delivery — a
 * duplicate NEVER double-applies.
 *
 * Pure: the reducer must not mutate; state threading is functional.
 */
export function replayEvents<S>(
  events: readonly KernelEventRecord[],
  initialState: S,
  reducer: (state: S, event: KernelEventRecord) => S,
  options: ReplayOptions = {},
): ReplayResult<S> {
  const deduplication = dedupeEvents(events, options);
  let state = initialState;
  const applied: KernelEventRecord[] = [];
  for (const entry of deduplication.unique) {
    state = reducer(state, entry.event);
    applied.push(entry.event);
  }
  return Object.freeze({
    state,
    applied: Object.freeze(applied),
    duplicateCount: deduplication.duplicateCount,
    totalSeen: deduplication.totalSeen,
    tenantId: options.tenantId ?? null,
  });
}

/* ─────────────────────────────────────────────────────────────
 * Consumption-time conformance (fail-closed event gate)
 * ────────────────────────────────────────────────────────────*/

/**
 * Fail-closed consumption gate over a single event: the event type MUST be
 * registered in the taxonomy (unknown types never silently enter the
 * observation tail) and the required coordinate fields must be present.
 * Combine with `orderEvents({ requireAuthorityProvenance: true })` and
 * `dedupeEvents({ requireCause: true })` for the full production posture.
 */
export function validateEventRecord(event: KernelEventRecord): void {
  if (!isKnownEventType(event.event_type)) {
    throw new UnknownEventTypeError(event.event_type);
  }
  if (!event.aggregate_type.trim() || !event.aggregate_id.trim()) {
    throw new Error(`event_semantics: event "${eventIdOf(event)}" requires aggregate_type and aggregate_id`);
  }
  if (event.payload != null && (typeof event.payload !== "object" || Array.isArray(event.payload))) {
    throw new Error(`event_semantics: event "${eventIdOf(event)}" payload must be a JSON object`);
  }
  classifyEvent(event.event_type);
}

/**
 * Consume a batch under the FULL production posture: validate every event
 * against the taxonomy, require issuance provenance, require a causation
 * root, then dedupe and order. Returns the consumption plan — unique
 * events in total order with their collapsed duplicates and alert policy.
 */
export interface ConsumptionPlan {
  readonly ordered: readonly DeduplicatedEvent[];
  readonly duplicateCount: number;
  readonly totalSeen: number;
  /** Alert policy per unique event (resolved from the taxonomy). */
  readonly alertPolicies: readonly { readonly eventId: string; readonly policy: EventAlertPolicy }[];
}

export function consumeEvents(
  events: readonly KernelEventRecord[],
  options: ReplayOptions & { readonly tenantId?: string } = {},
): ConsumptionPlan {
  const deduplication = dedupeEvents(events, {
    ...options,
    requireAuthorityProvenance: true,
    requireCause: true,
  });
  for (const entry of deduplication.unique) validateEventRecord(entry.event);
  return Object.freeze({
    ordered: deduplication.unique,
    duplicateCount: deduplication.duplicateCount,
    totalSeen: deduplication.totalSeen,
    alertPolicies: Object.freeze(
      deduplication.unique.map((entry) => ({
        eventId: entry.event.id?.trim() ?? `digest:${entry.digest.slice(0, 16)}`,
        policy: eventAlertPolicy(entry.event.event_type),
      })),
    ),
  });
}

/* ─────────────────────────────────────────────────────────────
 * Time-authority binding helper (issue + stamp in one step)
 * ────────────────────────────────────────────────────────────*/

/**
 * Stamp an event with time-authority issuance provenance: the caller asks
 * the authority for the next timestamp and binds its coordinates onto the
 * event record (occurred_at from the issued instant, sequence/issuer for
 * ordering). This is the ONLY sanctioned way a producer obtains an event
 * timestamp — the authority shape, never a raw `Date.now()`.
 */
export function stampEventWithIssuedTime<T extends Omit<KernelEventRecord, "sequence" | "issuer">>(
  event: T,
  issued: IssuedTimestamp,
): T & { readonly occurred_at: string; readonly sequence: number; readonly issuer: string } {
  assertIssued(issued);
  return {
    ...event,
    occurred_at: event.occurred_at ?? issued.at,
    sequence: issued.sequence,
    issuer: issued.issuer,
  };
}

/** Local re-export of the fail-closed shape guard for producer call sites. */
function assertIssued(issued: IssuedTimestamp): void {
  if (!isAuthorityTimestampShape(issued)) {
    throw new Error("event_semantics: event timestamps must be issued by the TimeAuthority");
  }
}

/**
 * Total-order comparison bound to the authority's own comparison law: an
 * event stream ordered by `compareEventOrder` is consistent with the
 * authority's `compareIssued` over the same issuance coordinates. Exported
 * for suites proving the two orders agree (the concurrency guarantee).
 */
export { compareIssued };