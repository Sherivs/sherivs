// Track E k6: key school flows through PostgREST with real JWT/RLS (local sim lab only).
// login (post-auth profile + role bootstrap), results, CBT (start/sync/submit), fees (read + child fees), attendance (register read/mark + own history).
// Usage: PEAK=3000 BASE=http://127.0.0.1:3300 ../bin/k6 run flows.js
import http from "k6/http"; import { check, sleep } from "k6"; import { Trend } from "k6/metrics"; import { SharedArray } from "k6/data";
// SharedArray: one copy of the tokens for all VUs (per-VU JSON copies OOM a 16 GB box at 3k+ VUs).
const S = new SharedArray("s", () => JSON.parse(open("./tokens.json")).student.filter((u) => u.tid && u.sid));
const P = new SharedArray("p", () => JSON.parse(open("./tokens.json")).parent.filter((u) => u.sid));
const TE = new SharedArray("t", () => JSON.parse(open("./tokens.json")).teacher.filter((u) => u.cid));
const ALL = new SharedArray("a", () => { const t = JSON.parse(open("./tokens.json")); return [...t.student, ...t.parent, ...t.teacher]; });
const BASE = __ENV.BASE || "http://127.0.0.1:3300";
const PEAK = Number(__ENV.PEAK || 3000);
const tr = {}; for (const f of ["login", "results", "cbt", "fees", "attendance"]) tr[f] = new Trend(`flow_${f}`, true);
export const options = {
  discardResponseBodies: true,
  // SMOKE=1 (CI): same shape, ~30 s total.
  scenarios: { ramp: { executor: "ramping-vus", startVUs: 0, stages: (__ENV.SMOKE ? [["5s", 1 / 3], ["5s", 2 / 3], ["5s", 1], ["10s", 1], ["5s", 0]] : [["30s", 1 / 3], ["30s", 2 / 3], ["30s", 1], ["60s", 1], ["15s", 0]])
    .map(([duration, f]) => ({ duration, target: Math.round(PEAK * f) })), gracefulRampDown: "10s" } },
  thresholds: { http_req_failed: ["rate<0.01"], http_req_duration: ["p(95)<1500"] },
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const H = (u, extra = {}) => ({ headers: Object.assign({ Authorization: `Bearer ${u.t}`, "Content-Type": "application/json" }, extra) });
const ok = (res) => check(res, { "2xx": (x) => x.status >= 200 && x.status < 300 });
const get = (flow, u, path, extra) => { const r = http.get(BASE + path, Object.assign(H(u, extra), { tags: { flow } })); tr[flow].add(r.timings.duration); ok(r); return r; };
const rpc = (flow, u, fn, body, keep) => { const r = http.post(`${BASE}/rpc/${fn}`, JSON.stringify(body), { headers: H(u).headers, tags: { flow }, responseType: keep ? "text" : "none" }); tr[flow].add(r.timings.duration); ok(r); return r; };
const today = new Date().toISOString().slice(0, 10);
export default function () {
  const r = Math.random();
  if (r < 0.15) { // login: role bootstrap after GoTrue sign-in (GoTrue itself is not in the sim)
    const u = pick(ALL); get("login", u, `/users?select=id,full_name,role,school_id&id=eq.${u.uid}`); get("login", u, `/schools?select=id,name,slug&limit=1`);
  } else if (r < 0.45) { // results day
    if (Math.random() < 0.5) { const u = pick(S); get("results", u, `/grades?select=subject,total_score,grade,term&is_published=eq.true&student_id=eq.${u.sid}`); }
    else { const u = pick(P); get("results", u, `/grades?select=student_id,subject,grade&student_id=eq.${u.sid}`); }
  } else if (r < 0.65) { // CBT: start (idempotent per attempt), autosave, submit 1 in 5
    const u = pick(S); const s = rpc("cbt", u, "cbt_start", { p_test: u.tid }, true);
    let id = null; try { const b = s.json(); id = b && (b.attempt_id || b.id || (b.attempt && b.attempt.id)); } catch (_) {}
    if (id) { const ans = { "0": Math.floor(Math.random() * 4) };
      rpc("cbt", u, "cbt_sync", { p_attempt: id, p_answers: ans, p_seq: Math.floor(Date.now() / 1000) % 1e6, p_captured_at: new Date().toISOString() }); }
    get("cbt", u, `/cbt_tests?select=id,title,closes_at`);
  } else if (r < 0.80) { // fees / wallet view (payment itself is Paystack-hosted; settlement is webhook-driven)
    if (Math.random() < 0.5) { const u = pick(P); get("fees", u, `/fees?select=id,amount,paid_amount,status&student_id=eq.${u.sid}`); }
    else { const u = pick(S); get("fees", u, `/fees?select=id,amount,paid_amount,status&student_id=eq.${u.sid}`); }
  } else { // attendance
    if (Math.random() < 0.5) { const u = pick(TE); get("attendance", u, `/attendance?select=student_id,status&class_id=eq.${u.cid}&date=eq.${today}`); }
    else { const u = pick(S); get("attendance", u, `/attendance?select=date,status&student_id=eq.${u.sid}&order=date.desc&limit=30`); }
  }
  sleep(1 + Math.random() * 2);
}
