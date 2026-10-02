/**
 * CoreGrid — tenant-scoped event routing & subscriptions suite (V1CAP-043 /
 * J-021 / MISSION-R-63).
 *
 * Proves, at unit level, that:
 *  1. subscriptions are declared objects and every declaration field fails
 *     closed (ids, taxonomy-registered type filters, visibility scopes,
 *     sensitivity ceiling, delivery semantics, bounded queue);
 *  2. routing evaluates every event against every matching subscription
 *     through M-R-81's consumption gate — the routing layer never forks the
 *     gate's decision (deny/redact per event-security), and there is NO
 *     broadcast primitive (zero subscriptions ⇒ zero deliveries);
 *  3. cross-tenant delivery is impossible — live and in replay alike — and
 *     tenant-less events reach no one (Constitution §13, AGENTS §35);
 *  4. backpressure is bounded and explicit: a full undelivered queue
 *     SUSPENDS the subscription for overload with an auditable record,
 *     further events are shed with audit records (never silently dropped or
 *     silently delayed), drain/replay are unreachable while suspended, and
 *     delivery resumes ONLY on explicit re-subscription with the identical
 *     declaration;
 *  5. replay passes through the SAME gate: revoked/undeliverable events
 *     (missing contract, tampered digest, above-ceiling, cross-tenant,
 *     unprovenanced) stay undeliverable in replay, the replay batch applies
 *     in tenant total order, a declared sequence point excludes events below
 *     it, and replaying full history reconstructs the identical delivered
 *     state as live routing (mission T2 evidence);
 *  6. delivery order respects the tenant total order from event-semantics
 *     under any arrival permutation, and an event whose total-order position
 *     precedes the delivery frontier is "late" — fail-closed, auditable,
 *     never re-ordered into history;
 *  7. dedup composes with the content+cause digest: duplicate events are
 *     never delivered twice across live routing, pending queues and replay,
 *     while same-content-different-cause does NOT collapse (G-010).
 */

import { describe, expect, it } from "vitest";
import {
  EventRouter,
  EventRoutingError,
  SubscriptionConflictError,
  SubscriptionNotFoundError,
  SubscriptionSuspendedError,
  type EventConsumptionCandidate,
  type EventSubscription,
} from "@/lib/kernel/event-routing";
import {
  EVENT_FIELD_WITHHELD,
  deliverEvent,
  secureEvent,
  verifyEventDigest,
  type EventSubscriber,
  type SecuredEvent,
} from "@/lib/kernel/event-security";
import {
  UnknownEventTypeError,
  eventDedupDigest,
  orderEvents,
  registerEventTypes,
  type KernelEventRecord,
} from "@/lib/kernel/event-semantics";

const BASE_MS = Date.parse("2026-10-01T00:00:00.000Z");
const NOW = new Date(BASE_MS + 60_000).toISOString();
const iso = (ms: number) => new Date(ms).toISOString();

let nextEventId = 0;

/** A well-formed event WITH time-authority issuance provenance (shape-valid). */
function makeEvent(overrides: Partial<KernelEventRecord> = {}): KernelEventRecord {
  nextEventId += 1;
  const atMs = BASE_MS + nextEventId;
  return {
    id: `evt-${nextEventId}`,
    event_type: "core.state.changed",
    tenant_id: "tenant-1",
    aggregate_type: "core.aggregate",
    aggregate_id: "aggregate-1",
    payload: { state: "on" },
    occurred_at: iso(atMs),
    recorded_at: iso(atMs),
    sequence: nextEventId,
    issuer: "time-authority:clock:fixed",
    causation_id: `cause-root-${nextEventId}`,
    ...overrides,
  };
}

interface SecureOverrides {
  visibility?: "public" | "tenant" | "restricted" | "direct-observation";
  sensitivity?: "public" | "internal" | "restricted";
  subjectRefs?: string[];
  redactableFields?: string[];
  evidenceClass?: "observed" | "reported" | "inferred" | "predicted" | "simulated";
}

function secure(
  overrides: SecureOverrides = {},
  event: KernelEventRecord = makeEvent(),
): SecuredEvent {
  return secureEvent({
    event,
    issuerId: "agent:fixture-emitter",
    visibility: overrides.visibility ?? "tenant",
    emissionAuthority: "policy:event.emit",
    sensitivity: overrides.sensitivity ?? "internal",
    subjectRefs: overrides.subjectRefs ?? [],
    redactableFields: overrides.redactableFields ?? [],
    evidenceClass: overrides.evidenceClass ?? "observed",
    source: "fixture:source",
    previousDigest: null,
  });
}

function declaration(overrides: Partial<EventSubscription> = {}): EventSubscription {
  return {
    subscriptionId: "sub-1",
    subscriberId: "subscriber-1",
    tenantId: "tenant-1",
    eventTypes: [],
    visibilityScopes: ["public", "tenant", "restricted", "direct-observation"],
    maxSensitivity: "restricted",
    delivery: { ordering: "tenant-total-order", dedup: "collapse-duplicates", maxUndelivered: 100 },
    ...overrides,
  };
}

function idsOf(
  deliveries: readonly { event: KernelEventRecord | null }[],
): (string | null | undefined)[] {
  return deliveries.map((delivery) => delivery.event?.id);
}

registerEventTypes("fixture:routing", [
  { eventType: "fixture.routing.alpha", significance: "notable" },
  { eventType: "fixture.routing.beta", significance: "routine" },
]);

describe("event routing — subscription declarations fail closed", () => {
  it("accepts a well-formed declaration and returns an active receipt", () => {
    const router = new EventRouter();
    const receipt = router.subscribe(declaration());
    expect(receipt).toEqual({
      subscriptionId: "sub-1",
      status: "active",
      resumedFromSuspension: false,
      queueDepth: 0,
    });
    expect(router.status("sub-1").status).toBe("active");
  });

  it("rejects malformed identity and tenant fields", () => {
    const router = new EventRouter();
    expect(() => router.subscribe(declaration({ subscriptionId: "" }))).toThrow(EventRoutingError);
    expect(() => router.subscribe(declaration({ subscriberId: "  " }))).toThrow(EventRoutingError);
    expect(() => router.subscribe(declaration({ tenantId: "" }))).toThrow(EventRoutingError);
    try {
      router.subscribe(declaration({ tenantId: "" }));
      expect.unreachable("must throw");
    } catch (error) {
      expect((error as EventRoutingError).field).toBe("tenantId");
    }
  });

  it("rejects an event-type filter naming an unregistered taxonomy type", () => {
    const router = new EventRouter();
    expect(() => router.subscribe(declaration({ eventTypes: ["nobody.registered.this"] }))).toThrow(
      EventRoutingError,
    );
    try {
      router.subscribe(declaration({ eventTypes: ["nobody.registered.this"] }));
      expect.unreachable("must throw");
    } catch (error) {
      expect((error as EventRoutingError).field).toBe("eventTypes");
      expect((error as EventRoutingError).message).toContain("not registered");
    }
  });

  it("rejects unknown visibility scopes, sensitivities and delivery semantics", () => {
    const router = new EventRouter();
    expect(() => router.subscribe(declaration({ visibilityScopes: ["galaxy" as never] }))).toThrow(
      /visibilityScopes/,
    );
    expect(() => router.subscribe(declaration({ maxSensitivity: "unlimited" as never }))).toThrow(
      /maxSensitivity/,
    );
    expect(() =>
      router.subscribe(
        declaration({
          delivery: {
            ordering: "arrival-order" as never,
            dedup: "collapse-duplicates",
            maxUndelivered: 1,
          },
        }),
      ),
    ).toThrow(/delivery\.ordering/);
    expect(() =>
      router.subscribe(
        declaration({
          delivery: {
            ordering: "tenant-total-order",
            dedup: "keep-duplicates" as never,
            maxUndelivered: 1,
          },
        }),
      ),
    ).toThrow(/delivery\.dedup/);
    expect(() =>
      router.subscribe(
        declaration({
          delivery: {
            ordering: "tenant-total-order",
            dedup: "collapse-duplicates",
            maxUndelivered: 0,
          },
        }),
      ),
    ).toThrow(/maxUndelivered/);
    expect(() =>
      router.subscribe(
        declaration({
          delivery: {
            ordering: "tenant-total-order",
            dedup: "collapse-duplicates",
            maxUndelivered: 1.5,
          },
        }),
      ),
    ).toThrow(/maxUndelivered/);
  });

  it("keeps the declaration immutable: identical re-declaration is idempotent, a changed one conflicts", () => {
    const router = new EventRouter();
    router.subscribe(declaration());
    const receipt = router.subscribe(declaration());
    expect(receipt.status).toBe("active");
    expect(receipt.resumedFromSuspension).toBe(false);
    expect(() => router.subscribe(declaration({ maxSensitivity: "internal" }))).toThrow(
      SubscriptionConflictError,
    );
  });

  it("rejects unknown subscriptions on status/drain/replay/unsubscribe", () => {
    const router = new EventRouter();
    expect(() => router.status("ghost")).toThrow(SubscriptionNotFoundError);
    expect(() => router.drain("ghost")).toThrow(SubscriptionNotFoundError);
    expect(() => router.replay("ghost", [], { now: NOW })).toThrow(SubscriptionNotFoundError);
    expect(() => router.unsubscribe("ghost")).toThrow(SubscriptionNotFoundError);
  });

  it("rejects a non-ISO audit instant (supplied, never sampled)", () => {
    const router = new EventRouter();
    expect(() => router.routeEvent(secure(), { now: "not-a-timestamp" })).toThrow(
      EventRoutingError,
    );
  });
});

describe("event routing — filtered delivery per subscription", () => {
  it("routes each event only to subscriptions whose declared filter matches", () => {
    const router = new EventRouter();
    router.subscribe(
      declaration({ subscriptionId: "sub-alpha", eventTypes: ["fixture.routing.alpha"] }),
    );
    router.subscribe(
      declaration({ subscriptionId: "sub-beta", eventTypes: ["fixture.routing.beta"] }),
    );
    router.subscribe(declaration({ subscriptionId: "sub-all", eventTypes: [] }));

    const alpha = secure({}, makeEvent({ event_type: "fixture.routing.alpha" }));
    const beta = secure({}, makeEvent({ event_type: "fixture.routing.beta" }));

    const alphaResult = router.routeEvent(alpha, { now: NOW });
    expect(alphaResult.outcomes.map((outcome) => outcome.subscriptionId).sort()).toEqual([
      "sub-all",
      "sub-alpha",
    ]);
    const betaResult = router.routeEvent(beta, { now: NOW });
    expect(betaResult.outcomes.map((outcome) => outcome.subscriptionId).sort()).toEqual([
      "sub-all",
      "sub-beta",
    ]);

    expect(idsOf(router.drain("sub-alpha").deliveries)).toEqual([alpha.event.id]);
    expect(idsOf(router.drain("sub-beta").deliveries)).toEqual([beta.event.id]);
    const allDrain = router.drain("sub-all");
    expect(idsOf(allDrain.deliveries)).toEqual([alpha.event.id, beta.event.id]);
    expect(allDrain.remaining).toBe(0);
  });

  it("reaches NO ONE with zero matching subscriptions — there is no broadcast primitive", () => {
    const router = new EventRouter();
    const result = router.routeEvent(secure(), { now: NOW });
    expect(result.outcomes).toEqual([]);
    const afterSubscribe = new EventRouter();
    afterSubscribe.subscribe(declaration({ eventTypes: ["fixture.routing.alpha"] }));
    const filtered = afterSubscribe.routeEvent(secure(), { now: NOW });
    expect(filtered.outcomes).toEqual([]);
    expect(afterSubscribe.status("sub-1").queueDepth).toBe(0);
  });
});

describe("event routing — gate enforcement (compose, never fork M-R-81)", () => {
  it("queues the gated ALLOW view for a fully authorized subscription", () => {
    const router = new EventRouter();
    router.subscribe(declaration());
    const secured = secure();
    const result = router.routeEvent(secured, { now: NOW });
    expect(result.eventId).toBe(secured.event.id);
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].kind).toBe("queued");
    expect(result.outcomes[0].delivery?.decision).toBe("ALLOW");
    expect(result.outcomes[0].delivery?.event).toBe(secured.event);
    expect(result.outcomes[0].denial).toBeNull();
    const drain = router.drain("sub-1");
    expect(drain.deliveries[0].decision).toBe("ALLOW");
    expect(drain.deliveries[0].event).toBe(secured.event);
  });

  it("queues the gated REDACT view when the ceiling is below the event sensitivity", () => {
    const router = new EventRouter();
    router.subscribe(declaration({ maxSensitivity: "internal" }));
    const secured = secure({
      sensitivity: "restricted",
      subjectRefs: ["ent:subject-a"],
      redactableFields: ["state"],
    });
    const result = router.routeEvent(secured, { now: NOW });
    expect(result.outcomes[0].kind).toBe("queued");
    expect(result.outcomes[0].delivery?.decision).toBe("REDACT");
    const drain = router.drain("sub-1");
    expect(drain.deliveries[0].decision).toBe("REDACT");
    expect(drain.deliveries[0].event?.payload).toEqual({ state: EVENT_FIELD_WITHHELD });
    expect(drain.deliveries[0].security?.privacy.subjectRefs).toEqual([EVENT_FIELD_WITHHELD]);
    expect(drain.deliveries[0].redactions).toHaveLength(1);
    expect(drain.deliveries[0].redactions[0].withheldFields).toEqual(["state"]);
  });

  it("denies (never downgrades) when the event cannot be safely minimized", () => {
    const router = new EventRouter();
    router.subscribe(declaration({ maxSensitivity: "internal" }));
    const secured = secure({ sensitivity: "restricted", redactableFields: [] });
    const result = router.routeEvent(secured, { now: NOW });
    expect(result.outcomes[0].kind).toBe("denied");
    expect(result.outcomes[0].denial?.reason).toBe("sensitivity_not_authorized");
    expect(result.outcomes[0].delivery).toBeNull();
    expect(router.status("sub-1").queueDepth).toBe(0);
  });

  it("denies when the event visibility is outside the declared scope set", () => {
    const router = new EventRouter();
    router.subscribe(declaration({ visibilityScopes: ["public", "tenant"] }));
    const secured = secure({ visibility: "restricted" });
    const result = router.routeEvent(secured, { now: NOW });
    expect(result.outcomes[0].kind).toBe("denied");
    expect(result.outcomes[0].denial?.reason).toBe("visibility_not_authorized");
  });

  it("denies an event with no security contract to every subscriber (fail-closed)", () => {
    const router = new EventRouter();
    router.subscribe(declaration());
    const bare: EventConsumptionCandidate = { event: makeEvent() };
    const result = router.routeEvent(bare, { now: NOW });
    expect(result.outcomes[0].kind).toBe("denied");
    expect(result.outcomes[0].denial?.reason).toBe("missing_security_contract");
    expect(router.drain("sub-1").deliveries).toEqual([]);
  });

  it("denies a tampered event via the gate's digest recompute", () => {
    const router = new EventRouter();
    router.subscribe(declaration());
    const secured = secure();
    const tampered: EventConsumptionCandidate = {
      event: { ...secured.event, payload: { state: "tampered" } },
      security: secured.security,
    };
    expect(verifyEventDigest(tampered)).toBe(false);
    const result = router.routeEvent(tampered, { now: NOW });
    expect(result.outcomes[0].kind).toBe("denied");
    expect(result.outcomes[0].denial?.reason).toBe("tampered_digest");
  });

  it("rejects events that fail the event-semantics consumption posture before any subscription", () => {
    const router = new EventRouter();
    router.subscribe(declaration());
    expect(() =>
      router.routeEvent(secure({}, makeEvent({ event_type: "nobody.registered.this" })), {
        now: NOW,
      }),
    ).toThrow(UnknownEventTypeError);
  });
});

describe("event routing — cross-tenant isolation", () => {
  it("never routes a cross-tenant event: the gate denies and nothing is queued", () => {
    const router = new EventRouter();
    router.subscribe(declaration({ subscriptionId: "sub-a", tenantId: "tenant-1" }));
    router.subscribe(declaration({ subscriptionId: "sub-b", tenantId: "tenant-2" }));
    const tenant1Event = secure();
    const result = router.routeEvent(tenant1Event, { now: NOW });
    const subA = result.outcomes.find((outcome) => outcome.subscriptionId === "sub-a");
    const subB = result.outcomes.find((outcome) => outcome.subscriptionId === "sub-b");
    expect(subA?.kind).toBe("queued");
    expect(subB?.kind).toBe("denied");
    expect(subB?.denial?.reason).toBe("tenant_mismatch");
    expect(router.drain("sub-b").deliveries).toEqual([]);
    expect(idsOf(router.drain("sub-a").deliveries)).toEqual([tenant1Event.event.id]);
  });

  it("denies a tenant-less event to every subscriber (anonymous at the tenancy boundary)", () => {
    const router = new EventRouter();
    router.subscribe(declaration({ subscriptionId: "sub-a", tenantId: "tenant-1" }));
    router.subscribe(declaration({ subscriptionId: "sub-b", tenantId: "tenant-2" }));
    const result = router.routeEvent(secure({}, makeEvent({ tenant_id: null })), { now: NOW });
    expect(result.outcomes).toHaveLength(2);
    for (const outcome of result.outcomes) {
      expect(outcome.kind).toBe("denied");
      expect(outcome.denial?.reason).toBe("tenant_mismatch");
      expect(outcome.denial?.detail).toContain("null");
    }
  });

  it("denies cross-tenant candidates during replay and never delivers them", () => {
    const router = new EventRouter();
    router.subscribe(declaration({ tenantId: "tenant-2", subscriberId: "subscriber-2" }));
    const tenant1Event = secure();
    const tenant2Event = secure({}, makeEvent({ tenant_id: "tenant-2" }));
    const result = router.replay("sub-1", [tenant1Event, tenant2Event], { now: NOW });
    expect(result.queuedCount).toBe(1);
    expect(result.deniedCount).toBe(1);
    const denied = result.outcomes.find((outcome) => outcome.kind === "denied");
    expect(denied?.eventId).toBe(tenant1Event.event.id);
    expect(denied?.denial?.reason).toBe("tenant_mismatch");
    const drain = router.drain("sub-1");
    expect(idsOf(drain.deliveries)).toEqual([tenant2Event.event.id]);
  });
});

describe("event routing — backpressure is bounded and explicit", () => {
  function deliverableEvents(count: number): SecuredEvent[] {
    return Array.from({ length: count }, () => secure());
  }

  it("suspends for overload when the undelivered bound is exceeded, with an auditable record", () => {
    const router = new EventRouter();
    router.subscribe(
      declaration({
        subscriptionId: "sub-bp",
        delivery: {
          ordering: "tenant-total-order",
          dedup: "collapse-duplicates",
          maxUndelivered: 2,
        },
      }),
    );
    const [e1, e2, e3, e4] = deliverableEvents(4);
    expect(router.routeEvent(e1, { now: NOW }).outcomes[0].kind).toBe("queued");
    expect(router.routeEvent(e2, { now: NOW }).outcomes[0].kind).toBe("queued");

    const third = router.routeEvent(e3, { now: NOW }).outcomes[0];
    expect(third.kind).toBe("overload");
    expect(third.backpressure).not.toBeNull();
    expect(third.backpressure?.reason).toBe("overload");
    expect(third.backpressure?.queueLimit).toBe(2);
    expect(third.backpressure?.queueDepth).toBe(2);
    expect(third.backpressure?.eventId).toBe(e3.event.id);
    expect(third.backpressure?.recordedAt).toBe(NOW);
    expect(third.detail).toContain("SUSPENDED");

    const fourth = router.routeEvent(e4, { now: NOW }).outcomes[0];
    expect(fourth.kind).toBe("suspended");
    expect(fourth.delivery).toBeNull();
    expect(fourth.detail).toContain("shed");

    const status = router.status("sub-bp");
    expect(status.status).toBe("suspended");
    expect(status.suspension?.eventId).toBe(e3.event.id);
    expect(status.queueDepth).toBe(2);

    expect(() => router.drain("sub-bp")).toThrow(SubscriptionSuspendedError);
    expect(() => router.replay("sub-bp", [], { now: NOW })).toThrow(SubscriptionSuspendedError);
  });

  it("resumes delivery ONLY on explicit re-subscription with the identical declaration", () => {
    const router = new EventRouter();
    router.subscribe(
      declaration({
        subscriptionId: "sub-bp",
        delivery: {
          ordering: "tenant-total-order",
          dedup: "collapse-duplicates",
          maxUndelivered: 1,
        },
      }),
    );
    const [e1, e2, e3] = deliverableEvents(3);
    router.routeEvent(e1, { now: NOW });
    expect(router.routeEvent(e2, { now: NOW }).outcomes[0].kind).toBe("overload");
    expect(router.routeEvent(e3, { now: NOW }).outcomes[0].kind).toBe("suspended");

    expect(() => router.drain("sub-bp")).toThrow(SubscriptionSuspendedError);
    expect(() =>
      router.subscribe(declaration({ subscriptionId: "sub-bp", subscriberId: "changed" })),
    ).toThrow(SubscriptionConflictError);

    const receipt = router.subscribe(
      declaration({
        subscriptionId: "sub-bp",
        delivery: {
          ordering: "tenant-total-order",
          dedup: "collapse-duplicates",
          maxUndelivered: 1,
        },
      }),
    );
    expect(receipt.status).toBe("active");
    expect(receipt.resumedFromSuspension).toBe(true);
    expect(router.status("sub-bp").suspension).toBeNull();

    const drain1 = router.drain("sub-bp");
    expect(idsOf(drain1.deliveries)).toEqual([e1.event.id]);

    // The shed events were never enqueued (no digest recorded), so replaying
    // them after re-subscription queues them through the gate. The bound is
    // still 1, so recovery proceeds one event at a time: replay e2, drain,
    // then route e3 live (it follows the new delivery frontier).
    const replayed = router.replay("sub-bp", [e2], {
      now: NOW,
      fromSequence: e2.event.sequence ?? 0,
    });
    expect(replayed.queuedCount).toBe(1);
    expect(idsOf(router.drain("sub-bp").deliveries)).toEqual([e2.event.id]);
    expect(router.routeEvent(e3, { now: NOW }).outcomes[0].kind).toBe("queued");
    expect(idsOf(router.drain("sub-bp").deliveries)).toEqual([e3.event.id]);
  });

  it("sheds load mid-replay without loss of auditability", () => {
    const router = new EventRouter();
    router.subscribe(
      declaration({
        subscriptionId: "sub-replay-bp",
        delivery: {
          ordering: "tenant-total-order",
          dedup: "collapse-duplicates",
          maxUndelivered: 2,
        },
      }),
    );
    const [e1, e2, e3, e4] = deliverableEvents(4);
    const result = router.replay("sub-replay-bp", [e4, e1, e3, e2], { now: NOW });
    expect(result.suspendedDuringReplay).toBe(true);
    const kinds = result.outcomes.map((outcome) => outcome.kind);
    expect(kinds).toEqual(["queued", "queued", "overload", "suspended"]);
    expect(result.outcomes[2].backpressure?.eventId).toBe(e3.event.id);
    expect(result.outcomes[3].detail).toContain("shed");
    // The subscription is suspended mid-replay: draining is unreachable until
    // the explicit identical re-subscription — nothing else resumes delivery.
    expect(() => router.drain("sub-replay-bp")).toThrow(SubscriptionSuspendedError);
    router.subscribe(
      declaration({
        subscriptionId: "sub-replay-bp",
        delivery: {
          ordering: "tenant-total-order",
          dedup: "collapse-duplicates",
          maxUndelivered: 2,
        },
      }),
    );
    const drain = router.drain("sub-replay-bp");
    expect(idsOf(drain.deliveries)).toEqual([e1.event.id, e2.event.id]);
    // e3 and e4 were shed with audit records — the subscription recovers them
    // by explicit re-subscription plus a replay from a later point.
    router.subscribe(
      declaration({
        subscriptionId: "sub-replay-bp",
        delivery: {
          ordering: "tenant-total-order",
          dedup: "collapse-duplicates",
          maxUndelivered: 2,
        },
      }),
    );
    const recovered = router.replay("sub-replay-bp", [e3, e4], {
      now: NOW,
      fromSequence: e3.event.sequence ?? 0,
    });
    expect(recovered.queuedCount).toBe(2);
    expect(idsOf(router.drain("sub-replay-bp").deliveries)).toEqual([e3.event.id, e4.event.id]);
  });
});

describe("event routing — replay through the SAME gate (never a bypass)", () => {
  it("keeps revoked/undeliverable events undeliverable in replay", () => {
    const router = new EventRouter();
    router.subscribe(declaration({ maxSensitivity: "internal" }));
    const noContract: EventConsumptionCandidate = { event: makeEvent() };
    const secured = secure();
    const tampered: EventConsumptionCandidate = {
      event: { ...secured.event, payload: { state: "tampered" } },
      security: secured.security,
    };
    const aboveCeiling = secure({ sensitivity: "restricted", redactableFields: [] });

    const result = router.replay("sub-1", [noContract, tampered, aboveCeiling], { now: NOW });
    expect(result.queuedCount).toBe(0);
    expect(result.deniedCount).toBe(3);
    const reasons = result.outcomes.map((outcome) => outcome.denial?.reason).sort();
    expect(reasons).toEqual([
      "missing_security_contract",
      "sensitivity_not_authorized",
      "tampered_digest",
    ]);
    expect(router.drain("sub-1").deliveries).toEqual([]);
  });

  it("denies an unprovenanced replay candidate at the gate (unverifiable issuance)", () => {
    const router = new EventRouter();
    router.subscribe(declaration());
    // The attack shape: a validly secured event whose issuance provenance was
    // stripped in flight — the contract no longer verifies against the event.
    const secured = secure();
    const stripped: EventConsumptionCandidate = {
      event: { ...secured.event, sequence: null, issuer: null },
      security: secured.security,
    };
    const result = router.replay("sub-1", [stripped], { now: NOW });
    expect(result.queuedCount).toBe(0);
    expect(result.deniedCount).toBe(1);
    expect(result.outcomes[0].denial?.reason).toBe("unverifiable_issuance");
  });

  it("excludes events below the declared sequence point before the gate", () => {
    const router = new EventRouter();
    router.subscribe(declaration());
    const [e1, e2, e3] = [secure(), secure(), secure()];
    const result = router.replay("sub-1", [e3, e1, e2], {
      now: NOW,
      fromSequence: e2.event.sequence ?? 0,
    });
    expect(result.excludedBelowFromSequence).toBe(1);
    expect(result.considered).toBe(2);
    expect(result.queuedCount).toBe(2);
    expect(idsOf(router.drain("sub-1").deliveries)).toEqual([e2.event.id, e3.event.id]);
  });

  it("replaying full history reconstructs the identical delivered state as live routing", () => {
    const live = new EventRouter();
    const replayed = new EventRouter();
    const liveDeclaration = declaration({
      subscriptionId: "sub-live",
      subscriberId: "subscriber-live",
    });
    const replayDeclaration = declaration({
      subscriptionId: "sub-replay",
      subscriberId: "subscriber-replay",
    });
    live.subscribe(liveDeclaration);
    replayed.subscribe(replayDeclaration);

    const secured = [
      secure(),
      secure({
        sensitivity: "restricted",
        subjectRefs: ["ent:subject-a"],
        redactableFields: ["state"],
      }),
      secure({}, makeEvent({ event_type: "core.observation.recorded" })),
      secure(),
    ];

    for (const entry of secured) {
      live.routeEvent(entry, { now: NOW });
    }
    const liveDrain = live.drain("sub-live");
    const liveDelivered = liveDrain.deliveries.map((delivery) => ({
      eventId: delivery.event?.id,
      decision: delivery.decision,
      payload: delivery.event?.payload,
    }));

    const replayResult = replayed.replay("sub-replay", [...secured].reverse(), { now: NOW });
    expect(replayResult.queuedCount).toBe(4);
    expect(replayResult.duplicateCount).toBe(0);
    const replayDrain = replayed.drain("sub-replay");
    const replayDelivered = replayDrain.deliveries.map((delivery) => ({
      eventId: delivery.event?.id,
      decision: delivery.decision,
      payload: delivery.event?.payload,
    }));
    expect(replayDelivered).toEqual(liveDelivered);
  });

  it("rejects an unknown event type in the replay window (consumption posture holds)", () => {
    const router = new EventRouter();
    router.subscribe(declaration());
    expect(() =>
      router.replay("sub-1", [secure({}, makeEvent({ event_type: "nobody.registered.this" }))], {
        now: NOW,
      }),
    ).toThrow(UnknownEventTypeError);
  });
});

describe("event routing — ordering preserves the tenant total order", () => {
  it("delivers in total order under ANY arrival permutation", () => {
    const router = new EventRouter();
    router.subscribe(declaration());
    const secured = [secure(), secure(), secure(), secure()];
    const expected = orderEvents(secured.map((entry) => entry.event)).map((event) => event.id);
    const scrambles = [
      secured,
      [...secured].reverse(),
      [secured[2], secured[0], secured[3], secured[1]],
    ];
    for (const scramble of scrambles) {
      const permutationRouter = new EventRouter();
      permutationRouter.subscribe(declaration());
      for (const entry of scramble) {
        const result = permutationRouter.routeEvent(entry, { now: NOW });
        expect(result.outcomes.every((outcome) => outcome.kind === "queued")).toBe(true);
      }
      expect(idsOf(permutationRouter.drain("sub-1").deliveries)).toEqual(expected);
    }
  });

  it("marks an event behind the delivery frontier as late — never re-orders it into history", () => {
    const router = new EventRouter();
    router.subscribe(declaration());
    const e1 = secure();
    const e2 = secure();
    expect(router.routeEvent(e2, { now: NOW }).outcomes[0].kind).toBe("queued");
    expect(idsOf(router.drain("sub-1").deliveries)).toEqual([e2.event.id]);

    const late = router.routeEvent(e1, { now: NOW }).outcomes[0];
    expect(late.kind).toBe("late");
    expect(late.delivery).toBeNull();
    expect(late.detail).toContain("frontier");
    expect(router.status("sub-1").deliveredCount).toBe(1);
    expect(router.drain("sub-1").deliveries).toEqual([]);

    // Recovery is a NEW subscription identity replaying from a sequence point:
    // the fresh identity re-delivers the whole window through the same gate,
    // in total order.
    router.subscribe(
      declaration({ subscriptionId: "sub-recover", subscriberId: "subscriber-recover" }),
    );
    const recovery = router.replay("sub-recover", [e1, e2], { now: NOW });
    expect(recovery.queuedCount).toBe(2);
    expect(idsOf(router.drain("sub-recover").deliveries)).toEqual([e1.event.id, e2.event.id]);
  });
});

describe("event routing — dedup compatibility (content+cause digest)", () => {
  it("never delivers a duplicate twice: live, pending, or after drain", () => {
    const router = new EventRouter();
    router.subscribe(declaration());
    const secured = secure();
    const duplicate: EventConsumptionCandidate = {
      event: secured.event,
      security: secured.security,
    };

    const first = router.routeEvent(secured, { now: NOW });
    expect(first.outcomes[0].kind).toBe("queued");
    // Duplicate while the original is still PENDING: collapses, no double queue.
    expect(router.routeEvent(duplicate, { now: NOW }).outcomes[0].kind).toBe("duplicate");
    expect(router.status("sub-1").queueDepth).toBe(1);

    const drain = router.drain("sub-1");
    expect(idsOf(drain.deliveries)).toEqual([secured.event.id]);

    // Duplicate AFTER delivery: still collapses — never delivered twice.
    expect(router.routeEvent(duplicate, { now: NOW }).outcomes[0].kind).toBe("duplicate");
    expect(router.drain("sub-1").deliveries).toEqual([]);
    expect(router.status("sub-1").deliveredCount).toBe(1);
  });

  it("collapses duplicates in replay but not same-content-different-cause events (G-010)", () => {
    const router = new EventRouter();
    router.subscribe(declaration());
    const original = secure();
    const sameContentDifferentCause = secure(
      {},
      makeEvent({ causation_id: "cause-root-unrelated" }),
    );
    expect(eventDedupDigest(original.event)).not.toBe(
      eventDedupDigest(sameContentDifferentCause.event),
    );

    const first = router.replay("sub-1", [original, original, sameContentDifferentCause], {
      now: NOW,
    });
    expect(first.queuedCount).toBe(2);
    expect(first.duplicateCount).toBe(1);
    // A SECOND replay of the same stream collapses entirely.
    const second = router.replay("sub-1", [original, sameContentDifferentCause], { now: NOW });
    expect(second.queuedCount).toBe(0);
    expect(second.duplicateCount).toBe(2);
    expect(idsOf(router.drain("sub-1").deliveries)).toEqual([
      original.event.id,
      sameContentDifferentCause.event.id,
    ]);
    expect(router.status("sub-1").deliveredCount).toBe(2);
  });
});

describe("event routing — subscription lifecycle and observability", () => {
  it("unsubscribes explicitly: a retired identity receives nothing further", () => {
    const router = new EventRouter();
    router.subscribe(declaration({ subscriptionId: "sub-gone" }));
    router.unsubscribe("sub-gone");
    expect(() => router.status("sub-gone")).toThrow(SubscriptionNotFoundError);
    const result = router.routeEvent(secure(), { now: NOW });
    expect(result.outcomes).toEqual([]);
  });

  it("snapshots every subscription deterministically for audit", () => {
    const router = new EventRouter();
    router.subscribe(declaration({ subscriptionId: "sub-b" }));
    router.subscribe(declaration({ subscriptionId: "sub-a" }));
    router.routeEvent(secure(), { now: NOW });
    const snapshots = router.statuses();
    expect(snapshots.map((snapshot) => snapshot.subscriptionId)).toEqual(["sub-a", "sub-b"]);
    for (const snapshot of snapshots) {
      expect(snapshot.status).toBe("active");
      expect(snapshot.deliveredCount).toBe(0);
      expect(snapshot.suspension).toBeNull();
    }
    expect(snapshots.find((snapshot) => snapshot.subscriptionId === "sub-b")?.queueDepth).toBe(1);
  });
});

describe("event routing — vocabulary composition pins", () => {
  it("delivers only through the gate's decision vocabulary (no routing-local decisions)", () => {
    const router = new EventRouter();
    router.subscribe(declaration({ maxSensitivity: "internal" }));
    const allowed = secure();
    const redacted = secure({
      sensitivity: "restricted",
      subjectRefs: ["ent:1"],
      redactableFields: ["state"],
    });
    const denied = secure({ sensitivity: "restricted", redactableFields: [] });
    const outcomes = [
      router.routeEvent(allowed, { now: NOW }).outcomes[0],
      router.routeEvent(redacted, { now: NOW }).outcomes[0],
      router.routeEvent(denied, { now: NOW }).outcomes[0],
    ];
    const decisions = outcomes.map((outcome) =>
      outcome.kind === "denied" ? "DENY" : (outcome.delivery?.decision ?? null),
    );
    expect(decisions).toEqual(["ALLOW", "REDACT", "DENY"]);
    expect(
      decisions.every((decision) => ["ALLOW", "DENY", "REDACT"].includes(decision as string)),
    ).toBe(true);
  });

  it("binds every outcome to the declaring subscriber identity and audit instant", () => {
    const router = new EventRouter();
    router.subscribe(
      declaration({
        subscriptionId: "sub-audit",
        subscriberId: "subscriber-audit",
        tenantId: "tenant-1",
      }),
    );
    const outcomes = router.routeEvent(secure(), { now: NOW }).outcomes;
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].subscriptionId).toBe("sub-audit");
    expect(outcomes[0].subscriberId).toBe("subscriber-audit");
    expect(outcomes[0].recordedAt).toBe(NOW);
  });
});

describe("event routing — subscriber shape pin (gate composition)", () => {
  it("passes the declaration to the gate as the server-resolved EventSubscriber verbatim", () => {
    const router = new EventRouter();
    const decl = declaration({
      subscriberId: "subscriber-gate",
      tenantId: "tenant-1",
      visibilityScopes: ["tenant"],
      maxSensitivity: "internal",
    });
    router.subscribe(decl);
    const secured = secure({ sensitivity: "restricted", redactableFields: [] });
    // The identical subscriber shape through the gate directly: the routing
    // outcome must match the gate's own decision — routing adds no authority.
    const subscriber: EventSubscriber = {
      subscriberId: decl.subscriberId,
      tenantId: decl.tenantId,
      visibilityScopes: decl.visibilityScopes,
      maxSensitivity: decl.maxSensitivity,
    };
    const direct = deliverEvent(secured, subscriber, { now: NOW });
    const routed = router.routeEvent(secured, { now: NOW });
    expect(routed.outcomes[0].kind).toBe("denied");
    expect(routed.outcomes[0].denial?.reason).toBe(direct.denial?.reason);
    expect(routed.outcomes[0].denial?.reason).toBe("sensitivity_not_authorized");
  });
});
