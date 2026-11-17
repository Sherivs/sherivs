import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import worker, { ROUTES } from "../../infra/cloudflare/sherivs-cron/src/index.js";

type FetchFunction = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const secret = "scheduled-test-value";
const allEnabled = Object.fromEntries(ROUTES.map((route) => [route.setting, "true"]));

async function runScheduled(
  env: Record<string, string>,
  scheduledTime: string,
  fetchImpl: Mock<FetchFunction> = vi.fn<FetchFunction>(async () => new Response("ok")),
) {
  const pending: Promise<unknown>[] = [];
  const waitUntil = vi.fn((promise) => pending.push(promise));
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubGlobal("fetch", fetchImpl);
  worker.scheduled({ scheduledTime: Date.parse(scheduledTime) }, env, { waitUntil });
  await Promise.all(pending);
  return { fetchImpl, log, waitUntil };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("sherivs-cron scheduler", () => {
  it.each([
    ["wallet-topup-reconcile", "2026-11-17T12:20:00.000Z", true],
    ["wallet-topup-reconcile", "2026-11-17T12:21:00.000Z", false],
    ["workflow-tick", "2026-11-17T12:21:00.000Z", true],
    ["org-notifications", "2026-11-17T12:20:00.000Z", true],
    ["org-notifications", "2026-11-17T12:21:00.000Z", false],
    ["jarvis-tick", "2026-11-17T12:20:00.000Z", true],
    ["integrations-sync", "2026-11-17T12:30:00.000Z", true],
    ["integrations-sync", "2026-11-17T12:20:00.000Z", false],
    ["org-weekly-reports", "2026-11-16T05:00:00.000Z", true],
    ["org-weekly-reports", "2026-11-17T05:00:00.000Z", false],
    ["org-weekly-reports", "2026-11-16T05:01:00.000Z", false],
  ])("applies UTC cadence for %s at %s", async (name, time, due) => {
    const route = ROUTES.find((candidate) => candidate.name === name);
    if (!route) throw new Error("test_route_missing");
    const { fetchImpl } = await runScheduled({ ...allEnabled, CRON_SECRET: secret }, time);
    expect(fetchImpl.mock.calls.some(([url]) => new URL(String(url)).pathname === route.path)).toBe(
      due,
    );
  });

  it("only calls enabled routes and treats non-true values as disabled", async () => {
    const { fetchImpl, log } = await runScheduled(
      { CRON_SECRET: secret, ROUTE_WORKFLOW_TICK: "1" },
      "2026-11-17T12:20:00.000Z",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("cron skipped route=workflow-tick reason=disabled");
  });

  it("refuses a non-HTTPS target without making a request", async () => {
    const fetchImpl = vi.fn();
    const { log } = await runScheduled(
      { ...allEnabled, CRON_SECRET: secret, TARGET_BASE_URL: "http://localhost:3000" },
      "2026-11-17T12:20:00.000Z",
      fetchImpl,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("cron route=workflow-tick http=0"));
  });

  it("requires a bearer and returns an empty 401 response", async () => {
    const response = await worker.fetch(new Request("https://worker.test/?route=workflow-tick"), {
      ...allEnabled,
      CRON_SECRET: secret,
    });
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
  });

  it("rejects unknown and disabled manual routes", async () => {
    const env = { CRON_SECRET: secret, ...allEnabled, ROUTE_WORKFLOW_TICK: "false" };
    const auth = { headers: { Authorization: "Bearer " + secret } };
    const unknown = await worker.fetch(
      new Request("https://worker.test/?route=not-a-route", auth),
      env,
    );
    const disabled = await worker.fetch(
      new Request("https://worker.test/?route=workflow-tick", auth),
      env,
    );
    expect(unknown.status).toBe(404);
    expect(disabled.status).toBe(409);
  });

  it("continues after one route fails and never logs credentials or response bodies", async () => {
    const fetchImpl = vi.fn<FetchFunction>(async (url) => {
      if (new URL(String(url)).pathname.includes("workflow-tick")) throw new Error(secret);
      return new Response("private response body");
    });
    const { log } = await runScheduled(
      { ...allEnabled, CRON_SECRET: secret },
      "2026-11-16T05:00:00.000Z",
      fetchImpl,
    );
    const output = log.mock.calls.flat().join(" ");
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(output).not.toContain(secret);
    expect(output).not.toContain("private response body");
    expect(output).toContain("cron route=workflow-tick http=0");
    expect(output).toContain("cron route=wallet-topup-reconcile http=200");
  });

  it("aborts a request when its timeout signal fires", async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const fetchImpl = vi.fn<FetchFunction>((_, options) => {
      queueMicrotask(() => controller.abort());
      return new Promise((_, reject) => {
        if (options?.signal?.aborted) reject(new Error("aborted"));
        else options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    const { log } = await runScheduled(
      {
        CRON_SECRET: secret,
        ...Object.fromEntries(ROUTES.map((route) => [route.setting, "false"])),
        ROUTE_WORKFLOW_TICK: "true",
      },
      "2026-11-17T12:20:00.000Z",
      fetchImpl,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("cron route=workflow-tick http=0"));
  });
});
