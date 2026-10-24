// k6: login-morning burst of workspace manifest calls (every role) through PostgREST + RLS.
// PEAK=500 ../bin/k6 run workspace.js   (BASE defaults to the sim PostgREST on :3300)
import http from "k6/http"; import { check } from "k6";
const T = JSON.parse(open("./tokens.json")); const BASE = __ENV.BASE || "http://127.0.0.1:3300";
const PEAK = Number(__ENV.PEAK || 500);
export const options = { scenarios: { burst: { executor: "ramping-vus", stages: [{ duration: "15s", target: PEAK }, { duration: "30s", target: PEAK }, { duration: "5s", target: 0 }] } },
  thresholds: { http_req_failed: ["rate<0.01"], http_req_duration: ["p(95)<800"] } };
const roles = Object.keys(T);
export default function () {
  const r = roles[Math.floor(Math.random() * roles.length)]; const u = T[r][Math.floor(Math.random() * T[r].length)];
  const res = http.post(`${BASE}/rpc/workspace_manifest`, JSON.stringify({ p_org: u.school }), { headers: { Authorization: `Bearer ${u.t}`, "Content-Type": "application/json" } });
  check(res, { "200": (x) => x.status === 200, "has widgets": (x) => (x.json("widgets") || []).length > 0 });
}
