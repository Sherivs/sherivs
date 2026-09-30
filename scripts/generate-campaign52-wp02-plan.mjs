import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const ledger = JSON.parse(
  readFileSync(join(root, "architecture", "COREGRID_CAMPAIGN_52_DECISION_LEDGER.json"), "utf8"),
);

const mapped = ledger.decisions
  .filter((decision) => decision.status === "MAPPED_TO_MOTHER")
  .map((decision) => ({
    workItemId: `CAMPAIGN-52-WP-02-${decision.gapId}`,
    decisionId: decision.decisionId,
    gapId: decision.gapId,
    title: decision.title,
    approvedOwner: decision.approvedOwner,
    disposition: decision.disposition,
    receivingBlueprintWork: decision.blueprintUpdatePlan,
    evidencePlan: decision.evidencePlan,
    verificationPlan: decision.verificationPlan,
    status: "READY_FOR_SCOPE_REVIEW",
    implementationAuthorization: "DENIED",
    exclusions: [
      "No new phase registration",
      "No new mother document",
      "No runtime implementation",
      "No registry mutation unless separately authorized by blueprint reconciliation",
      "No changes to blocked items",
    ],
  }));

const blocked = ledger.decisions
  .filter((decision) => decision.status === "BLOCKED")
  .map((decision) => ({
    gapId: decision.gapId,
    title: decision.title,
    owner: decision.approvedOwner,
    status: "EXCLUDED_FROM_WP02",
  }));

const plan = {
  mission: ledger.mission,
  campaign: ledger.campaign,
  workPackage: "CAMPAIGN-52-WP-02",
  artifact: "COREGRID_CAMPAIGN_52_WP_02_RECEIVING_BLUEPRINT_PLAN",
  status: "READY_FOR_SCOPE_REVIEW",
  generatedAt: new Date().toISOString(),
  objective:
    "Reconcile approved Phase 52 mappings into receiving mothers and existing blueprints without implementing blocked or unverified capabilities.",
  mappedCount: mapped.length,
  blockedCount: blocked.length,
  mapped,
  excludedBlockedItems: blocked,
  gates: [
    "Confirm receiving blueprint boundary and non-purpose.",
    "Merge source content with provenance and supersession links.",
    "Define contract, security, failure, evidence and verification deltas.",
    "Update scope map and acceptance criteria without claiming implementation.",
    "Run architecture and duplicate scans.",
  ],
  nextGate:
    "Scope review and receiving-blueprint evidence before any registry or implementation mutation.",
};

const output = join(
  root,
  "architecture",
  "COREGRID_CAMPAIGN_52_WP_02_RECEIVING_BLUEPRINT_PLAN.json",
);
writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      mapped: mapped.length,
      blockedExcluded: blocked.length,
      output: "architecture/COREGRID_CAMPAIGN_52_WP_02_RECEIVING_BLUEPRINT_PLAN.json",
    },
    null,
    2,
  ),
);
