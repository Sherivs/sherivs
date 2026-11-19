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
const runTag = crypto.randomBytes(4).toString("hex");
const reference = `wf05-e2e-${runTag}`;
const templateId = syntheticId("f0514000");
const definitionId = syntheticId("f0524000");
const versionId = syntheticId("f0534000");
const bindingId = syntheticId("f0544000");
let orgId;

function syntheticId(prefix) {
  return `${prefix}-0000-4000-8000-${runTag}0001`;
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

function assertLocalEnvironment() {
  if (!/^(127\.0\.0\.1|::1|localhost)$/.test(host)) {
    throw new Error("WF05 refuses a non-loopback Postgres host");
  }
  if (!fs.existsSync(path.join(simDir, "load", ".jwt-secret"))) {
    throw new Error("WF05 local sim JWT secret is missing; start tools/sim-lab first");
  }
}

async function seed(client) {
  const graph = {
    trigger: { kind: "event", eventType: "wallet.topup_succeeded" },
    templateId,
    steps: [
      {
        stepId: "record",
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
    const school = await client.query(
      `SELECT s.id
         FROM public.schools s
        WHERE NOT EXISTS (SELECT 1 FROM public.wf_org_settings o WHERE o.org_id = s.id)
          AND NOT EXISTS (SELECT 1 FROM public.wf_event e WHERE e.org_id = s.id)
           AND NOT EXISTS (SELECT 1 FROM public.wf_definition d WHERE d.org_id = s.id)
           AND NOT EXISTS (SELECT 1 FROM public.wf_run r WHERE r.org_id = s.id)
           AND NOT EXISTS (SELECT 1 FROM public.audit_chain a WHERE a.org_id = s.id)
         ORDER BY s.id
         LIMIT 1`,
    );
    if (!school.rows[0])
      throw new Error("WF05 requires a seeded synthetic school without workflow data");
    orgId = school.rows[0].id;

    await client.query(
      "INSERT INTO public.wf_org_settings (org_id, workflows_enabled) VALUES ($1, true)",
      [orgId],
    );
    await client.query(
      `INSERT INTO public.wf_template (id, template_key, version, name, description, graph)
       VALUES ($1, $2, 1, 'WF05 synthetic top-up template', 'Local WF05 event dispatch fixture.', $3::jsonb)`,
      [templateId, `wf05-e2e-${runTag}`, JSON.stringify(graph)],
    );
    await client.query(
      "INSERT INTO public.wf_definition (id, org_id, key, name) VALUES ($1, $2, $3, 'WF05 synthetic workflow')",
      [definitionId, orgId, `wf05-e2e-${runTag}`],
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
        "f0554000-0000-4000-8000-000000000001",
        "f0554000-0000-4000-8000-000000000002",
      ],
    );
    await client.query(
      "UPDATE public.wf_version SET state = 'published', published_by = $1 WHERE id = $2",
      ["f0554000-0000-4000-8000-000000000003", versionId],
    );
    await client.query("UPDATE public.wf_definition SET current_version_id = $1 WHERE id = $2", [
      versionId,
      definitionId,
    ]);
    await client.query(
      `INSERT INTO public.wf_trigger_binding (id, org_id, definition_id, kind, event_type, enabled)
       VALUES ($1, $2, $3, 'event', 'wallet.topup_succeeded', true)`,
      [bindingId, orgId, definitionId],
    );
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
      throw new Error("WF05 blocked a non-local or non-PostgREST request");
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
  const originalFetch = globalThis.fetch;
  try {
    await client.connect();
    const safety = await client.query(
      `SELECT current_user, r.rolsuper, inet_server_addr()::text AS address
         FROM pg_roles r WHERE r.rolname = current_user`,
    );
    if (!safety.rows[0]?.rolsuper || !/^(127\.|::1$)/.test(safety.rows[0].address ?? "")) {
      throw new Error("WF05 requires a loopback disposable Postgres superuser");
    }
    const source = await client.query(
      `SELECT to_regclass('public.wf_event_source') IS NOT NULL
              AND to_regclass('public.wallet_ledger') IS NOT NULL
              AND EXISTS (SELECT 1 FROM public.wf_event_source WHERE event_type = 'wallet.topup_succeeded')
              AS ready`,
    );
    if (!source.rows[0].ready) throw new Error("WF05 migrations are not applied");

    await seed(client);
    await client.query(
      `SELECT public._wallet_post(
         $1, 'topup', 1200, $2, NULL, NULL, NULL, jsonb_build_object('channel', 'wf05-e2e')
       )`,
      [orgId, reference],
    );
    const emitted = await client.query(
      `SELECT id, payload FROM public.wf_event
        WHERE org_id = $1 AND event_type = 'wallet.topup_succeeded'
          AND dedupe_key = 'wallet.topup_succeeded:wallet_ledger:' ||
            (SELECT id::text FROM public.wallet_ledger WHERE school_id = $1 AND reference = $2) || ':topup'`,
      [orgId, reference],
    );
    if (emitted.rowCount !== 1) throw new Error("WF05 source row did not emit exactly one event");

    const jwtSecret = fs.readFileSync(path.join(simDir, "load", ".jwt-secret"), "utf8").trim();
    const runtime = await workflowPort(vite, serviceRoleToken(jwtSecret));
    const counts = await runtime.runWorkflowTick(runtime.port, {
      worker: `wf05-${runTag}`,
      limit: 10,
      leaseSeconds: 60,
      budgetMs: 45_000,
      executeAction: async () => {},
    });
    const result = await client.query(
      `SELECT e.status,
              count(DISTINCT r.id)::int AS runs,
              count(DISTINCT a.seq)::int AS audits
         FROM public.wf_event e
         LEFT JOIN public.wf_run r ON r.org_id = e.org_id AND r.event_id = e.id
         LEFT JOIN public.audit_chain a
           ON a.org_id = r.org_id AND a.action = 'workflow.run.created'
          AND a.target_type = 'wf_run' AND a.target_id = r.id::text
        WHERE e.id = $1
        GROUP BY e.status`,
      [emitted.rows[0].id],
    );
    const row = result.rows[0];
    const duplicateRuns = await client.query(
      `SELECT count(*)::int AS count
         FROM (SELECT event_id FROM public.wf_run WHERE org_id = $1 AND event_id = $2
                GROUP BY event_id HAVING count(*) > 1) duplicate_runs`,
      [orgId, emitted.rows[0].id],
    );
    const duplicates = duplicateRuns.rows[0].count;
    console.log(
      `WF05-E2E RESULT: event=${emitted.rowCount} status=${row?.status ?? "missing"} runs=${row?.runs ?? 0} audits=${row?.audits ?? 0} dispatched=${counts.succeeded} dup=${duplicates}`,
    );
    if (
      row?.status !== "dispatched" ||
      row.runs !== 1 ||
      row.audits < 1 ||
      counts.succeeded < 1 ||
      duplicates !== 0
    ) {
      throw new Error("WF05 event dispatch, published workflow run or audit assertion failed");
    }
  } finally {
    globalThis.fetch = originalFetch;
    try {
      if (client._connected && orgId) {
        await client.query(
          "UPDATE public.wf_org_settings SET workflows_enabled = false WHERE org_id = $1",
          [orgId],
        );
      }
    } finally {
      if (client._connected) await client.end();
      await vite.close();
    }
  }
}

main().catch((error) => {
  console.error("WF05 local event E2E failed:", error.message);
  process.exitCode = 1;
});
