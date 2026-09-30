/**
 * Phase 12 — Scheduling Intelligence contract (seeded authoring).
 *
 * Timetabling and availability: constraints, validation and availability
 * resolution over the reality ontology's calendars and resources.
 */

import { definePhaseContractFromSeed } from "./define-phase";

export const PHASE_12_SCHEDULING_INTELLIGENCE = definePhaseContractFromSeed({
  id: "12",
  name: "Scheduling Intelligence",
  phaseDoc: "architecture/phase-12-scheduling-intelligence.md",
  layer: "Runtime",
  stage: "S4",
  status: "implemented",
  owner: "12",
  capability: "scheduling",
  consumes: [
    "foundation-standards-config-secrets-ci",
    "universal-identity",
    "tenancy-isolation-rls",
    "education-reality-ontology",
    "academic-intelligence",
  ],
  purpose:
    "Own time and resource placement: model constraints, validate schedules, resolve availability and detect conflicts for any runtime that plans time.",
  ownership:
    "Single owner of the scheduling model: constraints, availability resolution, timetable validation and conflict detection.",
  boundaryStatement:
    "Scheduling owns placement, never attendance or academic truth; it never writes the records it schedules around.",
  excludes: [
    "canonical-attendance-ownership (phase 04 ontology data)",
    "academic-mastery (phase 11)",
    "workflow-orchestration (phase 17)",
  ],
  principle:
    "A schedule is valid only if every declared constraint holds; conflicts are surfaced, never silently overwritten.",
  dependsOn: ["01", "02", "03", "04"],
  consumers: ["04", "25"],
  substrates: [
    "scheduling constraints",
    "availability windows",
    "timetable placements",
    "conflict records",
    "schedule scores",
    "disruption vectors",
    "placement explanations",
  ],
  tests: [
    "tests/unit/scheduling-core.test.ts",
    "tests/unit/scheduling-availability.test.ts",
    "tests/unit/scheduling-constraints.test.ts",
    "tests/unit/scheduling-validator.test.ts",
    "tests/unit/scheduling-governance.test.ts",
    "tests/unit/scheduling-intelligence-report.test.ts",
  ],
  provides: [
    { id: "scheduling:resolve-availability", kind: "query", description: "resolve availability" },
    { id: "scheduling:validate", kind: "api", description: "validate a timetable" },
    { id: "scheduling:place", kind: "command", description: "place a session" },
    {
      id: "scheduling:detect-conflicts",
      kind: "query",
      description: "detect and classify conflicts across assignments",
    },
    {
      id: "scheduling:escalate-conflicts",
      kind: "query",
      description: "separate blocking from waivable conflicts and report infeasibility",
    },
    {
      id: "scheduling:score",
      kind: "query",
      description: "score a plan across independent quality dimensions",
    },
    {
      id: "scheduling:measure-disruption",
      kind: "query",
      description: "measure how far a change disturbs the active plan",
    },
    {
      id: "scheduling:compare-versions",
      kind: "query",
      description: "compare two schedule versions by placement, resource and conflict",
    },
    {
      id: "scheduling:analyse-impact",
      kind: "query",
      description: "calculate the impact of a change and the least disruptive adjustment",
    },
    {
      id: "scheduling:explain-placement",
      kind: "query",
      description: "explain a placement: why here, why this resource, why not the alternatives",
    },
    {
      id: "scheduling:rank-candidates",
      kind: "query",
      description: "rank feasible candidates by disruption before quality",
    },
  ],
  consumesContracts: [{ id: "reality:resolve-entity", kind: "query" }],
  canonicalTruth: {
    owners: ["constraint sets", "timetable placements"],
    derived: ["suggested placements", "conflict forecasts"],
  },
  requiresApprovalFor: ["constraint-removal", "timetable-publish", "cross-campus-placement"],
});
