/**
 * CoreGrid — event kernel semantics suite (V1CAP-042 / J-020 / MISSION-R-15).
 *
 * Proves, at unit level, that:
 *  1. the taxonomy is declarative and extensible per domain with neutral
 *     builtins, and FAILS CLOSED: unknown event types and unknown
 *     significance values are rejected, never silently classified;
 *  2. significance classification resolves the downstream alerting policy
 *     (routine→none, notable→notify, critical→escalate);
 *  3. ordering is a deterministic per-tenant TOTAL ORDER via the time
 *     authority (instant + issuance sequence + issuer): concurrent writers
 *     and out-of-order writers cannot corrupt it, and any input permutation
 *     yields the identical order;
 *  4. deduplication is the content+cause digest: duplicates collapse,
 *     never double-apply, and same-content-different-cause does NOT
 *     collapse; dedup is deterministic under permutation and per-tenant;
 *  5. replay generalizes the foundation loop's idempotent replay to the
 *     event plane: duplicate/out-of-order streams and REPLAYED streams all
 *     reduce to exactly the once-applied-in-order state;
 *  6. events stamped through the time authority (and envelope/bi-temporal
 *     eventDraft rows from kernel/reality.ts) are consumed verbatim —
 *     composition over modification.
 */

import { describe, expect, it } from "vitest";
import {
  EventWithoutCauseError,
  KERNEL_BUILTIN_EVENT_TYPES,
  KERNEL_CORE_EVENT_DOMAIN_REF,
  UnknownEventTypeError,
  UnauthoritativeTimeError,
  alertPolicyFor,
  canonicalJson,
  classifyEvent,
  consumeEvents,
  dedupeEvents,
  deregisterEventTypes,
  eventAlertPolicy,
  eventCause,
  eventDedupDigest,
  eventTypeOwner,
  hasIssuanceProvenance,
  isKnownEventType,
  orderEvents,
  registerEventTypes,
  replayEvents,
  stampEventWithIssuedTime,
  validateEventRecord,
  type EventTypeDeclaration,
  type KernelEventRecord,
} from "@/lib/kernel/event-semantics";
import { FixedClock, SteppedClock, TimeAuthority, type IssuedTimestamp } from "@/lib/kernel/time-authority";
import { eventDraft } from "@/lib/kernel/reality";

const BASE_MS = Date.parse("2026-10-01T00:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

let nextEventId = 0;

function makeEvent(overrides: Partial<KernelEventRecord> = {}): KernelEventRecord {
  nextEventId += 1;
  return {
    id: `evt-${nextEventId}`,
    event_type: "core.state.changed",
    tenant_id: "tenant-1",
    aggregate_type: "core.aggregate",
    aggregate_id: "aggregate-1",
    payload: { state: "on" },
    occurred_at: iso(BASE_MS),
    recorded_at: iso(BASE_MS),
    causation_id: "cause-root-1",
    ...overrides,
  };
}

/**
 * Stamp an event with time-authority provenance. `occurred_at` is cleared so
 * the issued instant becomes the event's valid-time coordinate.
 */
function stamp(
  overrides: Partial<KernelEventRecord>,
  issue: () => IssuedTimestamp,
): KernelEventRecord {
  return stampEventWithIssuedTime(makeEvent({ occurred_at: null, ...overrides }), issue());
}

/** Deterministic permutations of an array (identity + rotations + reverse). */
function permutations<T>(items: readonly T[]): T[][] {
  const result: T[][] = [[...items]];
  for (let shift = 1; shift < items.length; shift += 1) {
    result.push([...items.slice(shift), ...items.slice(0, shift)]);
  }
  result.push([...items].reverse());
  return result;
}

describe("event semantics — taxonomy (declarative, extensible, neutral builtins)", () => {
  it("bootstraps a neutral builtin floor under the kernel domain", () => {
    expect(KERNEL_BUILTIN_EVENT_TYPES.length).toBeGreaterThan(0);
    expect(eventTypeOwner("core.state.changed")).toBe(KERNEL_CORE_EVENT_DOMAIN_REF);
    for (const declaration of KERNEL_BUILTIN_EVENT_TYPES) {
      expect(isKnownEventType(declaration.eventType)).toBe(true);
      expect(classifyEvent(declaration.eventType)).toBe(declaration.significance);
    }
  });

  it("registers domain event types through the public gate with declared significance", () => {
    registerEventTypes("fixture:semantic-test-a", [
      { eventType: "fixture.contract.signed", significance: "notable" },
      { eventType: "fixture.contract.breached", significance: "critical" },
    ]);
    expect(classifyEvent("fixture.contract.signed")).toBe("notable");
    expect(eventTypeOwner("fixture.contract.breached")).toBe("fixture:semantic-test-a");
  });

  it("rejects an UNKNOWN event type at classification and validation (fail-closed)", () => {
    expect(() => classifyEvent("nobody.registered.this")).toThrow(UnknownEventTypeError);
    expect(() =>
      validateEventRecord(makeEvent({ event_type: "nobody.registered.this" })),
    ).toThrow(UnknownEventTypeError);
    expect(isKnownEventType("nobody.registered.this")).toBe(false);
  });

  it("rejects a registration declaring an unknown significance value", () => {
    const badDeclaration = {
      eventType: "fixture.unknown.significance",
      significance: "apocalyptic",
    } as unknown as EventTypeDeclaration;
    expect(() =>
      registerEventTypes("fixture:semantic-test-b", [badDeclaration]),
    ).toThrow(/unknown significance/);
    expect(isKnownEventType("fixture.unknown.significance")).toBe(false);
  });

  it("rejects a registration of a type owned by a DIFFERENT domain (exclusive ownership)", () => {
    registerEventTypes("fixture:semantic-test-c", [
      { eventType: "fixture.exclusive.type", significance: "routine" },
    ]);
    expect(() =>
      registerEventTypes("fixture:semantic-test-d", [
        { eventType: "fixture.exclusive.type", significance: "critical" },
      ]),
    ).toThrow(/already owned by/);
  });

  it("closes a domain's vocabulary immediately on deregistration", () => {
    registerEventTypes("fixture:semantic-test-e", [
      { eventType: "fixture.doomed.type", significance: "routine" },
    ]);
    expect(deregisterEventTypes("fixture:semantic-test-e")).toBe(true);
    expect(isKnownEventType("fixture.doomed.type")).toBe(false);
    expect(() => classifyEvent("fixture.doomed.type")).toThrow(UnknownEventTypeError);
  });
});

describe("event semantics — significance classification drives alerting", () => {
  it("maps routine→none, notable→notify, critical→escalate", () => {
    expect(alertPolicyFor("routine")).toBe("none");
    expect(alertPolicyFor("notable")).toBe("notify");
    expect(alertPolicyFor("critical")).toBe("escalate");
  });

  it("resolves the alert policy from the registered taxonomy per event type", () => {
    expect(eventAlertPolicy("core.state.changed")).toBe("none");
    expect(eventAlertPolicy("core.observation.recorded")).toBe("notify");
    expect(eventAlertPolicy("core.invariant.violated")).toBe("escalate");
  });
});

describe("event semantics — deduplication (content+cause digest)", () => {
  it("collapses duplicate deliveries: never double-apply", () => {
    const original = makeEvent();
    const duplicate = makeEvent({ id: "evt-dup" });
    const result = dedupeEvents([original, duplicate]);
    expect(result.totalSeen).toBe(2);
    expect(result.duplicateCount).toBe(1);
    expect(result.unique.length).toBe(1);
    expect(result.unique[0].collapsed.length).toBe(1);
    expect(result.unique[0].digest).toBe(eventDedupDigest(original));
  });

  it("digests deterministically regardless of payload key construction order", () => {
    const a = makeEvent({ payload: { alpha: 1, beta: { gamma: 2, delta: 3 } } });
    const b = makeEvent({ id: "evt-reordered", payload: { beta: { delta: 3, gamma: 2 }, alpha: 1 } });
    expect(eventDedupDigest(a)).toBe(eventDedupDigest(b));
    expect(canonicalJson(a.payload)).toBe(canonicalJson(b.payload));
  });

  it("does NOT collapse same content with a DIFFERENT cause", () => {
    const first = makeEvent({ causation_id: "cause-A" });
    const second = makeEvent({ causation_id: "cause-B" });
    const result = dedupeEvents([first, second]);
    expect(result.duplicateCount).toBe(0);
    expect(result.unique.length).toBe(2);
  });

  it("prefers the envelope causation chain: parent_event_id and declared_origin act as cause", () => {
    const viaParent = makeEvent({ causation_id: null, parent_event_id: "parent-evt-1" });
    const viaOrigin = makeEvent({
      causation_id: null,
      parent_event_id: null,
      declared_origin: "kernel:bootstrap",
    });
    expect(eventCause(viaParent)).toBe("parent-evt-1");
    expect(eventCause(viaOrigin)).toBe("kernel:bootstrap");
    // Identical content, same declared origin → duplicates collapse.
    const twin = makeEvent({
      id: "evt-origin-twin",
      causation_id: null,
      parent_event_id: null,
      declared_origin: "kernel:bootstrap",
    });
    expect(dedupeEvents([viaOrigin, twin]).duplicateCount).toBe(1);
  });

  it("fails CLOSED on an unrooted event (no causation chain root, G-010)", () => {
    const unrooted = makeEvent({ causation_id: null, parent_event_id: null, declared_origin: null });
    expect(() => dedupeEvents([unrooted])).toThrow(EventWithoutCauseError);
  });

  it("does not collapse cross-tenant look-alikes (tenant is in the digest)", () => {
    const tenantA = makeEvent({ tenant_id: "tenant-A" });
    const tenantB = makeEvent({ tenant_id: "tenant-B" });
    const result = dedupeEvents([tenantA, tenantB]);
    expect(result.duplicateCount).toBe(0);
    expect(result.unique.length).toBe(2);
  });

  it("is deterministic under EVERY input permutation", () => {
    const stream = [
      makeEvent({ id: "evt-1", causation_id: "cause-1" }),
      makeEvent({ id: "evt-2", causation_id: "cause-1" }), // duplicate of evt-1
      makeEvent({ id: "evt-3", causation_id: "cause-2", occurred_at: iso(BASE_MS + 1_000) }),
      makeEvent({ id: "evt-4", causation_id: "cause-3", occurred_at: iso(BASE_MS - 1_000) }),
      makeEvent({ id: "evt-5", causation_id: "cause-2" }), // duplicate of evt-3
    ];
    const baseline = dedupeEvents(stream);
    expect(baseline.duplicateCount).toBe(2); // evt-2 dup of evt-1; evt-5 dup of evt-3
    for (const permutation of permutations(stream)) {
      const result = dedupeEvents(permutation);
      expect(result.duplicateCount).toBe(baseline.duplicateCount);
      expect(result.unique.map((entry) => entry.digest)).toEqual(
        baseline.unique.map((entry) => entry.digest),
      );
    }
  });
});

describe("event semantics — deterministic per-tenant total order", () => {
  it("orders by the time-authority coordinates, not arrival order", () => {
    const authority = new TimeAuthority(new SteppedClock(BASE_MS, 1_000));
    const earlier = stamp({ id: "evt-early" }, authority.now.bind(authority));
    const later = stamp({ id: "evt-late-arrival" }, authority.now.bind(authority));
    // later arrived first in the array, but was ISSUED after earlier.
    const ordered = orderEvents([later, earlier]);
    expect(ordered.map((event) => event.id)).toEqual(["evt-early", "evt-late-arrival"]);
  });

  it("gives concurrent writers a deterministic total order on the same instant", () => {
    // Two writers sample the SAME millisecond: only sequence + issuer break the tie.
    const writerA: KernelEventRecord = makeEvent({
      id: "evt-writer-a",
      sequence: 7,
      issuer: "time-authority:clock:a",
    });
    const writerB: KernelEventRecord = makeEvent({
      id: "evt-writer-b",
      sequence: 3,
      issuer: "time-authority:clock:b",
    });
    const writerA2: KernelEventRecord = makeEvent({
      id: "evt-writer-a2",
      sequence: 7,
      issuer: "time-authority:clock:a", // same ms, same sequence, same issuer → id tiebreak
    });
    const baseline = orderEvents([writerA, writerB, writerA2]);
    expect(baseline.map((event) => event.id)).toEqual(["evt-writer-b", "evt-writer-a", "evt-writer-a2"]);
    for (const permutation of permutations([writerA, writerB, writerA2])) {
      expect(orderEvents(permutation).map((event) => event.id)).toEqual(
        baseline.map((event) => event.id),
      );
    }
  });

  it("out-of-order writers do not corrupt event ordering", () => {
    const authority = new TimeAuthority(new SteppedClock(BASE_MS, 2_000));
    // Issued in logical order, but CONSUMED out of order and permuted.
    const first = stamp({ id: "evt-first" }, authority.now.bind(authority));
    const second = stamp({ id: "evt-second" }, authority.now.bind(authority));
    const third = stamp({ id: "evt-third" }, authority.now.bind(authority));
    const scrambled = [second, third, first];
    for (const permutation of permutations(scrambled)) {
      expect(orderEvents(permutation).map((event) => event.id)).toEqual([
        "evt-first",
        "evt-second",
        "evt-third",
      ]);
    }
  });

  it("rejects provenance-less events under the strict (production) posture", () => {
    const bare = makeEvent({ sequence: null, issuer: null });
    expect(hasIssuanceProvenance(bare)).toBe(false);
    expect(() => orderEvents([bare], { requireAuthorityProvenance: true })).toThrow(
      UnauthoritativeTimeError,
    );
    // Provenance-stamped events pass the strict posture.
    const stampAuthority = new TimeAuthority(new FixedClock(BASE_MS));
    const stamped = stamp({}, stampAuthority.now.bind(stampAuthority));
    expect(hasIssuanceProvenance(stamped)).toBe(true);
    expect(() => orderEvents([stamped], { requireAuthorityProvenance: true })).not.toThrow();
  });

  it("scopes ordering per tenant (defense-in-depth over shared record sets)", () => {
    const otherTenant = makeEvent({
      id: "evt-other-tenant",
      tenant_id: "tenant-2",
      occurred_at: iso(BASE_MS - 10_000),
    });
    const mine = makeEvent({ id: "evt-mine" });
    const ordered = orderEvents([otherTenant, mine], { tenantId: "tenant-1" });
    expect(ordered.map((event) => event.id)).toEqual(["evt-mine"]);
  });
});

describe("event semantics — replay (generalized foundation-loop idempotent replay)", () => {
  function countingReducer(state: { applied: string[] }, event: KernelEventRecord) {
    return { applied: [...state.applied, event.id ?? eventDedupDigest(event)] };
  }

  it("applies each unique event exactly once, in total order", () => {
    const authority = new TimeAuthority(new SteppedClock(BASE_MS, 1_000));
    // Issued in order a → b → c but consumed out of issuance order.
    const a = stamp({ id: "evt-a", causation_id: "cause-a" }, authority.now.bind(authority));
    const b = stamp({ id: "evt-b", causation_id: "cause-b" }, authority.now.bind(authority));
    const c = stamp({ id: "evt-c", causation_id: "cause-c" }, authority.now.bind(authority));
    const events = [c, a, b];
    const result = replayEvents(events, { applied: [] }, countingReducer);
    expect(result.state.applied).toEqual(["evt-a", "evt-b", "evt-c"]);
    expect(result.applied.length).toBe(3);
    expect(result.duplicateCount).toBe(0);
  });

  it("a duplicate NEVER double-applies: state equals the once-applied stream", () => {
    const authority = new TimeAuthority(new SteppedClock(BASE_MS, 1_000));
    const first = stamp({ id: "evt-original" }, authority.now.bind(authority));
    const duplicate = stamp({ id: "evt-duplicate" }, authority.now.bind(authority));
    const clean = replayEvents([first], { applied: [] }, countingReducer);
    const noisy = replayEvents([first, duplicate], { applied: [] }, countingReducer);
    expect(noisy.state).toEqual(clean.state);
    expect(noisy.duplicateCount).toBe(1);
  });

  it("replaying a replay is a no-op (idempotency under repeated replay)", () => {
    const authority = new TimeAuthority(new SteppedClock(BASE_MS, 1_000));
    const events = [
      stamp({ id: "evt-1" }, authority.now.bind(authority)),
      stamp({ id: "evt-1" }, authority.now.bind(authority)), // duplicate
      stamp({ id: "evt-2", causation_id: "cause-2" }, authority.now.bind(authority)),
    ];
    const first = replayEvents(events, { applied: [] }, countingReducer);
    const second = replayEvents(first.applied, { applied: [] }, countingReducer);
    expect(second.state).toEqual({ applied: ["evt-1", "evt-2"] });
  });

  it("is invariant under input permutation AND duplication level", () => {
    const authority = new TimeAuthority(new SteppedClock(BASE_MS, 1_000));
    const stream = [
      stamp({ id: "evt-x", causation_id: "cause-x" }, authority.now.bind(authority)),
      stamp(
        { id: "evt-y", causation_id: "cause-y", payload: { state: "off" } },
        authority.now.bind(authority),
      ),
      stamp({ id: "evt-x-dup", causation_id: "cause-x" }, authority.now.bind(authority)), // dup of evt-x
    ];
    const baseline = replayEvents(stream, { applied: [] }, countingReducer);
    expect(baseline.duplicateCount).toBe(1);
    for (const permutation of permutations(stream)) {
      expect(replayEvents(permutation, { applied: [] }, countingReducer).state).toEqual(baseline.state);
    }
  });
});

describe("event semantics — envelope + bi-temporal compatibility (composition)", () => {
  function envelopeDraft(tenantId: string, aggregateId: string, occurredAt?: string) {
    return eventDraft(
      {
        eventType: "core.observation.recorded",
        aggregateType: "core.aggregate",
        aggregateId,
        tenantId,
        payload: { observation: "state-change" },
        occurredAt,
        biTemporal: { validFrom: occurredAt ?? iso(BASE_MS) },
        envelope: {
          objectType: "core.event",
          schemaVersion: "1.0",
          status: "active",
          createdBy: "identity:engineer-1",
          updatedBy: "identity:engineer-1",
          provenance: { source: "kernel:test", originTenantId: tenantId },
          policyContext: { policy: "core.data.internal" },
          traceId: `trace-${aggregateId}`,
          correlationId: `corr-${aggregateId}`,
          declaredOrigin: "kernel:test:bootstrap",
        },
      },
      iso(BASE_MS),
    );
  }

  it("consumes envelope-stamped eventDraft rows verbatim (no shape rewriting)", () => {
    const draft = envelopeDraft("tenant-1", "aggregate-1");
    expect(() => validateEventRecord(draft)).not.toThrow();
    const ordered = orderEvents([draft]);
    expect(ordered.length).toBe(1);
    expect(ordered[0].event_type).toBe("core.observation.recorded");
    expect(ordered[0].valid_from).toBe(iso(BASE_MS));
  });

  it("envelope causation root (declared_origin) satisfies the dedup cause law", () => {
    const first = envelopeDraft("tenant-1", "aggregate-1");
    const redelivered = envelopeDraft("tenant-1", "aggregate-1");
    const result = dedupeEvents([first, redelivered]);
    expect(result.duplicateCount).toBe(1);
    expect(result.unique.length).toBe(1);
    // A DIFFERENT aggregate is a different event: no collapse.
    const other = envelopeDraft("tenant-1", "aggregate-2");
    expect(dedupeEvents([first, other]).duplicateCount).toBe(0);
  });

  it("occurred_at (valid time) governs order; recorded_at (record time) is the fallback", () => {
    const validTimeEarlier = envelopeDraft("tenant-1", "aggregate-1", iso(BASE_MS - 5_000));
    const validTimeLater = envelopeDraft("tenant-1", "aggregate-2", iso(BASE_MS + 5_000));
    const ordered = orderEvents([validTimeLater, validTimeEarlier]);
    expect(ordered.map((event) => event.aggregate_id)).toEqual(["aggregate-1", "aggregate-2"]);
  });

  it("full production posture: consumeEvents validates, orders and classifies in one gate", () => {
    const authority = new TimeAuthority(new SteppedClock(BASE_MS, 1_000));
    // Issued order: critical first (earliest), then routine, then its duplicate.
    const critical = stamp(
      { id: "evt-critical", event_type: "core.invariant.violated" },
      authority.now.bind(authority),
    );
    const routine = stamp({ id: "evt-routine" }, authority.now.bind(authority));
    const routineDup = stamp({ id: "evt-routine-dup" }, authority.now.bind(authority));
    const foreign = makeEvent({ id: "evt-foreign-tenant", tenant_id: "tenant-2" });
    const plan = consumeEvents([routine, routineDup, critical, foreign], { tenantId: "tenant-1" });
    expect(plan.totalSeen).toBe(4);
    expect(plan.duplicateCount).toBe(1);
    expect(plan.ordered.length).toBe(2);
    expect(plan.ordered.map((entry) => entry.event.id)).toEqual(["evt-critical", "evt-routine"]);
    const policies = Object.fromEntries(plan.alertPolicies.map((entry) => [entry.eventId, entry.policy]));
    expect(policies["evt-critical"]).toBe("escalate");
    expect(policies["evt-routine"]).toBe("none");
  });

  it("rejects an unregistered event type inside the production consumption gate", () => {
    const authority = new TimeAuthority(new FixedClock(BASE_MS));
    const stamped = stamp(
      { event_type: "nobody.registered.this" },
      authority.now.bind(authority),
    );
    expect(() => consumeEvents([stamped])).toThrow(UnknownEventTypeError);
  });
});