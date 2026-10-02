/**
 * CoreGrid — tenant-scoped event routing & subscriptions (V1CAP-043 / J-021 /
 * MISSION-R-63), composed over the per-event security contract (V1CAP-044 /
 * J-022 / MISSION-R-81) and the event kernel semantics (V1CAP-042 / J-020 /
 * MISSION-R-15).
 *
 * G-043 + Constitution §35 demand the governed subscription half of the event
 * plane: realtime must respect tenant, authorization, subscriptions and
 * privacy — "never broadcast unauthorized events". Notifications fanout
 * exists (phase 10), but no stream evidenced a governed subscription model
 * over cg_event. This module IS that contract, and it is the first consumer
 * of M-R-81's consumption gate: it REUSES `deliverEvent` as the single
 * authorization enforcement point — the routing layer never re-implements,
 * weakens or forks the per-event security decision.
 *
 * Law of this module:
 * - SUBSCRIPTIONS ARE DECLARED OBJECTS: a subscription carries the subscriber
 *   identity, the tenant scope, an event-type filter over the registered
 *   taxonomy, the declared visibility scope set, the declared sensitivity
 *   ceiling, and the delivery semantics (ordering posture, dedup posture,
 *   bounded undelivered queue). The declaration is server-resolved truth —
 *   client declarations are never trusted beyond this validated shape
 *   (Constitution §26). A subscription declaration is IMMUTABLE while it
 *   exists: re-subscription must re-declare it identically; a scope change
 *   is a retire + a NEW subscription identity (a new identity re-delivers
 *   history through the gate under its own ceiling — never in place).
 * - NO BROADCAST PRIMITIVE: routing evaluates every event against every
 *   matching subscription through the gate, per subscription. An event with
 *   zero matching subscriptions reaches zero subscribers. A subscription can
 *   never receive an event its declared ceiling + tenant disallow — the gate
 *   (not this module) decides ALLOW | DENY | REDACT per event per
 *   subscription, and every denial is a first-class auditable record.
 * - BACKPRESSURE IS BOUNDED AND EXPLICIT: each subscription declares
 *   `maxUndelivered`. When the undelivered queue is full the subscription is
 *   SUSPENDED for overload with an auditable record naming the event that
 *   could not be enqueued. While suspended, deliverable events are SHED with
 *   an audit record — never silently dropped, never silently delayed, never
 *   queued. Delivery resumes ONLY on explicit re-subscription (identical
 *   declaration); the shed load is recovered by replay through the SAME gate.
 * - REPLAY IS NOT AN AUTHORIZATION BYPASS: a subscriber replays from a
 *   declared sequence point within its tenant; every replay candidate passes
 *   through the same `deliverEvent` gate with the same declared ceiling.
 *   Revoked / tampered / contract-less events stay undeliverable in replay.
 *   A suspended subscription cannot replay — re-subscription comes first.
 * - ORDERING RESPECTS THE TENANT TOTAL ORDER: the undelivered queue is kept
 *   in `compareEventOrder` order (event-semantics time-authority order,
 *   never arrival order) and drained front-first. The delivery cursor
 *   (last delivered event) is a one-way frontier: an event whose total-order
 *   position precedes the cursor is "late" — its position cannot be honored,
 *   it is not delivered, and the fact is auditable (fail-closed, never
 *   re-ordered, never silently inserted into history). Recovery for late
 *   events is a NEW subscription replaying from a sequence point.
 * - DEDUP COMPATIBILITY: per subscription, the content+cause digest
 *   (`eventDedupDigest`, composed — never redefined) marks what has been
 *   enqueued or delivered. A duplicate delivery collapses to a `duplicate`
 *   outcome — never delivered twice — across live routing, pending queues
 *   and replay alike.
 * - CONSUMPTION POSTURE: routing consumes only events that pass the
 *   event-semantics conformance gate (`validateEventRecord`) — unknown event
 *   types are rejected loudly, never silently classified or routed.
 * - PURITY: no I/O, no persistence, no wall-clock sampling. Audit instants
 *   are supplied by the caller. Persistence of queues, cursors and digest
 *   histories arrives with the substrate; this layer is an authored
 *   contract, explicitly incomplete there.
 */

import {
  canonicalJson,
  compareEventOrder,
  eventDedupDigest,
  isKnownEventType,
  validateEventRecord,
  type KernelEventRecord,
} from "./event-semantics";
import {
  deliverEvent,
  isEventSensitivity,
  isEventVisibilityScope,
  type EventConsumptionCandidate,
  type EventDenialRecord,
  type EventDelivery,
  type EventSubscriber,
  type EventSensitivity,
  type EventVisibilityScope,
} from "./event-security";

/**
 * The consumption-time input the routing plane accepts, re-exported so
 * routing consumers compose with the gate's own candidate type (never a
 * routing-local redefinition).
 */
export type { EventConsumptionCandidate };

/* ─────────────────────────────────────────────────────────────
 * Subscription declaration (server-resolved, immutable)
 * ────────────────────────────────────────────────────────────*/

export type EventSubscriptionStatus = "active" | "suspended";

/**
 * The delivery semantics a subscription declares. The vocabulary is closed
 * and fail-closed: the only lawful posture in V1 is the tenant total order
 * (event-semantics time-authority order) with content+cause digest
 * deduplication — arrival order is never a delivery order.
 */
export interface EventDeliverySemantics {
  readonly ordering: "tenant-total-order";
  readonly dedup: "collapse-duplicates";
  /**
   * Bound on the undelivered queue. Exceeding it suspends the subscription
   * for overload — explicit, auditable, resumable only by re-subscription.
   */
  readonly maxUndelivered: number;
}

export interface EventSubscription {
  readonly subscriptionId: string;
  /** Subscriber identity (audit: WHO receives or is denied — Constitution §43). */
  readonly subscriberId: string;
  readonly tenantId: string;
  /**
   * Declared event-type filter over the registered taxonomy. An EMPTY filter
   * declares every registered type. Types outside the filter never route to
   * this subscription — the declaration itself is the auditable scope.
   */
  readonly eventTypes: readonly string[];
  /** Declared visibility scopes this subscriber is authorized to receive. */
  readonly visibilityScopes: readonly EventVisibilityScope[];
  /** Declared sensitivity ceiling (J-011 data-scope law). */
  readonly maxSensitivity: EventSensitivity;
  readonly delivery: EventDeliverySemantics;
}

export interface EventSubscriptionReceipt {
  readonly subscriptionId: string;
  readonly status: EventSubscriptionStatus;
  /** True when this act of subscription lifted an overload suspension. */
  readonly resumedFromSuspension: boolean;
  readonly queueDepth: number;
}

/* ─────────────────────────────────────────────────────────────
 * Routing outcomes (per event × per subscription)
 * ────────────────────────────────────────────────────────────*/

export type EventRouteOutcomeKind =
  "queued" | "denied" | "duplicate" | "late" | "overload" | "suspended";

export interface EventRouteOutcome {
  readonly subscriptionId: string;
  readonly subscriberId: string;
  readonly kind: EventRouteOutcomeKind;
  readonly eventId: string;
  /**
   * The gated delivery for `queued` outcomes — the ALLOW view, or the REDACT
   * view with its redaction records attached. Null for every other kind.
   */
  readonly delivery: EventDelivery | null;
  /** The gate's denial record for `denied` outcomes. Null otherwise. */
  readonly denial: EventDenialRecord | null;
  /** The backpressure record when this outcome triggered the suspension. */
  readonly backpressure: EventBackpressureRecord | null;
  readonly detail: string;
  /** Audit instant supplied by the caller — never wall-clock sampled. */
  readonly recordedAt: string;
}

/**
 * The auditable overload record: which event could not be enqueued, at what
 * bound, and when. Suspension is a first-class state — never a silent drop.
 */
export interface EventBackpressureRecord {
  readonly subscriptionId: string;
  readonly subscriberId: string;
  readonly tenantId: string;
  readonly reason: "overload";
  readonly queueLimit: number;
  readonly queueDepth: number;
  readonly eventId: string;
  readonly detail: string;
  readonly recordedAt: string;
}

export interface EventRoutingResult {
  readonly eventId: string;
  readonly outcomes: readonly EventRouteOutcome[];
  readonly recordedAt: string;
}

export interface SubscriptionDrainResult {
  readonly subscriptionId: string;
  readonly status: EventSubscriptionStatus;
  /** The gated deliveries handed over, in tenant total order. */
  readonly deliveries: readonly EventDelivery[];
  readonly remaining: number;
}

export interface EventReplayResult {
  readonly subscriptionId: string;
  readonly fromSequence: number | null;
  /** Candidates that entered the gate (window + out-of-window-but-gated). */
  readonly considered: number;
  /** Candidates excluded BEFORE the gate: sequence below the declared point. */
  readonly excludedBelowFromSequence: number;
  readonly outcomes: readonly EventRouteOutcome[];
  readonly queuedCount: number;
  readonly duplicateCount: number;
  readonly deniedCount: number;
  /** True when the replay hit the undelivered bound mid-replay. */
  readonly suspendedDuringReplay: boolean;
}

export interface SubscriptionStatusSnapshot {
  readonly subscriptionId: string;
  readonly subscriberId: string;
  readonly tenantId: string;
  readonly status: EventSubscriptionStatus;
  readonly queueDepth: number;
  readonly deliveredCount: number;
  readonly suspension: EventBackpressureRecord | null;
}

/* ─────────────────────────────────────────────────────────────
 * Typed rejections
 * ────────────────────────────────────────────────────────────*/

/** Declaration-time rejection: the subscription cannot be declared at all. */
export class EventRoutingError extends Error {
  readonly field: string;

  constructor(field: string, detail: string) {
    super(`event_routing: ${field} — ${detail}`);
    this.name = "EventRoutingError";
    this.field = field;
  }
}

/** A subscription id already exists with a DIFFERENT declaration. */
export class SubscriptionConflictError extends Error {
  readonly subscriptionId: string;

  constructor(subscriptionId: string, detail: string) {
    super(`event_routing: subscription "${subscriptionId}" — ${detail}`);
    this.name = "SubscriptionConflictError";
    this.subscriptionId = subscriptionId;
  }
}

export class SubscriptionNotFoundError extends Error {
  readonly subscriptionId: string;

  constructor(subscriptionId: string) {
    super(`event_routing: subscription "${subscriptionId}" is not registered`);
    this.name = "SubscriptionNotFoundError";
    this.subscriptionId = subscriptionId;
  }
}

/**
 * The subscription is suspended for overload: drain and replay are
 * unreachable until an explicit re-subscription (identical declaration).
 */
export class SubscriptionSuspendedError extends Error {
  readonly subscriptionId: string;
  readonly suspension: EventBackpressureRecord | null;

  constructor(subscriptionId: string, suspension: EventBackpressureRecord | null) {
    super(
      `event_routing: subscription "${subscriptionId}" is suspended for overload — ` +
        "delivery resumes only on explicit re-subscription; shed load is recovered by replay through the same gate",
    );
    this.name = "SubscriptionSuspendedError";
    this.subscriptionId = subscriptionId;
    this.suspension = suspension;
  }
}

/* ─────────────────────────────────────────────────────────────
 * Shape helpers (local mirrors of the kernel's private conventions)
 * ────────────────────────────────────────────────────────────*/

/** Mirrors `isEnvelopeRef` (trimmed, 1–bound characters). */
function isRef(value: unknown, maxLength: number): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= maxLength;
}

/** Mirror of the private `eventIdOf` convention in event-semantics. */
function eventIdOf(event: KernelEventRecord): string {
  return event.id?.trim() || `digest:${eventDedupDigest(event).slice(0, 16)}`;
}

function assertAuditInstant(now: string): string {
  if (typeof now !== "string" || Number.isNaN(Date.parse(now))) {
    throw new EventRoutingError("now", "the audit instant must be a valid ISO-8601 timestamp");
  }
  return now;
}

/* ─────────────────────────────────────────────────────────────
 * Internal subscription state
 * ────────────────────────────────────────────────────────────*/

interface PendingDelivery {
  /** The ORIGINAL event (order coordinates; the gated view may be redacted). */
  readonly event: KernelEventRecord;
  readonly digest: string;
  readonly delivery: EventDelivery;
}

interface SubscriptionEntry {
  readonly declaration: EventSubscription;
  status: EventSubscriptionStatus;
  suspension: EventBackpressureRecord | null;
  /** Undelivered queue, kept in tenant total order. */
  pending: PendingDelivery[];
  /** Content+cause digests enqueued OR delivered — dedup across both. */
  readonly seenDigests: Set<string>;
  deliveredCount: number;
  /** Last DELIVERED event — the one-way total-order frontier. */
  cursor: KernelEventRecord | null;
}

/* ─────────────────────────────────────────────────────────────
 * The router
 * ────────────────────────────────────────────────────────────*/

export class EventRouter {
  private readonly subscriptions = new Map<string, SubscriptionEntry>();

  /**
   * Declare (or explicitly re-declare) a subscription. Fail-closed on any
   * malformed or unregistered field. The declaration is immutable: an ACTIVE
   * subscription id re-declared identically is an idempotent no-op; a
   * SUSPENDED subscription id re-declared identically is the EXPLICIT
   * re-subscription that lifts the overload suspension — nothing else does.
   * A scope change requires retiring the id and subscribing a new identity.
   */
  subscribe(declaration: EventSubscription): EventSubscriptionReceipt {
    EventRouter.validateDeclaration(declaration);
    const existing = this.subscriptions.get(declaration.subscriptionId);
    if (existing != null) {
      if (canonicalJson(existing.declaration) !== canonicalJson(declaration)) {
        throw new SubscriptionConflictError(
          declaration.subscriptionId,
          "the declaration is immutable — retire this id and subscribe a new identity to change scope",
        );
      }
      const wasSuspended = existing.status === "suspended";
      if (wasSuspended) {
        existing.status = "active";
        existing.suspension = null;
      }
      return {
        subscriptionId: declaration.subscriptionId,
        status: existing.status,
        resumedFromSuspension: wasSuspended,
        queueDepth: existing.pending.length,
      };
    }
    this.subscriptions.set(declaration.subscriptionId, {
      declaration,
      status: "active",
      suspension: null,
      pending: [],
      seenDigests: new Set<string>(),
      deliveredCount: 0,
      cursor: null,
    });
    return {
      subscriptionId: declaration.subscriptionId,
      status: "active",
      resumedFromSuspension: false,
      queueDepth: 0,
    };
  }

  /** Explicitly retire a subscription; its identity and state close. */
  unsubscribe(subscriptionId: string): void {
    const entry = this.subscriptions.get(subscriptionId);
    if (entry == null) throw new SubscriptionNotFoundError(subscriptionId);
    this.subscriptions.delete(subscriptionId);
  }

  /**
   * Route one event against every matching subscription. The event must pass
   * the event-semantics consumption posture (`validateEventRecord`) before
   * any subscription is consulted — unknown event types are rejected loudly,
   * never routed. Matching = the subscription's declared event-type filter;
   * tenant, visibility, sensitivity and authenticity are the GATE's decision,
   * invoked per subscription (there is no broadcast primitive here).
   */
  routeEvent(
    candidate: EventConsumptionCandidate,
    options: { readonly now: string },
  ): EventRoutingResult {
    const recordedAt = assertAuditInstant(options.now);
    validateEventRecord(candidate.event);
    const digest = eventDedupDigest(candidate.event);
    const outcomes: EventRouteOutcome[] = [];
    for (const entry of this.subscriptions.values()) {
      if (!EventRouter.matchesTypeFilter(entry, candidate.event)) continue;
      outcomes.push(this.gateAndEnqueue(entry, candidate, digest, recordedAt));
    }
    return {
      eventId: eventIdOf(candidate.event),
      outcomes: Object.freeze(outcomes),
      recordedAt,
    };
  }

  /**
   * Replay events to one subscription from a declared sequence point within
   * its tenant. Every in-window candidate passes through the SAME gate with
   * the subscription's own declared ceiling — replay is never an
   * authorization bypass — and dedup collapses already-delivered history so
   * replaying a stream twice reconstructs the identical delivered state.
   * The replay batch is applied in tenant total order (time-authority order,
   * never the supplied order). Candidates below the declared sequence point
   * are excluded before the gate; candidates without issuance provenance
   * still reach the gate and are DENIED there (unverifiable issuance) —
   * nothing silently bypasses.
   */
  replay(
    subscriptionId: string,
    candidates: readonly EventConsumptionCandidate[],
    options: { readonly now: string; readonly fromSequence?: number | null },
  ): EventReplayResult {
    const recordedAt = assertAuditInstant(options.now);
    const entry = this.require(subscriptionId);
    if (entry.status === "suspended") {
      throw new SubscriptionSuspendedError(subscriptionId, entry.suspension);
    }
    const fromSequence = options.fromSequence ?? null;
    if (fromSequence !== null && (!Number.isInteger(fromSequence) || fromSequence < 0)) {
      throw new EventRoutingError("fromSequence", "must be a non-negative integer when declared");
    }
    let excludedBelowFromSequence = 0;
    const window: EventConsumptionCandidate[] = [];
    for (const candidate of candidates) {
      const sequence = candidate.event.sequence;
      if (fromSequence !== null && typeof sequence === "number" && sequence < fromSequence) {
        excludedBelowFromSequence += 1;
        continue;
      }
      validateEventRecord(candidate.event);
      window.push(candidate);
    }
    window.sort((a, b) => compareEventOrder(a.event, b.event));
    const outcomes: EventRouteOutcome[] = [];
    let queuedCount = 0;
    let duplicateCount = 0;
    let deniedCount = 0;
    let suspendedDuringReplay = false;
    for (const candidate of window) {
      if (suspendedDuringReplay) {
        // The undelivered bound was hit mid-replay: the remaining candidates
        // are shed WITH audit records — never silently dropped — and are
        // recovered by re-subscription plus a replay from a later point.
        outcomes.push(this.suspendedOutcome(entry, candidate, recordedAt));
        continue;
      }
      const outcome = this.gateAndEnqueue(
        entry,
        candidate,
        eventDedupDigest(candidate.event),
        recordedAt,
      );
      outcomes.push(outcome);
      if (outcome.kind === "queued") queuedCount += 1;
      else if (outcome.kind === "duplicate") duplicateCount += 1;
      else if (outcome.kind === "denied") deniedCount += 1;
      else if (outcome.kind === "overload") suspendedDuringReplay = true;
    }
    return {
      subscriptionId,
      fromSequence,
      considered: window.length,
      excludedBelowFromSequence,
      outcomes: Object.freeze(outcomes),
      queuedCount,
      duplicateCount,
      deniedCount,
      suspendedDuringReplay,
    };
  }

  /**
   * Hand over the pending gated deliveries in tenant total order (front of
   * the ordered queue first), advancing the subscription's one-way delivery
   * frontier. A suspended subscription cannot drain — re-subscribe first.
   */
  drain(
    subscriptionId: string,
    options: { readonly maxEvents?: number } = {},
  ): SubscriptionDrainResult {
    const entry = this.require(subscriptionId);
    if (entry.status === "suspended") {
      throw new SubscriptionSuspendedError(subscriptionId, entry.suspension);
    }
    const maxEvents = options.maxEvents ?? entry.pending.length;
    if (!Number.isInteger(maxEvents) || maxEvents < 0) {
      throw new EventRoutingError("maxEvents", "must be a non-negative integer");
    }
    const handed = entry.pending.splice(0, maxEvents);
    if (handed.length > 0) {
      entry.cursor = handed[handed.length - 1].event;
      entry.deliveredCount += handed.length;
    }
    return {
      subscriptionId,
      status: entry.status,
      deliveries: Object.freeze(handed.map((pending) => pending.delivery)),
      remaining: entry.pending.length,
    };
  }

  status(subscriptionId: string): SubscriptionStatusSnapshot {
    return EventRouter.snapshot(this.require(subscriptionId));
  }

  /** All subscription snapshots, sorted by id for deterministic reading. */
  statuses(): readonly SubscriptionStatusSnapshot[] {
    return Object.freeze(
      [...this.subscriptions.values()]
        .map((entry) => EventRouter.snapshot(entry))
        .sort((a, b) =>
          a.subscriptionId < b.subscriptionId ? -1 : a.subscriptionId > b.subscriptionId ? 1 : 0,
        ),
    );
  }

  /* ── internals ──*/

  private require(subscriptionId: string): SubscriptionEntry {
    const entry = this.subscriptions.get(subscriptionId);
    if (entry == null) throw new SubscriptionNotFoundError(subscriptionId);
    return entry;
  }

  private static validateDeclaration(declaration: EventSubscription): void {
    if (!isRef(declaration.subscriptionId, 200)) {
      throw new EventRoutingError("subscriptionId", "must be 1–200 characters");
    }
    if (!isRef(declaration.subscriberId, 200)) {
      throw new EventRoutingError("subscriberId", "must be 1–200 characters");
    }
    if (!isRef(declaration.tenantId, 128)) {
      throw new EventRoutingError("tenantId", "must be 1–128 characters");
    }
    if (
      !Array.isArray(declaration.eventTypes) ||
      declaration.eventTypes.some((t) => !isRef(t, 200))
    ) {
      throw new EventRoutingError("eventTypes", "must be an array of 1–200 character event types");
    }
    for (const eventType of declaration.eventTypes) {
      if (!isKnownEventType(eventType)) {
        throw new EventRoutingError(
          "eventTypes",
          `"${eventType}" is not registered in the taxonomy — a subscription can only declare known event types (fail-closed)`,
        );
      }
    }
    if (
      !Array.isArray(declaration.visibilityScopes) ||
      declaration.visibilityScopes.some((scope) => !isEventVisibilityScope(scope))
    ) {
      throw new EventRoutingError("visibilityScopes", "must all be registered visibility scopes");
    }
    if (!isEventSensitivity(declaration.maxSensitivity)) {
      throw new EventRoutingError(
        "maxSensitivity",
        `"${String(declaration.maxSensitivity)}" is not a registered sensitivity`,
      );
    }
    const delivery = declaration.delivery;
    if (delivery == null || typeof delivery !== "object") {
      throw new EventRoutingError("delivery", "must declare delivery semantics");
    }
    if (delivery.ordering !== "tenant-total-order") {
      throw new EventRoutingError(
        "delivery.ordering",
        `"${String(delivery.ordering)}" is not a registered ordering posture — delivery respects the tenant total order`,
      );
    }
    if (delivery.dedup !== "collapse-duplicates") {
      throw new EventRoutingError(
        "delivery.dedup",
        `"${String(delivery.dedup)}" is not a registered dedup posture`,
      );
    }
    if (!Number.isInteger(delivery.maxUndelivered) || delivery.maxUndelivered <= 0) {
      throw new EventRoutingError(
        "delivery.maxUndelivered",
        "must be a positive integer — backpressure is always bounded",
      );
    }
  }

  private static matchesTypeFilter(entry: SubscriptionEntry, event: KernelEventRecord): boolean {
    const filter = entry.declaration.eventTypes;
    return filter.length === 0 || filter.includes(event.event_type);
  }

  /**
   * The single evaluation path: gate the candidate for this subscription's
   * declared identity/tenant/scopes/ceiling, then apply the routing state
   * machine to the gate's decision. The gate's decision is NEVER overridden.
   */
  private gateAndEnqueue(
    entry: SubscriptionEntry,
    candidate: EventConsumptionCandidate,
    digest: string,
    recordedAt: string,
  ): EventRouteOutcome {
    const declaration = entry.declaration;
    const eventId = eventIdOf(candidate.event);
    const base = {
      subscriptionId: declaration.subscriptionId,
      subscriberId: declaration.subscriberId,
      eventId,
      recordedAt,
    };
    const subscriber: EventSubscriber = {
      subscriberId: declaration.subscriberId,
      tenantId: declaration.tenantId,
      visibilityScopes: declaration.visibilityScopes,
      maxSensitivity: declaration.maxSensitivity,
    };
    const delivery = deliverEvent(candidate, subscriber, { now: recordedAt });

    if (delivery.decision === "DENY") {
      return Object.freeze({
        ...base,
        kind: "denied",
        delivery: null,
        denial: delivery.denial,
        backpressure: null,
        detail: delivery.denial?.detail ?? "denied by the consumption gate",
      });
    }

    if (entry.seenDigests.has(digest)) {
      return Object.freeze({
        ...base,
        kind: "duplicate",
        delivery: null,
        denial: null,
        backpressure: null,
        detail:
          `content+cause digest already enqueued or delivered to this subscription — ` +
          "collapsed per the declared dedup semantics, never delivered twice",
      });
    }

    if (entry.status === "suspended") {
      return this.suspendedOutcome(entry, candidate, recordedAt);
    }

    if (entry.cursor !== null && compareEventOrder(candidate.event, entry.cursor) < 0) {
      return Object.freeze({
        ...base,
        kind: "late",
        delivery: null,
        denial: null,
        backpressure: null,
        detail:
          `event "${eventId}" precedes the delivery frontier in the tenant total order — ` +
          "its position cannot be honored, so it is not delivered (fail-closed, auditable; " +
          "recovery is a new subscription identity replaying from a sequence point)",
      });
    }

    const maxUndelivered = declaration.delivery.maxUndelivered;
    if (entry.pending.length >= maxUndelivered) {
      const record: EventBackpressureRecord = Object.freeze({
        subscriptionId: declaration.subscriptionId,
        subscriberId: declaration.subscriberId,
        tenantId: declaration.tenantId,
        reason: "overload",
        queueLimit: maxUndelivered,
        queueDepth: entry.pending.length,
        eventId,
        detail:
          `undelivered queue of subscription "${declaration.subscriptionId}" is at its bound ` +
          `(${entry.pending.length}/${maxUndelivered}) — subscription SUSPENDED for overload; ` +
          `event "${eventId}" is shed with this audit record and recoverable only by explicit ` +
          "re-subscription plus replay through the same gate",
        recordedAt,
      });
      entry.status = "suspended";
      entry.suspension = record;
      return Object.freeze({
        ...base,
        kind: "overload",
        delivery: null,
        denial: null,
        backpressure: record,
        detail: record.detail,
      });
    }

    entry.seenDigests.add(digest);
    entry.pending.push({ event: candidate.event, digest, delivery });
    entry.pending.sort((a, b) => compareEventOrder(a.event, b.event));
    return Object.freeze({
      ...base,
      kind: "queued",
      delivery,
      denial: null,
      backpressure: null,
      detail:
        delivery.decision === "REDACT"
          ? "gated REDACT view queued for delivery (minimization recorded on the delivery)"
          : "gated ALLOW view queued for delivery",
    });
  }

  private suspendedOutcome(
    entry: SubscriptionEntry,
    candidate: EventConsumptionCandidate,
    recordedAt: string,
  ): EventRouteOutcome {
    const declaration = entry.declaration;
    return Object.freeze({
      subscriptionId: declaration.subscriptionId,
      subscriberId: declaration.subscriberId,
      kind: "suspended" as const,
      eventId: eventIdOf(candidate.event),
      delivery: null,
      denial: null,
      backpressure: null,
      detail:
        `subscription "${declaration.subscriptionId}" is suspended for overload — ` +
        "the event is shed with this audit record (never silently dropped, never silently " +
        "delayed); recovery is explicit re-subscription plus replay through the same gate",
      recordedAt,
    });
  }

  private static snapshot(entry: SubscriptionEntry): SubscriptionStatusSnapshot {
    const declaration = entry.declaration;
    return {
      subscriptionId: declaration.subscriptionId,
      subscriberId: declaration.subscriberId,
      tenantId: declaration.tenantId,
      status: entry.status,
      queueDepth: entry.pending.length,
      deliveredCount: entry.deliveredCount,
      suspension: entry.suspension,
    };
  }
}
