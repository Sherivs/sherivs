import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const proposals = JSON.parse(
  readFileSync(
    join(root, "architecture", "COREGRID_CAMPAIGN_52_RECEIVING_BLUEPRINT_PROPOSALS.json"),
    "utf8",
  ),
);

const ledger = {
  mission: "COREGRID-MISSION-0001",
  campaign: "CAMPAIGN-52",
  workPackage: "CAMPAIGN-52-WP-01",
  artifact: "COREGRID_CAMPAIGN_52_DECISION_LEDGER",
  status: "PENDING_AUTHORITY",
  version: "1.0.0",
  generatedAt: new Date().toISOString(),
  decisionVocabulary: [
    "PENDING_AUTHORITY",
    "APPROVED_EXISTING_OWNER",
    "APPROVED_NEW_PHASE_PROPOSAL",
    "MAPPED_TO_MOTHER",
    "DOMAIN_RUNTIME",
    "RESEARCH_OR_EXPERIMENTAL",
    "HISTORICAL",
    "REJECTED_WITH_RATIONALE",
    "BLOCKED",
  ],
  authorizationRequirements: [
    "decision authority identity",
    "decision timestamp",
    "source authority reference",
    "rationale",
    "affected owners and consumers",
    "security and tenant impact",
    "failure and recovery impact",
    "evidence and verification plan",
    "registry/mother/blueprint update plan",
  ],
  decisions: proposals.proposals.map((proposal) => ({
    decisionId: `CAMPAIGN-52-DECISION-${proposal.gapId}`,
    gapId: proposal.gapId,
    proposalId: proposal.proposalId,
    extract: proposal.extract,
    title: proposal.sourceTitle,
    proposedCandidatePhases: proposal.candidateReceivingPhases,
    status: "PENDING_AUTHORITY",
    disposition: null,
    approvedOwner: null,
    authorizedBy: null,
    authorityReference: null,
    decisionTimestamp: null,
    rationale: null,
    affectedConsumers: null,
    securityImpact: null,
    failureImpact: null,
    evidencePlan: null,
    verificationPlan: null,
    registryUpdatePlan: null,
    blueprintUpdatePlan: null,
    implementationAuthorization: "DENIED",
  })),
  rule: "A pending decision cannot mutate architecture, registry, mothers, infrastructure or implementation.",
  nextGate: "Record authorized decisions, validate them, then update receiving blueprints.",
};

const output = join(root, "architecture", "COREGRID_CAMPAIGN_52_DECISION_LEDGER.json");
writeFileSync(output, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      decisions: ledger.decisions.length,
      status: ledger.status,
      output: "architecture/COREGRID_CAMPAIGN_52_DECISION_LEDGER.json",
    },
    null,
    2,
  ),
);
