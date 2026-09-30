#!/usr/bin/env node
/**
 * Apply the V5.3 V1/FUTURE version classification to registry.json.
 *
 * Additive only: adds a per-phase `version_target` field and a top-level
 * `versionClassification` block. No existing field is modified (existing
 * `status` values must remain untouched — registry-validate.mjs enforces a
 * closed status enum).
 *
 * Authority: architecture/COREGRID_V53_DIRECTIVE_RECONCILIATION.json
 * Classification source: MISSION-V1-002 workforce stream B.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const registryPath = join(root, "architecture/registry.json");
const registry = JSON.parse(readFileSync(registryPath, "utf8"));

// V5.3 Part 37/57 classification (Stream B, MISSION-V1-002, 2026-09-30).
const CLASSIFICATION = {
  "01": "ACTIVE-V1",
  "02": "ACTIVE-V1",
  "03": "ACTIVE-V1",
  "04": "ACTIVE-V1",
  "05": "ACTIVE-V1",
  "06": "ACTIVE-V1",
  "07": "ACTIVE-V1",
  "08": "ACTIVE-V1",
  "09": "ACTIVE-V1",
  "10": "ACTIVE-V1",
  "11": "ACTIVE-V1",
  "12": "ACTIVE-V1",
  "13": "ACTIVE-V1",
  "14": "ACTIVE-V1",
  "15": "FUTURE-V2",
  "16": "MIXED",
  "17": "ACTIVE-V1",
  "18": "ACTIVE-V1",
  "19": "ACTIVE-V1",
  "20": "ACTIVE-V1",
  "21": "ACTIVE-V1",
  "22": "ACTIVE-V1",
  "23": "ACTIVE-V1",
  "24": "ACTIVE-V1",
  "25": "ACTIVE-V1",
  "26": "ACTIVE-V1",
  "27": "MIXED",
  "28": "MIXED",
  "29": "ACTIVE-V1",
  "30": "ACTIVE-V1",
  "31": "ACTIVE-V1",
  "32": "MIXED",
  "33": "MIXED",
  "34": "FUTURE-UNASSIGNED",
  "35": "FUTURE-UNASSIGNED",
  "36": "MIXED",
  "37": "FUTURE-V3",
  "38": "FUTURE-UNASSIGNED",
  "39": "MIXED",
  "40": "MIXED",
  "41": "FUTURE-V3",
  "42": "MIXED",
  "43": "MIXED",
  "44": "FUTURE-V3",
  "45": "FUTURE-UNASSIGNED",
  "46": "FUTURE-V3",
  "47": "FUTURE-UNASSIGNED",
  "48": "FUTURE-UNASSIGNED",
  "49": "FUTURE-UNASSIGNED",
  "50": "FUTURE-UNASSIGNED",
  "51": "FUTURE-UNASSIGNED",
};

const VERSION_TARGET_ENUM = [
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

if (!registry.versionClassification) {
  registry.versionClassification = {
    profile: "V5.3",
    boundary: "V1 ACTIVE / V2 FROZEN / V3 FROZEN / FUTURE / RESEARCH",
    adopted: "2026-09-30",
    authority: "architecture/COREGRID_V53_DIRECTIVE_RECONCILIATION.json",
    classificationSource: "MISSION-V1-002 workforce stream B (Phase 52 V1/Future Decomposition)",
    enum: VERSION_TARGET_ENUM,
    rule: "version_target classifies implementation scope; the existing status field is unchanged and never reports frozen scope as implemented.",
  };
}

let changed = 0;
for (const phase of registry.phases) {
  const target = CLASSIFICATION[phase.id];
  if (!target) throw new Error(`No classification for phase ${phase.id} — refusing to guess`);
  if (phase.version_target !== target) {
    phase.version_target = target;
    changed += 1;
  }
}

writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n");
const counts = {};
for (const phase of registry.phases) counts[phase.version_target] = (counts[phase.version_target] ?? 0) + 1;
console.log(JSON.stringify({ phasesUpdated: changed, counts }, null, 2));
