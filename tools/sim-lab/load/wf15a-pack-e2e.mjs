// WF-15a Private School Pack E2E against the local sim-lab Postgres + PostgREST (never a hosted database).
//
// Installs the pack's eight templates from the TypeScript source of truth, instantiates each as a published
// workflow in a synthetic organization, emits the real WF-05 event types (including the five WF-15a2 reminder types), drives the real workflow tick
// with a counting action stub, then replays the same events to prove replay creates nothing.
// Scope, stated plainly: this proves the pack graphs are accepted by the engine and dispatch exactly once. The
// real action executor (drafts, approvals, sandbox outbox) is not re-driven here; WF-06 and WF-07 e2es own it.
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
const uid = (prefix, n) => `${prefix}-0000-4000-8000-${runTag}${String(n).padStart(4, "0")}`;
const EVENTS = {
  ps_fee_ladder: {
    type: "fees.invoice_issued",
    payload: { amount_kobo: 4500000, invoice_id: uid("f15a0001", 1) },
  },
  ps_fee_week_start: {
    type: "fees.reminder_week_start",
    payload: {
      amount_kobo: 4500000,
      due_at: "2026-12-04",
      invoice_id: uid("f15a0001", 1),
      offset_days: 32,
    },
  },
  ps_fee_week_end: {
    type: "fees.reminder_week_end",
    payload: {
      amount_kobo: 4500000,
      due_at: "2026-12-04",
      invoice_id: uid("f15a0001", 1),
      offset_days: 28,
    },
  },
  ps_fee_due_day: {
    type: "fees.reminder_due_day",
    payload: {
      amount_kobo: 4500000,
      due_at: "2026-12-04",
      invoice_id: uid("f15a0001", 1),
      offset_days: 0,
    },
  },
  ps_fee_overdue: {
    type: "fees.reminder_overdue",
    payload: {
      amount_kobo: 4500000,
      due_at: "2026-12-04",
      invoice_id: uid("f15a0001", 1),
      offset_days: -7,
    },
  },
  ps_fee_escalation: {
    type: "fees.reminder_escalation",
    payload: {
      amount_kobo: 4500000,
      due_at: "2026-12-04",
      invoice_id: uid("f15a0001", 1),
      offset_days: -28,
    },
  },
  ps_payment_receipt: {
    type: "payment.succeeded",
    payload: {
      amount_kobo: 4500000,
      invoice_id: uid("f15a0001", 1),
      method: "transfer",
      payment_id: uid("f15a0002", 1),
    },
  },
  ps_absence_alert: {
    type: "attendance.marked_absent",
    payload: { attendance_id: uid("f15a0003", 1), status: "absent" },
  },
};
let orgId;

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
  if (!/^(127\.0\.0\.1|::1|localhost)$/.test(host))
    throw new Error("WF15A refuses a non-loopback Postgres host");
  if (!fs.existsSync(path.join(simDir, "load", ".jwt-secret"))) {
    throw new Error("WF15A local sim JWT secret is missing; start tools/sim-lab first");
  }
}

async function seed(client, pack) {
  await client.query("BEGIN");
  try {
    orgId = uid("f15a0000", 1);
    await client.query("INSERT INTO public.schools (id, name, slug) VALUES ($1, $2, $3)", [
      orgId,
      "WF15A e2e org",
      `wf15a-e2e-${runTag}`,
    ]);
    await client.query(
      "INSERT INTO public.wf_org_settings (org_id, workflows_enabled) VALUES ($1, true)",
      [orgId],
    );
    let n = 0;
    for (const t of pack.templates) {
      n += 1;
      const row = pack.packTemplateToCatalogRow(t);
      const templateId = uid("f15a1000", n);
      const definitionId = uid("f15a2000", n);
      const versionId = uid("f15a3000", n);
      const key = `${row.template_key}-${runTag}`;
      await client.query(
        `INSERT INTO public.wf_template (id, template_key, version, name, description, graph)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [templateId, key, row.version, row.name, row.description, JSON.stringify(row.graph)],
      );
      const graph = { ...row.graph, templateId };
      await client.query(
        "INSERT INTO public.wf_definition (id, org_id, key, name) VALUES ($1, $2, $3, $4)",
        [definitionId, orgId, key, row.name],
      );
      await client.query(
        `INSERT INTO public.wf_version (id, org_id, definition_id, version, graph, created_by, updated_by)
         VALUES ($1, $2, $3, 1, $4::jsonb, $5, $6)`,
        [
          versionId,
          orgId,
          definitionId,
          JSON.stringify(graph),
          uid("f15a4000", 1),
          uid("f15a4000", 2),
        ],
      );
      await client.query(
        "UPDATE public.wf_version SET state = 'published', published_by = $1 WHERE id = $2",
        [uid("f15a4000", 3), versionId],
      );
      await client.query("UPDATE public.wf_definition SET current_version_id = $1 WHERE id = $2", [
        versionId,
        definitionId,
      ]);
      await client.query(
        `INSERT INTO public.wf_trigger_binding (id, org_id, definition_id, kind, event_type, enabled)
         VALUES ($1, $2, $3, 'event', $4, true)`,
        [uid("f15a5000", n), orgId, definitionId, row.graph.trigger.eventType],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function emitAll(client, round) {
  for (const [key, e] of Object.entries(EVENTS)) {
    await client.query("SELECT public.wf_emit_event($1, $2, $3, $4, $5, $6::jsonb)", [
      orgId,
      e.type,
      "wf15a-e2e",
      `wf15a:${runTag}:${key}`,
      `subject:${key}:${round}`,
      JSON.stringify(e.payload),
    ]);
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
      throw new Error("WF15A blocked a non-local or non-PostgREST request");
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
      `SELECT r.rolsuper, inet_server_addr()::text AS address FROM pg_roles r WHERE r.rolname = current_user`,
    );
    if (!safety.rows[0]?.rolsuper || !/^(127\.|::1$)/.test(safety.rows[0].address ?? "")) {
      throw new Error("WF15A requires a loopback disposable Postgres superuser");
    }
    const mod = await vite.ssrLoadModule(
      "/frontend/src/lib/runtime/scholar/workflow-packs/private-school-pack.ts",
    );
    const validation = mod.validatePrivateSchoolPack();
    if (!validation.ok)
      throw new Error(`WF15A pack failed validation: ${validation.errors.join("; ")}`);
    await seed(client, {
      templates: mod.PRIVATE_SCHOOL_PACK_V1.templates,
      packTemplateToCatalogRow: mod.packTemplateToCatalogRow,
    });

    await emitAll(client, 1);
    const emitted = await client.query(
      "SELECT count(*)::int AS n FROM public.wf_event WHERE org_id = $1",
      [orgId],
    );

    const jwtSecret = fs.readFileSync(path.join(simDir, "load", ".jwt-secret"), "utf8").trim();
    const runtime = await workflowPort(vite, serviceRoleToken(jwtSecret));
    let executorCalls = 0;
    const tick = () =>
      runtime.runWorkflowTick(runtime.port, {
        worker: `wf15a-${runTag}`,
        limit: 20,
        leaseSeconds: 60,
        budgetMs: 45_000,
        executeAction: async () => {
          executorCalls += 1;
        },
      });
    await tick();
    const first = await client.query(
      `SELECT count(DISTINCT e.id)::int AS events,
              count(*) FILTER (WHERE e.status = 'dispatched')::int AS dispatched,
              count(DISTINCT r.id)::int AS runs
         FROM public.wf_event e LEFT JOIN public.wf_run r ON r.org_id = e.org_id AND r.event_id = e.id
        WHERE e.org_id = $1`,
      [orgId],
    );
    // Replay: the same dedupe keys again must create no event and no run.
    await emitAll(client, 2);
    await tick();
    const after = await client.query(
      `SELECT (SELECT count(*)::int FROM public.wf_event WHERE org_id = $1) AS events,
              (SELECT count(*)::int FROM public.wf_run WHERE org_id = $1) AS runs`,
      [orgId],
    );
    const dup = await client.query(
      `SELECT count(*)::int AS n FROM (
         SELECT event_id, version_id FROM public.wf_run WHERE org_id = $1 GROUP BY 1, 2 HAVING count(*) > 1) d`,
      [orgId],
    );
    const replayRuns = after.rows[0].runs - first.rows[0].runs;
    const kinds = await client.query(
      `SELECT count(*)::int AS n FROM public.wf_template t, jsonb_array_elements(t.graph->'steps') s
        WHERE t.template_key LIKE $1 AND s #>> '{action,kind}' IN ('webhook')`,
      [`ps\\_%-${runTag}`],
    );
    const sentLive = kinds.rows[0].n; // no provider adapter is wired in this script; no provider adapter exists in this script, so the only thing counted is a webhook step (sms and whatsapp are drafts here).
    console.log(
      `WF15A-E2E RESULT: templates=${mod.PRIVATE_SCHOOL_PACK_V1.templates.length} events=${emitted.rows[0].n} dispatched=${first.rows[0].dispatched} runs=${first.rows[0].runs} replay_events=${after.rows[0].events - emitted.rows[0].n} replay_runs=${replayRuns} executor_calls_positive=${executorCalls > 0 ? 1 : 0} sent_live=${sentLive} dup=${dup.rows[0].n}`,
    );
    if (
      first.rows[0].dispatched !== 8 ||
      first.rows[0].runs !== 8 ||
      after.rows[0].events !== emitted.rows[0].n ||
      replayRuns !== 0 ||
      executorCalls < 1 ||
      sentLive !== 0 ||
      dup.rows[0].n !== 0
    ) {
      throw new Error("WF15A pack install, dispatch, replay or no-live-send assertion failed");
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
  console.error("WF15A local pack E2E failed:", error.message);
  process.exitCode = 1;
});
