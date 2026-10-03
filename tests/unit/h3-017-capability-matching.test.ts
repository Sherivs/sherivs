/**
 * CoreGrid — H3-017 capability-matching contract tests (mission B-017 / J-028).
 * Capability-overlap matching depth between declared capabilities and
 * required capabilities, fail-closed on unknown capabilities, plus
 * read-only composition with the delegation contract and the persistent
 * worker-definition substrate.
 * Pure offline: no network, no database, no secrets.
 */
import { describe, expect, it } from "vitest";
import {
  FAIL_CLOSED_UNKNOWN_CAPABILITY_DETAIL,
  capabilityRegistrySchema,
  delegationCapabilityBound,
  matchCapabilities,
  matchDelegationCapabilities,
  matchWorkerCapabilities,
  parseCapabilityRegistry,
  type CapabilityRequirement,
} from "../../frontend/src/lib/agent-runtime/capability-matching";
import { stampDelegationContract, type MissionDelegation } from "../../frontend/src/lib/mission/delegation-contract";
import { defineWorkerDefinition, type WorkerDefinition } from "../../frontend/src/lib/workforce/worker-definition";

/* ─────────────────────────────────────────────────────────────
 * Fixtures (synthetic, secret-free)
 * ────────────────────────────────────────────────────────────*/

function declaration(capabilityId: string, description = `synthetic declaration for ${capabilityId}`) {
  return { capabilityId, description };
}

function requirement(capabilityId: string, purpose = `synthetic demand for ${capabilityId}`): CapabilityRequirement {
  return { capabilityId, purpose };
}

const DECLARED = [
  declaration("read_only"),
  declaration("write_records"),
  declaration("emit_report"),
];

function registry() {
  const parsed = parseCapabilityRegistry({ capabilities: DECLARED });
  if (!parsed.ok) throw new Error(`fixture registry rejected: ${parsed.issues[0]?.message ?? "unknown"}`);
  return parsed.registry;
}

const DELEGATION_TENANT = "tenant-a";
const DELEGATION_GRANTED_AT = "2026-10-01T00:00:00.000Z";
const DELEGATION_EXPIRES_AT = "2026-10-31T00:00:00.000Z";

function delegationEnvelopeInput() {
  return {
    objectType: "mission_delegation",
    schemaVersion: "1.0",
    status: "active" as const,
    createdBy: "role:capability-registry-engineer",
    updatedBy: "role:capability-registry-engineer",
    provenance: {
      source: "h3-017 test fixture",
      recordedBy: "role:capability-registry-engineer",
      originTenantId: DELEGATION_TENANT,
      generatedByAi: true,
      verified: true,
    },
    policyContext: {},
    traceId: "trace-h3-017",
    correlationId: "corr-h3-017",
    causationId: null,
    parentEventId: null,
    declaredOrigin: "fixture-origin-h3-017",
  };
}

function delegation(grantedActions: readonly string[]): MissionDelegation {
  return stampDelegationContract({
    delegationId: "dlg-h3-017-1",
    schemaVersion: "1.0",
    tenantId: DELEGATION_TENANT,
    missionId: "mission-h3-017",
    delegatorRef: "actor:delegator",
    delegateRef: "actor:delegate",
    grantedActions,
    grantedRoles: [],
    delegatorActions: [...grantedActions],
    delegatorRoles: [],
    taskRefs: null,
    notBefore: null,
    expiresAt: DELEGATION_EXPIRES_AT,
    lifecycle: "active",
    revokedAt: null,
    revokedBy: null,
    revocationReason: null,
    idempotencyKey: "idem-h3-017-1",
    provenance: {
      grantedBy: "actor:delegator",
      grantedAt: DELEGATION_GRANTED_AT,
      authorityRef: "authority:h3-wave",
      sourceRef: null,
      generatedByAi: true,
      verified: true,
    },
    envelope: delegationEnvelopeInput(),
  });
}

function workerDefinition(
  capabilityIds: readonly string[],
  lifecycle: "provisioned" | "active" | "suspended" | "archived" | "deleted" = "active",
): WorkerDefinition {
  const result = defineWorkerDefinition({
    id: "worker-h3-017",
    tenantScope: DELEGATION_TENANT,
    identityRef: "identity:worker-h3-017",
    classification: "ai",
    capabilities: capabilityIds.map((capabilityId) => ({
      capabilityId,
      description: `synthetic declaration for ${capabilityId}`,
    })),
    authorityBounds: { maxRiskClass: "low", resourceScopes: [] },
    lifecycle,
  });
  if (!result.ok) throw new Error(`fixture definition rejected: ${result.errors.join("; ")}`);
  return result.definition;
}

/* ─────────────────────────────────────────────────────────────
 * Registry parsing (fail-closed, no partial results)
 * ────────────────────────────────────────────────────────────*/

describe("capability registry parsing", () => {
  it("accepts a valid registry with distinct declarations", () => {
    const parsed = parseCapabilityRegistry({ capabilities: DECLARED });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.registry.capabilities).toHaveLength(3);
      expect(parsed.registry.capabilities[0]?.capabilityId).toBe("read_only");
    }
  });

  it("accepts an empty registry — valid shape, zero authority", () => {
    const parsed = parseCapabilityRegistry({ capabilities: [] });
    expect(parsed.ok).toBe(true);
  });

  it("rejects non-object and malformed inputs with structured issues", () => {
    for (const bad of [null, undefined, 42, "registry", [], [declaration("read_only")]]) {
      const parsed = parseCapabilityRegistry(bad);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.reason).toBe("invalid_shape");
        expect(parsed.issues.length).toBeGreaterThan(0);
        expect(typeof parsed.issues[0]?.path).toBe("string");
        expect(typeof parsed.issues[0]?.message).toBe("string");
      }
    }
  });

  it("rejects unknown keys (strict shape) so undeclared semantics cannot leak in", () => {
    const parsed = parseCapabilityRegistry({
      capabilities: [{ ...declaration("read_only"), inherited: true }],
    });
    expect(parsed.ok).toBe(false);
  });

  it("rejects duplicate declarations — one capability, one declaration", () => {
    const parsed = parseCapabilityRegistry({
      capabilities: [declaration("read_only"), declaration("read_only", "a second, conflicting declaration")],
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe("cross_record_invariant");
      expect(parsed.issues[0]?.message).toContain("duplicate");
    }
  });

  it("rejects blank, whitespace-padded, control-character and oversized capability ids", () => {
    for (const badId of ["", "   ", " read_only", "read_only ", "a\tb", "x".repeat(161)]) {
      expect(parseCapabilityRegistry({ capabilities: [declaration(badId)] }).ok).toBe(false);
    }
  });

  it("rejects blank descriptions", () => {
    expect(parseCapabilityRegistry({ capabilities: [{ capabilityId: "read_only", description: "   " }] }).ok).toBe(false);
  });

  it("rejects registries above the bounded declaration count", () => {
    const many = Array.from({ length: 1_025 }, (_, i) => declaration(`capability_${i}`));
    const parsed = parseCapabilityRegistry({ capabilities: many });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe("invalid_shape");
    }
  });

  it("exposes the registry schema for downstream consumers", () => {
    expect(typeof capabilityRegistrySchema.safeParse).toBe("function");
    expect(capabilityRegistrySchema.safeParse({ capabilities: [] }).success).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Capability-overlap matching (the depth)
 * ────────────────────────────────────────────────────────────*/

describe("matchCapabilities — full overlap", () => {
  it("succeeds only when every required capability is declared", () => {
    const result = matchCapabilities(registry(), [
      requirement("read_only"),
      requirement("write_records"),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.depth).toBe("full");
      expect(result.matched).toEqual(["read_only", "write_records"]);
      expect(result.requiredCount).toBe(2);
    }
  });

  it("keeps requirement order in the matched list", () => {
    const result = matchCapabilities(registry(), [
      requirement("emit_report"),
      requirement("read_only"),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.matched).toEqual(["emit_report", "read_only"]);
  });
});

describe("matchCapabilities — fail closed on unknown capabilities", () => {
  it("denies when any required capability is undeclared, naming the unknown ids", () => {
    const result = matchCapabilities(registry(), [
      requirement("read_only"),
      requirement("delete_everything"),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unknown_capability");
      expect(result.unknown).toEqual(["delete_everything"]);
      expect(result.matched).toEqual(["read_only"]);
      expect(result.detail).toBe(FAIL_CLOSED_UNKNOWN_CAPABILITY_DETAIL);
      expect(result.detail).toContain("fail-closed");
    }
  });

  it("reports partial depth when some requirements overlap but never authorizes", () => {
    const result = matchCapabilities(registry(), [
      requirement("read_only"),
      requirement("not_declared_a"),
      requirement("not_declared_b"),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.depth).toBe("partial");
      expect(result.unknown).toEqual(["not_declared_a", "not_declared_b"]);
    }
  });

  it("reports depth none when nothing overlaps", () => {
    const result = matchCapabilities(registry(), [requirement("wholly_unknown")]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.depth).toBe("none");
      expect(result.matched).toEqual([]);
      expect(result.unknown).toEqual(["wholly_unknown"]);
    }
  });

  it("performs no case normalization — different case is an unknown capability", () => {
    const result = matchCapabilities(registry(), [requirement("Read_Only")]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unknown_capability");
      expect(result.unknown).toEqual(["Read_Only"]);
    }
  });

  it("performs no prefix or substring matching", () => {
    for (const nearMiss of ["read", "read_onl", "read_only_extra", "e_read_only"]) {
      const result = matchCapabilities(registry(), [requirement(nearMiss)]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.unknown).toEqual([nearMiss]);
    }
  });

  it("denies every requirement against an empty registry — zero declared authority", () => {
    const parsed = parseCapabilityRegistry({ capabilities: [] });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const result = matchCapabilities(parsed.registry, [requirement("read_only")]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("unknown_capability");
        expect(result.depth).toBe("none");
      }
    }
  });
});

describe("matchCapabilities — malformed requirement sets", () => {
  it("denies an empty requirement set rather than trivially passing", () => {
    const result = matchCapabilities(registry(), []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("empty_requirements");
      expect(result.depth).toBe("none");
      expect(result.detail).toContain("authorizes nothing");
    }
  });

  it("denies duplicate requirements instead of silently deduplicating", () => {
    const result = matchCapabilities(registry(), [
      requirement("read_only"),
      requirement("read_only", "the same capability demanded twice"),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("duplicate_requirements");
      expect(result.detail).toContain("read_only");
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * Delegation-contract composition (read-only)
 * ────────────────────────────────────────────────────────────*/

describe("delegation capability bound composition", () => {
  it("extracts the capability bound view from a real stamped delegation contract", () => {
    const record = delegation(["read_only", "emit_report"]);
    const bound = delegationCapabilityBound(record);
    expect(bound.delegationId).toBe("dlg-h3-017-1");
    expect(bound.grantedActions).toEqual(["read_only", "emit_report"]);
  });

  it("matches a delegation whose granted capabilities are fully declared", () => {
    const result = matchDelegationCapabilities(
      delegationCapabilityBound(delegation(["read_only", "write_records"])),
      registry(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.depth).toBe("full");
      expect(result.requiredCount).toBe(2);
    }
  });

  it("fails closed when the delegation grants an undeclared capability", () => {
    const result = matchDelegationCapabilities(
      delegationCapabilityBound(delegation(["read_only", "admin_override"])),
      registry(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unknown_capability");
      expect(result.unknown).toEqual(["admin_override"]);
      expect(result.depth).toBe("partial");
    }
  });

  it("fails closed on a delegation whose granted capabilities are entirely undeclared", () => {
    const result = matchDelegationCapabilities(
      delegationCapabilityBound(delegation(["admin_override", "secret_exfil"])),
      registry(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.depth).toBe("none");
      expect(result.unknown).toEqual(["admin_override", "secret_exfil"]);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * Worker-definition composition (read-only)
 * ────────────────────────────────────────────────────────────*/

describe("worker definition composition", () => {
  it("matches required capabilities against a usable definition's declared set", () => {
    const definition = workerDefinition(["read_only", "emit_report"]);
    const result = matchWorkerCapabilities(definition, [
      requirement("read_only"),
      requirement("emit_report"),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.depth).toBe("full");
  });

  it("fails closed on an unknown capability even against a usable definition", () => {
    const result = matchWorkerCapabilities(workerDefinition(["read_only"]), [requirement("write_records")]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unknown_capability");
      expect(result.unknown).toEqual(["write_records"]);
    }
  });

  it("denies a suspended definition before any overlap is computed", () => {
    const definition = workerDefinition(["read_only"], "suspended");
    const result = matchWorkerCapabilities(definition, [requirement("read_only")]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("definition_lifecycle_unusable");
      expect(result.depth).toBe("none");
      expect(result.matched).toEqual([]);
      expect(result.detail).toContain("fail closed");
    }
  });

  it("denies archived and deleted definitions the same way", () => {
    for (const lifecycle of ["archived", "deleted"] as const) {
      const result = matchWorkerCapabilities(workerDefinition(["read_only"], lifecycle), [
        requirement("read_only"),
      ]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("definition_lifecycle_unusable");
    }
  });

  it("treats a definition with zero declared capabilities as matching nothing", () => {
    const definition = workerDefinition([]);
    const result = matchWorkerCapabilities(definition, [requirement("read_only")]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unknown_capability");
      expect(result.unknown).toEqual(["read_only"]);
    }
  });

  it("accepts provisioned definitions as usable (identity-aligned predicate)", () => {
    const result = matchWorkerCapabilities(workerDefinition(["read_only"], "provisioned"), [
      requirement("read_only"),
    ]);
    expect(result.ok).toBe(true);
  });
});
