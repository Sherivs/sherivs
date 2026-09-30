import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const ledgerPath = join(root, "architecture", "COREGRID_CAMPAIGN_52_DECISION_LEDGER.json");
const logPath = join(root, "architecture", "COREGRID_CAMPAIGN_52_AUTHORITY_DECISION_LOG.md");
const backupPath = join(
  root,
  "architecture",
  "COREGRID_CAMPAIGN_52_DECISION_LEDGER_PRE_RECOMMENDED_BATCH.json",
);

const batchReference = "USER_BATCH_AUTHORIZATION_CHAT_2026-09-28";
const authorizedBy = "USER_AUTHORITY_VIA_CURSOR_CHAT";
const decisionTimestamp = "2026-09-28";

const recommendations = {
  "CG-P52-GAP-020": {
    owner: "COREGRID.md / ARCHITECTURE.md / ECOSYSTEM.md",
    rationale: "Strategy and positioning material is not a phase-owned capability.",
    consumers: ["CoreGrid architecture", "Ecosystem strategy"],
    security:
      "No security or runtime boundary changes; strategy remains subordinate to governance.",
    failure: "Strategic claims cannot be promoted to implementation or operational truth.",
    evidence: ["Review the complete blue-ocean strategy extract and mother documents."],
    verification: ["Confirm no phase or implementation claim is introduced."],
    blueprint: "Record as strategy context with source provenance.",
  },
  "CG-P52-GAP-021": {
    owner: "Phase 24 Experience & Design Intelligence / Phase 50 Human Interface",
    rationale:
      "Experience formula material belongs to existing experience and interface boundaries.",
    consumers: ["Phase 24", "Phase 50", "Phase 23 Web Platform"],
    security: "Experience remains an authorized projection and cannot expand authorization.",
    failure: "Projection failures must remain distinguishable from canonical reality or state.",
    evidence: ["Review the complete experience formula extract and Phase 24/50 contracts."],
    verification: ["Run experience, accessibility and projection conformance checks."],
    blueprint: "Reconcile into existing experience/interface blueprint sections.",
  },
  "CG-P52-GAP-022": {
    owner: "REALITY.md / MISSIONS.md / ASSURANCE.md",
    rationale:
      "The complete reality loop is a cross-cutting architectural quality model, not a new phase.",
    consumers: ["Reality kernel", "Mission system", "Assurance system"],
    security: "Each transition remains subject to identity, tenant and authorization laws.",
    failure: "Unobserved, unverifiable or failed transitions must remain explicit.",
    evidence: ["Compare the extract with the reality ontology, mission and assurance artifacts."],
    verification: ["Trace each loop edge to an existing contract and evidence requirement."],
    blueprint: "Record as cross-cutting architecture and assurance law.",
  },
  "CG-P52-GAP-023": {
    owner: "ENGINEERING.md / MISSIONS.md",
    rationale: "Implementation order is engineering and mission sequencing guidance, not a phase.",
    consumers: ["Mission 0001", "Foundation Mission 001"],
    security: "Sequencing cannot bypass authority, security or verification gates.",
    failure: "Dependency failure must block progression rather than trigger blind retries.",
    evidence: ["Compare the implementation-order extract with the approved mission plan."],
    verification: ["Validate dependency ordering and gate prerequisites."],
    blueprint: "Record as engineering/mission sequencing law.",
  },
  "CG-P52-GAP-024": {
    owner: "MISSIONS.md / COREGRID_FIRST_MISSION_DEFINITION",
    rationale:
      "The proposed first product is a mission-selection question already governed by Foundation Mission 001.",
    consumers: ["Mission 0001", "Foundation Mission 001"],
    security: "No implementation authority is created by product-strategy text.",
    failure: "The foundation choice remains blocked if ownership or contracts are unresolved.",
    evidence: ["Compare the extract with the first mission definition and runtime readiness."],
    verification: ["Confirm the selected foundation mission is evidence-backed and bounded."],
    blueprint: "Preserve as mission rationale and reconcile with Foundation Mission 001.",
  },
  "CG-P52-GAP-025": {
    owner: "ARCHITECTURE.md / REGISTRY.md / CONTROL-PLANE-01-REGISTRY.md",
    rationale: "55-Phase Architectural Binding is a governance/registry artifact, not a new phase.",
    consumers: ["Phase registry", "Ownership graph", "Control-plane registry"],
    security:
      "Registry changes require explicit governance and must not grant implementation authority.",
    failure: "Conflicting bindings remain visible and block silent registry mutation.",
    evidence: ["Review source-linked extract p52-block-17-occurrence-225."],
    verification: ["Compare with registry, phase reconciliation and authority maps."],
    blueprint: "Record as registry-governance source material.",
  },
  "CG-P52-GAP-026": {
    owner: "ARCHITECTURE.md / REGISTRY.md / CONTROL-PLANE-01-REGISTRY.md",
    rationale:
      "Repeated 55-Phase Architectural Binding material remains registry/governance evidence.",
    consumers: ["Phase registry", "Ownership graph", "Control-plane registry"],
    security: "No registry or permission change follows from a duplicate binding extract.",
    failure: "Conflicting or repeated binding claims remain traceable.",
    evidence: ["Review source-linked extract p52-block-17-occurrence-254."],
    verification: ["Compare duplicate binding against the decomposition map and registry."],
    blueprint: "Record as registry-governance source material.",
  },
  "CG-P52-GAP-027": {
    owner: "ARCHITECTURE.md / REGISTRY.md / CONTROL-PLANE-01-REGISTRY.md",
    rationale:
      "Repeated 55-Phase Architectural Binding material remains registry/governance evidence.",
    consumers: ["Phase registry", "Ownership graph", "Control-plane registry"],
    security: "No registry or permission change follows from a duplicate binding extract.",
    failure: "Conflicting or repeated binding claims remain traceable.",
    evidence: ["Review source-linked extract p52-block-17-occurrence-276."],
    verification: ["Compare duplicate binding against the decomposition map and registry."],
    blueprint: "Record as registry-governance source material.",
  },
};

const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
copyFileSync(ledgerPath, backupPath);

const now = new Set();
for (const decision of ledger.decisions) {
  const recommendation = recommendations[decision.gapId];
  if (!recommendation || decision.status !== "PENDING_AUTHORITY") continue;
  decision.status = "MAPPED_TO_MOTHER";
  decision.disposition = "MAPPED_TO_MOTHER";
  decision.approvedOwner = recommendation.owner;
  decision.authorizedBy = authorizedBy;
  decision.authorityReference = batchReference;
  decision.decisionTimestamp = decisionTimestamp;
  decision.rationale = recommendation.rationale;
  decision.affectedConsumers = recommendation.consumers;
  decision.securityImpact = recommendation.security;
  decision.failureImpact = recommendation.failure;
  decision.evidencePlan = recommendation.evidence;
  decision.verificationPlan = recommendation.verification;
  decision.registryUpdatePlan = "NONE; existing authorities retained";
  decision.blueprintUpdatePlan = recommendation.blueprint;
  decision.implementationAuthorization = "DENIED";
  now.add(decision.gapId);
}

writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");

const log = [
  "",
  "## Decision Batch 2026-09-28 — Clear Existing Authority Mappings",
  "",
  `Authority reference: \`${batchReference}\``,
  "",
  `Applied ${now.size} clear existing-authority mappings under the user's explicit batch authorization. No new phases, registry mutation or implementation authorization was created.`,
  "",
  ...[...now].map((gapId) => `- \`${gapId}\` → \`${recommendations[gapId].owner}\``),
  "",
  "Ambiguous items remain pending or blocked and require individual review.",
  "",
].join("\n");
const existingLog = readFileSync(logPath, "utf8");
writeFileSync(logPath, `${existingLog.trimEnd()}\n${log}`, "utf8");

console.log(
  JSON.stringify(
    {
      applied: now.size,
      backup: "architecture/COREGRID_CAMPAIGN_52_DECISION_LEDGER_PRE_RECOMMENDED_BATCH.json",
      remainingPending: ledger.decisions.filter(
        (decision) => decision.status === "PENDING_AUTHORITY",
      ).length,
      remainingBlocked: ledger.decisions.filter((decision) => decision.status === "BLOCKED").length,
    },
    null,
    2,
  ),
);
