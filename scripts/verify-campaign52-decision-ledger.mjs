import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const ledger = JSON.parse(
  readFileSync(join(root, "architecture", "COREGRID_CAMPAIGN_52_DECISION_LEDGER.json"), "utf8"),
);
const requiredFields = [
  "status",
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
const invalidPending = ledger.decisions.filter((decision) => {
  if (decision.status !== "PENDING_AUTHORITY") return false;
  return requiredFields.some((field) =>
    field === "status" ? decision[field] !== "PENDING_AUTHORITY" : decision[field] !== null,
  );
});
const unauthorizedImplementation = ledger.decisions.filter(
  (decision) => decision.implementationAuthorization !== "DENIED",
);
const pendingCount = ledger.decisions.filter(
  (decision) => decision.status === "PENDING_AUTHORITY",
).length;
const blockedCount = ledger.decisions.filter((decision) => decision.status === "BLOCKED").length;

const result = {
  mission: ledger.mission,
  campaign: ledger.campaign,
  workPackage: ledger.workPackage,
  artifact: "COREGRID_CAMPAIGN_52_DECISION_LEDGER_VERIFICATION",
  status:
    invalidPending.length > 0 ||
    unauthorizedImplementation.length > 0 ||
    ledger.decisions.length !== 27
      ? "FAIL"
      : pendingCount > 0
        ? "PASS_PENDING_AUTHORITY"
        : blockedCount > 0
          ? "PASS_DECISIONS_RECORDED_WITH_BLOCKERS"
          : "PASS_ALL_DECISIONS_RECORDED",
  decisionCount: ledger.decisions.length,
  pendingCount,
  blockedCount,
  invalidPending: invalidPending.map((decision) => decision.decisionId),
  unauthorizedImplementation: unauthorizedImplementation.map((decision) => decision.decisionId),
  rule: ledger.rule,
};

const output = join(root, "architecture", "COREGRID_CAMPAIGN_52_DECISION_LEDGER_VERIFICATION.json");
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));
if (result.status === "FAIL") process.exit(1);
