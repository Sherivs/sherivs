import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TenantId } from "../../frontend/src/lib/tenant-core";
import { ORG_AGENTS, MEMBERSHIP_ROLES } from "../../frontend/src/lib/org-workforce/org-agents";
import {
  TIER_ORDER,
  minTierOf,
  orgAgentEntitlement,
} from "../../frontend/src/lib/org-workforce/packaging";
import {
  ACK_WINDOW_MIN,
  buildWeeklyReport,
  nextWeeklySendAt,
} from "../../frontend/src/lib/org-workforce/escalation";

const TENANT = "t1" as TenantId;
const FILE = "database/proposals/ENGINE-20_org_agent_addons_events_reports.sql";
const CHECK = "database/proposals/ENGINE-20_org_agent_addons_events_reports.check.sql";
const sql = readFileSync(FILE, "utf8");
const check = readFileSync(CHECK, "utf8");
const live = sql.split("-- Rollback (for the migration")[0]!;

const seedRows = (): { code: string; accountable: string; minTier: string }[] => {
  const block = /min_tier\) VALUES\n([\s\S]*?)\nON CONFLICT/.exec(live)![1]!;
  return [...block.matchAll(/\('([^']+)', '([^']+)', '([^']+)'\)/g)].map((m) => ({
    code: m[1]!,
    accountable: m[2]!,
    minTier: m[3]!,
  }));
};
const inList = (re: RegExp): string[] =>
  [...re.exec(live)![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);

describe("ENGINE-20 SQL proposal stays in step with the code", () => {
  it("is kept as the reviewed source outside the migrations folder, and says what its status is", () => {
    expect(FILE.startsWith("database/proposals/")).toBe(true);
    expect(sql.split("\n")[0]).toMatch(/^-- APPLIED TO PRODUCTION 2026-11-15\./);
    expect(sql).toContain("ops/2026-11-15-apply-engine20-engine22/");
    expect(check.split("\n")[0]).toMatch(
      /^-- SCRATCH-DATABASE CHECK\. NEVER RUN ON A REAL PROJECT\./,
    );
  });

  it("seeds exactly the agents in the code, with the same accountable role and plan", () => {
    const rows = seedRows();
    expect(rows).toHaveLength(ORG_AGENTS.length);
    for (const a of ORG_AGENTS) {
      const row = rows.find((r) => r.code === a.pack.code);
      expect(row, a.pack.code).toBeDefined();
      expect(row!.accountable, a.pack.code).toBe(a.accountable);
      expect(row!.minTier, a.pack.code).toBe(minTierOf(a));
    }
  });

  it("allows only the roles and plans the code knows", () => {
    expect(inList(/accountable IN\s*\(([^)]*)\)/).sort()).toEqual([...MEMBERSHIP_ROLES].sort());
    expect(inList(/min_tier IN \(([^)]*)\)/)).toEqual([...TIER_ORDER]);
    expect(inList(/ARRAY\[('trial'[^\]]*)\]/)).toEqual([...TIER_ORDER]);
  });

  it("uses the same event kinds, severities and channels as the escalation code", () => {
    const report = buildWeeklyReport({
      tenantId: "t",
      events: [],
      windowEndIso: "2026-11-16T06:30:00Z",
      administratorWhatsappVerified: true,
    });
    expect(inList(/kind\s+text NOT NULL CHECK \(kind IN \(([^)]*)\)/).sort()).toEqual(
      Object.keys(report.totals.byKind).sort(),
    );
    expect(inList(/severity\s+text NOT NULL CHECK \(severity IN \(([^)]*)\)/).sort()).toEqual(
      Object.keys(ACK_WINDOW_MIN).sort(),
    );
    expect(inList(/channel\s+text NOT NULL CHECK \(channel IN \(('push'[^)]*)\)/).sort()).toEqual([
      "email",
      "in_app",
      "push",
      "whatsapp",
    ]);
  });

  it("agrees with the plan rule: an unknown plan counts as the trial", () => {
    for (const a of ORG_AGENTS) {
      const unknown = orgAgentEntitlement(TENANT, "mystery", a.pack.code);
      const trial = orgAgentEntitlement(TENANT, "trial", a.pack.code);
      expect(unknown.tier).toBe("trial");
      expect(unknown.entitled).toBe(trial.entitled);
    }
    expect(live).toMatch(
      /coalesce\(\s*array_position\(ARRAY\[[^\]]*\], lower\(btrim\(p_tier\)\)\),\s*1\s*\)/,
    );
  });

  it("matches the weekly schedule documented in the code (Monday 07:30 Lagos = 06:30 UTC)", () => {
    expect(nextWeeklySendAt("2026-11-15T12:00:00Z")).toBe("2026-11-16T06:30:00.000Z");
    expect(sql).toContain("every Monday at 06:30 UTC (07:30 Africa/Lagos)");
  });

  it("keeps the safety rules in the database, not only in the app", () => {
    for (const rule of [
      "org_agent_events_safeguarding_no_text",
      "org_notification_redacted_has_no_summary",
      "safeguarding_must_be_redacted",
      "platform_action_needs_sheriff",
      "paused_by_platform",
      "plan_excludes_agent",
      "organization_inactive",
      "org_agent_events only allows a single acknowledgement",
      "FOR UPDATE SKIP LOCKED",
    ]) {
      expect(live, rule).toContain(rule);
    }
  });

  it("forces row-level security on every table and pins search_path on every function", () => {
    const tables = [...live.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)].map((m) => m[1]);
    expect(tables).toHaveLength(5);
    for (const t of tables) {
      expect(live, t).toContain(`ALTER TABLE public.${t}`);
      expect(live, t).toMatch(new RegExp(`${t}\\s+FORCE ROW LEVEL SECURITY`));
    }
    const fns = live.split("CREATE OR REPLACE FUNCTION").slice(1);
    expect(fns.length).toBeGreaterThanOrEqual(12);
    for (const f of fns) expect(f.split("$$")[0], f.slice(0, 60)).toContain("SET search_path = ''");
  });

  it("never hands write access to ordinary users and never touches existing tables", () => {
    expect(live).not.toMatch(
      /GRANT[^;]*\b(INSERT|UPDATE|DELETE)\b[^;]*\bTO\b[^;]*\bauthenticated\b/i,
    );
    expect(live).not.toMatch(/\bALTER TABLE public\.(schools|users)\b/);
    expect(live).not.toMatch(/\bDROP TABLE\b(?![^\n]*IF EXISTS)/);
  });

  it("carries a matching rollback for everything it creates", () => {
    const rollback = sql.split("-- Rollback (for the migration")[1]!;
    for (const m of live.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)) {
      expect(rollback, m[1]).toContain(`DROP TABLE IF EXISTS public.${m[1]};`);
    }
    for (const m of live.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)) {
      expect(rollback, m[1]).toContain(`public.${m[1]}(`);
    }
  });
});
