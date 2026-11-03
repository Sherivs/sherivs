import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderDpoDesignation, renderDpoOverview } from "../../scripts/lib/dpo-designation.mjs";

const designation = JSON.parse(readFileSync("config/dpo-designation.json", "utf8"));
const overview = readFileSync("docs/compliance/ndpa-overview.md", "utf8");

describe("DPO designation", () => {
  it("renders the current config with interim status and the effective end date", () => {
    const rendered = renderDpoDesignation(designation, new Date("2026-11-03T00:00:00Z"));

    expect(rendered).toContain("Muhammad");
    expect(rendered).toContain("Interim Data Protection Officer");
    expect(rendered).toContain("Sherivs");
    expect(rendered).toContain("Interim appointment");
    expect(rendered).toContain("2027-02-02");
    expect(rendered).toContain("Status: Active.");
    expect(rendered).not.toContain("@");
    expect(designation).not.toHaveProperty("email");
    expect(designation).not.toHaveProperty("phone");
  });

  it("flags a designation after its effective end date", () => {
    expect(renderDpoOverview(overview, designation, new Date("2027-02-03T00:00:00Z"))).toContain(
      "Status: EXPIRED",
    );
  });

  it("keeps the documented designation rendered from the central config", () => {
    expect(renderDpoOverview(overview, designation, new Date("2026-11-03T00:00:00Z"))).toBe(
      overview,
    );
  });
});
