import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SEED_BEGIN,
  SEED_END,
  TIER_ACTION_CLASSES,
  engineActorSeedSql,
  engineAgentRecords,
  tierActionClassSeedSql,
} from "../../frontend/src/lib/workforce-charter/engine-actors";
import { workforceRoster } from "../../frontend/src/lib/workforce-charter/roster";
import { ORG_AGENTS } from "../../frontend/src/lib/org-workforce/org-agents";

const MIGRATION =
  "database/supabase/migrations/20261117000970_sherivs_ain01_agents_as_engine_actors.sql";
const ROLLBACK =
  "database/supabase/rollbacks/20261117000970_sherivs_ain01_agents_as_engine_actors.sql";
const ENGINE20 = "database/proposals/ENGINE-20_org_agent_addons_events_reports.sql";
const migration = readFileSync(MIGRATION, "utf8");
const rollback = readFileSync(ROLLBACK, "utf8");
const records = engineAgentRecords();
const platform = records.filter((r) => r.family === "platform");
const org = records.filter((r) => r.family === "org");

describe("AIN-01 engine actors (ADR-125): definitions", () => {
  it("covers the whole workforce: 25 platform agents and 17 organization agents, unique codes", () => {
    expect(platform).toHaveLength(25);
    expect(org).toHaveLength(17);
    expect(platform).toHaveLength(workforceRoster().length);
    expect(org).toHaveLength(ORG_AGENTS.length);
    expect(new Set(records.map((r) => r.agentRef)).size).toBe(records.length);
  });

  it("every code fits the database identity pattern and the pause-rule pattern", () => {
    for (const r of records) {
      expect(r.agentRef, r.agentRef).toMatch(/^[a-z][a-z0-9-]{1,60}$/);
    }
    for (const r of org) expect(r.agentRef).toMatch(/^org-[a-z0-9-]{2,40}$/);
    for (const r of platform) expect(r.agentRef.startsWith("org-")).toBe(false);
  });

  it("organization agent codes are exactly the codes of the applied organization catalogue (ENGINE-20)", () => {
    const live = readFileSync(ENGINE20, "utf8").split("-- Rollback (for the migration")[0]!;
    const block = /min_tier\) VALUES\n([\s\S]*?)\nON CONFLICT/.exec(live)![1]!;
    const codes = [...block.matchAll(/\('([^']+)', '[^']+', '[^']+'\)/g)].map((m) => m[1]!);
    expect([...codes].sort()).toEqual(org.map((r) => r.agentRef).sort());
  });

  it("platform supervision matches the charters: executive to the sheriff, departments to the executive, assurance to the sheriff", () => {
    const executives = platform.filter((r) => r.agentTier === "executive");
    expect(executives).toHaveLength(1);
    expect(executives[0]!.supervisor).toBe("sheriff");
    for (const r of platform) {
      if (r.agentTier === "department") expect(r.supervisor).toBe(executives[0]!.agentRef);
      if (r.agentTier === "assurance") expect(r.supervisor).toBe("sheriff");
      expect(r.supervisor).not.toBeNull();
      expect(r.supervisor).not.toBe(r.agentRef);
    }
    for (const r of org) {
      expect(r.supervisor).toBeNull();
      expect(r.agentTier).toBe("organization");
    }
  });

  it("the charter rules hold: assurance agents never above T1, organization agents never above T2, nothing above T1 is autonomous", () => {
    for (const r of records) {
      if (r.agentTier === "assurance") expect(["T0", "T1"], r.agentRef).toContain(r.maxTier);
      if (r.family === "org") expect(["T0", "T1", "T2"], r.agentRef).toContain(r.maxTier);
      for (const c of r.capabilities) {
        if (c.autonomy === "act_autonomously")
          expect(["T0", "T1"], `${r.agentRef}.${c.id}`).toContain(c.tier);
      }
    }
  });

  it("an agent's highest tier is its highest capability tier and every agent has capabilities and a positive budget", () => {
    for (const r of records) {
      expect(r.capabilities.length, r.agentRef).toBeGreaterThan(0);
      const top = r.capabilities.map((c) => Number(c.tier[1])).reduce((a, b) => Math.max(a, b), 0);
      expect(Number(r.maxTier[1]), r.agentRef).toBe(top);
      expect(r.dailyActions).toBeGreaterThan(0);
      expect(r.dailyModelCalls).toBeGreaterThanOrEqual(0);
    }
  });

  it("only the highest tiers can reach the capped classes; observe-only tiers cannot communicate or run unclassified actions", () => {
    const capped = [
      "money_movement",
      "safeguarding",
      "credential_change",
      "public_publish",
      "mass_message",
      "external_authority_share",
    ];
    for (const t of ["T0", "T1", "T2"] as const) {
      for (const c of capped) expect(TIER_ACTION_CLASSES[t]).not.toContain(c);
    }
    for (const c of capped) expect(TIER_ACTION_CLASSES.T3).toContain(c);
    expect(TIER_ACTION_CLASSES.T0).not.toContain("communication");
    expect(TIER_ACTION_CLASSES.T1).not.toContain("communication");
    expect(TIER_ACTION_CLASSES.T2).toContain("communication");
    expect(TIER_ACTION_CLASSES.T0).not.toContain("unclassified");
    expect(TIER_ACTION_CLASSES.T1).toContain("unclassified");
  });

  it("the module is pure: no network, environment, clock or server import", () => {
    const text = readFileSync("frontend/src/lib/workforce-charter/engine-actors.ts", "utf8");
    expect(text).not.toMatch(/\bfetch\s*\(/);
    expect(text).not.toMatch(/process\.env|import\.meta\.env/);
    expect(text).not.toMatch(/Date\.now|new Date\(/);
    expect(text).not.toMatch(/\.server["']/);
    expect(text).not.toMatch(/\bapi\.openai\.com|anthropic\.com/i);
  });
});

describe("AIN-01 engine actors (ADR-125): migration", () => {
  it("the generated seed in the migration is exactly what the definitions render (regenerate with scripts/ops/generate-ain01-agent-seed.mjs)", () => {
    expect(migration).toContain(engineActorSeedSql(records));
    expect(migration).toContain(tierActionClassSeedSql());
    expect(migration.split(SEED_BEGIN)).toHaveLength(2);
    expect(migration.split(SEED_END)).toHaveLength(2);
  });

  it("is marked not applied, transactional, with a paired rollback that is marked the same way", () => {
    expect(migration.split("\n")[0]).toMatch(/^-- NOT APPLIED\./);
    expect(migration).toMatch(/^BEGIN;$/m);
    expect(migration).toMatch(/^COMMIT;$/m);
    expect(rollback.split("\n")[0]).toMatch(/^-- NOT APPLIED\./);
  });

  it("forces row level security on all four tables and revokes every client privilege including the service role's writes", () => {
    for (const t of [
      "wf_agent",
      "wf_agent_capability",
      "wf_agent_tier_action_class",
      "wf_agent_platform_grant",
    ]) {
      expect(migration).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(migration).toContain(`ALTER TABLE public.${t} FORCE ROW LEVEL SECURITY;`);
    }
    expect(migration).toMatch(
      /REVOKE ALL ON public\.wf_agent,[\s\S]*FROM PUBLIC, anon, authenticated, service_role;/,
    );
    expect(migration).not.toMatch(
      /GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*TO (anon|authenticated|service_role)/,
    );
  });

  it("never writes the autonomy table or any approval, send or wallet object", () => {
    const code = migration
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(code).not.toMatch(/(INSERT INTO|UPDATE|DELETE FROM)\s+public\.wf_agent_autonomy/);
    expect(code).not.toMatch(
      /(INSERT INTO|UPDATE|DELETE FROM)\s+public\.(wf_approval|school_wallets|wf_action_)/,
    );
  });

  it("keeps the AI route undecided and refuses ai steps until it is approved", () => {
    expect(migration).toMatch(
      /CREATE FUNCTION public\.wf_ai_route_approved\(\)\s+RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = ''\s+AS \$\$ SELECT false \$\$;/,
    );
    expect(migration).toContain("NEW.kind = 'ai' AND NOT public.wf_ai_route_approved()");
  });

  it("every function pins an empty search_path", () => {
    const fns =
      migration.match(/CREATE FUNCTION public\.[a-z_0-9]+\([\s\S]*?\n(?:AS|LANGUAGE)/g) ?? [];
    expect(fns.length).toBeGreaterThanOrEqual(8);
    for (const f of fns) expect(f, f.slice(0, 80)).toMatch(/SET search_path = ''/);
  });
});
