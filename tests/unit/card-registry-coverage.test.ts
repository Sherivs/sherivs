/**
 * M3 (ADR-106) card registry coverage.
 *
 * The catalogue keys come from `tests/fixtures/workspace-item-catalog.snapshot.json`, a read-only
 * snapshot of production `public.workspace_item_catalog` taken on 2026-11-17 (refresh instructions
 * are inside the file). This test fails when:
 *   - a catalogue key has no card-registry entry;
 *   - a `live` entry has no screen, or no test file under tests/ references its screen module;
 *   - a `planned` entry claims a screen, server functions or tables.
 * A second group feeds the check fake keys and expects it to fail, so the check itself is tested.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CARD_REGISTRY,
  plannedEntry,
  registryCoverageIssues,
  type CardContract,
} from "../../frontend/src/lib/shell/card-registry";
import { CATALOG } from "../../frontend/src/lib/sherivs-ws/engine";

interface Snapshot {
  capturedOn: string;
  rowCount: number;
  md5OfKeyKindRouteRows: string;
  items: { key: string; kind: string; route: string }[];
}

const snapshot = JSON.parse(
  readFileSync("tests/fixtures/workspace-item-catalog.snapshot.json", "utf8"),
) as Snapshot;
const catalogueKeys = snapshot.items.map((item) => item.key);
const SELF = "tests/unit/card-registry-coverage.test.ts";

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "fixtures" ? [] : testFiles(path);
    return /\.(test|spec)\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
const TEST_SOURCES = testFiles("tests")
  .filter((path) => path.split("\\").join("/") !== SELF)
  .map((path) => readFileSync(path, "utf8"));
const hasTestFor = (screenModule: string) =>
  TEST_SOURCES.some((source) => source.includes(basename(screenModule)));

describe("workspace item catalogue snapshot", () => {
  it("is the 107-row production snapshot, unedited", () => {
    expect(snapshot.capturedOn).toBe("2026-11-17");
    expect(snapshot.items).toHaveLength(snapshot.rowCount);
    expect(snapshot.rowCount).toBe(107);
    const rows = snapshot.items.map((i) => `${i.key}|${i.kind}|${i.route}`).join("\n");
    expect(createHash("md5").update(rows).digest("hex")).toBe(snapshot.md5OfKeyKindRouteRows);
    expect(new Set(catalogueKeys).size).toBe(catalogueKeys.length);
  });

  it("matches the keys of the catalogue mirror shipped to the client", () => {
    expect([...catalogueKeys].sort()).toEqual(CATALOG.map((item) => item.key).sort());
  });
});

describe("card registry coverage", () => {
  it("registers every catalogue key, and every live screen has a test", () => {
    expect(registryCoverageIssues({ catalogueKeys, registry: CARD_REGISTRY, hasTestFor })).toEqual(
      [],
    );
  });

  it("marks only the screens that exist as live", () => {
    const live = Object.values(CARD_REGISTRY).filter((entry) => entry.status === "live");
    for (const entry of live) {
      expect(entry.screen, entry.key).toBeTypeOf("function");
      expect(entry.screenModule, entry.key).toMatch(/^frontend\/src\/components\/app-shell\//);
      expect(() => statSync(`${entry.screenModule}.tsx`), entry.key).not.toThrow();
    }
    const plannedInCatalogue = catalogueKeys.filter(
      (key) => CARD_REGISTRY[key]?.status === "planned",
    );
    expect(
      plannedInCatalogue.length + live.filter((e) => catalogueKeys.includes(e.key)).length,
    ).toBe(107);
  });

  it("copies permissions and scope dimensions from the catalogue for planned cards", () => {
    for (const item of CATALOG) {
      const entry = CARD_REGISTRY[item.key]!;
      if (entry.status !== "planned") continue;
      expect(entry.permissions.any ?? [], item.key).toEqual(item.any);
      expect(entry.permissions.all ?? [], item.key).toEqual(item.all);
      expect(entry.scopeDims, item.key).toEqual(item.scopeDims);
      expect(entry.kind, item.key).toBe(item.kind);
    }
  });
});

describe("the coverage check itself", () => {
  it("fails when a catalogue key has no registry entry", () => {
    const issues = registryCoverageIssues({
      catalogueKeys: [...catalogueKeys, "w.fake_card_for_coverage_proof"],
      registry: CARD_REGISTRY,
      hasTestFor,
    });
    expect(issues).toEqual([
      "w.fake_card_for_coverage_proof: catalogue key has no card-registry entry",
    ]);
  });

  it("fails when a live entry has no screen", () => {
    const fake: CardContract = { ...plannedEntry("w.fake_live"), status: "live" };
    const issues = registryCoverageIssues({
      catalogueKeys: [],
      registry: { "w.fake_live": fake },
      hasTestFor,
    });
    expect(issues).toEqual(["w.fake_live: live entry has no screen"]);
  });

  it("fails when a live screen has no test referencing it", () => {
    const fake: CardContract = {
      ...plannedEntry("w.fake_untested"),
      status: "live",
      screen: async () => ({ default: () => null }),
      screenModule: "frontend/src/components/app-shell/no-such-untested-screen",
    };
    const issues = registryCoverageIssues({
      catalogueKeys: [],
      registry: { "w.fake_untested": fake },
      hasTestFor,
    });
    expect(issues).toEqual([
      "w.fake_untested: live screen frontend/src/components/app-shell/no-such-untested-screen has no test referencing it",
    ]);
  });

  it("fails when a planned entry claims tables it does not have", () => {
    const fake: CardContract = { ...plannedEntry("w.fake_planned"), tables: ["invented_table"] };
    expect(
      registryCoverageIssues({
        catalogueKeys: [],
        registry: { "w.fake_planned": fake },
        hasTestFor,
      }),
    ).toEqual([
      "w.fake_planned: planned entry must not claim a screen, server functions or tables",
    ]);
  });
});
