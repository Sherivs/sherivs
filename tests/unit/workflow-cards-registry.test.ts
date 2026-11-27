/**
 * The four workflow screens (approvals, run history, agent console, limits) are cards in the M3
 * registry, not hard-coded branches in the section screen. Each is a live section card with a lazy
 * screen, the screen module named here so the registry coverage check finds a test for it
 * (approval-inbox-screen, run-history-screen, agent-console-screen, limits-screen), and a
 * permission gate that matches the database RPCs (`wf_can(..., 'workflows.*')`).
 */
import { describe, expect, it } from "vitest";
import { resolveCard } from "../../frontend/src/lib/shell/card-registry";

const CARDS: Array<[string, string, string[]]> = [
  ["approvals", "approval-inbox-screen", ["workflows.view", "workflows.approve"]],
  ["workflow-runs", "run-history-screen", ["workflows.view"]],
  ["agent-console", "agent-console-screen", ["workflows.view"]],
  ["workflow-limits", "limits-screen", ["workflows.view"]],
];

describe("workflow cards in the registry", () => {
  for (const [key, screen, any] of CARDS) {
    it(`${key} is a live section card backed by ${screen}`, () => {
      const r = resolveCard(key);
      expect(r.kind).toBe("live");
      if (r.kind !== "live") return;
      expect(r.contract.kind).toBe("section");
      expect(r.contract.screenModule).toBe(`frontend/src/components/app-shell/${screen}`);
      expect(r.contract.screen).toBeTypeOf("function");
      expect(r.contract.permissions.any).toEqual(any);
      expect(r.contract.offline).toBe(false);
      expect(r.contract.serverFns.some((f) => f.startsWith("rpc:wf_"))).toBe(true);
    });
  }
});
