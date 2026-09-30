import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceCandidates = [
  "phase 52 cross domaiin and engineering sections",
  "phase-52-cross domain and engineering sections",
];
const sourceName = sourceCandidates.find((candidate) =>
  existsSync(join(root, "architecture", candidate)),
);
if (!sourceName) {
  throw new Error(`Phase 52 corpus not found. Checked: ${sourceCandidates.join(", ")}`);
}
const sourcePath = join(root, "architecture", sourceName);
const outputPath = join(root, "architecture", "COREGRID_PHASE_52_SECTION_INVENTORY.json");
const source = readFileSync(sourcePath, "utf8");
const lines = source.split(/\r?\n/);
const sourceHash = createHash("sha256").update(source).digest("hex").toUpperCase();

function hash(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

function normalizeTitle(value) {
  return value.toLowerCase().replace(/[—=:]/g, " ").replace(/\s+/g, " ").trim();
}

const blockPattern = /^BLOCK\s+(\d{1,2})(?:\s*(?:—|=|:)\s*(.*))?$/i;
const numberedPattern = /^(\d{1,3})\.\s+(.+)$/;
const letteredPattern = /^([A-Z]{1,3})\.\s+(.+)$/;
const anchors = [];
const numberedSections = [];
const letteredSections = [];

for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index].trim();
  const block = line.match(blockPattern);
  if (block) {
    anchors.push({
      kind: "block",
      label: block[1].padStart(2, "0"),
      title: (block[2] ?? "").trim(),
      line: index + 1,
      index,
    });
    continue;
  }
  const numbered = line.match(numberedPattern);
  if (numbered) {
    numberedSections.push({
      number: Number(numbered[1]),
      title: numbered[2].trim(),
      line: index + 1,
    });
  }
  const lettered = line.match(letteredPattern);
  if (lettered) {
    letteredSections.push({
      label: lettered[1],
      title: lettered[2].trim(),
      line: index + 1,
    });
  }
}

const occurrences = anchors.map((anchor, position) => {
  const next = anchors[position + 1];
  const endIndex = next?.index ?? lines.length;
  const body = lines.slice(anchor.index, endIndex).join("\n").trimEnd();
  const inferredTitle =
    anchor.title ||
    lines
      .slice(anchor.index + 1, endIndex)
      .map((line) => line.trim())
      .find((line) => line && !/^[▼↘↓→]+$/.test(line)) ||
    "";
  return {
    occurrence: position + 1,
    block: anchor.label,
    title: anchor.title,
    inferredTitle,
    normalizedTitle: normalizeTitle(anchor.title),
    startLine: anchor.line,
    endLine: endIndex,
    lineCount: endIndex - anchor.index,
    contentSha256: hash(body),
  };
});

const groups = new Map();
for (const occurrence of occurrences) {
  const key = `${occurrence.block}|${occurrence.normalizedTitle}|${occurrence.contentSha256}`;
  const group = groups.get(key) ?? {
    key,
    block: occurrence.block,
    normalizedTitle: occurrence.normalizedTitle,
    contentSha256: occurrence.contentSha256,
    occurrences: [],
  };
  group.occurrences.push(occurrence.occurrence);
  groups.set(key, group);
}

const duplicateGroups = [...groups.values()]
  .filter((group) => group.occurrences.length > 1)
  .map((group) => ({
    ...group,
    duplicateCount: group.occurrences.length,
  }));

const inventory = {
  mission: "COREGRID-MISSION-0001",
  artifact: "COREGRID_PHASE_52_SECTION_INVENTORY",
  status: "INVENTORIED_DEDUPLICATION_PENDING_REVIEW",
  source: {
    path: `architecture/${sourceName}`,
    sha256: sourceHash,
    lineCount: lines.length - 1,
    byteLength: Buffer.byteLength(source, "utf8"),
  },
  extractionRules: {
    blockHeader: "BLOCK <number> optionally followed by em dash, equals, or colon",
    blockBoundary: "A block ends immediately before the next block header or EOF",
    exactDuplicate: "same normalized block number/title and body SHA-256",
    preservation: "source is never rewritten by inventory generation",
  },
  summary: {
    blockOccurrences: occurrences.length,
    uniqueBlockBodies: groups.size,
    exactDuplicateGroups: duplicateGroups.length,
    numberedSectionOccurrences: numberedSections.length,
    letteredSectionOccurrences: letteredSections.length,
  },
  blockOccurrences: occurrences,
  exactDuplicateGroups: duplicateGroups,
  numberedSections,
  letteredSections,
  nextGate:
    "Review duplicate groups and overlapping block families before producing canonical per-block extracts.",
};

writeFileSync(outputPath, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      sourceSha256: sourceHash,
      ...inventory.summary,
      output: "architecture/COREGRID_PHASE_52_SECTION_INVENTORY.json",
    },
    null,
    2,
  ),
);
