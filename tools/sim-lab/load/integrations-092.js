// SHERIVS-092 k6: 1,000 VUs of school admins syncing results, invoices and payments through PostgREST
// (real JWT + RLS), one admin per school as the scheduler would run it (SCHOOLS=1000 in setup), half the schools with outbound triggers live, plus 10% cross-tenant attempts that MUST fail.
import http from "k6/http"; import { check } from "k6"; import { Counter } from "k6/metrics";
const tokens = JSON.parse(open("./integ92-tokens.json"));
const BASE = __ENV.BASE || "http://127.0.0.1:3300";
const crossLeak = new Counter("cross_tenant_write_accepted");
export const options = {
  scenarios: { mix: { executor: "ramping-vus", stages: [{ duration: "20s", target: +(__ENV.PEAK || 1000) }, { duration: "40s", target: +(__ENV.PEAK || 1000) }, { duration: "10s", target: 0 }] } },
  thresholds: { http_req_failed: ["rate<0.01"], cross_tenant_write_accepted: ["count==0"], "http_req_duration{kind:sync}": ["p(95)<2000"] },
};
const SUBJECTS = ["Mathematics", "English", "Basic Science"];
function body(kind) {
  if (kind === "result") return Array.from({ length: 20 }, (_, k) => ({ external_id: `G-${__VU % 3}-${k}`, data: { student_external_id: `S${k}`, subject: SUBJECTS[__VU % 3], term: "First Term", academic_year: "2025/2026", ca_score: 20 + (k % 10), exam_score: 40 + (__ITER % 5) } }));
  if (kind === "payment") return [{ external_id: `P-${__VU}-${__ITER}`, data: { invoice_external_id: `INV${__ITER % 20}`, amount_naira: 100, reference: `REF-${__VU}-${__ITER}`, channel: "pos" } }];
  return Array.from({ length: 20 }, (_, k) => ({ external_id: `INV${k}`, data: { student_external_id: `S${k}`, amount_naira: 500000, term: "First Term", academic_year: "2025/2026" } }));
}
export default function () {
  const me = tokens[(__VU - 1) % tokens.length];
  const hdr = { headers: { Authorization: `Bearer ${me.t}`, "Content-Type": "application/json" } };
  const kind = ["result", "result", "fee_invoice", "payment"][__ITER % 4];
  if (Math.random() < 0.1) {
    const other = tokens[(__VU + 7) % tokens.length];
    const r = http.post(`${BASE}/rpc/integration_ingest`, JSON.stringify({ p_integration: other.integration, p_entity: kind, p_records: body(kind), p_idempotency_key: `x-${__VU}-${__ITER}-${Date.now()}`, p_trigger: "manual" }),
      { ...hdr, tags: { kind: "cross" }, responseCallback: http.expectedStatuses(401, 403) });
    if (r.status === 200) crossLeak.add(1);
    check(r, { "cross-tenant refused": (x) => x.status === 403 || x.status === 401 });
    return;
  }
  const r = http.post(`${BASE}/rpc/integration_ingest`, JSON.stringify({ p_integration: me.integration, p_entity: kind, p_records: body(kind), p_idempotency_key: `k-${__VU}-${__ITER}-${Date.now()}`, p_trigger: "schedule" }), { ...hdr, tags: { kind: "sync", entity: kind } });
  check(r, { "sync 200": (x) => x.status === 200 });
}
