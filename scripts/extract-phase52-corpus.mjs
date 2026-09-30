import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const architectureDir = join(root, "architecture");
const inventoryPath = join(architectureDir, "COREGRID_PHASE_52_SECTION_INVENTORY.json");
const allocationPath = join(architectureDir, "COREGRID_PHASE_52_CANONICAL_SURFACE_ALLOCATION.json");
const extractDir = join(architectureDir, "phase-52-extracts");
const mapPath = join(architectureDir, "COREGRID_PHASE_52_DECOMPOSITION_MAP.json");

const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
const allocation = JSON.parse(readFileSync(allocationPath, "utf8"));
const sourcePath = join(root, inventory.source.path);
if (!existsSync(sourcePath)) {
  throw new Error(`Phase 52 source not found: ${inventory.source.path}`);
}

const source = readFileSync(sourcePath, "utf8");
const lines = source.split(/\r?\n/);
const allocationByBlock = new Map(
  allocation.blocks.map((block) => [block.block.padStart(2, "0"), block]),
);
const duplicateByOccurrence = new Map();
for (const group of inventory.exactDuplicateGroups) {
  for (const occurrence of group.occurrences) {
    duplicateByOccurrence.set(occurrence, {
      group: group.key,
      duplicateCount: group.duplicateCount,
      representativeOccurrence: group.occurrences[0],
    });
  }
}

mkdirSync(extractDir, { recursive: true });
const extracts = [];
for (const occurrence of inventory.blockOccurrences) {
  const start = occurrence.startLine - 1;
  const end = occurrence.endLine;
  const body = lines.slice(start, end).join("\n").trimEnd();
  const block = allocationByBlock.get(occurrence.block);
  const duplicate = duplicateByOccurrence.get(occurrence.occurrence) ?? null;
  const extractName = `block-${occurrence.block}-occurrence-${String(
    occurrence.occurrence,
  ).padStart(3, "0")}.md`;
  const extractPath = join(extractDir, extractName);
  const relativeExtractPath = `architecture/phase-52-extracts/${extractName}`;
  const routing = {
    primaryMotherSurface: block?.primaryMotherSurface ?? null,
    canonicalPhaseOwner:
      block?.canonicalPhaseOwner && /^\d{2}$/.test(block.canonicalPhaseOwner)
        ? block.canonicalPhaseOwner
        : null,
    phaseStatus: block?.phaseStatus ?? "UNRESOLVED",
    classification: block?.classification ?? "UNRESOLVED",
    secondarySurfaces: block?.secondarySurfaces ?? [],
    candidateBoundary: block?.candidateBoundary ?? false,
  };
  const header = [
    "---",
    `mission: COREGRID-MISSION-0001`,
    `artifact_id: p52-block-${occurrence.block}-occurrence-${String(occurrence.occurrence).padStart(
      3,
      "0",
    )}`,
    `source: ${inventory.source.path}`,
    `source_sha256: ${inventory.source.sha256}`,
    `source_lines: ${occurrence.startLine}-${occurrence.endLine}`,
    `content_sha256: ${occurrence.contentSha256}`,
    `inferred_title: ${occurrence.inferredTitle || "UNRESOLVED"}`,
    `primary_mother_surface: ${routing.primaryMotherSurface ?? "UNRESOLVED"}`,
    `canonical_phase_owner: ${routing.canonicalPhaseOwner ?? "UNRESOLVED"}`,
    `classification: ${routing.classification}`,
    `status: ${routing.phaseStatus}`,
    `candidate_boundary: ${routing.candidateBoundary}`,
    `duplicate_group: ${duplicate?.group ?? "NONE"}`,
    `duplicate_count: ${duplicate?.duplicateCount ?? 1}`,
    "---",
    "",
  ].join("\n");
  writeFileSync(extractPath, `${header}${body}\n`, "utf8");
  extracts.push({
    artifactId: `p52-block-${occurrence.block}-occurrence-${String(occurrence.occurrence).padStart(
      3,
      "0",
    )}`,
    sourceLocation: inventory.source.path,
    sourceLines: [occurrence.startLine, occurrence.endLine],
    extract: relativeExtractPath,
    block: occurrence.block,
    sourceTitle: occurrence.title,
    title: occurrence.inferredTitle || occurrence.title,
    inferredTitle: occurrence.inferredTitle,
    normalizedTitle: occurrence.normalizedTitle,
    contentSha256: occurrence.contentSha256,
    duplicate,
    routing,
    status: "EXTRACTED_NOT_IMPLEMENTED",
  });
}

const unresolved = extracts.filter(
  (entry) => !entry.routing.primaryMotherSurface || !entry.routing.canonicalPhaseOwner,
);
const map = {
  mission: "COREGRID-MISSION-0001",
  artifact: "COREGRID_PHASE_52_DECOMPOSITION_MAP",
  status: "EXTRACTED_ROUTED_WITH_UNRESOLVED_ITEMS",
  source: {
    path: inventory.source.path,
    sha256: inventory.source.sha256,
    lineCount: inventory.source.lineCount,
    byteLength: inventory.source.byteLength,
  },
  extraction: {
    occurrences: extracts.length,
    exactDuplicateGroups: inventory.summary.exactDuplicateGroups,
    uniqueBodies: inventory.summary.uniqueBlockBodies,
    extractDirectory: "architecture/phase-52-extracts",
    sourcePreserved: true,
  },
  routingLaw: allocation.allocationLaw,
  extracts,
  unresolved: unresolved.map((entry) => ({
    artifactId: entry.artifactId,
    block: entry.block,
    title: entry.title,
    classification: entry.routing.classification,
    candidateBoundary: entry.routing.candidateBoundary,
    requiredDecision:
      "Determine existing owner or propose a new phase through governance; do not implement from this extract alone.",
  })),
  prohibitedActions: [
    "register Phase 52 as a canonical phase",
    "create a new mother surface from an extract",
    "claim implementation from extracted text",
    "delete or rewrite source corpus",
  ],
  nextGate:
    "Review routed extracts, resolve unresolved ownership, then scope-lock approved blueprints before implementation.",
};

writeFileSync(mapPath, `${JSON.stringify(map, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      extracts: extracts.length,
      unresolved: unresolved.length,
      duplicateGroups: inventory.summary.exactDuplicateGroups,
      output: "architecture/COREGRID_PHASE_52_DECOMPOSITION_MAP.json",
      directory: "architecture/phase-52-extracts",
    },
    null,
    2,
  ),
);
