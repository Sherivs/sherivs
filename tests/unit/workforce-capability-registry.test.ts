/**
 * MISSION-R-41 / J-028 (V1CAP-049) — worker capability registry &
 * delegation-contract matching.
 *
 * Proves, at unit level, that:
 *  1. registry integrity is fail closed — a worker declaring an
 *     unregistered capability is an integrity failure, never silently
 *     accepted;
 *  2. capability-over-agent matching is exact — risk ceilings, exact
 *     capability satisfaction, and multiple interchangeable candidates
 *     (model neutrality: names never influence the match, E-033/E-046);
 *  3. delegation compatibility produces explicit verdicts with per-axis
 *     reasons (never a silent pass);
 *  4. revocation propagates — a worker lifecycle change (suspended/
 *     archived/deleted) or a registry capability removal disqualifies the
 *     very next evaluation (results are computed at evaluation time,
 *     never cached);
 *  5. cross-tenant workers never match (multi-tenancy law);
 *  6. no escalation — a match can never grant capability the worker did
 *     not declare, and a delegation can never be made compatible by the
 *     matcher widening the worker.
 */

import { describe, expect, it } from "vitest";
import {
  createCapabilityRegistry,
  checkWorkerCapabilityIntegrity,
  evaluateDelegationCompatibility,
  matchWorkersForCapabilityRequirement,
  registerCapability,
  type CapabilityRegistry,
} from "@/lib/workforce/capability-registry";
import {
  defineWorkerDefinition,
  type WorkerDefinition,
} from "@/lib/workforce/worker-definition";
import type { AgentRiskClassification } from "@/lib/agent-core";
import type { UniversalRole } from "@/lib/universal-roles";

const TENANT_A = "tenant-alpha";
const TENANT_B = "tenant-beta";

function capability(id: string, description: string) {
  return { capabilityId: id, description };
}

function worker(
  id: string,
  capabilityIds: readonly string[],
  overrides?: Partial<WorkerDefinition>,
): WorkerDefinition {
  const validated = defineWorkerDefinition({
    id,
    tenantScope: TENANT_A,
    identityRef: `identity:${id}`,
    classification: "ai",
    capabilities: capabilityIds.map((capabilityId) =>
      capability(capabilityId, `declared ${capabilityId}`),
    ),
    authorityBounds: { maxRiskClass: "critical", resourceScopes: ["scope:all"] },
    lifecycle: "active",
    ...overrides,
  });
  if (!validated.ok) throw new Error(`fixture worker rejected: ${validated.errors.join("; ")}`);
  return validated.definition;
}

function registryWith(
  entries: readonly { id: string; riskClass: AgentRiskClassification }[],
): CapabilityRegistry {
  const result = createCapabilityRegistry(
    entries.map((entry) => ({
      capabilityId: entry.id,
      contract: `contract for ${entry.id}`,
      riskClass: entry.riskClass,
      evidenceRequirements: [`evidence:${entry.id}`],
    })),
  );
  if (!result.ok) throw new Error(`fixture registry rejected: ${result.errors.join("; ")}`);
  return result.registry;
}

const REGISTRY = registryWith([
  { id: "cap:dispatch", riskClass: "low" },
  { id: "cap:roster-read", riskClass: "medium" },
  { id: "cap:payment-capture", riskClass: "high" },
  { id: "cap:tenant-admin", riskClass: "critical" },
]);

describe("capability registry integrity (E-035)", () => {
  it("registers capabilities with stable id, contract, risk class, and evidence requirements", () => {
    expect(REGISTRY.get("cap:dispatch")).toEqual({
      capabilityId: "cap:dispatch",
      contract: "contract for cap:dispatch",
      riskClass: "low",
      evidenceRequirements: ["evidence:cap:dispatch"],
    });
  });

  it("fails closed on duplicate registration", () => {
    const result = registerCapability(REGISTRY, {
      capabilityId: "cap:dispatch",
      contract: "duplicate attempt",
      riskClass: "low",
      evidenceRequirements: ["evidence:x"],
    });
    expect(result.ok).toBe(false);
  });

  it("fails closed on unknown risk class or missing evidence requirements", () => {
    const unknownRisk = registerCapability(REGISTRY, {
      capabilityId: "cap:new",
      contract: "c",
      riskClass: "existential" as AgentRiskClassification,
      evidenceRequirements: ["evidence:x"],
    });
    expect(unknownRisk.ok).toBe(false);
    const noEvidence = registerCapability(REGISTRY, {
      capabilityId: "cap:new",
      contract: "c",
      riskClass: "low",
      evidenceRequirements: [],
    });
    expect(noEvidence.ok).toBe(false);
  });

  it("flags a worker claiming an unregistered capability as an integrity failure", () => {
    const claimant = worker("worker:unregistered", ["cap:ghost"]);
    const check = checkWorkerCapabilityIntegrity(REGISTRY, claimant);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.unregisteredCapabilityIds).toEqual(["cap:ghost"]);
    }
  });

  it("never matches a worker whose declarations include an unregistered capability", () => {
    const claimant = worker("worker:mixed", ["cap:dispatch", "cap:ghost"]);
    const result = matchWorkersForCapabilityRequirement(REGISTRY, [claimant], {
      tenantId: TENANT_A,
      requiredCapabilityIds: ["cap:dispatch"],
      maxRiskClass: "medium",
    });
    expect(result.qualified).toEqual([]);
    expect(result.disqualified).toEqual([
      {
        workerId: "worker:mixed",
        axis: "registry_integrity",
        reason: expect.stringContaining("cap:ghost"),
      },
    ]);
  });
});

describe("capability-over-agent matching", () => {
  it("matches only workers that declare every required capability", () => {
    const full = worker("worker:full", ["cap:dispatch", "cap:roster-read"]);
    const partial = worker("worker:partial", ["cap:dispatch"]);
    const result = matchWorkersForCapabilityRequirement(REGISTRY, [full, partial], {
      tenantId: TENANT_A,
      requiredCapabilityIds: ["cap:dispatch", "cap:roster-read"],
      maxRiskClass: "medium",
    });
    expect(result.qualified.map((match) => match.workerId)).toEqual(["worker:full"]);
    expect(result.disqualified).toEqual([
      {
        workerId: "worker:partial",
        axis: "capability",
        reason: expect.stringContaining("cap:roster-read"),
      },
    ]);
  });

  it("enforces the requirement risk ceiling against registered capability risk", () => {
    const claimant = worker("worker:dispatcher", ["cap:payment-capture"]);
    const result = matchWorkersForCapabilityRequirement(REGISTRY, [claimant], {
      tenantId: TENANT_A,
      requiredCapabilityIds: ["cap:payment-capture"],
      maxRiskClass: "medium",
    });
    expect(result.qualified).toEqual([]);
    expect(result.disqualified[0]?.axis).toBe("risk");
    expect(result.disqualified[0]?.reason).toContain("high");
  });

  it("enforces the worker's own authority ceiling independently of the requirement ceiling", () => {
    const limited = worker("worker:limited", ["cap:tenant-admin"], {
      authorityBounds: { maxRiskClass: "low", resourceScopes: ["scope:all"] },
    });
    const result = matchWorkersForCapabilityRequirement(REGISTRY, [limited], {
      tenantId: TENANT_A,
      requiredCapabilityIds: ["cap:tenant-admin"],
      maxRiskClass: "critical",
    });
    expect(result.qualified).toEqual([]);
    expect(result.disqualified[0]?.axis).toBe("risk");
    expect(result.disqualified[0]?.reason).toContain("worker authority ceiling");
  });

  it("returns multiple qualified candidates and is name-neutral (model neutrality)", () => {
    const alpha = worker("worker:aaa", ["cap:dispatch"]);
    const zeta = worker("worker:zzz", ["cap:dispatch"]);
    const requirement = {
      tenantId: TENANT_A,
      requiredCapabilityIds: ["cap:dispatch"],
      maxRiskClass: "low" as AgentRiskClassification,
    };
    const forward = matchWorkersForCapabilityRequirement(REGISTRY, [alpha, zeta], requirement);
    const reverse = matchWorkersForCapabilityRequirement(REGISTRY, [zeta, alpha], requirement);
    expect(forward.qualified.map((match) => match.workerId).sort()).toEqual([
      "worker:aaa",
      "worker:zzz",
    ]);
    expect(new Set(forward.qualified.map((match) => match.workerId))).toEqual(
      new Set(reverse.qualified.map((match) => match.workerId)),
    );
    for (const match of forward.qualified) {
      expect(match.effectiveRiskClass).toBe("low");
    }
  });

  it("fails closed when the requirement itself references an unregistered capability", () => {
    expect(() =>
      matchWorkersForCapabilityRequirement(REGISTRY, [], {
        tenantId: TENANT_A,
        requiredCapabilityIds: ["cap:ghost"],
        maxRiskClass: "low",
      }),
    ).toThrow(/unregistered/);
  });
});

describe("delegation-contract compatibility", () => {
  const delegation = {
    tenantId: TENANT_A,
    authorizedActions: ["cap:dispatch", "cap:roster-read"],
    authorizedRoles: ["OPERATOR", "REVIEWER"] as readonly UniversalRole[],
    maxRiskClass: "medium" as AgentRiskClassification,
  };

  it("is compatible when every axis is satisfied", () => {
    const candidate = worker("worker:compat", ["cap:dispatch", "cap:roster-read"]);
    const verdict = evaluateDelegationCompatibility(REGISTRY, candidate, delegation, [
      "OPERATOR" as UniversalRole,
    ]);
    expect(verdict).toEqual({
      compatible: true,
      exercisedCapabilities: ["cap:dispatch", "cap:roster-read"],
      effectiveRiskClass: "medium",
    });
  });

  it("is incompatible with a per-axis reason when an authorized action is undeclared", () => {
    const candidate = worker("worker:narrow", ["cap:dispatch"]);
    const verdict = evaluateDelegationCompatibility(REGISTRY, candidate, delegation, []);
    expect(verdict.compatible).toBe(false);
    if (!verdict.compatible) {
      expect(verdict.reasons).toEqual([
        {
          axis: "capability",
          reason: expect.stringContaining("cap:roster-read"),
        },
      ]);
    }
  });

  it("names the risk axis when the delegation ceiling is below the capability risk", () => {
    const candidate = worker("worker:risky", ["cap:payment-capture"]);
    const verdict = evaluateDelegationCompatibility(
      REGISTRY,
      candidate,
      { ...delegation, authorizedActions: ["cap:payment-capture"] },
      [],
    );
    expect(verdict.compatible).toBe(false);
    if (!verdict.compatible) {
      expect(verdict.reasons.some((reason) => reason.axis === "risk")).toBe(true);
    }
  });

  it("names the role axis when a claimed role is not authorized by the delegation", () => {
    const candidate = worker("worker:roles", ["cap:dispatch"]);
    const verdict = evaluateDelegationCompatibility(
      REGISTRY,
      candidate,
      { ...delegation, authorizedActions: ["cap:dispatch"] },
      ["OPERATOR" as UniversalRole, "AUDITOR" as UniversalRole],
    );
    expect(verdict.compatible).toBe(false);
    if (!verdict.compatible) {
      expect(verdict.reasons).toContainEqual({
        axis: "role",
        reason: expect.stringContaining("AUDITOR"),
      });
    }
  });

  it("never returns a silent pass on a malformed requirement", () => {
    const candidate = worker("worker:any", ["cap:dispatch"]);
    const emptyActions = evaluateDelegationCompatibility(
      REGISTRY,
      candidate,
      { ...delegation, authorizedActions: [] },
      [],
    );
    expect(emptyActions.compatible).toBe(false);
    const unknownRisk = evaluateDelegationCompatibility(
      REGISTRY,
      candidate,
      { ...delegation, maxRiskClass: "unbounded" as AgentRiskClassification },
      [],
    );
    expect(unknownRisk.compatible).toBe(false);
  });
});

describe("revocation and disqualification propagation", () => {
  const requirement = {
    tenantId: TENANT_A,
    requiredCapabilityIds: ["cap:dispatch"],
    maxRiskClass: "low" as AgentRiskClassification,
  };
  const delegation = {
    tenantId: TENANT_A,
    authorizedActions: ["cap:dispatch"],
    authorizedRoles: ["OPERATOR"] as readonly UniversalRole[],
    maxRiskClass: "low" as AgentRiskClassification,
  };

  it("disqualifies a suspended worker on the next evaluation (never cached)", () => {
    const candidate = worker("worker:revoke-me", ["cap:dispatch"]);
    const before = matchWorkersForCapabilityRequirement(REGISTRY, [candidate], requirement);
    expect(before.qualified).toHaveLength(1);
    const suspended: WorkerDefinition = { ...candidate, lifecycle: "suspended" };
    const after = matchWorkersForCapabilityRequirement(REGISTRY, [suspended], requirement);
    expect(after.qualified).toEqual([]);
    expect(after.disqualified[0]?.axis).toBe("lifecycle");
    const verdict = evaluateDelegationCompatibility(REGISTRY, suspended, delegation, []);
    expect(verdict.compatible).toBe(false);
  });

  it("disqualifies archived and deleted (retired) workers", () => {
    for (const lifecycle of ["archived", "deleted"] as const) {
      const candidate = worker(`worker:${lifecycle}`, ["cap:dispatch"], { lifecycle });
      const result = matchWorkersForCapabilityRequirement(REGISTRY, [candidate], requirement);
      expect(result.qualified).toEqual([]);
      expect(result.disqualified[0]?.axis).toBe("lifecycle");
    }
  });

  it("disqualifies every worker declaring a capability removed from the registry", () => {
    const localAtFirst = registryWith([{ id: "cap:ephemeral", riskClass: "low" }]);
    const claimant = worker("worker:ephemeral", ["cap:ephemeral"]);
    const before = matchWorkersForCapabilityRequirement(localAtFirst, [claimant], {
      tenantId: TENANT_A,
      requiredCapabilityIds: ["cap:ephemeral"],
      maxRiskClass: "low",
    });
    expect(before.qualified).toHaveLength(1);

    // The capability is removed: a requirement on it now fails closed.
    const localAfterRemoval = registryWith([{ id: "cap:other", riskClass: "low" }]);
    expect(() =>
      matchWorkersForCapabilityRequirement(localAfterRemoval, [claimant], {
        tenantId: TENANT_A,
        requiredCapabilityIds: ["cap:ephemeral"],
        maxRiskClass: "low",
      }),
    ).toThrow(/unregistered/);

    // And the worker declaring the removed capability is disqualified from
    // any OTHER match too — the unregistered declaration is an integrity
    // failure, never silently accepted.
    const other = matchWorkersForCapabilityRequirement(localAfterRemoval, [claimant], {
      tenantId: TENANT_A,
      requiredCapabilityIds: ["cap:other"],
      maxRiskClass: "low",
    });
    expect(other.qualified).toEqual([]);
    expect(other.disqualified[0]?.axis).toBe("registry_integrity");
    expect(other.disqualified[0]?.reason).toContain("cap:ephemeral");
  });
});

describe("cross-tenant isolation and no-escalation", () => {
  it("never matches a worker scoped to another tenant", () => {
    const foreign = worker("worker:foreign", ["cap:dispatch"], { tenantScope: TENANT_B });
    const result = matchWorkersForCapabilityRequirement(REGISTRY, [foreign], {
      tenantId: TENANT_A,
      requiredCapabilityIds: ["cap:dispatch"],
      maxRiskClass: "low",
    });
    expect(result.qualified).toEqual([]);
    expect(result.disqualified[0]?.axis).toBe("tenant");
    const verdict = evaluateDelegationCompatibility(
      REGISTRY,
      foreign,
      {
        tenantId: TENANT_A,
        authorizedActions: ["cap:dispatch"],
        authorizedRoles: ["OPERATOR"] as readonly UniversalRole[],
        maxRiskClass: "low",
      },
      [],
    );
    expect(verdict.compatible).toBe(false);
  });

  it("never grants capability the worker did not declare (match output is the declared subset)", () => {
    const narrow = worker("worker:narrow", ["cap:dispatch"]);
    const result = matchWorkersForCapabilityRequirement(REGISTRY, [narrow], {
      tenantId: TENANT_A,
      requiredCapabilityIds: ["cap:dispatch", "cap:roster-read"],
      maxRiskClass: "medium",
    });
    expect(result.qualified).toEqual([]);
    const declared = new Set(narrow.capabilities.map((declaration) => declaration.capabilityId));
    for (const match of result.qualified) {
      for (const capabilityId of match.matchedCapabilities) {
        expect(declared.has(capabilityId)).toBe(true);
      }
    }
  });

  it("a compatible delegation exercises exactly the declared ∩ registered ∩ authorized set", () => {
    const candidate = worker("worker:exact", ["cap:dispatch", "cap:payment-capture"]);
    const verdict = evaluateDelegationCompatibility(
      REGISTRY,
      candidate,
      {
        tenantId: TENANT_A,
        authorizedActions: ["cap:dispatch", "cap:payment-capture", "cap:tenant-admin"],
        authorizedRoles: ["OPERATOR"] as readonly UniversalRole[],
        maxRiskClass: "high",
      },
      [],
    );
    expect(verdict.compatible).toBe(false);
    if (!verdict.compatible) {
      expect(verdict.reasons.some((reason) => reason.reason.includes("cap:tenant-admin"))).toBe(
        true,
      );
    }
    const bounded = evaluateDelegationCompatibility(
      REGISTRY,
      candidate,
      {
        tenantId: TENANT_A,
        authorizedActions: ["cap:dispatch", "cap:payment-capture"],
        authorizedRoles: ["OPERATOR"] as readonly UniversalRole[],
        maxRiskClass: "high",
      },
      [],
    );
    if (bounded.compatible) {
      const declared = new Set(candidate.capabilities.map((d) => d.capabilityId));
      expect(bounded.exercisedCapabilities.every((id) => declared.has(id))).toBe(true);
      expect(bounded.exercisedCapabilities).toEqual(["cap:dispatch", "cap:payment-capture"]);
    } else {
      throw new Error("expected compatible verdict for the bounded delegation");
    }
  });
});
