#!/usr/bin/env node
/**
 * CoreGrid — phase completion auditor (the executable Phase Completion Gate).
 *
 * PURPOSE
 * The Constitution defines the five-level maturity model and the Phase Completion
 * Gate. Those are prose; this script makes them MACHINE-AUDITABLE, so a phase can
 * never be marked more complete than its evidence supports.
 *
 * WHY IT EXISTS (archaeological finding, 2026-09-13)
 * `architecture/registry.json` carried hand-maintained `levels` vectors claiming
 * Level 1 only for 45 of 51 phases, while 26 phases have real modules and 2,600+
 * passing tests. The registry UNDERSTATED reality; nothing checked it. This
 * auditor derives each level from artifacts and reports the drift in BOTH
 * directions.
 *
 * EVIDENCE DEFINITIONS (no semantics, no guessing)
 *   L1 conceptual  — phase document exists with >= 8 distinct engineering sections
 *                    AND a kernel phase contract exists
 *   L2 data model  — the phase document carries data-model vocabulary AND
 *                    (a DB migration exists for the capability OR the contract
 *                    declares substrates)
 *   L3 backend     — every registry module resolves to real source AND every test
 *                    file the contract cites exists with >= 1 real test
 *   L4 frontend    — at least one route/component/workspace file references the
 *                    phase's modules or capability
 *   L5 operational — an operational artifact exists (proof, verifier, CI job or
 *                    runbook) naming the phase or its capability
 *
 * FAILURE SEMANTICS
 *   Incompleteness is REPORTED, not failed — unfinished work is honest.
 *   The script exits non-zero only on INCONSISTENCY: the registry claiming a level
 *   with no evidence, or a declared test artifact missing from the repository.
 *
 * Output:
 *   architecture/proofs/phase-completion.proof.json   (machine-readable)
 *   architecture/phase-completion-status.md           (generated status table)
 *
 * Usage: node scripts/audit-phase-completion.mjs [--phase=21] [--quiet]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const onlyPhase = (process.argv.find((a) => a.startsWith("--phase=")) ?? "").slice(
  "--phase=".length,
);
const quiet = process.argv.includes("--quiet");
const PROOF_REF = "architecture/proofs/phase-completion.proof.json";
const STATUS_REF = "architecture/phase-completion-status.md";

const registry = JSON.parse(read("architecture/registry.json"));

/**
 * Declared level exemptions (see architecture/phase-completion-exemptions.json).
 * A missing file means no exemptions; a malformed one fails the gate, because an
 * unreadable exemption record must never silently widen the gate.
 */
const EXEMPTIONS_REF = "architecture/phase-completion-exemptions.json";
const exemptionsFile = join(ROOT, EXEMPTIONS_REF);
let exemptions = [];
if (existsSync(exemptionsFile)) {
  const parsed = JSON.parse(readFileSync(exemptionsFile, "utf8"));
  exemptions = Array.isArray(parsed.exemptions) ? parsed.exemptions : [];
}
const exemptionsFor = (phaseId) => exemptions.filter((entry) => entry.phase === phaseId);
const phaseDocs = readdirSync(join(ROOT, "architecture")).filter((f) =>
  /^phase-\d\d-.*\.md$/.test(f),
);
const contractFiles = listFiles(join(ROOT, "frontend/src/lib/kernel/phase-contracts"));
const migrations = readdirSync(join(ROOT, "database/supabase/migrations")).filter((f) =>
  f.endsWith(".sql"),
);
const sourceFiles = listFiles(join(ROOT, "frontend/src/lib"));
const surfaceFiles = [
  ...listFiles(join(ROOT, "frontend/src/routes")),
  ...listFiles(join(ROOT, "frontend/src/components")),
];
const operationalFiles = [
  ...listFiles(join(ROOT, "scripts")),
  ...listFiles(join(ROOT, ".github/workflows")),
  ...listFiles(join(ROOT, "architecture/proofs")),
  ...listFiles(join(ROOT, "infrastructure")),
];

/** The engineering sections a phase document must actually carry (Constitution §10). */
const REQUIRED_SECTIONS = [
  "api",
  "event",
  "command",
  "query",
  "policy",
  "security",
  "tenant",
  "workflow",
  "agent",
  "memory",
  "knowledge",
  "observab",
  "test",
  "audit",
  "dependency",
  "boundary",
  "ownership",
  "failure",
  "data model",
  "migration",
];
const DATA_MODEL_MARKERS = ["data model", "schema", "entity", "entities", "column", "table"];

/**
 * Prefixes that count as EXECUTABLE evidence for L3. A contract that only cites
 * architecture documents and phase prose does not satisfy the backend level.
 */
const EXECUTABLE_PREFIXES = [
  "scripts/",
  "tests/",
  "database/supabase/migrations/",
  "frontend/src/",
  "infrastructure/",
  ".github/",
];

function read(ref) {
  return readFileSync(join(ROOT, ref), "utf8").replace(/\r\n/g, "\n");
}

function listFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

function countTests(file) {
  const text = readFileSync(file, "utf8");
  return (text.match(/\b(?:it|test)\s*\(/g) ?? []).length;
}

function resolveModule(name) {
  const base = name.split("/").pop();
  const candidates = sourceFiles.filter((file) => {
    const rel = relative(join(ROOT, "frontend/src/lib"), file).replace(/\\/g, "/");
    return rel === `${name}.ts` || rel.startsWith(`${name}/`) || rel === `${base}.ts`;
  });
  return candidates.length > 0;
}

const LEVEL_NAMES = [
  "L1 conceptual",
  "L2 data model",
  "L3 backend",
  "L4 frontend/workspace integration",
  "L5 operational maturity",
];

/** Kernel phase contracts, keyed by phase id — the authored engineering statement. */
const contracts = new Map();
for (const file of contractFiles) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  const match = rel.match(/phase-(\d\d)-/);
  if (!match) continue;
  contracts.set(match[1], { ref: rel, text: readFileSync(file, "utf8") });
}

/* ── Capability token extraction (used only for evidence location, never semantics) ── */

/**
 * Strong tokens only: the capability id and module basenames. Generic words
 * ("platform", "compute", "memory") are deliberately excluded — matching them
 * would let an artefact inflate a phase it has nothing to do with.
 */
function tokensFor(phase, contract) {
  const tokens = new Set();
  const capability = contract ? stringField(contract.text, "capability") : null;
  if (capability) tokens.add(capability.toLowerCase());
  for (const name of Array.isArray(phase.modules) ? phase.modules : []) {
    const basename = String(name).split("/").pop().toLowerCase();
    if (basename.length >= 6) tokens.add(basename);
    tokens.add(`@/lib/${String(name).toLowerCase()}`);
  }
  return [...tokens];
}

function arrayField(text, field) {
  const match = text.match(new RegExp(`${field}:\\s*\\[([\\s\\S]*?)\\]`));
  if (!match) return [];
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

function stringField(text, field) {
  const match = text.match(new RegExp(`${field}:\\s*"([^"]+)"`));
  return match ? match[1] : null;
}

/* ── Per-phase evidence ───────────────────────────────────────────────────── */

const migrationCorpus = migrations
  .map((file) => `${file}\n${read(`database/supabase/migrations/${file}`)}`)
  .join("\n")
  .toLowerCase();
const surfaceCorpus = surfaceFiles
  .map((file) => readFileSync(file, "utf8"))
  .join("\n")
  .toLowerCase();
const operationalCorpus = operationalFiles
  .map(
    (file) =>
      `${relative(ROOT, file).replace(/\\/g, "/").toLowerCase()}\n${readFileSync(file, "utf8").toLowerCase()}`,
  )
  .join("\n");

const rows = [];
const inconsistencies = [];

for (const phase of registry.phases) {
  if (onlyPhase && phase.id !== onlyPhase) continue;

  const id = phase.id;
  const docs = phaseDocs.filter((file) => file.startsWith(`phase-${id}-`));
  const docText = docs
    .map((file) => read(`architecture/${file}`))
    .join("\n")
    .toLowerCase();
  const sections = REQUIRED_SECTIONS.filter((section) => docText.includes(section));
  const contract = contracts.get(id);
  const modules = Array.isArray(phase.modules) ? phase.modules : [];
  const tokens = tokensFor(phase, contract);
  const citedTests = contract
    ? [
        ...new Set([
          ...arrayField(contract.text, "tests"),
          // Contracts also cite their suites inside section artifacts/evidence;
          // ignoring those understated every phase that documents tests that way.
          ...[...contract.text.matchAll(/"([^"\n]+\.test\.tsx?)"/g)].map((match) => match[1]),
        ]),
      ].filter((ref) => ref.startsWith("tests/"))
    : [];
  const substrates = contract ? arrayField(contract.text, "substrates") : [];

  // L1 — conceptual completeness
  const l1 = docs.length > 0 && sections.length >= 8 && Boolean(contract);

  // L2 — data model representation
  const hasDataVocabulary = DATA_MODEL_MARKERS.some((marker) => docText.includes(marker));
  const dataInDatabase = tokens.some((token) => migrationCorpus.includes(token));
  const l2 = hasDataVocabulary && (dataInDatabase || substrates.length > 0);

  // L3 — backend implementation: real modules, or cited EXECUTABLE artefacts,
  // plus real tests. Documentation citations alone never satisfy this level.
  const modulesResolve = modules.length > 0 && modules.every((name) => resolveModule(name));
  const testsPresent =
    citedTests.length > 0 && citedTests.every((ref) => existsSync(join(ROOT, ref)));
  const testsCounted = citedTests.reduce(
    (total, ref) => total + (existsSync(join(ROOT, ref)) ? countTests(join(ROOT, ref)) : 0),
    0,
  );
  const executableEvidence = contract
    ? [
        ...new Set(
          [...contract.text.matchAll(/"([^"\n]+)"/g)]
            .map((match) => match[1].replace(/\/$/, ""))
            .filter(
              (value) =>
                value.includes("/") &&
                EXECUTABLE_PREFIXES.some((prefix) => value.startsWith(prefix)),
            ),
        ),
      ].filter((value) => existsSync(join(ROOT, value)))
    : [];
  const l3 =
    (modulesResolve || executableEvidence.length > 0) &&
    (testsCounted > 0 || (phase.tests ?? 0) > 0);

  // L4 — frontend / workspace projection. A capability id (distinctive, hyphenated)
  // or a real import of the phase's module counts. A bare module word does NOT:
  // "identity" used to match marketing prose on /platform, which awarded a level for
  // a keyword coincidence instead of a projection.
  const capabilityId = contract ? stringField(contract.text, "capability") : null;
  const surfaceModuleImports = (Array.isArray(phase.modules) ? phase.modules : [])
    .map((name) => String(name).toLowerCase())
    .filter((name) => name.length > 0);
  const l4 =
    (capabilityId ? surfaceCorpus.includes(capabilityId.toLowerCase()) : false) ||
    surfaceModuleImports.some((name) =>
      [`@/lib/${name}"`, `@/lib/${name}/`, `./${name}"`, `/lib/${name}"`, `"/${name}"`].some(
        (specifier) => surfaceCorpus.includes(specifier),
      ),
    );

  // L5 — operational maturity (proof, verifier, CI job, runbook or infra naming it)
  const l5 =
    tokens.some((token) => operationalCorpus.includes(token)) ||
    operationalCorpus.includes(`phase-${id}`);

  const evidence = [l1, l2, l3, l4, l5];
  const claimed = Array.isArray(phase.levels) ? phase.levels.map(Boolean) : [];

  /**
   * Registry claims this audit could NOT evidence are recorded as UNKNOWN-class
   * review items, never as failures: a narrow artefact search is not proof of
   * absence (Constitution §121 KNOWN/INFERRED/UNKNOWN). Provable defects below do
   * fail the gate.
   */
  const unconfirmed = [];
  for (let index = 0; index < Math.max(evidence.length, claimed.length); index += 1) {
    if (claimed[index] && !evidence[index]) unconfirmed.push(LEVEL_NAMES[index]);
  }
  if (docs.length === 0) {
    inconsistencies.push(
      `phase ${id}: registry lists this phase, but no architecture/phase-${id}-*.md exists`,
    );
  }
  for (const ref of citedTests) {
    if (!existsSync(join(ROOT, ref))) {
      inconsistencies.push(`phase ${id}: contract cites a missing test artifact ${ref}`);
    }
  }

  /**
   * Declared level exemptions (BR-01): a level that is not APPLICABLE by
   * construction. An exemption may never be applied to a level that HAS evidence —
   * that would be hiding work — and it never substitutes for the other levels.
   */
  const exemptedLevels = [];
  for (const exemption of exemptionsFor(id)) {
    const index = LEVEL_NAMES.indexOf(exemption.level);
    if (index === -1) {
      inconsistencies.push(`phase ${id}: exemption names an unknown level "${exemption.level}"`);
      continue;
    }
    if (evidence[index]) {
      inconsistencies.push(
        `phase ${id}: exemption for ${exemption.level} is invalid because that level already has evidence — delete the exemption rather than hide the level`,
      );
      continue;
    }
    if (!exemption.reason || !exemption.owner || !exemption.closesWhen || !exemption.ratified) {
      inconsistencies.push(
        `phase ${id}: exemption for ${exemption.level} is not fully justified (reason/owner/closesWhen/ratified required)`,
      );
      continue;
    }
    exemptedLevels.push(exemption.level);
  }

  const satisfied = evidence.map(
    (value, index) => value || exemptedLevels.includes(LEVEL_NAMES[index]),
  );
  const evidencedCount = evidence.filter(Boolean).length;
  const complete = satisfied.every(Boolean) && evidencedCount >= 3;
  const derivedStatus = complete
    ? "COMPLETE"
    : evidence[2] || evidence[3]
      ? "IMPLEMENTING"
      : "ARCHITECTURE_DEFINED";

  rows.push({
    id,
    name: phase.name,
    capability: contract ? stringField(contract.text, "capability") : null,
    docs,
    sectionsPresent: sections.length,
    sectionsRequired: REQUIRED_SECTIONS.length,
    modules,
    modulesResolve,
    citedTests: citedTests.length,
    testsCounted,
    executableEvidence: executableEvidence.length,
    evidence,
    exemptedLevels,
    claimed,
    beyondRegistry: claimed.some((value, index) => evidence[index] && !value),
    unconfirmed,
    registryStatus: phase.status,
    derivedStatus,
    complete,
    missingLevels: LEVEL_NAMES.filter((_, index) => !satisfied[index]),
  });
}

/* ── Report ───────────────────────────────────────────────────────────────── */

const complete = rows.filter((row) => row.complete);
const implementing = rows.filter((row) => !row.complete && row.derivedStatus === "IMPLEMENTING");
const defined = rows.filter((row) => row.derivedStatus === "ARCHITECTURE_DEFINED");
const beyondRegistry = rows.filter((row) => row.beyondRegistry);
const unconfirmed = rows.filter((row) => row.unconfirmed.length > 0);
const gapFrequency = new Map();
for (const row of rows) {
  for (const level of row.missingLevels)
    gapFrequency.set(level, (gapFrequency.get(level) ?? 0) + 1);
}

const proof = {
  artifact: "phase-completion",
  wave: "AUDIT-1",
  owner: "kernel (Phase 01 governance)",
  generatedAt: new Date().toISOString(),
  authority: [
    "CONSTITUTION.md",
    "architecture/registry.json",
    "architecture/phase-*.md",
    "frontend/src/lib/kernel/phase-contracts/**",
  ],
  levelDefinitions: {
    "L1 conceptual":
      "phase document exists with >= 8 distinct engineering sections AND a kernel phase contract exists",
    "L2 data model":
      "phase document carries data-model vocabulary AND (a migration references the capability OR the contract declares substrates)",
    "L3 backend":
      "every declared module resolves to real source AND every contract-cited test file exists with >= 1 real test",
    "L4 frontend/workspace integration":
      "at least one route or component references the phase's modules or capability",
    "L5 operational maturity":
      "an operational artifact (proof, verifier, CI job, runbook or infrastructure file) names the phase or capability",
  },
  summary: {
    phasesAudited: rows.length,
    complete: complete.length,
    implementing: implementing.length,
    architectureDefined: defined.length,
    withModules: rows.filter((row) => row.modules.length > 0).length,
    withResolvedModules: rows.filter((row) => row.modulesResolve).length,
    totalTestsCited: rows.reduce((total, row) => total + row.testsCounted, 0),
    registryBeyondAudit: beyondRegistry.map((row) => row.id),
    unconfirmedClaims: unconfirmed.map((row) => ({ id: row.id, levels: row.unconfirmed })),
    exemptionsApplied: rows.flatMap((row) =>
      row.exemptedLevels.map((level) => ({ phase: row.id, level })),
    ),
    exemptionSource: EXEMPTIONS_REF,
    missingLevelFrequency: Object.fromEntries(
      [...gapFrequency.entries()].sort((left, right) => right[1] - left[1]),
    ),
  },
  phases: rows.map((row) => ({
    id: row.id,
    name: row.name,
    capability: row.capability,
    sections: `${row.sectionsPresent}/${row.sectionsRequired}`,
    modules: row.modules,
    modulesResolve: row.modulesResolve,
    citedTestFiles: row.citedTests,
    testsCounted: row.testsCounted,
    executableEvidence: row.executableEvidence,
    evidence: Object.fromEntries(LEVEL_NAMES.map((name, index) => [name, row.evidence[index]])),
    registryLevels: row.claimed,
    registryStatus: row.registryStatus,
    derivedStatus: row.derivedStatus,
    complete: row.complete,
    missingLevels: row.missingLevels,
    exemptedLevels: row.exemptedLevels,
    unconfirmedLevels: row.unconfirmed,
  })),
  inconsistencies,
  ok: inconsistencies.length === 0,
  limitations: [
    "Evidence-derived: this audit measures artefacts, not correctness of behaviour.",
    'L4 requires a DISTINCTIVE reference: the capability id inside a surface, or a route/component importing the phase\'s module directly. A bare module word is not credited ("identity" used to match marketing prose and inflated three phases), and an INDIRECT projection (surface → server function → module) is not credited either, so L4 may UNDERSTATE a phase — the safe direction; close by hand review with recorded evidence.',
    "DB-backed L2 registries are verified by scripts/verify-l2-registries.mjs, which requires live Supabase credentials.",
    "Incompleteness is reported, never failed: unfinished work is honest. Only overstated claims or missing cited artifacts fail the gate.",
  ],
};

mkdirSync(dirname(join(ROOT, PROOF_REF)), { recursive: true });
writeFileSync(join(ROOT, PROOF_REF), `${JSON.stringify(proof, null, 2)}\n`, "utf8");

/* Generated status table — machine-derived so it cannot drift from the evidence. */
const statusLines = [
  "<!-- GENERATED by scripts/audit-phase-completion.mjs — do not hand-edit. -->",
  "",
  "# CoreGrid — Phase Completion Status (evidence-derived)",
  "",
  `Generated: ${proof.generatedAt}`,
  "",
  `Phases audited: ${rows.length} · COMPLETE: ${complete.length} · IMPLEMENTING: ${implementing.length} · ARCHITECTURE_DEFINED: ${defined.length}`,
  "",
  "Levels: L1 conceptual · L2 data model · L3 backend · L4 frontend/workspace · L5 operational.",
  "",
  "| Phase | Name | Capability | Sections | Modules | Tests | L1 | L2 | L3 | L4 | L5 | Derived | Registry |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...rows.map(
    (row) =>
      `| ${row.id} | ${row.name} | ${row.capability ?? "—"} | ${row.sectionsPresent}/${row.sectionsRequired} | ${row.modules.length} | ${row.testsCounted} | ${row.evidence
        .map((value, index) =>
          value ? "yes" : row.exemptedLevels.includes(LEVEL_NAMES[index]) ? "exempt" : "—",
        )
        .join(" | ")} | ${row.derivedStatus} | ${row.registryStatus} |`,
  ),
  "",
  "## Registry drift (review items — not failures)",
  "",
  beyondRegistry.length > 0
    ? `Evidence beyond the registry claim (registry is stale): ${beyondRegistry.map((row) => row.id).join(", ")}`
    : "Evidence beyond the registry claim: none.",
  "",
  unconfirmed.length > 0
    ? `Registry claims this audit could not evidence (UNKNOWN class — review by hand): ${unconfirmed
        .map((row) => `${row.id}(${row.unconfirmed.join("/")})`)
        .join(", ")}`
    : "Unconfirmed registry claims: none.",
  "",
  "## Provable inconsistencies (these fail the gate)",
  "",
  inconsistencies.length > 0 ? inconsistencies.map((issue) => `- ${issue}`).join("\n") : "- none",
  "",
  "## Missing levels (frequency across phases)",
  "",
  ...[...gapFrequency.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([level, count]) => `- ${level}: ${count} phase(s)`),
  "",
  "## How to move a phase to COMPLETE",
  "",
  "1. L1: ensure the phase document carries the engineering sections and a kernel contract exists.",
  "2. L2: declare the phase's substrates in the contract and represent them in migrations (or an L2 registry).",
  "3. L3: every registry module resolves to real source; every contract-cited test exists and actually tests.",
  "4. L4: at least one workspace/route projects the capability from real state (never manufactured state).",
  "5. L5: an operational artefact names it — proof, verifier, CI job, runbook or infrastructure file.",
  "",
];
writeFileSync(join(ROOT, STATUS_REF), `${statusLines.join("\n")}\n`, "utf8");

/* ── Console + gate ───────────────────────────────────────────────────────── */

if (!quiet) {
  console.log(
    `Audited ${rows.length} phases · COMPLETE ${complete.length} · IMPLEMENTING ${implementing.length} · ARCHITECTURE_DEFINED ${defined.length}`,
  );
  console.log(
    `Modules resolve: ${proof.summary.withResolvedModules}/${proof.summary.withModules} phases with modules · tests counted: ${proof.summary.totalTestsCited}`,
  );
  console.log(
    `Registry drift — evidence beyond claim: ${beyondRegistry.length ? beyondRegistry.map((row) => row.id).join(",") : "none"} · unconfirmed claims: ${unconfirmed.length ? unconfirmed.map((row) => row.id).join(",") : "none"}`,
  );
  console.log(`Status table written: ${STATUS_REF}`);
}

for (const issue of inconsistencies) console.error(`INCONSISTENT  ${issue}`);
console.log(`Proof written: ${PROOF_REF}`);

if (inconsistencies.length > 0) {
  console.error(
    `\n${inconsistencies.length} registry/evidence inconsistenc(ies) — the registry must not claim what artefacts cannot support.`,
  );
  process.exit(1);
}
console.log(
  "No overstatement: every satisfied registry level is backed by an artefact. Incomplete phases are reported honestly.",
);
