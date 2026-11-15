import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_REASON_LENGTH,
  MIN_REASON_LENGTH,
  PAUSE_CAPABILITY,
  WORKFORCE_TARGET,
  applyPause,
  authorizePauseChange,
  cascades,
  computePaused,
  type PauseActor,
  type PauseEvent,
  type PauseSubject,
} from "../../frontend/src/lib/workforce-pause/pause-policy";
import { workforceRoster } from "../../frontend/src/lib/workforce-charter/roster";

const roster: readonly PauseSubject[] = workforceRoster().map((m) => ({
  packCode: m.charter.packCode,
  agentTier: m.charter.agentTier,
  killScope: m.charter.killScope,
}));
const sheriff: PauseActor = { isSheriff: true, capabilities: new Set() };
const ops: PauseActor = { isSheriff: false, capabilities: new Set([PAUSE_CAPABILITY]) };
const viewer: PauseActor = {
  isSheriff: false,
  capabilities: new Set(["platform.operations.read"]),
};
const why = "Unexpected spike in refund proposals";

const ordinary = roster.find((s) => s.agentTier === "department" && !cascades(s))!;
const assurance = roster.filter((s) => s.agentTier === "assurance");
const jarvis = roster.find((s) => s.agentTier === "executive")!;
const ev = (action: "pause" | "resume", target: string, atMs: number): PauseEvent => ({
  action,
  target,
  reason: why,
  actorId: "u1",
  atMs,
});

describe("ENGINE-16 who may pause and resume", () => {
  it("the roster has the shapes the policy relies on", () => {
    expect(roster).toHaveLength(25);
    expect(assurance).toHaveLength(2);
    expect(roster.filter(cascades).map((s) => s.packCode)).toEqual([jarvis.packCode]);
  });

  it("an operations holder may pause one ordinary agent and nothing wider", () => {
    expect(
      authorizePauseChange(
        ops,
        { action: "pause", target: ordinary.packCode, reason: why },
        roster,
      ),
    ).toEqual({
      allowed: true,
      needs: "operations",
    });
    for (const target of [jarvis.packCode, ...assurance.map((a) => a.packCode), WORKFORCE_TARGET]) {
      expect(
        authorizePauseChange(ops, { action: "pause", target, reason: why }, roster),
        target,
      ).toEqual({
        allowed: false,
        reason: "pause_needs_sheriff",
      });
    }
  });

  it("the sheriff may pause anything", () => {
    for (const target of [
      ordinary.packCode,
      jarvis.packCode,
      ...assurance.map((a) => a.packCode),
      WORKFORCE_TARGET,
    ]) {
      expect(
        authorizePauseChange(sheriff, { action: "pause", target, reason: why }, roster),
        target,
      ).toMatchObject({
        allowed: true,
        needs: "sheriff",
      });
    }
  });

  it("resuming is the sheriff's alone, even for an agent an operations holder could pause", () => {
    expect(
      authorizePauseChange(
        ops,
        { action: "resume", target: ordinary.packCode, reason: why },
        roster,
      ),
    ).toEqual({
      allowed: false,
      reason: "resume_needs_sheriff",
    });
    expect(
      authorizePauseChange(
        sheriff,
        { action: "resume", target: ordinary.packCode, reason: why },
        roster,
      ),
    ).toMatchObject({
      allowed: true,
    });
  });

  it("someone without the capability may do nothing", () => {
    expect(
      authorizePauseChange(
        viewer,
        { action: "pause", target: ordinary.packCode, reason: why },
        roster,
      ),
    ).toEqual({
      allowed: false,
      reason: "pause_needs_operations_capability",
    });
    expect(
      authorizePauseChange(
        viewer,
        { action: "resume", target: ordinary.packCode, reason: why },
        roster,
      ).allowed,
    ).toBe(false);
  });

  it("a reason is required, and bounded", () => {
    const base = { action: "pause" as const, target: ordinary.packCode };
    expect(authorizePauseChange(sheriff, { ...base, reason: "too short" }, roster)).toEqual({
      allowed: false,
      reason: "reason_too_short",
    });
    expect(authorizePauseChange(sheriff, { ...base, reason: "   ".repeat(10) }, roster)).toEqual({
      allowed: false,
      reason: "reason_too_short",
    });
    expect(
      authorizePauseChange(sheriff, { ...base, reason: "x".repeat(MAX_REASON_LENGTH + 1) }, roster),
    ).toEqual({
      allowed: false,
      reason: "reason_too_long",
    });
    expect(
      authorizePauseChange(sheriff, { ...base, reason: "x".repeat(MAX_REASON_LENGTH) }, roster)
        .allowed,
    ).toBe(true);
    expect(authorizePauseChange(sheriff, { ...base, reason: "x".repeat(10) }, roster).allowed).toBe(
      true,
    );
  });

  it("an unknown target or action is refused", () => {
    expect(
      authorizePauseChange(sheriff, { action: "pause", target: "nobody", reason: why }, roster),
    ).toEqual({
      allowed: false,
      reason: "unknown_target",
    });
    expect(
      authorizePauseChange(
        sheriff,
        { action: "delete" as "pause", target: ordinary.packCode, reason: why },
        roster,
      ),
    ).toEqual({
      allowed: false,
      reason: "unknown_action",
    });
  });
});

describe("ENGINE-16 what a pause reaches", () => {
  it("pausing an ordinary agent pauses only that agent", () => {
    const p = computePaused([ev("pause", ordinary.packCode, 1)], roster);
    expect([...p.keys()]).toEqual([ordinary.packCode]);
    expect(p.get(ordinary.packCode)).toEqual({ source: ordinary.packCode, direct: true });
  });

  it("pausing JARVIS pauses every agent except the two assurance agents", () => {
    const p = computePaused([ev("pause", jarvis.packCode, 1)], roster);
    expect(p.size).toBe(23);
    for (const a of assurance) expect(p.has(a.packCode)).toBe(false);
    expect(p.get(jarvis.packCode)).toEqual({ source: jarvis.packCode, direct: true });
    expect(p.get(ordinary.packCode)).toEqual({ source: jarvis.packCode, direct: false });
  });

  it("a workforce pause never silences the verifiers, but a direct pause of one does", () => {
    const all = computePaused([ev("pause", WORKFORCE_TARGET, 1)], roster);
    expect(all.size).toBe(23);
    expect(assurance.some((a) => all.has(a.packCode))).toBe(false);
    expect(all.get(ordinary.packCode)).toEqual({ source: WORKFORCE_TARGET, direct: false });
    const direct = computePaused([ev("pause", assurance[0]!.packCode, 1)], roster);
    expect([...direct.keys()]).toEqual([assurance[0]!.packCode]);
  });

  it("the last event for a target wins, whatever order they arrive in", () => {
    const events = [
      ev("resume", ordinary.packCode, 5),
      ev("pause", ordinary.packCode, 1),
      ev("pause", ordinary.packCode, 9),
    ];
    expect(computePaused(events, roster).has(ordinary.packCode)).toBe(true);
    const resumed = [ev("pause", ordinary.packCode, 9), ev("resume", ordinary.packCode, 10)];
    expect(computePaused(resumed, roster).size).toBe(0);
    expect(computePaused([...resumed].reverse(), roster).size).toBe(0);
  });

  it("events at the same instant apply in the order given", () => {
    expect(
      computePaused([ev("pause", ordinary.packCode, 1), ev("resume", ordinary.packCode, 1)], roster)
        .size,
    ).toBe(0);
    expect(
      computePaused([ev("resume", ordinary.packCode, 1), ev("pause", ordinary.packCode, 1)], roster)
        .size,
    ).toBe(1);
  });

  it("resuming a cascading source frees what it was holding, but not what is paused for its own reasons", () => {
    const events = [
      ev("pause", ordinary.packCode, 1),
      ev("pause", jarvis.packCode, 2),
      ev("resume", jarvis.packCode, 3),
    ];
    const p = computePaused(events, roster);
    expect([...p.keys()]).toEqual([ordinary.packCode]);
    expect(p.get(ordinary.packCode)?.direct).toBe(true);
  });

  it("a direct pause keeps its own source even when a cascade also covers it", () => {
    const p = computePaused(
      [ev("pause", ordinary.packCode, 1), ev("pause", jarvis.packCode, 2)],
      roster,
    );
    expect(p.get(ordinary.packCode)).toEqual({ source: ordinary.packCode, direct: true });
  });

  it("unknown targets are ignored, and no events means nothing is paused", () => {
    expect(computePaused([ev("pause", "nobody", 1)], roster).size).toBe(0);
    expect(computePaused([], roster).size).toBe(0);
  });

  it("an executive agent is sheriff-only even if its kill scope were narrowed", () => {
    const custom: PauseSubject[] = [
      { packCode: "boss", agentTier: "executive", killScope: "agent" },
    ];
    expect(
      authorizePauseChange(ops, { action: "pause", target: "boss", reason: why }, custom),
    ).toEqual({
      allowed: false,
      reason: "pause_needs_sheriff",
    });
  });

  it("a department-scoped agent is treated as workforce-wide, the safe direction", () => {
    const custom: PauseSubject[] = [
      { packCode: "a", agentTier: "department", killScope: "department" },
      { packCode: "b", agentTier: "department", killScope: "agent" },
      { packCode: "v", agentTier: "assurance", killScope: "agent" },
    ];
    expect(cascades(custom[0]!)).toBe(true);
    const p = computePaused([ev("pause", "a", 1)], custom);
    expect([...p.keys()].sort()).toEqual(["a", "b"]);
    expect(
      authorizePauseChange(ops, { action: "pause", target: "a", reason: why }, custom),
    ).toEqual({
      allowed: false,
      reason: "pause_needs_sheriff",
    });
  });
});

describe("ENGINE-16 a pause forces shadow", () => {
  it("any earned level becomes shadow while paused, and is untouched otherwise", () => {
    for (const e of ["shadow", "propose_only", "act_with_approval", "act_autonomously"] as const) {
      expect(applyPause(e, true)).toBe("shadow");
      expect(applyPause(e, false)).toBe(e);
    }
  });
});

describe("ENGINE-16 the database proposal matches the policy", () => {
  const sql = readFileSync("database/proposals/ENGINE-16_agent_pause_state.sql", "utf8");
  const seed = [...sql.matchAll(/^ {2}\('([a-z0-9-]+)', '([a-z]+)', '([a-z]+)'\)/gm)].map((m) => [
    m[1],
    m[2],
    m[3],
  ]);

  it("seeds exactly the charters' agent tiers and kill scopes", () => {
    const expected = workforceRoster()
      .map((m) => [m.charter.packCode, m.charter.agentTier, m.charter.killScope])
      .sort();
    expect([...seed].sort()).toEqual(expected);
    expect(seed).toHaveLength(25);
  });

  it("is append-only, forced-RLS, definer-safe and reversible", () => {
    expect(sql.startsWith("-- PROPOSAL ONLY. NOT APPLIED.")).toBe(true);
    expect(sql).toContain("ALTER TABLE public.agent_pause_events FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE public.agent_pause_rules FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("BEFORE UPDATE OR DELETE ON public.agent_pause_events");
    expect(sql).not.toMatch(/GRANT[^;]*\b(UPDATE|DELETE|ALL)\b[^;]*agent_pause_events/);
    expect(sql.match(/SECURITY DEFINER SET search_path = ''/g)).toHaveLength(2);
    expect(sql).toContain("platform.operations.assign");
    expect(sql).toContain("-- DROP TABLE IF EXISTS public.agent_pause_events;");
    expect(sql).not.toMatch(/ALTER\s+TABLE[^;]*\bDISABLE\b/i);
  });

  it("states the same rules as the policy", () => {
    for (const code of [
      "resume_needs_sheriff",
      "pause_needs_sheriff",
      "pause_needs_operations_capability",
      "reason_too_short",
      "reason_too_long",
      "unknown_target",
      "unknown_action",
    ]) {
      expect(sql, code).toContain(code);
    }
    expect(sql).toContain("BETWEEN 10 AND 300");
    expect(MIN_REASON_LENGTH).toBe(10);
    expect(MAX_REASON_LENGTH).toBe(300);
  });

  it("the scratch check script is clearly marked and covers the same cases", () => {
    const check = readFileSync("database/proposals/ENGINE-16_agent_pause_state.check.sql", "utf8");
    expect(check.startsWith("-- SCRATCH-DATABASE CHECK. NEVER RUN ON A REAL PROJECT.")).toBe(true);
    for (const name of [
      "resume_needs_sheriff",
      "pause_needs_sheriff",
      "agent_pause_events is append-only",
      "not_authenticated",
    ]) {
      expect(check, name).toContain(name);
    }
  });
});
