// AIN-03 tenant memory E2E against the local sim-lab Postgres (never a hosted database).
//
// What the SQL harness cannot show: the caps and the state machine under real concurrency, retention racing writes, and
// the privilege boundary over separate connections, each its own transaction as the service role.
//   A  60 simultaneous proposals by one agent: exactly 50 land (the daily cap), 10 are refused, 50 ledger rows;
//   B  30 simultaneous proposals of the SAME key by another agent: exactly 1 lands, 29 are refused;
//   C  20 simultaneous writes of one key by a manager: one live row, version 20, one write + 19 update ledger rows;
//   D  320 simultaneous writes into the organization scope (cap 300): exactly 300 land, 20 are refused, 300 live rows;
//   E  10 simultaneous acceptances of one proposal: one wins; 5 accepts racing 5 rejects of another: one decision only;
//   F  retention racing writes: 10 expired rows are purged exactly once by 3 simultaneous passes while 15 writes land;
//   G  the service role cannot read or write wf_memory_item directly; a member reads only their own organization.
//
// Nothing here calls a model, sends a message or reaches a network other than loopback. `sent_live` counts rows in the
// outbound tables for these organizations (this scenario creates none) and `dup` is computed from SQL.
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
const POOL = 40;

const id = (prefix, n) => `${prefix}-0000-4000-8000-${runTag}${String(n).padStart(4, "0")}`;

function assertLocalEnvironment() {
  if (!/^(127\.0\.0\.1|::1|localhost)$/.test(host)) {
    throw new Error("AIN03 refuses a non-loopback Postgres host");
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

const orgA = id("f3610000", 1);
const orgB = id("f3610000", 2);
const orgD = id("f3610000", 3);
const adminA = id("f3620000", 1);
const adminB = id("f3620000", 2);
const adminD = id("f3620000", 3);
const author = id("f3620000", 4);
const publisher = id("f3620000", 5);
const agent1 = `ain03-e2e-a-${runTag}`;
const agent2 = `ain03-e2e-b-${runTag}`;
const run1 = id("f3630000", 1);
const run2 = id("f3630000", 2);

async function setup(c) {
  await c.query("BEGIN");
  for (const u of [adminA, adminB, adminD, author, publisher]) {
    await c.query("INSERT INTO auth.users (id) VALUES ($1)", [u]);
  }
  for (const [org, name, admin] of [
    [orgA, "a", adminA],
    [orgB, "b", adminB],
    [orgD, "d", adminD],
  ]) {
    await c.query("INSERT INTO public.schools (id, name, slug) VALUES ($1, $2, $3)", [
      org,
      `AIN03 e2e org ${name}`,
      `ain03-e2e-${runTag}-${name}`,
    ]);
    await c.query(
      `INSERT INTO public.wf_org_settings (org_id, workflows_enabled, autonomy_ceiling)
       VALUES ($1, true, 'act_and_report')`,
      [org],
    );
    await c.query(
      `INSERT INTO public.users (id, school_id, full_name, email, role, is_active)
       VALUES ($1, $2, 'AIN03 e2e admin', $3, 'admin', true)`,
      [admin, org, `${name}-${runTag}@ain03.invalid`],
    );
  }
  for (const agent of [agent1, agent2]) {
    await c.query(
      `INSERT INTO public.agent_pause_rules (agent_code, tier, kill_scope) VALUES ($1, 'department', 'agent')`,
      [agent],
    );
    await c.query(
      `INSERT INTO public.wf_agent (agent_ref, family, codename, agent_tier, accountable, supervisor, pack_version,
         max_tier, context_ceiling, daily_actions, daily_model_calls, daily_cost_cap_minor)
       VALUES ($1, 'platform', 'Fixture', 'department', 'fixture', 'jarvis-executive', '1.0.0', 'T3', 'internal', 1000, 0, 0)`,
      [agent],
    );
    await c.query(
      `INSERT INTO public.wf_agent_platform_grant (org_id, agent_ref) VALUES ($1, $2)`,
      [orgA, agent],
    );
  }
  const def = crypto.randomUUID();
  const ver = crypto.randomUUID();
  await c.query(
    "INSERT INTO public.wf_definition (id, org_id, key, name) VALUES ($1, $2, $3, $4)",
    [def, orgA, `ain03-e2e-${runTag}`, "AIN03 e2e"],
  );
  await c.query(
    `INSERT INTO public.wf_version (id, org_id, definition_id, version, graph, created_by)
     VALUES ($1, $2, $3, 1, '{"steps":[]}', $4)`,
    [ver, orgA, def, author],
  );
  await c.query(
    `UPDATE public.wf_version SET state = 'published', published_by = $2 WHERE id = $1`,
    [ver, publisher],
  );
  await c.query(
    `UPDATE public.wf_definition SET current_version_id = $2, status = 'active' WHERE id = $1`,
    [def, ver],
  );
  for (const [run, agent, n] of [
    [run1, agent1, 1],
    [run2, agent2, 2],
  ]) {
    await c.query(
      `INSERT INTO public.wf_run (id, org_id, definition_id, version_id, idempotency_key, status, max_depth,
         max_steps, step_count, started_by, deadline_at, started_at, agent_ref)
       VALUES ($1, $2, $3, $4, $5, 'running', 3, 500, 0, $6, now() + interval '1 hour', now(), $7)`,
      [run, orgA, def, ver, `ain03-e2e-run-${runTag}-${n}`, adminA, agent],
    );
  }
  await c.query("COMMIT");
}

/** Run one statement as the service role in its own connection and transaction. */
async function asServiceRole(sql, params = []) {
  const c = await connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE service_role");
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

/** At most `limit` of these run at once, like a pool; every task is its own connection. */
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

const put = (actor, key, value = { plan_code: "e2e" }, scope = "organization", ref = "") =>
  asServiceRole(
    `SELECT public.wf_memory_put($1, $2, $3, $4, 'reference', $5::jsonb, 10, false) AS v`,
    [actor, scope, ref, key, JSON.stringify(value)],
  );
const propose = (run, key) =>
  asServiceRole(
    `SELECT public.wf_memory_agent_propose($1, 'agent', NULL, $2, '{"text":"e2e"}'::jsonb, NULL) AS v`,
    [run, key],
  );
const decide = (actor, item, decision) =>
  asServiceRole(`SELECT public.wf_memory_decide($1, $2, $3) AS v`, [actor, item, decision]);
const count = async (c, sql, params) => Number((await c.query(sql, params)).rows[0].n);
const ok = (rs) => rs.filter((r) => r.outcome === "ok").length;
const refusedWith = (rs, text) =>
  rs.filter((r) => r.outcome === "refused" && r.message.includes(text)).length;

async function main() {
  assertLocalEnvironment();
  const admin = await connect();
  await setup(admin);

  // A. one agent, 60 proposals at once, daily cap 50
  const a = await pooled(
    POOL,
    Array.from({ length: 60 }, (_, i) => () => propose(run1, `prop-${i}`)),
  );
  const proposed = ok(a);
  const overCapRefused = refusedWith(a, "agent_daily_proposals_exceeded");
  const proposeRows = await count(
    admin,
    `SELECT count(*) n FROM public.wf_memory_change WHERE org_id = $1 AND actor_agent = $2 AND op = 'propose'`,
    [orgA, agent1],
  );
  const overCap = proposeRows - 50;

  // B. another agent, 30 proposals of the same key
  const b = await pooled(
    POOL,
    Array.from({ length: 30 }, () => () => propose(run2, "same-key")),
  );
  const sameInserted = ok(b);
  const sameRefused = refusedWith(b, "key_exists");

  // C. a manager writes one key 20 times at once
  const c20 = await pooled(
    POOL,
    Array.from({ length: 20 }, (_, i) => () => put(adminA, "hot-key", { plan_code: `v${i}` })),
  );
  const putsOk = ok(c20);
  const hot = (
    await admin.query(
      `SELECT count(*)::int AS n, max(version)::int AS v FROM public.wf_memory_item
        WHERE org_id = $1 AND key = 'hot-key' AND status <> 'retired'`,
      [orgA],
    )
  ).rows[0];
  const hotWrite = await count(
    admin,
    `SELECT count(*) n FROM public.wf_memory_change c JOIN public.wf_memory_item i ON i.id = c.item_id
      WHERE i.org_id = $1 AND i.key = 'hot-key' AND c.op = 'write'`,
    [orgA],
  );
  const hotUpdate = await count(
    admin,
    `SELECT count(*) n FROM public.wf_memory_change c JOIN public.wf_memory_item i ON i.id = c.item_id
      WHERE i.org_id = $1 AND i.key = 'hot-key' AND c.op = 'update'`,
    [orgA],
  );

  // D. 320 writes into one organization scope that holds 300
  const d = await pooled(
    POOL,
    Array.from({ length: 320 }, (_, i) => () => put(adminD, `fill-${i}`)),
  );
  const orgInserted = ok(d);
  const orgRefused = refusedWith(d, "scope_is_full");
  const orgLive = await count(
    admin,
    `SELECT count(*) n FROM public.wf_memory_item WHERE org_id = $1 AND scope_kind = 'organization' AND status <> 'retired'`,
    [orgD],
  );

  // E. decisions race
  const propIds = (
    await admin.query(
      `SELECT id FROM public.wf_memory_item WHERE org_id = $1 AND source_agent = $2 AND status = 'proposed' ORDER BY key LIMIT 2`,
      [orgA, agent1],
    )
  ).rows.map((r) => r.id);
  const acc = await pooled(
    POOL,
    Array.from({ length: 10 }, () => () => decide(adminA, propIds[0], "accept")),
  );
  const accepted = ok(acc);
  const acceptRefused = refusedWith(acc, "not_a_pending_proposal");
  const mixed = await pooled(
    POOL,
    Array.from(
      { length: 10 },
      (_, i) => () => decide(adminA, propIds[1], i % 2 ? "accept" : "reject"),
    ),
  );
  const mixedWinners = ok(mixed);
  const finalStatus = (
    await admin.query(`SELECT status, decided_by FROM public.wf_memory_item WHERE id = $1`, [
      propIds[1],
    ])
  ).rows[0];
  const decisionRows = await count(
    admin,
    `SELECT count(*) n FROM public.wf_memory_change WHERE item_id = $1 AND op IN ('accept', 'reject')`,
    [propIds[1]],
  );

  // F. retention racing writes
  for (let i = 0; i < 10; i += 1) await put(adminA, `old-${i}`);
  const oldIds = (
    await admin.query(
      `SELECT id FROM public.wf_memory_item WHERE org_id = $1 AND key LIKE 'old-%'`,
      [orgA],
    )
  ).rows.map((r) => r.id);
  await admin.query("BEGIN");
  await admin.query("ALTER TABLE public.wf_memory_item DISABLE TRIGGER USER");
  await admin.query(
    `UPDATE public.wf_memory_item SET created_at = created_at - interval '3 days',
            expires_at = now() - interval '2 days' WHERE id = ANY($1)`,
    [oldIds],
  );
  await admin.query("ALTER TABLE public.wf_memory_item ENABLE TRIGGER USER");
  await admin.query("COMMIT");
  const liveBefore = await count(
    admin,
    `SELECT count(*) n FROM public.wf_memory_item WHERE org_id = $1 AND status <> 'retired' AND expires_at > now()`,
    [orgA],
  );
  const race = await Promise.all([
    ...Array.from({ length: 3 }, () =>
      asServiceRole(`SELECT public.wf_memory_purge_expired(500) AS v`),
    ),
    ...Array.from({ length: 15 }, (_, i) => put(adminA, `during-${i}`)),
  ]);
  const purgedTotal = race
    .slice(0, 3)
    .reduce((n, r) => n + (r.outcome === "ok" ? Number(r.rows[0].v.purged) : 0), 0);
  const purgeErrors = race.slice(0, 3).filter((r) => r.outcome !== "ok").length;
  const duringOk = ok(race.slice(3));
  const purgeLedger = await count(
    admin,
    `SELECT count(*) n FROM public.wf_memory_change WHERE org_id = $1 AND op = 'purge' AND item_id = ANY($2)`,
    [orgA, oldIds],
  );
  const oldLeft = await count(
    admin,
    `SELECT count(*) n FROM public.wf_memory_item WHERE id = ANY($1)`,
    [oldIds],
  );
  const liveAfter = await count(
    admin,
    `SELECT count(*) n FROM public.wf_memory_item WHERE org_id = $1 AND status <> 'retired' AND expires_at > now()`,
    [orgA],
  );

  // G. the privilege boundary over separate connections
  const direct = await Promise.all([
    asServiceRole(`SELECT count(*) FROM public.wf_memory_item`),
    asServiceRole(
      `INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_person, expires_at)
       VALUES ($1, 'organization', '', 'sneaky', 'reference', '{"a":"b"}', 'active', 'person', $2, now() + interval '1 day')`,
      [orgA, adminA],
    ),
    asServiceRole(`UPDATE public.wf_memory_item SET ai_readable = true`),
    asServiceRole(`DELETE FROM public.wf_memory_item`),
  ]);
  const directRefused = direct.filter((r) => r.outcome === "refused" && r.code === "42501").length;
  const member = await connect();
  await member.query("BEGIN");
  await member.query("SET LOCAL ROLE authenticated");
  await member.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [adminB]);
  await member.query(
    `SELECT set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
    [adminB],
  );
  const memberRows = (await member.query(`SELECT DISTINCT org_id FROM public.wf_memory_item`)).rows;
  await member.query("ROLLBACK");
  await member.end();
  const memberReadsOthers = memberRows.length;

  const sentLive = await count(
    admin,
    `SELECT (SELECT count(*) FROM public.wf_action_sandbox_outbox WHERE org_id = ANY($1))
          + (SELECT count(*) FROM public.wf_action_draft WHERE org_id = ANY($1)) n`,
    [[orgA, orgB, orgD]],
  );
  const dup = await count(
    admin,
    `SELECT count(*) n FROM (SELECT 1 FROM public.wf_memory_item WHERE org_id = ANY($1) AND status <> 'retired'
       GROUP BY org_id, scope_kind, scope_ref, key HAVING count(*) > 1) d`,
    [[orgA, orgB, orgD]],
  );
  await admin.end();

  const failures = [];
  if (proposed !== 50 || overCapRefused !== 10 || proposeRows !== 50 || overCap !== 0)
    failures.push(`A proposed=${proposed} refused=${overCapRefused} rows=${proposeRows}`);
  if (sameInserted !== 1 || sameRefused !== 29)
    failures.push(`B inserted=${sameInserted} refused=${sameRefused}`);
  if (putsOk !== 20 || hot.n !== 1 || hot.v !== 20 || hotWrite !== 1 || hotUpdate !== 19)
    failures.push(
      `C ok=${putsOk} live=${hot.n} version=${hot.v} write=${hotWrite} update=${hotUpdate}`,
    );
  if (orgInserted !== 300 || orgRefused !== 20 || orgLive !== 300)
    failures.push(`D inserted=${orgInserted} refused=${orgRefused} live=${orgLive}`);
  if (propIds.length !== 2 || accepted !== 1 || acceptRefused !== 9)
    failures.push(`E accepted=${accepted} refused=${acceptRefused}`);
  if (
    mixedWinners !== 1 ||
    decisionRows !== 1 ||
    !["active", "retired"].includes(finalStatus.status)
  )
    failures.push(
      `E mixed winners=${mixedWinners} decisions=${decisionRows} status=${finalStatus.status}`,
    );
  if (purgeErrors !== 0 || purgedTotal !== 10 || purgeLedger !== 10 || oldLeft !== 0)
    failures.push(
      `F purged=${purgedTotal} ledger=${purgeLedger} left=${oldLeft} errors=${purgeErrors}`,
    );
  if (duringOk !== 15 || liveAfter !== liveBefore + 15)
    failures.push(`F during=${duringOk} live ${liveBefore}->${liveAfter}`);
  if (directRefused !== 4 || memberReadsOthers !== 0)
    failures.push(`G direct=${directRefused} member=${memberReadsOthers}`);
  if (sentLive !== 0 || dup !== 0) failures.push("sent_or_dup");

  const line =
    `AIN03-E2E RESULT: proposals=60 proposed=${proposed} refused=${overCapRefused} over_cap=${overCap} ` +
    `same_key=30 same_key_inserted=${sameInserted} puts=20 live_after_puts=${hot.n} version_after_puts=${hot.v} ` +
    `org_scope_writes=320 org_scope_inserted=${orgInserted} org_scope_refused=${orgRefused} ` +
    `accepts=10 accepted=${accepted} mixed_winners=${mixedWinners} purged=${purgedTotal} writes_during_purge=${duringOk} ` +
    `direct_write_refused=${directRefused} member_sees_other_org=${memberReadsOthers} sent_live=${sentLive} dup=${dup}`;
  console.log(line);
  if (failures.length) {
    console.error(`AIN03-E2E FAIL: ${failures.join(", ")}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`AIN03-E2E FAIL: ${error.message}`);
  process.exit(1);
});
