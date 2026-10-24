// SHERIVS-090 Integration Hub sim checks (local only). Usage: PGPORT=54329 node sim/integrations.mjs
// Self-contained: creates two synthetic schools (*.sim.invalid) inside a transaction per check and rolls back.
import pg from "pg"; import fs from "node:fs"; import { randomUUID as uuid } from "node:crypto";
const c = new pg.Client({ host: "127.0.0.1", port: +(process.env.PGPORT || 54329), user: "postgres" });
await c.connect();
const results = [];
async function check(name, fn) {
  await c.query("BEGIN");
  try { await fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: String(e.message).slice(0, 300) }); }
  finally { await c.query("ROLLBACK"); }
}
const as = async (uid) => { await c.query("RESET ROLE"); await c.query("SET LOCAL ROLE authenticated"); await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: "authenticated" })]); };
const svc = async () => { await c.query("RESET ROLE"); await c.query("SET LOCAL ROLE service_role"); await c.query("select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)"); };
const owner = async () => { await c.query("RESET ROLE"); await c.query("select set_config('request.jwt.claims','{}',true)"); };
const assert = (v, m) => { if (!v) throw new Error(m); };
const expectDenied = async (p, m) => { await c.query("SAVEPOINT x"); try { await p(); } catch { await c.query("ROLLBACK TO SAVEPOINT x"); return; } throw new Error(m); };

async function world() {
  await owner();
  const w = {};
  for (const k of ["A", "B"]) {
    const sid = uuid(), admin = uuid(), teacher = uuid();
    await c.query("INSERT INTO schools (id,name,slug,subscription_tier,subscription_status,is_active,max_students) VALUES ($1,$2,$3,'growth','active',true,1000)", [sid, `Sim School ${k}`, `sim-integ-${k.toLowerCase()}-${sid.slice(0, 6)}`]);
    for (const [u, r] of [[admin, "admin"], [teacher, "teacher"]]) {
      await c.query("INSERT INTO auth.users (id,email) VALUES ($1,$2)", [u, `${r}-${u.slice(0, 6)}@sim.invalid`]);
      await c.query("INSERT INTO users (id,school_id,full_name,email,role) VALUES ($1,$2,$3,$4,$5)", [u, sid, `Sim ${r}`, `${r}-${u.slice(0, 6)}@sim.invalid`, r]);
    }
    w[k] = { sid, admin, teacher };
  }
  return w;
}
const recs = (n, off = 0) => Array.from({ length: n }, (_, i) => ({ external_id: `EXT-${i + off}`, data: { admission_number: `ADM/${i + off}`, gender: i % 2 ? "female" : "male", first_name: `Ada${i}`, state_of_origin: "Lagos" } }));
const connect = async (w, k, conn = "rest-webhook", mode = "gradual") => { await as(w[k].admin); return (await c.query("select public.integration_connect($1,$2,$3,$4) id", [w[k].sid, conn, `Legacy SIS ${k}`, mode])).rows[0].id; };
const ingest = async (id, records, key, trig = "manual") => (await c.query("select public.integration_ingest($1,'student',$2::jsonb,$3,$4) r", [id, JSON.stringify(records), key, trig])).rows[0].r;

await check("catalog seeded with csv, rest-webhook, google-classroom", async () => {
  const w = await world(); await as(w.A.admin);
  const k = (await c.query("select key from connector_manifests order by key")).rows.map((r) => r.key).join(",");
  assert(k === "csv,google-classroom,rest-webhook", k);
});
await check("connect stores a vault reference, never a secret", async () => {
  const w = await world(); const id = await connect(w, "A"); await owner();
  const r = (await c.query("select * from integrations where id=$1", [id])).rows[0];
  assert(r.credential_provider === "integration.rest-webhook" && /^[0-9a-f]{32}$/.test(r.credential_name), "vault ref");
  const cols = (await c.query("select column_name from information_schema.columns where table_name='integrations'")).rows.map((x) => x.column_name);
  assert(!cols.some((x) => /secret|password|token|api_key/.test(x)), "secret-like column present");
});
await check("teacher cannot connect an integration", async () => {
  const w = await world(); await as(w.A.teacher);
  await expectDenied(() => c.query("select public.integration_connect($1,'csv','x','mirror')", [w.A.sid]), "teacher connected");
});
await check("tenant isolation: school A admin cannot connect for school B", async () => {
  const w = await world(); await as(w.A.admin);
  await expectDenied(() => c.query("select public.integration_connect($1,'csv','x','mirror')", [w.B.sid]), "cross-school connect");
});
await check("tenant isolation: school A admin cannot ingest via school B's integration", async () => {
  const w = await world(); const idB = await connect(w, "B"); await as(w.A.admin);
  await expectDenied(() => ingest(idB, recs(3), "cross-key-0001"), "cross-school ingest");
  await owner(); assert((await c.query("select count(*)::int n from students where school_id=$1", [w.B.sid])).rows[0].n === 0, "B got rows");
});
await check("tenant isolation: payload school_id is ignored; rows land only in the integration's school", async () => {
  const w = await world(); const idA = await connect(w, "A"); await svc();
  const evil = recs(5).map((r) => ({ ...r, school_id: w.B.sid, data: { ...r.data, school_id: w.B.sid } }));
  await ingest(idA, evil, "evil-payload-01", "webhook"); await owner();
  const a = (await c.query("select count(*)::int n from students where school_id=$1", [w.A.sid])).rows[0].n;
  const b = (await c.query("select count(*)::int n from students where school_id=$1", [w.B.sid])).rows[0].n;
  const leak = (await c.query("select count(*)::int n from external_id_map m join integrations i on i.id=m.integration_id where m.school_id<>i.school_id")).rows[0].n;
  assert(a === 5 && b === 0 && leak === 0, `A=${a} B=${b} leak=${leak}`);
});
await check("tenant isolation: RLS hides school B runs, maps and audit from school A admin", async () => {
  const w = await world(); const idB = await connect(w, "B"); await ingest(idB, recs(4), "b-run-000001");
  await as(w.A.admin);
  for (const t of ["integrations", "sync_runs", "external_id_map", "integration_audit", "sync_jobs"]) {
    const n = (await c.query(`select count(*)::int n from ${t} where school_id=$1`, [w.B.sid])).rows[0].n; assert(n === 0, `${t} leaked ${n}`);
  }
  await expectDenied(() => c.query("select * from integration_records limit 1"), "raw records readable by client");
  await as(w.B.admin); assert((await c.query("select count(*)::int n from sync_runs")).rows[0].n === 1, "B cannot see own run");
});
await check("tenant isolation: no direct client writes to hub tables", async () => {
  const w = await world(); const idA = await connect(w, "A"); await as(w.A.admin);
  await expectDenied(() => c.query("update integrations set school_id=$1 where id=$2", [w.B.sid, idA]), "direct update allowed");
  await expectDenied(() => c.query("insert into external_id_map (school_id,integration_id,entity,external_id,payload_hash) values ($1,$2,'student','x','h')", [w.B.sid, idA]), "direct insert allowed");
});
await check("tenant isolation: natural-key match never crosses schools", async () => {
  const w = await world(); await owner();
  await c.query("insert into students (school_id, admission_number) values ($1,'ADM/0')", [w.B.sid]);
  const idA = await connect(w, "A"); const r = await ingest(idA, recs(1), "nk-cross-0001"); await owner();
  const m = (await c.query("select s.school_id from external_id_map m join students s on s.id=m.sherivs_id where m.integration_id=$1", [idA])).rows[0];
  assert(r.created === 1 && m.school_id === w.A.sid, JSON.stringify(r));
});
await check("idempotent re-sync: same payload twice -> 0 new rows, all unchanged", async () => {
  const w = await world(); const idA = await connect(w, "A");
  const r1 = await ingest(idA, recs(50), "sync-0000001"); const r2 = await ingest(idA, recs(50), "sync-0000002"); await owner();
  const n = (await c.query("select count(*)::int n from students where school_id=$1", [w.A.sid])).rows[0].n;
  assert(r1.created === 50 && r2.created === 0 && r2.unchanged === 50 && n === 50, JSON.stringify({ r1, r2, n }));
});
await check("idempotent replay: same idempotency key returns the original run, no writes", async () => {
  const w = await world(); const idA = await connect(w, "A");
  const r1 = await ingest(idA, recs(10), "replay-000001"); const r2 = await ingest(idA, recs(10, 100), "replay-000001"); await owner();
  const runs = (await c.query("select count(*)::int n from sync_runs where integration_id=$1", [idA])).rows[0].n;
  const n = (await c.query("select count(*)::int n from students where school_id=$1", [w.A.sid])).rows[0].n;
  assert(r2.replayed === true && r2.run_id === r1.run_id && runs === 1 && n === 10, JSON.stringify({ r2, runs, n }));
});
await check("changed record updates in place (no duplicate student)", async () => {
  const w = await world(); const idA = await connect(w, "A");
  await ingest(idA, recs(3), "chg-0000001");
  const changed = recs(3); changed[1].data.state_of_origin = "Kano";
  const r = await ingest(idA, changed, "chg-0000002"); await owner();
  const n = (await c.query("select count(*)::int n from students where school_id=$1", [w.A.sid])).rows[0].n;
  const kano = (await c.query("select count(*)::int n from students where school_id=$1 and state_of_origin='Kano'", [w.A.sid])).rows[0].n;
  assert(r.updated === 1 && r.unchanged === 2 && n === 3 && kano === 1, JSON.stringify({ r, n, kano }));
});
await check("dedupe: existing Sherivs student matched by admission number", async () => {
  const w = await world(); await owner();
  const sid = (await c.query("insert into students (school_id, admission_number) values ($1,'ADM/0') returning id", [w.A.sid])).rows[0].id;
  const idA = await connect(w, "A"); await ingest(idA, recs(1), "dedupe-00001"); await owner();
  const m = (await c.query("select sherivs_id, match_method from external_id_map where integration_id=$1", [idA])).rows[0];
  const n = (await c.query("select count(*)::int n from students where school_id=$1", [w.A.sid])).rows[0].n;
  assert(m.sherivs_id === sid && m.match_method === "natural_key" && n === 1, JSON.stringify({ m, n }));
});
await check("mirror mode stages records but never writes core tables", async () => {
  const w = await world(); const idA = await connect(w, "A", "csv", "mirror"); await ingest(idA, recs(5), "mirror-00001", "csv_upload"); await owner();
  const n = (await c.query("select count(*)::int n from students where school_id=$1", [w.A.sid])).rows[0].n;
  const s = (await c.query("select count(*)::int n from integration_records where integration_id=$1", [idA])).rows[0].n;
  assert(n === 0 && s === 5, `students=${n} staged=${s}`);
});
await check("system-of-record = sherivs blocks inbound overwrite", async () => {
  const w = await world(); const idA = await connect(w, "A");
  await c.query("select public.integration_update($1,null,null,'{\"student\":\"sherivs\"}'::jsonb)", [idA]);
  await ingest(idA, recs(2), "sor-00000001"); await owner();
  assert((await c.query("select count(*)::int n from students where school_id=$1", [w.A.sid])).rows[0].n === 0, "core written");
});
await check("per-school limit: oversize batch rejected and audited", async () => {
  const w = await world(); const idA = await connect(w, "A"); await owner();
  await c.query("update integrations set max_records_per_run=5 where id=$1", [idA]); await as(w.A.admin);
  const r = await ingest(idA, recs(6), "limit-000001"); await owner();
  const a = (await c.query("select count(*)::int n from integration_audit where integration_id=$1 and action='run_rejected'", [idA])).rows[0].n;
  assert(r.status === "rejected" && a === 1, JSON.stringify(r));
});
await check("audit trail is append-only", async () => {
  const w = await world(); const idA = await connect(w, "A"); await owner();
  await expectDenied(() => c.query("delete from integration_audit where integration_id=$1", [idA]), "audit deleted");
  await expectDenied(() => c.query("update integration_audit set action='x' where integration_id=$1", [idA]), "audit updated");
});
await check("webhook target lookup is service_role only", async () => {
  const w = await world(); const idA = await connect(w, "A"); await owner();
  const wh = (await c.query("select webhook_id from integrations where id=$1", [idA])).rows[0].webhook_id;
  await as(w.A.admin); await expectDenied(() => c.query("select * from public.integration_webhook_target($1)", [wh]), "client could resolve webhook");
  await svc(); const t = (await c.query("select * from public.integration_webhook_target($1)", [wh])).rows[0];
  assert(t.school_id === w.A.sid, "target");
});
await check("scheduler claims due jobs once (SKIP LOCKED / next_run_at advance)", async () => {
  const w = await world(); const idA = await connect(w, "A"); await ingest(idA, recs(1), "sched-000001");
  await owner(); await c.query("update sync_jobs set next_run_at = now() + interval '1 day' where integration_id <> $1", [idA]); // isolate from other data in the DB
  await svc();
  const a = (await c.query("select * from public.integration_claim_due_jobs(500)")).rows.filter((j) => j.integration_id === idA).length;
  const b = (await c.query("select * from public.integration_claim_due_jobs(500)")).rows.filter((j) => j.integration_id === idA).length;
  const want = (await c.query("select cardinality(entities) n from connector_manifests where key='rest-webhook'")).rows[0].n;
  assert(a === want && b === 0, `first=${a} want=${want} second=${b}`);
});

const ok = results.filter((r) => r.ok).length;
console.log(`integration hub: ${ok}/${results.length} passed`);
for (const r of results) console.log(r.ok ? "PASS" : "FAIL", r.name, r.err ?? "");
fs.mkdirSync(new URL("../results/", import.meta.url), { recursive: true });
fs.writeFileSync(new URL("../results/integrations-090.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), ok, total: results.length, results }, null, 1));
await c.end(); process.exit(ok === results.length ? 0 : 1);
