import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { customTenantColors } from "../../frontend/src/lib/brand/tenant-colors";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(name) && !name.includes("routeTree.gen") && name !== "tenant-colors.ts") out.push(p);
  }
  return out;
}

describe("Sherivs blue/purple rebrand", () => {
  it("leaves no legacy teal in the frontend (hex, rgb triplet or Tailwind teal-*)", () => {
    const offenders = walk(join(ROOT, "frontend/src")).filter((p) =>
      /#0d9488|13,\s*148,\s*136|\b(?:bg|text|border|stroke|fill|ring|from|to|via)-teal-\d/.test(readFileSync(p, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
  it("defaults the tenant primary, ring and theme-color to Sherivs blue #184efd", () => {
    expect(read("frontend/src/routes/__root.tsx")).toContain('{ name: "theme-color", content: "#184efd" }');
    const css = read("frontend/src/styles.css");
    expect(css).toContain("--tenant-primary: #184efd;");
    expect(css).toContain("--primary-rgb: 24, 78, 253;");
    for (const hex of ["#184efd", "#0d37ca", "#24bffd", "#a872fc", "#0885fa", "#5744fc", "#08154a"]) expect(css).toContain(hex);
    expect(read("frontend/src/routes/__root.tsx")).toContain('{ name: "theme-color", content: "#184efd" }');
  });

  it("ships one reusable logo component with accessible alt text", () => {
    const logo = read("frontend/src/components/brand/sherivs-logo.tsx");
    expect(logo).toContain("export function SherivsLogo");
    expect(logo).toContain("export function SherivsMark");
    expect(logo).toMatch(/alt=\{decorative \? "" : `\$\{PLATFORM_NAME\} logo`\}/);
    for (const f of [
      "frontend/src/components/public/site-header.tsx",
      "frontend/src/routes/auth.tsx",
      "frontend/src/routes/forgot-password.tsx",
      "frontend/src/routes/reset-password.tsx",
      "frontend/src/routes/__root.tsx",
    ]) expect(read(f), f).toMatch(/<Sherivs(Logo|Mark)\b/);
  });

  it("has a 1200x630 OG/Twitter share image wired into the meta", () => {
    const png = readFileSync(join(ROOT, "public/og-image.png"));
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    const idx = read("frontend/src/routes/index.tsx");
    expect(idx).toContain("summary_large_image");
    expect(idx).toContain("/og-image.png");
  });

  it("keeps the logo source master out of the public bundle", () => {
    expect(existsSync(join(ROOT, "public/brand/sherivs-logo-source.png"))).toBe(false);
    expect(existsSync(join(ROOT, "docs/brand/sherivs-logo-source.png"))).toBe(true);
  });

  it("treats the untouched legacy teal/amber DB default as no custom tenant colour", () => {
    expect(customTenantColors("#0d9488", "#f59e0b")).toEqual({ primary: null, secondary: null });
    expect(customTenantColors("#0D9488", null)).toEqual({ primary: null, secondary: null });
    expect(customTenantColors("#c2410c", "#f59e0b")).toEqual({ primary: "#c2410c", secondary: "#f59e0b" });
    expect(customTenantColors(null, null)).toEqual({ primary: null, secondary: null });
  });
});
