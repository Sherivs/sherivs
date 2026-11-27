import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACTION_CLASS_CAP,
  AGENT_TIER_CAP,
  AUTONOMY_BAR,
  AUTONOMY_DEMOTE_FLOOR,
  AUTONOMY_RANK,
  AUTONOMY_SCALE,
  LADDER_STATE_OF_LEVEL,
  agentCeiling,
  autonomyRank,
  classCap,
  effectiveAutonomy,
  explainPromotion,
  isRegression,
} from "../../frontend/src/lib/workflow/autonomy-scale";
import { effectiveWorkflowAutonomy } from "../../frontend/src/lib/workflow/workflow-actions";
import { TRUST_STATES } from "../../frontend/src/lib/twin-engine/autonomy-ladder";

const MIGRATION =
  "database/supabase/migrations/20261117000980_sherivs_ain02_autonomy_scale_and_promotion_gate.sql";
const ROLLBACK =
  "database/supabase/rollbacks/20261117000980_sherivs_ain02_autonomy_scale_and_promotion_gate.sql";
const migration = readFileSync(MIGRATION, "utf8");
const rollback = readFileSync(ROLLBACK, "utf8");
const seed = migration.slice(
  migration.indexOf("-- BEGIN AIN02 SEED"),
  migration.indexOf("-- END AIN02 SEED"),
);

/** Rows of one INSERT in the seed block: the quoted and numeric cells of each parenthesized tuple. */
function rowsOf(table: string): string[][] {
  const start = seed.indexOf(`INSERT INTO public.${table}`);
  expect(start, table).toBeGreaterThan(-1);
  const end = seed.indexOf(";", start);
  return [...seed.slice(start, end).matchAll(/\(([^()]*)\)/g)]
    .slice(1)
    .map((m) => m[1]!.split(",").map((c) => c.trim().replace(/^'|'$/g, "")));
}

describe("AIN-02 scale: the TypeScript restatement matches the migration seed", () => {
  it("scale: four levels in one order, each on one ladder state", () => {
    const rows = rowsOf("wf_autonomy_scale (level, rank, ladder_state, label)");
    expect(rows.map((r) => r[0])).toEqual([...AUTONOMY_SCALE]);
    for (const [level, rank, state] of rows) {
      expect(AUTONOMY_RANK[level as keyof typeof AUTONOMY_RANK]).toBe(Number(rank));
      expect(LADDER_STATE_OF_LEVEL[level as keyof typeof LADDER_STATE_OF_LEVEL]).toBe(state);
    }
    expect(Object.values(LADDER_STATE_OF_LEVEL)).toEqual([...TRUST_STATES]);
  });

  it("class caps match, including the six capped classes at draft", () => {
    const rows = rowsOf("wf_autonomy_class_cap (action_class, max_level)");
    expect(rows).toHaveLength(Object.keys(ACTION_CLASS_CAP).length);
    for (const [cls, level] of rows) expect(ACTION_CLASS_CAP[cls!], cls).toBe(level);
    for (const c of [
      "money_movement",
      "safeguarding",
      "credential_change",
      "public_publish",
      "mass_message",
      "external_authority_share",
      "unclassified",
    ]) {
      expect(ACTION_CLASS_CAP[c], c).toBe("draft");
    }
    expect(ACTION_CLASS_CAP.ai_model).toBe("suggest");
  });

  it("agent tier caps match", () => {
    const rows = rowsOf("wf_autonomy_agent_tier_cap (agent_tier, max_level)");
    expect(rows).toHaveLength(Object.keys(AGENT_TIER_CAP).length);
    for (const [tier, level] of rows)
      expect(AGENT_TIER_CAP[tier as keyof typeof AGENT_TIER_CAP]).toBe(level);
  });

  it("bars match the ladder (20/0.90, 50/0.95, 200/0.98 within 30 days) and the demote floor is 0.90", () => {
    const rows = rowsOf("wf_autonomy_bar (target_level, min_graded, min_pass_rate, max_age_days)");
    expect(rows).toHaveLength(3);
    for (const [level, graded, rate, days] of rows) {
      const b = AUTONOMY_BAR[level as keyof typeof AUTONOMY_BAR];
      expect(b.minGraded, level).toBe(Number(graded));
      expect(b.minPassRate, level).toBeCloseTo(Number(rate), 6);
      expect(b.maxAgeDays, level).toBe(Number(days));
    }
    expect(AUTONOMY_DEMOTE_FLOOR).toBe(0.9);
    expect(migration).toMatch(/wf_autonomy_demote_floor\(\)[\s\S]{0,200}SELECT 0\.900::numeric/);
  });
});

describe("AIN-02 scale: invariants", () => {
  it("no class above draft is reachable for the capped classes, whatever else is allowed", () => {
    for (const cls of Object.keys(ACTION_CLASS_CAP).filter(
      (c) => AUTONOMY_RANK[ACTION_CLASS_CAP[c]!] <= 1,
    )) {
      for (const tier of ["executive", "department", "assurance", "organization"]) {
        expect(
          autonomyRank(
            effectiveAutonomy({
              template: "act_and_report",
              organization: "act_and_report",
              earned: "act_and_report",
              tier,
              actionClass: cls,
            }),
          ),
          `${tier}/${cls}`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  it("an unknown class is draft, an unknown tier or level is the floor", () => {
    expect(classCap("brand_new")).toBe("draft");
    expect(agentCeiling("nobody")).toBe("suggest");
    expect(agentCeiling(null)).toBe("suggest");
    expect(autonomyRank("ACT_AND_REPORT")).toBe(0);
    expect(autonomyRank(undefined)).toBe(0);
    expect(classCap("constructor")).toBe("draft");
    expect(agentCeiling("hasOwnProperty")).toBe("suggest");
  });

  it("agrees with the dispatcher's own function when the agent ceiling is the earned level", () => {
    for (const template of AUTONOMY_SCALE) {
      for (const org of AUTONOMY_SCALE) {
        for (const earned of AUTONOMY_SCALE) {
          for (const actionClass of ["internal", "money_movement", "unclassified", "task"]) {
            const mine = effectiveAutonomy({
              template,
              organization: org,
              earned,
              tier: "department",
              actionClass,
            });
            const theirs = effectiveWorkflowAutonomy({
              template,
              tenant: org,
              agent: earned,
              actionClass,
            });
            expect(mine, `${template}/${org}/${earned}/${actionClass}`).toBe(theirs);
          }
        }
      }
    }
  });

  it("the executive tier cannot be autonomous and the assurance tier cannot act", () => {
    expect(AUTONOMY_RANK[AGENT_TIER_CAP.executive]).toBeLessThan(AUTONOMY_RANK.act_and_report);
    expect(AUTONOMY_RANK[AGENT_TIER_CAP.assurance]).toBeLessThanOrEqual(AUTONOMY_RANK.draft);
  });
});

describe("AIN-02 promotion explainer: boundaries match the database bars", () => {
  const day = 86_400_000;
  const ev = (
    graded: number,
    passed: number,
    extra: Partial<{ crit: number; ungraded: number; ageMs: number }> = {},
  ) => ({
    graded,
    passed,
    criticalFailures: extra.crit ?? 0,
    ungraded: extra.ungraded ?? 0,
    ageMs: extra.ageMs ?? day,
  });
  const step = (
    from: "suggest" | "draft" | "act_with_approval",
    to: "draft" | "act_with_approval" | "act_and_report",
    e: ReturnType<typeof ev>,
    tier = "department",
  ) => explainPromotion({ from, to, tier, evidence: e }).eligible;

  it("draft: limit - 1 fails, limit passes (cases and rate)", () => {
    expect(step("suggest", "draft", ev(19, 19))).toBe(false);
    expect(step("suggest", "draft", ev(20, 17))).toBe(false);
    expect(step("suggest", "draft", ev(20, 18))).toBe(true);
  });
  it("act_with_approval: 49 cases fail, 47 of 50 fails, 48 of 50 passes", () => {
    expect(step("draft", "act_with_approval", ev(49, 49))).toBe(false);
    expect(step("draft", "act_with_approval", ev(50, 47))).toBe(false);
    expect(step("draft", "act_with_approval", ev(50, 48))).toBe(true);
  });
  it("act_and_report: 199 cases fail, 195 of 200 fails, 196 of 200 passes", () => {
    expect(step("act_with_approval", "act_and_report", ev(199, 199))).toBe(false);
    expect(step("act_with_approval", "act_and_report", ev(200, 195))).toBe(false);
    expect(step("act_with_approval", "act_and_report", ev(200, 196))).toBe(true);
  });
  it("a critical failure, stale or future evidence, and ungraded cases above draft block", () => {
    expect(step("suggest", "draft", ev(40, 39, { crit: 1 }))).toBe(false);
    expect(step("suggest", "draft", ev(30, 30, { ageMs: 30 * day + 1 }))).toBe(false);
    expect(step("suggest", "draft", ev(30, 30, { ageMs: 30 * day }))).toBe(true);
    expect(step("suggest", "draft", ev(30, 30, { ageMs: -1 }))).toBe(false);
    expect(step("suggest", "draft", ev(30, 30, { ungraded: 3 }))).toBe(true);
    expect(step("draft", "act_with_approval", ev(60, 60, { ungraded: 1 }))).toBe(false);
  });
  it("one rung only, and never above the tier ceiling", () => {
    expect(step("suggest", "act_with_approval" as never, ev(60, 60))).toBe(false);
    expect(step("draft", "act_with_approval", ev(60, 60), "assurance")).toBe(false);
    expect(step("act_with_approval", "act_and_report", ev(300, 300), "executive")).toBe(false);
    expect(step("act_with_approval", "act_and_report", ev(300, 300), "organization")).toBe(true);
  });
  it("regression: below 0.90, a critical failure or nothing graded; exactly 0.90 is not", () => {
    expect(isRegression({ graded: 100, passed: 90, criticalFailures: 0 })).toBe(false);
    expect(isRegression({ graded: 100, passed: 89, criticalFailures: 0 })).toBe(true);
    expect(isRegression({ graded: 200, passed: 199, criticalFailures: 1 })).toBe(true);
    expect(isRegression({ graded: 0, passed: 0, criticalFailures: 0 })).toBe(true);
  });
});

describe("AIN-02 migration hygiene", () => {
  it("is marked not applied, transactional, and has a rollback that undoes the lot", () => {
    expect(migration.startsWith("-- NOT APPLIED")).toBe(true);
    expect(migration).toMatch(/^BEGIN;$/m);
    expect(migration).toMatch(/^COMMIT;$/m);
    for (const t of [
      "wf_autonomy_scale",
      "wf_autonomy_class_cap",
      "wf_autonomy_agent_tier_cap",
      "wf_autonomy_bar",
      "wf_autonomy_evidence",
      "wf_autonomy_change",
    ]) {
      expect(rollback, t).toContain(t);
    }
    for (const trg of [
      "wf_agent_autonomy_05_gate",
      "wf_action_sandbox_outbox_90_autonomy",
      "wf_run_08_freeze_actor",
    ]) {
      expect(rollback, trg).toContain(trg);
    }
  });

  it("every function pins an empty search_path and nothing is granted to PUBLIC, anon or authenticated", () => {
    const fns = migration.split(/CREATE (?:OR REPLACE )?FUNCTION /).slice(1);
    expect(fns.length).toBeGreaterThanOrEqual(16);
    for (const f of fns) {
      const header = f.slice(0, f.indexOf("$$"));
      expect(header, f.slice(0, 60)).toMatch(/SET search_path = ''/);
    }
    expect(migration).not.toMatch(/GRANT[^;]*TO[^;]*\b(anon|authenticated|PUBLIC)\b/);
    expect(migration).toMatch(/REVOKE[^;]*FROM PUBLIC, anon, authenticated, service_role/);
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION[\s\S]*wf_autonomy_promote[\s\S]*TO service_role/,
    );
  });

  it("does not make the service role able to write the earned level", () => {
    expect(migration).toMatch(
      /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public\.wf_agent_autonomy/,
    );
    expect(migration).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*wf_agent_autonomy/);
  });

  it("contains no external call, model call or send", () => {
    expect(migration).not.toMatch(/\bhttp_post\b|\bpg_net\b|\bnet\.http|\bdblink\b|\bCOPY\b/i);
  });
});
