// Track E: database security audit against the LOCAL sim DB (all repo migrations applied).
// Checks: RLS enabled+forced on every public table, policies present, permissive `true` policies,
// SECURITY DEFINER search_path + anon/public EXECUTE grants, views without security_invoker, storage buckets.
// Usage: SIM_PG_PORT=54329 node sim/security-audit.mjs > results/security-audit.json
import pg from "pg";
// AUDIT_DB_URL (optional) audits another DB strictly read-only (session forced read-only before any query).
const c = process.env.AUDIT_DB_URL ? new pg.Client({ connectionString: process.env.AUDIT_DB_URL, ssl: { rejectUnauthorized: false } })
  : new pg.Client({ host: "127.0.0.1", port: Number(process.env.SIM_PG_PORT ?? 54329), user: "postgres" });
await c.connect(); await c.query("set session characteristics as transaction read only; set default_transaction_read_only = on");
const q = async (s) => (await c.query(s)).rows;
const T = `from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')`;
const out = {
  tables: (await q(`select count(*)::int n ${T}`))[0].n,
  rls_disabled: (await q(`select relname ${T} and not relrowsecurity order by 1`)).map((r) => r.relname),
  rls_not_forced: (await q(`select relname ${T} and not relforcerowsecurity order by 1`)).map((r) => r.relname),
  rls_without_policies: (await q(`select relname ${T} and relrowsecurity and not exists(select 1 from pg_policy p where p.polrelid=c.oid) order by 1`)).map((r) => r.relname),
  anon_table_grants_no_rls: (await q(`select relname ${T} and not relrowsecurity and has_table_privilege('anon',c.oid,'select')`)).map((r) => r.relname),
  permissive_true_policies: await q(`select tablename,policyname,cmd,roles::text roles from pg_policies where schemaname='public' and (qual='true' or with_check='true') and cmd<>'SELECT' order by 1`),
  roles: await q(`select rolname, rolbypassrls, rolsuper from pg_roles where rolname in ('postgres','service_role','authenticator') order by 1`),
  public_read_true_policies: await q(`select tablename,policyname,roles::text roles from pg_policies where schemaname='public' and qual='true' and cmd='SELECT' and roles::text ~ '(anon|public)' order by 1`),
  secdef_no_search_path: (await q(`select p.proname from pg_proc p join pg_namespace n on n.oid=pronamespace where nspname='public' and prosecdef and not exists (select 1 from unnest(coalesce(proconfig,'{}')) x where x like 'search_path=%') order by 1`)).map((r) => r.proname),
  secdef_mutable_search_path: (await q(`select p.proname, x from pg_proc p join pg_namespace n on n.oid=pronamespace, unnest(proconfig) x where nspname='public' and prosecdef and x like 'search_path=%' and x !~ '^search_path=("?pg_catalog"?, ?)?"?(public|pg_temp|""|)"?(, ?"?(public|pg_temp|extensions)"?)*$' order by 1`)),
  secdef_anon_execute: (await q(`select p.proname from pg_proc p join pg_namespace n on n.oid=pronamespace where nspname='public' and prosecdef and has_function_privilege('anon',p.oid,'execute') order by 1`)).map((r) => r.proname),
  secdef_total: (await q(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=pronamespace where nspname='public' and prosecdef`))[0].n,
  views_definer: (await q(`select relname from pg_class c join pg_namespace n on n.oid=relnamespace where nspname='public' and relkind in ('v','m') and not coalesce(reloptions::text like '%security_invoker=true%',false) order by 1`)).map((r) => r.relname),
  buckets: await q(`select id, public from storage.buckets order by 1`).catch(() => []),
  storage_policies: await q(`select policyname,cmd,roles::text roles,left(coalesce(qual,with_check),160) expr from pg_policies where schemaname='storage' order by 1`),
};
console.log(JSON.stringify(out, null, 2)); await c.end();
