import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const architecture = join(root, "architecture");
const outputPath = join(architecture, "COREGRID_PHASE_52_ROUTING_DECOMPOSITION.json");
const sourceCandidates = [
  "phase 52 cross domaiin and engineering sections",
  "phase-52-cross domain and engineering sections",
];
const sourceName = sourceCandidates.find((name) => existsSync(join(architecture, name)));
if (!sourceName) throw new Error("Phase 52 corpus not found");

const sourcePath = join(architecture, sourceName);
const source = readFileSync(sourcePath, "utf8");
const lines = source.split(/\r?\n/);
const hash = (value) => createHash("sha256").update(value).digest("hex").toUpperCase();
const sourceHash = hash(source);

function readJson(name) {
  return JSON.parse(readFileSync(join(architecture, name), "utf8"));
}

const inventory = readJson("COREGRID_PHASE_52_SECTION_INVENTORY.json");
const catalog = readJson("COREGRID_PHASE_52_CAPABILITY_CATALOG.json");
const allocation = readJson("COREGRID_PHASE_52_CANONICAL_SURFACE_ALLOCATION.json");
const registry = readJson("registry.json");
const blueprintCatalog = readJson("COREGRID_BLUEPRINT_CATALOG.json");
const phases = new Map((registry.phases ?? []).map((phase) => [phase.id, phase]));
const phaseDocs = new Map();
for (const name of readdirSync(architecture).sort()) {
  const match = name.match(/^phase-(\d{2})-.+\.md$/);
  if (match) phaseDocs.set(match[1], `architecture/${name}`);
}

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[—=:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRanges(value) {
  return String(value ?? "")
    .split(",")
    .map((part) => part.trim().match(/(\d+)\s*-\s*(\d+)/))
    .filter(Boolean)
    .map((match) => [Number(match[1]), Number(match[2])]);
}

function overlap(linesStart, linesEnd, ranges) {
  return ranges.reduce((total, [start, end]) => {
    return total + Math.max(0, Math.min(linesEnd, end) - Math.max(linesStart, start) + 1);
  }, 0);
}

function phaseEvidence(phaseId) {
  if (!phaseId || !phases.has(phaseId)) return [];
  const phase = phases.get(phaseId);
  return [
    "architecture/registry.json",
    phaseDocs.get(phaseId),
    "architecture/COREGRID_BLUEPRINT_CATALOG.json",
    `registry.phase[${phaseId}]`,
    ...(phase.modules ?? []).map((module) => `frontend/src/lib/${module}`),
  ].filter(Boolean);
}

function evidenceFor(candidate, phaseIds = []) {
  return [
    "architecture/COREGRID_PHASE_52_SECTION_INVENTORY.json",
    "architecture/COREGRID_PHASE_52_CAPABILITY_CATALOG.json",
    "architecture/COREGRID_PHASE_52_CANONICAL_SURFACE_ALLOCATION.json",
    "architecture/COREGRID_PHASE_52_OWNERSHIP_RECONCILIATION.md",
    "architecture/COREGRID_PHASE_52_RECONCILIATION.md",
    "architecture/COREGRID_BLUEPRINT_CATALOG.json",
    ...phaseIds.flatMap(phaseEvidence),
    ...(candidate?.implementationEvidence ?? []),
  ].filter(Boolean);
}

const allocationByTitle = new Map(
  (allocation.blocks ?? []).map((block) => [normalize(block.name), block]),
);
const capabilities = (catalog.capabilities ?? []).map((capability) => ({
  ...capability,
  ranges: parseRanges(capability.sourceLines),
}));

function candidateFor(startLine, endLine, title, blockNumber) {
  const exactAllocation = allocationByTitle.get(normalize(title));
  if (exactAllocation) {
    return {
      source: "canonical-surface-allocation",
      claimedOwner: exactAllocation.canonicalPhaseOwner,
      candidateOwner: /^\d+$/.test(String(exactAllocation.canonicalPhaseOwner))
        ? exactAllocation.canonicalPhaseOwner.padStart(2, "0")
        : null,
      candidateOwners: /^\d+$/.test(String(exactAllocation.canonicalPhaseOwner))
        ? [String(exactAllocation.canonicalPhaseOwner).padStart(2, "0")]
        : [],
      relatedPhases: [
        ...(exactAllocation.canonicalPhaseOwner &&
        /^\d+$/.test(String(exactAllocation.canonicalPhaseOwner))
          ? [String(exactAllocation.canonicalPhaseOwner).padStart(2, "0")]
          : []),
      ],
      conflictCluster: null,
      classification: exactAllocation.classification,
      implementationEvidence: [],
      evidence: [
        "architecture/COREGRID_PHASE_52_CANONICAL_SURFACE_ALLOCATION.json",
        `allocation.block[${exactAllocation.block}]`,
      ],
    };
  }

  const ranked = capabilities
    .map((capability) => ({
      capability,
      score: overlap(startLine, endLine, capability.ranges),
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.capability.id.localeCompare(right.capability.id),
    );
  if (!ranked.length) return null;

  const topScore = ranked[0].score;
  const top = ranked.filter((entry) => entry.score === topScore);
  const owners = [
    ...new Set(top.flatMap(({ capability }) => capability.existingOwners ?? [])),
  ].sort();
  const clusters = [
    ...new Set(top.flatMap(({ capability }) => capability.relatedClusters ?? [])),
  ].sort();
  const classes = [...new Set(top.map(({ capability }) => capability.classification))];
  const candidate = top[0].capability;
  return {
    source: "capability-catalog",
    capabilityIds: top.map(({ capability }) => capability.id),
    claimedOwner: owners.length ? owners.join("/") : null,
    candidateOwner: owners.length === 1 ? owners[0].padStart(2, "0") : null,
    candidateOwners: owners.map((owner) => owner.padStart(2, "0")),
    relatedPhases: owners.map((owner) => owner.padStart(2, "0")),
    conflictCluster: clusters.length ? clusters.join("/") : null,
    classification: classes.length > 1 ? "DUPLICATE_OR_CONFLICT" : candidate.classification,
    implementationEvidence: top.flatMap(
      ({ capability }) => capability.implementationEvidence ?? [],
    ),
    evidence: [
      "architecture/COREGRID_PHASE_52_CAPABILITY_CATALOG.json",
      ...top.map(({ capability }) => `capability[${capability.id}]`),
    ],
    blockNumber,
  };
}

function statusFor(candidate) {
  if (!candidate) return "DEFERRED";
  if (
    candidate.classification === "DUPLICATE_OR_CONFLICT" ||
    candidate.candidateOwners.length > 1
  ) {
    return "CONFLICTING";
  }
  if (
    candidate.classification === "UNOWNED_CANDIDATE" ||
    candidate.classification === "CANDIDATE_EXTENSION"
  ) {
    return "PROPOSED_UNOWNED";
  }
  if (
    candidate.classification === "EXTENSION_OF_EXISTING" ||
    candidate.classification === "EXISTING_OWNER"
  ) {
    return "EXISTING_CANONICAL_OWNER";
  }
  return "DEFERRED";
}

function makeRecord(kind, index, item, startLine, endLine, body, blockNumber) {
  const candidate = candidateFor(startLine, endLine, item.title, blockNumber);
  const status = statusFor(candidate);
  const phaseIds = candidate?.relatedPhases ?? [];
  return {
    id: `${kind}-${String(index).padStart(4, "0")}`,
    kind,
    index,
    sourceLineRange: `${startLine}-${endLine}`,
    startLine,
    endLine,
    lineCount: endLine - startLine + 1,
    contentSha256: hash(body),
    block: blockNumber ?? null,
    title: item.title ?? "",
    normalizedTitle: normalize(item.title ?? ""),
    claimedOwner: candidate?.claimedOwner ?? null,
    candidateOwner: candidate?.candidateOwner ?? null,
    candidateOwners: candidate?.candidateOwners ?? [],
    relatedPhases: phaseIds,
    conflictCluster: candidate?.conflictCluster ?? null,
    status,
    classification: candidate?.classification ?? "UNKNOWN",
    evidenceReferences: [
      ...evidenceFor(
        {
          implementationEvidence: candidate?.implementationEvidence ?? [],
        },
        phaseIds,
      ),
      ...(candidate?.evidence ?? []),
    ].filter((value, position, values) => values.indexOf(value) === position),
  };
}

const blockRecords = inventory.blockOccurrences.map((item, index) => {
  const body = lines
    .slice(item.startLine - 1, item.endLine)
    .join("\n")
    .trimEnd();
  return makeRecord("block", index + 1, item, item.startLine, item.endLine, body, item.block);
});

function sectionRecords(kind, sourceItems) {
  const sorted = sourceItems
    .map((item, index) => ({ item, index }))
    .sort((left, right) => left.item.line - right.item.line || left.index - right.index);
  return sorted.map(({ item }, index) => {
    const next = sorted[index + 1]?.item;
    const startLine = item.line;
    const endLine = next ? next.line - 1 : lines.length - 1;
    const body = lines
      .slice(startLine - 1, endLine)
      .join("\n")
      .trimEnd();
    return makeRecord(kind, index + 1, item, startLine, endLine, body, null);
  });
}

const numberedRecords = sectionRecords("numbered-section", inventory.numberedSections);
const letteredRecords = sectionRecords("lettered-section", inventory.letteredSections);
const records = [...blockRecords, ...numberedRecords, ...letteredRecords];
const counts = Object.fromEntries(
  ["EXISTING_CANONICAL_OWNER", "PROPOSED_UNOWNED", "CONFLICTING", "DEFERRED"].map((status) => [
    status,
    records.filter((record) => record.status === status).length,
  ]),
);

const artifact = {
  mission: "COREGRID-MISSION-0001",
  artifact: "COREGRID_PHASE_52_ROUTING_DECOMPOSITION",
  status: "DESIGN_EVIDENCE_ROUTING_ONLY",
  generatedBy: "scripts/generate-phase52-routing.mjs",
  source: {
    path: `architecture/${sourceName}`,
    sha256: sourceHash,
    lineCount: lines.length - 1,
    byteLength: Buffer.byteLength(source, "utf8"),
  },
  inputs: {
    inventory: "architecture/COREGRID_PHASE_52_SECTION_INVENTORY.json",
    capabilityCatalog: "architecture/COREGRID_PHASE_52_CAPABILITY_CATALOG.json",
    canonicalSurfaceAllocation: "architecture/COREGRID_PHASE_52_CANONICAL_SURFACE_ALLOCATION.json",
    registry: "architecture/registry.json",
    blueprintCatalog: "architecture/COREGRID_BLUEPRINT_CATALOG.json",
  },
  routingRules: {
    existingCanonicalOwner:
      "Only explicit existing-owner/extension evidence with a single candidate owner is routed here.",
    proposedUnowned: "Candidate boundaries remain proposals and are never registered as phases.",
    conflicting:
      "Duplicate/conflict classifications or multiple top-ranked owners remain unresolved.",
    deferred:
      "No deterministic ownership evidence, governance-only material, or unverified boundary.",
    sectionBoundary:
      "A numbered or lettered section ends immediately before the next indexed section of the same family or EOF.",
    sourcePreservation: "The Phase 52 corpus is never rewritten.",
  },
  summary: {
    blockRecords: blockRecords.length,
    numberedSectionRecords: numberedRecords.length,
    letteredSectionRecords: letteredRecords.length,
    totalRecords: records.length,
    byStatus: counts,
    phase52Registered: phases.has("52"),
    implementationAuthorized: false,
  },
  records,
  nextGates: [
    "Resolve D1, D2, D3, D4, D5, and D7 ownership conflicts.",
    "Approve candidate-boundary contracts, security, evidence, verification, and conformance gates.",
    "Do not register Phase 52 or create infrastructure from this artifact.",
  ],
};

const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
if (process.argv.includes("--check")) {
  const existing = readFileSync(outputPath, "utf8");
  if (existing !== serialized) {
    throw new Error("Routing artifact is stale; run node scripts/generate-phase52-routing.mjs");
  }
} else {
  writeFileSync(outputPath, serialized, "utf8");
}

console.log(
  JSON.stringify(
    {
      sourceSha256: sourceHash,
      ...artifact.summary,
      output: relative(root, outputPath).replaceAll("\\", "/"),
      mode: process.argv.includes("--check") ? "check" : "write",
    },
    null,
    2,
  ),
);
