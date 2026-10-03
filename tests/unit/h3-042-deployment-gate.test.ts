/**
 * CoreGrid — H3-042 deployment monitoring gate tests (mission E-042, BLK-3).
 *
 * Proves the serving-URL monitoring gate laws, fully OFFLINE (mocked
 * transport; zero network, zero database, zero secrets):
 * - typed poll results are ok | degraded | failing, aggregated worst-of per
 *   the existing ./health contract (read-only composition);
 * - the gate verdict is fail-closed: only an unambiguous `ok` aggregate is
 *   PASS — `degraded` and `failing` both BLOCK;
 * - retry/backoff is bounded: transport errors and 5xx retry on a capped
 *   exponential schedule; 4xx / unexpected 2xx / invalid health bodies are
 *   deterministic and never retried;
 * - an invalid configuration blocks BEFORE the transport is ever invoked,
 *   with named reasons that never echo a rejected URL (a rejected URL's query
 *   string or userinfo may carry a secret);
 * - evidence is secret-safe: errors serialized `Name: message` only (no stack
 *   traces, no raw payloads), URLs validated secret-free by construction.
 */
import { describe, expect, it } from "vitest";
import {
  computeBackoffDelays,
  evaluateDeploymentGate,
  parseDeploymentGateConfig,
  parseHealthBodyStatus,
  probeServingUrl,
  servingUrlProblem,
  type DeploymentGateConfig,
  type DeploymentProbeRequest,
  type DeploymentProbeResponse,
  type DeploymentTransport,
} from "../../frontend/src/lib/observability/deployment-gate";

const NOW = "2026-10-03T00:00:00.000Z";
const SERVING_URL = "https://app.example.com/health";

/* ─── fixtures ─────────────────────────────────────────────── */

function baseConfig(overrides: Partial<DeploymentGateConfig> = {}): DeploymentGateConfig {
  return {
    urls: [SERVING_URL],
    expectedHttpStatus: 200,
    requestTimeoutMs: 1_000,
    maxAttempts: 3,
    backoffBaseMs: 250,
    backoffMultiplier: 2,
    backoffMaxMs: 2_000,
    degradedLatencyMs: 1_500,
    inspectBody: false,
    ...overrides,
  };
}

function instantSleep(): { sleep: (ms: number) => Promise<void>; applied: number[] } {
  const applied: number[] = [];
  const sleep = async (ms: number): Promise<void> => {
    applied.push(ms);
  };
  return { sleep, applied };
}

/** Stepped fake millisecond clock: each call advances by `stepMs`. */
function steppedClock(stepMs: number, start = 0): () => number {
  let value = start;
  return () => {
    value += stepMs;
    return value;
  };
}

interface SequenceTransport {
  transport: DeploymentTransport;
  calls: DeploymentProbeRequest[];
}

/** Mock transport replaying a fixed sequence; an `Error` entry is thrown. */
function sequenceTransport(sequence: Array<DeploymentProbeResponse | Error>): SequenceTransport {
  const calls: DeploymentProbeRequest[] = [];
  const queue = [...sequence];
  const transport: DeploymentTransport = async (request) => {
    calls.push(request);
    const next = queue.shift();
    if (next === undefined) throw new Error("transport sequence exhausted");
    if (next instanceof Error) throw next;
    return next;
  };
  return { transport, calls };
}

function spyTransport(): { transport: DeploymentTransport; called: () => boolean } {
  let used = false;
  const transport: DeploymentTransport = async () => {
    used = true;
    return { httpStatus: 200 };
  };
  return { transport, called: () => used };
}

function healthBody(status: string): string {
  return JSON.stringify({
    status,
    ts: NOW,
    uptime_s: 12,
    memory: { rss_mb: 10, heap_used_mb: 5 },
    version: "test",
    checks: [],
  });
}

/* ─── verdict and classification ───────────────────────────── */

describe("deployment gate — verdict and classification", () => {
  it("passes when the serving url answers the expected status on the first attempt", async () => {
    const { transport, calls } = sequenceTransport([{ httpStatus: 200 }]);
    const { sleep, applied } = instantSleep();

    const result = await evaluateDeploymentGate({
      config: baseConfig(),
      transport,
      sleep,
      now: () => NOW,
      nowMs: () => 0,
    });

    expect(result.verdict).toBe("PASS");
    expect(result.blockedReasons).toEqual([]);
    expect(result.aggregate).toBe("ok");
    expect(result.startedAt).toBe(NOW);
    expect(result.finishedAt).toBe(NOW);
    expect(result.config).toEqual(baseConfig());
    expect(result.probes).toHaveLength(1);
    const probe = result.probes[0]!;
    expect(probe.url).toBe(SERVING_URL);
    expect(probe.status).toBe("ok");
    expect(probe.attempts).toBe(1);
    expect(probe.httpStatus).toBe(200);
    expect(probe.latency_ms).toBe(0);
    expect(probe.error).toBeNull();
    expect(probe.delays_ms).toEqual([]);
    expect(applied).toEqual([]);
    expect(calls).toEqual([{ url: SERVING_URL, timeoutMs: 1_000, attempt: 1 }]);
  });

  it("retries a thrown transport failure on the backoff schedule, then passes", async () => {
    const { transport, calls } = sequenceTransport([
      new Error("connection refused"),
      { httpStatus: 200 },
    ]);
    const { sleep, applied } = instantSleep();

    const result = await evaluateDeploymentGate({
      config: baseConfig(),
      transport,
      sleep,
      now: () => NOW,
      nowMs: () => 0,
    });

    expect(result.verdict).toBe("PASS");
    expect(result.aggregate).toBe("ok");
    const probe = result.probes[0]!;
    expect(probe.status).toBe("ok");
    expect(probe.attempts).toBe(2);
    expect(probe.error).toBeNull();
    expect(probe.delays_ms).toEqual([250]);
    expect(applied).toEqual([250]);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.attempt).toBe(2);
  });

  it("retries 5xx responses but never 4xx", async () => {
    const retryable = sequenceTransport([{ httpStatus: 503 }, { httpStatus: 503 }, { httpStatus: 200 }]);
    const { sleep, applied } = instantSleep();

    const retried = await evaluateDeploymentGate({
      config: baseConfig(),
      transport: retryable.transport,
      sleep,
      now: () => NOW,
      nowMs: () => 0,
    });
    expect(retried.verdict).toBe("PASS");
    expect(retried.probes[0]!.attempts).toBe(3);
    expect(retried.probes[0]!.delays_ms).toEqual([250, 500]);
    expect(applied).toEqual([250, 500]);

    const deterministic = sequenceTransport([{ httpStatus: 404 }]);
    const blocked = await evaluateDeploymentGate({
      config: baseConfig(),
      transport: deterministic.transport,
      sleep,
      now: () => NOW,
      nowMs: () => 0,
    });
    expect(blocked.verdict).toBe("BLOCKED");
    expect(blocked.aggregate).toBe("failing");
    const probe = blocked.probes[0]!;
    expect(probe.status).toBe("failing");
    expect(probe.attempts).toBe(1);
    expect(probe.error).toBe("unexpected http status 404");
    expect(blocked.blockedReasons).toEqual([
      `failing probe: ${SERVING_URL} (unexpected http status 404)`,
    ]);
  });

  it("blocks on an unexpected 2xx without retrying it", async () => {
    const { transport, calls } = sequenceTransport([{ httpStatus: 204 }]);
    const { sleep } = instantSleep();

    const result = await evaluateDeploymentGate({
      config: baseConfig({ expectedHttpStatus: 200 }),
      transport,
      sleep,
      now: () => NOW,
      nowMs: () => 0,
    });

    expect(result.verdict).toBe("BLOCKED");
    expect(calls).toHaveLength(1);
    expect(result.probes[0]!.error).toBe("unexpected http status 204");
  });

  it("fails closed when attempts are exhausted, recording the serialized error only", async () => {
    const { transport, calls } = sequenceTransport([
      new Error("upstream timed out"),
      new Error("upstream timed out"),
      new Error("upstream timed out"),
    ]);
    const { sleep } = instantSleep();

    const result = await evaluateDeploymentGate({
      config: baseConfig(),
      transport,
      sleep,
      now: () => NOW,
      nowMs: () => 0,
    });

    expect(result.verdict).toBe("BLOCKED");
    expect(result.aggregate).toBe("failing");
    const probe = result.probes[0]!;
    expect(probe.status).toBe("failing");
    expect(probe.attempts).toBe(3);
    expect(probe.httpStatus).toBeNull();
    expect(probe.latency_ms).toBeNull();
    expect(probe.error).toBe("Error: upstream timed out");
    expect(probe.error).not.toContain("at ");
    expect(calls).toHaveLength(3);
  });

  it("marks a slow-but-successful probe degraded and blocks the gate", async () => {
    const { transport } = sequenceTransport([{ httpStatus: 200 }]);
    const { sleep } = instantSleep();

    const result = await evaluateDeploymentGate({
      config: baseConfig(),
      transport,
      sleep,
      now: () => NOW,
      nowMs: steppedClock(2_000),
    });

    expect(result.verdict).toBe("BLOCKED");
    expect(result.aggregate).toBe("degraded");
    expect(result.probes[0]!.status).toBe("degraded");
    expect(result.probes[0]!.latency_ms).toBe(2_000);
    expect(result.blockedReasons[0]).toBe(`degraded probe: ${SERVING_URL}`);
  });
});

/* ─── health-body composition (read-only on the ./health contract) ── */

describe("deployment gate — health report body composition", () => {
  it("combines the latency classification with the body status worst-of", async () => {
    const cases: Array<{ body: string; expected: "ok" | "degraded" | "failing"; verdict: "PASS" | "BLOCKED" }> = [
      { body: healthBody("ok"), expected: "ok", verdict: "PASS" },
      { body: healthBody("degraded"), expected: "degraded", verdict: "BLOCKED" },
      { body: healthBody("failing"), expected: "failing", verdict: "BLOCKED" },
    ];
    for (const testCase of cases) {
      const { transport } = sequenceTransport([{ httpStatus: 200, bodyText: testCase.body }]);
      const { sleep } = instantSleep();
      const result = await evaluateDeploymentGate({
        config: baseConfig({ inspectBody: true }),
        transport,
        sleep,
        now: () => NOW,
        nowMs: () => 0,
      });
      expect(result.probes[0]!.status).toBe(testCase.expected);
      expect(result.aggregate).toBe(testCase.expected);
      expect(result.verdict).toBe(testCase.verdict);
    }
  });

  it("fails closed on a body that does not carry a valid health status", async () => {
    const invalidBodies = ["not-json", "[]", '"plain"', healthBody("excellent"), "{}"];
    for (const body of invalidBodies) {
      const { transport, calls } = sequenceTransport([{ httpStatus: 200, bodyText: body }]);
      const { sleep } = instantSleep();
      const result = await evaluateDeploymentGate({
        config: baseConfig({ inspectBody: true }),
        transport,
        sleep,
        now: () => NOW,
        nowMs: () => 0,
      });
      expect(result.verdict).toBe("BLOCKED");
      expect(result.probes[0]!.status).toBe("failing");
      expect(result.probes[0]!.error).toBe("invalid health report body");
      expect(calls).toHaveLength(1);
    }
  });

  it("ignores the body when inspectBody is disabled (opt-in composition)", async () => {
    const { transport } = sequenceTransport([{ httpStatus: 200, bodyText: "not-json" }]);
    const { sleep } = instantSleep();
    const result = await evaluateDeploymentGate({
      config: baseConfig({ inspectBody: false }),
      transport,
      sleep,
      now: () => NOW,
      nowMs: () => 0,
    });
    expect(result.verdict).toBe("PASS");
    expect(result.probes[0]!.status).toBe("ok");
  });

  it("parseHealthBodyStatus accepts exactly the HealthStatus taxonomy", () => {
    expect(parseHealthBodyStatus(healthBody("ok"))).toBe("ok");
    expect(parseHealthBodyStatus(healthBody("degraded"))).toBe("degraded");
    expect(parseHealthBodyStatus(healthBody("failing"))).toBe("failing");
    expect(parseHealthBodyStatus(undefined)).toBeNull();
    expect(parseHealthBodyStatus("")).toBeNull();
    expect(parseHealthBodyStatus("[]")).toBeNull();
    expect(parseHealthBodyStatus("{broken")).toBeNull();
    expect(parseHealthBodyStatus(healthBody("excellent"))).toBeNull();
  });
});

/* ─── fail-closed configuration ────────────────────────────── */

describe("deployment gate — fail-closed configuration", () => {
  const invalidCases: Array<{ label: string; config: unknown }> = [
    { label: "missing urls", config: {} },
    { label: "empty urls", config: baseConfig({ urls: [] }) },
    { label: "non-http scheme", config: baseConfig({ urls: ["ftp://app.example.com/health"] }) },
    { label: "userinfo in url", config: baseConfig({ urls: ["https://user:pw@example.com/health"] }) },
    { label: "query string in url", config: baseConfig({ urls: ["https://app.example.com/health?token=abc123"] }) },
    { label: "fragment in url", config: baseConfig({ urls: ["https://app.example.com/health#frag"] }) },
    { label: "unparseable url", config: baseConfig({ urls: ["not a url at all"] }) },
    {
      label: "duplicate urls",
      config: baseConfig({ urls: [SERVING_URL, SERVING_URL] }),
    },
    { label: "maxAttempts below the bound", config: baseConfig({ maxAttempts: 0 }) },
    { label: "maxAttempts above the bound", config: baseConfig({ maxAttempts: 6 }) },
    { label: "timeout below the bound", config: baseConfig({ requestTimeoutMs: 50 }) },
    { label: "expected status out of range", config: baseConfig({ expectedHttpStatus: 199 }) },
  ];

  for (const testCase of invalidCases) {
    it(`blocks without probing on invalid configuration: ${testCase.label}`, async () => {
      const { transport, called } = spyTransport();
      const { sleep, applied } = instantSleep();

      const result = await evaluateDeploymentGate({
        config: testCase.config,
        transport,
        sleep,
        now: () => NOW,
        nowMs: () => 0,
      });

      expect(result.verdict).toBe("BLOCKED");
      expect(result.aggregate).toBe("failing");
      expect(result.config).toBeNull();
      expect(result.probes).toEqual([]);
      expect(result.blockedReasons.length).toBeGreaterThan(0);
      expect(called()).toBe(false);
      expect(applied).toEqual([]);
    });
  }

  it("never echoes a rejected URL into the blocked reasons (secrets law)", async () => {
    const { transport, called } = spyTransport();

    const result = await evaluateDeploymentGate({
      config: baseConfig({ urls: ["https://app.example.com/health?token=abc123"] }),
      transport,
      sleep: instantSleep().sleep,
      now: () => NOW,
      nowMs: () => 0,
    });

    expect(result.blockedReasons.join("\n")).not.toContain("abc123");
    expect(result.blockedReasons.join("\n")).not.toContain("?");
    expect(result.blockedReasons.join("\n")).toContain("invalid serving url");
    expect(called()).toBe(false);
  });

  it("never echoes userinfo into the blocked reasons (secrets law)", async () => {
    const parsed = parseDeploymentGateConfig(
      baseConfig({ urls: ["https://operator:hunter2@example.com/health"] }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("userinfo url must be rejected");
    expect(parsed.reasons.join("\n")).not.toContain("hunter2");
    expect(parsed.reasons.join("\n")).not.toContain("operator:");
    expect(parsed.reasons.join("\n")).toContain("userinfo");
  });

  it("parseDeploymentGateConfig validates every URL rule with named reasons", () => {
    const valid = parseDeploymentGateConfig(baseConfig());
    expect(valid.ok).toBe(true);
    if (!valid.ok) throw new Error("base config must be valid");

    const duplicate = parseDeploymentGateConfig(baseConfig({ urls: [SERVING_URL, SERVING_URL] }));
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) throw new Error("duplicates must be rejected");
    expect(duplicate.reasons.join("\n")).toContain("duplicate serving urls");

    const badUrl = parseDeploymentGateConfig(
      baseConfig({ urls: ["gopher://app.example.com"] }),
    );
    expect(badUrl.ok).toBe(false);
    if (badUrl.ok) throw new Error("gopher urls must be rejected");
    expect(badUrl.reasons.join("\n")).toContain("http/https only");
  });

  it("servingUrlProblem names every rejected URL shape", () => {
    expect(servingUrlProblem("https://app.example.com/health")).toBeNull();
    expect(servingUrlProblem("http://localhost:3000/health")).toBeNull();
    expect(servingUrlProblem("not a url")).toBe("not a parseable URL");
    expect(servingUrlProblem("ftp://app.example.com")).toContain("not allowed");
    expect(servingUrlProblem("https://user:pw@example.com")).toContain("userinfo");
    expect(servingUrlProblem("https://app.example.com/?token=x")).toContain("query string");
    expect(servingUrlProblem("https://app.example.com/#frag")).toContain("fragment");
  });
});

/* ─── bounded retry/backoff policy ─────────────────────────── */

describe("deployment gate — bounded backoff policy", () => {
  it("grows exponentially and caps every delay at backoffMaxMs", () => {
    const config = baseConfig({ backoffBaseMs: 100, backoffMultiplier: 3, backoffMaxMs: 400, maxAttempts: 5 });
    expect(computeBackoffDelays(config)).toEqual([100, 300, 400, 400]);
  });

  it("produces an empty schedule for a single-attempt policy", () => {
    expect(computeBackoffDelays(baseConfig({ maxAttempts: 1 }))).toEqual([]);
  });

  it("honors the parsed config's bounds (schedule derived from validated values)", () => {
    const parsed = parseDeploymentGateConfig({
      urls: [SERVING_URL],
      maxAttempts: 4,
      backoffBaseMs: 100,
      backoffMultiplier: 2,
      backoffMaxMs: 150,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("config must be valid");
    expect(computeBackoffDelays(parsed.config)).toEqual([100, 150, 150]);
  });

  it("probeServingUrl never exceeds maxAttempts on a permanently failing transport", async () => {
    const { transport, calls } = sequenceTransport([]);
    const { sleep, applied } = instantSleep();

    const probe = await probeServingUrl(SERVING_URL, baseConfig({ maxAttempts: 3 }), transport, {
      sleep,
      nowMs: () => 0,
    });

    expect(probe.attempts).toBe(3);
    expect(probe.status).toBe("failing");
    expect(probe.error).toBe("Error: transport sequence exhausted");
    expect(calls).toHaveLength(3);
    expect(applied).toEqual([250, 500]);
  });
});

/* ─── multi-URL gates and evidence ─────────────────────────── */

describe("deployment gate — multi-url evaluation and evidence", () => {
  it("passes only when every configured url is ok, preserving url order", async () => {
    const urls = ["https://a.example.com/health", "https://b.example.com/health"];
    const { transport, calls } = sequenceTransport([{ httpStatus: 200 }, { httpStatus: 200 }]);
    const { sleep } = instantSleep();

    const result = await evaluateDeploymentGate({
      config: baseConfig({ urls }),
      transport,
      sleep,
      now: () => NOW,
      nowMs: () => 0,
    });

    expect(result.verdict).toBe("PASS");
    expect(result.probes.map((probe) => probe.url)).toEqual(urls);
    expect(calls.map((request) => request.url)).toEqual(urls);
  });

  it("blocks with named reasons when one url fails while others are ok", async () => {
    const badUrl = "https://b.example.com/health";
    const { transport } = sequenceTransport([{ httpStatus: 200 }, { httpStatus: 500 }]);
    const { sleep } = instantSleep();

    const result = await evaluateDeploymentGate({
      config: baseConfig({
        urls: ["https://a.example.com/health", badUrl],
        maxAttempts: 1,
      }),
      transport,
      sleep,
      now: () => NOW,
      nowMs: () => 0,
    });

    expect(result.verdict).toBe("BLOCKED");
    expect(result.aggregate).toBe("failing");
    expect(result.blockedReasons).toEqual([
      `failing probe: ${badUrl} (unexpected http status 500)`,
    ]);
    expect(result.blockedReasons.join("\n")).not.toContain("https://a.example.com");
  });

  it("probes are processed sequentially under the bounded backoff schedule", async () => {
    const urls = ["https://a.example.com/health", "https://b.example.com/health"];
    const sequence: Array<DeploymentProbeResponse | Error> = [
      { httpStatus: 503 },
      { httpStatus: 200 },
      { httpStatus: 200 },
    ];
    const { transport, calls } = sequenceTransport(sequence);
    const { sleep, applied } = instantSleep();

    const result = await evaluateDeploymentGate({
      config: baseConfig({ urls, maxAttempts: 2, backoffBaseMs: 100, backoffMaxMs: 100 }),
      transport,
      sleep,
      now: () => NOW,
      nowMs: () => 0,
    });

    expect(result.verdict).toBe("PASS");
    expect(result.probes[0]!.attempts).toBe(2);
    expect(result.probes[0]!.delays_ms).toEqual([100]);
    expect(result.probes[1]!.attempts).toBe(1);
    expect(applied).toEqual([100]);
    expect(calls.map((request) => request.attempt)).toEqual([1, 2, 1]);
  });
});