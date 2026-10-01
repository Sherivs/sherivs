/**
 * CoreGrid — Canonical kernel object type registry (V1CAP-003, MISSION-R-11).
 *
 * Proves, at unit level, that:
 *  1. the registry contract is domain-neutral — registration is by domainRef,
 *     types come from the domain's own declared vocabulary (never invented);
 *  2. the kernel's own substrate object types are the fail-closed bootstrap
 *     floor, registered through the same public gate ("kernel:core");
 *  3. both real domains — the Scholar runtime and the restaurant fixture —
 *     register their ACTUAL object type vocabularies and pass the gate
 *     end-to-end through envelope validation and the kernel write API;
 *  4. an UNREGISTERED object_type is rejected at the write API with a typed
 *     error (seeded-rejection proof, deterministic);
 *  5. deregistration closes a domain's vocabulary immediately, and a registry
 *     stripped to zero registrations rejects EVERY object type (fail-closed
 *     bootstrap posture preserved at the write API).
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  KERNEL_CORE_DOMAIN_REF,
  KERNEL_CORE_OBJECT_TYPES,
  KernelObjectTypeRejectedError,
  canonicalKernelObjectTypes,
  deregisterKernelObjectTypes,
  isRegisteredKernelObjectType,
  kernelObjectTypeOwner,
  registerKernelObjectTypes,
  registeredKernelObjectDomains,
  registeredKernelObjectTypesFor,
} from "@/lib/kernel/object-type-registry";
import {
  ENVELOPE_SCHEMA_VERSION,
  entityDraft,
  eventDraft,
  validateKernelObjectEnvelope,
  validateKernelRowEnvelope,
  type KernelObjectEnvelopeInput,
} from "@/lib/kernel/reality";
import { SCHOLAR_ENTITY_TYPES } from "@/lib/runtime/scholar-reality";
import {
  RESTAURANT_DOMAIN_DEFINITION,
  RESTAURANT_DOMAIN_ID,
} from "@/lib/domain-config/restaurant";

const SCHOLAR_DOMAIN_REF = "runtime:scholar";
const RESTAURANT_FIXTURE_REF = "fixture:restaurant";

/** The restaurant fixture's ACTUAL object type vocabulary (never invented). */
const RESTAURANT_OBJECT_TYPES: readonly string[] =
  RESTAURANT_DOMAIN_DEFINITION.entityTypes.map((entityType) => entityType.name);

const NOW = "2026-10-02T00:00:00.000Z";

function envelopeOf(
  objectType: string,
  overrides: Partial<KernelObjectEnvelopeInput> = {},
): KernelObjectEnvelopeInput {
  return {
    objectType,
    schemaVersion: ENVELOPE_SCHEMA_VERSION,
    status: "active",
    createdBy: "identity:engineer-1",
    updatedBy: "identity:engineer-1",
    provenance: { source: "kernel:test", originTenantId: "tenant-1" },
    policyContext: { policy: "core.data.internal" },
    traceId: "trace-r11",
    correlationId: "corr-r11",
    declaredOrigin: "kernel:test:object-type-registry",
    ...overrides,
  };
}

/** Deterministic seed: bootstrap floor + both real domains, via the public API. */
function seedRegistry(): void {
  for (const domainRef of registeredKernelObjectDomains()) {
    deregisterKernelObjectTypes(domainRef);
  }
  registerKernelObjectTypes(KERNEL_CORE_DOMAIN_REF, KERNEL_CORE_OBJECT_TYPES);
  registerKernelObjectTypes(SCHOLAR_DOMAIN_REF, SCHOLAR_ENTITY_TYPES);
  registerKernelObjectTypes(RESTAURANT_FIXTURE_REF, RESTAURANT_OBJECT_TYPES);
}

beforeEach(seedRegistry);

afterAll(() => {
  // Leave the module at its natural fail-closed bootstrap floor.
  for (const domainRef of registeredKernelObjectDomains()) {
    deregisterKernelObjectTypes(domainRef);
  }
  registerKernelObjectTypes(KERNEL_CORE_DOMAIN_REF, KERNEL_CORE_OBJECT_TYPES);
});

describe("kernel object type registry — fail-closed bootstrap floor", () => {
  it("registers the kernel substrate object types through the same public gate", () => {
    expect(kernelObjectTypeOwner("core.entity")).toBe(KERNEL_CORE_DOMAIN_REF);
    expect(kernelObjectTypeOwner("core.relationship")).toBe(KERNEL_CORE_DOMAIN_REF);
    expect(kernelObjectTypeOwner("core.event")).toBe(KERNEL_CORE_DOMAIN_REF);
    expect(kernelObjectTypeOwner("core.observation")).toBe(KERNEL_CORE_DOMAIN_REF);
    expect(registeredKernelObjectTypesFor(KERNEL_CORE_DOMAIN_REF)).toEqual([
      "core.entity",
      "core.relationship",
      "core.event",
      "core.observation",
    ]);
  });

  it("rejects malformed registrations and duplicate cross-domain ownership", () => {
    expect(() => registerKernelObjectTypes("scholar", ["learner"])).toThrow(/domainRef/);
    expect(() => registerKernelObjectTypes(SCHOLAR_DOMAIN_REF, ["   "])).toThrow(/1–128/);
    expect(() => registerKernelObjectTypes(SCHOLAR_DOMAIN_REF, [42 as never])).toThrow(
      /non-string object type/,
    );
    expect(() => registerKernelObjectTypes("fixture:imposter", ["learner"])).toThrow(
      /already owned by "runtime:scholar"/,
    );
    // Fail-closed: none of the rejected attempts mutated the allowlist.
    expect(kernelObjectTypeOwner("learner")).toBe(SCHOLAR_DOMAIN_REF);
    expect(isRegisteredKernelObjectType("learner")).toBe(true);
  });

  it("re-registration by the owning domain is an idempotent refresh", () => {
    registerKernelObjectTypes(SCHOLAR_DOMAIN_REF, ["learner", "program"]);
    expect(kernelObjectTypeOwner("learner")).toBe(SCHOLAR_DOMAIN_REF);
    expect(registeredKernelObjectTypesFor(SCHOLAR_DOMAIN_REF)).toEqual(["learner", "program"]);
  });
});

describe("kernel object type registry — both real domains registered", () => {
  it("registers the Scholar runtime's ACTUAL ontology object types", () => {
    expect(SCHOLAR_ENTITY_TYPES.length).toBeGreaterThan(0);
    for (const objectType of SCHOLAR_ENTITY_TYPES) {
      expect(isRegisteredKernelObjectType(objectType)).toBe(true);
      expect(kernelObjectTypeOwner(objectType)).toBe(SCHOLAR_DOMAIN_REF);
    }
    expect(SCHOLAR_ENTITY_TYPES).toContain("learner");
    expect(SCHOLAR_ENTITY_TYPES).toContain("institution");
  });

  it("registers the restaurant fixture's ACTUAL entity type vocabulary", () => {
    expect(RESTAURANT_DOMAIN_ID).toBe("restaurant");
    expect(RESTAURANT_OBJECT_TYPES).toContain("restaurant.menu_item");
    expect(RESTAURANT_OBJECT_TYPES).toContain("restaurant.order");
    for (const objectType of RESTAURANT_OBJECT_TYPES) {
      expect(isRegisteredKernelObjectType(objectType)).toBe(true);
      expect(kernelObjectTypeOwner(objectType)).toBe(RESTAURANT_FIXTURE_REF);
    }
  });

  it("registers object types only — relation vocabulary stays on relation_type", () => {
    // Relationship names are NOT object types; the allowlist governs
    // object identity, relation identity has its own substrate column.
    expect(isRegisteredKernelObjectType("operates")).toBe(false);
    expect(isRegisteredKernelObjectType("enrolls")).toBe(false);
    expect(isRegisteredKernelObjectType("restaurant.order_for")).toBe(false);
  });

  it("exposes the canonical allowlist as the sorted union of all domains", () => {
    expect(canonicalKernelObjectTypes()).toEqual(
      [
        ...KERNEL_CORE_OBJECT_TYPES,
        ...RESTAURANT_OBJECT_TYPES,
        ...SCHOLAR_ENTITY_TYPES,
      ].slice().sort(),
    );
    expect(registeredKernelObjectDomains()).toEqual([
      RESTAURANT_FIXTURE_REF,
      KERNEL_CORE_DOMAIN_REF,
      SCHOLAR_DOMAIN_REF,
    ]);
  });
});

describe("kernel object type registry — end-to-end through the write API", () => {
  it("writes Scholar objects through envelope + type gate end-to-end", () => {
    for (const objectType of SCHOLAR_ENTITY_TYPES) {
      const draft = entityDraft(
        { entityType: "person", tenantId: "tenant-1", envelope: envelopeOf(objectType) },
        NOW,
      );
      const row: Record<string, unknown> = { id: `entity-${objectType}`, ...draft };
      expect(() => validateKernelRowEnvelope(row, canonicalKernelObjectTypes())).not.toThrow();
    }
  });

  it("writes restaurant fixture objects through envelope + type gate end-to-end", () => {
    for (const objectType of RESTAURANT_OBJECT_TYPES) {
      const draft = entityDraft(
        { entityType: "menu_item", tenantId: "tenant-1", envelope: envelopeOf(objectType) },
        NOW,
      );
      const row: Record<string, unknown> = { id: `entity-${objectType}`, ...draft };
      expect(() => validateKernelRowEnvelope(row, canonicalKernelObjectTypes())).not.toThrow();
    }
  });

  it("gates every kernel draft builder through the live registry", () => {
    const stamped = eventDraft(
      {
        eventType: "created",
        aggregateType: "entity",
        aggregateId: "entity-1",
        tenantId: "tenant-1",
        envelope: envelopeOf("core.event", { causationId: "cause-1" }),
      },
      NOW,
    );
    expect(stamped).toHaveProperty("object_type", "core.event");
    const row: Record<string, unknown> = { id: "event-1", ...stamped };
    expect(() => validateKernelRowEnvelope(row, canonicalKernelObjectTypes())).not.toThrow();
  });

  it("keeps the explicit-allowlist contract of the envelope API intact", () => {
    // Registered live, rejected under an explicit allowlist that omits it —
    // the MISSION-R-10 injection point semantics are unchanged.
    expect(() =>
      validateKernelObjectEnvelope(envelopeOf("learner"), KERNEL_CORE_OBJECT_TYPES),
    ).toThrow(/not registered/);
    expect(() =>
      validateKernelObjectEnvelope(envelopeOf("learner"), canonicalKernelObjectTypes()),
    ).not.toThrow();
  });
});

describe("kernel object type registry — seeded rejection at the write API", () => {
  it("rejects a seeded unregistered type with the typed error, deterministically", () => {
    const seededUnknownTypes = ["restaurant.ghost_order", "scholar.phantom_learner"];
    for (const objectType of seededUnknownTypes) {
      expect(isRegisteredKernelObjectType(objectType)).toBe(false);
      // The write API rejects before any row exists.
      expect(() =>
        entityDraft(
          { entityType: "person", tenantId: "tenant-1", envelope: envelopeOf(objectType) },
          NOW,
        ),
      ).toThrow(KernelObjectTypeRejectedError);
      try {
        entityDraft(
          { entityType: "person", tenantId: "tenant-1", envelope: envelopeOf(objectType) },
          NOW,
        );
        expect.unreachable(`${objectType} must not pass the kernel write API`);
      } catch (error) {
        expect(error).toBeInstanceOf(KernelObjectTypeRejectedError);
        expect((error as KernelObjectTypeRejectedError).objectType).toBe(objectType);
        expect((error as Error).message).toMatch(new RegExp(`"${objectType}" is not registered`));
      }
      // The same rejection through the envelope validation injection point.
      expect(() =>
        validateKernelObjectEnvelope(envelopeOf(objectType), canonicalKernelObjectTypes()),
      ).toThrow(/is not registered/);
    }
  });
});

describe("kernel object type registry — deregistration / empty registry fail closed", () => {
  it("closes a deregistered domain's vocabulary at the write API immediately", () => {
    expect(deregisterKernelObjectTypes(RESTAURANT_FIXTURE_REF)).toBe(true);
    expect(isRegisteredKernelObjectType("restaurant.menu_item")).toBe(false);
    expect(() =>
      entityDraft(
        {
          entityType: "menu_item",
          tenantId: "tenant-1",
          envelope: envelopeOf("restaurant.menu_item"),
        },
        NOW,
      ),
    ).toThrow(KernelObjectTypeRejectedError);
    // Other domains are untouched.
    expect(() =>
      entityDraft(
        { entityType: "person", tenantId: "tenant-1", envelope: envelopeOf("learner") },
        NOW,
      ),
    ).not.toThrow();
    // Re-registration reopens the vocabulary through the same gate.
    registerKernelObjectTypes(RESTAURANT_FIXTURE_REF, RESTAURANT_OBJECT_TYPES);
    expect(() =>
      entityDraft(
        {
          entityType: "menu_item",
          tenantId: "tenant-1",
          envelope: envelopeOf("restaurant.menu_item"),
        },
        NOW,
      ),
    ).not.toThrow();
  });

  it("rejects EVERY object type when the registry is empty (fail-closed bootstrap)", () => {
    for (const domainRef of registeredKernelObjectDomains()) {
      deregisterKernelObjectTypes(domainRef);
    }
    expect(canonicalKernelObjectTypes()).toEqual([]);
    for (const objectType of ["core.entity", "learner", "restaurant.menu_item"]) {
      expect(() =>
        entityDraft(
          { entityType: "person", tenantId: "tenant-1", envelope: envelopeOf(objectType) },
          NOW,
        ),
      ).toThrow(KernelObjectTypeRejectedError);
    }
    // Deregistering an unknown domain is a no-op, never a silent success.
    expect(deregisterKernelObjectTypes("fixture:never-registered")).toBe(false);
  });
});
