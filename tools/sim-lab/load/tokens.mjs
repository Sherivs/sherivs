// Mint local sim JWTs (HS256) for real sim users; secret stays in load/.jwt-secret (never printed).
import pg from "pg"; import fs from "node:fs"; import crypto from "node:crypto";
const secret = fs.readFileSync("load/.jwt-secret", "utf8").trim();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sign = (p) => { const h = b64({ alg: "HS256", typ: "JWT" }) + "." + b64(p); return h + "." + crypto.createHmac("sha256", secret).update(h).digest("base64url"); };
const c = new pg.Client({ host: "127.0.0.1", port: 54329, user: "postgres" }); await c.connect();
const out = {};
for (const role of ["student", "parent", "teacher", "bursar", "admin"]) {
  const r = await c.query("select u.id, u.school_id, (select s.id from students s where s.user_id=u.id or s.parent_id=u.id limit 1) sid, (select id from classes where teacher_id=u.id limit 1) cid from users u where role=$1 order by md5(u.id::text) limit 600", [role]);
  out[role] = r.rows.map((x) => ({ t: sign({ sub: x.id, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 86400 }), school: x.school_id, sid: x.sid, cid: x.cid }));
}
fs.writeFileSync("load/tokens.json", JSON.stringify(out)); console.log(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])));
await c.end();
