#!/usr/bin/env node
/**
 * CoreGrid — phase acceptance probe (archaeology instrumentation).
 *
 * A pasted phase document states acceptance criteria (§100 in Phase 01). This
 * script resolves each criterion against ACTUAL artefacts and classifies it:
 *
 *   ENFORCED       an executable artefact proves it (a test, verifier script,
 *                  migration, or a machine-checked contract with content match)
 *   DECLARED       a module, document or contract mentions it, but nothing
 *                  executable proves it yet
 *   MISSING        no artefact at all
 *
 * It implements no capability (Constitution Law 11): it only measures. Each phase
 * supplies its own data file, so phases 02–51 need no new code:
 *   architecture/phase-acceptance/phase-<id>-<slug>.json
 *
 * Gate semantics: a criterion marked `required: true` that classifies MISSING
 * fails the probe — a phase cannot be accepted while a mandatory area has no
 * evidence whatsoever. DECLARED is reported, never failed: an area with a module
 * but no executable proof is unfinished work, not a lie.
 *
 * Output: architecture/proofs/phase-<id>-acceptance.proof.json
 *
 * Usage: node scripts/audit-phase-acceptance.mjs --phase=01
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const phaseArg = (process.argv.find((arg) => arg.startsWith("--phase=")) ?? "").slice(
  "--phase=".length,
);
if (!phaseArg) {
  console.error("Usage: node scripts/audit-phase-acceptance.mjs --phase=01");
  process.exit(2);
}
const phaseId = phaseArg.padStart(2, "0");

const acceptanceDir = join(ROOT, "architecture", "phase-acceptance");
if (!existsSync(acceptanceDir)) {
  console.error(`No acceptance data found at ${relative(ROOT, acceptanceDir)}`);
  process.exit(2);
}
const dataFile = readdirSync(acceptanceDir).find(
  (name) => name.startsWith(`phase-${phaseId}-`) && name.endsWith(".json"),
);
if (!dataFile) {
  console.error(`No acceptance data for phase ${phaseId} (expected phase-${phaseId}-*.json)`);
  process.exit(2);
}

const data = JSON.parse(readFileSync(join(acceptanceDir, dataFile), "utf8"));
const proofRef = `architecture/proofs/phase-${phaseId}-acceptance.proof.json`;

/** Executable evidence kinds: these prove behaviour, not intent. */
const EXECUTABLE_KINDS = new Set(["test", "script", "migration", "policy", "config", "contract"]);

/**
 * A `boundary` entry proves the capability is actually INVOKED at a real
 * boundary (a call site in a server function, route, workflow or CI job). An area
 * whose implementation and tests exist but whose boundary patterns do not match
 * is classified IMPLEMENTED_UNWIRED: a library that protects nothing yet. That is
 * unfinished work, and it is reported rather than passed off as enforcement.
 */

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const REPO_FILES = [
  ...walk(join(ROOT, "frontend/src")),
  ...walk(join(ROOT, "tests")),
  ...walk(join(ROOT, "scripts")),
  ...walk(join(ROOT, "database")),
  ...walk(join(ROOT, "architecture")),
  ...walk(join(ROOT, "infrastructure")),
  ...walk(join(ROOT, "docs")),
  ...walk(join(ROOT, ".github")),
]
  .map((full) => relative(ROOT, full).replace(/\\/g, "/"))
  .sort();

const ROOT_FILES = readdirSync(ROOT).map((name) => name);

function resolveEvidence(entry) {
  const matches = REPO_FILES.filter((file) =>
    entry.path.includes("*")
      ? new RegExp(
          `^${entry.path.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
        ).test(file)
      : file === entry.path || file.startsWith(entry.path),
  );
  const rootMatch = ROOT_FILES.includes(entry.path);
  const resolved = matches.length > 0 || rootMatch;
  if (!resolved) return { ...entry, resolved: false, matched: false, hits: 0 };

  if (!entry.contains) return { ...entry, resolved: true, matched: true, hits: matches.length };

  const pattern = new RegExp(entry.contains, "i");
  const hits = matches.filter((file) => pattern.test(readFileSync(join(ROOT, file), "utf8")));
  return { ...entry, resolved: true, matched: hits.length > 0, hits: hits.length };
}

function classify(evidence, boundary) {
  const executable = evidence.filter((entry) => entry.matched && EXECUTABLE_KINDS.has(entry.kind));
  if (executable.length === 0) {
    return evidence.some((entry) => entry.matched) ? "DECLARED" : "MISSING";
  }
  // Declared boundary patterns mean the capability claims to be enforced where it
  // is used. If none of them match, the implementation exists but nothing calls it.
  if (boundary.length > 0 && !boundary.some((entry) => entry.matched)) {
    return "IMPLEMENTED_UNWIRED";
  }
  return "ENFORCED";
}

/* ── Evaluate every acceptance area ────────────────────────────────────────── */

const rows = (data.areas ?? []).map((area) => {
  const evidence = (area.evidence ?? []).map(resolveEvidence);
  const boundary = (area.boundary ?? []).map(resolveEvidence);
  return {
    id: area.id,
    area: area.area,
    requirement: area.requirement,
    required: area.required !== false,
    ownerPhase: area.ownerPhase ?? null,
    classification: classify(evidence, boundary),
    declaredEvidence: (area.evidence ?? []).map((entry) => entry.path),
    matchedEvidence: evidence.filter((entry) => entry.matched).map((entry) => entry.path),
    unresolvedEvidence: evidence.filter((entry) => !entry.resolved).map((entry) => entry.path),
    boundaryEvidence: boundary.filter((entry) => entry.matched).map((entry) => entry.path),
    declaredBoundary: (area.boundary ?? []).map((entry) => entry.path),
    evidence,
    boundary,
  };
});

const enforced = rows.filter((row) => row.classification === "ENFORCED");
const declared = rows.filter((row) => row.classification === "DECLARED");
const unwired = rows.filter((row) => row.classification === "IMPLEMENTED_UNWIRED");
const missing = rows.filter((row) => row.classification === "MISSING");
const missingRequired = missing.filter((row) => row.required);
const unresolvedPaths = [...new Set(rows.flatMap((row) => row.unresolvedEvidence))];

const proof = {
  artifact: "phase-acceptance",
  phase: phaseId,
  phaseName: data.phaseName ?? null,
  source: data.source ?? null,
  generatedAt: new Date().toISOString(),
  classificationDefinitions: {
    ENFORCED:
      "an executable artefact proves it (test, verifier script, migration, policy or machine-checked contract match) and, where a boundary is declared, a real call site invokes it",
    DECLARED: "a module, document or contract mentions it, but nothing executable proves it",
    IMPLEMENTED_UNWIRED:
      "implementation and tests exist, but the declared boundary patterns match nothing — the capability protects nothing yet",
    IMPLEMENTED_UNWIRED:
      "implementation and tests exist, but the declared boundary patterns match nothing — the capability protects nothing yet",
    MISSING: "no artefact found",
  },
  summary: {
    areas: rows.length,
    enforced: enforced.length,
    declared: declared.length,
    implementedUnwired: unwired.length,
    implementedUnwiredAreas: unwired.map((row) => row.id),
    implementedUnwired: unwired.length,
    implementedUnwiredAreas: unwired.map((row) => row.id),
    missing: missing.length,
    missingRequired: missingRequired.map((row) => row.id),
    unresolvedEvidencePaths: unresolvedPaths,
  },
  ownership: data.ownership ?? null,
  areas: rows.map((row) => ({
    id: row.id,
    area: row.area,
    requirement: row.requirement,
    required: row.required,
    ownerPhase: row.ownerPhase,
    classification: row.classification,
    declaredEvidence: row.declaredEvidence,
    matchedEvidence: row.matchedEvidence,
    unresolvedEvidence: row.unresolvedEvidence,
    declaredBoundary: row.declaredBoundary,
    boundaryEvidence: row.boundaryEvidence,
  })),
  ok: missingRequired.length === 0 && unresolvedPaths.length === 0,
  limitations: [
    "Classification measures the presence of executable evidence, not the correctness or completeness of that evidence.",
    "A DECLARED area is unfinished work, never a false claim — it is reported as such.",
    "An IMPLEMENTED_UNWIRED area has a tested implementation that no boundary calls; it is reported, never counted as enforcement.",
    "Evidence patterns are declared per phase in architecture/phase-acceptance/phase-<id>-*.json and must be reviewed when a phase is re-audited.",
  ],
};

mkdirSync(dirname(join(ROOT, proofRef)), { recursive: true });
writeFileSync(join(ROOT, proofRef), `${JSON.stringify(proof, null, 2)}\n`, "utf8");

/* ── Report ────────────────────────────────────────────────────────────────── */

console.log(
  `Phase ${phaseId}${proof.phaseName ? ` — ${proof.phaseName}` : ""}: ${rows.length} acceptance area(s) · ENFORCED ${enforced.length} · DECLARED ${declared.length} · UNWIRED ${unwired.length} · MISSING ${missing.length}`,
);
for (const row of rows) {
  const mark = row.classification === "ENFORCED" ? "ENFORCED" : row.classification;
  console.log(`  ${mark.padEnd(19)} ${row.id.padEnd(26)} ${row.area}`);
}
if (unwired.length > 0) {
  console.log(
    `\nImplemented and tested, but no boundary invokes it yet (${unwired.length}) — this is not enforcement:`,
  );
  for (const row of unwired) console.log(`  - ${row.id}: ${row.matchedEvidence.join(", ") || "—"}`);
}
if (declared.length > 0) {
  console.log(`\nDeclared but not yet proven by an executable artefact (${declared.length}):`);
  for (const row of declared)
    console.log(`  - ${row.id}: ${row.matchedEvidence.join(", ") || "—"}`);
}
if (missing.length > 0) {
  console.log(`\nNo evidence found (${missing.length}):`);
  for (const row of missing) console.log(`  - ${row.id}${row.required ? " [REQUIRED]" : ""}`);
}
if (unresolvedPaths.length > 0) {
  console.error(
    `\nEvidence paths declared but not present in the repository (${unresolvedPaths.length}):`,
  );
  for (const path of unresolvedPaths) console.error(`  - ${path}`);
}
console.log(`\nProof written: ${proofRef}`);

if (missingRequired.length > 0) {
  console.error(
    `\n${missingRequired.length} REQUIRED acceptance area(s) have no evidence — phase ${phaseId} cannot be accepted.`,
  );
  process.exit(1);
}
if (unresolvedPaths.length > 0) {
  console.error(
    `\n${unresolvedPaths.length} declared evidence path(s) do not exist — the acceptance data must be corrected.`,
  );
  process.exit(1);
}
console.log(
  "Every required acceptance area has evidence. DECLARED areas remain unfinished work and are reported as such.",
);
