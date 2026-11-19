// WF-06 action E2E against the local sim-lab Postgres + PostgREST (never a hosted database).
//
// Drives real workflow ticks through the production action executor
// (`createWorkflowActionRuntime` / `createWorkflowActionExecutor` in
// workflow-action-runtime.server.ts), with the real broker, ledger, draft and outbox writers.
// Only the outbound provider adapters (and the gate's HTTP port) are stubbed, and every stub
// counts its calls: `sent_live` is computed from those counters, `dup` from SQL.
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
const EVENT_TYPE = "wallet.topup_succeeded";
const THRESHOLD = 25; // WORKFLOW_MASS_RECIPIENT_THRESHOLD; asserted against the TS export below.

function id(prefix, n) {
  return `${prefix}-0000-4000-8000-${runTag}${String(n).padStart(4, "0")}`;
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
    throw new Error("WF06 refuses a non-loopback Postgres host");
  }
  if (!fs.existsSync(path.join(simDir, "load", ".jwt-secret"))) {
    throw new Error("WF06 local sim JWT secret is missing; start tools/sim-lab first");
  }
}

/** Counting stubs for every outbound provider path. Nothing here reaches a network. */
function countingProviders() {
  const calls = { adapters: 0, http: 0 };
  const adapter = (connector, tools) => ({
    connector,
    tools,
    async execute() {
      calls.adapters += 1;
      return { ok: true, outcome: "succeeded", externalRef: `stub-${connector}` };
    },
  });
  return {
    calls,
    dependencies: {
      adapters: {
        "in-app": adapter("in-app", ["workflow.action.in_app"]),
        sms: adapter("sms", ["workflow.action.sms"]),
        email: adapter("email", ["workflow.action.email"]),
        whatsapp: adapter("whatsapp", ["workflow.action.whatsapp"]),
        "http-webhook": adapter("http-webhook", ["workflow.action.webhook"]),
      },
      http: {
        async request() {
          calls.http += 1;
          return { status: 599, headers: {}, body: "" };
        },
      },
    },
  };
}

const rolePack = (code, role) => ({
  schema: "sherivs.role-pack.v1",
  code,
  version: "1.0.0",
  title: "WF06 e2e workflow agent",
  kind: "tenant_role",
  appliesTo: [role],
  permissions: ["workflows.run"],
  capabilities: [
    {
      id: "workflow.in-app",
      title: "Workflow in-app message",
      tier: "T1",
      autonomy: "act_autonomously",
      requiresPermission: "workflows.run",
      connector: "in-app",
    },
    {
      id: "workflow.sms",
      title: "Workflow SMS",
      tier: "T2",
      autonomy: "act_with_approval",
      approver: "role_owner",
      requiresPermission: "workflows.run",
      connector: "sms",
    },
  ],
  playbooks: [],
  memory: { domains: ["work"], maxSensitivity: "internal", retentionDays: 90, crossTenant: false },
  budget: { dailyActions: 50, dailyModelCalls: 0, dailyCostCapMinor: 0 },
  escalation: { defaultApprover: "role_owner", t3Approver: "sheriff" },
  startsInShadow: true,
});

/**
 * One synthetic organization with: workflow settings, an agent with earned autonomy, a published
 * single-action workflow bound to an event, an active twin context for the agent (role pack with
 * an `in-app` capability promoted to autonomous), a tenant connector binding, approved templates
 * and `recipients` active members.
 */
async function seedOrganization(client, n, { action, recipients }) {
  const orgId = id("f0660000", n);
  const agentRef = `wf06.e2e.agent.${runTag}.${n}`;
  const agentIdentity = id("f0661000", n);
  const role = `wf06-e2e-agent-${runTag}-${n}`;
  const packCode = `wf06-e2e-${runTag}-${n}`;
  const templateId = id("f0662000", n);
  const definitionId = id("f0663000", n);
  const versionId = id("f0664000", n);
  const memberIds = Array.from({ length: recipients }, (_, index) =>
    id(`f066${String(5000 + n).padStart(4, "0")}`, index + 1),
  );
  const graph = {
    trigger: { kind: "event", eventType: EVENT_TYPE },
    templateId,
    steps: [
      {
        stepId: "notify",
        kind: "action",
        assignment: { kind: "unassigned" },
        budgetUnits: 5,
        nextStepId: "record",
        authorizedActions: [`workflow.action.${action.kind}`],
        action: { ...action, recipientIds: memberIds },
      },
      // A follow-up step proves whether the run continued past the action.
      { stepId: "record", kind: "task", assignment: { kind: "unassigned" }, authorizedActions: [] },
    ],
    onFailure: { kind: "halt" },
    requiredApprovals: [],
  };
  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO public.schools (id, name, slug) VALUES ($1, $2, $3)", [
      orgId,
      `WF06 e2e org ${n}`,
      `wf06-e2e-${runTag}-${n}`,
    ]);
    await client.query(
      `INSERT INTO public.wf_org_settings (org_id, workflows_enabled, autonomy_ceiling)
       VALUES ($1, true, 'act_and_report')`,
      [orgId],
    );
    await client.query(
      `INSERT INTO public.wf_agent_autonomy (org_id, agent_ref, earned_level)
       VALUES ($1, $2, 'act_and_report')`,
      [orgId, agentRef],
    );
    await client.query(
      `INSERT INTO public.wf_template
         (id, template_key, version, name, description, graph, agent_ref, autonomy_max)
       VALUES ($1, $2, 1, 'WF06 e2e template', 'Local WF06 action fixture.', $3::jsonb, $4,
         'act_and_report')`,
      [templateId, `wf06-e2e-${runTag}-${n}`, JSON.stringify(graph), agentRef],
    );
    await client.query(
      "INSERT INTO public.wf_definition (id, org_id, key, name) VALUES ($1, $2, $3, 'WF06 e2e workflow')",
      [definitionId, orgId, `wf06-e2e-${runTag}-${n}`],
    );
    await client.query(
      `INSERT INTO public.wf_version (id, org_id, definition_id, version, graph, created_by, updated_by)
       VALUES ($1, $2, $3, 1, $4::jsonb, $5, $6)`,
      [versionId, orgId, definitionId, JSON.stringify(graph), id("f0667000", 1), id("f0667000", 2)],
    );
    await client.query(
      "UPDATE public.wf_version SET state = 'published', published_by = $1 WHERE id = $2",
      [id("f0667000", 3), versionId],
    );
    await client.query("UPDATE public.wf_definition SET current_version_id = $1 WHERE id = $2", [
      versionId,
      definitionId,
    ]);
    await client.query(
      `INSERT INTO public.wf_trigger_binding (id, org_id, definition_id, kind, event_type, enabled)
       VALUES ($1, $2, $3, 'event', $4, true)`,
      [id("f0668000", n), orgId, definitionId, EVENT_TYPE],
    );

    // Twin context for the workflow agent, with a published pack and earned trust.
    await client.query("INSERT INTO auth.users (id) VALUES ($1)", [agentIdentity]);
    await client.query(
      `INSERT INTO public.cg_role_pack (code, version, kind, applies_to, status, definition)
       VALUES ($1, '1.0.0', 'tenant_role', ARRAY[$2], 'published', $3::jsonb)`,
      [packCode, role, JSON.stringify(rolePack(packCode, role))],
    );
    const ensured = await client.query(
      `SELECT public.cg_twin_ensure_context($1, 'tenant_membership', $2, $3, $4, true) AS r`,
      [agentIdentity, orgId, role, `wf06-e2e-${runTag}-${n}`],
    );
    const contextId = ensured.rows[0].r.context_id;
    await client.query(
      "UPDATE public.cg_twin_context SET agent_definition_ref = $1 WHERE id = $2",
      [agentRef, contextId],
    );
    for (const state of ["propose", "assist", "autonomous"]) {
      await client.query(
        `UPDATE public.cg_twin_trust SET state = $1
          WHERE context_id = $2 AND capability_id = 'workflow.in-app'`,
        [state, contextId],
      );
    }
    for (const connector of ["in-app", "sms"]) {
      await client.query(
        `INSERT INTO public.cg_connector_binding (connector, scope, tenant_ref, secret_ref)
         VALUES ($1, 'tenant', $2, $3)`,
        [connector, orgId, `vault://${connector}/wf06-e2e-${runTag}-${n}#v1`],
      );
    }

    // Approved templates (no free text from events) and server-resolvable recipients.
    await client.query(
      `INSERT INTO public.wf_action_template (org_id, kind, template_ref, body_template, parameter_keys, status)
       VALUES ($1, 'in_app', 'wf06.notice', 'Status: {{status}}', ARRAY['status'], 'approved')`,
      [orgId],
    );
    await client.query(
      `INSERT INTO public.comms_templates (school_id, org_id, code, channel, category, body, status)
       VALUES ($1, $1, 'wf06.notice', 'sms', 'utility', 'Status update', 'approved')`,
      [orgId],
    );
    for (const memberId of memberIds) {
      await client.query("INSERT INTO auth.users (id) VALUES ($1)", [memberId]);
      await client.query(
        `INSERT INTO public.organization_memberships (user_id, school_id, role, is_active)
         VALUES ($1, $2, 'parent', true)`,
        [memberId, orgId],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return { orgId, memberIds };
}

async function emitEvent(client, orgId, n) {
  await client.query(
    `INSERT INTO public.wf_event (org_id, event_type, source, dedupe_key, payload)
     VALUES ($1, $2, 'wf06-e2e', $3, '{}'::jsonb)`,
    [orgId, EVENT_TYPE, `wf06-e2e:${runTag}:${n}`],
  );
}

async function loadModules(vite, token) {
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
      throw new Error("WF06 blocked a non-local or non-PostgREST request");
    }
    url.pathname = url.pathname.replace(/^\/rest\/v1/, "") || "/";
    return localFetch(new Request(url, request));
  };
  const runtime = await vite.ssrLoadModule("/frontend/src/lib/workflow/workflow-runtime.ts");
  const serverRuntime = await vite.ssrLoadModule(
    "/frontend/src/lib/workflow/workflow-runtime.server.ts",
  );
  const actionRuntime = await vite.ssrLoadModule(
    "/frontend/src/lib/workflow/workflow-action-runtime.server.ts",
  );
  const actions = await vite.ssrLoadModule("/frontend/src/lib/workflow/workflow-actions.ts");
  if (actions.WORKFLOW_MASS_RECIPIENT_THRESHOLD !== THRESHOLD) {
    throw new Error("WF06 mass threshold drifted from 25");
  }
  return {
    runWorkflowTick: runtime.runWorkflowTick,
    createPort: serverRuntime.createWorkflowRuntimePort,
    createWorkflowActionRuntime: actionRuntime.createWorkflowActionRuntime,
  };
}

/** Wraps the real executor only to observe the error it throws; it never changes behaviour. */
function observed(executeAction, errors) {
  return async (input) => {
    try {
      return await executeAction(input);
    } catch (error) {
      errors.push(error?.message ?? String(error));
      throw error;
    }
  };
}

async function tickUntil(modules, actionRuntime, done, label) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await modules.runWorkflowTick(modules.createPort(), {
      worker: `wf06-${runTag}-${label}`,
      limit: 20,
      leaseSeconds: 60,
      budgetMs: 30_000,
      ...actionRuntime,
    });
    if (await done()) return true;
  }
  return false;
}

async function scalar(client, sql, params) {
  return (await client.query(sql, params)).rows[0].n;
}

const countLedger = (client, orgId) =>
  scalar(
    client,
    `SELECT count(*)::int AS n FROM public.cg_tool_call_ledger
      WHERE tenant_ref = $1 AND tool_id LIKE 'workflow.action.%'`,
    [orgId],
  );
const countOutbox = (client, orgId) =>
  scalar(
    client,
    "SELECT count(*)::int AS n FROM public.wf_action_sandbox_outbox WHERE org_id = $1",
    [orgId],
  );
const countDrafts = (client, orgId) =>
  scalar(client, "SELECT count(*)::int AS n FROM public.wf_action_draft WHERE org_id = $1", [
    orgId,
  ]);

async function actionStep(client, orgId) {
  const result = await client.query(
    `SELECT s.id, s.org_id, s.run_id, s.step_key, s.iteration, s.status, s.attempt,
            s.max_attempts, s.idempotency_key, s.timeout_seconds, s.action_class,
            s.autonomy_level, s.budget_units, s.spent_units, s.error_code, r.status AS run_status
       FROM public.wf_step_run s
       JOIN public.wf_run r ON r.org_id = s.org_id AND r.id = s.run_id
      WHERE s.org_id = $1 AND s.step_key = 'notify'`,
    [orgId],
  );
  return result.rows;
}

function claimedShape(row) {
  return {
    id: row.id,
    orgId: row.org_id,
    leaseOwner: `wf06-${runTag}-retry`,
    runId: row.run_id,
    stepKey: row.step_key,
    iteration: row.iteration,
    status: "claimed",
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    idempotencyKey: row.idempotency_key,
    timeoutSeconds: row.timeout_seconds,
    actionClass: row.action_class,
    autonomyLevel: row.autonomy_level,
    budgetUnits: row.budget_units,
    spentUnits: row.spent_units,
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
    logLevel: "error",
  });
  const originalFetch = globalThis.fetch;
  const orgs = [];
  try {
    await client.connect();
    const safety = await client.query(
      `SELECT r.rolsuper, inet_server_addr()::text AS address
         FROM pg_roles r WHERE r.rolname = current_user`,
    );
    if (!safety.rows[0]?.rolsuper || !/^(127\.|::1$)/.test(safety.rows[0].address ?? "")) {
      throw new Error("WF06 requires a loopback disposable Postgres superuser");
    }
    const ready = await client.query(
      `SELECT to_regclass('public.wf_action_sandbox_outbox') IS NOT NULL
              AND EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_schema = 'public' AND table_name = 'wf_action_sandbox_outbox'
                             AND column_name = 'category')
              AND to_regclass('public.comms_templates') IS NOT NULL AS ready`,
    );
    if (!ready.rows[0].ready) throw new Error("WF06 migrations are not applied");

    const inApp = {
      kind: "in_app",
      templateRef: "wf06.notice",
      templateParams: { status: "ok" },
      dataClass: "internal",
    };
    const sandboxOrg = await seedOrganization(client, 1, { action: inApp, recipients: 1 });
    const massOrg = await seedOrganization(client, 2, {
      action: { kind: "sms", templateRef: "wf06.notice", dataClass: "internal" },
      recipients: THRESHOLD + 1,
    });
    const liveOrg = await seedOrganization(client, 3, { action: inApp, recipients: 1 });
    orgs.push(sandboxOrg.orgId, massOrg.orgId, liveOrg.orgId);

    const jwtSecret = fs.readFileSync(path.join(simDir, "load", ".jwt-secret"), "utf8").trim();
    const modules = await loadModules(vite, serviceRoleToken(jwtSecret));
    const providers = countingProviders();
    const sandboxEnv = {
      WORKFLOW_DELIVERY_MODE: "sandbox",
      WORKFLOWS_ENABLED: "true",
      APP_ENV: "staging",
    };
    const sandboxErrors = [];
    const sandbox = modules.createWorkflowActionRuntime(sandboxEnv, providers.dependencies);
    const sandboxRuntime = {
      executeAction: observed(sandbox.executeAction, sandboxErrors),
      actionOutcome: sandbox.actionOutcome,
    };

    // 1 + 2: event -> run -> action step, sandbox in-app delivery and a 26-recipient SMS.
    await emitEvent(client, sandboxOrg.orgId, 1);
    await emitEvent(client, massOrg.orgId, 2);
    const settled = await tickUntil(
      modules,
      sandboxRuntime,
      async () =>
        (await countOutbox(client, sandboxOrg.orgId)) >= 1 &&
        (await countDrafts(client, massOrg.orgId)) >= 1,
      "sandbox",
    );
    if (!settled) {
      throw new Error(`WF06 sandbox ticks did not settle: ${sandboxErrors.join(", ") || "none"}`);
    }
    const [sandboxStep] = await actionStep(client, sandboxOrg.orgId);
    const [massStep] = await actionStep(client, massOrg.orgId);

    // 3: live delivery outside production is refused by the real executor.
    const liveErrors = [];
    const live = modules.createWorkflowActionRuntime(
      { WORKFLOW_DELIVERY_MODE: "live", WORKFLOWS_ENABLED: "true", APP_ENV: "staging" },
      providers.dependencies,
    );
    await emitEvent(client, liveOrg.orgId, 3);
    await tickUntil(
      modules,
      {
        executeAction: observed(live.executeAction, liveErrors),
        actionOutcome: live.actionOutcome,
      },
      async () => liveErrors.length > 0,
      "live",
    );
    const refusedLive = liveErrors.includes("workflow_delivery_refused") ? 1 : 0;

    // 4: retries with the same idempotency key, straight through the production executor.
    const retryResults = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      retryResults.push(
        await sandbox.executeAction({
          orgId: sandboxOrg.orgId,
          step: claimedShape(sandboxStep),
          action: { ...inApp, recipientIds: sandboxOrg.memberIds },
          authorizedActions: ["workflow.action.in_app"],
        }),
        await sandbox.executeAction({
          orgId: massOrg.orgId,
          step: claimedShape(massStep),
          action: {
            kind: "sms",
            templateRef: "wf06.notice",
            dataClass: "internal",
            recipientIds: massOrg.memberIds,
          },
          authorizedActions: ["workflow.action.sms"],
        }),
      );
    }
    // Note 1: the replay lookup reports what the original dispatch produced.
    const replayOutcomes = {
      sandbox: await sandbox.actionOutcome({
        orgId: sandboxOrg.orgId,
        step: claimedShape(sandboxStep),
      }),
      mass: await sandbox.actionOutcome({ orgId: massOrg.orgId, step: claimedShape(massStep) }),
    };

    const ledgerSandbox = await countLedger(client, sandboxOrg.orgId);
    const ledgerSandboxExecute = await scalar(
      client,
      `SELECT count(*)::int AS n FROM public.cg_tool_call_ledger
        WHERE tenant_ref = $1 AND tool_id = 'workflow.action.in_app' AND kind = 'decision'
          AND verdict = 'execute' AND idempotency_key = $2`,
      [sandboxOrg.orgId, sandboxStep.idempotency_key],
    );
    const outboxSandbox = await countOutbox(client, sandboxOrg.orgId);
    const outboxRow = (
      await client.query(
        `SELECT o.category, o.data_class, cardinality(o.recipient_ids) AS recipients,
                o.broker_decision_id = l.id AS linked
           FROM public.wf_action_sandbox_outbox o
           JOIN public.cg_tool_call_ledger l ON l.id = o.broker_decision_id
          WHERE o.org_id = $1`,
        [sandboxOrg.orgId],
      )
    ).rows[0];
    const draftsMass = await countDrafts(client, massOrg.orgId);
    const draftRow = (
      await client.query(
        `SELECT category, status, cardinality(recipient_ids) AS recipients
           FROM public.wf_action_draft WHERE org_id = $1`,
        [massOrg.orgId],
      )
    ).rows[0];
    const outboxMass = await countOutbox(client, massOrg.orgId);
    const ledgerMass = await countLedger(client, massOrg.orgId);
    const ledgerLive = await countLedger(client, liveOrg.orgId);
    const outboxLive = await countOutbox(client, liveOrg.orgId);
    const draftsLive = await countDrafts(client, liveOrg.orgId);
    const runsPerEvent = await scalar(
      client,
      `SELECT coalesce(max(c), 0)::int AS n FROM (
         SELECT count(*) AS c FROM public.wf_run
          WHERE org_id = ANY($1::uuid[]) GROUP BY org_id, event_id) runs`,
      [orgs],
    );
    const followUp = async (orgId) =>
      scalar(
        client,
        "SELECT count(*)::int AS n FROM public.wf_step_run WHERE org_id = $1 AND step_key = 'record'",
        [orgId],
      );
    const followUpSandbox = await followUp(sandboxOrg.orgId);
    const followUpMass = await followUp(massOrg.orgId);
    const sentLive = providers.calls.adapters + providers.calls.http;
    const dup =
      Math.max(0, ledgerSandbox - 1) +
      Math.max(0, outboxSandbox - 1) +
      Math.max(0, draftsMass - 1) +
      Math.max(0, followUpSandbox - 1) +
      Math.max(0, runsPerEvent - 1);

    console.log(
      `WF06-E2E DETAIL: sandbox_step=${sandboxStep.status}/${sandboxStep.run_status} ` +
        `mass_step=${massStep.status}/${massStep.run_status} follow_up=${followUpSandbox}/${followUpMass} ` +
        `ledger_sandbox=${ledgerSandbox} ` +
        `ledger_mass=${ledgerMass} outbox_mass=${outboxMass} ledger_live=${ledgerLive} ` +
        `outbox_live=${outboxLive} drafts_live=${draftsLive} retries=${retryResults
          .map((r) => r.status)
          .join(",")} replay=${replayOutcomes.sandbox}/${replayOutcomes.mass} ` +
        `adapter_calls=${providers.calls.adapters} http_calls=${providers.calls.http} ` +
        `live_errors=${liveErrors.join("|") || "none"}`,
    );
    console.log(
      `WF06-E2E RESULT: in_app_sandbox=${outboxSandbox} drafts=${draftsMass} refused_live=${refusedLive} sent_live=${sentLive} dup=${dup}`,
    );
    const failures = [];
    if (outboxSandbox !== 1) failures.push("sandbox in-app outbox row count is not 1");
    if (ledgerSandbox !== 1 || ledgerSandboxExecute !== 1)
      failures.push("sandbox in-app did not write exactly one execute decision");
    if (
      outboxRow?.category !== "communication" ||
      outboxRow.data_class !== "internal" ||
      !outboxRow.linked
    )
      failures.push("sandbox outbox row is not linked to its decision with category/data class");
    if (sandboxStep.status !== "succeeded" || followUpSandbox !== 1)
      failures.push("sandbox run did not continue after the executed action");
    if (followUpMass !== 0) failures.push("drafted mass SMS run continued as if it executed");
    if (draftsMass !== 1 || draftRow?.category !== "mass_message" || draftRow.status !== "draft")
      failures.push("26-recipient SMS did not produce exactly one capped draft");
    if (draftRow?.recipients !== THRESHOLD + 1) failures.push("draft lost recipients");
    if (outboxMass !== 0 || ledgerMass !== 0)
      failures.push("26-recipient SMS reached the outbox or the broker ledger");
    if (massStep.status !== "waiting") failures.push("mass SMS step is not waiting for review");
    if (refusedLive !== 1) failures.push("live delivery outside production was not refused");
    if (ledgerLive !== 0 || outboxLive !== 0 || draftsLive !== 0)
      failures.push("refused live delivery left a ledger, outbox or draft row");
    if (replayOutcomes.sandbox !== "executed" || replayOutcomes.mass !== "draft")
      failures.push("replay outcome lookup did not report the original dispatch");
    if (retryResults.some((r, i) => r.status !== (i % 2 === 0 ? "executed" : "draft")))
      failures.push("retry returned a different outcome");
    if (sandboxErrors.length) failures.push(`sandbox executor errors: ${sandboxErrors.join(",")}`);
    if (sentLive !== 0) failures.push("a provider adapter or HTTP call was made");
    if (dup !== 0) failures.push("duplicates were created");
    if (failures.length) throw new Error(failures.join("; "));
  } finally {
    globalThis.fetch = originalFetch;
    try {
      if (client._connected && orgs.length) {
        await client.query(
          "UPDATE public.wf_org_settings SET workflows_enabled = false WHERE org_id = ANY($1::uuid[])",
          [orgs],
        );
      }
    } finally {
      if (client._connected) await client.end();
      await vite.close();
    }
  }
}

main().catch((error) => {
  console.error("WF06 local action E2E failed:", error.message);
  process.exitCode = 1;
});
