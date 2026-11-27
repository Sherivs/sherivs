import { describe, expect, it } from "vitest";
import {
  RETRY_BLOCKER_CODES,
  RETRY_BLOCKER_MESSAGES,
  RunCancelInput,
  RunHistoryError,
  RunListInput,
  RunRetryInput,
  looksLikeContact,
  parseCancelResult,
  parseRetryResult,
  parseRunDetail,
  parseRunList,
  runErrorFromDatabase,
  runErrorMessage,
  safeLabel,
  safeRunMessage,
} from "../../frontend/src/lib/workflow/run-history";
import {
  cancelRun,
  listRuns,
  retryStep,
  viewRun,
  type RunHistoryPorts,
} from "../../frontend/src/lib/workflow/run-history.server";

const ID = (n: number) => `f0800000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOW = "2026-11-19T10:00:00+00:00";

function detail(over: Record<string, unknown> = {}) {
  return {
    run: {
      run_id: ID(1),
      workflow_key: "wf-a",
      version: 1,
      status: "failed",
      error_code: "step.failed",
      trigger_event_type: "fees.invoice_overdue",
      created_at: NOW,
      started_at: NOW,
      finished_at: NOW,
      deadline_at: NOW,
      step_count: 1,
      max_steps: 20,
      started_by_me: false,
      started_by_kind: "user",
      retry_of_run_id: null,
      retry_generation: 0,
    },
    permissions: { can_cancel: false, can_retry: true, workflows_enabled: true },
    steps: [
      {
        step_id: ID(2),
        step_key: "send",
        iteration: 0,
        kind: "action",
        status: "dead",
        attempt: 3,
        max_attempts: 3,
        action_class: "communication",
        autonomy_level: "suggest",
        error_code: "step.failed",
        started_at: null,
        finished_at: NOW,
        created_at: NOW,
        retry: { blockers: [], retry_run_id: null },
      },
    ],
    events: [
      {
        event_id: 1,
        kind: "runtime.failure",
        actor_kind: "system",
        at: NOW,
        step_id: ID(2),
        detail: { error_code: "step.failed" },
      },
    ],
    approvals: [],
    drafts: [],
    outbox: [],
    ...over,
  };
}

function fakePorts(data: unknown, error: { message?: unknown; code?: unknown } | null = null) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const ports: RunHistoryPorts = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      return { data, error };
    },
  };
  return { ports, calls };
}

describe("WF-08 run history shapes", () => {
  it("parses a detail and keeps only allow-listed fields", () => {
    const parsed = parseRunDetail(detail());
    expect(parsed.steps[0]?.retry?.blockers).toEqual([]);
    expect(parsed.events[0]?.detail).toEqual({ error_code: "step.failed" });
  });

  it("rejects unknown keys anywhere, so a new column cannot leak by accident", () => {
    expect(() => parseRunDetail({ ...detail(), recipient_ids: [ID(9)] })).toThrow(RunHistoryError);
    const d = detail();
    (d.run as Record<string, unknown>).guardian_email = "x@y.invalid";
    expect(() => parseRunDetail(d)).toThrow(RunHistoryError);
    const e = detail();
    (e.events[0] as { detail: Record<string, unknown> }).detail.note = "free text";
    expect(() => parseRunDetail(e)).toThrow(RunHistoryError);
  });

  it("rejects an event detail whose code is free text", () => {
    const d = detail();
    (d.events[0] as { detail: Record<string, unknown> }).detail.error_code = "Call 0801234567";
    expect(() => parseRunDetail(d)).toThrow(RunHistoryError);
  });

  it("drops a workflow or template label that looks like an address or phone number", () => {
    const d = detail({
      drafts: [
        {
          draft_id: ID(3),
          step_id: ID(2),
          kind: "in_app",
          category: "communication",
          status: "draft",
          data_class: "internal",
          template_ref: "parent@example.invalid",
          recipient_count: 3,
          has_audience: false,
          has_webhook_target: false,
          param_count: 1,
          approval_id: null,
          created_at: NOW,
        },
      ],
    });
    (d.run as Record<string, unknown>).trigger_event_type = "+2348012345678";
    const parsed = parseRunDetail(d);
    expect(parsed.drafts[0]?.template_ref).toBeNull();
    expect(parsed.run.trigger_event_type).toBeNull();
    expect(JSON.stringify(parsed)).not.toMatch(/example\.invalid|2348012345678/);
  });

  it("parses a list and refuses a malformed one", () => {
    const item = {
      run_id: ID(1),
      workflow_key: "wf-a",
      status: "running",
      error_code: null,
      trigger_event_type: null,
      created_at: NOW,
      started_at: NOW,
      finished_at: null,
      step_count: 0,
      steps: { pending: 1 },
      open_approvals: 0,
      drafts: 0,
      executed: 0,
      retry_of_run_id: null,
      retry_generation: 0,
      retries: 0,
      has_dead_step: false,
      can_cancel: true,
    };
    expect(parseRunList({ items: [item], has_more: false }).items).toHaveLength(1);
    expect(() => parseRunList({ items: [{ ...item, status: "weird" }], has_more: false })).toThrow(
      RunHistoryError,
    );
    expect(() => parseRunList({ items: [{ ...item, payload: {} }], has_more: false })).toThrow(
      RunHistoryError,
    );
  });

  it("parses control results, including a replayed retry without a generation", () => {
    expect(
      parseCancelResult({ run_id: ID(1), status: "cancelled", replayed: false, steps_cancelled: 2 })
        .steps_cancelled,
    ).toBe(2);
    expect(parseRetryResult({ run_id: ID(1), replayed: true }).replayed).toBe(true);
    expect(() => parseCancelResult({ run_id: ID(1), status: "running" })).toThrow(RunHistoryError);
  });

  it("validates requests strictly: reason codes only, no free text, no extra keys", () => {
    expect(RunCancelInput.safeParse({ runId: ID(1), reason: "duplicate_run" }).success).toBe(true);
    expect(RunCancelInput.safeParse({ runId: ID(1), reason: "they were upset" }).success).toBe(
      false,
    );
    expect(RunRetryInput.safeParse({ stepId: ID(1), reason: "other", orgId: ID(2) }).success).toBe(
      false,
    );
    expect(RunListInput.parse({}).filter).toBe("all");
    expect(RunListInput.safeParse({ filter: "x" }).success).toBe(false);
    expect(RunListInput.safeParse({ workflow: "a; drop" }).success).toBe(false);
  });
});

describe("WF-08 errors", () => {
  it("maps database codes to safe sentences and never leaks unknown text", () => {
    expect(runErrorFromDatabase({ message: "wf08:effect_recorded" }).code).toBe("effect_recorded");
    expect(runErrorFromDatabase({ message: "wf07:actor_required" }).code).toBe("actor_required");
    const unknown = runErrorFromDatabase({
      message: "relation wf_run secret detail owner@x.invalid",
    });
    expect(unknown.code).toBe("unavailable");
    expect(unknown.message).not.toMatch(/owner@|wf_run/);
    expect(runErrorFromDatabase(null).code).toBe("unavailable");
  });

  it("has a sentence for every retry blocker and every one is plain language", () => {
    for (const code of RETRY_BLOCKER_CODES) {
      expect(RETRY_BLOCKER_MESSAGES[code].length).toBeGreaterThan(10);
      expect(runErrorMessage(code)).toBe(RETRY_BLOCKER_MESSAGES[code]);
    }
  });

  it("shows our sentences and nothing else from a thrown error", () => {
    expect(safeRunMessage(new Error(runErrorMessage("not_found")))).toBe(
      runErrorMessage("not_found"),
    );
    expect(safeRunMessage(new Error("password authentication failed"))).toBe(
      runErrorMessage("unavailable"),
    );
    expect(safeRunMessage("x")).toBe(runErrorMessage("unavailable"));
  });

  it("detects address and phone shapes", () => {
    expect(looksLikeContact("a@b.invalid")).toBe(true);
    expect(looksLikeContact("+234 801 234 5678")).toBe(true);
    expect(looksLikeContact("fees.invoice_overdue")).toBe(false);
    expect(safeLabel("0801234567")).toBe("");
    expect(safeLabel("wf-a")).toBe("wf-a");
    expect(safeLabel(5)).toBe("");
  });
});

describe("WF-08 server operations", () => {
  it("passes the verified actor id and filters to the list function", async () => {
    const { ports, calls } = fakePorts({ items: [], has_more: false });
    await listRuns(ports, { actorId: ID(7), filter: "failed", workflow: "wf-a" });
    expect(calls[0]).toEqual({
      fn: "wf_run_history_list",
      args: {
        p_actor: ID(7),
        p_status: "failed",
        p_workflow: "wf-a",
        p_before: null,
        p_limit: 25,
        p_before_id: null,
      },
    });
  });

  it("views a run through the detail function", async () => {
    const { ports, calls } = fakePorts(detail());
    const out = await viewRun(ports, { actorId: ID(7), runId: ID(1) });
    expect(out.run.run_id).toBe(ID(1));
    expect(calls[0]?.args).toEqual({ p_actor: ID(7), p_run: ID(1) });
  });

  it("cancels and retries through the control functions with a reason code", async () => {
    const c = fakePorts({
      run_id: ID(1),
      status: "cancelled",
      replayed: false,
      steps_cancelled: 1,
    });
    await cancelRun(c.ports, { actorId: ID(7), runId: ID(1), reason: "policy_change" });
    expect(c.calls[0]).toEqual({
      fn: "wf_run_cancel",
      args: { p_actor: ID(7), p_run: ID(1), p_reason: "policy_change" },
    });
    const r = fakePorts({ run_id: ID(5), replayed: false, generation: 1 });
    const out = await retryStep(r.ports, {
      actorId: ID(7),
      stepId: ID(2),
      reason: "fixed_upstream",
    });
    expect(out.run_id).toBe(ID(5));
    expect(r.calls[0]).toEqual({
      fn: "wf_run_retry",
      args: { p_actor: ID(7), p_step: ID(2), p_reason: "fixed_upstream" },
    });
  });

  it("maps a database refusal to its code and an exception to unavailable", async () => {
    const refused = fakePorts(null, { message: "wf08:retry_limit" });
    await expect(
      retryStep(refused.ports, { actorId: ID(7), stepId: ID(2), reason: "other" }),
    ).rejects.toMatchObject({ code: "retry_limit" });
    const broken: RunHistoryPorts = {
      rpc: async () => {
        throw new Error("connection refused at 10.0.0.5");
      },
    };
    const err = await viewRun(broken, { actorId: ID(7), runId: ID(1) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RunHistoryError);
    expect((err as RunHistoryError).message).not.toMatch(/10\.0\.0\.5/);
  });

  it("refuses a database answer that does not match the shape", async () => {
    const bad = fakePorts({ run: {}, steps: [] });
    await expect(viewRun(bad.ports, { actorId: ID(7), runId: ID(1) })).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});
