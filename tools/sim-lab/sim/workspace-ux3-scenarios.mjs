// SHERIVS-UX2/UX3 workspace scenarios against the isolated sim DB (never prod): scope-bound cards, school
// policies, and live card data (workspace_widget_data) computed under the caller's RLS and scope.
// Usage: SIM_PG_PORT=54395 node sim/workspace-ux3-scenarios.mjs   -> sim/workspace-ux3-results.json
import pg from "pg";
import fs from "node:fs";
const PORT = Number(process.env.SIM_PG_PORT ?? process.env.SIM_PORT ?? 54329);
const pool = new pg.Pool({ host: "127.0.0.1", port: PORT, user: "postgres", max: 10 });
const results = [];
const rec = (name, pass, detail) => {
  results.push({ area: "workspace-ux3", name, pass: !!pass, detail });
  console.log(pass ? "PASS" : "FAIL", name, "::", detail);
};
async function as(uid, fn, role = "authenticated") {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`SET LOCAL ROLE ${role}`);
    await c.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(uid ? { sub: uid, role } : { role }),
    ]);
    return await fn(c);
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    c.release();
  }
}
const one = async (uid, sql, p = [], role) => {
  try {
    return { ok: true, v: (await as(uid, (c) => c.query(sql, p), role)).rows[0] };
  } catch (e) {
    return { ok: false, err: e.message };
  }
};
const sys = async (sql, p = []) => (await pool.query(sql, p)).rows;
const keys = (m, k) => (m?.[k] ?? []).map((x) => x.key ?? x);

const lekki = (await sys("select id from schools where name like 'Sim Lekki%'"))[0].id;
const [tX, tY] = (
  await sys("select id from users where school_id=$1 and role='teacher' order by id limit 2", [
    lekki,
  ])
).map((r) => r.id);
const [student] = (
  await sys(
    "select s.user_id id from students s where s.school_id=$1 and s.user_id is not null order by s.id limit 1",
    [lekki],
  )
).map((r) => r.id);
const [parent] = (
  await sys(
    "select m.parent_id id from parent_student_map m where m.school_id=$1 order by m.parent_id limit 1",
    [lekki],
  )
).map((r) => r.id);

// ---- fixture: two campuses, two shifts, two levels; classes split across them; attendance today; timetable ----
await sys("update classes set campus_id=null, shift_id=null, level_id=null where school_id=$1", [
  lekki,
]);
await sys(
  "delete from timetables where school_id=$1 and academic_year='2026/2027' and term='first'",
  [lekki],
);
await sys("delete from school_shifts where school_id=$1 and name in ('Morning','Afternoon')", [
  lekki,
]);
await sys("delete from school_levels where school_id=$1 and name in ('JSS 1','JSS 2')", [lekki]);
await sys("delete from campuses where school_id=$1 and code in ('SIM-MAIN','SIM-ANNEX')", [lekki]);
const [main] = await sys(
  "insert into campuses (school_id,name,code) values ($1,'Lekki Main Campus','SIM-MAIN') returning id",
  [lekki],
);
const [annex] = await sys(
  "insert into campuses (school_id,name,code) values ($1,'Ajah Annex','SIM-ANNEX') returning id",
  [lekki],
);
const [am] = await sys(
  "insert into school_shifts (school_id,campus_id,name,kind) values ($1,$2,'Morning','morning') returning id",
  [lekki, main.id],
);
const [pm] = await sys(
  "insert into school_shifts (school_id,campus_id,name,kind) values ($1,$2,'Afternoon','afternoon') returning id",
  [lekki, annex.id],
);
const [l1] = await sys(
  "insert into school_levels (school_id,name,band,ordinal) values ($1,'JSS 1','jss',7) returning id",
  [lekki],
);
const [l2] = await sys(
  "insert into school_levels (school_id,name,band,ordinal) values ($1,'JSS 2','jss',8) returning id",
  [lekki],
);
const classes = await sys("select id from classes where school_id=$1 order by name", [lekki]);
for (const [i, c] of classes.entries()) {
  const odd = i % 2 === 1;
  await sys("update classes set campus_id=$2, shift_id=$3, level_id=$4 where id=$1", [
    c.id,
    odd ? annex.id : main.id,
    odd ? pm.id : am.id,
    i % 3 === 0 ? l2.id : l1.id,
  ]);
}
await sys(
  `insert into attendance (school_id, student_id, class_id, date, status)
  select s.school_id, s.id, s.class_id, (now() at time zone 'Africa/Lagos')::date, case when abs(hashtext(s.id::text)) % 9 = 0 then 'absent' else 'present' end
    from students s where s.school_id=$1 and s.class_id is not null
     and not exists (select 1 from attendance a where a.student_id=s.id and a.date=(now() at time zone 'Africa/Lagos')::date)`,
  [lekki],
);
const dow = (await sys("select lower(to_char(now() at time zone 'Africa/Lagos','FMDay')) d"))[0].d;
const [tt] = await sys(
  "insert into timetables (school_id,class_id,academic_year,term,is_active,published) values ($1,$2,'2026/2027','first',true,true) returning id",
  [lekki, classes[0].id],
);
await sys(
  `insert into timetable_slots (timetable_id,school_id,day_of_week,period_number,start_time,end_time,subject,teacher_id,room) values
  ($1,$2,$3,1,'08:00','08:40','Mathematics',$4,'Rm 4'),($1,$2,$3,3,'10:10','10:50','Mathematics',$4,'Rm 4'),($1,$2,$3,2,'09:00','09:40','Basic Science',$5,'Lab 1')`,
  [tt.id, lekki, dow, tX, tY],
);

// Teacher X: maths, scoped to level JSS 2 + subject Mathematics. Teacher Y: maths, scoped to Ajah Annex, Afternoon shift.
await sys("delete from user_role_assignments where user_id = any($1)", [[tX, tY]]);
const asg = async (uid, dims) => {
  const [a] = await sys(
    "insert into user_role_assignments (org_id,user_id,role_code,scope_type) values ($1,$2,'ng.mathematics_teacher','org') returning id",
    [lekki, uid],
  );
  const [s] = await sys(
    "insert into role_assignment_scope_sets (assignment_id, org_id, label) values ($1,$2,'sim') returning id",
    [a.id, lekki],
  );
  for (const [d, refs] of Object.entries(dims))
    for (const r of refs)
      await sys(
        "insert into role_assignment_scopes (set_id, org_id, dim, ref) values ($1,$2,$3,$4)",
        [s.id, lekki, d, r],
      );
};
await asg(tX, { level: [l2.id], subject: ["Mathematics"] });
await asg(tY, { campus: [annex.id], shift: [pm.id] });

const ALL = (
  await sys("select array_agg(key) k from workspace_item_catalog where kind='widget'")
)[0].k;
const man = async (uid) => (await one(uid, "select public.workspace_manifest($1) m", [lekki])).v?.m;
const data = async (uid, ks, scope = null) =>
  one(uid, "select public.workspace_widget_data($1,$2,$3) d", [
    lekki,
    ks,
    scope ? JSON.stringify(scope) : null,
  ]);
const MX = await man(tX),
  MY = await man(tY);
rec(
  "same role, same school, different scopes -> different homes",
  JSON.stringify(keys(MX, "widgets")) !== JSON.stringify(keys(MY, "widgets")),
  JSON.stringify({ X: keys(MX, "widgets"), Y: keys(MY, "widgets") }),
);
rec(
  "level-scoped teacher gets the level card only",
  keys(MX, "widgets").includes("w.level_overview") &&
    !keys(MX, "widgets").includes("w.campus_overview") &&
    !keys(MX, "widgets").includes("w.shift_overview"),
  JSON.stringify(MX?.scope_options),
);
rec(
  "campus+shift-scoped teacher gets campus and shift cards",
  keys(MY, "widgets").includes("w.campus_overview") &&
    keys(MY, "widgets").includes("w.shift_overview") &&
    !keys(MY, "widgets").includes("w.level_overview"),
  JSON.stringify(MY?.scope_options),
);

const rX = await data(tX, keys(MX, "widgets")),
  rY = await data(tY, keys(MY, "widgets"));
if (!rX.ok || !rY.ok) console.log("widget_data error", rX.err, rY.err);
const DX = rX.v?.d,
  DY = rY.v?.d;
const cnt = async (sql, p) => Number((await sys(sql, p))[0].n);
const lvlTotal = await cnt(
  "select count(*) n from students s join classes c on c.id=s.class_id where c.level_id=$1 and coalesce(s.is_active,true)",
  [l2.id],
);
const annexTotal = await cnt(
  "select count(*) n from students s join classes c on c.id=s.class_id where c.campus_id=$1 and c.shift_id=$2 and coalesce(s.is_active,true)",
  [annex.id, pm.id],
);
const tot = (card) => Number(String(card?.metric ?? "").split(" / ")[1]);
rec(
  "live: level card counts only JSS 2 students",
  tot(DX?.cards?.["w.level_overview"]) === lvlTotal,
  `${DX?.cards?.["w.level_overview"]?.metric} vs ${lvlTotal} expected`,
);
rec(
  "live: campus card counts only Ajah Annex afternoon students",
  tot(DY?.cards?.["w.campus_overview"]) === annexTotal,
  `${DY?.cards?.["w.campus_overview"]?.metric} vs ${annexTotal} expected`,
);
rec(
  "live: today's lessons from the timetable (subject-scoped)",
  JSON.stringify(DX?.cards?.["w.today_classes"]?.list ?? []).includes("08:00 Mathematics"),
  JSON.stringify(DX?.cards?.["w.today_classes"]),
);
rec(
  "live: scope labels are human names, not ids",
  DY?.labels?.campus?.[annex.id] === "Ajah Annex" && DY?.labels?.shift?.[pm.id] === "Afternoon",
  JSON.stringify(DY?.labels),
);
const unav = Object.entries({ ...(DX?.cards ?? {}), ...(DY?.cards ?? {}) })
  .filter(([, v]) => v.unavailable)
  .map(([k]) => k);
rec(
  "live: no card fails under teacher RLS",
  unav.length === 0,
  unav.join(",") || "all cards readable",
);
const fF = (await data(tY, ["w.campus_overview"], { dim: "campus", ref: annex.id })).v?.d;
rec(
  "focus on a held scope narrows to that dimension",
  JSON.stringify(fF?.scope) === JSON.stringify({ campus: [annex.id] }),
  JSON.stringify(fF?.scope),
);
const fBad = (await data(tY, ["w.campus_overview"], { dim: "campus", ref: main.id })).v?.d;
rec(
  "focus on a scope the user does not hold is ignored",
  !JSON.stringify(fBad?.scope).includes(main.id) && JSON.stringify(fBad?.scope).includes(annex.id),
  JSON.stringify(fBad?.scope),
);
const sR = await data(student, [
  "w.fee_collection",
  "w.defaulters",
  "w.my_results",
  "w.my_timetable",
]);
if (!sR.ok) console.log("student err", sR.err);
const sD = sR.v?.d;
rec(
  "student cannot pull finance cards (skipped, not leaked)",
  sD && !("w.fee_collection" in sD.cards) && !("w.defaulters" in sD.cards),
  JSON.stringify(Object.keys(sD?.cards ?? {})),
);
const pD = (await data(parent, ["w.child_fees", "w.children_summary"])).v?.d;
const pExp = await cnt(
  "select coalesce(sum(f.amount-coalesce(f.paid_amount,0)),0) n from fees f where f.status<>'paid' and f.student_id in (select student_id from parent_student_map where parent_id=$1)",
  [parent],
);
rec(
  "parent sees only own children's balance",
  Number(pD?.cards?.["w.child_fees"]?.metric) === pExp &&
    (pD?.cards?.["w.children_summary"]?.list ?? []).length >= 1,
  `${pD?.cards?.["w.child_fees"]?.metric} vs ${pExp}; children ${(pD?.cards?.["w.children_summary"]?.list ?? []).length}`,
);
rec(
  "anon cannot call widget data",
  !(
    await one(
      null,
      "select public.workspace_widget_data($1,$2,null)",
      [lekki, ["w.enrolment"]],
      "anon",
    )
  ).ok,
  "anon",
);
const cross = await data(tX, ["w.enrolment"], null);
const ikeja = (await sys("select id from schools where name like 'Sim Government%'"))[0].id;
const xs = await one(tX, "select public.workspace_widget_data($1,$2,null) d", [
  ikeja,
  ["w.today_classes", "w.attendance_todo", "w.enrolment"],
]);
rec(
  "other school's cards return nothing",
  cross.ok && xs.ok && Object.keys(xs.v.d.cards).length === 0,
  JSON.stringify(xs.v?.d?.cards ?? xs.err),
);
rec(
  "too many keys rejected",
  !(
    await data(
      tX,
      Array.from({ length: 41 }, (_, i) => `w.x${i}`),
    )
  ).ok,
  "41 keys",
);
// UX2 policies
await sys(
  "insert into org_workspace_policies (org_id, policy, enabled) values ($1,'staff.ai_helper',false),($1,'workspace.personalise',false) on conflict (org_id,policy) do update set enabled=false",
  [lekki],
);
const MXp = await man(tX);
rec(
  "policy off hides AI helper; personalisation locked",
  !keys(MXp, "widgets").includes("w.ai_lesson_helper") && MXp?.can_personalise === false,
  JSON.stringify({ widgets: keys(MXp, "widgets"), lock: MXp?.can_personalise }),
);
rec(
  "teacher cannot change policies",
  !(await one(tX, "select public.workspace_policy_set($1,'workspace.personalise',true)", [lekki]))
    .ok,
  "settings.manage required",
);
await sys("delete from org_workspace_policies where org_id=$1", [lekki]);
// latency
const t = [];
const wk = keys(MY, "widgets");
for (let i = 0; i < 60; i++) {
  const s = performance.now();
  await data(tY, wk);
  t.push(performance.now() - s);
}
t.sort((a, b) => a - b);
rec(
  "widget data p95 < 150 ms (all cards of a home)",
  t[56] < 150,
  `p50 ${t[29].toFixed(1)} ms, p95 ${t[56].toFixed(1)} ms, ${wk.length} cards`,
);
void ALL;
fs.writeFileSync(
  new URL("./workspace-ux3-results.json", import.meta.url),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      passed: results.filter((r) => r.pass).length,
      total: results.length,
      results,
      fixture: {
        lekki,
        teacherX: tX,
        teacherY: tY,
        scopes: { X: MX?.scope_options, Y: MY?.scope_options },
      },
      sample: {
        X: DX,
        Y: DY,
        manifestX: MX,
        manifestY: MY,
        focusY: {
          scope: { dim: "shift", ref: pm.id },
          data: (await data(tY, keys(MY, "widgets"), { dim: "shift", ref: pm.id })).v?.d,
        },
      },
    },
    null,
    1,
  ),
);
console.log(`${results.filter((r) => r.pass).length}/${results.length} passed`);
await pool.end();
