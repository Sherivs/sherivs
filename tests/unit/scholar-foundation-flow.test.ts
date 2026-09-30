import { describe, expect, it } from "vitest";
import {
  assertScholarEventForEntity,
  assertScholarRelationshipVocabulary,
  buildScholarFoundationEntity,
  buildScholarFoundationEvent,
  buildScholarFoundationRelationship,
  SCHOLAR_FOUNDATION_ACTION,
  SCHOLAR_FOUNDATION_ENTITY_TYPES,
  SCHOLAR_FOUNDATION_MISSION_ID,
  SCHOLAR_FOUNDATION_RELATIONSHIP_TYPES,
  scholarFoundationRequest,
} from "@/lib/runtime/scholar-foundation-flow";
import { SCHOLAR_RUNTIME_ID } from "@/lib/runtime/scholar-consumption";

const NOW = "2026-09-30T06:00:00.000Z";

describe("scholar foundation flow — ontology boundary", () => {
  it("declares Scholar ontology entity types including learner", () => {
    expect(SCHOLAR_FOUNDATION_ENTITY_TYPES).toContain("learner");
    expect(SCHOLAR_FOUNDATION_ENTITY_TYPES).toContain("institution");
  });

  it("builds an insert-ready row through the universal kernel contract", () => {
    const row = buildScholarFoundationEntity(
      { entityType: "learner", state: "enrolled", attributes: { probe: true } },
      "school-1",
      NOW,
    );
    expect(row.entity_type).toBe("learner");
    expect(row.tenant_id).toBe("school-1");
    expect(row.classification).toBe("INTERNAL");
    expect(row.source_type).toBe(`cg:${SCHOLAR_RUNTIME_ID}:foundation-validation`);
    expect(row.recorded_at).toBe(NOW);
  });

  it("rejects entity types outside the declared Scholar ontology", () => {
    expect(() =>
      buildScholarFoundationEntity({ entityType: "restaurant" }, "school-1", NOW),
    ).toThrow(/not declared in the Scholar ontology/);
  });

  it("keeps the governed mission envelope bounded", () => {
    const request = scholarFoundationRequest({
      executionId: "exec-1",
      idempotencyKey: "idem-12345678",
      requestedAt: NOW,
    });
    expect(request.missionId).toBe(SCHOLAR_FOUNDATION_MISSION_ID);
    expect(request.action).toBe(SCHOLAR_FOUNDATION_ACTION);
    expect(request.ownerRef).toContain(SCHOLAR_RUNTIME_ID);
    expect(request.authorityRef).toBe("CONTROL-PLANE-06");
  });
});

describe("scholar foundation flow — governed relationship vocabulary", () => {
  it("declares the handoff-authorized relationship subset", () => {
    expect(SCHOLAR_FOUNDATION_RELATIONSHIP_TYPES).toEqual(["enrolls", "teaches"]);
  });

  it("builds an insert-ready cg_relationship row through the runtime boundary", () => {
    const row = buildScholarFoundationRelationship(
      {
        relationType: "enrolls",
        sourceEntityId: "11111111-1111-1111-1111-111111111111",
        targetEntityId: "22222222-2222-2222-2222-222222222222",
        attributes: { probe: true },
      },
      "school-1",
      NOW,
    );
    expect(row.relation_type).toBe("enrolls");
    expect(row.source_entity_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(row.target_entity_id).toBe("22222222-2222-2222-2222-222222222222");
    expect(row.tenant_id).toBe("school-1");
    expect(row.source_ref).toBe(`cg:${SCHOLAR_RUNTIME_ID}:foundation-validation`);
    expect(row.recorded_at).toBe(NOW);
  });

  it("rejects relations outside the Scholar ontology", () => {
    expect(() =>
      assertScholarRelationshipVocabulary("married", "learner", "learning_group"),
    ).toThrow(/not declared in the Scholar ontology/);
  });

  it("rejects edges whose endpoints violate the declared source/target types", () => {
    expect(() =>
      assertScholarRelationshipVocabulary("enrolls", "institution", "learning_group"),
    ).toThrow(/does not accept source entity type "institution"/);
    expect(() => assertScholarRelationshipVocabulary("enrolls", "learner", "campus")).toThrow(
      /does not accept target entity type "campus"/,
    );
    expect(() =>
      assertScholarRelationshipVocabulary("teaches", "educator", "learning_group"),
    ).not.toThrow();
  });
});

describe("scholar foundation flow — governed event vocabulary", () => {
  it("builds an insert-ready cg_event row through the Scholar event contract", () => {
    const row = buildScholarFoundationEvent(
      {
        eventType: "learner.enrolled",
        aggregateId: "33333333-3333-3333-3333-333333333333",
        actorIdentity: "user-1",
        correlationId: "exec-1",
        idempotencyKey: "scholar-foundation-validation:idem-12345678",
      },
      "school-1",
      NOW,
    );
    expect(row.event_type).toBe("learner.enrolled");
    expect(row.aggregate_type).toBe("learner");
    expect(row.aggregate_id).toBe("33333333-3333-3333-3333-333333333333");
    expect(row.tenant_id).toBe("school-1");
    expect(row.actor_identity).toBe("user-1");
    expect(row.state).toBe("pending");
    expect(row.payload_version).toBe(1);
  });

  it("rejects an event whose aggregate does not match the created entity", () => {
    expect(() => assertScholarEventForEntity("learner.enrolled", "learner")).not.toThrow();
    expect(() => assertScholarEventForEntity("learner.enrolled", "institution")).toThrow(
      /aggregates on "learner", not the created entity type "institution"/,
    );
    expect(() => assertScholarEventForEntity("educator.assigned", "educator")).not.toThrow();
  });
});
