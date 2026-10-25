import pg from "pg"; import fs from "node:fs"; const M = JSON.parse(fs.readFileSync("sim/manifest.json")); 
const c = new pg.Client({ host: "127.0.0.1", port: Number(process.env.SIM_PG_PORT ?? 54329), user: "postgres" }); await c.connect();
const cases = [["student grades", M.institutions[4].sampleStudentUser, "select subject,grade from grades where is_published"],
  ["parent grades", M.institutions[4].sampleParent, `select subject from grades where student_id='${M.institutions[4].sampleStudent}'`],
  ["teacher students", M.institutions[4].teacher, "select id from students limit 100"],
  ["bursar fees", M.institutions[4].bursar, "select id from fees where status<>'paid' limit 50"]];
for (const [n, uid, sql] of cases) {
  await c.query("BEGIN; SET LOCAL ROLE authenticated"); await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
  const r = await c.query("EXPLAIN (ANALYZE, FORMAT JSON) " + sql); const p = r.rows[0]["QUERY PLAN"][0];
  console.log(n.padEnd(18), "exec", p["Execution Time"].toFixed(1), "ms");
  await c.query("ROLLBACK");
}
console.log((await c.query("select indexname from pg_indexes where tablename='grades'")).rows.map((r) => r.indexname).join(","));
await c.end();
