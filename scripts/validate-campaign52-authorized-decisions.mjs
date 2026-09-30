import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const ledger = JSON.parse(
  readFileSync(join(root, "architecture", "COREGRID_CAMPAIGN_52_DECISION_LEDGER.json"), "utf8"),
);

const allowedStatuses = new Set([
  "PENDING_AUTHORITY",
  "APPROVED_EXISTING_OWNER",
  "APPROVED_NEW_PHASE_PROPOSAL",
  "MAPPED_TO_MOTHER",
  "DOMAIN_RUNTIME",
  "RESEARCH_OR_EXPERIMENTAL",
  "HISTORICAL",
  "REJECTED_WITH_RATIONALE",
  "BLOCKED",
]);
const requiredForApproved = [
  "disposition",
  "approvedOwner",
  "authorizedBy",
  "authorityReference",
  "decisionTimestamp",
  "rationale",
  "evidencePlan",
  "verificationPlan",
  "registryUpdatePlan",
  "blueprintUpdatePlan",
];

const findings = [];
for (const decision of ledger.decisions) {
  if (!allowedStatuses.has(decision.status)) {
    findings.push(`${decision.decisionId}: unknown status ${decision.status}`);
  }
  if (decision.status === "PENDING_AUTHORITY") {
    if (decision.implementationAuthorization !== "DENIED") {
      findings.push(`${decision.decisionId}: pending decision authorizes implementation`);
    }
    continue;
  }
  for (const field of requiredForApproved) {
    if (decision[field] === null || decision[field] === undefined || decision[field] === "") {
      findings.push(`${decision.decisionId}: missing authorized field ${field}`);
    }
  }
  if (decision.status === "APPROVED_NEW_PHASE_PROPOSAL") {
    if (!decision.approvedOwner || !decision.registryUpdatePlan) {
      findings.push(`${decision.decisionId}: new-phase proposal requires owner and registry plan`);
    }
  }
}

const result = {
  mission: ledger.mission,
  campaign: ledger.campaign,
  artifact: "COREGRID_CAMPAIGN_52_AUTHORIZED_DECISION_VALIDATION",
  status: findings.length === 0 ? "PASS_NO_INVALID_DECISIONS" : "FAIL",
  decisionCount: ledger.decisions.length,
  findings,
  mutation: "NONE",
  rule: "Validation does not apply decisions or mutate architecture.",
};
console.log(JSON.stringify(result, null, 2));
if (findings.length > 0) process.exit(1);
