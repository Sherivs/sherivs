/**
 * Sherivs — quarantine isolation guard (mission M1b / E-005).
 *
 * Rule (frontend/src/lib/_quarantine/README.md): nothing outside
 * `frontend/src/lib/_quarantine` may import from it. The only exception is the
 * fixed list of unit tests that already exercised the quarantined modules
 * before they moved; they keep running unchanged. Any other importer, and any
 * new test importer, fails this test.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildGraph,
  findQuarantineImporters,
  readRepositorySources,
  traceModule,
} from "../../scripts/trace-module-reachability.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const QUARANTINE = "frontend/src/lib/_quarantine";

/** Tests that pinned these modules before the move (same assertions, new path). */
const ALLOWED_TEST_IMPORTERS = new Set([
  "tests/unit/h3-054-cognitive-architecture.test.ts",
  "tests/unit/h3-055-multi-agent-society.test.ts",
  "tests/unit/h3-057-simulation-engine.test.ts",
  "tests/unit/h3-058-evolution-engine.test.ts",
  "tests/unit/h3-064-planetary-infrastructure.test.ts",
  "tests/unit/h3-066-twin-civilization.test.ts",
  "tests/unit/h3-069-autonomous-economy.test.ts",
  "tests/unit/h3-071-reality-os-kernel.test.ts",
  "tests/unit/h3-072-cognitive-architecture-verification.test.ts",
  "tests/unit/h3-073-multi-agent-society-verification.test.ts",
  "tests/unit/h3-075-simulation-engine-verification.test.ts",
  "tests/unit/h3-079-planetary-infrastructure-verification.test.ts",
  "tests/unit/h3-080-twin-civilization-verification.test.ts",
  "tests/unit/h3-096-twin-governance.test.ts",
]);

const QUARANTINED_MODULES = [
  "planetary-infrastructure",
  "autonomous-economy",
  "twin-civilization",
  "multi-agent-society",
  "simulation-engine",
  "cognitive-architecture",
  "reality-os-kernel",
  "evolution-engine",
];

const graph = buildGraph(readRepositorySources(ROOT));

describe("frontend/src/lib/_quarantine isolation", () => {
  it("no file outside the quarantine imports from it, except the pinned tests", () => {
    const offenders = findQuarantineImporters(graph, QUARANTINE).filter(
      (o) => !ALLOWED_TEST_IMPORTERS.has(o.file),
    );
    expect(offenders).toEqual([]);
  });

  it("every quarantined module is present and UNREACHABLE from routes, components and servers", () => {
    for (const name of QUARANTINED_MODULES) {
      const result = traceModule(name, graph, { libDir: QUARANTINE });
      expect(result.status, `${name}: ${result.chain?.join(" -> ")}`).toBe("UNREACHABLE");
      expect(result.directImporters, name).toEqual([]);
    }
  });
});
