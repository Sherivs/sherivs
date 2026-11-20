// WF-08 run history, retry and cancel E2E against the local sim-lab Postgres + PostgREST (never a hosted database).
//
// Drives the real thing end to end with no browser. Workflow ticks through the production action
// executor create drafts and failures; the production run-history operations (run-history.server.ts)
// list, view, cancel and retry through the real SECURITY DEFINER functions; the production approval
// inbox decides the retried run's draft; the production approval sweep dispatches it to the sandbox
// outbox. Scenarios:
//   A  an approved draft whose run is cancelled before dispatch is never dispatched;
//   B  a run that fails (its template is missing), is fixed upstream, and is retried: the retry is a
//      NEW run that resumes at the dead step, goes through a draft and an approval like any first
//      attempt, dispatches once, and a repeat retry returns the same run;
//   C  refusals: a viewer, another organisation, a finished run, and a step that is not dead.
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
    throw new Error("WF08 refuses a non-loopback Postgres host");
  }
  if (!fs.existsSync(path.join(simDir, "load", ".jwt-secret"))) {
    throw new Error("WF08 local sim JWT secret is missing; start tools/sim-lab first");
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
  title: "WF08 e2e workflow agent",
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
  const orgId = id("f0880000", n);
  const agentRef = `wf08-e2e-agent-${runTag}-${n}`;
  const agentIdentity = id("f0881000", n);
  const role = `wf08-e2e-agent-${runTag}-${n}`;
  const packCode = `wf08-e2e-${runTag}-${n}`;
  const templateId = id("f0882000", n);
  const definitionId = id("f0883000", n);
  const versionId = id("f0884000", n);
  const memberIds = Array.from({ length: recipients }, (_, index) =>
    id(`f088${String(5000 + n).padStart(4, "0")}`, index + 1),
  );
  const people = {
    ap1: id("f0887000", n * 10 + 1),
    ap2: id("f0887000", n * 10 + 2),
    author: id("f0887000", n * 10 + 3),
    publisher: id("f0887000", n * 10 + 4),
    owner: id("f0887000", n * 10 + 5),
    viewer: id("f0887000", n * 10 + 6),
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
      `WF08 e2e org ${n}`,
      `wf08-e2e-${runTag}-${n}`,
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
       VALUES ($1, $2, 1, 'WF08 e2e template', 'Local WF08 run history fixture.', $3::jsonb, $4,
         'act_and_report')`,
      [templateId, `wf08-e2e-${runTag}-${n}`, JSON.stringify(graph), agentRef],
    );
    await client.query(
      "INSERT INTO public.wf_definition (id, org_id, key, name) VALUES ($1, $2, $3, 'WF08 e2e workflow')",
      [definitionId, orgId, `wf08-e2e-${runTag}-${n}`],
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
      [id("f0888000", n), orgId, definitionId, EVENT_TYPE],
    );

    await client.query("INSERT INTO auth.users (id) VALUES ($1)", [agentIdentity]);
    await client.query(
      `INSERT INTO public.cg_role_pack (code, version, kind, applies_to, status, definition)
       VALUES ($1, '1.0.0', 'tenant_role', ARRAY[$2], 'published', $3::jsonb)`,
      [packCode, role, JSON.stringify(rolePack(packCode, role))],
    );
    const ensured = await client.query(
      `SELECT public.cg_twin_ensure_context($1, 'tenant_membership', $2, $3, $4, true) AS r`,
      [agentIdentity, orgId, role, `wf08-e2e-${runTag}-${n}`],
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
      [orgId, `vault://in-app/wf08-e2e-${runTag}-${n}#v1`],
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
          `WF08 e2e ${name}`,
          `${name}-${n}-${runTag}@wf08-e2e.invalid`,
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

async function emitEvent(client, orgId, n) {
  await client.query(
    `INSERT INTO public.wf_event (org_id, event_type, source, dedupe_key, payload)
     VALUES ($1, $2, 'wf08-e2e', $3, '{}'::jsonb)`,
    [orgId, EVENT_TYPE, `wf08-e2e:${runTag}:${n}`],
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
      throw new Error("WF08 blocked a non-local or non-PostgREST request");
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
  const history = await load("lib/workflow/run-history.server.ts");
  const client = await load("integrations/supabase/client.server.ts");
  return {
    runWorkflowTick: runtime.runWorkflowTick,
    createPort: serverRuntime.createWorkflowRuntimePort,
    createWorkflowActionRuntime: actionRuntime.createWorkflowActionRuntime,
    createWorkflowApprovalSweepRuntime: actionRuntime.createWorkflowApprovalSweepRuntime,
    inbox,
    stepUp,
    history,
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
      worker: `wf08-${runTag}-${label}`,
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
      throw new Error("WF08 requires a loopback disposable Postgres superuser");
    }
    const ready = await client.query(
      `SELECT to_regprocedure('public.wf_run_retry(uuid,uuid,text)') IS NOT NULL
              AND to_regprocedure('public.wf_run_cancel(uuid,uuid,text)') IS NOT NULL AS ready`,
    );
    if (!ready.rows[0].ready) throw new Error("WF08 migrations are not applied");

    const orgA = await seedOrganization(client, 1, {
      templateRef: "wf08.notice",
      withTemplate: true,
      recipients: MASS,
    }); // approved by two people, then cancelled before dispatch
    const orgB = await seedOrganization(client, 2, {
      templateRef: "wf08.late",
      withTemplate: false,
      recipients: SMALL,
    }); // fails, is fixed, is retried
    orgs.push(orgA.orgId, orgB.orgId);

    const jwtSecret = fs.readFileSync(path.join(simDir, "load", ".jwt-secret"), "utf8").trim();
    const modules = await loadModules(vite, serviceRoleToken(jwtSecret));
    const providers = countingProviders();
    const sandboxEnv = {
      WORKFLOW_DELIVERY_MODE: "sandbox",
      WORKFLOWS_ENABLED: "true",
      APP_ENV: "staging",
    };
    const actionRuntime = modules.createWorkflowActionRuntime(sandboxEnv, providers.dependencies);
    const sweep = modules.createWorkflowApprovalSweepRuntime(sandboxEnv, providers.dependencies);
    const authenticator = stubAuthenticator();
    const inboxPorts = {
      rpc: (fn, args) => modules.admin.rpc(fn, args),
      webauthn: async () => ({ service: authenticator.service, origin: ORIGIN }),
      rateKey: (userId) => `user:${userId}:127.0.0.1`,
      nonce: modules.stepUp.newApprovalStepUpNonce,
    };
    const approveWithPasskey = async (approvalId, actorId) => {
      const begun = await modules.inbox.beginApprovalStepUp(inboxPorts, { actorId, approvalId });
      return modules.inbox.decideApproval(inboxPorts, {
        actorId,
        approvalId,
        decision: "approve",
        digest: begun.digest,
        nonce: begun.nonce,
        response: authenticator.sign(begun.options.challenge),
      });
    };
    const ports = { rpc: (fn, args) => modules.admin.rpc(fn, args) };
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
          `WF08 ${label}: expected ${expected}, got ${error?.code ?? error?.message}`,
        );
      }
      throw new Error(`WF08 ${label}: expected a refusal (${expected}) but the call succeeded`);
    };
    const outboxCount = (org) =>
      scalar(
        client,
        "SELECT count(*)::int AS n FROM public.wf_action_sandbox_outbox WHERE org_id = $1",
        [org.orgId],
      );
    const runsOf = (org) =>
      client
        .query(
          `SELECT id, status, error_code, retry_of_run_id, retry_generation
             FROM public.wf_run WHERE org_id = $1 ORDER BY created_at, id`,
          [org.orgId],
        )
        .then((r) => r.rows);

    // 1: events -> runs. Org A drafts (and waits for approval); org B's step fails for good.
    for (const org of [orgA, orgB]) await emitEvent(client, org.orgId, org.n);
    const drafted = await tickUntil(
      modules,
      actionRuntime,
      async () =>
        (await scalar(
          client,
          `SELECT count(*)::int AS n FROM public.wf_action_draft
            WHERE org_id = $1 AND approval_id IS NOT NULL`,
          [orgA.orgId],
        )) >= 1,
      "draft",
      client,
      orgs,
    );
    if (!drafted) throw new Error("WF08 ticks did not produce org A's draft with an approval");
    const failed = await tickUntil(
      modules,
      actionRuntime,
      async () =>
        (await scalar(
          client,
          "SELECT count(*)::int AS n FROM public.wf_step_run WHERE org_id = $1 AND status = 'dead'",
          [orgB.orgId],
        )) >= 1,
      "fail",
      client,
      orgs,
    );
    if (!failed) throw new Error("WF08 ticks did not drive org B's step to a dead step");

    // 2: scenario A. The one approver approves; before the sweep dispatches, the owner cancels the run.
    const a = await rowOf(
      client,
      `SELECT a.id AS approval_id, d.id AS draft_id, r.id AS run_id
         FROM public.wf_action_draft d
         JOIN public.wf_approval a ON a.id = d.approval_id
         JOIN public.wf_run r ON r.org_id = d.org_id AND r.id = d.run_id
        WHERE d.org_id = $1`,
      [orgA.orgId],
    );
    const firstA = await approveWithPasskey(a.approval_id, orgA.people.ap1);
    const approvedA = await approveWithPasskey(a.approval_id, orgA.people.ap2);
    if (firstA.status !== "pending" || approvedA.status !== "approved")
      throw new Error("WF08 the two approvers did not approve the mass draft");

    const listedA = await modules.history.listRuns(ports, {
      actorId: orgA.people.viewer,
      filter: "all",
    });
    const detailA = await modules.history.viewRun(ports, {
      actorId: orgA.people.viewer,
      runId: a.run_id,
    });
    const leaked = JSON.stringify({ listedA, detailA });
    const leakProbes = [
      ...orgA.memberIds,
      "@wf08-e2e.invalid",
      "Status: ok",
      '"status":"ok"',
      orgB.orgId,
    ];
    const redactionLeaks = leakProbes.filter((p) => leaked.includes(p)).length;
    const draftView = detailA.drafts[0];
    const redactionShape =
      draftView?.recipient_count === MASS &&
      draftView?.param_count === 1 &&
      !detailA.permissions.can_cancel;

    await expectRefusal("viewer cancels", "not_authorized", () =>
      modules.history.cancelRun(ports, {
        actorId: orgA.people.viewer,
        runId: a.run_id,
        reason: "operator_request",
      }),
    );
    await expectRefusal("another organisation cancels", "not_found", () =>
      modules.history.cancelRun(ports, {
        actorId: orgB.people.owner,
        runId: a.run_id,
        reason: "operator_request",
      }),
    );
    await expectRefusal("another organisation reads the run", "not_found", () =>
      modules.history.viewRun(ports, { actorId: orgB.people.owner, runId: a.run_id }),
    );
    const outboxBeforeCancel = await outboxCount(orgA);
    const cancelled = await modules.history.cancelRun(ports, {
      actorId: orgA.people.owner,
      runId: a.run_id,
      reason: "duplicate_run",
    });
    const cancelledAgain = await modules.history.cancelRun(ports, {
      actorId: orgA.people.owner,
      runId: a.run_id,
      reason: "duplicate_run",
    });
    await expectRefusal("retry a step of a cancelled run", "step_not_dead", async () => {
      const dead = await rowOf(
        client,
        "SELECT id FROM public.wf_step_run WHERE org_id = $1 ORDER BY created_at LIMIT 1",
        [orgA.orgId],
      );
      return modules.history.retryStep(ports, {
        actorId: orgA.people.owner,
        stepId: dead.id,
        reason: "operator_request",
      });
    });
    await sweep();
    await sweep();
    await tickUntil(modules, actionRuntime, async () => false, "after-cancel", client, orgs).catch(
      () => undefined,
    );
    const outboxAfterCancel = await outboxCount(orgA);
    const stateA = await rowOf(
      client,
      `SELECT r.status AS run, d.status AS draft,
              (SELECT count(*)::int FROM public.wf_step_run s WHERE s.run_id = r.id AND s.step_key = 'record') AS follow_up
         FROM public.wf_run r JOIN public.wf_action_draft d ON d.run_id = r.id AND d.org_id = r.org_id
        WHERE r.id = $1`,
      [a.run_id],
    );
    const ledgerA = await scalar(
      client,
      `SELECT count(*)::int AS n FROM public.cg_tool_call_ledger
        WHERE tenant_ref = $1 AND tool_id LIKE 'workflow.action.%'`,
      [orgA.orgId],
    );
    // 3: scenario B. Org B's run failed because its template was missing. List and view it, refuse
    // the retries that must be refused, fix the template, retry, and let the real runtime continue.
    const runsB0 = await runsOf(orgB);
    const failedRun = runsB0.find((r) => r.status === "failed");
    if (!failedRun) throw new Error("WF08 org B has no failed run");
    await expectRefusal("cancel a finished run", "not_cancellable", () =>
      modules.history.cancelRun(ports, {
        actorId: orgB.people.owner,
        runId: failedRun.id,
        reason: "operator_request",
      }),
    );

    const failedList = await modules.history.listRuns(ports, {
      actorId: orgB.people.viewer,
      filter: "failed",
    });
    const failedDetail = await modules.history.viewRun(ports, {
      actorId: orgB.people.owner,
      runId: failedRun.id,
    });
    const deadStep = failedDetail.steps.find((s) => s.status === "dead");
    if (!deadStep || failedList.items.length !== 1 || !failedList.items[0].has_dead_step) {
      throw new Error("WF08 the failed run or its dead step is not shown in the history");
    }
    if (deadStep.retry.blockers.length !== 0) {
      throw new Error(`WF08 the dead step is unexpectedly blocked: ${deadStep.retry.blockers}`);
    }
    await expectRefusal("viewer retries", "not_authorized", () =>
      modules.history.retryStep(ports, {
        actorId: orgB.people.viewer,
        stepId: deadStep.step_id,
        reason: "fixed_upstream",
      }),
    );
    await expectRefusal("another organisation retries", "not_found", () =>
      modules.history.retryStep(ports, {
        actorId: orgA.people.owner,
        stepId: deadStep.step_id,
        reason: "fixed_upstream",
      }),
    );
    const successStep = await rowOf(
      client,
      "SELECT id FROM public.wf_step_run WHERE org_id = $1 AND status <> 'dead' LIMIT 1",
      [orgB.orgId],
    );
    if (successStep) {
      await expectRefusal("retry a step that is not dead", "step_not_dead", () =>
        modules.history.retryStep(ports, {
          actorId: orgB.people.owner,
          stepId: successStep.id,
          reason: "fixed_upstream",
        }),
      );
    }

    // Fix upstream: the template the action asked for now exists and is approved.
    await client.query(
      `INSERT INTO public.wf_action_template (org_id, kind, template_ref, body_template, parameter_keys, status)
       VALUES ($1, 'in_app', $2, 'Status: {{status}}', ARRAY['status'], 'approved')`,
      [orgB.orgId, orgB.templateRef],
    );
    const retried = await modules.history.retryStep(ports, {
      actorId: orgB.people.owner,
      stepId: deadStep.step_id,
      reason: "fixed_upstream",
    });
    const retriedAgain = await modules.history.retryStep(ports, {
      actorId: orgB.people.owner,
      stepId: deadStep.step_id,
      reason: "fixed_upstream",
    });
    const continued = await tickUntil(
      modules,
      actionRuntime,
      async () =>
        (await scalar(
          client,
          `SELECT count(*)::int AS n FROM public.wf_step_run
            WHERE org_id = $1 AND run_id = $2 AND step_key = 'record'`,
          [orgB.orgId, retried.run_id],
        )) >= 1,
      "retry-resume",
      client,
      orgs,
    );
    const outboxB = await outboxCount(orgB);
    const finalB = await rowOf(
      client,
      `SELECT r.status, r.retry_generation, r.retry_of_run_id, r.started_by
         FROM public.wf_run r WHERE r.id = $1`,
      [retried.run_id],
    );
    const sourceB = await rowOf(
      client,
      "SELECT status, error_code FROM public.wf_run WHERE id = $1",
      [failedRun.id],
    );
    const runsB = await runsOf(orgB);
    const ledgerB = await scalar(
      client,
      `SELECT count(*)::int AS n FROM public.cg_tool_call_ledger
        WHERE tenant_ref = $1 AND tool_id LIKE 'workflow.action.%'`,
      [orgB.orgId],
    );
    const followUpB = await scalar(
      client,
      `SELECT count(*)::int AS n FROM public.wf_step_run
        WHERE org_id = $1 AND run_id = $2 AND step_key = 'record'`,
      [orgB.orgId, retried.run_id],
    );
    const audit = async (action) =>
      scalar(
        client,
        "SELECT count(*)::int AS n FROM public.audit_chain WHERE action = $1 AND org_id = ANY($2::uuid[])",
        [action, orgs],
      );
    const auditTrail = {
      cancel: await audit("workflow.run.cancel_requested"),
      retry: await audit("workflow.run.retry_requested"),
    };
    const history = await modules.history.viewRun(ports, {
      actorId: orgB.people.viewer,
      runId: retried.run_id,
    });
    const timelineKinds = history.events.map((e) => e.kind);

    const sentLive = providers.calls.adapters + providers.calls.http;
    const dup =
      Math.max(0, outboxB - 1) +
      Math.max(0, ledgerB - 1) +
      Math.max(0, followUpB - 1) +
      Math.max(0, runsB.filter((r) => r.retry_of_run_id).length - 1) +
      Math.max(0, auditTrail.cancel - 1) +
      Math.max(0, auditTrail.retry - 1) +
      (retriedAgain.run_id === retried.run_id ? 0 : 1);

    console.log(
      `WF08-E2E DETAIL: a_cancel=${cancelled.status}/replayed:${cancelledAgain.replayed} ` +
        `a_state=${stateA.run}/${stateA.draft}/follow_up:${stateA.follow_up} a_outbox=${outboxBeforeCancel}->${outboxAfterCancel} ` +
        `a_ledger=${ledgerA} redaction_leaks=${redactionLeaks} redaction_shape=${redactionShape} ` +
        `b_source=${sourceB.status}/${sourceB.error_code} b_retry=${finalB.status}/gen:${finalB.retry_generation} ` +
        `b_replayed=${retriedAgain.replayed} b_outbox=${outboxB} ` +
        `b_follow_up=${followUpB} b_timeline=${timelineKinds.join(",")} ` +
        `audit=cancel:${auditTrail.cancel},retry:${auditTrail.retry} adapter_calls=${providers.calls.adapters} http_calls=${providers.calls.http}`,
    );
    console.log(
      `WF08-E2E RESULT: cancelled_dispatched=${outboxAfterCancel} retried_dispatched=${outboxB} ` +
        `retry_runs=${runsB.filter((r) => r.retry_of_run_id).length} refusals=${refusals.length} ` +
        `sent_live=${sentLive} dup=${dup}`,
    );

    const failures = [];
    if (cancelled.status !== "cancelled" || cancelled.replayed || !cancelledAgain.replayed)
      failures.push("cancel was not idempotent");
    if (outboxBeforeCancel !== 0 || outboxAfterCancel !== 0 || ledgerA !== 0)
      failures.push("an approved draft of a cancelled run reached the outbox or the broker");
    if (stateA.run !== "cancelled" || stateA.draft !== "approved" || stateA.follow_up !== 0)
      failures.push("the cancelled run did not stay cancelled (or continued past the approval)");
    if (redactionLeaks !== 0 || !redactionShape)
      failures.push("run history leaked a recipient, parameter or other organisation's id");
    if (sourceB.status !== "failed") failures.push("the source run was rewritten by the retry");
    if (retried.replayed || !retriedAgain.replayed || retriedAgain.run_id !== retried.run_id)
      failures.push("a repeat retry did not return the same run");
    if (runsB.filter((r) => r.retry_of_run_id).length !== 1)
      failures.push("retry did not create exactly one linked run");
    if (outboxB !== 1)
      failures.push("the retried step did not reach the sandbox outbox exactly once");
    if (!continued || followUpB !== 1 || finalB.retry_generation !== 1)
      failures.push("the retry run did not continue to its follow-up step");
    if (finalB.retry_of_run_id !== failedRun.id || finalB.started_by !== orgB.people.owner)
      failures.push("the retry run is not linked to its source or its starter");
    if (auditTrail.cancel !== 1 || auditTrail.retry !== 1)
      failures.push("the audit chain does not hold exactly one cancel and one retry request");
    if (!timelineKinds.includes("run.retry_requested"))
      failures.push("the retry run's timeline does not show its retry request");
    if (refusals.length < 7) failures.push(`expected at least 7 refusals, saw ${refusals.length}`);
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
  console.error("WF08 local run history E2E failed:", error.message);
  process.exitCode = 1;
});
