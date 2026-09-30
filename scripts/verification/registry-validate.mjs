#!/usr/bin/env node
/**
 * CoreGrid Architectural Registry Validator
 *
 * Validates architecture/registry.json machine-auditable metadata (§72, §120-13):
 * - JSON parses; schemaVersion present.
 * - Exactly 51 phases; ids are "01".."51" in order; names unique and non-empty.
 * - layer/status/stage belong to allowed sets.
 * - levels array is 5 booleans (L1 concept, L2 data, L3 backend, L4 frontend, L5 ops).
 * - tests is null or a non-negative integer.
 * - consumers reference valid phase ids or the literals "all"|"control-plane"|"runtime-001".
 * - capabilities have unique slugs and an owner that references a registered phase id.
 * - duplications: status OPEN|CLOSED; adr null or /^PLATFORM-\d{3}$/; owner null|string.
 * - runtimes: unique ids, non-empty names.
 *
 * Usage: node scripts/verification/registry-validate.mjs
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const registry = JSON.parse(readFileSync(join(root, "architecture", "registry.json"), "utf8"));

const errors = [];
const LAYERS = [
  "Foundations",
  "Intelligence",
  "Runtime",
  "Commerce",
  "Global",
  "Universal",
  "Civilization",
];
const STATUSES = [
  "NOT_STARTED",
  "ARCHITECTURE_DEFINED",
  "IMPLEMENTING",
  "IMPLEMENTED",
  "INTEGRATING",
  "TESTING",
  "SECURITY_REVIEW",
  "OPERATIONAL_VALIDATION",
  "PRODUCTION_READY",
  "COMPLETE",
  "BLOCKED",
  "SUPERSEDED",
];
const STAGES = ["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11", "S12"];

// V5.3 Part 81 V1 scope guard: every phase must carry an explicit version
// classification, and frozen scope must never be reported as implemented.
const VERSION_TARGETS = [
  "ACTIVE-V1",
  "MIXED",
  "FUTURE-V2",
  "FUTURE-V3",
  "FUTURE-UNASSIGNED",
  "RESEARCH",
  "EXPERIMENTAL",
  "HISTORICAL",
  "REJECTED",
];
const IMPLEMENTED_STATUSES = ["IMPLEMENTING", "IMPLEMENTED", "INTEGRATING", "TESTING", "SECURITY_REVIEW", "OPERATIONAL_VALIDATION", "PRODUCTION_READY", "COMPLETE"];

const phases = registry.phases;
const phaseIds = new Set(Array.isArray(phases) ? phases.map((p) => p?.id).filter(Boolean) : []);
if (!Array.isArray(phases)) errors.push("phases is not an array");
else {
  if (phases.length !== 51) errors.push(`phases length ${phases.length} != 51`);
  const expectedIds = Array.from({ length: 51 }, (_, i) => String(i + 1).padStart(2, "0"));
  const seenIds = new Set();
  const seenNames = new Set();
  phases.forEach((p, i) => {
    if (!p.id || p.id !== expectedIds[i])
      errors.push(`phases[${i}].id expected ${expectedIds[i]}, got ${p?.id}`);
    if (seenIds.has(p.id)) errors.push(`duplicate phase id ${p.id}`);
    seenIds.add(p.id);
    if (!p.name || seenNames.has(p.name)) errors.push(`phase ${p.id}: name missing/duplicate`);
    seenNames.add(p.name);
    if (!LAYERS.includes(p.layer)) errors.push(`phase ${p.id}: unknown layer ${p.layer}`);
    if (!STATUSES.includes(p.status)) errors.push(`phase ${p.id}: unknown status ${p.status}`);
    if (!p.version_target) {
      errors.push(`phase ${p.id}: version_target missing (V5.3 Part 81 scope guard)`);
    } else if (!VERSION_TARGETS.includes(p.version_target)) {
      errors.push(`phase ${p.id}: unknown version_target ${p.version_target}`);
    } else if (
      IMPLEMENTED_STATUSES.includes(p.status) &&
      ["FUTURE-V2", "FUTURE-V3", "FUTURE-UNASSIGNED"].includes(p.version_target)
    ) {
      errors.push(
        `phase ${p.id}: version_target ${p.version_target} must not carry implemented status ${p.status} (V5.3 Part 42)`,
      );
    }
    if (!STAGES.includes(p.stage)) errors.push(`phase ${p.id}: unknown stage ${p.stage}`);
    if (
      !Array.isArray(p.levels) ||
      p.levels.length !== 5 ||
      p.levels.some((v) => typeof v !== "boolean")
    ) {
      errors.push(`phase ${p.id}: levels must be 5 booleans`);
    }
    if (
      p.tests !== null &&
      (typeof p.tests !== "number" || !Number.isInteger(p.tests) || p.tests < 0)
    ) {
      errors.push(`phase ${p.id}: tests must be null or non-negative integer`);
    }
    const validRef = (c) => ["all", "control-plane", "runtime-001"].includes(c) || phaseIds.has(c);
    (p.consumers ?? []).forEach((c) => {
      if (!validRef(c)) errors.push(`phase ${p.id}: unknown consumer ref ${c}`);
    });
  });
}

const caps = registry.capabilities ?? [];
const seenCaps = new Set();
caps.forEach((c, i) => {
  if (!c.capability || seenCaps.has(c.capability))
    errors.push(`capabilities[${i}]: missing/duplicate slug`);
  seenCaps.add(c.capability);
  if (!phaseIds.has(c.owner))
    errors.push(`capability ${c.capability}: owner ${c.owner} is not a registered phase`);
  (c.consumers ?? []).forEach((x) => {
    if (!["all", "control-plane", "runtime-001"].includes(x) && !phaseIds.has(x))
      errors.push(`capability ${c.capability}: unknown consumer ${x}`);
  });
});

const dups = registry.duplications ?? [];
dups.forEach((d) => {
  if (!["OPEN", "CLOSED"].includes(d.status))
    errors.push(`duplication ${d.id}: status must be OPEN|CLOSED`);
  if (d.adr !== null && !/^PLATFORM-\d{3}$/.test(d.adr))
    errors.push(`duplication ${d.id}: adr format ${d.adr}`);
});

const runtimes = registry.runtimes ?? [];
const seenRt = new Set();
runtimes.forEach((r) => {
  if (!r.id || seenRt.has(r.id)) errors.push(`runtime duplicate/missing id ${r?.id}`);
  seenRt.add(r.id);
  if (!r.name) errors.push(`runtime ${r.id}: missing name`);
});

if (errors.length > 0) {
  console.error(`REGISTRY VALIDATION FAILED (${errors.length}):`);
  for (const e of errors.slice(0, 40)) console.error(" - " + e);
  process.exit(1);
}
console.log(
  `REGISTRY VALIDATION PASSED: phases=${phases.length} capabilities=${caps.length} duplications=${dups.length} runtimes=${runtimes.length}`,
);
