/**
 * CoreGrid — V1-012: §27 per-function invariant suite for the command-centre
 * server-function family (Constitution §27), plus the honest-substrate route
 * wiring contract for /command-centre.
 *
 * Machine-checked proof that every exported server function in the
 * control-plane family `frontend/src/lib/command-centre.functions.ts` enforces
 * the full §27 chain — AUTHENTICATE, RESOLVE AUTHORITY (platform super-admin,
 * fail-closed), VALIDATE, EXECUTE (sanctioned substrate), AUDIT (declared
 * pure-read) — and that the /command-centre route consumes ONLY that family
 * with zero fabricated numbers (§57). Static analysis of the family and route
 * source (no network, no database): the manifest is the spec; the source must
 * match it. A §27 gap is never accommodated — it is recorded as a finding.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FAMILY = join(ROOT, "frontend/src/lib/command-centre.functions.ts");
const ROUTE_DIR = join(ROOT, "frontend/src/routes/_authenticated/command-centre");
const DEMO_ROUTE = join(ROOT, "frontend/src/routes/command-centre.tsx");

const src = readFileSync(FAMILY, "utf8");

type FnName = "loadPlatformAuditTrail" | "loadKernelEventOutboxState";

const MANIFEST: Readonly<Record<FnName, { method: "GET"; substrate: RegExp }>> = {
  loadPlatformAuditTrail: { method: "GET", substrate: /\.from\("super_admin_logs"\)/ },
  loadKernelEventOutboxState: {
    method: "GET",
    substrate: /\.from\("cg_event"\)|asKernelAdmin\(/,
  },
};

function serverFnBlocks(source: string): Map<string, string> {
  const marks: { name: string; start: number }[] = [];
  for (const m of source.matchAll(/export const (\w+) = createServerFn/g)) {
    marks.push({ name: m[1], start: m.index });
  }
  const blocks = new Map<string, string>();
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].start : source.length;
    blocks.set(marks[i].name, source.slice(marks[i].start, end));
  }
  return blocks;
}

const blocks = serverFnBlocks(src);

describe("§27 server-function invariants — command-centre.functions.ts (control-plane family)", () => {
  it("inventory: every exported server function is classified and none is unlisted", () => {
    expect(blocks.size, "classified server functions must equal exported ones").toBe(
      Object.keys(MANIFEST).length,
    );
    for (const [name, spec] of Object.entries(MANIFEST)) {
      const block = blocks.get(name);
      expect(block, `${name} block present`).toBeDefined();
      expect(block).toMatch(new RegExp(`createServerFn\\(\\{\\s*method:\\s*"${spec.method}"`));
    }
  });

  it("1 AUTHENTICATE: no anonymous entry — requireSupabaseAuth middleware on every function", () => {
    for (const [name, block] of blocks) {
      expect(block, `${name}: must enter through requireSupabaseAuth`).toMatch(
        /\.middleware\(\[\s*requireSupabaseAuth\s*\]\)/,
      );
    }
  });

  it("2 RESOLVE AUTHORITY: control-plane authority resolved server-side, never from client input", () => {
    for (const [name, block] of blocks) {
      expect(block, `${name}: authority must resolve through requirePlatformSuperAdmin`).toMatch(
        /requirePlatformSuperAdmin\(/,
      );
      expect(block, `${name}: must never query by a client-supplied tenant id`).not.toMatch(
        /\.eq\("(?:school_id|tenant_id)"\s*,\s*data\./,
      );
      expect(block, `${name}: must never stamp a client-supplied tenant id into a row`).not.toMatch(
        /\b(?:school_id|tenant_id|schoolId|tenantId):\s*data\./,
      );
    }
    expect(src, "family must declare no client tenant field (input contracts)").not.toMatch(
      /(?:school_id|schoolId|tenant_id|tenantId):\s*z\./,
    );
  });

  it("3 AUTHORIZE: gate invoked fail-closed with lifecycle/session signals threaded", () => {
    expect(src, "gateSignals helper must thread lifecycle: null").toMatch(/lifecycle:\s*null/);
    expect(src, "gateSignals helper must attest session validity").toMatch(/sessionValid/);
    for (const [name, block] of blocks) {
      expect(block, `${name}: lifecycle signal must be threaded through the gate`).toMatch(
        /requirePlatformSuperAdmin\(context\.supabase,\s*lifecycle\)/,
      );
      expect(block, `${name}: gate signals must be built before the gate call`).toMatch(
        /const lifecycle = gateSignals\(context\.claims\)/,
      );
    }
  });

  it("4 VALIDATE: read-only GET handlers consume no client data", () => {
    for (const [name, block] of blocks) {
      expect(block, `${name}: no-input handler must not consume client data`).not.toMatch(
        /\.handler\(\s*(?:async\s+)?\(\s*\{\s*data\b/,
      );
    }
  });

  it("5 EXECUTE: sanctioned substrate only — no vendor leakage", () => {
    for (const [name, spec] of Object.entries(MANIFEST)) {
      expect(blocks.get(name) ?? "", `${name}: must execute through the sanctioned substrate`).toMatch(
        spec.substrate,
      );
    }
    expect(src, "no vendor SDK import (provider-agnostic, §25)").not.toMatch(
      /from ["'](@supabase\/supabase-js|twilio|paystack)["']/,
    );
  });

  it("6 AUDIT: declared PURE READ — the family must not mutate reality anywhere", () => {
    expect(src, "contract must declare its pure-read audit posture in its own header").toContain(
      "AUDIT — PURE READ",
    );
    expect(src, "pure-read family must not insert").not.toMatch(/\.insert\(/);
    expect(src, "pure-read family must not update").not.toMatch(/\.update\(/);
    expect(src, "pure-read family must not upsert").not.toMatch(/\.upsert\(/);
  });

  it("J-023: time enters only via the kernel time-authority — no direct wall-clock sampling", () => {
    expect(src, "family must compose the kernel time authority").toMatch(
      /const\s+timeAuthority\s*=\s*new\s+TimeAuthority\(\s*new\s+SystemClock\(\)\s*\)/,
    );
    expect(src, "no bare Date.now() sample").not.toMatch(/\bDate\.now\s*\(\s*\)/);
    expect(src, "no bare new Date() sample").not.toMatch(/\bnew\s+Date\s*\(\s*\)/);
  });

  it("domain neutrality: the control-plane family carries no domain vocabulary", () => {
    const banned = [
      "scholar",
      "student",
      "teacher",
      "school",
      "classroom",
      "exam",
      "attendance",
      "fee",
      "fees",
      "payroll",
      "bursar",
      "principal",
    ];
    for (const token of banned) {
      expect(src, `banned domain token "${token}"`).not.toMatch(
        new RegExp(`\\b${token}\\b`, "i"),
      );
    }
  });
});

describe("/command-centre honest-substrate route wiring (V1-012)", () => {
  const routeLayout = join(ROUTE_DIR, "route.tsx");
  const page = join(ROUTE_DIR, "index.tsx");

  it("the hardcoded demo route is gone; the route lives under _authenticated", () => {
    expect(existsSync(DEMO_ROUTE), "routes/command-centre.tsx (demo substrate) must be deleted").toBe(
      false,
    );
    expect(existsSync(routeLayout), "auth layout route must exist").toBe(true);
    expect(existsSync(page), "command-centre page must exist").toBe(true);
  });

  it("the route is permission-gated in the tree (super_admin RoleGuard) and server-gated by the family", () => {
    expect(readFileSync(routeLayout, "utf8")).toMatch(
      /RoleGuard\s+allow=\{\["super_admin"\]\}/,
    );
    expect(src).toMatch(/requirePlatformSuperAdmin/);
  });

  it("the page consumes ONLY the command-centre family server functions", () => {
    const pageSrc = readFileSync(page, "utf8");
    const familyImports = [...pageSrc.matchAll(/from\s+"(@\/lib\/[\w/.-]*functions)"/g)].map(
      (m) => m[1],
    );
    expect(familyImports).toEqual(["@/lib/command-centre.functions"]);
    for (const fn of Object.keys(MANIFEST)) {
      expect(pageSrc, `page must load ${fn}`).toContain(fn);
    }
  });

  it("no fabricated demo values remain on the page (§57)", () => {
    const pageSrc = readFileSync(page, "utf8");
    for (const marker of [
      "tenant:demo",
      "tenant:other",
      "demoSubstrate",
      "projectCommandCentre",
      "createCommandAlert",
      "createIncident",
      "appendIncidentDecision",
      "alert-1",
      "incident-1",
      "decision-1",
    ]) {
      expect(pageSrc, `fabricated demo marker "${marker}" must not render`).not.toContain(marker);
    }
    expect(pageSrc, "planned capability must be rendered honestly").toContain(
      "PlannedCapabilityState",
    );
  });

  it("the pure contract modules stay intact (no destructive refactoring, §39)", () => {
    for (const module of [
      "frontend/src/lib/command-centre.ts",
      "frontend/src/lib/command-alerts.ts",
      "frontend/src/lib/command-incidents.ts",
      "frontend/src/lib/command-core.ts",
      "frontend/src/lib/command-governance.ts",
    ]) {
      expect(existsSync(join(ROOT, module)), `${module} preserved`).toBe(true);
    }
  });
});