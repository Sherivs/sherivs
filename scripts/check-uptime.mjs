#!/usr/bin/env node
/**
 * Sherivs uptime probe (mission M23, ADR-110).
 *
 * Requests the public health endpoint once and FAILS unless it answers HTTP 200 with a JSON body
 * whose `checks` contain `{ "name": "database", "status": "ok" }` (the shape built by
 * frontend/src/lib/observability/health.ts and db-health.server.ts).
 *
 * The URL comes from SHERIVS_HEALTH_URL (the uptime workflow fills it from the repository
 * variable of the same name). When it is unset the probe prints STATUS=BLOCKED and exits 0, so
 * an unconfigured repository does not fail every hour. The URL must be https, except for
 * localhost and 127.0.0.1. It sends no credentials and prints only the host, never a query string.
 *
 * Usage: node scripts/check-uptime.mjs [--timeout-ms 10000]
 * Exit codes: 0 PASS or BLOCKED (unset) · 1 FAIL.
 */
import { pathToFileURL } from "node:url";

export const DATABASE_CHECK_NAME = "database";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Parse and screen the configured URL; returns { url } or { error }. */
export function parseHealthUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { error: "SHERIVS_HEALTH_URL is not a valid URL" };
  }
  if (url.username || url.password)
    return { error: "SHERIVS_HEALTH_URL must not carry credentials" };
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    return { error: "SHERIVS_HEALTH_URL must use https (http is allowed only for localhost)" };
  }
  return { url };
}

/** Pure verdict over one HTTP answer. */
export function evaluateHealth({ status, body }) {
  if (status !== 200)
    return { ok: false, reason: `health endpoint answered HTTP ${status}, expected 200` };
  let parsed;
  try {
    parsed = typeof body === "string" ? JSON.parse(body) : body;
  } catch {
    return { ok: false, reason: "health endpoint did not answer JSON" };
  }
  const checks = Array.isArray(parsed?.checks) ? parsed.checks : [];
  const database = checks.find((check) => check?.name === DATABASE_CHECK_NAME);
  if (!database) return { ok: false, reason: "health report has no database check" };
  if (database.status !== "ok") {
    return { ok: false, reason: `database check is ${String(database.status)}, expected ok` };
  }
  return { ok: true, reason: `HTTP 200, database ok, overall ${String(parsed.status)}` };
}

export async function run({ env, argv, fetchImpl, log }) {
  const raw = (env.SHERIVS_HEALTH_URL ?? "").trim();
  if (!raw) {
    log("STATUS=BLOCKED SHERIVS_HEALTH_URL is not set (repository variable); nothing was probed");
    return 0;
  }
  const parsed = parseHealthUrl(raw);
  if (parsed.error) {
    log(`STATUS=FAIL ${parsed.error}`);
    return 1;
  }
  const index = argv.indexOf("--timeout-ms");
  const timeoutMs = index >= 0 ? Number(argv[index + 1]) : 10_000;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10_000,
  );
  let verdict;
  try {
    const response = await fetchImpl(parsed.url.href, {
      headers: { Accept: "application/json", "User-Agent": "sherivs-uptime-probe" },
      redirect: "manual",
      signal: controller.signal,
    });
    verdict = evaluateHealth({ status: response.status, body: await response.text() });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    verdict = { ok: false, reason: aborted ? "no answer in time" : "request failed" };
  } finally {
    clearTimeout(timer);
  }
  log(`uptime probe ${parsed.url.host}: ${verdict.reason}`);
  log(`STATUS=${verdict.ok ? "PASS" : "FAIL"}`);
  return verdict.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run({
    env: process.env,
    argv: process.argv.slice(2),
    fetchImpl: globalThis.fetch,
    log: (l) => console.log(l),
  }).then((code) => {
    process.exitCode = code;
  });
}
