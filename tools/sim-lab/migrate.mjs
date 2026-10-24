import pg from "pg"; import fs from "node:fs"; import path from "node:path";
const DIR = process.argv[2] || new URL("../../database/supabase/migrations", import.meta.url).pathname;
const extra = process.argv.slice(3);
const c = new pg.Client({ host: "127.0.0.1", port: 54329, user: "postgres", database: process.env.SIMDB ?? "postgres" });
await c.connect();
const files = [...fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort().map((f) => path.join(DIR, f)), ...extra];
const res = [];
for (const f of files) {
  const sql = fs.readFileSync(f, "utf8");
  try { await c.query(sql); res.push({ f: path.basename(f), ok: true }); }
  catch (e) { try { await c.query("ROLLBACK"); } catch {} res.push({ f: path.basename(f), ok: false, err: String(e.message).slice(0, 200) }); }
}
fs.writeFileSync("migrate-result.json", JSON.stringify(res, null, 1));
console.log(`applied ${res.filter((r) => r.ok).length}/${res.length}`);
for (const r of res.filter((r) => !r.ok)) console.log("FAIL", r.f, "::", r.err);
await c.end();
