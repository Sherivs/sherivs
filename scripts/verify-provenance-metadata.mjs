#!/usr/bin/env node
/**
 * Sherivs — H3 wave, team H3-095 (Provenance Auditor), mission J-095
 * (Squad J — Governance & documentation).
 *
 * Machine check that key governance artifacts carry provenance metadata per
 * AGENTS.md §12 (Data Provenance): where did this come from, who created it,
 * when was it created, was it verified, was it AI-generated, can it be trusted.
 *
 * Provenance contract (how §12 maps to checked-in conventions):
 *   origin        — WHERE did this come from: an authority citation (Authority:/
 *                   Cites/Supersedes/Contract:/campaign law), a derivation
 *                   citation (source/creating migration, created/corrected by,
 *                   machine source of truth), a mission-graph citation
 *                   (Mission: <id>), or a cited in-repo artifact path.
 *   creator       — WHO created it: an agent identity under AGENTS §5 — the
 *                   wave team id (H3-NNN), a mission id (X-NNN, MISSION-R-NNN,
 *                   H2-NN, mrNNN), or the template/root-authority equivalents.
 *                   Per campaign convention every H3 artifact is authored by a
 *                   numbered agent team, so the team attribution IS the
 *                   AI-generated disclosure. Explicit authenticated coding-agent
 *                   account names are also accepted as creator identities.
 *   createdAt     — WHEN: an inline ISO date (required inline for ADRs, the
 *                   campaign record and the root authority), or wave-inheritance
 *                   for wave-scope classes: the campaign record is the root
 *                   provenance record and carries the wave date (2026-10-03).
 *   verification  — VERIFIED? / trustworthy?: a declared verification or
 *                   decision posture (Status/Verdict/Decision/Disposition/
 *                   Adjudication markers, Governed-(not)-executed / nothing-
 *                   applied honesty markers, a Tests/Evidence report section,
 *                   STATUS= battery lines, or an explicit no-execution claim).
 *   identity      — root authority only (AGENTS.md): Document/System/Version
 *                   self-identification (it defines provenance; it does not
 *                   cite a higher authority).
 *   declared-fields — ADR template only: the template's provenance IS its
 *                   declared field schema (Status/Date/Author/Mission rows).
 *
 * Artifact classes (first matching rule wins):
 *   root-authority   AGENTS.md
 *   adr-template     architecture/adr/TEMPLATE.md
 *   campaign-record  architecture/campaigns/H3-WAVE-CAMPAIGN.md
 *   adr              architecture/adr (all markdown, recursive)
 *   runbook          docs/runbooks (all markdown, recursive)
 *   wave-doc         architecture/campaigns/h3 + architecture/observability
 *   wave-report      progress/h3-wave
 *
 * Scope: markdown governance artifacts only. Machine JSON posture registries
 * (scripts/verification/rls-table-postures-*.json) are J-099's merge target and
 * are deliberately out of scope, as are non-markdown sources.
 *
 * Modes: single offline mode — zero network, zero database, zero credential.
 * Credential-gated drills are outside this checker's contract entirely, so no
 * BLOCKED_NO_CREDENTIAL path exists; exit 2 is reserved for BLOCKED_USAGE and
 * BLOCKED_SCAN (unreadable scan root), the same fail-closed family as the
 * wave's drill exemplars.
 *
 * Usage:
 *   node scripts/verify-provenance-metadata.mjs [--root <dir>] [--json]
 * Exit codes: 0 PASS · 1 FINDING · 2 BLOCKED_USAGE / BLOCKED_SCAN.
 *
 * Hygiene law: this tool never prints, logs, or writes any secret value (it
 * reads only checked-in markdown); evidence artifacts land in
 * SHERIVS_ARTIFACTS_DIR (default /opt/cursor/artifacts) with a guarded write.
 */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CAMPAIGN_RECORD_REL = "architecture/campaigns/H3-WAVE-CAMPAIGN.md";
const ROOT_AUTHORITY_REL = "AGENTS.md";
const ADR_TEMPLATE_REL = "architecture/adr/TEMPLATE.md";
const ARTIFACTS_DIR =
  process.env.SHERIVS_ARTIFACTS_DIR ??
  process.env.COREGRID_ARTIFACTS_DIR ??
  "/opt/cursor/artifacts";

// ── argument parsing ─────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const KNOWN_FLAGS = new Set(["--root", "--json"]);

/** @type {string | undefined} */
let scanRootArg;
let jsonOutput = false;
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === "--json") {
    jsonOutput = true;
  } else if (arg === "--root") {
    const next = argv[i + 1];
    if (next === undefined) {
      console.error("BLOCKED_USAGE --root requires a directory argument.");
      process.exit(2);
    }
    scanRootArg = next;
    i += 1;
  } else {
    console.error(`BLOCKED_USAGE unknown argument: ${arg}. Supported: [--root <dir>] [--json].`);
    process.exit(2);
  }
}

const SCAN_ROOT = scanRootArg ?? ROOT;
if (!statSync(SCAN_ROOT, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`BLOCKED_SCAN root is not a directory: ${SCAN_ROOT}`);
  process.exit(2);
}

/** POSIX-relative path of an absolute path against the scan root. */
function relPath(absPath) {
  return relative(SCAN_ROOT, absPath).split(sep).join("/");
}

// ── dimension matchers (any single match satisfies the dimension) ────────────
/** @type {readonly RegExp[]} */
const ORIGIN_MATCHERS = [
  /\bauthorit/i, // Authority / authorities
  /\bcites?\b|\bcited\b/i,
  /\bsupersedes?\b/i,
  /\bderived[- ]from\b/i,
  /\b(?:source|creating) migration\b/i,
  /\b(?:created|corrected) by\b/i,
  /\bmachine source of truth\b/i,
  /\bprovenance of\b/i,
  /\bcontract:|\bcontract mapped\b/i,
  /\bbranch context\b|\bbranch:/i,
  /\bcampaign law\b|architecture\/campaigns/i,
  /\bmission\s*[:\-–]\s*[A-Z]-\d{2,3}\b/i,
  /\b(?:tests|frontend|scripts|docs|architecture|database|progress)\/[A-Za-z0-9][A-Za-z0-9_./-]*/i,
];

/** @type {readonly RegExp[]} */
const CREATOR_MATCHERS = [
  /\bH3-\d{3}\b/, // wave team id
  /\b[A-Z]-\d{3}\b/, // mission id (A-001, D-040, E-044, H-085, J-042, …)
  /\bMISSION-R-\d+\b/i,
  /\bMISSION-V1-\d{3}\b/, // V5.3 V1 mission series (MISSION-V1-001..018)
  /\bH2-\d{2,3}\b/,
  /\bmr\d{3}\b/i,
  /\bcopilot-swe-agent\[bot\]/i, // authenticated GitHub Copilot coding-agent account
];

/** @type {readonly RegExp[]} */
const VERIFICATION_MATCHERS = [
  /^\s*[-*]?\s*\*{0,2}status\*{0,2}\s*[:|=]/im,
  /\b(?:status|verdict|decision|disposition|adjudication type|adjudicated posture|last verified)\b\s*[:|=]/im,
  /\bdisposition classes\b/i,
  /^#{1,4}\s*disposition\b/im,
  /\bSTATUS=(?:PASS|FAIL|BLOCKED|FINDINGS|REHEARSAL_PASS)/i,
  /\badjudicat/i,
  /\b(?:governed[ ](?:not|and)[ ]executed|governed,[ ]not[ ]executed|nothing applied|nothing was applied)\b/i,
  /^tests?:\s*\S/im,
  /^#{2,4}\s*(?:tests|test results|verification|evidence)\b/im,
  /\*\*Tests?\b[^*]{0,24}\*\*/,
  /\bzero (?:test )?execution\b/i,
  /\bnot produced by (?:running|executing)\b/i,
  /^#{1,3}\s*campaign law\b/im,
];

/** @type {readonly RegExp[]} */
const IDENTITY_MATCHERS = [/^Document: AGENTS\.md/m, /^System: \S/m, /^Version: v\d+/m];

/** @type {readonly RegExp[]} */
const DECLARED_FIELD_MATCHERS = [
  /^\|{1,2}\s*Status\s*\|/m,
  /^\|{1,2}\s*Date\s*\|/m,
  /^\|{1,2}\s*Author\s*\|/m,
  /^\|{1,2}\s*Mission\s*\|/m,
];

const INLINE_DATE_MATCHER = /\b20\d{2}-\d{2}-\d{2}\b/;

/**
 * Provenance contract, declared as data. `dimensions` lists REQUIRED checks;
 * `createdAtInline: true` demands an inline ISO date (no wave inheritance).
 * @type {readonly { name: string, accepts: (rel: string) => boolean, dimensions: readonly string[], createdAtInline?: boolean }[]}
 */
export const PROVENANCE_CONTRACT = [
  {
    name: "root-authority",
    accepts: (rel) => rel === ROOT_AUTHORITY_REL,
    dimensions: ["identity"],
  },
  {
    name: "adr-template",
    accepts: (rel) => rel === ADR_TEMPLATE_REL,
    dimensions: ["declared-fields"],
  },
  {
    name: "campaign-record",
    accepts: (rel) => rel === CAMPAIGN_RECORD_REL,
    dimensions: ["origin", "creator", "createdAt", "verification"],
    createdAtInline: true,
  },
  {
    name: "adr",
    accepts: (rel) => rel.startsWith("architecture/adr/"),
    dimensions: ["origin", "creator", "createdAt", "verification"],
    createdAtInline: true,
  },
  {
    name: "runbook",
    accepts: (rel) => rel.startsWith("docs/runbooks/"),
    dimensions: ["origin", "creator", "createdAt", "verification"],
  },
  {
    name: "wave-doc",
    accepts: (rel) =>
      rel.startsWith("architecture/campaigns/h3/") || rel.startsWith("architecture/observability/"),
    dimensions: ["origin", "creator", "createdAt", "verification"],
  },
  {
    name: "wave-report",
    accepts: (rel) => rel.startsWith("progress/h3-wave/"),
    dimensions: ["origin", "creator", "createdAt", "verification"],
  },
];

/** Walked class roots; a missing root is itself a FINDING (fail-closed). */
const CLASS_ROOTS = [
  "architecture/adr",
  "architecture/campaigns/h3",
  "architecture/observability",
  "docs/runbooks",
  "progress/h3-wave",
];

const DIMENSION_MATCHERS = {
  origin: ORIGIN_MATCHERS,
  creator: CREATOR_MATCHERS,
  verification: VERIFICATION_MATCHERS,
  identity: IDENTITY_MATCHERS,
  "declared-fields": DECLARED_FIELD_MATCHERS,
};

/**
 * Evaluate one artifact's provenance against its class rule.
 * @param {string} text full artifact text
 * @param {{ name: string, dimensions: readonly string[], createdAtInline?: boolean }} rule
 * @param {boolean} waveDateAnchored whether the campaign record carries the wave date
 * @returns {{ missing: string[], advisories: string[] }}
 */
export function evaluateProvenance(text, rule, waveDateAnchored) {
  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const advisories = [];
  for (const dimension of rule.dimensions) {
    if (dimension === "createdAt") {
      if (INLINE_DATE_MATCHER.test(text)) continue;
      if (!rule.createdAtInline && waveDateAnchored) {
        advisories.push("createdAt satisfied by wave-inheritance (no inline date)");
        continue;
      }
      missing.push("createdAt");
      continue;
    }
    const matchers = DIMENSION_MATCHERS[dimension];
    if (!matchers || !matchers.some((re) => re.test(text))) missing.push(dimension);
  }
  return { missing, advisories };
}

/** Resolve the class rule for a relative path, or null when unclassified. */
export function resolveClass(rel) {
  return PROVENANCE_CONTRACT.find((rule) => rule.accepts(rel)) ?? null;
}

/**
 * Recursively collect .md files under a root directory.
 * @param {string} dir absolute directory
 * @returns {string[]} absolute file paths
 */
function walkMarkdown(dir) {
  /** @type {string[]} */
  const out = [];
  const stat = statSync(dir, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(abs));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(abs);
  }
  return out.sort();
}

/**
 * @typedef {Object} ProvenanceFinding
 * @property {string} file
 * @property {string} artifactClass
 * @property {string[]} missing
 */

/**
 * @typedef {Object} ScanResult
 * @property {number} checked
 * @property {ProvenanceFinding[]} findings
 * @property {string[]} advisories
 * @property {Record<string, number>} classCounts
 * @property {string[]} scanErrors
 */

/**
 * Scan the whole governance-artifact inventory (offline, read-only).
 * @returns {ScanResult}
 */
export function scanProvenance() {
  /** @type {ProvenanceFinding[]} */
  const findings = [];
  /** @type {string[]} */
  const advisories = [];
  /** @type {Record<string, number>} */
  const classCounts = {};
  /** @type {string[]} */
  const scanErrors = [];

  const campaignAbs = join(SCAN_ROOT, CAMPAIGN_RECORD_REL);
  let campaignText = null;
  try {
    campaignText = readFileSync(campaignAbs, "utf8");
  } catch {
    findings.push({
      file: CAMPAIGN_RECORD_REL,
      artifactClass: "campaign-record",
      missing: ["anchor artifact missing — the wave provenance root record must exist"],
    });
  }
  const waveDateAnchored = campaignText !== null && INLINE_DATE_MATCHER.test(campaignText);

  for (const root of CLASS_ROOTS) {
    const abs = join(SCAN_ROOT, root);
    if (!statSync(abs, { throwIfNoEntry: false })?.isDirectory()) {
      findings.push({
        file: root,
        artifactClass: "inventory",
        missing: ["class root directory missing — fail-closed, no silent scope shrink"],
      });
    }
  }

  /** @type {string[]} */
  const files = [];
  for (const root of CLASS_ROOTS) files.push(...walkMarkdown(join(SCAN_ROOT, root)));
  const anchorPaths = [join(SCAN_ROOT, ROOT_AUTHORITY_REL), campaignAbs];
  for (const abs of anchorPaths) {
    if (!statSync(abs, { throwIfNoEntry: false })?.isFile()) {
      const rel = relPath(abs);
      if (!findings.some((f) => f.file === rel)) {
        findings.push({
          file: rel,
          artifactClass: "inventory",
          missing: ["anchor artifact missing — fail-closed, the provenance chain must be rooted"],
        });
      }
    }
  }
  const allPaths = [
    ...new Set([
      ...anchorPaths.filter((abs) => statSync(abs, { throwIfNoEntry: false })?.isFile()),
      ...files,
    ]),
  ].sort();

  for (const abs of allPaths) {
    const rel = relPath(abs);
    const rule = resolveClass(rel);
    if (!rule) {
      findings.push({
        file: rel,
        artifactClass: "unclassified",
        missing: ["no provenance class declared for this artifact"],
      });
      continue;
    }
    classCounts[rule.name] = (classCounts[rule.name] ?? 0) + 1;
    /** @type {string} */
    let text;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      scanErrors.push(`unreadable artifact (skipped content, recorded fail-closed): ${rel}`);
      findings.push({ file: rel, artifactClass: rule.name, missing: ["unreadable artifact"] });
      continue;
    }
    const { missing, advisories: artifactAdvisories } = evaluateProvenance(
      text,
      rule,
      waveDateAnchored,
    );
    for (const note of artifactAdvisories) {
      advisories.push(`${rel}: ${note}`);
    }
    if (missing.length > 0) findings.push({ file: rel, artifactClass: rule.name, missing });
  }

  return {
    checked: allPaths.length,
    findings,
    advisories,
    classCounts,
    scanErrors,
  };
}

// ── reporting ────────────────────────────────────────────────────────────────
/** @type {string[]} */
const log = [];
const reportLine = (line) => {
  log.push(line);
  if (!jsonOutput) process.stdout.write(line + "\n");
};

function writeArtifacts(result) {
  const record = {
    mission: "J-095 provenance auditor (H3-095, Squad J — Governance & documentation)",
    mode: "offline",
    scanRoot: SCAN_ROOT,
    networkContact: false,
    databaseContact: false,
    credentialRequired: false,
    checked: result.checked,
    classCounts: result.classCounts,
    findings: result.findings,
    advisories: result.advisories,
    scanErrors: result.scanErrors,
    log,
  };
  try {
    mkdirSync(ARTIFACTS_DIR, { recursive: true });
    writeFileSync(
      join(ARTIFACTS_DIR, "provenance-metadata.json"),
      JSON.stringify(record, null, 2) + "\n",
    );
    writeFileSync(join(ARTIFACTS_DIR, "provenance-metadata.log"), log.join("\n") + "\n");
    reportLine(`artifact: ${ARTIFACTS_DIR}/provenance-metadata.json`);
  } catch (err) {
    reportLine(`WARN artifact write failed (${ARTIFACTS_DIR}): ${err.message}`);
  }
}

const result = scanProvenance();

if (jsonOutput) {
  process.stdout.write(
    JSON.stringify(
      {
        checked: result.checked,
        classCounts: result.classCounts,
        findings: result.findings,
        advisories: result.advisories,
        scanErrors: result.scanErrors,
      },
      null,
      2,
    ) + "\n",
  );
  process.exitCode = result.findings.length === 0 ? 0 : 1;
} else {
  reportLine(
    "COREGRID PROVENANCE METADATA VERIFIER (AGENTS §12) — offline; no network, no database, no credential.",
  );
  reportLine(`root=${SCAN_ROOT} checked=${result.checked}`);
  const classSummary = Object.entries(result.classCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => `${name}:${count}`)
    .join(" ");
  reportLine(`classes: ${classSummary || "(none)"}`);
  if (result.scanErrors.length > 0) {
    for (const err of result.scanErrors) reportLine(`WARN ${err}`);
  }
  if (result.findings.length === 0) {
    reportLine(
      `STATUS=PASS — ${result.checked} governance artifacts carry the required §12 provenance dimensions (origin, creator, createdAt, verification per class contract).`,
    );
  } else {
    for (const finding of result.findings) {
      reportLine(
        `FINDING ${finding.file} [${finding.artifactClass}] missing: ${finding.missing.join(", ")}`,
      );
    }
    reportLine(
      `STATUS=PROVENANCE_FINDINGS (${result.findings.length}) — governance artifacts above lack declared provenance; fix the artifacts, never the contract, without an ADR.`,
    );
  }
  if (result.advisories.length > 0) {
    reportLine(
      `advisory: ${result.advisories.length} wave-scope artifact(s) rely on wave-inherited dating (see JSON record).`,
    );
  }
  writeArtifacts(result);
  process.exitCode = result.findings.length === 0 ? 0 : 1;
}
