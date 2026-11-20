// AIN-01 agents as engine actors E2E against the local sim-lab Postgres + PostgREST (never a hosted database).
//
// What the SQL harness cannot show: the guard under real concurrency and the read surface over HTTP.
//   A  daily budget under concurrency: an agent with a budget of 5 and 20 simultaneous connections, each its own
//      transaction as the service role, gets exactly 5 steps and 15 refusals (the advisory lock serializes count and
//      insert); replaying every key at once adds nothing and refuses no replay of an existing step;
//   B  pause: with the agent paused, 10 simultaneous inserts all fail; resume lets one through;
//   C  grant: in the organization the agent is not granted to, 10 simultaneous inserts all fail;
//   D  AI tripwire: a step of kind ai is refused while the AI route is undecided;
//   E  read surface over HTTP (PostgREST, service-role token): each organization sees its own view; the agent granted
//      to one organization is not listed for the other; no ungranted internal agent appears; the route is reported
//      as undecided.
//
// Nothing here calls a model, sends a message or reaches a network other than loopback. `sent_live` counts rows in the
// outbound tables for these organizations (this scenario creates none) and `dup` is computed from SQL.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const simDir = path.resolve(here, "..");
const { Client } = createRequire(path.join(simDir, "package.json"))("pg");
const host = process.env.SIM_PG_HOST || "127.0.0.1";
const port = Number(process.env.SIM_PG_PORT ?? 54329);
const postgrestPort = Number(process.env.SIM_POSTGREST_PORT ?? 3300);
const runTag = crypto.randomBytes(4).toString("hex");
const BUDGET = 5;
const CONCURRENT = 20;

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
    throw new Error("AIN01 refuses a non-loopback Postgres host");
  }
  if (!fs.existsSync(path.join(simDir, "load", ".jwt-secret"))) {
    throw new Error("AIN01 local sim JWT secret is missing; start tools/sim-lab first");
  }
}

async function connect() {
  const c = new Client({ host, port, user: "postgres", database: "postgres" });
  await c.connect();
  return c;
}

const orgA = id("f2510000", 1);
const orgB = id("f2510000", 2);
const adminA = id("f2520000", 1);
const adminB = id("f2520000", 2);
const author = id("f2520000", 3);
const publisher = id("f2520000", 4);
const agent = `ain01-e2e-${runTag}`;
const runIds = { a: id("f2530000", 1), b: id("f2530000", 2) };

async function setup(c) {
  await c.query("BEGIN");
  for (const u of [adminA, adminB, author, publisher]) {
    await c.query("INSERT INTO auth.users (id) VALUES ($1)", [u]);
  }
  for (const [org, name] of [
    [orgA, "a"],
    [orgB, "b"],
  ]) {
    await c.query("INSERT INTO public.schools (id, name, slug) VALUES ($1, $2, $3)", [
      org,
      `AIN01 e2e org ${name}`,
      `ain01-e2e-${runTag}-${name}`,
    ]);
    await c.query(
      `INSERT INTO public.wf_org_settings (org_id, workflows_enabled, autonomy_ceiling)
       VALUES ($1, true, 'act_and_report')`,
      [org],
    );
  }
  await c.query(
    `INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
       ($1, $3, 'AIN01 e2e admin A', $5, 'admin', true),
       ($2, $4, 'AIN01 e2e admin B', $6, 'admin', true)`,
    [adminA, adminB, orgA, orgB, `a-${runTag}@ain01.invalid`, `b-${runTag}@ain01.invalid`],
  );
  await c.query(
    `INSERT INTO public.agent_pause_rules (agent_code, tier, kill_scope) VALUES ($1, 'department', 'agent')`,
    [agent],
  );
  await c.query(
    `INSERT INTO public.wf_agent (agent_ref, family, codename, agent_tier, accountable, supervisor, pack_version,
       max_tier, context_ceiling, daily_actions, daily_model_calls, daily_cost_cap_minor)
     VALUES ($1, 'platform', 'Fixture', 'department', 'fixture', 'jarvis-executive', '1.0.0', 'T3', 'internal', $2, 0, 0)`,
    [agent, BUDGET],
  );
  await c.query(`INSERT INTO public.wf_agent_platform_grant (org_id, agent_ref) VALUES ($1, $2)`, [
    orgA,
    agent,
  ]);
  for (const [org, key, run] of [
    [orgA, "a", runIds.a],
    [orgB, "b", runIds.b],
  ]) {
    const def = crypto.randomUUID();
    const ver = crypto.randomUUID();
    await c.query(
      "INSERT INTO public.wf_definition (id, org_id, key, name) VALUES ($1, $2, $3, $4)",
      [def, org, `ain01-e2e-${runTag}-${key}`, `AIN01 e2e ${key}`],
    );
    await c.query(
      `INSERT INTO public.wf_version (id, org_id, definition_id, version, graph, created_by)
       VALUES ($1, $2, $3, 1, '{"steps":[]}', $4)`,
      [ver, org, def, author],
    );
    await c.query(
      `UPDATE public.wf_version SET state = 'published', published_by = $2 WHERE id = $1`,
      [ver, publisher],
    );
    await c.query(
      `UPDATE public.wf_definition SET current_version_id = $2, status = 'active' WHERE id = $1`,
      [def, ver],
    );
    await c.query(
      `INSERT INTO public.wf_run (id, org_id, definition_id, version_id, idempotency_key, status, max_depth,
         max_steps, step_count, started_by, deadline_at, started_at, agent_ref)
       VALUES ($1, $2, $3, $4, $5, 'running', 3, 500, 0, $6, now() + interval '1 hour', now(), $7)`,
      [run, org, def, ver, `ain01-e2e-run-${runTag}-${key}`, adminA, agent],
    );
  }
  await c.query("COMMIT");
}

/** One step, in its own transaction, as the service role. Returns "ok", "replay" or the refusal's SQLSTATE and text. */
async function insertStep(
  org,
  run,
  key,
  { kind = "action", cls = "internal", replay = false } = {},
) {
  const c = await connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE service_role");
    const res = await c.query(
      `INSERT INTO public.wf_step_run (org_id, run_id, step_key, kind, idempotency_key, action_class)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (org_id, idempotency_key) DO NOTHING`,
      [org, run, key, kind, `ain01-e2e-${runTag}-${key}`, cls],
    );
    await c.query("COMMIT");
    return { outcome: res.rowCount === 1 ? "ok" : "replay" };
  } catch (error) {
    await c.query("ROLLBACK").catch(() => {});
    return { outcome: "refused", code: error.code, message: String(error.message) };
  } finally {
    await c.end();
  }
}

const count = async (c, sql, params) => Number((await c.query(sql, params)).rows[0].n);

async function rpc(token, fn, body) {
  const response = await fetch(`http://127.0.0.1:${postgrestPort}/rpc/${fn}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${fn} over HTTP failed: ${response.status}`);
  return response.json();
}

async function main() {
  assertLocalEnvironment();
  const secret = fs.readFileSync(path.join(simDir, "load", ".jwt-secret"), "utf8").trim();
  const token = serviceRoleToken(secret);
  const admin = await connect();
  await setup(admin);
  const stepsOf = (org) =>
    count(admin, "SELECT count(*) n FROM public.wf_step_run WHERE org_id = $1 AND agent_ref = $2", [
      org,
      agent,
    ]);

  // A. budget under concurrency
  const keys = Array.from({ length: CONCURRENT }, (_, i) => `a${i}`);
  const first = await Promise.all(keys.map((k) => insertStep(orgA, runIds.a, k)));
  const inserted = first.filter((r) => r.outcome === "ok").length;
  const refused = first.filter((r) => r.outcome === "refused" && r.code === "54000").length;
  const otherFailures = first.length - inserted - refused;
  const overBudget = Math.max(0, (await stepsOf(orgA)) - BUDGET);
  const again = await Promise.all(keys.map((k) => insertStep(orgA, runIds.a, k)));
  const replayOk = again.filter((r) => r.outcome === "replay").length;
  const replayRefused = again.filter(
    (r, i) => first[i].outcome === "ok" && r.outcome !== "replay",
  ).length;
  const afterReplay = await stepsOf(orgA);

  // B. pause
  await admin.query(
    `INSERT INTO public.agent_pause_events (action, target, reason, actor_id) VALUES ('pause', $1, 'AIN01 e2e pause of one agent', $2)`,
    [agent, adminA],
  );
  const pausedKeys = Array.from({ length: 10 }, (_, i) => `p${i}`);
  const paused = await Promise.all(pausedKeys.map((k) => insertStep(orgA, runIds.a, k)));
  const pausedInserted = paused.filter((r) => r.outcome === "ok").length;
  const pausedRefusedRight = paused.filter(
    (r) => r.code === "42501" && r.message.includes("agent_paused"),
  ).length;
  await admin.query(
    `INSERT INTO public.agent_pause_events (action, target, reason, actor_id) VALUES ('resume', $1, 'AIN01 e2e resume of one agent', $2)`,
    [agent, adminA],
  );
  // Resumed, but the daily budget is spent: still refused, for the budget reason.
  const resumed = await insertStep(orgA, runIds.a, "resume-1");
  const resumedStillBudget = resumed.outcome === "refused" && resumed.code === "54000";

  // C. grant
  const ungranted = await Promise.all(
    Array.from({ length: 10 }, (_, i) => insertStep(orgB, runIds.b, `u${i}`)),
  );
  const ungrantedInserted = ungranted.filter((r) => r.outcome === "ok").length;
  const ungrantedRefusedRight = ungranted.filter((r) =>
    r.message?.includes("agent_not_granted"),
  ).length;

  // D. AI tripwire
  const ai = await insertStep(orgA, runIds.a, "ai-1", { kind: "ai", cls: "ai_model" });
  const aiInserted = await count(
    admin,
    "SELECT count(*) n FROM public.wf_step_run WHERE org_id = ANY($1) AND kind = 'ai'",
    [[orgA, orgB]],
  );
  const aiRefusedRight =
    ai.outcome === "refused" && ai.message.includes("ain01:ai_route_undecided");

  // E. read surface over HTTP
  const viewA = await rpc(token, "wf_agent_registry_get", { p_actor: adminA });
  const viewB = await rpc(token, "wf_agent_registry_get", { p_actor: adminB });
  const refsA = viewA.agents.map((a) => a.agent_ref);
  const refsB = viewB.agents.map((a) => a.agent_ref);
  const orgAgentsA = viewA.agents.filter((a) => a.family === "org").length;
  const orgAgentsB = viewB.agents.filter((a) => a.family === "org").length;
  const platformB = viewB.agents.filter((a) => a.family === "platform").length;
  const stepsShownA = viewA.agents.find((a) => a.agent_ref === agent)?.steps_24h ?? -1;
  const leak =
    (refsB.includes(agent) ? 1 : 0) +
    (refsA.includes("jarvis-executive") || refsB.includes("jarvis-executive") ? 1 : 0) +
    (platformB === 0 ? 0 : 1) +
    (stepsShownA === afterReplay ? 0 : 1) +
    (viewA.ai_route_approved === false && viewB.ai_route_approved === false ? 0 : 1);

  const sentLive = await count(
    admin,
    `SELECT (SELECT count(*) FROM public.wf_action_sandbox_outbox WHERE org_id = ANY($1))
          + (SELECT count(*) FROM public.wf_action_draft WHERE org_id = ANY($1)) n`,
    [[orgA, orgB]],
  );
  const dup = await count(
    admin,
    `SELECT count(*) n FROM (SELECT org_id, idempotency_key FROM public.wf_step_run
       WHERE org_id = ANY($1) GROUP BY 1, 2 HAVING count(*) > 1) d`,
    [[orgA, orgB]],
  );
  await admin.end();

  const failures = [];
  if (inserted !== BUDGET) failures.push(`inserted=${inserted} expected ${BUDGET}`);
  if (refused !== CONCURRENT - BUDGET) failures.push(`refused=${refused}`);
  if (otherFailures !== 0) failures.push(`other_failures=${otherFailures}`);
  if (overBudget !== 0) failures.push(`over_budget=${overBudget}`);
  if (replayOk !== BUDGET || replayRefused !== 0 || afterReplay !== BUDGET) failures.push("replay");
  if (pausedInserted !== 0 || pausedRefusedRight !== pausedKeys.length) failures.push("pause");
  if (!resumedStillBudget) failures.push("resume");
  if (ungrantedInserted !== 0 || ungrantedRefusedRight !== 10) failures.push("grant");
  if (aiInserted !== 0 || !aiRefusedRight) failures.push("ai");
  if (orgAgentsA !== 17 || orgAgentsB !== 17 || leak !== 0) failures.push("registry");
  if (sentLive !== 0 || dup !== 0) failures.push("sent_or_dup");
  const line =
    `AIN01-E2E RESULT: budget=${BUDGET} concurrent=${CONCURRENT} inserted=${inserted} refused=${refused} ` +
    `over_budget=${overBudget} replay_refused=${replayRefused} paused_inserted=${pausedInserted} ` +
    `ungranted_inserted=${ungrantedInserted} ai_inserted=${aiInserted} registry_org_agents=${orgAgentsA} ` +
    `cross_org_leak=${leak} sent_live=${sentLive} dup=${dup}`;
  console.log(line);
  if (failures.length) {
    console.error(`AIN01-E2E FAIL: ${failures.join(", ")}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`AIN01-E2E FAIL: ${error.message}`);
  process.exit(1);
});
