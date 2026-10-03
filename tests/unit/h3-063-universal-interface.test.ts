/**
 * CoreGrid — H3-063 universal-interface contract tests (mission G-063).
 * Zod validation of the phase-43 connectivity substrate contracts: connector
 * kernel, zero-trust verification, guard-evidence posture (never
 * authorization), discovery registration (fail-closed), protocol
 * translation (never drops), offline sync conflict escalation, universal
 * action gateway (proposal-only until the platform authorization engine
 * records ALLOW), health/self-healing, and module hygiene (strict TS, no
 * vendor imports, no I/O, domain-neutral).
 * Pure offline: no network, no database, no secrets.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  ACTION_KINDS,
  CONNECTION_GUARD_KINDS,
  CONNECTOR_TYPES,
  HEALING_STAGES,
  IMPACT_TIERS,
  MAX_ACTION_KINDS,
  MAX_OFFLINE_QUEUE_ITEMS,
  MAX_REGISTRY_CONNECTORS,
  OBSERVATION_ONLY_CONNECTOR_KINDS,
  PLATFORM_DECISIONS,
  TRUST_LEVELS,
  actionExecutionSchema,
  actionGate,
  actionProposalSchema,
  advanceHealingCycle,
  connectionGuardPosture,
  connectionVerificationSchema,
  connectorRecordSchema,
  discoveryScanSchema,
  effectiveHealthState,
  effectiveTrustLevel,
  healthReportSchema,
  healingCycleSchema,
  interfaceEventSchema,
  isObservationOnlyConnectorKind,
  lifecycleTransition,
  offlineQueueSchema,
  parseActionProposal,
  parseConnectorRecord,
  parseInterfaceEvent,
  parseUniversalInterfaceRegistry,
  registerCandidate,
  signalSampleSchema,
  syncOutcome,
  translateSample,
  translationContractSchema,
  type ConnectorRecord,
  type DiscoveryScan,
  type HealingCycle,
  type SignalSample,
} from "../../frontend/src/lib/universal-interface/contracts";

const TS0 = "2026-10-03T00:00:00.000Z";
const TS1 = "2026-10-03T01:00:00.000Z";
const TS_EARLIER = "2026-09-30T00:00:00.000Z";

function digest(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

const D_A = digest("connector-a");
const D_B = digest("connector-b");

const PROVENANCE = {
  recordedBy: "role_universal_interface_architect",
  recordedAt: TS0,
  source: "operator_declaration" as const,
};

function connectorRecord(overrides: Record<string, unknown> = {}): ConnectorRecord {
  return {
    connectorId: "conn_alpha",
    universalId: "CGID-SOFT-0001",
    tenantId: "tenant_main",
    kind: "api",
    displayName: "Alpha Connector",
    version: "1.2.0",
    owner: "owner_platform_ops",
    lifecycleState: "ACTIVE",
    actionKinds: ["observe", "write"],
    capabilities: ["schema_discovery", "sync"],
    fingerprint: D_A,
    registeredAt: TS0,
    updatedAt: TS1,
    provenance: PROVENANCE,
    ...overrides,
  } as ConnectorRecord;
}

function verification(overrides: Record<string, unknown> = {}) {
  return {
    connectorId: "conn_alpha",
    verifiedAt: TS0,
    verifiedUntil: "2026-10-04T00:00:00.000Z",
    grantedTrustLevel: "VERIFIED" as const,
    method: "method_continuous_challenge",
    evidenceDigest: D_A,
    ...overrides,
  };
}

function sample(overrides: Record<string, unknown> = {}): SignalSample {
  return {
    sampleId: "sample_001",
    connectorId: "conn_alpha",
    capturedAt: TS0,
    contentDigest: D_B,
    fields: [
      { key: "raw_value", value: 42 },
      { key: "raw_label", value: "  padded  " },
      { key: "raw_flag", value: "true" },
    ],
    ...overrides,
  };
}

function translationContract(overrides: Record<string, unknown> = {}) {
  return {
    translationId: "trans_001",
    connectorId: "conn_alpha",
    mappings: [
      { rawKey: "raw_value", canonicalKey: "value", transform: "number" as const, required: true },
      { rawKey: "raw_label", canonicalKey: "label", transform: "trim" as const, required: false },
      { rawKey: "raw_flag", canonicalKey: "flag", transform: "boolean" as const, required: true },
    ],
    provenance: PROVENANCE,
    ...overrides,
  };
}

function scan(candidates: Record<string, unknown>[], overrides: Record<string, unknown> = {}) {
  return {
    scanId: "scan_001",
    tenantId: "tenant_main",
    scope: "network" as const,
    requestedBy: "operator_discovery",
    requestedAt: TS0,
    candidates: candidates.map((candidate) => ({
      candidateId: "cand_001",
      connectorKind: "device" as const,
      fingerprint: D_A,
      observedProtocols: ["protocol_serial"],
      discoveredAt: TS0,
      trustLevel: "UNTRUSTED" as const,
      ...candidate,
    })),
    provenance: PROVENANCE,
    ...overrides,
  } as unknown as DiscoveryScan;
}

const REGISTRATION_INPUT = {
  connectorId: "conn_beta",
  grantedUniversalId: "CGID-DEV-0002",
  displayName: "Beta Connector",
  version: "0.1.0",
  owner: "owner_platform_ops",
  actionKinds: ["observe" as const],
  capabilities: ["observation"],
  guardEvidence: {
    guards: CONNECTION_GUARD_KINDS.map((kind) => ({ kind, reference: `ref_${kind}` })),
  },
};

const FULL_GUARD_EVIDENCE = {
  guards: CONNECTION_GUARD_KINDS.map((kind) => ({ kind, reference: `ref_${kind}` })),
};

describe("vocabulary and bounds", () => {
  it("declares bounded, duplicate-free vocabularies", () => {
    for (const vocabulary of [CONNECTOR_TYPES, TRUST_LEVELS, ACTION_KINDS, IMPACT_TIERS, HEALING_STAGES]) {
      expect(new Set(vocabulary).size).toBe(vocabulary.length);
    }
    expect(CONNECTOR_TYPES).toContain("api");
    expect(CONNECTOR_TYPES).toContain("mcp");
    expect(CONNECTOR_TYPES).toContain("database");
    expect(CONNECTOR_TYPES).toContain("local_runtime_bridge");
    expect(CONNECTOR_TYPES).toContain("external_reality");
  });

  it("keeps observation-only kinds a strict subset of connector kinds", () => {
    for (const kind of OBSERVATION_ONLY_CONNECTOR_KINDS) {
      expect(CONNECTOR_TYPES).toContain(kind);
      expect(isObservationOnlyConnectorKind(kind)).toBe(true);
    }
    expect(isObservationOnlyConnectorKind("api")).toBe(false);
    expect(isObservationOnlyConnectorKind("device")).toBe(false);
  });

  it("carries positive integer bounds", () => {
    expect(MAX_ACTION_KINDS).toBeGreaterThan(0);
    expect(MAX_REGISTRY_CONNECTORS).toBeGreaterThan(0);
    expect(MAX_OFFLINE_QUEUE_ITEMS).toBeGreaterThan(0);
  });

  it("mirrors the platform authorization decision vocabulary without computing it", () => {
    expect([...PLATFORM_DECISIONS]).toEqual(["ALLOW", "DENY", "REDACT", "ESCALATE", "REQUIRE_APPROVAL"]);
  });
});

describe("connector record schema (fail-closed shape)", () => {
  it("accepts a complete connector record", () => {
    const parsed = connectorRecordSchema.safeParse(connectorRecord());
    expect(parsed.success).toBe(true);
  });

  it("rejects malformed records", () => {
    expect(connectorRecordSchema.safeParse(connectorRecord({ lifecycleState: "ONLINE" })).success).toBe(false);
    expect(connectorRecordSchema.safeParse(connectorRecord({ universalId: "cgid-soft-0001" })).success).toBe(false);
    expect(connectorRecordSchema.safeParse(connectorRecord({ fingerprint: "deadbeef" })).success).toBe(false);
    expect(connectorRecordSchema.safeParse(connectorRecord({ version: "1.0" })).success).toBe(false);
    expect(connectorRecordSchema.safeParse(connectorRecord({ provenance: { ...PROVENANCE, recordedBy: "" } })).success).toBe(false);
    expect(connectorRecordSchema.safeParse({ ...connectorRecord(), extraKey: true }).success).toBe(false);
  });

  it("rejects unbounded declared capabilities and action kinds", () => {
    const manyKinds = Array.from({ length: MAX_ACTION_KINDS + 1 }, () => "observe" as const);
    expect(connectorRecordSchema.safeParse(connectorRecord({ actionKinds: manyKinds })).success).toBe(false);
  });

  it("exposes the parse helper with structured issues", () => {
    const result = parseConnectorRecord(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_shape");
      expect(result.issues.length).toBeGreaterThan(0);
    }
    const good = parseConnectorRecord(connectorRecord());
    expect(good.ok).toBe(true);
  });
});

describe("registry parsing (cross-record invariants, tenant coherence)", () => {
  it("parses a valid tenant registry", () => {
    const result = parseUniversalInterfaceRegistry({
      registryId: "registry_main",
      tenantId: "tenant_main",
      connectors: [connectorRecord()],
      updatedAt: TS1,
      provenance: PROVENANCE,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects malformed inputs without partial results", () => {
    for (const bad of [null, 42, "registry", [connectorRecord()]]) {
      const result = parseUniversalInterfaceRegistry(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("invalid_shape");
    }
  });

  it("rejects duplicate connector and universal identities", () => {
    const duplicateId = parseUniversalInterfaceRegistry({
      registryId: "registry_main",
      tenantId: "tenant_main",
      connectors: [connectorRecord(), connectorRecord({ universalId: "CGID-SOFT-0002" })],
      updatedAt: TS1,
      provenance: PROVENANCE,
    });
    expect(duplicateId.ok).toBe(false);
    if (!duplicateId.ok) {
      expect(duplicateId.reason).toBe("cross_record_invariant");
      expect(duplicateId.issues.some((issue) => issue.message.includes("duplicate connectorId"))).toBe(true);
    }

    const duplicateUniversal = parseUniversalInterfaceRegistry({
      registryId: "registry_main",
      tenantId: "tenant_main",
      connectors: [connectorRecord(), connectorRecord({ connectorId: "conn_gamma" })],
      updatedAt: TS1,
      provenance: PROVENANCE,
    });
    expect(duplicateUniversal.ok).toBe(false);
    if (!duplicateUniversal.ok) {
      expect(duplicateUniversal.issues.some((issue) => issue.message.includes("duplicate universalId"))).toBe(true);
    }
  });

  it("rejects connectors whose tenant context diverges from the registry", () => {
    const result = parseUniversalInterfaceRegistry({
      registryId: "registry_main",
      tenantId: "tenant_main",
      connectors: [connectorRecord({ tenantId: "tenant_other" })],
      updatedAt: TS1,
      provenance: PROVENANCE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0].path).toContain("tenantId");
    }
  });

  it("rejects an observation-only kind declaring elevated action kinds", () => {
    const result = parseUniversalInterfaceRegistry({
      registryId: "registry_main",
      tenantId: "tenant_main",
      connectors: [connectorRecord({ kind: "sensor", actionKinds: ["observe", "write"] })],
      updatedAt: TS1,
      provenance: PROVENANCE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("cross_record_invariant");
      expect(result.issues[0].message).toContain("observation-only");
    }
  });

  it("rejects records moving backwards in time", () => {
    const result = parseUniversalInterfaceRegistry({
      registryId: "registry_main",
      tenantId: "tenant_main",
      connectors: [connectorRecord({ updatedAt: TS_EARLIER })],
      updatedAt: TS1,
      provenance: PROVENANCE,
    });
    expect(result.ok).toBe(false);
  });

  it("enforces the registry connector bound", () => {
    const many = Array.from({ length: MAX_REGISTRY_CONNECTORS + 1 }, (_, i) =>
      connectorRecord({ connectorId: `conn_${i}`, universalId: `CGID-SOFT-${String(i).padStart(4, "0")}` }),
    );
    const result = parseUniversalInterfaceRegistry({
      registryId: "registry_main",
      tenantId: "tenant_main",
      connectors: many,
      updatedAt: TS1,
      provenance: PROVENANCE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_shape");
  });
});

describe("continuous zero-trust verification (derived, never stored)", () => {
  const record = connectorRecord();

  it("degrades to UNTRUSTED when no verification exists", () => {
    expect(effectiveTrustLevel(record, undefined, TS1)).toBe("UNTRUSTED");
  });

  it("grants the verified level only for fresh, matching, evidence-bound verification", () => {
    expect(effectiveTrustLevel(record, verification(), TS1)).toBe("VERIFIED");
    expect(
      effectiveTrustLevel(record, verification({ grantedTrustLevel: "HARDENED" as const }), TS1),
    ).toBe("HARDENED");
  });

  it("degrades to UNTRUSTED on expiry, mismatch, or unbound evidence", () => {
    expect(effectiveTrustLevel(record, verification({ verifiedUntil: TS1 }), TS1)).toBe("UNTRUSTED");
    expect(effectiveTrustLevel(record, verification({ connectorId: "conn_other" }), TS1)).toBe("UNTRUSTED");
    expect(effectiveTrustLevel(record, verification({ evidenceDigest: D_B }), TS1)).toBe("UNTRUSTED");
    expect(
      effectiveTrustLevel(record, verification({ verifiedAt: TS1, verifiedUntil: "2026-10-05T00:00:00.000Z" }), TS0),
    ).toBe("UNTRUSTED");
  });

  it("refuses verification records that grant UNTRUSTED or invert their window", () => {
    expect(connectionVerificationSchema.safeParse(verification({ grantedTrustLevel: "UNTRUSTED" })).success).toBe(false);
    expect(
      connectionVerificationSchema.safeParse(verification({ verifiedUntil: "2026-10-02T00:00:00.000Z" })).success,
    ).toBe(false);
  });

  it("never stores trust on the connector record", () => {
    expect("trustLevel" in record).toBe(false);
  });
});

describe("connection guard posture (evidence completeness, not authorization)", () => {
  const record = connectorRecord();

  it("is satisfied only when every mandated guard has evidence", () => {
    const posture = connectionGuardPosture(record, FULL_GUARD_EVIDENCE);
    expect(posture.status).toBe("SATISFIED");
    if (posture.status === "SATISFIED") {
      expect(posture.guards).toHaveLength(CONNECTION_GUARD_KINDS.length);
    }
  });

  it("fails closed naming the missing guards", () => {
    const partial = { guards: FULL_GUARD_EVIDENCE.guards.slice(0, 3) };
    const posture = connectionGuardPosture(record, partial);
    expect(posture.status).toBe("UNSATISFIED");
    if (posture.status === "UNSATISFIED") {
      expect(posture.missing).toEqual(["monitoring", "audit"]);
      expect(posture.detail).toContain("fail-closed");
    }
    const empty = connectionGuardPosture(record, { guards: [] });
    expect(empty.status).toBe("UNSATISFIED");
    if (empty.status === "UNSATISFIED") {
      expect(empty.missing).toEqual([...CONNECTION_GUARD_KINDS]);
    }
  });

  it("does not let duplicate evidence inflate coverage", () => {
    const duplicated = {
      guards: [
        { kind: "identity" as const, reference: "ref_identity_a" },
        { kind: "identity" as const, reference: "ref_identity_b" },
        { kind: "identity" as const, reference: "ref_identity_c" },
      ],
    };
    const posture = connectionGuardPosture(record, duplicated);
    expect(posture.status).toBe("UNSATISFIED");
    if (posture.status === "UNSATISFIED") {
      expect(posture.missing).toEqual(["authentication", "encryption", "monitoring", "audit"]);
    }
  });

  it("emits posture vocabulary that is not the authorization decision vocabulary", () => {
    for (const status of ["SATISFIED", "UNSATISFIED"] as const) {
      expect(PLATFORM_DECISIONS).not.toContain(status);
    }
  });
});

describe("discovery engine (discovered is not trusted)", () => {
  it("accepts candidates only with the UNTRUSTED literal label", () => {
    const parsed = discoveryScanSchema.safeParse(scan([{}]));
    expect(parsed.success).toBe(true);
    const trustedLooking = scan([{ trustLevel: "VERIFIED" }]);
    expect(discoveryScanSchema.safeParse(trustedLooking).success).toBe(false);
  });

  it("blocks registration of an unknown candidate", () => {
    const verdict = registerCandidate(scan([{}]), "cand_missing", REGISTRATION_INPUT);
    expect(verdict.status).toBe("BLOCKED");
    if (verdict.status === "BLOCKED") expect(verdict.reason).toBe("unknown_candidate");
  });

  it("blocks registration of a candidate that is not labelled UNTRUSTED (defensive)", () => {
    const impostor = scan([{}]) as unknown as DiscoveryScan;
    (impostor.candidates[0] as { trustLevel: string }).trustLevel = "VERIFIED";
    const verdict = registerCandidate(impostor, "cand_001", REGISTRATION_INPUT);
    expect(verdict.status).toBe("BLOCKED");
    if (verdict.status === "BLOCKED") expect(verdict.reason).toBe("candidate_not_untrusted");
  });

  it("blocks registration without a platform-issued universal identity", () => {
    const input = { ...REGISTRATION_INPUT };
    delete (input as { grantedUniversalId?: string }).grantedUniversalId;
    const verdict = registerCandidate(scan([{}]), "cand_001", input);
    expect(verdict.status).toBe("BLOCKED");
    if (verdict.status === "BLOCKED") expect(verdict.reason).toBe("missing_universal_identity");
  });

  it("blocks registration on incomplete guard evidence", () => {
    const input = {
      ...REGISTRATION_INPUT,
      guardEvidence: { guards: FULL_GUARD_EVIDENCE.guards.slice(0, 2) },
    };
    const verdict = registerCandidate(scan([{}]), "cand_001", input);
    expect(verdict.status).toBe("BLOCKED");
    if (verdict.status === "BLOCKED") {
      expect(verdict.reason).toBe("guards_unsatisfied");
      expect(verdict.detail).toContain("encryption");
    }
  });

  it("blocks observation-only elevation at the registration boundary", () => {
    const verdict = registerCandidate(scan([{ connectorKind: "sensor" }]), "cand_001", {
      ...REGISTRATION_INPUT,
      actionKinds: ["observe", "write"],
    });
    expect(verdict.status).toBe("BLOCKED");
    if (verdict.status === "BLOCKED") expect(verdict.reason).toBe("observation_only_elevation");
  });

  it("registers a complete candidate as PROPOSED with no stored trust", () => {
    const verdict = registerCandidate(scan([{ connectorKind: "device" }]), "cand_001", REGISTRATION_INPUT);
    expect(verdict.status).toBe("REGISTERED");
    if (verdict.status === "REGISTERED") {
      expect(verdict.connector.lifecycleState).toBe("PROPOSED");
      expect(verdict.connector.kind).toBe("device");
      expect(verdict.connector.fingerprint).toBe(D_A);
      expect("trustLevel" in verdict.connector).toBe(false);
      expect(verdict.connector.tenantId).toBe("tenant_main");
    }
  });
});

describe("lifecycle transitions (structurally well-formed edges)", () => {
  it("allows the well-formed edges", () => {
    for (const [from, to] of [
      ["PROPOSED", "APPROVED"],
      ["APPROVED", "ACTIVE"],
      ["ACTIVE", "DEGRADED"],
      ["DEGRADED", "ACTIVE"],
      ["ACTIVE", "SUSPENDED"],
      ["SUSPENDED", "ACTIVE"],
      ["APPROVED", "RETIRED"],
      ["SUSPENDED", "RETIRED"],
    ] as const) {
      expect(lifecycleTransition(from, to).ok).toBe(true);
    }
  });

  it("rejects meaningless edges", () => {
    for (const [from, to] of [
      ["PROPOSED", "ACTIVE"],
      ["RETIRED", "ACTIVE"],
      ["SUSPENDED", "PROPOSED"],
      ["RETIRED", "SUSPENDED"],
      ["ACTIVE", "PROPOSED"],
    ] as const) {
      const verdict = lifecycleTransition(from, to);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.reason).toContain("not a well-formed");
    }
  });
});

describe("protocol translation (a partial translation is a failed translation)", () => {
  it("translates a fully-mapped sample into a canonical envelope", () => {
    const result = translateSample(sample(), translationContract());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.envelopeId).toBe("env_sample_001");
      expect(result.envelope.sourceContentDigest).toBe(D_B);
      expect(result.envelope.connectorId).toBe("conn_alpha");
      const fields = Object.fromEntries(result.envelope.fields.map((f) => [f.key, f.value]));
      expect(fields.value).toBe(42);
      expect(fields.label).toBe("padded");
      expect(fields.flag).toBe(true);
      expect(result.envelope.provenance.source).toBe("connector_observation");
    }
  });

  it("surfaces unmapped raw fields as typed failures — never silently drops them", () => {
    const result = translateSample(sample({ fields: [...sample().fields, { key: "raw_unknown", value: 1 }] }), translationContract());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.code === "unmapped_field" && issue.field === "raw_unknown")).toBe(true);
    }
  });

  it("fails when a required raw field is absent or null", () => {
    const absent = translateSample(
      sample({ fields: sample().fields.filter((f) => f.key !== "raw_value") }),
      translationContract(),
    );
    expect(absent.ok).toBe(false);
    if (!absent.ok) {
      expect(absent.issues.some((issue) => issue.code === "missing_required" && issue.field === "value")).toBe(true);
    }

    const nulled = translateSample(
      sample({ fields: sample().fields.map((f) => (f.key === "raw_value" ? { key: f.key, value: null } : f)) }),
      translationContract(),
    );
    expect(nulled.ok).toBe(false);
    if (!nulled.ok) {
      expect(nulled.issues.some((issue) => issue.code === "missing_required")).toBe(true);
    }
  });

  it("passes null for optional mappings", () => {
    const result = translateSample(
      sample({ fields: sample().fields.map((f) => (f.key === "raw_label" ? { key: f.key, value: null } : f)) }),
      translationContract(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const label = result.envelope.fields.find((f) => f.key === "label");
      expect(label?.value).toBeNull();
    }
  });

  it("fails closed on incoercible transforms", () => {
    const notANumber = translateSample(
      sample({ fields: [{ key: "raw_value", value: "not-a-number" }] }),
      translationContract(),
    );
    expect(notANumber.ok).toBe(false);
    if (!notANumber.ok) expect(notANumber.issues[0].code).toBe("incoercible");

    const trimNumber = translateSample(
      sample({ fields: [{ key: "raw_label", value: 5 }] }),
      translationContract(),
    );
    expect(trimNumber.ok).toBe(false);
  });

  it("coerces numeric strings and canonical boolean strings", () => {
    const result = translateSample(
      sample({ fields: [{ key: "raw_value", value: " 7 " }, { key: "raw_flag", value: "false" }] }),
      translationContract(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const fields = Object.fromEntries(result.envelope.fields.map((f) => [f.key, f.value]));
      expect(fields.value).toBe(7);
      expect(fields.flag).toBe(false);
    }
  });

  it("rejects ambiguous translation contracts (duplicate raw keys)", () => {
    const ambiguous = translationContract({
      mappings: [
        { rawKey: "raw_value", canonicalKey: "value", transform: "number" as const, required: true },
        { rawKey: "raw_value", canonicalKey: "value_again", transform: "identity" as const, required: false },
      ],
    });
    expect(translationContractSchema.safeParse(ambiguous).success).toBe(false);
    const result = translateSample(sample(), ambiguous);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.code === "invalid_contract")).toBe(true);
    }
  });
});

describe("offline queues and synchronization (conflicts escalate, AGENTS §9)", () => {
  function queueItem(itemId: string, capturedAt: string) {
    return {
      itemId,
      capturedAt,
      sample: sample({ sampleId: itemId, capturedAt }),
    };
  }

  it("parses a bounded offline queue and rejects an inverted window", () => {
    expect(offlineQueueSchema.safeParse({
      queueId: "queue_001",
      connectorId: "conn_alpha",
      tenantId: "tenant_main",
      windowStart: TS0,
      windowEnd: TS1,
      items: [queueItem("item_001", TS0)],
    }).success).toBe(true);

    expect(offlineQueueSchema.safeParse({
      queueId: "queue_001",
      connectorId: "conn_alpha",
      tenantId: "tenant_main",
      windowStart: TS1,
      windowEnd: TS0,
      items: [],
    }).success).toBe(false);
  });

  it("enforces the offline queue bound", () => {
    const items = Array.from({ length: MAX_OFFLINE_QUEUE_ITEMS + 1 }, (_, i) =>
      queueItem(`item_${i}`, TS0),
    );
    expect(offlineQueueSchema.safeParse({
      queueId: "queue_001",
      connectorId: "conn_alpha",
      tenantId: "tenant_main",
      windowStart: TS0,
      windowEnd: TS1,
      items,
    }).success).toBe(false);
  });

  it("applies agreeing items", () => {
    const outcome = syncOutcome([{ itemId: "item_001", localDigest: D_A, canonicalDigest: D_A }]);
    expect(outcome.status).toBe("APPLIED");
    if (outcome.status === "APPLIED") expect(outcome.applied).toEqual(["item_001"]);
  });

  it("escalates divergence instead of silently overwriting canonical truth", () => {
    const outcome = syncOutcome([
      { itemId: "item_001", localDigest: D_A, canonicalDigest: D_A },
      { itemId: "item_002", localDigest: D_B, canonicalDigest: D_A },
    ]);
    expect(outcome.status).toBe("CONFLICT");
    if (outcome.status === "CONFLICT") {
      expect(outcome.conflicts).toEqual(["item_002"]);
      expect(outcome.applied).toEqual(["item_001"]);
      expect(outcome.detail).toContain("escalate");
      expect(outcome.detail).toContain("never silently overwritten");
    }
  });
});

describe("universal action gateway (a proposal is never an act)", () => {
  const active = connectorRecord();
  const suspended = connectorRecord({ lifecycleState: "SUSPENDED" });
  const sensor = connectorRecord({ kind: "sensor", actionKinds: ["observe"] });

  function proposal(kind: "observe" | "notify" | "write" | "execute" | "configure", overrides: Record<string, unknown> = {}) {
    return {
      proposalId: "prop_001",
      connectorId: "conn_alpha",
      kind,
      impactTier: "medium" as const,
      payloadDigest: D_B,
      proposedAt: TS0,
      proposedBy: "agent_connector_intelligence",
      rationale: "proposed by the connector intelligence capability",
      provenance: { ...PROVENANCE, source: "derived" as const },
      ...overrides,
    };
  }

  const ALLOW = { decidedBy: "engine_authorization", decidedAt: TS1, decision: "ALLOW" as const };

  it("parses proposals fail-closed", () => {
    expect(actionProposalSchema.safeParse(proposal("write")).success).toBe(true);
    expect(actionProposalSchema.safeParse(proposal("write", { impactTier: "EXTREME" })).success).toBe(false);
    expect(actionProposalSchema.safeParse(proposal("write", { rationale: "" })).success).toBe(false);
    const parsed = parseActionProposal(proposal("write"));
    expect(parsed.ok).toBe(true);
  });

  it("marks an admissible, authorization-backed proposal executable", () => {
    const result = actionGate(proposal("write"), active, ALLOW);
    expect(result.status).toBe("EXECUTABLE");
    if (result.status === "EXECUTABLE") {
      expect(result.note).toContain("authorization engine");
    }
  });

  it("blocks inactive connectors, undeclared kinds, and observation-only elevation", () => {
    const inactive = actionGate(proposal("write"), suspended, ALLOW);
    expect(inactive.status).toBe("BLOCKED");
    if (inactive.status === "BLOCKED") expect(inactive.reasons).toContain("connector_not_active");

    const undeclared = actionGate(proposal("configure"), active, ALLOW);
    expect(undeclared.status).toBe("BLOCKED");
    if (undeclared.status === "BLOCKED") expect(undeclared.reasons).toContain("action_kind_not_declared");

    const observing = actionGate(proposal("write"), sensor, ALLOW);
    expect(observing.status).toBe("BLOCKED");
    if (observing.status === "BLOCKED") {
      expect(observing.reasons).toContain("observation_only_connector");
    }
  });

  it("blocks without a recorded platform authorization decision — and on any non-ALLOW decision", () => {
    const missing = actionGate(proposal("write"), active, undefined);
    expect(missing.status).toBe("BLOCKED");
    if (missing.status === "BLOCKED") {
      expect(missing.reasons).toContain("authorization_evidence_missing");
      expect(missing.detail).toContain("authorization engine");
    }

    for (const decision of ["DENY", "REDACT", "ESCALATE", "REQUIRE_APPROVAL"] as const) {
      const result = actionGate(proposal("write"), active, { ...ALLOW, decision });
      expect(result.status).toBe("BLOCKED");
      if (result.status === "BLOCKED") expect(result.reasons).toContain("authorization_not_granted");
    }
  });

  it("records only ALLOW-backed executions in the audit surface", () => {
    const execution = {
      executionId: "exec_001",
      proposalId: "prop_001",
      connectorId: "conn_alpha",
      kind: "write" as const,
      executedAt: TS1,
      executedBy: "runner_action_gateway",
      payloadDigest: D_B,
      outcome: "SUCCEEDED" as const,
      authorization: ALLOW,
      provenance: PROVENANCE,
    };
    expect(actionExecutionSchema.safeParse(execution).success).toBe(true);
    expect(actionExecutionSchema.safeParse({ ...execution, authorization: { ...ALLOW, decision: "DENY" } }).success).toBe(false);
    expect(actionExecutionSchema.safeParse({ ...execution, authorization: undefined }).success).toBe(false);
  });
});

describe("health and self-healing (nothing heals silently)", () => {
  it("defaults missing health reports to UNKNOWN", () => {
    expect(effectiveHealthState(undefined)).toBe("UNKNOWN");
  });

  it("parses health reports fail-closed", () => {
    expect(healthReportSchema.safeParse({
      connectorId: "conn_alpha",
      reportedAt: TS1,
      healthState: "DEGRADED",
      provenance: PROVENANCE,
    }).success).toBe(true);
    expect(healthReportSchema.safeParse({ connectorId: "conn_alpha", reportedAt: TS1, healthState: "GREAT" }).success).toBe(false);
  });

  function cycle(stage: HealingCycle["stage"], overrides: Record<string, unknown> = {}): HealingCycle {
    return {
      cycleId: "cycle_001",
      connectorId: "conn_alpha",
      stage,
      openedAt: TS0,
      updatedAt: TS1,
      provenance: PROVENANCE,
      ...overrides,
    };
  }

  it("advances one stage at a time along the mandated path", () => {
    expect(advanceHealingCycle(cycle("detected"), "diagnosed").ok).toBe(false);
    expect(advanceHealingCycle(cycle("detected"), "repair_proposed").ok).toBe(false);
    expect(advanceHealingCycle(cycle("detected"), "escalated").ok).toBe(false);
  });

  it("requires findings and repair proposals at the stages that name them", () => {
    const noFinding = advanceHealingCycle(cycle("detected"), "diagnosed");
    expect(noFinding.ok).toBe(false);
    if (!noFinding.ok) expect(noFinding.reason).toContain("finding");

    const withFinding = advanceHealingCycle(cycle("detected", { findingRef: "finding_001" }), "diagnosed");
    expect(withFinding.ok).toBe(true);
    if (withFinding.ok) expect(withFinding.cycle.stage).toBe("diagnosed");

    const noRepair = advanceHealingCycle(cycle("repair_proposed"), "repair_validated");
    expect(noRepair.ok).toBe(false);
    if (!noRepair.ok) expect(noRepair.reason).toContain("repair proposal");

    const withRepair = advanceHealingCycle(cycle("repair_proposed", { repairProposalRef: "prop_001" }), "repair_validated");
    expect(withRepair.ok).toBe(true);
  });

  it("never restores without a validated repair proposal", () => {
    const noRepair = advanceHealingCycle(cycle("repair_validated"), "restored");
    expect(noRepair.ok).toBe(false);
    const withRepair = advanceHealingCycle(cycle("repair_validated", { repairProposalRef: "prop_001" }), "restored");
    expect(withRepair.ok).toBe(true);
    if (withRepair.ok) expect(withRepair.cycle.stage).toBe("restored");
  });

  it("escalates only with a stated detail, and escalation is terminal", () => {
    const silent = advanceHealingCycle(cycle("diagnosed"), "escalated");
    expect(silent.ok).toBe(false);
    if (!silent.ok) expect(silent.reason).toContain("silently");

    const stated = advanceHealingCycle(cycle("diagnosed", { detail: "repair not possible — governance required" }), "escalated");
    expect(stated.ok).toBe(true);
    if (stated.ok) {
      expect(stated.cycle.stage).toBe("escalated");
      expect(advanceHealingCycle(stated.cycle, "restored").ok).toBe(false);
    }
  });

  it("parses healing cycles against the stage vocabulary", () => {
    expect(healingCycleSchema.safeParse(cycle("detected")).success).toBe(true);
    expect(healingCycleSchema.safeParse(cycle("repaired" as unknown as HealingCycle["stage"])).success).toBe(false);
  });
});

describe("interface event fabric", () => {
  const event = {
    eventId: "event_001",
    connectorId: "conn_alpha",
    tenantId: "tenant_main",
    kind: "observation_received" as const,
    occurredAt: TS1,
    contentDigest: D_B,
    provenance: PROVENANCE,
  };

  it("parses valid interface events", () => {
    expect(interfaceEventSchema.safeParse(event).success).toBe(true);
    const parsed = parseInterfaceEvent(event);
    expect(parsed.ok).toBe(true);
  });

  it("rejects unknown kinds and missing content digests", () => {
    expect(interfaceEventSchema.safeParse({ ...event, kind: "mystery" }).success).toBe(false);
    expect(interfaceEventSchema.safeParse({ ...event, contentDigest: "abc" }).success).toBe(false);
    expect(parseInterfaceEvent(null).ok).toBe(false);
  });
});

describe("module hygiene", () => {
  const source = readFileSync(
    new URL("../../frontend/src/lib/universal-interface/contracts.ts", import.meta.url),
    "utf8",
  );

  it("uses strict typing — no any, no z.any", () => {
    expect(source).not.toMatch(/:\s*any\b/);
    expect(source).not.toMatch(/\bas any\b/);
    expect(source).not.toContain("z.any");
  });

  it("imports only zod and the platform identity type — no vendors, no sibling wave modules, no I/O", () => {
    const imports = [...source.matchAll(/^import[^"']*["']([^"']+)["']/gm)].map((match) => match[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) {
      expect(["zod", "../identity"]).toContain(specifier);
    }
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/\bprocess\.env\b/);
    expect(source).not.toMatch(/\bDate\.now\(/);
    expect(source).not.toMatch(/new Date\(/);
    expect(source).not.toMatch(/\bnode:fs\b/);
  });

  it("carries no secrets-shaped literals", () => {
    expect(source).not.toMatch(/\bsk-[A-Za-z0-9]{8,}/);
    expect(source).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
    expect(source).not.toMatch(/\b(password|api[_-]?key|secret[_-]?key)\s*[:=]/i);
  });

  it("is domain-neutral (J-037): no domain vocabulary in code or comments", () => {
    const forbidden = [
      "school",
      "student",
      "teacher",
      "classroom",
      "attendance",
      "curriculum",
      "farm",
      "hospital",
      "logistics",
    ];
    const lowered = source.toLowerCase();
    for (const term of forbidden) {
      expect(lowered).not.toContain(term);
    }
  });
});