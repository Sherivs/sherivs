/**
 * M5a (E-009) — family: multi-campus groups and franchises (Appendix A10).
 * Group-level choices only; each campus is onboarded as a unit of the group.
 */
import { eq, familyModule, languagesStep, populationStep, question } from "../builders";
import type { GraphModule } from "../types";
import { PRIVATE_CURRICULA, PRIVATE_INTAKE_MODES } from "./options";

const F = "multi_campus";
const id = (s: string) => `${F}.${s}`;
const A = "institutionProfile.attributes";
const CENTRAL = id("intake.central");

export const MODULE: GraphModule = familyModule(F, [
  {
    q: question(id("layout.campus_count"), "number", `${A}.campus_count`, {
      validation: { min: 2, max: 100 },
      dataClass: "public",
    }),
  },
  {
    q: question(id("layout.campus_kinds"), "multi", `${A}.campus_kinds`, {
      options: ["nursery_ecce", "primary", "secondary", "islamiyya", "tertiary"],
      validation: { minItems: 1 },
      dataClass: "public",
    }),
  },
  {
    q: question(id("authority.owner"), "single", "institutionProfile.ownership", {
      options: ["private", "faith_based", "community"],
      dataClass: "public",
    }),
  },
  {
    q: question(id("governance.shared_services"), "multi", `${A}.shared_services`, {
      options: ["finance", "academics", "hr", "internal_audit", "admissions", "ict"],
      validation: { minItems: 1 },
    }),
  },
  { q: question(CENTRAL, "bool", "admissions.enabledByDefault") },
  {
    q: question(id("intake.mode"), "single", "admissions.mode", {
      options: PRIVATE_INTAKE_MODES,
      dataClass: "public",
    }),
    when: eq(CENTRAL, true),
  },
  {
    q: question(id("web.layout"), "single", `${A}.website_layout`, {
      options: ["one_group_site", "site_per_campus"],
    }),
  },
  {
    q: question(id("academics.curricula"), "multi", "curricula", {
      options: PRIVATE_CURRICULA,
      validation: { minItems: 1 },
      dataClass: "public",
    }),
  },
  populationStep(F),
  languagesStep(F),
]);
