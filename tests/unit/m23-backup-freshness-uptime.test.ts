import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateFreshness,
  run as runFreshness,
  tokenFrom,
  // @ts-expect-error plain .mjs script without types
} from "../../scripts/check-backup-freshness.mjs";
import {
  evaluateHealth,
  parseHealthUrl,
  run as runUptime,
  // @ts-expect-error plain .mjs script without types
} from "../../scripts/check-uptime.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const yaml = createRequire(import.meta.url)("js-yaml") as { load: (src: string) => unknown };

const NOW = Date.parse("2026-11-17T12:00:00Z");
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** Built at runtime so no token-shaped literal is committed. */
const FAKE_TOKEN = ["ghs", "fake", "value", "for", "tests"].join("_");

function runsBody(...finishedAgoHours: number[]) {
  return {
    total_count: finishedAgoHours.length,
    workflow_runs: finishedAgoHours.map((ago, i) => ({
      id: 1000 + i,
      run_number: 50 + i,
      status: "completed",
      conclusion: "success",
      updated_at: iso(NOW - ago * HOUR),
    })),
  };
}
const artifactsBody = (overrides: Record<string, unknown> = {}) => ({
  total_count: 1,
  artifacts: [
    {
      name: "sherivs-prod-db-20261117T010700Z",
      size_in_bytes: 123456,
      expired: false,
      ...overrides,
    },
  ],
});

function fakeFetch(responses: Record<string, { status: number; body: unknown }>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl = async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, headers: init.headers });
    const key = Object.keys(responses).find((k) => url.includes(k));
    const hit = key ? responses[key] : { status: 404, body: {} };
    return {
      ok: hit.status >= 200 && hit.status < 300,
      status: hit.status,
      json: async () => hit.body,
    };
  };
  return { impl, calls };
}

describe("M23 backup freshness: decision", () => {
  it("passes when the newest successful run is under 26 hours old and has a backup artifact", () => {
    const result = evaluateFreshness({
      runs: runsBody(30, 5),
      artifacts: artifactsBody(),
      nowMs: NOW,
    });
    expect(result.ok).toBe(true);
    expect(result.runId).toBe(1001); // the newest, not the first listed
    expect(result.ageHours).toBe(5);
  });

  it("fails when the newest successful run is older than 26 hours", () => {
    const result = evaluateFreshness({
      runs: runsBody(27),
      artifacts: artifactsBody(),
      nowMs: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("27 h old");
  });

  it("fails with no successful run, and ignores failed or in-progress runs", () => {
    expect(evaluateFreshness({ runs: { workflow_runs: [] }, artifacts: null, nowMs: NOW }).ok).toBe(
      false,
    );
    const notSuccess = {
      workflow_runs: [
        { id: 1, status: "completed", conclusion: "failure", updated_at: iso(NOW - HOUR) },
        { id: 2, status: "in_progress", conclusion: null, updated_at: iso(NOW - HOUR) },
      ],
    };
    expect(
      evaluateFreshness({ runs: notSuccess, artifacts: artifactsBody(), nowMs: NOW }).reason,
    ).toContain("no successful");
  });

  it("fails when the run has no artifact, an expired one, an empty one, or an unrelated one", () => {
    for (const artifacts of [
      { artifacts: [] },
      artifactsBody({ expired: true }),
      artifactsBody({ size_in_bytes: 0 }),
      artifactsBody({ name: "something-else" }),
    ]) {
      const result = evaluateFreshness({ runs: runsBody(2), artifacts, nowMs: NOW });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("artifact");
    }
  });
});

describe("M23 backup freshness: CLI behaviour with a fake API", () => {
  it("reports BLOCKED and exits 2 without a token, and makes no request", async () => {
    const { impl, calls } = fakeFetch({});
    const lines: string[] = [];
    const code = await runFreshness({
      env: {},
      argv: [],
      fetchImpl: impl,
      nowMs: NOW,
      log: (l: string) => lines.push(l),
    });
    expect(code).toBe(2);
    expect(lines.join("\n")).toContain("STATUS=BLOCKED");
    expect(calls).toHaveLength(0);
    expect(tokenFrom({ GH_TOKEN: "  " })).toBeNull();
  });

  it("asks for successful runs of nightly-db-backup.yml, then that run's artifacts, and never prints the token", async () => {
    const { impl, calls } = fakeFetch({
      "/actions/workflows/nightly-db-backup.yml/runs?status=success": {
        status: 200,
        body: runsBody(3),
      },
      "/actions/runs/1000/artifacts": { status: 200, body: artifactsBody() },
    });
    const lines: string[] = [];
    const code = await runFreshness({
      env: { GITHUB_TOKEN: FAKE_TOKEN, GITHUB_REPOSITORY: "Sherivs/sherivs" },
      argv: [],
      fetchImpl: impl,
      nowMs: NOW,
      log: (l: string) => lines.push(l),
    });
    expect(code).toBe(0);
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.github.com/repos/Sherivs/sherivs/actions/workflows/nightly-db-backup.yml/runs?status=success&per_page=10",
      "https://api.github.com/repos/Sherivs/sherivs/actions/runs/1000/artifacts?per_page=100",
    ]);
    expect(calls[0]!.headers.Authorization).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(lines.join("\n")).toContain("STATUS=PASS");
    expect(lines.join("\n")).not.toContain(FAKE_TOKEN);
  });

  it("fails (exit 1) on a stale backup", async () => {
    const { impl } = fakeFetch({
      "/runs?status=success": { status: 200, body: runsBody(40) },
      "/artifacts": { status: 200, body: artifactsBody() },
    });
    const lines: string[] = [];
    const code = await runFreshness({
      env: { GH_TOKEN: FAKE_TOKEN },
      argv: [],
      fetchImpl: impl,
      nowMs: NOW,
      log: (l: string) => lines.push(l),
    });
    expect(code).toBe(1);
    expect(lines.at(-1)).toBe("STATUS=FAIL");
  });

  it("reports BLOCKED (exit 2) when the API refuses, without echoing the token", async () => {
    const { impl } = fakeFetch({ "/runs": { status: 401, body: {} } });
    const lines: string[] = [];
    const code = await runFreshness({
      env: { GH_TOKEN: FAKE_TOKEN },
      argv: [],
      fetchImpl: impl,
      nowMs: NOW,
      log: (l: string) => lines.push(l),
    });
    expect(code).toBe(2);
    expect(lines.join("\n")).toContain("HTTP 401");
    expect(lines.join("\n")).not.toContain(FAKE_TOKEN);
  });
});

describe("M23 uptime probe", () => {
  const healthy = { status: "ok", checks: [{ name: "database", status: "ok" }] };

  it("passes only on HTTP 200 with a database check that is ok", () => {
    expect(evaluateHealth({ status: 200, body: JSON.stringify(healthy) }).ok).toBe(true);
    expect(evaluateHealth({ status: 503, body: JSON.stringify(healthy) }).ok).toBe(false);
    expect(evaluateHealth({ status: 200, body: "<html>" }).ok).toBe(false);
    expect(
      evaluateHealth({ status: 200, body: JSON.stringify({ status: "ok", checks: [] }) }).ok,
    ).toBe(false);
    const dbDown = { status: "failing", checks: [{ name: "database", status: "failing" }] };
    expect(evaluateHealth({ status: 200, body: JSON.stringify(dbDown) }).reason).toContain(
      "database check is failing",
    );
  });

  it("requires https except for localhost, and refuses credentials in the URL", () => {
    expect(parseHealthUrl("https://example.org/health.json").url).toBeDefined();
    expect(parseHealthUrl("http://localhost:8080/health.json").url).toBeDefined();
    expect(parseHealthUrl("http://example.org/health.json").error).toBeDefined();
    expect(parseHealthUrl("https://user:pw@example.org/health.json").error).toBeDefined();
    expect(parseHealthUrl("not a url").error).toBeDefined();
  });

  it("reports BLOCKED and exits 0 when the URL variable is unset", async () => {
    const lines: string[] = [];
    const code = await runUptime({
      env: {},
      argv: [],
      fetchImpl: async () => {
        throw new Error("no");
      },
      log: (l: string) => lines.push(l),
    });
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("STATUS=BLOCKED");
  });

  it("fails on a network error and passes on a healthy answer", async () => {
    const lines: string[] = [];
    const env = { SHERIVS_HEALTH_URL: "http://127.0.0.1:8080/health.json" };
    expect(
      await runUptime({
        env,
        argv: [],
        fetchImpl: async () => {
          throw new Error("ECONNREFUSED");
        },
        log: (l: string) => lines.push(l),
      }),
    ).toBe(1);
    const ok = async () => ({ status: 200, text: async () => JSON.stringify(healthy) });
    expect(
      await runUptime({ env, argv: [], fetchImpl: ok, log: (l: string) => lines.push(l) }),
    ).toBe(0);
  });
});

interface Workflow {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<
    string,
    {
      steps: { uses?: string; run?: string; env?: Record<string, string> }[];
      permissions?: unknown;
    }
  >;
}
const loadWorkflow = (name: string) =>
  yaml.load(readFileSync(join(ROOT, ".github/workflows", name), "utf8")) as Workflow;

describe("M23 new workflows", () => {
  const NEW = ["backup-freshness.yml", "uptime-probe.yml"];

  it.each(NEW)(
    "%s is scheduled or manual only, least-privilege, with SHA-pinned actions",
    (name) => {
      const wf = loadWorkflow(name);
      expect(Object.keys(wf.on).sort()).toEqual(["schedule", "workflow_dispatch"]);
      const allowed =
        name === "backup-freshness.yml"
          ? { contents: "read", actions: "read" }
          : { contents: "read" };
      expect(wf.permissions).toEqual(allowed);
      for (const job of Object.values(wf.jobs)) {
        expect(job.permissions).toBeUndefined();
        for (const step of job.steps) {
          if (step.uses) expect(step.uses).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
          // No secret is referenced at all, so none can be printed.
          expect(JSON.stringify(step)).not.toContain("secrets.");
        }
      }
    },
  );

  it("the freshness workflow passes only the built-in token, through the environment", () => {
    const wf = loadWorkflow("backup-freshness.yml");
    const step = Object.values(wf.jobs)[0]!.steps.find((s) =>
      s.run?.includes("check-backup-freshness"),
    );
    expect(step?.env).toEqual({ GITHUB_TOKEN: "${{ github.token }}" });
    expect(step?.run).not.toMatch(/echo .*GITHUB_TOKEN/);
  });

  it("the uptime workflow reads its URL from a repository variable", () => {
    const wf = loadWorkflow("uptime-probe.yml");
    const step = Object.values(wf.jobs)[0]!.steps.find((s) => s.run?.includes("check-uptime"));
    expect(step?.env).toEqual({ SHERIVS_HEALTH_URL: "${{ vars.SHERIVS_HEALTH_URL }}" });
  });
});
