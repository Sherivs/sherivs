import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("seroval override", () => {
  it("pins the TanStack serializer above the advisory range 1.6.10", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      overrides?: { seroval?: string };
    };
    expect(pkg.overrides?.seroval).toBe("1.6.12");
    const lock = readFileSync(join(ROOT, "package-lock.json"), "utf8");
    expect(lock).toContain('"node_modules/seroval"');
    expect(lock).toMatch(/node_modules\/seroval"[\s\S]{0,200}"version": "1\.6\.12"/);
  });
});
