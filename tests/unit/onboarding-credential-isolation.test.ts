/**
 * CoreGrid — V1-008: credential-isolation proof suite (AGENTS.md §29/§30).
 *
 * Proves the step-3 objective — fixed demo credentials are eliminated from
 * every production-reachable path:
 *
 * (a) NO CONSTANT CREDENTIALS on production surfaces — the demo provisioning
 *     module carries no password constant anywhere (the initial password is
 *     generated once per run by the platform credential generator and
 *     returned exactly once), and the public /auth route no longer renders
 *     any credential.
 *
 * (b) ENVIRONMENT-GATED ISOLATION — provisionDemoEnterprise keeps its
 *     fail-closed environment gate (ALLOW_DEMO_PROVISIONING !== "true"
 *     throws; default OFF in every environment), documented per Phase 01
 *     §34/§45.
 *
 * (c) THE GENERATOR — generateInitialPassword produces strong, unique,
 *     entropy-backed passwords (>= 20 chars, all four character classes,
 *     unbiased sampling) and refuses weak lengths.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateInitialPassword } from "@/lib/onboarding/generated-credentials";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

/* ─────────────────────────────────────────────────────────────
 * (a) No constant credentials on production surfaces
 * ────────────────────────────────────────────────────────────*/

describe("(a) no constant credentials on production surfaces", () => {
  const DEMO_MODULE = "frontend/src/lib/runtime/scholar/demo-provision.functions.ts";

  it("the demo provisioning module contains no password constant", () => {
    const source = read(DEMO_MODULE);
    // The historical fixed credential is gone from source entirely.
    expect(source).not.toMatch(/Demo@2026/);
    // No object-literal or constant assigns a string password.
    expect(source).not.toMatch(/password\s*:\s*["'`]/);
    // The password is generated at runtime by the platform generator.
    expect(source).toMatch(/generateInitialPassword\(\)/);
    // The accounts table is an identifier list only — no password column.
    expect(source).toMatch(/export const DEMO_ACCOUNTS/);
    expect(source).not.toMatch(/DEMO_CREDENTIALS/);
  });

  it("the public /auth route renders no credentials and no demo entry point", () => {
    const source = read("frontend/src/routes/auth.tsx");
    expect(source).not.toMatch(/DEMO_CREDENTIALS|DEMO_ACCOUNTS/);
    expect(source).not.toMatch(/Demo@2026/);
    expect(source).not.toMatch(/admin@demo\.school/);
    expect(source).not.toMatch(/ADMIN_DEMO/);
    // Sherivs refoundation (§12): the public authentication surface carries no
    // demo provisioning flow at all — sign-in only. Demo provisioning remains
    // an environment-gated, server-side developer fixture, never a public UI.
    expect(source).not.toMatch(/provisionDemoEnterprise/);
    expect(source).not.toMatch(/creds\.password/);
    expect(source).not.toMatch(/Enterprise demo|Sign in as Enterprise demo/i);
  });

  it("no file under frontend/src carries the historical fixed credential", () => {
    const scan = (dir: string): string[] => {
      const entries: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) entries.push(...scan(full));
        else if (/\.(ts|tsx|js|jsx|sql|json)$/.test(entry)) entries.push(full);
      }
      return entries;
    };
    const files = scan(join(ROOT, "frontend/src"));
    expect(files.length).toBeGreaterThan(100);
    for (const file of files) {
      expect(
        readFileSync(file, "utf8"),
        `${file} must not carry a fixed demo credential`,
      ).not.toMatch(/Demo@2026!/);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * (b) Environment-gated fixture isolation stays fail-closed
 * ────────────────────────────────────────────────────────────*/

describe("(b) environment-gated fixture isolation", () => {
  it("provisionDemoEnterprise keeps its fail-closed environment gate", () => {
    const source = read("frontend/src/lib/runtime/scholar/demo-provision.functions.ts");
    // The gate itself (exact frozen form pinned by the §27 invariant suite).
    expect(source).toMatch(/ALLOW_DEMO_PROVISIONING\s*!==\s*["']true["']/);
    // The gate throws before the dynamic service-role import is reached
    // (the top-of-file import is type-only and erased at build time).
    const gateIndex = source.indexOf("ALLOW_DEMO_PROVISIONING");
    const substrateIndex = source.indexOf('import("@/integrations/supabase/client.server")');
    expect(gateIndex).toBeGreaterThan(-1);
    expect(substrateIndex).toBeGreaterThan(gateIndex);
  });

  it("the fixture documents its generated-once credential posture in its own header", () => {
    const source = read("frontend/src/lib/runtime/scholar/demo-provision.functions.ts");
    expect(source).toContain("NO fixed credentials");
    expect(source).toContain("GENERATED ONCE");
  });
});

/* ─────────────────────────────────────────────────────────────
 * (c) The credential generator
 * ────────────────────────────────────────────────────────────*/

describe("(c) generateInitialPassword", () => {
  const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{20,}$/;

  it("produces >= 20 character passwords carrying all four character classes", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateInitialPassword()).toMatch(STRONG_PASSWORD);
    }
  });

  it("is entropy-backed — repeated calls do not repeat values", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(generateInitialPassword());
    expect(seen.size).toBe(200);
  });

  it("honors explicit longer lengths and refuses weak lengths", () => {
    expect(generateInitialPassword(32)).toHaveLength(32);
    expect(() => generateInitialPassword(12)).toThrow();
    expect(() => generateInitialPassword(19)).toThrow();
    expect(() => generateInitialPassword(12.5)).toThrow();
  });
});
