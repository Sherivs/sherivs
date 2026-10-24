/**
 * Sherivs — V1CAP-40 placeholder-page disposition tests (mission V1-011).
 *
 * §57 no-product-theatre law, enforced structurally:
 *  - the typed disposition registry is complete, non-contradictory, and cites
 *    evidence (tables for V1_BUILD, planned capability for V2_CLASSIFIED);
 *  - every V1_BUILD page reads real data through the audited server functions
 *    and contains no fabricated statics and no disabled fake actions;
 *  - every V2_CLASSIFIED page renders the honest planned-capability state
 *    ("planned capability — not in V1") with no numbers and no fake controls;
 *  - the fabricated IntelligenceCenter renderings are gone from the portal.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PLACEHOLDER_DISPOSITIONS,
  dispositionCounts,
  validatePlaceholderDispositions,
} from "@/lib/runtime/scholar/placeholder-dispositions";
import {
  aggregateExpenseRows,
  aggregateFeeRows,
  aggregatePayrollRows,
  aggregateSportsPrograms,
} from "@/lib/runtime/scholar/portal-overview.functions";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function routeSource(file: string): string {
  return readFileSync(join(ROOT, file), "utf-8");
}

describe("disposition registry — audit law", () => {
  it("passes its own validator with zero issues", () => {
    const result = validatePlaceholderDispositions();
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("classifies every entry exactly once and cites evidence", () => {
    const counts = dispositionCounts();
    expect(counts.V1_BUILD).toBe(4);
    expect(counts.V2_CLASSIFIED).toBe(7);
    expect(counts.AUDITED_REAL).toBe(18);
    expect(PLACEHOLDER_DISPOSITIONS.length).toBe(
      counts.V1_BUILD + counts.V2_CLASSIFIED + counts.AUDITED_REAL,
    );
    for (const entry of PLACEHOLDER_DISPOSITIONS) {
      expect(entry.evidence.trim().length, `${entry.route} evidence`).toBeGreaterThan(20);
    }
  });

  it("points every entry at an existing route file", () => {
    for (const entry of PLACEHOLDER_DISPOSITIONS) {
      expect(existsSync(join(ROOT, entry.file)), `${entry.route} → ${entry.file}`).toBe(true);
    }
  });

  it("keeps V2 classifications inside the frozen V1 envelope (§45)", () => {
    for (const entry of PLACEHOLDER_DISPOSITIONS) {
      if (entry.disposition === "V2_CLASSIFIED") {
        expect(entry.plannedCapability, entry.route).toBeTruthy();
        expect(entry.versionTargetNote, entry.route).toBeTruthy();
      }
    }
  });
});

describe("V1_BUILD pages — real data law", () => {
  const v1Entries = PLACEHOLDER_DISPOSITIONS.filter((e) => e.disposition === "V1_BUILD");

  it("wires every V1_BUILD page through the audited server functions", () => {
    for (const entry of v1Entries) {
      const src = routeSource(entry.file);
      expect(src, entry.route).toContain("portal-overview.functions");
      expect(src, entry.route).toContain("useQuery");
    }
  });

  it("renders no fabricated statics and no disabled fake actions", () => {
    for (const entry of v1Entries) {
      const src = routeSource(entry.file);
      expect(src, `${entry.route} disabled fake action`).not.toMatch(/<Button[^>]*disabled/);
      // A literal rendered zero posing as data (the old placeholder signature).
      expect(src, `${entry.route} fabricated zero`).not.toMatch(/>\s*0\s*</);
      expect(src, `${entry.route} fabricated naira zero`).not.toContain("₦0");
    }
  });

  it("never renders a number outside a live server-function result", () => {
    for (const entry of v1Entries) {
      const src = routeSource(entry.file);
      expect(src, entry.route).not.toContain("IntelligenceCenter");
      expect(src, entry.route).not.toMatch(/value: "\d/);
    }
  });
});

describe("V2_CLASSIFIED pages — honest planned-state law", () => {
  const v2Entries = PLACEHOLDER_DISPOSITIONS.filter((e) => e.disposition === "V2_CLASSIFIED");

  it("renders the honest planned-capability state, stated in the open", () => {
    // The phrase lives in ONE place — the shared component — so a page cannot
    // claim honesty without actually rendering the honest state.
    const componentSrc = routeSource("frontend/src/components/planned-capability-state.tsx");
    expect(componentSrc).toContain("Planned capability — not in V1.");
    for (const entry of v2Entries) {
      const src = routeSource(entry.file);
      expect(src, entry.route).toContain("PlannedCapabilityState");
    }
  });

  it("fabricates nothing: no statics, no stats arrays, no fake controls", () => {
    for (const entry of v2Entries) {
      const src = routeSource(entry.file);
      expect(src, `${entry.route} disabled fake action`).not.toMatch(/<Button[^>]*disabled/);
      expect(src, `${entry.route} fabricated zero`).not.toMatch(/>\s*0\s*</);
      expect(src, `${entry.route} stats array`).not.toMatch(/stats\s*=\s*\[/);
      expect(src, `${entry.route} fabricated renderer`).not.toContain("IntelligenceCenter");
    }
  });
});

describe("fabrication sweep — the retired placeholder renderer", () => {
  it("no admin route renders IntelligenceCenter fabricated metrics anymore", () => {
    const adminDir = join(ROOT, "frontend/src/routes/_authenticated/admin");
    const offenders: string[] = [];
    const entries = readdirSync(adminDir);
    for (const name of entries) {
      if (!name.endsWith(".tsx")) continue;
      const src = readFileSync(join(adminDir, name), "utf-8");
      if (src.includes("IntelligenceCenter")) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});

describe("aggregation helpers — pure computation over real rows", () => {
  it("aggregates fee rows into billed/collected/outstanding and status counts", () => {
    const totals = aggregateFeeRows([
      { amount: 1000, paid_amount: 1000, status: "paid" },
      { amount: 2000, paid_amount: 500, status: "partial" },
      { amount: 3000, paid_amount: 0, status: "unpaid" },
      { amount: 500, paid_amount: null, status: null },
    ]);
    expect(totals.billed).toBe(6500);
    expect(totals.collected).toBe(1500);
    expect(totals.outstanding).toBe(5000);
    expect(totals.count).toBe(4);
    expect(totals.byStatus).toEqual({ unpaid: 1, partial: 1, paid: 1 });
  });

  it("aggregates an empty fee table as an honest zero, not a fabricated one", () => {
    const totals = aggregateFeeRows([]);
    expect(totals).toEqual({
      billed: 0,
      collected: 0,
      outstanding: 0,
      byStatus: { unpaid: 0, partial: 0, paid: 0 },
      count: 0,
    });
  });

  it("aggregates expense rows", () => {
    const totals = aggregateExpenseRows([{ amount: 120 }, { amount: 80 }, { amount: null }]);
    expect(totals).toEqual({ total: 200, count: 3 });
  });

  it("aggregates payroll rows including the unrecognised-status bucket", () => {
    const totals = aggregatePayrollRows([
      { gross_salary: 1000, net_salary: 800, status: "paid" },
      { gross_salary: 1000, net_salary: 800, status: "approved" },
      { gross_salary: 1000, net_salary: 900, status: "draft" },
      { gross_salary: 999, net_salary: 999, status: "weird" },
    ]);
    expect(totals.payslipCount).toBe(4);
    expect(totals.grossTotal).toBe(3999);
    expect(totals.netTotal).toBe(3499);
    expect(totals.byStatus).toEqual({ draft: 1, approved: 1, paid: 1, other: 1 });
  });

  it("aggregates sports programs with a category breakdown", () => {
    const overview = aggregateSportsPrograms([
      { sport_name: "Football", sport_category: "Team", coach_name: null, is_active: true },
      { sport_name: "Chess", sport_category: "Board", coach_name: "Ada", is_active: true },
      { sport_name: "Swimming", sport_category: null, coach_name: null, is_active: false },
    ]);
    expect(overview.totalPrograms).toBe(3);
    expect(overview.activePrograms).toBe(2);
    expect(overview.byCategory).toEqual([
      { category: "Team", count: 1 },
      { category: "Board", count: 1 },
      { category: "Uncategorized", count: 1 },
    ]);
  });
});
