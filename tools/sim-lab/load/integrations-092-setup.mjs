// SHERIVS-092 load setup: N schools, each with a gradual rest-webhook integration, 20 students, 1 class,
// and (every other school) outbound enabled with Sherivs owning 'student' so the outbox triggers fire.
// Local sim only; tokens in load/integ92-tokens.json (secret in load/.jwt-secret, never printed).
import pg from "pg"; import fs from "node:fs"; import crypto from "node:crypto";
const N = +(process.env.SCHOOLS || 200), port = +(process.env.PGPORT || 54329);
const secret = fs.readFileSync("load/.jwt-secret", "utf8").trim();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sign = (p) => { const h = b64({ alg: "HS256", typ: "JWT" }) + "." + b64(p); return h + "." + crypto.createHmac("sha256", secret).update(h).digest("base64url"); };
const c = new pg.Client({ host: "127.0.0.1", port, user: "postgres" }); await c.connect();
const out = [];
for (let i = 0; i < N; i++) {
  const sid = crypto.randomUUID(), admin = crypto.randomUUID();
  await c.query("INSERT INTO schools (id,name,slug,subscription_tier,subscription_status,is_active,max_students) VALUES ($1,$2,$3,'growth','active',true,100000)", [sid, `Integ92 ${i}`, `integ92-${sid.slice(0, 8)}`]);
  await c.query("INSERT INTO auth.users (id,email) VALUES ($1,$2)", [admin, `a92-${admin.slice(0, 8)}@sim.invalid`]);
  await c.query("INSERT INTO users (id,school_id,full_name,email,role) VALUES ($1,$2,'Sim Admin',$3,'admin')", [admin, sid, `a92-${admin.slice(0, 8)}@sim.invalid`]);
  await c.query("BEGIN"); await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: admin, role: "authenticated" })]);
  const id = (await c.query("select public.integration_connect($1,'rest-webhook','Legacy SIS','gradual') id", [sid])).rows[0].id;
  await c.query("select public.integration_ingest($1,'class',$2::jsonb,'seed-class-1','manual')", [id, JSON.stringify([{ external_id: "C1", data: { name: "JSS1A", academic_year: "2025/2026" } }])]);
  const st = Array.from({ length: 20 }, (_, k) => ({ external_id: `S${k}`, data: { admission_number: `ADM/${k}`, class_name: "JSS1A" } }));
  await c.query("select public.integration_ingest($1,'student',$2::jsonb,'seed-students-1','manual')", [id, JSON.stringify(st)]);
  const inv = st.map((s, k) => ({ external_id: `INV${k}`, data: { student_external_id: s.external_id, amount_naira: 500000, term: "First Term", academic_year: "2025/2026" } }));
  await c.query("select public.integration_ingest($1,'fee_invoice',$2::jsonb,'seed-invoices-1','manual')", [id, JSON.stringify(inv)]);
  if (i % 2 === 0) {
    await c.query("select public.integration_update($1,null,null,'{\"student\":\"sherivs\"}'::jsonb)", [id]);
    await c.query("select public.integration_set_outbound($1,true,'{\"outbound_url\":\"https://legacy.sim.invalid/hook\"}'::jsonb)", [id]);
  }
  await c.query("COMMIT");
  await c.query("update integrations set max_runs_per_day=2000 where id=$1", [id]);
  out.push({ t: sign({ sub: admin, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 86400 }), school: sid, integration: id });
}
fs.writeFileSync("load/integ92-tokens.json", JSON.stringify(out)); console.log(`schools: ${out.length}`); await c.end();
