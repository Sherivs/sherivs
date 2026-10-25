// SHERIVS-UX1 workspace manifest scenarios against the isolated sim DB (never prod).
// Usage: node sim/workspace-scenarios.mjs   (SIM_PORT overrides 54329). Writes sim/workspace-results.json.
import pg from "pg"; import fs from "node:fs";
const PORT = Number(process.env.SIM_PORT ?? 54329);
const pool = new pg.Pool({ host: "127.0.0.1", port: PORT, user: "postgres", max: 20 });
const results = [];
const rec = (name, pass, detail) => { results.push({ area: "workspace", name, pass: !!pass, detail }); console.log(pass ? "PASS" : "FAIL", name, "::", detail); };
async function as(uid, fn, role = "authenticated") {
  const c = await pool.connect();
  try { await c.query("BEGIN"); await c.query(`SET LOCAL ROLE ${role}`);
    await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return await fn(c); } finally { await c.query("ROLLBACK").catch(() => {}); c.release(); }
}
const q1 = async (uid, sql, p = [], role) => { try { return { ok: true, v: (await as(uid, (c) => c.query(sql, p), role)).rows[0] }; } catch (e) { return { ok: false, err: e.message }; } };
const sys = (sql, p = []) => pool.query(sql, p);
const man = async (uid, org) => (await q1(uid, "select public.workspace_manifest($1) m", [org]));
const keys = (m, k) => (m?.[k] ?? []).map((x) => x.key ?? x);

const schools = (await sys("select id, name, subscription_tier from schools where name like 'Sim %' order by name")).rows;
const lekki = schools.find((s) => /Lekki/.test(s.name)), ikeja = schools.find((s) => /Ikeja/.test(s.name));
const pick = async (org, role, n = 1) => (await sys("select id from users where school_id=$1 and role=$2 order by id limit $3", [org, role, n])).rows.map((r) => r.id);
const [tA] = await pick(lekki.id, "teacher"); const [tB, tLegacy] = await pick(ikeja.id, "teacher", 2);
const [adminB] = await pick(ikeja.id, "admin"); const [parentB] = await pick(ikeja.id, "parent"); const [studentB] = await pick(ikeja.id, "student");

// Fixture: teacher A = Mathematics teacher at Lekki (growth plan), scoped to JSS2 / Mathematics.
// Teacher B = Mathematics teacher + form teacher at Ikeja (starter plan); the school switched off the
// optional cbt.manage for its maths teachers and turned off the library module.
await sys("delete from user_role_assignments where user_id = any($1)", [[tA, tB]]);
const asg = async (org, uid, role) => (await sys("insert into user_role_assignments (org_id,user_id,role_code,scope_type) values ($1,$2,$3,'org') returning id", [org, uid, role])).rows[0].id;
const aA = await asg(lekki.id, tA, "ng.mathematics_teacher");
const ss = (await sys("insert into role_assignment_scope_sets (assignment_id, org_id, label) values ($1,$2,'JSS2 maths') returning id", [aA, lekki.id])).rows[0].id;
await sys("insert into role_assignment_scopes (set_id, org_id, dim, ref) values ($1,$2,'level','JSS2'),($1,$2,'subject','Mathematics')", [ss, lekki.id]);
await asg(ikeja.id, tB, "ng.mathematics_teacher");
const ft = (await sys("select code from role_catalog where template_code='form_teacher' and org_id is null order by code limit 1")).rows[0].code;
await asg(ikeja.id, tB, ft);
await sys("insert into org_role_permission_settings (org_id, role_code, permission_code, enabled) values ($1,'ng.mathematics_teacher','cbt.manage',false) on conflict (org_id, role_code, permission_code) do update set enabled=false", [ikeja.id]);
await sys("insert into org_workspace_features (org_id, feature, enabled) values ($1,'library',false) on conflict (org_id, feature) do update set enabled=false", [ikeja.id]);

const A = (await man(tA, lekki.id)).v?.m, B = (await man(tB, ikeja.id)).v?.m;
rec("teacher A manifest computed", A && A.primary_family === "teacher", JSON.stringify({ families: A?.families, widgets: keys(A, "widgets") }));
rec("teacher B manifest computed (multi-role)", B && B.families.includes("form_teacher") && B.families.includes("teacher"), JSON.stringify({ families: B?.families, widgets: keys(B, "widgets") }));
rec("same role, different school -> different workspace", JSON.stringify(keys(A, "widgets")) !== JSON.stringify(keys(B, "widgets")), "A vs B widget lists differ");
rec("plan feature: AI helper only on growth plan", keys(A, "widgets").includes("w.ai_lesson_helper") && !keys(B, "widgets").includes("w.ai_lesson_helper"), "ai in growth, not in starter");
rec("optional permission toggled off hides CBT", keys(A, "widgets").includes("w.cbt_sessions") && !keys(B, "widgets").includes("w.cbt_sessions") && !keys(B, "actions").includes("a.new_cbt"), "cbt.manage off at Ikeja");
rec("form teacher role adds form-class widget", keys(B, "widgets").includes("w.form_class") && !keys(A, "widgets").includes("w.form_class"), "w.form_class");
rec("scope set carried into manifest", JSON.stringify(A?.scopes ?? []).includes("Mathematics") && JSON.stringify(A?.scopes ?? []).includes("JSS2"), JSON.stringify(A?.scopes));
rec("no finance widgets for teachers", !keys(A, "widgets").some((k) => /fee_collection|reconciliation|payroll_run/.test(k)), "bursar items hidden");
const allowed = await q1(tA, "select public.workspace_item_allowed($1,'w.fee_collection') a, public.workspace_item_allowed($1,'w.today_classes') b", [lekki.id]);
rec("workspace_item_allowed enforces the same rule", allowed.ok && allowed.v.a === false && allowed.v.b === true, JSON.stringify(allowed.v ?? allowed.err));
// legacy (no catalog role) users fall back to the legacy role bridge
for (const [label, uid, fam] of [["legacy teacher", tLegacy, "teacher"], ["parent", parentB, "parent"], ["student", studentB, "student"], ["school admin", adminB, "principal"]]) {
  const m = (await man(uid, ikeja.id)).v?.m;
  rec(`${label} gets ${fam} workspace`, m?.primary_family === fam && m.widgets.length > 0, JSON.stringify({ fam: m?.families, widgets: keys(m, "widgets").slice(0, 6) }));
}
// personalisation: only allowed items are stored
const saved = await as(tB, async (c) => {
  const v = (await c.query("select public.workspace_prefs_save($1, $2) p", [ikeja.id, JSON.stringify({ hidden: ["w.today_classes"], added: ["w.payroll_run", "w.announcements"], order: ["w.form_class"], actions: ["a.record_cash", "a.take_attendance"], locale: "ha" })])).rows[0].p;
  const m = (await c.query("select public.workspace_manifest($1) m", [ikeja.id])).rows[0].m; return { v, m };
});
rec("prefs strip items outside the allowed set", !JSON.stringify(saved.v).includes("payroll_run") && !JSON.stringify(saved.v).includes("record_cash") && saved.v.locale === "ha", JSON.stringify(saved.v));
rec("prefs applied (hide + order + locale)", !keys(saved.m, "widgets").includes("w.today_classes") && keys(saved.m, "widgets")[0] === "w.form_class" && saved.m.locale === "ha", JSON.stringify(keys(saved.m, "widgets")));
rec("cross-school manifest denied", !(await man(tA, ikeja.id)).ok, "teacher A asking for Ikeja");
rec("anon cannot call manifest", !(await q1(null, "select public.workspace_manifest($1)", [ikeja.id], "anon")).ok, "anon");
rec("teacher cannot toggle school modules", !(await q1(tB, "select public.workspace_feature_set($1,'hostel',false)", [ikeja.id])).ok, "settings.manage required");
const adm = await as(adminB, async (c) => { await c.query("select public.workspace_feature_set($1,'transport',false)", [ikeja.id]); return (await c.query("select public.workspace_features($1) f", [ikeja.id])).rows[0].f; });
rec("admin toggles a module", adm && !adm.includes("transport") && !adm.includes("library"), JSON.stringify(adm));
rec("prefs table not directly writable", !(await q1(tB, "insert into user_workspace_prefs (user_id, org_id, prefs) values ($1,$2,'{}')", [tB, ikeja.id])).ok, "RLS/grants");
// legacy bridge parity: the set-based mirror must equal scholar_can() for every legacy role x permission
{ let bad = [];
  for (const [role, uid] of [["teacher", tLegacy], ["parent", parentB], ["student", studentB], ["admin", adminB]]) {
    const r = await as(uid, async (c) => (await c.query("select array(select code from permission_catalog where public.scholar_can($1, code) order by code) a, public._workspace_legacy_codes($2) b", [ikeja.id, role])).rows[0], "postgres").catch((e) => ({ a: [e.message], b: [] }));
    if (JSON.stringify(r.a) !== JSON.stringify(r.b)) bad.push(role);
  }
  rec("legacy bridge parity with scholar_can()", bad.length === 0, bad.length ? `drift: ${bad}` : "teacher/parent/student/admin identical"); }
// latency
const t = []; for (let i = 0; i < 100; i++) { const s = performance.now(); await man(tB, ikeja.id); t.push(performance.now() - s); }
t.sort((a, b) => a - b); const p95 = t[94];
rec("manifest p95 < 50 ms", p95 < 50, `p50 ${t[49].toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`);
fs.writeFileSync(new URL("./workspace-results.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), passed: results.filter((r) => r.pass).length, total: results.length, results, sample: { teacherA: A, teacherB: B } }, null, 1));
console.log(`${results.filter((r) => r.pass).length}/${results.length} passed`); await pool.end();
