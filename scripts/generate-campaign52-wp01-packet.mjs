import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const gapRegister = JSON.parse(
  readFileSync(
    join(root, "architecture", "COREGRID_PHASE_52_UNRESOLVED_GAP_REGISTER.json"),
    "utf8",
  ),
);
const decomposition = JSON.parse(
  readFileSync(join(root, "architecture", "COREGRID_PHASE_52_DECOMPOSITION_MAP.json"), "utf8"),
);

const extracts = new Map(decomposition.extracts.map((extract) => [extract.artifactId, extract]));
const lines = [
  "# CAMPAIGN-52-WP-01 — Ownership Decision Packet",
  "",
  "Mission: `COREGRID-MISSION-0001`  ",
  "Campaign: `CAMPAIGN-52`  ",
  "Work package: `CAMPAIGN-52-WP-01`  ",
  "Status: `PROPOSED / DECISION REQUIRED`  ",
  "Generated: `2026-09-28`",
  "",
  "## Objective",
  "",
  "Resolve the ownership disposition of every unresolved Phase 52 extract",
  "without creating new phases, mothers, services or infrastructure by",
  "inference. This packet is a governance input, not an authorization record.",
  "",
  "## Decision procedure",
  "",
  "For each item:",
  "",
  "```text",
  "READ SOURCE EXTRACT",
  "→ COMPARE EXISTING MOTHERS AND PHASES",
  "→ CHECK CAPABILITY DUPLICATION",
  "→ CHECK IMPLEMENTATION AND CONSUMERS",
  "→ CHECK SECURITY / TENANT / STATE BOUNDARIES",
  "→ CHECK FAILURE / EVIDENCE / VERIFICATION REQUIREMENTS",
  "→ SELECT EXISTING OWNER OR PROPOSE NEW PHASE",
  "→ RECORD RATIONALE AND PROVENANCE",
  "→ DEFINE RECEIVING BLUEPRINT CHANGES",
  "→ AUTHORIZE OR BLOCK",
  "```",
  "",
  "Allowed dispositions:",
  "`MAPPED_TO_CANONICAL_MOTHER`, `MAPPED_TO_EXISTING_PHASE`,",
  "`MAPPED_TO_NEW_GOVERNED_PHASE`, `DOMAIN_RUNTIME`, `SHARED_CONTRACT`,",
  "`IMPLEMENTATION_ARTIFACT`, `OPERATIONAL_ARTIFACT`, `RESEARCH_OR_EXPERIMENTAL`,",
  "`HISTORICAL`, `REJECTED_WITH_RATIONALE`, `UNRESOLVED`, `BLOCKED`.",
  "",
  "## Work items",
  "",
];

for (const gap of gapRegister.gaps) {
  const extract = extracts.get(gap.evidence?.artifactId);
  lines.push(`### ${gap.id} — ${gap.evidence?.title ?? gap.description}`);
  lines.push("");
  lines.push(`- Extract: \`${gap.evidence?.artifactId ?? "UNKNOWN"}\``);
  lines.push(`- Block: \`${gap.evidence?.block ?? "UNKNOWN"}\``);
  lines.push(`- Classification: \`${gap.evidence?.classification ?? "UNKNOWN"}\``);
  lines.push(`- Source: \`${gap.source?.[0] ?? "UNKNOWN"}\``);
  lines.push(`- Source lines: \`${gap.evidence?.sourceLines?.join("-") ?? "UNKNOWN"}\``);
  lines.push(`- Severity: \`${gap.severity}\``);
  lines.push(
    `- Current candidate mother: \`${gap.affectedArchitecture?.motherSurface ?? "UNRESOLVED"}\``,
  );
  lines.push(
    `- Current candidate phase: \`${gap.affectedArchitecture?.candidatePhaseOwner ?? "UNRESOLVED"}\``,
  );
  lines.push(`- Extract path: \`${extract?.extract ?? "UNRESOLVED"}\``);
  lines.push("");
  lines.push("Decision record:");
  lines.push("- Disposition: `UNRESOLVED`");
  lines.push("- Approved owner: `UNRESOLVED`");
  lines.push("- Governing authority: `UNRESOLVED`");
  lines.push("- Rationale: `REQUIRED`");
  lines.push("- Affected consumers/providers: `REQUIRED`");
  lines.push("- Contract/schema/security impact: `REQUIRED`");
  lines.push("- Failure/evidence/verification impact: `REQUIRED`");
  lines.push("- Receiving blueprint: `REQUIRED`");
  lines.push("- Verification evidence: `REQUIRED`");
  lines.push("");
}

lines.push("## Work package exit criteria");
lines.push("");
lines.push("WP-01 may close only when:");
lines.push("");
lines.push("1. Every item has an explicit disposition.");
lines.push("2. Every approved owner is canonical or governed as a new proposal.");
lines.push("3. All conflicts and rejected interpretations preserve provenance.");
lines.push("4. Receiving blueprints identify required scope changes.");
lines.push("5. No implementation begins for unresolved items.");
lines.push("6. Registry and dependency updates are separately authorized.");
lines.push("7. A verification plan exists for each approved ownership decision.");

const output = join(
  root,
  "architecture",
  "COREGRID_CAMPAIGN_52_WP_01_OWNERSHIP_DECISION_PACKET.md",
);
writeFileSync(output, `${lines.join("\n")}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      workItems: gapRegister.gaps.length,
      output: "architecture/COREGRID_CAMPAIGN_52_WP_01_OWNERSHIP_DECISION_PACKET.md",
    },
    null,
    2,
  ),
);
