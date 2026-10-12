/**
 * Sherivs customer-facing brand lock.
 *
 * Surfaces a person can read (routes, components, public shell, mobile UI)
 * must not reintroduce the legacy platform name. Compatibility identifiers
 * that still contain it are listed in SHERIVS_BRAND_MIGRATION.md §4.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const LEGACY_PLATFORM_NAME = /\bCoreGrid\b/;

const SURFACE_ROOTS = [
  "frontend/src/routes",
  "frontend/src/components",
  "frontend/src/lib/guidance/page-tips.ts",
  "frontend/src/styles.css",
  "mobile/app",
  "mobile/src/ui",
  "mobile/src/api/errors.ts",
  "public/sw.js",
  "public/robots.txt",
];

function filesUnder(ref: string): string[] {
  const full = join(ROOT, ref);
  if (!statSync(full).isDirectory()) return [full];
  const found: string[] = [];
  for (const entry of readdirSync(full)) {
    const child = join(full, entry);
    if (statSync(child).isDirectory()) {
      found.push(...filesUnder(relative(ROOT, child)));
    } else if (/\.(tsx?|jsx?|css|txt|json|md)$/.test(entry)) {
      found.push(child);
    }
  }
  return found;
}

describe("Sherivs customer-facing brand", () => {
  it("keeps the legacy platform name off surfaces a person can read", () => {
    const hits: string[] = [];
    for (const ref of SURFACE_ROOTS) {
      for (const file of filesUnder(ref)) {
        const text = readFileSync(file, "utf8");
        if (LEGACY_PLATFORM_NAME.test(text)) hits.push(relative(ROOT, file));
      }
    }
    expect(hits).toEqual([]);
  });
});
