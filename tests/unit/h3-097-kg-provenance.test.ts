/**
 * CoreGrid — H3-097 knowledge-graph provenance proof (mission J-097, Squad J).
 *
 * AGENTS §11 (Knowledge Graph Principle): every knowledge-graph relationship
 * must preserve PROVENANCE, OWNERSHIP, AUTHORIZATION and CONFIDENCE.
 *
 * This suite proves the phase-48 KG relationship contract
 * (`frontend/src/lib/knowledge-graph/contracts.ts` — READ-ONLY, mission G-068's
 * module) honors §11 end-to-end:
 *
 * 1. MANDATORY FIELDS — provenance, ownership, authorization and confidence
 *    are mandatory on every relationship; an edge missing any of the four does
 *    not parse (`malformed_edge`), and an unparsed edge is never published,
 *    never traversed, never disclosed.
 * 2. PROVENANCE DEPTH (AGENTS §12) — provenance answers "where did this come
 *    from": createdBy, originKind, originRef, createdAt, declared aiGenerated,
 *    bounded transformation/validation history; unknown fields are rejected;
 *    inferred edges must cite an inference method and asserted edges must not
 *    carry one (AGENTS §9 canonical-truth separation).
 * 3. OWNERSHIP — an accountable ownerRef is mandatory and non-blank.
 * 4. AUTHORIZATION — visibility and sensitivity are mandatory; cross-tenant
 *    (federated) edges require federationRef AND approvalRef, and a
 *    federationRef on a tenant-scoped edge is rejected (§13 multi-tenancy).
 * 5. CONFIDENCE — tier must match its numeric band; high/confirmed edges must
 *    cite evidence; publication enforces the confidence floor.
 * 6. FIELD PROPAGATION — every edge projected to a consumer by traversal
 *    carries all four §11 fields intact; the governance metadata never detaches
 *    from the relationship.
 * 7. POSTURE — the module's declared posture names the four-field
 *    relationship policy and a deny-by-default decision.
 *
 * Read-only on the KG module: this suite asserts behavior; a failure is
 * evidence (a FINDING), never a reason to edit the contract. Pure offline:
 * no network, no database, no secrets.
 */
import { describe, expect, it } from "vitest";
import {
  GRAPH_CONFIDENCE_PUBLISH_FLOOR,
  KNOWLEDGE_GRAPH_CONTRACT_POSTURE,
  evaluateTraversal,
  parseGraphRelationship,
  publishRelationship,
  type GraphAuthorizationGate,
  type GraphEntity,
  type GraphProvenance,
  type GraphRelationship,
} from "../../frontend/src/lib/knowledge-graph/contracts";

const NOW = "2026-10-03T00:00:00.000Z";
const EARLIER = "2026-10-02T00:00:00.000Z";
const LATER = "2026-10-03T12:00:00.000Z";
const AFTER_EXPIRY = "2026-10-04T00:00:00.000Z";

type EdgeGovernanceField = "provenance" | "ownership" | "authorization" | "confidence";

/* ─────────────── fixture builders ─────────────── */

function provenance(overrides: Partial<GraphProvenance> = {}): GraphProvenance {
  return {
    createdBy: "creator:kg-j097",
    originKind: "human",
    originRef: "source:h3-097",
    createdAt: EARLIER,
    aiGenerated: false,
    transformationRefs: [],
    validationRefs: ["validation:h3-097"],
    ...overrides,
  };
}

function entity(overrides: Partial<GraphEntity> = {}): GraphEntity {
  return {
    entityId: "entity-a",
    tenantRef: "tenant-1",
    entityKind: "organization",
    label: "Entity A",
    sensitivity: "internal",
    provenance: provenance(),
    confidence: 0.9,
    payloadRefs: [],
    createdAt: EARLIER,
    updatedAt: EARLIER,
    ...overrides,
  };
}

function edge(overrides: Partial<GraphRelationship> = {}): GraphRelationship {
  return {
    edgeId: "edge-j097",
    tenantRef: "tenant-1",
    relationKind: "connected_to",
    sourceEntityId: "entity-a",
    targetEntityId: "entity-b",
    origin: "asserted",
    provenance: provenance(),
    ownership: { ownerRef: "owner:alpha" },
    authorization: { visibility: "tenant_scoped", sensitivity: "internal" },
    confidence: { value: 0.9, tier: "high" },
    evidenceRefs: ["evidence:j097"],
    lifecycle: "published",
    createdAt: EARLIER,
    updatedAt: EARLIER,
    ...overrides,
  };
}

/** A shallow copy of the edge with one top-level governance field removed. */
function withoutField(
  source: GraphRelationship,
  field: EdgeGovernanceField,
): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...source };
  delete rest[field];
  return rest;
}

/** A shallow copy of an object with one named key removed. */
function withoutKey(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...source };
  delete rest[key];
  return rest;
}

function gate(overrides: Partial<GraphAuthorizationGate> = {}): GraphAuthorizationGate {
  return {
    gateId: "gate-j097",
    decision: "allow",
    principalRef: "principal:alpha",
    tenantRef: "tenant-1",
    purposeRef: "purpose:ops",
    sensitivityCeiling: "restricted",
    federationRefs: [],
    redactionDirectives: [],
    decidedAt: EARLIER,
    expiresAt: AFTER_EXPIRY,
    authorityRef: "authority:h3-097",
    traceId: "trace:h3-097",
    ...overrides,
  };
}

/** Fails the test with the contract's typed reason when a parse succeeds. */
function expectEdgeRejected(candidate: unknown): void {
  const parsed = parseGraphRelationship(candidate);
  if (parsed.ok) {
    throw new Error(
      `expected malformed_edge but the edge parsed and would have been consumable: ${parsed.value.edgeId}`,
    );
  }
  expect(parsed.error).toBe("malformed_edge");
}

/* ─────────────── 1. the four §11 fields are mandatory ─────────────── */

describe("§11: relationship governance fields are mandatory", () => {
  it("accepts a fully governed edge (all four fields present)", () => {
    const parsed = parseGraphRelationship(edge());
    expect(parsed.ok).toBe(true);
  });

  it("rejects an edge missing provenance", () => {
    expectEdgeRejected(withoutField(edge(), "provenance"));
  });

  it("rejects an edge missing ownership", () => {
    expectEdgeRejected(withoutField(edge(), "ownership"));
  });

  it("rejects an edge missing authorization", () => {
    expectEdgeRejected(withoutField(edge(), "authorization"));
  });

  it("rejects an edge missing confidence", () => {
    expectEdgeRejected(withoutField(edge(), "confidence"));
  });

  it("an edge stripped of all four fields is rejected, never partially parsed", () => {
    const stripped: Record<string, unknown> = { ...edge() };
    delete stripped["provenance"];
    delete stripped["ownership"];
    delete stripped["authorization"];
    delete stripped["confidence"];
    expectEdgeRejected(stripped);
  });
});

/* ─────────────── 2. provenance depth (AGENTS §11/§12) ─────────────── */

describe("§11/§12: provenance answers where an edge came from", () => {
  it("rejects provenance with a blank createdBy", () => {
    const bad = edge({ provenance: provenance({ createdBy: "  " }) });
    expectEdgeRejected(bad);
  });

  it("rejects provenance without a declared originKind", () => {
    const candidate = withoutKey(
      { ...edge() }.provenance as unknown as Record<string, unknown>,
      "originKind",
    );
    const bad = edge({ provenance: candidate as unknown as GraphProvenance });
    expectEdgeRejected(bad);
  });

  it("rejects provenance without an originRef", () => {
    const base = { ...edge() }.provenance;
    const candidate = withoutKey(base as unknown as Record<string, unknown>, "originRef");
    const bad = edge({ provenance: candidate as unknown as GraphProvenance });
    expectEdgeRejected(bad);
  });

  it("rejects provenance without the mandatory aiGenerated declaration", () => {
    const base = { ...edge() }.provenance;
    const candidate = withoutKey(base as unknown as Record<string, unknown>, "aiGenerated");
    const bad = edge({ provenance: candidate as unknown as GraphProvenance });
    expectEdgeRejected(bad);
  });

  it("accepts a declared AI-generated edge (declared, never inferred)", () => {
    const parsed = parseGraphRelationship(
      edge({
        provenance: provenance({ aiGenerated: true, originKind: "agent" }),
        origin: "asserted",
      }),
    );
    expect(parsed.ok).toBe(true);
  });

  it("rejects provenance carrying unknown fields (strict provenance shape)", () => {
    const inflated = {
      ...provenance(),
      freeTextNarrative: "uncontrolled annotation is not provenance",
    };
    const bad = edge({ provenance: inflated as GraphProvenance });
    expectEdgeRejected(bad);
  });

  it("rejects unbounded transformation history (provenance stays bounded)", () => {
    const many = Array.from({ length: 33 }, (_, i) => `transform:${i}`);
    const bad = edge({ provenance: provenance({ transformationRefs: many }) });
    expectEdgeRejected(bad);
  });
});

/* ─────────────── 3. canonical-truth separation on provenance (AGENTS §9) ────── */

describe("§9 via §11: asserted vs inferred provenance is exact", () => {
  it("an inferred edge must cite an inferenceMethodRef", () => {
    const bad = edge({
      origin: "inferred",
      provenance: provenance({ aiGenerated: true, originKind: "agent" }),
    });
    expectEdgeRejected(bad);
  });

  it("an inferred edge with a cited method parses", () => {
    const parsed = parseGraphRelationship(
      edge({
        origin: "inferred",
        confidence: { value: 0.6, tier: "medium" },
        evidenceRefs: [],
        provenance: provenance({
          aiGenerated: true,
          originKind: "agent",
          inferenceMethodRef: "method:similarity-v1",
        }),
      }),
    );
    expect(parsed.ok).toBe(true);
  });

  it("an asserted edge must not carry an inferenceMethodRef", () => {
    const bad = edge({
      provenance: provenance({ inferenceMethodRef: "method:should-not-be-here" }),
    });
    expectEdgeRejected(bad);
  });
});

/* ─────────────── 4. ownership ─────────────── */

describe("§11: ownership is mandatory and accountable", () => {
  it("rejects an edge whose ownership block is empty", () => {
    const bad = edge({ ownership: {} as GraphRelationship["ownership"] });
    expectEdgeRejected(bad);
  });

  it("rejects a blank ownerRef", () => {
    const bad = edge({ ownership: { ownerRef: "" } });
    expectEdgeRejected(bad);
  });

  it("rejects ownership carrying unknown fields (strict shape)", () => {
    const inflated = { ownerRef: "owner:alpha", delegated: true };
    const bad = edge({ ownership: inflated as GraphRelationship["ownership"] });
    expectEdgeRejected(bad);
  });
});

/* ─────────────── 5. authorization block ─────────────── */

describe("§11/§13: authorization on the edge is explicit and closed", () => {
  it("rejects an edge without a declared sensitivity", () => {
    const authorization = withoutKey(
      { ...edge() }.authorization as unknown as Record<string, unknown>,
      "sensitivity",
    );
    const bad = edge({ authorization: authorization as GraphRelationship["authorization"] });
    expectEdgeRejected(bad);
  });

  it("rejects an edge with an unknown visibility", () => {
    const bad = edge({
      authorization: {
        visibility: "public-by-vibes",
        sensitivity: "internal",
      } as unknown as GraphRelationship["authorization"],
    });
    expectEdgeRejected(bad);
  });

  it("a federated edge without federationRef is rejected (cross-tenant is never implicit)", () => {
    const bad = edge({
      authorization: { visibility: "federated", sensitivity: "internal" },
    });
    expectEdgeRejected(bad);
  });

  it("a federated edge without approvalRef is rejected (cross-tenant creation is approval-gated)", () => {
    const bad = edge({
      authorization: {
        visibility: "federated",
        sensitivity: "internal",
        federationRef: "federation:alpha-beta",
      },
    });
    expectEdgeRejected(bad);
  });

  it("a federated edge with federationRef AND approvalRef parses", () => {
    const parsed = parseGraphRelationship(
      edge({
        authorization: {
          visibility: "federated",
          sensitivity: "internal",
          federationRef: "federation:alpha-beta",
          approvalRef: "approval:fed-001",
        },
      }),
    );
    expect(parsed.ok).toBe(true);
  });

  it("a federationRef on a tenant-scoped edge is rejected", () => {
    const bad = edge({
      authorization: {
        visibility: "tenant_scoped",
        sensitivity: "internal",
        federationRef: "federation:unauthorized",
      },
    });
    expectEdgeRejected(bad);
  });
});

/* ─────────────── 6. confidence ─────────────── */

describe("§11: confidence is banded, evidenced and floored", () => {
  it("rejects a tier that does not match its numeric band", () => {
    const bad = edge({ confidence: { value: 0.9, tier: "medium" } });
    expectEdgeRejected(bad);
  });

  it("rejects a confidence value outside [0,1]", () => {
    const bad = edge({ confidence: { value: 1.2, tier: "confirmed" } });
    expectEdgeRejected(bad);
  });

  it("rejects high confidence without cited evidence", () => {
    const bad = edge({ confidence: { value: 0.8, tier: "high" }, evidenceRefs: [] });
    expectEdgeRejected(bad);
  });

  it("accepts confirmed confidence with evidence", () => {
    const parsed = parseGraphRelationship(
      edge({ confidence: { value: 0.96, tier: "confirmed" }, evidenceRefs: ["evidence:audit-1"] }),
    );
    expect(parsed.ok).toBe(true);
  });

  it("publishes nothing below the confidence floor", () => {
    const candidate = edge({
      lifecycle: "proposed",
      confidence: { value: 0.2, tier: "unknown" },
      evidenceRefs: [],
    });
    const published = publishRelationship(candidate, [entity(), entity({ entityId: "entity-b" })], NOW);
    expect(parsedOk(published)).toBe(false);
    if (!published.ok) {
      expect(published.error).toBe("confidence_below_floor");
    }
    expect(GRAPH_CONFIDENCE_PUBLISH_FLOOR).toBeGreaterThan(0.2);
  });
});

/* ─────────────── 7. unparsed edges never reach consumers ─────────────── */

describe("§11: an edge missing a governance field is never published, traversed or disclosed", () => {
  const fourFields: EdgeGovernanceField[] = [
    "provenance",
    "ownership",
    "authorization",
    "confidence",
  ];

  it("publication refuses an edge missing any of the four fields", () => {
    const tenants = [entity(), entity({ entityId: "entity-b" })];
    for (const field of fourFields) {
      const published = publishRelationship(
        withoutField(edge(), field) as unknown as GraphRelationship,
        tenants,
        NOW,
      );
      expect(parsedOk(published)).toBe(false);
      if (!published.ok) {
        expect(published.error).toBe("edge_malformed");
      }
    }
  });

  it("traversal counts an unparseable edge as malformed and returns no trace of it", () => {
    const tenants = [entity(), entity({ entityId: "entity-b" })];
    for (const field of fourFields) {
      const verdict = evaluateTraversal(
        {
          rootEntityId: "entity-a",
          tenantRef: "tenant-1",
          principalRef: "principal:alpha",
          purposeRef: "purpose:ops",
          direction: "both",
          maxDepth: 3,
          maxEdges: 64,
          minConfidence: 0,
        },
        gate(),
        tenants,
        [withoutField(edge(), field) as unknown as GraphRelationship],
        LATER,
      );
      expect(verdict.outcome).toBe("allowed");
      if (verdict.outcome === "allowed") {
        expect(verdict.edges).toHaveLength(0);
        expect(verdict.excluded.malformed_edge).toBe(1);
        // entity-b is reachable ONLY through the (now excluded) edge — the
        // malformed edge is absorbed from the result and not merely unlabeled.
        expect(verdict.nodes.map((n) => n.entityId)).toEqual(["entity-a"]);
      }
    }
  });

  it("a fully governed edge traverses with every §11 field attached", () => {
    const tenants = [entity(), entity({ entityId: "entity-b" })];
    const verdict = evaluateTraversal(
      {
        rootEntityId: "entity-a",
        tenantRef: "tenant-1",
        principalRef: "principal:alpha",
        purposeRef: "purpose:ops",
        direction: "both",
        maxDepth: 3,
        maxEdges: 64,
        minConfidence: 0,
      },
      gate(),
      tenants,
      [edge()],
      LATER,
    );
    expect(verdict.outcome).toBe("allowed");
    if (verdict.outcome !== "allowed") {
      throw new Error(`expected traversal to be allowed, got ${verdict.outcome}`);
    }
    expect(verdict.edges).toHaveLength(1);
    for (const subgraphEdge of verdict.edges) {
      // The four governance fields travel WITH the edge to the consumer.
      expect(subgraphEdge.provenance).toBeDefined();
      expect(subgraphEdge.provenance.createdBy).toBe("creator:kg-j097");
      expect(typeof subgraphEdge.provenance.createdAt).toBe("string");
      expect(typeof subgraphEdge.provenance.aiGenerated).toBe("boolean");
      expect(Array.isArray(subgraphEdge.provenance.validationRefs)).toBe(true);
      expect(subgraphEdge.ownership).toBeDefined();
      expect(subgraphEdge.ownership.ownerRef).toBe("owner:alpha");
      expect(subgraphEdge.authorization).toBeDefined();
      expect(subgraphEdge.authorization.visibility).toBe("tenant_scoped");
      expect(subgraphEdge.authorization.sensitivity).toBe("internal");
      expect(subgraphEdge.confidence).toBeDefined();
      expect(subgraphEdge.confidence.tier).toBe("high");
      expect(subgraphEdge.confidence.value).toBe(0.9);
    }
  });
});

/* ─────────────── 8. declared posture ─────────────── */

describe("§11: the module declares the four-field governance posture", () => {
  it("relationshipPolicy names provenance, ownership, authorization and confidence as mandatory", () => {
    expect(KNOWLEDGE_GRAPH_CONTRACT_POSTURE.relationshipPolicy).toBe(
      "provenance-ownership-authorization-confidence-mandatory",
    );
  });

  it("the substrate default decision is deny (fail-closed)", () => {
    expect(KNOWLEDGE_GRAPH_CONTRACT_POSTURE.defaultDecision).toBe("deny");
  });

  it("traversal is query-time filtered under an authorization gate", () => {
    expect(KNOWLEDGE_GRAPH_CONTRACT_POSTURE.traversalPolicy).toBe(
      "authorization-gated-query-time-filtered",
    );
  });
});

/* ─────────────── helpers ─────────────── */

function parsedOk<T, E>(result: { ok: true; value: T } | { ok: false; error: E }): boolean {
  return result.ok;
}
