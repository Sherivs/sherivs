// Synthetic Nigerian institution data for the isolated sim DB. Deterministic (seeded). No real people.
import pg from "pg"; import crypto from "node:crypto"; import fs from "node:fs";
let seed = 20261024; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
let uc = 0; const uuid = () => { const h = crypto.createHash("sha256").update(`sherivs-sim-${uc++}`).digest("hex"); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; };
const FIRST = ["Chinedu","Adaeze","Tunde","Funmilayo","Ibrahim","Aisha","Emeka","Ngozi","Segun","Bisi","Musa","Hauwa","Obinna","Chiamaka","Yusuf","Zainab","Kelechi","Temitope","Uche","Halima","Babatunde","Amaka","Sani","Fatima","Ifeanyi","Yetunde","Abubakar","Nneka","Olumide","Hadiza"];
const LAST = ["Okafor","Adeyemi","Bello","Eze","Ogunleye","Abdullahi","Nwosu","Balogun","Usman","Okonkwo","Adebayo","Ibrahim","Chukwu","Olawale","Danjuma","Obi","Akinola","Garba","Nwachukwu","Lawal"];
const STATES = ["Lagos","Oyo","Kano","Enugu","Anambra","Kaduna","Rivers","Ogun","Abuja FCT","Kwara","Imo","Sokoto"];
export const ARCHETYPES = [
  { key: "lagos_k12", name: "Sim Lekki Heritage Academy", slug: "sim-lekki-heritage", tier: "growth", students: 1200, kind: "k12",
    classes: ["Nursery 1","Nursery 2","Primary 1","Primary 2","Primary 3","Primary 4","Primary 5","Primary 6","JSS1","JSS2","JSS3","SS1","SS2","SS3"], feeKobo: 45000000 },
  { key: "public_secondary", name: "Sim Government Secondary School Ikeja", slug: "sim-gss-ikeja", tier: "starter", students: 2500, kind: "k12",
    classes: ["JSS1","JSS2","JSS3","SS1","SS2","SS3"], feeKobo: 1500000 },
  { key: "faith_boarding", name: "Sim St. Gregory's Boarding College", slug: "sim-st-gregory", tier: "professional", students: 700, kind: "k12",
    classes: ["JSS1","JSS2","JSS3","SS1","SS2","SS3"], feeKobo: 32000000 },
  { key: "polytechnic", name: "Sim Federal Polytechnic Ilaro-East", slug: "sim-fedpoly", tier: "professional", students: 5000, kind: "tertiary",
    classes: ["ND1 Computer Sci","ND2 Computer Sci","HND1 Computer Sci","HND2 Computer Sci","ND1 Accountancy","ND2 Accountancy","HND1 Accountancy","HND2 Accountancy"], feeKobo: 9500000 },
  { key: "federal_university", name: "Sim Federal University of the Savannah", slug: "sim-fus", tier: "enterprise", students: 12000, kind: "tertiary",
    classes: ["100L Medicine","200L Medicine","300L Medicine","100L Law","200L Law","300L Law","400L Law","100L Engineering","200L Engineering","300L Engineering","400L Engineering","500L Engineering"], feeKobo: 12000000 },
];
const K12_SUBJECTS = ["Mathematics","English Language","Basic Science","Civic Education","Yoruba","Igbo","Hausa","Computer Studies","Agricultural Science"];
export const COURSES = [["GST101",2],["MTH101",3],["PHY101",3],["CHM101",3],["CSC101",3],["ENG101",2],["STA101",2],["ECO101",2]];

async function bulk(c, table, cols, rows, chunk = 2000) {
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk); const params = []; const vals = part.map((r, ri) => `(${cols.map((_, ci) => { params.push(r[ci]); return `$${ri * cols.length + ci + 1}`; }).join(",")})`);
    await c.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${vals.join(",")}`, params);
  }
}
const c = new pg.Client({ host: "127.0.0.1", port: Number(process.env.SIM_PG_PORT ?? 54329), user: "postgres" }); await c.connect();
await c.query("SET session_replication_role = replica"); // skip triggers during bulk load (memberships inserted explicitly)
const manifest = { generatedAt: new Date().toISOString(), institutions: [] };
const SCALE = Number(process.env.SIM_SCALE ?? 1);
for (const a of ARCHETYPES) {
  const schoolId = uuid(); const nStudents = Math.round(a.students * SCALE);
  await c.query("INSERT INTO schools (id,name,slug,subscription_tier,subscription_status,is_active,max_students) VALUES ($1,$2,$3,$4,'active',true,$5)", [schoolId, a.name, a.slug, a.tier, nStudents * 2]);
  const authRows = [], userRows = [], memRows = [];
  const mkUser = (role, extra = {}) => { const id = uuid(); const fn = `${pick(FIRST)} ${pick(LAST)}`; const email = `${role}.${id.slice(0, 8)}@${a.slug}.sim.invalid`;
    authRows.push([id, email]); userRows.push([id, schoolId, fn, email, role, `+234${800000000 + Math.floor(rnd() * 99999999)}`]); memRows.push([id, schoolId, role, true, true]); return id; };
  const admin = mkUser("admin"), principal = mkUser("principal"), bursar = mkUser("bursar");
  const teachers = Array.from({ length: Math.max(5, Math.round(nStudents / 25)) }, () => mkUser("teacher"));
  const classIds = a.classes.map(() => uuid());
  const classRows = a.classes.map((n, i) => [classIds[i], schoolId, n, a.kind === "k12" ? n : n.split(" ")[0], teachers[i % teachers.length], a.kind === "k12" ? "2025/2026" : "2025/2026", Math.ceil(nStudents / a.classes.length) + 10]);
  let lastParent = null; const studentRows = [], parentMap = [], gradeRows = [], feeRows = [];
  for (let s = 0; s < nStudents; s++) {
    const uid = mkUser("student"); if (s % 2 === 0) lastParent = mkUser("parent"); const parent = lastParent;
    const sid = uuid(); const cls = s % a.classes.length;
    studentRows.push([sid, schoolId, uid, `${a.slug.slice(4, 8).toUpperCase()}/${2025 - (cls % 4)}/${String(s).padStart(5, "0")}`, classIds[cls], pick(["male","female"]), pick(STATES), parent, "2025-09-15"]);
    if (parent) parentMap.push([uuid(), schoolId, parent, sid, "parent", true]);
    const subj = a.kind === "k12" ? K12_SUBJECTS.slice(0, 6) : COURSES.map((x) => x[0]);
    for (const sub of subj) { const ca = Math.round(8 + rnd() * 32), ex = Math.round(12 + rnd() * 48);
      gradeRows.push([uuid(), schoolId, sid, classIds[cls], sub, ca, ex, a.kind === "k12" ? "First Term" : "First Semester", "2025/2026", classRows[cls][4], true]); }
    const paid = rnd() < 0.55 ? a.feeKobo / 100 : rnd() < 0.5 ? Math.round(a.feeKobo / 200) : 0;
    feeRows.push([uuid(), schoolId, sid, "Tuition", a.feeKobo / 100, paid, paid >= a.feeKobo / 100 ? "paid" : paid > 0 ? "partial" : "unpaid", a.kind === "k12" ? "First Term" : "First Semester", "2025/2026"]);
  }
  await bulk(c, "auth.users", ["id","email"], authRows);
  await bulk(c, "users", ["id","school_id","full_name","email","role","phone"], userRows);
  await bulk(c, "organization_memberships", ["user_id","school_id","role","is_primary","is_active"], memRows);
  await bulk(c, "classes", ["id","school_id","name","grade_level","teacher_id","academic_year","capacity"], classRows);
  await bulk(c, "students", ["id","school_id","user_id","admission_number","class_id","gender","state_of_origin","parent_id","enrollment_date"], studentRows);
  await bulk(c, "parent_student_map", ["id","school_id","parent_id","student_id","relationship","is_primary_contact"], parentMap);
  await bulk(c, "grades", ["id","school_id","student_id","class_id","subject","ca_score","exam_score","term","academic_year","teacher_id","is_published"], gradeRows);
  await bulk(c, "fees", ["id","school_id","student_id","fee_type","amount","paid_amount","status","term","academic_year"], feeRows);
  manifest.institutions.push({ key: a.key, name: a.name, schoolId, tier: a.tier, kind: a.kind, admin, principal, bursar, teacher: teachers[0],
    sampleStudentUser: studentRows[0][2], sampleStudent: studentRows[0][0], sampleParent: studentRows[0][7], counts: { users: userRows.length, students: studentRows.length, teachers: teachers.length, classes: classRows.length, grades: gradeRows.length, fees: feeRows.length } });
  console.log(a.key, JSON.stringify(manifest.institutions.at(-1).counts));
}
// SHERIVS-016: academic configuration, as an institution would set it up
const CATEGORY = { lagos_k12: "k12", public_secondary: "k12", faith_boarding: "k12", polytechnic: "polytechnic", federal_university: "university" };
for (const inst of manifest.institutions) {
  await c.query("SELECT public.configure_academic_defaults($1, $2, $3)", [inst.schoolId, CATEGORY[inst.key],
    JSON.stringify(inst.key === "federal_university" ? { Medicine: "600L", Law: "500L", Engineering: "500L" } : {})]);
  if (inst.kind === "tertiary") for (const [code, units] of COURSES)
    await c.query("INSERT INTO courses (school_id, code, title, credit_units, level, semester) VALUES ($1,$2,$2,$3,'100L','First') ON CONFLICT DO NOTHING", [inst.schoolId, code, units]);
}
await c.query(`UPDATE classes SET programme = nullif(btrim(substr(name, length(grade_level) + 1)), '') WHERE name LIKE grade_level || '%'`);
await c.query("UPDATE students s SET current_level = c.grade_level, programme = c.programme, current_session = '2025/2026' FROM classes c WHERE c.id = s.class_id");
await c.query("SELECT public.sync_org_entitlements_from_tier(NULL)");
await c.query("SELECT public.sync_admin_role_assignments(NULL)");
await c.query("SET session_replication_role = origin");
await c.query("UPDATE grades SET ca_score = ca_score"); // fire grade autocalc trigger skipped during bulk load
await c.query(`UPDATE users SET nin = lpad((abs(hashtext(id::text)) % 100000000000)::text, 11, '0'),
  account_number = CASE WHEN role IN ('admin','principal','bursar','teacher') THEN lpad((abs(hashtext('a'||id)) % 10000000000)::text, 10, '0') END,
  salary = CASE WHEN role IN ('admin','principal','bursar','teacher') THEN 150000 + (abs(hashtext('s'||id)) % 400000) END`); // synthetic sensitive fields
await c.query("ANALYZE");
fs.writeFileSync("sim/manifest.json", JSON.stringify(manifest, null, 1));
await c.end();
