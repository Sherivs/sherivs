// SHERIVS-100 k6: anonymous public site reads at PEAK VUs across all schools via PostgREST, plus cross-tenant
// probes (host of one school + slug of another; admin of one school writing another's site) and admin draft saves.
// BASE=http://127.0.0.1:3371 PEAK=1000 k6 run website.js
import http from "k6/http"; import { check } from "k6"; import { Counter } from "k6/metrics"; import { SharedArray } from "k6/data";
const schools = new SharedArray("s", () => JSON.parse(open("./website-tokens.json")));
const BASE = __ENV.BASE || "http://127.0.0.1:3371"; const PEAK = +(__ENV.PEAK || 1000);
const leaked = new Counter("cross_tenant_leak"); const accepted = new Counter("cross_tenant_write_accepted");
export const options = {
  scenarios: { site: { executor: "ramping-vus", stages: [{ duration: "20s", target: PEAK }, { duration: "60s", target: PEAK }, { duration: "10s", target: 0 }] } },
  thresholds: { http_req_failed: ["rate<0.01"], "http_req_duration{kind:public}": ["p(95)<1000"], cross_tenant_leak: ["count==0"], cross_tenant_write_accepted: ["count==0"] },
};
const J = { "Content-Type": "application/json" };
export default function () {
  const i = Math.floor(Math.random() * schools.length); // index, not indexOf: SharedArray items are copies
  const s = schools[i];
  const r = Math.random();
  if (r < 0.85) {
    const viaHost = s.host && Math.random() < 0.5;
    const res = http.post(`${BASE}/rpc/website_public`, JSON.stringify(viaHost ? { p_host: s.host } : { p_slug: s.slug }), { headers: J, tags: { kind: "public" } });
    const body = res.json();
    const ok = check(res, { "public 200": (x) => x.status === 200, "right school": () => body && body.data && body.data.school.slug === s.slug,
      "published doc iff published": () => (body.document !== null) === s.published });
    if (res.status === 200 && body && body.data && body.data.school.slug !== s.slug) leaked.add(1);
    // every news title is prefixed with its own school's slug: any other prefix is a cross-tenant leak
    if (res.status === 200 && body && body.data && (body.data.news || []).some((n) => !n.title.startsWith(`${s.slug} `))) leaked.add(1);
    void ok;
  } else if (r < 0.95) {
    const other = schools[(i + 1 + Math.floor(Math.random() * (schools.length - 1))) % schools.length];
    if (other.school === s.school) throw new Error("probe picked own school");
    if (s.host) {
      const res = http.post(`${BASE}/rpc/website_public`, JSON.stringify({ p_host: s.host, p_slug: other.slug }), { headers: J, tags: { kind: "probe" } });
      const b = res.json(); if (!check(res, { "host wins over slug": () => b && b.data.school.slug === s.slug })) leaked.add(1);
    }
    const w = http.post(`${BASE}/rpc/website_publish`, JSON.stringify({ p_school: other.school, p_note: "hijack" }),
      { headers: { ...J, Authorization: `Bearer ${s.t}` }, tags: { kind: "probe" }, responseCallback: http.expectedStatuses(400, 401, 403) });
    if (w.status === 200) accepted.add(1);
    check(w, { "cross-tenant publish refused": (x) => x.status !== 200 });
  } else {
    const H = { headers: { ...J, Authorization: `Bearer ${s.t}` }, tags: { kind: "admin" } };
    const g = http.post(`${BASE}/rpc/website_get`, JSON.stringify({ p_school: s.school }), H);
    check(g, { "admin get 200": (x) => x.status === 200 });
  }
}
