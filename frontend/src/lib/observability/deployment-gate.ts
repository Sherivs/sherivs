/**
 * CoreGrid — serving-URL deployment monitoring gate (BLK-3 launch gate).
 *
 * Mission E-042 (team H3-042, Deployment Monitor Engineer). This module is a
 * pure, typed, READ-ONLY contract: it observes a deployment's serving URL(s)
 * and issues a gate verdict. It never mutates state, never retries without
 * bound, never follows redirects, and never performs a side-effecting action.
 *
 * Composition (read-only) with the existing observability contracts:
 * - `HealthStatus` taxonomy and `aggregateStatus` / `isHealthStatus` come from
 *   `./health` — poll results are typed ok | degraded | failing and multiple
 *   probes aggregate worst-of, exactly like the health endpoint contract;
 * - `serializeError` comes from `./structured-log` — transport failures are
 *   recorded as `Name: message` only, never stack traces or raw payloads.
 *
 * Fail-closed law:
 * - an invalid configuration yields verdict `BLOCKED` with named reasons and
 *   the transport is NEVER invoked (nothing is observed, nothing is guessed);
 * - only an unambiguous `ok` aggregate passes the gate — `degraded` and
 *   `failing` both block;
 * - monitored URLs must be secret-free by construction: no userinfo
 *   (username/password), no query string (tokens must never appear in a
 *   monitored URL or in recorded evidence), no fragment, http/https only.
 *
 * Bounded retry/backoff policy:
 * - at most `maxAttempts` (hard-capped by schema) attempts per URL;
 * - transport errors and 5xx responses are retried with a capped exponential
 *   backoff schedule; 4xx and unexpected 2xx statuses are deterministic
 *   failures and are NOT retried;
 * - worst-case observation time is bounded by
 *   urls × maxAttempts × (requestTimeoutMs + backoffMaxMs).
 *
 * Offline-testable: the transport, the sleep, and both clocks are injectable;
 * the unit battery mocks the transport and never touches a network service.
 */

import { z } from "zod";
import {
  aggregateStatus,
  isHealthStatus,
  type HealthStatus,
} from "./health";
import { serializeError } from "./structured-log";

export type { HealthStatus };

/** A deployment gate can only PASS or BLOCK — never degrade a gate silently. */
export type GateVerdict = "PASS" | "BLOCKED";

/** Request the gate issues to the pluggable transport (one attempt). */
export interface DeploymentProbeRequest {
  /** Validated, secret-free serving URL. */
  url: string;
  /** Per-attempt timeout budget the transport is asked to honor. */
  timeoutMs: number;
  /** 1-based attempt number (bounded by maxAttempts). */
  attempt: number;
}

/** Minimal transport response shape (mockable; no DOM/Node fetch types). */
export interface DeploymentProbeResponse {
  httpStatus: number;
  /** Raw body text; only inspected when `inspectBody` is enabled. */
  bodyText?: string;
}

/** Pluggable transport: performs ONE HTTP GET and never retries itself. */
export type DeploymentTransport = (
  request: DeploymentProbeRequest,
) => Promise<DeploymentProbeResponse>;

export type SleepFn = (ms: number) => Promise<void>;

export interface DeploymentGateConfig {
  /** Serving URLs to observe (1–8, unique, secret-free http/https). */
  urls: string[];
  /** The HTTP status the serving URL must answer (default 200). */
  expectedHttpStatus: number;
  /** Per-attempt timeout budget the transport is asked to honor (ms). */
  requestTimeoutMs: number;
  /** Total attempts per URL, hard-capped at 5. */
  maxAttempts: number;
  /** Base delay before the 2nd attempt (ms). */
  backoffBaseMs: number;
  /** Exponential growth factor between attempts. */
  backoffMultiplier: number;
  /** Upper cap for any single backoff delay (ms). */
  backoffMaxMs: number;
  /** A successful probe slower than this is `degraded`, not `ok` (ms). */
  degradedLatencyMs: number;
  /** When true, a 200 body must carry a valid health `status` field. */
  inspectBody: boolean;
}

const gateConfigSchema = z.object({
  urls: z.array(z.string().min(1)).min(1).max(8),
  expectedHttpStatus: z.number().int().min(200).max(599).default(200),
  requestTimeoutMs: z.number().int().min(100).max(30_000).default(5_000),
  maxAttempts: z.number().int().min(1).max(5).default(3),
  backoffBaseMs: z.number().int().min(0).max(5_000).default(250),
  backoffMultiplier: z.number().min(1).max(8).default(2),
  backoffMaxMs: z.number().int().min(0).max(15_000).default(2_000),
  degradedLatencyMs: z.number().int().min(1).max(60_000).default(1_500),
  inspectBody: z.boolean().default(false),
});

/**
 * Returns a named problem when a URL may not be monitored, else null.
 * Law: monitored URLs (and therefore all recorded evidence) must be
 * secret-free — no credentials, no query strings, no fragments.
 */
export function servingUrlProblem(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "not a parseable URL";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `scheme "${parsed.protocol.replace(":", "")}" not allowed (http/https only)`;
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return "userinfo (username/password) embedded in the URL is not allowed";
  }
  if (parsed.search !== "") {
    return "query string not allowed (tokens must never appear in a monitored URL)";
  }
  if (parsed.hash !== "") {
    return "fragment not allowed";
  }
  return null;
}

export type ParsedGateConfig =
  | { ok: true; config: DeploymentGateConfig }
  | { ok: false; reasons: string[] };

/** Fail-closed parse: every problem becomes a named reason, never a throw. */
export function parseDeploymentGateConfig(raw: unknown): ParsedGateConfig {
  const parsed = gateConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reasons: parsed.error.issues.map(
        (issue) =>
          `invalid configuration: ${issue.path.join(".") || "config"}: ${issue.message}`,
      ),
    };
  }
  const config = parsed.data;
  const reasons: string[] = [];
  // Secrets law: a rejected URL must never be echoed into reasons/evidence —
  // its query string or userinfo may carry a secret. Reasons name the PROBLEM,
  // never the offending URL; `servingUrlProblem` is exported for diagnosis.
  const seen = new Set<string>();
  for (const url of config.urls) seen.add(url);
  if (seen.size !== config.urls.length) {
    reasons.push(
      `invalid configuration: duplicate serving urls declared (${seen.size} unique of ${config.urls.length})`,
    );
  }
  for (const url of config.urls) {
    const problem = servingUrlProblem(url);
    if (problem !== null) reasons.push(`invalid serving url: ${problem}`);
  }
  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, config };
}

/**
 * Pure backoff schedule: the delay before attempts 2..maxAttempts.
 * Exponential growth from `backoffBaseMs` by `backoffMultiplier`, each delay
 * capped at `backoffMaxMs` — the schedule is bounded by construction.
 */
export function computeBackoffDelays(config: DeploymentGateConfig): number[] {
  const delays: number[] = [];
  for (let attempt = 2; attempt <= config.maxAttempts; attempt += 1) {
    const raw = config.backoffBaseMs * Math.pow(config.backoffMultiplier, attempt - 2);
    delays.push(Math.min(Math.round(raw), config.backoffMaxMs));
  }
  return delays;
}

/** Result of observing one serving URL (typed poll result). */
export interface UrlProbeResult {
  url: string;
  status: HealthStatus;
  attempts: number;
  httpStatus: number | null;
  latency_ms: number | null;
  /** Serialized `Name: message` only — never a stack trace or payload. */
  error: string | null;
  /** Backoff delays actually applied before retries 2..n (ms). */
  delays_ms: number[];
}

interface AttemptRecord {
  httpStatus: number | null;
  latency_ms: number | null;
  error: string | null;
}

/**
 * Extracts the health status from an optional response body. Only a JSON
 * object carrying a valid `HealthStatus` (per the ./health contract) is
 * accepted; anything else is rejected so the caller can fail closed.
 */
export function parseHealthBodyStatus(bodyText: string | undefined): HealthStatus | null {
  if (typeof bodyText !== "string" || bodyText.length === 0) return null;
  let candidate: unknown;
  try {
    candidate = JSON.parse(bodyText);
  } catch {
    return null;
  }
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return null;
  }
  const status = (candidate as Record<string, unknown>)["status"];
  return isHealthStatus(status) ? status : null;
}

function probeFrom(
  url: string,
  status: HealthStatus,
  attempt: number,
  record: AttemptRecord,
  delays: number[],
): UrlProbeResult {
  return {
    url,
    status,
    attempts: attempt,
    httpStatus: record.httpStatus,
    latency_ms: record.latency_ms,
    error: record.error,
    delays_ms: delays,
  };
}

/**
 * Observes one serving URL with the bounded retry/backoff policy.
 * Retryable: transport errors and 5xx. Not retryable (deterministic):
 * 4xx, any 2xx other than `expectedHttpStatus`, and — when `inspectBody` is
 * enabled — a body that does not carry a valid health status.
 */
export async function probeServingUrl(
  url: string,
  config: DeploymentGateConfig,
  transport: DeploymentTransport,
  deps: { sleep: SleepFn; nowMs: () => number } = {
    sleep: defaultSleep,
    nowMs: () => Date.now(),
  },
): Promise<UrlProbeResult> {
  const { sleep, nowMs } = deps;
  const schedule = computeBackoffDelays(config);
  const appliedDelays: number[] = [];

  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    if (attempt > 1) {
      const delay = schedule[attempt - 2];
      appliedDelays.push(delay);
      await sleep(delay);
    }
    const startedAtMs = nowMs();
    let response: DeploymentProbeResponse;
    try {
      response = await transport({ url, timeoutMs: config.requestTimeoutMs, attempt });
    } catch (err) {
      const error = serializeError(err);
      if (attempt < config.maxAttempts) continue;
      return probeFrom(url, "failing", attempt, { httpStatus: null, latency_ms: null, error }, appliedDelays);
    }
    const latencyMs = nowMs() - startedAtMs;

    if (response.httpStatus === config.expectedHttpStatus) {
      if (config.inspectBody) {
        const bodyStatus = parseHealthBodyStatus(response.bodyText);
        if (bodyStatus === null) {
          return probeFrom(
            url,
            "failing",
            attempt,
            { httpStatus: response.httpStatus, latency_ms: latencyMs, error: "invalid health report body" },
            appliedDelays,
          );
        }
        const latencyStatus: HealthStatus = latencyMs > config.degradedLatencyMs ? "degraded" : "ok";
        return probeFrom(
          url,
          aggregateStatus([latencyStatus, bodyStatus]),
          attempt,
          { httpStatus: response.httpStatus, latency_ms: latencyMs, error: null },
          appliedDelays,
        );
      }
      const status: HealthStatus = latencyMs > config.degradedLatencyMs ? "degraded" : "ok";
      return probeFrom(
        url,
        status,
        attempt,
        { httpStatus: response.httpStatus, latency_ms: latencyMs, error: null },
        appliedDelays,
      );
    }

    const retryable = response.httpStatus >= 500;
    if (retryable && attempt < config.maxAttempts) continue;
    return probeFrom(
      url,
      "failing",
      attempt,
      {
        httpStatus: response.httpStatus,
        latency_ms: latencyMs,
        error: `unexpected http status ${response.httpStatus}`,
      },
      appliedDelays,
    );
  }

  // Unreachable (the loop always returns), kept fail-closed for totality.
  return probeFrom(url, "failing", config.maxAttempts, { httpStatus: null, latency_ms: null, error: "attempts exhausted" }, appliedDelays);
}

export interface DeploymentGateResult {
  verdict: GateVerdict;
  /** Named, human-safe reasons when BLOCKED; empty when PASS. */
  blockedReasons: string[];
  /** Worst-of aggregate over all probes ("failing" for an invalid config). */
  aggregate: HealthStatus;
  /** The validated config, or null when the gate blocked before observing. */
  config: DeploymentGateConfig | null;
  probes: UrlProbeResult[];
  startedAt: string;
  finishedAt: string;
}

function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface DeploymentGateInput {
  /** Raw, untrusted configuration (validated fail-closed before any probe). */
  config: unknown;
  transport: DeploymentTransport;
  sleep?: SleepFn;
  /** Injectable wall clock (ISO string) for deterministic evidence. */
  now?: () => string;
  /** Injectable monotonic-ish clock (ms) for latency measurement. */
  nowMs?: () => number;
}

/**
 * Evaluates the deployment gate against the configured serving URLs.
 * Invalid configuration blocks WITHOUT invoking the transport; only an
 * unambiguous `ok` aggregate yields PASS.
 */
export async function evaluateDeploymentGate(
  input: DeploymentGateInput,
): Promise<DeploymentGateResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const nowMs = input.nowMs ?? (() => Date.now());
  const sleep = input.sleep ?? defaultSleep;
  const startedAt = now();

  const parsed = parseDeploymentGateConfig(input.config);
  if (!parsed.ok) {
    return {
      verdict: "BLOCKED",
      blockedReasons: parsed.reasons,
      aggregate: "failing",
      config: null,
      probes: [],
      startedAt,
      finishedAt: now(),
    };
  }

  const probes: UrlProbeResult[] = [];
  for (const url of parsed.config.urls) {
    probes.push(await probeServingUrl(url, parsed.config, input.transport, { sleep, nowMs }));
  }

  const aggregate = aggregateStatus(probes.map((probe) => probe.status));
  const blockedReasons: string[] = [];
  if (aggregate !== "ok") {
    for (const probe of probes) {
      if (probe.status === "ok") continue;
      const errorPart = probe.error === null ? "" : ` (${probe.error})`;
      blockedReasons.push(`${probe.status} probe: ${probe.url}${errorPart}`);
    }
  }

  return {
    verdict: aggregate === "ok" ? "PASS" : "BLOCKED",
    blockedReasons,
    aggregate,
    config: parsed.config,
    probes,
    startedAt,
    finishedAt: now(),
  };
}