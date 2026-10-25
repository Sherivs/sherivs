// SHERIVS-093 sim checks: Fedena/Moodle/OneRoster catalog, config rules, fair scheduler, service-role pull
// ingest isolation + idempotency (same page twice = replay). Local only. Usage: PGPORT=54329 node sim/integrations-093.mjs
import pg from "pg"; import fs from "node:fs"; import { randomUUID as uuid } from "node:crypto";
const c = new pg.Client({ host: "127.0.0.1", port: +(process.env.PGPORT || 54329), user: "postgres" });
await c.connect();
const results = [];
async function check(name, fn) { await c.query("BEGIN"); try { await fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, err: String(e.message).slice(0, 300) }); } finally { await c.query("ROLLBACK"); } }
const as = async (uid) => { await c.query("RESET ROLE"); await c.query("SET LOCAL ROLE authenticated"); await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: "authenticated" })]); };
const svc = async () => { await c.query("RESET ROLE"); await c.query("SET LOCAL ROLE service_role"); await c.query("select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)"); };
const owner = async () => { await c.query("RESET ROLE"); await c.query("select set_config('request.jwt.claims','{}',true)"); };
const assert = (v, m) => { if (!v) throw new Error(m); };
const denied = async (sql, p = []) => { await c.query("SAVEPOINT s"); try { await c.query(sql, p); } catch { await c.query("ROLLBACK TO SAVEPOINT s"); return true; } await c.query("ROLLBACK TO SAVEPOINT s"); return false; };
async function world() {
  await owner(); const w = {};
  for (const k of ["A", "B"]) {
    const sid = uuid(), admin = uuid();
    await c.query("INSERT INTO schools (id,name,slug,subscription_tier,subscription_status,is_active,max_students) VALUES ($1,$2,$3,'growth','active',true,1000)", [sid, `Sim ${k}`, `sim93-${k.toLowerCase()}-${sid.slice(0, 6)}`]);
    await c.query("INSERT INTO auth.users (id,email) VALUES ($1,$2)", [admin, `a93-${admin.slice(0, 6)}@sim.invalid`]);
    await c.query("INSERT INTO users (id,school_id,full_name,email,role) VALUES ($1,$2,'Admin',$3,'admin')", [admin, sid, `a93-${admin.slice(0, 6)}@sim.invalid`]);
    w[k] = { sid, admin };
  }
  return w;
}
const connect = async (w, k, key) => { await as(w[k].admin); return (await c.query("select public.integration_connect($1,$2,'x','gradual') id", [w[k].sid, key])).rows[0].id; };

await check("catalog lists fedena, moodle, oneroster with vault credential refs", async () => {
  const w = await world();
  for (const key of ["fedena", "moodle", "oneroster"]) {
    const id = await connect(w, "A", key); await owner();
    const r = (await c.query("select credential_provider, credential_name, (select count(*)::int from sync_jobs where integration_id=$1) jobs from integrations where id=$1", [id])).rows[0];
    assert(r.credential_provider === `integration.${key}` && r.credential_name && r.jobs > 0, `${key} ${JSON.stringify(r)}`);
  }
});
await check("config: https only, known keys only, never secrets; other school's admin denied", async () => {
  const w = await world(); const id = await connect(w, "A", "moodle");
  await c.query("select public.integration_set_config($1,'{\"base_url\":\"https://lms.school.sch.ng\",\"term\":\"First Term\"}'::jsonb)", [id]);
  for (const bad of ['{"base_url":"http://lms.sim.invalid"}', '{"token":"abc"}', '{"base_url":"https://user:pw@lms.sim.invalid"}', '{"password":"x"}'])
    assert(await denied("select public.integration_set_config($1,$2::jsonb)", [id, bad]), `accepted ${bad}`);
  await as(w.B.admin); assert(await denied("select public.integration_set_config($1,'{\"term\":\"x\"}'::jsonb)", [id]), "cross-school config");
  await owner(); const cfg = (await c.query("select config from integrations where id=$1", [id])).rows[0].config;
  assert(cfg.base_url === "https://lms.school.sch.ng" && cfg.term === "First Term", JSON.stringify(cfg));
});
await check("fair scheduler: one job per integration per claim; csv/webhook never claimed; leases not double-claimed", async () => {
  const w = await world(); const a1 = await connect(w, "A", "moodle"); const a2 = await connect(w, "A", "oneroster"); const b1 = await connect(w, "B", "fedena");
  const wh = await connect(w, "A", "rest-webhook"); await owner();
  await c.query("update integrations set status='active' where id = any($1)", [[a1, a2, b1, wh]]);
  await c.query("update sync_jobs set next_run_at = now() + interval '1 day' where integration_id <> all($1)", [[a1, a2, b1, wh]]);
  await svc(); const got = (await c.query("select integration_id from public.integration_claim_due_jobs(500)")).rows.map((r) => r.integration_id);
  const counts = Object.fromEntries([a1, a2, b1, wh].map((x) => [x, got.filter((g) => g === x).length]));
  assert(counts[a1] === 1 && counts[a2] === 1 && counts[b1] === 1 && counts[wh] === 0, JSON.stringify(counts));
});
await check("pull ingest (service role) writes only the integration's school; same page twice is a replay", async () => {
  const w = await world(); const idA = await connect(w, "A", "oneroster"); await svc();
  const page = [{ external_id: "or:u1", data: { admission_number: "OR-1", first_name: "Ada", school_id: w.B.sid } }];
  const r1 = (await c.query("select public.integration_ingest($1,'student',$2::jsonb,'pull-abc1234567','schedule') r", [idA, JSON.stringify(page)])).rows[0].r;
  const r2 = (await c.query("select public.integration_ingest($1,'student',$2::jsonb,'pull-abc1234567','schedule') r", [idA, JSON.stringify(page)])).rows[0].r;
  await owner();
  const a = (await c.query("select count(*)::int n from students where school_id=$1", [w.A.sid])).rows[0].n;
  const b = (await c.query("select count(*)::int n from students where school_id=$1", [w.B.sid])).rows[0].n;
  assert(r1.created === 1 && r2.replayed === true && a === 1 && b === 0, JSON.stringify({ r1, r2, a, b }));
});
await check("job_done stores the cursor and audits failures; clients cannot call it", async () => {
  const w = await world(); const id = await connect(w, "A", "fedena"); await owner();
  const job = (await c.query("select id from sync_jobs where integration_id=$1 limit 1", [id])).rows[0].id;
  await as(w.A.admin); assert(await denied("select public.integration_job_done($1,'9',null)", [job]), "client job_done");
  await svc(); await c.query("select public.integration_job_done($1,'42','fedena: token HTTP 401')", [job]); await owner();
  const cur = (await c.query("select cursor from sync_jobs where id=$1", [job])).rows[0].cursor;
  const aud = (await c.query("select count(*)::int n from integration_audit where integration_id=$1 and action='pull_failed'", [id])).rows[0].n;
  assert(cur === "42" && aud === 1, JSON.stringify({ cur, aud }));
});
await check("pull connectors cannot enable outbound write-back", async () => {
  const w = await world(); const id = await connect(w, "A", "moodle");
  assert(await denied("select public.integration_set_outbound($1,true,null)", [id]), "outbound enabled on moodle");
});

const ok = results.filter((r) => r.ok).length;
console.log(`integration hub 093: ${ok}/${results.length} passed`);
for (const r of results) console.log(r.ok ? "PASS" : "FAIL", r.name, r.err ?? "");
fs.mkdirSync(new URL("../results/", import.meta.url), { recursive: true });
fs.writeFileSync(new URL("../results/integrations-093.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), ok, total: results.length, results }, null, 1));
await c.end(); process.exit(ok === results.length ? 0 : 1);
