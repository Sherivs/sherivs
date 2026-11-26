// A7 (issue #465): turns the sim scenario results into a gate that fails closed.
//  - the results file must exist, parse and contain at least baseline.min_total scenarios (nothing silently dropped);
//  - a scenario that fails and is not in the baseline is a regression: the gate fails;
//  - a baseline entry that now passes, or no longer exists, makes the gate fail until it is removed (the list only shrinks);
//  - duplicate scenario names in the results are refused (a name must identify one scenario).
// Usage: node sim/scenario-ratchet.mjs [results.json] [baseline.json]
import fs from "node:fs";

export function evaluate(results, baseline) {
  const problems = [];
  if (!Array.isArray(results) || results.length === 0) {
    return { ok: false, problems: ["no scenario results"], regressions: [], stale: [] };
  }
  if (
    !baseline ||
    !Array.isArray(baseline.known_failing) ||
    !Number.isInteger(baseline.min_total)
  ) {
    return { ok: false, problems: ["baseline is malformed"], regressions: [], stale: [] };
  }
  const key = (r) => `${r.area} :: ${r.name}`;
  const seen = new Set();
  for (const r of results) {
    if (typeof r.area !== "string" || typeof r.name !== "string" || typeof r.pass !== "boolean") {
      problems.push("a scenario result is malformed");
      break;
    }
    if (seen.has(key(r))) problems.push(`duplicate scenario name: ${key(r)}`);
    seen.add(key(r));
  }
  if (results.length < baseline.min_total) {
    problems.push(
      `only ${results.length} scenarios ran, the baseline requires at least ${baseline.min_total}`,
    );
  }
  const known = new Set(baseline.known_failing);
  const failing = new Set(results.filter((r) => !r.pass).map(key));
  const regressions = [...failing].filter((k) => !known.has(k)).sort();
  const stale = [...known].filter((k) => !failing.has(k)).sort();
  for (const k of regressions) problems.push(`new failure: ${k}`);
  for (const k of stale) {
    problems.push(
      seen.has(k)
        ? `now passes, remove from the baseline: ${k}`
        : `no longer exists, remove from the baseline: ${k}`,
    );
  }
  return { ok: problems.length === 0, problems, regressions, stale };
}

const invokedDirectly =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");
if (invokedDirectly) {
  const resultsPath = process.argv[2] ?? "sim/scenario-results.json";
  const baselinePath = process.argv[3] ?? "sim/scenario-baseline.json";
  let verdict;
  try {
    verdict = evaluate(
      JSON.parse(fs.readFileSync(resultsPath, "utf8")),
      JSON.parse(fs.readFileSync(baselinePath, "utf8")),
    );
  } catch (e) {
    verdict = { ok: false, problems: [`could not read inputs: ${e.message}`] };
  }
  if (!verdict.ok) {
    console.error("Scenario ratchet FAILED:");
    for (const p of verdict.problems) console.error("  - " + p);
    process.exit(1);
  }
  console.log("Scenario ratchet ok: no new failures, no stale baseline entries.");
}
