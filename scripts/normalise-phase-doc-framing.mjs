#!/usr/bin/env node
/**
 * CoreGrid — phase blueprint neutrality normaliser.
 *
 * WHY IT EXISTS
 * The 51 phase blueprints were authored while one runtime was the product, so a large
 * minority of them present that runtime as the PLATFORM ("CoreGrid Scholar's institutional
 * communication infrastructure", "Scholar is the first runtime", "Scholar-specific", …).
 * Every later phase reads those blueprints as law, so the framing is corrected at the
 * source rather than argued with at review time — the same finding as PROGRESS §22.16,
 * applied to the architecture portfolio.
 *
 * WHAT IT DOES
 * Rewrites owner-framing statements into platform statements, deterministically:
 *   CoreGrid Scholar …  -> CoreGrid …
 *   Scholar's <noun>    -> CoreGrid's <noun>
 *   Scholar is|consumes|owns|binds|resolves|implements … -> the platform / a runtime …
 * A bare "Scholar" it cannot classify is NEVER rewritten: it is reported as a human
 * decision, because it may be a legitimate proper noun in a sentence about the runtime.
 *
 * The runtime keeps its name where the sentence is ABOUT the runtime (runtime-001, the
 * first installed runtime, a consumer of the kernel) — that is the fact the blueprints must
 * state, not the identity of the platform.
 *
 * Usage:
 *   node scripts/normalise-phase-doc-framing.mjs --check   # report only (gate mode)
 *   node scripts/normalise-phase-doc-framing.mjs           # apply + report
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const CHECK = process.argv.includes("--check");
const REPORT = join(ROOT, "architecture", "phase-blueprint-neutrality-report.md");

const read = (ref) => readFileSync(join(ROOT, ref), "utf8");

/**
 * Ordered rewrites. Order matters: the compound name collapses first, so the possessive
 * rule never sees "Scholar's" and the platform name is never doubled.
 */
const REWRITES = [
  [/CoreGrid\s+Scholar/gi, "CoreGrid"],
  [/\bScholar's\s+(?=[A-Za-z-])/gi, "CoreGrid's "],
  [
    /\bScholar is the first runtime\b/gi,
    "the first installed runtime is runtime-001, a consumer among equals",
  ],
  [/\bScholar is\b/gi, "The first installed runtime is"],
  [/\bScholar consumes\b/gi, "A runtime consumes"],
  [/\bScholar provides\b/gi, "The platform provides"],
  [/\bScholar owns\b/gi, "CoreGrid owns"],
  [/\bScholar implements\b/gi, "A runtime implements"],
  [/\bScholar binds\b/gi, "A runtime binds"],
  [/\bScholar resolves\b/gi, "A runtime resolves"],
  [/\bScholar remains\b/gi, "The first installed runtime remains"],
  [/\bScholar-?specific\b/gi, "runtime-specific"],
  [/\bScholar-only\b/gi, "runtime-specific"],
  [/\bScholar platform\b/gi, "CoreGrid platform"],
  [/\bScholar system\b/gi, "CoreGrid system"],
  [/\bScholar runtime\b/gi, "installed runtime"],
  [/\bScholar implementation\b/gi, "runtime implementation"],
  [/\bfor Scholar\b/gi, "for an installed runtime"],
  [/\bwith Scholar\b/gi, "with the installed runtime"],
  [/\bby Scholar\b/gi, "by an installed runtime"],
  [/\bto Scholar\b/gi, "to the installed runtime"],
];

/** A runtime presented as the platform — the patterns the gate refuses. */
const OWNER_FRAMING = [
  /CoreGrid Scholar/i,
  /Scholar's/i,
  /Scholar is\b/i,
  /Scholar consumes/i,
  /Scholar owns/i,
  /Scholar provides/i,
  /Scholar-?specific/i,
  /Scholar-only/i,
  /Scholar platform/i,
  /Scholar system/i,
  /Scholar implementation/i,
  /\bfor Scholar\b/i,
];

/**
 * Kept deliberately: the runtime named as the first consumer of the kernel, or named as a
 * path/identifier that belongs to the runtime's own layer. Naming a runtime file is not a
 * claim about the platform.
 */
const ALLOWED_CONSUMER =
  /runtime-001|R-001|first installed runtime|first runtime to consume|tests\/unit\/scholar|lib\/scholar|scripts\/verify-scholar|verify-scholar-config-wiring/;

const phaseDocs = readdirSync(join(ROOT, "architecture"))
  .filter((name) => /^phase-\d\d-.*\.md$/.test(name))
  .sort();

const changes = [];
const ownerFramingLeft = [];
const residualMentions = [];
let rewrittenFiles = 0;
let rewrittenLines = 0;

for (const name of phaseDocs) {
  const ref = `architecture/${name}`;
  const before = read(ref);
  const lines = before.split("\n");
  const afterLines = [];
  let fileChanged = 0;

  for (const line of lines) {
    let next = line;
    for (const [pattern, replacement] of REWRITES) next = next.replace(pattern, replacement);
    next = next.replace(/CoreGrid's CoreGrid's/g, "CoreGrid's");

    if (next !== line) {
      fileChanged += 1;
      rewrittenLines += 1;
      changes.push({ ref, before: line.trim(), after: next.trim() });
    }
    afterLines.push(next);
  }

  const after = afterLines.join("\n");

  /**
   * After rewriting, every line that still names a runtime must be a sentence ABOUT the
   * runtime (runtime-001, the first installed runtime, a consumer). An owner-framing line
   * left behind, or a bare name the rules could not classify, is reported rather than
   * silently kept.
   */
  for (const [index, line] of afterLines.entries()) {
    if (!/Scholar/.test(line)) continue;
    // "Scholarship" is a domain word, not a runtime reference.
    if (/Scholarship/i.test(line)) continue;
    if (ALLOWED_CONSUMER.test(line)) continue;
    if (OWNER_FRAMING.some((pattern) => pattern.test(line))) {
      ownerFramingLeft.push({ ref, line: index + 1, text: line.trim() });
    } else {
      residualMentions.push({ ref, line: index + 1, text: line.trim() });
    }
  }

  if (fileChanged > 0) {
    rewrittenFiles += 1;
    if (!CHECK) writeFileSync(join(ROOT, ref), after, "utf8");
  }
}

const report = [
  "# Phase blueprint neutrality report",
  "",
  `Generated by \`scripts/normalise-phase-doc-framing.mjs${CHECK ? " --check" : ""}\`.`,
  "",
  "| Measure | Value |",
  "| --- | --- |",
  `| Phase documents scanned | ${phaseDocs.length} |`,
  `| Documents with owner-framing ${CHECK ? "to rewrite" : "rewritten"} | ${rewrittenFiles} |`,
  `| Lines ${CHECK ? "to rewrite" : "rewritten"} | ${rewrittenLines} |`,
  `| Owner-framing statements left | ${ownerFramingLeft.length} |`,
  `| Residual runtime mentions to review | ${residualMentions.length} |`,
  "",
  "## Rewrites applied",
  "",
  ...changes.map(
    (change) => `- \`${change.ref}\`\n  - before: ${change.before}\n  - after: ${change.after}`,
  ),
  "",
  "## Owner-framing left (must be zero)",
  "",
  ...(ownerFramingLeft.length === 0
    ? ["None."]
    : ownerFramingLeft.map((item) => `- \`${item.ref}:${item.line}\` — ${item.text}`)),
  "",
  "## Residual runtime mentions to review",
  "",
  ...(residualMentions.length === 0
    ? ["None: every remaining mention names the runtime as an installed consumer."]
    : residualMentions.map((item) => `- \`${item.ref}:${item.line}\` — ${item.text}`)),
  "",
];

if (!CHECK) writeFileSync(REPORT, report.join("\n"), "utf8");

console.log(`phase documents scanned: ${phaseDocs.length}`);
console.log(
  `documents with owner-framing ${CHECK ? "to rewrite" : "rewritten"}: ${rewrittenFiles}`,
);
console.log(`lines ${CHECK ? "to rewrite" : "rewritten"}: ${rewrittenLines}`);
console.log(`human decisions required: ${residualMentions.length}`);
if (!CHECK) console.log("report written: architecture/phase-blueprint-neutrality-report.md");

if (CHECK && (rewrittenFiles > 0 || ownerFramingLeft.length > 0 || residualMentions.length > 0)) {
  console.log("\n--check: the blueprint still frames a runtime as the platform.");
  process.exit(1);
}
