/**
 * CoreGrid — kernel phase-contract + engineering-section dictionary tests.
 *
 * Verifies the Foundation (Phase 01) contract layer that every later phase and
 * every runtime (Scholar first, neutral domains through reserved seats) is
 * validated against:
 *  - the twenty-section dictionary is complete, unique and matches PROGRESS §10;
 *  - the Phase 01 contract declares all twenty sections with substance;
 *  - capability ownership, dependency/consumer law and the connected-DAG graph
 *    reject orphans, dangling references and cycles;
 *  - the ASI law (tiers, mandatory invariants, canonical truth) cannot be
 *    weakened by a contract author;
 *  - runtime neutrality holds: Scholar is the first runtime and non-Scholar
 *    domain seats are reserved with valid manifests.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ASI_INVARIANTS,
  ENGINEERING_SECTION_COUNT,
  ENGINEERING_SECTIONS,
  ENGINEERING_SECTION_KEYS,
  MANDATORY_ASI_INVARIANTS,
  engineeringSectionCoverage,
  missingEngineeringSections,
} from "@/lib/kernel/engineering-sections";
import {
  PHASE_CONTRACT_SCHEMA_VERSION,
  buildPhaseContractGraph,
  validatePhaseContract,
  validatePhaseContractGraph,
  type PhaseEngineeringContract,
} from "@/lib/kernel/phase-contract";
import { PHASE_CATALOG } from "@/lib/phase-catalog";
import {
  PHASE_CONTRACTS,
  phaseContractById,
  validatePhaseContracts,
} from "@/lib/kernel/phase-contracts";
import { KERNEL_CAPABILITIES } from "@/lib/kernel/kernel-capability-registry";

const KNOWN_PHASE_IDS = Array.from({ length: 51 }, (_, i) => String(i + 1).padStart(2, "0"));
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const KNOWN_CAPABILITY_IDS = KERNEL_CAPABILITIES.map((capability) => capability.id);
const CAPABILITY_OWNERS: Readonly<Record<string, string>> = Object.fromEntries(
  KERNEL_CAPABILITIES.map((capability) => [capability.id, capability.ownerPhase]),
);

const FOUNDATION = PHASE_CONTRACTS[0];

function validationOptions() {
  return {
    knownPhaseIds: KNOWN_PHASE_IDS,
    knownCapabilityIds: KNOWN_CAPABILITY_IDS,
    capabilityOwners: CAPABILITY_OWNERS,
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function expectFailure(contract: PhaseEngineeringContract, fragment: string): void {
  const result = validatePhaseContract(contract, validationOptions());
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.issues.join(" | ")).toContain(fragment);
}

describe("kernel engineering-section dictionary", () => {
  it("declares exactly twenty unique canonical sections", () => {
    expect(ENGINEERING_SECTION_COUNT).toBe(20);
    expect(ENGINEERING_SECTION_KEYS.length).toBe(20);
    expect(new Set(ENGINEERING_SECTION_KEYS).size).toBe(20);
    expect(ENGINEERING_SECTIONS.length).toBe(20);
  });

  it("matches the canonical dictionary order of PROGRESS §10", () => {
    expect(ENGINEERING_SECTIONS.map((section) => section.term)).toEqual([
      "Identity",
      "Purpose",
      "Ownership",
      "Non-Ownership / Boundaries",
      "Principles",
      "Architecture",
      "Contracts / API",
      "Data Model",
      "Events",
      "Workflows",
      "Security",
      "Tenancy",
      "AI Safety",
      "Observability",
      "Testing",
      "Integration",
      "Dependencies",
      "Risks",
      "Completion Criteria",
      "Extensions",
    ]);
  });

  it("reports coverage and missing sections deterministically", () => {
    const full = engineeringSectionCoverage(ENGINEERING_SECTION_KEYS);
    expect(full.complete).toBe(true);
    expect(full.declared).toBe(20);
    expect(full.ratio).toBe(1);

    const partial = engineeringSectionCoverage(["identity", "purpose"]);
    expect(partial.complete).toBe(false);
    expect(partial.declared).toBe(2);
    expect(partial.missing).toHaveLength(18);
    expect(missingEngineeringSections(["identity"])).toContain("aiSafety");
  });
});

describe("Phase 01 foundation contract", () => {
  it("is registered with the kernel schema version and Scholar-first binding", () => {
    expect(FOUNDATION.id).toBe("01");
    expect(FOUNDATION.schemaVersion).toBe(PHASE_CONTRACT_SCHEMA_VERSION);
    expect(FOUNDATION.runtimeBindings.firstRuntime).toBe("runtime:scholar");
    expect(FOUNDATION.runtimeBindings.neutralSeats.length).toBeGreaterThanOrEqual(2);
    expect(phaseContractById("01")).toBe(FOUNDATION);
  });

  it("declares all twenty engineering sections with substance", () => {
    const coverage = engineeringSectionCoverage(Object.keys(FOUNDATION.sections));
    expect(coverage.complete).toBe(true);
    expect(coverage.missing).toEqual([]);
    for (const key of ENGINEERING_SECTION_KEYS) {
      const section = FOUNDATION.sections[key];
      expect(section.summary.length, `${key} summary`).toBeGreaterThanOrEqual(20);
      expect(section.artifacts.length, `${key} artifacts`).toBeGreaterThan(0);
    }
  });

  it("passes per-contract validation against the kernel capability registry", () => {
    const result = validatePhaseContract(FOUNDATION, validationOptions());
    expect(result.ok, result.ok ? "" : result.issues.join(" | ")).toBe(true);
  });

  it("owns exactly the foundation capability and consumes nothing", () => {
    expect(FOUNDATION.capabilities.owns).toEqual(["foundation-standards-config-secrets-ci"]);
    expect(FOUNDATION.capabilities.consumes).toEqual([]);
    expect(CAPABILITY_OWNERS["foundation-standards-config-secrets-ci"]).toBe("01");
  });

  it("is the dependency root serving every phase", () => {
    expect(FOUNDATION.dependsOn).toEqual([]);
    expect(FOUNDATION.consumers).toContain("all");
  });

  it("rejects a section that loses its artifacts or shrinks below substance", () => {
    const withoutArtifacts = clone(FOUNDATION);
    withoutArtifacts.sections.event.artifacts = [];
    expectFailure(withoutArtifacts, 'section "event" must reference at least one artifact');

    const thinSummary = clone(FOUNDATION);
    thinSummary.sections.workflow.summary = "too short";
    expectFailure(thinSummary, 'section "workflow" summary must be at least');
  });

  it("rejects an undeclared engineering section", () => {
    const incomplete = clone(FOUNDATION);
    Reflect.deleteProperty(incomplete.sections, "aiSafety");
    expectFailure(incomplete, 'engineering section "aiSafety" is not declared');
  });

  it("rejects a capability the phase does not own in the kernel registry", () => {
    const thief = clone(FOUNDATION);
    thief.capabilities.owns = ["universal-identity"];
    expectFailure(thief, "is owned by phase 02, not 01");

    const inventor = clone(FOUNDATION);
    inventor.capabilities.owns = ["foundation-standards-config-secrets-ci", "invented-capability"];
    expectFailure(inventor, 'owns unknown kernel capability "invented-capability"');
  });
});

describe("ASI law in phase contracts", () => {
  it("keeps the foundation at assistive autonomy with proposal-only self-improvement", () => {
    expect(FOUNDATION.asi.tier).toBe("assistive");
    expect(FOUNDATION.asi.autonomy.level).toBe(1);
    expect(FOUNDATION.asi.selfImprovement).toBe("proposal-only");
    expect(FOUNDATION.asi.autonomy.requiresApprovalFor.length).toBeGreaterThan(0);
    expect(FOUNDATION.asi.canonicalTruth.owners.length).toBeGreaterThan(0);
    expect(FOUNDATION.asi.canonicalTruth.derived.length).toBeGreaterThan(0);
  });

  it("cannot omit a mandatory ASI invariant", () => {
    expect(MANDATORY_ASI_INVARIANTS.length).toBeGreaterThan(0);
    for (const invariant of MANDATORY_ASI_INVARIANTS) {
      expect(ASI_INVARIANTS).toContain(invariant);
    }
    for (const dropped of MANDATORY_ASI_INVARIANTS) {
      const weakened = clone(FOUNDATION);
      weakened.asi.invariants = FOUNDATION.asi.invariants.filter((item) => item !== dropped);
      expectFailure(weakened, `asi invariant "${dropped}" is mandatory`);
    }
  });

  it("rejects an unregistered invariant or tier", () => {
    const fakeInvariant = clone(FOUNDATION);
    (fakeInvariant.asi as unknown as { invariants: string[] }).invariants = [
      ...FOUNDATION.asi.invariants,
      "self-granted-permissions",
    ];
    expectFailure(fakeInvariant, 'asi invariant "self-granted-permissions" is not registered');

    const fakeTier = clone(FOUNDATION);
    (fakeTier.asi as { tier: string }).tier = "unbounded";
    expectFailure(fakeTier, 'asi.tier "unbounded" is not registered');
  });

  it("caps autonomy at the tier maximum and gates civilization-scale autonomy", () => {
    const overreach = clone(FOUNDATION);
    overreach.asi.autonomy.level = 3;
    expectFailure(overreach, 'exceeds tier "assistive" maximum 1');

    const unbounded = clone(FOUNDATION);
    unbounded.asi.tier = "civilization-scale";
    unbounded.asi.autonomy.level = 4;
    unbounded.asi.selfImprovement = "proposal-only";
    expectFailure(unbounded, "civilization-scale autonomy requires governed self-improvement");
  });

  it("requires named approval actions and owned canonical truth", () => {
    const noGates = clone(FOUNDATION);
    noGates.asi.autonomy.requiresApprovalFor = [];
    expectFailure(noGates, "requiresApprovalFor must name at least one gated action");

    const noTruth = clone(FOUNDATION);
    noTruth.asi.canonicalTruth.owners = [];
    expectFailure(noTruth, "canonicalTruth.owners must name the canonical truth");

    const contradictory = clone(FOUNDATION);
    contradictory.asi.canonicalTruth.ownsNoCanonicalTruth = true;
    expectFailure(
      contradictory,
      "cannot both own canonical truth and declare ownsNoCanonicalTruth",
    );

    const pureDerivation = clone(FOUNDATION);
    pureDerivation.asi.canonicalTruth.owners = [];
    pureDerivation.asi.canonicalTruth.ownsNoCanonicalTruth = true;
    const pureResult = validatePhaseContract(pureDerivation, validationOptions());
    expect(pureResult.ok, pureResult.ok ? "" : pureResult.issues.join(" | ")).toBe(true);

    const noDerived = clone(FOUNDATION);
    noDerived.asi.canonicalTruth.derived = [];
    expectFailure(noDerived, "derived must name the derived intelligence");
  });
});

describe("cross-phase connection law (no independent phases)", () => {
  it("rejects a phase that declares no consumer", () => {
    const orphan = clone(FOUNDATION);
    orphan.consumers = [];
    expectFailure(orphan, "must declare at least one consumer");
  });

  it("rejects self-dependency and self-consumption", () => {
    const selfDep = clone(FOUNDATION);
    selfDep.dependsOn = ["01"];
    expectFailure(selfDep, "a phase cannot depend on itself");

    const selfConsumer = clone(FOUNDATION);
    selfConsumer.consumers = ["all", "01"];
    expectFailure(selfConsumer, "a phase cannot consume itself");
  });

  it("rejects a dependency on a phase that is not registered", () => {
    const dangling = clone(FOUNDATION);
    dangling.dependsOn = ["99"];
    expectFailure(dangling, 'dependsOn references unregistered phase "99"');
  });

  it("accepts principal references (all, control-plane, runtime ids)", () => {
    const principal = clone(FOUNDATION);
    principal.consumers = ["all", "control-plane", "runtime:scholar"];
    const result = validatePhaseContract(principal, validationOptions());
    expect(result.ok, result.ok ? "" : result.issues.join(" | ")).toBe(true);
  });

  it("builds a connected graph rooted at phase 01 as contracts land wave by wave", () => {
    const graph = buildPhaseContractGraph(PHASE_CONTRACTS);
    expect(graph.nodes).toEqual(PHASE_CONTRACTS.map((contract) => contract.id));
    expect(graph.roots).toEqual(["01"]);
    expect(graph.edges).toContainEqual({ from: "02", to: "01", kind: "dependency" });
    expect(validatePhaseContractGraph(graph)).toEqual([]);
  });

  it("detects dangling edges, self loops, cycles and independent phases", () => {
    const dangling = validatePhaseContractGraph({
      nodes: ["01", "02"],
      edges: [{ from: "02", to: "77", kind: "dependency" }],
      roots: ["01"],
    });
    expect(dangling.join(" | ")).toContain("references an unregistered phase");

    const cycle = validatePhaseContractGraph({
      nodes: ["01", "02"],
      edges: [
        { from: "01", to: "02", kind: "dependency" },
        { from: "02", to: "01", kind: "dependency" },
      ],
      roots: [],
    });
    expect(cycle.join(" | ")).toContain("dependency cycle detected");

    const mutualConsumption = validatePhaseContractGraph({
      nodes: ["08", "09"],
      edges: [
        { from: "09", to: "08", kind: "dependency" },
        { from: "08", to: "09", kind: "consumer" },
      ],
      roots: [],
    });
    expect(mutualConsumption.join(" | ")).not.toContain("cycle");

    const island = validatePhaseContractGraph({
      nodes: ["01", "02"],
      edges: [],
      roots: ["01"],
    });
    expect(island.join(" | ")).toContain("phase 02 is independent");
  });
});

describe("runtime neutrality (Scholar first, neutral domains reserved)", () => {
  it("binds Scholar as the first runtime and reserves non-Scholar seats", () => {
    const domains = FOUNDATION.runtimeBindings.neutralSeats.map((seat) => seat.domain);
    expect(FOUNDATION.runtimeBindings.firstRuntime).toBe("runtime:scholar");
    expect(domains.length).toBeGreaterThanOrEqual(2);
    expect(new Set(domains).size).toBe(domains.length);
    expect(domains).not.toContain("education");
    for (const seat of FOUNDATION.runtimeBindings.neutralSeats) {
      expect(seat.status).toBe("reserved");
      expect(seat.manifestRef).toContain("domain-manifest");
    }
  });

  it("rejects a contract with no reserved seat for another domain runtime", () => {
    const firstRuntimeOnly = clone(FOUNDATION);
    firstRuntimeOnly.runtimeBindings.neutralSeats = [];
    // Message is runtime-neutral by law: the seat requirement never names a runtime.
    expectFailure(
      firstRuntimeOnly,
      "neutralSeats must reserve at least one seat for a domain runtime other than the first",
    );

    const duplicate = clone(FOUNDATION);
    duplicate.runtimeBindings.neutralSeats = [
      { domain: "healthcare", status: "reserved", manifestRef: "manifests/healthcare.json" },
      { domain: "healthcare", status: "reserved", manifestRef: "manifests/healthcare.json" },
    ];
    expectFailure(duplicate, 'duplicate neutral seat domain "healthcare"');

    const badSlug = clone(FOUNDATION);
    badSlug.runtimeBindings.neutralSeats = [
      { domain: "Health Care", status: "reserved", manifestRef: "manifests/x.json" },
    ];
    expectFailure(badSlug, 'neutral seat domain "Health Care" must be a lowercase slug');

    const badStatus = clone(FOUNDATION);
    badStatus.runtimeBindings.neutralSeats = [
      { domain: "commerce", status: "active" as never, manifestRef: "manifests/x.json" },
    ];
    expectFailure(badStatus, 'neutral seat "commerce" has an unregistered status');

    const noManifest = clone(FOUNDATION);
    noManifest.runtimeBindings.neutralSeats = [
      { domain: "commerce", status: "reserved", manifestRef: "" },
    ];
    expectFailure(noManifest, 'neutral seat "commerce" must reference a runtime manifest');
  });
});

describe("authored phase-contract registry", () => {
  it("validates the whole authored set against kernel capabilities and the graph", () => {
    const result = validatePhaseContracts();
    expect(result.ok, result.ok ? "" : result.issues.join(" | ")).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.summary.total).toBe(PHASE_CONTRACTS.length);
    expect(result.summary.sectionsComplete).toBe(PHASE_CONTRACTS.length);
    expect(result.summary.roots).toContain("01");
    expect(result.summary.byStatus.implementing).toBeGreaterThanOrEqual(1);
  });

  it("registers the authored wave in phase order while later waves land", () => {
    const ids = PHASE_CONTRACTS.map((contract) => contract.id);
    expect(ids).toEqual([...ids].sort());
    expect(ids[0]).toBe("01");
    expect(ids).toContain("02");
    expect(ids).toContain("03");
    expect(ids).toContain("04");
  });

  it("references only artifacts that exist in the repository", () => {
    const missing: string[] = [];
    for (const contract of PHASE_CONTRACTS) {
      for (const [key, section] of Object.entries(contract.sections)) {
        for (const artifact of section.artifacts) {
          if (artifact.startsWith("npm ") || artifact.includes(" ")) continue;
          if (!existsSync(join(ROOT, artifact))) {
            missing.push(`phase ${contract.id} ${key}: ${artifact}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("registry alignment (REGISTRY.md / PROGRESS.md source of truth)", () => {
  const catalogIds = PHASE_CATALOG.map((entry) => entry.phase);

  it("authors contracts contiguously from phase 01 with no gaps", () => {
    const ids = PHASE_CONTRACTS.map((contract) => contract.id);
    expect(ids.length).toBe(51);
    const expected = Array.from({ length: ids.length }, (_, i) => String(i + 1).padStart(2, "0"));
    expect(ids).toEqual(expected);
  });

  it("keeps every contract aligned with the PROGRESS §11 phase registry row", () => {
    const progress = readFileSync(join(ROOT, "PROGRESS.md"), "utf8");
    const rows = new Map<string, string>();
    const progressLines = progress.split(/\r\n|\r|\n/);
    for (let index = 0; index < progressLines.length; index += 1) {
      const tableMatch = progressLines[index].match(/^\|\s*(\d{2})\s+([^|]+?)\s*\|/);
      if (tableMatch) {
        rows.set(tableMatch[1], tableMatch[2].trim());
        continue;
      }
      const phaseMatch = progressLines[index].match(/^\s*(\d{2})\s*$/);
      const name = progressLines[index + 1]?.trim();
      if (
        phaseMatch &&
        name &&
        !/^(Complete|Pending|PROPOSED|IMPLEMENTED|ARCHITECTURE_DEFINED|DESIGNED|IN_PROGRESS|VALIDATING|OPERATIONAL|UNKNOWN)$/i.test(
          name,
        )
      ) {
        rows.set(phaseMatch[1], name);
      }
    }
    expect(rows.size).toBeGreaterThanOrEqual(51);
    for (const contract of PHASE_CONTRACTS) {
      expect(rows.get(contract.id), `PROGRESS row for phase ${contract.id}`).toBe(contract.name);
    }
  });

  it("keeps registry, catalog and contract names in lockstep (drift closed, ADR 202)", () => {
    const registry = JSON.parse(readFileSync(join(ROOT, "architecture/registry.json"), "utf8")) as {
      phases: Array<{ id: string; name: string }>;
    };
    const catalog = readFileSync(join(ROOT, "frontend/src/lib/phase-catalog.ts"), "utf8");
    const drifted: string[] = [];
    for (const phase of registry.phases) {
      const match = catalog.match(
        new RegExp(`phase: "${phase.id}",[\\s\\S]{0,90}?name: "([^"]+)"`),
      );
      const catalogName = match ? match[1] : "(not found)";
      if (catalogName !== phase.name) drifted.push(phase.id);
    }
    // ADR 202 aligned all seven previously-drifted names to PROGRESS §11 authority;
    // any new drift — or a regression on an aligned name — fails here.
    expect(drifted).toEqual([]);
  });

  it("matches each owned capability to its registry owner phase", () => {
    for (const contract of PHASE_CONTRACTS) {
      for (const capabilityId of contract.capabilities.owns) {
        const capability = KERNEL_CAPABILITIES.find((candidate) => candidate.id === capabilityId);
        expect(capability, `capability ${capabilityId} must exist`).toBeDefined();
        expect(capability?.ownerPhase, `owner of ${capabilityId}`).toBe(contract.id);
      }
    }
  });

  it("keeps the kernel capability graph free of unregistered principals", () => {
    const legal = new Set([...catalogIds, "all", "control-plane"]);
    const illegal: string[] = [];
    for (const capability of KERNEL_CAPABILITIES) {
      if (!catalogIds.includes(capability.ownerPhase)) {
        illegal.push(`${capability.id} owner ${capability.ownerPhase}`);
      }
      for (const consumer of capability.consumers) {
        if (!legal.has(consumer) && !/^runtime[-:]/.test(consumer)) {
          illegal.push(`${capability.id} consumer ${consumer}`);
        }
      }
    }
    expect(illegal).toEqual([]);
  });

  it("declares dependencies only on phases that come earlier or are registered", () => {
    const registered = new Set(catalogIds);
    for (const contract of PHASE_CONTRACTS) {
      for (const dependency of contract.dependsOn) {
        expect(registered.has(dependency), `${contract.id} depends on ${dependency}`).toBe(true);
      }
    }
  });
});
