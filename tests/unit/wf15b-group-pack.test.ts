import { describe, expect, it } from "vitest";
import {
  GROUP_DIRECTOR_ROLE,
  GROUP_PACK_ENTRIES,
  GROUP_REUSED_TEMPLATE_KEYS,
  validateGroupPack,
} from "../../frontend/src/lib/runtime/scholar/workflow-packs/group-pack";
import {
  validateCatalogEntry,
  type CatalogEntry,
} from "../../frontend/src/lib/runtime/scholar/workflow-packs/workflow-catalog";

const ok: CatalogEntry = { ...GROUP_PACK_ENTRIES[0] };

describe("Group Pack", () => {
  it("is valid as declared", () => {
    expect(validateGroupPack()).toEqual([]);
  });
  it("reuses only templates that exist in the Private School Pack", () => {
    expect(validateGroupPack(["ps_fee_ladder"]).length).toBe(GROUP_REUSED_TEMPLATE_KEYS.length - 1);
  });
  it("declares the six group workflows as not yet buildable and reports them to the group director", () => {
    expect(GROUP_PACK_ENTRIES.map((e) => e.key).sort()).toEqual(
      [
        "group.finance_close",
        "group.fee_policy_rollout",
        "group.kpi_breach_alert",
        "group.staff_transfer",
        "group.student_transfer",
        "group.weekly_rollup",
      ].sort(),
    );
    for (const e of GROUP_PACK_ENTRIES) {
      expect(e.buildState).toBe("needs_event_source");
      expect(e.reportsTo).toBe(GROUP_DIRECTOR_ROLE);
      expect(e.autonomyMax).toBe("draft");
    }
  });
  it("keeps roll-ups aggregate-only", () => {
    for (const e of GROUP_PACK_ENTRIES.filter((x) => x.aggregateOnly)) {
      expect(e.dataClasses.every((d) => d.startsWith("aggregate_"))).toBe(true);
    }
    // The pack validator refuses an aggregate-only entry that declares a non-aggregate data class.
    expect(validateGroupPack()).toEqual([]);
  });
});

describe("catalogue entry validation", () => {
  it("accepts a valid entry and refuses malformed keys, versions, titles and types", () => {
    expect(validateCatalogEntry(ok)).toEqual([]);
    expect(validateCatalogEntry({ ...ok, key: "Bad Key" })).toContain(
      "key must be dotted lower-case words",
    );
    expect(validateCatalogEntry({ ...ok, version: "1.2" })).toContain("version must be semver");
    expect(validateCatalogEntry({ ...ok, title: { en: " " } })).toContain(
      "an English title is required",
    );
    expect(validateCatalogEntry({ ...ok, orgTypes: ["zzz" as never] }).join()).toContain(
      "unknown org type",
    );
    expect(validateCatalogEntry({ ...ok, orgTypes: [] })).toContain("at least one org type");
  });
  it("caps high-risk, regulator and money-or-safeguarding templates at draft", () => {
    expect(
      validateCatalogEntry({ ...ok, riskTier: "high", autonomyMax: "act_with_approval" }),
    ).toContain("a high-risk template is capped at draft");
    expect(
      validateCatalogEntry({ ...ok, regulator: "WAEC", autonomyMax: "act_with_approval" }).join(),
    ).toContain("regulator-facing");
    expect(
      validateCatalogEntry({
        ...ok,
        dataClasses: ["safeguarding_case"],
        autonomyMax: "act_and_report",
      }).join(),
    ).toContain("never rise above draft");
  });
  it("keeps build state honest against the real event sources", () => {
    expect(validateCatalogEntry({ ...ok, buildState: "built" })).toContain(
      "a built template must trigger on an existing WF-05 event source",
    );
    expect(
      validateCatalogEntry({ ...ok, trigger: { event: "fees.invoice_issued" } }).join(),
    ).toContain("the trigger event exists");
    expect(
      validateCatalogEntry({
        ...ok,
        trigger: { event: "fees.invoice_issued" },
        buildState: "built",
      }),
    ).toEqual([]);
  });
  it("keeps min_plan null until PLAN-01", () => {
    expect(validateCatalogEntry({ ...ok, minPlan: "pro" as never })).toContain(
      "min_plan stays null until PLAN-01",
    );
  });
});
