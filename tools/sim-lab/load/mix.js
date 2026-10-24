// k6 mix: results-day traffic across 5 sim institutions via PostgREST (RLS enforced per JWT).
import http from "k6/http"; import { check, sleep } from "k6"; import { Trend } from "k6/metrics";
const T = JSON.parse(open("./tokens.json")); T.parent = T.parent.filter((u) => u.sid); T.teacher = T.teacher.filter((u) => u.cid);
const BASE = "http://127.0.0.1:3300";
const tr = { student: new Trend("t_student_results", true), parent: new Trend("t_parent_results", true), teacher: new Trend("t_teacher_class", true), bursar: new Trend("t_bursar_fees", true), admin: new Trend("t_admin_dash", true), domain: new Trend("t_domain_resolve", true) };
const PEAK = Number(__ENV.PEAK || 3000);
export const options = {
  discardResponseBodies: true,
  scenarios: { ramp: { executor: "ramping-vus", startVUs: 0, stages: [
    { duration: "30s", target: Math.round(PEAK / 3) }, { duration: "30s", target: Math.round(PEAK * 2 / 3) }, { duration: "30s", target: PEAK }, { duration: "60s", target: PEAK }, { duration: "15s", target: 0 } ], gracefulRampDown: "10s" } },
  thresholds: { http_req_failed: ["rate<0.01"], http_req_duration: ["p(95)<1500"] },
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];
export default function () {
  const r = Math.random(); let role, url;
  // SHERIVS-029: anonymous visitors landing on a school's own domain (verified-host resolver).
  if (r < 0.05) { const res = http.post(BASE + "/rpc/resolve_school_by_host", JSON.stringify({ p_host: `h${1 + Math.floor(Math.random() * 2000)}.load.sch.ng` }), { headers: { "Content-Type": "application/json" }, tags: { role: "domain" } });
    tr.domain.add(res.timings.duration); check(res, { "status 200/206": (x) => x.status === 200 }); }
  else if (r < 0.40) { role = "student"; const u = pick(T.student); url = `/grades?select=subject,total_score,grade,term&is_published=eq.true`; this_req(role, u, url); }
  else if (r < 0.75) { role = "parent"; const u = pick(T.parent); this_req(role, u, `/grades?select=student_id,subject,grade&student_id=eq.${u.sid}`); }
  else if (r < 0.92) { role = "teacher"; const u = pick(T.teacher); this_req(role, u, `/students?select=id,admission_number,class_id&class_id=eq.${u.cid}&limit=100`); }
  else if (r < 0.98) { role = "bursar"; const u = pick(T.bursar); this_req(role, u, `/fees?select=id,amount,paid_amount,status&status=neq.paid&limit=50`); }
  else { role = "admin"; const u = pick(T.admin); this_req(role, u, `/students?select=id&limit=1`, { Prefer: "count=exact" }); }
  sleep(1 + Math.random() * 2);
}
function this_req(role, u, url, extra = {}) {
  const res = http.get(BASE + url, { headers: Object.assign({ Authorization: `Bearer ${u.t}` }, extra), tags: { role } });
  tr[role].add(res.timings.duration); check(res, { "status 200/206": (x) => x.status === 200 || x.status === 206 });
}
