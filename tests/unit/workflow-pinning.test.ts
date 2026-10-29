import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const workflows = readdirSync(join(ROOT, ".github/workflows")).filter((name) => name.endsWith(".yml"));

describe("GitHub Actions pinning", () => {
  it("pins every action to a commit SHA", () => {
    const floating: string[] = [];
    for (const name of workflows) {
      const text = readFileSync(join(ROOT, ".github/workflows", name), "utf8");
      for (const match of text.matchAll(/^\s*uses:\s*(\S+)/gm)) {
        const ref = match[1] ?? "";
        if (!/@[0-9a-f]{40}$/.test(ref)) floating.push(`${name}: ${ref}`);
      }
    }
    expect(floating).toEqual([]);
  });

  it("checks the gitleaks archive and does not install a floating Vercel CLI", () => {
    const verify = readFileSync(join(ROOT, ".github/workflows/verify.yml"), "utf8");
    expect(verify).toContain("sha256sum -c");
    expect(verify).toContain("vercel@65.7.0");
    expect(verify).not.toContain("vercel@latest");
  });
});
