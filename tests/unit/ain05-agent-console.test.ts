/**
 * AIN-05: the agent console's shapes, error mapping, fixed reasons and server operations (ADR-129). Pure: no database.
 */
import { describe, expect, it } from "vitest";
import {
  AgentConsoleError,
  CONSOLE_ERROR_CODES,
  CONSOLE_REASONS,
  CONSOLE_REASON_SENTENCES,
  MemoryListInput,
  SafetyReviewInput,
  AgentDemoteInput,
  consoleErrorFromDatabase,
  consoleErrorMessage,
  parseAgentConsole,
  parseMemoryList,
  parseSafetyList,
  safeConsoleMessage,
} from "../../frontend/src/lib/workflow/agent-console";
import {
  demoteAgent,
  listMemory,
  loadAgents,
  reviewSafety,
  type AgentConsolePorts,
} from "../../frontend/src/lib/workflow/agent-console.server";

const ID = "11111111-1111-4111-8111-111111111111";
const agent = {
  agent_ref: "org-fees",
  codename: "Fees",
  family: "org",
  tier: "department",
  accountable: "bursar",
  state: "active",
  ceiling: "act_and_report",
  earned_level: "draft",
  next_level: "act_with_approval",
  bar: { min_graded: 30, min_pass_rate: 0.95, max_age_days: 30 },
  evidence: {
    suite_id: "s1",
    graded: 40,
    passed: 39,
    critical_failures: 0,
    ungraded: 0,
    evaluated_at: "2026-11-25T10:00:00Z",
    age_days: 1,
    meets_bar: true,
  },
  changes: [{ kind: "promote", from: "suggest", to: "draft", at: "2026-11-20T10:00:00Z" }],
  steps_24h: 3,
  budget: { daily_actions: 10, daily_model_calls: 0, daily_cost_cap_minor: 0 },
};
const consoleDoc = {
  org_id: ID,
  ai_route_approved: false,
  can_manage: true,
  can_approve: true,
  is_founder: false,
  levels: [{ level: "suggest", rank: 0, label: "Suggest" }],
  agents: [agent],
};

function ports(over: { data?: unknown; error?: { message: string } | null } = {}) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const p: AgentConsolePorts = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      return { data: over.data ?? null, error: over.error ?? null };
    },
  };
  return { p, calls };
}

describe("AIN-05 agent console shapes", () => {
  it("parses the agent view strictly and rejects an unknown key", () => {
    expect(parseAgentConsole(consoleDoc).agents[0]?.agent_ref).toBe("org-fees");
    expect(() => parseAgentConsole({ ...consoleDoc, extra: 1 })).toThrow(AgentConsoleError);
    expect(() => parseAgentConsole({ ...consoleDoc, agents: [{ ...agent, secret: "x" }] })).toThrow(
      AgentConsoleError,
    );
  });

  it("rejects an agent change that carries a reason or a person", () => {
    const bad = { ...agent, changes: [{ ...agent.changes[0], reason: "free text" }] };
    expect(() => parseAgentConsole({ ...consoleDoc, agents: [bad] })).toThrow(AgentConsoleError);
  });

  it("renders a memory value as capped plain text", () => {
    const item = {
      item_id: ID,
      key: "k",
      scope_kind: "agent",
      scope_ref: "r",
      data_class: "note",
      status: "proposed",
      source_kind: "agent",
      source_agent: "org-fees",
      ai_readable: false,
      version: 1,
      value: { text: "x".repeat(5000) },
      expired: false,
      created_at: "2026-11-25T10:00:00Z",
      expires_at: null,
    };
    const parsed = parseMemoryList({ items: [item], has_more: false });
    expect(typeof parsed.items[0]?.value).toBe("string");
    expect(parsed.items[0]?.value.length).toBeLessThanOrEqual(1200);
  });

  it("rejects a screened output that carries any text field", () => {
    const check = {
      check_id: ID,
      run_id: ID,
      step_key: "draft",
      direction: "output",
      verdict: "flagged",
      codes: ["pii.email"],
      text_chars: 40,
      created_at: "2026-11-25T10:00:00Z",
      decision: null,
      decided_at: null,
      started_by_me: false,
      can_review: true,
    };
    expect(
      parseSafetyList({ items: [check], has_more: false, can_approve: true }).items,
    ).toHaveLength(1);
    expect(() =>
      parseSafetyList({ items: [{ ...check, text: "hello" }], has_more: false, can_approve: true }),
    ).toThrow(AgentConsoleError);
  });
});

describe("AIN-05 reasons and requests", () => {
  it("maps every reason to a fixed sentence the ledgers accept (10 to 300 characters)", () => {
    for (const r of CONSOLE_REASONS) {
      const s = CONSOLE_REASON_SENTENCES[r];
      expect(s.length).toBeGreaterThanOrEqual(10);
      expect(s.length).toBeLessThanOrEqual(300);
    }
  });

  it("refuses free text, unknown keys and a raise of level at the edge", () => {
    expect(() =>
      SafetyReviewInput.parse({ checkId: ID, decision: "cleared", reason: "because I said so" }),
    ).toThrow();
    expect(() =>
      SafetyReviewInput.parse({
        checkId: ID,
        decision: "cleared",
        reason: "reviewed_ok",
        note: "x",
      }),
    ).toThrow();
    expect(() =>
      AgentDemoteInput.parse({ agentRef: "org-fees", toLevel: "act_and_report", reason: "other" }),
    ).toThrow();
    expect(MemoryListInput.parse({}).status).toBe("proposed");
  });
});

describe("AIN-05 errors", () => {
  it("maps database codes to safe sentences and never leaks unknown text", () => {
    const e = consoleErrorFromDatabase({ message: "ain05:not_authorized" });
    expect(e.code).toBe("not_authorized");
    expect(
      consoleErrorFromDatabase({ message: "ain04:the_starter_of_the_run_cannot_review_its_output" })
        .code,
    ).toBe("the_starter_of_the_run_cannot_review_its_output");
    expect(
      consoleErrorFromDatabase({
        message: 'relation "wf_safety_check" does not exist ada@x.example',
      }).code,
    ).toBe("unavailable");
    expect(safeConsoleMessage(new Error("password=hunter2"))).toBe(
      consoleErrorMessage("unavailable"),
    );
    expect(safeConsoleMessage(e)).toBe(consoleErrorMessage("not_authorized"));
    for (const c of CONSOLE_ERROR_CODES) expect(consoleErrorMessage(c).length).toBeGreaterThan(10);
  });
});

describe("AIN-05 server operations", () => {
  it("forwards the verified actor and never anything from the request", async () => {
    const a = ports({ data: consoleDoc });
    await loadAgents(a.p, { actorId: ID });
    expect(a.calls).toEqual([{ fn: "wf_console_agents", args: { p_actor: ID } }]);
    const m = ports({ data: { items: [], has_more: false } });
    await listMemory(m.p, { actorId: ID, status: "active" });
    expect(m.calls[0]?.args).toMatchObject({
      p_actor: ID,
      p_status: "active",
      p_limit: 25,
      p_before: null,
      p_before_id: null,
    });
  });

  it("sends the fixed sentence for a review, not the person's words", async () => {
    const r = ports({ data: { decision: "cleared" } });
    await reviewSafety(r.p, {
      actorId: ID,
      checkId: ID,
      decision: "cleared",
      reason: "reviewed_ok",
    });
    expect(r.calls[0]?.args.p_reason).toBe(CONSOLE_REASON_SENTENCES.reviewed_ok);
  });

  it("takes the organisation for a demotion from the permission-checked view, then demotes", async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const p: AgentConsolePorts = {
      rpc: async (fn, args) => {
        calls.push({ fn, args });
        return { data: fn === "wf_console_agents" ? consoleDoc : { to: "suggest" }, error: null };
      },
    };
    await demoteAgent(p, {
      actorId: ID,
      agentRef: "org-fees",
      toLevel: "suggest",
      reason: "quality_concern",
    });
    expect(calls.map((c) => c.fn)).toEqual(["wf_console_agents", "wf_autonomy_demote"]);
    expect(calls[1]?.args).toMatchObject({
      p_actor: ID,
      p_org: ID,
      p_agent: "org-fees",
      p_to_level: "suggest",
    });
  });

  it("does not demote when the view is refused", async () => {
    const p: AgentConsolePorts = {
      rpc: async () => ({ data: null, error: { message: "ain05:not_authorized" } }),
    };
    await expect(
      demoteAgent(p, { actorId: ID, agentRef: "org-fees", toLevel: "suggest", reason: "other" }),
    ).rejects.toMatchObject({ code: "not_authorized" });
  });

  it("turns a thrown transport error into the generic sentence", async () => {
    const p: AgentConsolePorts = {
      rpc: async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.1");
      },
    };
    await expect(loadAgents(p, { actorId: ID })).rejects.toMatchObject({ code: "unavailable" });
  });
});
