// Verify that ten failed admission-number attempts are committed to the local sim DB limiter.
import fs from "node:fs";
import pg from "pg";

const manifest = JSON.parse(fs.readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
const institution = manifest.institutions[0];
const client = new pg.Client({
  host: "127.0.0.1",
  port: Number(process.env.SIM_PG_PORT ?? 54329),
  user: "postgres",
});

await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE authenticated");
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: institution.admin, role: "authenticated" }),
  ]);
  const generated = await client.query(
    "SELECT * FROM public.generate_result_pins($1, '2026/2027', 'SEC-01', 1, 5)",
    [institution.schoolId],
  );
  await client.query("COMMIT");

  const { serial, pin } = generated.rows[0];
  for (let attempt = 1; attempt <= 11; attempt += 1) {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE anon");
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role: "anon" }),
    ]);
    const result = await client.query("SELECT public.check_result($1, $2, $3) AS result", [
      serial,
      pin,
      `SEC-01-NONMATCH-${attempt}`,
    ]);
    await client.query("COMMIT");
    const expected = attempt === 11 ? "rate_limited" : "invalid serial or PIN";
    if (result.rows[0].result?.error !== expected) {
      throw new Error(
        `attempt ${attempt}: expected ${expected}, received ${JSON.stringify(result.rows[0].result)}`,
      );
    }
  }
  console.log("PASS check_result rate limits the 11th failed admission-number attempt");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end();
}
