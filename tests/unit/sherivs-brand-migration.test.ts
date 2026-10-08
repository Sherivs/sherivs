/**
 * CoreGrid -> Sherivs brand migration: classification-based, never a blind
 * replace. Customer-facing copy is Sherivs; technical identifiers are preserved.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error — ESM .mjs tooling script without type declarations
import { classifyBrandLine } from "../../scripts/experience/brand-classifier.mjs";
import { SHERIVS_BRAND, canonicalUrl, pageTitle } from "@/lib/experience-system/sherivs-brand";
import { PLATFORM_NAME } from "@/lib/platform";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("classifier", () => {
  const cases: Array<[string, string, string]> = [
    ['title: "Welcome to CoreGrid",', "frontend/src/routes/x.tsx", "CUSTOMER_FACING"],
    ['toast.error("CoreGrid could not save")', "frontend/src/routes/x.tsx", "CUSTOMER_FACING"],
    ['import { x } from "@coregrid/contracts";', "frontend/src/lib/x.ts", "TECHNICAL_IDENTIFIER"],
    ["export interface CoreGridTenant {", "frontend/src/lib/x.ts", "TECHNICAL_IDENTIFIER"],
    ['const BUCKET = "coregrid-files";', "frontend/src/lib/x.ts", "TECHNICAL_IDENTIFIER"],
    ['ref: "secret://coregrid/stripe"', "frontend/src/lib/x.ts", "TECHNICAL_IDENTIFIER"],
    ["const COREGRID_ROLES = [", "frontend/src/lib/x.ts", "TECHNICAL_IDENTIFIER"],
    ["// CoreGrid platform note", "frontend/src/lib/x.ts", "COMMENT"],
    ["CoreGrid", "frontend/src/lib/kernel/anything.ts", "REGISTRY_BOUND"],
    ["CoreGrid", "database/supabase/migrations/1.sql", "INFRASTRUCTURE_OR_DB"],
    ["CoreGrid", "architecture/doc.md", "GOVERNANCE_DOC"],
    ["CoreGrid", "tests/unit/x.test.ts", "TEST"],
  ];
  it.each(cases)("classifies %s in %s as %s", (line, file, expected) => {
    expect(classifyBrandLine(line, file)).toBe(expected);
  });

  it("leaves the AI prompt for reviewed change instead of silently rewriting it", () => {
    expect(
      classifyBrandLine("You are the CoreGrid assistant", "frontend/src/lib/worker-launch-runtime.server.ts"),
    ).toBe("AI_PROMPT");
  });
});

describe("customer-facing source is migrated", () => {
  function walk(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, acc);
      else if (/\.(ts|tsx)$/.test(full) && !full.endsWith("routeTree.gen.ts")) acc.push(full);
    }
    return acc;
  }

  it("leaves no CUSTOMER_FACING 'CoreGrid' line in frontend or public zones", () => {
    const offenders: string[] = [];
    for (const zone of ["frontend/src", "mobile/src", "mobile/app"]) {
      let files: string[] = [];
      try {
        files = walk(join(ROOT, zone));
      } catch {
        continue;
      }
      for (const file of files) {
        const rel = relative(ROOT, file).split(sep).join("/");
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (rel === "frontend/src/lib/experience-system/sherivs-brand.ts" && /legacyName:/.test(line)) return;
            if (/coregrid/i.test(line) && classifyBrandLine(line, rel) === "CUSTOMER_FACING") {
              offenders.push(`${rel}:${i + 1}`);
            }
          });
      }
    }
    expect(offenders).toEqual([]);
  });

  it("preserves technical compatibility identifiers (no blind replace)", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { name: string };
    expect(pkg.name).toBe("coregrid-scholar");
  });
});

describe("identity", () => {
  it("makes Sherivs the customer-facing platform name from one source", () => {
    expect(PLATFORM_NAME).toBe("Sherivs");
    expect(SHERIVS_BRAND.name).toBe("Sherivs");
    expect(SHERIVS_BRAND.category).toBe("Institutional Intelligence Infrastructure");
  });

  it("registers product names without making them separate brands", () => {
    expect(SHERIVS_BRAND.products.scholar.name).toBe("Sherivs Scholar");
    expect(SHERIVS_BRAND.products.jarvis.name).toBe("Jarvis");
    expect(SHERIVS_BRAND.products.aiWorkforce.name).toBe("Sherivs AI Workforce");
  });

  it("uses sherivs.com as the canonical origin", () => {
    expect(canonicalUrl("/")).toBe("https://sherivs.com/");
    expect(canonicalUrl("platform/")).toBe("https://sherivs.com/platform");
    expect(pageTitle("Security")).toBe("Security — Sherivs");
  });

  it("keeps legacy hosts resolvable as platform hosts so tenant resolution does not break", () => {
    const tenant = readFileSync(join(ROOT, "frontend/src/lib/tenant.ts"), "utf8");
    for (const host of ["sherivs.com", "www.sherivs.com", "app.sherivs.com", "universalschoolos.com"]) {
      expect(tenant).toContain(`"${host}"`);
    }
  });
});
