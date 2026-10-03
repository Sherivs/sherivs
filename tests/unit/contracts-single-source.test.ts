/**
 * Single-source contract structural test (Constitution §23).
 *
 * The cross-surface contracts live in ONE physical source
 * (`packages/contracts`, specifier `@coregrid/contracts`). Vocabulary drift
 * between web and mobile is impossible by construction — there is no second
 * declaration to drift against. This suite therefore proves the STRUCTURE
 * that makes drift impossible:
 *
 *  1. the canonical vocabularies are declared exactly once (in the package),
 *  2. BOTH surfaces actually consume the package (no copy drift re-introduced
 *     later by re-inlining a mirror),
 *  3. the former cross-tree relative imports and two-directional drift shims
 *     (mobile/src/api/contracts/{vocabulary,database}.ts) are gone,
 *  4. the package's runtime values remain the closed, ordered sets the
 *     consumers' Zod contracts and UIs rely on.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EVIDENCE_LIFECYCLES,
  EXECUTION_STATUSES,
  EXTERNAL_EFFECTS,
  IDENTITY_KINDS,
  IDENTITY_STATES,
  VERIFICATION_DECISIONS,
} from "@coregrid/contracts";

const repoRoot = resolve(import.meta.dirname, "../..");
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const VOCABULARY_NAMES = [
  "EXECUTION_STATUSES",
  "EXTERNAL_EFFECTS",
  "EVIDENCE_LIFECYCLES",
  "VERIFICATION_DECISIONS",
  "IDENTITY_KINDS",
  "IDENTITY_STATES",
] as const;

const FRONTEND_CONTRACT_MODULES = [
  "frontend/src/lib/control-plane/foundation-mission.ts",
  "frontend/src/lib/control-plane/foundation-loop.ts",
  "frontend/src/lib/identity-registry.ts",
  "frontend/src/lib/identity-registry.functions.ts",
  "frontend/src/integrations/supabase/types.ts",
] as const;

const MOBILE_CONSUMERS = [
  "mobile/src/api/contracts/mission-contracts.ts",
  "mobile/src/api/contracts/identity-contracts.ts",
  "mobile/src/api/client.ts",
] as const;

function listTsFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
    }
  }
  return out;
}

describe("shared contract package is the single source (@coregrid/contracts)", () => {
  it("declares each canonical vocabulary exactly once — only in packages/contracts", () => {
    const declaration = new RegExp(
      `const (?:${VOCABULARY_NAMES.join("|")}) =`,
      "g",
    );
    const offenders: string[] = [];
    for (const tree of ["packages/contracts/src", "frontend/src", "mobile/src"]) {
      for (const file of listTsFiles(join(repoRoot, tree))) {
        const rel = file.slice(repoRoot.length + 1);
        const count = read(rel).match(declaration)?.length ?? 0;
        if (count === 0) continue;
        if (rel !== "packages/contracts/src/vocabulary.ts") offenders.push(rel);
      }
    }
    expect(offenders, "canonical vocabulary re-declared outside the package").toEqual([]);
  });

  it("every web contract module consumes the package", () => {
    for (const file of FRONTEND_CONTRACT_MODULES) {
      expect(read(file).includes('"@coregrid/contracts"'), `${file} must import from the package`).toBe(true);
    }
  });

  it("every mobile contract consumer imports the package", () => {
    for (const file of MOBILE_CONSUMERS) {
      expect(read(file).includes('"@coregrid/contracts"'), `${file} must import from the package`).toBe(true);
    }
  });

  it("no consumer reaches across trees with relative imports anymore", () => {
    for (const file of listTsFiles(join(repoRoot, "mobile/src")).concat(listTsFiles(join(repoRoot, "frontend/src")))) {
      const rel = file.slice(repoRoot.length + 1);
      const src = read(rel);
      expect(src.includes('"../../../../'), `${rel} escapes its tree via a relative import`).toBe(false);
      expect(src.includes("/mobile/src"), `${rel} imports the mobile tree directly`).toBe(false);
    }
  });

  it("the former two-directional drift shims are retired", () => {
    expect(existsSync(join(repoRoot, "mobile/src/api/contracts/vocabulary.ts"))).toBe(false);
    expect(existsSync(join(repoRoot, "mobile/src/api/contracts/database.ts"))).toBe(false);
  });

  it("the package values remain the closed canonical sets (runtime pin)", () => {
    expect(EXECUTION_STATUSES).toEqual(["admitted", "denied", "rolled_back"]);
    expect(EXTERNAL_EFFECTS).toEqual(["none", "recorded_intent", "compensation_required"]);
    expect(EVIDENCE_LIFECYCLES).toEqual(["active", "superseded", "revoked"]);
    expect(VERIFICATION_DECISIONS).toEqual(["verified", "failed", "inconclusive"]);
    expect(IDENTITY_KINDS).toEqual(["human", "organization", "agent", "service", "device", "runtime"]);
    expect(IDENTITY_STATES).toEqual(["provisioned", "active", "suspended", "archived", "deleted"]);
  });
});

describe("the DB type generator is officially wired into the contracts package (R-wave follow-up)", () => {
  const LEGACY_PATH = "frontend/src/integrations/supabase/types.ts";
  const GENERATOR_PATH = "scripts/generate-database-types.mjs";

  it("package.json declares types:generate and points it at the generator script", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["types:generate"]).toBe("node scripts/generate-database-types.mjs");
  });

  it("the generator script exists and writes ONLY packages/contracts/src/database.ts", () => {
    const src = read(GENERATOR_PATH);
    expect(src.includes('OUTPUT_TARGET = "packages/contracts/src/database.ts"')).toBe(true);
    expect(src.includes("writeFileSync(targetAbs")).toBe(true);
    for (const line of src.split("\n").filter((l) => l.includes(LEGACY_PATH))) {
      const isComment = /^\s*(\*|\/\/)/.test(line);
      expect(
        isComment || line.includes("LEGACY_OUTPUT_PATH"),
        `legacy path may appear only in comments or the write-guard constant: ${line.trim()}`,
      ).toBe(true);
    }
  });

  it("the legacy output path remains a one-line re-export of the package", () => {
    const legacy = read(LEGACY_PATH).trim();
    expect(legacy).toBe('export type { Database, Json } from "@coregrid/contracts";');
    expect(read(LEGACY_PATH).split("\n")).toHaveLength(2);
  });

  it("the contracts README documents the official regeneration path", () => {
    const readme = read("packages/contracts/README.md");
    expect(readme.includes("npm run types:generate")).toBe(true);
    expect(readme.includes("packages/contracts/src/database.ts")).toBe(true);
  });
});
