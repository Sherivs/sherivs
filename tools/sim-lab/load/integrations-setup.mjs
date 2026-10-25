// SHERIVS-090 load setup: N synthetic schools (*.sim.invalid), one admin + one rest-webhook integration each,
// local HS256 tokens in load/integ-tokens.json (secret in load/.jwt-secret, never printed). Local sim only.
import pg from "pg"; import fs from "node:fs"; import crypto from "node:crypto";
const N = +(process.env.SCHOOLS || 200), port = +(process.env.PGPORT || 54329);
const secret = fs.readFileSync("load/.jwt-secret", "utf8").trim();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sign = (p) => { const h = b64({ alg: "HS256", typ: "JWT" }) + "." + b64(p); return h + "." + crypto.createHmac("sha256", secret).update(h).digest("base64url"); };
const c = new pg.Client({ host: "127.0.0.1", port, user: "postgres" }); await c.connect();
const out = [];
for (let i = 0; i < N; i++) {
  const sid = crypto.randomUUID(), admin = crypto.randomUUID();
  await c.query("INSERT INTO schools (id,name,slug,subscription_tier,subscription_status,is_active,max_students) VALUES ($1,$2,$3,'growth','active',true,100000)", [sid, `Integ Load ${i}`, `integ-load-${sid.slice(0, 8)}`]);
  await c.query("INSERT INTO auth.users (id,email) VALUES ($1,$2)", [admin, `admin-${admin.slice(0, 8)}@sim.invalid`]);
  await c.query("INSERT INTO users (id,school_id,full_name,email,role) VALUES ($1,$2,'Sim Admin',$3,'admin')", [admin, sid, `admin-${admin.slice(0, 8)}@sim.invalid`]);
  await c.query("BEGIN"); await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: admin, role: "authenticated" })]);
  const id = (await c.query("select public.integration_connect($1,'rest-webhook','Legacy SIS','gradual') id", [sid])).rows[0].id;
  await c.query("COMMIT");
  await c.query("update integrations set max_runs_per_day=2000 where id=$1", [id]);
  out.push({ t: sign({ sub: admin, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 86400 }), school: sid, integration: id });
}
fs.writeFileSync("load/integ-tokens.json", JSON.stringify(out)); console.log(`schools: ${out.length}`); await c.end();
