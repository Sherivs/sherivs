import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const map = JSON.parse(
  readFileSync(join(root, "architecture", "COREGRID_PHASE_52_DECOMPOSITION_MAP.json"), "utf8"),
);

const gaps = map.unresolved.map((entry, index) => {
  const extract = map.extracts.find((candidate) => candidate.artifactId === entry.artifactId);
  const routing = extract?.routing ?? {};
  const candidateBoundary = entry.candidateBoundary === true;
  const conflict =
    entry.classification === "DUPLICATE_OR_CONFLICT" ||
    entry.classification === "UNOWNED_CANDIDATE";
  const unresolvedBoundary = entry.classification === "UNRESOLVED";
  return {
    id: `CG-P52-GAP-${String(index + 1).padStart(3, "0")}`,
    category: candidateBoundary ? "OWNERSHIP" : "ARCHITECTURAL",
    description: `Phase 52 extract ${entry.artifactId} has no approved canonical owner.`,
    source: [entry.extract, "architecture/COREGRID_PHASE_52_DECOMPOSITION_MAP.json"],
    evidence: {
      block: entry.block,
      title: entry.title,
      sourceLines: extract?.sourceLines ?? null,
      contentSha256: extract?.contentSha256 ?? null,
      classification: entry.classification,
    },
    affectedArchitecture: {
      motherSurface: routing.primaryMotherSurface ?? null,
      candidatePhaseOwner: routing.canonicalPhaseOwner ?? null,
      secondarySurfaces: routing.secondarySurfaces ?? [],
    },
    owner: "UNRESOLVED_REQUIRES_GOVERNANCE",
    dependency: [
      "existing phase ownership review",
      "duplication analysis",
      "security boundary",
      "evidence requirements",
      "verification requirements",
    ],
    severity: candidateBoundary || unresolvedBoundary ? "HIGH" : conflict ? "MEDIUM" : "LOW",
    requiredAction:
      "Compare against existing canonical capabilities, determine ownership, record a decision, and scope-lock before implementation.",
    verification:
      "Approved ownership decision plus contract, security, failure, evidence and acceptance review.",
    status: "BLOCKED",
  };
});

const register = {
  mission: "COREGRID-MISSION-0001",
  artifact: "COREGRID_PHASE_52_UNRESOLVED_GAP_REGISTER",
  status: "BLOCKED_REVIEW_REQUIRED",
  capturedAt: new Date().toISOString(),
  source: {
    decompositionMap: "architecture/COREGRID_PHASE_52_DECOMPOSITION_MAP.json",
    corpusSha256: map.source.sha256,
  },
  rule: "These gaps do not authorize new phases, mother surfaces, infrastructure, or implementation.",
  summary: {
    total: gaps.length,
    high: gaps.filter((gap) => gap.severity === "HIGH").length,
    medium: gaps.filter((gap) => gap.severity === "MEDIUM").length,
    low: gaps.filter((gap) => gap.severity === "LOW").length,
  },
  gaps,
  nextGate:
    "Run bounded ownership decisions in dependency/risk order; preserve unresolved items as BLOCKED.",
};

const output = join(root, "architecture", "COREGRID_PHASE_52_UNRESOLVED_GAP_REGISTER.json");
writeFileSync(output, `${JSON.stringify(register, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      total: gaps.length,
      high: register.summary.high,
      medium: register.summary.medium,
      low: register.summary.low,
      output: "architecture/COREGRID_PHASE_52_UNRESOLVED_GAP_REGISTER.json",
    },
    null,
    2,
  ),
);
