// SHERIVS-100: SSR public site under load (1,000 VUs) across tenants by Host header. Local sim only.
// Usage: k6 run -e BASE=http://127.0.0.1:3400 tools/sim-lab/load/website-ssr.js
import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";
const leaks = new Counter("cross_tenant_leaks");
export const options = {
  scenarios: { ssr: { executor: "constant-vus", vus: 1000, duration: "60s" } },
  thresholds: { http_req_failed: ["rate<0.01"], cross_tenant_leaks: ["count==0"] },
};
const SITES = [
  ["www.littlepearls.sch.ng", "/", "Little Pearls"],
  ["gss-gwange.sherivs.com", "/", "Government Secondary School Gwange"],
  ["fuarewa.edu.ng", "/", "Federal University of Arewa"],
  ["fuarewa.edu.ng", "/pages/faculties?lang=ha", "Federal University of Arewa"],
  ["www.littlepearls.sch.ng", "/?school=fu-arewa", "Little Pearls"],
];
const NAMES = [
  "Little Pearls",
  "Government Secondary School Gwange",
  "Federal University of Arewa",
];
export default function () {
  const [host, path, name] = SITES[Math.floor(Math.random() * SITES.length)];
  const r = http.get(`${__ENV.BASE}${path}`, { headers: { Host: host }, tags: { host } });
  const title = (/<title>([^<]*)/.exec(r.body || "") || [])[1] || "";
  check(r, { 200: (x) => x.status === 200, "own org": () => title.includes(name) });
  if (NAMES.some((n) => n !== name && title.includes(n))) leaks.add(1);
}
