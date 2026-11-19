import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  KIB,
  SHELL_ROOTS,
  evaluateBudgets,
  formatReport,
  parseAllowlist,
  // @ts-expect-error plain .mjs script without types
} from "../../scripts/verify-route-budgets.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** A fake manifest: the shell roots, one shared chunk, and three lazy chunks. */
function fakeManifest() {
  return {
    [SHELL_ROOTS[0]]: { file: "assets/entry.js", isEntry: true, imports: ["_react.js"] },
    [SHELL_ROOTS[1]]: {
      file: "assets/home-route.js",
      isDynamicEntry: true,
      imports: ["_react.js"],
    },
    [SHELL_ROOTS[2]]: { file: "assets/home-index.js", isDynamicEntry: true, imports: [] },
    "_react.js": { file: "assets/react.js" },
    "_shared.js": { file: "assets/shared.js", imports: ["_react.js"] },
    "screen-small.tsx": { file: "assets/small.js", isDynamicEntry: true, imports: ["_shared.js"] },
    "screen-big.tsx": { file: "assets/big.js", isDynamicEntry: true, imports: ["_react.js"] },
    "style.css": { file: "assets/style.css", isDynamicEntry: true },
  };
}

const SIZES: Record<string, number> = {
  "assets/entry.js": 100 * KIB,
  "assets/home-route.js": 20 * KIB,
  "assets/home-index.js": 10 * KIB,
  "assets/react.js": 50 * KIB,
  "assets/shared.js": 30 * KIB,
  "assets/small.js": 20 * KIB,
  "assets/big.js": 90 * KIB,
};
const gzipSize = (file: string) => {
  const size = SIZES[file];
  if (size === undefined) throw new Error(`unexpected file ${file}`);
  return size;
};

describe("M23 route budgets", () => {
  it("measures the shell once per file and reports the 170 KiB target without failing", () => {
    const result = evaluateBudgets({
      manifest: fakeManifest(),
      gzipSize,
      allowlist: parseAllowlist({
        entries: [{ key: "screen-big.tsx", maxGzipBytes: 95 * KIB, reason: "r" }],
      }),
    });
    // entry 100 + home-route 20 + home-index 10 + react 50 (counted once) = 180 KiB.
    expect(result.shell.bytes).toBe(180 * KIB);
    expect(result.shell.overTarget).toBe(true);
    expect(result.shell.overLimit).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w: string) => w.includes("target"))).toBe(true);
  });

  it("fails the shell only above the 250 KiB limit", () => {
    const big: Record<string, number> = { ...SIZES, "assets/entry.js": 200 * KIB };
    const result = evaluateBudgets({ manifest: fakeManifest(), gzipSize: (f: string) => big[f] });
    expect(result.shell.overLimit).toBe(true);
    expect(result.failures.some((f: string) => f.startsWith("shell:"))).toBe(true);
  });

  it("counts a lazy chunk's own file plus static imports not already in the shell", () => {
    const result = evaluateBudgets({ manifest: fakeManifest(), gzipSize });
    const small = result.chunks.find((c: { key: string }) => c.key === "screen-small.tsx");
    // small 20 + shared 30; react is in the shell and is not counted again.
    expect(small.bytes).toBe(50 * KIB);
    expect(small.status).toBe("ok");
    // CSS-only dynamic entries are not JavaScript chunks.
    expect(result.chunks.some((c: { key: string }) => c.key === "style.css")).toBe(false);
  });

  it("fails a lazy chunk over 60 KiB that is not allowlisted", () => {
    const result = evaluateBudgets({ manifest: fakeManifest(), gzipSize });
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([expect.stringContaining("screen-big.tsx")]);
    expect(formatReport(result)).toContain("STATUS=FAIL");
  });

  it("holds an allowlisted chunk to its recorded ceiling", () => {
    const within = evaluateBudgets({
      manifest: fakeManifest(),
      gzipSize,
      allowlist: parseAllowlist({
        entries: [{ key: "screen-big.tsx", maxGzipBytes: 90 * KIB, reason: "r" }],
      }),
    });
    expect(within.ok).toBe(true);
    expect(within.chunks.find((c: { key: string }) => c.key === "screen-big.tsx").status).toBe(
      "allowlisted",
    );

    const grown = evaluateBudgets({
      manifest: fakeManifest(),
      gzipSize,
      allowlist: parseAllowlist({
        entries: [{ key: "screen-big.tsx", maxGzipBytes: 80 * KIB, reason: "r" }],
      }),
    });
    expect(grown.ok).toBe(false);
    expect(grown.failures[0]).toContain("allowlisted ceiling");
  });

  it("warns about stale allowlist entries instead of failing", () => {
    const result = evaluateBudgets({
      manifest: fakeManifest(),
      gzipSize,
      allowlist: parseAllowlist({
        entries: [
          { key: "screen-big.tsx", maxGzipBytes: 90 * KIB, reason: "r" },
          { key: "screen-small.tsx", maxGzipBytes: 70 * KIB, reason: "r" },
          { key: "gone.tsx", maxGzipBytes: 70 * KIB, reason: "r" },
        ],
      }),
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w: string) => w.startsWith("screen-small.tsx"))).toBe(true);
    expect(result.warnings.some((w: string) => w.startsWith("gone.tsx"))).toBe(true);
  });

  it("rejects malformed or duplicate allowlist entries", () => {
    expect(() => parseAllowlist({})).toThrow();
    expect(() => parseAllowlist({ entries: [{ key: "a", maxGzipBytes: 1 }] })).toThrow();
    expect(() =>
      parseAllowlist({ entries: [{ key: "a", maxGzipBytes: 1.5, reason: "r" }] }),
    ).toThrow();
    expect(() =>
      parseAllowlist({
        entries: [
          { key: "a", maxGzipBytes: 1, reason: "r" },
          { key: "a", maxGzipBytes: 2, reason: "r" },
        ],
      }),
    ).toThrow(/duplicate/);
  });

  it("refuses a manifest without the shell roots", () => {
    expect(() => evaluateBudgets({ manifest: {}, gzipSize })).toThrow(/Missing shell bundle entry/);
  });

  it("ships a well-formed allowlist that is marked as pending review", () => {
    const raw = JSON.parse(
      readFileSync(join(ROOT, "scripts/verification/route-budget-allowlist.json"), "utf8"),
    );
    const parsed = parseAllowlist(raw);
    expect(parsed.size).toBeGreaterThan(0);
    expect(raw.review.status).toBe("PENDING");
    for (const entry of raw.entries)
      expect(entry.maxGzipBytes).toBeGreaterThanOrEqual(entry.measuredGzipBytes);
  });

  it("is an npm script but not part of the verify chain until the allowlist is reviewed", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(pkg.scripts["verify:route-budgets"]).toBe("node scripts/verify-route-budgets.mjs");
    expect(pkg.scripts.verify).not.toContain("route-budgets");
  });
});
