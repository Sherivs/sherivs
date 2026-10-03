/**
 * CoreGrid — H3-014 (J-020) Event Kernel Semantics Engineer.
 *
 * Semantics proofs for the event kernel (cg_event consumption) against
 * `frontend/src/lib/kernel/event-semantics.ts` and its substrate
 * `frontend/src/lib/kernel/time-authority.ts`, composed over the
 * `eventDraft` envelope of `frontend/src/lib/kernel/reality.ts` (all
 * engines READ-ONLY — proven, not modified).
 *
 * Invariants under test:
 * - TAXONOMY: event types are registered per domain through the public
 *   gate; ownership is exclusive; unknown significance values are
 *   rejected at registration; deregistration closes the vocabulary;
 *   UNKNOWN event types fail closed at classification and consumption
 *   (UnknownEventTypeError) — never silently classified.
 * - SIGNIFICANCE: closed routine|notable|critical vocabulary mapped to
 *   the alerting policy none|notify|escalate, declared once per type.
 * - DIGEST/DEDUPLICATION: the content+cause digest is canonical (order-
 *   independent) over (type, tenant, aggregate, payload) PLUS the
 *   causation root (G-010); duplicate deliveries collapse into the
 *   first event IN TOTAL ORDER (not first arrival); same content with a
 *   different cause never collapses; cross-tenant look-alikes never
 *   collapse; unrooted events are rejected by default (fail-closed).
 * - ORDERING: total order is (instant, issuance sequence, issuer, event
 *   identity) — never arrival order, never IDs alone; input is never
 *   mutated; the same stream in ANY permutation orders identically;
 *   strict posture requires time-authority issuance provenance
 *   (UnauthoritativeTimeError); the event order agrees with the time
 *   authority's own compareIssued over the same issuance coordinates.
 * - REPLAY: duplicated + out-of-order streams replay to exactly the
 *   state of each unique event applied once in total order; re-replay
 *   is idempotent; the reducer runs once per unique event, never per
 *   delivery.
 * - CONSUMPTION: the production gate (consumeEvents) requires taxonomy
 *   membership, issuance provenance and a causation root, and resolves
 *   the alert policy per unique event.
 *
 * FINDINGS recorded (documented behavior tested; engines NOT modified):
 * - F-1: `eventDraft` (kernel/reality.ts) emits NO causation coordinates
 *   (causation_id/parent_event_id/declared_origin), so a verbatim draft
 *   fails the default `requireCause` dedup posture with
 *   EventWithoutCauseError. The fail-closed behavior is proven here;
 *   producers must attach the causation root before consumption.
 * - F-2: `eventDraft` also emits no issuance provenance (sequence/
 *   issuer), so verbatim drafts are rejected by strict consumption
 *   (`consumeEvents`); `stampEventWithIssuedTime` is the sanctioned
 *   bridge (tested below).
 * - F-3: for digest-identical duplicate deliveries that carry NO `id`
 *   (both fall back to the same digest stand-in id), every order
 *   coordinate ties and `compareEventOrder` returns 0, so stable sort
 *   keeps ARRIVAL order: the surviving representative's non-digest
 *   fields (e.g. recorded_at) are arrival-dependent in that edge.
 *   Digest-level uniqueness itself stays permutation-invariant (both
 *   facts proven below); give duplicates distinct ids for row-level
 *   determinism.
 * - F-4: `hasIssuanceProvenance` THROWS (via eventInstantMs) instead of
 *   returning false for an event that carries provenance fields but no
 *   parsable occurred_at/recorded_at; under
 *   `orderEvents({ requireAuthorityProvenance: true })` that shape
 *   surfaces the generic "cannot be ordered" error rather than
 *   UnauthoritativeTimeError. Documented behavior tested.
 * - F-5: `consumeEvents` does not force a tenant scope — a batch
 *   spanning tenants is consumed as ONE stream unless the caller passes
 *   `tenantId` (documented defense-in-depth). Cross-tenant look-alikes
 *   still never collapse (tenant is inside the digest), but consumption
 *   isolation is caller responsibility in V1; the DB path must scope.
 * - F-6: `orderEvents` over a SINGLE element never invokes the sort
 *   comparator, so an event with no parsable occurred_at/recorded_at
 *   passes a one-element orderEvents silently — the "cannot be ordered"
 *   rejection only fires when events are actually compared (proven
 *   below). Batch consumption (dedupe/consume over ≥2 events) is
 *   unaffected.
 */
import { describe, expect, it } from "vitest";
import {
  EVENT_SIGNIFICANCES,
  EventWithoutCauseError,
  KERNEL_BUILTIN_EVENT_TYPES,
  KERNEL_CORE_EVENT_DOMAIN_REF,
  UnknownEventTypeError,
  UnauthoritativeTimeError,
  alertPolicyFor,
  canonicalJson,
  classifyEvent,
  compareEventOrder,
  consumeEvents,
  dedupeEvents,
  deregisterEventTypes,
  eventAlertPolicy,
  eventCause,
  eventDedupDigest,
  eventTypeOwner,
  hasIssuanceProvenance,
  isEventSignificance,
  isKnownEventType,
  isUnknownEventTypeError,
  orderEvents,
  registerEventTypes,
  registeredEventDomains,
  replayEvents,
  stampEventWithIssuedTime,
  validateEventRecord,
  type EventSignificance,
  type KernelEventRecord,
} from "@/lib/kernel/event-semantics";
import { compareIssued } from "@/lib/kernel/event-semantics";
import {
  FixedClock,
  SteppedClock,
  TimeAuthority,
  isAuthorityTimestampShape,
  type IssuedTimestamp,
} from "@/lib/kernel/time-authority";
import { eventDraft } from "@/lib/kernel/reality";

/* ─────────────────────────────────────────────────────────────
 * Deterministic fixtures — fixed instants, no wall clock, no I/O.
 * ────────────────────────────────────────────────────────────*/

const T0 = "2026-09-30T12:00:00.000Z";
const T1 = "2026-09-30T12:00:01.000Z";
const T2 = "2026-09-30T12:00:02.000Z";
const T3 = "2026-09-30T12:00:03.000Z";
const T4 = "2026-09-30T12:00:04.000Z";
const T5 = "2026-09-30T12:00:05.000Z";
const T6 = "2026-09-30T12:00:06.000Z";
const NOW = T0;

/** Base event record; every field overridable per proof. */
function ev(overrides: Partial<KernelEventRecord> = {}): KernelEventRecord {
  return {
    id: "evt-1",
    event_type: "core.state.changed",
    tenant_id: "tenant-1",
    aggregate_type: "object",
    aggregate_id: "agg-1",
    payload: { k: "v" },
    occurred_at: T0,
    recorded_at: T0,
    causation_id: "cause-1",
    ...overrides,
  };
}

/** Deterministic PRNG permutation (mulberry32) — offline, no Math.random. */
function permute(items: readonly number[], seed: number): readonly number[] {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const a = copy[i];
    const b = copy[j];
    if (a === undefined || b === undefined) throw new Error("permutation index out of range");
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}

/** Strict-TS throw capture that preserves the typed error instance. */
function captureError<T extends Error>(fn: () => unknown, errorClass: new (...args: never[]) => T): T {
  try {
    fn();
  } catch (error: unknown) {
    if (error instanceof errorClass) return error;
    throw new Error(`expected ${errorClass.name}, got: ${String(error)}`);
  }
  throw new Error(`expected ${errorClass.name} but nothing was thrown`);
}

/** Mint a provenance-stamped event from a real TimeAuthority issuance. */
function stamped(
  authority: TimeAuthority,
  overrides: Partial<KernelEventRecord> = {},
): KernelEventRecord & { readonly occurred_at: string; readonly sequence: number; readonly issuer: string } {
  return stampEventWithIssuedTime(
    ev({ occurred_at: null, recorded_at: null, ...overrides }),
    authority.now(),
  );
}

/* ─────────────────────────────────────────────────────────────
 * 1. TAXONOMY — declarative registry, exclusive ownership
 * ────────────────────────────────────────────────────────────*/

describe("event kernel taxonomy (declarative, fail-closed registry)", () => {
  const DOMAIN = "test:taxonomy";
  const DECLARATIONS = [
    { eventType: "alpha.happened", significance: "routine" as EventSignificance },
    { eventType: "beta.happened", significance: "notable" as EventSignificance },
    { eventType: "gamma.happened", significance: "critical" as EventSignificance },
  ];

  it("bootstraps the neutral builtin floor under kernel:core at import time", () => {
    expect(KERNEL_CORE_EVENT_DOMAIN_REF).toBe("kernel:core");
    for (const declaration of KERNEL_BUILTIN_EVENT_TYPES) {
      expect(isKnownEventType(declaration.eventType)).toBe(true);
      expect(eventTypeOwner(declaration.eventType)).toBe("kernel:core");
    }
    const domains = registeredEventDomains();
    expect(domains).toContain("kernel:core");
    expect(domains.every((d, i) => i === 0 || domains[i - 1]! <= d)).toBe(true);
  });

  it("returns the registration with sorted, deduplicated event types", () => {
    const registration = registerEventTypes(DOMAIN, [
      DECLARATIONS[1]!,
      DECLARATIONS[0]!,
      DECLARATIONS[2]!,
      DECLARATIONS[1]!,
    ]);
    expect(registration.domainRef).toBe(DOMAIN);
    expect(registration.eventTypes).toEqual(["alpha.happened", "beta.happened", "gamma.happened"]);
    expect(Object.isFrozen(registration.eventTypes)).toBe(true);
  });

  it("rejects invalid domainRefs (<namespace>:<name> pattern, ≤100 chars)", () => {
    const invalid = [
      "runtime",
      "runtime:",
      "Runtime:x",
      "runtime:X",
      "1runtime:x",
      "runtime:a b",
      `${"a".repeat(99)}:x`,
    ];
    for (const ref of invalid) {
      expect(() => registerEventTypes(ref, DECLARATIONS), `domainRef "${ref}"`).toThrowError(
        /not a valid domainRef/,
      );
    }
    const maxValid = `${"a".repeat(98)}:x`;
    expect(maxValid.length).toBe(100);
    expect(() =>
      registerEventTypes(maxValid, [{ eventType: "len.boundary.type", significance: "routine" }]),
    ).not.toThrowError();
    deregisterEventTypes(maxValid);
  });

  it("rejects unknown significance values at registration (closed vocabulary)", () => {
    const bad = "urgent" as unknown as EventSignificance;
    const error = captureError(
      () => registerEventTypes("test:bad-significance", [{ eventType: "t.type", significance: bad }]),
      Error,
    );
    expect(error.message).toContain("unknown significance");
    expect(error.message).toContain("routine|notable|critical");
  });

  it("rejects event types violating the 1–200 character cg_event constraint", () => {
    expect(() =>
      registerEventTypes("test:length", [{ eventType: "x".repeat(201), significance: "routine" }]),
    ).toThrowError(/1–200 character/);
    expect(() =>
      registerEventTypes("test:length", [
        { eventType: "x".repeat(200), significance: "routine" },
      ]),
    ).not.toThrowError();
    deregisterEventTypes("test:length");
  });

  it("enforces exclusive canonical ownership across domains", () => {
    registerEventTypes("test:owner-a", [{ eventType: "own.type", significance: "routine" }]);
    const error = captureError(
      () =>
        registerEventTypes("test:owner-b", [{ eventType: "own.type", significance: "notable" }]),
      Error,
    );
    expect(error.message).toContain('already owned by "test:owner-a"');
    expect(eventTypeOwner("own.type")).toBe("test:owner-a");
    deregisterEventTypes("test:owner-a");
    deregisterEventTypes("test:owner-b");
  });

  it("lets a domain idempotently refresh its OWN vocabulary; replaced types close", () => {
    registerEventTypes("test:replace", [
      { eventType: "repl.first", significance: "routine" },
      { eventType: "repl.second", significance: "notable" },
    ]);
    const refreshed = registerEventTypes("test:replace", [
      { eventType: "repl.first", significance: "critical" },
      { eventType: "repl.third", significance: "routine" },
    ]);
    expect(refreshed.eventTypes).toEqual(["repl.first", "repl.third"]);
    expect(classifyEvent("repl.first")).toBe("critical");
    expect(isKnownEventType("repl.second")).toBe(false);
    expect(() => classifyEvent("repl.second")).toThrowError(UnknownEventTypeError);
    deregisterEventTypes("test:replace");
  });

  it("deregistration closes the vocabulary immediately; unknown domains report false", () => {
    registerEventTypes("test:deregister", [{ eventType: "der.type", significance: "routine" }]);
    expect(deregisterEventTypes("test:deregister")).toBe(true);
    expect(isKnownEventType("der.type")).toBe(false);
    expect(deregisterEventTypes("test:deregister")).toBe(false);
    deregisterEventTypes("test:deregister");
  });

  it("fails closed on UNKNOWN event types — never silently classified", () => {
    expect(() => classifyEvent("never.registered.anywhere")).toThrowError(UnknownEventTypeError);
    const error = captureError(() => classifyEvent("never.registered.anywhere"), UnknownEventTypeError);
    expect(error.eventType).toBe("never.registered.anywhere");
    expect(error.message).toContain('is not registered');
    expect(isUnknownEventTypeError(error)).toBe(true);
    expect(isUnknownEventTypeError(new Error("plain"))).toBe(false);
    expect(() => eventAlertPolicy("never.registered.anywhere")).toThrowError(UnknownEventTypeError);
  });

  it("tolerates surrounding whitespace in classification lookups (trimmed)", () => {
    registerEventTypes("test:trim", [{ eventType: "trim.type", significance: "notable" }]);
    expect(isKnownEventType("  trim.type  ")).toBe(true);
    expect(classifyEvent(" trim.type ")).toBe("notable");
    deregisterEventTypes("test:trim");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. SIGNIFICANCE — closed vocabulary → alerting policy
 * ────────────────────────────────────────────────────────────*/

describe("event kernel significance classification (closed vocabulary)", () => {
  it("exposes exactly the three-significance closed vocabulary", () => {
    expect(EVENT_SIGNIFICANCES).toEqual(["routine", "notable", "critical"]);
  });

  it("maps significance to alert policy: routine→none, notable→notify, critical→escalate", () => {
    expect(alertPolicyFor("routine")).toBe("none");
    expect(alertPolicyFor("notable")).toBe("notify");
    expect(alertPolicyFor("critical")).toBe("escalate");
  });

  it("isEventSignificance accepts only the declared values", () => {
    for (const significance of EVENT_SIGNIFICANCES) {
      expect(isEventSignificance(significance)).toBe(true);
    }
    expect(isEventSignificance("Routine")).toBe(false);
    expect(isEventSignificance("urgent")).toBe(false);
    expect(isEventSignificance(null)).toBe(false);
    expect(isEventSignificance(42)).toBe(false);
  });

  it("classifies every builtin kernel type with its declared significance", () => {
    for (const declaration of KERNEL_BUILTIN_EVENT_TYPES) {
      expect(classifyEvent(declaration.eventType)).toBe(declaration.significance);
      expect(eventAlertPolicy(declaration.eventType)).toBe(alertPolicyFor(declaration.significance));
    }
    expect(classifyEvent("core.invariant.violated")).toBe("critical");
    expect(eventAlertPolicy("core.invariant.violated")).toBe("escalate");
    expect(eventAlertPolicy("core.state.changed")).toBe("none");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. CANONICAL SERIALIZATION + CONTENT+CAUSE DIGEST
 * ────────────────────────────────────────────────────────────*/

describe("event kernel canonical serialization and content+cause digest", () => {
  it("serializes JSON canonically: object keys sorted recursively, array order preserved", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ z: { c: 3, d: [2, 1] }, a: 1 })).toBe(
      canonicalJson({ a: 1, z: { d: [2, 1], c: 3 } }),
    );
    expect(canonicalJson([3, 1, 2])).not.toBe(canonicalJson([1, 2, 3]));
  });

  it("drops undefined object entries in canonical form", () => {
    const withUndefined: Record<string, unknown> = { a: 1, b: undefined };
    expect(canonicalJson(withUndefined)).toBe(canonicalJson({ a: 1 }));
  });

  it("digests equal for structurally identical events regardless of payload key order", () => {
    const a = ev({ payload: { alpha: 1, beta: { x: 1, y: 2 } } });
    const b = ev({ payload: { beta: { y: 2, x: 1 }, alpha: 1 }, id: "evt-other-id" });
    expect(eventDedupDigest(a)).toBe(eventDedupDigest(b));
  });

  it("digests equal for null payload and empty-object payload (documented collapse)", () => {
    const nullPayload = ev({ payload: null });
    const emptyPayload = ev({ payload: {} });
    expect(eventDedupDigest(nullPayload)).toBe(eventDedupDigest(emptyPayload));
  });

  it("digests differ when the causation root changes (same content, different cause)", () => {
    const cause1 = ev({ causation_id: "cause-1" });
    const cause2 = ev({ causation_id: "cause-2" });
    expect(eventDedupDigest(cause1)).not.toBe(eventDedupDigest(cause2));
  });

  it("digests differ across tenant, event type, aggregate and payload changes", () => {
    const base = eventDedupDigest(ev());
    expect(eventDedupDigest(ev({ tenant_id: "tenant-2" }))).not.toBe(base);
    expect(eventDedupDigest(ev({ event_type: "core.observation.recorded" }))).not.toBe(base);
    expect(eventDedupDigest(ev({ aggregate_id: "agg-2" }))).not.toBe(base);
    expect(eventDedupDigest(ev({ aggregate_type: "other" }))).not.toBe(base);
    expect(eventDedupDigest(ev({ payload: { k: "changed" } }))).not.toBe(base);
  });

  it("resolves the causation chain root with precedence causation_id > parent_event_id > declared_origin", () => {
    expect(eventCause(ev())).toBe("cause-1");
    expect(eventCause(ev({ causation_id: null, parent_event_id: "parent-9", declared_origin: "origin-9" }))).toBe(
      "parent-9",
    );
    expect(eventCause(ev({ causation_id: null, parent_event_id: null, declared_origin: "origin-9" }))).toBe(
      "origin-9",
    );
    expect(eventCause(ev({ causation_id: null, parent_event_id: null, declared_origin: null }))).toBeNull();
  });

  it("skips blank cause coordinates and trims the resolved root", () => {
    expect(
      eventCause(ev({ causation_id: "   ", parent_event_id: " parent-7 ", declared_origin: "origin-7" })),
    ).toBe("parent-7");
    expect(eventCause(ev({ causation_id: " cause-5 ", parent_event_id: "parent-7" }))).toBe("cause-5");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. DETERMINISTIC ORDERING — (instant, sequence, issuer, id)
 * ────────────────────────────────────────────────────────────*/

describe("event kernel deterministic ordering (time-authority coordinates)", () => {
  it("orders by instant ascending and never mutates the input array", () => {
    const input = [ev({ id: "e3", occurred_at: T3 }), ev({ id: "e1", occurred_at: T1 }), ev({ id: "e2", occurred_at: T2 })];
    const snapshot = input.map((e) => e.id);
    const ordered = orderEvents(input);
    expect(ordered.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
    expect(input.map((e) => e.id)).toEqual(snapshot);
    expect(ordered).not.toBe(input);
  });

  it("is permutation-invariant: any shuffled input produces the SAME total order", () => {
    const instants = [T0, T1, T2, T3, T4, T5, T6];
    const stream = instants.map((at, i) => ev({ id: `evt-${i}`, occurred_at: at, causation_id: `cause-${i}` }));
    const reference = orderEvents(stream).map((e) => e.id);
    expect(reference).toEqual(["evt-0", "evt-1", "evt-2", "evt-3", "evt-4", "evt-5", "evt-6"]);
    for (const seed of [1, 7, 42, 1337, 9001]) {
      const shuffled = permute(stream.map((_, i) => i), seed).map((i) => stream[i]!);
      expect(orderEvents(shuffled).map((e) => e.id)).toEqual(reference);
    }
  });

  it("breaks instant ties by issuance sequence, then issuer, then event identity", () => {
    const sameInstant = T2;
    const bySequence = orderEvents([
      ev({ id: "seq-high", sequence: 5, issuer: "ia" }),
      ev({ id: "seq-low", sequence: 2, issuer: "ia" }),
      ev({ id: "seq-mid", sequence: 3, issuer: "ia" }),
    ]);
    expect(bySequence.map((e) => e.id)).toEqual(["seq-low", "seq-mid", "seq-high"]);

    const byIssuer = orderEvents([
      ev({ id: "issuer-b", sequence: 1, issuer: "time-authority:writer-b" }),
      ev({ id: "issuer-a", sequence: 1, issuer: "time-authority:writer-a" }),
    ]);
    expect(byIssuer.map((e) => e.id)).toEqual(["issuer-a", "issuer-b"]);

    const byId = orderEvents([
      ev({ id: "zzz", sequence: 1, issuer: "same" }),
      ev({ id: "aaa", sequence: 1, issuer: "same" }),
    ]);
    expect(byId.map((e) => e.id)).toEqual(["aaa", "zzz"]);
  });

  it("scopes to the requested tenant: foreign and null-tenant rows are excluded entirely", () => {
    const scoped = orderEvents(
      [
        ev({ id: "mine", tenant_id: "tenant-1" }),
        ev({ id: "foreign", tenant_id: "tenant-2" }),
        ev({ id: "scopeless", tenant_id: null }),
      ],
      { tenantId: "tenant-1" },
    );
    expect(scoped.map((e) => e.id)).toEqual(["mine"]);
  });

  it("strict posture rejects events without issuance provenance (UnauthoritativeTimeError)", () => {
    const unstamped = ev({ id: "no-provenance", sequence: null, issuer: null });
    const error = captureError(
      () => orderEvents([unstamped], { requireAuthorityProvenance: true }),
      UnauthoritativeTimeError,
    );
    expect(error.eventId).toBe("no-provenance");
    expect(error.message).toContain("issuance provenance");
    expect(isUnknownEventTypeError(error)).toBe(false);
  });

  it("strict posture accepts events stamped with valid authority provenance", () => {
    const authority = new TimeAuthority(new SteppedClock(Date.parse(T0), 1));
    const stampedEvent = stamped(authority, { id: "stamped-1" });
    expect(hasIssuanceProvenance(stampedEvent)).toBe(true);
    expect(() => orderEvents([stampedEvent], { requireAuthorityProvenance: true })).not.toThrowError();
  });

  it("hasIssuanceProvenance fails shape validation for malformed provenance", () => {
    const authority = new TimeAuthority(new FixedClock(Date.parse(T0)));
    const good = stamped(authority);
    expect(hasIssuanceProvenance(good)).toBe(true);
    expect(hasIssuanceProvenance(ev({ sequence: -1, issuer: "ia" }))).toBe(false);
    expect(hasIssuanceProvenance(ev({ sequence: 1.5, issuer: "ia" }))).toBe(false);
    expect(hasIssuanceProvenance(ev({ sequence: 1, issuer: "  " }))).toBe(false);
    expect(hasIssuanceProvenance(ev({ sequence: null, issuer: null }))).toBe(false);
  });

  it("rejects events with no parsable temporal coordinate when ordering compares them (F-6 edge)", () => {
    const timeless = ev({ id: "timeless", occurred_at: null, recorded_at: null });
    expect(() => orderEvents([timeless, ev({ id: "other" })])).toThrowError(/cannot be ordered/);
    expect(() => compareEventOrder(timeless, ev())).toThrowError(/cannot be ordered/);
    // F-6 edge: with a SINGLE element the sort comparator is never invoked,
    // so orderEvents([timeless]) passes silently — ordering failures only
    // surface when events are actually compared.
    expect(() => orderEvents([timeless])).not.toThrowError();
  });

  it("orders by VALID time (occurred_at) over RECORD time (recorded_at)", () => {
    const ordered = orderEvents([
      ev({ id: "valid-late", occurred_at: T2, recorded_at: T1 }),
      ev({ id: "valid-early", occurred_at: T1, recorded_at: T3 }),
    ]);
    expect(ordered.map((e) => e.id)).toEqual(["valid-early", "valid-late"]);
  });

  it("agrees with the time authority's own compareIssued over the same issuance coordinates", () => {
    const authority = new TimeAuthority(new SteppedClock(Date.parse(T0), 1));
    const issuances: IssuedTimestamp[] = [];
    const events: KernelEventRecord[] = [];
    for (let i = 0; i < 6; i += 1) {
      const issued = authority.now();
      issuances.push(issued);
      events.push(stampEventWithIssuedTime(ev({ id: `auth-${i}`, occurred_at: null, recorded_at: null }), issued));
    }
    const eventOrder = orderEvents(events, { requireAuthorityProvenance: true });
    const issuanceOrder = [...issuances].sort(compareIssued);
    expect(eventOrder.map((e) => e.sequence)).toEqual(issuanceOrder.map((s) => s.sequence));
  });

  it("orders concurrent same-instant writers deterministically (issuer tiebreak), agreeing with compareIssued", () => {
    const sameMs = Date.parse(T0);
    const writerA = new TimeAuthority(new FixedClock(sameMs, "clock:writer-a"));
    const writerB = new TimeAuthority(new FixedClock(sameMs, "clock:writer-b"));
    const issuedA = writerA.now();
    const issuedB = writerB.now();
    const a = stampEventWithIssuedTime(ev({ id: "writer-a-evt", occurred_at: null, recorded_at: null }), issuedA);
    const b = stampEventWithIssuedTime(ev({ id: "writer-b-evt", occurred_at: null, recorded_at: null }), issuedB);
    const forward = orderEvents([a, b]);
    const backward = orderEvents([b, a]);
    expect(forward.map((e) => e.id)).toEqual(backward.map((e) => e.id));
    expect(forward.map((e) => e.issuer)).toEqual([
      "time-authority:clock:writer-a",
      "time-authority:clock:writer-b",
    ]);
    const issuanceOrder = [issuedA, issuedB].sort(compareIssued);
    expect(forward.map((e) => e.issuer)).toEqual(issuanceOrder.map((s) => s.issuer));
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. DEDUPLICATION — content+cause digest
 * ────────────────────────────────────────────────────────────*/

describe("event kernel deduplication (content+cause digest)", () => {
  it("collapses duplicate deliveries into the first event IN TOTAL ORDER, not first arrival", () => {
    const early = ev({ id: "evt-early", occurred_at: T1, causation_id: "cause-dup" });
    const late = ev({ id: "evt-late", occurred_at: T2, causation_id: "cause-dup" });
    const result = dedupeEvents([late, early]);
    expect(result.unique).toHaveLength(1);
    expect(result.unique[0]?.event.id).toBe("evt-early");
    expect(result.unique[0]?.collapsed).toEqual(["evt-late"]);
    expect(result.duplicateCount).toBe(1);
    expect(result.totalSeen).toBe(2);
  });

  it("never collapses same-content events with DIFFERENT causes (two independent actions)", () => {
    const result = dedupeEvents([
      ev({ id: "a", causation_id: "cause-1" }),
      ev({ id: "b", causation_id: "cause-2" }),
    ]);
    expect(result.unique).toHaveLength(2);
    expect(result.duplicateCount).toBe(0);
    expect(result.unique.map((u) => u.event.id)).toEqual(["a", "b"]);
  });

  it("never collapses cross-tenant look-alikes (tenant coordinate is in the digest)", () => {
    const result = dedupeEvents([
      ev({ id: "t1", tenant_id: "tenant-1" }),
      ev({ id: "t2", tenant_id: "tenant-2" }),
    ]);
    expect(result.unique).toHaveLength(2);
    expect(result.duplicateCount).toBe(0);
  });

  it("is permutation-invariant: any shuffled duplicate-laden stream yields the same unique set", () => {
    const stream = [
      ev({ id: "u1", occurred_at: T0, causation_id: "c1" }),
      ev({ id: "u2", occurred_at: T1, causation_id: "c2" }),
      ev({ id: "u3", occurred_at: T2, causation_id: "c3" }),
      ev({ id: "dup-u1", occurred_at: T0, causation_id: "c1" }),
      ev({ id: "dup-u2", occurred_at: T1, causation_id: "c2" }),
      ev({ id: "dup-u1-again", occurred_at: T0, causation_id: "c1" }),
    ];
    const reference = dedupeEvents(stream);
    // The representative is the first event in TOTAL order: same instant,
    // no sequence/issuer → the id tiebreak picks "dup-u1" < "u1".
    expect(reference.unique.map((u) => u.event.id)).toEqual(["dup-u1", "dup-u2", "u3"]);
    expect(reference.duplicateCount).toBe(3);
    for (const seed of [3, 11, 77]) {
      const shuffled = permute(stream.map((_, i) => i), seed).map((i) => stream[i]!);
      const result = dedupeEvents(shuffled);
      expect(result.unique.map((u) => u.event.id)).toEqual(reference.unique.map((u) => u.event.id));
      expect(result.duplicateCount).toBe(reference.duplicateCount);
      expect(result.unique.map((u) => u.digest)).toEqual(reference.unique.map((u) => u.digest));
    }
  });

  it("rejects UNROOTED events by default (EventWithoutCauseError, G-010 fail-closed)", () => {
    const unrooted = ev({ id: "orphan", causation_id: null, parent_event_id: null, declared_origin: null });
    const error = captureError(() => dedupeEvents([unrooted]), EventWithoutCauseError);
    expect(error.eventId).toBe("orphan");
    expect(error.message).toContain("no causation chain root");
  });

  it("an unrooted event with a sibling cause still digests differently (cause null ≠ cause present)", () => {
    const unrooted = ev({ id: "orphan", causation_id: null, parent_event_id: null, declared_origin: null });
    const rooted = ev({ id: "rooted", causation_id: "cause-1" });
    expect(eventDedupDigest(unrooted)).not.toBe(eventDedupDigest(rooted));
  });

  it("requireCause: false consumes unrooted events; identical unrooted duplicates still collapse", () => {
    const a = ev({ id: "orphan-a", occurred_at: T1, causation_id: null, parent_event_id: null, declared_origin: null });
    const b = ev({ id: "orphan-b", occurred_at: T1, causation_id: null, parent_event_id: null, declared_origin: null });
    const result = dedupeEvents([a, b], { requireCause: false });
    expect(result.unique).toHaveLength(1);
    expect(result.duplicateCount).toBe(1);
    expect(result.unique[0]?.collapsed).toEqual(["orphan-b"]);
  });

  it("digest-identical id-less duplicates keep digest-level uniqueness permutation-invariant (F-3 edge)", () => {
    const make = (recorded: string): KernelEventRecord => ({
      event_type: "core.state.changed",
      tenant_id: "tenant-1",
      aggregate_type: "object",
      aggregate_id: "agg-1",
      payload: { k: "v" },
      occurred_at: T0,
      recorded_at: recorded,
      causation_id: "cause-1",
    });
    const first = make("2026-09-30T12:00:09.000Z");
    const second = make("2026-09-30T12:00:19.000Z");
    const forward = dedupeEvents([first, second]);
    const backward = dedupeEvents([second, first]);
    for (const result of [forward, backward]) {
      expect(result.unique).toHaveLength(1);
      expect(result.duplicateCount).toBe(1);
    }
    expect(eventDedupDigest(first)).toBe(eventDedupDigest(second));
  });

  it("keeps the first-in-total-order representative's identity when duplicates carry ids", () => {
    const a = ev({ id: "evt-a", occurred_at: T1 });
    const b = ev({ id: "evt-b", occurred_at: T1 });
    const forward = dedupeEvents([a, b]);
    const backward = dedupeEvents([b, a]);
    expect(forward.unique[0]?.event.id).toBe("evt-a");
    expect(backward.unique[0]?.event.id).toBe("evt-a");
    expect(forward.unique[0]?.collapsed).toEqual(["evt-b"]);
    expect(backward.unique[0]?.collapsed).toEqual(["evt-b"]);
  });

  it("scopes deduplication to the requested tenant before collapsing", () => {
    const result = dedupeEvents([ev({ id: "mine" }), ev({ id: "foreign", tenant_id: "tenant-2" })], {
      tenantId: "tenant-1",
    });
    expect(result.unique).toHaveLength(1);
    expect(result.unique[0]?.event.id).toBe("mine");
    expect(result.totalSeen).toBe(2);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 6. REPLAY — idempotent, permutation-invariant state application
 * ────────────────────────────────────────────────────────────*/

describe("event kernel replay (generalized foundation-loop idempotent replay)", () => {
  const reducer = (state: readonly string[], event: KernelEventRecord): readonly string[] => [
    ...state,
    `${event.event_type}@${event.aggregate_id}`,
  ];

  it("applies each unique event exactly once; duplicates never double-apply", () => {
    const stream = [
      ev({ id: "e1", event_type: "core.state.changed", aggregate_id: "agg-1" }),
      ev({ id: "e1-dup", event_type: "core.state.changed", aggregate_id: "agg-1" }),
      ev({ id: "e2", event_type: "core.observation.recorded", aggregate_id: "agg-2", occurred_at: T1 }),
    ];
    const result = replayEvents(stream, [] as readonly string[], reducer);
    expect(result.state).toEqual(["core.state.changed@agg-1", "core.observation.recorded@agg-2"]);
    expect(result.applied).toHaveLength(2);
    expect(result.duplicateCount).toBe(1);
    expect(result.totalSeen).toBe(3);
  });

  it("replays a duplicated, out-of-order stream to EXACTLY the unique-in-order state", () => {
    const unique = [
      ev({ id: "r1", occurred_at: T0, causation_id: "cr-1" }),
      ev({ id: "r2", occurred_at: T1, causation_id: "cr-2" }),
      ev({ id: "r3", occurred_at: T2, causation_id: "cr-3" }),
    ];
    const messy = [unique[2]!, unique[0]!, unique[2]!, unique[1]!, unique[0]!];
    const reference = replayEvents(unique, [] as readonly string[], reducer);
    const actual = replayEvents(messy, [] as readonly string[], reducer);
    expect(actual.state).toEqual(reference.state);
    expect(actual.applied.map((e) => e.id)).toEqual(["r1", "r2", "r3"]);
    expect(actual.duplicateCount).toBe(2);
  });

  it("re-replaying (feed + already-applied events) is idempotent — same state, nothing re-applied", () => {
    const stream = [
      ev({ id: "i1", occurred_at: T0, causation_id: "ci-1" }),
      ev({ id: "i2", occurred_at: T1, causation_id: "ci-2" }),
      ev({ id: "i1-again", occurred_at: T0, causation_id: "ci-1" }),
    ];
    const first = replayEvents(stream, [] as readonly string[], reducer);
    const second = replayEvents([...stream, ...first.applied], [] as readonly string[], reducer);
    expect(second.state).toEqual(first.state);
    expect(second.applied.map((e) => e.id)).toEqual(["i1", "i2"]);
  });

  it("respects tenant scoping in replay (foreign-tenant events never reach the reducer)", () => {
    const result = replayEvents(
      [
        ev({ id: "mine", occurred_at: T0, causation_id: "cm-1" }),
        ev({ id: "foreign", tenant_id: "tenant-2", occurred_at: T1, causation_id: "cm-2" }),
      ],
      [] as readonly string[],
      reducer,
      { tenantId: "tenant-1" },
    );
    expect(result.state).toEqual(["core.state.changed@agg-1"]);
    expect(result.tenantId).toBe("tenant-1");
    expect(result.totalSeen).toBe(2);
  });

  it("rejects unrooted streams under the default fail-closed posture", () => {
    const unrooted = ev({ id: "u", causation_id: null, parent_event_id: null, declared_origin: null });
    expect(() => replayEvents([unrooted], [] as readonly string[], reducer)).toThrowError(
      EventWithoutCauseError,
    );
  });
});

/* ─────────────────────────────────────────────────────────────
 * 7. CONSUMPTION GATE — validateEventRecord + consumeEvents
 * ────────────────────────────────────────────────────────────*/

describe("event kernel consumption gate (fail-closed production posture)", () => {
  it("validateEventRecord accepts a registered, well-formed event", () => {
    expect(() => validateEventRecord(ev())).not.toThrowError();
  });

  it("validateEventRecord rejects unknown event types (never silently consumed)", () => {
    expect(() => validateEventRecord(ev({ event_type: "ghost.type" }))).toThrowError(UnknownEventTypeError);
  });

  it("validateEventRecord requires non-empty aggregate_type and aggregate_id", () => {
    expect(() => validateEventRecord(ev({ aggregate_type: "  " }))).toThrowError(/aggregate_type/);
    expect(() => validateEventRecord(ev({ aggregate_id: "" }))).toThrowError(/aggregate_id/);
  });

  it("validateEventRecord requires a JSON-object payload (arrays rejected)", () => {
    const arrayPayload = ["not", "an", "object"] as unknown as Record<string, unknown>;
    expect(() => validateEventRecord(ev({ payload: arrayPayload }))).toThrowError(/payload must be a JSON object/);
    expect(() => validateEventRecord(ev({ payload: null }))).not.toThrowError();
  });

  it("consumeEvents plans the full production posture: order, collapse, alert policies", () => {
    const authority = new TimeAuthority(new SteppedClock(Date.parse(T0), 1));
    const first = stamped(authority, { id: "c-1", event_type: "core.state.changed", causation_id: "cc-1" });
    const firstDup = stamped(authority, { id: "c-1-dup", event_type: "core.state.changed", causation_id: "cc-1" });
    const critical = stamped(authority, {
      id: "c-2",
      event_type: "core.invariant.violated",
      aggregate_id: "agg-2",
      causation_id: "cc-2",
    });
    const plan = consumeEvents([firstDup, critical, first]);
    expect(plan.ordered).toHaveLength(2);
    expect(plan.ordered.map((u) => u.event.id)).toEqual(["c-1", "c-2"]);
    expect(plan.ordered[0]?.collapsed).toEqual(["c-1-dup"]);
    expect(plan.duplicateCount).toBe(1);
    expect(plan.totalSeen).toBe(3);
    expect(plan.alertPolicies).toEqual([
      { eventId: "c-1", policy: "none" },
      { eventId: "c-2", policy: "escalate" },
    ]);
  });

  it("consumeEvents rejects unstamped deliveries (UnauthoritativeTimeError)", () => {
    expect(() => consumeEvents([ev({ id: "raw" })])).toThrowError(UnauthoritativeTimeError);
  });

  it("consumeEvents rejects unrooted deliveries (EventWithoutCauseError)", () => {
    const authority = new TimeAuthority(new SteppedClock(Date.parse(T0), 1));
    const stampedUnrooted = stamped(authority, {
      id: "rootless",
      causation_id: null,
      parent_event_id: null,
      declared_origin: null,
    });
    expect(() => consumeEvents([stampedUnrooted])).toThrowError(EventWithoutCauseError);
  });

  it("consumeEvents rejects unregistered event types even when provenance and cause are present", () => {
    const authority = new TimeAuthority(new SteppedClock(Date.parse(T0), 1));
    const ghost = stamped(authority, { id: "ghost", event_type: "ghost.type", causation_id: "gc-1" });
    expect(() => consumeEvents([ghost])).toThrowError(UnknownEventTypeError);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 8. TIME-AUTHORITY BINDING — the sanctioned stamping path
 * ────────────────────────────────────────────────────────────*/

describe("event kernel time-authority binding (V1CAP-045)", () => {
  it("binds the authority issuance coordinates onto the event record", () => {
    const authority = new TimeAuthority(new SteppedClock(Date.parse(T0), 5));
    const issued = authority.now();
    const bound = stampEventWithIssuedTime(ev({ occurred_at: null, recorded_at: null }), issued);
    expect(bound.occurred_at).toBe(issued.at);
    expect(bound.sequence).toBe(issued.sequence);
    expect(bound.issuer).toBe(issued.issuer);
    expect(isAuthorityTimestampShape(issued)).toBe(true);
  });

  it("preserves an explicit valid-time occurred_at over the issued instant (bi-temporal law)", () => {
    const authority = new TimeAuthority(new FixedClock(Date.parse(T0)));
    const bound = stampEventWithIssuedTime(ev({ occurred_at: T1, recorded_at: null }), authority.now());
    expect(bound.occurred_at).toBe(T1);
    expect(hasIssuanceProvenance(bound)).toBe(true);
  });

  it("fails closed on raw, non-authority time shapes (no provenance, no stamp)", () => {
    const rawNumber = 1727054400000 as unknown as IssuedTimestamp;
    expect(() => stampEventWithIssuedTime(ev(), rawNumber)).toThrowError(/must be issued by the TimeAuthority/);
    const provenanceless = { at: T0, atMs: Date.parse(T0) } as unknown as IssuedTimestamp;
    expect(() => stampEventWithIssuedTime(ev(), provenanceless)).toThrowError(/TimeAuthority/);
  });

  it("isAuthorityTimestampShape distinguishes authority shapes from raw values", () => {
    const authority = new TimeAuthority(new FixedClock(Date.parse(T0)));
    expect(isAuthorityTimestampShape(authority.now())).toBe(true);
    expect(isAuthorityTimestampShape(Date.parse(T0))).toBe(false);
    expect(isAuthorityTimestampShape(T0)).toBe(false);
    expect(isAuthorityTimestampShape(null)).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 9. ENVELOPE COMPATIBILITY — kernel/reality.ts eventDraft
 * ────────────────────────────────────────────────────────────*/

describe("event kernel envelope compatibility (eventDraft composition, FINDINGS F-1/F-2)", () => {
  function draft(overrides: Partial<Parameters<typeof eventDraft>[0]> = {}) {
    return eventDraft(
      {
        eventType: "core.state.changed",
        aggregateType: "object",
        aggregateId: "agg-1",
        tenantId: "tenant-1",
        payload: { k: "v" },
        ...overrides,
      },
      NOW,
    );
  }

  it("accepts a verbatim eventDraft through the consumption validation gate", () => {
    const record = draft();
    expect(record.event_type).toBe("core.state.changed");
    expect(record.tenant_id).toBe("tenant-1");
    expect(record.occurred_at).toBe(NOW);
    expect(record.recorded_at).toBe(NOW);
    expect(() => validateEventRecord(record)).not.toThrowError();
    expect(() => eventDedupDigest(record)).not.toThrowError();
  });

  it("orders drafts by VALID time even when every draft shares one RECORD time", () => {
    const early = draft({ aggregateId: "agg-early", occurredAt: T1 });
    const late = draft({ aggregateId: "agg-late", occurredAt: T2 });
    const ordered = orderEvents([late, early]);
    expect(ordered.map((e) => e.aggregate_id)).toEqual(["agg-early", "agg-late"]);
  });

  it("draft tenant blank-normalizes to null, which tenant scoping then excludes (defense-in-depth)", () => {
    const scopeless = draft({ tenantId: "   " });
    expect(scopeless.tenant_id).toBeNull();
    expect(orderEvents([scopeless, draft()], { tenantId: "tenant-1" })).toHaveLength(1);
  });

  it("F-1: a verbatim draft carries NO causation root and fails the default dedup posture", () => {
    const record = draft();
    expect(eventCause(record)).toBeNull();
    expect(() => dedupeEvents([record])).toThrowError(EventWithoutCauseError);
    expect(() => dedupeEvents([record], { requireCause: false })).not.toThrowError();
  });

  it("F-2: a verbatim draft carries no issuance provenance and is rejected by strict consumption", () => {
    const record = draft();
    expect(hasIssuanceProvenance(record)).toBe(false);
    expect(() => consumeEvents([record])).toThrowError(UnauthoritativeTimeError);
    const authority = new TimeAuthority(new FixedClock(Date.parse(NOW)));
    const bridged = stampEventWithIssuedTime(record, authority.now());
    expect(hasIssuanceProvenance(bridged)).toBe(true);
    expect(() => dedupeEvents([bridged], { requireCause: false })).not.toThrowError();
  });
});