import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const simDir = path.resolve(here, "..");
const root = path.resolve(simDir, "../..");
const { Client } = createRequire(path.join(simDir, "package.json"))("pg");
const host = process.env.SIM_PG_HOST || "127.0.0.1";
const port = Number(process.env.SIM_PG_PORT ?? 54329);
const postgrestPort = Number(process.env.SIM_POSTGREST_PORT ?? 3300);
const eventsToSeed = Number(process.env.WF04_N ?? 100);
const workers = Number(process.env.WF04_WORKERS ?? 2);
const runTag = crypto.randomBytes(4).toString("hex");
const jwtSecretPath = path.join(simDir, "load", ".jwt-secret");
const orgIds = Array.from({ length: eventsToSeed }, (_, index) => syntheticId("f0404000", index));

function syntheticId(prefix, index) {
  return `${prefix}-0000-4000-8000-${runTag}${index.toString(16).padStart(4, "0")}`;
}

function serviceRoleToken(secret) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    role: "service_role",
    iss: "supabase",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}`;
  return `${body}.${crypto.createHmac("sha256", secret).update(body).digest("base64url")}`;
}

function percentile(samples, value) {
  const sorted = [...samples].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return Math.round(sorted[Math.ceil((value / 100) * sorted.length) - 1]);
}

function assertLocalEnvironment() {
  if (!/^(127\.0\.0\.1|::1|localhost)$/.test(host)) {
    throw new Error("WF04 refuses a non-loopback Postgres host");
  }
  if (!Number.isInteger(eventsToSeed) || eventsToSeed < 1 || eventsToSeed > 500) {
    throw new Error("WF04_N must be between 1 and 500");
  }
  if (!Number.isInteger(workers) || workers < 1 || workers > 4) {
    throw new Error("WF04_WORKERS must be between 1 and 4");
  }
  if (!fs.existsSync(jwtSecretPath)) {
    throw new Error("WF04 local sim JWT secret is missing; start tools/sim-lab first");
  }
}

async function cleanup(client) {
  await client.query("BEGIN");
  await client.query("SET LOCAL session_replication_role = replica");
  await client.query("DELETE FROM public.wf_run_event WHERE org_id = ANY($1::uuid[])", [orgIds]);
  await client.query("DELETE FROM public.wf_step_run WHERE org_id = ANY($1::uuid[])", [orgIds]);
  await client.query("DELETE FROM public.wf_run WHERE org_id = ANY($1::uuid[])", [orgIds]);
  await client.query("DELETE FROM public.wf_event WHERE org_id = ANY($1::uuid[])", [orgIds]);
  await client.query("DELETE FROM public.wf_trigger_binding WHERE org_id = ANY($1::uuid[])", [
    orgIds,
  ]);
  await client.query(
    "UPDATE public.wf_definition SET current_version_id = NULL WHERE org_id = ANY($1::uuid[])",
    [orgIds],
  );
  await client.query("DELETE FROM public.wf_version WHERE org_id = ANY($1::uuid[])", [orgIds]);
  await client.query("DELETE FROM public.wf_definition WHERE org_id = ANY($1::uuid[])", [orgIds]);
  await client.query("DELETE FROM public.wf_org_settings WHERE org_id = ANY($1::uuid[])", [orgIds]);
  await client.query("DELETE FROM public.audit_chain WHERE org_id = ANY($1::uuid[])", [orgIds]);
  await client.query("COMMIT");
}

async function seed(client) {
  const eventType = "wf04.load.requested";
  const graph = {
    trigger: { kind: "event", eventType },
    steps: [
      {
        stepId: "work",
        kind: "task",
        assignment: { kind: "unassigned" },
        authorizedActions: [],
        nextStepId: "finish",
      },
      {
        stepId: "finish",
        kind: "task",
        assignment: { kind: "unassigned" },
        authorizedActions: [],
      },
    ],
    onFailure: { kind: "halt" },
    requiredApprovals: [],
  };

  await client.query("BEGIN");
  try {
    for (let index = 0; index < eventsToSeed; index += 1) {
      const orgId = orgIds[index];
      const definitionId = syntheticId("f0414000", index);
      const versionId = syntheticId("f0424000", index);
      const bindingId = syntheticId("f0434000", index);
      await client.query(
        "INSERT INTO public.wf_org_settings (org_id, workflows_enabled) VALUES ($1, true)",
        [orgId],
      );
      await client.query(
        "INSERT INTO public.wf_definition (id, org_id, key, name) VALUES ($1, $2, $3, $4)",
        [definitionId, orgId, `wf04-load-${index}`, `Synthetic WF-04 load ${index}`],
      );
      await client.query(
        `INSERT INTO public.wf_version
           (id, org_id, definition_id, version, graph, created_by, updated_by)
         VALUES ($1, $2, $3, 1, $4::jsonb, $5, $6)`,
        [
          versionId,
          orgId,
          definitionId,
          JSON.stringify(graph),
          "f0444000-0000-4000-8000-000000000001",
          "f0444000-0000-4000-8000-000000000002",
        ],
      );
      await client.query(
        "UPDATE public.wf_version SET state = 'published', published_by = $1 WHERE id = $2",
        ["f0444000-0000-4000-8000-000000000003", versionId],
      );
      await client.query("UPDATE public.wf_definition SET current_version_id = $1 WHERE id = $2", [
        versionId,
        definitionId,
      ]);
      await client.query(
        `INSERT INTO public.wf_trigger_binding
           (id, org_id, definition_id, kind, event_type, enabled)
         VALUES ($1, $2, $3, 'event', $4, true)`,
        [bindingId, orgId, definitionId, eventType],
      );
      await client.query(
        `INSERT INTO public.wf_event (org_id, event_type, source, dedupe_key, payload)
         VALUES ($1, $2, 'wf04.load', $3, '{}'::jsonb)`,
        [orgId, eventType, `wf04-${runTag}-${index}`],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function workflowPort(vite, token) {
  process.env.SUPABASE_URL = `http://127.0.0.1:${postgrestPort}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = token;
  const localFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (
      url.hostname !== "127.0.0.1" ||
      Number(url.port) !== postgrestPort ||
      !url.pathname.startsWith("/rest/v1")
    ) {
      throw new Error("WF04 blocked a non-local or non-PostgREST request");
    }
    url.pathname = url.pathname.replace(/^\/rest\/v1/, "") || "/";
    return localFetch(new Request(url, request));
  };
  const runtime = await vite.ssrLoadModule("/frontend/src/lib/workflow/workflow-runtime.ts");
  const serverRuntime = await vite.ssrLoadModule(
    "/frontend/src/lib/workflow/workflow-runtime.server.ts",
  );
  return {
    runWorkflowTick: runtime.runWorkflowTick,
    port: serverRuntime.createWorkflowRuntimePort(),
  };
}

async function remainingWork(client) {
  const result = await client.query(
    `SELECT
       (SELECT count(*) FROM public.wf_event
         WHERE org_id = ANY($1::uuid[]) AND status IN ('pending', 'claimed'))::int
       + (SELECT count(*) FROM public.wf_step_run
           WHERE org_id = ANY($1::uuid[]) AND status IN ('pending', 'claimed', 'running'))::int
         AS count`,
    [orgIds],
  );
  return result.rows[0].count;
}

async function main() {
  assertLocalEnvironment();
  const client = new Client({ host, port, user: process.env.SIM_PG_USER || "postgres" });
  const vite = await createServer({
    configFile: false,
    root,
    resolve: { alias: { "@": path.join(root, "frontend/src") } },
    server: { middlewareMode: true },
    appType: "custom",
  });
  let seeded = false;
  try {
    await client.connect();
    const safety = await client.query(
      `SELECT current_user, r.rolsuper, inet_server_addr()::text AS address
         FROM pg_roles r WHERE r.rolname = current_user`,
    );
    if (!safety.rows[0]?.rolsuper || !/^(127\.|::1$)/.test(safety.rows[0].address ?? "")) {
      throw new Error("WF04 requires a loopback disposable Postgres superuser");
    }
    for (const table of [
      "wf_org_settings",
      "wf_definition",
      "wf_version",
      "wf_trigger_binding",
      "wf_event",
      "wf_run",
      "wf_step_run",
    ]) {
      const exists = await client.query("SELECT to_regclass($1) IS NOT NULL AS ok", [
        `public.${table}`,
      ]);
      if (!exists.rows[0].ok) throw new Error("WF04 workflow migrations are not applied");
    }

    await seed(client);
    seeded = true;
    const jwtSecret = fs.readFileSync(jwtSecretPath, "utf8").trim();
    const runtime = await workflowPort(vite, serviceRoleToken(jwtSecret));
    const tickDurations = [];
    const totals = { claimed: 0, succeeded: 0, retried: 0, dead: 0, skipped: 0 };
    const started = Date.now();
    const deadline = started + 45_000;

    for (let round = 0; round < 12 && Date.now() < deadline; round += 1) {
      const batch = await Promise.all(
        Array.from({ length: workers }, async (_, index) => {
          const tickStarted = Date.now();
          const counts = await runtime.runWorkflowTick(runtime.port, {
            worker: `wf04-${runTag}-${index}`,
            limit: 500,
            leaseSeconds: 60,
            budgetMs: 45_000,
          });
          tickDurations.push(Date.now() - tickStarted);
          return counts;
        }),
      );
      for (const counts of batch) {
        for (const key of Object.keys(totals)) totals[key] += counts[key];
      }
      if ((await remainingWork(client)) === 0) break;
    }

    const elapsedMs = Math.max(1, Date.now() - started);
    const metrics = await client.query(
      `SELECT
         (SELECT count(*) FROM public.wf_event
           WHERE org_id = ANY($1::uuid[]) AND status = 'dispatched')::int AS events_dispatched,
         (SELECT count(*) FROM public.wf_step_run
           WHERE org_id = ANY($1::uuid[]) AND status = 'succeeded')::int AS steps_succeeded,
         (SELECT count(*) FROM public.wf_step_run
           WHERE org_id = ANY($1::uuid[]) AND status = 'skipped')::int AS steps_skipped,
         (SELECT count(*) FROM public.wf_step_run
           WHERE org_id = ANY($1::uuid[]) AND status = 'dead')::int AS steps_dead,
         (SELECT count(*) FROM (
            SELECT event_id FROM public.wf_run
             WHERE org_id = ANY($1::uuid[]) AND event_id IS NOT NULL
             GROUP BY event_id HAVING count(*) > 1
          ) duplicate_runs)::int
         + (SELECT count(*) FROM public.wf_step_run
             WHERE org_id = ANY($1::uuid[]) AND status = 'succeeded' AND attempt > 1)::int
           AS duplicate_executions`,
      [orgIds],
    );
    const row = metrics.rows[0];
    const result = {
      version_target: "V1 organizational workflows",
      started_at: new Date(started).toISOString(),
      organizations: orgIds.length,
      seeded_events: eventsToSeed,
      workers,
      elapsed_ms: elapsedMs,
      steps_per_minute: Math.round((row.steps_succeeded * 60_000) / elapsedMs),
      events_per_minute: Math.round((row.events_dispatched * 60_000) / elapsedMs),
      tick_duration_ms_p50: percentile(tickDurations, 50),
      tick_duration_ms_p95: percentile(tickDurations, 95),
      counts: totals,
      duplicate_execution_count: row.duplicate_executions,
    };
    const output = path.join(
      simDir,
      "results",
      `wf04-workflow-tick-${new Date().toISOString().replaceAll(/[-:.TZ]/g, "")}.json`,
    );
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
    console.log(
      `WF04-LOAD RESULT: events=${row.events_dispatched} steps=${row.steps_succeeded} steps_per_minute=${result.steps_per_minute} dup=${row.duplicate_executions}`,
    );
    if (
      row.duplicate_executions > 0 ||
      result.steps_per_minute === 0 ||
      row.events_dispatched !== eventsToSeed ||
      row.steps_succeeded < eventsToSeed ||
      row.steps_dead > 0
    ) {
      throw new Error("WF04 load test failed its throughput or duplicate-execution check");
    }
  } finally {
    try {
      if (seeded && client._connected) await cleanup(client);
    } finally {
      if (client._connected) await client.end();
      await vite.close();
    }
  }
}

main().catch((error) => {
  console.error("WF04 local workflow load test failed:", error.message);
  process.exitCode = 1;
});
