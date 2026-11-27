import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  NG_GUARDRAILS,
  NG_INSTITUTION_TYPES,
  NG_PERMISSIONS,
  NG_ROLE_CATALOG_STATS,
  NG_ROLE_TEMPLATES,
  NG_ROLES,
  NG_SOD_PERMISSION_RULES,
  NG_SOD_ROLE_PAIRS,
} from "../../frontend/src/lib/scholar/roles/ng-role-catalog.generated";

const GOLDEN = JSON.parse(
  readFileSync("tests/unit/__golden__/ng-role-catalog-by-institution-type.json", "utf8"),
) as Record<string, { roles: number; templates: string[] }>;
const MIGRATION =
  "database/supabase/migrations/20261117001000_sherivs_m2a_role_catalog_extension.sql";
const ROLLBACK =
  "database/supabase/rollbacks/20261117001000_sherivs_m2a_role_catalog_extension.sql";

describe("M2a catalogue extension (ADR-145)", () => {
  it("pins the exact totals", () => {
    expect(NG_ROLE_CATALOG_STATS).toMatchObject({
      roles: 649,
      templates: 108,
      permissions: 160,
      guardrails: 14,
      sod_role_pairs: 8,
      sod_permission_rules: 9,
      institution_types: 65,
      oversight_institution_types: 25,
      remapped_roles: 31,
    });
    expect(NG_ROLES).toHaveLength(NG_ROLE_CATALOG_STATS.roles);
    expect(Object.keys(NG_ROLE_TEMPLATES)).toHaveLength(NG_ROLE_CATALOG_STATS.templates);
    expect(Object.keys(NG_INSTITUTION_TYPES)).toHaveLength(NG_ROLE_CATALOG_STATS.institution_types);
  });

  it("golden: per institution type, the set of templates and the count of roles", () => {
    const actual: Record<string, { roles: number; templates: string[] }> = {};
    for (const t of Object.keys(NG_INSTITUTION_TYPES).sort()) {
      const rs = NG_ROLES.filter((r) => r.institutionTypes.includes(t));
      actual[t] = { roles: rs.length, templates: [...new Set(rs.map((r) => r.template))].sort() };
    }
    expect(actual).toEqual(GOLDEN);
  });

  it("carries every section 6.1 code written in the brief", () => {
    for (const c of [
      "nursery_ecce",
      "public_primary",
      "private_primary",
      "public_jss",
      "public_sss",
      "private_secondary",
      "unity_college",
      "technical_college",
      "science_technical_college",
      "special_needs_school",
      "islamiyya_sangaya",
      "mission_school",
      "boarding",
      "multi_shift",
      "multi_campus_group",
      "university_federal",
      "university_state",
      "university_private",
      "polytechnic_federal",
      "polytechnic_state",
      "polytechnic_private",
      "monotechnic",
      "college_of_education_federal",
      "college_of_education_state",
      "college_of_education_private",
      "college_of_health_technology",
      "college_of_nursing_midwifery",
      "college_of_agriculture",
      "innovation_enterprise_institution",
      "vocational_enterprise_institution",
      "distance_learning_centre",
      "federal_ministry_of_education",
      "state_ministry_of_education",
      "ministry_of_higher_education",
      "ubec",
      "subeb",
      "lgea",
      "teaching_service_commission",
      "secondary_education_board",
      "arabic_islamic_education_board",
      "tvet_board",
      "scholarship_board",
      "agency_for_mass_literacy",
    ])
      expect(NG_INSTITUTION_TYPES[c], c).toBeDefined();
    // Original SHERIVS-017 types are kept for every original role.
    for (const c of [
      "government",
      "nursery",
      "primary",
      "secondary",
      "polytechnic",
      "college_of_education",
      "university",
      "boarding",
      "faith",
    ])
      expect(NG_INSTITUTION_TYPES[c]?.legacy, c).toBe(true);
  });

  it("every template's permissions and guardrails exist, lists are disjoint", () => {
    for (const [k, t] of Object.entries(NG_ROLE_TEMPLATES)) {
      const all = [...t.mandatory, ...t.optionalOn, ...t.optionalOff];
      expect(new Set(all).size, k).toBe(all.length);
      expect(t.mandatory.length, k).toBeGreaterThan(0);
      for (const p of all) expect(NG_PERMISSIONS[p], `${k}:${p}`).toBeDefined();
      for (const g of t.guardrails) expect(NG_GUARDRAILS[g], `${k}:${g}`).toBeDefined();
      expect(t.guardrails).toContain("tenant_isolation");
      expect(t.guardrails).toContain("audited");
    }
  });

  it("every SoD rule names existing permissions or templates", () => {
    for (const r of NG_SOD_PERMISSION_RULES) {
      expect(NG_PERMISSIONS[r.a], r.a).toBeDefined();
      expect(NG_PERMISSIONS[r.b], r.b).toBeDefined();
    }
    for (const [a, b] of NG_SOD_ROLE_PAIRS) {
      expect(NG_ROLE_TEMPLATES[a], a).toBeDefined();
      expect(NG_ROLE_TEMPLATES[b], b).toBeDefined();
    }
    const pairs = NG_SOD_PERMISSION_RULES.map((r) => `${r.a}|${r.b}`);
    for (const p of [
      "farm.produce_record|farm.produce_sell",
      "roles.custom_create|roles.custom_approve",
      "admissions.score|admissions.offer",
      "returns.submit|returns.review",
      "research.manage|research.ethics_approve",
    ])
      expect(pairs).toContain(p);
  });

  it("every role and template has a workspace_mode; full templates have exactly three nav sections", () => {
    const modes = ["full", "task_surface", "none"];
    for (const [k, t] of Object.entries(NG_ROLE_TEMPLATES)) {
      expect(modes, k).toContain(t.workspaceMode);
      expect(t.nav.length, k).toBe(t.workspaceMode === "full" ? 3 : 0);
    }
    for (const r of NG_ROLES) {
      expect(modes, r.code).toContain(r.workspaceMode);
      // A role may narrow its template's mode, never widen it.
      if (NG_ROLE_TEMPLATES[r.template]?.workspaceMode !== "full")
        expect(r.workspaceMode).not.toBe("full");
    }
    expect(NG_ROLE_TEMPLATES.driver?.workspaceMode).toBe("task_surface");
    expect(NG_ROLE_TEMPLATES.gate_officer?.workspaceMode).toBe("task_surface");
    expect(NG_ROLE_TEMPLATES.support_staff?.workspaceMode).toBe("none");
  });

  it("oversight roles are disabled by default with mandate_status unverified", () => {
    const oversight = new Set(
      Object.entries(NG_INSTITUTION_TYPES)
        .filter(([, d]) => d.oversight)
        .map(([c]) => c),
    );
    for (const r of NG_ROLES) {
      const isOversight = r.institutionTypes.every((t) => oversight.has(t));
      expect(r.oversight, r.code).toBe(isOversight);
      if (isOversight) {
        expect(r.defaultEnabled, r.code).toBe(false);
        expect(r.mandateStatus, r.code).toBe("unverified");
      } else {
        expect(
          r.institutionTypes.some((t) => oversight.has(t)),
          r.code,
        ).toBe(false);
        expect(r.defaultEnabled, r.code).toBe(true);
      }
    }
    for (const t of ["government", "subeb", "lgea", "waec", "nuc", "trcn", "jamb"])
      expect(NG_INSTITUTION_TYPES[t]?.oversight, t).toBe(true);
  });

  it("protected flags follow Appendix C", () => {
    for (const p of [
      "role_pack.manage",
      "roles.custom_approve",
      "senate.approve_results",
      "records.certify",
      "clinical.log_sign",
      "exam_body.import",
      "dsr.process",
      "break_glass.invoke",
      "returns.submit",
      "circular.issue",
      "posting.manage",
      "promotion.case_manage",
      "mandate.verify",
      "agent.approve",
    ])
      expect(NG_PERMISSIONS[p]?.protected, p).toBe(true);
    for (const p of [
      "roles.custom_create",
      "farm.produce_record",
      "farm.produce_sell",
      "admissions.score",
      "returns.review",
      "twin.use",
    ])
      expect(NG_PERMISSIONS[p]?.protected, p).toBe(false);
    expect(NG_PERMISSIONS["iep.manage"]?.sensitivity).toBe("restricted");
  });

  it("new permissions reach existing templates only as optional and off", () => {
    const legacy = Object.entries(NG_ROLE_TEMPLATES).filter(
      ([, t]) => t.specSource === "sherivs_017",
    );
    expect(legacy).toHaveLength(56);
    const newPerms = new Set(Object.keys(NG_PERMISSIONS).slice(94));
    for (const [k, t] of legacy) {
      for (const p of [...t.mandatory, ...t.optionalOn])
        expect(newPerms.has(p), `${k}:${p}`).toBe(false);
    }
  });

  it("[VERIFY] items are carried as data, not asserted", () => {
    expect(NG_INSTITUTION_TYPES.arabic_islamic_education_board?.verify).toMatch(/VERIFY/);
    expect(NG_INSTITUTION_TYPES.chprbn?.verify).toMatch(/VERIFY/);
    expect(NG_ROLE_TEMPLATES.licence_verifier?.verify).toMatch(/VERIFY/);
  });

  it("migration is NOT APPLIED, guarded, and the rollback is generated with it", () => {
    const mig = readFileSync(MIGRATION, "utf8");
    const rb = readFileSync(ROLLBACK, "utf8");
    expect(mig.split("\n")[0]).toBe(
      "-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.",
    );
    expect(mig).not.toMatch(/^\s*(BEGIN|COMMIT);/m);
    expect(mig).not.toMatch(/CREATE TABLE|GRANT /);
    expect(mig).toContain("a remapped catalogue role has active assignments");
    expect(rb).toContain("ENABLE TRIGGER trg_role_templates_guard");
  });

  it("generator is deterministic and the checked-in outputs are current", () => {
    const run = spawnSync("python3", ["tools/role-catalog/catalog.py", "--check"], {
      encoding: "utf8",
    });
    expect(run.error, "python3 must be available").toBeUndefined();
    expect(run.stdout.trim()).toBe("UP TO DATE");
    expect(run.status).toBe(0);
  });
});
