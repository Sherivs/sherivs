/**
 * CoreGrid — Phase 01 Foundation integrity tests.
 *
 * Validates repository-level foundation invariants so the foundation can be
 * verified mechanically (§9 testing foundation, phase-01 §35/§38/§39):
 * - all 51 registered phase documents exist and match the registry id set;
 * - the machine-readable registry is valid and matches the frontend catalog;
 * - verification scripts run clean (registry validator + secrets scanner);
 * - secrets and build artifacts are git-ignored; `.env` is never tracked;
 * - portable npm verification contracts exist.
 */

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PHASE_CATALOG } from "@/lib/phase-catalog";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const archDir = join(ROOT, "architecture");

/**
 * Non-phase-spec planning/companion docs that may live beside the 51 phase
 * specs. A planning doc MUST be registered here — unregistered companions
 * fail the 51-phase invariant below.
 */
const PHASE_DOC_COMPANIONS = new Set(["phase-04-runtime-build-map.md"]);

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files"], { encoding: "utf8", cwd: ROOT })
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("Phase 01 — phase document integrity", () => {
  it("registers exactly 51 phase documents", () => {
    const docs = readdirSync(archDir).filter(
      (f) => /^phase-\d{2}-.*\.md$/.test(f) && !PHASE_DOC_COMPANIONS.has(f),
    );
    expect(docs.length).toBe(51);
    // Every registered companion must actually exist (registration is enforced).
    const present = new Set(readdirSync(archDir));
    for (const companion of PHASE_DOC_COMPANIONS) {
      expect(present.has(companion), `${companion} is registered as a companion`).toBe(true);
    }
  });

  it("registry.json exists, parses, and registers phases 01–51 in order", () => {
    const registry = JSON.parse(readFileSync(join(archDir, "registry.json"), "utf8"));
    expect(registry.phases.length).toBe(51);
    const ids = registry.phases.map((p: { id: string }) => p.id);
    expect(ids).toEqual(Array.from({ length: 51 }, (_, i) => String(i + 1).padStart(2, "0")));
  });

  it("keeps the frontend phase catalog in sync with the registry (51 phases)", () => {
    const registry = JSON.parse(readFileSync(join(archDir, "registry.json"), "utf8"));
    expect(PHASE_CATALOG.length).toBe(51);
    expect(PHASE_CATALOG.length).toBe(registry.phases.length);
  });
});

describe("Phase 01 — registry and secrets verification contracts", () => {
  it("runs the registry validator cleanly", () => {
    const out = execFileSync("node", ["scripts/verification/registry-validate.mjs"], {
      encoding: "utf8",
      cwd: ROOT,
    });
    expect(out).toContain("REGISTRY VALIDATION PASSED");
  });

  it("runs the secrets scanner cleanly", () => {
    const out = execFileSync("node", ["scripts/verification/secret-scan.mjs"], {
      encoding: "utf8",
      cwd: ROOT,
    });
    expect(out).toContain("SECRET SCAN PASSED");
  });
});

describe("Phase 01 — secrets and ignore hygiene", () => {
  it("gitignores environment files, dependencies, and build output", () => {
    const ignore = readFileSync(join(ROOT, ".gitignore"), "utf8");
    expect(ignore).toMatch(/^\.env($|\.)/m);
    expect(ignore).toMatch(/^node_modules$/m);
    expect(ignore).toMatch(/^dist$/m);
  });

  it("never tracks the real .env file", () => {
    const tracked = trackedFiles();
    expect(tracked).not.toContain(".env");
    expect(existsSync(join(ROOT, ".env.example"))).toBe(true);
    expect(tracked).toContain(".env.example");
  });
});

describe("Phase 01 — portable verification contracts", () => {
  it("exposes the canonical npm verification contracts", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const scripts = pkg.scripts ?? {};
    for (const name of ["typecheck", "test:unit", "verify", "verify:registry", "verify:secrets"]) {
      expect(typeof scripts[name]).toBe("string");
    }
  });
});

describe("Phase 01 — line-ending hygiene (.gitattributes)", () => {
  it("declares canonical LF for code and markdown to prevent CRLF churn", () => {
    const attrs = readFileSync(join(ROOT, ".gitattributes"), "utf8");
    expect(attrs).toContain("* text=auto");
    expect(attrs).toMatch(/\.tsx?\s+text eol=lf/);
    expect(attrs).toMatch(/\.md\s+text eol=lf/);
    expect(attrs).toMatch(/\.sql\s+text eol=lf/);
  });
});

describe("Phase 01 — documentation integrity (no dead governance references)", () => {
  const AGENT_FACING_DOCS = [
    "architecture/README.md",
    "remaining-work.md",
    ".codex/instructions.md",
    ".codex/pull-request-policy.md",
    "backend/README.md",
    "agents/README.md",
    "docs/product-spec.md",
  ];

  it("never references removed governance directories (constitution/, decisions/, progress/)", () => {
    for (const rel of AGENT_FACING_DOCS) {
      const text = readFileSync(join(ROOT, rel), "utf8");
      expect(text).not.toMatch(/`?constitution\//);
      expect(text).not.toMatch(/`?decisions\//);
      expect(text).not.toMatch(/`?progress\//);
    }
  });

  it("points agents at the real root governance documents", () => {
    const archReadme = readFileSync(join(ROOT, "architecture/README.md"), "utf8");
    for (const doc of [
      "CONSTITUTION.md",
      "PRINCIPLES.md",
      "DECISIONS.md",
      "BOUNDARIES.md",
      "DEPENDENCY.md",
      "REGISTRY.md",
      "PROGRESS.md",
    ]) {
      expect(archReadme).toContain(doc);
    }
  });
});

describe("Phase 01 — tracked MCP configuration hygiene (§34)", () => {
  it("embeds no credential material anywhere in .mcp.json env values", () => {
    const mcp = JSON.parse(readFileSync(join(ROOT, ".mcp.json"), "utf8")) as {
      mcpServers?: Record<string, { env?: Record<string, string> }>;
    };
    const values: string[] = [];
    for (const server of Object.values(mcp.mcpServers ?? {})) {
      if (server?.env) values.push(...Object.values(server.env));
    }
    for (const value of values) {
      expect(value).not.toMatch(/https:\/\/[a-z0-9]{16,}\.supabase\.co/);
      expect(value).not.toMatch(/^sb_(secret|publishable)_/);
      expect(value).not.toMatch(/^ghp_/);
    }
  });

  it("does not embed Supabase credentials in the supabase MCP server env", () => {
    const mcp = JSON.parse(readFileSync(join(ROOT, ".mcp.json"), "utf8")) as {
      mcpServers?: Record<string, { env?: Record<string, string> }>;
    };
    const env = mcp.mcpServers?.supabase?.env ?? {};
    for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_PUBLISHABLE_KEY"]) {
      expect(env[name]).toBeUndefined();
    }
  });
});

describe("Phase 01 — development-fixture reality isolation (§45)", () => {
  it("environment-gates the demo provisioning server function", () => {
    const src = readFileSync(join(ROOT, "frontend/src/lib/runtime/scholar/demo-provision.functions.ts"), "utf8");
    expect(src).toContain("ALLOW_DEMO_PROVISIONING");
    expect(src).toContain('!== "true"');
  });

  it("documents the demo provisioning flag as disabled by default", () => {
    const example = readFileSync(join(ROOT, ".env.example"), "utf8");
    expect(example).toMatch(/ALLOW_DEMO_PROVISIONING=false/);
  });
});
