import { describe, expect, it } from "vitest";
import {
  LIMIT_ERROR_CODES,
  LimitsError,
  LimitsUpdateInput,
  RetentionRunInput,
  limitErrorFromDatabase,
  limitErrorMessage,
  parseLimitsUpdateResult,
  parseLimitsView,
  parseRetentionResult,
  safeLimitMessage,
} from "../../frontend/src/lib/workflow/limits";
import {
  getLimits,
  runRetention,
  updateLimits,
  type LimitsPorts,
} from "../../frontend/src/lib/workflow/limits.server";
import { runErrorFromDatabase, runErrorMessage } from "../../frontend/src/lib/workflow/run-history";

const ID = (n: number) => `f1200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const limits = {
  runs_per_day: 500,
  steps_per_run: 100,
  drafts_pending: 200,
  actions_per_hour: { email: 100, sms: 0 },
  wallet_cap_kobo_per_day: 0,
  wallet_cap_kobo_per_run: 0,
  retention_outbox_days: 90,
  retention_draft_days: 180,
  retention_event_days: 180,
  retention_run_days: 365,
  retention_stepup_days: 365,
  retention_evidence_days: 2555,
  retention_auto_purge: false,
};
const view = {
  limits,
  bounds: {
    runs_per_day: { default: 500, min: 1, max: 10000 },
    retention_auto_purge: { default: false },
  },
  usage: {
    runs_24h: 3,
    drafts_pending: 1,
    actions_1h: { email: 2 },
    spend_24h_kobo: 0,
    wallet_spendable_kobo: 0,
  },
  configured: true,
  settings_exist: true,
  denials_24h: [{ limit: "actions_per_hour", kind: "email", denied: 2 }],
  spend_kinds: [{ kind: "sms", rate_decided: false }],
  wallet_cap_ceiling_kobo: 0,
  last_retention: null,
  can_manage: true,
};

describe("WF-12 limits: request shapes", () => {
  it("accepts a partial patch and rejects an empty one", () => {
    expect(LimitsUpdateInput.safeParse({ runs_per_day: 10 }).success).toBe(true);
    expect(LimitsUpdateInput.safeParse({}).success).toBe(false);
  });

  it("rejects unknown keys, wrong types, fractions and out-of-range values", () => {
    for (const bad of [
      { org_id: ID(1) },
      { runs_per_day: "10" },
      { runs_per_day: 1.5 },
      { runs_per_day: 0 },
      { runs_per_day: 10001 },
      { retention_run_days: 179 },
      { retention_evidence_days: 729 },
      { retention_outbox_days: 29 },
      { retention_auto_purge: "yes" },
      { actions_per_hour: { carrier_pigeon: 1 } },
      { actions_per_hour: { email: -1 } },
      { actions_per_hour: { email: 5001 } },
      { wallet_cap_kobo_per_day: -1 },
    ]) {
      expect(LimitsUpdateInput.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("a real purge needs a dry run id; a dry run does not", () => {
    expect(RetentionRunInput.safeParse({ dryRun: true }).success).toBe(true);
    expect(RetentionRunInput.safeParse({ dryRun: false }).success).toBe(false);
    expect(RetentionRunInput.safeParse({ dryRun: false, dryRunId: "nope" }).success).toBe(false);
    expect(RetentionRunInput.safeParse({ dryRun: false, dryRunId: ID(2) }).success).toBe(true);
    expect(RetentionRunInput.safeParse({ dryRun: true, org: ID(1) }).success).toBe(false);
  });
});

describe("WF-12 limits: results", () => {
  it("parses a view and drops anything it does not know", () => {
    const parsed = parseLimitsView({ ...view, extra: "x", limits: { ...limits, secret: "x" } });
    expect(parsed.limits.runs_per_day).toBe(500);
    expect(JSON.stringify(parsed)).not.toContain("secret");
    expect(JSON.stringify(parsed)).not.toContain('"extra"');
  });

  it("refuses a malformed view with the generic message", () => {
    for (const bad of [null, {}, { ...view, usage: null }, { ...view, can_manage: "yes" }]) {
      expect(() => parseLimitsView(bad)).toThrow(LimitsError);
    }
  });

  it("parses update and retention results", () => {
    expect(parseLimitsUpdateResult({ limits }).runs_per_day).toBe(500);
    const result = parseRetentionResult({
      run_id: ID(3),
      mode: "dry_run",
      outcome: "completed",
      refusal_code: null,
      counts: { runs: 1, outbox: 2 },
      truncated: false,
    });
    expect(result.counts.runs).toBe(1);
    expect(() =>
      parseRetentionResult({ run_id: "x", mode: "dry_run", outcome: "completed", counts: {} }),
    ).toThrow();
  });
});

describe("WF-12 limits: errors", () => {
  it("maps database codes to fixed sentences and everything else to the generic one", () => {
    for (const code of LIMIT_ERROR_CODES) {
      expect(limitErrorFromDatabase({ message: `wf12:${code}` }).message).toBe(
        limitErrorMessage(code),
      );
    }
    for (const raw of ["wf12:not_a_code", "relation wf_org_limits does not exist", "", undefined]) {
      expect(limitErrorFromDatabase({ message: raw }).message).toBe(
        limitErrorMessage("unavailable"),
      );
    }
    expect(limitErrorFromDatabase(null).code).toBe("unavailable");
  });

  it("shows only our sentences", () => {
    expect(safeLimitMessage(new Error("password=hunter2"))).toBe(limitErrorMessage("unavailable"));
    expect(safeLimitMessage(new LimitsError("invalid_limit"))).toBe(
      limitErrorMessage("invalid_limit"),
    );
  });

  it("run history now explains a daily quota refusal on retry", () => {
    const err = runErrorFromDatabase({ message: "wf12:quota_runs_per_day" });
    expect(err.code).toBe("quota_runs_per_day");
    expect(err.message).toBe(runErrorMessage("quota_runs_per_day"));
    expect(err.message).toMatch(/daily limit/);
  });
});

describe("WF-12 limits: server operations forward the verified actor and nothing else", () => {
  function ports(
    data: unknown,
    error: LimitsPorts extends never ? never : { message: string } | null = null,
  ) {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const p: LimitsPorts = {
      rpc: async (fn, args) => {
        calls.push({ fn, args });
        return { data, error };
      },
    };
    return { p, calls };
  }

  it("reads, updates and runs retention through the three functions", async () => {
    const a = ports(view);
    await getLimits(a.p, { actorId: ID(9) });
    expect(a.calls).toEqual([{ fn: "wf_limits_get", args: { p_actor: ID(9) } }]);

    const b = ports({ limits });
    await updateLimits(b.p, { actorId: ID(9), patch: { runs_per_day: 10 } });
    expect(b.calls).toEqual([
      { fn: "wf_limits_update", args: { p_actor: ID(9), p_patch: { runs_per_day: 10 } } },
    ]);

    const c = ports({
      run_id: ID(3),
      mode: "dry_run",
      outcome: "completed",
      refusal_code: null,
      counts: {},
    });
    await runRetention(c.p, { actorId: ID(9), dryRun: true, dryRunId: null });
    expect(c.calls).toEqual([
      {
        fn: "wf_retention_run_manual",
        args: { p_actor: ID(9), p_dry_run: true, p_dry_run_id: null },
      },
    ]);
  });

  it("turns database refusals and transport failures into safe errors", async () => {
    await expect(
      getLimits(ports(null, { message: "wf12:not_authorized" }).p, { actorId: ID(9) }),
    ).rejects.toMatchObject({ code: "not_authorized" });
    await expect(
      updateLimits(ports(null, { message: "wf12:invalid_limit" }).p, {
        actorId: ID(9),
        patch: { runs_per_day: 1 },
      }),
    ).rejects.toMatchObject({ code: "invalid_limit" });
    await expect(
      runRetention(ports(null, { message: "wf12:dry_run_required" }).p, {
        actorId: ID(9),
        dryRun: false,
        dryRunId: ID(4),
      }),
    ).rejects.toMatchObject({ code: "dry_run_required" });
    const down: LimitsPorts = {
      rpc: async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.1");
      },
    };
    await expect(getLimits(down, { actorId: ID(9) })).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});
