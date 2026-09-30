/**
 * CoreGrid — Phase 01 Foundation: the §59/§60 limits map must not lie (P01-3).
 *
 * The Phase 01 document demands rate limits at ten levels (§59) and resource
 * budgets (§60). Those capabilities already exist with canonical owners (Phase 05
 * runtime, 03 tenancy, 26 AI governance), so Phase 01's duty is the CONVENTION —
 * `architecture/foundation-limits.json` — not a second engine (duplication law).
 *
 * These tests re-derive every claim in that map against real source:
 *
 *  - coverage: all ten §59 scopes and all seven §60 budget kinds are mapped;
 *  - no overclaiming: an "enforced" row must name a symbol that really exists in
 *    the file it names, and a test file that really references that module;
 *  - no underclaiming: a "missing" row must NOT already exist in the implementation
 *    it points at (verified against the runtime limiter's scope union);
 *  - the unwired-boundary finding is re-probed, not asserted from memory: if any
 *    server function or route starts invoking the limiter or the budget, this test
 *    fails until the map is updated.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MAP_REF = "architecture/foundation-limits.json";

const RATE_LIMIT_SCOPES = [
  "ip",
  "user",
  "organization",
  "tenant",
  "api",
  "agent",
  "tool",
  "workflow",
  "device",
  "model",
] as const;
const BUDGET_KINDS = [
  "tokens",
  "requests",
  "compute",
  "storage",
  "execution_time",
  "external_calls",
  "financial_exposure",
] as const;

interface MapRow {
  scope?: string;
  kind?: string;
  status: "enforced" | "missing";
  ownerPhase: string;
  reason?: string;
  implementation?: { file: string; symbol: string };
  evidence?: string;
  extension?: boolean;
}
interface LimitsMap {
  phase: string;
  source: string;
  duplicationLaw: string;
  rateLimitScopes: MapRow[];
  budgetKinds: MapRow[];
  boundaryWiring: {
    status: string;
    statement: string;
    probe: { files: string[]; forbidden: string[]; expectedMatches: number };
    closesWhen: string;
  };
}

const map = () => JSON.parse(readFileSync(join(ROOT, MAP_REF), "utf8")) as LimitsMap;
const read = (ref: string) => readFileSync(join(ROOT, ref), "utf8");

describe("Phase 01 — §59/§60 limits map is complete and owned", () => {
  it("maps every §59 scope and every §60 budget kind exactly once", () => {
    const limits = map();
    expect(limits.phase).toBe("01");
    expect(limits.source).toBe("architecture/phase-01-foundation.md");
    expect(limits.duplicationLaw).toMatch(/must not implement a second limiter/i);

    const scopes = limits.rateLimitScopes.map((row) => row.scope);
    for (const scope of RATE_LIMIT_SCOPES) {
      expect(scopes, `§59 scope ${scope} must be mapped`).toContain(scope);
    }
    expect(new Set(scopes).size).toBe(scopes.length);

    const kinds = limits.budgetKinds.map((row) => row.kind);
    for (const kind of BUDGET_KINDS) {
      expect(kinds, `§60 budget kind ${kind} must be mapped`).toContain(kind);
    }
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it("gives every row a canonical owner phase and a reason when unimplemented", () => {
    const limits = map();
    for (const row of [...limits.rateLimitScopes, ...limits.budgetKinds]) {
      const label = row.scope ?? row.kind ?? "?";
      expect(row.ownerPhase, `${label} must name an owner`).toMatch(/^\d{2}$/);
      if (row.status === "missing") {
        expect(row.reason, `${label} must state why it is missing`).toBeTruthy();
        expect(row.implementation ?? null).toBeNull();
      } else {
        expect(row.implementation, `${label} must name its implementation`).toBeTruthy();
        expect(row.evidence, `${label} must name its proof`).toBeTruthy();
      }
    }
  });
});

describe("Phase 01 — the limits map is falsified against real source", () => {
  it("names a symbol that really exists in the file each enforced row cites", () => {
    const limits = map();
    for (const row of [...limits.rateLimitScopes, ...limits.budgetKinds]) {
      if (row.status !== "enforced" || !row.implementation) continue;
      const label = row.scope ?? row.kind ?? "?";
      expect(existsSync(join(ROOT, row.implementation.file)), `${label} file`).toBe(true);
      const source = read(row.implementation.file);
      expect(
        source,
        `${label}: ${row.implementation.symbol} not found in ${row.implementation.file}`,
      ).toContain(row.implementation.symbol);
      // The proof must reference the implementation module, not merely exist.
      const moduleName = row.implementation.file.split("/").pop()?.replace(/\.ts$/, "") ?? "";
      expect(existsSync(join(ROOT, row.evidence ?? "")), `${label} proof file`).toBe(true);
      expect(read(row.evidence ?? ""), `${label} proof must exercise ${moduleName}`).toContain(
        moduleName,
      );
    }
  });

  it("does not underclaim: scopes the limiter implements are not marked missing", () => {
    const limits = map();
    const limiterSource = read("frontend/src/lib/runtime-resilience.ts");
    const union = limiterSource.match(/export type RateLimitScope =([^;]+);/)?.[1] ?? "";
    const implemented = [...union.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);

    expect(implemented.length).toBeGreaterThan(0);
    for (const scope of implemented) {
      const row = limits.rateLimitScopes.find((entry) => entry.scope === scope);
      expect(row, `scope ${scope} exists in code but is not mapped`).toBeTruthy();
      expect(row?.status, `scope ${scope} exists in code but is marked ${row?.status}`).toBe(
        "enforced",
      );
    }
    for (const row of limits.rateLimitScopes) {
      if (row.status === "enforced") {
        expect(implemented, `§59 scope ${row.scope} must exist in RateLimitScope`).toContain(
          row.scope,
        );
      }
    }
  });

  it("re-probes the unwired-boundary finding instead of asserting it", () => {
    const limits = map();
    const probe = limits.boundaryWiring.probe;
    const files = [
      ...readdirSync(join(ROOT, "frontend/src/lib"))
        .filter((name) => name.endsWith(".functions.ts"))
        .map((name) => join("frontend/src/lib", name)),
      ...readdirSync(join(ROOT, "frontend/src/routes"))
        .filter((name) => name.endsWith(".tsx") || name.endsWith(".ts"))
        .map((name) => join("frontend/src/routes", name)),
    ];
    let matches = 0;
    for (const file of files) {
      const source = read(file);
      for (const forbidden of probe.forbidden) {
        if (source.includes(forbidden)) matches += 1;
      }
    }
    expect(files.length).toBeGreaterThan(0);
    expect(
      matches,
      `${matches} boundary call site(s) now invoke the limiter/budget — update ${MAP_REF}`,
    ).toBe(probe.expectedMatches);
    expect(limits.boundaryWiring.status).toBe("unwired");
    expect(limits.boundaryWiring.closesWhen).toMatch(/invoked at the server-function boundary/i);
  });
});
