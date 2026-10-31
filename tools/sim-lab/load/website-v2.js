// SHERIVS-101: website v2 under load (1,000 VUs): home, posts, RSS, robots, sitemap per tenant by Host. Local sim only.
// Usage: k6 run -e BASE=http://127.0.0.1:3400 tools/sim-lab/load/website-v2.js
import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";
const leaks = new Counter("cross_tenant_leaks");
export const options = {
  scenarios: { v2: { executor: "constant-vus", vus: 1000, duration: "60s" } },
  thresholds: { http_req_failed: ["rate<0.01"], cross_tenant_leaks: ["count==0"] },
};
const ORGS = {
  "www.littlepearls.sch.ng": "Little Pearls",
  "gss-gwange.sherivs.com": "Government Secondary School Gwange",
  "fuarewa.edu.ng": "Federal University of Arewa",
};
const HOSTS = Object.keys(ORGS);
// [host, path, expected status, must-contain]
const CASES = [
  ["www.littlepearls.sch.ng", "/", 200, "Little Pearls"],
  ["gss-gwange.sherivs.com", "/posts/waec-results-2026", 200, "WASSCE 2026"],
  ["fuarewa.edu.ng", "/posts/matriculation-2026", 200, "Federal University of Arewa"],
  ["fuarewa.edu.ng", "/?lang=ha", 200, "Federal University of Arewa"],
  ["gss-gwange.sherivs.com", "/rss.xml", 200, "Government Secondary School Gwange"],
  ["fuarewa.edu.ng", "/robots.txt", 200, "Sitemap: https://fuarewa.edu.ng/sitemap.xml"],
  ["www.littlepearls.sch.ng", "/sitemap.xml", 200, "https://www.littlepearls.sch.ng/"],
  // cross-tenant: another org's post slug must never render here
  ["www.littlepearls.sch.ng", "/posts/waec-results-2026", 200, "Little Pearls"],
];
export default function () {
  const [host, path, status, want] = CASES[Math.floor(Math.random() * CASES.length)];
  const r = http.get(`${__ENV.BASE}${path}`, { headers: { Host: host }, tags: { host, path } });
  const body = r.body || "";
  check(r, { status: (x) => x.status === status, "own org": () => body.includes(want) });
  for (const h of HOSTS)
    if (h !== host && (body.includes(ORGS[h]) || body.includes(`https://${h}/`))) leaks.add(1);
  if (host === "www.littlepearls.sch.ng" && body.includes("WASSCE 2026")) leaks.add(1);
}
