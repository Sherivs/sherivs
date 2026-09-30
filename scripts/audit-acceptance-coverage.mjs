#!/usr/bin/env node
/**
 * Inventory phase acceptance definitions and generated proofs.
 *
 * This script does not create acceptance definitions or proofs. It records
 * coverage gaps from the current repository and preserves UNKNOWN states.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const registry = JSON.parse(readFileSync(join(root, "architecture", "registry.json"), "utf8"));
const acceptanceDir = join(root, "architecture", "phase-acceptance");
const proofDir = join(root, "architecture", "proofs");
const acceptanceFiles = existsSync(acceptanceDir) ? readdirSync(acceptanceDir) : [];

const phases = (registry.phases ?? []).map((phase) => {
  const phaseId = String(phase.id).padStart(2, "0");
  const definitionFile = acceptanceFiles.find(
    (file) => file.startsWith(`phase-${phaseId}-`) && file.endsWith(".json"),
  );
  const proofFile = `phase-${phaseId}-acceptance.proof.json`;
  const definitionPath = definitionFile
    ? join("architecture", "phase-acceptance", definitionFile)
    : null;
  const proofPath = join("architecture", "proofs", proofFile);
  const proofExists = existsSync(join(proofDir, proofFile));
  let proof = null;
  if (proofExists) {
    proof = JSON.parse(readFileSync(join(proofDir, proofFile), "utf8"));
  }

  let coverage;
  if (!definitionFile) {
    coverage = "UNKNOWN_ACCEPTANCE_NOT_ESTABLISHED";
  } else if (!proofExists) {
    coverage = "BLOCKED_PROOF_MISSING";
  } else if (proof.ok !== true) {
    coverage = "FAILED_OR_UNRESOLVED_PROOF";
  } else if ((proof.summary?.declared ?? 0) > 0 || (proof.summary?.implementedUnwired ?? 0) > 0) {
    coverage = "PASS_WITH_DECLARED_OR_UNWIRED_GAP";
  } else {
    coverage = "PASS";
  }

  return {
    phaseId,
    phaseName: phase.name,
    registryStatus: phase.status,
    acceptanceDefinition: definitionPath,
    proof: proofExists ? proofPath : null,
    coverage,
    summary: proof?.summary ?? null,
  };
});

const result = {
  mission: "COREGRID-MISSION-0001",
  artifact: "COREGRID_ACCEPTANCE_COVERAGE_AUDIT",
  capturedAt: new Date().toISOString(),
  policy:
    "Missing acceptance definitions remain UNKNOWN; this audit never fabricates definitions or proofs.",
  summary: {
    registeredPhases: phases.length,
    definitionsPresent: phases.filter((phase) => phase.acceptanceDefinition).length,
    proofsPresent: phases.filter((phase) => phase.proof).length,
    unknownAcceptance: phases
      .filter((phase) => phase.coverage === "UNKNOWN_ACCEPTANCE_NOT_ESTABLISHED")
      .map((phase) => phase.phaseId),
    blockedProofs: phases
      .filter((phase) => phase.coverage === "BLOCKED_PROOF_MISSING")
      .map((phase) => phase.phaseId),
    passWithGaps: phases
      .filter((phase) => phase.coverage === "PASS_WITH_DECLARED_OR_UNWIRED_GAP")
      .map((phase) => phase.phaseId),
    pass: phases.filter((phase) => phase.coverage === "PASS").map((phase) => phase.phaseId),
  },
  phases,
};

const outputPath = join(root, "architecture", "COREGRID_ACCEPTANCE_COVERAGE_AUDIT.json");
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result.summary, null, 2));
console.log(`Coverage audit written: ${outputPath}`);
