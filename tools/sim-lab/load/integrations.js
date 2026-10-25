// SHERIVS-090 k6: 1,000 VUs of school admins re-syncing student batches through PostgREST (real JWT + RLS),
// with 10% cross-tenant write attempts that MUST be refused. Usage: PEAK=1000 k6 run integrations.js
import http from "k6/http"; import { check } from "k6"; import { Counter } from "k6/metrics";
const tokens = JSON.parse(open("./integ-tokens.json"));
const BASE = __ENV.BASE || "http://127.0.0.1:3300";
const crossLeak = new Counter("cross_tenant_write_accepted");
export const options = {
  scenarios: { resync: { executor: "ramping-vus", stages: [{ duration: "20s", target: +(__ENV.PEAK || 1000) }, { duration: "40s", target: +(__ENV.PEAK || 1000) }, { duration: "10s", target: 0 }] } },
  thresholds: { http_req_failed: ["rate<0.01"], cross_tenant_write_accepted: ["count==0"], "http_req_duration{kind:resync}": ["p(95)<1500"] },
};
const batch = (n) => Array.from({ length: 20 }, (_, i) => ({ external_id: `EXT-${n}-${i}`, data: { admission_number: `ADM/${n}/${i}`, gender: i % 2 ? "female" : "male", state_of_origin: "Oyo" } }));
export default function () {
  const me = tokens[(__VU - 1) % tokens.length];
  const hdr = { headers: { Authorization: `Bearer ${me.t}`, "Content-Type": "application/json" } };
  if (Math.random() < 0.1) {
    const other = tokens[(__VU + 7) % tokens.length];
    const r = http.post(`${BASE}/rpc/integration_ingest`, JSON.stringify({ p_integration: other.integration, p_entity: "student", p_records: batch(0), p_idempotency_key: `x-${__VU}-${__ITER}-${Date.now()}`, p_trigger: "manual" }),
      { ...hdr, tags: { kind: "cross" }, responseCallback: http.expectedStatuses(401, 403) });
    if (r.status === 200) crossLeak.add(1);
    check(r, { "cross-tenant refused": (x) => x.status === 403 || x.status === 401 });
    return;
  }
  const r = http.post(`${BASE}/rpc/integration_ingest`, JSON.stringify({ p_integration: me.integration, p_entity: "student", p_records: batch(__VU % 3), p_idempotency_key: `k-${__VU}-${__ITER}-${Date.now()}`, p_trigger: "schedule" }), { ...hdr, tags: { kind: "resync" } });
  check(r, { "resync 200": (x) => x.status === 200 });
}
