/**
 * CoreGrid Scholar — Phase 16 Digital Twin Platform unit tests
 * (twin-core).
 *
 * Validates:
 * - Reality model boundary (F): representation is never confused with
 *   reality.
 * - Twin identity (G) and instance creation (K, AY): stable identity,
 *   creation sources.
 * - Lifecycle (AX-BC): legal/illegal transitions, controlled deletion.
 * - Type registry (I), templates (J) and composition (L).
 * - Merge (AZ) and split (BA): authorization, provenance, rollback
 *   surface.
 * - Lineage (AS/AT): provenance chains must be connected.
 * - Identity resolution (BD/BE): AI must not silently merge.
 * - Ontology (BF-BH): versioned semantic concepts.
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  createTwin,
  transitionTwinLifecycle,
  isTwinLifecycleTransitionAllowed,
  isHardDeletionAllowed,
  createTemplate,
  validateTwinAgainstTemplate,
  addCompositionLink,
  mergeTwins,
  splitTwin,
  createProvenanceRecord,
  isLineageChainValid,
  resolveIdentity,
  createOntologyEntry,
  type TwinInstance,
} from "@/lib/twin-core";

const TENANT_A = tenantId("tenant-a");
const NOW = "2026-01-01T00:00:00Z";

function twin(overrides: Partial<TwinInstance> = {}): TwinInstance {
  return {
    twinId: "twin-1",
    kind: "classroom",
    tenantId: TENANT_A,
    lifecycleState: "ACTIVE",
    createdAt: NOW,
    creationSource: "institutional_record",
    provenanceRef: null,
    version: 1,
    status: "active",
    confidence: 0.9,
    ownerReference: "user-1",
    templateId: "classroom-template",
    sourceEntityId: "classroom-204",
    ...overrides,
  };
}

describe("Twin creation and identity (G, K, AY)", () => {
  it("creates a twin with stable identity material", () => {
    const result = createTwin({
      kind: "classroom",
      tenantId: TENANT_A,
      createdAt: NOW,
      creationSource: "institutional_record",
      sourceEntityId: "classroom-204",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.twin.tenantId).toBe(TENANT_A);
      expect(result.twin.lifecycleState).toBe("DISCOVERED");
      expect(result.twin.version).toBe(1);
    }
  });

  it("requires a creation timestamp", () => {
    const result = createTwin({
      kind: "classroom",
      tenantId: TENANT_A,
      createdAt: "  ",
      creationSource: "institutional_record",
    });
    expect(result.ok).toBe(false);
  });

  it("requires a source entity reference for device discovery", () => {
    const result = createTwin({
      kind: "device",
      tenantId: TENANT_A,
      createdAt: NOW,
      creationSource: "device_discovery",
      sourceEntityId: null,
    });
    expect(result.ok).toBe(false);
  });

  it("keeps the twin ID stable across lifecycle transitions", () => {
    const result = createTwin({
      kind: "classroom",
      tenantId: TENANT_A,
      createdAt: NOW,
      creationSource: "institutional_record",
    });
    if (!result.ok) throw new Error("fixture failed");
    const idBefore = result.twin.twinId;
    const active = transitionTwinLifecycle(result.twin, "CREATED");
    if (!active.ok) throw new Error("fixture failed");
    const promoted = transitionTwinLifecycle(active.twin, "ACTIVE");
    if (!promoted.ok) throw new Error("fixture failed");
    expect(promoted.twin.twinId).toBe(idBefore);
    expect(promoted.twin.version).toBe(3);
  });
});

describe("Twin lifecycle (AX-BC)", () => {
  it("allows the canonical DISCOVERED -> CREATED -> ACTIVE path", () => {
    expect(isTwinLifecycleTransitionAllowed("DISCOVERED", "CREATED")).toBe(true);
    expect(isTwinLifecycleTransitionAllowed("CREATED", "ACTIVE")).toBe(true);
  });

  it("blocks an illegal ACTIVE -> DISCOVERED jump", () => {
    expect(isTwinLifecycleTransitionAllowed("ACTIVE", "DISCOVERED")).toBe(false);
    const result = transitionTwinLifecycle(twin(), "DISCOVERED");
    expect(result.ok).toBe(false);
  });

  it("retires a twin terminally — no further transitions", () => {
    const retired = transitionTwinLifecycle(twin(), "RETIRED");
    if (!retired.ok) throw new Error("fixture failed");
    expect(isTwinLifecycleTransitionAllowed("RETIRED", "ACTIVE")).toBe(false);
  });

  it("only allows hard deletion for ephemeral or retired twins (BB, BC)", () => {
    expect(isHardDeletionAllowed(twin({ creationSource: "derived" }))).toBe(true);
    expect(isHardDeletionAllowed(twin({ lifecycleState: "RETIRED" }))).toBe(true);
    expect(
      isHardDeletionAllowed(
        twin({ creationSource: "institutional_record", lifecycleState: "ACTIVE" }),
      ),
    ).toBe(false);
  });
});

describe("Type registry and templates (I, J)", () => {
  it("creates a versioned template", () => {
    const result = createTemplate({
      templateId: "classroom-template",
      kind: "classroom",
      version: 1,
      structure: { identity: {}, location: {}, capacity: {} },
      requiredAttributes: ["capacity", "building"],
      createdAt: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a template with an empty ID or zero version", () => {
    const noId = createTemplate({
      templateId: " ",
      kind: "classroom",
      version: 1,
      structure: {},
      requiredAttributes: [],
      createdAt: NOW,
    });
    expect(noId.ok).toBe(false);
    const noVersion = createTemplate({
      templateId: "classroom-template",
      kind: "classroom",
      version: 0,
      structure: {},
      requiredAttributes: [],
      createdAt: NOW,
    });
    expect(noVersion.ok).toBe(false);
  });

  it("validates twin attributes against required template fields", () => {
    const result = createTemplate({
      templateId: "classroom-template",
      kind: "classroom",
      version: 1,
      structure: {},
      requiredAttributes: ["capacity", "building"],
      createdAt: NOW,
    });
    if (!result.ok) throw new Error("fixture failed");
    expect(validateTwinAgainstTemplate(result.template, { capacity: 30, building: "A" }).ok).toBe(
      true,
    );
    expect(validateTwinAgainstTemplate(result.template, { capacity: 30 }).ok).toBe(false);
  });
});

describe("Composition (L)", () => {
  it("adds a composition link preserving child identity", () => {
    const links = addCompositionLink([], "twin-campus", "twin-building", TENANT_A, NOW);
    expect(links.ok).toBe(true);
    if (links.ok) {
      expect(links.links).toHaveLength(1);
      expect(links.links[0].parentTwinId).toBe("twin-campus");
      expect(links.links[0].childTwinId).toBe("twin-building");
    }
  });

  it("rejects a twin containing itself and duplicate links", () => {
    const selfLink = addCompositionLink([], "twin-a", "twin-a", TENANT_A, NOW);
    expect(selfLink.ok).toBe(false);
    const first = addCompositionLink([], "twin-a", "twin-b", TENANT_A, NOW);
    if (!first.ok) throw new Error("fixture failed");
    const duplicate = addCompositionLink(first.links, "twin-a", "twin-b", TENANT_A, NOW);
    expect(duplicate.ok).toBe(false);
  });
});

describe("Merge and split (AZ, BA)", () => {
  it("merges duplicates with authorization and provenance", () => {
    const result = mergeTwins({
      primaryTwinId: "twin-1",
      duplicateTwinIds: ["twin-2"],
      authorizedBy: "admin-1",
      reason: "duplicate enrollment records",
      resolvedConflicts: 1,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mergedTwinId).toBe("twin-1");
      expect(result.provenanceRef).toContain("merge-");
    }
  });

  it("rejects a merge without authorization or reason", () => {
    const noAuth = mergeTwins({
      primaryTwinId: "twin-1",
      duplicateTwinIds: ["twin-2"],
      authorizedBy: "",
      reason: "duplicate",
      resolvedConflicts: 0,
      now: NOW,
    });
    expect(noAuth.ok).toBe(false);
    const noReason = mergeTwins({
      primaryTwinId: "twin-1",
      duplicateTwinIds: ["twin-2"],
      authorizedBy: "admin-1",
      reason: "",
      resolvedConflicts: 0,
      now: NOW,
    });
    expect(noReason.ok).toBe(false);
  });

  it("rejects a merge where the primary is also a duplicate", () => {
    const result = mergeTwins({
      primaryTwinId: "twin-1",
      duplicateTwinIds: ["twin-1", "twin-2"],
      authorizedBy: "admin-1",
      reason: "duplicate",
      resolvedConflicts: 0,
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("splits a twin into at least two targets with a reason", () => {
    const result = splitTwin({
      sourceTwinId: "twin-1",
      targetTwinIds: ["twin-1a", "twin-1b"],
      reason: "covers two rooms",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    const tooFew = splitTwin({
      sourceTwinId: "twin-1",
      targetTwinIds: ["twin-1a"],
      reason: "x",
      now: NOW,
    });
    expect(tooFew.ok).toBe(false);
  });
});

describe("Lineage and provenance (AS, AT)", () => {
  it("accepts a connected lineage chain", () => {
    const source = createProvenanceRecord({
      source: "hardware",
      actor: null,
      transformation: null,
      timestamp: NOW,
      systemVersion: "1",
      modelVersion: null,
      parentProvenanceId: null,
    });
    const observation = createProvenanceRecord({
      source: "hardware",
      actor: null,
      transformation: "normalize",
      timestamp: NOW,
      systemVersion: "1",
      modelVersion: null,
      parentProvenanceId: source.provenanceId,
    });
    const state = createProvenanceRecord({
      source: "twin",
      actor: null,
      transformation: "project",
      timestamp: NOW,
      systemVersion: "1",
      modelVersion: null,
      parentProvenanceId: observation.provenanceId,
    });
    expect(isLineageChainValid([source, observation, state])).toBe(true);
  });

  it("rejects a broken lineage chain", () => {
    const source = createProvenanceRecord({
      source: "hardware",
      actor: null,
      transformation: null,
      timestamp: NOW,
      systemVersion: "1",
      modelVersion: null,
      parentProvenanceId: null,
    });
    const broken = createProvenanceRecord({
      source: "twin",
      actor: null,
      transformation: "project",
      timestamp: NOW,
      systemVersion: "1",
      modelVersion: null,
      parentProvenanceId: "missing",
    });
    expect(isLineageChainValid([source, broken])).toBe(false);
  });
});

describe("Identity resolution (BD, BE)", () => {
  it("matches records sharing all identifiers", () => {
    expect(
      resolveIdentity({
        sharedIdentifiers: 2,
        totalIdentifiers: 2,
        nameSimilarity: 0.4,
        locationMatch: false,
        metadataMatch: false,
        timestampProximity: false,
      }),
    ).toBe("same");
  });

  it("returns uncertain when identifiers partially match — never auto-merges", () => {
    expect(
      resolveIdentity({
        sharedIdentifiers: 1,
        totalIdentifiers: 2,
        nameSimilarity: 0.4,
        locationMatch: false,
        metadataMatch: false,
        timestampProximity: false,
      }),
    ).toBe("uncertain");
  });

  it("distinguishes different entities on weak signals", () => {
    expect(
      resolveIdentity({
        sharedIdentifiers: 0,
        totalIdentifiers: 2,
        nameSimilarity: 0.1,
        locationMatch: false,
        metadataMatch: false,
        timestampProximity: false,
      }),
    ).toBe("different");
  });
});

describe("Ontology (BF, BG, BH)", () => {
  it("creates versioned ontology entries for every semantic concept", () => {
    const entry = createOntologyEntry("ENTITY", "Classroom", 1);
    expect(entry.concept).toBe("ENTITY");
    expect(entry.version).toBe(1);
    const prediction = createOntologyEntry("PREDICTION", "OccupancyForecast", 3);
    expect(prediction.version).toBe(3);
  });
});
