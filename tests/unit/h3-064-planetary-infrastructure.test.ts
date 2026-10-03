/**
 * CoreGrid — H3-064 planetary-infrastructure contract tests (mission G-064).
 * Zod validation of phase-44 distributed-infrastructure substrate contracts:
 * distributed-node identity, region topology, and fail-closed region
 * admission under the E-060 posture (external nodes are never automatically
 * trusted). Pure offline: no network, no database, no secrets.
 */
import { describe, expect, it } from "vitest";
import {
  DISTRIBUTED_INFRASTRUCTURE_BOUNDARY,
  EXTERNAL_NODE_TRUST_POSTURE,
  KEY_FINGERPRINT_PATTERN,
  MAX_CAPABILITIES_PER_NODE,
  MAX_LINKS_PER_TOPOLOGY,
  MAX_REGIONS_PER_TOPOLOGY,
  TENANT_DATA_ELIGIBLE_REGION_KINDS,
  admissionPolicySchema,
  canHostTenantData,
  decideNodeLifecycleTransition,
  decideRegionAdmission,
  distributedNodeIdentitySchema,
  effectiveTrustVerdict,
  isOperationalState,
  keyFingerprintSchema,
  parseAdmissionRequest,
  parseRegionTopology,
  regionById,
  regionSchema,
  trustDecisionSchema,
  type AdmissionPolicy,
  type AdmissionRequest,
  type RegionTopology,
} from "../../frontend/src/lib/planetary-infrastructure/contracts";

const DECLARED_AT = "2026-10-03T00:00:00.000Z";
const REQUESTED_AT = "2026-10-03T01:00:00.000Z";

const PROVENANCE = {
  declaredBy: "role:infrastructure-architect",
  authority: "AGENTS.md §42 / H3 wave mission G-064",
  declaredAt: DECLARED_AT,
};

function region(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    regionId: "core_region_1",
    kind: "storage",
    jurisdiction: "jurisdiction:neutral",
    tenantDataEligible: true,
    capacityUnits: 1000,
    provenance: PROVENANCE,
    ...overrides,
  };
}

function topology(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    topologyId: "fabric_main",
    version: 1,
    regions: [
      region(),
      region({ regionId: "edge_region_1", kind: "edge", tenantDataEligible: false }),
      region({ regionId: "compute_region_1", kind: "compute", tenantDataEligible: false }),
    ],
    links: [
      { fromRegionId: "core_region_1", toRegionId: "edge_region_1", linkKind: "backbone", weight: 10 },
      { fromRegionId: "core_region_1", toRegionId: "compute_region_1", linkKind: "regional", weight: 20 },
    ],
    ...overrides,
  };
}

function node(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    nodeId: "node_ext_1",
    ownerRef: "role:fleet-operator",
    purpose: "serve regional presence workloads under declared policy",
    keyFingerprint: "sha256:" + "a".repeat(64),
    lifecycleState: "deployed",
    capabilities: ["serve_presence", "report_health"],
    provenance: PROVENANCE,
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: "req_001",
    node: node(),
    requestedRegionId: "edge_region_1",
    declaredPurpose: "regional presence serving",
    requestedAt: REQUESTED_AT,
    tenantDataIntended: false,
    capabilities: ["serve_presence"],
    ...overrides,
  };
}

function trustDecision(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    nodeId: "node_ext_1",
    verdict: "trusted",
    decidedBy: "role:infrastructure-governor",
    authority: "governed admission review",
    reason: "identity attestation verified; residency constraints accepted",
    basisEvidenceRef: "evidence_attestation_001",
    decidedAt: REQUESTED_AT,
    ...overrides,
  };
}

function approval(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    approvedBy: "role:infrastructure-governor",
    authority: "governed admission review",
    decidedAt: REQUESTED_AT,
    reason: "identity attestation verified; deployment approved",
    ...overrides,
  };
}

function policyFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    policyId: "admission_default",
    requireExplicitTrust: true,
    escalationRole: "role:human-oversight",
    maxPendingAdmissions: 100,
    provenance: PROVENANCE,
    ...overrides,
  };
}

function parsedPolicy(overrides: Record<string, unknown> = {}): AdmissionPolicy {
  const result = admissionPolicySchema.safeParse(policyFixture(overrides));
  if (!result.success) throw new Error(`fixture policy failed to parse: ${JSON.stringify(result.error.issues)}`);
  return result.data;
}

function parsedTopology(overrides: Record<string, unknown> = {}): RegionTopology {
  const result = parseRegionTopology(topology(overrides));
  if (!result.ok) throw new Error(`fixture topology failed to parse: ${JSON.stringify(result.issues)}`);
  return result.topology;
}

function parsedRequest(overrides: Record<string, unknown> = {}): AdmissionRequest {
  const result = parseAdmissionRequest(request(overrides));
  if (!result.ok) throw new Error(`fixture request failed to parse: ${JSON.stringify(result.issues)}`);
  return result.request;
}

/* ─────────────────────────────────────────────────────────────
 * Module posture
 * ────────────────────────────────────────────────────────────*/

describe("module posture and constants", () => {
  it("states the phase-44 boundary and the E-060 external-node posture", () => {
    expect(DISTRIBUTED_INFRASTRUCTURE_BOUNDARY).toContain("never data or its meaning");
    expect(EXTERNAL_NODE_TRUST_POSTURE).toContain("never automatically trusted");
  });

  it("carries hard ceilings with no unbounded structures", () => {
    expect(MAX_REGIONS_PER_TOPOLOGY).toBe(512);
    expect(MAX_LINKS_PER_TOPOLOGY).toBe(4096);
    expect(MAX_CAPABILITIES_PER_NODE).toBe(64);
  });

  it("accepts only sha256 fingerprints and rejects raw key material", () => {
    expect(keyFingerprintSchema.safeParse("sha256:" + "a".repeat(64)).success).toBe(true);
    expect(keyFingerprintSchema.safeParse("-----BEGIN PRIVATE KEY-----").success).toBe(false);
    expect(keyFingerprintSchema.safeParse("my-secret-api-key").success).toBe(false);
    expect(KEY_FINGERPRINT_PATTERN.test("sha256:deadbeef")).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Distributed-node identity
 * ────────────────────────────────────────────────────────────*/

describe("distributed-node identity", () => {
  it("parses a well-formed provenanced node identity", () => {
    const parsed = distributedNodeIdentitySchema.safeParse(node());
    expect(parsed.success).toBe(true);
  });

  it("rejects anonymous nodes: owner, purpose and provenance are mandatory", () => {
    expect(distributedNodeIdentitySchema.safeParse(node({ ownerRef: "" })).success).toBe(false);
    expect(distributedNodeIdentitySchema.safeParse(node({ purpose: "   " })).success).toBe(false);
    expect(distributedNodeIdentitySchema.safeParse(node({ provenance: undefined })).success).toBe(false);
  });

  it("rejects unknown lifecycle states and unknown capability shapes", () => {
    expect(distributedNodeIdentitySchema.safeParse(node({ lifecycleState: "trusted" })).success).toBe(false);
    expect(distributedNodeIdentitySchema.safeParse(node({ capabilities: ["UPPER_CASE"] })).success).toBe(false);
  });

  it("rejects raw key material in the identity slot", () => {
    const parsed = distributedNodeIdentitySchema.safeParse(node({ keyFingerprint: "super-secret-key-value" }));
    expect(parsed.success).toBe(false);
  });

  it("classifies lifecycle states operationally", () => {
    expect(isOperationalState("approved")).toBe(true);
    expect(isOperationalState("deployed")).toBe(true);
    expect(isOperationalState("proposed")).toBe(false);
    expect(isOperationalState("suspended")).toBe(false);
  });
});

describe("node lifecycle transitions (AGENTS §6, §8)", () => {
  it("permits forward-only progression along the chain", () => {
    expect(decideNodeLifecycleTransition("proposed", "reviewed", undefined).ok).toBe(true);
    expect(decideNodeLifecycleTransition("reviewed", "approved", undefined).ok).toBe(true);
    expect(decideNodeLifecycleTransition("approved", "deployed", approval()).ok).toBe(true);
  });

  it("refuses backward or non-table transitions (no silent standing increase)", () => {
    const result = decideNodeLifecycleTransition("deployed", "reviewed", undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("transition_not_permitted");
    expect(decideNodeLifecycleTransition("retired", "deployed", undefined).ok).toBe(false);
    expect(decideNodeLifecycleTransition("proposed", "deployed", undefined).ok).toBe(false);
  });

  it("fails closed on deployment without a valid human approval", () => {
    const noApproval = decideNodeLifecycleTransition("approved", "deployed", undefined);
    expect(noApproval.ok).toBe(false);
    if (!noApproval.ok) expect(noApproval.reason).toBe("human_approval_invalid");

    const machineShaped = decideNodeLifecycleTransition("approved", "deployed", { approvedBy: "agent:self" });
    expect(machineShaped.ok).toBe(false);
  });

  it("requires human approval to leave suspension (re-activation)", () => {
    const blocked = decideNodeLifecycleTransition("suspended", "reviewed", undefined);
    expect(blocked.ok).toBe(false);
    const approved = decideNodeLifecycleTransition(
      "suspended",
      "reviewed",
      approval({ approvedBy: "role:human-oversight", authority: "governed review", reason: "re-activation reviewed" }),
    );
    expect(approved.ok).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Region topology
 * ────────────────────────────────────────────────────────────*/

describe("region topology parsing", () => {
  it("parses a well-formed topology and resolves regions by id", () => {
    const result = parseRegionTopology(topology());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.topology.regions).toHaveLength(3);
      expect(regionById(result.topology, "edge_region_1")?.kind).toBe("edge");
      expect(regionById(result.topology, "missing_region")).toBeUndefined();
    }
  });

  it("rejects an empty fabric (an empty topology denies by construction)", () => {
    const result = parseRegionTopology(topology({ regions: [] }));
    expect(result.ok).toBe(false);
  });

  it("fails closed on duplicate region ids with structured issues", () => {
    const result = parseRegionTopology(topology({ regions: [region(), region()] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("cross_record_invariant");
      expect(result.issues.some((issue) => issue.message.includes("duplicate region id"))).toBe(true);
    }
  });

  it("fails closed on unresolved link endpoints and duplicate links", () => {
    const unresolved = parseRegionTopology(
      topology({ links: [{ fromRegionId: "core_region_1", toRegionId: "ghost_region", linkKind: "backbone", weight: 1 }] }),
    );
    expect(unresolved.ok).toBe(false);
    if (!unresolved.ok) {
      expect(unresolved.issues.some((issue) => issue.message.includes("unresolved region"))).toBe(true);
    }

    const duplicated = parseRegionTopology(
      topology({
        links: [
          { fromRegionId: "core_region_1", toRegionId: "edge_region_1", linkKind: "backbone", weight: 1 },
          { fromRegionId: "core_region_1", toRegionId: "edge_region_1", linkKind: "backbone", weight: 2 },
        ],
      }),
    );
    expect(duplicated.ok).toBe(false);
    if (!duplicated.ok) {
      expect(duplicated.issues.some((issue) => issue.message.includes("duplicate link"))).toBe(true);
    }
  });

  it("rejects self-links and malformed shapes", () => {
    const selfLink = parseRegionTopology(
      topology({ links: [{ fromRegionId: "core_region_1", toRegionId: "core_region_1", linkKind: "backbone", weight: 1 }] }),
    );
    expect(selfLink.ok).toBe(false);
    expect(parseRegionTopology({ topologyId: "fabric_main" }).ok).toBe(false);
    expect(parseRegionTopology(null).ok).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Residency: regions and tenant-data eligibility
 * ────────────────────────────────────────────────────────────*/

describe("residency (tenant-data eligibility)", () => {
  it("marks only control and storage kinds as structurally eligible", () => {
    expect(TENANT_DATA_ELIGIBLE_REGION_KINDS).toEqual(["control", "storage"]);
  });

  it("refuses tenant-data eligibility on compute, edge and worker regions at the schema level", () => {
    for (const kind of ["compute", "edge", "worker"] as const) {
      const parsed = regionSchema.safeParse(region({ kind, tenantDataEligible: true }));
      expect(parsed.success).toBe(false);
    }
  });

  it("accepts eligible kinds declaring tenant-data eligibility", () => {
    expect(regionSchema.safeParse(region({ kind: "control" })).success).toBe(true);
    expect(regionSchema.safeParse(region({ kind: "storage" })).success).toBe(true);
  });

  it("keeps canHostTenantData fail-closed on the region kind and declaration", () => {
    const storage = regionSchema.parse(region());
    const edge = regionSchema.parse(region({ regionId: "edge_region_1", kind: "edge", tenantDataEligible: false }));
    expect(canHostTenantData(storage)).toBe(true);
    expect(canHostTenantData(edge)).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Trust decisions (E-060)
 * ────────────────────────────────────────────────────────────*/

describe("trust decisions (E-060: never automatically trusted)", () => {
  it("limits the automatic verdict space to unproven and untrusted", () => {
    expect(effectiveTrustVerdict(undefined)).toEqual({ verdict: "unproven", valid: false });
    expect(effectiveTrustVerdict({})).toEqual({ verdict: "unproven", valid: false });
    expect(effectiveTrustVerdict("trusted").verdict).toBe("unproven");
    expect(effectiveTrustVerdict({ verdict: "trusted" }).valid).toBe(false);
  });

  it("surfaces a valid decision verdict without widening it", () => {
    expect(effectiveTrustVerdict(trustDecision())).toEqual({ verdict: "trusted", valid: true });
    expect(effectiveTrustVerdict(trustDecision({ verdict: "untrusted" }))).toEqual({
      verdict: "untrusted",
      valid: true,
    });
  });

  it("rejects decisions without provenance, reason, or evidence basis", () => {
    expect(trustDecisionSchema.safeParse(trustDecision({ decidedBy: "" })).success).toBe(false);
    expect(trustDecisionSchema.safeParse(trustDecision({ reason: "" })).success).toBe(false);
    expect(trustDecisionSchema.safeParse(trustDecision({ basisEvidenceRef: "" })).success).toBe(false);
    expect(trustDecisionSchema.safeParse(trustDecision({ authority: undefined })).success).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Region admission (fail-closed gates)
 * ────────────────────────────────────────────────────────────*/

describe("region admission (fail-closed, E-060)", () => {
  const fabric = parsedTopology();

  it("never carries a permissive default: the policy schema cannot express auto-trust", () => {
    expect(admissionPolicySchema.safeParse(policyFixture()).success).toBe(true);
    const permissive = admissionPolicySchema.safeParse(policyFixture({ requireExplicitTrust: false }));
    expect(permissive.success).toBe(false);
    const missing = admissionPolicySchema.safeParse(policyFixture({ requireExplicitTrust: undefined }));
    expect(missing.success).toBe(false);
  });

  it("denies admission without an explicit trust decision even when every other gate passes", () => {
    const decision = decideRegionAdmission(fabric, parsedPolicy(), parsedRequest(), undefined);
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toBe("explicit_trust_decision_required");
      expect(decision.detail).toContain("never automatically trusted");
    }
  });

  it("denies admission on a malformed trust decision (fail-closed, never widens)", () => {
    const decision = decideRegionAdmission(fabric, parsedPolicy(), parsedRequest(), { verdict: "trusted", nodeId: "node_ext_1" });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("trust_decision_invalid");
  });

  it("admits only through a valid, node-matched trusted decision", () => {
    const decision = decideRegionAdmission(fabric, parsedPolicy(), parsedRequest(), trustDecision());
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.verdict).toBe("admitted");
      expect(decision.basis).toBe("explicit_trust_decision");
      expect(decision.regionId).toBe("edge_region_1");
    }
  });

  it("denies on an explicit untrusted verdict and on node-mismatched decisions", () => {
    const distrusted = decideRegionAdmission(fabric, parsedPolicy(), parsedRequest(), trustDecision({ verdict: "untrusted" }));
    expect(distrusted.ok).toBe(false);
    if (!distrusted.ok) expect(distrusted.reason).toBe("distrusted_by_decision");

    const mismatched = decideRegionAdmission(
      fabric,
      parsedPolicy(),
      parsedRequest(),
      trustDecision({ nodeId: "node_other" }),
    );
    expect(mismatched.ok).toBe(false);
    if (!mismatched.ok) expect(mismatched.reason).toBe("trust_decision_node_mismatch");
  });

  it("denies requests into unknown regions (no default-open targets)", () => {
    const decision = decideRegionAdmission(
      parsedTopology(),
      parsedPolicy(),
      parsedRequest({ requestedRegionId: "ghost_region" }),
      trustDecision(),
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("unknown_region");
  });

  it("denies tenant-data placement on ineligible regions (residency beats availability)", () => {
    const decision = decideRegionAdmission(
      fabric,
      parsedPolicy(),
      parsedRequest({ tenantDataIntended: true }),
      trustDecision(),
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toBe("region_not_tenant_data_eligible");
      expect(decision.detail).toContain("residency beats availability");
    }
  });

  it("permits tenant-data placement only on structurally eligible regions", () => {
    const decision = decideRegionAdmission(
      fabric,
      parsedPolicy(),
      parsedRequest({ requestedRegionId: "core_region_1", tenantDataIntended: true }),
      trustDecision(),
    );
    expect(decision.ok).toBe(true);
  });

  it("denies nodes that are not in an operational lifecycle state", () => {
    for (const state of ["proposed", "reviewed", "suspended", "retired"] as const) {
      const decision = decideRegionAdmission(
        fabric,
        parsedPolicy(),
        parsedRequest({ node: node({ lifecycleState: state }) }),
        trustDecision(),
      );
      expect(decision.ok).toBe(false);
      if (!decision.ok) expect(decision.reason).toBe("node_not_operational");
    }
  });

  it("parses requests fail-closed and refuses capability expansion", () => {
    expect(parseAdmissionRequest(request()).ok).toBe(true);
    expect(parseAdmissionRequest(request({ node: node({ capabilities: ["serve_presence"] }) })).ok).toBe(true);

    const expanded = parseAdmissionRequest(request({ capabilities: ["serve_presence", "admin_everything"] }));
    expect(expanded.ok).toBe(false);
    if (!expanded.ok) {
      expect(expanded.reason).toBe("capability_expansion");
      expect(expanded.issues[0].message).toContain("cannot widen standing");
    }

    expect(parseAdmissionRequest(request({ node: undefined })).ok).toBe(false);
    expect(parseAdmissionRequest(request({ declaredPurpose: "" })).ok).toBe(false);
    expect(parseAdmissionRequest(null).ok).toBe(false);
  });
});
