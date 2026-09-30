import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const matches = JSON.parse(
  readFileSync(join(root, "architecture", "COREGRID_CAMPAIGN_52_CANDIDATE_MATCHES.json"), "utf8"),
);
const gaps = JSON.parse(
  readFileSync(
    join(root, "architecture", "COREGRID_PHASE_52_UNRESOLVED_GAP_REGISTER.json"),
    "utf8",
  ),
);
const gapById = new Map(gaps.gaps.map((gap) => [gap.id, gap]));

const proposals = matches.matches.map((match) => {
  const gap = gapById.get(match.gapId);
  const candidates = match.candidateMatches.map((candidate) => ({
    phase: candidate.phase,
    name: candidate.name,
    registryStatus: candidate.status,
    score: candidate.score,
    overlappingTokens: candidate.overlap,
    evidence: candidate.evidence,
  }));
  return {
    proposalId: `CAMPAIGN-52-WP-01-P-${match.gapId}`,
    gapId: match.gapId,
    extract: match.extract,
    sourceTitle: match.title,
    status: "PROPOSAL_ONLY_REQUIRES_AUTHORITY",
    proposedDisposition:
      candidates.length > 0
        ? "REVIEW_EXISTING_PHASE_CANDIDATES"
        : "REVIEW_MOTHER_RESEARCH_OR_EXISTING_BOUNDARY",
    candidateReceivingPhases: candidates,
    affectedMother: gap?.affectedArchitecture?.motherSurface ?? null,
    receivingBlueprintWork: [
      "Confirm canonical owner and non-purpose.",
      "Merge unique source content with provenance and supersession links.",
      "Define receiving capability boundaries, dependencies and consumers.",
      "Define contracts, schemas, security, failure, evidence and verification.",
      "Update acceptance criteria and scope-lock record only after approval.",
    ],
    implementationStatus: "BLOCKED",
    registryMutation: "NOT_AUTHORIZED",
    infrastructureChange: "NOT_AUTHORIZED",
    rationale:
      "Candidate matches are deterministic discovery evidence, not architectural authority.",
  };
});

const result = {
  mission: "COREGRID-MISSION-0001",
  campaign: "CAMPAIGN-52",
  workPackage: "CAMPAIGN-52-WP-01",
  artifact: "COREGRID_CAMPAIGN_52_RECEIVING_BLUEPRINT_PROPOSALS",
  status: "PROPOSAL_ONLY_GATE_3_REMAINS_BLOCKED",
  generatedAt: new Date().toISOString(),
  source: [
    "architecture/COREGRID_CAMPAIGN_52_CANDIDATE_MATCHES.json",
    "architecture/COREGRID_PHASE_52_UNRESOLVED_GAP_REGISTER.json",
  ],
  proposals,
};

const jsonOutput = join(
  root,
  "architecture",
  "COREGRID_CAMPAIGN_52_RECEIVING_BLUEPRINT_PROPOSALS.json",
);
writeFileSync(jsonOutput, `${JSON.stringify(result, null, 2)}\n`, "utf8");

const markdown = [
  "# Campaign 52 Receiving Blueprint Proposals",
  "",
  "Status: `PROPOSAL ONLY — GATE 3 REMAINS BLOCKED`",
  "",
  "These proposals identify likely receiving blueprint work from deterministic",
  "candidate matches. They do not assign ownership, update the registry, or",
  "authorize implementation.",
  "",
  ...proposals.flatMap((proposal) => [
    `## ${proposal.proposalId}`,
    "",
    `- Gap: \`${proposal.gapId}\``,
    `- Extract: \`${proposal.extract}\``,
    `- Title: ${proposal.sourceTitle || "UNRESOLVED SOURCE TITLE"}`,
    `- Disposition: \`${proposal.proposedDisposition}\``,
    `- Candidate phases: ${
      proposal.candidateReceivingPhases
        .map((candidate) => `${candidate.phase} (${candidate.name})`)
        .join(", ") || "none"
    }`,
    "- Required work:",
    ...proposal.receivingBlueprintWork.map((item) => `  - ${item}`),
    "- Implementation: `BLOCKED`",
    "- Registry mutation: `NOT AUTHORIZED`",
    "",
  ]),
  "## Exit condition",
  "",
  "A proposal becomes active only after an authoritative ownership decision,",
  "receiving-blueprint review, acceptance criteria, and verification plan.",
].join("\n");
const markdownOutput = join(
  root,
  "architecture",
  "COREGRID_CAMPAIGN_52_RECEIVING_BLUEPRINT_PROPOSALS.md",
);
writeFileSync(markdownOutput, `${markdown}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      proposals: proposals.length,
      json: "architecture/COREGRID_CAMPAIGN_52_RECEIVING_BLUEPRINT_PROPOSALS.json",
      markdown: "architecture/COREGRID_CAMPAIGN_52_RECEIVING_BLUEPRINT_PROPOSALS.md",
      status: result.status,
    },
    null,
    2,
  ),
);
