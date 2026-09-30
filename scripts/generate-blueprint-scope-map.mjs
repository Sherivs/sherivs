import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const architectureDir = join(root, "architecture");
const registry = JSON.parse(readFileSync(join(architectureDir, "registry.json"), "utf8"));
const completion = JSON.parse(
  readFileSync(join(architectureDir, "proofs", "phase-completion.proof.json"), "utf8"),
);
const completionById = new Map(completion.phases.map((phase) => [phase.id, phase]));
const acceptanceDir = join(architectureDir, "phase-acceptance");
const proofDir = join(architectureDir, "proofs");
const openClusters = new Set(["D1", "D2", "D3", "D4", "D5", "D7"]);

const phases = registry.phases.map((phase) => {
  const audit = completionById.get(phase.id);
  const acceptance = readdirSync(acceptanceDir).find(
    (entry) => entry.startsWith(`phase-${phase.id}-`) && entry.endsWith(".json"),
  );
  const acceptanceProof = `phase-${phase.id}-acceptance.proof.json`;
  const acceptanceProofExists = existsSync(join(proofDir, acceptanceProof));
  const sections = audit?.sections ?? "UNKNOWN";
  const sectionComplete = sections === "20/20";
  const hasAcceptance = Boolean(acceptance && acceptanceProofExists);
  const conflicted = phase.id === "16" || phase.id === "32" || phase.id === "36";
  let scopeLock = "PARTIAL_NOT_SCOPE_LOCKED";
  if (sectionComplete && hasAcceptance && !conflicted) {
    scopeLock = "DESIGN_SCOPE_LOCKED_WITH_ACCEPTANCE_EVIDENCE";
  } else if (hasAcceptance) {
    scopeLock = "PARTIAL_WITH_ACCEPTANCE_EVIDENCE";
  }
  return {
    phase: phase.id,
    name: phase.name,
    source: `architecture/phase-${phase.id}-*.md`,
    canonicalOwner: phase.id,
    registryStatus: phase.status,
    derivedStatus: audit?.derivedStatus ?? "UNKNOWN",
    sections,
    modules: phase.modules,
    modulesResolve: audit?.modulesResolve ?? false,
    acceptanceDefinition: acceptance ? `architecture/phase-acceptance/${acceptance}` : null,
    acceptanceProof: acceptanceProofExists ? `architecture/proofs/${acceptanceProof}` : null,
    scopeLock,
    unresolvedClusters: conflicted ? [...openClusters] : [],
    implementationBoundary:
      phase.modules.length > 0 ? "EXISTING_MODULES_REQUIRES_RUNTIME_REVIEW" : "NONE_ESTABLISHED",
    runtimeBoundary:
      audit?.evidence?.["L4 frontend/workspace integration"] === true
        ? "OBSERVED_ROUTE_OR_WORKSPACE_EVIDENCE"
        : "UNVERIFIED",
    evidenceBoundary:
      audit?.evidence?.["L5 operational maturity"] === true
        ? "OPERATIONAL_ARTIFACT_NAMED"
        : "UNVERIFIED",
  };
});

const map = {
  mission: "COREGRID-MISSION-0001",
  artifact: "COREGRID_BLUEPRINT_SCOPE_MAP",
  status: "RECONCILED_WITH_DECLARED_GAPS",
  capturedAt: new Date().toISOString(),
  scopeLockLaw:
    "A long blueprint is not scope-locked unless purpose, non-purpose, owner, boundaries, dependencies, contracts, runtime expectations, security, failure, evidence, verification, conformance and evolution rules are sufficiently evidenced.",
  phaseCount: phases.length,
  scopeLocked: phases.filter((phase) => phase.scopeLock.startsWith("DESIGN_SCOPE_LOCKED")).length,
  partial: phases.filter((phase) => phase.scopeLock.startsWith("PARTIAL")).length,
  openClusters: [...openClusters],
  phases,
  nextGate:
    "Review partial and conflicted blueprints by ownership/dependency order; upgrade documents only when evidence supports the change.",
};

const output = join(architectureDir, "COREGRID_BLUEPRINT_SCOPE_MAP.json");
writeFileSync(output, `${JSON.stringify(map, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      phases: map.phaseCount,
      scopeLocked: map.scopeLocked,
      partial: map.partial,
      output: "architecture/COREGRID_BLUEPRINT_SCOPE_MAP.json",
    },
    null,
    2,
  ),
);
