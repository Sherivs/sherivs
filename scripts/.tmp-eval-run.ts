import { workforceRoster, } from "../frontend/src/lib/workforce-charter/roster";
import { evaluateWorkforce, validateSuiteCoverage } from "../frontend/src/lib/workforce-eval/eval-run";
import { referenceResponder } from "../frontend/src/lib/workforce-eval/eval-case";
const roster = workforceRoster();
const w = evaluateWorkforce(roster, referenceResponder);
const cov = validateSuiteCoverage(roster);
console.log(JSON.stringify({ agents: w.agents.length, suites: w.suites, graded: w.graded, ungraded: w.ungraded, criticalFailures: w.criticalFailures, suitesBelowBar: w.suitesBelowBar.length, coverageProblems: cov.length, ceilings: Object.entries(w.agents.reduce((m: Record<string, number>, a) => ((m[a.ceiling] = (m[a.ceiling] ?? 0) + 1), m), {})) }));
