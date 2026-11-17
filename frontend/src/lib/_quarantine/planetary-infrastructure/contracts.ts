/**
 * Sherivs — phase 44 substrate surface: distributed infrastructure contracts
 * (H3 wave Squad G, mission G-064; Contract Architect, phase 44).
 *
 * WHAT: Zod-validated contracts for the distributed-infrastructure substrate —
 * distributed-node identity, region topology, and fail-closed region
 * admission. This module owns the STRUCTURE of that surface; it does not own
 * enforcement (phases 08/09/42), placement execution (phase 21), or device
 * identity (phase 15), and it never expresses an authorization decision on
 * behalf of the platform.
 *
 * Laws of this module:
 * - External nodes are never automatically trusted (E-060): admission to a
 *   region requires an explicit, provenanced trust decision. The automatic
 *   verdict space is only "unproven" | "untrusted"; "trusted" is reachable
 *   exclusively through a governed decision record carrying decidedBy,
 *   authority, reason, and an evidence basis (AGENTS §12 provenance).
 * - Fail-closed admission: every gate denies on missing, malformed, or
 *   non-matching inputs. A failed parse never yields a partial topology, and
 *   an unknown region, unapproved node, or ineligible placement denies rather
 *   than defaults open.
 * - Residency beats availability: only regions whose kind is structurally
 *   eligible may declare tenant-data eligibility, and a placement request
 *   that intends tenant data on an ineligible region is denied by schema and
 *   by decision — never silently degraded.
 * - Node lifecycle is forward-only and auditable (AGENTS §6): nodes cannot
 *   silently increase standing; deployment and re-activation after
 *   suspension require a validated human approval record. Machine-authored
 *   approvals fail closed (AGENTS §8).
 * - Bounded inputs: identifiers, statements, registries and capability sets
 *   all carry hard ceilings. No unbounded structures.
 *
 * Neutral vocabulary only (J-037, shrink-only): a "node" is any participant
 * in the distributed substrate; a "region" is any locality of capacity; a
 * "tenant" is any isolated ownership boundary. No domain vocabulary appears
 * here.
 *
 * Pure contract module: no I/O, no persistence, no vendor imports, no
 * wall-clock reads, no secrets. Key material appears only as fingerprints —
 * never as raw keys.
 */

import { z } from "zod";

/* ─────────────────────────────────────────────────────────────
 * Ceilings (no unbounded structures)
 * ────────────────────────────────────────────────────────────*/

/** Hard ceiling on free-form statements of purpose or reason. */
export const STATEMENT_MAX_LENGTH = 2_000;

/** Hard ceiling on regions in one parsed topology. */
export const MAX_REGIONS_PER_TOPOLOGY = 512;

/** Hard ceiling on links in one parsed topology. */
export const MAX_LINKS_PER_TOPOLOGY = 4_096;

/** Hard ceiling on capability identifiers per node or admission request. */
export const MAX_CAPABILITIES_PER_NODE = 64;

/** Hard ceiling on pending admission requests per policy. */
export const MAX_PENDING_ADMISSIONS = 10_000;

/**
 * The phase-44 boundary, exported as a constant so downstream surfaces can
 * cite it rather than paraphrase it. Infrastructure owns physical placement
 * and availability; it never owns data or its meaning, and it never overrides
 * residency, isolation, or sovereignty policy to keep a site running.
 */
export const DISTRIBUTED_INFRASTRUCTURE_BOUNDARY =
  "infrastructure owns physical placement and availability, never data or its meaning; residency, isolation and sovereignty policy always outrank availability preferences";

/**
 * The external-node trust posture this surface encodes (E-060): an external
 * node is never admitted merely because it asked, was previously seen, or
 * presents well-formed identity — trust exists only as an explicit,
 * provenanced decision.
 */
export const EXTERNAL_NODE_TRUST_POSTURE =
  "external nodes are never automatically trusted; region admission requires an explicit, provenanced trust decision, and the automatic verdict space is only unproven or untrusted";

/* ─────────────────────────────────────────────────────────────
 * Vocabulary and primitives
 * ────────────────────────────────────────────────────────────*/

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export const identifierSchema = z
  .string()
  .regex(
    IDENTIFIER_PATTERN,
    "identifier must be a lowercase snake_case identifier (letters, digits, underscore; starts with a letter; at most 64 characters)",
  );

export type Identifier = z.infer<typeof identifierSchema>;

function nonEmptyBounded(label: string, maxLength: number) {
  return z
    .string()
    .min(1, `${label} must be a non-empty string`)
    .refine((value) => value.trim().length > 0, `${label} must not be blank`)
    .max(
      maxLength,
      `${label} exceeds the bounded maximum of ${maxLength} characters`,
    );
}

/**
 * Key fingerprints only. Raw key material is structurally rejected: a
 * fingerprint is a short hex digest used for pinning and rotation audit, and
 * can never be confused with a private key or credential.
 */
export const KEY_FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{32,128}$/;

export const keyFingerprintSchema = z
  .string()
  .regex(
    KEY_FINGERPRINT_PATTERN,
    "key fingerprint must be a 'sha256:' prefixed hex digest (32-128 hex characters); raw key material is never accepted on this surface",
  );

export type KeyFingerprint = z.infer<typeof keyFingerprintSchema>;

export const provenanceSchema = z.strictObject({
  /** Who declared the record (role or principal reference, not a secret). */
  declaredBy: nonEmptyBounded("provenance.declaredBy", 256),
  /** Under which authority the declaration was made (AGENTS §43). */
  authority: nonEmptyBounded("provenance.authority", 256),
  /** ISO-8601 timestamp of the declaration. */
  declaredAt: z.string().datetime(),
});

export type Provenance = z.infer<typeof provenanceSchema>;

/* ─────────────────────────────────────────────────────────────
 * Distributed-node identity
 * ────────────────────────────────────────────────────────────*/

/**
 * Node lifecycle (AGENTS §6). The chain proposed → reviewed → approved →
 * deployed is forward-only; suspended and retired are containment states.
 * Nodes cannot silently increase standing (AGENTS §6, §8).
 */
export const nodeLifecycleStateSchema = z.enum([
  "proposed",
  "reviewed",
  "approved",
  "deployed",
  "suspended",
  "retired",
]);

export type NodeLifecycleState = z.infer<typeof nodeLifecycleStateSchema>;

/** Ordered standing of lifecycle states; containment states rank lowest. */
export const NODE_LIFECYCLE_ORDER: Readonly<Record<NodeLifecycleState, number>> = {
  proposed: 0,
  reviewed: 1,
  approved: 2,
  deployed: 3,
  suspended: 0,
  retired: 0,
};

export const distributedNodeIdentitySchema = z.strictObject({
  nodeId: identifierSchema,
  /** Owner reference (role or principal, never a secret). */
  ownerRef: nonEmptyBounded("node.ownerRef", 256),
  /** Declared purpose of the node (AGENTS §43: WHY). */
  purpose: nonEmptyBounded("node.purpose", STATEMENT_MAX_LENGTH),
  /** Fingerprint of the node's public key — pinning only, never key material. */
  keyFingerprint: keyFingerprintSchema,
  lifecycleState: nodeLifecycleStateSchema,
  /** Declared capabilities; admission matching never widens this set. */
  capabilities: z
    .array(identifierSchema)
    .max(MAX_CAPABILITIES_PER_NODE),
  provenance: provenanceSchema,
});

export type DistributedNodeIdentity = z.infer<typeof distributedNodeIdentitySchema>;

/**
 * Human approval record for sensitive lifecycle transitions (deployment,
 * re-activation after suspension). Parsed fail-closed: a malformed or
 * machine-shaped record is rejected, never trusted.
 */
export const humanApprovalSchema = z.strictObject({
  approvedBy: nonEmptyBounded("approval.approvedBy", 256),
  authority: nonEmptyBounded("approval.authority", 256),
  decidedAt: z.string().datetime(),
  reason: nonEmptyBounded("approval.reason", STATEMENT_MAX_LENGTH),
});

export type HumanApproval = z.infer<typeof humanApprovalSchema>;

export type LifecycleTransitionRejectionReason =
  | "transition_not_permitted"
  | "human_approval_required"
  | "human_approval_invalid";

export type LifecycleTransitionDecision =
  | { readonly ok: true; readonly from: NodeLifecycleState; readonly to: NodeLifecycleState }
  | {
      readonly ok: false;
      readonly from: NodeLifecycleState;
      readonly to: NodeLifecycleState;
      readonly reason: LifecycleTransitionRejectionReason;
      readonly detail: string;
    };

const LIFECYCLE_TRANSITIONS: Readonly<
  Record<NodeLifecycleState, readonly NodeLifecycleState[]>
> = {
  proposed: ["reviewed", "retired"],
  reviewed: ["approved", "retired"],
  approved: ["deployed", "suspended", "retired"],
  deployed: ["suspended", "retired"],
  suspended: ["reviewed", "retired"],
  retired: [],
};

/** True when the target state may hold or place tenant-bearing workloads. */
export function isOperationalState(state: NodeLifecycleState): boolean {
  return state === "approved" || state === "deployed";
}

/**
 * Decide a lifecycle transition. Fail-closed by design:
 * - transitions not present in the forward-only table are refused;
 * - entering `deployed` and leaving `suspended` (re-activation) require a
 *   VALID human approval record — the approval input is parsed here, so a
 *   malformed or machine-shaped approval fails closed (AGENTS §8: AI
 *   improvement is not AI permission expansion).
 */
export function decideNodeLifecycleTransition(
  from: NodeLifecycleState,
  to: NodeLifecycleState,
  approval: unknown,
): LifecycleTransitionDecision {
  if (!LIFECYCLE_TRANSITIONS[from].includes(to)) {
    return {
      ok: false,
      from,
      to,
      reason: "transition_not_permitted",
      detail: `transition ${from} → ${to} is not in the forward-only lifecycle table; node standing cannot silently increase (AGENTS §6)`,
    };
  }

  const approvalRequired = to === "deployed" || (from === "suspended" && to === "reviewed");
  if (!approvalRequired) {
    return { ok: true, from, to };
  }

  const parsed = humanApprovalSchema.safeParse(approval);
  if (!parsed.success) {
    return {
      ok: false,
      from,
      to,
      reason: "human_approval_invalid",
      detail:
        "this lifecycle transition requires a valid human approval record (approvedBy, authority, decidedAt, reason) — machine-authored or malformed approvals fail closed (AGENTS §8)",
    };
  }

  return { ok: true, from, to };
}

/* ─────────────────────────────────────────────────────────────
 * Regions and region topology
 * ────────────────────────────────────────────────────────────*/

/**
 * Region kinds. Only `control` and `storage` regions are structurally
 * eligible to hold tenant data; `compute`, `edge` and `worker` regions are
 * execution or presence surfaces and can never declare tenant-data
 * eligibility (residency beats availability).
 */
export const regionKindSchema = z.enum([
  "control",
  "storage",
  "compute",
  "edge",
  "worker",
]);

export type RegionKind = z.infer<typeof regionKindSchema>;

export const TENANT_DATA_ELIGIBLE_REGION_KINDS: readonly RegionKind[] = [
  "control",
  "storage",
];

export const regionSchema = z
  .strictObject({
    regionId: identifierSchema,
    kind: regionKindSchema,
    /** Jurisdiction the region's capacity is subject to (residency record). */
    jurisdiction: nonEmptyBounded("region.jurisdiction", 256),
    /**
     * Whether tenant data may be placed on this region. Structurally
     * constrained below: ineligible kinds can never claim it.
     */
    tenantDataEligible: z.boolean(),
    /** Bounded relative capacity in abstract capacity units. */
    capacityUnits: z.number().int().min(0).max(1_000_000),
    provenance: provenanceSchema,
  })
  .superRefine((value, ctx) => {
    if (value.tenantDataEligible && !TENANT_DATA_ELIGIBLE_REGION_KINDS.includes(value.kind)) {
      ctx.addIssue({
        code: "custom",
        path: ["tenantDataEligible"],
        message: `a region of kind "${value.kind}" can never be tenant-data eligible — residency beats availability (fail-closed)`,
      });
    }
  });

export type Region = z.infer<typeof regionSchema>;

/** True only when the region's kind and declaration both permit tenant data. */
export function canHostTenantData(region: Region): boolean {
  return (
    region.tenantDataEligible && TENANT_DATA_ELIGIBLE_REGION_KINDS.includes(region.kind)
  );
}

export const topologyLinkKindSchema = z.enum(["backbone", "regional", "edge_uplink"]);

export type TopologyLinkKind = z.infer<typeof topologyLinkKindSchema>;

export const topologyLinkSchema = z
  .strictObject({
    fromRegionId: identifierSchema,
    toRegionId: identifierSchema,
    linkKind: topologyLinkKindSchema,
    /** Bounded relative link weight (latency class or cost class). */
    weight: z.number().int().min(0).max(1_000),
  })
  .superRefine((value, ctx) => {
    if (value.fromRegionId === value.toRegionId) {
      ctx.addIssue({
        code: "custom",
        path: ["toRegionId"],
        message: "a topology link cannot attach a region to itself",
      });
    }
  });

export type TopologyLink = z.infer<typeof topologyLinkSchema>;

export const regionTopologySchema = z.strictObject({
  topologyId: identifierSchema,
  /** Monotonic version; topology edits produce a new version, never silent edits. */
  version: z.number().int().positive().max(1_000_000),
  regions: z
    .array(regionSchema)
    .min(1, "a topology requires at least one region — an empty fabric denies by construction")
    .max(MAX_REGIONS_PER_TOPOLOGY),
  links: z.array(topologyLinkSchema).max(MAX_LINKS_PER_TOPOLOGY),
});

export type RegionTopology = z.infer<typeof regionTopologySchema>;

/* ─────────────────────────────────────────────────────────────
 * Topology parsing (fail-closed: no partial topologies)
 * ────────────────────────────────────────────────────────────*/

export type TopologyParseFailureReason =
  /** The input does not match the schema at all. */
  | "invalid_shape"
  /** A cross-record invariant failed (duplicates, unresolved references). */
  | "cross_record_invariant";

export interface TopologyParseIssue {
  readonly path: string;
  readonly message: string;
}

export type TopologyParseResult =
  | { readonly ok: true; readonly topology: RegionTopology }
  | {
      readonly ok: false;
      readonly reason: TopologyParseFailureReason;
      readonly issues: readonly TopologyParseIssue[];
    };

function issuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "(root)";
  return path.map((segment) => String(segment)).join(".");
}

/**
 * Parse an untrusted input into a region topology. Any violation — shape,
 * bounds, duplicate region ids, duplicate links, unresolved link endpoints —
 * yields `ok: false` with structured issues; a failed parse never yields a
 * partial topology.
 */
export function parseRegionTopology(input: unknown): TopologyParseResult {
  const parsed = regionTopologySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_shape",
      issues: parsed.error.issues.map((issue) => ({
        path: issuePath(issue.path),
        message: issue.message,
      })),
    };
  }

  const issues: TopologyParseIssue[] = [];
  const regionIds = new Set<string>();
  for (const region of parsed.data.regions) {
    if (regionIds.has(region.regionId)) {
      issues.push({
        path: `[regionId=${region.regionId}]`,
        message: `duplicate region id "${region.regionId}" — one id carries exactly one region`,
      });
    } else {
      regionIds.add(region.regionId);
    }
  }

  const seenLinks = new Set<string>();
  parsed.data.links.forEach((link, index) => {
    for (const endpoint of [link.fromRegionId, link.toRegionId]) {
      if (!regionIds.has(endpoint)) {
        issues.push({
          path: `links[${index}]`,
          message: `link references unresolved region "${endpoint}" — every link endpoint must resolve inside the topology (fail-closed)`,
        });
      }
    }
    const linkKey = `${link.fromRegionId}->${link.toRegionId}`;
    if (seenLinks.has(linkKey)) {
      issues.push({
        path: `links[${index}]`,
        message: `duplicate link "${linkKey}" — one ordered pair carries exactly one link`,
      });
    } else {
      seenLinks.add(linkKey);
    }
  });

  if (issues.length > 0) {
    return { ok: false, reason: "cross_record_invariant", issues };
  }

  return { ok: true, topology: parsed.data };
}

/** Resolve a region by id inside a parsed topology, or `undefined`. */
export function regionById(topology: RegionTopology, regionId: Identifier): Region | undefined {
  return topology.regions.find((region) => region.regionId === regionId);
}

/* ─────────────────────────────────────────────────────────────
 * Region admission (E-060: external nodes are never automatically trusted)
 * ────────────────────────────────────────────────────────────*/

/**
 * Trust verdicts. The AUTOMATIC verdict space is only `unproven` |
 * `untrusted` — `trusted` is reachable exclusively through an explicit
 * decision record (`trustDecisionSchema`), never as a default.
 */
export const automaticTrustVerdictSchema = z.enum(["unproven", "untrusted"]);

export type AutomaticTrustVerdict = z.infer<typeof automaticTrustVerdictSchema>;

export const trustDecisionSchema = z.strictObject({
  nodeId: identifierSchema,
  verdict: z.enum(["trusted", "untrusted"]),
  /** Who decided (role or principal reference, not a secret). */
  decidedBy: nonEmptyBounded("trustDecision.decidedBy", 256),
  /** Under which authority the decision was made (AGENTS §43). */
  authority: nonEmptyBounded("trustDecision.authority", 256),
  /** Why the decision was made — decisions without reasons are rejected. */
  reason: nonEmptyBounded("trustDecision.reason", STATEMENT_MAX_LENGTH),
  /** Reference to the evidence basis of the decision (AGENTS §12). */
  basisEvidenceRef: identifierSchema,
  decidedAt: z.string().datetime(),
});

export type TrustDecision = z.infer<typeof trustDecisionSchema>;

export const admissionPolicySchema = z.strictObject({
  policyId: identifierSchema,
  /**
   * Literal `true`, enforced by the schema: this surface cannot even express
   * a policy that auto-trusts external nodes (E-060).
   */
  requireExplicitTrust: z.literal(true),
  /** Role reference low-confidence or high-impact requests escalate to. */
  escalationRole: nonEmptyBounded("policy.escalationRole", 256),
  maxPendingAdmissions: z.number().int().positive().max(MAX_PENDING_ADMISSIONS),
  provenance: provenanceSchema,
});

export type AdmissionPolicy = z.infer<typeof admissionPolicySchema>;

export const admissionRequestSchema = z.strictObject({
  requestId: identifierSchema,
  /** The requesting node's identity is re-parsed, never trusted as-is. */
  node: distributedNodeIdentitySchema,
  requestedRegionId: identifierSchema,
  /** Declared purpose of the admission (AGENTS §43: WHY). */
  declaredPurpose: nonEmptyBounded("request.declaredPurpose", STATEMENT_MAX_LENGTH),
  requestedAt: z.string().datetime(),
  /** Whether the requester intends to place tenant data on the region. */
  tenantDataIntended: z.boolean(),
  capabilities: z
    .array(identifierSchema)
    .max(MAX_CAPABILITIES_PER_NODE),
});

export type AdmissionRequest = z.infer<typeof admissionRequestSchema>;

export type AdmissionDenialReason =
  | "unknown_region"
  | "region_not_tenant_data_eligible"
  | "node_not_operational"
  | "explicit_trust_decision_required"
  | "trust_decision_invalid"
  | "trust_decision_node_mismatch"
  | "distrusted_by_decision";

export type AdmissionDecision =
  | {
      readonly ok: true;
      readonly verdict: "admitted";
      readonly requestId: Identifier;
      readonly regionId: Identifier;
      readonly basis: "explicit_trust_decision";
    }
  | {
      readonly ok: false;
      readonly verdict: "denied";
      readonly requestId: Identifier;
      readonly regionId: Identifier;
      readonly reason: AdmissionDenialReason;
      readonly detail: string;
    };

/**
 * Effective trust verdict for a node under an admission attempt, given an
 * untrusted decision input. Absent or malformed decisions never widen to
 * `trusted` — the verdict degrades to `unproven` (E-060).
 */
export function effectiveTrustVerdict(
  decisionInput: unknown,
): { readonly verdict: AutomaticTrustVerdict | "trusted"; readonly valid: boolean } {
  const parsed = trustDecisionSchema.safeParse(decisionInput);
  if (!parsed.success) {
    return { verdict: "unproven", valid: false };
  }
  return { verdict: parsed.data.verdict, valid: true };
}

/**
 * Decide a region admission request. Fail-closed gates, in order:
 *
 * 1. `unknown_region` — the requested region does not resolve in the
 *    topology; unknown targets deny, never default open.
 * 2. `region_not_tenant_data_eligible` — the request intends tenant data on
 *    a region that structurally cannot host it (residency beats
 *    availability).
 * 3. `node_not_operational` — the node is not in an approved/deployed
 *    lifecycle state; proposed or suspended nodes cannot be admitted.
 * 4. `explicit_trust_decision_required` / `trust_decision_invalid` — no
 *    explicit trust decision, or a malformed one (E-060: external nodes are
 *    never automatically trusted; there is no permissive default).
 * 5. `trust_decision_node_mismatch` — a decision made for a different node
 *    is not transferable.
 * 6. `distrusted_by_decision` — an explicit `untrusted` verdict denies.
 *
 * Admission (`ok: true`) is reachable ONLY through a valid, node-matched
 * `trusted` decision; the decision record — not the request — is the audit
 * basis.
 */
export function decideRegionAdmission(
  topology: RegionTopology,
  policy: AdmissionPolicy,
  request: AdmissionRequest,
  trustDecisionInput: unknown,
): AdmissionDecision {
  const region = regionById(topology, request.requestedRegionId);
  if (region === undefined) {
    return {
      ok: false,
      verdict: "denied",
      requestId: request.requestId,
      regionId: request.requestedRegionId,
      reason: "unknown_region",
      detail: `the requested region does not resolve in the parsed topology — unknown targets deny (fail-closed), never default open [policy: ${policy.policyId}]`,
    };
  }

  if (request.tenantDataIntended && !canHostTenantData(region)) {
    return {
      ok: false,
      verdict: "denied",
      requestId: request.requestId,
      regionId: region.regionId,
      reason: "region_not_tenant_data_eligible",
      detail: `a region of kind "${region.kind}" cannot host tenant data — residency beats availability (${DISTRIBUTED_INFRASTRUCTURE_BOUNDARY}) [policy: ${policy.policyId}]`,
    };
  }

  if (!isOperationalState(request.node.lifecycleState)) {
    return {
      ok: false,
      verdict: "denied",
      requestId: request.requestId,
      regionId: region.regionId,
      reason: "node_not_operational",
      detail: `node "${request.node.nodeId}" is in lifecycle state "${request.node.lifecycleState}"; only approved or deployed nodes can be admitted [policy: ${policy.policyId}]`,
    };
  }

  const parsedDecision = trustDecisionSchema.safeParse(trustDecisionInput);
  if (!parsedDecision.success) {
    const missing =
      trustDecisionInput === undefined ||
      trustDecisionInput === null ||
      (typeof trustDecisionInput === "object" && Object.keys(trustDecisionInput as object).length === 0);
    return {
      ok: false,
      verdict: "denied",
      requestId: request.requestId,
      regionId: region.regionId,
      reason: missing ? "explicit_trust_decision_required" : "trust_decision_invalid",
      detail: missing
        ? `${EXTERNAL_NODE_TRUST_POSTURE}; a request without an explicit decision denies even when every other gate passes`
        : "the trust decision record failed validation (decidedBy, authority, reason, basisEvidenceRef and decidedAt are mandatory) — malformed decisions fail closed, never widen",
    };
  }

  const decision = parsedDecision.data;
  if (decision.nodeId !== request.node.nodeId) {
    return {
      ok: false,
      verdict: "denied",
      requestId: request.requestId,
      regionId: region.regionId,
      reason: "trust_decision_node_mismatch",
      detail: `the trust decision was made for node "${decision.nodeId}", not "${request.node.nodeId}" — decisions are not transferable between nodes`,
    };
  }

  if (decision.verdict === "untrusted") {
    return {
      ok: false,
      verdict: "denied",
      requestId: request.requestId,
      regionId: region.regionId,
      reason: "distrusted_by_decision",
      detail: `node "${decision.nodeId}" carries an explicit untrusted verdict (${decision.decidedBy}); admission denies until a governed decision re-admits it`,
    };
  }

  return {
    ok: true,
    verdict: "admitted",
    requestId: request.requestId,
    regionId: region.regionId,
    basis: "explicit_trust_decision",
  };
}

/* ─────────────────────────────────────────────────────────────
 * Request parsing (fail-closed, no partial results)
 * ────────────────────────────────────────────────────────────*/

export type AdmissionRequestParseFailureReason =
  /** The input does not match the schema at all. */
  | "invalid_shape"
  /** The requested capability set exceeds the node's declared capabilities. */
  | "capability_expansion";

export type AdmissionRequestParseResult =
  | { readonly ok: true; readonly request: AdmissionRequest }
  | {
      readonly ok: false;
      readonly reason: AdmissionRequestParseFailureReason;
      readonly issues: readonly TopologyParseIssue[];
    };

/**
 * Parse an untrusted admission request. The requested capability set may be
 * narrowed but never widened: a request whose capabilities are not a
 * subset of the node's declared capabilities is rejected outright
 * (AGENTS §6: nodes cannot silently increase permissions).
 */
export function parseAdmissionRequest(input: unknown): AdmissionRequestParseResult {
  const parsed = admissionRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_shape",
      issues: parsed.error.issues.map((issue) => ({
        path: issuePath(issue.path),
        message: issue.message,
      })),
    };
  }

  const declared = new Set(parsed.data.node.capabilities);
  const undeclared = parsed.data.capabilities.filter((capability) => !declared.has(capability));
  if (undeclared.length > 0) {
    return {
      ok: false,
      reason: "capability_expansion",
      issues: [
        {
          path: "capabilities",
          message: `request requests capabilities beyond the node's declared set (${undeclared.join(", ")}) — admission cannot widen standing (fail-closed)`,
        },
      ],
    };
  }

  return { ok: true, request: parsed.data };
}
