// Track E: EXPLAIN ANALYZE each k6 flow query as a real sim user under RLS (local only).
import pg from "pg"; import fs from "node:fs";
const c = new pg.Client({ host: "127.0.0.1", port: Number(process.env.SIM_PG_PORT ?? 54329), user: "postgres" }); await c.connect();
const T = JSON.parse(fs.readFileSync(new URL("../load/tokens.json", import.meta.url)));
const sub = (t) => JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()).sub;
const S = T.student.find((u) => u.tid), P = T.parent.find((u) => u.sid), TE = T.teacher.find((u) => u.cid);
const today = new Date().toISOString().slice(0, 10);
const cases = [
  ["login users", S, `select id,full_name,role,school_id from users limit 1`],
  ["login schools", S, `select id,name,slug from schools limit 1`],
  ["results student", S, `select subject,total_score,grade,term from grades where is_published and student_id='${S.sid}'`],
  ["results parent", P, `select student_id,subject,grade from grades where student_id='${P.sid}'`],
  ["cbt tests", S, `select id,title,closes_at from cbt_tests`],
  ["cbt start", S, `select cbt_start('${S.tid}')`],
  ["fees parent", P, `select id,amount,paid_amount,status from fees where student_id='${P.sid}'`],
  ["fees student", S, `select id,amount,paid_amount,status from fees where student_id='${S.sid}'`],
  ["attendance register", TE, `select student_id,status from attendance where class_id='${TE.cid}' and date='${today}'`],
  ["attendance own", S, `select date,status from attendance where student_id='${S.sid}' order by date desc limit 30`],
];
const out = [];
for (const [name, u, sql] of cases) {
  await c.query("begin"); await c.query(`set local role authenticated`);
  await c.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify({ sub: sub(u.t), role: "authenticated" }), sub(u.t)]);
  const t0 = Date.now(); const r = await c.query(`explain (analyze, format json) ${sql}`); const ms = r.rows[0]["QUERY PLAN"][0]["Execution Time"];
  await c.query("rollback"); out.push({ name, ms: Math.round(ms * 10) / 10, wall: Date.now() - t0 });
  if (process.env.VERBOSE === name) console.error(JSON.stringify(r.rows[0]["QUERY PLAN"][0].Plan, null, 1).slice(0, 6000));
}
console.log(JSON.stringify(out)); await c.end();
