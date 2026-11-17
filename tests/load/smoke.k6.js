/**
 * Sherivs k6 smoke load test (mission M23, ADR-110). LOCAL TARGETS ONLY.
 *
 * Scenarios: public home (/), health endpoint (/health.json), sign-in page (/auth).
 * The target guard (./target-guard.js) refuses every host except localhost and 127.0.0.1 unless
 * K6_ALLOW_NON_LOCAL_HOST names the exact non-production host, and ALWAYS refuses sherivs.com,
 * app.sherivs.com, any other *.sherivs.com host and *.supabase.co.
 *
 * Run (see tests/load/README.md):
 *   k6 run tests/load/smoke.k6.js                                   # http://localhost:8080
 *   k6 run -e BASE_URL=http://127.0.0.1:8080 tests/load/smoke.k6.js
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { checkTarget } from "./target-guard.js";

const target = checkTarget(
  __ENV.BASE_URL || "http://localhost:8080",
  __ENV.K6_ALLOW_NON_LOCAL_HOST,
);
if (!target.ok) {
  // Thrown in the init context: k6 aborts before any request is sent.
  throw new Error(`load test refused: ${target.reason}`);
}
const BASE = target.origin;

const VUS = Number(__ENV.VUS || 5);
const DURATION = __ENV.DURATION || "30s";

export const options = {
  scenarios: {
    public_home: { executor: "constant-vus", exec: "publicHome", vus: VUS, duration: DURATION },
    health: { executor: "constant-vus", exec: "health", vus: VUS, duration: DURATION },
    sign_in_page: { executor: "constant-vus", exec: "signInPage", vus: VUS, duration: DURATION },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{scenario:public_home}": ["p(95)<1500"],
    "http_req_duration{scenario:health}": ["p(95)<800"],
    "http_req_duration{scenario:sign_in_page}": ["p(95)<1500"],
    checks: ["rate>0.99"],
  },
};

const PARAMS = { headers: { "User-Agent": "sherivs-k6-smoke" }, redirects: 0 };

export function publicHome() {
  const res = http.get(`${BASE}/`, PARAMS);
  check(res, {
    "home: 200": (r) => r.status === 200,
    "home: html": (r) => String(r.headers["Content-Type"] || "").includes("text/html"),
  });
  sleep(1);
}

// A local stack without a database answers 503 with a valid report; that is a correct answer,
// not a transport failure. Correctness of production health is the uptime probe's job.
const HEALTH_PARAMS = { ...PARAMS, responseCallback: http.expectedStatuses(200, 503) };

function hasChecksArray(body) {
  try {
    return Array.isArray(JSON.parse(body).checks);
  } catch (_error) {
    return false;
  }
}

export function health() {
  const res = http.get(`${BASE}/health.json`, HEALTH_PARAMS);
  check(res, {
    "health: 200 or 503": (r) => r.status === 200 || r.status === 503,
    "health: json with checks": (r) => hasChecksArray(r.body),
  });
  sleep(1);
}

export function signInPage() {
  const res = http.get(`${BASE}/auth`, PARAMS);
  check(res, { "sign-in: 200": (r) => r.status === 200 });
  sleep(1);
}
