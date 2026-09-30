#!/usr/bin/env node
/**
 * MISSION-V1-003: insert the V1 EXECUTION BOUNDARY banner into the 13 mothers
 * and 7 governance files, per V5.3 Parts 41-42/77.
 *
 * Minimal, non-rewriting: the banner is inserted once, immediately before the
 * first standalone `---` separator line (after the header metadata block).
 * Idempotent: a file already carrying the banner is skipped.
 * History preservation: no existing line is modified or removed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const FILES = [
  "COREGRID.md",
  "GOVERNANCE.md",
  "ARCHITECTURE.md",
  "REALITY.md",
  "ENGINEERING.md",
  "WORKFORCE.md",
  "MISSIONS.md",
  "BLUEPRINTS.md",
  "PROGRESS.md",
  "ECOSYSTEM.md",
  "IMPLEMENTATION.md",
  "RUNTIME.md",
  "ASSURANCE.md",
  "REGISTRY.md",
  "PRINCIPLES.md",
  "BOUNDARIES.md",
  "DEPENDENCY.md",
  "CONSTITUTION.md",
  "DECISIONS.md",
];

function bannerFor(file) {
  const specific = {
    "COREGRID.md":
      "V1 instantiates the organizational reality domain only; universal/civilization scope remains preserved master identity, never an implementation claim.",
    "REALITY.md":
      "V1 implements organizational reality only — people, organizations, identity, memberships, schedules, attendance, finance, communication. Geospatial, geophysical, satellite, biological, chemical, physical-world, environmental and civilization-scale reality sections are V3 FROZEN.",
    "ECOSYSTEM.md":
      "V1 ecosystem scope is limited to the Scholar runtime and its core integrations; developer, marketplace, government-cloud, partner and economic ecosystem sections are FROZEN until V2+.",
    "PRINCIPLES.md":
      "The V3/Civilization generation remains the preserved normative master for frozen scope; under V5.3 only the V1 organizational subset of these principles is actively binding on implementation.",
    "PROGRESS.md":
      "V1 boundary classification is recorded via registry.json version_target; progress claims must state their version-target classification.",
    default:
      "Active implementation covers only the V1 organizational capability envelope per the V5.3 MVP execution profile.",
  };
  return [
    "",
    "───",
    "",
    "V1 EXECUTION BOUNDARY (Constitution V5.3 MVP Execution Profile — adopted 2026-09-30)",
    "Authority: architecture/COREGRID_V53_DIRECTIVE_RECONCILIATION.json",
    "",
    ...wrap(
      "This surface is preserved in full as master architecture. " +
        (specific[file] ?? specific.default) +
        " Device/IoT capabilities are V2 FROZEN. Universal Reality Intelligence capabilities are V3 FROZEN. " +
        "Unassigned capabilities are FUTURE — FROZEN. Sections describing frozen scope are preserved, never deleted, never claimed as implemented. " +
        "Un-freezing requires an explicit human authorization record.",
    ),
    "",
  ].join("\n") + "\n";
}

function wrap(text, width = 96) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width) {
      lines.push(line.trim());
      line = w;
    } else {
      line += " " + w;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.map((l, i) => (i === 0 ? l : "  " + l));
}

let inserted = 0;
let skipped = 0;
for (const file of FILES) {
  const path = join(root, file);
  const content = readFileSync(path, "utf8");
  if (content.includes("V1 EXECUTION BOUNDARY")) {
    skipped += 1;
    continue;
  }
  const lines = content.split("\n");
  const sepIndex = lines.findIndex((l, i) => i > 0 && l.trim() === "───");
  if (sepIndex === -1) throw new Error(`${file}: no separator line found — refusing to guess placement`);
  lines.splice(sepIndex, 0, bannerFor(file));
  writeFileSync(path, lines.join("\n"));
  inserted += 1;
  console.log(`banner inserted: ${file}`);
}
console.log(JSON.stringify({ inserted, skipped }));
