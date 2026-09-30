/**
 * Phase 11 — Academic Intelligence contract (seeded authoring).
 *
 * Learning intelligence over the installed reality ontology: mastery, pathways
 * and risk, computed from canonical academic records rather than replacing them.
 */

import { definePhaseContractFromSeed } from "./define-phase";

export const PHASE_11_ACADEMIC_INTELLIGENCE = definePhaseContractFromSeed({
  id: "11",
  name: "Academic Intelligence",
  phaseDoc: "architecture/phase-11-academic-intelligence.md",
  layer: "Intelligence",
  stage: "S4",
  status: "implemented",
  owner: "11",
  capability: "academic-intelligence",
  consumes: [
    "foundation-standards-config-secrets-ci",
    "universal-identity",
    "tenancy-isolation-rls",
    "education-reality-ontology",
  ],
  purpose:
    "Turn academic records into intelligence: mastery estimates, learning pathways and early risk signals that inform people without overwriting the records they derive from.",
  ownership:
    "Single owner of mastery models, pathway recommendations and academic risk scoring over the reality ontology.",
  boundaryStatement:
    "Academic intelligence owns derived insight, never canonical academic truth: it may not write grades, attendance or assessments, and it never presents inference as record.",
  excludes: [
    "canonical-academic-records (phase 04 ontology data)",
    "scheduling (phase 12)",
    "model-gateway-ownership (phase 26)",
  ],
  principle:
    "Derived intelligence is labelled as derived: every estimate carries its inputs, its method and its confidence, and canonical records remain untouched.",
  dependsOn: ["01", "02", "03", "04", "07"],
  consumers: ["12", "18"],
  substrates: [
    "mastery projections",
    "pathway recommendations",
    "risk signals",
    "curriculum versions",
    "competency graph",
    "learning objectives",
  ],
  tests: [
    "tests/unit/academic-core.test.ts",
    "tests/unit/academic-mastery.test.ts",
    "tests/unit/academic-pathways.test.ts",
    "tests/unit/academic-risk.test.ts",
    "tests/unit/academic-curriculum.test.ts",
    "tests/unit/academic-intelligence-report.test.ts",
  ],
  provides: [
    { id: "academic:mastery-read", kind: "query", description: "read mastery estimates" },
    { id: "academic:pathway-recommend", kind: "query", description: "recommend a pathway" },
    { id: "academic:risk-signals", kind: "query", description: "read risk signals" },
    {
      id: "academic:curriculum-version",
      kind: "command",
      description: "publish a curriculum version that supersedes without editing the previous one",
    },
    {
      id: "academic:competency-graph",
      kind: "query",
      description: "resolve competency prerequisites, refusing a cycle before it is stored",
    },
    {
      id: "academic:assessment-coverage",
      kind: "query",
      description:
        "prove an assessment covers its competencies and objectives and reconciles its marks",
    },
  ],
  consumesContracts: [
    { id: "reality:resolve-entity", kind: "query" },
    { id: "agent:audit-trail", kind: "query" },
  ],
  canonicalTruth: {
    owners: ["academic records (phase 04 ontology data)"],
    derived: ["mastery estimates", "pathways", "risk signals"],
  },
  asiTier: "supervised-autonomous",
  autonomyLevel: 2,
  requiresApprovalFor: ["intervention-recommendation-release", "risk-threshold-change"],
  sections: {
    aiSafety:
      "Recommendations are proposals with inputs and confidence; no estimate may be presented to a learner as a grade, and staff approval gates intervention actions.",
  },
});
