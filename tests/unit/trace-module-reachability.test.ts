/**
 * Sherivs — unit tests for scripts/trace-module-reachability.mjs (mission M1b / E-005).
 *
 * Builds small in-memory repositories and proves the tracer finds every import
 * form, follows chains transitively, and never counts a test as an entry.
 */
import { describe, expect, it } from "vitest";
import {
  buildGraph,
  extractSpecifiers,
  findQuarantineImporters,
  isEntryFile,
  moduleFiles,
  resolveSpecifier,
  traceModule,
} from "../../scripts/trace-module-reachability.mjs";

describe("extractSpecifiers", () => {
  it("finds static, type-only, re-export, dynamic and require imports", () => {
    const specifiers = extractSpecifiers(
      [
        'import a from "./a";',
        'import type { B } from "./b";',
        'export * from "./c";',
        'export { d } from "./d";',
        'const e = await import("./e");',
        'const f = require("./f");',
        'type G = typeof import("./g");',
      ].join("\n"),
    );
    expect(specifiers).toEqual(
      expect.arrayContaining(["./a", "./b", "./c", "./d", "./e", "./f", "./g"]),
    );
  });

  it("ignores import-like text inside strings and comments", () => {
    expect(
      extractSpecifiers('// import x from "./nope";\nconst s = "import(\'./also-no\')";'),
    ).toEqual([]);
  });
});

describe("resolveSpecifier", () => {
  const files = new Set([
    "frontend/src/lib/x.ts",
    "frontend/src/lib/folder/index.ts",
    "frontend/src/lib/y.tsx",
  ]);
  it("resolves relative, alias, extensionless, .js-for-.ts and folder index", () => {
    expect(resolveSpecifier("frontend/src/lib/a/b.ts", "../x", files)).toBe(
      "frontend/src/lib/x.ts",
    );
    expect(resolveSpecifier("tests/unit/t.ts", "@/lib/x", files)).toBe("frontend/src/lib/x.ts");
    expect(resolveSpecifier("frontend/src/lib/z.ts", "./x.js", files)).toBe(
      "frontend/src/lib/x.ts",
    );
    expect(resolveSpecifier("frontend/src/lib/z.ts", "./folder", files)).toBe(
      "frontend/src/lib/folder/index.ts",
    );
    expect(resolveSpecifier("frontend/src/lib/z.ts", "./y", files)).toBe("frontend/src/lib/y.tsx");
  });
  it("returns null for packages and missing files", () => {
    expect(resolveSpecifier("frontend/src/lib/z.ts", "zod", files)).toBeNull();
    expect(resolveSpecifier("frontend/src/lib/z.ts", "./missing", files)).toBeNull();
  });
});

describe("isEntryFile", () => {
  it("treats routes, components and server entries as entries, never tests", () => {
    expect(isEntryFile("frontend/src/routes/index.tsx")).toBe(true);
    expect(isEntryFile("frontend/src/components/a/b.tsx")).toBe(true);
    expect(isEntryFile("frontend/src/server.ts")).toBe(true);
    expect(isEntryFile("frontend/src/lib/x.ts")).toBe(false);
    expect(isEntryFile("tests/unit/x.test.ts")).toBe(false);
    expect(isEntryFile("frontend/src/components/a/b.test.tsx")).toBe(false);
  });
});

describe("traceModule", () => {
  const sources: Record<string, string> = {
    "frontend/src/routes/home.tsx": 'import { v } from "@/lib/surface";',
    "frontend/src/lib/surface.ts": 'export * from "./barrel";',
    "frontend/src/lib/barrel/index.ts": 'export { live } from "../live-mod/contracts";',
    "frontend/src/lib/live-mod/contracts.ts": "export const live = 1;",
    "frontend/src/components/lazy.tsx": 'const m = () => import("../lib/lazy-mod");',
    "frontend/src/lib/lazy-mod.ts": "export const lazy = 1;",
    "frontend/src/lib/dead-mod/contracts.ts": 'import { live } from "../live-mod/contracts";',
    "frontend/src/lib/dead-helper.ts": 'import type { X } from "./dead-mod/contracts";',
    "tests/unit/dead.test.ts": 'import "../../frontend/src/lib/dead-mod/contracts";',
  };
  const graph = buildGraph(sources);

  it("reports REACHABLE with a chain through a barrel re-export", () => {
    const result = traceModule("live-mod", graph);
    expect(result.status).toBe("REACHABLE");
    expect(result.chain).toEqual([
      "frontend/src/routes/home.tsx",
      "frontend/src/lib/surface.ts",
      "frontend/src/lib/barrel/index.ts",
      "frontend/src/lib/live-mod/contracts.ts",
    ]);
  });

  it("reports REACHABLE through a dynamic import of a single-file module", () => {
    const result = traceModule("lazy-mod", graph);
    expect(result.status).toBe("REACHABLE");
    expect(result.files).toEqual(["frontend/src/lib/lazy-mod.ts"]);
    expect(result.chain?.[0]).toBe("frontend/src/components/lazy.tsx");
  });

  it("reports UNREACHABLE when only tests and other dead files import it", () => {
    const result = traceModule("dead-mod", graph);
    expect(result.status).toBe("UNREACHABLE");
    expect(result.chain).toBeNull();
    expect(result.directImporters).toEqual(["frontend/src/lib/dead-helper.ts"]);
    expect(result.directTestImporters).toEqual(["tests/unit/dead.test.ts"]);
  });

  it("reports MISSING for an unknown module", () => {
    expect(traceModule("nope", graph).status).toBe("MISSING");
  });

  it("matches a folder or a single file, not a name prefix", () => {
    expect(moduleFiles("dead", [...graph.keys()])).toEqual([]);
  });
});

describe("findQuarantineImporters", () => {
  it("lists files outside the quarantine that import into it", () => {
    const graph = buildGraph({
      "frontend/src/lib/_quarantine/m/contracts.ts": 'import "../../ok";',
      "frontend/src/lib/_quarantine/m/inner.ts": 'import "./contracts";',
      "frontend/src/lib/ok.ts": "",
      "frontend/src/lib/bad.ts": 'import "@/lib/_quarantine/m/contracts";',
    });
    expect(findQuarantineImporters(graph)).toEqual([
      { file: "frontend/src/lib/bad.ts", imports: "frontend/src/lib/_quarantine/m/contracts.ts" },
    ]);
  });
});
