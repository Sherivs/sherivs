import { describe, expect, it } from "vitest";
import type {
  AdapterCall,
  ConnectorAdapter,
  HttpPort,
  HttpRequest,
} from "../../frontend/src/lib/connector-adapters/adapter-contract";
import {
  executeCleared,
  scrubSecret,
  type GateLedgerPort,
  type GatePorts,
  type LoadedDecision,
} from "../../frontend/src/lib/connector-adapters/execution-gate.server";
import { githubReadAdapter } from "../../frontend/src/lib/connector-adapters/github-read-adapter";
import { allowlistedHttp } from "../../frontend/src/lib/connector-adapters/http-egress";
import { JARVIS_EXECUTIVE_PACK } from "../../frontend/src/lib/jarvis-executive/executive-pack";
import {
  JARVIS_BINDINGS,
  type BindingTable,
} from "../../frontend/src/lib/playbook-runner/capability-bindings";
import {
  driveRun,
  type RunnerPorts,
} from "../../frontend/src/lib/playbook-runner/playbook-runner.server";
import { startRun } from "../../frontend/src/lib/playbook-runner/run-state";
import type {
  ActingContext,
  BrokerState,
  Verdict,
} from "../../frontend/src/lib/tool-broker/broker";
import { VERDICTS } from "../../frontend/src/lib/tool-broker/broker";
import type {
  AuthorityPort,
  DecisionRecord,
  LedgerPort,
} from "../../frontend/src/lib/tool-broker/broker-service.server";
import type { ConnectorBinding } from "../../frontend/src/lib/tool-broker/connector-vault";
import { toolById } from "../../frontend/src/lib/tool-broker/platform-tools";
import { argsDigest } from "../../frontend/src/lib/tool-broker/redact.server";
import { createToolLedgerDb } from "../../frontend/src/lib/tool-broker/tool-ledger-db.server";
import type { RolePack } from "../../frontend/src/lib/twin-engine/role-pack";

const SECRET = "ghp_" + "S".repeat(36);
const readTool = toolById("github.read")!;
const binding: ConnectorBinding = {
  connector: "github",
  scope: "platform",
  secretRef: "vault://github/main#v1",
  status: "active",
};
const lcg = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;

function fakeHttp(respond: (r: HttpRequest) => { status: number; bodyText: string } | Error) {
  const calls: HttpRequest[] = [];
  const port: HttpPort = {
    async request(r) {
      calls.push(r);
      const out = respond(r);
      if (out instanceof Error) throw out;
      return out;
    },
  };
  return { port, calls };
}
const ok = (body: unknown) => ({ status: 200, bodyText: JSON.stringify(body) });
const callOf = (args: Record<string, unknown>, http: HttpPort): AdapterCall => ({
  tool: readTool,
  args,
  binding,
  secret: SECRET,
  http,
  idempotencyKey: "k",
});

describe("ENGINE-06 egress allowlist", () => {
  it("blocks every request that is not https to an allowed host", async () => {
    const h = fakeHttp(() => ok({}));
    const guarded = allowlistedHttp(h.port, ["api.github.com"]);
    const base = { method: "GET" as const, headers: {}, timeoutMs: 1 };
    for (const url of [
      "https://evil.example/x",
      "http://api.github.com/x",
      "https://api.github.com:8443/x",
      "https://user:pw@api.github.com/x",
      "https://user@api.github.com/x",
      "https://api.github.com.evil.example/x",
      "not a url",
      "//api.github.com/x",
    ]) {
      await expect(guarded.request({ ...base, url }), url).rejects.toThrow("egress_blocked");
    }
    expect(h.calls).toHaveLength(0);
    await guarded.request({ ...base, url: "https://API.github.com/x" });
    expect(h.calls).toHaveLength(1);
  });
});

describe("ENGINE-06 GitHub read adapter", () => {
  it("performs a GET to api.github.com with the secret only in the Authorization header", async () => {
    const h = fakeHttp(() =>
      ok({
        full_name: "Sherivs/sherivs",
        private: true,
        default_branch: "master",
        open_issues_count: 3,
        pushed_at: "2026-11-14T00:00:00Z",
        owner: { email: "x@y.z" },
        token: "t",
      }),
    );
    const r = await githubReadAdapter.execute(
      callOf({ operation: "get_repo", owner: "Sherivs", repo: "sherivs" }, h.port),
    );
    expect(r).toEqual({
      outcome: "succeeded",
      summary: {
        fullName: "Sherivs/sherivs",
        private: true,
        defaultBranch: "master",
        openIssues: 3,
        pushedAt: "2026-11-14T00:00:00Z",
      },
    });
    expect(h.calls).toHaveLength(1);
    const req = h.calls[0]!;
    expect(req.method).toBe("GET");
    expect(req.url).toBe("https://api.github.com/repos/Sherivs/sherivs");
    expect(req.headers["Authorization"]).toBe(`Bearer ${SECRET}`);
    expect(req.url).not.toContain(SECRET);
    expect(JSON.stringify(r)).not.toContain("x@y.z");
  });

  it("keeps only allowlisted fields of pull requests and commits", async () => {
    const pr = {
      number: 7,
      title: "T",
      state: "open",
      draft: true,
      user: { login: "a", email: "e" },
      head: { ref: "h", sha: "s" },
      base: { ref: "master" },
      updated_at: "u",
      html_url: "https://github.com/x",
      body: "SECRET BODY",
      labels: [1],
    };
    const h = fakeHttp(() => ok([pr]));
    const r = await githubReadAdapter.execute(
      callOf({ operation: "list_pull_requests", owner: "o", repo: "r" }, h.port),
    );
    expect(r.outcome).toBe("succeeded");
    expect(JSON.stringify(r)).not.toMatch(/SECRET BODY|"e"|labels|"s"/);
    expect(h.calls[0]!.url).toContain("pulls?state=open&per_page=10");
    const h2 = fakeHttp(() =>
      ok([
        {
          sha: "abcdef1234567",
          commit: { message: "first line\nsecond", author: { date: "d" } },
          author: { login: "a" },
        },
      ]),
    );
    const c = await githubReadAdapter.execute(
      callOf({ operation: "list_commits", owner: "o", repo: "r", perPage: 5 }, h2.port),
    );
    expect(c).toEqual({
      outcome: "succeeded",
      summary: [{ sha: "abcdef1", message: "first line", author: "a", date: "d" }],
    });
  });

  it("derives a safe default from a playbook subject reference", async () => {
    const h = fakeHttp(() => ok([]));
    expect(
      (
        await githubReadAdapter.execute(
          callOf({ subjectRef: "github:Sherivs/sherivs", correlationId: "c" }, h.port),
        )
      ).outcome,
    ).toBe("succeeded");
    expect(h.calls[0]!.url).toBe(
      "https://api.github.com/repos/Sherivs/sherivs/pulls?state=open&per_page=10",
    );
  });

  it("rejects invalid arguments before any request", async () => {
    const h = fakeHttp(() => ok({}));
    const bad: Array<Record<string, unknown>> = [
      { operation: "get_repo", owner: "../x", repo: "r" },
      { operation: "get_repo", owner: "o/p", repo: "r" },
      { operation: "get_repo", owner: "o", repo: "r?x=1" },
      { operation: "list_commits", owner: "o", repo: "r", perPage: 31 },
      { operation: "get_pull_request", owner: "o", repo: "r" },
      { operation: "delete_repo", owner: "o", repo: "r" },
      { operation: "get_repo", owner: "o", repo: "r", extra: 1 },
      { subjectRef: "gitlab:o/r" },
      {},
    ];
    for (const a of bad)
      expect(await githubReadAdapter.execute(callOf(a, h.port)), JSON.stringify(a)).toEqual({
        outcome: "failed",
        code: "invalid_args",
      });
    expect(h.calls).toHaveLength(0);
  });

  it("refuses any tool but github.read", async () => {
    const h = fakeHttp(() => ok({}));
    const w = {
      ...callOf({ operation: "get_repo", owner: "o", repo: "r" }, h.port),
      tool: toolById("github.pr.draft")!,
    };
    expect(await githubReadAdapter.execute(w)).toEqual({
      outcome: "failed",
      code: "unsupported_operation",
    });
    expect(h.calls).toHaveLength(0);
  });

  it("maps upstream failures to codes without echoing the body", async () => {
    const cases: Array<[number, string]> = [
      [401, "unauthorized"],
      [403, "forbidden"],
      [404, "not_found"],
      [429, "rate_limited"],
      [500, "upstream_error"],
      [302, "bad_response"],
      [418, "bad_response"],
    ];
    for (const [status, code] of cases) {
      const h = fakeHttp(() => ({ status, bodyText: `leak ${SECRET}` }));
      const r = await githubReadAdapter.execute(
        callOf({ operation: "get_repo", owner: "o", repo: "r" }, h.port),
      );
      expect(r, String(status)).toEqual({ outcome: "failed", code });
    }
    const big = fakeHttp(() => ({
      status: 200,
      bodyText: JSON.stringify({ full_name: "x".repeat(600_000) }),
    }));
    expect(
      await githubReadAdapter.execute(
        callOf({ operation: "get_repo", owner: "o", repo: "r" }, big.port),
      ),
    ).toEqual({ outcome: "failed", code: "bad_response" });
    const junk = fakeHttp(() => ({ status: 200, bodyText: "<html>" }));
    expect(
      await githubReadAdapter.execute(
        callOf({ operation: "get_repo", owner: "o", repo: "r" }, junk.port),
      ),
    ).toEqual({ outcome: "failed", code: "bad_response" });
    const down = fakeHttp(() => new Error(`network ${SECRET}`));
    expect(
      await githubReadAdapter.execute(
        callOf({ operation: "get_repo", owner: "o", repo: "r" }, down.port),
      ),
    ).toEqual({ outcome: "failed", code: "timeout" });
  });
});

describe("ENGINE-06 secret scrubbing", () => {
  it("removes the secret at any depth, in values and keys", () => {
    const out = JSON.stringify(
      scrubSecret({ a: `x ${SECRET} y`, [SECRET]: 1, n: [{ m: SECRET }], k: 5 }, SECRET),
    );
    expect(out).not.toContain(SECRET);
    expect(out).toContain("[withheld]");
    expect(scrubSecret({ a: 1 }, "")).toEqual({ a: 1 });
  });
});

/* ---------- in-memory ledger implementing both ports ---------- */
interface Row {
  id: string;
  kind: "decision" | "outcome";
  parent?: string;
  key?: string;
  ctx: string;
  tenant: string;
  ctxKind: "tenant_membership" | "platform_staff";
  tool: string;
  ver: string;
  tier: LoadedDecision["tier"];
  verdict?: Verdict;
  digest: string;
  outcome?: string;
  approval?: { approvalRef: string; approverKind: string } | null;
  approver?: string;
}
function memLedger(opts: { ctxKind?: "tenant_membership" | "platform_staff" } = {}) {
  const rows: Row[] = [];
  const failLoad = { on: false };
  const failAppend = { on: false };
  const port: LedgerPort & GateLedgerPort = {
    async findDecision({ idempotencyKey }) {
      const r = rows.find((x) => x.kind === "decision" && x.key === idempotencyKey);
      return r
        ? ({
            id: r.id,
            decision: {
              verdict: r.verdict!,
              tier: r.tier,
              reasons: [],
              ...(r.approver ? { approver: r.approver as never } : {}),
            },
            argsDigest: r.digest,
          } as DecisionRecord)
        : null;
    },
    async appendDecision(i) {
      const id = `d${rows.length + 1}`;
      rows.push({
        id,
        kind: "decision",
        key: i.idempotencyKey,
        ctx: i.twinContextId,
        tenant: i.tenantRef,
        ctxKind: opts.ctxKind ?? "platform_staff",
        tool: i.tool.id,
        ver: i.tool.version,
        tier: i.decision.tier,
        verdict: i.decision.verdict,
        digest: i.argsDigest,
        approver: i.decision.approver,
      });
      return { id };
    },
    async loadDecision(id) {
      if (failLoad.on) throw new Error("down");
      const r = rows.find((x) => x.id === id && x.kind === "decision");
      return r
        ? {
            id: r.id,
            twinContextId: r.ctx,
            tenantRef: r.tenant,
            contextKind: r.ctxKind,
            toolId: r.tool,
            toolVersion: r.ver,
            tier: r.tier,
            verdict: r.verdict!,
            argsDigest: r.digest,
          }
        : null;
    },
    async hasSucceeded(id) {
      return rows.some((x) => x.kind === "outcome" && x.parent === id && x.outcome === "succeeded");
    },
    async appendOutcome({ decision, outcome, approval }) {
      if (failAppend.on) throw new Error("down");
      const id = `o${rows.length + 1}`;
      rows.push({
        id,
        kind: "outcome",
        parent: decision.id,
        ctx: decision.twinContextId,
        tenant: decision.tenantRef,
        ctxKind: opts.ctxKind ?? "platform_staff",
        tool: decision.toolId,
        ver: decision.toolVersion,
        tier: decision.tier,
        digest: decision.argsDigest,
        outcome,
        approval,
      });
      return { id };
    },
  };
  return { rows, port, failLoad, failAppend };
}

function gate(
  over: Partial<GatePorts> = {},
  led = memLedger(),
  http = fakeHttp(() => ok({ full_name: `echo ${SECRET}` })),
) {
  const secrets = { calls: 0 };
  const ports: GatePorts = {
    ledger: led.port,
    adapters: { github: githubReadAdapter },
    secrets: {
      async resolve() {
        secrets.calls++;
        return SECRET;
      },
    },
    bindings: async () => binding,
    http: http.port,
    ...over,
  };
  return { ports, led, http, secrets };
}

const ARGS = { operation: "get_repo", owner: "o", repo: "r" };
async function decide(
  led: ReturnType<typeof memLedger>,
  verdict: Verdict,
  tool = readTool,
  args: Record<string, unknown> = ARGS,
  tenant = "sherivs-platform",
) {
  const { id } = await led.port.appendDecision({
    twinContextId: "ctx",
    tenantRef: tenant,
    tool,
    decision: { verdict, tier: tool.tier, reasons: [] },
    argsDigest: argsDigest(args),
    argsRedacted: {},
    idempotencyKey: `k-${led.rows.length}`,
  });
  return id;
}

describe("ENGINE-06 execution gate", () => {
  it("runs a cleared call once, records the outcome, and never returns the secret", async () => {
    const g = gate();
    const id = await decide(g.led, "execute");
    const r = await executeCleared(g.ports, {
      decisionId: id,
      args: ARGS,
      idempotencyKey: "k",
      approval: null,
    });
    expect(r).toMatchObject({ ok: true, outcome: "succeeded", errorCode: null });
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(JSON.stringify(g.led.rows)).not.toContain(SECRET);
    expect(g.led.rows.filter((x) => x.kind === "outcome")).toHaveLength(1);
    const again = await executeCleared(g.ports, {
      decisionId: id,
      args: ARGS,
      idempotencyKey: "k",
      approval: null,
    });
    expect(again).toEqual({ ok: false, error: "already_succeeded" });
    expect(g.http.calls).toHaveLength(1);
  });

  it("refuses, writing nothing and calling nothing, when the call is not cleared", async () => {
    const run = async (
      verdict: Verdict,
      approval: {
        approvalRef: string;
        approverKind: "role_owner" | "platform_staff" | "sheriff";
      } | null,
      expected: string,
    ) => {
      const g2 = gate();
      const id = await decide(g2.led, verdict);
      const r = await executeCleared(g2.ports, {
        decisionId: id,
        args: ARGS,
        idempotencyKey: "k",
        approval,
      });
      expect(r, `${verdict}/${approval?.approverKind}`).toEqual({ ok: false, error: expected });
      expect(g2.http.calls).toHaveLength(0);
      expect(g2.led.rows.filter((x) => x.kind === "outcome")).toHaveLength(0);
    };
    for (const v of ["shadow", "propose", "deny"] as Verdict[])
      await run(v, { approvalRef: "a", approverKind: "sheriff" }, "not_cleared");
    await run("queue_approval", null, "not_cleared");
    await run("queue_approval", { approvalRef: " ", approverKind: "role_owner" }, "not_cleared");
    await run("sheriff_passkey", null, "not_cleared");
    await run(
      "sheriff_passkey",
      { approvalRef: "a", approverKind: "platform_staff" },
      "not_cleared",
    );
    await run("sheriff_passkey", { approvalRef: "a", approverKind: "role_owner" }, "not_cleared");
  });

  it("an approved decision runs and the outcome carries the approval", async () => {
    const g2 = gate();
    const id = await decide(g2.led, "sheriff_passkey");
    const r = await executeCleared(g2.ports, {
      decisionId: id,
      args: ARGS,
      idempotencyKey: "k",
      approval: { approvalRef: "ap-1", approverKind: "sheriff" },
    });
    expect(r).toMatchObject({ ok: true, outcome: "succeeded" });
    expect(g2.led.rows.at(-1)!.approval).toEqual({ approvalRef: "ap-1", approverKind: "sheriff" });
  });

  it("refuses unknown decisions, changed arguments, unknown tools and platform-only tools from a tenant", async () => {
    const g2 = gate();
    expect(
      await executeCleared(g2.ports, {
        decisionId: "nope",
        args: ARGS,
        idempotencyKey: "k",
        approval: null,
      }),
    ).toEqual({ ok: false, error: "unknown_decision" });
    const id = await decide(g2.led, "execute");
    expect(
      await executeCleared(g2.ports, {
        decisionId: id,
        args: { ...ARGS, repo: "other" },
        idempotencyKey: "k",
        approval: null,
      }),
    ).toEqual({ ok: false, error: "args_mismatch" });
    const fake = { ...readTool, id: "ghost.tool" };
    const id2 = await decide(g2.led, "execute", fake);
    expect(
      await executeCleared(g2.ports, {
        decisionId: id2,
        args: ARGS,
        idempotencyKey: "k",
        approval: null,
      }),
    ).toEqual({ ok: false, error: "unknown_tool" });
    const tenantLed = memLedger({ ctxKind: "tenant_membership" });
    const g3 = gate({}, tenantLed);
    const slack = toolById("slack.read")!;
    const id3 = await decide(tenantLed, "execute", slack, ARGS, "t1");
    expect(
      await executeCleared(g3.ports, {
        decisionId: id3,
        args: ARGS,
        idempotencyKey: "k",
        approval: null,
      }),
    ).toEqual({ ok: false, error: "not_cleared" });
    expect(g2.http.calls.length + g3.http.calls.length).toBe(0);
  });

  it("refuses a decision whose recorded tier differs from the registered tool tier", async () => {
    const g2 = gate();
    const { id } = await g2.led.port.appendDecision({
      twinContextId: "ctx",
      tenantRef: "sherivs-platform",
      tool: readTool,
      decision: { verdict: "execute", tier: "T3", reasons: [] },
      argsDigest: argsDigest(ARGS),
      argsRedacted: {},
      idempotencyKey: "tier",
    });
    expect(
      await executeCleared(g2.ports, {
        decisionId: id,
        args: ARGS,
        idempotencyKey: "k",
        approval: null,
      }),
    ).toEqual({ ok: false, error: "unknown_tool" });
    expect(g2.http.calls).toHaveLength(0);
  });

  it("an execute verdict records no approval even if one is supplied", async () => {
    const g2 = gate();
    const id = await decide(g2.led, "execute");
    const r = await executeCleared(g2.ports, {
      decisionId: id,
      args: ARGS,
      idempotencyKey: "k",
      approval: { approvalRef: "stray", approverKind: "sheriff" },
    });
    expect(r).toMatchObject({ ok: true, outcome: "succeeded" });
    expect(g2.led.rows.at(-1)!.approval).toBeNull();
  });

  it("refuses without an adapter, or when the adapter does not declare the tool", async () => {
    const none = gate({ adapters: {} });
    const id = await decide(none.led, "execute");
    expect(
      await executeCleared(none.ports, {
        decisionId: id,
        args: ARGS,
        idempotencyKey: "k",
        approval: null,
      }),
    ).toEqual({ ok: false, error: "no_adapter" });
    const narrow: ConnectorAdapter = {
      connector: "github",
      tools: ["github.pr.draft"],
      execute: githubReadAdapter.execute,
    };
    const g2 = gate({ adapters: { github: narrow } });
    const id2 = await decide(g2.led, "execute");
    expect(
      await executeCleared(g2.ports, {
        decisionId: id2,
        args: ARGS,
        idempotencyKey: "k",
        approval: null,
      }),
    ).toEqual({ ok: false, error: "no_adapter" });
    const wrongName: ConnectorAdapter = { ...githubReadAdapter, connector: "slack" };
    const g3 = gate({ adapters: { github: wrongName } });
    expect(
      await executeCleared(g3.ports, {
        decisionId: await decide(g3.led, "execute"),
        args: ARGS,
        idempotencyKey: "k",
        approval: null,
      }),
    ).toEqual({ ok: false, error: "no_adapter" });
  });

  it("refuses an unavailable, revoked, mis-scoped or secret-shaped binding, and never resolves the secret", async () => {
    const bad: Array<[string, ConnectorBinding | null]> = [
      ["none", null],
      ["revoked", { ...binding, status: "revoked" }],
      ["tenant scope", { ...binding, scope: "tenant", tenantRef: "sherivs-platform" }],
      ["secret shaped", { ...binding, secretRef: "vault://github/ghp_" + "a".repeat(30) + "#v1" }],
      ["other connector", { ...binding, connector: "slack", secretRef: "vault://slack/m#v1" }],
    ];
    for (const [name, b] of bad) {
      const g2 = gate({ bindings: async () => b });
      const id = await decide(g2.led, "execute");
      expect(
        await executeCleared(g2.ports, {
          decisionId: id,
          args: ARGS,
          idempotencyKey: "k",
          approval: null,
        }),
        name,
      ).toEqual({ ok: false, error: "binding_unavailable" });
      expect(g2.secrets.calls, name).toBe(0);
    }
  });

  it("records a failed outcome when the secret is missing or the adapter throws, without echoing errors", async () => {
    const a = gate({
      secrets: {
        async resolve() {
          return null;
        },
      },
    });
    const r1 = await executeCleared(a.ports, {
      decisionId: await decide(a.led, "execute"),
      args: ARGS,
      idempotencyKey: "k",
      approval: null,
    });
    expect(r1).toMatchObject({ ok: true, outcome: "failed", errorCode: "secret_unavailable" });
    expect(a.http.calls).toHaveLength(0);
    const boom: ConnectorAdapter = {
      connector: "github",
      tools: ["github.read"],
      async execute() {
        throw new Error(`boom ${SECRET}`);
      },
    };
    const b = gate({ adapters: { github: boom } });
    const r2 = await executeCleared(b.ports, {
      decisionId: await decide(b.led, "execute"),
      args: ARGS,
      idempotencyKey: "k",
      approval: null,
    });
    expect(r2).toMatchObject({ ok: true, outcome: "failed", errorCode: "adapter_error" });
    expect(JSON.stringify([r2, b.led.rows])).not.toContain(SECRET);
    const c = gate({
      secrets: {
        async resolve() {
          throw new Error(SECRET);
        },
      },
    });
    const r3 = await executeCleared(c.ports, {
      decisionId: await decide(c.led, "execute"),
      args: ARGS,
      idempotencyKey: "k",
      approval: null,
    });
    expect(r3).toMatchObject({ ok: true, outcome: "failed" });
    expect(JSON.stringify(r3)).not.toContain(SECRET);
  });

  it("fails loudly when the ledger is down or the outcome cannot be recorded", async () => {
    const a = gate();
    const id = await decide(a.led, "execute");
    a.led.failLoad.on = true;
    expect(
      await executeCleared(a.ports, {
        decisionId: id,
        args: ARGS,
        idempotencyKey: "k",
        approval: null,
      }),
    ).toEqual({ ok: false, error: "ledger_unavailable" });
    expect(a.http.calls).toHaveLength(0);
    const b = gate();
    const id2 = await decide(b.led, "execute");
    b.led.failAppend.on = true;
    expect(
      await executeCleared(b.ports, {
        decisionId: id2,
        args: ARGS,
        idempotencyKey: "k",
        approval: null,
      }),
    ).toEqual({ ok: false, error: "outcome_unrecorded" });
  });

  it("property: the adapter runs only for a cleared, matching, bound, first-time call, and the secret never leaks", async () => {
    const r = lcg(31337);
    for (let i = 0; i < 1500; i++) {
      const verdict = VERDICTS[Math.floor(r() * VERDICTS.length)] as Verdict;
      const approvals = [
        null,
        { approvalRef: "a", approverKind: "sheriff" as const },
        { approvalRef: "a", approverKind: "platform_staff" as const },
        { approvalRef: "", approverKind: "sheriff" as const },
      ];
      const approval = approvals[Math.floor(r() * approvals.length)]!;
      const bnd =
        r() < 0.8
          ? { ...binding, status: r() < 0.85 ? ("active" as const) : ("revoked" as const) }
          : null;
      const g2 = gate(
        { bindings: async () => bnd },
        memLedger(),
        fakeHttp(() => ok({ full_name: `x ${SECRET}` })),
      );
      const id = await decide(g2.led, verdict);
      const args = r() < 0.85 ? ARGS : { ...ARGS, repo: "changed" };
      const res = await executeCleared(g2.ports, {
        decisionId: id,
        args,
        idempotencyKey: "k",
        approval,
      });
      if (g2.http.calls.length > 0) {
        expect(["execute", "queue_approval", "sheriff_passkey"]).toContain(verdict);
        if (verdict === "sheriff_passkey")
          expect(approval).toMatchObject({ approverKind: "sheriff" });
        if (verdict !== "execute") expect(approval?.approvalRef.trim()).toBeTruthy();
        expect(argsDigest(args)).toBe(argsDigest(ARGS));
        expect(bnd?.status).toBe("active");
      }
      expect(JSON.stringify([res, g2.led.rows])).not.toContain(SECRET);
    }
  });
});

describe("ENGINE-06 end to end: runner, broker, gate and adapter", () => {
  it("a playbook step reads GitHub through the broker and the gate, leaving a decision and an outcome", async () => {
    const base = JARVIS_EXECUTIVE_PACK;
    const pack: RolePack = {
      ...base,
      capabilities: [
        ...base.capabilities,
        {
          id: "read.repo",
          title: "Read a repository",
          tier: "T0",
          autonomy: "act_autonomously",
          connector: "github",
          requiresPermission: "platform.tenants.read",
        },
      ],
      playbooks: [
        {
          id: "repo.check",
          title: "Repository check",
          wakeOn: ["repo.check.due"],
          steps: ["read.repo"],
          maxRunsPerDay: 5,
        },
      ],
    };
    const bindings: BindingTable = {
      ...JARVIS_BINDINGS,
      "read.repo": { kind: "tool", toolId: "github.read" },
    };
    const led = memLedger();
    const http = fakeHttp(() =>
      ok([{ number: 1, title: "A PR", state: "open", user: { login: "dev" } }]),
    );
    const g = gate({}, led, http);
    const authority: AuthorityPort = {
      async resolve({ tool }) {
        const ctx: ActingContext = {
          kind: "platform_staff",
          tenantRef: "sherivs-platform",
          status: "active",
          permissions: new Set(pack.permissions),
          capability: {
            id: "read.repo",
            tier: "T0",
            requiresPermission: "platform.tenants.read",
            connector: "github",
          },
          effective: "act_autonomously",
        };
        const state: BrokerState = {
          killSwitch: false,
          disabledTools: new Set(),
          callsThisHour: 0,
          binding: tool.connector === "github" ? binding : null,
        };
        return { ctx, state };
      },
    };
    const ports: RunnerPorts = {
      broker: { authority, ledger: led.port },
      killSwitch: async () => false,
      effective: async () => "act_autonomously",
      handlers: {},
      execute: async ({ decisionId, args, idempotencyKey, approval }) => {
        const r = await executeCleared(g.ports, { decisionId, args, idempotencyKey, approval });
        return r.ok && r.outcome === "succeeded" ? "succeeded" : "failed";
      },
    };
    const run = startRun(
      {
        eventId: "e",
        kind: "repo.check.due",
        source: "scheduler",
        tenantRef: "sherivs-platform",
        contextId: "ctx",
        occurredAtMs: 1,
        correlationId: "c",
        subjectRef: "github:Sherivs/sherivs",
      },
      "repo.check",
      "run-gh",
    );
    const out = await driveRun(ports, pack, bindings, run, { actionsToday: 0 });
    expect(out.run.status).toBe("completed");
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0]!.url).toBe(
      "https://api.github.com/repos/Sherivs/sherivs/pulls?state=open&per_page=10",
    );
    expect(led.rows.map((r) => r.kind + ":" + (r.verdict ?? r.outcome))).toEqual([
      "decision:execute",
      "outcome:succeeded",
    ]);
    expect(JSON.stringify(led.rows)).not.toContain(SECRET);
  });
});

/* ---------- DB ledger adapter over a fake client ---------- */
function fakeClient() {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    cg_tool_call_ledger: [],
    cg_twin_context: [{ id: "ctx-1", context_kind: "platform_staff" }],
  };
  let n = 0;
  const from = (name: string) => {
    const filters: Array<[string, unknown]> = [];
    let cols = "";
    let insertRow: Record<string, unknown> | null = null;
    let limit = Infinity;
    const run = (): { data: unknown; error: { message: string; code?: string } | null } => {
      const rows = tables[name]!;
      if (insertRow) {
        if (
          insertRow["kind"] === "decision" &&
          insertRow["idempotency_key"] &&
          rows.some(
            (r) =>
              r["kind"] === "decision" &&
              r["twin_context_id"] === insertRow!["twin_context_id"] &&
              r["tool_id"] === insertRow!["tool_id"] &&
              r["idempotency_key"] === insertRow!["idempotency_key"],
          )
        ) {
          return { data: null, error: { message: "duplicate key", code: "23505" } };
        }
        const row = { id: `row-${++n}`, ...insertRow };
        rows.push(row);
        return { data: { id: row["id"] }, error: null };
      }
      const hit = rows.filter((r) => filters.every(([k, v]) => r[k] === v)).slice(0, limit);
      const out = hit.map((r) =>
        cols.includes("twin_context:")
          ? {
              ...r,
              twin_context: {
                context_kind: tables["cg_twin_context"]!.find(
                  (c) => c["id"] === r["twin_context_id"],
                )?.["context_kind"],
              },
            }
          : r,
      );
      return { data: out, error: null };
    };
    const b: Record<string, unknown> = {
      select(c: string) {
        cols = c;
        return b;
      },
      eq(k: string, v: unknown) {
        filters.push([k, v]);
        return b;
      },
      limit(l: number) {
        limit = l;
        return b;
      },
      insert(r: Record<string, unknown>) {
        insertRow = r;
        return b;
      },
      async maybeSingle() {
        const r = run();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
      },
      async single() {
        return run();
      },
      then(res: (v: unknown) => unknown) {
        return Promise.resolve(run()).then(res);
      },
    };
    return b;
  };
  return { client: { from } as never, tables };
}

describe("ENGINE-06 DB tool ledger", () => {
  const tool = toolById("owner.alert.send")!;
  const input = (key: string | undefined, verdict: Verdict = "execute", approver?: "sheriff") => ({
    twinContextId: "ctx-1",
    tenantRef: "sherivs-platform",
    tool,
    decision: { verdict, tier: tool.tier, reasons: ["r"], ...(approver ? { approver } : {}) },
    argsDigest: "a".repeat(64),
    argsRedacted: { x: 1 },
    idempotencyKey: key,
  });

  it("appends and finds a decision, round-tripping the required approver", async () => {
    const f = fakeClient();
    const db = createToolLedgerDb(f.client);
    const { id } = await db.appendDecision(input("k1", "sheriff_passkey", "sheriff"));
    const found = await db.findDecision({
      twinContextId: "ctx-1",
      toolId: tool.id,
      idempotencyKey: "k1",
    });
    expect(found).toMatchObject({
      id,
      argsDigest: "a".repeat(64),
      decision: { verdict: "sheriff_passkey", approver: "sheriff", tier: "T1" },
    });
    expect(
      await db.findDecision({ twinContextId: "ctx-1", toolId: tool.id, idempotencyKey: "other" }),
    ).toBeNull();
  });

  it("findDecision ignores outcome rows that share a decision's key", async () => {
    const f = fakeClient();
    const db = createToolLedgerDb(f.client);
    f.tables["cg_tool_call_ledger"]!.push({
      id: "o-x",
      kind: "outcome",
      twin_context_id: "ctx-1",
      tool_id: tool.id,
      idempotency_key: "shared",
      verdict: "execute",
      tier: "T1",
      deny_code: null,
      reasons: [],
      args_digest: "a".repeat(64),
      approver_kind: null,
    });
    expect(
      await db.findDecision({ twinContextId: "ctx-1", toolId: tool.id, idempotencyKey: "shared" }),
    ).toBeNull();
  });

  it("returns the winning row when a concurrent call with the same key races", async () => {
    const f = fakeClient();
    const db = createToolLedgerDb(f.client);
    const a = await db.appendDecision(input("dup"));
    const b = await db.appendDecision(input("dup"));
    expect(b.id).toBe(a.id);
    expect(f.tables["cg_tool_call_ledger"]).toHaveLength(1);
  });

  it("loads a decision with its context kind, records outcomes, and answers hasSucceeded", async () => {
    const f = fakeClient();
    const db = createToolLedgerDb(f.client);
    const { id } = await db.appendDecision(input("k2"));
    const loaded = await db.loadDecision(id);
    expect(loaded).toMatchObject({
      id,
      contextKind: "platform_staff",
      toolId: tool.id,
      verdict: "execute",
      tier: "T1",
    });
    expect(await db.loadDecision("missing")).toBeNull();
    expect(await db.hasSucceeded(id)).toBe(false);
    await db.appendOutcome({ decision: loaded!, outcome: "failed", approval: null });
    expect(await db.hasSucceeded(id)).toBe(false);
    await db.appendOutcome({
      decision: loaded!,
      outcome: "succeeded",
      approval: { approvalRef: "ap", approverKind: "sheriff" },
    });
    expect(await db.hasSucceeded(id)).toBe(true);
    const outcome = f.tables["cg_tool_call_ledger"]!.at(-1)!;
    expect(outcome).toMatchObject({
      kind: "outcome",
      parent_id: id,
      approval_ref: "ap",
      approver_kind: "sheriff",
      args_digest: "a".repeat(64),
    });
  });

  it("throws on persistence errors and on malformed rows, so callers fail closed", async () => {
    const f = fakeClient();
    const db = createToolLedgerDb(f.client);
    f.tables["cg_tool_call_ledger"]!.push({
      id: "bad",
      kind: "decision",
      twin_context_id: "ctx-1",
      tool_id: tool.id,
      idempotency_key: "bad",
      verdict: "launch",
      tier: "T1",
      deny_code: null,
      reasons: [],
      args_digest: "short",
      approver_kind: null,
    });
    await expect(
      db.findDecision({ twinContextId: "ctx-1", toolId: tool.id, idempotencyKey: "bad" }),
    ).rejects.toThrow();
    const broken = createToolLedgerDb({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: null,
                    error: { message: "relation does not exist" },
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    } as never);
    await expect(
      broken.findDecision({ twinContextId: "c", toolId: "t", idempotencyKey: "k" }),
    ).rejects.toThrow("tool ledger find failed");
  });
});
