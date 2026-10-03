#!/usr/bin/env node
/**
 * H3-090 (Verify Budget Engineer) — verify-chain runtime census and budget
 * policy reporter.
 *
 * Produces, on stdout, a static census of the `npm run verify` chain read
 * READ-ONLY from package.json, plus a test-count / runtime-budget table
 * derived from a filesystem census of the vitest test surface.
 *
 * HARD BOUNDS (H3 wave campaign law):
 *   - OFFLINE only: no network, no database, no credential access.
 *   - NO test execution: this script never spawns vitest/tsc/vite/npm. It
 *     reads package.json and walks tests/ counting files and test-call
 *     sites (a `vitest list`-style enumeration without booting vitest).
 *   - READ-ONLY: nothing under package.json or any other file is modified.
 *
 * The census is INTENTIONALLY conservative: runtime figures are budget
 * classes (S/M/L), not measurements. No timing claim in the output was
 * produced by executing a step.
 *
 * Exit codes: 0 = census produced; 1 = repo state unreadable (package.json
 * missing or unparseable, tests/ walk failed).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// ---------------------------------------------------------------------------
// Step 1 — read the verify chain READ-ONLY from package.json
// ---------------------------------------------------------------------------
let packageJson;
try {
  packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
} catch (error) {
  console.error("verify-budget: package.json unreadable:", error.message);
  process.exit(1);
}

const verifyScript = typeof packageJson.scripts?.verify === "string" ? packageJson.scripts.verify : null;
if (!verifyScript) {
  console.error("verify-budget: package.json has no `verify` script; nothing to census.");
  process.exit(1);
}

// The chain is an `&&`-joined list of `npm run <name>` / `node <file>` steps.
const chainCommands = verifyScript.split("&&").map((s) => s.trim()).filter(Boolean);

// ---------------------------------------------------------------------------
// Step 2 — static cost classification and census descriptions
// ---------------------------------------------------------------------------

/**
 * Cost classes (budget policy, not measurements):
 *   S = cheap static verifier, budget <= 10s
 *   M = medium single-process step, budget <= 180s
 *   L = heavy step (typecheck / full unit suite / build), budget <= 600s
 */
const STEP_CENSUS = {
  typecheck: {
    what: "TypeScript whole-repo type check (`tsc --noEmit`). No emit; correctness gate for the entire chain.",
    costClass: "L",
    budget: "<= 180s",
    heavy: true,
  },
  "test:unit": {
    what: "Full vitest unit+failure suite (`vitest run`, include: tests/**/*.test.{ts,tsx}). Internally parallel workers; the largest CPU consumer in the chain.",
    costClass: "L",
    budget: "<= 600s",
    heavy: true,
  },
  "verify:registry": {
    what: "Validates architecture/registry.json machine metadata: 51 phases, unique ids/names, allowed layer/status sets, capabilities and runtimes (scripts/verification/registry-validate.mjs).",
    costClass: "S",
    budget: "<= 10s",
    heavy: false,
  },
  "verify:drift": {
    what: "Compares the declared registry state against the governed evolution baseline plus the recorded drift declaration; undeclared drift fails (scripts/verify-registry-drift.mjs).",
    costClass: "S",
    budget: "<= 10s",
    heavy: false,
  },
  "verify:neutrality": {
    what: "Domain-neutrality guard over lib root files, kernel/phase-contracts, and migrations; fails on new violations, warns on shrink-only baseline entries (scripts/verify-domain-neutrality.mjs).",
    costClass: "S",
    budget: "<= 10s",
    heavy: false,
  },
  "verify:secrets": {
    what: "Secrets scanner over git-tracked files for secret-shaped material; fails on committed secret values (scripts/verification/secret-scan.mjs). Shells out to `git ls-files` only.",
    costClass: "S",
    budget: "<= 10s",
    heavy: false,
  },
  build: {
    what: "Production frontend build (`vite build`). Heaviest single step; CPU- and IO-bound, internally parallelized by the bundler.",
    costClass: "L",
    budget: "<= 300s",
    heavy: true,
  },
};

function classifyStep(stepName, rawCommand) {
  const census = STEP_CENSUS[stepName];
  if (census) return { stepName, rawCommand, ...census, described: true };

  // Fallback classification by command shape for steps added later
  // (provenance: derived from package.json at runtime, description generic).
  const cmd = rawCommand ?? "";
  if (cmd.includes("vitest")) {
    return { stepName, rawCommand, what: "(vitest-based step; not yet in the census map)", costClass: "L", budget: "<= 600s", heavy: true, described: false };
  }
  if (cmd.includes("tsc")) {
    return { stepName, rawCommand, what: "(TypeScript compiler step; not yet in the census map)", costClass: "L", budget: "<= 180s", heavy: true, described: false };
  }
  if (cmd.includes("vite build") || cmd.includes("vite &&")) {
    return { stepName, rawCommand, what: "(bundler build step; not yet in the census map)", costClass: "L", budget: "<= 300s", heavy: true, described: false };
  }
  return { stepName, rawCommand, what: "(static node verifier; not yet in the census map)", costClass: "S", budget: "<= 10s", heavy: false, described: false };
}

const chain = chainCommands.map((cmd) => {
  const npmRun = cmd.match(/^npm\s+run\s+(\S+)$/);
  const stepName = npmRun ? npmRun[1] : cmd;
  const rawStepCommand = npmRun ? packageJson.scripts[stepName] ?? cmd : cmd;
  return classifyStep(stepName, rawStepCommand);
});

// ---------------------------------------------------------------------------
// Step 3 — parallelization analysis (static, from the step census)
// ---------------------------------------------------------------------------
const heavySteps = chain.filter((s) => s.heavy).map((s) => s.stepName);
const cheapSteps = chain.filter((s) => !s.heavy).map((s) => s.stepName);

// Serial wall-clock budget = sum of per-step budgets (upper bounds).
const budgetSeconds = { S: 10, M: 180, L: 600, build: 300 };
const serialBudget = chain.reduce((total, step) => {
  const cap = step.stepName === "build" ? budgetSeconds.build : budgetSeconds[step.costClass] ?? 0;
  return total + cap;
}, 0);
const serialBudgetMin = (serialBudget / 60).toFixed(1);

// Parallelized policy: heavy steps stay sequential (CPU contention), the
// cheap static verifiers run concurrently after the last heavy gate.
const heavySerialBudget = chain
  .filter((s) => s.heavy)
  .reduce((t, s) => t + (s.stepName === "build" ? budgetSeconds.build : budgetSeconds[s.costClass] ?? 0), 0);
const parallelBudget = heavySerialBudget + budgetSeconds.S;
const parallelBudgetMin = (parallelBudget / 60).toFixed(1);

// ---------------------------------------------------------------------------
// Step 4 — test census (filesystem enumeration; `vitest list`-style,
// zero-execution). Vitest include per vitest.config.ts:
// tests/**/*.test.{ts,tsx}
// ---------------------------------------------------------------------------
const TESTS_DIR = join(ROOT, "tests");
const VITEST_INCLUDE_RE = /\.test\.(ts|tsx)$/;
const TEST_CALL_RE = /\b(?:it|test)\s*(?:\.\w+)?\s*\(/g;

function walkTestFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTestFiles(full));
    else if (entry.isFile() && VITEST_INCLUDE_RE.test(entry.name)) out.push(full);
  }
  return out;
}

const allTestFiles = walkTestFiles(TESTS_DIR);
const suites = new Map(); // suite label -> { files, callSites }
for (const file of allTestFiles) {
  const rel = relative(TESTS_DIR, file);
  const suite = rel.split(sep)[0];
  const record = suites.get(suite) ?? { files: 0, callSites: 0 };
  record.files += 1;
  try {
    const source = readFileSync(file, "utf8");
    record.callSites += (source.match(TEST_CALL_RE) ?? []).length;
  } catch {
    // unreadable file: still counted, call-site estimate degrades honestly
  }
  suites.set(suite, record);
}

const e2eSpecs = (() => {
  const e2eDir = join(TESTS_DIR, "e2e");
  if (!statSyncSafeIsDir(e2eDir)) return 0;
  return readdirSync(e2eDir).filter((f) => f.endsWith(".spec.ts")).length;
})();

function statSyncSafeIsDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

const SUITE_NOTES = {
  unit: "in vitest chain (`npm run test:unit`)",
  failure: "in vitest chain (`npm run test:unit`); adversarial/failure-path suite",
  integration: "in vitest include but credentials-gated (`describe.skipIf(!enabled)`); skips offline, so contributes 0 runtime to the offline budget",
  e2e: "playwright specs; NOT part of the vitest verify chain (excluded from the budget)",
};

// ---------------------------------------------------------------------------
// Step 5 — emit census (markdown, exit 0)
// ---------------------------------------------------------------------------
const lines = [];
lines.push("# Verify Budget Census (H3-090)");
lines.push("");
lines.push(`Generated by \`node scripts/verify-budget.mjs\` — offline, read-only, zero test execution.`);
lines.push("");
lines.push("## Verify chain (`npm run verify`, read READ-ONLY from package.json)");
lines.push("");
lines.push("Chain: `" + verifyScript + "`");
lines.push("");
lines.push("| # | Step | Command | What it does | Cost class | Runtime budget | Parallelizable with |");
lines.push("|---|------|---------|--------------|------------|----------------|---------------------|");
chain.forEach((step, i) => {
  const parallelWith = step.heavy
    ? "nothing (keep sequential — CPU-heavy)"
    : "other cheap static verifiers: " + cheapSteps.filter((n) => n !== step.stepName).join(", ");
  lines.push(`| ${i + 1} | \`${step.stepName}\` | \`${step.rawCommand}\` | ${step.what} | ${step.costClass} | ${step.budget} | ${parallelWith} |`);
});
lines.push("");
lines.push(`Cost classes: S <= 10s (cheap static verifier), L = heavy step (typecheck / full unit suite / build).`);
lines.push("");
lines.push("## Parallelization policy");
lines.push("");
lines.push(`- As declared, the chain is strictly sequential (\`&&\`) — no step parallelizes.`);
lines.push(`- Cheap static verifiers (${cheapSteps.map((s) => `\`${s}\``).join(", ")}) are mutually independent and may run concurrently once the typecheck gate passes.`);
lines.push(`- Heavy steps (${heavySteps.map((s) => `\`${s}\``).join(", ")}) must stay sequential: each is CPU-saturating and running them concurrently degrades both participants.`);
lines.push(`- Serial chain wall-clock budget: ~${serialBudget}s (~${serialBudgetMin} min).`);
lines.push(`- Parallelized wall-clock budget: ~${parallelBudget}s (~${parallelBudgetMin} min).`);
lines.push("");
lines.push("## Test-count / runtime-budget table");
lines.push("");
lines.push("Call-site counts are static upper-bound estimates (`it(`/`test(` occurrences incl. `.each` variants); they are not collected test counts and were not produced by running vitest.");
lines.push("");
lines.push("| Suite | Test files | Test-call sites (est.) | In verify chain? | Runtime budget | Note |");
lines.push("|-------|-----------:|-----------------------:|------------------|----------------|------|");
for (const [suite, record] of [...suites.entries()].sort()) {
  const inChain = suite === "integration" ? "yes (skips offline)" : suite === "e2e" ? "no (not a vitest surface)" : "yes";
  const budget = suite === "e2e" ? "n/a" : suite === "unit" ? "<= 600s total" : "<= 60s";
  lines.push(`| \`${suite}\` | ${record.files} | ${record.callSites} | ${inChain} | ${budget} | ${SUITE_NOTES[suite] ?? ""} |`);
}
lines.push(`| e2e (playwright specs) | ${e2eSpecs} | n/a | no | n/a | run via \`npm run test:e2e\` only; never part of \`npm run verify\` |`);
lines.push("");
lines.push(`Total vitest-surface files: ${allTestFiles.length}.`);
lines.push("");
lines.push("## Budget policy");
lines.push("");
lines.push("1. A verify-chain step exceeding its runtime budget is an incident to triage, not a reason to weaken tests.");
lines.push("2. The unit-suite budget (<= 600s) is protected by the vitest per-test timeout of 30s (vitest.config.ts).");
lines.push("3. New cheap static verifiers must stay in class S (<= 10s) or be moved out of the serial verify chain.");
lines.push("4. Offline guarantee: `npm run verify` must complete with no database and no network; the only credentials-gated test in the vitest include (`tests/integration/foundation-loop.live.test.ts`) skips itself when credentials are absent.");

console.log(lines.join("\n"));
process.exit(0);