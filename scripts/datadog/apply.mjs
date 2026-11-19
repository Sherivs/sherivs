#!/usr/bin/env node
/**
 * OBS-DD-02 — apply Sherivs Datadog monitors, dashboard and service catalog from the repo.
 *
 * Dry run by default: validates the files locally (and, with keys, through Datadog's monitor
 * validation endpoint) and prints the plan. Pass --apply to create or update.
 *
 *   DD_API_KEY=… DD_APP_KEY=… node scripts/datadog/apply.mjs            # plan
 *   DD_API_KEY=… DD_APP_KEY=… node scripts/datadog/apply.mjs --apply    # create/update
 *   … --with-worker-telemetry   also apply monitors tagged requires:worker-telemetry
 *                               (only once OBSERVABILITY_DATADOG_ENABLED is "true" on the Worker)
 *
 * EU only: DD_SITE must be unset or "datadoghq.eu". Keys are read from the environment, sent
 * only as request headers, and never printed. Idempotent: monitors are matched by their
 * sherivs-monitor-id tag and the dashboard by title. Monitors, dashboards and service catalog
 * entries are included in every Datadog plan; this script creates no billable product.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dir = join(root, "infra/datadog");
export const NOTIFY = "@hello@sherivs.com";
export const SERVICE_FILES = [
  "service.datadog.yaml",
  "infra/cloudflare/sherivs-cron/service.datadog.yaml",
];

export function loadMonitors() {
  return readdirSync(join(dir, "monitors"))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({ file, body: JSON.parse(readFileSync(join(dir, "monitors", file), "utf8")) }));
}

export function loadDashboards() {
  return readdirSync(join(dir, "dashboards"))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({
      file,
      body: JSON.parse(readFileSync(join(dir, "dashboards", file), "utf8")),
    }));
}

export function monitorId(monitor) {
  const tag = (monitor.tags ?? []).find((t) => t.startsWith("sherivs-monitor-id:"));
  return tag ? tag.slice("sherivs-monitor-id:".length) : null;
}

/** Local invariants. Returns a list of problems (empty when valid). */
export function lint(monitors) {
  const problems = [];
  const ids = new Set();
  for (const { file, body } of monitors) {
    const id = monitorId(body);
    if (!id || `${id}.json` !== file)
      problems.push(`${file}: sherivs-monitor-id tag must match file name`);
    if (ids.has(id)) problems.push(`${file}: duplicate id`);
    ids.add(id);
    if (!String(body.message).includes(NOTIFY)) problems.push(`${file}: must notify ${NOTIFY}`);
    if (!body.tags?.includes("team:sherivs")) problems.push(`${file}: missing team:sherivs tag`);
    if (!body.query || !body.type || !body.name)
      problems.push(`${file}: name, type and query are required`);
  }
  return problems;
}

async function main(argv) {
  const apply = argv.includes("--apply");
  const withWorker = argv.includes("--with-worker-telemetry");
  const site = process.env.DD_SITE ?? "datadoghq.eu";
  if (site !== "datadoghq.eu") throw new Error("DD_SITE must be datadoghq.eu (EU data residency)");

  const monitors = loadMonitors().filter(
    (m) => withWorker || !m.body.tags.includes("requires:worker-telemetry"),
  );
  const dashboards = loadDashboards();
  const problems = lint(loadMonitors());
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exitCode = 1;
    return;
  }

  const apiKey = (process.env.DD_API_KEY ?? "").trim();
  const appKey = (process.env.DD_APP_KEY ?? "").trim();
  if (!apiKey || !appKey) {
    console.log(`local check ok: ${monitors.length} monitor(s), ${dashboards.length} dashboard(s)`);
    console.log("DD_API_KEY and DD_APP_KEY not both set; skipping remote validation and apply.");
    if (apply) process.exitCode = 1;
    return;
  }

  const base = "https://api.datadoghq.eu";
  const headers = {
    "DD-API-KEY": apiKey,
    "DD-APPLICATION-KEY": appKey,
    "Content-Type": "application/json",
  };
  const call = async (method, path, body, extraHeaders = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: { ...headers, ...extraHeaders },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok)
      throw new Error(`${method} ${path} -> HTTP ${response.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  };

  const existing = await call("GET", "/api/v1/monitor?monitor_tags=managed-by:sherivs-repo");
  for (const { file, body } of monitors) {
    await call("POST", "/api/v1/monitor/validate", body);
    const id = monitorId(body);
    const match = existing.find((m) => monitorId(m) === id);
    if (!apply) {
      console.log(`plan: monitor ${id} -> ${match ? `update ${match.id}` : "create"}`);
      continue;
    }
    const saved = match
      ? await call("PUT", `/api/v1/monitor/${match.id}`, body)
      : await call("POST", "/api/v1/monitor", body);
    console.log(`monitor ${id}: ${match ? "updated" : "created"} id=${saved.id} (${file})`);
  }

  const boards = (await call("GET", "/api/v1/dashboard")).dashboards ?? [];
  for (const { file, body } of dashboards) {
    const match = boards.find((b) => b.title === body.title);
    if (!apply) {
      console.log(`plan: dashboard "${body.title}" -> ${match ? `update ${match.id}` : "create"}`);
      continue;
    }
    const saved = match
      ? await call("PUT", `/api/v1/dashboard/${match.id}`, body)
      : await call("POST", "/api/v1/dashboard", body);
    console.log(
      `dashboard "${body.title}": ${match ? "updated" : "created"} id=${saved.id} url=${saved.url ?? ""} (${file})`,
    );
  }

  for (const file of SERVICE_FILES) {
    if (!apply) {
      console.log(`plan: service definition ${file} -> upsert`);
      continue;
    }
    const yaml = readFileSync(join(root, file), "utf8");
    await call("POST", "/api/v2/services/definitions", yaml, {
      "Content-Type": "application/x-yaml",
    });
    console.log(`service definition upserted (${file})`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(String(error?.message ?? error));
    process.exitCode = 1;
  });
}
