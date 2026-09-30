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
const proposals = JSON.parse(
  readFileSync(
    join(root, "architecture", "COREGRID_CAMPAIGN_52_RECEIVING_BLUEPRINT_PROPOSALS.json"),
    "utf8",
  ),
);

const gapIds = gapRegister.gaps.map((gap) => gap.id);
const proposalIds = proposals.proposals.map((proposal) => proposal.gapId);
const missing = gapIds.filter((id) => !proposalIds.includes(id));
const unexpected = proposalIds.filter((id) => !gapIds.includes(id));
const nonProposalStatuses = proposals.proposals.filter(
  (proposal) => proposal.status !== "PROPOSAL_ONLY_REQUIRES_AUTHORITY",
);
const unauthorized = proposals.proposals.filter(
  (proposal) =>
    proposal.registryMutation !== "NOT_AUTHORIZED" ||
    proposal.implementationStatus !== "BLOCKED" ||
    proposal.infrastructureChange !== "NOT_AUTHORIZED",
);

const result = {
  mission: "COREGRID-MISSION-0001",
  campaign: "CAMPAIGN-52",
  workPackage: "CAMPAIGN-52-WP-01",
  artifact: "COREGRID_CAMPAIGN_52_RECEIVING_PROPOSALS_VERIFICATION",
  status:
    missing.length === 0 &&
    unexpected.length === 0 &&
    nonProposalStatuses.length === 0 &&
    unauthorized.length === 0
      ? "PASS_PROPOSALS_COMPLETE_NOT_AUTHORIZED"
      : "FAIL",
  counts: {
    registeredGaps: gapIds.length,
    proposals: proposalIds.length,
    missing,
    unexpected,
    nonProposalStatuses: nonProposalStatuses.map((proposal) => proposal.proposalId),
    unauthorized: unauthorized.map((proposal) => proposal.proposalId),
  },
  rule: "Proposal completeness does not create ownership or implementation authority.",
};

const output = join(
  root,
  "architecture",
  "COREGRID_CAMPAIGN_52_RECEIVING_PROPOSALS_VERIFICATION.json",
);
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));
if (result.status === "FAIL") process.exit(1);
