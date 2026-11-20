import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const VERSION = "20261117000960";
const NAME = "sherivs_wf12_quotas_wallet_caps_retention.sql";
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const up = read(`database/supabase/migrations/${VERSION}_${NAME}`);
const down = read(`database/supabase/rollbacks/${VERSION}_${NAME}`);

describe("WF-12 migration (static)", () => {
  it("is marked NOT APPLIED, sits after WF-08 and below the next reserved slot", () => {
    expect(up.startsWith("-- NOT APPLIED")).toBe(true);
    expect(down.startsWith("-- NOT APPLIED")).toBe(true);
    expect(Number(VERSION)).toBeGreaterThan(20261117000950);
    expect(Number(VERSION)).toBeLessThan(20261117001000);
  });

  it("never loosens grants or row security", () => {
    expect(up).not.toMatch(/GRANT[^;]*\bTO\s+(anon|PUBLIC)\b/);
    // Clients may read through row security, never write.
    expect(up).not.toMatch(
      /GRANT[^;]*(INSERT|UPDATE|DELETE|ALL|EXECUTE)[^;]*\bTO\s+authenticated\b/,
    );
    expect(up).not.toMatch(/GRANT[^;]*(INSERT|UPDATE|DELETE|ALL)[^;]*\bTO\s+service_role\b/);
    expect(up).not.toMatch(/DISABLE ROW LEVEL SECURITY|NO FORCE ROW LEVEL SECURITY/i);
    expect(up).not.toMatch(/DROP POLICY/i);
  });

  it("every REVOKE names service_role too (Supabase default privileges hand it everything a migrator creates)", () => {
    const revokes = [...up.matchAll(/REVOKE ALL ON[\s\S]*?;/g)].map((m) => m[0]);
    expect(revokes.length).toBeGreaterThanOrEqual(2);
    for (const r of revokes)
      expect(r, r.slice(0, 80)).toMatch(/FROM PUBLIC, anon, authenticated, service_role;/);
    // The only service_role grants are EXECUTE on the nine server-called functions and SELECT on the tables.
    const grants = [...up.matchAll(/GRANT[^;]*TO service_role;/g)].map((m) => m[0]);
    for (const g of grants) expect(g).toMatch(/^GRANT (EXECUTE ON FUNCTION|SELECT ON)/);
    expect(up).not.toMatch(/GRANT[^;]*(INSERT|UPDATE|DELETE|TRUNCATE|ALL)[^;]*TO service_role/);
  });

  it("the quota windows count a timestamp the caller cannot choose", () => {
    expect((up.match(/NEW\.created_at := now\(\);/g) ?? []).length).toBe(3);
  });

  it("a purge consumes its dry run once and only with the windows it reported", () => {
    expect(up).toMatch(/wf_retention_run_one_purge_per_dry/);
    expect(up).toMatch(
      /r\.windows = public\.wf_retention_windows\(public\.wf_org_limits_effective\(v_org\)\)/,
    );
  });

  it("every new table has forced row security", () => {
    const tables = [...up.matchAll(/CREATE TABLE public\.(\w+)/g)].map((m) => m[1]);
    expect(tables.sort()).toEqual(
      ["wf_action_spend_rate", "wf_org_limits", "wf_quota_denial", "wf_retention_run"].sort(),
    );
    for (const t of tables) {
      expect(up).toMatch(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`));
      expect(up).toMatch(new RegExp(`ALTER TABLE public\\.${t} FORCE ROW LEVEL SECURITY`));
    }
  });

  it("callable functions are SECURITY DEFINER, empty search_path, service-role-only execute", () => {
    for (const fn of [
      "wf_limits_get",
      "wf_limits_update",
      "wf_retention_run_manual",
      "wf_retention_run_scheduled",
      "wf_quota_check_action",
      "wf_quota_runs_exceeded",
      "wf_quota_note_denial",
    ]) {
      const start = up.indexOf(`CREATE FUNCTION public.${fn}(`);
      expect(start, `${fn} defined`).toBeGreaterThan(-1);
      const header = up.slice(start, up.indexOf("AS $$", start));
      expect(header).toMatch(/SECURITY DEFINER/);
      expect(header).toMatch(/SET search_path = ''/);
      expect(up).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION[^;]*public\\.${fn}\\(`));
    }
  });

  it("the wallet is only ever read: no write to any wallet or ledger table", () => {
    expect(up).not.toMatch(
      /(INSERT INTO|UPDATE|DELETE FROM)\s+public\.(school_wallets|wallet_|fin_)/i,
    );
  });

  it("the ceiling, bounds and defaults are STABLE (an IMMUTABLE one is folded into cached plans)", () => {
    for (const fn of ["wf_wallet_cap_ceiling_kobo", "wf_limit_bounds", "wf_limit_defaults"]) {
      const start = up.indexOf(`CREATE FUNCTION public.${fn}(`);
      const header = up.slice(start, up.indexOf("AS $$", start));
      expect(header, fn).toMatch(/\bSTABLE\b/);
      expect(header, fn).not.toMatch(/IMMUTABLE/);
    }
    expect(up).toMatch(/wf_wallet_cap_ceiling_kobo\(\)[\s\S]{0,200}SELECT 0::bigint/);
  });

  it("the purge never reaches audit or broker ledger tables", () => {
    expect(up).not.toMatch(
      /DELETE FROM public\.(audit_chain|cg_tool_call_ledger|retention_legal_holds)/i,
    );
    expect(up).not.toMatch(/\bTRUNCATE\s+(TABLE\s+)?public\./i);
  });

  it("an active legal hold is read through to_regclass, not assumed", () => {
    expect(up).toMatch(/to_regclass\('public\.retention_legal_holds'\)/);
  });

  it("the rollback refuses once a purge happened or cost was recorded", () => {
    expect(down).toMatch(/wf_retention_run/);
    expect(down).toMatch(/cost_kobo/);
    expect(down).toMatch(/RAISE EXCEPTION/);
  });
});
