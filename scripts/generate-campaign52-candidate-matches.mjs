import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const registry = JSON.parse(readFileSync(join(root, "architecture", "registry.json"), "utf8"));
const gaps = JSON.parse(
  readFileSync(
    join(root, "architecture", "COREGRID_PHASE_52_UNRESOLVED_GAP_REGISTER.json"),
    "utf8",
  ),
);

const stopWords = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "coregrid",
  "universal",
  "engine",
  "system",
  "architecture",
  "fabric",
  "model",
  "phase",
]);

function tokens(value) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2 && !stopWords.has(token)),
  );
}

const phaseCandidates = registry.phases.map((phase) => {
  const capabilityText = registry.capabilities
    .filter((capability) => capability.owner === phase.id)
    .map((capability) => capability.capability)
    .join(" ");
  return {
    phase: phase.id,
    name: phase.name,
    status: phase.status,
    tokens: tokens(`${phase.name} ${capabilityText}`),
    evidence: {
      registry: "architecture/registry.json",
      phase: phase.id,
      capabilityText,
    },
  };
});

const matches = gaps.gaps.map((gap) => {
  const titleTokens = tokens(gap.evidence.title);
  const scored = phaseCandidates
    .map((candidate) => {
      const overlap = [...titleTokens].filter((token) => candidate.tokens.has(token));
      return {
        phase: candidate.phase,
        name: candidate.name,
        status: candidate.status,
        overlap,
        score: overlap.length,
        evidence: candidate.evidence,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.phase.localeCompare(right.phase))
    .slice(0, 3);
  return {
    gapId: gap.id,
    extract: gap.evidence.artifactId,
    title: gap.evidence.title,
    candidateMatches: scored,
    status: "PROPOSAL_REQUIRES_HUMAN_OR_GOVERNANCE_REVIEW",
    rule: "Token overlap is discovery evidence, not ownership authority.",
  };
});

const result = {
  mission: "COREGRID-MISSION-0001",
  campaign: "CAMPAIGN-52",
  workPackage: "CAMPAIGN-52-WP-01",
  artifact: "COREGRID_CAMPAIGN_52_CANDIDATE_MATCHES",
  status: "NON_AUTHORITATIVE_CANDIDATE_ANALYSIS",
  generatedAt: new Date().toISOString(),
  method:
    "Deterministic token overlap between unresolved extract titles and existing registry phase/capability names.",
  matches,
  prohibitedUse: [
    "Do not update phase ownership from this artifact alone.",
    "Do not register a new phase from this artifact.",
    "Do not implement a candidate match without governance and contract evidence.",
  ],
};

const output = join(root, "architecture", "COREGRID_CAMPAIGN_52_CANDIDATE_MATCHES.json");
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      gaps: matches.length,
      output: "architecture/COREGRID_CAMPAIGN_52_CANDIDATE_MATCHES.json",
      status: result.status,
    },
    null,
    2,
  ),
);
