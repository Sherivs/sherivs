/**
 * CoreGrid — phase 48 Civilization Knowledge Graph substrate contracts
 * (H3 wave, Squad G, mission G-068 — Contract Architect).
 *
 * WHAT: the typed, Zod-validated contract surface for the phase-48 knowledge
 * graph substrate — entities, relationships, provenance, ownership,
 * authorization, confidence, relationship publication, authorization-gated
 * traversal, authorized entity views, lifecycle transitions and governed
 * retraction.
 *
 * ARCHITECTURAL POSTURE (non-negotiable, encoded below and proven in tests):
 * - EVERY RELATIONSHIP CARRIES THE FOUR GOVERNANCE FIELDS (AGENTS §11):
 *   provenance, ownership, authorization and confidence are MANDATORY fields
 *   of every relationship. An edge missing any of the four does not parse, and
 *   an unparsed edge is never published, traversed or disclosed. An edge
 *   without all four is not published to consumers (phase contract principle).
 * - AN EDGE IS NOT A PERMISSION: the graph records relationships, never
 *   permissions — an edge existing between two entities never implies that
 *   either party may read the other. Every read surface (traversal, entity
 *   view) demands a presented, valid authorization gate and fails CLOSED to a
 *   typed denial otherwise. Filtering happens at QUERY TIME, never by hiding
 *   edges in place: the stored edge keeps its four governance fields, the
 *   traversal simply never returns an edge the gate does not authorize.
 * - CROSS-TENANT EDGES ARE INVISIBLE WITHOUT A FEDERATION AGREEMENT
 *   (AGENTS §13): a tenant-scoped edge traverses only within its tenant; a
 *   federated edge is structurally invalid without a federation reference AND
 *   an approval reference (kernel contract `requiresApprovalFor`:
 *   cross-tenant-edge-creation), and traversal includes it only when the
 *   presented gate carries the matching federation reference.
 * - CANONICAL TRUTH SEPARATION (AGENTS §9): an edge is either `asserted`
 *   (canonical — recorded from a verified source) or `inferred` (derived —
 *   intelligence). Inferred edges MUST cite an inference method and are never
 *   presented as asserted facts. The graph stores REFERENCES to payloads held
 *   by owning substrates and never carries the payloads themselves — it must
 *   not become a shadow copy of domain records (kernel boundary statement).
 * - CONFIDENCE IS BANDED, NOT FREE-FORM: every confidence value carries a
 *   tier and the tier must match the numeric band (confirmed ≥ 0.95,
 *   high ≥ 0.75, medium ≥ 0.4, unknown < 0.4). High/confirmed edges must cite
 *   evidence. Publication requires a minimum confidence floor; traversal
 *   honours the consumer's declared minimum and silently-filtered edges are
 *   counted, never absorbed.
 * - DENY BY DEFAULT: the default decision of this substrate is DENY. Missing
 *   gates, malformed requests, expired gates, mismatched tenants/principals/
 *   purposes, retired entities and non-published edges all fail closed with a
 *   typed reason — never clamped, never partially satisfied.
 *
 * PURITY: this is a typed CONTRACT module — no I/O, no persistence, no vendor
 * imports, no network, no wall-clock sampling. Time is always injected as an
 * ISO-8601 instant. Inputs are never mutated; every transition returns a
 * fresh record. It grants no authority of its own: it bounds reads that a
 * server-side authorization layer has already authenticated (Constitution
 * §15/§17 — one layer, never the only one).
 *
 * Composition (read-only): the module binds to the phase-48 kernel contract
 * (`../kernel/phase-contracts/phase-48-knowledge-graph`) and reuses the
 * platform sensitivity vocabulary from `../context-assembly` — it redefines
 * neither. No sibling H3 module is imported.
 */

import { z } from "zod";
import type { ContextSensitivity } from "../context-assembly";
import { PHASE_48_KNOWLEDGE_GRAPH } from "../kernel/phase-contracts/phase-48-knowledge-graph";

/* ─────────────────────────────────────────────────────────────
 * Module posture (composed from the kernel phase contract)
 * ────────────────────────────────────────────────────────────*/

export const KNOWLEDGE_GRAPH_MODULE_ID = "phase-48/knowledge-graph/h3-068";

/** Fail-closed posture of this substrate, composed from the kernel contract. */
export const KNOWLEDGE_GRAPH_CONTRACT_POSTURE = {
  moduleId: KNOWLEDGE_GRAPH_MODULE_ID,
  phaseId: PHASE_48_KNOWLEDGE_GRAPH.id,
  phaseName: PHASE_48_KNOWLEDGE_GRAPH.name,
  phaseCapability: PHASE_48_KNOWLEDGE_GRAPH.capabilities.owns[0] ?? "",
  boundary: PHASE_48_KNOWLEDGE_GRAPH.boundary.statement,
  defaultDecision: "deny" as const,
  traversalPolicy: "authorization-gated-query-time-filtered" as const,
  relationshipPolicy: "provenance-ownership-authorization-confidence-mandatory" as const,
  inferencePolicy: "derived-labelled-method-cited" as const,
  approvalRequiredFor: PHASE_48_KNOWLEDGE_GRAPH.asi.autonomy.requiresApprovalFor,
} as const;

/* ─────────────────────────────────────────────────────────────
 * Vocabulary
 * ────────────────────────────────────────────────────────────*/

/** Universal entity kinds (phase §Domain 02 — the neutral substrate set). */
export const GRAPH_ENTITY_KINDS = [
  "human",
  "organization",
  "agent",
  "machine",
  "location",
  "event",
  "concept",
  "technology",
  "resource",
  "process",
  "document",
  "system",
  "runtime",
] as const;
export type GraphEntityKind = (typeof GRAPH_ENTITY_KINDS)[number];

/** Relationship kinds (phase §Domain 03 — neutral, generic verbs). */
export const GRAPH_RELATION_KINDS = [
  "owns",
  "creates",
  "depends_on",
  "located_in",
  "causes",
  "influences",
  "uses",
  "competes_with",
  "learns_from",
  "connected_to",
] as const;
export type GraphRelationKind = (typeof GRAPH_RELATION_KINDS)[number];

/** Confidence tiers (phase §Domain 12), lowest to highest band. */
export const GRAPH_CONFIDENCE_TIERS = ["unknown", "medium", "high", "confirmed"] as const;
export type GraphConfidenceTier = (typeof GRAPH_CONFIDENCE_TIERS)[number];

/** Numeric bands backing the tiers; a tier must match its band (fail-closed). */
export const GRAPH_CONFIDENCE_BANDS: Readonly<
  Record<GraphConfidenceTier, { readonly min: number; readonly max: number }>
> = {
  unknown: { min: 0, max: 0.4 },
  medium: { min: 0.4, max: 0.75 },
  high: { min: 0.75, max: 0.95 },
  confirmed: { min: 0.95, max: 1 },
};

/** Whether an edge is recorded fact or derived intelligence (AGENTS §9). */
export const GRAPH_EDGE_ORIGINS = ["asserted", "inferred"] as const;
export type GraphEdgeOrigin = (typeof GRAPH_EDGE_ORIGINS)[number];

/** Edge lifecycle (strict forward chain; `retracted` is terminal). */
export const GRAPH_EDGE_LIFECYCLE_STATES = [
  "proposed",
  "published",
  "superseded",
  "retracted",
] as const;
export type GraphEdgeLifecycleState = (typeof GRAPH_EDGE_LIFECYCLE_STATES)[number];

export const GRAPH_EDGE_LIFECYCLE_TRANSITIONS: Readonly<
  Record<GraphEdgeLifecycleState, readonly GraphEdgeLifecycleState[]>
> = {
  proposed: ["published"],
  published: ["superseded", "retracted"],
  superseded: [],
  retracted: [],
};

/** Whether traversal sees an edge only in-tenant or under a federation agreement. */
export const GRAPH_EDGE_VISIBILITIES = ["tenant_scoped", "federated"] as const;
export type GraphEdgeVisibility = (typeof GRAPH_EDGE_VISIBILITIES)[number];

/** Authorization decisions (Constitution §16), lowercase contract form. */
export const GRAPH_AUTHORIZATION_DECISIONS = [
  "allow",
  "deny",
  "redact",
  "escalate",
  "require_approval",
] as const;
export type GraphAuthorizationDecision = (typeof GRAPH_AUTHORIZATION_DECISIONS)[number];

/** Origin kinds for provenance (AGENTS §12 — AI-generated is always declared). */
export const GRAPH_ORIGIN_KINDS = ["human", "agent", "system", "external"] as const;
export type GraphOriginKind = (typeof GRAPH_ORIGIN_KINDS)[number];

/** Sensitivity vocabulary — reused from context-assembly, never redefined. */
export type GraphSensitivity = ContextSensitivity;

export const GRAPH_SENSITIVITIES: readonly GraphSensitivity[] = [
  "public",
  "internal",
  "restricted",
] as const;

const SENSITIVITY_RANK: Record<GraphSensitivity, 0 | 1 | 2> = {
  public: 0,
  internal: 1,
  restricted: 2,
};

/** Minimum confidence for an edge to be publishable to consumers. */
export const GRAPH_CONFIDENCE_PUBLISH_FLOOR = 0.5;

/* ─────────────────────────────────────────────────────────────
 * Primitive schemas
 * ────────────────────────────────────────────────────────────*/

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const REF_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_:.\-/]{0,199}$/;

function boundedText(label: string, max: number) {
  return z
    .string()
    .min(1, `${label} must be a non-empty string`)
    .max(max, `${label} must be at most ${max} characters`)
    .refine((value) => value.trim().length > 0, `${label} must not be blank`);
}

function refField(label: string, max = 200) {
  return z
    .string()
    .regex(
      REF_PATTERN,
      `${label} must be a bounded reference identifier (at most ${max} characters)`,
    );
}

export const graphIdentifierSchema = z
  .string()
  .regex(
    IDENTIFIER_PATTERN,
    "identifier must be a lowercase identifier (letters, digits, underscore, hyphen; starts with a letter; at most 64 characters)",
  );

export const graphInstantSchema = z.string().datetime();

export const graphSensitivitySchema = z.enum(
  GRAPH_SENSITIVITIES as [GraphSensitivity, ...GraphSensitivity[]],
);

/* ─────────────────────────────────────────────────────────────
 * Provenance (phase §Domain 13; AGENTS §11/§12)
 * ────────────────────────────────────────────────────────────*/

export const graphProvenanceSchema = z.strictObject({
  createdBy: boundedText("provenance.createdBy", 160),
  originKind: z.enum(GRAPH_ORIGIN_KINDS),
  originRef: refField("provenance.originRef"),
  createdAt: graphInstantSchema,
  /** Declared, never inferred: AI-generated material must say so. */
  aiGenerated: z.boolean(),
  /** Mandatory on inferred edges; forbidden on asserted edges (AGENTS §9). */
  inferenceMethodRef: refField("provenance.inferenceMethodRef").optional(),
  /** Ordered transformation history references (at most 32). */
  transformationRefs: z.array(refField("provenance.transformationRef")).max(32),
  /** Ordered validation history references (at most 32). */
  validationRefs: z.array(refField("provenance.validationRef")).max(32),
});

export type GraphProvenance = z.infer<typeof graphProvenanceSchema>;

/* ─────────────────────────────────────────────────────────────
 * Governance blocks (AGENTS §11 — all four mandatory per relationship)
 * ────────────────────────────────────────────────────────────*/

export const graphOwnershipSchema = z.strictObject({
  /** The accountable owner of the relationship record itself. */
  ownerRef: refField("ownership.ownerRef"),
});

export type GraphOwnership = z.infer<typeof graphOwnershipSchema>;

export const graphEdgeAuthorizationSchema = z.strictObject({
  visibility: z.enum(GRAPH_EDGE_VISIBILITIES),
  sensitivity: graphSensitivitySchema,
  /** Mandatory when `visibility` is `federated`; forbidden otherwise. */
  federationRef: refField("authorization.federationRef").optional(),
  /** Approval reference — mandatory on federated (cross-tenant) edges. */
  approvalRef: refField("authorization.approvalRef").optional(),
});

export type GraphEdgeAuthorization = z.infer<typeof graphEdgeAuthorizationSchema>;

export const graphConfidenceSchema = z
  .strictObject({
    value: z.number().min(0).max(1),
    tier: z.enum(GRAPH_CONFIDENCE_TIERS),
  })
  .refine((confidence) => {
    const band = GRAPH_CONFIDENCE_BANDS[confidence.tier];
    return (
      confidence.value >= band.min &&
      (confidence.tier === "confirmed"
        ? confidence.value <= band.max
        : confidence.value < band.max)
    );
  }, "confidence tier must match the numeric band (unknown < 0.4, medium < 0.75, high < 0.95, confirmed ≥ 0.95)");

export type GraphConfidence = z.infer<typeof graphConfidenceSchema>;

/* ─────────────────────────────────────────────────────────────
 * Graph entity (phase §Domain 01/02 — reference-only, no payloads)
 * ────────────────────────────────────────────────────────────*/

export const graphEntitySchema = z
  .strictObject({
    entityId: graphIdentifierSchema,
    tenantRef: refField("entity.tenantRef"),
    entityKind: z.enum(GRAPH_ENTITY_KINDS),
    label: boundedText("entity.label", 200),
    sensitivity: graphSensitivitySchema,
    provenance: graphProvenanceSchema,
    confidence: z.number().min(0).max(1),
    /** References to payloads held by owning substrates — never inline payloads. */
    payloadRefs: z.array(refField("entity.payloadRef")).max(8),
    createdAt: graphInstantSchema,
    updatedAt: graphInstantSchema,
    /** Mandatory when the entity is retired; forbidden otherwise. */
    retiredAt: graphInstantSchema.optional(),
  })
  .superRefine((entity, ctx) => {
    if (entity.retiredAt !== undefined && !isBefore(entity.createdAt, entity.retiredAt)) {
      ctx.addIssue({
        code: "custom",
        message: "a retired entity's retiredAt must be after createdAt",
      });
    }
  });

export type GraphEntity = z.infer<typeof graphEntitySchema>;

/* ─────────────────────────────────────────────────────────────
 * Graph relationship (phase §Domain 03 — the four §11 fields mandatory)
 * ────────────────────────────────────────────────────────────*/

export const graphRetractionSchema = z.strictObject({
  reason: boundedText("retraction.reason", 400),
  retractedByRef: refField("retraction.retractedByRef"),
  retractedAt: graphInstantSchema,
});

export type GraphRetraction = z.infer<typeof graphRetractionSchema>;

export const graphRelationshipSchema = z
  .strictObject({
    edgeId: graphIdentifierSchema,
    tenantRef: refField("edge.tenantRef"),
    relationKind: z.enum(GRAPH_RELATION_KINDS),
    sourceEntityId: graphIdentifierSchema,
    targetEntityId: graphIdentifierSchema,
    origin: z.enum(GRAPH_EDGE_ORIGINS),
    /** AGENTS §11 — mandatory. */
    provenance: graphProvenanceSchema,
    /** AGENTS §11 — mandatory. */
    ownership: graphOwnershipSchema,
    /** AGENTS §11 — mandatory. */
    authorization: graphEdgeAuthorizationSchema,
    /** AGENTS §11 — mandatory. */
    confidence: graphConfidenceSchema,
    /** Cited evidence; high/confirmed edges must cite at least one. */
    evidenceRefs: z.array(refField("edge.evidenceRef")).max(16),
    lifecycle: z.enum(GRAPH_EDGE_LIFECYCLE_STATES),
    createdAt: graphInstantSchema,
    updatedAt: graphInstantSchema,
    /** Mandatory when `lifecycle` is `superseded`; forbidden otherwise. */
    supersededById: graphIdentifierSchema.optional(),
    /** Mandatory when `lifecycle` is `retracted`; forbidden otherwise. */
    retraction: graphRetractionSchema.optional(),
  })
  .superRefine((edge, ctx) => {
    if (edge.sourceEntityId === edge.targetEntityId) {
      ctx.addIssue({
        code: "custom",
        message: "a relationship must connect two distinct entities (no self-loops)",
      });
    }
    if (edge.authorization.visibility === "federated") {
      if (edge.authorization.federationRef === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "a federated edge must carry a federationRef (cross-tenant is never implicit)",
        });
      }
      if (edge.authorization.approvalRef === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "a federated edge must carry an approvalRef (cross-tenant-edge-creation is approval-gated)",
        });
      }
    } else if (edge.authorization.federationRef !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "federationRef is only permitted on a federated edge",
      });
    }
    if (edge.origin === "inferred" && edge.provenance.inferenceMethodRef === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "an inferred edge must cite an inferenceMethodRef (derived intelligence is labelled)",
      });
    }
    if (edge.origin === "asserted" && edge.provenance.inferenceMethodRef !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "inferenceMethodRef is only permitted on an inferred edge",
      });
    }
    if ((edge.confidence.tier === "high" || edge.confidence.tier === "confirmed") && edge.evidenceRefs.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "high or confirmed confidence must cite at least one evidenceRef",
      });
    }
    if (edge.lifecycle === "superseded") {
      if (edge.supersededById === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "a superseded edge must carry supersededById",
        });
      }
      if (edge.retraction !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: "retraction is only permitted on a retracted edge",
        });
      }
    } else if (edge.lifecycle === "retracted") {
      if (edge.retraction === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "a retracted edge must carry a retraction",
        });
      }
    } else {
      if (edge.supersededById !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: "supersededById is only permitted on a superseded edge",
        });
      }
      if (edge.retraction !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: "retraction is only permitted on a retracted edge",
        });
      }
    }
  });

export type GraphRelationship = z.infer<typeof graphRelationshipSchema>;

/* ─────────────────────────────────────────────────────────────
 * Authorization gate (AGENTS §16/§19 — same deny-by-default shape as the
 * platform recall gates; presented per request, never ambient)
 * ────────────────────────────────────────────────────────────*/

export const graphAuthorizationGateSchema = z
  .strictObject({
    gateId: refField("gate.gateId"),
    decision: z.enum(GRAPH_AUTHORIZATION_DECISIONS),
    principalRef: refField("gate.principalRef"),
    tenantRef: refField("gate.tenantRef"),
    purposeRef: refField("gate.purposeRef"),
    /** Upper bound of sensitivity this gate may open. */
    sensitivityCeiling: graphSensitivitySchema,
    /** Federation agreements the gate's principal may traverse under. */
    federationRefs: z.array(refField("gate.federationRef")).max(16),
    /** Directives describing WHAT is redacted — mandatory when decision is `redact`. */
    redactionDirectives: z.array(boundedText("gate.redactionDirective", 160)).max(16),
    decidedAt: graphInstantSchema,
    expiresAt: graphInstantSchema,
    authorityRef: refField("gate.authorityRef"),
    traceId: refField("gate.traceId"),
  })
  .superRefine((gate, ctx) => {
    if (!isBefore(gate.decidedAt, gate.expiresAt)) {
      ctx.addIssue({
        code: "custom",
        message: "gate expiresAt must be after decidedAt (fail-closed: no eternal gate)",
      });
    }
    if (gate.decision === "redact" && gate.redactionDirectives.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "a redact decision must carry at least one redaction directive",
      });
    }
    if (gate.decision !== "redact" && gate.redactionDirectives.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: "redactionDirectives are only permitted on a redact decision",
      });
    }
  });

export type GraphAuthorizationGate = z.infer<typeof graphAuthorizationGateSchema>;

/* ─────────────────────────────────────────────────────────────
 * Traversal request (references only — never a credential or a secret)
 * ────────────────────────────────────────────────────────────*/

export const graphTraversalRequestSchema = z.strictObject({
  rootEntityId: graphIdentifierSchema,
  tenantRef: refField("traversal.tenantRef"),
  principalRef: refField("traversal.principalRef"),
  purposeRef: refField("traversal.purposeRef"),
  direction: z.enum(["outbound", "inbound", "both"]),
  /** Hard structural bounds — depth 1 means root plus its direct edges. */
  maxDepth: z.number().int().min(1).max(6),
  maxEdges: z.number().int().min(1).max(512),
  /** Consumer confidence floor: edges below it are excluded and counted. */
  minConfidence: z.number().min(0).max(1),
});

export type GraphTraversalRequest = z.infer<typeof graphTraversalRequestSchema>;

/** The presenting caller's declared identity and purpose at view time. */
export const graphCallerContextSchema = z.strictObject({
  principalRef: refField("caller.principalRef"),
  purposeRef: refField("caller.purposeRef"),
});

export type GraphCallerContext = z.infer<typeof graphCallerContextSchema>;

/* ─────────────────────────────────────────────────────────────
 * Lifecycle revision (explicit, revision-carrying transitions)
 * ────────────────────────────────────────────────────────────*/

export const graphEdgeRevisionSchema = z.strictObject({
    revisionId: refField("revision.revisionId"),
    edgeId: graphIdentifierSchema,
    reason: boundedText("revision.reason", 400),
    contributorRef: refField("revision.contributorRef"),
    appliedAt: graphInstantSchema,
    previousLifecycle: z.enum(GRAPH_EDGE_LIFECYCLE_STATES),
    newLifecycle: z.enum(GRAPH_EDGE_LIFECYCLE_STATES),
    /**
     * Shape-level: a bounded reference; its PRESENCE for a retraction is a
     * SEMANTIC denial (`missing_approval`), checked by the execution path,
     * never the parser.
     */
    approvalRef: refField("revision.approvalRef").optional(),
  });

export type GraphEdgeRevision = z.infer<typeof graphEdgeRevisionSchema>;

/* ─────────────────────────────────────────────────────────────
 * Typed results
 * ────────────────────────────────────────────────────────────*/

export type ContractOk<T> = { readonly ok: true; readonly value: T };
export type ContractErr<E> = { readonly ok: false; readonly error: E };
export type ContractResult<T, E> = ContractOk<T> | ContractErr<E>;

export type ParseFailure =
  | "malformed_entity"
  | "malformed_edge"
  | "malformed_gate"
  | "malformed_request"
  | "malformed_revision";

export type TraversalDenialReason =
  | "request_malformed"
  | "no_gate_presented"
  | "gate_malformed"
  | "gate_expired"
  | "decision_not_permitted"
  | "tenant_mismatch"
  | "principal_mismatch"
  | "purpose_mismatch"
  | "root_entity_missing"
  | "root_entity_retired"
  | "sensitivity_exceeds_clearance";

/** Why an edge was excluded from a traversal result (observability, never silent). */
export type TraversalExclusionReason =
  | "malformed_edge"
  | "non_published"
  | "low_confidence"
  | "sensitivity_above_clearance"
  | "foreign_tenant"
  | "cross_tenant_unfederated"
  | "missing_endpoint"
  | "endpoint_retired"
  | "endpoint_above_clearance";

export type TraversalExclusions = Readonly<Record<TraversalExclusionReason, number>>;

export type SubgraphNode = {
  readonly entityId: string;
  readonly entityKind: GraphEntityKind;
  readonly label: string;
  readonly sensitivity: GraphSensitivity;
};

export type SubgraphEdge = {
  readonly edgeId: string;
  readonly relationKind: GraphRelationKind;
  readonly sourceEntityId: string;
  readonly targetEntityId: string;
  readonly origin: GraphEdgeOrigin;
  /** AGENTS §11 — the four governance fields travel with every traversed edge. */
  readonly provenance: GraphProvenance;
  readonly ownership: GraphOwnership;
  readonly authorization: Pick<GraphEdgeAuthorization, "visibility" | "sensitivity">;
  readonly confidence: GraphConfidence;
};

export type TraversalVerdict =
  | { readonly outcome: "denied"; readonly reason: TraversalDenialReason }
  | {
      readonly outcome: "redacted";
      readonly gateId: string;
      readonly traceId: string;
      readonly redactionDirectives: readonly string[];
    }
  | {
      readonly outcome: "allowed";
      readonly gateId: string;
      readonly traceId: string;
      readonly rootEntityId: string;
      readonly nodes: readonly SubgraphNode[];
      readonly edges: readonly SubgraphEdge[];
      readonly truncated: boolean;
      /** Every exclusion is counted and surfaced — nothing drops silently. */
      readonly excluded: TraversalExclusions;
    };

export type EntityViewDenialReason =
  | "entity_malformed"
  | "caller_malformed"
  | "entity_retired"
  | "no_gate_presented"
  | "gate_malformed"
  | "gate_expired"
  | "decision_not_permitted"
  | "tenant_mismatch"
  | "principal_mismatch"
  | "purpose_mismatch"
  | "sensitivity_exceeds_clearance";

export type AuthorizedEntityView =
  | { readonly outcome: "denied"; readonly reason: EntityViewDenialReason }
  | {
      readonly outcome: "allowed";
      readonly gateId: string;
      readonly traceId: string;
      /** Metadata only — payload references stay with the owning substrates. */
      readonly entityId: string;
      readonly entityKind: GraphEntityKind;
      readonly label: string;
      readonly sensitivity: GraphSensitivity;
      readonly provenance: Pick<GraphProvenance, "createdBy" | "createdAt" | "aiGenerated">;
      readonly confidence: number;
    };

export type PublishDenialReason =
  | "edge_malformed"
  | "not_publishable"
  | "confidence_below_floor"
  | "endpoint_missing"
  | "endpoint_retired"
  | "endpoint_tenant_mismatch";

export type LifecycleDenialReason =
  | "edge_malformed"
  | "revision_malformed"
  | "edge_id_mismatch"
  | "target_equals_current"
  | "unknown_transition"
  | "revision_previous_state_mismatch"
  | "revision_target_mismatch"
  | "missing_approval";

export type RetractionDenialReason =
  | "edge_malformed"
  | "retraction_malformed"
  | "edge_id_mismatch"
  | "already_retracted"
  | "lifecycle_not_retractable";

/* ─────────────────────────────────────────────────────────────
 * Internals
 * ────────────────────────────────────────────────────────────*/

function isBefore(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isFinite(ta) && Number.isFinite(tb) && ta < tb;
}

function emptyExclusions(): Record<TraversalExclusionReason, number> {
  return {
    malformed_edge: 0,
    non_published: 0,
    low_confidence: 0,
    sensitivity_above_clearance: 0,
    foreign_tenant: 0,
    cross_tenant_unfederated: 0,
    missing_endpoint: 0,
    endpoint_retired: 0,
    endpoint_above_clearance: 0,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Parse helpers — fail closed, never throw on hostile input
 * ────────────────────────────────────────────────────────────*/

export function parseGraphEntity(input: unknown): ContractResult<GraphEntity, ParseFailure> {
  const parsed = graphEntitySchema.safeParse(input);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: "malformed_entity" };
}

export function parseGraphRelationship(
  input: unknown,
): ContractResult<GraphRelationship, ParseFailure> {
  const parsed = graphRelationshipSchema.safeParse(input);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: "malformed_edge" };
}

export function parseGraphGate(
  input: unknown,
): ContractResult<GraphAuthorizationGate, ParseFailure> {
  const parsed = graphAuthorizationGateSchema.safeParse(input);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: "malformed_gate" };
}

export function parseTraversalRequest(
  input: unknown,
): ContractResult<GraphTraversalRequest, ParseFailure> {
  const parsed = graphTraversalRequestSchema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: "malformed_request" };
}

export function parseEdgeRevision(
  input: unknown,
): ContractResult<GraphEdgeRevision, ParseFailure> {
  const parsed = graphEdgeRevisionSchema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: "malformed_revision" };
}

/* ─────────────────────────────────────────────────────────────
 * Shared gate checks — the single deny path for every surface
 * ────────────────────────────────────────────────────────────*/

type GateFailure = { kind: "failure"; reason: TraversalDenialReason };
type GateSuccess = {
  kind: "success";
  gate: GraphAuthorizationGate;
};
type GateResult = GateFailure | GateSuccess;

function checkGate(
  tenantRef: string,
  principalRef: string,
  purposeRef: string,
  gate: GraphAuthorizationGate | undefined,
  now: string,
): GateResult {
  if (gate === undefined) {
    return { kind: "failure", reason: "no_gate_presented" };
  }
  if (!graphAuthorizationGateSchema.safeParse(gate).success) {
    return { kind: "failure", reason: "gate_malformed" };
  }
  if (!isBefore(now, gate.expiresAt)) {
    return { kind: "failure", reason: "gate_expired" };
  }
  if (gate.decision !== "allow" && gate.decision !== "redact") {
    return { kind: "failure", reason: "decision_not_permitted" };
  }
  if (tenantRef !== gate.tenantRef) {
    return { kind: "failure", reason: "tenant_mismatch" };
  }
  if (principalRef !== gate.principalRef) {
    return { kind: "failure", reason: "principal_mismatch" };
  }
  if (purposeRef !== gate.purposeRef) {
    return { kind: "failure", reason: "purpose_mismatch" };
  }
  return { kind: "success", gate };
}

/* ─────────────────────────────────────────────────────────────
 * Traversal — authorization-gated, query-time filtered, bounded
 * ────────────────────────────────────────────────────────────*/

export function evaluateTraversal(
  request: GraphTraversalRequest,
  gate: GraphAuthorizationGate | undefined,
  entities: readonly GraphEntity[],
  edges: readonly GraphRelationship[],
  now: string,
): TraversalVerdict {
  if (!graphTraversalRequestSchema.safeParse(request).success) {
    return { outcome: "denied", reason: "request_malformed" };
  }
  const gateResult = checkGate(
    request.tenantRef,
    request.principalRef,
    request.purposeRef,
    gate,
    now,
  );
  if (gateResult.kind === "failure") {
    return { outcome: "denied", reason: gateResult.reason };
  }
  const validGate = gateResult.gate;
  if (validGate.decision === "redact") {
    return {
      outcome: "redacted",
      gateId: validGate.gateId,
      traceId: validGate.traceId,
      redactionDirectives: [...validGate.redactionDirectives],
    };
  }

  // Defense-in-depth: unparseable entities in the candidate set can never be
  // reached — they are absent from the index, so a malformed root denies and a
  // malformed endpoint counts as missing. Nothing malformed is ever projected.
  const parsedEntities: GraphEntity[] = [];
  for (const candidate of entities) {
    if (graphEntitySchema.safeParse(candidate).success) {
      parsedEntities.push(candidate);
    }
  }
  const entityById = new Map(parsedEntities.map((entity) => [entity.entityId, entity]));
  const root = entityById.get(request.rootEntityId);
  if (root === undefined) {
    return { outcome: "denied", reason: "root_entity_missing" };
  }
  if (root.retiredAt !== undefined) {
    return { outcome: "denied", reason: "root_entity_retired" };
  }
  if (root.tenantRef !== validGate.tenantRef) {
    return { outcome: "denied", reason: "tenant_mismatch" };
  }
  if (SENSITIVITY_RANK[root.sensitivity] > SENSITIVITY_RANK[validGate.sensitivityCeiling]) {
    return { outcome: "denied", reason: "sensitivity_exceeds_clearance" };
  }

  const excluded = emptyExclusions();
  const byId = (a: GraphRelationship, b: GraphRelationship) => (a.edgeId < b.edgeId ? -1 : 1);
  const sortedEdges = [...edges].sort(byId);

  // Classification pass — every candidate edge is accounted for exactly once
  // (observability: exclusions are counted, never silently absorbed). An edge
  // eligible here still only enters the result if the BFS reaches it within
  // the requested depth and edge budget.
  const eligible: GraphRelationship[] = [];
  for (const edge of sortedEdges) {
    if (!graphRelationshipSchema.safeParse(edge).success) {
      excluded.malformed_edge += 1;
      continue;
    }
    if (edge.lifecycle !== "published") {
      excluded.non_published += 1;
      continue;
    }
    if (edge.confidence.value < request.minConfidence) {
      excluded.low_confidence += 1;
      continue;
    }
    if (
      SENSITIVITY_RANK[edge.authorization.sensitivity] >
      SENSITIVITY_RANK[validGate.sensitivityCeiling]
    ) {
      excluded.sensitivity_above_clearance += 1;
      continue;
    }
    if (
      edge.authorization.visibility === "tenant_scoped" &&
      edge.tenantRef !== validGate.tenantRef
    ) {
      excluded.foreign_tenant += 1;
      continue;
    }
    if (edge.authorization.visibility === "federated") {
      if (
        edge.authorization.federationRef === undefined ||
        !validGate.federationRefs.includes(edge.authorization.federationRef)
      ) {
        excluded.cross_tenant_unfederated += 1;
        continue;
      }
    }
    const source = entityById.get(edge.sourceEntityId);
    const target = entityById.get(edge.targetEntityId);
    if (source === undefined || target === undefined) {
      excluded.missing_endpoint += 1;
      continue;
    }
    if (source.retiredAt !== undefined || target.retiredAt !== undefined) {
      excluded.endpoint_retired += 1;
      continue;
    }
    if (
      SENSITIVITY_RANK[source.sensitivity] > SENSITIVITY_RANK[validGate.sensitivityCeiling] ||
      SENSITIVITY_RANK[target.sensitivity] > SENSITIVITY_RANK[validGate.sensitivityCeiling]
    ) {
      excluded.endpoint_above_clearance += 1;
      continue;
    }
    if (
      edge.authorization.visibility === "tenant_scoped" &&
      (source.tenantRef !== validGate.tenantRef || target.tenantRef !== validGate.tenantRef)
    ) {
      excluded.foreign_tenant += 1;
      continue;
    }
    eligible.push(edge);
  }

  // Bounded breadth-first walk from the root over the eligible edges.
  const adjacency = new Map<string, GraphRelationship[]>();
  for (const edge of eligible) {
    for (const endpointId of [edge.sourceEntityId, edge.targetEntityId]) {
      const list = adjacency.get(endpointId);
      if (list === undefined) {
        adjacency.set(endpointId, [edge]);
      } else {
        list.push(edge);
      }
    }
  }

  const visited = new Set<string>([root.entityId]);
  const nodes: SubgraphNode[] = [
    {
      entityId: root.entityId,
      entityKind: root.entityKind,
      label: root.label,
      sensitivity: root.sensitivity,
    },
  ];
  const subgraphEdges: SubgraphEdge[] = [];
  let frontier: GraphEntity[] = [root];
  let truncated = false;

  for (let depth = 0; depth < request.maxDepth && frontier.length > 0 && !truncated; depth += 1) {
    const next: GraphEntity[] = [];
    for (const node of frontier) {
      const candidates = adjacency.get(node.entityId) ?? [];
      for (const edge of candidates) {
        const farId = otherEndpoint(edge, node.entityId);
        if (visited.has(farId)) {
          continue;
        }
        const reachableAlongDirection =
          request.direction === "both" ||
          (request.direction === "outbound" && edge.sourceEntityId === node.entityId) ||
          (request.direction === "inbound" && edge.targetEntityId === node.entityId);
        if (!reachableAlongDirection) {
          continue;
        }
        if (subgraphEdges.length >= request.maxEdges) {
          truncated = true;
          break;
        }
        const far = entityById.get(farId);
        if (far === undefined) {
          continue;
        }
        subgraphEdges.push(projectEdge(edge));
        visited.add(farId);
        nodes.push({
          entityId: far.entityId,
          entityKind: far.entityKind,
          label: far.label,
          sensitivity: far.sensitivity,
        });
        next.push(far);
      }
      if (truncated) break;
    }
    frontier = next;
  }

  return {
    outcome: "allowed",
    gateId: validGate.gateId,
    traceId: validGate.traceId,
    rootEntityId: root.entityId,
    nodes,
    edges: subgraphEdges,
    truncated,
    excluded,
  };
}

function otherEndpoint(edge: GraphRelationship, entityId: string): string {
  return edge.sourceEntityId === entityId ? edge.targetEntityId : edge.sourceEntityId;
}

function projectEdge(edge: GraphRelationship): SubgraphEdge {
  return {
    edgeId: edge.edgeId,
    relationKind: edge.relationKind,
    sourceEntityId: edge.sourceEntityId,
    targetEntityId: edge.targetEntityId,
    origin: edge.origin,
    provenance: { ...edge.provenance },
    ownership: { ...edge.ownership },
    authorization: {
      visibility: edge.authorization.visibility,
      sensitivity: edge.authorization.sensitivity,
    },
    confidence: { ...edge.confidence },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Authorized entity view — the ONLY entity-metadata read surface
 * ────────────────────────────────────────────────────────────*/

export function authorizedEntityView(
  entity: GraphEntity,
  gate: GraphAuthorizationGate | undefined,
  now: string,
  caller: GraphCallerContext,
): AuthorizedEntityView {
  if (!graphEntitySchema.safeParse(entity).success) {
    return { outcome: "denied", reason: "entity_malformed" };
  }
  if (!graphCallerContextSchema.safeParse(caller).success) {
    return { outcome: "denied", reason: "caller_malformed" };
  }
  if (entity.retiredAt !== undefined) {
    return { outcome: "denied", reason: "entity_retired" };
  }
  const gateResult = checkGate(
    entity.tenantRef,
    caller.principalRef,
    caller.purposeRef,
    gate,
    now,
  );
  if (gateResult.kind === "failure") {
    return { outcome: "denied", reason: gateResult.reason as EntityViewDenialReason };
  }
  const validGate = gateResult.gate;
  if (validGate.decision === "redact") {
    return { outcome: "denied", reason: "decision_not_permitted" };
  }
  if (SENSITIVITY_RANK[entity.sensitivity] > SENSITIVITY_RANK[validGate.sensitivityCeiling]) {
    return { outcome: "denied", reason: "sensitivity_exceeds_clearance" };
  }
  return {
    outcome: "allowed",
    gateId: validGate.gateId,
    traceId: validGate.traceId,
    entityId: entity.entityId,
    entityKind: entity.entityKind,
    label: entity.label,
    sensitivity: entity.sensitivity,
    provenance: {
      createdBy: entity.provenance.createdBy,
      createdAt: entity.provenance.createdAt,
      aiGenerated: entity.provenance.aiGenerated,
    },
    confidence: entity.confidence,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Relationship publication (phase contract `graph:relate`)
 * ────────────────────────────────────────────────────────────*/

export function publishRelationship(
  edge: GraphRelationship,
  entities: readonly GraphEntity[],
  now: string,
): ContractResult<GraphRelationship, PublishDenialReason> {
  if (!graphRelationshipSchema.safeParse(edge).success) {
    return { ok: false, error: "edge_malformed" };
  }
  if (edge.lifecycle !== "proposed") {
    return { ok: false, error: "not_publishable" };
  }
  if (edge.confidence.value < GRAPH_CONFIDENCE_PUBLISH_FLOOR) {
    return { ok: false, error: "confidence_below_floor" };
  }
  const entityById = new Map(entities.map((entity) => [entity.entityId, entity]));
  const source = entityById.get(edge.sourceEntityId);
  const target = entityById.get(edge.targetEntityId);
  if (source === undefined || target === undefined) {
    return { ok: false, error: "endpoint_missing" };
  }
  if (source.retiredAt !== undefined || target.retiredAt !== undefined) {
    return { ok: false, error: "endpoint_retired" };
  }
  if (
    edge.authorization.visibility === "tenant_scoped" &&
    (source.tenantRef !== edge.tenantRef || target.tenantRef !== edge.tenantRef)
  ) {
    return { ok: false, error: "endpoint_tenant_mismatch" };
  }
  const published: GraphRelationship = {
    ...edge,
    lifecycle: "published",
    updatedAt: now,
  };
  return { ok: true, value: published };
}

/* ─────────────────────────────────────────────────────────────
 * Lifecycle transitions — explicit and revision-carrying
 * ────────────────────────────────────────────────────────────*/

export function applyEdgeLifecycleTransition(
  edge: GraphRelationship,
  target: GraphEdgeLifecycleState,
  revision: GraphEdgeRevision,
): ContractResult<GraphRelationship, LifecycleDenialReason> {
  if (!graphRelationshipSchema.safeParse(edge).success) {
    return { ok: false, error: "edge_malformed" };
  }
  if (!graphEdgeRevisionSchema.safeParse(revision).success) {
    return { ok: false, error: "revision_malformed" };
  }
  if (revision.edgeId !== edge.edgeId) {
    return { ok: false, error: "edge_id_mismatch" };
  }
  if (target === edge.lifecycle) {
    return { ok: false, error: "target_equals_current" };
  }
  const allowed = GRAPH_EDGE_LIFECYCLE_TRANSITIONS[edge.lifecycle];
  if (!allowed.includes(target)) {
    return { ok: false, error: "unknown_transition" };
  }
  if (revision.previousLifecycle !== edge.lifecycle) {
    return { ok: false, error: "revision_previous_state_mismatch" };
  }
  if (revision.newLifecycle !== target) {
    return { ok: false, error: "revision_target_mismatch" };
  }
  if (target === "retracted" && revision.approvalRef === undefined) {
    return { ok: false, error: "missing_approval" };
  }
  const next: GraphRelationship = {
    ...edge,
    lifecycle: target,
    updatedAt: revision.appliedAt,
  };
  return { ok: true, value: next };
}

/* ─────────────────────────────────────────────────────────────
 * Governed retraction — reason-carrying, terminal
 * ────────────────────────────────────────────────────────────*/

export function retractRelationship(
  edge: GraphRelationship,
  retraction: GraphRetraction,
): ContractResult<GraphRelationship, RetractionDenialReason> {
  if (!graphRelationshipSchema.safeParse(edge).success) {
    return { ok: false, error: "edge_malformed" };
  }
  if (!graphRetractionSchema.safeParse(retraction).success) {
    return { ok: false, error: "retraction_malformed" };
  }
  if (edge.lifecycle === "retracted") {
    return { ok: false, error: "already_retracted" };
  }
  const retractable = GRAPH_EDGE_LIFECYCLE_TRANSITIONS[edge.lifecycle].includes("retracted");
  if (!retractable) {
    return { ok: false, error: "lifecycle_not_retractable" };
  }
  const retracted: GraphRelationship = {
    ...edge,
    lifecycle: "retracted",
    retraction: { ...retraction },
    updatedAt: retraction.retractedAt,
  };
  return { ok: true, value: retracted };
}