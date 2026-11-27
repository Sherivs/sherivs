import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { offeredPromotion, reasonProblem } from "../../frontend/src/lib/workflow/agent-promotion";

const evidence = {
  suite_id: "s",
  graded: 40,
  passed: 40,
  critical_failures: 0,
  ungraded: 0,
  evaluated_at: "2026-11-30T10:00:00Z",
  age_days: 1,
  meets_bar: true,
};
const agent = { next_level: "draft", evidence, state: "active" } as const;

describe("A4 offered promotion", () => {
  it("is offered only to the founder, on evidence that meets the bar, to an active agent", () => {
    expect(offeredPromotion(agent, true)).toBe("draft");
    expect(offeredPromotion(agent, false)).toBeNull();
    expect(
      offeredPromotion({ ...agent, evidence: { ...evidence, meets_bar: false } }, true),
    ).toBeNull();
    expect(offeredPromotion({ ...agent, evidence: null }, true)).toBeNull();
    expect(offeredPromotion({ ...agent, next_level: null }, true)).toBeNull();
    expect(offeredPromotion({ ...agent, state: "paused" }, true)).toBeNull();
  });
  it("needs a reason of 10 to 300 characters", () => {
    expect(reasonProblem("too short")).not.toBeNull();
    expect(reasonProblem("a".repeat(301))).not.toBeNull();
    expect(reasonProblem("Passed two full suites")).toBeNull();
  });
});

describe("A4 control wiring", () => {
  const control = readFileSync(
    "frontend/src/components/app-shell/agent-promotion-control.tsx",
    "utf8",
  );
  it("asks for the passkey between begin and finish, and never promotes on its own", () => {
    const b = control.indexOf("beginAgentPromotion({");
    const p = control.indexOf("startAuthentication({");
    const f = control.indexOf("finishAgentPromotion({");
    expect(b).toBeGreaterThan(-1);
    expect(p).toBeGreaterThan(b);
    expect(f).toBeGreaterThan(p);
    expect(control).not.toMatch(/wf_autonomy_promote/);
  });
  it("is shown by the console only through offeredPromotion", () => {
    const screen = readFileSync(
      "frontend/src/components/app-shell/agent-console-screen.tsx",
      "utf8",
    );
    expect(screen).toMatch(/offeredPromotion\(a, agents\.is_founder\)/);
  });
});
