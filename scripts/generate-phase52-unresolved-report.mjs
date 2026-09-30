import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const map = JSON.parse(
  readFileSync(join(root, "architecture", "COREGRID_PHASE_52_DECOMPOSITION_MAP.json"), "utf8"),
);
const catalog = JSON.parse(
  readFileSync(join(root, "architecture", "COREGRID_PHASE_52_CAPABILITY_CATALOG.json"), "utf8"),
);
const catalogByName = new Map(
  catalog.capabilities.map((capability) => [capability.name.toLowerCase(), capability]),
);

const groups = new Map();
for (const unresolved of map.unresolved) {
  const key = unresolved.block;
  const group = groups.get(key) ?? {
    block: unresolved.block,
    titles: [],
    extracts: [],
    classifications: new Set(),
  };
  group.titles.push(unresolved.title);
  group.extracts.push(unresolved.artifactId);
  group.classifications.add(unresolved.classification);
  groups.set(key, group);
}

const lines = [
  "# Phase 52 Unresolved Ownership Review",
  "",
  "Mission: `COREGRID-MISSION-0001`  ",
  "Status: `BLOCKED / REVIEW_REQUIRED`  ",
  "Source: `architecture/COREGRID_PHASE_52_DECOMPOSITION_MAP.json`",
  "",
  "This report is generated from the deterministic Phase 52 extraction. It",
  "does not authorize a new phase, mother surface, implementation, or",
  "infrastructure. Unresolved extracts remain evidence requiring governance.",
  "",
  "## Corpus facts",
  "",
  `- Extracted occurrences: ${map.extraction.occurrences}`,
  `- Exact duplicate groups: ${map.extraction.exactDuplicateGroups}`,
  `- Unresolved routed occurrences: ${map.unresolved.length}`,
  `- Source SHA-256: ${map.source.sha256}`,
  "",
  "## Review law",
  "",
  "Each unresolved item must pass:",
  "",
  "```text",
  "EXTRACT",
  "→ COMPARE EXISTING OWNERS",
  "→ CLASSIFY DUPLICATION",
  "→ IDENTIFY CANONICAL MOTHER",
  "→ DEFINE PHASE OWNER OR JUSTIFY NO NEW PHASE",
  "→ DEFINE CONTRACT / SECURITY / FAILURE / EVIDENCE / VERIFICATION",
  "→ GOVERNANCE DECISION",
  "→ SCOPE LOCK",
  "```",
  "",
  "## Unresolved groups",
  "",
];

for (const group of groups.values()) {
  lines.push(`### Block ${group.block}`);
  lines.push("");
  lines.push(`Classifications: ${[...group.classifications].join(", ")}`);
  lines.push("");
  lines.push("Extracts:");
  for (const extract of group.extracts) lines.push(`- \`${extract}\``);
  lines.push("");
  lines.push("Titles:");
  for (const title of group.titles) lines.push(`- ${title}`);
  const related = [...catalogByName.entries()].find(([name]) =>
    group.titles.some((title) => name.includes(title.toLowerCase())),
  )?.[1];
  if (related) {
    lines.push("");
    lines.push(`Related catalog capability: \`${related.id}\``);
    lines.push(`Existing owners: ${related.existingOwners.join(", ")}`);
    lines.push(`Catalog decision: ${related.decision}`);
  }
  lines.push("");
  lines.push("Decision state: `UNRESOLVED — preserve extract and open ownership review`");
  lines.push("");
}

lines.push("## Explicit prohibitions");
lines.push("");
lines.push("- Do not register Phase 52.");
lines.push("- Do not create a mother surface per extract.");
lines.push("- Do not infer implementation from blueprint text.");
lines.push(
  "- Do not install graph, vector, queue, simulation, or runtime-generator infrastructure.",
);
lines.push("- Do not move Scholar concepts into universal ownership without evidence.");
lines.push("");
lines.push("## Next mission");
lines.push("");
lines.push(
  "Create a bounded ownership-decision mission for the unresolved groups, beginning with the highest-risk evidence/provenance, spatial, and cross-phase duplication boundaries.",
);

const output = join(root, "architecture", "COREGRID_PHASE_52_UNRESOLVED_OWNERSHIP_REVIEW.md");
writeFileSync(output, `${lines.join("\n")}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      groups: groups.size,
      unresolved: map.unresolved.length,
      output: "architecture/COREGRID_PHASE_52_UNRESOLVED_OWNERSHIP_REVIEW.md",
    },
    null,
    2,
  ),
);
