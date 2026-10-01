/**
 * CoreGrid — Phase 33 Universal Reality Kernel: reality contract tests.
 *
 * Two layers of verification:
 *  1. SQL coherence — every enumerated value exported by the typed contracts
 *     must exist verbatim in the kernel substrate migration's CHECK clauses
 *     (database is the source of truth).
 *  2. Contract behaviour — draft builders and guards reject values the
 *     database would reject and normalise values the database accepts.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  areDistinctEntityIds,
  DATA_CLASSIFICATIONS,
  entityDraft,
  EVENT_DELIVERY_STATES,
  eventDraft,
  isConfidence,
  isDataClassification,
  isEntityType,
  isEventDeliveryState,
  isObservationKind,
  isPayloadObject,
  isRelationType,
  OBSERVATION_KINDS,
  observationDraft,
  relationshipDraft,
} from "@/lib/kernel/reality";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATION = readFileSync(
  join(ROOT, "database/supabase/migrations/20260903000000_coregrid_universal_kernel_substrate.sql"),
  "utf8",
);
const NOW = "2026-09-03T00:00:00.000Z";

describe("kernel reality contracts ↔ SQL coherence", () => {
  it("registers every classification value present in the migration CHECK clause", () => {
    for (const value of DATA_CLASSIFICATIONS) {
      expect(MIGRATION).toContain(`'${value}'`);
    }
  });

  it("registers every observation kind present in the migration CHECK clause", () => {
    for (const value of OBSERVATION_KINDS) {
      expect(MIGRATION).toContain(`'${value}'`);
    }
  });

  it("registers every event delivery state present in the migration CHECK clause", () => {
    for (const value of EVENT_DELIVERY_STATES) {
      expect(MIGRATION).toContain(`'${value}'`);
    }
  });

  it("mirrors the relationship constraints (distinct ids, typed length)", () => {
    expect(MIGRATION).toContain("source_entity_id <> target_entity_id");
    expect(MIGRATION).toContain("length(relation_type) BETWEEN 1 AND 128");
  });
});

describe("kernel reality contracts — guards", () => {
  it("accepts only registered classifications, kinds, and states", () => {
    expect(isDataClassification("INTERNAL")).toBe(true);
    expect(isDataClassification("LEGACY")).toBe(false);
    expect(isObservationKind("inferred")).toBe(true);
    expect(isObservationKind("verified")).toBe(false);
    expect(isEventDeliveryState("dead")).toBe(true);
    expect(isEventDeliveryState("queued")).toBe(false);
  });

  it("bounds confidence to [0, 1]", () => {
    expect(isConfidence(0)).toBe(true);
    expect(isConfidence(1)).toBe(true);
    expect(isConfidence(-0.01)).toBe(false);
    expect(isConfidence(1.01)).toBe(false);
    expect(isConfidence(Number.NaN)).toBe(false);
  });

  it("enforces entity_type length 1–128 and rejects blank values", () => {
    expect(isEntityType("person")).toBe(true);
    expect(isEntityType("x".repeat(128))).toBe(true);
    expect(isEntityType("x".repeat(129))).toBe(false);
    expect(isEntityType("   ")).toBe(false);
    expect(isEntityType("")).toBe(false);
  });

  it("requires payloads to be plain objects", () => {
    expect(isPayloadObject({})).toBe(true);
    expect(isPayloadObject({ a: 1 })).toBe(true);
    expect(isPayloadObject([])).toBe(false);
    expect(isPayloadObject(null)).toBe(false);
    expect(isPayloadObject("x")).toBe(false);
  });

  it("rejects self-relationships", () => {
    expect(areDistinctEntityIds("a", "b")).toBe(true);
    expect(areDistinctEntityIds("a", "a")).toBe(false);
  });
});

describe("kernel reality contracts — draft builders", () => {
  it("builds a valid entity draft with defaults", () => {
    const draft = entityDraft({ entityType: "person", tenantId: "tenant-1" }, NOW);
    expect(draft.entity_type).toBe("person");
    expect(draft.tenant_id).toBe("tenant-1");
    expect(draft.classification).toBe("INTERNAL");
    expect(draft.recorded_at).toBe(NOW);
    expect(draft.attributes).toEqual({});
  });

  it("trims entity_type and tenant scope", () => {
    const draft = entityDraft({ entityType: "  person  ", tenantId: "  tenant-2  " }, NOW);
    expect(draft.entity_type).toBe("person");
    expect(draft.tenant_id).toBe("tenant-2");
  });

  it("rejects invalid entity drafts the database would reject", () => {
    expect(() => entityDraft({ entityType: "" }, NOW)).toThrow(/entity_type/);
    expect(() =>
      entityDraft({ entityType: "person", classification: "LEGACY" as never }, NOW),
    ).toThrow(/classification/);
    expect(() => entityDraft({ entityType: "person", confidence: 1.5 }, NOW)).toThrow(/confidence/);
  });

  it("builds a versioned event draft with pending delivery state", () => {
    const draft = eventDraft(
      {
        eventType: "created",
        aggregateType: "entity",
        aggregateId: "entity-1",
        idempotencyKey: "key-1",
        tenantId: "tenant-1",
      },
      NOW,
    );
    expect(draft.state).toBe("pending");
    expect(draft.payload_version).toBe(1);
    expect(draft.attempts).toBe(0);
    expect(draft.idempotency_key).toBe("key-1");
    expect(draft.recorded_at).toBe(NOW);
  });

  it("rejects invalid event drafts the database would reject", () => {
    expect(() =>
      eventDraft({ eventType: "", aggregateType: "entity", aggregateId: "1" }, NOW),
    ).toThrow(/event_type/);
    expect(() => eventDraft({ eventType: "e", aggregateType: "", aggregateId: "1" }, NOW)).toThrow(
      /aggregate_type/,
    );
    expect(() =>
      eventDraft({ eventType: "e", aggregateType: "entity", aggregateId: "" }, NOW),
    ).toThrow(/aggregate_id/);
  });

  it("builds a truth-hierarchy observation draft with no collapsed kind", () => {
    const draft = observationDraft(
      { subjectEntityId: "entity-1", kind: "observed", confidence: 0.9 },
      NOW,
    );
    expect(draft.kind).toBe("observed");
    expect(draft.statement).toEqual({});
    expect(draft.evidence_entity_ids).toEqual([]);
    expect(draft.recorded_at).toBe(NOW);
  });

  it("rejects invalid observation drafts", () => {
    expect(() => observationDraft({ subjectEntityId: "", kind: "observed" }, NOW)).toThrow(
      /subject_entity_id/,
    );
    expect(() =>
      observationDraft({ subjectEntityId: "e", kind: "verified" as never }, NOW),
    ).toThrow(/kind/);
  });
});

describe("kernel reality contracts — envelope posture (MISSION-R-10)", () => {
  it("leaves unstamped drafts envelope-absent, never half-stamped", () => {
    // Legacy posture: drafts without an envelope carry NO envelope columns.
    // The envelope migration's atomic CHECK rejects half-stamped rows at the
    // database boundary; `kernel-envelope.test.ts` proves the stamped path.
    const draft = entityDraft({ entityType: "person", tenantId: "tenant-1" }, NOW);
    expect("object_type" in draft).toBe(false);
    expect("trace_id" in draft).toBe(false);
  });
});

describe("kernel reality contracts — relationship draft", () => {
  it("enforces 1–128 relation_type and trims values", () => {
    expect(isRelationType("teaches")).toBe(true);
    expect(isRelationType("x".repeat(128))).toBe(true);
    expect(isRelationType("x".repeat(129))).toBe(false);
    expect(isRelationType("   ")).toBe(false);
  });

  it("builds a valid relationship draft between distinct entities", () => {
    const draft = relationshipDraft(
      {
        sourceEntityId: "entity-a",
        targetEntityId: "entity-b",
        relationType: "related-to",
        tenantId: "  tenant-1  ",
      },
      NOW,
    );
    expect(draft.source_entity_id).toBe("entity-a");
    expect(draft.target_entity_id).toBe("entity-b");
    expect(draft.relation_type).toBe("related-to");
    expect(draft.tenant_id).toBe("tenant-1");
    expect(draft.recorded_at).toBe(NOW);
    expect(draft.attributes).toEqual({});
  });

  it("rejects self-relationships the database would reject", () => {
    expect(() =>
      relationshipDraft(
        { sourceEntityId: "entity-a", targetEntityId: "entity-a", relationType: "self" },
        NOW,
      ),
    ).toThrow(/must differ/);
  });

  it("rejects missing entity ids and invalid relation types", () => {
    expect(() =>
      relationshipDraft({ sourceEntityId: "", targetEntityId: "entity-b", relationType: "r" }, NOW),
    ).toThrow(/required/);
    expect(() =>
      relationshipDraft(
        { sourceEntityId: "entity-a", targetEntityId: "entity-b", relationType: "   " },
        NOW,
      ),
    ).toThrow(/relation_type/);
  });

  it("rejects invalid confidence on relationships", () => {
    expect(() =>
      relationshipDraft(
        {
          sourceEntityId: "entity-a",
          targetEntityId: "entity-b",
          relationType: "r",
          confidence: 2,
        },
        NOW,
      ),
    ).toThrow(/confidence/);
  });
});
