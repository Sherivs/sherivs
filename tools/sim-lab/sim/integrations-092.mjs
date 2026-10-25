// SHERIVS-092 sim checks: every entity writer in gradual mode, tenant isolation of references,
// idempotent re-sync per entity, payments immutable, outbound capture + echo suppression + worker ack.
// Local only. Usage: PGPORT=54329 node sim/integrations-092.mjs
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
const one = async (sql, p = []) => (await c.query(sql, p)).rows[0];
const n = async (sql, p = []) => (await one(sql, p)).n;

async function world() {
  await owner(); const w = {};
  for (const k of ["A", "B"]) {
    const sid = uuid(), admin = uuid(), teacher = uuid(), parent = uuid();
    await c.query("INSERT INTO schools (id,name,slug,subscription_tier,subscription_status,is_active,max_students) VALUES ($1,$2,$3,'growth','active',true,1000)", [sid, `Sim ${k}`, `sim92-${k.toLowerCase()}-${sid.slice(0, 6)}`]);
    for (const [u, r, e, ph] of [[admin, "admin", `admin-${sid.slice(0, 4)}@sim.invalid`, null], [teacher, "teacher", `t-${sid.slice(0, 4)}@sim.invalid`, null], [parent, "parent", null, "+2348030000001"]]) {
      await c.query("INSERT INTO auth.users (id,email) VALUES ($1,$2)", [u, e ?? `${u}@sim.invalid`]);
      await c.query("INSERT INTO users (id,school_id,full_name,email,role,phone) VALUES ($1,$2,$3,$4,$5,$6)", [u, sid, `Sim ${r}`, e, r, ph]);
    }
    await c.query("INSERT INTO courses (school_id, code, title, credit_units, level, semester) VALUES ($1,'MTH101','Maths',3,'100L','First')", [sid]);
    w[k] = { sid, admin, teacher, parent, temail: `t-${sid.slice(0, 4)}@sim.invalid` };
  }
  return w;
}
const connect = async (w, k, mode = "gradual") => { await as(w[k].admin); return (await one("select public.integration_connect($1,'rest-webhook','SIS',$2) id", [w[k].sid, mode])).id; };
const ingest = async (id, entity, records, key) => (await one("select public.integration_ingest($1,$2,$3::jsonb,$4,'manual') r", [id, entity, JSON.stringify(records), key])).r;
const R = (ext, data) => ({ external_id: ext, data });

async function seed(w, k, id) {
  await ingest(id, "class", [R("C1", { name: "JSS1A", level: "JSS1", arm: "A", academic_year: "2025/2026" })], `cls-${k}-0001`);
  await ingest(id, "student", [R("S1", { admission_number: "ADM/1", gender: "female" }), R("S2", { admission_number: "ADM/2", gender: "male" })], `stu-${k}-0001`);
}

await check("class + student + enrollment (class) are written in gradual mode", async () => {
  const w = await world(); const id = await connect(w, "A"); await seed(w, "A", id);
  const r = await ingest(id, "enrollment", [R("E1", { student_external_id: "S1", class_external_id: "C1" }), R("E2", { admission_number: "ADM/2", class_name: "JSS1A" })], "enr-000001");
  await owner();
  assert(r.created === 2 && r.errors === 0, JSON.stringify(r));
  assert(await n("select count(*)::int n from students s join classes c on c.id=s.class_id where s.school_id=$1 and c.name='JSS1A'", [w.A.sid]) === 2, "class_id");
});
await check("tertiary enrollment -> approved course registration", async () => {
  const w = await world(); const id = await connect(w, "A"); await seed(w, "A", id);
  const r = await ingest(id, "enrollment", [R("CR1", { student_external_id: "S1", course_code: "mth101", session: "2025/2026", semester: "First" })], "enr-000002");
  await owner(); assert(r.created === 1, JSON.stringify(r));
  assert(await n("select count(*)::int n from course_registrations where school_id=$1 and status='approved'", [w.A.sid]) === 1, "reg");
});
await check("results upsert into grades UNPUBLISHED; re-sync is a no-op; change updates in place", async () => {
  const w = await world(); const id = await connect(w, "A"); await seed(w, "A", id);
  const rs = [R("G1", { student_external_id: "S1", subject: "Mathematics", term: "First Term", academic_year: "2025/2026", ca_score: 30, exam_score: 55 })];
  const a = await ingest(id, "result", rs, "res-000001"); const b = await ingest(id, "result", rs, "res-000002");
  rs[0].data.exam_score = 60; const c2 = await ingest(id, "result", rs, "res-000003"); await owner();
  const g = await one("select count(*)::int n, max(exam_score)::int e, bool_or(is_published) p from grades where school_id=$1", [w.A.sid]);
  assert(a.created === 1 && b.unchanged === 1 && c2.updated === 1 && g.n === 1 && g.e === 60 && g.p === false, JSON.stringify({ a, b, c2, g }));
});
await check("fee invoice + payment: offline_payments row, fee becomes paid; payment replay never double-counts", async () => {
  const w = await world(); const id = await connect(w, "A"); await seed(w, "A", id);
  await ingest(id, "fee_invoice", [R("INV1", { student_external_id: "S1", fee_type: "Tuition", amount_naira: 50000, term: "First Term", academic_year: "2025/2026" })], "fee-000001");
  const p = [R("PAY1", { invoice_external_id: "INV1", amount_naira: 20000, reference: "BANK-1", channel: "bank_deposit" }), R("PAY2", { invoice_external_id: "INV1", amount_naira: 30000, reference: "BANK-2", channel: "pos" })];
  await ingest(id, "payment", p, "pay-000001"); await ingest(id, "payment", p, "pay-000002");
  const changed = [R("PAY1", { invoice_external_id: "INV1", amount_naira: 99999, reference: "BANK-1" })];
  const x = await ingest(id, "payment", changed, "pay-000003"); await owner();
  const f = await one("select paid_amount::int pa, status from fees where school_id=$1", [w.A.sid]);
  const op = await n("select count(*)::int n from offline_payments where school_id=$1", [w.A.sid]);
  assert(f.pa === 50000 && f.status === "paid" && op === 2 && x.conflicts === 1, JSON.stringify({ f, op, x }));
});
await check("staff: existing account linked by email; unknown staff becomes an invite, never an auth account", async () => {
  const w = await world(); const id = await connect(w, "A");
  const r = await ingest(id, "staff", [R("ST1", { email: w.A.temail.toUpperCase(), qualification: "B.Ed" }), R("ST2", { first_name: "Ngozi", last_name: "Eze", email: "new@sim.invalid", role: "teacher" })], "stf-000001");
  await owner();
  const m = await one("select sherivs_id from external_id_map where integration_id=$1 and external_id='ST1'", [id]);
  const inv = await n("select count(*)::int n from integration_account_invites where integration_id=$1 and status='pending'", [id]);
  const q = await one("select qualification from users where id=$1", [w.A.teacher]);
  const au = await n("select count(*)::int n from auth.users where email='new@sim.invalid'");
  assert(r.created === 2 && m.sherivs_id === w.A.teacher && inv === 1 && q.qualification === "B.Ed" && au === 0, JSON.stringify({ r, m, inv, q, au }));
});
await check("guardian: existing parent (by phone) linked to the student via parent_student_map", async () => {
  const w = await world(); const id = await connect(w, "A"); await seed(w, "A", id);
  await ingest(id, "guardian", [R("P1", { phone: "+2348030000001", student_external_id: "S1", relationship: "mother" })], "grd-000001"); await owner();
  assert(await n("select count(*)::int n from parent_student_map where school_id=$1 and parent_id=$2", [w.A.sid, w.A.parent]) === 1, "map");
});
await check("tenant isolation: references never resolve across schools (B's student/parent/course/staff invisible to A)", async () => {
  const w = await world(); const idB = await connect(w, "B"); await seed(w, "B", idB);
  const idA = await connect(w, "A");
  const r1 = await ingest(idA, "result", [R("X1", { student_external_id: "S1", subject: "Eng", term: "First Term", academic_year: "2025/2026", ca_score: 10 }), R("X2", { admission_number: "ADM/1", subject: "Eng", term: "First Term", academic_year: "2025/2026", ca_score: 10 })], "iso-000001");
  const r2 = await ingest(idA, "guardian", [R("X3", { phone: "+2348030000001", admission_number: "ADM/1" })], "iso-000002");
  const r3 = await ingest(idA, "staff", [R("X4", { email: w.B.temail })], "iso-000003");
  await owner();
  const gB = await n("select count(*)::int n from grades where school_id=$1", [w.B.sid]);
  const pB = await n("select count(*)::int n from parent_student_map where school_id=$1", [w.B.sid]);
  const linked = await one("select sherivs_id from external_id_map where integration_id=$1 and external_id='X4'", [idA]);
  const leak = await n("select count(*)::int n from external_id_map m join integrations i on i.id=m.integration_id where m.school_id<>i.school_id");
  assert(r1.errors === 2 && gB === 0 && pB === 0 && linked.sherivs_id === null && leak === 0, JSON.stringify({ r1, r2, r3, gB, pB, linked, leak }));
});
await check("one bad row does not fail the batch (per-record subtransaction)", async () => {
  const w = await world(); const id = await connect(w, "A"); await seed(w, "A", id);
  const r = await ingest(id, "result", [R("OK1", { student_external_id: "S1", subject: "Bio", term: "T1", academic_year: "2025/2026", ca_score: 20 }), R("BAD", { student_external_id: "S1", subject: "Chem", term: "T1", academic_year: "2025/2026", ca_score: 90, exam_score: 90 })], "bad-000001");
  assert(r.created === 1 && r.errors === 1 && r.status === "partial", JSON.stringify(r));
});
await check("outbound: Sherivs-owned edits are queued once (coalesced); ingest writes are not echoed", async () => {
  const w = await world(); const id = await connect(w, "A"); await seed(w, "A", id);
  await c.query("select public.integration_update($1,null,null,'{\"result\":\"sherivs\"}'::jsonb)", [id]);
  await c.query("select public.integration_set_outbound($1,true,'{\"outbound_url\":\"https://legacy.sim.invalid/hook\"}'::jsonb)", [id]);
  await owner(); const st = (await one("select id from students where school_id=$1 and admission_number='ADM/1'", [w.A.sid])).id;
  const g = (await one("insert into grades (school_id,student_id,subject,ca_score,term,academic_year) values ($1,$2,'Physics',20,'T1','2025/2026') returning id", [w.A.sid, st])).id;
  await c.query("update grades set exam_score=50 where id=$1", [g]);
  const q = await n("select count(*)::int n from integration_outbox where integration_id=$1 and entity='result' and status='pending'", [id]);
  const p = await one("select payload from integration_outbox where integration_id=$1 and entity='result'", [id]);
  const echo = await n("select count(*)::int n from integration_outbox where integration_id=$1 and entity='student'", [id]);
  assert(q === 1 && Number(p.payload.exam_score) === 50 && p.payload.admission_number === "ADM/1" && echo === 0, JSON.stringify({ q, p, echo }));
});
await check("outbound: config rejects secrets and non-https; teacher cannot enable outbound", async () => {
  const w = await world(); const id = await connect(w, "A");
  for (const cfg of ['{"api_key":"x"}', '{"outbound_url":"http://x.sim.invalid"}']) {
    await c.query("SAVEPOINT s"); let threw = false;
    try { await c.query("select public.integration_set_outbound($1,true,$2::jsonb)", [id, cfg]); } catch { threw = true; }
    await c.query("ROLLBACK TO SAVEPOINT s"); assert(threw, `accepted ${cfg}`);
  }
  await as(w.A.teacher); await c.query("SAVEPOINT s"); let t = false;
  try { await c.query("select public.integration_set_outbound($1,true,null)", [id]); } catch { t = true; } await c.query("ROLLBACK TO SAVEPOINT s"); assert(t, "teacher enabled outbound");
});
await check("outbound worker: claim leases (SKIP LOCKED), ack records external id, failures back off then dead-letter", async () => {
  const w = await world(); const id = await connect(w, "A"); await seed(w, "A", id);
  await c.query("select public.integration_update($1,null,null,'{\"fee_invoice\":\"sherivs\"}'::jsonb)", [id]);
  await c.query("select public.integration_set_outbound($1,true,null)", [id]); await owner();
  const st = (await one("select id from students where school_id=$1 and admission_number='ADM/2'", [w.A.sid])).id;
  await c.query("insert into fees (school_id,student_id,fee_type,amount) values ($1,$2,'Bus',5000),($1,$2,'Lab',2000)", [w.A.sid, st]);
  await svc(); const a = (await c.query("select * from public.integration_outbox_claim(500)")).rows.filter((x) => x.integration_id === id).sort((x, y) => Number(x.id) - Number(y.id));
  const b = (await c.query("select * from public.integration_outbox_claim(500)")).rows.filter((x) => x.integration_id === id);
  await c.query("select public.integration_outbox_ack($1,true,null,'LEG-77')", [a[0].id]);
  for (let k = 0; k < 9; k++) { await owner(); await c.query("update integration_outbox set next_attempt_at=now(), attempts=attempts+1 where id=$1 and status='pending'", [a[1].id]); await svc(); await c.query("select public.integration_outbox_ack($1,false,'HTTP 500')", [a[1].id]); }
  await owner();
  const s = (await c.query("select status from integration_outbox where id = any($1) order by id", [[a[0].id, a[1].id]])).rows.map((x) => x.status).join(",");
  const mapped = await n("select count(*)::int n from external_id_map where integration_id=$1 and external_id='LEG-77' and match_method='outbound'", [id]);
  assert(a.length === 2 && b.length === 0 && s === "sent,dead" && mapped === 1, JSON.stringify({ a: a.length, b: b.length, s, mapped }));
});
await check("outbound worker functions are service_role only; RLS hides other schools' outbox/invites", async () => {
  const w = await world(); const idB = await connect(w, "B");
  await ingest(idB, "staff", [R("Z", { email: "z@sim.invalid" })], "inv-b-0001");
  await as(w.A.admin);
  for (const f of ["select * from public.integration_outbox_claim(1)", "select public.integration_outbox_ack(1,true)", "select public.integration_job_done(gen_random_uuid(),null)"]) {
    await c.query("SAVEPOINT s"); let t = false; try { await c.query(f); } catch { t = true; } await c.query("ROLLBACK TO SAVEPOINT s"); assert(t, f);
  }
  assert(await n("select count(*)::int n from integration_account_invites") === 0, "invites leaked");
  await as(w.B.admin); assert(await n("select count(*)::int n from integration_account_invites") === 1, "B cannot see own invite");
});
await check("mirror mode still writes nothing to core for every entity", async () => {
  const w = await world(); const id = await connect(w, "A", "mirror");
  await ingest(id, "class", [R("C1", { name: "SS1" })], "mir-000001");
  await ingest(id, "fee_invoice", [R("I1", { admission_number: "ADM/1", amount_naira: 100 })], "mir-000002"); await owner();
  assert(await n("select count(*)::int n from classes where school_id=$1", [w.A.sid]) === 0 && await n("select count(*)::int n from fees where school_id=$1", [w.A.sid]) === 0, "core written");
});

const ok = results.filter((r) => r.ok).length;
console.log(`integration hub 092: ${ok}/${results.length} passed`);
for (const r of results) console.log(r.ok ? "PASS" : "FAIL", r.name, r.err ?? "");
fs.mkdirSync(new URL("../results/", import.meta.url), { recursive: true });
fs.writeFileSync(new URL("../results/integrations-092.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), ok, total: results.length, results }, null, 1));
await c.end(); process.exit(ok === results.length ? 0 : 1);
