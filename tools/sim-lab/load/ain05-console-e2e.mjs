// AIN-05 agent console E2E against the local sim-lab Postgres (never a hosted database).
//
// What the SQL harness cannot show: the read models under real concurrency (alongside writes), tenant isolation over
// separate connections, and that reading never changes a row.
//   A  60 simultaneous reads of the three console views: all succeed and agree;
//   B  20 proposals decided at once by two managers while 40 more reads run: no read fails, nothing is pending after;
//   C  another organisation sees none of it; a person without a role is refused all three; clients cannot call them;
//   D  the reads changed no row in the memory, safety or autonomy tables.
//
// Nothing here calls a model, sends a message or reaches a network other than loopback. `sent_live` counts rows in the
// outbound tables for these organizations (none are created) and `dup` is computed from SQL.
import crypto from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const simDir = path.resolve(here, "..");
const { Client } = createRequire(path.join(simDir, "package.json"))("pg");
const host = process.env.SIM_PG_HOST || "127.0.0.1";
const port = Number(process.env.SIM_PG_PORT ?? 54329);
const runTag = crypto.randomBytes(4).toString("hex");
const POOL = 30;

const id = (prefix, n) => `${prefix}-0000-4000-8000-${runTag}${String(n).padStart(4, "0")}`;

function assertLocalEnvironment() {
  if (!/^(127\.0\.0\.1|::1|localhost)$/.test(host)) {
    throw new Error("AIN05 refuses a non-loopback Postgres host");
  }
}

async function connect() {
  const c = new Client({
    host,
    port,
    user: "postgres",
    database: process.env.SIM_PG_DB || "postgres",
  });
  await c.connect();
  return c;
}

const orgA = id("f4710000", 1);
const orgB = id("f4710000", 2);
const adminA = id("f4720000", 1);
const adminA2 = id("f4720000", 2);
const plain = id("f4720000", 3);
const adminB = id("f4720000", 4);
const author = id("f4720000", 5);
const publisher = id("f4720000", 6);
const run = id("f4730000", 1);
const AGENT = `ain05-e2e-${runTag}`;
const PROPOSALS = 20;

async function setup(c) {
  await c.query("BEGIN");
  for (const u of [adminA, adminA2, plain, adminB, author, publisher]) {
    await c.query("INSERT INTO auth.users (id) VALUES ($1)", [u]);
  }
  for (const [org, name] of [
    [orgA, "a"],
    [orgB, "b"],
  ]) {
    await c.query("INSERT INTO public.schools (id, name, slug) VALUES ($1, $2, $3)", [
      org,
      `AIN05 e2e org ${name}`,
      `ain05-e2e-${runTag}-${name}`,
    ]);
    await c.query(
      `INSERT INTO public.wf_org_settings (org_id, workflows_enabled, autonomy_ceiling)
       VALUES ($1, true, 'act_and_report')`,
      [org],
    );
  }
  for (const [u, org, name, role] of [
    [adminA, orgA, "admin-a", "admin"],
    [adminA2, orgA, "admin-a2", "admin"],
    [plain, orgA, "plain", "teacher"],
    [adminB, orgB, "admin-b", "admin"],
  ]) {
    await c.query(
      `INSERT INTO public.users (id, school_id, full_name, email, role, is_active)
       VALUES ($1, $2, 'AIN05 e2e person', $3, $4, true)`,
      [u, org, `${name}-${runTag}@ain05.invalid`, role],
    );
  }
  await c.query(
    `INSERT INTO public.agent_pause_rules (agent_code, tier, kill_scope) VALUES ($1, 'department', 'agent')`,
    [AGENT],
  );
  await c.query(
    `INSERT INTO public.wf_agent (agent_ref, family, codename, agent_tier, accountable, supervisor, pack_version,
       max_tier, context_ceiling, daily_actions, daily_model_calls, daily_cost_cap_minor)
     VALUES ($1, 'platform', 'E2E', 'department', 'fixture', 'jarvis-executive', '1.0.0', 'T3', 'internal', 100000, 0, 0)`,
    [AGENT],
  );
  await c.query(`INSERT INTO public.wf_agent_platform_grant (org_id, agent_ref) VALUES ($1, $2)`, [
    orgA,
    AGENT,
  ]);
  const def = crypto.randomUUID();
  const ver = crypto.randomUUID();
  await c.query("INSERT INTO public.wf_definition (id, org_id, key, name) VALUES ($1, $2, $3, $4)", [
    def,
    orgA,
    `ain05-e2e-${runTag}`,
    "AIN05 e2e",
  ]);
  await c.query(
    `INSERT INTO public.wf_version (id, org_id, definition_id, version, graph, created_by)
     VALUES ($1, $2, $3, 1, '{"steps":[]}', $4)`,
    [ver, orgA, def, author],
  );
  await c.query(`UPDATE public.wf_version SET state = 'published', published_by = $2 WHERE id = $1`, [ver, publisher]);
  await c.query(`UPDATE public.wf_definition SET current_version_id = $2, status = 'active' WHERE id = $1`, [def, ver]);
  await c.query(
    `INSERT INTO public.wf_run (id, org_id, definition_id, version_id, idempotency_key, status, max_depth, max_steps,
       step_count, started_by, deadline_at, started_at, agent_ref)
     VALUES ($1, $2, $3, $4, $5, 'running', 3, 500, 0, $6, now() + interval '1 hour', now(), $7)`,
    [run, orgA, def, ver, `ain05-e2e-run-${runTag}`, adminA, AGENT],
  );
  await c.query("COMMIT");
}

async function connectionAs(role, sub) {
  const c = await connect();
  await c.query("BEGIN");
  await c.query(`SET LOCAL ROLE ${role}`);
  if (sub) {
    await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [sub]);
    await c.query(
      `SELECT set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', $2::text)::text, true)`,
      [sub, role],
    );
  }
  return c;
}

/** Run one statement as the given role in its own connection and transaction. */
async function as(role, sql, params = [], sub = null) {
  const c = await connectionAs(role, sub);
  try {
    const res = await c.query(sql, params);
    await c.query("COMMIT");
    return { outcome: "ok", rows: res.rows };
  } catch (error) {
    await c.query("ROLLBACK").catch(() => {});
    return { outcome: "refused", code: error.code, message: String(error.message) };
  } finally {
    await c.end();
  }
}
const svc = (sql, params) => as("service_role", sql, params);

async function pooled(limit, tasks) {
  const results = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        results[i] = await tasks[i]();
      }
    }),
  );
  return results;
}

const agentsOf = (actor) => svc(`SELECT public.wf_console_agents($1) AS v`, [actor]);
const memoryOf = (actor, status = "proposed", limit = 100) =>
  svc(`SELECT public.wf_console_memory_list($1, $2, NULL, NULL, $3) AS v`, [actor, status, limit]);
const safetyOf = (actor) => svc(`SELECT public.wf_console_safety_list($1, 'all', NULL, NULL, 100) AS v`, [actor]);
const count = async (c, sql, params) => Number((await c.query(sql, params)).rows[0].n);
const ok = (rs) => rs.filter((r) => r.outcome === "ok").length;

async function main() {
  assertLocalEnvironment();
  const admin = await connect();
  await setup(admin);

  // Seed: proposals by the agent through the production function, a check for the safety view.
  const proposed = await pooled(
    10,
    Array.from({ length: PROPOSALS }, (_, i) => () =>
      svc(`SELECT public.wf_memory_agent_propose($1, 'agent', NULL, $2, $3::jsonb, NULL) AS v`, [
        run,
        `hint-${i}`,
        JSON.stringify({ text: `Note ${i}.` }),
      ]),
    ),
  );
  const seeded = ok(proposed);
  await svc(`SELECT public.wf_safety_run_eval()`);
  await svc(`SELECT public.wf_safety_check_text($1, 'draft', 'output', 'Write to ann@mail.example now.')`, [run]);

  const tables = `(SELECT count(*) FROM public.wf_memory_item) + (SELECT count(*) FROM public.wf_safety_check)
    + (SELECT count(*) FROM public.wf_safety_review) + (SELECT count(*) FROM public.wf_autonomy_change)
    + (SELECT count(*) FROM public.wf_agent_autonomy)`;
  const before = await count(admin, `SELECT ${tables} n`);

  // A. 60 simultaneous reads, 20 of each view: all succeed and agree.
  const reads = await pooled(POOL, [
    ...Array.from({ length: 20 }, () => () => agentsOf(adminA)),
    ...Array.from({ length: 20 }, () => () => memoryOf(adminA)),
    ...Array.from({ length: 20 }, () => () => safetyOf(adminA)),
  ]);
  const readOk = ok(reads);
  const agentCounts = new Set(reads.slice(0, 20).map((r) => r.rows?.[0]?.v?.agents?.length));
  const memCounts = new Set(reads.slice(20, 40).map((r) => r.rows?.[0]?.v?.items?.length));
  const consistent = agentCounts.size === 1 && memCounts.size === 1 && [...memCounts][0] === seeded;
  const afterReads = await count(admin, `SELECT ${tables} n`);

  // B. decide every proposal at once while more reads run.
  const items = (await memoryOf(adminA)).rows[0].v.items.map((i) => i.item_id);
  const pendingBefore = items.length;
  const mixed = await pooled(POOL, [
    ...items.map((item, i) => () =>
      svc(`SELECT public.wf_memory_decide($1, $2, $3) AS v`, [i % 2 ? adminA2 : adminA, item, i % 2 ? "reject" : "accept"]),
    ),
    ...Array.from({ length: 40 }, (_, i) => () => (i % 2 ? memoryOf(adminA2, "all") : agentsOf(adminA2))),
  ]);
  const decided = ok(mixed.slice(0, items.length));
  const readsFailed = mixed.slice(items.length).filter((r) => r.outcome !== "ok").length;
  const pendingAfter = (await memoryOf(adminA)).rows[0].v.items.length;

  // C. isolation and refusals.
  const other = [await agentsOf(adminB), await memoryOf(adminB, "all"), await safetyOf(adminB)];
  const tenantLeaks =
    (other[0].rows[0].v.agents.some((a) => a.agent_ref === AGENT) ? 1 : 0) +
    other[1].rows[0].v.items.length +
    other[2].rows[0].v.items.length;
  const plainRefused = [await agentsOf(plain), await memoryOf(plain), await safetyOf(plain)].filter(
    (r) => r.outcome === "refused" && r.code === "42501",
  ).length;
  const clientRefused = (
    await Promise.all([
      as("authenticated", `SELECT public.wf_console_agents($1)`, [adminA], adminA),
      as("authenticated", `SELECT public.wf_console_memory_list($1)`, [adminA], adminA),
      as("anon", `SELECT public.wf_console_safety_list($1)`, [adminA]),
    ])
  ).filter((r) => r.outcome === "refused" && r.code === "42501").length;

  // D. the reads changed no row. (The decisions in B are the only writes, and they are counted separately.)
  const readsChangedRows = afterReads - before;

  const sentLive = await count(
    admin,
    `SELECT (SELECT count(*) FROM public.wf_action_sandbox_outbox WHERE org_id = ANY($1))
          + (SELECT count(*) FROM public.wf_action_draft WHERE org_id = ANY($1)) n`,
    [[orgA, orgB]],
  );
  const dup = await count(
    admin,
    `SELECT count(*) n FROM (SELECT org_id, scope_kind, scope_ref, key FROM public.wf_memory_item
       WHERE org_id = ANY($1) AND status = 'active' GROUP BY 1, 2, 3, 4 HAVING count(*) > 1) d`,
    [[orgA, orgB]],
  );
  await admin.end();

  const failures = [];
  if (seeded !== PROPOSALS) failures.push(`seed ${seeded}`);
  if (readOk !== 60 || !consistent) failures.push(`A ok=${readOk} consistent=${consistent}`);
  if (decided !== PROPOSALS || readsFailed !== 0 || pendingAfter !== 0)
    failures.push(`B decided=${decided} readsFailed=${readsFailed} pendingAfter=${pendingAfter}`);
  if (tenantLeaks !== 0 || plainRefused !== 3 || clientRefused !== 3)
    failures.push(`C leaks=${tenantLeaks} plain=${plainRefused} client=${clientRefused}`);
  if (readsChangedRows !== 0) failures.push(`D changed=${readsChangedRows}`);
  if (sentLive !== 0 || dup !== 0) failures.push("sent_or_dup");

  console.log(
    `AIN05-E2E RESULT: concurrent_reads=60 read_ok=${readOk} proposals=${seeded} pending_before=${pendingBefore} ` +
      `decided=${decided} reads_during_decides_failed=${readsFailed} pending_after=${pendingAfter} ` +
      `tenant_leaks=${tenantLeaks} plain_refused=${plainRefused} client_refused=${clientRefused} ` +
      `reads_changed_rows=${readsChangedRows} sent_live=${sentLive} dup=${dup}`,
  );
  if (failures.length) {
    console.error(`AIN05-E2E FAIL: ${failures.join(", ")}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`AIN05-E2E FAIL: ${error.message}`);
  process.exit(1);
});
