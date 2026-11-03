// Track E regression: a student or parent must not read other students' attendance/clinic/discipline/hostel/library rows,
// nor staff payroll/leave. Exit 1 on any leak. Local sim DB only.
import pg from "pg";
const c = new pg.Client({
  host: "127.0.0.1",
  port: Number(process.env.SIM_PG_PORT ?? 54329),
  user: "postgres",
});
await c.connect();
const users = (
  await c.query(
    `select u.id, u.role from users u where u.role in ('student','parent') and exists (select 1 from students s where s.user_id=u.id or s.parent_id=u.id) order by md5(u.id::text) limit 40`,
  )
).rows;
const stuTables = [
  "attendance",
  "clinic_visits",
  "discipline_records",
  "hostel_allocations",
  "hostel_attendance",
  "library_borrowings",
];
const staffTables = ["staff_payroll", "staff_leave"];
let leaks = 0;
const out = [];
for (const u of users) {
  await c.query("begin");
  await c.query("set local role authenticated");
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: u.id, role: "authenticated" }),
  ]);
  for (const t of stuTables) {
    const r = await c.query(
      `select count(*)::int n from public.${t} where not (student_id = any ((select public.my_linked_student_ids())::uuid[]))`,
    );
    if (r.rows[0].n) {
      leaks++;
      out.push({ user: u.role, table: t, foreign_rows: r.rows[0].n });
    }
  }
  for (const t of staffTables) {
    const r = await c.query(`select count(*)::int n from public.${t} where user_id <> auth.uid()`);
    if (r.rows[0].n) {
      leaks++;
      out.push({ user: u.role, table: t, foreign_rows: r.rows[0].n });
    }
  }
  await c.query("rollback");
}
const whatsappTables = [
  "cg_communication_conversation",
  "cg_communication_message",
  "cg_communication_optin",
  "cg_communication_recipient_address",
  "cg_whatsapp_n8n_outbox",
  "cg_whatsapp_n8n_dead_letter",
  "cg_whatsapp_send_audit",
  "cg_whatsapp_n8n_reply",
];
for (const table of whatsappTables) {
  const posture = await c.query(
    `select relrowsecurity, relforcerowsecurity, has_table_privilege('authenticated', format('public.%I', $1::text), 'SELECT') as client_select from pg_class where oid = format('public.%I', $1::text)::regclass`,
    [table],
  );
  if (
    posture.rowCount !== 1 ||
    posture.rows[0].relrowsecurity !== true ||
    posture.rows[0].relforcerowsecurity !== true ||
    posture.rows[0].client_select !== false
  ) {
    leaks++;
    out.push({ table, posture: posture.rows[0] ?? null });
    continue;
  }
  await c.query("begin");
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({
      sub: users[0]?.id ?? "00000000-0000-4000-8000-000000000001",
      role: "authenticated",
      tenant_id: "tenant-a",
    }),
  ]);
  try {
    await c.query(`select count(*) from public.${table}`);
    leaks++;
    out.push({ table, tenant: "tenant-a", read_denied: false });
  } catch (error) {
    if (error.code !== "42501") {
      leaks++;
      out.push({ table, tenant: "tenant-a", error_code: error.code ?? "unknown" });
    }
  }
  await c.query("rollback");
}
console.log(
  JSON.stringify({
    users_checked: users.length,
    whatsapp_tables_checked: whatsappTables.length,
    leaks,
    sample: out.slice(0, 10),
  }),
);
await c.end();
process.exit(leaks ? 1 : 0);
