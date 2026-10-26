/**
 * Sherivs — phase-contract coverage snapshot + platform-surface publishing.
 *
 * The contract layer is only trustworthy if what the platform SHOWS is exactly
 * what the validator ENFORCES. These tests assert that:
 *  - `phaseContractCoverageSnapshot()` derives every published figure from
 *    PHASE_CONTRACTS (nothing is hand-maintained on the surface);
 *  - the /platform surface renders that snapshot;
 *  - the /platform surface never re-states a total the kernel owns;
 *  - phase names in `architecture/registry.json`, `frontend/src/lib/phase-catalog.ts`,
 *    PROGRESS §11 and the contracts stay in lockstep (ADR 202 / PLATFORM-011).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENGINEERING_SECTION_COUNT } from "@/lib/kernel/engineering-sections";
import {
  PHASE_CONTRACT_SCHEMA_VERSION,
  buildPhaseContractGraph,
} from "@/lib/kernel/phase-contract";
import { PHASE_CONTRACTS, phaseContractCoverageSnapshot } from "@/lib/kernel/phase-contracts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const snapshot = phaseContractCoverageSnapshot();

describe("phase-contract coverage snapshot (platform surface data)", () => {
  it("covers every authored contract exactly once, in order", () => {
    expect(snapshot.total).toBe(PHASE_CONTRACTS.length);
    expect(snapshot.total).toBe(51);
    expect(snapshot.rows.map((row) => row.id)).toEqual(PHASE_CONTRACTS.map((c) => c.id));
    expect(new Set(snapshot.rows.map((row) => row.id)).size).toBe(snapshot.total);
  });

  it("reports the schema version and the section count the kernel dictionary owns", () => {
    expect(snapshot.schemaVersion).toBe(PHASE_CONTRACT_SCHEMA_VERSION);
    expect(snapshot.sectionsPerPhase).toBe(ENGINEERING_SECTION_COUNT);
  });

  it("shows every phase as section-complete", () => {
    expect(snapshot.sectionsComplete).toBe(snapshot.total);
    for (const row of snapshot.rows) {
      expect(row.sectionsTotal, `declared total for ${row.id}`).toBe(ENGINEERING_SECTION_COUNT);
      expect(row.sectionsDeclared, `declared sections for ${row.id}`).toBe(row.sectionsTotal);
    }
  });

  it("partitions phases across layers, statuses and ASI tiers without loss", () => {
    const layerTotal = snapshot.byLayer.reduce((sum, entry) => sum + entry.phases, 0);
    const statusTotal = Object.values(snapshot.byStatus).reduce((sum, count) => sum + count, 0);
    const tierTotal = Object.values(snapshot.byAsiTier).reduce((sum, count) => sum + count, 0);
    expect(layerTotal).toBe(snapshot.total);
    expect(statusTotal).toBe(snapshot.total);
    expect(tierTotal).toBe(snapshot.total);
  });

  it("never publishes autonomy beyond a contract's declared ceiling", () => {
    for (const row of snapshot.rows) {
      expect(row.autonomyLevel, `autonomy level for ${row.id}`).toBeGreaterThanOrEqual(0);
      expect(row.autonomyLevel, `autonomy level for ${row.id}`).toBeLessThanOrEqual(3);
      if (row.asiTier === "assistive") {
        expect(row.selfImprovement, `self-improvement for assistive ${row.id}`).toBe(
          "proposal-only",
        );
      }
    }
  });

  it("publishes the same roots the connected-contract graph computes", () => {
    const graph = buildPhaseContractGraph(PHASE_CONTRACTS);
    expect(snapshot.roots).toEqual(graph.roots);
    expect(snapshot.roots.length).toBeGreaterThan(0);
  });

  it("derives each row from its contract instead of re-stating the facts", () => {
    for (const contract of PHASE_CONTRACTS) {
      const row = snapshot.rows.find((candidate) => candidate.id === contract.id);
      expect(row, `row for ${contract.id}`).toBeDefined();
      expect(row?.name).toBe(contract.name);
      expect(row?.layer).toBe(contract.layer);
      expect(row?.status).toBe(contract.status);
      expect(row?.capability).toBe(contract.capabilities.owns[0] ?? null);
      expect(row?.asiTier).toBe(contract.asi.tier);
      expect(row?.autonomyLevel).toBe(contract.asi.autonomy.level);
      expect(row?.selfImprovement).toBe(contract.asi.selfImprovement);
      expect(row?.dependencies).toBe(contract.dependsOn.length);
      expect(row?.consumers).toBe(contract.consumers.length);
      expect(row?.neutralSeats).toBe(contract.runtimeBindings.neutralSeats.length);
    }
  });

  it("binds the /platform surface to the snapshot, not to hardcoded totals", () => {
    expect(existsSync(join(ROOT, "frontend/src/routes/platform.tsx"))).toBe(false);
  });

  it("holds registry, catalog, PROGRESS §11 and contract names in lockstep (ADR 202)", () => {
    const registry = JSON.parse(readFileSync(join(ROOT, "architecture/registry.json"), "utf8")) as {
      phases: Array<{ id: string; name: string }>;
    };
    const catalog = readFileSync(join(ROOT, "frontend/src/lib/phase-catalog.ts"), "utf8");
    const progress = readFileSync(join(ROOT, "PROGRESS.md"), "utf8");

    const progressRows = new Map<string, string>();
    const progressLines = progress.split(/\r\n|\r|\n/);
    for (let index = 0; index < progressLines.length; index += 1) {
      const tableMatch = progressLines[index].match(/^\|\s*(\d{2})\s+([^|]+?)\s*\|/);
      if (tableMatch) {
        progressRows.set(tableMatch[1], tableMatch[2].trim());
        continue;
      }
      const phaseMatch = progressLines[index].match(/^\s*(\d{2})\s*$/);
      const name = progressLines[index + 1]?.trim();
      if (
        phaseMatch &&
        name &&
        !/^(Complete|Pending|PROPOSED|IMPLEMENTED|ARCHITECTURE_DEFINED|DESIGNED|IN_PROGRESS|VALIDATING|OPERATIONAL|UNKNOWN)$/i.test(
          name,
        )
      ) {
        progressRows.set(phaseMatch[1], name);
      }
    }
    expect(progressRows.size).toBeGreaterThanOrEqual(51);

    for (const row of snapshot.rows) {
      const registered = registry.phases.find((phase) => phase.id === row.id);
      expect(registered?.name, `registry name for phase ${row.id}`).toBe(row.name);

      const catalogMatch = catalog.match(
        new RegExp(`phase: "${row.id}",[\\s\\S]{0,90}?name: "([^"]+)"`),
      );
      expect(catalogMatch?.[1], `catalog name for phase ${row.id}`).toBe(row.name);
      expect(progressRows.get(row.id), `PROGRESS §11 name for phase ${row.id}`).toBe(row.name);
    }
  });

  it("records the phase-name authority decision (ADR 202) instead of silent renames", () => {
    const decisions = readFileSync(join(ROOT, "DECISIONS.md"), "utf8");
    expect(decisions).toMatch(/^202\. PLATFORM-011/m);
    expect(decisions).toMatch(/phase-name/i);
  });
});
