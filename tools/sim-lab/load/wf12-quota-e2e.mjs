// WF-12 quotas, wallet caps and retention E2E against the local sim-lab Postgres + PostgREST (never a hosted database).
//
// Drives the real thing end to end with no browser. Workflow ticks through the production action
// executor; the production limits and retention operations (limits.server.ts) change limits, run dry
// runs and purge through the real SECURITY DEFINER functions. Scenarios:
//   A  hourly action quota: with a limit of 2, four in-app events produce exactly two executed records and the
//      other two steps are refused by the quota (never a third record, never a broker row);
//   B  daily run quota: with a limit of 2, four events produce two runs, the rest wait unclaimed (no attempt
//      used up); raising the limit lets them through exactly once;
//   C  wallet: an SMS action is refused by the pre-check (no price decided, caps at zero), and a cap above
//      the ceiling is refused;
//   D  retention: aged rows are counted by a dry run (nothing deleted), a purge without a dry run is refused,
//      the purge removes exactly what the dry run counted, and a run waiting on a pending approval keeps
//      everything it needs;
//   E  refusals: a viewer cannot change limits or purge, values outside the safe bounds are refused.
//
// The only stubs are the outbound provider adapters / HTTP port, which count their calls.
// `sent_live` is computed from those counters and `dup` from SQL. Nothing here reaches a network.
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
const MASS = 26; // one more than the mass-message threshold: a capped, two-person, high-risk draft.
const SMALL = 3; // an ordinary in-app message: not capped, runs in the sandbox without a draft.
const ORIGIN = "https://app.local.test";

const id = (prefix, n) => `${prefix}-0000-4000-8000-${runTag}${String(n).padStart(4, "0")}`;

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
    throw new Error("WF12 refuses a non-loopback Postgres host");
  }
  if (!fs.existsSync(path.join(simDir, "load", ".jwt-secret"))) {
    throw new Error("WF12 local sim JWT secret is missing; start tools/sim-lab first");
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

/**
 * A stand-in for the WebAuthn service. `assertionOptions` records the challenge the production code
 * issued. `sign` builds the "browser's" response for a chosen challenge; `verifyAssertion` then does
 * what the real service does at this boundary: read the signed challenge out of the client data and
 * ask `challengeAccepted`, refusing (like the real one) when it is not the one issued for the action.
 */
function stubAuthenticator() {
  const state = { issued: [], verified: 0, refused: 0 };
  return {
    state,
    service: {
      async assertionOptions(input) {
        state.issued.push(input);
        return { challenge: input.challenge, rpId: "app.local.test", allowCredentials: [] };
      },
      async verifyAssertion(input) {
        const clientData = JSON.parse(
          Buffer.from(input.response.response.clientDataJSON, "base64url").toString("utf8"),
        );
        if (!input.challengeAccepted(clientData.challenge)) {
          state.refused += 1;
          throw Object.assign(new Error("Passkey sign-in did not succeed."), {
            code: "auth_failed",
          });
        }
        state.verified += 1;
        return { credentialRowId: "stub-credential", verifiedAtMs: 0 };
      },
    },
    /** The response a browser would send after signing `challenge`. */
    sign(challenge) {
      const pad = (value) => Buffer.from(value).toString("base64url");
      return {
        id: pad("stub-credential-id-0001"),
        rawId: pad("stub-credential-id-0001"),
        type: "public-key",
        response: {
          clientDataJSON: pad(JSON.stringify({ type: "webauthn.get", challenge })),
          authenticatorData: pad("stub-authenticator-data"),
          signature: pad("stub-signature-bytes"),
        },
      };
    },
  };
}

const rolePack = (code, role) => ({
  schema: "sherivs.role-pack.v1",
  code,
  version: "1.0.0",
  title: "WF12 e2e workflow agent",
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
  ],
  playbooks: [],
  memory: { domains: ["work"], maxSensitivity: "internal", retentionDays: 90, crossTenant: false },
  budget: { dailyActions: 50, dailyModelCalls: 0, dailyCostCapMinor: 0 },
  escalation: { defaultApprover: "role_owner", t3Approver: "sheriff" },
  startsInShadow: true,
});

/**
 * One synthetic organization: workflow settings, an agent with earned autonomy, a published
 * workflow whose single action is an in-app message to RECIPIENTS members (a capped, one-approver
 * draft), an active twin context for the agent, a tenant connector binding, and people: an approver,
 * the workflow's author and publisher, an owner who may run workflows, and a viewer who may only read.
 * `templateRef` is the message template the action asks for; `withTemplate` decides whether it exists.
 */
async function seedOrganization(client, n, { templateRef, withTemplate, recipients }) {
  const orgId = id("f1280000", n);
  const agentRef = `wf12-e2e-agent-${runTag}-${n}`;
  const agentIdentity = id("f1281000", n);
  const role = `wf12-e2e-agent-${runTag}-${n}`;
  const packCode = `wf12-e2e-${runTag}-${n}`;
  const templateId = id("f1282000", n);
  const definitionId = id("f1283000", n);
  const versionId = id("f1284000", n);
  const memberIds = Array.from({ length: recipients }, (_, index) =>
    id(`f128${String(5000 + n).padStart(4, "0")}`, index + 1),
  );
  const people = {
    ap1: id("f1287000", n * 10 + 1),
    ap2: id("f1287000", n * 10 + 2),
    author: id("f1287000", n * 10 + 3),
    publisher: id("f1287000", n * 10 + 4),
    owner: id("f1287000", n * 10 + 5),
    viewer: id("f1287000", n * 10 + 6),
  };
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
        authorizedActions: ["workflow.action.in_app"],
        action: {
          kind: "in_app",
          templateRef,
          templateParams: { status: "ok" },
          dataClass: "internal",
          recipientIds: memberIds,
        },
      },
      { stepId: "record", kind: "task", assignment: { kind: "unassigned" }, authorizedActions: [] },
    ],
    onFailure: { kind: "halt" },
    requiredApprovals: [],
  };
  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO public.schools (id, name, slug) VALUES ($1, $2, $3)", [
      orgId,
      `WF12 e2e org ${n}`,
      `wf12-e2e-${runTag}-${n}`,
    ]);
    await client.query(
      `INSERT INTO public.wf_org_settings (org_id, workflows_enabled, autonomy_ceiling)
       VALUES ($1, true, 'act_and_report')`,
      [orgId],
    );
    // AIN-02: the earned level changes only through the promotion gate. This fixture seeds a level directly, as the
    // database owner, with the gate switched off for this one statement and back on straight after.
    await client.query(
      "ALTER TABLE public.wf_agent_autonomy DISABLE TRIGGER wf_agent_autonomy_05_gate",
    );
    await client.query(
      `INSERT INTO public.wf_agent_autonomy (org_id, agent_ref, earned_level)
       VALUES ($1, $2, 'act_and_report')`,
      [orgId, agentRef],
    );
    await client.query(
      "ALTER TABLE public.wf_agent_autonomy ENABLE TRIGGER wf_agent_autonomy_05_gate",
    );
    // AIN-01: an agent step needs a registered identity. A throwaway platform agent, granted to this org only.
    await client.query(
      `INSERT INTO public.agent_pause_rules (agent_code, tier, kill_scope) VALUES ($1, 'department', 'agent')`,
      [agentRef],
    );
    await client.query(
      `INSERT INTO public.wf_agent (agent_ref, family, codename, agent_tier, accountable, supervisor, pack_version,
         max_tier, context_ceiling, daily_actions, daily_model_calls, daily_cost_cap_minor)
       VALUES ($1, 'platform', 'Fixture', 'department', 'fixture', 'jarvis-executive', '1.0.0', 'T3', 'internal', 100000, 0, 0)`,
      [agentRef],
    );
    await client.query(
      `INSERT INTO public.wf_agent_platform_grant (org_id, agent_ref) VALUES ($1, $2)`,
      [orgId, agentRef],
    );
    await client.query(
      `INSERT INTO public.wf_template
         (id, template_key, version, name, description, graph, agent_ref, autonomy_max)
       VALUES ($1, $2, 1, 'WF12 e2e template', 'Local WF12 run history fixture.', $3::jsonb, $4,
         'act_and_report')`,
      [templateId, `wf12-e2e-${runTag}-${n}`, JSON.stringify(graph), agentRef],
    );
    await client.query(
      "INSERT INTO public.wf_definition (id, org_id, key, name) VALUES ($1, $2, $3, 'WF12 e2e workflow')",
      [definitionId, orgId, `wf12-e2e-${runTag}-${n}`],
    );
    await client.query(
      `INSERT INTO public.wf_version (id, org_id, definition_id, version, graph, created_by, updated_by)
       VALUES ($1, $2, $3, 1, $4::jsonb, $5, $5)`,
      [versionId, orgId, definitionId, JSON.stringify(graph), people.author],
    );
    await client.query(
      "UPDATE public.wf_version SET state = 'published', published_by = $1 WHERE id = $2",
      [people.publisher, versionId],
    );
    await client.query("UPDATE public.wf_definition SET current_version_id = $1 WHERE id = $2", [
      versionId,
      definitionId,
    ]);
    await client.query(
      `INSERT INTO public.wf_trigger_binding (id, org_id, definition_id, kind, event_type, enabled)
       VALUES ($1, $2, $3, 'event', $4, true)`,
      [id("f1288000", n), orgId, definitionId, EVENT_TYPE],
    );

    await client.query("INSERT INTO auth.users (id) VALUES ($1)", [agentIdentity]);
    await client.query(
      `INSERT INTO public.cg_role_pack (code, version, kind, applies_to, status, definition)
       VALUES ($1, '1.0.0', 'tenant_role', ARRAY[$2], 'published', $3::jsonb)`,
      [packCode, role, JSON.stringify(rolePack(packCode, role))],
    );
    const ensured = await client.query(
      `SELECT public.cg_twin_ensure_context($1, 'tenant_membership', $2, $3, $4, true) AS r`,
      [agentIdentity, orgId, role, `wf12-e2e-${runTag}-${n}`],
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
    await client.query(
      `INSERT INTO public.cg_connector_binding (connector, scope, tenant_ref, secret_ref)
       VALUES ('in-app', 'tenant', $1, $2)`,
      [orgId, `vault://in-app/wf12-e2e-${runTag}-${n}#v1`],
    );
    if (withTemplate) {
      await client.query(
        `INSERT INTO public.wf_action_template (org_id, kind, template_ref, body_template, parameter_keys, status)
         VALUES ($1, 'in_app', $2, 'Status: {{status}}', ARRAY['status'], 'approved')`,
        [orgId, templateRef],
      );
    }
    for (const memberId of memberIds) {
      await client.query("INSERT INTO auth.users (id) VALUES ($1)", [memberId]);
    }
    for (const [name, userId] of Object.entries(people)) {
      await client.query("INSERT INTO auth.users (id) VALUES ($1)", [userId]);
      await client.query(
        `INSERT INTO public.users (id, school_id, full_name, email, role, is_active)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [
          userId,
          orgId,
          `WF12 e2e ${name}`,
          `${name}-${n}-${runTag}@wf12-e2e.invalid`,
          name === "owner" ? "admin" : "teacher",
        ],
      );
    }
    // Role assignments are written as the signed-in publisher would write them. The owner holds the
    // head-of-institution template (workflow run and manage), the approver and viewer hold auditor
    // (workflow view and approve only), so the viewer can read but not cancel or retry.
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [people.publisher]);
    await client.query("SELECT set_config('request.jwt.claim.role', 'authenticated', true)");
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: people.publisher, role: "authenticated" }),
    ]);
    await client.query(
      `INSERT INTO public.user_role_assignments (org_id, user_id, role_code, scope_type, scope_ref, assigned_by)
       SELECT $1, u.user_id, r.code, t.default_scope, NULL, $2
         FROM (VALUES ($3::uuid, 'head_of_institution'), ($4::uuid, 'auditor'),
                      ($5::uuid, 'auditor'), ($6::uuid, 'auditor')) u(user_id, template_code)
         JOIN public.role_catalog r ON r.template_code = u.template_code AND r.org_id IS NULL
          AND NOT coalesce(r.requires_verified_authority_link, false)
         JOIN public.role_templates t ON t.code = r.template_code
        WHERE r.code = (
          SELECT min(r2.code) FROM public.role_catalog r2
           WHERE r2.template_code = u.template_code AND r2.org_id IS NULL
             AND NOT coalesce(r2.requires_verified_authority_link, false))`,
      [orgId, people.publisher, people.owner, people.ap1, people.ap2, people.viewer],
    );
    await client.query("SELECT set_config('request.jwt.claim.sub', '', true)");
    await client.query("SELECT set_config('request.jwt.claims', '', true)");
    await client.query("SELECT set_config('request.jwt.claim.role', '', true)");
    // SHERIVS-006 refuses direct membership writes from non-service roles. The e2e seeds fixtures
    // as the superuser, so skip triggers for this insert only (as sim gen.mjs and WF-06 do).
    await client.query("SET LOCAL session_replication_role = replica");
    for (const memberId of memberIds) {
      await client.query(
        `INSERT INTO public.organization_memberships (user_id, school_id, role, is_active)
         VALUES ($1, $2, 'parent', true)`,
        [memberId, orgId],
      );
    }
    await client.query("SET LOCAL session_replication_role = origin");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return { orgId, memberIds, people, n, templateRef };
}

async function emitEvent(client, orgId, n, seq = 0) {
  await client.query(
    `INSERT INTO public.wf_event (org_id, event_type, source, dedupe_key, payload)
     VALUES ($1, $2, 'wf12-e2e', $3, '{}'::jsonb)`,
    [orgId, EVENT_TYPE, `wf12-e2e:${runTag}:${n}:${seq}`],
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
      throw new Error("WF12 blocked a non-local or non-PostgREST request");
    }
    url.pathname = url.pathname.replace(/^\/rest\/v1/, "") || "/";
    return localFetch(new Request(url, request));
  };
  const load = (p) => vite.ssrLoadModule(`/frontend/src/${p}`);
  const runtime = await load("lib/workflow/workflow-runtime.ts");
  const serverRuntime = await load("lib/workflow/workflow-runtime.server.ts");
  const actionRuntime = await load("lib/workflow/workflow-action-runtime.server.ts");
  const inbox = await load("lib/workflow/approval-inbox.server.ts");
  const stepUp = await load("lib/workflow/approval-step-up.ts");
  const limits = await load("lib/workflow/limits.server.ts");
  const client = await load("integrations/supabase/client.server.ts");
  return {
    runWorkflowTick: runtime.runWorkflowTick,
    createPort: serverRuntime.createWorkflowRuntimePort,
    createWorkflowActionRuntime: actionRuntime.createWorkflowActionRuntime,
    createWorkflowApprovalSweepRuntime: actionRuntime.createWorkflowApprovalSweepRuntime,
    inbox,
    stepUp,
    limits,
    createActionPorts: actionRuntime.createWorkflowActionPorts,
    admin: client.supabaseAdmin,
  };
}

async function tickUntil(modules, actionRuntime, done, label, client, orgs) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    // A failed step backs off before its next attempt; the e2e does not wait for the clock.
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(
      `UPDATE public.wf_step_run SET resume_at = now() - interval '1 second'
        WHERE org_id = ANY($1::uuid[]) AND status = 'pending' AND resume_at IS NOT NULL`,
      [orgs],
    );
    await client.query("COMMIT");
    await modules.runWorkflowTick(modules.createPort(), {
      worker: `wf12-${runTag}-${label}`,
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

const rowOf = async (client, sql, params) => (await client.query(sql, params)).rows[0];

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
      throw new Error("WF12 requires a loopback disposable Postgres superuser");
    }
    const ready = await client.query(
      `SELECT to_regprocedure('public.wf_limits_update(uuid,jsonb)') IS NOT NULL
              AND to_regprocedure('public.wf_retention_run_manual(uuid,boolean,uuid)') IS NOT NULL AS ready`,
    );
    if (!ready.rows[0].ready) throw new Error("WF12 migrations are not applied");

    const orgA = await seedOrganization(client, 1, {
      templateRef: "wf12.notice",
      withTemplate: true,
      recipients: SMALL,
    }); // hourly action quota
    const orgB = await seedOrganization(client, 2, {
      templateRef: "wf12.notice",
      withTemplate: true,
      recipients: SMALL,
    }); // daily run quota, then retention
    const orgC = await seedOrganization(client, 3, {
      templateRef: "wf12.notice",
      withTemplate: true,
      recipients: MASS,
    }); // a draft waiting on a pending approval
    orgs.push(orgA.orgId, orgB.orgId, orgC.orgId);

    const jwtSecret = fs.readFileSync(path.join(simDir, "load", ".jwt-secret"), "utf8").trim();
    const modules = await loadModules(vite, serviceRoleToken(jwtSecret));
    const providers = countingProviders();
    const sandboxEnv = {
      WORKFLOW_DELIVERY_MODE: "sandbox",
      WORKFLOWS_ENABLED: "true",
      APP_ENV: "staging",
    };
    const actionRuntime = modules.createWorkflowActionRuntime(sandboxEnv, providers.dependencies);
    const actionPorts = modules.createActionPorts(sandboxEnv, providers.dependencies);
    // The application maps every database error to a safe code, which hides the cause when a check fails here. This
    // local-only wrapper prints the underlying code and message (never arguments) so a failing run can be diagnosed.
    const ports = {
      rpc: async (fn, args) => {
        const result = await modules.admin.rpc(fn, args);
        if (result?.error && !/wf12:/.test(String(result.error.message ?? ""))) {
          console.error(
            `WF12-E2E rpc ${fn} failed: ${result.error.code ?? "no-code"} ${String(result.error.message ?? "").slice(0, 200)}`,
          );
        }
        return result;
      },
    };
    const refusals = [];
    const expectRefusal = async (label, expected, run) => {
      try {
        await run();
      } catch (error) {
        if (error?.code === expected) {
          refusals.push(label);
          return;
        }
        throw new Error(
          `WF12 ${label}: expected ${expected}, got ${error?.code ?? error?.message}`,
        );
      }
      throw new Error(`WF12 ${label}: expected a refusal (${expected}) but the call succeeded`);
    };
    const count = (sql, params) => scalar(client, sql, params);
    const outboxCount = (org) =>
      count("SELECT count(*)::int AS n FROM public.wf_action_sandbox_outbox WHERE org_id = $1", [
        org.orgId,
      ]);
    const runCount = (org) =>
      count("SELECT count(*)::int AS n FROM public.wf_run WHERE org_id = $1", [org.orgId]);
    const ledgerCount = (org) =>
      count(
        `SELECT count(*)::int AS n FROM public.cg_tool_call_ledger
          WHERE tenant_ref = $1 AND tool_id LIKE 'workflow.action.%'`,
        [org.orgId],
      );
    const denials = (org, limit) =>
      count(
        `SELECT coalesce(sum(denied), 0)::int AS n FROM public.wf_quota_denial
          WHERE org_id = $1 AND limit_name = $2`,
        [org.orgId, limit],
      );
    const audit = (action) =>
      count(
        "SELECT count(*)::int AS n FROM public.audit_chain WHERE action = $1 AND org_id = ANY($2::uuid[])",
        [action, orgs],
      );
    const tick = (label) =>
      tickUntil(modules, actionRuntime, async () => false, label, client, orgs);

    // --- E (part): who may read and change limits ------------------------------------------------
    const ownerView = await modules.limits.getLimits(ports, { actorId: orgA.people.owner });
    const viewerView = await modules.limits.getLimits(ports, { actorId: orgA.people.viewer });
    if (!ownerView.can_manage || viewerView.can_manage || ownerView.configured) {
      throw new Error("WF12 the settings read did not report who may manage, or defaults");
    }
    if (ownerView.limits.runs_per_day !== 500 || ownerView.limits.wallet_cap_kobo_per_day !== 0) {
      throw new Error("WF12 platform defaults are not what ADR-124 says");
    }
    await expectRefusal("viewer changes a limit", "not_authorized", () =>
      modules.limits.updateLimits(ports, {
        actorId: orgA.people.viewer,
        patch: { runs_per_day: 5 },
      }),
    );
    await expectRefusal("a window below its safe minimum", "invalid_limit", () =>
      modules.limits.updateLimits(ports, {
        actorId: orgA.people.owner,
        patch: { retention_run_days: 30 },
      }),
    );
    await expectRefusal("a limit above its bound", "invalid_limit", () =>
      modules.limits.updateLimits(ports, {
        actorId: orgA.people.owner,
        patch: { runs_per_day: 1_000_000 },
      }),
    );
    await expectRefusal("a spend cap above the ceiling (zero)", "invalid_limit", () =>
      modules.limits.updateLimits(ports, {
        actorId: orgA.people.owner,
        patch: { wallet_cap_kobo_per_day: 100 },
      }),
    );
    await expectRefusal("an unknown key", "invalid_limit", () =>
      modules.limits.updateLimits(ports, {
        actorId: orgA.people.owner,
        patch: { org_id: orgB.orgId },
      }),
    );
    await expectRefusal("viewer runs a dry run", "not_authorized", () =>
      modules.limits.runRetention(ports, {
        actorId: orgA.people.viewer,
        dryRun: true,
        dryRunId: null,
      }),
    );

    // --- A: hourly action quota -------------------------------------------------------------------
    await modules.limits.updateLimits(ports, {
      actorId: orgA.people.owner,
      patch: { actions_per_hour: { in_app: 2 } },
    });
    for (let seq = 1; seq <= 4; seq += 1) await emitEvent(client, orgA.orgId, 1, seq);
    await tick("a-1");
    await tick("a-2");
    const outboxA = await outboxCount(orgA);
    const ledgerA = await ledgerCount(orgA);
    const deniedA = await denials(orgA, "actions_per_hour");
    const runsA = await runCount(orgA);

    // --- B: daily run quota -------------------------------------------------------------------------
    await modules.limits.updateLimits(ports, {
      actorId: orgB.people.owner,
      patch: { runs_per_day: 2 },
    });
    for (let seq = 1; seq <= 4; seq += 1) await emitEvent(client, orgB.orgId, 2, seq);
    await tick("b-1");
    await tick("b-2");
    const runsB1 = await runCount(orgB);
    const waiting = await rowOf(
      client,
      `SELECT count(*)::int AS n, coalesce(max(attempts), 0)::int AS attempts
         FROM public.wf_event WHERE org_id = $1 AND status = 'pending'`,
      [orgB.orgId],
    );
    const deniedB = await denials(orgB, "runs_per_day");
    await modules.limits.updateLimits(ports, {
      actorId: orgB.people.owner,
      patch: { runs_per_day: 4 },
    });
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(
      "UPDATE public.wf_event SET next_attempt_at = now() - interval '1 second' WHERE org_id = $1 AND status = 'pending'",
      [orgB.orgId],
    );
    await client.query("COMMIT");
    await tickUntil(
      modules,
      actionRuntime,
      async () => (await runCount(orgB)) >= 4,
      "b-3",
      client,
      orgs,
    );
    await tick("b-4");
    const runsB2 = await runCount(orgB);
    const outboxB = await outboxCount(orgB);
    const duplicateRuns = await count(
      `SELECT count(*)::int AS n FROM (
         SELECT idempotency_key FROM public.wf_run WHERE org_id = $1 GROUP BY 1 HAVING count(*) > 1) d`,
      [orgB.orgId],
    );

    // --- C: wallet caps ---------------------------------------------------------------------------------
    const smsExecute = await actionPorts.quotaCheck({
      orgId: orgA.orgId,
      runId: (
        await rowOf(client, "SELECT id FROM public.wf_run WHERE org_id = $1 LIMIT 1", [orgA.orgId])
      ).id,
      kind: "sms",
      recipientCount: 1,
      mode: "execute",
    });
    const unknownKind = await actionPorts.quotaCheck({
      orgId: orgA.orgId,
      runId: "00000000-0000-4000-8000-000000000000",
      kind: "carrier_pigeon",
      recipientCount: 1,
      mode: "draft",
    });
    const walletBefore = await rowOf(
      client,
      "SELECT count(*)::int AS n FROM public.school_wallets WHERE school_id = $1",
      [orgA.orgId],
    );
    if (smsExecute.allowed || unknownKind.allowed) {
      throw new Error("WF12 the pre-check allowed an SMS (no price decided) or an unknown kind");
    }

    // --- D: retention -------------------------------------------------------------------------------------
    // Org C: a draft that waits for approval, with everything about it aged far past every window.
    await emitEvent(client, orgC.orgId, 3, 1);
    await tickUntil(
      modules,
      actionRuntime,
      async () =>
        (await count(
          `SELECT count(*)::int AS n FROM public.wf_action_draft d
             JOIN public.wf_approval a ON a.id = d.approval_id AND a.status = 'pending'
            WHERE d.org_id = $1`,
          [orgC.orgId],
        )) >= 1,
      "c-draft",
      client,
      orgs,
    );
    const pendingC = await count(
      `SELECT count(*)::int AS n FROM public.wf_approval WHERE org_id = $1 AND status = 'pending'`,
      [orgC.orgId],
    );
    const age = async (orgId, days) => {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      const d = `${days} days`;
      try {
        for (const sql of [
          `UPDATE public.wf_run SET created_at = created_at - $2::interval, started_at = started_at - $2::interval,
                finished_at = finished_at - $2::interval WHERE org_id = $1`,
          `UPDATE public.wf_run_event SET at = at - $2::interval WHERE org_id = $1`,
          `UPDATE public.wf_action_sandbox_outbox SET created_at = created_at - $2::interval WHERE org_id = $1`,
          `UPDATE public.wf_action_draft SET created_at = created_at - $2::interval, updated_at = updated_at - $2::interval WHERE org_id = $1`,
          `UPDATE public.wf_approval SET requested_at = requested_at - $2::interval, expires_at = expires_at - $2::interval WHERE org_id = $1`,
          `UPDATE public.wf_event SET occurred_at = occurred_at - $2::interval, created_at = created_at - $2::interval WHERE org_id = $1`,
        ]) {
          await client.query(sql, [orgId, d]);
        }
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      await client.query("COMMIT");
    };
    // The fixture's follow-up step is an unassigned task, which waits for a person. Org B's runs are
    // finished by hand (triggers skipped, fixture only) so there is something finished to age and purge.
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(
      "UPDATE public.wf_step_run SET status = 'succeeded' WHERE org_id = $1 AND status NOT IN ('succeeded', 'dead', 'failed', 'cancelled', 'skipped')",
      [orgB.orgId],
    );
    await client.query(
      "UPDATE public.wf_run SET status = 'succeeded', finished_at = now() WHERE org_id = $1",
      [orgB.orgId],
    );
    await client.query("COMMIT");
    await age(orgB.orgId, 800);
    await age(orgC.orgId, 800);

    const snapshot = async (org) => ({
      runs: await runCount(org),
      outbox: await outboxCount(org),
      events: await count("SELECT count(*)::int AS n FROM public.wf_run_event WHERE org_id = $1", [
        org.orgId,
      ]),
      drafts: await count(
        "SELECT count(*)::int AS n FROM public.wf_action_draft WHERE org_id = $1",
        [org.orgId],
      ),
      approvals: await count(
        "SELECT count(*)::int AS n FROM public.wf_approval WHERE org_id = $1",
        [org.orgId],
      ),
    });
    const beforeB = await snapshot(orgB);
    const beforeC = await snapshot(orgC);
    const auditChainBefore = await count(
      "SELECT count(*)::int AS n FROM public.audit_chain WHERE org_id = ANY($1::uuid[]) AND action NOT LIKE 'workflow.retention.%'",
      [orgs],
    );
    const ledgerBeforeB = await ledgerCount(orgB);

    await expectRefusal("a purge with no dry run", "dry_run_required", () =>
      modules.limits.runRetention(ports, {
        actorId: orgB.people.owner,
        dryRun: false,
        dryRunId: null,
      }),
    );
    const dryB = await modules.limits.runRetention(ports, {
      actorId: orgB.people.owner,
      dryRun: true,
      dryRunId: null,
    });
    const afterDryB = await snapshot(orgB);
    await expectRefusal(
      "a purge naming another organisation's dry run",
      "dry_run_required",
      async () => {
        const dryC0 = await modules.limits.runRetention(ports, {
          actorId: orgC.people.owner,
          dryRun: true,
          dryRunId: null,
        });
        return modules.limits.runRetention(ports, {
          actorId: orgB.people.owner,
          dryRun: false,
          dryRunId: dryC0.run_id,
        });
      },
    );
    const purgeB = await modules.limits.runRetention(ports, {
      actorId: orgB.people.owner,
      dryRun: false,
      dryRunId: dryB.run_id,
    });
    const afterPurgeB = await snapshot(orgB);

    const dryC = await modules.limits.runRetention(ports, {
      actorId: orgC.people.owner,
      dryRun: true,
      dryRunId: null,
    });
    const purgeC = await modules.limits.runRetention(ports, {
      actorId: orgC.people.owner,
      dryRun: false,
      dryRunId: dryC.run_id,
    });
    const afterPurgeC = await snapshot(orgC);
    const pendingAfterC = await count(
      `SELECT count(*)::int AS n FROM public.wf_approval WHERE org_id = $1 AND status = 'pending'`,
      [orgC.orgId],
    );
    const auditChainAfter = await count(
      "SELECT count(*)::int AS n FROM public.audit_chain WHERE org_id = ANY($1::uuid[]) AND action NOT LIKE 'workflow.retention.%'",
      [orgs],
    );
    const ledgerAfterB = await ledgerCount(orgB);
    const retentionAudit = {
      dry: await audit("workflow.retention.dry_run"),
      purge: await audit("workflow.retention.purge"),
      limits: await audit("workflow.wf_org_limits.changed"),
    };
    const walletAfter = await rowOf(
      client,
      "SELECT count(*)::int AS n FROM public.school_wallets WHERE school_id = $1",
      [orgA.orgId],
    );

    const sentLive = providers.calls.adapters + providers.calls.http;
    const dup =
      duplicateRuns +
      (await count(
        `SELECT count(*)::int AS n FROM (SELECT idempotency_key FROM public.wf_action_sandbox_outbox
          WHERE org_id = ANY($1::uuid[]) GROUP BY org_id, idempotency_key HAVING count(*) > 1) d`,
        [orgs],
      )) +
      Math.max(0, runsB2 - 4);

    console.log(
      `WF12-E2E DETAIL: a_outbox=${outboxA} a_ledger=${ledgerA} a_denied=${deniedA} a_runs=${runsA} ` +
        `b_runs=${runsB1}->${runsB2} b_waiting=${waiting.n}/attempts:${waiting.attempts} b_denied=${deniedB} b_outbox=${outboxB} ` +
        `sms_execute=${smsExecute.allowed}/${smsExecute.code} unknown_kind=${unknownKind.allowed}/${unknownKind.code} ` +
        `wallet_rows=${walletBefore.n}->${walletAfter.n} ` +
        `b_dry=${JSON.stringify(dryB.counts)} b_purge=${JSON.stringify(purgeB.counts)} ` +
        `c_pending=${pendingC}->${pendingAfterC} c_purge=${JSON.stringify(purgeC.counts)} ` +
        `audit=dry:${retentionAudit.dry},purge:${retentionAudit.purge},limits:${retentionAudit.limits} ` +
        `adapter_calls=${providers.calls.adapters} http_calls=${providers.calls.http}`,
    );
    console.log(
      `WF12-E2E RESULT: hourly_executed=${outboxA} daily_runs=${runsB1}->${runsB2} ` +
        `purged_runs=${purgeB.counts.runs} kept_pending_approvals=${pendingAfterC} refusals=${refusals.length} ` +
        `sent_live=${sentLive} dup=${dup}`,
    );

    const failures = [];
    if (outboxA !== 2 || ledgerA !== 2)
      failures.push(
        `the hourly quota of 2 let ${outboxA} records / ${ledgerA} broker rows through`,
      );
    if (deniedA < 1) failures.push("the hourly refusals were not counted");
    if (runsA !== 4) failures.push("the other events did not each produce one run");
    if (runsB1 !== 2) failures.push(`the daily quota of 2 allowed ${runsB1} runs`);
    if (waiting.n !== 2 || waiting.attempts !== 0)
      failures.push("deferred events were not left pending with their attempts intact");
    if (deniedB < 1) failures.push("the daily refusals were not counted");
    if (runsB2 !== 4 || outboxB !== 4)
      failures.push("raising the limit did not release exactly the two waiting events");
    if (smsExecute.code !== "spend_rate_unknown" && smsExecute.code !== "actions_per_hour")
      failures.push(`SMS was refused for an unexpected reason: ${smsExecute.code}`);
    if (walletBefore.n !== walletAfter.n) failures.push("a wallet row appeared or disappeared");
    if (pendingC !== 1) failures.push("the fixture did not produce one pending approval");
    if (JSON.stringify(afterDryB) !== JSON.stringify(beforeB))
      failures.push("a dry run deleted something");
    if (dryB.counts.runs !== 4 || dryB.counts.outbox !== 4)
      failures.push(
        `the dry run counted ${JSON.stringify(dryB.counts)}, expected 4 runs and 4 records`,
      );
    if (JSON.stringify(dryB.counts) !== JSON.stringify(purgeB.counts))
      failures.push("the purge did not delete exactly what the dry run counted");
    if (
      afterPurgeB.runs !== beforeB.runs - purgeB.counts.runs ||
      afterPurgeB.outbox !== beforeB.outbox - purgeB.counts.outbox
    )
      failures.push("the tables do not match the purge counts");
    if (afterPurgeB.runs !== 0) failures.push("aged finished runs were not removed");
    if (
      pendingAfterC !== 1 ||
      afterPurgeC.runs !== beforeC.runs ||
      afterPurgeC.drafts !== beforeC.drafts ||
      afterPurgeC.approvals !== beforeC.approvals
    )
      failures.push("a purge removed something a pending approval depends on");
    if (auditChainAfter < auditChainBefore || ledgerAfterB !== ledgerBeforeB)
      failures.push("the audit chain or the broker ledger lost rows");
    if (retentionAudit.dry < 3 || retentionAudit.purge !== 2)
      failures.push("retention runs are not audited as dry run / purge");
    if (retentionAudit.limits < 3) failures.push("limit changes are not audited");
    if (refusals.length < 8) failures.push(`expected at least 8 refusals, saw ${refusals.length}`);
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
  console.error("WF12 local quota and retention E2E failed:", error.message);
  process.exitCode = 1;
});
