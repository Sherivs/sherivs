#!/usr/bin/env node
/**
 * Campaign-52 WP-02 receiving reconciliation.
 *
 * Records the 19 ledger mappings against source extracts and updates the
 * Phase 52 gap register. It does not register a phase, mutate the registry,
 * or authorize runtime implementation. Blocked ledger items stay blocked.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const architecture = join(root, "architecture");

const ledger = JSON.parse(
  readFileSync(join(architecture, "COREGRID_CAMPAIGN_52_DECISION_LEDGER.json"), "utf8"),
);
const gaps = JSON.parse(
  readFileSync(join(architecture, "COREGRID_PHASE_52_UNRESOLVED_GAP_REGISTER.json"), "utf8"),
);
const plan = JSON.parse(
  readFileSync(
    join(architecture, "COREGRID_CAMPAIGN_52_WP_02_RECEIVING_BLUEPRINT_PLAN.json"),
    "utf8",
  ),
);

const principles = {
  "CG-P52-GAP-007": {
    principle: "The universal CoreGrid application shell comes before additional domain runtimes.",
    nonPurpose:
      "The named home surfaces are product intent. They do not authorize a new shell phase; COREGRID GLOBAL SHELL remains blocked.",
  },
  "CG-P52-GAP-009": {
    principle:
      "One identity may participate in many realities. CoreGrid switches active context and does not replace identity.",
    nonPurpose: "This does not create a reality phase or grant cross-reality access.",
  },
  "CG-P52-GAP-010": {
    principle:
      "An organization switch must verify membership, role, authority, domain, and organization reality before experience is loaded. A client organization id is not access.",
    nonPurpose: "This does not authorize a new context store or bypass existing authorization.",
  },
  "CG-P52-GAP-011": {
    principle:
      "Personal reality and organizational reality stay separated. Cross-context access requires identity, membership, permission, purpose, policy, and consent where applicable.",
    nonPurpose: "This does not create a new data platform or infer consent.",
  },
  "CG-P52-GAP-012": {
    principle:
      "Application structure should share contracts across web, mobile, and admin surfaces.",
    nonPurpose:
      "The proposed directory tree is source design. It does not authorize a repository migration or new packages.",
  },
  "CG-P52-GAP-013": {
    principle:
      "Web and mobile clients share domain contracts, identity, authorization, ontology, and experience definitions, while native capabilities stay local.",
    nonPurpose: "This does not create a third platform phase or claim mobile runtime completion.",
  },
  "CG-P52-GAP-014": {
    principle:
      "Experience and engine construction follow a locked sequence. Engines are not the first build.",
    nonPurpose: "The extract stages do not override Mission 0001 gates or authorize those engines.",
  },
  "CG-P52-GAP-015": {
    principle:
      "A domain runtime is a package of ontology, entities, workflows, policy, experience, and extension points, not a disconnected application.",
    nonPurpose:
      "Listing package facets does not instantiate them. Scholar remains the existing domain runtime.",
  },
  "CG-P52-GAP-016": {
    principle:
      "CoreGrid does not need every domain prebuilt. Unknown domains are discovered, validated, and only then eligible to become packages.",
    nonPurpose: "Discovery and AI proposal are not canonical domain truth.",
  },
  "CG-P52-GAP-017": {
    principle:
      "An SDK economy is a governed flywheel of validated capability, publication, installation, use, and compensation.",
    nonPurpose:
      "The flywheel does not authorize billing, marketplace publication, or the blocked developer-platform gaps.",
  },
  "CG-P52-GAP-018": {
    principle:
      "Users, organizations, and developers meet on one platform, with different installation and distribution surfaces.",
    nonPurpose:
      "This composition does not resolve the blocked developer marketplace or authorize live installation.",
  },
  "CG-P52-GAP-020": {
    principle:
      "Durability comes from reinforcing ontology, reality, events, agents, experience, domain packages, and economy layers.",
    nonPurpose:
      "Strategy context does not register those layers as new capabilities or claim they are operational.",
  },
  "CG-P52-GAP-021": {
    principle:
      "Experience is a composition of domain invariants, organization reality, role, authority, current state, and objectives.",
    nonPurpose: "The formula is not an executable experience compiler.",
  },
  "CG-P52-GAP-022": {
    principle:
      "The reality loop connects earth, organizations, people, ontology, events, knowledge, decisions, and outcomes.",
    nonPurpose:
      "The diagram does not prove any loop edge. Each edge still needs its own contract and evidence.",
  },
  "CG-P52-GAP-023": {
    principle:
      "Implementation proceeds in locked blocks. The whole civilization is not coded at once.",
    nonPurpose:
      "The extract block list is historical sequencing advice. It is subordinate to Mission 0001 and does not authorize new shells or infrastructure.",
  },
  "CG-P52-GAP-024": {
    principle:
      "The first visible product is the universal CoreGrid experience, not a domain vertical such as school, hotel, or marketplace.",
    nonPurpose:
      "The screen sketch is mission rationale beside Foundation Mission 001. That mission remains unauthorized.",
  },
  "CG-P52-GAP-025": {
    principle: "Heading-only source material names a 55-phase architectural binding.",
    nonPurpose:
      "It does not expand the canonical registry beyond 51 phases and does not register Phase 52.",
  },
  "CG-P52-GAP-026": {
    principle:
      "Duplicate heading-only binding. Provenance is preserved separately from occurrence 225.",
    nonPurpose: "Duplicate wording is not additional phase authority.",
  },
  "CG-P52-GAP-027": {
    principle:
      "Duplicate heading-only binding. Provenance is preserved separately from occurrences 225 and 254.",
    nonPurpose: "Duplicate wording is not additional phase authority.",
  },
};

function extractIdentity(gap) {
  const match = gap.description.match(/p52-block-(\d+)-occurrence-(\d+)/);
  if (!match) throw new Error(`${gap.id}: extract identity missing`);
  return {
    artifactId: `p52-block-${match[1]}-occurrence-${match[2]}`,
    path: `architecture/phase-52-extracts/block-${match[1]}-occurrence-${match[2]}.md`,
  };
}

const gapById = new Map(gaps.gaps.map((gap) => [gap.id, gap]));
const records = [];

for (const decision of ledger.decisions) {
  const gap = gapById.get(decision.gapId);
  if (!gap) throw new Error(`ledger gap missing from register: ${decision.gapId}`);
  if (decision.status === "BLOCKED") {
    if (gap.status !== "BLOCKED") {
      throw new Error(`${gap.id}: blocked ledger item is ${gap.status} in the register`);
    }
    continue;
  }
  if (decision.status !== "MAPPED_TO_MOTHER") {
    throw new Error(`${decision.gapId}: unexpected status ${decision.status}`);
  }
  const note = principles[decision.gapId];
  if (!note) throw new Error(`${decision.gapId}: missing reconciliation principle`);
  const identity = extractIdentity(gap);
  const extract = readFileSync(join(root, identity.path), "utf8");
  const hashLine = extract.match(/^content_sha256: ([A-F0-9]+)$/m);
  if (!hashLine || hashLine[1] !== gap.evidence.contentSha256) {
    throw new Error(`${decision.gapId}: extract hash does not match gap register`);
  }
  if (!extract.includes(gap.evidence.title)) {
    throw new Error(`${decision.gapId}: extract title missing`);
  }
  const planItem = plan.mapped.find((item) => item.gapId === decision.gapId);
  records.push({
    gapId: decision.gapId,
    decisionId: decision.decisionId,
    title: gap.evidence.title,
    extract: identity.path,
    artifactId: identity.artifactId,
    contentSha256: gap.evidence.contentSha256,
    approvedOwner: decision.approvedOwner,
    disposition: "MAPPED_TO_MOTHER",
    principle: note.principle,
    nonPurpose: note.nonPurpose,
    stalePlanExtract: planItem?.evidencePlan ?? [],
    implementationAuthorization: "DENIED",
    registryMutation: "NONE",
    contractDelta: "NONE",
  });

  gap.status = "PARTIAL";
  gap.owner = decision.approvedOwner;
  gap.disposition = "MAPPED_TO_MOTHER";
  gap.implementationAuthorization = "DENIED";
  gap.description =
    `Phase 52 extract ${identity.artifactId} is mapped to ${decision.approvedOwner}. ` +
    "Scope is recorded. Runtime implementation remains denied.";
  gap.affectedArchitecture.motherSurface = decision.approvedOwner.split("/")[0].trim();
  gap.reconciliation = "architecture/COREGRID_CAMPAIGN_52_WP_02_RECEIVING_RECONCILIATION.json";
}

if (records.length !== 19) throw new Error(`expected 19 mapped records, got ${records.length}`);
const blockedRemaining = gaps.gaps.filter((gap) => gap.status === "BLOCKED").length;
if (blockedRemaining !== 8) {
  throw new Error(`expected 8 blocked gaps, got ${blockedRemaining}`);
}

const reconciliation = {
  mission: "COREGRID-MISSION-0001",
  campaign: "CAMPAIGN-52",
  workPackage: "CAMPAIGN-52-WP-02",
  artifact: "COREGRID_CAMPAIGN_52_WP_02_RECEIVING_RECONCILIATION",
  status: "RECONCILED_SCOPE_RECORDED_IMPLEMENTATION_DENIED",
  generatedAt: new Date().toISOString(),
  mappedCount: records.length,
  blockedCount: blockedRemaining,
  registryMutation: "NONE",
  phaseRegistration: "NONE",
  rule: "Mapped extracts are source-locked to existing owners. Blocked extracts stay untouched. No record authorizes runtime implementation.",
  records,
  excludedBlockedGapIds: ledger.decisions
    .filter((decision) => decision.status === "BLOCKED")
    .map((decision) => decision.gapId),
};

gaps.nextGate =
  "WP-02 scope is recorded for 19 mapped extracts. Eight blocked extracts remain untouched. Foundation Mission 001 remains unauthorized.";
gaps.wp02Reconciliation = reconciliation.artifact;

plan.status = "RECONCILED_SCOPE_RECORDED_IMPLEMENTATION_DENIED";
plan.reconciledAt = reconciliation.generatedAt;
plan.reconciliationArtifact = reconciliation.artifact;
plan.nextGate =
  "No registry or implementation mutation. Resolve blocked boundary reviews separately. Foundation Mission 001 remains blocked.";
for (const item of plan.mapped) {
  item.status = "SCOPE_RECORDED_IMPLEMENTATION_DENIED";
  item.implementationAuthorization = "DENIED";
}

writeFileSync(
  join(architecture, "COREGRID_CAMPAIGN_52_WP_02_RECEIVING_RECONCILIATION.json"),
  `${JSON.stringify(reconciliation, null, 2)}\n`,
  "utf8",
);
writeFileSync(
  join(architecture, "COREGRID_PHASE_52_UNRESOLVED_GAP_REGISTER.json"),
  `${JSON.stringify(gaps, null, 2)}\n`,
  "utf8",
);
writeFileSync(
  join(architecture, "COREGRID_CAMPAIGN_52_WP_02_RECEIVING_BLUEPRINT_PLAN.json"),
  `${JSON.stringify(plan, null, 2)}\n`,
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status: reconciliation.status,
      mappedCount: reconciliation.mappedCount,
      blockedCount: reconciliation.blockedCount,
      registryMutation: "NONE",
    },
    null,
    2,
  ),
);
