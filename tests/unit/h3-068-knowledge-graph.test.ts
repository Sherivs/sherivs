/**
 * CoreGrid — H3-068 phase-48 knowledge graph contract tests (mission G-068).
 *
 * Proves, against the pure contract in
 * `frontend/src/lib/knowledge-graph/contracts.ts`:
 * - the substrate is FAIL-CLOSED: malformed entities/edges/gates/requests/
 *   revisions are rejected with typed reasons and never throw;
 * - EVERY RELATIONSHIP CARRIES THE FOUR §11 FIELDS — provenance, ownership,
 *   authorization and confidence are mandatory; an edge missing any of the
 *   four does not parse and is never published, traversed or disclosed;
 * - AN EDGE IS NOT A PERMISSION: traversal and entity views are
 *   AUTHORIZATION-GATED with NO bypass path — a missing, malformed, expired,
 *   mismatched or non-permitting gate denies with a typed reason; filtering
 *   happens at query time and every excluded edge is counted, never absorbed;
 * - CROSS-TENANT EDGES ARE INVISIBLE WITHOUT A FEDERATION AGREEMENT: a
 *   federated edge is structurally invalid without federationRef AND
 *   approvalRef, and traversal includes it only under a matching gate
 *   federation reference;
 * - CANONICAL TRUTH SEPARATION: inferred edges must cite an inference method
 *   and are labelled derived; the graph carries references only and never
 *   hands payloads to consumers;
 * - confidence is banded (tier must match the numeric band), high/confirmed
 *   edges must cite evidence, and publication enforces a confidence floor;
 * - lifecycle transitions are explicit and revision-carrying; retraction is
 *   reason-carrying and terminal, and retracted edges become unreachable;
 * - composition: the module binds to the phase-48 kernel contract read-only
 *   and reuses the platform sensitivity vocabulary;
 * - purity: time is injected, inputs are never mutated.
 *
 * Pure offline suite: no network, no database, no secrets.
 */
import { describe, expect, it } from "vitest";
import {
  GRAPH_CONFIDENCE_PUBLISH_FLOOR,
  KNOWLEDGE_GRAPH_CONTRACT_POSTURE,
  authorizedEntityView,
  applyEdgeLifecycleTransition,
  evaluateTraversal,
  parseEdgeRevision,
  parseGraphEntity,
  parseGraphGate,
  parseGraphRelationship,
  parseTraversalRequest,
  publishRelationship,
  retractRelationship,
  type GraphAuthorizationGate,
  type GraphCallerContext,
  type GraphEntity,
  type GraphEdgeRevision,
  type GraphRelationship,
  type GraphRetraction,
  type GraphTraversalRequest,
} from "../../frontend/src/lib/knowledge-graph/contracts";
import { PHASE_48_KNOWLEDGE_GRAPH } from "../../frontend/src/lib/kernel/phase-contracts/phase-48-knowledge-graph";

const NOW = "2026-10-03T00:00:00.000Z";
const EARLIER = "2026-10-02T00:00:00.000Z";
const LATER = "2026-10-03T12:00:00.000Z";
const AFTER_EXPIRY = "2026-10-04T00:00:00.000Z";

/* ─────────────── fixture builders ─────────────── */

function provenance(overrides: Partial<GraphEntity["provenance"]> = {}): GraphEntity["provenance"] {
  return {
    createdBy: "creator:alpha",
    originKind: "human",
    originRef: "origin:1",
    createdAt: EARLIER,
    aiGenerated: false,
    transformationRefs: [],
    validationRefs: ["validation:1"],
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
    payloadRefs: ["payload:1"],
    createdAt: EARLIER,
    updatedAt: EARLIER,
    ...overrides,
  };
}

function edge(overrides: Partial<GraphRelationship> = {}): GraphRelationship {
  return {
    edgeId: "edge-e1",
    tenantRef: "tenant-1",
    relationKind: "depends_on",
    sourceEntityId: "entity-a",
    targetEntityId: "entity-b",
    origin: "asserted",
    provenance: provenance(),
    ownership: { ownerRef: "owner:alpha" },
    authorization: { visibility: "tenant_scoped", sensitivity: "internal" },
    confidence: { value: 0.9, tier: "high" },
    evidenceRefs: ["evidence:1"],
    lifecycle: "published",
    createdAt: EARLIER,
    updatedAt: EARLIER,
    ...overrides,
  };
}

function gate(overrides: Partial<GraphAuthorizationGate> = {}): GraphAuthorizationGate {
  return {
    gateId: "gate-0001",
    decision: "allow",
    principalRef: "principal:alpha",
    tenantRef: "tenant-1",
    purposeRef: "purpose:ops",
    sensitivityCeiling: "restricted",
    federationRefs: [],
    redactionDirectives: [],
    decidedAt: EARLIER,
    expiresAt: LATER,
    authorityRef: "authority:authz-layer",
    traceId: "trace:0001",
    ...overrides,
  };
}

function caller(overrides: Partial<GraphCallerContext> = {}): GraphCallerContext {
  return {
    principalRef: "principal:alpha",
    purposeRef: "purpose:ops",
    ...overrides,
  };
}

function traversalRequest(
  overrides: Partial<GraphTraversalRequest> = {},
): GraphTraversalRequest {
  return {
    rootEntityId: "entity-a",
    tenantRef: "tenant-1",
    principalRef: "principal:alpha",
    purposeRef: "purpose:ops",
    direction: "both",
    maxDepth: 3,
    maxEdges: 16,
    minConfidence: 0.5,
    ...overrides,
  };
}

function revision(overrides: Partial<GraphEdgeRevision> = {}): GraphEdgeRevision {
  return {
    revisionId: "rev-0001",
    edgeId: "edge-e1",
    reason: "advance lifecycle",
    contributorRef: "contributor:alpha",
    appliedAt: NOW,
    previousLifecycle: "proposed",
    newLifecycle: "published",
    ...overrides,
  };
}

function retraction(overrides: Partial<GraphRetraction> = {}): GraphRetraction {
  return {
    reason: "contradicted by new evidence",
    retractedByRef: "operator:alpha",
    retractedAt: NOW,
    ...overrides,
  };
}

/** The shared small graph used by the traversal suite. */
function graphFixtures() {
  const entities: GraphEntity[] = [
    entity(),
    entity({ entityId: "entity-b", label: "Entity B" }),
    entity({ entityId: "entity-c", label: "Entity C", sensitivity: "restricted" }),
    entity({
      entityId: "entity-d",
      label: "Entity D",
      retiredAt: LATER,
      updatedAt: LATER,
    }),
    entity({ entityId: "entity-f", label: "Entity F", tenantRef: "tenant-2" }),
    entity({ entityId: "entity-g", label: "Entity G", tenantRef: "tenant-2" }),
    entity({ entityId: "entity-h", label: "Entity H" }),
    entity({ entityId: "entity-r", label: "Entity R" }),
  ];
  const edges: GraphRelationship[] = [
    edge(), // e1: a→b published, tenant-1 scoped
    edge({ edgeId: "edge-e2", sourceEntityId: "entity-b", targetEntityId: "entity-c" }), // endpoint above ceiling when ceiling is internal
    edge({
      edgeId: "edge-e3",
      sourceEntityId: "entity-c",
      targetEntityId: "entity-a",
      lifecycle: "proposed",
    }), // not published
    edge({ edgeId: "edge-e4", sourceEntityId: "entity-a", targetEntityId: "entity-d" }), // retired endpoint
    edge({ edgeId: "edge-e5", sourceEntityId: "entity-a", targetEntityId: "entity-f" }), // cross-tenant endpoint, tenant_scoped
    edge({
      edgeId: "edge-e6",
      sourceEntityId: "entity-a",
      targetEntityId: "entity-g",
      authorization: {
        visibility: "federated",
        sensitivity: "internal",
        federationRef: "federation:1",
        approvalRef: "approval:fed-1",
      },
    }), // federated, tenant-2 endpoint
    edge({
      edgeId: "edge-e7",
      sourceEntityId: "entity-a",
      targetEntityId: "entity-h",
      confidence: { value: 0.3, tier: "unknown" },
      evidenceRefs: [],
    }), // below consumer floor
    edge({
      edgeId: "edge-e8",
      sourceEntityId: "entity-a",
      targetEntityId: "entity-r",
      authorization: { visibility: "tenant_scoped", sensitivity: "restricted" },
    }), // edge sensitivity above clearance
  ];
  return { entities, edges };
}

/* ─────────────── posture composition ─────────────── */

describe("posture composition (read-only kernel binding)", () => {
  it("binds to the phase-48 kernel contract and its boundary statement", () => {
    expect(KNOWLEDGE_GRAPH_CONTRACT_POSTURE.phaseId).toBe(PHASE_48_KNOWLEDGE_GRAPH.id);
    expect(KNOWLEDGE_GRAPH_CONTRACT_POSTURE.phaseId).toBe("48");
    expect(KNOWLEDGE_GRAPH_CONTRACT_POSTURE.phaseName).toBe("Civilization Knowledge Graph");
    expect(KNOWLEDGE_GRAPH_CONTRACT_POSTURE.phaseCapability).toBe(
      PHASE_48_KNOWLEDGE_GRAPH.capabilities.owns[0],
    );
    expect(KNOWLEDGE_GRAPH_CONTRACT_POSTURE.phaseCapability).toBe("civilization-knowledge-graph");
    expect(KNOWLEDGE_GRAPH_CONTRACT_POSTURE.boundary).toBe(
      PHASE_48_KNOWLEDGE_GRAPH.boundary.statement,
    );
    expect(KNOWLEDGE_GRAPH_CONTRACT_POSTURE.boundary).toContain("never permissions");
    expect(KNOWLEDGE_GRAPH_CONTRACT_POSTURE.boundary).toContain(
      "never implies that either party may read the other",
    );
  });

  it("encodes the approval-gated operations named by the kernel contract", () => {
    expect(KNOWLEDGE_GRAPH_CONTRACT_POSTURE.approvalRequiredFor).toContain(
      "cross-tenant-edge-creation",
    );
    expect(KNOWLEDGE_GRAPH_CONTRACT_POSTURE.approvalRequiredFor).toContain(
      "graph-wide-relationship-publish",
    );
    expect(KNOWLEDGE_GRAPH_CONTRACT_POSTURE.approvalRequiredFor).toContain(
      "inference-threshold-change",
    );
  });

  it("is deny-by-default with governance-mandatory relationships", () => {
    expect(KNOWLEDGE_GRAPH_CONTRACT_POSTURE.defaultDecision).toBe("deny");
    expect(KNOWLEDGE_GRAPH_CONTRACT_POSTURE.traversalPolicy).toBe(
      "authorization-gated-query-time-filtered",
    );
    expect(KNOWLEDGE_GRAPH_CONTRACT_POSTURE.relationshipPolicy).toBe(
      "provenance-ownership-authorization-confidence-mandatory",
    );
    expect(KNOWLEDGE_GRAPH_CONTRACT_POSTURE.inferencePolicy).toBe(
      "derived-labelled-method-cited",
    );
  });
});

/* ─────────────── §11 — the four mandatory governance fields ─────────────── */

describe("every relationship carries provenance, ownership, authorization, confidence (AGENTS §11)", () => {
  it("rejects an edge missing any of the four §11 fields", () => {
    const base = edge();
    for (const field of ["provenance", "ownership", "authorization", "confidence"] as const) {
      const stripped = { ...base } as Record<string, unknown>;
      delete stripped[field];
      expect(parseGraphRelationship(stripped).ok).toBe(false);
    }
  });

  it("travels the four fields with every traversed edge", () => {
    const { entities, edges } = graphFixtures();
    const verdict = evaluateTraversal(traversalRequest(), gate(), entities, edges, NOW);
    expect(verdict.outcome).toBe("allowed");
    if (verdict.outcome === "allowed") {
      expect(verdict.edges.length).toBeGreaterThan(0);
      for (const subgraphEdge of verdict.edges) {
        expect(Object.keys(subgraphEdge).sort()).toEqual([
          "authorization",
          "confidence",
          "edgeId",
          "origin",
          "ownership",
          "provenance",
          "relationKind",
          "sourceEntityId",
          "targetEntityId",
        ]);
        expect(Object.keys(subgraphEdge.ownership)).toEqual(["ownerRef"]);
        expect(Object.keys(subgraphEdge.authorization).sort()).toEqual([
          "sensitivity",
          "visibility",
        ]);
      }
    }
  });

  it("carries the four fields on a successfully published edge", () => {
    const result = publishRelationship(
      edge({ lifecycle: "proposed" }),
      [entity(), entity({ entityId: "entity-b" })],
      NOW,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.provenance.originRef).toBe("origin:1");
      expect(result.value.ownership.ownerRef).toBe("owner:alpha");
      expect(result.value.authorization.visibility).toBe("tenant_scoped");
      expect(result.value.confidence.tier).toBe("high");
    }
  });
});

/* ─────────────── fail-closed parsing ─────────────── */

describe("fail-closed parsing", () => {
  it("rejects a malformed edge with a typed reason instead of throwing", () => {
    expect(parseGraphRelationship({ ...edge(), confidence: { value: 1.5, tier: "confirmed" } }).ok).toBe(false);
    expect(parseGraphRelationship({ ...edge(), relationKind: "magically_links" }).ok).toBe(false);
    expect(parseGraphRelationship({ ...edge(), edgeId: "BAD ID" }).ok).toBe(false);
    expect(parseGraphRelationship({ ...edge(), tenantRef: "" }).ok).toBe(false);
    expect(parseGraphRelationship(null)).toEqual({ ok: false, error: "malformed_edge" });
  });

  it("rejects self-loops", () => {
    expect(
      parseGraphRelationship(edge({ targetEntityId: "entity-a" })).ok,
    ).toBe(false);
  });

  it("rejects a confidence tier outside its numeric band", () => {
    expect(parseGraphRelationship(edge({ confidence: { value: 0.9, tier: "medium" } })).ok).toBe(false);
    expect(parseGraphRelationship(edge({ confidence: { value: 0.5, tier: "high" } })).ok).toBe(false);
    expect(parseGraphRelationship(edge({ confidence: { value: 0.3, tier: "high" } })).ok).toBe(false);
    expect(parseGraphRelationship(edge({ confidence: { value: 1, tier: "confirmed" } })).ok).toBe(true);
    expect(parseGraphRelationship(edge({ confidence: { value: 0.95, tier: "confirmed" } })).ok).toBe(true);
    expect(parseGraphRelationship(edge({ confidence: { value: 0.94, tier: "confirmed" } })).ok).toBe(false);
    expect(parseGraphRelationship(edge({ confidence: { value: 0.75, tier: "high" } })).ok).toBe(true);
    expect(parseGraphRelationship(edge({ confidence: { value: 0.4, tier: "medium" } })).ok).toBe(true);
    expect(parseGraphRelationship(edge({ confidence: { value: 0.39, tier: "medium" } })).ok).toBe(false);
    expect(parseGraphRelationship(edge({ confidence: { value: 0, tier: "unknown" } })).ok).toBe(true);
  });

  it("requires evidence for high or confirmed confidence", () => {
    expect(
      parseGraphRelationship(edge({ confidence: { value: 0.9, tier: "high" }, evidenceRefs: [] })).ok,
    ).toBe(false);
    expect(
      parseGraphRelationship(edge({ confidence: { value: 0.6, tier: "medium" }, evidenceRefs: [] })).ok,
    ).toBe(true);
  });

  it("requires federationRef AND approvalRef on federated edges and forbids them elsewhere", () => {
    expect(
      parseGraphRelationship(
        edge({ authorization: { visibility: "federated", sensitivity: "internal" } }),
      ).ok,
    ).toBe(false);
    expect(
      parseGraphRelationship(
        edge({
          authorization: {
            visibility: "federated",
            sensitivity: "internal",
            federationRef: "federation:1",
          },
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseGraphRelationship(
        edge({
          authorization: {
            visibility: "tenant_scoped",
            sensitivity: "internal",
            federationRef: "federation:1",
          },
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseGraphRelationship(
        edge({
          authorization: {
            visibility: "federated",
            sensitivity: "internal",
            federationRef: "federation:1",
            approvalRef: "approval:fed-1",
          },
        }),
      ).ok,
    ).toBe(true);
  });

  it("keeps canonical and derived separated: inferred edges cite a method, asserted edges may not", () => {
    expect(
      parseGraphRelationship(edge({ origin: "inferred" })).ok,
    ).toBe(false);
    expect(
      parseGraphRelationship(
        edge({
          origin: "inferred",
          provenance: provenance({ aiGenerated: true, inferenceMethodRef: "method:link-1" }),
        }),
      ).ok,
    ).toBe(true);
    expect(
      parseGraphRelationship(
        edge({ provenance: provenance({ inferenceMethodRef: "method:link-1" }) }),
      ).ok,
    ).toBe(false);
  });

  it("requires retraction on retracted edges and supersededById on superseded edges", () => {
    expect(parseGraphRelationship(edge({ lifecycle: "retracted" })).ok).toBe(false);
    expect(
      parseGraphRelationship(edge({ lifecycle: "retracted", retraction: retraction() })).ok,
    ).toBe(true);
    expect(parseGraphRelationship(edge({ lifecycle: "superseded" })).ok).toBe(false);
    expect(
      parseGraphRelationship(edge({ lifecycle: "superseded", supersededById: "edge-e9" })).ok,
    ).toBe(true);
    expect(
      parseGraphRelationship(edge({ supersededById: "edge-e9" })).ok,
    ).toBe(false);
    expect(
      parseGraphRelationship(edge({ retraction: retraction() })).ok,
    ).toBe(false);
  });

  it("rejects malformed entities, gates, requests and revisions with typed reasons", () => {
    expect(parseGraphEntity({ ...entity(), entityId: "Entity-A" }).ok).toBe(false);
    expect(parseGraphEntity({ ...entity(), entityKind: "school" }).ok).toBe(false);
    expect(parseGraphEntity({ ...entity(), confidence: 1.2 }).ok).toBe(false);
    expect(parseGraphEntity(entity({ retiredAt: EARLIER })).ok).toBe(false);
    expect(parseGraphGate(gate({ expiresAt: EARLIER })).ok).toBe(false);
    expect(parseGraphGate(gate({ decision: "redact" })).ok).toBe(false);
    expect(
      parseGraphGate(gate({ decision: "allow", redactionDirectives: ["strip-refs"] })).ok,
    ).toBe(false);
    expect(parseTraversalRequest(traversalRequest({ maxDepth: 0 })).ok).toBe(false);
    expect(parseTraversalRequest(traversalRequest({ maxDepth: 7 })).ok).toBe(false);
    expect(parseTraversalRequest(traversalRequest({ maxEdges: 0 })).ok).toBe(false);
    expect(parseTraversalRequest(traversalRequest({ minConfidence: 1.4 })).ok).toBe(false);
    // Shape-level: an approval-less retraction revision parses; its denial is
    // SEMANTIC (`missing_approval`) at the execution path — never the parser.
    expect(parseEdgeRevision(revision({ newLifecycle: "retracted" })).ok).toBe(true);
    expect(
      parseEdgeRevision(revision({ newLifecycle: "retracted", approvalRef: "approval:1" })).ok,
    ).toBe(true);
  });
});

/* ─────────────── authorization-gated traversal — no bypass path ─────────────── */

describe("traversal is authorization-gated and deny-by-default", () => {
  const { entities, edges } = graphFixtures();

  it("denies when no gate is presented", () => {
    expect(evaluateTraversal(traversalRequest(), undefined, entities, edges, NOW)).toEqual({
      outcome: "denied",
      reason: "no_gate_presented",
    });
  });

  it("denies a malformed gate instead of throwing", () => {
    expect(
      evaluateTraversal(
        traversalRequest(),
        { ...gate(), gateId: "" } as unknown as GraphAuthorizationGate,
        entities,
        edges,
        NOW,
      ),
    ).toEqual({ outcome: "denied", reason: "gate_malformed" });
  });

  it("denies an expired gate", () => {
    expect(evaluateTraversal(traversalRequest(), gate(), entities, edges, AFTER_EXPIRY)).toEqual({
      outcome: "denied",
      reason: "gate_expired",
    });
  });

  it("denies every non-permitting decision", () => {
    for (const decision of ["deny", "escalate", "require_approval"] as const) {
      expect(
        evaluateTraversal(traversalRequest(), gate({ decision }), entities, edges, NOW),
      ).toEqual({ outcome: "denied", reason: "decision_not_permitted" });
    }
  });

  it("denies tenant, principal and purpose mismatches", () => {
    expect(
      evaluateTraversal(traversalRequest({ tenantRef: "tenant-2" }), gate(), entities, edges, NOW),
    ).toEqual({ outcome: "denied", reason: "tenant_mismatch" });
    expect(
      evaluateTraversal(
        traversalRequest({ principalRef: "principal:beta" }),
        gate(),
        entities,
        edges,
        NOW,
      ),
    ).toEqual({ outcome: "denied", reason: "principal_mismatch" });
    expect(
      evaluateTraversal(traversalRequest({ purposeRef: "purpose:other" }), gate(), entities, edges, NOW),
    ).toEqual({ outcome: "denied", reason: "purpose_mismatch" });
  });

  it("denies a malformed request with a typed reason", () => {
    expect(
      evaluateTraversal(
        traversalRequest({ rootEntityId: "NOT-VALID" }),
        gate(),
        entities,
        edges,
        NOW,
      ),
    ).toEqual({ outcome: "denied", reason: "request_malformed" });
  });

  it("denies a missing, retired or over-sensitive root", () => {
    expect(
      evaluateTraversal(traversalRequest({ rootEntityId: "entity-zzz" }), gate(), entities, edges, NOW),
    ).toEqual({ outcome: "denied", reason: "root_entity_missing" });
    expect(
      evaluateTraversal(traversalRequest({ rootEntityId: "entity-d" }), gate(), entities, edges, NOW),
    ).toEqual({ outcome: "denied", reason: "root_entity_retired" });
    expect(
      evaluateTraversal(
        traversalRequest({ rootEntityId: "entity-c" }),
        gate({ sensitivityCeiling: "internal" }),
        entities,
        edges,
        NOW,
      ),
    ).toEqual({ outcome: "denied", reason: "sensitivity_exceeds_clearance" });
  });

  it("yields a redacted posture with directives — never a subgraph", () => {
    const verdict = evaluateTraversal(
      traversalRequest(),
      gate({ decision: "redact", redactionDirectives: ["strip-endpoint-labels"] }),
      entities,
      edges,
      NOW,
    );
    expect(verdict.outcome).toBe("redacted");
    if (verdict.outcome === "redacted") {
      expect(verdict.redactionDirectives).toEqual(["strip-endpoint-labels"]);
      expect("nodes" in verdict).toBe(false);
      expect("edges" in verdict).toBe(false);
    }
  });
});

/* ─────────────── query-time filtering — edges are filtered, not hidden ─────────────── */

describe("traversal filters at query time and counts every exclusion", () => {
  const { entities, edges } = graphFixtures();

  it("walks the authorized subgraph from the root", () => {
    const verdict = evaluateTraversal(traversalRequest(), gate(), entities, edges, NOW);
    expect(verdict.outcome).toBe("allowed");
    if (verdict.outcome === "allowed") {
      expect(verdict.rootEntityId).toBe("entity-a");
      expect(verdict.gateId).toBe("gate-0001");
      expect(verdict.traceId).toBe("trace:0001");
      expect(verdict.edges.map((e) => e.edgeId)).toEqual(["edge-e1", "edge-e8", "edge-e2"]);
      expect(verdict.nodes.map((n) => n.entityId)).toEqual(["entity-a", "entity-b", "entity-r", "entity-c"]);
      expect(verdict.truncated).toBe(false);
      expect(verdict.excluded.non_published).toBe(1);
      expect(verdict.excluded.endpoint_retired).toBe(1);
      expect(verdict.excluded.foreign_tenant).toBe(1);
      expect(verdict.excluded.cross_tenant_unfederated).toBe(1);
      expect(verdict.excluded.low_confidence).toBe(1);
      expect(verdict.excluded.sensitivity_above_clearance).toBe(0);
    }
  });

  it("never returns nodes or edges above the gate's sensitivity ceiling", () => {
    const verdict = evaluateTraversal(
      traversalRequest(),
      gate({ sensitivityCeiling: "internal" }),
      entities,
      edges,
      NOW,
    );
    expect(verdict.outcome).toBe("allowed");
    if (verdict.outcome === "allowed") {
      expect(verdict.edges.map((e) => e.edgeId)).toEqual(["edge-e1"]);
      for (const node of verdict.nodes) {
        expect(node.sensitivity).not.toBe("restricted");
      }
      expect(verdict.excluded.sensitivity_above_clearance).toBe(1);
      expect(verdict.excluded.endpoint_above_clearance).toBe(1);
    }
  });

  it("honours the consumer's minimum-confidence floor", () => {
    const verdict = evaluateTraversal(traversalRequest({ minConfidence: 0.95 }), gate(), entities, edges, NOW);
    expect(verdict.outcome).toBe("allowed");
    if (verdict.outcome === "allowed") {
      expect(verdict.edges).toEqual([]);
      expect(verdict.excluded.low_confidence).toBe(7);
    }
  });

  it("includes a federated cross-tenant edge only under a matching federation agreement", () => {
    const without = evaluateTraversal(traversalRequest(), gate(), entities, edges, NOW);
    if (without.outcome === "allowed") {
      expect(without.edges.map((e) => e.edgeId)).not.toContain("edge-e6");
      expect(without.excluded.cross_tenant_unfederated).toBe(1);
    }
    const withAgreement = evaluateTraversal(
      traversalRequest(),
      gate({ federationRefs: ["federation:1"] }),
      entities,
      edges,
      NOW,
    );
    expect(withAgreement.outcome).toBe("allowed");
    if (withAgreement.outcome === "allowed") {
      expect(withAgreement.edges.map((e) => e.edgeId)).toContain("edge-e6");
      expect(withAgreement.excluded.cross_tenant_unfederated).toBe(0);
      expect(withAgreement.nodes.map((n) => n.entityId)).toContain("entity-g");
    }
  });

  it("excludes a malformed candidate edge defensively — it never leaks into the result", () => {
    const brokenEdges = [
      edge({
        edgeId: "edge-bad-fed",
        sourceEntityId: "entity-a",
        targetEntityId: "entity-g",
        authorization: {
          visibility: "federated",
          sensitivity: "internal",
          federationRef: "federation:1",
        },
      }),
    ];
    const verdict = evaluateTraversal(
      traversalRequest(),
      gate({ federationRefs: ["federation:1"] }),
      [entity(), entity({ entityId: "entity-g", tenantRef: "tenant-2" })],
      brokenEdges,
      NOW,
    );
    expect(verdict.outcome).toBe("allowed");
    if (verdict.outcome === "allowed") {
      expect(verdict.edges).toEqual([]);
      expect(verdict.excluded.malformed_edge).toBe(1);
    }
  });

  it("respects depth bounds and never traverses through non-published edges", () => {
    const verdict = evaluateTraversal(
      traversalRequest({ maxDepth: 1 }),
      gate({ sensitivityCeiling: "restricted", federationRefs: ["federation:1"] }),
      entities,
      edges,
      NOW,
    );
    expect(verdict.outcome).toBe("allowed");
    if (verdict.outcome === "allowed") {
      expect(verdict.edges.map((e) => e.edgeId)).toEqual(["edge-e1", "edge-e6", "edge-e8"]);
      expect(verdict.nodes.map((n) => n.entityId)).toEqual(["entity-a", "entity-b", "entity-g", "entity-r"]);
    }
  });

  it("marks truncation honestly when the edge budget is reached", () => {
    const verdict = evaluateTraversal(
      traversalRequest({ maxEdges: 1 }),
      gate({ sensitivityCeiling: "restricted" }),
      entities,
      edges,
      NOW,
    );
    expect(verdict.outcome).toBe("allowed");
    if (verdict.outcome === "allowed") {
      expect(verdict.edges.length).toBe(1);
      expect(verdict.truncated).toBe(true);
    }
  });

  it("direction outbound never walks inbound edges back to the root", () => {
    const localEntities = [
      entity(),
      entity({ entityId: "entity-b", label: "Entity B" }),
      entity({ entityId: "entity-r", label: "Entity R" }),
    ];
    const localEdges = [
      edge(),
      edge({ edgeId: "edge-e9", sourceEntityId: "entity-r", targetEntityId: "entity-a" }),
    ];
    const outbound = evaluateTraversal(
      traversalRequest({ direction: "outbound" }),
      gate(),
      localEntities,
      localEdges,
      NOW,
    );
    expect(outbound.outcome).toBe("allowed");
    if (outbound.outcome === "allowed") {
      expect(outbound.edges.map((e) => e.edgeId)).toEqual(["edge-e1"]);
      expect(outbound.nodes.map((n) => n.entityId)).toEqual(["entity-a", "entity-b"]);
    }
    const both = evaluateTraversal(
      traversalRequest({ direction: "both" }),
      gate(),
      localEntities,
      localEdges,
      NOW,
    );
    expect(both.outcome).toBe("allowed");
    if (both.outcome === "allowed") {
      expect(both.edges.map((e) => e.edgeId)).toEqual(["edge-e1", "edge-e9"]);
      expect(both.nodes.map((n) => n.entityId)).toEqual(["entity-a", "entity-b", "entity-r"]);
    }
  });

  it("returns node metadata without payload references", () => {
    const verdict = evaluateTraversal(traversalRequest(), gate(), entities, edges, NOW);
    expect(verdict.outcome).toBe("allowed");
    if (verdict.outcome === "allowed") {
      for (const node of verdict.nodes) {
        expect(Object.keys(node).sort()).toEqual(["entityId", "entityKind", "label", "sensitivity"]);
        expect("payloadRefs" in node).toBe(false);
      }
    }
  });

  it("is deterministic for identical inputs", () => {
    const first = evaluateTraversal(traversalRequest(), gate(), entities, edges, NOW);
    const second = evaluateTraversal(traversalRequest(), gate(), entities, edges, NOW);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

/* ─────────────── authorized entity view ─────────────── */

describe("authorizedEntityView is the only entity read surface", () => {
  it("denies every read without a gate", () => {
    expect(authorizedEntityView(entity(), undefined, NOW, caller())).toEqual({
      outcome: "denied",
      reason: "no_gate_presented",
    });
  });

  it("denies a malformed caller or entity with a typed reason", () => {
    expect(
      authorizedEntityView(entity(), gate(), NOW, { principalRef: "", purposeRef: "purpose:ops" }),
    ).toEqual({ outcome: "denied", reason: "caller_malformed" });
    expect(
      authorizedEntityView({ ...entity(), entityId: 7 } as unknown as GraphEntity, gate(), NOW, caller()),
    ).toEqual({ outcome: "denied", reason: "entity_malformed" });
  });

  it("denies retired entities before consulting the gate", () => {
    expect(
      authorizedEntityView(entity({ entityId: "entity-d", retiredAt: LATER, updatedAt: LATER }), gate(), NOW, caller()),
    ).toEqual({ outcome: "denied", reason: "entity_retired" });
  });

  it("binds the gate to the caller: tenant, principal, purpose, decision, expiry, ceiling", () => {
    expect(authorizedEntityView(entity({ tenantRef: "tenant-2" }), gate(), NOW, caller())).toEqual({
      outcome: "denied",
      reason: "tenant_mismatch",
    });
    expect(
      authorizedEntityView(entity(), gate(), NOW, caller({ principalRef: "principal:beta" })),
    ).toEqual({ outcome: "denied", reason: "principal_mismatch" });
    expect(
      authorizedEntityView(entity(), gate(), NOW, caller({ purposeRef: "purpose:other" })),
    ).toEqual({ outcome: "denied", reason: "purpose_mismatch" });
    expect(authorizedEntityView(entity(), gate(), AFTER_EXPIRY, caller())).toEqual({
      outcome: "denied",
      reason: "gate_expired",
    });
    expect(authorizedEntityView(entity(), gate({ decision: "deny" }), NOW, caller())).toEqual({
      outcome: "denied",
      reason: "decision_not_permitted",
    });
    expect(
      authorizedEntityView(
        entity({ sensitivity: "restricted" }),
        gate({ sensitivityCeiling: "internal" }),
        NOW,
        caller(),
      ),
    ).toEqual({ outcome: "denied", reason: "sensitivity_exceeds_clearance" });
  });

  it("denies a redact decision at the entity level (views need ALLOW)", () => {
    expect(
      authorizedEntityView(
        entity(),
        gate({ decision: "redact", redactionDirectives: ["x"] }),
        NOW,
        caller(),
      ),
    ).toEqual({ outcome: "denied", reason: "decision_not_permitted" });
  });

  it("opens metadata only behind a valid allow gate — never payload references", () => {
    const view = authorizedEntityView(entity(), gate(), NOW, caller());
    expect(view.outcome).toBe("allowed");
    if (view.outcome === "allowed") {
      expect(view.entityId).toBe("entity-a");
      expect(view.entityKind).toBe("organization");
      expect(view.sensitivity).toBe("internal");
      expect(view.provenance.aiGenerated).toBe(false);
      expect(Object.keys(view).sort()).toEqual([
        "confidence",
        "entityId",
        "entityKind",
        "gateId",
        "label",
        "outcome",
        "provenance",
        "sensitivity",
        "traceId",
      ]);
      expect("payloadRefs" in view).toBe(false);
    }
  });
});

/* ─────────────── relationship publication ─────────────── */

describe("publishRelationship enforces the governance floor", () => {
  const nodes = [entity(), entity({ entityId: "entity-b" }), entity({ entityId: "entity-f", tenantRef: "tenant-2" }), entity({ entityId: "entity-d", retiredAt: EARLIER })];

  it("publishes a proposed, well-governed edge and stamps the lifecycle", () => {
    const result = publishRelationship(edge({ lifecycle: "proposed" }), nodes, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lifecycle).toBe("published");
      expect(result.value.updatedAt).toBe(NOW);
      expect(result.value.createdAt).toBe(EARLIER);
    }
  });

  it("denies edges below the publish confidence floor", () => {
    expect(GRAPH_CONFIDENCE_PUBLISH_FLOOR).toBe(0.5);
    expect(
      publishRelationship(
        edge({ lifecycle: "proposed", confidence: { value: 0.49, tier: "medium" } }),
        nodes,
        NOW,
      ),
    ).toEqual({ ok: false, error: "confidence_below_floor" });
  });

  it("denies missing, retired or cross-tenant endpoints for a tenant-scoped edge", () => {
    expect(
      publishRelationship(edge({ lifecycle: "proposed", targetEntityId: "entity-zzz" }), nodes, NOW),
    ).toEqual({ ok: false, error: "endpoint_missing" });
    expect(
      publishRelationship(edge({ lifecycle: "proposed", targetEntityId: "entity-d" }), nodes, NOW),
    ).toEqual({ ok: false, error: "endpoint_retired" });
    expect(
      publishRelationship(edge({ lifecycle: "proposed", targetEntityId: "entity-f" }), nodes, NOW),
    ).toEqual({ ok: false, error: "endpoint_tenant_mismatch" });
  });

  it("denies non-proposed edges and malformed input", () => {
    expect(publishRelationship(edge(), nodes, NOW)).toEqual({ ok: false, error: "not_publishable" });
    expect(
      publishRelationship(edge({ lifecycle: "proposed", sourceEntityId: "entity-b" }), nodes, NOW),
    ).toEqual({ ok: false, error: "edge_malformed" });
  });

  it("publishes a federated cross-tenant edge only when it carries approval", () => {
    const federated = edge({
      lifecycle: "proposed",
      targetEntityId: "entity-f",
      authorization: {
        visibility: "federated",
        sensitivity: "internal",
        federationRef: "federation:1",
        approvalRef: "approval:fed-1",
      },
    });
    expect(publishRelationship(federated, nodes, NOW).ok).toBe(true);
  });
});

/* ─────────────── lifecycle transitions ─────────────── */

describe("edge lifecycle transitions are explicit and revision-carrying", () => {
  it("advances only along the legal chain", () => {
    let current = edge({ lifecycle: "proposed" });
    const chain: Array<["published" | "superseded", string]> = [
      ["published", "publish after governance check"],
      ["superseded", "replaced by corrected edge"],
    ];
    for (const [target, reason] of chain) {
      const result = applyEdgeLifecycleTransition(
        current,
        target,
        revision({ previousLifecycle: current.lifecycle, newLifecycle: target, reason }),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.lifecycle).toBe(target);
        expect(result.value.updatedAt).toBe(NOW);
        current = result.value;
      }
    }
  });

  it("denies unknown transitions and terminal states", () => {
    const proposed = edge({ lifecycle: "proposed" });
    expect(
      applyEdgeLifecycleTransition(
        proposed,
        "superseded",
        revision({ previousLifecycle: "proposed", newLifecycle: "superseded" }),
      ),
    ).toEqual({ ok: false, error: "unknown_transition" });
    const superseded = edge({ lifecycle: "superseded", supersededById: "edge-e9" });
    expect(
      applyEdgeLifecycleTransition(
        superseded,
        "published",
        revision({ previousLifecycle: "superseded", newLifecycle: "published" }),
      ),
    ).toEqual({ ok: false, error: "unknown_transition" });
    const retracted = edge({ lifecycle: "retracted", retraction: retraction() });
    expect(
      applyEdgeLifecycleTransition(
        retracted,
        "published",
        revision({ previousLifecycle: "retracted", newLifecycle: "published" }),
      ),
    ).toEqual({ ok: false, error: "unknown_transition" });
  });

  it("denies id mismatch, state mismatch and target mismatch", () => {
    const proposed = edge({ lifecycle: "proposed" });
    expect(
      applyEdgeLifecycleTransition(
        proposed,
        "published",
        revision({ edgeId: "edge-other" }),
      ),
    ).toEqual({ ok: false, error: "edge_id_mismatch" });
    expect(
      applyEdgeLifecycleTransition(proposed, "published", revision({ previousLifecycle: "retracted" })),
    ).toEqual({ ok: false, error: "revision_previous_state_mismatch" });
    expect(
      applyEdgeLifecycleTransition(
        proposed,
        "published",
        revision({ previousLifecycle: "proposed", newLifecycle: "superseded" }),
      ),
    ).toEqual({ ok: false, error: "revision_target_mismatch" });
    expect(
      applyEdgeLifecycleTransition(proposed, "proposed", revision()),
    ).toEqual({ ok: false, error: "target_equals_current" });
  });

  it("denies malformed edges and revisions, and requires approval for retraction", () => {
    const proposed = edge({ lifecycle: "proposed" });
    expect(
      applyEdgeLifecycleTransition({ ...proposed, tenantRef: "" } as unknown as GraphRelationship, "published", revision()),
    ).toEqual({ ok: false, error: "edge_malformed" });
    expect(
      applyEdgeLifecycleTransition(proposed, "published", { revisionId: "" } as unknown as GraphEdgeRevision),
    ).toEqual({ ok: false, error: "revision_malformed" });
    expect(
      applyEdgeLifecycleTransition(
        edge({ lifecycle: "published" }),
        "retracted",
        revision({ previousLifecycle: "published", newLifecycle: "retracted" }),
      ),
    ).toEqual({ ok: false, error: "missing_approval" });
    expect(
      applyEdgeLifecycleTransition(
        edge({ lifecycle: "published" }),
        "retracted",
        revision({ previousLifecycle: "published", newLifecycle: "retracted", approvalRef: "approval:1" }),
      ).ok,
    ).toBe(true);
  });
});

/* ─────────────── governed retraction ─────────────── */

describe("retraction is governed, reason-carrying and terminal", () => {
  it("retracts a published edge with a reason and stamps the retraction", () => {
    const result = retractRelationship(edge(), retraction());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lifecycle).toBe("retracted");
      expect(result.value.retraction).toEqual(retraction());
      expect(result.value.updatedAt).toBe(NOW);
      expect(parseGraphRelationship(result.value).ok).toBe(true);
    }
  });

  it("denies malformed input, double retraction and non-retractable states", () => {
    expect(retractRelationship(edge(), { reason: "" } as unknown as GraphRetraction)).toEqual({
      ok: false,
      error: "retraction_malformed",
    });
    const first = retractRelationship(edge(), retraction());
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(retractRelationship(first.value, retraction())).toEqual({
        ok: false,
        error: "already_retracted",
      });
    }
    expect(
      retractRelationship(
        edge({ lifecycle: "proposed" }),
        retraction(),
      ),
    ).toEqual({ ok: false, error: "lifecycle_not_retractable" });
    expect(
      retractRelationship({ ...edge(), edgeId: 5 } as unknown as GraphRelationship, retraction()),
    ).toEqual({ ok: false, error: "edge_malformed" });
  });

  it("makes a retracted edge unreachable through traversal", () => {
    const result = retractRelationship(edge(), retraction());
    if (result.ok) {
      const verdict = evaluateTraversal(
        traversalRequest(),
        gate(),
        [entity(), entity({ entityId: "entity-b" })],
        [result.value],
        NOW,
      );
      expect(verdict.outcome).toBe("allowed");
      if (verdict.outcome === "allowed") {
        expect(verdict.edges).toEqual([]);
        expect(verdict.excluded.non_published).toBe(1);
      }
    }
  });
});

/* ─────────────── purity ─────────────── */

describe("purity: injected time and immutable inputs", () => {
  it("never mutates inputs", () => {
    const { entities, edges } = graphFixtures();
    const sourceGate = gate();
    const sourceRequest = traversalRequest();
    const sourceEntity = entities[0];
    const sourceEdge = edges[0];
    const before = JSON.stringify([entities, edges, sourceGate, sourceRequest]);

    evaluateTraversal(sourceRequest, sourceGate, entities, edges, NOW);
    authorizedEntityView(sourceEntity, sourceGate, NOW, caller());
    publishRelationship(edge({ lifecycle: "proposed" }), entities, NOW);
    applyEdgeLifecycleTransition(sourceEdge, "superseded", revision({ previousLifecycle: "published", newLifecycle: "superseded" }));
    retractRelationship(sourceEdge, retraction());

    const after = JSON.stringify([entities, edges, sourceGate, sourceRequest]);
    expect(after).toBe(before);
  });

  it("is driven entirely by injected instants — same inputs, different now, different verdict", () => {
    const { entities, edges } = graphFixtures();
    expect(evaluateTraversal(traversalRequest(), gate(), entities, edges, NOW).outcome).toBe("allowed");
    expect(evaluateTraversal(traversalRequest(), gate(), entities, edges, AFTER_EXPIRY)).toEqual({
      outcome: "denied",
      reason: "gate_expired",
    });
  });
});