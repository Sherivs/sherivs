// WF-01 SKIP LOCKED claim under real concurrency (LOCAL, DISPOSABLE ONLY).
// Needs real concurrent transactions, so the fixture is committed and removed again at the end.
// Run only against a loopback disposable database that already has the repository migrations:
//   cd tools/sim-lab && node ../../tests/integration/wf01-claim-concurrency.local.mjs
// Environment: SIM_PG_PORT (default 54329), SIM_PG_HOST (127.0.0.1), SIM_PG_USER (postgres), SIMDB (postgres).
// Prints "WF01-CONC PASS|FAIL: <name>" lines and "WF01-CONC RESULT: pass=N fail=M"; exits 1 on any failure.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pgDir = process.env.WF01_PG_DIR || path.resolve(here, "../../tools/sim-lab");
const { Client } = createRequire(path.join(pgDir, "package.json"))("pg");

const host = process.env.SIM_PG_HOST || "127.0.0.1";
const port = Number(process.env.SIM_PG_PORT ?? 54329);
const user = process.env.SIM_PG_USER || "postgres";
const database = process.env.SIMDB || "postgres";
if (!/^(127\.0\.0\.1|::1|localhost)$/.test(host))
  throw new Error(`WF01-CONC: refusing non-loopback host ${host}`);

const ORG = "f0200000-0000-4000-8000-0000000000a1";
const DEF = "f0210000-0000-4000-8000-0000000000a1";
const VER = "f0220000-0000-4000-8000-0000000000a1";
const RUN = "f0250000-0000-4000-8000-0000000000a1";
const STEPS = 400;
const WORKERS = 8;

const admin = new Client({ host, port, user, database });
await admin.connect();
const su = (await admin.query("select rolsuper from pg_roles where rolname = current_user")).rows[0]
  ?.rolsuper;
if (!su) throw new Error("WF01-CONC: must run as a superuser on a disposable DB");

const results = [];
function expect(name, ok, detail = "") {
  results.push(!!ok);
  console.log(`WF01-CONC ${ok ? "PASS" : "FAIL"}: ${name} [${detail}]`);
}

// Fixture rows are removed with triggers off (append-only and audit guards), which is why the
// script refuses anything but a local superuser on loopback.
async function cleanup() {
  await admin.query(`
    BEGIN;
    SET LOCAL session_replication_role = replica;
    DELETE FROM public.wf_step_run WHERE org_id = '${ORG}';
    DELETE FROM public.wf_run WHERE org_id = '${ORG}';
    UPDATE public.wf_definition SET current_version_id = NULL WHERE org_id = '${ORG}';
    DELETE FROM public.wf_version WHERE org_id = '${ORG}';
    DELETE FROM public.wf_definition WHERE org_id = '${ORG}';
    DELETE FROM public.audit_chain WHERE org_id = '${ORG}';
    COMMIT;`);
}

async function asService(client, sql, params) {
  await client.query("BEGIN");
  await client.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
  await client.query("SET LOCAL ROLE service_role");
  const r = await client.query(sql, params);
  await client.query("COMMIT");
  return r;
}

try {
  await cleanup();
  await asService(
    admin,
    `
    WITH d AS (INSERT INTO public.wf_definition (id, org_id, key, name) VALUES ('${DEF}', '${ORG}', 'conc', 'Concurrency') RETURNING id)
    INSERT INTO public.wf_version (id, org_id, definition_id, version, created_by, updated_by)
    SELECT '${VER}', '${ORG}', id, 1,
           'f0200000-0000-4000-8000-000000000001',
           'f0200000-0000-4000-8000-000000000002'
      FROM d`,
  );
  await asService(
    admin,
    `UPDATE public.wf_version
        SET state = 'published', published_by = 'f0200000-0000-4000-8000-000000000003'
      WHERE id = '${VER}'`,
  );
  await asService(
    admin,
    `
    INSERT INTO public.wf_run (id, org_id, definition_id, version_id, idempotency_key, status, started_at, max_depth, max_steps, deadline_at)
    VALUES ('${RUN}', '${ORG}', '${DEF}', '${VER}', 'conc-run-0001', 'running', now(), 0, 1000, now() + interval '1 hour')`,
  );
  await asService(
    admin,
    `
    INSERT INTO public.wf_step_run (org_id, run_id, step_key, iteration, kind, idempotency_key, next_attempt_at)
    SELECT '${ORG}', '${RUN}', 'step', g, 'action', 'conc-step-' || g, now() - interval '1 second'
      FROM generate_series(1, ${STEPS}) g`,
  );

  const clients = await Promise.all(
    Array.from({ length: WORKERS }, async () => {
      const c = new Client({ host, port, user, database });
      await c.connect();
      return c;
    }),
  );
  // Each worker claims in small batches inside a transaction that it holds briefly, so the
  // workers overlap and must skip each other's locked rows.
  const claimed = [];
  const started = Date.now();
  await Promise.all(
    clients.map(async (c, i) => {
      for (;;) {
        await c.query("BEGIN");
        await c.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
        await c.query("SET LOCAL ROLE service_role");
        const r = await c.query(
          "SELECT id, lease_owner FROM public.wf_claim_due_steps($1, 10, 60)",
          [`worker-${i}`],
        );
        await c.query("SELECT pg_sleep(0.01)");
        await c.query("COMMIT");
        if (r.rowCount === 0) break;
        for (const row of r.rows) claimed.push(row);
      }
    }),
  );
  const ms = Date.now() - started;
  await Promise.all(clients.map((c) => c.end()));

  const ids = new Set(claimed.map((r) => r.id));
  const owners = new Set(claimed.map((r) => r.lease_owner));
  expect("every due step claimed", ids.size === STEPS, `${ids.size}/${STEPS}`);
  expect(
    "no step claimed twice across workers",
    claimed.length === ids.size,
    `${claimed.length} claims`,
  );
  expect(
    "work spread over several workers (SKIP LOCKED, no blocking)",
    owners.size >= 2,
    `${owners.size} workers, ${ms} ms`,
  );
  const db = (
    await admin.query(
      `SELECT count(*) FILTER (WHERE status = 'claimed' AND attempt = 1)::int AS ok, count(*)::int AS total
       FROM public.wf_step_run WHERE org_id = $1`,
      [ORG],
    )
  ).rows[0];
  expect(
    "database agrees: each step claimed once with attempt 1",
    db.ok === STEPS && db.total === STEPS,
    `${db.ok}/${db.total}`,
  );
} finally {
  await cleanup();
  await admin.end();
}
const pass = results.filter(Boolean).length;
const fail = results.length - pass;
console.log(`WF01-CONC RESULT: pass=${pass} fail=${fail}`);
if (fail) process.exit(1);
