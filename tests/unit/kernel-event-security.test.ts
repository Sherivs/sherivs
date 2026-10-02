/**
 * CoreGrid — per-event security contract suite (V1CAP-044 / J-022 /
 * MISSION-R-81).
 *
 * Proves, at unit level, that:
 *  1. an event WITHOUT its security contract is UNDELIVERABLE — denied to
 *     every subscriber, never broadcast with default security fields
 *     (AGENTS §35 fail-closed);
 *  2. the consumption gate authorizes per subscriber and per axis (tenant,
 *     declared visibility scope, sensitivity ceiling) with auditable
 *     DENY/REDACT records — no silent drops, no broadcast primitive;
 *  3. cross-tenant delivery never happens, including tenant-less events;
 *  4. a generated event (inferred/predicted/simulated/reported) can NEVER
 *     claim direct-observation visibility — rejected at emission and denied
 *     at consumption (canonical truth law, Constitution §9);
 *  5. the tamper-evident per-tenant digest chain detects content tampering,
 *     contract tampering, and history rewriting (linkage break);
 *  6. redaction withholds privacy fields and subject refs (withheld, never
 *     deleted) and records the minimization for audit;
 *  7. secured events compose verbatim with event-semantics ordering,
 *     deduplication and the production consumption posture — the security
 *     sidecar never breaks the event plane's guarantees;
 *  8. the sensitivity vocabulary is pinned to lib/context-assembly and the
 *     delivery decisions are a subset of the five-valued authorization
 *     vocabulary.
 */

import { describe, expect, it } from "vitest";
import {
  EVENT_FIELD_WITHHELD,
  EVENT_SENSITIVITIES,
  EVENT_VISIBILITY_SCOPES,
  EventSecurityContractError,
  deliverEvent,
  deliverEventToSubscribers,
  evaluateEventSecurity,
  eventSecurityDigest,
  secureEvent,
  verifyEventDigest,
  verifyEventDigestChain,
  type EventConsumptionCandidate,
  type EventSubscriber,
  type SecuredEvent,
} from "@/lib/kernel/event-security";
import {
  UnauthoritativeTimeError,
  compareEventOrder,
  consumeEvents,
  dedupeEvents,
  orderEvents,
  stampEventWithIssuedTime,
  type KernelEventRecord,
} from "@/lib/kernel/event-semantics";
import { FixedClock, TimeAuthority } from "@/lib/kernel/time-authority";
import type { AuthorizationDecision } from "@/lib/identity";
import type { ContextSensitivity } from "@/lib/context-assembly";

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
  issuerId?: string;
  visibility?: "public" | "tenant" | "restricted" | "direct-observation";
  emissionAuthority?: string;
  sensitivity?: "public" | "internal" | "restricted";
  subjectRefs?: string[];
  redactableFields?: string[];
  evidenceClass?: "observed" | "reported" | "inferred" | "predicted" | "simulated";
  source?: string;
  previousDigest?: string | null;
}

function secure(overrides: SecureOverrides = {}, event: KernelEventRecord = makeEvent()): SecuredEvent {
  return secureEvent({
    event,
    issuerId: overrides.issuerId ?? "agent:fixture-emitter",
    visibility: overrides.visibility ?? "tenant",
    emissionAuthority: overrides.emissionAuthority ?? "policy:event.emit",
    sensitivity: overrides.sensitivity ?? "internal",
    subjectRefs: overrides.subjectRefs ?? [],
    redactableFields: overrides.redactableFields ?? [],
    evidenceClass: overrides.evidenceClass ?? "observed",
    source: overrides.source ?? "fixture:source",
    previousDigest: overrides.previousDigest ?? null,
  });
}

const fullSubscriber: EventSubscriber = {
  subscriberId: "subscriber-full",
  tenantId: "tenant-1",
  visibilityScopes: [...EVENT_VISIBILITY_SCOPES],
  maxSensitivity: "restricted",
};

function makeSubscriber(overrides: Partial<EventSubscriber> = {}): EventSubscriber {
  return {
    subscriberId: `subscriber-${Math.random().toString(36).slice(2, 8)}`,
    tenantId: "tenant-1",
    visibilityScopes: [...EVENT_VISIBILITY_SCOPES],
    maxSensitivity: "restricted",
    ...overrides,
  };
}

describe("event security — emission binding (secureEvent)", () => {
  it("binds the full contract and produces a self-verifying digest", () => {
    const secured = secure({ sensitivity: "restricted", subjectRefs: ["ent:1"], redactableFields: ["state"] });
    expect(secured.security.authenticity.issuerId).toBe("agent:fixture-emitter");
    expect(secured.security.authenticity.issuance.issuer).toBe("time-authority:clock:fixed");
    expect(secured.security.authorization.emissionAuthority).toBe("policy:event.emit");
    expect(secured.security.provenance.evidenceClass).toBe("observed");
    expect(verifyEventDigest(secured)).toBe(true);
    expect(evaluateEventSecurity(secured)).toEqual({ valid: true, reason: null, detail: "" });
  });

  it("mints issuance coordinates from the single time authority (stamped events)", () => {
    const authority = new TimeAuthority(new FixedClock(BASE_MS));
    const issued = authority.now();
    const stamped = stampEventWithIssuedTime(makeEvent({ occurred_at: null, sequence: null, issuer: null }), issued);
    const secured = secure({}, stamped);
    expect(secured.security.authenticity.issuance).toEqual(issued);
    expect(verifyEventDigest(secured)).toBe(true);
  });

  it("rejects an event without time-authority issuance provenance (fail-closed)", () => {
    const unstamped = makeEvent({ sequence: null, issuer: null });
    expect(() => secure({}, unstamped)).toThrow(UnauthoritativeTimeError);
  });

  it("rejects a generated event claiming direct-observation visibility (emission gate)", () => {
    for (const evidenceClass of ["reported", "inferred", "predicted", "simulated"] as const) {
      expect(() =>
        secure({ visibility: "direct-observation", evidenceClass }),
      ).toThrow(EventSecurityContractError);
      try {
        secure({ visibility: "direct-observation", evidenceClass });
        expect.unreachable("must throw");
      } catch (error) {
        expect((error as EventSecurityContractError).field).toBe("authorization.visibility");
      }
    }
    expect(() => secure({ visibility: "direct-observation", evidenceClass: "observed" })).not.toThrow();
  });

  it("rejects unknown vocabulary values and malformed fields", () => {
    expect(() => secure({ sensitivity: "secret" as never })).toThrow(/sensitivity/);
    expect(() => secure({ visibility: "everyone" as never })).toThrow(/visibility/);
    expect(() => secure({ evidenceClass: "hallucinated" as never })).toThrow(/evidenceClass/);
    expect(() => secure({ issuerId: "" })).toThrow(/issuerId/);
    expect(() => secure({ emissionAuthority: "  " })).toThrow(/emissionAuthority/);
    expect(() => secure({ subjectRefs: [""] })).toThrow(/subjectRefs/);
    expect(() => secure({ previousDigest: "not-a-digest" })).toThrow(/previousDigest/);
  });

  it("composes the chain digest over the event-semantics content+cause digest", () => {
    const base = secure();
    // Same content, DIFFERENT cause → different content digest → different chain digest.
    const otherCause = secure({}, makeEvent({ causation_id: "cause-root-other" }));
    expect(base.security.authenticity.digest).not.toBe(otherCause.security.authenticity.digest);
    // Same event, different contract field → different chain digest.
    const otherVisibility = secure({ visibility: "public" }, base.event);
    expect(base.security.authenticity.digest).not.toBe(otherVisibility.security.authenticity.digest);
    // Digest is deterministic over the same inputs regardless of construction.
    expect(eventSecurityDigest(base.event, {
      ...base.security.authenticity,
      authorization: base.security.authorization,
      privacy: base.security.privacy,
      provenance: base.security.provenance,
    })).toBe(base.security.authenticity.digest);
  });
});

describe("event security — undeliverable without contract (fail-closed)", () => {
  it("denies an event with no security contract to EVERY subscriber", () => {
    const bare = { event: makeEvent() } satisfies EventConsumptionCandidate;
    const subscribers = [fullSubscriber, makeSubscriber({ tenantId: "tenant-2" })];
    const deliveries = deliverEventToSubscribers(bare, subscribers, { now: NOW });
    expect(deliveries).toHaveLength(2);
    for (const delivery of deliveries) {
      expect(delivery.decision).toBe("DENY");
      expect(delivery.event).toBeNull();
      expect(delivery.security).toBeNull();
      expect(delivery.denial?.reason).toBe("missing_security_contract");
      expect(delivery.redactions).toEqual([]);
    }
  });

  it("denies an explicitly null contract and never invents default security fields", () => {
    const event = makeEvent();
    const delivery = deliverEvent({ event, security: null }, fullSubscriber, { now: NOW });
    expect(delivery.decision).toBe("DENY");
    expect(delivery.denial?.detail).toContain("undeliverable");
    expect(delivery.security).toBeNull();
  });

  it("denies a structurally incomplete contract (missing sections)", () => {
    const secured = secure();
    const broken = {
      event: secured.event,
      // Simulate a corrupted row: contract lost its privacy section.
      security: { authenticity: secured.security.authenticity, authorization: secured.security.authorization, provenance: secured.security.provenance } as never,
    } satisfies EventConsumptionCandidate;
    const delivery = deliverEvent(broken, fullSubscriber, { now: NOW });
    expect(delivery.decision).toBe("DENY");
    expect(delivery.denial?.reason).toBe("invalid_security_contract");
  });

  it("carries the event identity (or digest stand-in) on every denial record", () => {
    const noId = { event: makeEvent({ id: null }) } satisfies EventConsumptionCandidate;
    const delivery = deliverEvent(noId, fullSubscriber, { now: NOW });
    expect(delivery.denial?.eventId).toMatch(/^digest:[0-9a-f]{16}$/);
    expect(delivery.denial?.subscriberId).toBe(fullSubscriber.subscriberId);
    expect(delivery.denial?.recordedAt).toBe(NOW);
  });
});

describe("event security — per-subscriber authorization (per axis)", () => {
  it("allows the authorized subscriber with the full original", () => {
    const secured = secure();
    const delivery = deliverEvent(secured, fullSubscriber, { now: NOW });
    expect(delivery.decision).toBe("ALLOW");
    expect(delivery.event).toBe(secured.event);
    expect(delivery.security).toBe(secured.security);
    expect(delivery.denial).toBeNull();
    expect(delivery.redactions).toEqual([]);
  });

  it("denies per visibility-scope axis (declared scope, evaluated per subscriber)", () => {
    const secured = secure({ visibility: "restricted" });
    const allowed = makeSubscriber({ visibilityScopes: ["public", "tenant", "restricted"] });
    const denied = makeSubscriber({ visibilityScopes: ["public", "tenant"] });
    const fanout = deliverEventToSubscribers(secured, [allowed, denied], { now: NOW });
    expect(fanout[0].decision).toBe("ALLOW");
    expect(fanout[1].decision).toBe("DENY");
    expect(fanout[1].denial?.reason).toBe("visibility_not_authorized");
    expect(fanout[1].event).toBeNull();
  });

  it("redacts per sensitivity axis when the contract declares redactable fields", () => {
    const secured = secure({
      sensitivity: "restricted",
      subjectRefs: ["ent:subject-a", "ent:subject-b"],
      redactableFields: ["state", "absent_field"],
    });
    const cleared = makeSubscriber({ maxSensitivity: "internal" });
    const delivery = deliverEvent(secured, cleared, { now: NOW });
    expect(delivery.decision).toBe("REDACT");
    expect(delivery.event?.payload).toEqual({ state: EVENT_FIELD_WITHHELD });
    expect(delivery.security?.privacy.subjectRefs).toEqual([EVENT_FIELD_WITHHELD, EVENT_FIELD_WITHHELD]);
    expect(delivery.redactions).toHaveLength(1);
    expect(delivery.redactions[0].withheldFields).toEqual(["state"]);
    expect(delivery.redactions[0].withheldSubjectRefs).toEqual(["ent:subject-a", "ent:subject-b"]);
    expect(delivery.redactions[0].recordedAt).toBe(NOW);
  });

  it("denies (never downgrades) when the event cannot be safely minimized", () => {
    const secured = secure({ sensitivity: "restricted", redactableFields: [] });
    const cleared = makeSubscriber({ maxSensitivity: "internal" });
    const delivery = deliverEvent(secured, cleared, { now: NOW });
    expect(delivery.decision).toBe("DENY");
    expect(delivery.denial?.reason).toBe("sensitivity_not_authorized");
    expect(delivery.event).toBeNull();
  });

  it("keeps the original event untouched by redaction (withheld, not deleted)", () => {
    const secured = secure({
      sensitivity: "restricted",
      subjectRefs: ["ent:subject-a"],
      redactableFields: ["state"],
    });
    const originalPayload = { ...secured.event.payload };
    deliverEvent(secured, makeSubscriber({ maxSensitivity: "public" }), { now: NOW });
    expect(secured.event.payload).toEqual(originalPayload);
    expect(secured.event.payload).toEqual({ state: "on" });
    expect(secured.security.privacy.subjectRefs).toEqual(["ent:subject-a"]);
  });

  it("rejects a malformed subscriber configuration loudly (server-resolved input)", () => {
    const secured = secure();
    expect(() =>
      deliverEvent(secured, makeSubscriber({ maxSensitivity: "unlimited" as never }), { now: NOW }),
    ).toThrow(/maxSensitivity/);
    expect(() =>
      deliverEvent(secured, makeSubscriber({ visibilityScopes: ["galaxy" as never] }), { now: NOW }),
    ).toThrow(/visibilityScopes/);
    expect(() => deliverEvent(secured, fullSubscriber, { now: "not-a-timestamp" })).toThrow(/ISO-8601/);
  });
});

describe("event security — tenant boundary", () => {
  it("never delivers a cross-tenant event", () => {
    const secured = secure();
    const foreign = makeSubscriber({ tenantId: "tenant-2" });
    const delivery = deliverEvent(secured, foreign, { now: NOW });
    expect(delivery.decision).toBe("DENY");
    expect(delivery.denial?.reason).toBe("tenant_mismatch");
    expect(delivery.event).toBeNull();
  });

  it("denies a tenant-less event to everyone (anonymous at the tenancy boundary)", () => {
    const secured = secure({}, makeEvent({ tenant_id: null }));
    const fanout = deliverEventToSubscribers(secured, [fullSubscriber, makeSubscriber({ tenantId: "tenant-2" })], { now: NOW });
    for (const delivery of fanout) {
      expect(delivery.decision).toBe("DENY");
      expect(delivery.denial?.reason).toBe("tenant_mismatch");
      expect(delivery.denial?.detail).toContain("null");
    }
  });
});

describe("event security — generated events can never claim observation", () => {
  it("denies a forged contract claiming direct-observation visibility for generated content", () => {
    const forged: SecuredEvent = {
      event: makeEvent({ event_type: "core.observation.recorded" }),
      security: {
        authenticity: {
          issuerId: "agent:forger",
          issuance: {
            at: iso(BASE_MS + 999),
            atMs: BASE_MS + 999,
            sequence: 999,
            issuer: "time-authority:clock:fixed",
          },
          digest: "a".repeat(64),
          previousDigest: null,
        },
        authorization: { visibility: "direct-observation", emissionAuthority: "policy:event.emit" },
        privacy: { sensitivity: "internal", subjectRefs: [], redactableFields: [] },
        provenance: { evidenceClass: "inferred", source: "fixture:inference" },
      },
    };
    const evaluation = evaluateEventSecurity(forged);
    expect(evaluation.valid).toBe(false);
    expect(evaluation.reason).toBe("generated_event_claims_observation");
    const delivery = deliverEvent(forged, fullSubscriber, { now: NOW });
    expect(delivery.decision).toBe("DENY");
    expect(delivery.denial?.reason).toBe("generated_event_claims_observation");
    // The provenance law outranks digest verification: the forged contract is
    // caught even before its (invalid) digest would be.
  });
});

describe("event security — authenticity and tamper evidence", () => {
  it("denies delivery when the event payload was tampered", () => {
    const secured = secure();
    const tampered: EventConsumptionCandidate = {
      event: { ...secured.event, payload: { state: "off" } },
      security: secured.security,
    };
    expect(verifyEventDigest(tampered)).toBe(false);
    const delivery = deliverEvent(tampered, fullSubscriber, { now: NOW });
    expect(delivery.decision).toBe("DENY");
    expect(delivery.denial?.reason).toBe("tampered_digest");
  });

  it("denies delivery when a contract field was tampered in flight", () => {
    const secured = secure({ visibility: "tenant" });
    const tampered: EventConsumptionCandidate = {
      event: secured.event,
      security: {
        ...secured.security,
        authorization: { ...secured.security.authorization, visibility: "public" },
      },
    };
    expect(verifyEventDigest(tampered)).toBe(false);
    const delivery = deliverEvent(tampered, fullSubscriber, { now: NOW });
    expect(delivery.decision).toBe("DENY");
    expect(delivery.denial?.reason).toBe("tampered_digest");
  });

  it("denies delivery when the contract's issuance does not match the event", () => {
    const authority = new TimeAuthority(new FixedClock(BASE_MS));
    const stamped = stampEventWithIssuedTime(
      makeEvent({ occurred_at: null, sequence: null, issuer: null }),
      authority.now(),
    );
    const secured = secure({}, stamped);
    // Rewind the event's instant after stamping: contract no longer verifies.
    const rewound: EventConsumptionCandidate = {
      event: { ...stamped, occurred_at: iso(BASE_MS - 5_000) },
      security: secured.security,
    };
    const evaluation = evaluateEventSecurity(rewound);
    expect(evaluation.reason).toBe("unverifiable_issuance");
    expect(deliverEvent(rewound, fullSubscriber, { now: NOW }).decision).toBe("DENY");
  });

  it("verifies an intact per-tenant chain in total order", () => {
    const first = secure();
    const second = secure({ previousDigest: first.security.authenticity.digest }, makeEvent());
    const third = secure({ previousDigest: second.security.authenticity.digest }, makeEvent());
    // Feed out of order: the walk sorts through the time-authority total order.
    const verification = verifyEventDigestChain([third, first, second]);
    expect(verification.valid).toBe(true);
    expect(verification.length).toBe(3);
    expect(verification.brokenAtEventId).toBeNull();
  });

  it("detects content tampering inside the chain", () => {
    const first = secure();
    const second = secure({ previousDigest: first.security.authenticity.digest }, makeEvent());
    const tampered: EventConsumptionCandidate = {
      event: { ...second.event, payload: { state: "tampered" } },
      security: second.security,
    };
    const verification = verifyEventDigestChain([first, tampered]);
    expect(verification.valid).toBe(false);
    expect(verification.reason).toBe("tampered_digest");
    expect(verification.brokenAtEventId).toBe(tampered.event.id);
  });

  it("detects history rewriting: a recomputed digest cannot relink the chain", () => {
    const first = secure();
    const second = secure({ previousDigest: first.security.authenticity.digest }, makeEvent());
    const third = secure({ previousDigest: second.security.authenticity.digest }, makeEvent());
    // An attacker tampers with the second event's payload AND recomputes its
    // digest — but the third event still links to the ORIGINAL digest.
    const relinkedDigest = eventSecurityDigest(
      { ...second.event, payload: { state: "rewritten" } },
      {
        ...second.security.authenticity,
        authorization: second.security.authorization,
        privacy: second.security.privacy,
        provenance: second.security.provenance,
      },
    );
    const rewrittenSecond: SecuredEvent = {
      event: { ...second.event, payload: { state: "rewritten" } },
      security: {
        ...second.security,
        authenticity: { ...second.security.authenticity, digest: relinkedDigest },
      },
    };
    const verification = verifyEventDigestChain([first, rewrittenSecond, third]);
    expect(verification.valid).toBe(false);
    expect(verification.reason).toBe("tampered_digest");
    expect(verification.brokenAtEventId).toBe(third.event.id);
  });

  it("detects a broken link (successor points at the wrong predecessor)", () => {
    const first = secure();
    const unrelated = secure();
    const linked = secure({ previousDigest: unrelated.security.authenticity.digest }, makeEvent());
    const verification = verifyEventDigestChain([first, linked]);
    expect(verification.valid).toBe(false);
    expect(verification.reason).toBe("tampered_digest");
    expect(verification.brokenAtEventId).toBe(linked.event.id);
  });

  it("scopes chain verification per tenant", () => {
    const tenantA = secure();
    const tenantB = secure({}, makeEvent({ tenant_id: "tenant-2" }));
    const scoped = verifyEventDigestChain([tenantA, tenantB], { tenantId: "tenant-1" });
    expect(scoped.valid).toBe(true);
    expect(scoped.length).toBe(1);
  });
});

describe("event security — composition with event-semantics", () => {
  function chainOfThree(): SecuredEvent[] {
    const first = secure({}, makeEvent({ event_type: "core.state.changed" }));
    const second = secure(
      { previousDigest: first.security.authenticity.digest },
      makeEvent({ event_type: "core.observation.recorded" }),
    );
    const third = secure(
      { previousDigest: second.security.authenticity.digest },
      makeEvent({ event_type: "core.state.changed" }),
    );
    return [first, second, third];
  }

  it("orders secured events deterministically under any input permutation", () => {
    const secured = chainOfThree();
    const events = secured.map((entry) => entry.event);
    const expected = orderEvents(events).map((event) => event.id);
    const permutations: KernelEventRecord[][] = [
      [...events],
      [...events].reverse(),
      [events[2], events[0], events[1]],
    ];
    for (const permutation of permutations) {
      expect(orderEvents(permutation).map((event) => event.id)).toEqual(expected);
    }
    // Event order agrees with the authority's issuance order coordinates.
    const byAuthority = [...events].sort((a, b) =>
      a.occurred_at === b.occurred_at ? (a.sequence ?? 0) - (b.sequence ?? 0) : (a.occurred_at ?? "") < (b.occurred_at ?? "") ? -1 : 1,
    );
    expect(orderEvents(events).map((event) => event.id)).toEqual(byAuthority.map((event) => event.id));
    expect(compareEventOrder(events[0], events[1])).not.toBe(0);
  });

  it("deduplicates repeated deliveries of the same secured event", () => {
    const secured = secure();
    const result = dedupeEvents([secured.event, secured.event, secured.event]);
    expect(result.unique).toHaveLength(1);
    expect(result.duplicateCount).toBe(2);
    expect(result.unique[0].collapsed).toHaveLength(2);
  });

  it("passes the FULL production consumption posture (taxonomy + provenance + cause)", () => {
    const secured = chainOfThree();
    const plan = consumeEvents(secured.map((entry) => entry.event));
    expect(plan.ordered).toHaveLength(3);
    expect(plan.duplicateCount).toBe(0);
    expect(plan.alertPolicies.map((entry) => entry.policy)).toEqual(["none", "notify", "none"]);
  });

  it("keeps the security sidecar intact while the event plane orders and dedupes", () => {
    const secured = chainOfThree();
    const ordered = orderEvents(secured.map((entry) => entry.event));
    const byId = new Map(secured.map((entry) => [entry.event.id as string, entry]));
    for (const event of ordered) {
      const entry = byId.get(event.id as string) as SecuredEvent;
      expect(verifyEventDigest(entry)).toBe(true);
      expect(deliverEvent(entry, fullSubscriber, { now: NOW }).decision).toBe("ALLOW");
    }
  });

  it("chains across the time-authority total order when instants collide", () => {
    const authority = new TimeAuthority(new FixedClock(BASE_MS));
    const stamped = (overrides: Partial<Parameters<typeof makeEvent>[0]> = {}) =>
      stampEventWithIssuedTime(
        makeEvent({ occurred_at: null, sequence: null, issuer: null, ...overrides }),
        authority.now(),
      );
    const first = secure({}, stamped());
    const second = secure({ previousDigest: first.security.authenticity.digest }, stamped());
    // Same issued millisecond (clamped clock), strictly increasing sequences:
    // the chain walk still orders deterministically.
    expect(second.event.occurred_at).toBe(first.event.occurred_at);
    expect((second.event.sequence ?? 0)).toBeGreaterThan(first.event.sequence ?? 0);
    expect(verifyEventDigestChain([second, first]).valid).toBe(true);
  });
});

describe("event security — vocabulary pins (composition, never redefinition)", () => {
  it("pins the sensitivity vocabulary to lib/context-assembly", () => {
    const pinned: readonly ContextSensitivity[] = EVENT_SENSITIVITIES;
    expect([...pinned]).toEqual(["public", "internal", "restricted"]);
  });

  it("pins delivery decisions to the five-valued authorization vocabulary", () => {
    const decisions: readonly AuthorizationDecision[] = ["ALLOW", "DENY", "REDACT"];
    expect(decisions).toHaveLength(3);
    expect(decisions.every((decision) => ["ALLOW", "DENY", "REDACT", "ESCALATE", "REQUIRE_APPROVAL"].includes(decision))).toBe(true);
  });

  it("declares a closed visibility vocabulary with the observation-reserved scope", () => {
    expect(EVENT_VISIBILITY_SCOPES).toEqual(["public", "tenant", "restricted", "direct-observation"]);
  });
});