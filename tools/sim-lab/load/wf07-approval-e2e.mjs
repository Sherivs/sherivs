// WF-07 approval inbox E2E against the local sim-lab Postgres + PostgREST (never a hosted database).
//
// Drives the real thing end to end with no browser: workflow ticks through the production action
// executor create capped drafts; the production inbox operations (approval-inbox.server.ts) list,
// view, step up and decide through the real SECURITY DEFINER functions; the production approval
// sweep dispatches approved drafts to the sandbox outbox; a following tick lets the run continue.
//
// The only stubs: the WebAuthn service (there is no authenticator here; the stub signs exactly the
// challenge the production code issued, or a deliberately wrong one) and the outbound provider
// adapters / HTTP port, which count their calls. `sent_live` is computed from those counters and
// `dup` from SQL. Nothing here reaches a network.
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
const MASS = 26; // one more than WORKFLOW_MASS_RECIPIENT_THRESHOLD: a two-person, high-risk draft.
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
    throw new Error("WF07 refuses a non-loopback Postgres host");
  }
  if (!fs.existsSync(path.join(simDir, "load", ".jwt-secret"))) {
    throw new Error("WF07 local sim JWT secret is missing; start tools/sim-lab first");
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
  title: "WF07 e2e workflow agent",
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
 * workflow whose single action is an in-app message to MASS members (a two-person, high-risk
 * draft), an active twin context for the agent, a tenant connector binding, an approved in-app
 * template, two approvers, and the workflow's author (who also holds the approve permission, to
 * prove that holding it is not enough).
 */
async function seedOrganization(client, n) {
  const orgId = id("f0770000", n);
  const agentRef = `wf07-e2e-agent-${runTag}-${n}`;
  const agentIdentity = id("f0771000", n);
  const role = `wf07-e2e-agent-${runTag}-${n}`;
  const packCode = `wf07-e2e-${runTag}-${n}`;
  const templateId = id("f0772000", n);
  const definitionId = id("f0773000", n);
  const versionId = id("f0774000", n);
  const memberIds = Array.from({ length: MASS }, (_, index) =>
    id(`f077${String(5000 + n).padStart(4, "0")}`, index + 1),
  );
  const people = {
    ap1: id("f0777000", n * 10 + 1),
    ap2: id("f0777000", n * 10 + 2),
    author: id("f0777000", n * 10 + 3),
    publisher: id("f0777000", n * 10 + 4),
    owner: id("f0777000", n * 10 + 5),
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
          templateRef: "wf07.notice",
          templateParams: { status: "ok" },
          dataClass: "internal",
          recipientIds: memberIds,
        },
      },
      // A follow-up step proves whether the run continued past the approved action.
      { stepId: "record", kind: "task", assignment: { kind: "unassigned" }, authorizedActions: [] },
    ],
    onFailure: { kind: "halt" },
    requiredApprovals: [],
  };
  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO public.schools (id, name, slug) VALUES ($1, $2, $3)", [
      orgId,
      `WF07 e2e org ${n}`,
      `wf07-e2e-${runTag}-${n}`,
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
       VALUES ($1, $2, 1, 'WF07 e2e template', 'Local WF07 approval fixture.', $3::jsonb, $4,
         'act_and_report')`,
      [templateId, `wf07-e2e-${runTag}-${n}`, JSON.stringify(graph), agentRef],
    );
    await client.query(
      "INSERT INTO public.wf_definition (id, org_id, key, name) VALUES ($1, $2, $3, 'WF07 e2e workflow')",
      [definitionId, orgId, `wf07-e2e-${runTag}-${n}`],
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
      [id("f0778000", n), orgId, definitionId, EVENT_TYPE],
    );

    await client.query("INSERT INTO auth.users (id) VALUES ($1)", [agentIdentity]);
    await client.query(
      `INSERT INTO public.cg_role_pack (code, version, kind, applies_to, status, definition)
       VALUES ($1, '1.0.0', 'tenant_role', ARRAY[$2], 'published', $3::jsonb)`,
      [packCode, role, JSON.stringify(rolePack(packCode, role))],
    );
    const ensured = await client.query(
      `SELECT public.cg_twin_ensure_context($1, 'tenant_membership', $2, $3, $4, true) AS r`,
      [agentIdentity, orgId, role, `wf07-e2e-${runTag}-${n}`],
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
      [orgId, `vault://in-app/wf07-e2e-${runTag}-${n}#v1`],
    );
    await client.query(
      `INSERT INTO public.wf_action_template (org_id, kind, template_ref, body_template, parameter_keys, status)
       VALUES ($1, 'in_app', 'wf07.notice', 'Status: {{status}}', ARRAY['status'], 'approved')`,
      [orgId],
    );
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
          `WF07 e2e ${name}`,
          `${name}-${n}-${runTag}@wf07-e2e.invalid`,
          name === "owner" ? "admin" : "teacher",
        ],
      );
    }
    // Role assignments are written as the signed-in publisher would write them; the approvers and the
    // author hold the auditor template, which carries workflows.approve.
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
      [orgId, people.publisher, people.owner, people.ap1, people.ap2, people.author],
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
  return { orgId, memberIds, people, n };
}

async function emitEvent(client, orgId, n) {
  await client.query(
    `INSERT INTO public.wf_event (org_id, event_type, source, dedupe_key, payload)
     VALUES ($1, $2, 'wf07-e2e', $3, '{}'::jsonb)`,
    [orgId, EVENT_TYPE, `wf07-e2e:${runTag}:${n}`],
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
      throw new Error("WF07 blocked a non-local or non-PostgREST request");
    }
    url.pathname = url.pathname.replace(/^\/rest\/v1/, "") || "/";
    return localFetch(new Request(url, request));
  };
  const load = (p) => vite.ssrLoadModule(`/frontend/src/${p}`);
  const runtime = await load("lib/workflow/workflow-runtime.ts");
  const serverRuntime = await load("lib/workflow/workflow-runtime.server.ts");
  const actionRuntime = await load("lib/workflow/workflow-action-runtime.server.ts");
  const approvedDraft = await load("lib/workflow/workflow-approved-draft.server.ts");
  const inbox = await load("lib/workflow/approval-inbox.server.ts");
  const stepUp = await load("lib/workflow/approval-step-up.ts");
  const client = await load("integrations/supabase/client.server.ts");
  return {
    runWorkflowTick: runtime.runWorkflowTick,
    createPort: serverRuntime.createWorkflowRuntimePort,
    createWorkflowActionRuntime: actionRuntime.createWorkflowActionRuntime,
    createWorkflowActionPorts: actionRuntime.createWorkflowActionPorts,
    createWorkflowApprovalSweepRuntime: actionRuntime.createWorkflowApprovalSweepRuntime,
    dispatchApprovedWorkflowDraft: approvedDraft.dispatchApprovedWorkflowDraft,
    inbox,
    stepUp,
    admin: client.supabaseAdmin,
  };
}

async function tickUntil(modules, actionRuntime, done, label) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await modules.runWorkflowTick(modules.createPort(), {
      worker: `wf07-${runTag}-${label}`,
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
      throw new Error("WF07 requires a loopback disposable Postgres superuser");
    }
    const ready = await client.query(
      `SELECT to_regclass('public.wf_approval_decision') IS NOT NULL
              AND to_regprocedure('public.wf_decide_approval(uuid,uuid,text,text,text,uuid)') IS NOT NULL
              AND to_regclass('public.wf_action_sandbox_outbox') IS NOT NULL AS ready`,
    );
    if (!ready.rows[0].ready) throw new Error("WF07 migrations are not applied");

    const orgA = await seedOrganization(client, 1); // approved by two people, dispatched
    const orgB = await seedOrganization(client, 2); // rejected
    const orgC = await seedOrganization(client, 3); // expired
    orgs.push(orgA.orgId, orgB.orgId, orgC.orgId);

    const jwtSecret = fs.readFileSync(path.join(simDir, "load", ".jwt-secret"), "utf8").trim();
    const modules = await loadModules(vite, serviceRoleToken(jwtSecret));
    const providers = countingProviders();
    const sandboxEnv = {
      WORKFLOW_DELIVERY_MODE: "sandbox",
      WORKFLOWS_ENABLED: "true",
      APP_ENV: "staging",
    };
    const liveEnv = { ...sandboxEnv, WORKFLOW_DELIVERY_MODE: "live" };
    const actionRuntime = modules.createWorkflowActionRuntime(sandboxEnv, providers.dependencies);
    const sweep = modules.createWorkflowApprovalSweepRuntime(sandboxEnv, providers.dependencies);
    const authenticator = stubAuthenticator();
    const ports = {
      rpc: (fn, args) => modules.admin.rpc(fn, args),
      webauthn: async () => ({ service: authenticator.service, origin: ORIGIN }),
      rateKey: (userId) => `user:${userId}:127.0.0.1`,
      nonce: modules.stepUp.newApprovalStepUpNonce,
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
          `WF07 ${label}: expected ${expected}, got ${error?.code ?? error?.message}`,
        );
      }
      throw new Error(`WF07 ${label}: expected a refusal (${expected}) but the call succeeded`);
    };

    // 1: events -> runs -> capped drafts, each with an approval in the tenant inbox.
    for (const org of [orgA, orgB, orgC]) await emitEvent(client, org.orgId, org.n);
    const drafted = await tickUntil(
      modules,
      actionRuntime,
      async () =>
        (await scalar(
          client,
          `SELECT count(*)::int AS n FROM public.wf_action_draft
            WHERE org_id = ANY($1::uuid[]) AND approval_id IS NOT NULL`,
          [orgs],
        )) >= 3,
      "draft",
    );
    if (!drafted) throw new Error("WF07 ticks did not produce three drafts with approvals");
    const approvalFor = async (org) =>
      rowOf(
        client,
        `SELECT a.id AS approval_id, a.risk, a.status, d.id AS draft_id, d.category, d.status AS draft_status
           FROM public.wf_action_draft d JOIN public.wf_approval a ON a.id = d.approval_id
          WHERE d.org_id = $1`,
        [org.orgId],
      );
    const a = await approvalFor(orgA);
    const b = await approvalFor(orgB);
    const c = await approvalFor(orgC);
    for (const [name, row] of [
      ["A", a],
      ["B", b],
      ["C", c],
    ]) {
      if (row.category !== "mass_message" || row.risk !== "high" || row.status !== "pending") {
        throw new Error(`WF07 org ${name}: draft approval is not a pending high-risk mass_message`);
      }
    }

    // 2: the inbox for approver one shows only their organisation's item, with the two-person rule.
    const listed = await modules.inbox.listApprovals(ports, {
      actorId: orgA.people.ap1,
      filter: "pending",
    });
    const viewA1 = await modules.inbox.viewApproval(ports, {
      actorId: orgA.people.ap1,
      approvalId: a.approval_id,
    });
    const viewAuthor = await modules.inbox.viewApproval(ports, {
      actorId: orgA.people.author,
      approvalId: a.approval_id,
    });
    if (listed.length !== 1 || listed[0].approvalId !== a.approval_id || listed[0].required !== 2) {
      throw new Error("WF07 inbox list is not exactly the organisation's one two-person item");
    }
    if (
      !viewA1.canDecide ||
      !viewA1.stepUpRequired ||
      viewA1.required !== 2 ||
      !/^[0-9a-f]{64}$/.test(viewA1.digest)
    ) {
      throw new Error(
        "WF07 detail does not show a decidable high-risk two-person item with a digest",
      );
    }
    if (viewAuthor.canDecide || !viewAuthor.blockers.includes("author")) {
      throw new Error("WF07 the workflow's author is not excluded from deciding");
    }

    // 3: refusals. No approval without a passkey; the author, a wrong-binding assertion, a
    // cross-tenant read and a direct database approval are all refused.
    await expectRefusal("approve without passkey", "step_up_invalid", () =>
      modules.inbox.decideApproval(ports, {
        actorId: orgA.people.ap1,
        approvalId: a.approval_id,
        decision: "approve",
        digest: viewA1.digest,
      }),
    );
    await expectRefusal("author decides", "author", () =>
      modules.inbox.decideApproval(ports, {
        actorId: orgA.people.author,
        approvalId: a.approval_id,
        decision: "reject",
        digest: viewA1.digest,
      }),
    );
    const viewB1 = await modules.inbox.viewApproval(ports, {
      actorId: orgB.people.ap1,
      approvalId: b.approval_id,
    });
    await expectRefusal("cross-tenant read", "not_found", () =>
      modules.inbox.viewApproval(ports, {
        actorId: orgA.people.ap1,
        approvalId: b.approval_id,
      }),
    );
    await expectRefusal("cross-tenant decision", "not_found", () =>
      modules.inbox.decideApproval(ports, {
        actorId: orgA.people.ap1,
        approvalId: b.approval_id,
        decision: "reject",
        digest: viewB1.digest,
      }),
    );
    // An assertion signed for ANOTHER approval's content must not count for this one.
    {
      const begun = await modules.inbox.beginApprovalStepUp(ports, {
        actorId: orgA.people.ap1,
        approvalId: a.approval_id,
      });
      const foreign = modules.stepUp.approvalStepUpChallenge({
        userId: orgA.people.ap1,
        approvalId: b.approval_id,
        digest: viewB1.digest,
        nonce: begun.nonce,
      });
      await expectRefusal("assertion signed for another approval", "step_up_failed", () =>
        modules.inbox.decideApproval(ports, {
          actorId: orgA.people.ap1,
          approvalId: a.approval_id,
          decision: "approve",
          digest: begun.digest,
          nonce: begun.nonce,
          response: authenticator.sign(foreign),
        }),
      );
    }
    let directError = "";
    try {
      await client.query("UPDATE public.wf_action_draft SET status = 'approved' WHERE id = $1", [
        a.draft_id,
      ]);
    } catch (error) {
      directError = error.message;
    }
    if (!/cannot be approved/.test(directError)) {
      throw new Error("WF07 a direct database approval of the draft was not refused");
    }
    refusals.push("direct database approval");

    // 4: the first approval (with a passkey bound to this digest) is not enough for a two-person item.
    const approveWithPasskey = async (approvalId, actorId) => {
      const begun = await modules.inbox.beginApprovalStepUp(ports, { actorId, approvalId });
      return modules.inbox.decideApproval(ports, {
        actorId,
        approvalId,
        decision: "approve",
        digest: begun.digest,
        nonce: begun.nonce,
        response: authenticator.sign(begun.options.challenge),
        note: "Checked the recipients",
      });
    };
    const first = await approveWithPasskey(a.approval_id, orgA.people.ap1);
    if (first.status !== "pending" || first.approvals !== 1 || first.required !== 2) {
      throw new Error("WF07 the first approval did not leave the item waiting for a second person");
    }
    await expectRefusal("second vote by the same person", "already_voted", () =>
      approveWithPasskey(a.approval_id, orgA.people.ap1),
    );
    const viewAfterFirst = await modules.inbox.viewApproval(ports, {
      actorId: orgA.people.ap1,
      approvalId: a.approval_id,
    });
    if (viewAfterFirst.canDecide || !viewAfterFirst.votes.some((v) => v.mine && v.current)) {
      throw new Error("WF07 the first approver does not see their own recorded vote");
    }
    const outboxCount = (org) =>
      scalar(
        client,
        "SELECT count(*)::int AS n FROM public.wf_action_sandbox_outbox WHERE org_id = $1",
        [org.orgId],
      );
    await sweep();
    const outboxAfterOne = await outboxCount(orgA);

    // 5: the second approver completes it; a live-mode sweep refuses to dispatch; sandbox dispatches.
    const second = await approveWithPasskey(a.approval_id, orgA.people.ap2);
    if (second.status !== "approved" || second.draftId !== a.draft_id) {
      throw new Error("WF07 the second approval did not approve the draft");
    }
    // Live delivery of an approved draft is refused in both places it could be asked for: outside
    // production by the delivery gate, and (with a production-shaped in-process environment, stub
    // adapters and nothing sent) by the approved-draft dispatcher itself, which is sandbox only.
    for (const [label, env, expected] of [
      ["live dispatch outside production", liveEnv, "workflow_delivery_refused"],
      [
        "live dispatch of an approved draft",
        { ...liveEnv, APP_ENV: "production" },
        "workflow_approved_live_unsupported",
      ],
    ]) {
      const livePorts = modules.createWorkflowActionPorts(env, providers.dependencies);
      let liveError = "";
      try {
        await modules.dispatchApprovedWorkflowDraft(livePorts, {
          orgId: orgA.orgId,
          draftId: a.draft_id,
        });
      } catch (error) {
        liveError = error.message;
      }
      if (liveError !== expected) {
        throw new Error(
          `WF07 ${label} was not refused as ${expected} (${liveError || "no error"})`,
        );
      }
      refusals.push(label);
    }
    const outboxAfterLive = await outboxCount(orgA);

    await sweep();
    await sweep();
    const dispatched = await outboxCount(orgA);
    const outboxRow = await rowOf(
      client,
      `SELECT o.draft_id, o.category, o.data_class, cardinality(o.recipient_ids) AS recipients,
              l.idempotency_key AS broker_key, l.verdict
         FROM public.wf_action_sandbox_outbox o
         JOIN public.cg_tool_call_ledger l ON l.id = o.broker_decision_id
        WHERE o.org_id = $1`,
      [orgA.orgId],
    );
    const continued = await tickUntil(
      modules,
      actionRuntime,
      async () =>
        (await scalar(
          client,
          "SELECT count(*)::int AS n FROM public.wf_step_run WHERE org_id = $1 AND step_key = 'record'",
          [orgA.orgId],
        )) >= 1,
      "resume",
    );
    const stepA = await rowOf(
      client,
      `SELECT s.status, r.status AS run_status FROM public.wf_step_run s
         JOIN public.wf_run r ON r.org_id = s.org_id AND r.id = s.run_id
        WHERE s.org_id = $1 AND s.step_key = 'notify'`,
      [orgA.orgId],
    );
    const followUpA = await scalar(
      client,
      "SELECT count(*)::int AS n FROM public.wf_step_run WHERE org_id = $1 AND step_key = 'record'",
      [orgA.orgId],
    );
    const audit = async (action) =>
      scalar(
        client,
        "SELECT count(*)::int AS n FROM public.audit_chain WHERE action = $1 AND target_id = $2",
        [action, a.approval_id],
      );
    const auditTrail = {
      voteApprove: await audit("workflow.approval.vote_approve"),
      stepUpVerified: await audit("workflow.approval.step_up_verified"),
      stepUpFailed: await audit("workflow.approval.step_up_failed"),
    };
    const ledgerA = await scalar(
      client,
      `SELECT count(*)::int AS n FROM public.cg_tool_call_ledger
        WHERE tenant_ref = $1 AND tool_id LIKE 'workflow.action.%'`,
      [orgA.orgId],
    );

    // 6: a rejected item and an expired item never reach the outbox and cannot be decided.
    const rejected = await modules.inbox.decideApproval(ports, {
      actorId: orgB.people.ap1,
      approvalId: b.approval_id,
      decision: "reject",
      digest: viewB1.digest,
      note: "Wrong class",
    });
    await expectRefusal("approve after reject", "not_pending", () =>
      approveWithPasskey(b.approval_id, orgB.people.ap2),
    );
    const viewC = await modules.inbox.viewApproval(ports, {
      actorId: orgC.people.ap1,
      approvalId: c.approval_id,
    });
    // Backdate the window as the superuser, skipping triggers for this one fixture update only.
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(
      `UPDATE public.wf_approval SET requested_at = now() - interval '8 days',
              expires_at = now() - interval '1 minute' WHERE id = $1`,
      [c.approval_id],
    );
    await client.query("COMMIT");
    await expectRefusal("decide an expired item", "expired", () =>
      modules.inbox.decideApproval(ports, {
        actorId: orgC.people.ap1,
        approvalId: c.approval_id,
        decision: "reject",
        digest: viewC.digest,
      }),
    );
    await sweep();

    const state = async (org, row) =>
      rowOf(
        client,
        `SELECT a.status AS approval, d.status AS draft, r.status AS run, r.error_code
           FROM public.wf_approval a
           JOIN public.wf_action_draft d ON d.approval_id = a.id
           JOIN public.wf_run r ON r.org_id = a.org_id AND r.id = a.run_id
          WHERE a.id = $1`,
        [row.approval_id],
      );
    const sB = await state(orgB, b);
    const sC = await state(orgC, c);
    const outboxB = await outboxCount(orgB);
    const outboxC = await outboxCount(orgC);
    const ledgerOthers = await scalar(
      client,
      `SELECT count(*)::int AS n FROM public.cg_tool_call_ledger
        WHERE tenant_ref = ANY($1::text[]) AND tool_id LIKE 'workflow.action.%'`,
      [[orgB.orgId, orgC.orgId]],
    );

    const sentLive = providers.calls.adapters + providers.calls.http;
    const dup =
      Math.max(0, dispatched - 1) +
      Math.max(0, ledgerA - 1) +
      Math.max(0, followUpA - 1) +
      Math.max(0, auditTrail.voteApprove - 2) +
      Math.max(0, auditTrail.stepUpVerified - 2);

    console.log(
      `WF07-E2E DETAIL: first_approval=${first.status}(${first.approvals}/${first.required}) ` +
        `second_approval=${second.status} outbox_after_one=${outboxAfterOne} outbox_after_live=${outboxAfterLive} ` +
        `notify_step=${stepA.status}/${stepA.run_status} follow_up=${followUpA} ` +
        `broker_key=${outboxRow?.broker_key === `wf-approved:${a.draft_id}` ? "approved-draft" : "other"} ` +
        `audit=vote_approve:${auditTrail.voteApprove},step_up_verified:${auditTrail.stepUpVerified},step_up_failed:${auditTrail.stepUpFailed} ` +
        `rejected=${sB.approval}/${sB.draft}/${sB.run} expired=${sC.approval}/${sC.draft}/${sC.run} ` +
        `passkeys_verified=${authenticator.state.verified} passkeys_refused=${authenticator.state.refused} ` +
        `adapter_calls=${providers.calls.adapters} http_calls=${providers.calls.http}`,
    );
    console.log(
      `WF07-E2E RESULT: approved_dispatched=${dispatched} single_approval_dispatched=${outboxAfterOne} ` +
        `rejected_dispatched=${outboxB} expired_dispatched=${outboxC} refusals=${refusals.length} ` +
        `sent_live=${sentLive} dup=${dup}`,
    );

    const failures = [];
    if (dispatched !== 1)
      failures.push("the two-person approved draft was not dispatched exactly once");
    if (outboxAfterOne !== 0)
      failures.push("a single approval dispatched a two-person item to the outbox");
    if (outboxAfterLive !== 0) failures.push("a live-mode dispatch reached the outbox");
    if (
      !outboxRow ||
      outboxRow.draft_id !== a.draft_id ||
      outboxRow.broker_key !== `wf-approved:${a.draft_id}` ||
      outboxRow.verdict !== "execute" ||
      outboxRow.category !== "mass_message" ||
      outboxRow.recipients !== MASS
    )
      failures.push("the outbox row is not the approved draft cleared by its own broker decision");
    if (!continued || stepA.status !== "succeeded" || followUpA !== 1)
      failures.push("the run did not continue after the approved draft was dispatched");
    if (auditTrail.voteApprove !== 2 || auditTrail.stepUpVerified !== 2)
      failures.push("the audit chain does not hold both votes and both passkey confirmations");
    if (auditTrail.stepUpFailed < 1)
      failures.push("the wrong-binding passkey attempt was not audited");
    if (
      rejected.status !== "rejected" ||
      sB.approval !== "rejected" ||
      sB.draft !== "rejected" ||
      sB.run !== "cancelled"
    )
      failures.push("the rejected item did not reject its draft and stop its run");
    if (sC.approval !== "expired" || sC.draft !== "expired" || sC.run !== "cancelled")
      failures.push("the expired item did not expire its draft and stop its run");
    if (outboxB !== 0 || outboxC !== 0 || ledgerOthers !== 0)
      failures.push("a rejected or expired draft reached the outbox or the broker");
    if (authenticator.state.verified !== 2 || authenticator.state.refused < 1)
      failures.push("the passkey stub counts are not two verified and at least one refused");
    if (refusals.length !== 11) failures.push(`expected 11 refusals, saw ${refusals.length}`);
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
  console.error("WF07 local approval E2E failed:", error.message);
  process.exitCode = 1;
});
