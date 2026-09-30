/**
 * CoreGrid — Phase 07 AI Agent System: governance report tests.
 *
 * The agent system claims rules; these tests prove the report can only claim what
 * the code enforces, and that its checks can fail.
 */
import { describe, expect, it } from "vitest";

import {
  agentGovernanceReport,
  agentGovernanceRules,
  runAgentGovernanceCheck,
} from "@/lib/agent-governance-report";
import { TASK_STATES, TASK_TRANSITIONS } from "@/lib/agent-tasks";

describe("Phase 07 — the agent governance report reflects the real contracts", () => {
  it("reports the task state machine from the module, not a copy", () => {
    const report = agentGovernanceReport();

    expect(report.states).toEqual(TASK_STATES);
    expect(report.declaredTransitions).toBe(
      TASK_TRANSITIONS.filter((transition) => transition.allowed).length,
    );
    expect(report.declaredTransitions).toBeGreaterThan(0);
  });

  it("ties every claimed rule to an enforcing module and a proving suite", () => {
    const rules = agentGovernanceRules();

    expect(rules.length).toBeGreaterThanOrEqual(4);
    for (const rule of rules) {
      expect(rule.rule.length, `${rule.id} must state the rule`).toBeGreaterThan(10);
      expect(rule.enforcedBy, `${rule.id} must name its module`).toMatch(/^frontend\/src\/lib\//);
      expect(rule.provedBy, `${rule.id} must name its suite`).toMatch(
        /^tests\/unit\/.*\.test\.ts$/,
      );
    }
    const ids = rules.map((rule) => rule.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "task-state-machine",
        "memory-category-and-classification",
        "memory-trust",
        "plan-validation",
        "loop-safety",
        "tenant-scoped-agents",
      ]),
    );
  });
});

describe("Phase 07 — the agent checks exercise real state machines", () => {
  it("passes on the current agent system", () => {
    const checks = runAgentGovernanceCheck();

    expect(checks.length).toBeGreaterThanOrEqual(2);
    expect(checks.filter((check) => !check.ok)).toEqual([]);
    for (const check of checks) expect(check.detail.length).toBeGreaterThan(0);
  });

  it("proves that an undeclared task transition is refused", () => {
    const check = runAgentGovernanceCheck().find((entry) => entry.id === "task-transition");

    expect(check?.ok).toBe(true);
    expect(check?.detail).toContain("refused=");
  });

  it("proves that runaway reasoning stops at the step ceiling", () => {
    const check = runAgentGovernanceCheck().find((entry) => entry.id === "loop-safety");

    expect(check?.ok).toBe(true);
    expect(check?.detail).toContain("refused");
  });

  it("counts passes and failures consistently and names failures", () => {
    const report = agentGovernanceReport();

    expect(report.passed + report.failed).toBe(report.checks.length);
    expect(report.healthy).toBe(report.failed === 0);
    expect(report.failingChecks).toEqual(report.checks.filter((c) => !c.ok).map((c) => c.id));
  });
});
