#!/usr/bin/env node
/**
 * CoreGrid registry drift hook (MISSION-R-04 / J-038).
 *
 * Compares the machine-operable registry's declared state against the
 * governed evolution baseline (architecture/COREGRID_EVOLUTION_BASELINE_2026-09-30.json)
 * plus the recorded drift declaration
 * (scripts/verification/registry-drift-declaration.json).
 *
 * Law: drift never authorizes change by itself (baseline evolutionLaw). Any
 * difference between the declared registry state and the recorded state is
 * FAILED unless it is explicitly declared in the drift declaration with a
 * recorded authority — undeclared drift fails CI; declared drift passes with
 * the record attached.
 *
 * Usage: node scripts/verify-registry-drift.mjs   (wired as npm run verify:drift)
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(readFileSync(join(root, "architecture", "registry.json"), "utf8"));
const baseline = JSON.parse(
  readFileSync(join(root, "architecture", "COREGRID_EVOLUTION_BASELINE_2026-09-30.json"), "utf8"),
);
const declaration = JSON.parse(
  readFileSync(join(root, "scripts", "verification", "registry-drift-declaration.json"), "utf8"),
);

const problems = [];
const notes = [];
const declared = declaration.declaredState ?? {};

const isDeclared = (dimension) =>
  Array.isArray(declaration.driftRecords) &&
  declaration.driftRecords.some((r) => r.dimension === dimension);

// 1. baseline-recorded counts (phases, capabilities, runtimes).
const baselineRegistry = (baseline.baseline && baseline.baseline.registry) ?? {};
const countChecks = [
  ["phases", (r) => r.phases.length],
  ["capabilities", (r) => (r.capabilities ?? []).length],
  ["runtimes", (r) => (r.runtimes ?? []).length],
];
for (const [dimension, read] of countChecks) {
  const actual = read(registry);
  const recorded = baselineRegistry[dimension];
  if (recorded === undefined) {
    problems.push(`baseline does not record ${dimension} — extend the baseline or the hook`);
    continue;
  }
  if (actual === recorded) continue;
  if (isDeclared(dimension)) {
    notes.push(`${dimension}: ${actual} vs baseline ${recorded} — drift explicitly declared (see registry-drift-declaration.json)`);
  } else {
    problems.push(`UNDECLARED DRIFT: ${dimension} is ${actual}, baseline records ${recorded} — declare it in scripts/verification/registry-drift-declaration.json with authority, or revert`);
  }
}

// 2. status histogram (anchored in the drift declaration at the COND-012
//    reconciliation; any later status change must be declared there).
const histogram = {};
for (const p of registry.phases) histogram[p.status] = (histogram[p.status] ?? 0) + 1;
const declaredHistogram = declared.statusHistogram ?? {};
const dimensions = new Set([...Object.keys(histogram), ...Object.keys(declaredHistogram)]);
for (const status of dimensions) {
  const actual = histogram[status] ?? 0;
  const recorded = declaredHistogram[status] ?? 0;
  if (actual === recorded) continue;
  if (isDeclared(`statusHistogram.${status}`)) {
    notes.push(`statusHistogram.${status}: ${actual} vs declared ${recorded} — drift explicitly declared`);
  } else {
    problems.push(
      `UNDECLARED DRIFT: statusHistogram.${status} is ${actual}, declared ${recorded} — update scripts/verification/registry-drift-declaration.json (statusHistogram + a driftRecord naming the authority)`,
    );
  }
}

// 3. capability ids (the declared capability set is load-bearing: consumers,
//    ownership and the V1 capability catalog hang off it).
const actualIds = (registry.capabilities ?? []).map((c) => c.capability).sort();
const declaredIds = [...(declared.capabilityIds ?? [])].sort();
const added = actualIds.filter((id) => !declaredIds.includes(id));
const removed = declaredIds.filter((id) => !actualIds.includes(id));
if (added.length === 0 && removed.length === 0) {
  // state matches the declaration
} else if (isDeclared("capabilityIds")) {
  notes.push(`capabilityIds changed (added: ${added.join(",") || "none"}; removed: ${removed.join(",") || "none"}) — drift explicitly declared`);
} else {
  problems.push(
    `UNDECLARED DRIFT: capability ids changed (added: ${added.join(", ") || "none"}; removed: ${removed.join(", ") || "none"}) — update scripts/verification/registry-drift-declaration.json (capabilityIds + a driftRecord naming the authority)`,
  );
}

// 4. the declaration itself must stay honest: its counts must match the
//    registry it declares (a stale declaration is drift, too).
for (const [dimension, read] of countChecks) {
  if (declared[dimension] === undefined) continue;
  if (declared[dimension] !== read(registry)) {
    problems.push(
      `STALE DECLARATION: declaredState.${dimension} is ${declared[dimension]} but the registry declares ${read(registry)} — regenerate the declaration`,
    );
  }
}

if (problems.length > 0) {
  console.error(`REGISTRY DRIFT CHECK FAILED (${problems.length}):`);
  for (const p of problems) console.error(" - " + p);
  process.exit(1);
}
console.log(
  `REGISTRY DRIFT CHECK PASSED: phases=${registry.phases.length} capabilities=${registry.capabilities.length} runtimes=${registry.runtimes.length} statuses=${Object.entries(histogram).map(([k, v]) => `${k} ${v}`).join(", ")} — matches COREGRID_EVOLUTION_BASELINE_2026-09-30 + declared drift`,
);
for (const n of notes) console.log("  note: " + n);
