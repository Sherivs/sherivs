/**
 * CoreGrid — H3-079 planetary-infrastructure adversarial verification suite
 * (mission G-079, Verifier, phase 44, Squad G).
 *
 * Adversarial verification against the COMPLETED contract module
 * `frontend/src/lib/planetary-infrastructure/contracts.ts` (landed by H3-064).
 * This suite is READ-ONLY on that module: it deepens, and never duplicates,
 * the H3-064 contract suite. Attack vectors under verification:
 *
 *   1. raw-key-material injection into fingerprint-carrying surfaces;
 *   2. lifecycle-regression attempts (no silent standing increase, §6);
 *   3. machine-authored deployment approvals (§8 fail-closed);
 *   4. tenant-data placement on ineligible regions (residency beats
 *      availability);
 *   5. auto-trust bypass attempts (`requireExplicitTrust` must be
 *      inexpressible as false, E-060);
 *   6. trust-decision replay / node mismatch (decisions are not
 *      transferable);
 *   7. topology self-link / cycle smuggling.
 *
 * Every contained attack must end in a TYPED denial (a discriminated
 * `ok: false` decision or a structured parse failure). Any attack that
 * SUCCEEDS is recorded as an explicit FINDING test below — this suite never
 * fixes the module under verification. Pure offline: no network, no
 * database, no secrets (all key-shaped strings below are synthetic attack
 * fixtures, never real credentials).
 */
import { describe, expect, it } from "vitest";
import {
  KEY_FINGERPRINT_PATTERN,
  MAX_CAPABILITIES_PER_NODE,
  MAX_REGIONS_PER_TOPOLOGY,
  TENANT_DATA_ELIGIBLE_REGION_KINDS,
  admissionPolicySchema,
  canHostTenantData,
  decideNodeLifecycleTransition,
  decideRegionAdmission,
  distributedNodeIdentitySchema,
  effectiveTrustVerdict,
  keyFingerprintSchema,
  parseAdmissionRequest,
  parseRegionTopology,
  regionSchema,
  trustDecisionSchema,
  type AdmissionDecision,
  type AdmissionDenialReason,
  type AdmissionPolicy,
  type AdmissionRequest,
  type NodeLifecycleState,
  type RegionTopology,
} from "../../frontend/src/lib/planetary-infrastructure/contracts";

/* ─────────────────────────────────────────────────────────────
 * Fixtures (typed; parsed through the module's own fail-closed gates)
 * ────────────────────────────────────────────────────────────*/

const DECLARED_AT = "2026-10-03T00:00:00.000Z";
const REQUESTED_AT = "2026-10-03T01:00:00.000Z";

const PROVENANCE = {
  declaredBy: "role:infrastructure-architect",
  authority: "AGENTS.md §42 / H3 wave mission G-064",
  declaredAt: DECLARED_AT,
};

function regionFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

function topologyFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    topologyId: "fabric_main",
    version: 1,
    regions: [
      regionFixture(),
      regionFixture({ regionId: "edge_region_1", kind: "edge", tenantDataEligible: false }),
      regionFixture({ regionId: "compute_region_1", kind: "compute", tenantDataEligible: false }),
      regionFixture({ regionId: "worker_region_1", kind: "worker", tenantDataEligible: false }),
    ],
    links: [
      { fromRegionId: "core_region_1", toRegionId: "edge_region_1", linkKind: "backbone", weight: 10 },
      { fromRegionId: "core_region_1", toRegionId: "compute_region_1", linkKind: "regional", weight: 20 },
    ],
    ...overrides,
  };
}

function nodeFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

function requestFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: "req_001",
    node: nodeFixture(),
    requestedRegionId: "edge_region_1",
    declaredPurpose: "regional presence serving",
    requestedAt: REQUESTED_AT,
    tenantDataIntended: false,
    capabilities: ["serve_presence"],
    ...overrides,
  };
}

function trustDecisionFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

function approvalFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
  if (!result.success) {
    throw new Error(`fixture policy failed to parse: ${JSON.stringify(result.error.issues)}`);
  }
  return result.data;
}

function parsedTopology(overrides: Record<string, unknown> = {}): RegionTopology {
  const result = parseRegionTopology(topologyFixture(overrides));
  if (!result.ok) {
    throw new Error(`fixture topology failed to parse: ${JSON.stringify(result.issues)}`);
  }
  return result.topology;
}

function parsedRequest(overrides: Record<string, unknown> = {}): AdmissionRequest {
  const result = parseAdmissionRequest(requestFixture(overrides));
  if (!result.ok) {
    throw new Error(`fixture request failed to parse: ${JSON.stringify(result.issues)}`);
  }
  return result.request;
}

/** Asserts a decision is a typed denial with the exact expected reason. */
function expectDenied(
  decision: AdmissionDecision,
  reason: AdmissionDenialReason,
): void {
  expect(decision.ok).toBe(false);
  if (decision.ok) {
    throw new Error(`expected a typed denial (${reason}) but the attack was ADMITTED`);
  }
  expect(decision.verdict).toBe("denied");
  expect(decision.reason).toBe(reason);
  expect(decision.detail.length).toBeGreaterThan(0);
}

/* ─────────────────────────────────────────────────────────────
 * Vector 1 — raw-key-material injection
 * ────────────────────────────────────────────────────────────*/

describe("vector 1: raw-key-material injection", () => {
  const RAW_KEY_ATTACKS: readonly string[] = [
    "-----BEGIN RSA PRIVATE KEY-----",
    "-----BEGIN EC PRIVATE KEY-----MIIB",
    "-----BEGIN OPENSSH PRIVATE KEY-----",
    "sk_live_" + "a".repeat(32),
    "AKIA" + "A".repeat(16),
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abc123",
    "-----BEGIN CERTIFICATE-----",
    "0x" + "b".repeat(64),
    "c" + "w".repeat(47) + "AQAB",
  ];

  it("denies every raw-key-material shape in the fingerprint slot (typed regex denial)", () => {
    for (const raw of RAW_KEY_ATTACKS) {
      const parsed = keyFingerprintSchema.safeParse(raw);
      expect(parsed.success, `fingerprint slot accepted raw material: ${raw.slice(0, 24)}`).toBe(false);
    }
  });

  it("denies fingerprint look-alikes that are not sha256 hex digests", () => {
    expect(keyFingerprintSchema.safeParse("sha512:" + "a".repeat(64)).success).toBe(false);
    expect(keyFingerprintSchema.safeParse("md5:" + "a".repeat(32)).success).toBe(false);
    expect(keyFingerprintSchema.safeParse("sha256:" + "A".repeat(64)).success).toBe(false);
    expect(keyFingerprintSchema.safeParse("sha256:" + "z".repeat(64)).success).toBe(false);
    expect(keyFingerprintSchema.safeParse("sha256:" + "a".repeat(31)).success).toBe(false);
    expect(keyFingerprintSchema.safeParse("sha256:" + "a".repeat(129)).success).toBe(false);
    expect(keyFingerprintSchema.safeParse("sha256:").success).toBe(false);
    expect(keyFingerprintSchema.safeParse("a".repeat(64)).success).toBe(false);
    expect(KEY_FINGERPRINT_PATTERN.test("sha256:deadbeef")).toBe(false);
  });

  it("denies raw key material through the full node identity surface", () => {
    for (const raw of RAW_KEY_ATTACKS) {
      const parsed = distributedNodeIdentitySchema.safeParse(nodeFixture({ keyFingerprint: raw }));
      expect(parsed.success, `node identity accepted raw material: ${raw.slice(0, 24)}`).toBe(false);
    }
  });

  it("denies raw key material smuggled through an admission request's node block, and the parsed result never carries it", () => {
    for (const raw of RAW_KEY_ATTACKS) {
      const result = parseAdmissionRequest(requestFixture({ node: nodeFixture({ keyFingerprint: raw }) }));
      expect(result.ok, `admission request accepted raw material: ${raw.slice(0, 24)}`).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("invalid_shape");
        expect(result.issues.some((issue) => issue.path.includes("keyFingerprint"))).toBe(true);
      }
    }
  });

  it("injects key material into free-text fields and records the hygiene boundary honestly (no law claimed there)", () => {
    // The module's law scopes raw-key rejection to the fingerprint slot.
    // Free-text statements (purpose, reason, ownerRef) are bounded strings;
    // secret-hygiene over free text is the logging/redaction layer's duty
    // (AGENTS §29), not this schema's — recorded here as a boundary, and as
    // a Known Risk in the H3-079 report.
    const parsed = distributedNodeIdentitySchema.safeParse(
      nodeFixture({ purpose: "-----BEGIN RSA PRIVATE KEY-----" }),
    );
    expect(parsed.success).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Vector 2 — lifecycle-regression attempts (AGENTS §6)
 * ────────────────────────────────────────────────────────────*/

describe("vector 2: lifecycle-regression attempts", () => {
  const ALL_STATES: readonly NodeLifecycleState[] = [
    "proposed",
    "reviewed",
    "approved",
    "deployed",
    "suspended",
    "retired",
  ];

  /** The exact forward-only transition table the module documents. */
  const PERMITTED: Readonly<Record<NodeLifecycleState, readonly NodeLifecycleState[]>> = {
    proposed: ["reviewed", "retired"],
    reviewed: ["approved", "retired"],
    approved: ["deployed", "suspended", "retired"],
    deployed: ["suspended", "retired"],
    suspended: ["reviewed", "retired"],
    retired: [],
  };

  function isPermitted(from: NodeLifecycleState, to: NodeLifecycleState): boolean {
    return PERMITTED[from].includes(to);
  }

  it("holds the full 6x6 transition matrix to the forward-only table (every regression denied, every denial typed)", () => {
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        const decision = decideNodeLifecycleTransition(from, to, approvalFixture());
        if (isPermitted(from, to)) {
          expect(decision.ok, `expected ${from} → ${to} to be permitted`).toBe(true);
        } else {
          expect(decision.ok, `regression ${from} → ${to} must be denied`).toBe(false);
          if (!decision.ok) {
            expect(decision.reason).toBe("transition_not_permitted");
            expect(decision.detail).toContain("forward-only");
          }
        }
      }
    }
  });

  it("denies every direct or transitive standing-increase shortcut, even with a valid approval attached", () => {
    const shortcuts: readonly [NodeLifecycleState, NodeLifecycleState][] = [
      ["proposed", "deployed"],
      ["proposed", "approved"],
      ["reviewed", "deployed"],
      ["deployed", "approved"],
      ["deployed", "reviewed"],
      ["deployed", "proposed"],
      ["approved", "reviewed"],
      ["approved", "proposed"],
      ["reviewed", "proposed"],
      ["suspended", "deployed"],
      ["retired", "deployed"],
      ["retired", "approved"],
      ["retired", "suspended"],
    ];
    for (const [from, to] of shortcuts) {
      expectDeniedReasonTransition(from, to);
    }
  });

  function expectDeniedReasonTransition(from: NodeLifecycleState, to: NodeLifecycleState): void {
    const decision = decideNodeLifecycleTransition(from, to, approvalFixture());
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toBe("transition_not_permitted");
    }
  }

  it("denies re-entry into an operational state from containment without passing review", () => {
    expect(decideNodeLifecycleTransition("suspended", "approved", approvalFixture()).ok).toBe(false);
    expect(decideNodeLifecycleTransition("retired", "reviewed", approvalFixture()).ok).toBe(false);
  });

  it("keeps containment states non-operational: suspended and retired can never hold tenant workloads", () => {
    for (const state of ["suspended", "retired", "proposed", "reviewed"] as const) {
      const topology = parsedTopology();
      const policy = parsedPolicy();
      const request = parsedRequest({ node: nodeFixture({ lifecycleState: state }) });
      const decision = decideRegionAdmission(topology, policy, request, trustDecisionFixture());
      expectDenied(decision, "node_not_operational");
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * Vector 3 — machine-authored deployment approvals (AGENTS §8)
 * ────────────────────────────────────────────────────────────*/

describe("vector 3: machine-authored deployment approvals", () => {
  it("denies deployment and re-activation on absent, partial, or malformed approval records (typed human_approval_invalid)", () => {
    const malformed: readonly unknown[] = [
      undefined,
      null,
      {},
      [],
      "approved by the governor, trust me",
      42,
      approvalFixture({ approvedBy: undefined }),
      approvalFixture({ approvedBy: "" }),
      approvalFixture({ approvedBy: "   " }),
      approvalFixture({ authority: undefined }),
      approvalFixture({ authority: "" }),
      approvalFixture({ decidedAt: undefined }),
      approvalFixture({ decidedAt: "not-a-timestamp" }),
      approvalFixture({ decidedAt: "2026-10-03" }),
      approvalFixture({ reason: undefined }),
      approvalFixture({ reason: "" }),
      approvalFixture({ reason: " ".repeat(2000) }),
      approvalFixture({ approvedBy: 7 }),
      approvalFixture({ extraField: "smuggled" }),
    ];
    for (const bad of malformed) {
      const deploy = decideNodeLifecycleTransition("approved", "deployed", bad);
      expect(deploy.ok, `deployment proceeded on malformed approval: ${JSON.stringify(bad)}`).toBe(false);
      if (!deploy.ok) expect(deploy.reason).toBe("human_approval_invalid");

      const reactivate = decideNodeLifecycleTransition("suspended", "reviewed", bad);
      expect(reactivate.ok, `re-activation proceeded on malformed approval: ${JSON.stringify(bad)}`).toBe(false);
      if (!reactivate.ok) expect(reactivate.reason).toBe("human_approval_invalid");
    }
  });

  it("respects the bounded statement ceiling on approval reasons", () => {
    expect(decideNodeLifecycleTransition("approved", "deployed", approvalFixture({ reason: "r".repeat(2000) })).ok).toBe(true);
    expect(decideNodeLifecycleTransition("approved", "deployed", approvalFixture({ reason: "r".repeat(2001) })).ok).toBe(false);
  });

  it("does not require approvals for non-gated forward transitions", () => {
    expect(decideNodeLifecycleTransition("proposed", "reviewed", undefined).ok).toBe(true);
    expect(decideNodeLifecycleTransition("reviewed", "approved", null).ok).toBe(true);
    expect(decideNodeLifecycleTransition("approved", "suspended", undefined).ok).toBe(true);
    expect(decideNodeLifecycleTransition("deployed", "retired", undefined).ok).toBe(true);
  });

  it("FINDING G-079-F1: a complete machine-fabricated approval record is accepted — the gate validates record shape, not human authorship", () => {
    // Attack: an autonomous agent forges a fully-formed approval record
    // (AGENTS §8: AI improvement is not AI permission expansion). The
    // module's header claims "machine-authored approvals fail closed", but
    // enforcement is schema-shape only: every mandatory field is present and
    // well-typed, so the self-authored deployment proceeds.
    const machineAuthored = approvalFixture({
      approvedBy: "agent:h3-079-adversary",
      authority: "self-granted",
      reason: "self-service deployment by an autonomous agent",
    });
    const deploy = decideNodeLifecycleTransition("approved", "deployed", machineAuthored);
    const reactivate = decideNodeLifecycleTransition("suspended", "reviewed", machineAuthored);
    expect(deploy.ok).toBe(true);
    expect(reactivate.ok).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Vector 4 — tenant data on ineligible regions
 * ────────────────────────────────────────────────────────────*/

describe("vector 4: tenant data on ineligible regions", () => {
  it("denies tenant-data-intended placement on every ineligible region kind (typed region_not_tenant_data_eligible)", () => {
    const topology = parsedTopology();
    const policy = parsedPolicy();
    for (const regionId of ["edge_region_1", "compute_region_1", "worker_region_1"]) {
      const request = parsedRequest({ requestedRegionId: regionId, tenantDataIntended: true });
      const decision = decideRegionAdmission(topology, policy, request, trustDecisionFixture());
      expectDenied(decision, "region_not_tenant_data_eligible");
      if (!decision.ok) {
        expect(decision.detail).toContain("residency beats availability");
      }
    }
  });

  it("denies tenant data on an eligible kind whose eligibility was declared false (declaration and kind must agree)", () => {
    const topology = parsedTopology({
      regions: [regionFixture({ regionId: "storage_locked", kind: "storage", tenantDataEligible: false })],
      links: [],
    });
    const request = parsedRequest({ requestedRegionId: "storage_locked", tenantDataIntended: true });
    const decision = decideRegionAdmission(
      topology,
      parsedPolicy(),
      request,
      trustDecisionFixture({ nodeId: "node_ext_1" }),
    );
    expectDenied(decision, "region_not_tenant_data_eligible");
  });

  it("fails the whole topology parse when an ineligible kind claims tenant-data eligibility — no partial topology escapes", () => {
    const smuggled = parseRegionTopology(
      topologyFixture({
        regions: [regionFixture({ regionId: "edge_greedy", kind: "edge", tenantDataEligible: true })],
      }),
    );
    expect(smuggled.ok).toBe(false);
    expect("topology" in smuggled).toBe(false);
    if (!smuggled.ok) {
      expect(smuggled.reason).toBe("invalid_shape");
      expect(smuggled.issues.some((issue) => issue.path.includes("tenantDataEligible"))).toBe(true);
    }
  });

  it("holds the kind-based check in depth even when a forged region object bypasses the schema via a cast", () => {
    // Attack: an upstream caller forges a Region with kind "compute" and
    // tenantDataEligible true, bypassing regionSchema, and injects it into
    // the decision path. canHostTenantData's independent kind check must
    // still deny (defense in depth). The cast is a deliberate type-system
    // bypass simulating the forged input; no `any` is involved.
    const forgedRegion = {
      regionId: "edge_region_1",
      kind: "compute",
      jurisdiction: "jurisdiction:neutral",
      tenantDataEligible: true,
      capacityUnits: 1000,
      provenance: PROVENANCE,
    } as unknown as Parameters<typeof canHostTenantData>[0];
    expect(canHostTenantData(forgedRegion)).toBe(false);

    const forgedTopology = {
      ...parsedTopology(),
      regions: [forgedRegion],
    } as unknown as RegionTopology;
    const request = parsedRequest({ requestedRegionId: "edge_region_1", tenantDataIntended: true });
    const decision = decideRegionAdmission(forgedTopology, parsedPolicy(), request, trustDecisionFixture());
    expectDenied(decision, "region_not_tenant_data_eligible");
  });

  it("denies tenant-data intent on unknown regions at the earlier unknown_region gate (deny order is fail-closed)", () => {
    const request = parsedRequest({ requestedRegionId: "ghost_region", tenantDataIntended: true });
    const decision = decideRegionAdmission(parsedTopology(), parsedPolicy(), request, trustDecisionFixture());
    expectDenied(decision, "unknown_region");
  });

  it("keeps the eligible set exactly control+storage and admits tenant data only there", () => {
    expect([...TENANT_DATA_ELIGIBLE_REGION_KINDS].sort()).toEqual(["control", "storage"]);
    for (const kind of ["control", "storage"] as const) {
      expect(regionSchema.safeParse(regionFixture({ kind })).success).toBe(true);
    }
    for (const kind of ["compute", "edge", "worker"] as const) {
      expect(regionSchema.safeParse(regionFixture({ kind, tenantDataEligible: true })).success).toBe(false);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * Vector 5 — auto-trust bypass (requireExplicitTrust is inexpressible as false)
 * ────────────────────────────────────────────────────────────*/

describe("vector 5: auto-trust bypass attempts", () => {
  it("makes every falsy, coerced, or absent requireExplicitTrust value unparseable (z.literal(true))", () => {
    const bypassAttempts: readonly unknown[] = [
      false,
      0,
      1,
      "",
      "true",
      "yes",
      null,
      undefined,
      NaN,
    ];
    for (const bypass of bypassAttempts) {
      const parsed = admissionPolicySchema.safeParse(policyFixture({ requireExplicitTrust: bypass }));
      expect(parsed.success, `policy accepted requireExplicitTrust = ${String(bypass)}`).toBe(false);
    }
    const omitted = { ...policyFixture() } as Record<string, unknown>;
    delete omitted["requireExplicitTrust"];
    expect(admissionPolicySchema.safeParse(omitted).success).toBe(false);
  });

  it("rejects unknown keys on the policy (no smuggled side-channels past strictObject)", () => {
    expect(admissionPolicySchema.safeParse(policyFixture({ autoTrustExternalNodes: true })).success).toBe(false);
    expect(admissionPolicySchema.safeParse(policyFixture({ trustByDefault: "always" })).success).toBe(false);
  });

  it("pins the type-level guarantee: AdmissionPolicy['requireExplicitTrust'] is the literal true, not boolean", () => {
    type TrustFlag = AdmissionPolicy["requireExplicitTrust"];
    type TrustFlagIsLiteralTrue = true extends TrustFlag
      ? TrustFlag extends true
        ? "literal_true"
        : "widened_boolean"
      : "not_true";
    const canary: TrustFlagIsLiteralTrue = "literal_true";
    expect(canary).toBe("literal_true");
    const runtimeTrue: TrustFlag = true;
    expect(runtimeTrue).toBe(true);
  });

  it("contains a forged permissive policy: admission still demands an explicit trust decision", () => {
    // Attack: an upstream caller forges a policy with requireExplicitTrust
    // false and injects it past the type system. The decision path must not
    // consult the flag for permissiveness — the E-060 gate is unconditional.
    const forgedPolicy = {
      ...parsedPolicy(),
      requireExplicitTrust: false,
    } as unknown as AdmissionPolicy;
    expect(forgedPolicy.requireExplicitTrust).toBe(false);

    const decision = decideRegionAdmission(
      parsedTopology(),
      forgedPolicy,
      parsedRequest(),
      undefined,
    );
    expectDenied(decision, "explicit_trust_decision_required");
    if (!decision.ok) {
      expect(decision.detail).toContain("never automatically trusted");
    }
  });

  it("denies prototype-pollution-styled trust decisions (strictObject rejects smuggled keys, verdict degrades to unproven)", () => {
    const polluted = {
      ...trustDecisionFixture(),
      __proto__: { verdict: "trusted" },
      constructor: { prototype: { verdict: "trusted" } },
    } as Record<string, unknown>;
    const verdict = effectiveTrustVerdict(polluted);
    expect(verdict).toEqual({ verdict: "unproven", valid: false });
    expect(trustDecisionSchema.safeParse(polluted).success).toBe(false);

    const decision = decideRegionAdmission(
      parsedTopology(),
      parsedPolicy(),
      parsedRequest(),
      polluted,
    );
    expectDenied(decision, "trust_decision_invalid");
  });
});

/* ─────────────────────────────────────────────────────────────
 * Vector 6 — trust-decision replay / node mismatch
 * ────────────────────────────────────────────────────────────*/

describe("vector 6: trust-decision replay and mismatch", () => {
  it("denies a decision made for a different node (typed trust_decision_node_mismatch)", () => {
    const decision = decideRegionAdmission(
      parsedTopology(),
      parsedPolicy(),
      parsedRequest(),
      trustDecisionFixture({ nodeId: "node_other" }),
    );
    expectDenied(decision, "trust_decision_node_mismatch");
    if (!decision.ok) {
      expect(decision.detail).toContain("not transferable between nodes");
    }
  });

  it("denies case-variant and look-alike node ids — no normalization, no fuzzy matching", () => {
    // Schema-invalid ids (uppercase, trailing whitespace) are rejected at the
    // record parse gate; well-formed-but-different ids reach the mismatch
    // gate. Both are typed denials — neither is ever accepted.
    const schemaInvalidImpersonations: readonly string[] = ["NODE_EXT_1", "node_ext_1 "];
    const wellFormedImpersonations: readonly string[] = ["node_ext_2", "node_ext_10", "node_ext_11"];

    for (const impersonated of schemaInvalidImpersonations) {
      const decision = decideRegionAdmission(
        parsedTopology(),
        parsedPolicy(),
        parsedRequest(),
        trustDecisionFixture({ nodeId: impersonated }),
      );
      expect(decision.ok, `look-alike node id accepted: "${impersonated}"`).toBe(false);
      if (!decision.ok) {
        expect(decision.reason).toBe("trust_decision_invalid");
      }
    }

    for (const impersonated of wellFormedImpersonations) {
      const decision = decideRegionAdmission(
        parsedTopology(),
        parsedPolicy(),
        parsedRequest(),
        trustDecisionFixture({ nodeId: impersonated }),
      );
      expect(decision.ok, `look-alike node id accepted: "${impersonated}"`).toBe(false);
      if (!decision.ok) {
        expect(decision.reason).toBe("trust_decision_node_mismatch");
      }
    }
  });

  it("denies a replayed decision whose provenance was stripped below the record minimum", () => {
    const stripped = trustDecisionFixture({ decidedBy: "", authority: "", basisEvidenceRef: "" });
    const verdict = effectiveTrustVerdict(stripped);
    expect(verdict).toEqual({ verdict: "unproven", valid: false });

    const decision = decideRegionAdmission(
      parsedTopology(),
      parsedPolicy(),
      parsedRequest(),
      stripped,
    );
    expectDenied(decision, "trust_decision_invalid");
  });

  it("FINDING G-079-F2: a valid trusted decision replays indefinitely — no region binding, no freshness, no single-use semantics at this layer", () => {
    // Attack: capture one valid node-matched trust decision and replay it
    // (a) across distinct admission requests, (b) onto a different region,
    // and (c) long after it was decided. All three replays are accepted.
    const replayedDecision = trustDecisionFixture({ decidedAt: "2020-01-01T00:00:00.000Z" });

    const first = decideRegionAdmission(
      parsedTopology(),
      parsedPolicy(),
      parsedRequest({ requestId: "req_replay_a", requestedRegionId: "edge_region_1" }),
      replayedDecision,
    );
    const second = decideRegionAdmission(
      parsedTopology(),
      parsedPolicy(),
      parsedRequest({ requestId: "req_replay_b", requestedRegionId: "core_region_1" }),
      replayedDecision,
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    // A tampered-but-well-formed replay (mutated decidedBy / reason /
    // decidedAt) is equally accepted: there is no integrity binding on the
    // record at this layer.
    const tampered = decideRegionAdmission(
      parsedTopology(),
      parsedPolicy(),
      parsedRequest({ requestId: "req_replay_c" }),
      trustDecisionFixture({
        decidedBy: "attacker:after-the-fact",
        decidedAt: "2019-06-01T00:00:00.000Z",
      }),
    );
    expect(tampered.ok).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Vector 7 — topology self-link / cycle smuggling
 * ────────────────────────────────────────────────────────────*/

describe("vector 7: topology self-link and cycle smuggling", () => {
  it("denies a direct self-link with a typed schema issue at the offending path", () => {
    const selfLink = parseRegionTopology(
      topologyFixture({
        links: [{ fromRegionId: "core_region_1", toRegionId: "core_region_1", linkKind: "backbone", weight: 1 }],
      }),
    );
    expect(selfLink.ok).toBe(false);
    if (!selfLink.ok) {
      expect(selfLink.reason).toBe("invalid_shape");
      expect(selfLink.issues.some((issue) => issue.path.includes("toRegionId"))).toBe(true);
      expect(selfLink.issues.some((issue) => issue.message.includes("attach a region to itself"))).toBe(true);
    }
  });

  it("denies a disguised self-link declared with different link kind or weight", () => {
    for (const linkKind of ["backbone", "regional", "edge_uplink"] as const) {
      const disguised = parseRegionTopology(
        topologyFixture({
          links: [{ fromRegionId: "edge_region_1", toRegionId: "edge_region_1", linkKind, weight: 0 }],
        }),
      );
      expect(disguised.ok, `self-link smuggled as linkKind "${linkKind}"`).toBe(false);
    }
  });

  it("FINDING G-079-F3: cyclic topologies are smugglable — two-node and three-node cycles parse successfully", () => {
    // Attack: a↔b (and a→b→c→a) are distinct ordered pairs, so neither the
    // self-link refine nor the ordered-pair duplicate check fires. The
    // module documents no acyclicity invariant, and the parse admits the
    // cycle rather than returning a typed denial.
    const twoCycle = parseRegionTopology(
      topologyFixture({
        links: [
          { fromRegionId: "core_region_1", toRegionId: "edge_region_1", linkKind: "backbone", weight: 1 },
          { fromRegionId: "edge_region_1", toRegionId: "core_region_1", linkKind: "backbone", weight: 1 },
        ],
      }),
    );
    expect(twoCycle.ok).toBe(true);

    const threeCycle = parseRegionTopology(
      topologyFixture({
        links: [
          { fromRegionId: "core_region_1", toRegionId: "edge_region_1", linkKind: "backbone", weight: 1 },
          { fromRegionId: "edge_region_1", toRegionId: "compute_region_1", linkKind: "regional", weight: 1 },
          { fromRegionId: "compute_region_1", toRegionId: "core_region_1", linkKind: "regional", weight: 1 },
        ],
      }),
    );
    expect(threeCycle.ok).toBe(true);
  });

  it("keeps the sibling invariants intact while cycles slip through: duplicates and unresolved endpoints still deny", () => {
    const duplicated = parseRegionTopology(
      topologyFixture({
        links: [
          { fromRegionId: "core_region_1", toRegionId: "edge_region_1", linkKind: "backbone", weight: 1 },
          { fromRegionId: "core_region_1", toRegionId: "edge_region_1", linkKind: "backbone", weight: 2 },
        ],
      }),
    );
    expect(duplicated.ok).toBe(false);
    if (!duplicated.ok) expect(duplicated.reason).toBe("cross_record_invariant");

    const unresolved = parseRegionTopology(
      topologyFixture({
        links: [{ fromRegionId: "core_region_1", toRegionId: "ghost_region", linkKind: "backbone", weight: 1 }],
      }),
    );
    expect(unresolved.ok).toBe(false);
    if (!unresolved.ok) expect(unresolved.reason).toBe("cross_record_invariant");
  });

  it("keeps the bounded-input ceilings enforced under adversarial volume", () => {
    const flood = Array.from({ length: MAX_REGIONS_PER_TOPOLOGY + 1 }, (_, index) =>
      regionFixture({ regionId: `r${index}_region` }),
    );
    const flooded = parseRegionTopology(topologyFixture({ regions: flood, links: [] }));
    expect(flooded.ok).toBe(false);

    const capabilityFlood = Array.from({ length: MAX_CAPABILITIES_PER_NODE + 1 }, (_, index) => `cap_${index}`);
    const overCapability = parseAdmissionRequest(
      requestFixture({ node: nodeFixture({ capabilities: capabilityFlood.slice(0, MAX_CAPABILITIES_PER_NODE) }), capabilities: capabilityFlood }),
    );
    expect(overCapability.ok).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Cross-vector sanity — the honest path still exists
 * ────────────────────────────────────────────────────────────*/

describe("control: legitimate path is untouched by the adversarial hardening", () => {
  it("a governed, provenanced, node-matched admission on an eligible region still succeeds", () => {
    const decision = decideRegionAdmission(
      parsedTopology(),
      parsedPolicy(),
      parsedRequest({ requestId: "req_honest", requestedRegionId: "core_region_1", tenantDataIntended: true }),
      trustDecisionFixture(),
    );
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.verdict).toBe("admitted");
      expect(decision.basis).toBe("explicit_trust_decision");
    }
  });
});
