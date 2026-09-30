#!/usr/bin/env node
/**
 * CoreGrid Mission 0001 reconciliation artifact validator.
 *
 * This is intentionally read-only. It validates that the evidence model
 * references the current repository shape and reports conflicts without
 * mutating canonical registry, phase, or governance files.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const requiredMothers = [
  "COREGRID.md",
  "GOVERNANCE.md",
  "ARCHITECTURE.md",
  "REALITY.md",
  "ENGINEERING.md",
  "WORKFORCE.md",
  "MISSIONS.md",
  "BLUEPRINTS.md",
  "PROGRESS.md",
  "ECOSYSTEM.md",
  "IMPLEMENTATION.md",
  "RUNTIME.md",
  "ASSURANCE.md",
];
const requiredPlans = [
  "COREGRID_MISSION_0001_ENGINEERING_PLAN.md",
  "COREGRID_FIRST_MISSION_DEFINITION.md",
];
const artifacts = [
  "COREGRID_CAPABILITY_CATALOG.json",
  "COREGRID_ARCHITECTURE_OWNERSHIP_MAP.json",
  "COREGRID_PHASE_RECONCILIATION_MAP.json",
  "COREGRID_GAP_REGISTER.json",
  "COREGRID_ARCHITECTURE_TO_CODE_TRACEABILITY.json",
  "COREGRID_MOTHER_SURFACE_RECONCILIATION.json",
  "COREGRID_PHASE_52_CAPABILITY_CATALOG.json",
  "COREGRID_PHASE_52_CANONICAL_SURFACE_ALLOCATION.json",
  "COREGRID_PHASE_52_SECTION_INVENTORY.json",
  "COREGRID_FIRST_MISSION_DEFINITION.json",
  "COREGRID_ACCEPTANCE_COVERAGE_AUDIT.json",
  "COREGRID_VERIFICATION_BASELINE.json",
];

for (const file of requiredMothers) {
  if (!existsSync(join(root, file))) errors.push(`missing mother surface ${file}`);
}

for (const file of requiredPlans) {
  const path = join(root, "architecture", file);
  if (!existsSync(path)) {
    errors.push(`missing engineering plan architecture/${file}`);
  }
}

for (const file of artifacts) {
  const path = join(root, "architecture", file);
  if (!existsSync(path)) {
    errors.push(`missing reconciliation artifact architecture/${file}`);
    continue;
  }
  try {
    JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`invalid JSON architecture/${file}: ${error.message}`);
  }
}

const registry = JSON.parse(readFileSync(join(root, "architecture", "registry.json"), "utf8"));
if (registry.phaseCount !== 51 || registry.phases?.length !== 51) {
  errors.push(`registry phase count expected 51, got ${registry.phases?.length ?? "missing"}`);
}

const derived = readFileSync(join(root, "architecture", "phase-completion-status.md"), "utf8");
if (!/^Phases audited: 51/m.test(derived))
  errors.push("derived phase status does not declare 51 audited phases");

const phase52Catalog = JSON.parse(
  readFileSync(join(root, "architecture", "COREGRID_PHASE_52_CAPABILITY_CATALOG.json"), "utf8"),
);
if (phase52Catalog.newPhaseDecision !== "NONE_AUTHORIZED") {
  errors.push("Phase 52 catalog must not authorize a new phase during reconciliation");
}

const verificationBaseline = JSON.parse(
  readFileSync(join(root, "architecture", "COREGRID_VERIFICATION_BASELINE.json"), "utf8"),
);
if (verificationBaseline.status !== "PARTIAL_EVIDENCE_BASELINE") {
  errors.push(
    "verification baseline must remain a partial evidence baseline until full checks run",
  );
}

const phase52Allocation = JSON.parse(
  readFileSync(
    join(root, "architecture", "COREGRID_PHASE_52_CANONICAL_SURFACE_ALLOCATION.json"),
    "utf8",
  ),
);
if (!Array.isArray(phase52Allocation.blocks) || phase52Allocation.blocks.length !== 18) {
  errors.push("Phase 52 allocation must contain exactly 18 engineering blocks");
}

const phase52Inventory = JSON.parse(
  readFileSync(join(root, "architecture", "COREGRID_PHASE_52_SECTION_INVENTORY.json"), "utf8"),
);
if (
  phase52Inventory.source?.sha256 !==
  "A69A3E74FAA88B78B6FB33C36A499E764F7DE04A2C4B33B20C5795D1084CE286"
) {
  errors.push("Phase 52 section inventory source hash does not match the corpus baseline");
}

const firstMission = JSON.parse(
  readFileSync(join(root, "architecture", "COREGRID_FIRST_MISSION_DEFINITION.json"), "utf8"),
);
if (
  firstMission.missionId !== "COREGRID-FOUNDATION-MISSION-001" ||
  firstMission.status !== "PROPOSED_NOT_AUTHORIZED_FOR_IMPLEMENTATION"
) {
  errors.push(
    "first mission definition must remain proposed and unauthorized until ownership is resolved",
  );
}
if (!Array.isArray(firstMission.scope?.includes) || firstMission.scope.includes.length === 0) {
  errors.push("first mission definition requires an explicit bounded scope");
}
const acceptanceCoverage = JSON.parse(
  readFileSync(join(root, "architecture", "COREGRID_ACCEPTANCE_COVERAGE_AUDIT.json"), "utf8"),
);
if (acceptanceCoverage.summary?.registeredPhases !== 51) {
  errors.push("acceptance coverage audit does not match the current 51-phase registry");
}
if (acceptanceCoverage.summary?.definitionsPresent !== acceptanceCoverage.summary?.proofsPresent) {
  errors.push("every acceptance definition must have a generated proof before coverage is counted");
}
const coveredPhaseCount =
  (acceptanceCoverage.summary?.definitionsPresent ?? 0) +
  (acceptanceCoverage.summary?.unknownAcceptance?.length ?? 0) +
  (acceptanceCoverage.summary?.blockedProofs?.length ?? 0);
if (coveredPhaseCount !== 51) {
  errors.push("acceptance coverage audit must account for every registered phase");
}
const engineeringPlan = readFileSync(
  join(root, "architecture", "COREGRID_MISSION_0001_ENGINEERING_PLAN.md"),
  "utf8",
);
for (const heading of [
  "## 1. Repository topology",
  "## 12. Missing capability register",
  "## 20. First CoreGrid foundation mission",
  "## 25. Rollback strategy",
]) {
  if (!engineeringPlan.includes(heading)) {
    errors.push(`engineering plan is missing required section ${heading}`);
  }
}
if (
  phase52Inventory.summary?.blockOccurrences !== phase52Inventory.blockOccurrences?.length ||
  phase52Inventory.summary?.exactDuplicateGroups !== phase52Inventory.exactDuplicateGroups?.length
) {
  errors.push("Phase 52 section inventory summary does not match its records");
}
for (const block of phase52Allocation.blocks ?? []) {
  if (!block.primaryMotherSurface || !block.canonicalPhaseOwner) {
    errors.push(`Phase 52 block ${block.block ?? "unknown"} is missing a primary surface or owner`);
  }
  if (block.canonicalPhaseOwner === "NEW_PHASE") {
    errors.push(
      `Phase 52 block ${block.block ?? "unknown"} cannot register an unauthorized new phase`,
    );
  }
}
if (!Array.isArray(verificationBaseline.checks) || verificationBaseline.checks.length === 0) {
  errors.push("verification baseline requires explicit check records");
}
for (const capability of phase52Catalog.capabilities ?? []) {
  if (!capability.id || !capability.classification || !capability.status) {
    errors.push("Phase 52 capability entries require id, classification, and status");
  }
  if (
    capability.status === "IMPLEMENTED" ||
    capability.status === "VERIFIED" ||
    capability.status === "OPERATIONAL"
  ) {
    errors.push(
      `Phase 52 capability ${capability.id} claims unauthorized completion status ${capability.status}`,
    );
  }
}

const derivedRows = new Map();
for (const line of derived.split(/\r?\n/)) {
  const cells = line.split("|").map((cell) => cell.trim());
  if (!/^\d{2}$/.test(cells[1] ?? "")) continue;
  derivedRows.set(cells[1], {
    derived: cells[12] ?? null,
    registry: cells[13] ?? null,
  });
}

const statusConflicts = registry.phases
  .map((phase) => {
    const row = derivedRows.get(phase.id);
    if (!row)
      return {
        phase: phase.id,
        registry: phase.status,
        derived: null,
        type: "missing-derived-row",
      };
    if (phase.status !== row.registry || phase.status !== row.derived) {
      return {
        phase: phase.id,
        name: phase.name,
        registry: phase.status,
        derivedRegistry: row.registry,
        derived: row.derived,
        type: "status-conflict",
      };
    }
    return null;
  })
  .filter(Boolean);

const result = {
  mission: "COREGRID-MISSION-0001",
  artifact: "COREGRID_REGISTRY_TRUTH_LOCK",
  mothers: {
    expected: 13,
    present: requiredMothers.filter((file) => existsSync(join(root, file))).length,
  },
  registry: {
    phases: registry.phases?.length ?? 0,
    capabilities: registry.capabilities?.length ?? 0,
  },
  artifacts: {
    expected: artifacts.length,
    present: artifacts.filter((file) => existsSync(join(root, "architecture", file))).length,
  },
  derivedStatusRows: derivedRows.size,
  statusConflicts,
  errors,
  status: errors.length === 0 ? "PASS_WITH_REPORTED_CONFLICTS" : "FAIL",
};

console.log(JSON.stringify(result, null, 2));
if (errors.length > 0) process.exit(1);
