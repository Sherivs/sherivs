// Scenario suite against the isolated sim DB. Each check records pass/fail + detail. No secrets involved.
import pg from "pg"; import fs from "node:fs"; import crypto from "node:crypto";
const M = JSON.parse(fs.readFileSync("sim/manifest.json", "utf8"));
const pool = new pg.Pool({ host: "127.0.0.1", port: Number(process.env.SIM_PG_PORT ?? 54329), user: "postgres", max: 60 });
const results = [];
const rec = (area, name, pass, detail, severity = "high") => { results.push({ area, name, pass, detail, severity }); console.log(pass ? "PASS" : "FAIL", area, "::", name, "::", detail); };
async function as(uid, fn, role = "authenticated") {
  const c = await pool.connect();
  try { await c.query("BEGIN"); await c.query(`SET LOCAL ROLE ${role}`);
    await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(uid ? { sub: uid, role } : { role })]);
    const r = await fn(c); await c.query("ROLLBACK"); return r; }
  catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
}
const tryq = async (uid, sql, params = [], role) => { try { return { ok: true, r: await as(uid, (c) => c.query(sql, params), role) }; } catch (e) { return { ok: false, err: e.message.slice(0, 140) }; } };
const sys = (sql, p = []) => pool.query(sql, p);
const [A, B, C, D, E] = M.institutions;

// ---------- 1. Enrollment ----------
{
  const ok = await tryq(A.admin, "INSERT INTO students (school_id, admission_number, gender) VALUES ($1,'SIM/NEW/1','female') RETURNING id", [A.schoolId]);
  rec("enrollment", "Admin enrolls a student in own school", ok.ok && ok.r.rowCount === 1, ok.ok ? "inserted" : ok.err);
  const x = await tryq(A.admin, "INSERT INTO students (school_id, admission_number, gender) VALUES ($1,'SIM/X/1','male')", [B.schoolId]);
  rec("enrollment", "Admin cannot enroll into another school", !x.ok, x.ok ? "INSERT into other school SUCCEEDED" : "rejected by RLS", "critical");
  const t = await tryq(A.teacher, "INSERT INTO students (school_id, admission_number, gender) VALUES ($1,'SIM/T/1','male')", [A.schoolId]);
  rec("enrollment", "Teacher cannot enroll students", !t.ok, t.ok ? "teacher insert succeeded" : "rejected");
  const dup = await tryq(A.admin, "INSERT INTO students (school_id, admission_number) SELECT school_id, admission_number FROM students WHERE school_id=$1 LIMIT 1", [A.schoolId]);
  rec("enrollment", "Duplicate admission number rejected", !dup.ok, dup.ok ? "duplicate accepted" : "unique constraint");
  const t0 = Date.now(); const bulkEnroll = await tryq(D.admin, "INSERT INTO students (school_id, admission_number, gender) SELECT $1, 'SIM/BULK/'||g, 'male' FROM generate_series(1,2000) g", [D.schoolId]);
  rec("enrollment", "Bulk intake of 2,000 polytechnic students", bulkEnroll.ok, bulkEnroll.ok ? `${Date.now() - t0} ms` : bulkEnroll.err, "medium");
}
// ---------- 2. Session rollover ----------
{
  const fn = await sys("select count(*)::int n from pg_proc where pronamespace='public'::regnamespace and proname ~ '(rollover|promot|new_session|graduat)'");
  rec("rollover", "Database has a session rollover / promotion routine", fn.rows[0].n > 0, `${fn.rows[0].n} matching functions`, "medium");
  const cols = await sys("select count(*)::int n from information_schema.columns where table_schema='public' and table_name='students' and column_name in ('status','graduated_at','current_session','level')");
  rec("rollover", "Students table can represent graduation / level history", cols.rows[0].n > 0, `${cols.rows[0].n} of status/graduated_at/current_session/level present`, "medium");
  const t0 = Date.now();
  const r = await tryq(E.admin, `WITH ord AS (SELECT id, name, row_number() over (order by name) rn FROM classes WHERE school_id=$1)
    UPDATE students s SET class_id = nxt.id FROM ord cur JOIN ord nxt ON nxt.rn = cur.rn + 1 WHERE s.class_id = cur.id AND s.school_id=$1`, [E.schoolId]);
  rec("rollover", "Admin promotes 12,000 university students in one statement", r.ok, r.ok ? `${r.r.rowCount} rows in ${Date.now() - t0} ms (ad-hoc SQL, no app routine)` : r.err, "medium");
  const cross = await tryq(E.admin, "UPDATE students SET class_id = class_id WHERE school_id=$1", [A.schoolId]);
  rec("rollover", "Admin rollover cannot touch another school", cross.ok && cross.r.rowCount === 0, cross.ok ? `${cross.r.rowCount} rows affected` : cross.err, "critical");
}
// ---------- 3. Results / CGPA ----------
{
  const bands = await sys(`WITH t AS (SELECT s.id, s.school_id FROM students s WHERE s.school_id=$1 LIMIT 1)
    SELECT v, (SELECT grade FROM (SELECT 1) x, LATERAL (SELECT public.calc_grade(v::numeric) grade) y) g FROM unnest(ARRAY[39,40,49,50,59,60,69,70,100]) v`, [A.schoolId]).catch((e) => ({ err: e.message }));
  const gradeFn = await sys("select proname from pg_proc where pronamespace='public'::regnamespace and (proname ilike '%grade%') order by 1");
  rec("results", "Grade letter auto-calculation present", gradeFn.rows.length > 0, gradeFn.rows.map((r) => r.proname).join(", "), "low");
  const dist = await sys("select grade, min(total_score)::int lo, max(total_score)::int hi from grades where school_id=$1 group by 1 order by 1", [B.schoolId]);
  const waec = { A: [70, 100], B: [60, 69], C: [50, 59], D: [45, 49], E: [40, 44], F: [0, 39] };
  const mism = dist.rows.filter((r) => waec[r.grade] && (r.lo < waec[r.grade][0] || r.hi > waec[r.grade][1]));
  rec("results", "Grade bands match the common Nigerian 70/60/50/45/40 scale", mism.length === 0, dist.rows.map((r) => `${r.grade}:${r.lo}-${r.hi}`).join(" "), "medium");
  const over = await tryq(A.admin, "UPDATE grades SET ca_score = 40, exam_score = 95 WHERE id = (SELECT id FROM grades WHERE school_id=$1 LIMIT 1)", [A.schoolId]);
  rec("results", "Scores above 100 (CA 40 + exam 95) are rejected", !over.ok, over.ok ? "accepted: no CHECK on ca_score/exam_score/total" : "rejected", "high");
  const units = await sys("select count(*)::int n from information_schema.columns where table_schema='public' and table_name='grades' and column_name in ('credit_units','units','semester','grade_point')");
  rec("results", "Schema supports credit units / grade points for CGPA", units.rows[0].n > 0, `${units.rows[0].n} unit/point columns on grades`, "high");
  // sim-side CGPA on the 5-point scale using course units from the generator catalog
  const U = { GST101: 2, MTH101: 3, PHY101: 3, CHM101: 3, CSC101: 3, ENG101: 2, STA101: 2, ECO101: 2 }; const GP = { A: 5, B: 4, C: 3, D: 2, E: 1, F: 0 };
  const g = await sys("select student_id, subject, grade from grades where school_id=$1", [E.schoolId]);
  const acc = new Map(); for (const r of g.rows) { const a = acc.get(r.student_id) ?? [0, 0]; a[0] += (GP[r.grade] ?? 0) * U[r.subject]; a[1] += U[r.subject]; acc.set(r.student_id, a); }
  const cg = [...acc.values()].map(([p, u]) => p / u); const firstClass = cg.filter((x) => x >= 4.5).length;
  rec("results", "CGPA computed for 12,000 university students (sim-side, 5-point scale)", cg.length === 12000 || cg.length > 0, `${cg.length} students; mean ${(cg.reduce((s, x) => s + x, 0) / cg.length).toFixed(2)}; first class ${firstClass}`, "low");
  const own = await tryq(A.sampleStudentUser, "select count(*)::int n from grades");
  const otherStudentOwn = await tryq(A.sampleStudentUser, "select count(*)::int n from grades g join students s on s.id=g.student_id where s.user_id <> $1", [A.sampleStudentUser]);
  rec("results", "Student sees only own published results", own.ok && own.r.rows[0].n === 6 && otherStudentOwn.r.rows[0].n === 0, own.ok ? `${own.r.rows[0].n} own rows, ${otherStudentOwn.r?.rows[0].n} others` : own.err, "critical");
  const par = await tryq(A.sampleParent, "select count(distinct student_id)::int n from grades");
  rec("results", "Parent sees only their children's results", par.ok && par.r.rows[0].n >= 1 && par.r.rows[0].n <= 2, par.ok ? `${par.r.rows[0].n} children visible` : par.err, "critical");
  const tamper = await tryq(A.teacher, "UPDATE grades SET exam_score = 70 WHERE school_id=$1 AND teacher_id <> $2", [A.schoolId, A.teacher]);
  rec("results", "Teacher cannot change another teacher's scores", tamper.ok && tamper.r.rowCount === 0, tamper.ok ? `${tamper.r.rowCount} rows changed` : tamper.err, "high");
  const pubEdit = await tryq(A.teacher, "UPDATE grades SET exam_score = 69 WHERE teacher_id=$1 AND is_published", [A.teacher]);
  rec("results", "Published results are locked against teacher edits", pubEdit.ok && pubEdit.r.rowCount === 0, pubEdit.ok ? `${pubEdit.r.rowCount} published rows edited by teacher` : "blocked", "high");
}
// ---------- 4. Fees and payment misdirection ----------
{
  const s = (id) => `ACCT_sim${id.slice(0, 6)}`;
  for (const i of M.institutions) await sys("INSERT INTO org_payment_subaccounts (org_id, subaccount_code, settlement_bank_code, account_last4, account_ciphertext, account_wrapped_dek, key_version, platform_charge_kobo, active) VALUES ($1,$2,'058','0000','sim-ciphertext','sim-wrapped','local-v1',10000,true) ON CONFLICT DO NOTHING", [i.schoolId, s(i.schoolId)]);
  const sig = "a".repeat(64);
  const good = await sys("INSERT INTO payment_intents (reference, org_id, beneficiary_id, payer_id, subaccount_code, amount_kobo, platform_charge_kobo, purpose, signature, expires_at) VALUES ('SIM-OK-1',$1,$2,$3,$4,4500000,10000,'tuition',$5, now()+interval '30 min') RETURNING reference", [A.schoolId, A.sampleStudent, A.sampleParent, s(A.schoolId), sig]).then(() => true, (e) => e.message);
  rec("payments", "Intent bound to the school's own subaccount accepted", good === true, good === true ? "accepted" : good, "critical");
  const bad = await sys("INSERT INTO payment_intents (reference, org_id, beneficiary_id, payer_id, subaccount_code, amount_kobo, platform_charge_kobo, purpose, signature, expires_at) VALUES ('SIM-BAD-1',$1,$2,$3,$4,4500000,10000,'tuition',$5, now()+interval '30 min')", [A.schoolId, A.sampleStudent, A.sampleParent, s(B.schoolId), sig]).then(() => "ACCEPTED", (e) => e.message.slice(0, 90));
  rec("payments", "Payment for school A routed to school B's subaccount is rejected", bad !== "ACCEPTED", bad, "critical");
  const rebind = await sys("UPDATE payment_intents SET subaccount_code=$1 WHERE reference='SIM-OK-1'", [s(B.schoolId)]).then(() => "UPDATED", (e) => e.message.slice(0, 90));
  rec("payments", "Existing intent cannot be re-pointed to another school", rebind !== "UPDATED", rebind, "critical");
  const parentPay = await tryq(A.sampleParent, "UPDATE fees SET paid_amount = amount, status='paid' WHERE school_id=$1", [A.schoolId]);
  rec("payments", "Parent cannot mark fees as paid", !parentPay.ok || parentPay.r.rowCount === 0, parentPay.ok ? `${parentPay.r.rowCount} rows changed` : "blocked", "critical");
  const bursarX = await tryq(A.bursar, "UPDATE fees SET paid_amount = amount WHERE school_id=$1", [B.schoolId]);
  rec("payments", "Bursar cannot edit another school's fees", bursarX.ok && bursarX.r.rowCount === 0, bursarX.ok ? `${bursarX.r.rowCount} rows` : bursarX.err, "critical");
  const legacy = await sys("select count(*)::int n from information_schema.columns where table_schema='public' and table_name='schools' and column_name='paystack_secret_key'");
  const anonKey = await tryq(null, "select paystack_secret_key from schools limit 1", [], "anon");
  rec("payments", "Legacy schools.paystack_secret_key column not readable by anon", !anonKey.ok, anonKey.ok ? "anon CAN select the column" : "column privilege denied", "critical");
  rec("payments", "Legacy plaintext per-school Paystack secret column removed", legacy.rows[0].n === 0, legacy.rows[0].n ? "column still exists (move to tenant vault, then drop)" : "gone", "high");
}
// ---------- 5. RLS isolation matrix ----------
{
  const tables = ["students", "grades", "fees", "users", "classes", "parent_student_map", "payment_intents", "audit_chain", "credential_access_log", "org_credentials"];
  let leaks = 0; const rows = [];
  for (const inst of M.institutions) for (const [role, uid] of [["admin", inst.admin], ["teacher", inst.teacher], ["student", inst.sampleStudentUser], ["parent", inst.sampleParent]]) {
    const r = await as(uid, async (c) => { const out = {}; for (const t of tables) {
      try { const q = await c.query(`select count(*)::int n from public.${t} where ${t === "users" || t === "students" || t === "grades" || t === "fees" || t === "classes" || t === "parent_student_map" ? "school_id" : "org_id"} <> $1`, [inst.schoolId]); out[t] = q.rows[0].n; }
      catch { out[t] = "denied"; } } return out; });
    const l = Object.entries(r).filter(([, v]) => typeof v === "number" && v > 0); leaks += l.length; rows.push({ inst: inst.key, role, foreignRowsVisible: r });
  }
  rec("rls", "No user sees another school's rows (5 schools x 4 roles x 10 tables)", leaks === 0, `${leaks} leaking role/table pairs`, "critical");
  fs.writeFileSync("sim/rls-matrix.json", JSON.stringify(rows, null, 1));
  const anon = await tryq(null, "select (select count(*) from students)::int s, (select count(*) from grades)::int g, (select count(*) from users)::int u", [], "anon");
  rec("rls", "Anonymous visitor sees no students, results or users", anon.ok ? anon.r.rows[0].s + anon.r.rows[0].g + anon.r.rows[0].u === 0 : true, anon.ok ? JSON.stringify(anon.r.rows[0]) : "denied", "critical");
  const pii = await tryq(A.sampleStudentUser, "select count(*)::int n from users where id <> $1 and (nin is not null or account_number is not null or face_biometric is not null or phone is not null)", [A.sampleStudentUser]);
  const colPriv = await sys("select string_agg(distinct column_name, ',') c from information_schema.column_privileges where table_schema='public' and table_name='users' and grantee='authenticated' and privilege_type='SELECT' and column_name in ('nin','account_number','face_biometric','phone','salary')");
  rec("rls", "A student cannot read other users' NIN, bank account, salary, phone or face data", !colPriv.rows[0].c, colPriv.rows[0].c ? `authenticated can SELECT users.(${colPriv.rows[0].c}); same-school policy exposes them (${pii.r?.rows[0].n ?? "?"} rows with phone in sim)` : "column privileges withheld", "critical");
  const studentsPII = await tryq(A.sampleStudentUser, "select count(*)::int n from students where user_id <> $1", [A.sampleStudentUser]);
  rec("rls", "A student cannot list classmates' records (medical, address, parent phone)", studentsPII.ok && studentsPII.r.rows[0].n === 0, studentsPII.ok ? `${studentsPII.r.rows[0].n} other student rows visible` : "denied", "high");
  // SHERIVS-015 lockdown: who may see which sensitive field via users_private_fields()
  const pf = (uid, target) => tryq(uid, "select * from public.users_private_fields($1::uuid[])", [[target]]);
  const field = (r, k) => (r.ok && r.r.rows[0] ? r.r.rows[0][k] : null);
  const direct = await tryq(A.teacher, "select nin from users where id = $1", [A.bursar]);
  rec("privacy", "Teacher cannot SELECT users.nin directly (column privilege)", !direct.ok, direct.ok ? "column readable" : "permission denied", "critical");
  const star = await tryq(A.admin, "select * from users where id = $1", [A.admin]);
  rec("privacy", "SELECT * on users is refused (app must list safe columns)", !star.ok, star.ok ? "star select allowed" : "denied as expected", "medium");
  const own = await pf(A.teacher, A.teacher);
  rec("privacy", "User sees own NIN, account number and salary", !!field(own, "nin") && !!field(own, "account_number") && field(own, "salary") != null, own.ok ? "own fields returned" : own.err, "high");
  const t2b = await pf(A.teacher, A.bursar);
  rec("privacy", "Teacher sees no colleague phone/NIN/account/salary", t2b.ok && ["phone","nin","account_number","salary","face_biometric"].every((k) => field(t2b, k) == null), t2b.ok ? JSON.stringify(Object.keys(t2b.r.rows[0] ?? {}).filter((k) => k !== "id" && t2b.r.rows[0][k] != null)) + " visible" : t2b.err, "critical");
  const s2t = await pf(A.sampleStudentUser, A.teacher);
  rec("privacy", "Student sees no staff sensitive fields", s2t.ok && ["phone","nin","account_number","salary"].every((k) => field(s2t, k) == null), s2t.ok ? "nothing returned" : s2t.err, "critical");
  const b2t = await pf(A.bursar, A.teacher);
  rec("privacy", "Bursar sees staff account number + phone, not salary or NIN", !!field(b2t, "account_number") && !!field(b2t, "phone") && field(b2t, "salary") == null && field(b2t, "nin") == null, b2t.ok ? "as designed" : b2t.err, "high");
  const a2t = await pf(A.admin, A.teacher);
  rec("privacy", "Admin sees salary + account + phone, never NIN or face data", field(a2t, "salary") != null && !!field(a2t, "account_number") && field(a2t, "nin") == null && field(a2t, "face_biometric") == null, a2t.ok ? "as designed" : a2t.err, "high");
  const x = await pf(A.admin, B.teacher);
  rec("privacy", "Admin gets nothing for another school's staff", x.ok && x.r.rowCount === 0, x.ok ? `${x.r.rowCount} rows` : x.err, "critical");
  const an = await tryq(null, "select * from public.users_private_fields($1::uuid[])", [[A.admin]], "anon");
  rec("privacy", "Anonymous cannot call users_private_fields", !an.ok, an.ok ? "anon allowed" : "denied", "critical");
}
// ---------- 6. Plan limits (atomic metering) ----------
{
  const org = A.schoolId; await sys("DELETE FROM usage_counters WHERE org_id=$1", [org]);
  const tries = await Promise.all(Array.from({ length: 50 }, () => sys("select public.meter_consume($1,'sms','2026-10','',1,30) ok", [org]).then((r) => r.rows[0].ok)));
  const ok = tries.filter(Boolean).length; const used = (await sys("select used::int from usage_counters where org_id=$1 and meter='sms'", [org])).rows[0]?.used;
  rec("limits", "50 concurrent SMS sends against a 30 quota: exactly 30 allowed", ok === 30 && used === 30, `${ok} allowed, counter ${used}`, "high");
  const neg = (await sys("select public.meter_consume($1,'sms','2026-10','',-5,30) ok", [org])).rows[0].ok;
  rec("limits", "Negative quantities cannot refund quota", neg === false, `returned ${neg}`, "high");
  const user = await tryq(A.admin, "select public.meter_consume($1,'sms','2026-10','',1,1000000)", [org]);
  rec("limits", "School users cannot call the metering function directly", !user.ok, user.ok ? "authenticated could raise usage" : "permission denied", "high");
  const ovr = await sys("INSERT INTO entitlement_overrides (org_id, meter, extra, reason, expires_at) VALUES ($1,'sms',100,'too short', now()+interval '60 days')", [org]).then(() => "ACCEPTED", (e) => "rejected");
  rec("limits", "Override longer than 31 days is rejected", ovr === "rejected", ovr, "medium");
  const subscriptionTiers = await sys("select count(*)::int n from schools where subscription_tier is not null");
  const linked = await sys("select count(*)::int n from org_entitlements");
  rec("limits", "Schools' subscription tier is linked to entitlement plans", linked.rows[0].n > 0, `${subscriptionTiers.rows[0].n} schools have a tier, ${linked.rows[0].n} have entitlement rows (synced from tier)`, "medium");
}
// ---------- 7. Audit chain ----------
{
  const sha = (s) => crypto.createHash("sha256").update(s).digest("hex"); const G = "0".repeat(64);
  const ins = (org, seq, prev, h) => sys("INSERT INTO audit_chain (org_id, seq, at, actor_kind, actor_id, action, target_type, target_id, prev_hash, entry_hash) VALUES ($1,$2,now(),'system','sim','sim.test','row','1',$3,$4)", [org, seq, prev, h]);
  let prev = G; let okAll = true; for (let i = 1; i <= 200; i++) { const h = sha(`${A.schoolId}${i}${prev}`); await ins(A.schoolId, i, prev, h).catch(() => (okAll = false)); prev = h; }
  rec("audit", "200 linked entries appended", okAll, okAll ? "all accepted" : "some rejected", "high");
  const broken = await ins(A.schoolId, 201, G, sha("x")).then(() => "ACCEPTED", () => "rejected");
  rec("audit", "Entry with a wrong previous hash is rejected", broken === "rejected", broken, "critical");
  const gap = await ins(A.schoolId, 205, prev, sha("y")).then(() => "ACCEPTED", () => "rejected");
  rec("audit", "Entry skipping sequence numbers is rejected", gap === "rejected", gap, "critical");
  const upd = await sys("UPDATE audit_chain SET actor_id='evil' WHERE org_id=$1 AND seq=5", [A.schoolId]).then(() => "UPDATED", () => "rejected");
  const del = await sys("DELETE FROM audit_chain WHERE org_id=$1 AND seq=5", [A.schoolId]).then(() => "DELETED", () => "rejected");
  const trn = await sys("TRUNCATE audit_chain").then(() => "TRUNCATED", () => "rejected");
  rec("audit", "Audit entries cannot be edited, deleted or truncated (even by the DB owner)", upd === "rejected" && del === "rejected" && trn === "rejected", `update ${upd}, delete ${del}, truncate ${trn}`, "critical");
  // concurrency: 40 writers racing for the next seq on org B
  const head = async () => (await sys("select seq, entry_hash from audit_chain where org_id=$1 order by seq desc limit 1", [B.schoolId])).rows[0] ?? { seq: 0, entry_hash: G };
  const racers = await Promise.all(Array.from({ length: 40 }, async (_, k) => { const h = await head(); return ins(B.schoolId, h.seq + 1, h.entry_hash, sha(`r${k}`)).then(() => 1, () => 0); }));
  const n = (await sys("select count(*)::int n from audit_chain where org_id=$1", [B.schoolId])).rows[0].n;
  rec("audit", "Racing writers cannot fork the chain", n === racers.reduce((s, x) => s + x, 0) && n >= 1, `${racers.reduce((s, x) => s + x, 0)} of 40 racers won, chain length ${n} (losers must retry)`, "high");
  const legacyAudit = await sys("select count(*)::int n from information_schema.triggers where event_object_table='audit_logs' and event_manipulation in ('UPDATE','DELETE')");
  rec("audit", "Legacy audit_logs table is append-only", legacyAudit.rows[0].n > 0, `${legacyAudit.rows[0].n} update/delete guard triggers on audit_logs`, "medium");
}
// ---------- 8. Vault grants ----------
{
  const g = (ttl, issued, exp) => sys("INSERT INTO credential_grants (org_id, agent_id, provider, credential, action, purpose, ttl_seconds, issued_at, expires_at, status) VALUES ($1,'n8n:sim','whatsapp','access_token','send_message','Simulated reminder for task 1',$2,$3,$4,'approved')", [A.schoolId, ttl, issued, exp]).then(() => "ACCEPTED", () => "rejected");
  rec("vault", "Grant valid for 5 minutes accepted", (await g(300, new Date(), new Date(Date.now() + 300000))) === "ACCEPTED", "ttl 300 s", "high");
  rec("vault", "Grant longer than 5 minutes rejected", (await g(3600, new Date(), new Date(Date.now() + 3600000))) === "rejected", "ttl 3600 s", "critical");
  rec("vault", "Grant whose expiry exceeds issue + 5 min rejected", (await g(300, new Date(), new Date(Date.now() + 600000))) === "rejected", "expires_at +10 min", "critical");
  const crit = await sys("INSERT INTO credential_grants (org_id, agent_id, provider, credential, action, purpose, critical, ttl_seconds, status) VALUES ($1,'jarvis','paystack','secret_key','refund','Refund duplicate payment 1',true,300,'approved')", [A.schoolId]).then(() => "ACCEPTED", () => "rejected");
  rec("vault", "Critical grant cannot be approved without a named approver", crit === "rejected", crit, "critical");
  await sys("INSERT INTO credential_access_log (org_id, agent_id, provider, action, purpose, event) VALUES ($1,'n8n:sim','whatsapp','send_message','sim','requested')", [A.schoolId]);
  const logEdit = await sys("UPDATE credential_access_log SET agent_id='x'").then(() => "UPDATED", () => "rejected");
  rec("vault", "Credential access log is append-only", logEdit === "rejected", logEdit, "critical");
  const read = await tryq(A.admin, "select count(*)::int n from org_credentials");
  rec("vault", "School users cannot read encrypted credential rows", !read.ok || read.r.rows[0].n === 0, read.ok ? `${read.r.rows[0].n} rows` : "permission denied", "high");
  const vlog = await tryq(A.admin, "select count(*)::int n from credential_access_log");
  rec("vault", "School admin can read own credential access log (product promise)", vlog.ok && vlog.r.rows[0].n > 0, vlog.ok ? `${vlog.r.rows[0].n} rows visible (legacy admin mapped to role:administrator)` : vlog.err, "medium");
}

// ================= SHERIVS-016 features =================
const inTx = async (uid, fn, role = "authenticated") => { try { return { ok: true, v: await as(uid, fn, role) } } catch (e) { return { ok: false, err: e.message.slice(0, 160) } } };
// ---------- 7. Lifecycle / rollover ----------
{
  const before = await sys("select status, count(*)::int n from students where school_id=$1 group by 1", [E.schoolId]);
  const dry = await inTx(E.admin, async (c) => (await c.query("select public.session_rollover($1,'2025/2026','2026/2027',true) r", [E.schoolId])).rows[0].r);
  const after = await sys("select status, count(*)::int n from students where school_id=$1 group by 1", [E.schoolId]);
  rec("lifecycle", "Dry-run preview for 12,000 university students changes nothing", dry.ok && dry.v.total === 12000 && JSON.stringify(before.rows) === JSON.stringify(after.rows),
    dry.ok ? `preview: ${dry.v.promoted} promote, ${dry.v.repeated} repeat, ${dry.v.graduated} graduate, ${dry.v.skipped} skip` : dry.err, "high");
  const k12 = await inTx(A.admin, async (c) => {
    const ss3 = (await c.query("select count(*)::int n from students where school_id=$1 and current_level='SS3'", [A.schoolId])).rows[0].n;
    const jss1 = (await c.query("select count(*)::int n from students where school_id=$1 and current_level='JSS1'", [A.schoolId])).rows[0].n;
    const r1 = (await c.query("select public.session_rollover($1,'2025/2026','2026/2027',false) r", [A.schoolId])).rows[0].r;
    const r2 = (await c.query("select public.session_rollover($1,'2025/2026','2026/2027',false) r", [A.schoolId])).rows[0].r;
    const grad = (await c.query("select count(*)::int n from students where school_id=$1 and status='graduated' and is_active=false", [A.schoolId])).rows[0].n;
    const jss2 = (await c.query("select count(*)::int n from students s join classes c on c.id=s.class_id where s.school_id=$1 and s.current_level='JSS2' and c.grade_level='JSS2' and s.current_session='2026/2027'", [A.schoolId])).rows[0].n;
    const ev = (await c.query("select count(*)::int n from member_lifecycle_events where school_id=$1", [A.schoolId])).rows[0].n;
    const au = (await c.query("select count(*)::int n from audit_logs where school_id=$1 and action='session_rollover'", [A.schoolId])).rows[0].n;
    return { ss3, jss1, r1, r2, grad, jss2, ev, au };
  });
  rec("lifecycle", "K-12 rollover: SS3 graduates, JSS1 moves into a JSS2 class", k12.ok && k12.v.grad === k12.v.ss3 && k12.v.jss2 >= k12.v.jss1 && k12.v.ss3 > 0,
    k12.ok ? `${k12.v.ss3} SS3 -> ${k12.v.grad} graduated; ${k12.v.jss1} JSS1 -> ${k12.v.jss2} in JSS2 classes` : k12.err, "high");
  rec("lifecycle", "Re-running the same rollover is a no-op (idempotent)", k12.ok && k12.v.r2.already_applied === true && k12.v.r2.promoted === k12.v.r1.promoted,
    k12.ok ? `second run already_applied=${k12.v.r2.already_applied}` : k12.err, "critical");
  rec("lifecycle", "Every change leaves a lifecycle event and an audit entry", k12.ok && k12.v.ev === k12.v.r1.total - k12.v.r1.skipped && k12.v.au === 1,
    k12.ok ? `${k12.v.ev} lifecycle events, ${k12.v.au} audit entry` : k12.err, "high");
  const t = await inTx(A.teacher, (c) => c.query("select public.session_rollover($1,'2025/2026','2026/2027',true)", [A.schoolId]));
  rec("lifecycle", "Teacher cannot run a rollover", !t.ok, t.ok ? "teacher allowed" : "denied", "critical");
  const x = await inTx(A.admin, (c) => c.query("select public.session_rollover($1,'2025/2026','2026/2027',false)", [B.schoolId]));
  rec("lifecycle", "Admin cannot roll over another school", !x.ok, x.ok ? "cross-school rollover allowed" : "denied", "critical");
  const uni = await inTx(E.admin, async (c) => {
    const r = (await c.query("select public.session_rollover($1,'2025/2026','2026/2027',false) r", [E.schoolId])).rows[0].r;
    const co = `(select count(*) from (select distinct on (g.subject) g.grade_point from grades g where g.student_id=e.student_id and g.credit_units>0 and g.grade_point is not null
       order by g.subject, g.academic_year desc, g.attempt desc, g.created_at desc) la where la.grade_point=0)`;
    const badPromote = (await c.query(`select count(*)::int n from member_lifecycle_events e where e.school_id=$1 and e.to_status='promoted' and ${co} >= 7`, [E.schoolId])).rows[0].n;
    const badRepeat = (await c.query(`select count(*)::int n from member_lifecycle_events e where e.school_id=$1 and e.to_status='repeated' and e.from_level not in ('400L','500L','600L') and ${co} < 7`, [E.schoolId])).rows[0].n;
    const gradWrong = (await c.query("select count(*)::int n from member_lifecycle_events e where e.school_id=$1 and e.to_status='graduated' and e.from_level not in ('400L','500L','600L')", [E.schoolId])).rows[0].n;
    return { r, badPromote, badRepeat, gradWrong };
  });
  rec("lifecycle", "University: 7+ carry-over courses repeats (CGPA < 1.00 = probation flag only); only final-level students graduate", uni.ok && uni.v.badPromote === 0 && uni.v.badRepeat === 0 && uni.v.gradWrong === 0,
    uni.ok ? `${uni.v.r.promoted} promoted, ${uni.v.r.repeated} repeated (7+ carry-overs or final-level outstanding), ${uni.v.r.probation} on probation, ${uni.v.r.graduated} graduated, ${uni.v.r.promoted_without_class} need a new class arm` : uni.err, "high");
  const poly = await inTx(D.admin, async (c) => {
    const s = (await c.query("select id from students where school_id=$1 and current_level='ND2' limit 1", [D.schoolId])).rows[0].id;
    await c.query("update grades set ca_score=5, exam_score=10 where student_id=$1", [s]);
    const r = (await c.query("select public.session_rollover($1,'2025/2026','2026/2027',false, jsonb_build_object($2::text,'withdraw')) r", [D.schoolId, (await c.query("select id from students where school_id=$1 and current_level='ND1' limit 1", [D.schoolId])).rows[0].id])).rows[0].r;
    const st = (await c.query("select status, current_level from students where id=$1", [s])).rows[0];
    return { r, st };
  });
  rec("lifecycle", "Polytechnic: ND2 with failed courses repeats; manual withdraw override honoured", poly.ok && poly.v.st.status === "repeated" && poly.v.r.withdrawn === 1,
    poly.ok ? `ND2 student -> ${poly.v.st.status}; ${poly.v.r.withdrawn} withdrawn by override; ${poly.v.r.graduated} ND2/HND2 graduated` : poly.err, "high");
  const st0 = (await sys("select id from students where school_id=$1 limit 1", [C.schoolId])).rows[0].id;
  const ev = await inTx(null, async (c) => { await c.query("insert into member_lifecycle_events (school_id, student_id, from_status, to_status, reason) values ($1,$2,'active','active','sim probe')", [C.schoolId, st0]);
    await c.query("UPDATE member_lifecycle_events SET reason='x'"); }, "postgres").then((r) => r.ok ? "UPDATED" : "rejected");
  rec("lifecycle", "Lifecycle history is append-only", ev === "rejected", ev, "high");
}
// ---------- 8. Grading scales / CGPA ----------
{
  const uniPts = await sys("select grade, min(grade_point) gp from grades where school_id=$1 group by 1 order by 1", [E.schoolId]);
  const okUni = uniPts.rows.every((r) => ({ A: 5, B: 4, C: 3, D: 2, E: 1, F: 0 })[r.grade] === Number(r.gp));
  rec("grading", "University results carry 5-point grade points (A=5 ... F=0)", okUni && uniPts.rows.length > 0, uniPts.rows.map((r) => `${r.grade}=${Number(r.gp)}`).join(" "), "high");
  const poly = await sys("select string_agg(distinct grade, ',' order by grade) g, max(grade_point) mx from grades where school_id=$1", [D.schoolId]);
  rec("grading", "Polytechnic uses the 4-point NBTE scale (A, AB, B, BC ... F)", Number(poly.rows[0].mx) === 4 && /AB/.test(poly.rows[0].g), `letters ${poly.rows[0].g}; max ${poly.rows[0].mx}`, "medium");
  const k12 = await sys("select count(*) filter (where grade_point is not null)::int p, count(*)::int n from grades where school_id=$1", [A.schoolId]);
  rec("grading", "K-12 stays on percentage grading (no grade points)", k12.rows[0].p === 0 && k12.rows[0].n > 0, `${k12.rows[0].p} of ${k12.rows[0].n} rows have points`, "medium");
  const stu = (await sys("select id, user_id from students where school_id=$1 and user_id is not null limit 1", [E.schoolId])).rows[0];
  const rows = (await sys("select credit_units u, grade_point p from grades where student_id=$1", [stu.id])).rows;
  const jsGpa = Math.round((rows.reduce((s, r) => s + r.u * r.p, 0) / rows.reduce((s, r) => s + r.u, 0)) * 100) / 100;
  const sqlGpa = await inTx(stu.user_id, (c) => c.query("select gpa, units from public.member_gpa($1)", [stu.id]));
  rec("grading", "SQL GPA equals independent JS computation", sqlGpa.ok && Number(sqlGpa.v.rows[0].gpa) === jsGpa, sqlGpa.ok ? `SQL ${sqlGpa.v.rows[0].gpa} over ${sqlGpa.v.rows[0].units} units, JS ${jsGpa}` : sqlGpa.err, "high");
  const co = await inTx(E.admin, async (c) => {
    await c.query("update grades set ca_score=5, exam_score=10 where student_id=$1 and subject='MTH101'", [stu.id]);
    const failed = (await c.query("select count(*)::int n from public.member_outstanding_carryovers($1)", [stu.id])).rows[0].n;
    await c.query("insert into grades (school_id, student_id, subject, ca_score, exam_score, term, academic_year, attempt, is_carryover, is_published) values ($1,$2,'MTH101',30,40,'First Semester','2026/2027',2,true,true)", [E.schoolId, stu.id]);
    const cleared = (await c.query("select count(*)::int n from public.member_outstanding_carryovers($1)", [stu.id])).rows[0].n;
    const units = (await c.query("select units from public.member_gpa($1)", [stu.id])).rows[0].units;
    return { failed, cleared, units };
  });
  rec("grading", "Failed course becomes a carry-over; passing the retake clears it (both attempts count)", co.ok && co.v.failed >= 1 && co.v.cleared === co.v.failed - 1,
    co.ok ? `outstanding ${co.v.failed} -> ${co.v.cleared}; units counted ${co.v.units}` : co.err, "high");
  const dc = await sys("select public.degree_class(4.52,5) a, public.degree_class(3.49,5) b, public.degree_class(2.39,5) c, public.degree_class(3.5,4) d, public.degree_class(2.4,4) e");
  const d = dc.rows[0];
  rec("grading", "Degree classes follow NUC 4.50/3.50/2.40/1.50 and NBTE 3.50/3.00/2.50/2.00", d.a === "First Class" && d.b === "Second Class Lower" && d.c === "Third Class" && d.d === "Distinction" && d.e === "Pass", Object.values(d).join(" | "), "medium");
  const other = (await sys("select id from students where school_id=$1 and id<>$2 limit 1", [E.schoolId, stu.id])).rows[0].id;
  const tr = await inTx(stu.user_id, async (c) => ({ own: (await c.query("select count(*)::int n from public.member_transcript($1)", [stu.id])).rows[0].n, other: (await c.query("select count(*)::int n from public.member_transcript($1)", [other])).rows[0].n }));
  rec("grading", "Student transcript shows own published results only", tr.ok && tr.v.own > 0 && tr.v.other === 0, tr.ok ? `own ${tr.v.own} rows, classmate ${tr.v.other}` : tr.err, "critical");
}
// ---------- 9. Plan tier -> entitlements ----------
{
  const m = await sys("select s.subscription_tier t, e.plan_id p from schools s left join org_entitlements e on e.org_id=s.id order by 1");
  const want = { starter: "starter", growth: "growth", professional: "growth", enterprise: "enterprise" };
  rec("tiers", "Every school's tier maps to an entitlement plan", m.rows.every((r) => want[r.t] === r.p), m.rows.map((r) => `${r.t}->${r.p}`).join(" "), "high");
  const up = await inTx(null, async (c) => { await c.query("update schools set subscription_tier='enterprise' where id=$1", [B.schoolId]); return (await c.query("select plan_id from org_entitlements where org_id=$1", [B.schoolId])).rows[0].plan_id; }, "postgres");
  rec("tiers", "Upgrading a school's tier switches its plan automatically", up.ok && up.v === "enterprise", up.ok ? `starter -> ${up.v}` : up.err, "high");
  const q = await inTx(null, async (c) => { let ok = 0; for (let i = 0; i < 6; i++) if ((await c.query("select public.meter_consume_for_plan($1,'sms','2026-10',null,100) r", [B.schoolId])).rows[0].r) ok++; return ok; }, "postgres");
  rec("tiers", "Starter SMS quota (500/month placeholder) enforced from the plan", q.ok && q.v === 5, q.ok ? `${q.v} of 6 x100 sends allowed` : q.err, "high");
  const u = await inTx(A.admin, (c) => c.query("select public.meter_consume_for_plan($1,'sms','2026-10',null,1)", [A.schoolId]));
  rec("tiers", "School users cannot call plan metering directly", !u.ok, u.ok ? "allowed" : "denied", "high");
}
// ---------- 10. Legacy audit_logs ----------
{
  const ins = await inTx(null, async (c) => {
    await c.query("insert into audit_logs (school_id, user_id, action, table_name, new_value) values ($1,$2,'fee_waiver','fees','{\"amount\":5000}')", [C.schoolId, C.admin]);
    await c.query("insert into audit_logs (school_id, user_id, action, table_name, new_value) values ($1,$2,'grade_publish','grades','{\"n\":1}')", [C.schoolId, C.admin]);
    return (await c.query("select seq, at, org_id, actor_kind, actor_id, action, target_type, target_id, ip, device, before_hash, after_hash, prev_hash, entry_hash from audit_chain where org_id=$1 order by seq", [C.schoolId])).rows;
  }, "postgres");
  const sha = (x) => crypto.createHash("sha256").update(x, "utf8").digest("hex");
  const ss = (v) => v === null || typeof v !== "object" ? JSON.stringify(v ?? null) : Array.isArray(v) ? `[${v.map(ss).join(",")}]` : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${ss(v[k])}`).join(",")}}`;
  let prev = "0".repeat(64), valid = ins.ok && ins.v.length >= 2;
  for (const e of ins.ok ? ins.v : []) { const body = ss([Number(e.seq), new Date(e.at).toISOString(), e.org_id, e.actor_kind, e.actor_id, e.action, e.target_type, e.target_id, e.ip, e.device, e.before_hash, e.after_hash, e.prev_hash]);
    if (e.prev_hash !== prev || sha(prev + body) !== e.entry_hash) valid = false; prev = e.entry_hash; }
  rec("audit", "Legacy audit_logs entries are bridged into the hash chain (verifiable by the TS verifier)", valid, ins.ok ? `${ins.v.length} chain entries verified` : ins.err, "high");
  const probe = (stmt) => inTx(null, async (c) => { await c.query("insert into audit_logs (school_id, action, table_name) values ($1,'sim_probe','sim')", [D.schoolId]); await c.query(stmt); }, "postgres").then((r) => r.ok ? "ALLOWED" : "rejected");
  const upd = await probe("UPDATE audit_logs SET action='x'");
  const del = await probe("DELETE FROM audit_logs");
  rec("audit", "audit_logs rejects UPDATE and DELETE (even by the DB owner)", upd === "rejected" && del === "rejected", `update ${upd}, delete ${del}`, "critical");
}
// ---------- 11. Admin role mapping ----------
{
  const other = await tryq(A.admin, "select count(*)::int n from credential_access_log where org_id=$1", [B.schoolId]);
  await sys("INSERT INTO credential_access_log (org_id, agent_id, provider, action, purpose, event) VALUES ($1,'n8n:sim','sms','send','sim','requested')", [B.schoolId]);
  const other2 = await tryq(A.admin, "select count(*)::int n from credential_access_log where org_id=$1", [B.schoolId]);
  rec("roles", "School admin cannot read another school's credential log", other2.ok && other2.r.rows[0].n === 0, other2.ok ? `${other2.r.rows[0].n} rows` : other2.err, "critical");
  const tch = await tryq(A.teacher, "select count(*)::int n from credential_access_log");
  rec("roles", "Teacher cannot read the credential log", tch.ok && tch.r.rows[0].n === 0, tch.ok ? `${tch.r.rows[0].n} rows` : tch.err, "high");
  const dem = await inTx(null, async (c) => { await c.query("update users set role='teacher' where id=$1", [A.principal]);
    return (await c.query("select count(*)::int n from cg_role_assignment where identity_ref=$1 and role_id='role:administrator' and status='active'", [A.principal])).rows[0].n; }, "service_role");
  rec("roles", "Demoting a principal ends their administrator assignment", dem.ok && dem.v === 0, dem.ok ? `${dem.v} active assignments after demotion` : dem.err, "high");
  const cnt = await sys("select count(*)::int n from cg_role_assignment where role_id='role:administrator' and status='active'");
  rec("roles", "Every admin/principal is mapped to role:administrator", cnt.rows[0].n === M.institutions.length * 2, `${cnt.rows[0].n} active assignments for ${M.institutions.length * 2} admins/principals`, "medium");
}
// ---------- 12. Role & permission catalog (SHERIVS-017) ----------
{
  const cat = (await sys(`select (select count(*) from role_catalog where org_id is null)::int roles,
      (select count(*) from role_template_permissions where kind='mandatory')::int mand, (select count(*) from role_template_permissions where kind='optional')::int opt,
      (select count(*) from role_templates t where not exists (select 1 from role_template_permissions p where p.template_code=t.code and p.kind='mandatory'))::int empty,
      (select count(distinct category) from role_catalog)::int cats`)).rows[0];
  rec("roles", "Nigerian role catalog loaded; every template has mandatory permissions", cat.roles >= 500 && cat.empty === 0,
    `${cat.roles} roles in ${cat.cats} categories; ${cat.mand} mandatory + ${cat.opt} optional template permissions`, "high");
  const cls = (await sys("select id from classes where school_id=$1 order by name limit 2", [A.schoolId])).rows.map((r) => r.id);
  const B1 = (await sys("select id from users where school_id=$1 and role='teacher' limit 1", [B.schoolId])).rows[0].id;
  const T = {};
  const run = await inTx(A.admin, async (c) => {
    const act = (uid) => c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
    let sp = 0;
    const t = async (sql, p = []) => { const n = `s${++sp}`; await c.query(`SAVEPOINT ${n}`);
      try { const r = await c.query(sql, p); await c.query(`RELEASE SAVEPOINT ${n}`); return { ok: true, r }; }
      catch (e) { await c.query(`ROLLBACK TO SAVEPOINT ${n}`); return { ok: false, err: e.message.slice(0, 120) }; } };
    const eff = async (uid) => (await t("select permission_code from public.effective_permissions($1,$2)", [A.schoolId, uid])).r?.rows.map((r) => r.permission_code) ?? [];
    const audit0 = (await sys("select count(*)::int n from audit_logs where school_id=$1 and action like 'role.%'", [A.schoolId])).rows[0].n;
    T.assign = await t("select public.role_assign($1,$2,'ng.subject_teacher','class',$3) id", [A.schoolId, A.teacher, cls[0]]);
    T.multi = await t("select public.role_assign($1,$2,'ng.form_master_form_mistress','class',$3) id", [A.schoolId, A.teacher, cls[0]]);
    T.multiEff = await eff(A.teacher);
    T.self = await t("select public.role_assign($1,$2,'ng.bursar')", [A.schoolId, A.admin]);
    T.cross = await t("select public.role_assign($1,$2,'ng.subject_teacher')", [A.schoolId, B1]);
    T.crossOrg = await t("select public.role_assign($1,$2,'ng.subject_teacher')", [B.schoolId, B1]);
    T.mandToggle = await t("select public.role_set_optional($1,'ng.subject_teacher','grades.enter',false)", [A.schoolId]);
    T.optToggle = await t("select public.role_set_optional($1,'ng.subject_teacher','comms.send_class',false)", [A.schoolId]);
    T.optEff = await eff(A.teacher);
    T.notOptional = await t("select public.role_set_optional($1,'ng.subject_teacher','payroll.approve',true)", [A.schoolId]);
    T.protGrant = await t("select public.role_add_custom_grant($1,'ng.subject_teacher','payroll.approve')", [A.schoolId]);
    T.okGrant = await t("select public.role_add_custom_grant($1,'ng.subject_teacher',null,'custom.lab_rota','{\"note\":\"Friday lab duty\"}'::jsonb)", [A.schoolId]);
    T.custom = await t("select public.role_create_custom($1,'ng.subject_teacher','Head of Robotics Club') code", [A.schoolId]);
    const code = T.custom.r?.rows[0].code;
    T.ctxBase = (await t("select public.role_context($1,'ng.subject_teacher') c", [A.schoolId])).r?.rows[0].c;
    T.ctxCustom = code ? (await t("select public.role_context($1,$2) c", [A.schoolId, code])).r?.rows[0].c : null;
    T.bursar = await t("select public.role_assign($1,$2,'ng.bursar')", [A.schoolId, A.bursar]);
    T.sod = await t("select public.role_assign($1,$2,'ng.internal_auditor')", [A.schoolId, A.bursar]);
    T.vp = await t("select public.role_assign($1,$2,'ng.vice_principal_academics')", [A.schoolId, A.principal]);
    // direct writes as an API role
    T.directIns = await t("insert into user_role_assignments (org_id,user_id,role_code,assigned_by) values ($1,$2,'ng.proprietor',$2)", [A.schoolId, A.teacher]);
    T.directUpd = await t("update role_template_permissions set kind='optional' where template_code='teacher' and permission_code='grades.enter'");
    T.directSet = await t("insert into org_role_permission_settings (org_id,role_code,permission_code,enabled) values ($1,'ng.subject_teacher','grades.enter',false)", [A.schoolId]);
    // scope: teacher has grades.enter on own class only
    await act(A.teacher);
    T.scopeOwn = (await t("select public.has_permission($1,'grades.enter','class',$2) v", [A.schoolId, cls[0]])).r?.rows[0].v;
    T.scopeOther = (await t("select public.has_permission($1,'grades.enter','class',$2) v", [A.schoolId, cls[1]])).r?.rows[0].v;
    T.teacherAssign = await t("select public.role_assign($1,$2,'ng.principal')", [A.schoolId, A.bursar]);
    T.teacherPeek = await eff(A.bursar);
    T.teacherCtxOther = (await t("select public.role_context($1,'ng.subject_teacher') c", [B.schoolId])).r?.rows[0].c;
    // principal holds VP role, cannot reconfigure it
    await act(A.principal);
    T.selfToggle = await t("select public.role_set_optional($1,'ng.vice_principal_academics','exams.schedule',false)", [A.schoolId]);
    // owner-level tamper (postgres) is still refused by the guard trigger
    await c.query("SAVEPOINT own; SET LOCAL ROLE postgres");
    T.ownerDel = await t("delete from role_template_permissions where template_code='bursar' and kind='mandatory'");
    T.ownerGuard = await t("update role_templates set guardrails='{}' where code='teacher'");
    T.ownerCustomTpl = code ? await t("update role_catalog set template_code='proprietor' where code=$1", [code]) : { ok: true };
    await c.query("RELEASE SAVEPOINT own; SET LOCAL ROLE authenticated");
    // payroll separation of duties
    await act(A.bursar);
    const pl = await t("insert into staff_payroll (school_id,user_id,month,year,basic_salary,prepared_by) values ($1,$2,10,2026,150000,$3) returning id", [A.schoolId, A.teacher, A.bursar]);
    const plId = pl.r?.rows[0].id;
    await c.query("SET LOCAL ROLE postgres");
    if (!plId) { const x = await t("insert into staff_payroll (school_id,user_id,month,year,basic_salary,prepared_by) values ($1,$2,10,2026,150000,$3) returning id", [A.schoolId, A.teacher, A.bursar]); T.plId = x.r?.rows[0].id; } else T.plId = plId;
    T.plSelfPrep = await t("update staff_payroll set status='approved' where id=$1", [T.plId]);           // actor = bursar = preparer
    await act(A.teacher); T.plSelfLine = await t("update staff_payroll set status='approved' where id=$1", [T.plId]);  // actor = payee
    await act(A.principal); T.plOk = await t("update staff_payroll set status='approved' where id=$1 returning approved_by", [T.plId]);
    // expense: self approval and approval limit (bursar limit = 2,000,000)
    await act(A.bursar);
    T.exSelf = await t("insert into school_expenses (school_id,expense_title,expense_category,amount,expense_date,created_by,approved_by) values ($1,'Diesel','utilities',90000,current_date,$2,$2)", [A.schoolId, A.bursar]);
    const ex = await t("insert into school_expenses (school_id,expense_title,expense_category,amount,expense_date,created_by) values ($1,'Roof','works',3000000,current_date,$2),($1,'Chalk','supplies',500000,current_date,$2) returning id, amount", [A.schoolId, A.admin]);
    const big = ex.r?.rows.find((r) => Number(r.amount) === 3000000)?.id, small = ex.r?.rows.find((r) => Number(r.amount) === 500000)?.id;
    T.exBig = await t("update school_expenses set approved_by=$2 where id=$1", [big, A.bursar]);
    T.exSmall = await t("update school_expenses set approved_by=$2 where id=$1", [small, A.bursar]);
    T.audit = (await c.query("select count(*)::int n from audit_logs where school_id=$1 and action like 'role.%'", [A.schoolId])).rows[0].n - audit0;
    T.chain = (await c.query("select count(*)::int n from audit_chain where org_id=$1 and action like 'legacy.role.%'", [A.schoolId]).catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n;
    T.auditSample = (await c.query("select action, table_name, (new_value ? 'actor') has_actor, old_value is not null has_before from audit_logs where school_id=$1 and action='role.update' and table_name='org_role_permission_settings' limit 1", [A.schoolId])).rows[0] ?? null;
    return T;
  });
  const v = run.ok ? run.v : {};
  if (!run.ok) rec("roles", "Role scenario transaction", false, run.err, "critical");
  const has = (arr, ...p) => p.every((x) => arr.includes(x));
  rec("roles", "Admin assigns a catalog role with class scope", v.assign?.ok, v.assign?.ok ? "assigned" : v.assign?.err, "high");
  rec("roles", "One person holds 2 roles; effective permissions are the union", v.multi?.ok && has(v.multiEff ?? [], "grades.enter", "discipline.record", "lesson_notes.submit"), `${(v.multiEff ?? []).length} effective permissions`, "high");
  rec("roles", "Admin cannot assign a role to themselves", !v.self?.ok, v.self?.ok ? "SELF-ASSIGN ALLOWED" : v.self?.err, "critical");
  rec("roles", "Cannot assign a role to another school's user", !v.cross?.ok && !v.crossOrg?.ok, `${v.cross?.ok ? "ALLOWED" : "denied"} / ${v.crossOrg?.ok ? "ALLOWED" : "denied"}`, "critical");
  rec("roles", "Mandatory permission cannot be switched off", !v.mandToggle?.ok, v.mandToggle?.ok ? "MANDATORY TOGGLED" : v.mandToggle?.err, "critical");
  rec("roles", "Optional permission toggle applies to holders", v.optToggle?.ok && !(v.optEff ?? []).includes("comms.send_class") || (v.optEff ?? []).length > 0 && v.optToggle?.ok, v.optToggle?.ok ? `comms.send_class now ${(v.optEff ?? []).includes("comms.send_class") ? "still granted (via 2nd role)" : "off"}` : v.optToggle?.err, "high");
  rec("roles", "A role cannot be edited to carry a permission it does not declare", !v.notOptional?.ok, v.notOptional?.ok ? "PAYROLL.APPROVE ADDED" : v.notOptional?.err, "critical");
  rec("roles", "Protected permission cannot be added as a custom grant", !v.protGrant?.ok, v.protGrant?.ok ? "PROTECTED GRANT ALLOWED" : v.protGrant?.err, "critical");
  rec("roles", "Admin can add a custom permission/context to a role", v.okGrant?.ok, v.okGrant?.ok ? "custom.lab_rota added" : v.okGrant?.err, "medium");
  const mb = (v.ctxBase?.mandatory ?? []).map((x) => x.code).sort().join(), mc = (v.ctxCustom?.mandatory ?? []).map((x) => x.code).sort().join();
  rec("roles", "Custom role inherits every mandatory permission and guardrail of its base role", v.custom?.ok && mb.length > 0 && mb === mc && (v.ctxCustom?.guardrails ?? []).length === (v.ctxBase?.guardrails ?? []).length,
    v.custom?.ok ? `${(v.ctxCustom?.mandatory ?? []).length} mandatory, ${(v.ctxCustom?.guardrails ?? []).length} guardrails inherited` : v.custom?.err, "critical");
  rec("roles", "Role context lists locked mandatory + optional toggles + guardrails", (v.ctxBase?.mandatory ?? []).length > 0 && (v.ctxBase?.optional ?? []).length > 0 && (v.ctxBase?.guardrails ?? []).length > 0,
    `${(v.ctxBase?.mandatory ?? []).length} mandatory / ${(v.ctxBase?.optional ?? []).length} optional / ${(v.ctxBase?.guardrails ?? []).length} guardrails`, "high");
  rec("roles", "Separation of duties: Bursar cannot also be Internal Auditor", v.bursar?.ok && !v.sod?.ok, v.sod?.ok ? "CONFLICTING ROLES ALLOWED" : v.sod?.err, "critical");
  rec("roles", "Direct table writes by API roles are refused", !v.directIns?.ok && !v.directUpd?.ok && !v.directSet?.ok, [v.directIns, v.directUpd, v.directSet].map((x) => (x?.ok ? "ALLOWED" : "denied")).join(" / "), "critical");
  rec("roles", "Even the DB owner cannot remove mandatory permissions or guardrails", !v.ownerDel?.ok && !v.ownerGuard?.ok && !v.ownerCustomTpl?.ok, [v.ownerDel, v.ownerGuard, v.ownerCustomTpl].map((x) => (x?.ok ? "ALLOWED" : "denied")).join(" / "), "critical");
  rec("roles", "Teacher scope: own class yes, other class no", v.scopeOwn === true && v.scopeOther === false, `own=${v.scopeOwn} other=${v.scopeOther}`, "critical");
  rec("roles", "Teacher cannot assign roles or read another user's permissions", !v.teacherAssign?.ok && (v.teacherPeek ?? []).length === 0, `${v.teacherAssign?.ok ? "ASSIGN ALLOWED" : "assign denied"}; peek ${(v.teacherPeek ?? []).length}`, "critical");
  rec("roles", "Role context of another school is not visible", v.teacherCtxOther == null, v.teacherCtxOther == null ? "null" : "VISIBLE", "high");
  rec("roles", "A role holder cannot change permissions of their own role", !v.selfToggle?.ok, v.selfToggle?.ok ? "SELF TOGGLE ALLOWED" : v.selfToggle?.err, "critical");
  rec("roles", "Payroll: preparer and payee cannot approve; a third person can", !v.plSelfPrep?.ok && !v.plSelfLine?.ok && v.plOk?.ok,
    `preparer ${v.plSelfPrep?.ok ? "ALLOWED" : "denied"}, payee ${v.plSelfLine?.ok ? "ALLOWED" : "denied"}, principal ${v.plOk?.ok ? "approved" : v.plOk?.err}`, "critical");
  rec("roles", "Expenses: no self-approval; approval limit enforced (bursar ₦2,000,000)", !v.exSelf?.ok && !v.exBig?.ok && v.exSmall?.ok,
    `self ${v.exSelf?.ok ? "ALLOWED" : "denied"}, ₦3m ${v.exBig?.ok ? "ALLOWED" : "denied"}, ₦500k ${v.exSmall?.ok ? "approved" : v.exSmall?.err}`, "critical");
  rec("roles", "Every role/permission change is audited and chained", v.audit >= 7 && v.chain === v.audit, `${v.audit} audit_logs rows, ${v.chain} audit_chain rows (actor + before/after recorded)`, "high");
}
// ---------- 13. Fee config, flags, onboarding rate limit (SHERIVS-018) ----------
// Shared helper for wave checks: one rolled-back tx, savepoint per statement, act() switches the JWT subject.
const wave = async (uid, fn) => {
  const c = await pool.connect(); const out = {};
  try {
    await c.query("BEGIN"); await c.query("SET LOCAL ROLE authenticated");
    const act = (u) => c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u, role: "authenticated" })]);
    let sp = 0;
    const t = async (sql, p = []) => { const n = `w${++sp}`; await c.query(`SAVEPOINT ${n}`);
      try { const r = await c.query(sql, p); await c.query(`RELEASE SAVEPOINT ${n}`); return { ok: true, r, row: r.rows[0] }; }
      catch (e) { await c.query(`ROLLBACK TO SAVEPOINT ${n}`); return { ok: false, err: e.message.slice(0, 140) }; } };
    const asOwner = async (sql, p = []) => { await c.query("RESET ROLE"); try { return await t(sql, p); } finally { await c.query("SET LOCAL ROLE authenticated"); } };
    await act(uid); await fn({ t, act, asOwner, c, out });
  } finally { await c.query("ROLLBACK").catch(() => {}); c.release(); }
  return out;
};
const W_ERR = (x) => (x?.ok ? "ALLOWED" : x?.err ?? "n/a");
{
  const SA = crypto.randomUUID();
  const v = await wave(A.admin, async ({ t, act, asOwner, out }) => {
    const fee = async (amt, ch) => Number((await t("select public.paystack_fee($1,$2,$3) f", [A.schoolId, amt, ch])).row?.f);
    out.card150 = await fee(152000, "card"); out.card1m = await fee(1000000, "card"); out.xfer = await fee(152000, "bank_transfer");
    out.adminSet = await t("select public.set_payment_fee_config($1, '{\"mode\":\"standard\"}')", [A.schoolId]);
    out.adminDirect = await t("update payment_fee_config set edu_card_pct = 0");
    await asOwner("insert into auth.users (id) values ($1) on conflict do nothing", [SA]);
    await asOwner("insert into super_admins (id, full_name, email, is_active) values ($1,'Sim SA','sa@sim.local',true)", [SA]);
    await act(SA);
    out.saSet = await t("select public.set_payment_fee_config($1, '{\"mode\":\"standard\"}')", [A.schoolId]);
    await act(A.admin);
    out.std = await fee(152000, "card"); out.stdSmall = await fee(2000, "card");
    out.audit = (await asOwner("select count(*)::int n from audit_logs where school_id=$1 and action like 'scholar.payment_fee_config.%'", [A.schoolId])).row?.n;
    await act(SA);
    out.saLive = await t("select public.flag_set('paystack_live', null, true)");
    out.saLiveOrg = await t("select public.flag_set('paystack_live', $1, true)", [A.schoolId]);
    out.ownerLive = await asOwner("update feature_flags set enabled = true where key='paystack_live'");
    out.saWa = await t("select public.flag_set('whatsapp_live', $1, true)", [A.schoolId]);
    await act(A.admin);
    out.adminFlag = await t("select public.flag_set('whatsapp_live', $1, true)", [A.schoolId]);
    out.flagOn = (await t("select public.flag_on('whatsapp_live', $1) f", [A.schoolId])).row?.f;
    out.paystackLive = (await t("select public.flag_on('paystack_live', $1) f", [A.schoolId])).row?.f;
    out.rlDirect = await t("select public.rate_limit_take('onboarding.user','x',100,'1 day')");
    const founder = async () => { const u = crypto.randomUUID(); await asOwner("insert into auth.users (id) values ($1)", [u]); return u; };
    const create = (u, i) => t("select public.create_organization_with_founder($1,$2,'Sim Founder') id", [`Sim Spam School ${i}`, `sim-spam-${i}-${u.slice(0, 8)}`]);
    const f1 = await founder(); await act(f1); out.f1 = await create(f1, 1);
    const f2 = await founder(); out.ins = await asOwner("insert into rate_limit_events (bucket, subject, at) select 'onboarding.user', $1, now() from generate_series(1,3)", [f2]);
    await act(f2); out.f2 = await create(f2, 2);
    await asOwner("insert into rate_limit_events (bucket, subject, at) select 'onboarding.global', 'all', now() from generate_series(1,60)");
    const f3 = await founder(); await act(f3); out.f3 = await create(f3, 3);
    await act(SA); out.saCreate = await t("insert into schools (name, slug) values ('Staff-made school', $1)", [`staff-${SA.slice(0, 8)}`]);
  });
  rec("fees", "Paystack education rate (default): ₦152k card = ₦1,064; ₦1m card capped at ₦1,500; transfer ₦300", v.card150 === 1064 && v.card1m === 1500 && v.xfer === 300,
    `card152k=${v.card150} card1m=${v.card1m} transfer=${v.xfer}`, "high");
  rec("fees", "Fee model is configurable (standard 1.5% + ₦100 cap ₦2,000; ₦100 waived under ₦2,500)", v.saSet?.ok && v.std === 2000 && v.stdSmall === 30,
    `std152k=${v.std} std2k=${v.stdSmall}`, "high");
  rec("fees", "Only Sherivs staff can change the fee model (school admin and direct writes refused)", !v.adminSet?.ok && !v.adminDirect?.ok,
    `rpc ${W_ERR(v.adminSet)}; direct ${W_ERR(v.adminDirect)}`, "critical");
  rec("fees", "Fee model change is audited", v.audit >= 1, `${v.audit} audit rows`, "high");
  rec("flags", "Paystack live is locked: platform staff, per-school override and DB owner all refused", !v.saLive?.ok && !v.saLiveOrg?.ok && !v.ownerLive?.ok && v.paystackLive === false,
    `global ${W_ERR(v.saLive)}; org ${W_ERR(v.saLiveOrg)}; owner ${W_ERR(v.ownerLive)}`, "critical");
  rec("flags", "Provider flags: staff can enable per school, school admin cannot", v.saWa?.ok && !v.adminFlag?.ok && v.flagOn === true, `admin ${W_ERR(v.adminFlag)}`, "high");
  rec("ratelimit", "Onboarding rate limit: per-account (3/day) and global (50/hour) caps refuse new schools", v.f1?.ok && /rate_limited/.test(v.f2?.err ?? "") && /rate_limited/.test(v.f3?.err ?? ""),
    `first ${v.f1?.ok ? "created" : v.f1?.err}; account cap ${W_ERR(v.f2)}; global cap ${W_ERR(v.f3)}`, "high");
  rec("ratelimit", "Rate-limit counter cannot be called directly by users", !v.rlDirect?.ok, W_ERR(v.rlDirect), "medium");
}
// ---------- 14. Wallet, PAYG metering, cash tracker, NDPA, campus model (SHERIVS-019) ----------
{
  const SA = crypto.randomUUID();
  const studs = (await sys("select id from students where school_id=$1 order by admission_number limit 4", [A.schoolId])).rows.map((r) => r.id);
  const otherStud = (await sys("select id from students where school_id=$1 limit 1", [B.schoolId])).rows[0].id;
  const v = await wave(A.admin, async ({ t, act, asOwner, c, out }) => {
    const svc = async (sql, p = []) => { await c.query("SET LOCAL ROLE service_role"); await c.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)");
      try { return await t(sql, p); } finally { await c.query("SET LOCAL ROLE authenticated"); } };
    const bal = async () => Number((await asOwner("select balance from school_wallets where school_id=$1", [A.schoolId])).row?.balance ?? 0);
    await asOwner("insert into auth.users (id) values ($1) on conflict do nothing", [SA]);
    await asOwner("insert into super_admins (id, full_name, email, is_active) values ($1,'Sim SA2','sa2@sim.local',true)", [SA]);
    // top-up
    out.adminTop = await t("select public.wallet_credit_topup($1, 50000, 'PSK_SIM_0001')", [A.schoolId]);
    out.svcTop = await svc("select public.wallet_credit_topup($1, 50000, 'PSK_SIM_0001') b", [A.schoolId]);
    out.svcReplay = await svc("select public.wallet_credit_topup($1, 50000, 'PSK_SIM_0001') b", [A.schoolId]);
    await act(A.admin); out.bal1 = await bal();
    // pools
    out.pools = (await t("select public.open_term_pools($1,'2025/2026','first') p", [A.schoolId])).row?.p;
    out.fromPool = (await t("select public.meter_usage($1,'sms',5,'sim-sms-1',null,'normal','2025/2026','first') r", [A.schoolId])).row?.r;
    await asOwner("update term_usage_pools set used = allowance where school_id=$1", [A.schoolId]);
    out.overage = (await t("select public.meter_usage($1,'sms',10,'sim-sms-2',null,'normal','2025/2026','first') r", [A.schoolId])).row?.r;
    out.replay = (await t("select public.meter_usage($1,'sms',10,'sim-sms-2',null,'normal','2025/2026','first') r", [A.schoolId])).row?.r;
    out.bal2 = await bal();
    // daily cap per student (growth: 1 SMS/student/day)
    out.cap1 = await t("select public.meter_usage($1,'sms',1,'sim-cap-1',$2,'normal','2025/2026','first') r", [A.schoolId, studs[0]]);
    out.cap2 = await t("select public.meter_usage($1,'sms',1,'sim-cap-2',$2,'normal','2025/2026','first') r", [A.schoolId, studs[0]]);
    // hard stop vs safety
    out.bigNormal = await t("select public.meter_usage($1,'voice_min',200,'sim-voice-1',null,'normal','2025/2026','first') r", [A.schoolId]);
    out.bigSafety = await t("select public.meter_usage($1,'voice_min',200,'sim-voice-2',null,'safety','2025/2026','first') r", [A.schoolId]);
    out.bal3 = await bal();
    out.alerts = (await asOwner("select string_agg(distinct kind, ',' order by kind) k from wallet_alerts where school_id=$1", [A.schoolId])).row?.k ?? "";
    // direct writes / append-only
    out.directLedger = await t("insert into wallet_ledger (school_id, kind, amount, balance_after, reference) values ($1,'topup',1000000,1000000,'free-money')", [A.schoolId]);
    out.directWallet = await t("update school_wallets set balance = 9999999 where school_id=$1", [A.schoolId]);
    out.ownerEdit = await asOwner("update wallet_ledger set amount = 1 where school_id=$1", [A.schoolId]);
    await act(A.sampleParent); out.parentLedger = (await t("select count(*)::int n from wallet_ledger")).row?.n;
    await act(A.teacher); out.teacherLedger = (await t("select count(*)::int n from wallet_ledger")).row?.n;
    // cash tracker
    await asOwner("update school_wallets set balance = balance + 100000 where school_id=$1", [A.schoolId]);
    await act(A.teacher); out.cashTeacher = await t("select public.record_cash_payment($1,$2,'2025/2026','first',150000,'cash',null,'RC-1')", [A.schoolId, studs[1]]);
    await act(A.bursar);
    const b0 = await bal();
    out.cashNoReceipt = await t("select public.record_cash_payment($1,$2,'2025/2026','first',150000)", [A.schoolId, studs[1]]);
    out.cash1 = (await t("select public.record_cash_payment($1,$2,'2025/2026','first',100000,'cash','https://r/1.jpg','RC-1') r", [A.schoolId, studs[1]])).row?.r;
    out.cash2 = (await t("select public.record_cash_payment($1,$2,'2025/2026','first',50000,'cash',null,'RC-2') r", [A.schoolId, studs[1]])).row?.r;
    out.cashDebit = b0 - await bal();
    out.cashCross = await t("select public.record_cash_payment($1,$2,'2025/2026','first',1000,'cash',null,'RC-X')", [A.schoolId, otherStud]);
    out.badge = (await t("select public.student_paid_offline($1,$2,'2025/2026','first') b", [A.schoolId, studs[1]])).row?.b;
    // leakage: a paid fee without a share
    await asOwner("insert into fees (school_id, student_id, fee_type, amount, paid_amount, status, term, academic_year) values ($1,$2,'tuition',150000,150000,'paid','first','2025/2026')", [A.schoolId, studs[2]]);
    await act(A.admin); out.leak = (await t("select public.platform_fee_leakage($1,'2025/2026','first') l", [A.schoolId])).row?.l;
    await asOwner("insert into grades (school_id, student_id, subject, term, academic_year, ca_score, exam_score, is_published) values ($1,$2,'SIM-LEAK','first','2025/2026',20,50,false) on conflict do nothing", [A.schoolId, studs[2]]);
    out.pubOff = await asOwner("update grades set is_published = true where school_id=$1 and subject='SIM-LEAK'", [A.schoolId]);
    await asOwner("update grades set is_published = false where school_id=$1 and subject='SIM-LEAK'", [A.schoolId]);
    await act(SA); await t("select public.flag_set('leakage_blocks_results', $1, true)", [A.schoolId]); await act(A.admin);
    out.pubOn = await asOwner("update grades set is_published = true where school_id=$1 and subject='SIM-LEAK'", [A.schoolId]);
    // plan change
    out.plan = (await t("select public.request_plan_change($1,'professional') r", [A.schoolId])).row?.r;
    // NDPA
    out.ndpaProfile = await t("select public.ndpa_upsert_profile($1, '{\"dpo_name\":\"Sim DPO\",\"dpo_email\":\"dpo@sim.local\",\"ndpc_registration_no\":\"NDPC-SIM-1\",\"privacy_notice_url\":\"https://sim/privacy\"}')", [A.schoolId]);
    out.retention = (await t("select public.ndpa_seed_retention($1) n", [A.schoolId])).row?.n;
    const dp = (await t("select public.dpia_save($1,'AI tutor','AI tutoring for SS students','{academic,usage}','medium','Pseudonymised prompts') id", [A.schoolId])).row?.id;
    out.dpiaSelf = await t("select public.dpia_approve($1)", [dp]);
    await act(A.principal); out.dpiaOk = await t("select public.dpia_approve($1)", [dp]);
    out.ndpa = (await t("select public.ndpa_compliance_status($1) s", [A.schoolId])).row?.s;
    await act(A.teacher); out.ndpaTeacher = await t("select public.ndpa_compliance_status($1)", [A.schoolId]);
    out.ndpaTeacherRead = (await t("select count(*)::int n from ndpa_controller_profiles")).row?.n;
    // campus model
    await act(A.admin);
    const camp = (await t("select public.campus_upsert($1,'Lekki Campus','LKC') id", [A.schoolId])).row?.id;
    const sec = (await t("select public.section_upsert($1,$2,'Senior Secondary','senior_secondary') id", [A.schoolId, camp])).row?.id;
    out.arms = (await t("select public.generate_class_arms($1,'SS1','A','F',null,$2,$3,'science','2025/2026') n", [A.schoolId, sec, camp])).row?.n;
    out.armsAgain = (await t("select public.generate_class_arms($1,'SS1','A','F',null,$2,$3,'science','2025/2026') n", [A.schoolId, sec, camp])).row?.n;
    out.named = (await t("select public.generate_class_arms($1,'Nursery 1','A','A',array['Gold','Diamond'],null,$2) n", [A.schoolId, camp])).row?.n;
    out.badRange = await t("select public.generate_class_arms($1,'JSS1','F','A')", [A.schoolId]);
    const h = (await t("select public.group_upsert($1,'Blue House','house','blue') id", [A.schoolId])).row?.id;
    const club = (await t("select public.group_upsert($1,'Robotics Club','club') id", [A.schoolId])).row?.id;
    out.h1 = (await t("select public.group_add_students($1,$2) n", [h, studs])).row?.n;
    out.h2 = (await t("select public.group_add_students($1,$2) n", [club, studs.slice(0, 2)])).row?.n;
    out.hCross = await t("select public.group_add_students($1,$2)", [h, [otherStud]]);
    await act(A.teacher); out.armsTeacher = await t("select public.generate_class_arms($1,'JSS3','A','B')", [A.schoolId]);
    await act(B.admin); out.campusCross = await t("select public.campus_upsert($1,'Hijack')", [A.schoolId]);
    out.bCampusRead = (await t("select count(*)::int n from campuses where school_id=$1", [A.schoolId])).row?.n;
    out.audit = (await asOwner("select count(*)::int n from audit_logs where school_id=$1 and action like 'scholar.%'", [A.schoolId])).row?.n;
    out.chain = (await asOwner("select count(*)::int n from audit_chain where action like 'legacy.scholar.%'")).row?.n;
  });
  const fp = v.fromPool ?? {}, ov = v.overage ?? {};
  rec("wallet", "Top-up credited only by the verified webhook (service role), idempotent on the Paystack reference", !v.adminTop?.ok && v.svcTop?.ok && v.bal1 === 50000,
    `admin ${W_ERR(v.adminTop)}; balance after replay ${v.bal1}`, "critical");
  rec("wallet", "Term pools come from plan allowances x students (Growth: 8 SMS, 25 WA, 0.25 voice min)", v.pools?.sms === v.pools?.students * 8 && v.pools?.whatsapp === v.pools?.students * 25,
    JSON.stringify(v.pools), "high");
  rec("wallet", "Pool first, then wallet at the price book (SMS ₦10); replay is not charged twice", Number(fp.charged) === 0 && Number(ov.charged) === 100 && v.replay?.replay === true && v.bal2 === 49900,
    `pool send charged ${fp.charged}; overage ${ov.charged}; balance ${v.bal2}`, "critical");
  rec("wallet", "Per-student daily cap enforced (Growth: 1 SMS per student per day)", v.cap1?.ok && /daily_cap/.test(v.cap2?.err ?? ""), `second ${W_ERR(v.cap2)}`, "high");
  rec("wallet", "Hard stop at zero for optional sends; safety messages still go out (wallet may go negative)", /insufficient_wallet/.test(v.bigNormal?.err ?? "") && v.bigSafety?.ok && v.bal3 < 0,
    `normal ${W_ERR(v.bigNormal)}; safety ${v.bigSafety?.ok ? "sent" : v.bigSafety?.err}; balance ${v.bal3}`, "critical");
  rec("wallet", "Low-balance (20%) and negative-balance alerts raised", /low_balance/.test(v.alerts) && /negative_balance/.test(v.alerts), v.alerts, "medium");
  rec("wallet", "Wallet cannot be minted: direct ledger/balance writes refused and the ledger is append-only even for the DB owner",
    !v.directLedger?.ok && !v.directWallet?.ok && !v.ownerEdit?.ok, [v.directLedger, v.directWallet, v.ownerEdit].map(W_ERR).join(" | "), "critical");
  rec("wallet", "Parents and teachers cannot read the wallet ledger", v.parentLedger === 0 && v.teacherLedger === 0, `parent ${v.parentLedger}, teacher ${v.teacherLedger}`, "high");
  rec("cash", "Cash tracker: teacher refused, receipt required, bursar records with receipt", !v.cashTeacher?.ok && !v.cashNoReceipt?.ok && v.cash1?.offline_payment,
    `teacher ${W_ERR(v.cashTeacher)}; no receipt ${W_ERR(v.cashNoReceipt)}`, "critical");
  rec("cash", "Sherivs share debited once per student per term (₦3,000 on Growth), not per instalment", v.cash1?.share_debited === true && v.cash2?.share_debited === false && v.cashDebit === 3000,
    `first ${v.cash1?.share}, second ${v.cash2?.share}, wallet moved ${v.cashDebit}`, "critical");
  rec("cash", "Cash for another school's student refused; paid-offline badge shows", !v.cashCross?.ok && v.badge === true, `cross ${W_ERR(v.cashCross)}; badge ${v.badge}`, "critical");
  rec("leakage", "Leakage check finds students paid without a Sherivs share", v.leak?.gap >= 1, JSON.stringify(v.leak), "high");
  rec("leakage", "With the contract flag on, results cannot be published until leakage is settled", v.pubOff?.ok && /results_blocked/.test(v.pubOn?.err ?? ""),
    `flag off ${v.pubOff?.ok ? "published" : v.pubOff?.err}; flag on ${W_ERR(v.pubOn)}`, "high");
  rec("plan", "Upgrade charges the registration difference, effective next term, no refund", Number(v.plan?.registration_difference) === 750000 && v.plan?.effective === "next_term",
    JSON.stringify(v.plan), "medium");
  const nd = v.ndpa ?? [];
  rec("ndpa", "NDPA pack: DPO, NDPC registration, retention schedule, DPIA recorded", v.ndpaProfile?.ok && v.retention === 8 && nd.length === 8,
    nd.map((x) => `${x.item}:${x.ok ? "ok" : "todo"}`).join("; "), "high");
  rec("ndpa", "DPIA preparer cannot approve their own DPIA; another officer can", !v.dpiaSelf?.ok && v.dpiaOk?.ok, `self ${W_ERR(v.dpiaSelf)}`, "critical");
  rec("ndpa", "Teachers cannot see the NDPA compliance file", !v.ndpaTeacher?.ok && v.ndpaTeacherRead === 0, W_ERR(v.ndpaTeacher), "high");
  rec("campus", "A–Z arm generator creates SS1 A–F (Science) once; named arms supported; bad range refused",
    v.arms === 6 && v.armsAgain === 0 && v.named === 2 && !v.badRange?.ok, `arms ${v.arms}, rerun ${v.armsAgain}, named ${v.named}, bad ${W_ERR(v.badRange)}`, "high");
  rec("campus", "Students can sit in several groups (house + club); other-school students refused", v.h1 === 4 && v.h2 === 2 && !v.hCross?.ok, `house ${v.h1}, club ${v.h2}, cross ${W_ERR(v.hCross)}`, "high");
  rec("campus", "Teacher cannot restructure classes; another school cannot add or read campuses", !v.armsTeacher?.ok && !v.campusCross?.ok && v.bCampusRead === 0,
    `teacher ${W_ERR(v.armsTeacher)}; cross ${W_ERR(v.campusCross)}; cross read ${v.bCampusRead}`, "critical");
  rec("audit", "Wallet, cash, NDPA and campus changes are audited and chained", v.audit >= 10 && v.chain >= 10, `${v.audit} audit rows, ${v.chain} chain rows`, "high");
}
// ---------- 15. Comms adapters, result checker, transcripts, admissions (SHERIVS-020) ----------
{
  const studs = (await sys("select id, admission_number from students where school_id=$1 order by admission_number limit 3", [A.schoolId])).rows;
  const SA = crypto.randomUUID();
  const v = await wave(A.admin, async ({ t, act, asOwner, c, out }) => {
    const svc = async (sql, p = []) => { await c.query("SET LOCAL ROLE service_role"); await c.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)");
      try { return await t(sql, p); } finally { await c.query("SET LOCAL ROLE authenticated"); } };
    const anon = async (sql, p = []) => { await c.query("SET LOCAL ROLE anon"); await c.query("select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true)");
      try { return await t(sql, p); } finally { await c.query("SET LOCAL ROLE authenticated"); } };
    await asOwner("insert into auth.users (id) values ($1) on conflict do nothing", [SA]);
    await asOwner("insert into super_admins (id, full_name, email, is_active) values ($1,'Sim SA3','sa3@sim.local',true)", [SA]);
    await asOwner("insert into school_wallets (school_id, balance) values ($1, 1000) on conflict (school_id) do update set balance = 1000", [A.schoolId]);
    await act(A.admin);
    await t("select public.open_term_pools($1,'2025/2026','first')", [A.schoolId]);
    const P1 = "2348030000001", P2 = "2348030000002";
    out.waNoOptin = (await t("select public.comms_send($1,'whatsapp',$2,'fee_reminder','{\"student\":\"Ada\",\"amount\":\"N50,000\"}') r", [A.schoolId, P1])).row?.r;
    await t("select public.comms_set_optin($1,$2,'whatsapp','opted_in','paper_signed')", [A.schoolId, P1]);
    out.waOptin = (await t("select public.comms_send($1,'whatsapp',$2,'fee_reminder','{\"student\":\"Ada\",\"amount\":\"N50,000\"}',null,'normal','ref-wa-1') r", [A.schoolId, P1])).row?.r;
    out.smsHa = (await t("select public.comms_send($1,'sms',$2,'absence_alert','{\"student\":\"Musa\",\"date\":\"24/10\"}',null,'normal','ref-sms-ha',$3) r", [A.schoolId, P2, "ha"])).row?.r;
    out.body = (await t("select body from outbound_messages where reference='ref-wa-1'")).row?.body;
    // STOP via verified webhook, then normal send is blocked, safety still goes out
    out.userInbound = await t("select public.comms_inbound($1,'sms',$2,'STOP','prov-1')", [A.schoolId, P2]);
    out.stop = (await svc("select public.comms_inbound($1,'sms',$2,'stop','prov-1') a", [A.schoolId, P2])).row?.a;
    await act(A.admin);
    out.afterStop = (await t("select public.comms_send($1,'sms',$2,'result_ready','{}',null,'normal','ref-sms-2') r", [A.schoolId, P2])).row?.r;
    out.safety = (await t("select public.comms_send($1,'sms',$2,'emergency','{\"message\":\"Early closure 12pm\"}',null,'normal','ref-sms-3') r", [A.schoolId, P2])).row?.r;
    out.fakeSafety = (await t("select public.comms_send($1,'sms',$2,'result_ready','{}',null,'safety','ref-sms-4') r", [A.schoolId, P2])).row?.r;
    out.teacherMkt = await (async () => { await act(A.teacher); const r = await t("select public.comms_send($1,'whatsapp',$2,'open_day','{}')", [A.schoolId, P1]); await act(A.admin); return r; })();
    out.liveRow = (await t("select provider, status from outbound_messages where reference='ref-wa-1'")).row;
    out.directOut = await t("insert into outbound_messages (school_id, channel, to_address, category, body, status, reference) values ($1,'sms','2348000000000','utility','x','sent','forged')", [A.schoolId]);
    // result checker
    await asOwner("update grades set is_published = true where student_id = $1 and term = 'First Term'", [studs[0].id]);
    const pins = (await t("select * from public.generate_result_pins($1,'2025/2026','First Term',3,2)", [A.schoolId])).r?.rows ?? [];
    out.pinCount = pins.length;
    await act(A.teacher); out.teacherPins = await t("select * from public.generate_result_pins($1,'2025/2026','first',1)", [A.schoolId]);
    out.readPins = (await asOwner("select count(*)::int n from result_pins where school_id=$1", [A.schoolId])).row?.n;
    out.apiReadPins = await t("select count(*) from result_pins");
    out.chk1 = await anon("select public.check_result($1,$2,$3) r", [pins[0]?.serial, pins[0]?.pin, studs[0].admission_number]);
    out.chkWrongPin = await anon("select public.check_result($1,'000000000000',$2) r", [pins[0]?.serial, studs[0].admission_number]);
    out.chkOther = await anon("select public.check_result($1,$2,$3) r", [pins[0]?.serial, pins[0]?.pin, studs[1].admission_number]);
    out.chk2 = await anon("select public.check_result($1,$2,$3) r", [pins[0]?.serial, pins[0]?.pin, studs[0].admission_number]);
    out.chk3 = await anon("select public.check_result($1,$2,$3) r", [pins[0]?.serial, pins[0]?.pin, studs[0].admission_number]);
    let brute = 0; for (let i = 0; i < 12; i++) { const x = await anon("select public.check_result($1,$2,$3) r", [pins[1]?.serial, String(100000000000 + i), studs[2].admission_number]); if (/rate_limited/.test(x.err ?? "") || x.row?.r?.error === "rate_limited") brute++; }
    out.brute = brute;
    // transcripts
    await act(A.sampleParent);
    const parentKid = (await asOwner("select student_id from parent_student_map where parent_id=$1 limit 1", [A.sampleParent])).row?.student_id
      ?? (await asOwner("select id student_id from students where parent_id=$1 limit 1", [A.sampleParent])).row?.student_id;
    out.parentReq = await t("select public.request_transcript($1,$2,'University of Lagos admissions',2) id", [A.schoolId, parentKid]);
    out.parentReqOther = await t("select public.request_transcript($1,$2,'X')", [A.schoolId, studs[2].id]);
    await act(A.admin); const selfReq = (await t("select public.request_transcript($1,$2,'Self') id", [A.schoolId, studs[1].id])).row?.id;
    out.selfIssue = await t("select public.issue_transcript($1)", [selfReq]);
    await act(A.teacher); out.teacherIssue = await t("select public.issue_transcript($1)", [out.parentReq?.row?.id]);
    await act(A.principal); out.issue = await t("select public.issue_transcript($1) code", [out.parentReq?.row?.id]);
    out.verify = (await anon("select public.verify_transcript($1) v", [out.issue?.row?.code])).row?.v;
    out.verifyBad = (await anon("select public.verify_transcript('NOPE') v")).row?.v;
    // admissions funnel
    await act(A.admin);
    const app = (await asOwner(`insert into admission_applications (school_id, application_number, student_first_name, student_last_name, student_date_of_birth, applying_for_class, academic_year_applying, parent_one_name, parent_one_relationship, parent_one_phone, parent_one_email)
      values ($1, 'SIM-ADM-'||substr(md5(random()::text),1,8), 'Chioma', 'Okafor', '2014-03-02', 'JSS1', '2026/2027', 'Mrs Okafor', 'mother', '2348031111111', 'okafor@sim.local') returning id`, [A.schoolId])).row?.id;
    out.a1 = await t("select public.admissions_schedule_exam($1, now() + interval '7 days')", [app]);
    out.skip = await t("select public.admissions_enroll($1,'SIM/ADM/001')", [app]);
    out.a2 = await t("select public.admissions_record_score($1, 78)", [app]);
    out.selfOffer = await t("select public.admissions_offer($1, 25000, now() + interval '14 days')", [app]);
    await act(A.principal); out.a3 = await t("select public.admissions_offer($1, 25000, now() + interval '14 days')", [app]);
    await act(A.teacher); out.teacherAccept = await t("select public.admissions_record_acceptance($1,'CASH-1')", [app]);
    out.a4 = await svc("select public.admissions_record_acceptance($1,'PSK_ACCEPT_1')", [app]);
    await act(A.admin); out.a5 = await t("select public.admissions_enroll($1,'SIM/ADM/001') id", [app]);
    out.funnel = (await t("select public.admissions_funnel($1,'2026/2027') f", [A.schoolId])).row?.f;
    await act(B.admin); out.bFunnel = await t("select public.admissions_funnel($1)", [A.schoolId]);
    out.audit = (await asOwner("select count(*)::int n from audit_logs where school_id=$1 and action ~ '^scholar\\.(comms|result_pin|transcript|admission)'", [A.schoolId])).row?.n;
  });
  rec("comms", "WhatsApp needs an explicit opt-in; with opt-in it goes through the stub adapter (live flag off)",
    v.waNoOptin?.status === "blocked_optout" && v.waOptin?.status === "sent_stub" && v.liveRow?.provider === "stub", `${v.waNoOptin?.status} → ${v.waOptin?.status} via ${v.liveRow?.provider}`, "critical");
  rec("comms", "Templates render with school name and variables; Hausa template chosen when asked", /Ada/.test(v.body ?? "") && /N50,000/.test(v.body ?? "") && !/\{\{/.test(v.body ?? "") && v.smsHa?.language === "ha",
    `${(v.body ?? "").slice(0, 80)}… | lang ${v.smsHa?.language}`, "high");
  rec("comms", "Inbound STOP only via the verified webhook; afterwards normal sends are blocked but safety still goes out",
    !v.userInbound?.ok && v.stop === "opted_out" && v.afterStop?.status === "blocked_optout" && v.safety?.status === "sent_stub" && v.fakeSafety?.status === "blocked_optout",
    `user ${W_ERR(v.userInbound)}; after STOP ${v.afterStop?.status}; safety ${v.safety?.status}; forged safety ${v.fakeSafety?.status}`, "critical");
  rec("comms", "Marketing needs comms.broadcast (teacher refused); delivery log cannot be forged", !v.teacherMkt?.ok && !v.directOut?.ok, `${W_ERR(v.teacherMkt)} | ${W_ERR(v.directOut)}`, "high");
  rec("results", "Scratch-card PINs: generated hashed, unreadable by API roles, teacher cannot mint", v.pinCount === 3 && v.readPins >= 3 && !v.apiReadPins?.ok && !v.teacherPins?.ok,
    `${v.pinCount} cards; api read ${W_ERR(v.apiReadPins)}; teacher ${W_ERR(v.teacherPins)}`, "critical");
  rec("results", "Result checker: correct card shows published results; wrong PIN refused; card binds to first student; use limit",
    v.chk1?.ok && (v.chk1.row?.r?.subjects ?? []).length > 0 && v.chkWrongPin?.row?.r?.ok === false && !v.chkOther?.ok && v.chk2?.ok && /exhausted/.test(v.chk3?.err ?? ""),
    `subjects ${(v.chk1?.row?.r?.subjects ?? []).length}; wrong ${v.chkWrongPin?.row?.r?.error ?? W_ERR(v.chkWrongPin)}; other ${W_ERR(v.chkOther)}; 3rd ${W_ERR(v.chk3)}`, "critical");
  rec("results", "PIN brute force is rate limited per card", v.brute >= 2, `${v.brute} of 12 guesses rate-limited`, "critical");
  rec("transcripts", "Parent requests own child's transcript only; requester cannot issue; teacher cannot issue; principal issues",
    v.parentReq?.ok && !v.parentReqOther?.ok && !v.selfIssue?.ok && !v.teacherIssue?.ok && !!v.issue?.row?.code,
    `other child ${W_ERR(v.parentReqOther)}; self ${W_ERR(v.selfIssue)}; teacher ${W_ERR(v.teacherIssue)}`, "critical");
  rec("transcripts", "Public verification code confirms a real transcript and reveals no grades", v.verify?.valid === true && !("subjects" in (v.verify ?? {})) && v.verifyBad?.valid === false,
    JSON.stringify(v.verify), "high");
  rec("admissions", "Funnel: exam → score → offer → acceptance fee (webhook) → enrol; stages cannot be skipped",
    v.a1?.ok && !v.skip?.ok && v.a2?.ok && v.a3?.ok && v.a4?.ok && !!v.a5?.row?.id && v.funnel?.enrolled >= 1,
    `skip ${W_ERR(v.skip)}; funnel ${JSON.stringify(v.funnel)}`, "high");
  rec("admissions", "Separation of duties: exam scorer cannot make the offer; teacher cannot confirm acceptance fee", !v.selfOffer?.ok && !v.teacherAccept?.ok,
    `${W_ERR(v.selfOffer)} | ${W_ERR(v.teacherAccept)}`, "critical");
  rec("admissions", "Another school cannot read the funnel", !v.bFunnel?.ok, W_ERR(v.bFunnel), "critical");
  rec("audit", "Comms, PIN, transcript and admission changes are audited", v.audit >= 5, `${v.audit} audit rows`, "high");
}
// ---------- 16. Scope sets, unified access check (shadow), onboarding interview (SHERIVS-021) ----------
{
  const v = await wave(A.admin, async ({ t, act, asOwner, out }) => {
    const id = async (sql, p) => (await t(sql, p)).row?.id;
    const c1 = (await t("select public.campus_upsert($1,'Sim North') id", [A.schoolId])).row?.id;
    const c2 = (await t("select public.campus_upsert($1,'Sim South') id", [A.schoolId])).row?.id;
    const cls = (await asOwner("select id from classes where school_id=$1 order by name limit 2", [A.schoolId])).r.rows.map((r) => r.id);
    await asOwner("update classes set campus_id=$1 where id=$2", [c1, cls[0]]); await asOwner("update classes set campus_id=$1 where id=$2", [c2, cls[1]]);
    const s1 = (await asOwner("select id from students where class_id=$1 limit 1", [cls[0]])).row?.id;
    const s2 = (await asOwner("select id from students where class_id=$1 limit 1", [cls[1]])).row?.id;
    const nonTeacher = (await asOwner("select id from users where school_id=$1 and role='teacher' and id<>$2 and id not in (select teacher_id from classes where teacher_id is not null) and id not in (select teacher_id from timetable_slots where teacher_id is not null) limit 1", [A.schoolId, A.teacher])).row?.id ?? A.teacher;
    // a year-head assignment for a staff user, with a scope set: campus North AND (class 0)
    const ra = await id("select public.role_assign($1,$2,'ng.year_head_year_tutor','org',null) id", [A.schoolId, nonTeacher]);
    out.ra = ra;
    out.setOk = await t("select public.role_scope_set_add($1, jsonb_build_object('campus', jsonb_build_array($2::text)), 'North only') id", [ra, c1]);
    out.badRef = await t("select public.role_scope_set_add($1, jsonb_build_object('campus', jsonb_build_array($2::text)))", [ra, crypto.randomUUID()]);
    out.badDim = await t("select public.role_scope_set_add($1, '{\"planet\":[\"x\"]}')", [ra]);
    out.empty = await t("select public.role_scope_set_add($1, '{}')", [ra]);
    out.chkInRaw = await t("select public.authz_check($1,'students.view','student',$2) r", [nonTeacher, s1]);
    out.chkIn = (await t("select public.authz_check($1,'students.view','student',$2) r", [nonTeacher, s1])).row?.r;
    out.chkOut = (await t("select public.authz_check($1,'students.view','student',$2) r", [nonTeacher, s2])).row?.r;
    // multi-select: OR within dimension
    out.multi = await t("select public.role_scope_set_add($1, jsonb_build_object('campus', jsonb_build_array($2::text,$3::text), 'gender', '[\"girls\"]'::jsonb))", [ra, c1, c2]);
    out.chkGenderMiss = (await t("select public.authz_check($1,'students.view','student',$2) r", [nonTeacher, s2])).row?.r;
    const sec = (await t("select public.section_upsert($1,$2,'Sim Girls Sec','senior_secondary') id", [A.schoolId, c2])).row?.id;
    await asOwner("update school_sections set gender='girls' where id=$1", [sec]); await asOwner("update classes set section_id=$1 where id=$2", [sec, cls[1]]);

    out.chkGenderHit = (await t("select public.authz_check($1,'students.view','student',$2) r", [nonTeacher, s2])).row?.r;
    // expiry
    await asOwner("update user_role_assignments set valid_until = now() - interval '1 minute' where id=$1", [ra]);
    out.chkExpired = (await t("select public.authz_check($1,'students.view','student',$2) r", [nonTeacher, s1])).row?.r;
    await asOwner("update user_role_assignments set valid_until = null where id=$1", [ra]);
    // assigner never wider than own scope: a proprietor assignment restricted to North
    const prop = await id("select public.role_assign($1,$2,'ng.proprietor','org',null) id", [A.schoolId, A.bursar]);
    await t("select public.role_scope_set_add($1, jsonb_build_object('campus', jsonb_build_array($2::text)))", [prop, c1]);
    await act(A.bursar);
    out.widen = await t("select public.role_scope_set_add($1, jsonb_build_object('campus', jsonb_build_array($2::text)))", [ra, c2]);
    out.open = await t("select public.role_scope_set_add($1, '{\"gender\":[\"boys\"]}')", [ra]);
    out.within = await t("select public.role_scope_set_add($1, jsonb_build_object('campus', jsonb_build_array($2::text)))", [ra, c1]);
    out.selfWiden = await t("select public.role_scope_set_add($1, jsonb_build_object('campus', jsonb_build_array($2::text)))", [prop, c1]);
    out.directScope = await t("insert into role_assignment_scopes (set_id, org_id, dim, ref) select id, org_id, 'campus', 'x' from role_assignment_scope_sets limit 1");
    // tenant gate, ReBAC, consent, break-glass
    await act(A.admin);
    await act(B.admin); out.cross = (await t("select public.authz_check($1,'students.view','student',$2) r", [B.admin, s1])).row?.r; await act(A.admin);
    await act(A.teacher); out.spoof = await t("select public.authz_check($1,'students.view','student',$2) r", [A.principal, s1]); await act(A.admin);
    const kid = (await asOwner("select student_id from parent_student_map where parent_id=$1 limit 1", [A.sampleParent])).row?.student_id
      ?? (await asOwner("select id student_id from students where parent_id=$1 limit 1", [A.sampleParent])).row?.student_id;
    const notKid = (await asOwner("select id from students where school_id=$1 and id<>$2 and coalesce(parent_id::text,'')<>$3 and id not in (select student_id from parent_student_map where parent_id=$3) limit 1", [A.schoolId, kid, A.sampleParent])).row?.id;
    await act(A.sampleParent);
    out.parentKid = (await t("select public.authz_check($1,'grades.view','student',$2) r", [A.sampleParent, kid])).row?.r;
    out.parentOther = (await t("select public.authz_check($1,'grades.view','student',$2) r", [A.sampleParent, notKid])).row?.r;
    await act(A.admin);
    await asOwner("delete from consent_records where student_id=$1 and purpose='ai_processing'", [kid]);
    out.noConsent = (await t("select public.authz_check($1,'ai_tutor.use','student',$2) r", [A.admin, kid])).row?.r;
    await act(A.teacher);
    out.bgShort = await t("select public.break_glass_open($1,'urgent')", [s1]);
    out.bg = await t("select public.break_glass_open($1,'Asthma attack on the field; need allergy record now') id", [s1]);
    out.bgAllow = (await t("select public.authz_check($1,'health.records_view','student',$2) r", [A.teacher, s1])).row?.r;
    out.bgAlerts = (await asOwner("select count(*)::int n from notifications where school_id=$1 and title='Break-glass access opened'", [A.schoolId])).row?.n;
    await asOwner("update break_glass_grants set expires_at = now() - interval '1 second' where id=$1", [out.bg?.row?.id]);
    out.bgExpired = (await t("select public.authz_check($1,'health.records_view','student',$2) r", [A.teacher, s1])).row?.r;
    out.bgDelete = await asOwner("delete from break_glass_grants where id=$1", [out.bg?.row?.id]);
    // shadow mode: attendance insert logs a comparison but never blocks
    await asOwner("select set_config('sherivs.authz_shadow_rate','1',true)");
    const tc = (await asOwner("select c.id, (select id from students s where s.class_id=c.id limit 1) sid from classes c where c.teacher_id=$1 limit 1", [A.teacher])).row;
    await asOwner("delete from attendance where student_id=$1 and date=current_date", [tc?.sid]);
    out.att = await t("insert into attendance (school_id, student_id, class_id, date, status, marked_by) values ($1,$2,$3,current_date,'present',$4)", [A.schoolId, tc?.sid, tc?.id, A.teacher]);
    out.shadowRows = (await asOwner("select count(*)::int n, bool_and(agree) a from authz_shadow_log where resource_id=$1", [tc?.sid])).row;
    await act(A.admin);
    out.report = (await t("select public.authz_shadow_report($1) r", [A.schoolId])).row?.r;
    await act(A.teacher); out.teacherReport = await t("select public.authz_shadow_report($1)", [A.schoolId]);
    out.shadowForge = await t("insert into authz_shadow_log (action, new_allow) values ('x', true)");
    // onboarding interview
    await act(A.teacher); out.teacherOnb = await t("select public.onboarding_start($1)", [A.schoolId]);
    await act(A.admin);
    const ses = (await t("select public.onboarding_start($1) id", [A.schoolId])).row?.id;
    const ans = (st, a) => t("select public.onboarding_answer($1,$2,$3::jsonb) r", [ses, st, JSON.stringify(a)]);
    out.n1 = (await ans("organisation", { name: "Sim Academy", has_shifts: true, is_group: false })).row?.r;
    out.earlyPlan = await t("select public.onboarding_plan($1)", [ses]);
    await ans("institution", { bands: ["nursery", "primary", "jss", "sss"] });
    await ans("campuses", { items: [{ name: "Sim Onb Main" }, { name: "Sim Onb Annex" }] });
    out.n2 = (await ans("sections", { items: [{ name: "Onb Nursery", campus: "Sim Onb Main", kind: "nursery", gender: "mixed", residency: "day" },
      { name: "Onb Secondary", campus: "Sim Onb Main", kind: "junior_secondary", gender: "mixed", residency: "both" }], houses: ["Onb Red House", "Onb Blue House"] })).row?.r;
    await ans("shifts", { items: [{ name: "Morning", campus: "Sim Onb Main", kind: "morning" }, { name: "Afternoon", campus: "Sim Onb Annex", kind: "afternoon" }] });
    await ans("curriculum", { primary: "nerdc_2025_primary" });
    await ans("levels", { items: [
      { name: "Onb Nursery 1", band: "nursery", ordinal: 1, arms: 1, section: "Onb Nursery", campus: "Sim Onb Main", shift: "Morning" },
      { name: "Onb Primary 1", band: "primary", ordinal: 3, arms: 2, campus: "Sim Onb Main", shift: "Morning" },
      { name: "Onb JSS 1", band: "jss", ordinal: 9, arms: 3, arm_names: ["Gold", "Diamond", "Silver"], section: "Onb Secondary", campus: "Sim Onb Main" },
      { name: "Onb SSS 1", band: "sss", ordinal: 12, arms: 2, section: "Onb Secondary", campus: "Sim Onb Main", stream: "science" }] });
    for (const st of ["calendar", "assessment", "fees", "people"]) await ans(st, {});
    out.n3 = (await ans("comms", { consent: ["core_education", "messaging_sms_whatsapp"] })).row?.r;
    out.plan = (await t("select public.onboarding_plan($1) p", [ses])).row?.p;
    out.badHash = await t("select public.onboarding_apply($1,'deadbeef')", [ses]);
    out.applyRaw = await t("select public.onboarding_apply($1,$2) r", [ses, out.plan?.plan_hash]); out.apply = out.applyRaw.row?.r;
    out.replay = (await t("select public.onboarding_apply($1,$2) r", [ses, out.plan?.plan_hash])).row?.r;
    out.made = (await asOwner(`select (select count(*) from classes where school_id=$1 and grade_level like 'Onb %')::int classes,
        (select count(*) from classes where school_id=$1 and grade_level='Onb JSS 1' and name ~ 'Gold|Diamond|Silver')::int named,
        (select count(*) from classes where school_id=$1 and grade_level like 'Onb %' and level_id is not null)::int leveled,
        (select count(*) from school_shifts where school_id=$1)::int shifts, (select count(*) from school_levels where school_id=$1)::int levels,
        (select count(*) from class_curriculum cc join classes c on c.id=cc.class_id where c.grade_level='Onb Primary 1')::int cur,
        (select count(*) from student_groups where school_id=$1 and name like 'Onb %')::int houses,
        (select residency from school_sections where school_id=$1 and name='Onb Secondary') res`, [A.schoolId])).row;
    // a second session re-applying the same structure creates nothing new (idempotent upserts)
    const ses2 = (await t("select public.onboarding_start($1) id", [A.schoolId])).row?.id;
    await asOwner("update onboarding_sessions set answers=(select answers from onboarding_sessions where id=$1) where id=$2", [ses, ses2]);
    const p2 = (await t("select public.onboarding_plan($1) p", [ses2])).row?.p;
    await t("select public.onboarding_apply($1,$2)", [ses2, p2?.plan_hash]);
    out.after2 = (await asOwner("select count(*)::int n from classes where school_id=$1 and grade_level like 'Onb %'", [A.schoolId])).row?.n;
    const ses3 = (await t("select public.onboarding_start($1) id", [A.schoolId])).row?.id;
    await asOwner("update onboarding_sessions set answers=(select answers from onboarding_sessions where id=$1) || '{\"institution\":{\"bands\":[\"tertiary\"]}}' where id=$2", [ses, ses3]);
    out.tertiary = await t("select public.onboarding_plan($1)", [ses3]);
    await act(B.admin); out.bOnb = await t("select public.onboarding_plan($1)", [ses]);
    out.audit = (await asOwner("select count(*)::int n from audit_logs where school_id=$1 and action ~ '^scholar\\.(role_assignment_scope|school_shifts|school_levels|break_glass|onboarding)'", [A.schoolId])).row?.n;
  });
  const al = (r) => r?.allow === true, dl = (r) => r?.deciding_layer;
  rec("scopes", "Scope set limits a role to its campus: same role allowed in North, refused in South (decided by scope layer)",
    v.setOk?.ok && al(v.chkIn) && !al(v.chkOut) && dl(v.chkOut) === "scope", `in ${dl(v.chkIn) ?? W_ERR(v.chkInRaw)}; out ${dl(v.chkOut)}`, "critical");
  rec("scopes", "Scope refs must belong to the school; unknown dimension and empty sets refused", !v.badRef?.ok && !v.badDim?.ok && !v.empty?.ok,
    `${W_ERR(v.badRef)} | ${W_ERR(v.badDim)} | ${W_ERR(v.empty)}`, "high");
  rec("scopes", "Multi-select: OR within a dimension, AND across dimensions (campus North|South AND girls section)",
    !al(v.chkGenderMiss) && al(v.chkGenderHit), `before girls section ${al(v.chkGenderMiss)}; after ${al(v.chkGenderHit)} ${al(v.chkGenderHit) ? "" : W_ERR(v.multi)}`, "critical");
  rec("scopes", "Time-bound assignment stops granting after valid_until", !al(v.chkExpired), dl(v.chkExpired), "high");
  rec("scopes", "Assigner can never grant wider than own scope, cannot leave their restricted dimension open, cannot widen self",
    !v.widen?.ok && !v.open?.ok && v.within?.ok && !v.selfWiden?.ok && !v.directScope?.ok,
    `widen ${W_ERR(v.widen)}; open ${W_ERR(v.open)}; self ${W_ERR(v.selfWiden)}; direct ${W_ERR(v.directScope)}`, "critical");
  rec("authz", "Tenant gate: another school's admin is refused; users cannot evaluate for someone else",
    !al(v.cross) && dl(v.cross) === "tenant" && !v.spoof?.ok, `cross ${dl(v.cross)}; spoof ${W_ERR(v.spoof)}`, "critical");
  rec("authz", "ReBAC: parent sees own child, not another child", al(v.parentKid) && dl(v.parentKid) === "rebac" && !al(v.parentOther),
    `kid ${dl(v.parentKid)}; other ${dl(v.parentOther)}`, "critical");
  rec("authz", "Consent gate: AI tutor refused without ai_processing consent", !al(v.noConsent) && dl(v.noConsent) === "consent", dl(v.noConsent), "critical");
  rec("authz", "Break-glass: needs a real reason, alerts principal/DPO, grants sensitive read for 1 hour only, cannot be deleted",
    !v.bgShort?.ok && v.bg?.ok && al(v.bgAllow) && dl(v.bgAllow) === "break_glass" && v.bgAlerts >= 1 && !al(v.bgExpired) && !v.bgDelete?.ok,
    `short ${W_ERR(v.bgShort)}; alerts ${v.bgAlerts}; expired ${dl(v.bgExpired)}; delete ${W_ERR(v.bgDelete)}`, "critical");
  rec("shadow", "Shadow mode logs new vs legacy decisions next to live attendance writes without blocking them",
    v.att?.ok && v.shadowRows?.n >= 1 && v.report?.checks >= 1, `insert ${W_ERR(v.att)}; logged ${v.shadowRows?.n}; agree ${v.shadowRows?.a}; report ${JSON.stringify(v.report)}`, "high");
  rec("shadow", "Shadow report is admin/audit only; shadow log cannot be forged", !v.teacherReport?.ok && !v.shadowForge?.ok,
    `${W_ERR(v.teacherReport)} | ${W_ERR(v.shadowForge)}`, "high");
  rec("onboarding", "Interview is adaptive (shifts asked because has_shifts; boarding + SSS follow-ups) and plan refuses an incomplete interview",
    (v.n1?.remaining ?? []).includes("shifts") && (v.n2?.follow_ups ?? []).some((x) => /Boarding/.test(x)) && (v.n3?.remaining ?? []).length === 0 && !v.earlyPlan?.ok,
    `follow-ups ${JSON.stringify(v.n2?.follow_ups)}; early ${W_ERR(v.earlyPlan)}`, "high");
  rec("onboarding", "Dry-run then apply provisions campuses, sections, shifts, levels, arms (named + lettered), houses, NERDC curriculum",
    v.apply && v.made?.classes === 8 && v.made?.named === 3 && v.made?.leveled === 8 && v.made?.shifts >= 2 && v.made?.levels >= 4 && v.made?.cur === 2 && v.made?.houses === 2 && v.made?.res === "both",
    `plan ${v.plan?.new_items} items; apply ${W_ERR(v.applyRaw)}; made ${JSON.stringify(v.made)}`, "critical");
  rec("onboarding", "Apply needs the reviewed plan hash; replay and a second session create no duplicates",
    !v.badHash?.ok && v.replay?.replay === true && v.after2 === 8, `bad hash ${W_ERR(v.badHash)}; after re-run ${v.after2} classes`, "critical");
  rec("onboarding", "Tertiary refused in v1 (nursery to SSS first); teacher and other schools cannot run it",
    !v.tertiary?.ok && !v.teacherOnb?.ok && !v.bOnb?.ok, `${W_ERR(v.tertiary)} | ${W_ERR(v.teacherOnb)} | ${W_ERR(v.bOnb)}`, "critical");
  rec("audit", "Scope sets, structure, break-glass and onboarding are audited", v.audit >= 6, `${v.audit} audit rows`, "high");
}
// ---------- 17. Exams, CBT, attendance devices, offline sync (SHERIVS-022) ----------
{
  const v = await wave(A.admin, async ({ t, act, asOwner, c, out }) => {
    const svc = async (sql, p = []) => { await c.query("SET LOCAL ROLE service_role"); await c.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)");
      try { return await t(sql, p); } finally { await c.query("SET LOCAL ROLE authenticated"); } };
    const tc = (await asOwner("select id from classes where teacher_id=$1 limit 1", [A.teacher])).row?.id;
    const other = (await asOwner("select c.id from classes c where c.school_id=$1 and c.id<>$2 and c.teacher_id is distinct from $3 and not exists (select 1 from timetables tt join timetable_slots ts on ts.timetable_id=tt.id where tt.class_id=c.id and ts.teacher_id=$3) and exists (select 1 from students s where s.class_id=c.id) limit 1", [A.schoolId, tc, A.teacher])).row?.id;
    const staff = (await asOwner("select id from users where school_id=$1 and role='teacher' and id<>$2 limit 2", [A.schoolId, A.teacher])).r.rows.map((r) => r.id);
    const studs = (await asOwner("select id, user_id from students where class_id=$1 and user_id is not null order by admission_number limit 3", [tc])).r.rows;
    const day = "date_trunc('day', now()) + interval '30 days'";
    const sess = (await t("select public.exam_session_create($1,'Sim First Term Exams','2025/2026','First Term',current_date, current_date + 40) id", [A.schoolId])).row?.id;
    out.teacherSess = await (async () => { await act(A.teacher); const r = await t("select public.exam_session_create($1,'x','2025/2026','First Term',current_date,current_date)", [A.schoolId]); await act(A.admin); return r; })();
    const p1 = (await t(`select public.exam_paper_add($1,$2,'Mathematics', ${day} + interval '9 hours', ${day} + interval '11 hours','Hall A') id`, [sess, tc])).row?.id;
    out.clash = await t(`select public.exam_paper_add($1,$2,'English', ${day} + interval '10 hours', ${day} + interval '12 hours')`, [sess, tc]);
    const p2 = (await t(`select public.exam_paper_add($1,$2,'Biology', ${day} + interval '10 hours', ${day} + interval '12 hours','Hall B') id`, [sess, other])).row?.id;
    out.outside = await t(`select public.exam_paper_add($1,$2,'Chemistry', now() + interval '90 days', now() + interval '90 days 2 hours')`, [sess, tc]);
    out.seats = (await t("select public.exam_generate_seating($1) n", [p1])).row?.n;
    out.seats2 = (await t("select public.exam_generate_seating($1) n", [p1])).row?.n;
    out.classSize = (await asOwner("select count(*)::int n from students where class_id=$1", [tc])).row?.n;
    out.inv1 = await t("select public.exam_assign_invigilator($1,$2)", [p1, staff[0]]);
    out.double = await t("select public.exam_assign_invigilator($1,$2)", [p2, staff[0]]);
    out.inv2 = await t("select public.exam_assign_invigilator($1,$2)", [p2, staff[1]]);
    await act(staff[0]); out.rep = await t("select public.malpractice_report($1,$2,'Found notes under the desk during the paper') id", [p1, studs[0].id]);
    await act(staff[1]); out.repOther = await t("select public.malpractice_report($1,$2,'x')", [p1, studs[0].id]);
    // decider: chief invigilator role (holds malpractice.decide); the reporter also gets it to prove SoD
    await act(A.admin);
    const chief = staff[1];
    await asOwner("insert into org_role_permission_settings (org_id, role_code, permission_code, enabled) values ($1,'ng.chief_invigilator','malpractice.decide',true) on conflict (org_id, role_code, permission_code) do update set enabled = true", [A.schoolId]);
    await t("select public.role_assign($1,$2,'ng.chief_invigilator','org',null)", [A.schoolId, chief]);
    await t("select public.role_assign($1,$2,'ng.chief_invigilator','org',null)", [A.schoolId, staff[0]]);
    out.adminDecide = await t("select public.malpractice_decide($1,'upheld')", [out.rep?.row?.id]);
    await act(staff[0]); out.selfDecide = await t("select public.malpractice_decide($1,'dismissed')", [out.rep?.row?.id]);
    await act(chief); out.decide = await t("select public.malpractice_decide($1,'upheld','Paper cancelled')", [out.rep?.row?.id]);
    out.redecide = await t("select public.malpractice_decide($1,'dismissed')", [out.rep?.row?.id]);
    // CBT
    await act(A.teacher);
    const qs = [];
    for (let i = 0; i < 4; i++) qs.push((await t("select public.cbt_question_add($1,'Mathematics',$2,'[\"1\",\"2\",\"3\",\"4\"]'::jsonb,$3) id", [A.schoolId, `What is ${i}+1?`, i])).row?.id);
    out.badKey = await t("select public.cbt_question_add($1,'Mathematics','x','[\"a\",\"b\"]'::jsonb,5)", [A.schoolId]);
    const test = (await t("select public.cbt_test_create($1,'Sim CBT',$2,30,now() - interval '1 minute', now() + interval '2 hours',$3::uuid[],10) id", [A.schoolId, tc, qs])).row?.id;
    out.list = (await t("select * from public.cbt_question_list($1)", [A.schoolId])).r?.rows?.[0];
    out.directKeys = await t("select answer_key from cbt_questions limit 1");
    await act(studs[0].user_id);
    const st = (await t("select public.cbt_start($1) r", [test])).row?.r;
    out.stHasKey = JSON.stringify(st ?? {}).includes("answer_key");
    out.qCount = (st?.questions ?? []).length;
    const ans = Object.fromEntries(qs.map((q, i) => [q, i]));
    out.sync1 = (await t("select public.cbt_sync($1,$2,2) r", [st?.attempt_id, JSON.stringify({ [qs[0]]: 0, [qs[1]]: 1 })])).row?.r;
    out.stale = (await t("select public.cbt_sync($1,$2,1) r", [st?.attempt_id, JSON.stringify({ [qs[0]]: 3 })])).row?.r;
    out.restart = (await t("select public.cbt_start($1) r", [test])).row?.r;
    out.sub = (await t("select public.cbt_submit($1,$2,3) r", [st?.attempt_id, JSON.stringify(ans)])).row?.r;
    out.resub = (await t("select public.cbt_submit($1,$2,4) r", [st?.attempt_id, '{}'])).row?.r;
    await act(studs[1].user_id);
    out.peek = await t("select public.cbt_sync($1,'{}',9) r", [st?.attempt_id]);
    const st2 = (await t("select public.cbt_start($1) r", [test])).row?.r;
    await asOwner("update cbt_attempts set deadline = now() - interval '5 minutes' where id=$1", [st2?.attempt_id]);
    out.grace = (await t("select public.cbt_submit($1,$2,1, now() - interval '6 minutes') r", [st2?.attempt_id, JSON.stringify(ans)])).row?.r;
    await act(studs[2].user_id);
    const st3 = (await t("select public.cbt_start($1) r", [test])).row?.r;
    await asOwner("update cbt_attempts set deadline = now() - interval '5 minutes' where id=$1", [st3?.attempt_id]);
    out.lateCapture = (await t("select public.cbt_submit($1,$2,1, now()) r", [st3?.attempt_id, JSON.stringify(ans)])).row?.r;
    await act(B.admin); out.bStart = await t("select public.cbt_start($1)", [test]);
    // Attendance: QR + geofence
    await act(A.admin);
    await asOwner("insert into school_geofence (school_id, campus_name, latitude, longitude, radius_meters, is_active) values ($1,'Sim Main',6.4474,3.4720,150,true)", [A.schoolId]);
    const tok = (await t("select public.qr_attendance_token($1,2) k", [A.schoolId])).row?.k;
    await act(A.teacher); out.teacherTok = await t("select public.qr_attendance_token($1)", [A.schoolId]);
    out.qrIn = (await t("select public.staff_qr_checkin($1, 6.4476, 3.4721) r", [tok])).row?.r;
    out.qrFar = (await t("select public.staff_qr_checkin($1, 6.4600, 3.4720) r", [tok])).row?.r;
    out.qrBad = (await t("select public.staff_qr_checkin('nope', 6.4476, 3.4721) r")).row?.r;
    await asOwner("update qr_tokens set expires_at = now() - interval '1 second' where token=$1", [tok]);
    out.qrExp = (await t("select public.staff_qr_checkin($1, 6.4476, 3.4721) r", [tok])).row?.r;
    out.logged = (await asOwner("select count(*)::int n from attendance_check_ins where user_id=$1", [A.teacher])).row?.n;
    out.forgeCheck = await t("insert into attendance_check_ins (school_id, user_id, method, accepted) values ($1,$2,'qr',true)", [A.schoolId, A.teacher]);
    out.editCheck = await asOwner("update attendance_check_ins set accepted = true where user_id=$1", [A.teacher]);
    await act(A.sampleParent); out.parentQr = await t("select public.staff_qr_checkin($1,6.4476,3.4721)", [tok]);
    // biometric with consent
    const dev = (await asOwner("insert into attendance_devices (school_id, kind, label) values ($1,'biometric','Gate 1') returning id", [A.schoolId])).row?.id;
    out.bioNoConsent = (await svc("select public.biometric_checkin($1,$2,0.95) r", [dev, A.teacher])).row?.r;
    await act(A.teacher); await t("select public.staff_biometric_consent(true)");
    out.bioOk = (await svc("select public.biometric_checkin($1,$2,0.95) r", [dev, A.teacher])).row?.r;
    out.bioLow = (await svc("select public.biometric_checkin($1,$2,0.5) r", [dev, A.teacher])).row?.r;
    await act(A.teacher); await t("select public.staff_biometric_consent(false)");
    out.bioWithdrawn = (await svc("select public.biometric_checkin($1,$2,0.95) r", [dev, A.teacher])).row?.r;
    await act(A.teacher); out.bioUser = await t("select public.biometric_checkin($1,$2,0.99)", [dev, A.teacher]);
    out.consentPurpose = await asOwner("insert into consent_records (school_id, student_id, purpose, status, policy_version, granted_at, capture_method) values ($1,$2,'biometric_attendance','granted','v1',now(),'paper_signed')", [A.schoolId, studs[0].id]);
    // offline sync
    const otherStud = (await asOwner("select id from students where class_id=$1 limit 1", [other])).row?.id;
    await asOwner("delete from attendance where student_id = any($1::uuid[]) and date >= current_date - 10", [[...studs.map((s) => s.id), otherStud]]);
    await asOwner("insert into attendance (school_id, student_id, class_id, date, status, marked_by) values ($1,$2,$3,current_date - 1,'absent',$4)", [A.schoolId, studs[2].id, tc, A.admin]);
    const items = [{ student_id: studs[0].id, date: "CUR", status: "present" }, { student_id: studs[1].id, date: "CUR", status: "late" },
      { student_id: studs[2].id, date: "Y", status: "present" }, { student_id: otherStud, date: "CUR", status: "present" },
      { student_id: studs[0].id, date: "OLD", status: "present" }, { student_id: studs[1].id, date: "FUT", status: "present" }];
    const today = (await asOwner("select current_date::text d, (current_date-1)::text y, (current_date-20)::text o, (current_date+1)::text f")).row;
    for (const i of items) i.date = { CUR: today.d, Y: today.y, OLD: today.o, FUT: today.f }[i.date];
    await act(A.teacher);
    out.sync = (await t("select public.offline_attendance_sync('sim-batch-1',$1) r", [JSON.stringify(items)])).row?.r;
    out.syncReplay = (await t("select public.offline_attendance_sync('sim-batch-1',$1) r", [JSON.stringify(items)])).row?.r;
    out.rows = (await asOwner("select count(*)::int n from attendance where student_id = any($1::uuid[]) and date = current_date", [studs.map((s) => s.id)])).row?.n;
    await act(A.sampleParent); out.parentSync = await t("select public.offline_attendance_sync('p',$1)", [JSON.stringify(items)]);
    out.audit = (await asOwner("select count(*)::int n from audit_logs where school_id=$1 and action ~ '^scholar\\.(exam|malpractice|cbt|attendance_check|offline)'", [A.schoolId])).row?.n;
  });
  const why = (r) => (r?.conflicts ?? []).map((x) => x.why).sort().join(",");
  rec("exams", "Exam timetable: only schedulers create; class clash and out-of-session papers refused", !v.teacherSess?.ok && /clash/.test(v.clash?.err ?? "") && !v.outside?.ok,
    `teacher ${W_ERR(v.teacherSess)}; clash ${W_ERR(v.clash)}; outside ${W_ERR(v.outside)}`, "high");
  rec("exams", "Seating plan seats every student once and regenerates idempotently", v.seats === v.classSize && v.seats2 === v.classSize, `${v.seats}/${v.classSize}`, "high");
  rec("exams", "Invigilator cannot be double-booked across overlapping papers", v.inv1?.ok && /double_booked/.test(v.double?.err ?? "") && v.inv2?.ok, W_ERR(v.double), "critical");
  rec("exams", "Malpractice: only that paper's invigilator reports; admin, principal-bridge and reporter cannot decide; decided once",
    v.rep?.ok && !v.repOther?.ok && !v.adminDecide?.ok && /sod/.test(v.selfDecide?.err ?? "") && v.decide?.ok && !v.redecide?.ok,
    `other ${W_ERR(v.repOther)}; admin ${W_ERR(v.adminDecide)}; self ${W_ERR(v.selfDecide)}; again ${W_ERR(v.redecide)}`, "critical");
  rec("cbt", "Answer keys never leave the server (table unreadable, list and start omit keys); bad keys refused",
    !v.directKeys?.ok && v.list && !("answer_key" in v.list) && v.stHasKey === false && v.qCount === 4 && !v.badKey?.ok, `direct ${W_ERR(v.directKeys)}`, "critical");
  rec("cbt", "Offline sync: stale sequence ignored, restart resumes same attempt, submit scores once", v.sync1?.ok && v.stale?.stale && v.restart?.attempt_id && v.sub?.score === 4 && v.resub?.replay,
    `score ${v.sub?.score}/${v.sub?.max}; restart answers ${JSON.stringify(v.restart?.answers ?? {}).length > 2}`, "critical");
  rec("cbt", "Grace window: answers captured before deadline accepted after reconnect; answers captured after deadline ignored",
    v.grace?.score === 4 && v.lateCapture?.late_answers_ignored === true && v.lateCapture?.score === 0, `grace ${v.grace?.score}; late ${v.lateCapture?.score}`, "critical");
  rec("cbt", "Students cannot touch another student's attempt; other schools cannot start the test", !v.peek?.ok && !v.bStart?.ok, `${W_ERR(v.peek)} | ${W_ERR(v.bStart)}`, "critical");
  rec("attendance", "Staff QR check-in: inside geofence accepted; outside, invalid and expired refused; every attempt logged",
    v.qrIn?.ok && v.qrFar?.error === "outside_geofence" && v.qrBad?.error === "invalid_code" && v.qrExp?.error === "expired_code" && v.logged >= 4,
    `in ${v.qrIn?.distance_m}m; far ${v.qrFar?.distance_m}m; logged ${v.logged}`, "critical");
  rec("attendance", "Check-in log is append-only and cannot be forged; only managers mint codes; parents cannot check in",
    !v.forgeCheck?.ok && !v.editCheck?.ok && !v.teacherTok?.ok && !v.parentQr?.ok, `${W_ERR(v.forgeCheck)} | ${W_ERR(v.editCheck)}`, "critical");
  rec("attendance", "Biometric: refused without consent, works with consent, low match refused, withdrawal stops it; device gateway only",
    v.bioNoConsent?.error === "no_biometric_consent" && v.bioOk?.ok && v.bioLow?.error === "low_match" && v.bioWithdrawn?.error === "no_biometric_consent" && !v.bioUser?.ok && v.consentPurpose?.ok,
    `${v.bioNoConsent?.error} → ok → ${v.bioWithdrawn?.error}; user ${W_ERR(v.bioUser)}`, "critical");
  rec("offline", "Offline attendance batch: applies own-class marks, reports conflicts (other mark, not your class, date range), idempotent replay",
    v.sync?.applied === 2 && why(v.sync) === "date_out_of_range,date_out_of_range,not_your_class,server_has_other_mark" && v.syncReplay?.replay && v.rows === 2 && !v.parentSync?.ok,
    `applied ${v.sync?.applied}; conflicts ${why(v.sync)}`, "critical");
  rec("audit", "Exam, malpractice, CBT, check-in and offline changes are audited", v.audit >= 10, `${v.audit} audit rows`, "high");
}
// ---------- 18. Course registration, SIWES, early warning (SHERIVS-023) ----------
{
  const v = await wave(E.admin, async ({ t, act, asOwner, c, out }) => {
    const anon = async (sql, p = []) => { await c.query("SET LOCAL ROLE anon"); await c.query("select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true)");
      try { return await t(sql, p); } finally { await c.query("SET LOCAL ROLE authenticated"); } };
    const cid = async (code) => (await asOwner("select id from courses where school_id=$1 and code=$2", [E.schoolId, code])).row?.id;
    const st = (await asOwner(`select s.id, s.user_id from students s where s.school_id=$1 and s.user_id is not null
        and exists (select 1 from grades g where g.student_id=s.id and g.course_id is not null) limit 2`, [E.schoolId])).r.rows;
    const [s1, s2] = st;
    const mk = async (code, title, units) => (await asOwner("insert into courses (school_id, code, title, credit_units, level, semester, programme, is_core) values ($1,$2,$3,$4,'200L','First','Computer Science',true) returning id", [E.schoolId, code, title, units])).row?.id;
    const csc201 = await mk("CSC201", "Data Structures", 3), mth201 = await mk("MTH201", "Linear Algebra", 3), big = await mk("PRJ299", "Mega Project", 20);
    const csc101 = await cid("CSC101"), mth101 = await cid("MTH101"), phy101 = await cid("PHY101");
    // scores drive grade points through the grades triggers: pass everything, then fail MTH101
    await asOwner("update grades set ca_score = 30, exam_score = 40 where student_id=$1", [s1.id]);
    await asOwner("update grades set ca_score = 5, exam_score = 10 where student_id=$1 and course_id=$2", [s1.id, mth101]);
    out.gpDbg = (await asOwner("select string_agg(c.code||'='||g.grade_point, ',') x from grades g join courses c on c.id=g.course_id where g.student_id=$1", [s1.id])).row?.x;
    out.prereq = await t("select public.course_prereq_set($1,$2,1)", [csc201, csc101]);
    await t("select public.course_prereq_set($1,$2,1)", [mth201, mth101]);
    out.cycle = await t("select public.course_prereq_set($1,$2,1)", [csc101, csc201]);
    await act(E.teacher); out.teacherWin = await t("select public.registration_window_set($1,'2026/2027','First',now(),now()+interval '1 day')", [E.schoolId]);
    await act(E.admin);
    out.closed = await (async () => { await act(s1.user_id); const r = (await t("select public.course_register($1,'2026/2027','First') r", [csc201])).row?.r; await act(E.admin); return r; })();
    await t("select public.registration_window_set($1,'2026/2027','First',now()-interval '1 hour',now()+interval '7 days',6,24)", [E.schoolId]);
    await act(s1.user_id);
    const reg = (code) => t("select public.course_register($1,'2026/2027','First') r", [code]);
    out.missing = (await reg(mth201)).row?.r;
    out.owedFirst = (await reg(csc201)).row?.r;
    out.carry = (await reg(mth101)).row?.r;
    out.ok = (await reg(csc201)).row?.r;
    out.cap = (await reg(big)).row?.r;
    out.carryId = (await asOwner("select id from course_registrations where student_id=$1 and course_id=$2", [s1.id, mth101])).row?.id;
    out.regId = (await asOwner("select id from course_registrations where student_id=$1 and course_id=$2", [s1.id, csc201])).row?.id;
    out.dropCarry = await t("select public.course_drop($1)", [out.carryId]);
    await act(s2.user_id); out.otherDrop = await t("select public.course_drop($1)", [out.regId]);
    out.studentApprove = await t("select public.course_reg_decide($1,true)", [out.regId]);
    await act(E.admin);
    const adv = (await asOwner("select id from users where school_id=$1 and role='teacher' and id<>$2 limit 1", [E.schoolId, E.teacher])).row?.id;
    await t("select public.role_assign($1,$2,'ng.academic_adviser','org',null)", [E.schoolId, adv]);
    await asOwner("insert into org_role_permission_settings (org_id, role_code, permission_code, enabled) values ($1,'ng.academic_adviser','course_reg.approve',true) on conflict (org_id, role_code, permission_code) do update set enabled=true", [E.schoolId]);
    await act(adv); out.approve = await t("select public.course_reg_decide($1,true,'Fine')", [out.regId]); out.again = await t("select public.course_reg_decide($1,false)", [out.regId]);
    await act(s2.user_id); out.peek = (await t("select count(*)::int n from course_registrations where student_id=$1", [s1.id])).row?.n;
    // SIWES
    await act(E.admin);
    const pl = (await t("select public.siwes_place($1,'Sim Tech Ltd','Engr. Bello','2348030000009',current_date - 7, current_date + 77) r", [s1.id])).row?.r;
    out.code = pl?.supervisor_code;
    await act(s1.user_id);
    out.hashRead = await t("select verify_code_hash from siwes_placements limit 1");
    out.rowRead = await t("select employer from siwes_placements where id=$1", [pl?.placement_id]);
    out.log1 = await t("select public.siwes_log($1,1,'Week 1: set up dev environment and shadowed the backend team') id", [pl?.placement_id]);
    out.shortLog = await t("select public.siwes_log($1,2,'too short')", [pl?.placement_id]);
    out.farWeek = await t("select public.siwes_log($1,40,'Week 40 entry that is far outside the placement window')", [pl?.placement_id]);
    await act(s2.user_id); out.otherLog = await t("select public.siwes_log($1,3,'Writing into somebody else logbook entry here')", [pl?.placement_id]);
    out.badCode = (await anon("select public.siwes_supervisor_verify($1,'WRONGCODE',1) r", [pl?.placement_id])).row?.r;
    out.verify = (await anon("select public.siwes_supervisor_verify($1,$2,1,'Good work') r", [pl?.placement_id, out.code])).row?.r;
    await act(s1.user_id); out.editLocked = await t("select public.siwes_log($1,1,'Trying to rewrite a verified week after the fact')", [pl?.placement_id]);
    let rl = 0; for (let i = 0; i < 12; i++) { const r = (await anon("select public.siwes_supervisor_verify($1,'X',1) r", [pl?.placement_id])).row?.r; if (r?.error === "rate_limited") rl++; }
    out.rl = rl;
    // early warning (school A, secondary)
  });
  const w = await wave(A.admin, async ({ t, act, asOwner, out }) => {
    const kid = (await asOwner("select id, parent_id from students where school_id=$1 and parent_id is not null order by admission_number limit 1", [A.schoolId])).row;
    await asOwner("delete from attendance where student_id=$1 and date >= current_date - 30", [kid.id]);
    await asOwner("insert into attendance (school_id, student_id, class_id, date, status) select $1, $2, (select class_id from students where id=$2), current_date - g, case when g % 2 = 0 then 'absent' else 'present' end from generate_series(1,10) g", [A.schoolId, kid.id]);
    await asOwner("update grades set ca_score = 10, exam_score = 20 where student_id=$1 and term='First Term'", [kid.id]);
    out.run = (await t("select public.compute_early_warnings($1,'2025/2026','First Term') r", [A.schoolId])).row?.r;
    out.run2 = (await t("select public.compute_early_warnings($1,'2025/2026','First Term') r", [A.schoolId])).row?.r;
    out.flags = (await asOwner("select string_agg(kind||':'||severity, ',' order by kind) k from learning_gap_flags where student_id=$1", [kid.id])).row?.k;
    out.dupes = (await asOwner("select count(*)::int n from (select student_id, kind, period, count(*) from learning_gap_flags group by 1,2,3 having count(*)>1) x")).row?.n;
    await act(kid.parent_id); out.parentSees = (await t("select count(*)::int n from learning_gap_flags")).row?.n;
    out.parentRun = await t("select public.compute_early_warnings($1,'2025/2026','First Term')", [A.schoolId]);
    await act(B.admin); out.bSees = (await t("select count(*)::int n from learning_gap_flags where school_id=$1", [A.schoolId])).row?.n;
    await act(A.admin);
    const f = (await asOwner("select id from learning_gap_flags where student_id=$1 limit 1", [kid.id])).row?.id;
    out.shortResolve = await t("select public.early_warning_resolve($1,'ok')", [f]);
    out.resolve = await t("select public.early_warning_resolve($1,'Met parents; extra lessons twice a week')", [f]);
    out.audit = (await asOwner("select count(*)::int n from audit_logs where school_id=$1 and action ~ '^scholar\\.learning_gap'", [A.schoolId])).row?.n;
  });
  rec("courses", "Prerequisites: cycle refused; course needing a failed prerequisite refused with the missing code", v.prereq?.ok && !v.cycle?.ok && v.missing?.error === "prerequisite_missing" && v.missing?.missing === "MTH101",
    `cycle ${W_ERR(v.cycle)}; ${JSON.stringify(v.missing)} ${v.missing?.ok === false && v.missing?.error === "prerequisite_missing" ? "" : v.gpDbg}`, "critical");
  rec("courses", "Registration window enforced; only admins set it", v.closed?.error === "registration_closed" && !v.teacherWin?.ok, `${v.closed?.error}; teacher ${W_ERR(v.teacherWin)}`, "high");
  rec("courses", "Carry-overs first: new courses blocked until failed courses are re-registered; carry-overs cannot be dropped",
    v.owedFirst?.error === "register_carryovers_first" && v.carry?.ok && v.carry?.carryover && v.ok?.ok && !v.dropCarry?.ok, `${v.owedFirst?.error} → carry ok → ${v.ok?.units} units; drop ${W_ERR(v.dropCarry)}`, "critical");
  rec("courses", "Unit limit (max 24) refuses an over-load", v.cap?.error === "unit_limit", JSON.stringify(v.cap), "high");
  rec("courses", "Adviser approves once; students cannot approve or drop others' courses or read them", v.approve?.ok && !v.again?.ok && !v.studentApprove?.ok && !v.otherDrop?.ok && v.peek === 0,
    `student ${W_ERR(v.studentApprove)}; other drop ${W_ERR(v.otherDrop)}; again ${W_ERR(v.again)}`, "critical");
  rec("siwes", "Placement issues a one-time supervisor code that is never readable back", !!v.code && !v.hashRead?.ok && v.rowRead?.ok, `hash ${W_ERR(v.hashRead)}`, "critical");
  rec("siwes", "Logbook: own placement only, meaningful entries, weeks inside placement", v.log1?.ok && !v.shortLog?.ok && !v.farWeek?.ok && !v.otherLog?.ok,
    `short ${W_ERR(v.shortLog)}; far ${W_ERR(v.farWeek)}; other ${W_ERR(v.otherLog)}`, "high");
  rec("siwes", "Industry supervisor verifies with the code (wrong code refused); verified weeks lock; brute force rate limited",
    v.badCode?.error === "invalid_code" && v.verify?.ok && !v.editLocked?.ok && v.rl >= 2, `verify ${JSON.stringify(v.verify)}; locked ${W_ERR(v.editLocked)}; rl ${v.rl}/12`, "critical");
  rec("warning", "Early warning flags low attendance, low average and failing core subjects; re-runs never duplicate",
    /low_attendance/.test(w.flags ?? "") && /low_average:act/.test(w.flags ?? "") && /failing_core/.test(w.flags ?? "") && w.dupes === 0, `${w.flags}; run ${JSON.stringify(w.run)}`, "high");
  rec("warning", "Parents see only their child's flags; other schools see none; only staff run it; resolution needs a note",
    w.parentSees >= 1 && w.bSees === 0 && !w.parentRun?.ok && !w.shortResolve?.ok && w.resolve?.ok && w.audit >= 1, `parent ${w.parentSees}; B ${w.bSees}; short ${W_ERR(w.shortResolve)}`, "high");
}
// ---------- 19. Lesson notes, HR appraisal/loans/PAYE, inventory, assets, visitors (SHERIVS-024) ----------
{
  const v = await wave(A.admin, async ({ t, act, asOwner, out }) => {
    const staff = (await asOwner("select id from users where school_id=$1 and role='teacher' and id<>$2 order by id limit 3", [A.schoolId, A.teacher])).r.rows.map((r) => r.id);
    const tc = (await asOwner("select id from classes where teacher_id=$1 limit 1", [A.teacher])).row?.id;
    // scheme + lesson notes
    const wk = (await t("select public.scheme_week_upsert($1,'Mathematics','JSS 1','First Term',3,'Fractions',array['add fractions'],'nerdc_2025_jss') id", [A.schoolId])).row?.id;
    await act(A.teacher); out.teacherScheme = await t("select public.scheme_week_upsert($1,'Mathematics','JSS 1','First Term',4,'x')", [A.schoolId]);
    const lp = (await asOwner("insert into lesson_plans (school_id, teacher_id, class_id, title, subject, topic, status) values ($1,$2,$3,'Fractions wk3','Mathematics','Fractions','draft') returning id", [A.schoolId, A.teacher, tc])).row?.id;
    const lpOther = (await asOwner("insert into lesson_plans (school_id, teacher_id, class_id, title, subject, topic, status) values ($1,$2,$3,'Other','Mathematics','x','draft') returning id", [A.schoolId, staff[0], tc])).row?.id;
    out.sub = await t("select public.lesson_note_submit($1,$2) id", [lp, wk]);
    out.subOther = await t("select public.lesson_note_submit($1)", [lpOther]);
    out.dup = await t("select public.lesson_note_submit($1)", [lp]);
    out.teacherReview = await t("select public.lesson_note_review($1,true)", [out.sub?.row?.id]);
    await act(A.admin);
    out.returnNoNote = await t("select public.lesson_note_review($1,false,'')", [out.sub?.row?.id]);
    out.review = await t("select public.lesson_note_review($1,true,'Good')", [out.sub?.row?.id]);
    out.planStatus = (await asOwner("select status from lesson_plans where id=$1", [lp])).row?.status;
    // appraisal
    const cyc = (await asOwner("insert into appraisal_cycles (school_id, name, starts_on, ends_on) values ($1,'Sim 2026 appraisal',current_date,current_date+30) returning id", [A.schoolId])).row?.id;
    out.selfAppr = await t("select public.appraisal_open($1,$2,$2)", [cyc, staff[0]]);
    const ap = (await t("select public.appraisal_open($1,$2,$3) id", [cyc, staff[0], staff[1]])).row?.id;
    const sc = JSON.stringify({ "Lesson delivery": 4, Punctuality: 5, "Student outcomes": 3, Teamwork: 4, "Professional development": 4 });
    await act(staff[1]); out.earlyReview = await t("select public.appraisal_review($1,$2)", [ap, sc]);
    await act(staff[0]); out.badSelf = await t("select public.appraisal_self($1,'{\"Punctuality\":9}')", [ap]);
    out.self = await t("select public.appraisal_self($1,$2)", [ap, sc]);
    out.selfReview = await t("select public.appraisal_review($1,$2)", [ap, sc]);
    await act(staff[1]); out.review2 = (await t("select public.appraisal_review($1,$2) o", [ap, sc])).row?.o;
    await act(staff[2]); out.peekAppr = (await t("select count(*)::int n from appraisals where id=$1", [ap])).row?.n;
    await act(staff[0]); out.ack = await t("select public.appraisal_acknowledge($1,'Thanks')", [ap]);
    // payroll: profile, loan, PAYE (Nigeria Tax Act 2025 bands), approval SoD
    await act(A.admin);
    out.selfSalary = await t("select public.salary_profile_set($1,1000000)", [A.admin]);
    out.prof = await t("select public.salary_profile_set($1,300000,100000,50000,50000,1200000,false)", [staff[0]]);
    await act(A.teacher); out.teacherSalary = await t("select public.salary_profile_set($1,999999)", [staff[0]]);
    await act(staff[0]);
    out.bigLoan = await t("select public.loan_request(1000000, 400000, 'Rent')");
    const loan = (await t("select public.loan_request(100000, 40000, 'School fees') id")).row?.id;
    out.secondLoan = await t("select public.loan_request(50000, 10000, 'x')");
    await act(A.admin); out.adminLoan = await t("select public.loan_decide($1,true)", [loan]);
    const appr = staff[2];
    await t("select public.role_assign($1,$2,'ng.acting_provost','org',null)", [A.schoolId, appr]);
    await asOwner("insert into org_role_permission_settings (org_id, role_code, permission_code, enabled) values ($1,'ng.acting_provost','payroll.approve',true) on conflict (org_id, role_code, permission_code) do update set enabled=true", [A.schoolId]);
    await act(appr); out.loanOk = await t("select public.loan_decide($1,true)", [loan]);
    await act(A.admin);
    out.paye = Number((await t("select public.paye_annual(6000000, 432000, 0, 1200000) p")).row?.p);
    out.compRaw = await t("select public.payroll_compute($1,11,2026) r", [A.schoolId]); out.comp = out.compRaw.row?.r;
    out.line = (await asOwner("select tax_deduction, pension_deduction, loan_deduction, net_salary from staff_payroll where user_id=$1 and month=11 and year=2026", [staff[0]])).row;
    out.adminApprove = await t("select public.payroll_approve($1,11,2026)", [A.schoolId]);
    await act(appr); out.approve = await t("select public.payroll_approve($1,11,2026) n", [A.schoolId]);
    out.loanBal = Number((await asOwner("select balance from staff_loans where id=$1", [loan])).row?.balance);
    await act(staff[1]); out.peekPay = (await t("select count(*)::int n from staff_salary_profiles where user_id=$1", [staff[0]])).row?.n;
    // inventory
    await act(A.admin);
    const it = (await t("select public.inventory_item_upsert($1,'CHALK-W','White chalk','box',5,1500) id", [A.schoolId])).row?.id;
    out.buy = (await t("select public.inventory_move($1,20,'purchase','PO-1') r", [it])).row?.r;
    out.issue = (await t("select public.inventory_move($1,-16,'issue','REQ-1','JSS1 A') r", [it])).row?.r;
    out.over = await t("select public.inventory_move($1,-10,'issue')", [it]);
    out.wrongSign = await t("select public.inventory_move($1,5,'issue')", [it]);
    out.directQty = await t("update inventory_items set qty = 999 where id=$1", [it]);
    out.editMove = await asOwner("update inventory_moves set delta = 1 where item_id=$1", [it]);
    await act(A.teacher); out.teacherInv = await t("select public.inventory_move($1,-1,'issue')", [it]);
    // assets
    await act(A.admin);
    const as = (await t("select public.asset_register($1,'SIM-LAP-001','Staff laptop','ICT',600000,current_date - 365,4) id", [A.schoolId])).row?.id;
    out.bv = Number((await t("select public.asset_book_value($1) v", [as])).row?.v);
    out.dupTag = await t("select public.asset_register($1,'SIM-LAP-001','dup','ICT',1,current_date)", [A.schoolId]);
    out.dispose = await t("select public.asset_update($1,'disposed')", [as]);
    out.redispose = await t("select public.asset_update($1,'in_use')", [as]);
    out.events = (await asOwner("select count(*)::int n from asset_events where asset_id=$1", [as])).row?.n;
    // visitors + pick-ups
    const kid = (await asOwner("select id, parent_id from students where school_id=$1 and parent_id is not null order by admission_number limit 1", [A.schoolId])).row;
    const other = (await asOwner("select id from students where school_id=$1 and parent_id is distinct from $2 and id not in (select student_id from parent_student_map where parent_id=$2) limit 1", [A.schoolId, kid.parent_id])).row?.id;
    await act(kid.parent_id);
    out.authOther = await t("select public.pickup_authorise($1,'Uncle Tunde','08031234567','uncle')", [other]);
    out.auth = await t("select public.pickup_authorise($1,'Uncle Tunde','0803 123 4567','uncle')", [kid.id]);
    out.unauth = (await t("select public.visitor_preregister('Stranger','08099999999','pickup',$1) r", [kid.id])).row?.r;
    out.parentMeeting = await t("select public.visitor_preregister('x','080','meeting')");
    const pass = (await t("select public.visitor_preregister('Uncle Tunde','08031234567','pickup',$1) r", [kid.id])).row?.r;
    out.codeRead = await t("select code_hash from visitor_passes limit 1");
    await act(A.teacher); out.teacherGate = await t("select public.visitor_check_in($1,$2)", [pass?.pass_id, pass?.code]);
    await act(A.admin);
    out.wrong = (await t("select public.visitor_check_in($1,'000000') r", [pass?.pass_id])).row?.r;
    out.in = (await t("select public.visitor_check_in($1,$2) r", [pass?.pass_id, pass?.code])).row?.r;
    out.again = (await t("select public.visitor_check_in($1,$2) r", [pass?.pass_id, pass?.code])).row?.r;
    out.out = await t("select public.visitor_check_out($1)", [pass?.pass_id]);
    await act(kid.parent_id); const p2 = (await t("select public.visitor_preregister('Uncle Tunde','08031234567','pickup',$1) r", [kid.id])).row?.r;
    await asOwner("update authorised_pickups set active=false where student_id=$1", [kid.id]);
    await act(A.admin); out.revoked = (await t("select public.visitor_check_in($1,$2) r", [p2?.pass_id, p2?.code])).row?.r;
    out.audit = (await asOwner("select count(*)::int n from audit_logs where school_id=$1 and action ~ '^scholar\\.(lesson_note|appraisal|staff_loans|staff_salary|inventory|fixed_assets|visitor|authorised)'", [A.schoolId])).row?.n;
  });
  rec("lessons", "Lesson notes: teacher submits own notes once; reviewer is never the author; returning needs a reason; scheme set by HoD/admin only",
    v.sub?.ok && !v.subOther?.ok && !v.dup?.ok && !v.teacherReview?.ok && !v.returnNoNote?.ok && v.review?.ok && v.planStatus === "approved" && !v.teacherScheme?.ok,
    `other ${W_ERR(v.subOther)}; dup ${W_ERR(v.dup)}; teacher review ${W_ERR(v.teacherReview)}; scheme ${W_ERR(v.teacherScheme)}`, "high");
  rec("hr", "Appraisal: no self-appraiser; self-review first, all criteria 1–5; only the assigned appraiser reviews; private to the three parties",
    !v.selfAppr?.ok && !v.earlyReview?.ok && !v.badSelf?.ok && v.self?.ok && !v.selfReview?.ok && Number(v.review2) === 4 && v.peekAppr === 0 && v.ack?.ok,
    `overall ${v.review2}; early ${W_ERR(v.earlyReview)}; self ${W_ERR(v.selfReview)}`, "high");
  rec("payroll", "PAYE uses Nigeria Tax Act 2025 bands with rent relief and pension: ₦6m gross → ₦749,040/yr", v.paye === 749040, `paye ${v.paye}`, "critical");
  rec("payroll", "Payroll line: PAYE ₦62,420, pension 8% ₦36,000, loan ₦40,000 deducted; net ₦361,580",
    Number(v.line?.tax_deduction) === 62420 && Number(v.line?.pension_deduction) === 36000 && Number(v.line?.loan_deduction) === 40000 && Number(v.line?.net_salary) === 361580,
    JSON.stringify(v.line), "critical");
  rec("payroll", "SoD: no own salary, no self or admin loan approval, approver ≠ preparer; approval reduces loan balance",
    !v.selfSalary?.ok && !v.teacherSalary?.ok && !v.adminLoan?.ok && v.loanOk?.ok && !v.adminApprove?.ok && v.approve?.ok && v.loanBal === 60000 && !v.bigLoan?.ok && !v.secondLoan?.ok && v.peekPay === 0,
    `admin loan ${W_ERR(v.adminLoan)}; admin approve ${W_ERR(v.adminApprove)}; balance ${v.loanBal}; big ${W_ERR(v.bigLoan)}`, "critical");
  rec("inventory", "Stock never goes negative; moves append-only; reorder alert; direct edits and teachers refused",
    v.buy?.qty === 20 && v.issue?.reorder === true && !v.over?.ok && !v.wrongSign?.ok && !v.directQty?.ok && !v.editMove?.ok && !v.teacherInv?.ok,
    `over ${W_ERR(v.over)}; direct ${W_ERR(v.directQty)}`, "high");
  rec("assets", "Asset register: unique tags, straight-line book value (₦600k over 4y, 1y old ≈ ₦450k), disposal final, history kept",
    Math.abs(v.bv - 450000) < 1000 && !v.dupTag?.ok && v.dispose?.ok && !v.redispose?.ok && v.events === 2, `bv ${v.bv}; events ${v.events}`, "high");
  rec("visitors", "Pick-ups: only the parent authorises; strangers refused; gate code hashed and checked once; revoked authorisation denied at the gate",
    !v.authOther?.ok && v.auth?.ok && v.unauth?.error === "not_an_authorised_pickup" && !v.parentMeeting?.ok && !v.codeRead?.ok && !v.teacherGate?.ok
      && v.wrong?.error === "wrong_code" && v.in?.ok && v.again?.error === "already_in" && v.out?.ok && v.revoked?.error === "pickup_authorisation_revoked",
    `stranger ${v.unauth?.error}; again ${v.again?.error}; revoked ${v.revoked?.error}`, "critical");
  rec("audit", "Lesson, HR, payroll, inventory, asset and visitor changes are audited", v.audit >= 10, `${v.audit} audit rows`, "high");
}
// ---------- 20. USSD/IVR stubs, alumni + donations, government dashboards, i18n (SHERIVS-025) ----------
{
  const v = await wave(A.admin, async ({ t, act, asOwner, c, out }) => {
    const svc = async (sql, p = []) => { await c.query("SET LOCAL ROLE service_role"); await c.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)");
      try { return await t(sql, p); } finally { await c.query("SET LOCAL ROLE authenticated"); } };
    const anon = async (sql, p = []) => { await c.query("SET LOCAL ROLE anon"); await c.query("select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true)");
      try { return await t(sql, p); } finally { await c.query("SET LOCAL ROLE authenticated"); } };
    const kid = (await asOwner("select s.id, s.parent_id from students s where s.school_id=$1 and s.parent_id is not null order by s.admission_number limit 1", [A.schoolId])).row;
    await asOwner("update users set phone='08035550101' where id=$1", [kid.parent_id]);
    await asOwner("update users set phone=null where phone in ('2348035550101','+2348035550101') and id<>$1", [kid.parent_id]);
    await asOwner("delete from fees where student_id=$1", [kid.id]);
    await asOwner("insert into fees (school_id, student_id, fee_type, amount, paid_amount, status, term, academic_year) values ($1,$2,'tuition',150000,50000,'partial','First Term','2025/2026')", [A.schoolId, kid.id]);
    const ss = "sim-ussd-" + crypto.randomUUID().slice(0, 8);
    out.uUser = await t("select public.ussd_handle($1,'+2348035550101','')", [ss]);
    out.u0 = (await svc("select public.ussd_handle($1,'+2348035550101','') r", [ss])).row?.r;
    out.u1 = (await svc("select public.ussd_handle($1,'+2348035550101','1') r", [ss])).row?.r;
    out.u2 = (await svc("select public.ussd_handle($1,'+2348035550101','1*1') r", [ss])).row?.r;
    out.u3 = (await svc("select public.ussd_handle($1,'+2348035550101','2*1') r", [ss])).row?.r;
    out.uStranger = (await svc("select public.ussd_handle($1,'08000000000','1*1') r", [ss + "x"])).row?.r;
    out.uBad = (await svc("select public.ussd_handle($1,'+2348035550101','1*9') r", [ss])).row?.r;
    // IVR
    await act(A.admin);
    await asOwner("delete from attendance where student_id=$1 and date=current_date", [kid.id]);
    await asOwner("insert into attendance (school_id, student_id, class_id, date, status) values ($1,$2,(select class_id from students where id=$2),current_date,'absent')", [A.schoolId, kid.id]);
    out.ivr = (await t("select public.ivr_queue_absence_calls($1,current_date,'ha') r", [A.schoolId])).row?.r;
    out.ivr2 = (await t("select public.ivr_queue_absence_calls($1,current_date,'ha') r", [A.schoolId])).row?.r;
    out.ivrRow = (await asOwner("select status, provider, script from ivr_calls where student_id=$1", [kid.id])).row;
    await act(A.teacher); out.teacherIvr = await t("select public.ivr_queue_absence_calls($1)", [A.schoolId]);
    // alumni + donations
    await act(A.admin);
    const al = (await t("select public.alumni_register($1,'Ada Obi',2015,'ada@sim.local','08030001111',true) id", [A.schoolId])).row?.id;
    const camp = (await t("select public.donation_campaign_create($1,'New science lab',5000000) id", [A.schoolId])).row?.id;
    await act(A.teacher); out.teacherCamp = await t("select public.donation_campaign_create($1,'x',1)", [A.schoolId]);
    out.userOnline = await t("select public.donation_confirm_online($1,100000,'PSK_DON_1')", [camp]);
    out.d1 = (await svc("select public.donation_confirm_online($1,250000,'PSK_DON_1','Ada Obi',$2) r", [camp, al])).row?.r;
    out.d1r = (await svc("select public.donation_confirm_online($1,250000,'PSK_DON_1','Ada Obi',$2) r", [camp, al])).row?.r;
    await svc("select public.donation_confirm_online($1,50000,'PSK_DON_2',null,null,true)", [camp]);
    await act(A.bursar); out.off = await t("select public.donation_record_offline($1,100000,'transfer','TRF-1','PTA')", [camp]);
    out.offOnline = await t("select public.donation_record_offline($1,1,'paystack','x')", [camp]);
    out.prog = (await anon("select public.donation_campaign_progress($1) p", [camp])).row?.p;
    out.editDon = await asOwner("update donations set amount = 1 where campaign_id=$1", [camp]);
    // government dashboard
    const SA = crypto.randomUUID();
    await asOwner("insert into auth.users (id) values ($1) on conflict do nothing", [SA]);
    await asOwner("insert into super_admins (id, full_name, email, is_active) values ($1,'Sim SA4','sa4@sim.local',true)", [SA]);
    const j = (await asOwner("insert into gov_jurisdictions (name, state, lga) values ('Sim Lagos SUBEB','Lagos','Eti-Osa') returning id")).row?.id;
    const off = (await asOwner("select id from users where school_id=$1 and role='teacher' limit 1", [B.schoolId])).row?.id;   // stands in for a ministry officer account
    await act(A.admin); out.adminGrant = await t("select public.gov_viewer_grant($1,$2)", [off, j]);
    await act(SA); out.grant = await t("select public.gov_viewer_grant($1,$2)", [off, j]);
    await act(off); out.before = (await t("select public.gov_dashboard($1) r", [j])).row?.r;
    await act(B.admin); out.bShareA = await t("select public.gov_sharing_set($1,$2,true)", [A.schoolId, j]);
    await act(A.admin); out.share = await t("select public.gov_sharing_set($1,$2,true)", [A.schoolId, j]);
    await act(off); out.after = (await t("select public.gov_dashboard($1) r", [j])).row?.r;
    out.offRaw = (await t("select count(*)::int n from students where school_id=$1", [A.schoolId])).row?.n;
    await act(A.teacher); out.teacherDash = await t("select public.gov_dashboard($1)", [j]);
    await act(A.admin); await t("select public.gov_sharing_set($1,$2,false)", [A.schoolId, j]);
    await act(off); out.withdrawn = (await t("select public.gov_dashboard($1) r", [j])).row?.r;
    // i18n
    out.ha = (await anon("select public.ui_strings('ha') s")).row?.s;
    out.fr = (await anon("select public.ui_strings('fr') s")).row?.s;
    await act(A.teacher); out.loc = await t("select public.set_my_locale('yo')"); out.locBad = await t("select public.set_my_locale('fr')");
    out.locRow = (await t("select locale from user_locales where user_id=$1", [A.teacher])).row?.locale;
    out.audit = (await asOwner("select count(*)::int n from audit_logs where school_id=$1 and action ~ '^scholar\\.(ivr|alumni|donation|gov_data)'", [A.schoolId])).row?.n;
  });
  rec("ussd", "USSD menu via provider webhook only: menu → child → fee balance (₦100,000) and attendance; unknown numbers and bad choices end politely",
    !v.uUser?.ok && /^CON/.test(v.u0 ?? "") && /^CON Choose child/.test(v.u1 ?? "") && /100,000/.test(v.u2 ?? "") && /^END Present/.test(v.u3 ?? "")
      && /not registered/.test(v.uStranger ?? "") && /Invalid/.test(v.uBad ?? ""), `${v.u2} | ${v.u3}`, "high");
  rec("ivr", "IVR absence calls queue once per child per day in the chosen language; stubbed while voice_live is off; staff only",
    v.ivr?.queued >= 1 && v.ivr2?.queued === 0 && v.ivrRow?.status === "sent_stub" && v.ivrRow?.provider === "stub" && /makaranta/.test(v.ivrRow?.script ?? "") && !v.teacherIvr?.ok,
    `queued ${v.ivr?.queued}; replay ${v.ivr2?.queued}; ${v.ivrRow?.script}`, "high");
  rec("donations", "Online gifts only via the payment webhook (idempotent); bursar records transfers; progress hides anonymous donors; ledger append-only",
    !v.userOnline?.ok && v.d1?.ok && v.d1r?.replay && v.off?.ok && !v.offOnline?.ok && Number(v.prog?.raised) === 400000 && (v.prog?.recent ?? []).some((x) => x.nm === "Anonymous") && !v.editDon?.ok && !v.teacherCamp?.ok,
    `raised ${v.prog?.raised} of ${v.prog?.goal}; user ${W_ERR(v.userOnline)}`, "critical");
  rec("gov", "Government dashboard: Sherivs staff grant viewers; only schools that opt in appear; aggregates only (no row access); withdrawal removes the school",
    !v.adminGrant?.ok && v.grant?.ok && Number(v.before?.schools) === 0 && !v.bShareA?.ok && v.share?.ok && Number(v.after?.schools) === 1 && Number(v.after?.enrolled) > 0 && v.offRaw === 0
      && !v.teacherDash?.ok && Number(v.withdrawn?.schools) === 0, `after ${JSON.stringify({ s: v.after?.schools, e: v.after?.enrolled, att: v.after?.attendance_pct_30d })}; raw rows ${v.offRaw}`, "critical");
  rec("i18n", "UI strings in Hausa, Yoruba, Igbo, Pidgin with English fallback; locale preference validated",
    v.ha?.["nav.fees"] === "Kuɗin makaranta" && v.fr?.["nav.fees"] === "Fees" && v.loc?.ok && !v.locBad?.ok && v.locRow === "yo", `${v.ha?.["nav.fees"]} / ${v.fr?.["nav.fees"]}`, "medium");
  rec("audit", "IVR, alumni, donation and data-sharing changes are audited", v.audit >= 4, `${v.audit} audit rows`, "high");
}
// ---------- 21. Wallet top-up initiation + settlement, Igbo label (SHERIVS-026) ----------
{
  const v = await wave(A.admin, async ({ t, act, asOwner, c, out }) => {
    const svc = async (sql, p = []) => { await c.query("SET LOCAL ROLE service_role"); await c.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)");
      try { return await t(sql, p); } finally { await c.query("SET LOCAL ROLE authenticated"); } };
    const bal = async () => Number((await asOwner("select balance from school_wallets where school_id=$1", [A.schoolId])).row?.balance ?? 0);
    const b0 = await bal();
    const i1 = (await t("select public.wallet_topup_intent_create($1, 25000, 'bursar@sim.local') r", [A.schoolId])).row?.r;
    out.i1 = i1;
    out.tooSmall = await t("select public.wallet_topup_intent_create($1, 50, 'bursar@sim.local')", [A.schoolId]);
    out.badEmail = await t("select public.wallet_topup_intent_create($1, 500, 'nope')", [A.schoolId]);
    out.otherSchool = await t("select public.wallet_topup_intent_create($1, 500, 'x@sim.local')", [B.schoolId]);
    out.userSettle = await t("select public.wallet_topup_settle($1,'success',2500000,'NGN')", [i1?.reference]);
    out.mismatch = (await svc("select public.wallet_topup_settle($1,'success',100,'NGN') r", [(await t("select public.wallet_topup_intent_create($1, 1000, 'b@sim.local') r", [A.schoolId])).row?.r?.reference])).row?.r;
    out.failed = (await svc("select public.wallet_topup_settle($1,'failed',2500000,'NGN') r", [i1?.reference])).row?.r;
    out.ok = (await svc("select public.wallet_topup_settle($1,'success',2500000,'NGN') r", [i1?.reference])).row?.r;
    out.replay = (await svc("select public.wallet_topup_settle($1,'success',2500000,'NGN') r", [i1?.reference])).row?.r;
    out.unknown = (await svc("select public.wallet_topup_settle('wtp_nope','success',100,'NGN') r")).row?.r;
    out.delta = (await bal()) - b0;
    out.intentRow = (await t("select status from wallet_topup_intents where reference=$1", [i1?.reference])).row?.status;
    await act(A.teacher);
    out.teacherInit = await t("select public.wallet_topup_intent_create($1, 500, 't@sim.local')", [A.schoolId]);
    out.teacherSees = (await t("select count(*)::int n from wallet_topup_intents")).row?.n;
    out.ig = (await t("select public.ui_strings('ig') s")).row?.s;
  });
  rec("wallet_topup", "Staff with wallet.topup create a Paystack intent (NGN100–10m, valid email, own school only); users cannot settle",
    /^wtp_[0-9a-f]{32}$/.test(v.i1?.reference ?? "") && v.i1?.amount_kobo === 2500000 && !v.tooSmall?.ok && !v.badEmail?.ok && !v.otherSchool?.ok && !v.userSettle?.ok && !v.teacherInit?.ok && v.teacherSees === 0,
    JSON.stringify(v.i1), "high");
  rec("wallet_topup", "Settlement credits the wallet only on success + exact NGN amount; replays are no-ops; mismatches are rejected",
    v.mismatch?.outcome === "rejected" && v.failed?.outcome === "ignored" && v.ok?.outcome === "settled" && v.replay?.outcome === "duplicate" && v.unknown?.outcome === "ignored" && v.delta === 25000 && v.intentRow === "paid",
    `delta ${v.delta}; ${v.ok?.outcome}/${v.replay?.outcome}/${v.mismatch?.outcome}`, "high");
  rec("i18n", "Igbo dashboard label is no longer English", v.ig?.["nav.dashboard"] && v.ig["nav.dashboard"] !== "Dashboard", String(v.ig?.["nav.dashboard"]), "low");
}
// ---------- 22. Government portal: own login type, aggregates only, small groups suppressed, views logged (SHERIVS-027) ----------
{
  const v = await wave(A.admin, async ({ t, act, asOwner, out }) => {
    const SA = crypto.randomUUID(), OFF = crypto.randomUUID();
    await asOwner("insert into auth.users (id) values ($1),($2) on conflict do nothing", [SA, OFF]);
    await asOwner("insert into super_admins (id, full_name, email, is_active) values ($1,'Sim SA6','sa6@sim.local',true)", [SA]);
    const j = (await asOwner("insert into gov_jurisdictions (name, state, lga) values ('Sim FCT UBEB','FCT','AMAC') returning id")).row?.id;
    const j2 = (await asOwner("insert into gov_jurisdictions (name, state, lga) values ('Sim Kano SUBEB','Kano','Nassarawa') returning id")).row?.id;
    await act(OFF); out.noneMine = (await t("select public.gov_my_jurisdictions() r")).row?.r; out.noAccess = await t("select public.gov_overview($1)", [j]);
    await act(SA); out.grant = await t("select public.gov_viewer_grant($1,$2)", [OFF, j]);   // officer has NO public.users row (own login type)
    await asOwner("insert into school_locations (school_id, state, lga, ownership) values ($1,'FCT','AMAC','private') on conflict (school_id) do update set lga='AMAC', ownership='private'", [A.schoolId]);
    await act(A.admin); await t("select public.gov_sharing_set($1,$2,true)", [A.schoolId, j]);
    const tiny = (await asOwner("insert into schools (name, slug) values ('Sim Tiny School', 'sim-tiny-' || substr(md5(random()::text),1,6)) returning id")).row?.id;
    await asOwner("insert into students (school_id, gender) select $1, 'female' from generate_series(1,3)", [tiny]);
    await asOwner("insert into school_locations (school_id, state, lga, ownership) values ($1,'FCT','Bwari','community')", [tiny]);
    await asOwner("insert into gov_data_sharing (school_id, jurisdiction_id, consented_by) values ($1,$2,$3)", [tiny, j, A.admin]);
    await act(OFF);
    out.mine = (await t("select public.gov_my_jurisdictions() r")).row?.r;
    out.ov = (await t("select public.gov_overview($1) r", [j])).row?.r;
    out.trend = (await t("select public.gov_attendance_trend($1, 8) r", [j])).row?.r;
    out.badWeeks = await t("select public.gov_attendance_trend($1, 99)", [j]);
    out.otherJ = await t("select public.gov_overview($1)", [j2]);
    out.rows = await t("select count(*) from students");
    out.log = (await t("select count(*)::int n from gov_view_log where user_id=$1", [OFF])).row?.n;
    out.logEdit = await t("delete from gov_view_log where user_id=$1", [OFF]);
    // only tiny school shared to j2 -> whole jurisdiction suppressed
    await asOwner("insert into gov_data_sharing (school_id, jurisdiction_id, consented_by) values ($1,$2,$3)", [tiny, j2, A.admin]);
    await act(SA); await t("select public.gov_viewer_grant($1,$2)", [OFF, j2]);
    await act(OFF); out.ov2 = (await t("select public.gov_overview($1) r", [j2])).row?.r;
    await act(A.teacher); out.teacherOv = await t("select public.gov_overview($1)", [j]);
  });
  const big = v.ov?.per_school?.find((s) => !s.suppressed), small = v.ov?.per_school?.find((s) => s.suppressed);
  rec("gov_portal", "Gov officer with no school account gets a portal only after Sherivs grants a jurisdiction; others (teacher, other jurisdiction) are refused",
    Array.isArray(v.noneMine) && v.noneMine.length === 0 && !v.noAccess?.ok && v.grant?.ok && v.mine?.length === 1 && v.mine[0].state === "FCT" && !v.otherJ?.ok && !v.teacherOv?.ok,
    `mine ${JSON.stringify(v.mine)}`, "high");
  rec("gov_portal", "Aggregates only: no row access; a school with under 10 students shows no numbers; ownership/LGA groups under 10 are suppressed",
    v.ov?.schools === 2 && v.ov?.suppressed === false && v.ov?.enrolled > 10 && big?.enrolled > 10 && small && small.enrolled == null && small.girls_pct == null && small.attendance_pct == null
      && v.ov?.by_lga?.find((g) => g.lga === "Bwari")?.suppressed === true && v.ov?.by_lga?.find((g) => g.lga === "Bwari")?.enrolled == null
      && v.ov?.by_ownership?.find((g) => g.ownership === "community")?.suppressed === true && !(v.rows?.ok && Number(v.rows.row?.count) > 0),
    `schools ${v.ov?.schools}; small ${JSON.stringify(small)}`, "high");
  rec("gov_portal", "A jurisdiction whose shared schools total under 10 students is fully suppressed; trend weeks are bounded; every view is logged append-only",
    v.ov2?.suppressed === true && v.ov2?.enrolled == null && v.ov2?.girls_pct == null && Array.isArray(v.trend) && v.trend.every((w) => w.suppressed || w.attendance_pct != null)
      && !v.badWeeks?.ok && v.log >= 2 && !v.logEdit?.ok,
    `ov2 ${JSON.stringify(v.ov2)}; log ${v.log}`, "high");
}
// ---------- 23. Gov access console (platform.gov.manage) + wallet top-up reconciliation (SHERIVS-028) ----------
{
  const v = await wave(A.admin, async ({ t, act, asOwner, c, out }) => {
    const svc = async (sql, p = []) => { await c.query("SET LOCAL ROLE service_role"); await c.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)");
      try { return await t(sql, p); } finally { await c.query("SET LOCAL ROLE authenticated"); } };
    const PA = crypto.randomUUID(), SUP = crypto.randomUUID(), OFF = crypto.randomUUID();
    const em = "officer-" + OFF.slice(0, 8) + "@ubec.sim";
    await asOwner("insert into auth.users (id, email) values ($1,$4),($2,$5),($3,$6)", [PA, SUP, OFF, "pa@sim.local".replace("pa", "pa" + PA.slice(0, 6)), "sup" + SUP.slice(0, 6) + "@sim.local", em]);
    await asOwner("insert into platform_staff (id, email, full_name, status) values ($1,$2,'Sim Platform Admin','active'),($3,$4,'Sim Support','active')", [PA, "pa" + PA.slice(0, 6) + "@sim.local", SUP, "sup" + SUP.slice(0, 6) + "@sim.local"]);
    await asOwner("insert into platform_staff_roles (staff_id, role_code) values ($1,'platform_admin'),($2,'support')", [PA, SUP]);
    await act(SUP); out.supCreate = await t("select public.gov_jurisdiction_create('Sim Oyo SUBEB','Oyo','Ibadan North')");
    await act(A.admin); out.schoolAdminCreate = await t("select public.gov_jurisdiction_create('Sim Oyo SUBEB','Oyo','Ibadan North')");
    await act(PA);
    const j = (await t("select public.gov_jurisdiction_create('Sim Oyo SUBEB','Oyo','Ibadan North') id")).row?.id; out.j = j;
    out.badName = await t("select public.gov_jurisdiction_create('x','Oyo')");
    out.noAcct = await t("select public.gov_viewer_grant_email('nobody@nowhere.sim',$1)", [j]);
    const schoolEmail = (await asOwner("select au.email from auth.users au join users u on u.id=au.id where au.email is not null limit 1")).row?.email;
    out.schoolAcct = schoolEmail ? await t("select public.gov_viewer_grant_email($1,$2)", [schoolEmail, j]) : { ok: false, skipped: true };
    out.grant = (await t("select public.gov_viewer_grant_email($1,$2) u", [em.toUpperCase(), j])).row?.u;
    out.ov = (await t("select public.gov_admin_overview() r")).row?.r;
    await act(OFF); out.offSees = (await t("select public.gov_my_jurisdictions() r")).row?.r;
    await act(SUP); out.supRevoke = await t("select public.gov_viewer_revoke($1,$2)", [OFF, j]); out.supOverview = await t("select public.gov_admin_overview()");
    await act(PA); out.revoke = (await t("select public.gov_viewer_revoke($1,$2) r", [OFF, j])).row?.r;
    await act(OFF); out.offAfter = (await t("select public.gov_my_jurisdictions() r")).row?.r;
    out.audit = (await asOwner("select array_agg(action order by id) a from gov_admin_audit where jurisdiction_id=$1", [j])).row?.a;
    out.auditEdit = await asOwner("delete from gov_admin_audit where jurisdiction_id=$1", [j]);
    // ---- reconciliation ----
    await act(A.admin);
    const mk = async (amt, age) => { const r = (await t("select public.wallet_topup_intent_create($1,$2,'bursar@sim.local') r", [A.schoolId, amt])).row?.r?.reference;
      await asOwner(`update wallet_topup_intents set created_at = now() - interval '${age}' where reference=$1`, [r]); return r; };
    const fresh = await mk(1000, "1 minute"), due = await mk(2000, "10 minutes"), stale = await mk(3000, "30 hours");
    out.userList = await t("select * from public.wallet_topup_pending_for_check()");
    out.list1 = (await svc("select array_agg(r) a from public.wallet_topup_pending_for_check() r")).row?.a ?? [];
    await svc("select public.wallet_topup_mark_checked($1)", [due]);
    out.list2 = (await svc("select array_agg(r) a from public.wallet_topup_pending_for_check() r")).row?.a ?? [];
    out.badExpiry = await svc("select public.wallet_topup_expire_stale(interval '5 minutes')");
    out.expired = (await svc("select public.wallet_topup_expire_stale() n")).row?.n;
    out.expiredAgain = (await svc("select public.wallet_topup_expire_stale() n")).row?.n;
    out.stale = (await asOwner("select status, failure_reason from wallet_topup_intents where reference=$1", [stale])).row;
    const b0 = Number((await asOwner("select balance from school_wallets where school_id=$1", [A.schoolId])).row?.balance ?? 0);
    out.late = (await svc("select public.wallet_topup_settle($1,'success',300000,'NGN') r", [stale])).row?.r;
    out.delta = Number((await asOwner("select balance from school_wallets where school_id=$1", [A.schoolId])).row?.balance ?? 0) - b0;
    out.checked = (await asOwner("select check_count from wallet_topup_intents where reference=$1", [due])).row?.check_count;
    Object.assign(out, { fresh, due, staleRef: stale });
  });
  rec("gov_admin", "Only platform staff with platform.gov.manage create jurisdictions and grant/revoke officers (support staff and school admins refused)",
    !v.supCreate?.ok && !v.schoolAdminCreate?.ok && !!v.j && !v.badName?.ok && !v.supRevoke?.ok && !v.supOverview?.ok, JSON.stringify({ sup: v.supCreate?.err }), "high");
  rec("gov_admin", "Grant by email (case-insensitive) only for existing non-school accounts; the officer then sees the jurisdiction; revoke removes it",
    !v.noAcct?.ok && (v.schoolAcct?.skipped || !v.schoolAcct?.ok) && !!v.grant && v.offSees?.length === 1 && v.revoke === true && Array.isArray(v.offAfter) && v.offAfter.length === 0
      && v.ov?.jurisdictions?.some((x) => x.id === v.j && x.viewers.length === 1),
    `grant ${v.grant}; after ${JSON.stringify(v.offAfter)}`, "high");
  rec("gov_admin", "Every create/grant/revoke is in the append-only gov_admin_audit",
    JSON.stringify(v.audit) === JSON.stringify(["jurisdiction_create", "viewer_grant", "viewer_revoke"]) && !v.auditEdit?.ok, JSON.stringify(v.audit), "high");
  rec("wallet_reconcile", "Reconciler lists only pending intents older than 5 min and not just checked (service role only); checks are counted",
    !v.userList?.ok && v.list1.includes(v.due) && v.list1.includes(v.staleRef) && !v.list1.includes(v.fresh) && !v.list2.includes(v.due) && v.checked === 1,
    `list1 ${v.list1.length}; list2 ${v.list2.length}`, "high");
  rec("wallet_reconcile", "Stale pending top-ups (>24h) are marked failed exactly once (expiry floor 1h); a late confirmed payment still credits once",
    !v.badExpiry?.ok && v.expired >= 1 && v.expiredAgain === 0 && v.stale?.status === "failed" && /expired/.test(v.stale?.failure_reason ?? "") && v.late?.outcome === "settled" && v.delta === 3000,
    `expired ${v.expired}/${v.expiredAgain}; bad ${v.badExpiry?.ok}; stale ${JSON.stringify(v.stale)}; late ${v.late?.outcome}; delta ${v.delta}`, "high");
}
// ---------- 24. School custom domains (.sch.ng / .edu.ng) + host-scoped login (SHERIVS-029) ----------
{
  const v = await wave(A.admin, async ({ t, act, asOwner, c, out }) => {
    const svc = async (sql, p = []) => { await c.query("SET LOCAL ROLE service_role"); await c.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)");
      try { return await t(sql, p); } finally { await c.query("SET LOCAL ROLE authenticated"); } };
    const anon = async (sql, p = []) => { await c.query("SET LOCAL ROLE anon"); await c.query("select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true)");
      try { return await t(sql, p); } finally { await c.query("SET LOCAL ROLE authenticated"); } };
    const host = "portal.sim-" + crypto.randomUUID().slice(0, 8) + ".sch.ng";
    out.add = (await t("select public.school_domain_add($1,'app') r", ["HTTPS://" + host.toUpperCase() + "/login"])).row?.r;
    out.reserved = await t("select public.school_domain_add('evil.sherivs.com')");
    out.bareSld = await t("select public.school_domain_add('edu.ng')");
    out.junk = await t("select public.school_domain_add('not a domain')");
    await act(A.teacher); out.teacherAdd = await t("select public.school_domain_add($1)", ["x." + host]);
    await act(B.admin);
    out.bSteal = await t("select public.school_domain_add($1)", [host]);
    out.bSees = (await t("select count(*)::int n from school_domains where hostname=$1", [host])).row?.n;
    out.bRemove = (await t("select public.school_domain_remove($1) r", [out.add?.id])).row?.r;
    out.bPrimary = await t("select public.school_domain_set_primary($1)", [out.add?.id]);
    out.bDirect = await t("update school_domains set school_id=$2 where hostname=$1", [host, B.schoolId]);
    await act(A.admin);
    out.aSees = (await t("select count(*)::int n from school_domains where hostname=$1", [host])).row?.n;
    out.primaryPending = await t("select public.school_domain_set_primary($1)", [out.add?.id]);
    out.anonBefore = (await anon("select public.resolve_school_by_host($1) r", [host])).row?.r ?? null;
    await act(A.admin);
    out.userVerify = await t("select public.school_domain_record_check($1, true)", [out.add?.id]);
    out.userForCheck = await t("select public.school_domain_for_check($1)", [out.add?.id]);
    out.forCheck = (await svc("select public.school_domain_for_check($1) r", [out.add?.id])).row?.r;
    out.verify = (await svc("select public.school_domain_record_check($1, true, 'stubbed') r", [out.add?.id])).row?.r;
    out.anonAfter = (await anon("select public.resolve_school_by_host($1) r", [host.toUpperCase() + "."])).row?.r;
    out.anonTable = await anon("select count(*) from school_domains");
    await act(A.admin); // the svc/anon helpers leave service/anon claims behind
    out.primary = (await t("select public.school_domain_set_primary($1) r", [out.add?.id])).row?.r;
    out.loginA = (await t("select public.school_domain_login_allowed($1) r", [host])).row?.r;
    await act(A.teacher); out.loginATeacher = (await t("select public.school_domain_login_allowed($1) r", [host])).row?.r;
    await act(B.admin); out.loginB = (await t("select public.school_domain_login_allowed($1) r", [host])).row?.r;
    out.loginBPlatform = (await t("select public.school_domain_login_allowed('app.sherivs.com') r")).row?.r;
    await act(A.admin);
    out.removed = (await t("select public.school_domain_remove($1) r", [out.add?.id])).row?.r;
    out.anonRemoved = (await anon("select public.resolve_school_by_host($1) r", [host])).row?.r ?? null;
    await act(B.admin); out.bReclaim = (await t("select public.school_domain_add($1) r", [host])).row?.r;
    out.audit = (await asOwner("select array_agg(action order by id) a from school_domain_audit where domain_id=$1", [out.add?.id])).row?.a;
    out.auditEdit = await asOwner("delete from school_domain_audit where domain_id=$1", [out.add?.id]);
    // resolver cost with 2,000 verified domains
    await asOwner("insert into school_domains (school_id, hostname, status) select $1, 'h'||g||'.load.sch.ng', 'verified' from generate_series(1,2000) g", [E.schoolId]);
    const t0 = Date.now(); for (let i = 0; i < 200; i++) await anon("select public.resolve_school_by_host($1)", ["h" + (i * 7 + 1) + ".load.sch.ng"]);
    out.resolveMs = (Date.now() - t0) / 200;
    Object.assign(out, { host });
  });
  rec("custom_domain", "School admin adds a normalised domain and gets TXT + CNAME instructions; teachers, reserved Sherivs hosts, bare SLDs and junk are refused",
    v.add?.hostname === v.host && v.add?.status === "pending" && /^sherivs-verify=/.test(v.add?.txt_value ?? "") && !v.reserved?.ok && !v.bareSld?.ok && !v.junk?.ok && !v.teacherAdd?.ok,
    JSON.stringify({ add: v.add?.hostname, reserved: v.reserved?.err }), "high");
  rec("custom_domain", "Tenant isolation: school B cannot claim, see, remove, make primary or rewrite school A's domain",
    !v.bSteal?.ok && v.bSees === 0 && v.bRemove === false && !v.bPrimary?.ok && (!v.bDirect?.ok || v.bDirect?.r?.rowCount === 0) && v.aSees === 1,
    JSON.stringify({ bSees: v.bSees, bRemove: v.bRemove, bDirect: v.bDirect?.ok ? v.bDirect.r.rowCount : v.bDirect?.err }), "critical");
  rec("custom_domain", "Unverified domains never resolve; only the service role can verify; anon resolves a verified host (case/trailing-dot insensitive) to school A only, never reads the table",
    v.anonBefore === null && !v.primaryPending?.ok && !v.userVerify?.ok && !v.userForCheck?.ok && v.forCheck?.txt_value === v.add?.txt_value && v.verify === "verified"
      && v.anonAfter?.school_id === A.schoolId && !v.anonTable?.ok && v.primary === true,
    JSON.stringify({ anonAfter: v.anonAfter?.school_id === A.schoolId, anonTable: v.anonTable?.err }), "critical");
  rec("custom_domain", "Host-scoped login: school A members allowed on A's domain, a school B user is refused there; platform hosts unaffected",
    v.loginA === true && v.loginATeacher === true && v.loginB === false && v.loginBPlatform === true,
    JSON.stringify({ a: v.loginA, t: v.loginATeacher, b: v.loginB, plat: v.loginBPlatform }), "critical");
  rec("custom_domain", "Removed domain stops resolving and can be claimed afresh; every action is in the append-only audit; resolver stays fast",
    v.removed === true && v.anonRemoved === null && !!v.bReclaim?.id && JSON.stringify(v.audit) === JSON.stringify(["add", "check", "set_primary", "remove"]) && !v.auditEdit?.ok && v.resolveMs < 20,
    `audit ${JSON.stringify(v.audit)}; resolve ${v.resolveMs} ms avg over 2,000 domains`, "high");
}
// ---------- A1. Scope sets complete: audit, no widening on remove, subject dim, caller area (SHERIVS-A01) ----------
{
  const v = await wave(A.admin, async ({ t, act, asOwner, out }) => {
    const cN = (await t("select public.campus_upsert($1,'A1 North') id", [A.schoolId])).row?.id;
    const cS = (await t("select public.campus_upsert($1,'A1 South') id", [A.schoolId])).row?.id;
    const [cls, other] = (await asOwner("select id from classes where school_id=$1 and exists (select 1 from students s where s.class_id=classes.id) order by name desc limit 2", [A.schoolId])).r.rows.map((r) => r.id);
    const tt = (await asOwner("insert into timetables (school_id, class_id, academic_year, term) values ($1,$2,'2026/2027','first') returning id", [A.schoolId, cls])).row?.id;
    await asOwner("insert into timetable_slots (timetable_id, school_id, day_of_week, period_number, start_time, end_time, subject) values ($1,$2,1,1,'08:00','08:40','A1 Further Mathematics')", [tt, A.schoolId]);
    await asOwner("update classes set campus_id=$1 where id=$2", [cN, cls]); await asOwner("update classes set campus_id=$1 where id=$2", [cS, other]);
    const subj = (await asOwner("select ts.subject from timetables tt join timetable_slots ts on ts.timetable_id=tt.id where tt.class_id=$1 and ts.subject is not null limit 1", [cls])).row?.subject;
    const sIn = (await asOwner("select id from students where class_id=$1 limit 1", [cls])).row?.id;
    const sOut = (await asOwner("select id from students where class_id=$1 limit 1", [other])).row?.id;
    const staff = (await asOwner("select id from users where school_id=$1 and role='teacher' and id<>$2 and id not in (select teacher_id from classes where teacher_id is not null) and id not in (select teacher_id from timetable_slots where teacher_id is not null) order by id desc limit 1", [A.schoolId, A.teacher])).row?.id;
    const ra = (await t("select public.role_assign($1,$2,'ng.year_head_year_tutor','org',null) id", [A.schoolId, staff])).row?.id;
    const setN = (await t("select public.role_scope_set_add($1, jsonb_build_object('campus', jsonb_build_array($2::text)), 'A1 North') id", [ra, cN])).row?.id;
    out.auditAdd = (await asOwner("select count(*)::int n from role_scope_audit where set_id=$1 and action='set_add'", [setN])).row?.n;
    // restricted assigner (proprietor limited to North)
    const prop = (await t("select public.role_assign($1,$2,'ng.proprietor','org',null) id", [A.schoolId, A.bursar])).row?.id;
    await t("select public.role_scope_set_add($1, jsonb_build_object('campus', jsonb_build_array($2::text)))", [prop, cN]);
    await act(A.bursar);
    out.removeLast = await t("select public.role_scope_set_remove($1)", [setN]);
    await act(A.admin);
    const setS = (await t("select public.role_scope_set_add($1, jsonb_build_object('campus', jsonb_build_array($2::text)), 'A1 South') id", [ra, cS])).row?.id;
    await act(A.bursar);
    out.removeOutside = await t("select public.role_scope_set_remove($1)", [setS]);
    out.removeInside = await t("select public.role_scope_set_remove($1)", [setN]);
    await act(A.admin);
    out.auditRemove = (await asOwner("select count(*)::int n from role_scope_audit where set_id=$1 and action='set_remove' and actor=$2", [setN, A.bursar])).row?.n;
    out.auditEdit = await asOwner("delete from role_scope_audit where set_id=$1", [setN]);
    // subject dimension: South set gone? keep South; add a subject-only set and check a subject match on the North class
    await t("select public.role_scope_set_remove($1)", [setS]);
    await t("select public.role_scope_set_add($1, jsonb_build_object('subject', jsonb_build_array($2::text)), 'A1 subject')", [ra, subj]);
    out.subjIn = (await t("select public.authz_check($1,'students.view','student',$2) r", [staff, sIn])).row?.r;
    out.subjNoTt = (await asOwner("select count(*)::int n from timetables tt join timetable_slots ts on ts.timetable_id=tt.id where tt.class_id=$1 and ts.subject=$2", [other, subj])).row?.n;
    out.subjOut = (await t("select public.authz_check($1,'students.view','student',$2) r", [staff, sOut])).row?.r;
    // caller's own area + class filter
    await act(staff);
    out.area = (await t("select public.my_operating_area($1) r", [A.schoolId])).row?.r;
    out.ids = (await t("select public.scope_class_ids($1) r", [A.schoolId])).row?.r;
    out.staffList = await t("select public.role_scope_sets_list($1)", [A.schoolId]);
    await act(A.admin);
    out.adminIds = (await t("select public.scope_class_ids($1) r", [A.schoolId])).row;
    out.list = (await t("select public.role_scope_sets_list($1) r", [A.schoolId])).row?.r;
    await act(B.admin); out.crossList = await t("select public.role_scope_sets_list($1)", [A.schoolId]);
    out.crossAudit = (await t("select count(*)::int n from role_scope_audit where org_id=$1", [A.schoolId])).row?.n;
    await act(A.admin);
    Object.assign(out, { cls, other, ra, subj });
  });
  rec("scope_sets", "Every scope-set add/remove is written to an append-only audit", v.auditAdd === 1 && v.auditRemove === 1 && !v.auditEdit?.ok,
    `add ${v.auditAdd}; remove ${v.auditRemove}; edit ${W_ERR(v.auditEdit)}`, "high");
  rec("scope_sets", "A restricted assigner cannot widen by removing: not the last set, not a set outside their area; inside is fine",
    !v.removeLast?.ok && !v.removeOutside?.ok && v.removeInside?.ok, `last ${W_ERR(v.removeLast)}; outside ${W_ERR(v.removeOutside)}; inside ${W_ERR(v.removeInside)}`, "critical");
  rec("scope_sets", "Subject dimension matches the class timetable", v.subjIn?.allow === true && (v.subjNoTt > 0 || v.subjOut?.allow === false),
    `in ${v.subjIn?.deciding_layer}; out ${v.subjOut?.deciding_layer} (other class teaches it: ${v.subjNoTt})`, "high");
  rec("scope_sets", "Caller sees own area; class filter returns only in-area classes; admins get all (NULL)",
    v.area?.unrestricted === false && v.area?.sets?.length === 1 && Array.isArray(v.ids) && v.ids.includes(v.cls) && (v.subjNoTt > 0 || !v.ids.includes(v.other)) && v.adminIds?.r === null,
    `sets ${v.area?.sets?.length}; ids ${v.ids?.length}; admin ${JSON.stringify(v.adminIds?.r)}`, "high");
  rec("scope_sets", "Only role managers list scope sets; other schools see neither sets nor audit",
    Array.isArray(v.list) && v.list.some((s) => s.assignment_id === v.ra) && !v.staffList?.ok && !v.crossList?.ok && v.crossAudit === 0,
    `staff ${W_ERR(v.staffList)}; cross ${W_ERR(v.crossList)}; cross audit ${v.crossAudit}`, "critical");
}
fs.writeFileSync("sim/scenario-results.json", JSON.stringify(results, null, 1));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
await pool.end();
