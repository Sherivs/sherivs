// Emit initplan-wrapped versions of existing policies for given tables (SQL text only).
import pg from "pg"; const c = new pg.Client({ host: "127.0.0.1", port: 54329, user: "postgres" }); await c.connect();
const tables = process.argv.slice(2); let out = "";
const wrap = (s) => s && s.replace(/(?<!\(SELECT )\b(public\.)?(get_my_school_id|get_my_role|my_active_role|is_super_admin|is_school_admin|can_manage_admissions)\(\)/g, "(SELECT public.$2())").replace(/(?<!\(SELECT )auth\.uid\(\)/g, "(SELECT auth.uid())");
for (const t of tables) for (const p of (await c.query("select policyname, cmd, roles, permissive, qual, with_check from pg_policies where schemaname='public' and tablename=$1", [t])).rows) {
  const roles = p.roles.replace(/[{}]/g, "");
  out += `DROP POLICY IF EXISTS "${p.policyname}" ON public.${t};\nCREATE POLICY "${p.policyname}" ON public.${t} AS ${p.permissive} FOR ${p.cmd} TO ${roles}` + (p.qual ? `\n  USING (${wrap(p.qual)})` : "") + (p.with_check ? `\n  WITH CHECK (${wrap(p.with_check)})` : "") + ";\n\n";
}
process.stdout.write(out); await c.end();
