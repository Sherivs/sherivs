// Pure evaluation for the CI npm audit gate. Fails on any high or critical advisory
// unless that exact advisory id has an unexpired, approved exception. Expired
// exceptions fail the gate on their own, so an exception can never outlive its date.

const BLOCKING = new Set(["high", "critical"]);
const GHSA = /GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function advisoryId(via) {
  const match = typeof via?.url === "string" ? via.url.match(GHSA) : null;
  return match ? match[0] : null;
}

export function validateExceptions(config) {
  const problems = [];
  const list = Array.isArray(config?.exceptions) ? config.exceptions : null;
  if (!list) return { list: [], problems: ["exceptions file has no exceptions array"] };
  for (const e of list) {
    if (!e || typeof e.id !== "string" || !GHSA.test(e.id) || e.id !== e.id.match(GHSA)[0])
      problems.push(`exception has an invalid advisory id: ${JSON.stringify(e?.id)}`);
    if (typeof e?.expires !== "string" || !DATE.test(e.expires))
      problems.push(`exception ${e?.id} has no valid expires date (YYYY-MM-DD)`);
    for (const field of ["reason", "evidence", "approval"]) {
      if (typeof e?.[field] !== "string" || e[field].trim().length < 10)
        problems.push(`exception ${e?.id} is missing ${field}`);
    }
  }
  return { list, problems };
}

/** @returns {{ ok: boolean, blocking: string[], excepted: string[], problems: string[] }} */
export function evaluateAudit(report, config, now = new Date()) {
  const { list, problems } = validateExceptions(config);
  const today = now.toISOString().slice(0, 10);
  const active = new Map();
  for (const e of list) {
    if (typeof e?.expires === "string" && DATE.test(e.expires) && today > e.expires) {
      problems.push(
        `exception ${e.id} expired on ${e.expires}; fix the advisory or get a new approval`,
      );
    } else if (typeof e?.id === "string") {
      active.set(e.id, e);
    }
  }
  if (
    !report ||
    typeof report !== "object" ||
    typeof report.vulnerabilities !== "object" ||
    report.vulnerabilities === null
  ) {
    problems.push("npm audit report is missing or unreadable (failing closed)");
    return { ok: false, blocking: [], excepted: [], problems };
  }
  const blocking = new Set();
  const excepted = new Set();
  for (const [name, vuln] of Object.entries(report.vulnerabilities)) {
    for (const via of Array.isArray(vuln?.via) ? vuln.via : []) {
      if (typeof via !== "object" || via === null) continue; // transitive pointer, judged at its source
      if (!BLOCKING.has(via.severity)) continue;
      const id = advisoryId(via);
      if (id && active.has(id)) excepted.add(id);
      else
        blocking.add(
          `${id ?? via.url ?? "unknown-advisory"} (${via.severity}, ${via.name ?? name})`,
        );
    }
  }
  const counted =
    (report.metadata?.vulnerabilities?.high ?? 0) +
    (report.metadata?.vulnerabilities?.critical ?? 0);
  if (counted > 0 && blocking.size === 0 && excepted.size === 0) {
    problems.push(
      "high or critical vulnerabilities reported without advisory detail (failing closed)",
    );
  }
  return {
    ok: blocking.size === 0 && problems.length === 0,
    blocking: [...blocking].sort(),
    excepted: [...excepted].sort(),
    problems,
  };
}
