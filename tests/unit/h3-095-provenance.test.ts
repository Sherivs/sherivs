/**
 * Sherivs — H3 wave, team H3-095 (Provenance Auditor), mission J-095
 * (Squad J — Governance & documentation).
 *
 * Offline tests for scripts/verify-provenance-metadata.mjs: the AGENTS.md §12
 * provenance contract (origin / creator / createdAt / verification per artifact
 * class), the wave-inheritance dating rule, fail-closed inventory semantics,
 * CLI exit-code discipline (0 PASS · 1 FINDING · 2 BLOCKED), and tool hygiene
 * (no network, no database, no child processes, no credential references).
 *
 * Every fixture is a clearly synthetic, self-describing stub. No database, no
 * network, no real credential material. The real-repository assertions are
 * read-only and never mutate checked-in artifacts.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(ROOT, "scripts", "verify-provenance-metadata.mjs");
const SCRIPT_SOURCE = readFileSync(SCRIPT, "utf8");

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

interface ProvenanceFinding {
  file: string;
  artifactClass: string;
  missing: string[];
}

interface ProvenanceJson {
  checked: number;
  classCounts: Record<string, number>;
  findings: ProvenanceFinding[];
  advisories: string[];
  scanErrors: string[];
}

interface ProvenanceArtifactRecord {
  mission: string;
  mode: string;
  networkContact: boolean;
  databaseContact: boolean;
  credentialRequired: boolean;
  checked: number;
  findings: ProvenanceFinding[];
}

function runScript(args: string[], extraEnv: Record<string, string> = {}): RunResult {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
  if (extraEnv.COREGRID_ARTIFACTS_DIR === undefined) {
    delete env.COREGRID_ARTIFACTS_DIR;
  }
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: "utf8" });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parseJson(stdout: string): ProvenanceJson {
  return JSON.parse(stdout) as ProvenanceJson;
}

function findingFor(payload: ProvenanceJson, file: string): ProvenanceFinding | undefined {
  return payload.findings.find((f) => f.file === file);
}

// ── synthetic fixture stubs (self-describing; no real mission ids) ───────────
const AGENTS_STUB = ["Document: AGENTS.md", "System: CoreGrid", "Version: v1.0", ""].join("\n");

const CAMPAIGN_STUB = [
  "# H3 WAVE — SYNTHETIC CAMPAIGN (2026-10-03)",
  "Authority: AGENTS.md (CoreGrid ASI Engineering Constitution) §22, §23, §42.",
  "Wave command: H3-000 (synthetic coordinator role).",
  "",
  "## CAMPAIGN LAW",
  "",
  "1. Synthetic law line for fixture purposes only.",
  "",
].join("\n");

const ADR_STUB = [
  "# ADR-990: Synthetic backup decision (fixture)",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Status | PROPOSED (synthetic fixture ruling) |",
  "| Date | 2026-10-03 |",
  "| Author | SYNTHETIC STRATEGIST (TEAM H3-990, A-990) |",
  "| Mission | H3-990 (Squad J, mission A-990) |",
  "",
  "Cites: AGENTS.md §12; architecture/campaigns/H3-WAVE-CAMPAIGN.md campaign law.",
  "",
].join("\n");

const TEMPLATE_STUB = [
  "# ADR-NNN: Title (fixture template)",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Status | PROPOSED |",
  "| Date | YYYY-MM-DD |",
  "| Author | ROLE NAME (TEAM/MISSION ID) |",
  "| Mission | mission id slot |",
  "",
].join("\n");

const RUNBOOK_STUB = (withDate: boolean): string =>
  [
    "# RUNBOOK — Synthetic drill (fixture)",
    "",
    `Status: **AUTHORED** — H3-wave mission A-990 (team H3-990, Synthetic Runbook Engineer).${withDate ? " Fixture date 2026-10-03." : ""}`,
    "Authority: AGENTS.md §29 (observability), §30 (secrets); H3 wave campaign law.",
    "",
  ].join("\n");

const WAVE_DOC_STUB = (withDate: boolean): string =>
  [
    "# Synthetic Wave Governance Doc (fixture)",
    "",
    "Team: H3-990 (Squad J — Governance & documentation)",
    ...(withDate ? ["Date: 2026-10-03"] : []),
    "Authority: AGENTS.md §12, §42; architecture/campaigns/H3-WAVE-CAMPAIGN.md campaign law.",
    "Status: **AUTHORED** — synthetic fixture decision record.",
    "",
  ].join("\n");

const REPORT_STUB = (withDate: boolean): string =>
  [
    "# H3-990 — Synthetic §42 Report (fixture)",
    "",
    "- **Team:** H3-990 (Squad J — Governance & documentation)",
    "- **Mission:** A-990 — see docs/runbooks/synthetic-drill.md",
    ...(withDate ? ["- **Date:** 2026-10-03"] : []),
    "",
    "## Implemented",
    "",
    "- Synthetic fixture deliverable.",
    "",
    "## Tests",
    "",
    "- npx vitest run tests/unit/h3-990-synthetic.test.ts — synthetic fixture, all green.",
    "",
  ].join("\n");

/** Report stub missing a creator attribution: no team id, no mission id anywhere. */
const REPORT_NO_CREATOR_STUB = [
  "# Synthetic Report (fixture)",
  "",
  "Cites: docs/runbooks/synthetic-drill.md",
  "- **Date:** 2026-10-03",
  "",
  "## Implemented",
  "",
  "- Synthetic fixture deliverable with no declared authoring agent identity.",
  "",
  "## Tests",
  "",
  "- Synthetic fixture suite: green.",
  "",
].join("\n");

/** Report stub missing an origin citation: no authority, no mission citation, no cited path. */
const REPORT_NO_ORIGIN_STUB = [
  "# Synthetic Report (fixture)",
  "",
  "- **Team:** H3-992 (Squad J — Governance & documentation)",
  "- **Date:** 2026-10-03",
  "",
  "## Implemented",
  "",
  "- Synthetic fixture deliverable that declares no source.",
  "",
  "## Tests",
  "",
  "- Synthetic fixture suite: green.",
  "",
].join("\n");

/** Report stub missing a verification posture: no status/decision/Tests markers. */
const REPORT_NO_VERIFICATION_STUB = [
  "# Synthetic Report (fixture)",
  "",
  "- **Team:** H3-993 (Squad J — Governance & documentation)",
  "- **Mission:** A-993 — see docs/runbooks/synthetic-drill.md",
  "- **Date:** 2026-10-03",
  "",
  "## Implemented",
  "",
  "- Synthetic fixture deliverable that declares no verification or decision posture.",
  "",
].join("\n");

interface TreeOptions {
  campaignRecord?: boolean;
  rootAuthority?: boolean;
  runbookDate?: boolean;
  runbookFile?: boolean;
  waveDocDate?: boolean;
  reportDate?: boolean;
}

interface Tree {
  root: string;
  artifactsDir: string;
}

const trees: Tree[] = [];

function makeTree(name: string, options: TreeOptions = {}): Tree {
  const root = mkdtempSync(join(tmpdir(), `h3-095-${name}-`));
  const artifactsDir = join(root, "artifacts");
  mkdirSync(artifactsDir, { recursive: true });
  mkdirSync(join(root, "architecture", "adr"), { recursive: true });
  mkdirSync(join(root, "architecture", "campaigns"), { recursive: true });
  mkdirSync(join(root, "architecture", "campaigns", "h3"), { recursive: true });
  mkdirSync(join(root, "architecture", "observability"), { recursive: true });
  mkdirSync(join(root, "docs", "runbooks"), { recursive: true });
  mkdirSync(join(root, "progress", "h3-wave"), { recursive: true });
  if (options.rootAuthority !== false) {
    writeFileSync(join(root, "AGENTS.md"), AGENTS_STUB);
  }
  if (options.campaignRecord !== false) {
    writeFileSync(join(root, "architecture", "campaigns", "H3-WAVE-CAMPAIGN.md"), CAMPAIGN_STUB);
  }
  writeFileSync(join(root, "architecture", "adr", "ADR-990_SYNTHETIC.md"), ADR_STUB);
  writeFileSync(join(root, "architecture", "adr", "TEMPLATE.md"), TEMPLATE_STUB);
  if (options.runbookFile !== false) {
    writeFileSync(
      join(root, "docs", "runbooks", "synthetic-drill.md"),
      RUNBOOK_STUB(options.runbookDate !== false),
    );
  }
  writeFileSync(
    join(root, "architecture", "campaigns", "h3", "synthetic-wave-doc.md"),
    WAVE_DOC_STUB(options.waveDocDate !== false),
  );
  writeFileSync(
    join(root, "progress", "h3-wave", "H3-990.report.md"),
    REPORT_STUB(options.reportDate !== false),
  );
  const tree: Tree = { root, artifactsDir };
  trees.push(tree);
  return tree;
}

beforeAll(() => {
  makeTree("good");
});

afterAll(() => {
  for (const tree of trees) rmSync(tree.root, { recursive: true, force: true });
});

describe("H3-095 provenance checker — CLI exit-code contracts (synthetic tree)", () => {
  it("passes a fully-provenanced tree offline: exit 0, STATUS=PASS, evidence artifacts written", () => {
    const tree = trees[0];
    const run = runScript(["--root", tree.root], { COREGRID_ARTIFACTS_DIR: tree.artifactsDir });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("STATUS=PASS");
    expect(run.stdout).toContain("no network, no database, no credential");

    const record = JSON.parse(
      readFileSync(join(tree.artifactsDir, "provenance-metadata.json"), "utf8"),
    ) as ProvenanceArtifactRecord;
    expect(record.mode).toBe("offline");
    expect(record.networkContact).toBe(false);
    expect(record.databaseContact).toBe(false);
    expect(record.credentialRequired).toBe(false);
    expect(record.findings).toEqual([]);
  });

  it("checks every fixture artifact exactly once across declared classes", () => {
    const tree = trees[0];
    const run = runScript(["--root", tree.root, "--json"], {
      COREGRID_ARTIFACTS_DIR: tree.artifactsDir,
    });
    expect(run.status).toBe(0);
    const payload = parseJson(run.stdout);
    // AGENTS.md + campaign record + 2 ADR files + runbook + wave-doc + report
    expect(payload.checked).toBe(7);
    expect(payload.classCounts).toEqual({
      adr: 1,
      "adr-template": 1,
      "campaign-record": 1,
      "root-authority": 1,
      runbook: 1,
      "wave-doc": 1,
      "wave-report": 1,
    });
    expect(payload.findings).toEqual([]);
    expect(payload.advisories).toEqual([]);
  });

  it("fails closed with a creator FINDING when no agent identity is attributed (exit 1)", () => {
    const tree = makeTree("no-creator");
    writeFileSync(
      join(tree.root, "progress", "h3-wave", "H3-991.report.md"),
      REPORT_NO_CREATOR_STUB,
    );
    const run = runScript(["--root", tree.root, "--json"], {
      COREGRID_ARTIFACTS_DIR: tree.artifactsDir,
    });
    expect(run.status).toBe(1);
    const payload = parseJson(run.stdout);
    const finding = findingFor(payload, "progress/h3-wave/H3-991.report.md");
    expect(finding).toBeDefined();
    expect(finding?.artifactClass).toBe("wave-report");
    expect(finding?.missing).toContain("creator");
    expect(finding?.missing).not.toContain("origin");
    expect(finding?.missing).not.toContain("verification");
  });

  it("fails closed with an origin FINDING when nothing is cited (exit 1)", () => {
    const tree = makeTree("no-origin");
    writeFileSync(
      join(tree.root, "progress", "h3-wave", "H3-992.report.md"),
      REPORT_NO_ORIGIN_STUB,
    );
    const run = runScript(["--root", tree.root, "--json"], {
      COREGRID_ARTIFACTS_DIR: tree.artifactsDir,
    });
    expect(run.status).toBe(1);
    const payload = parseJson(run.stdout);
    const finding = findingFor(payload, "progress/h3-wave/H3-992.report.md");
    expect(finding?.missing).toContain("origin");
    expect(finding?.missing).not.toContain("creator");
  });

  it("recognizes an explicitly attributed GitHub Copilot coding-agent identity", () => {
    const tree = makeTree("copilot-creator");
    const attributed = ADR_STUB.replace(
      "| Author | SYNTHETIC STRATEGIST (TEAM H3-990, A-990) |",
      "| Author | `copilot-swe-agent[bot]` (GitHub Copilot Coding Agent) |",
    );
    writeFileSync(join(tree.root, "architecture", "adr", "ADR-991_COPILOT.md"), attributed);
    const run = runScript(["--root", tree.root, "--json"], {
      COREGRID_ARTIFACTS_DIR: tree.artifactsDir,
    });
    expect(run.status).toBe(0);
    expect(
      findingFor(parseJson(run.stdout), "architecture/adr/ADR-991_COPILOT.md"),
    ).toBeUndefined();
  });

  it("fails closed with a verification FINDING when no decision posture is declared (exit 1)", () => {
    const tree = makeTree("no-verification");
    writeFileSync(
      join(tree.root, "progress", "h3-wave", "H3-993.report.md"),
      REPORT_NO_VERIFICATION_STUB,
    );
    const run = runScript(["--root", tree.root, "--json"], {
      COREGRID_ARTIFACTS_DIR: tree.artifactsDir,
    });
    expect(run.status).toBe(1);
    const payload = parseJson(run.stdout);
    const finding = findingFor(payload, "progress/h3-wave/H3-993.report.md");
    expect(finding?.missing).toContain("verification");
    expect(finding?.missing).not.toContain("origin");
    expect(finding?.missing).not.toContain("creator");
  });

  it("requires an inline date for ADRs (authority artifacts get no wave inheritance)", () => {
    const tree = makeTree("adr-undated");
    const undated = ADR_STUB.replace("| Date | 2026-10-03 |", "| Date | (omitted by fixture) |");
    writeFileSync(join(tree.root, "architecture", "adr", "ADR-991_UNDATED.md"), undated);
    const run = runScript(["--root", tree.root, "--json"], {
      COREGRID_ARTIFACTS_DIR: tree.artifactsDir,
    });
    expect(run.status).toBe(1);
    const payload = parseJson(run.stdout);
    const finding = findingFor(payload, "architecture/adr/ADR-991_UNDATED.md");
    expect(finding?.artifactClass).toBe("adr");
    expect(finding?.missing).toContain("createdAt");
    // the sibling dated ADR stays clean — the finding is per-artifact, not per-class
    expect(findingFor(payload, "architecture/adr/ADR-990_SYNTHETIC.md")).toBeUndefined();
  });

  it("wave-inherits dating from the campaign record: undated wave artifact stays PASS with an advisory", () => {
    const tree = makeTree("undated-runbook", { runbookDate: false });
    const run = runScript(["--root", tree.root, "--json"], {
      COREGRID_ARTIFACTS_DIR: tree.artifactsDir,
    });
    expect(run.status).toBe(0);
    const payload = parseJson(run.stdout);
    expect(payload.findings).toEqual([]);
    expect(payload.advisories).toHaveLength(1);
    expect(payload.advisories[0]).toContain("docs/runbooks/synthetic-drill.md");
    expect(payload.advisories[0]).toContain("wave-inheritance");
  });

  it("fails closed when the campaign record anchor is missing: wave inheritance collapses", () => {
    const tree = makeTree("no-campaign", {
      campaignRecord: false,
      runbookDate: false,
      waveDocDate: false,
      reportDate: false,
    });
    const run = runScript(["--root", tree.root, "--json"], {
      COREGRID_ARTIFACTS_DIR: tree.artifactsDir,
    });
    expect(run.status).toBe(1);
    const payload = parseJson(run.stdout);
    expect(findingFor(payload, "architecture/campaigns/H3-WAVE-CAMPAIGN.md")).toBeDefined();
    for (const rel of [
      "docs/runbooks/synthetic-drill.md",
      "architecture/campaigns/h3/synthetic-wave-doc.md",
      "progress/h3-wave/H3-990.report.md",
    ]) {
      const finding = findingFor(payload, rel);
      expect(finding?.missing, rel).toContain("createdAt");
    }
  });

  it("fails closed when the root-authority anchor is missing", () => {
    const tree = makeTree("no-agents", { rootAuthority: false });
    const run = runScript(["--root", tree.root, "--json"], {
      COREGRID_ARTIFACTS_DIR: tree.artifactsDir,
    });
    expect(run.status).toBe(1);
    const payload = parseJson(run.stdout);
    const finding = findingFor(payload, "AGENTS.md");
    expect(finding?.missing[0]).toContain("anchor artifact missing");
  });

  it("fails closed when a declared class root directory is missing (no silent scope shrink)", () => {
    const tree = makeTree("no-runbook-root", { runbookFile: false });
    rmSync(join(tree.root, "docs", "runbooks"), { recursive: true, force: true });
    const run = runScript(["--root", tree.root, "--json"], {
      COREGRID_ARTIFACTS_DIR: tree.artifactsDir,
    });
    expect(run.status).toBe(1);
    const payload = parseJson(run.stdout);
    const finding = findingFor(payload, "docs/runbooks");
    expect(finding?.artifactClass).toBe("inventory");
    expect(finding?.missing[0]).toContain("class root directory missing");
  });

  it("rejects unknown arguments with BLOCKED_USAGE (exit 2)", () => {
    const run = runScript(["--rehearse"]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("BLOCKED_USAGE");
  });

  it("fails closed on a missing --root value and a nonexistent root (exit 2)", () => {
    expect(runScript(["--root"]).status).toBe(2);
    const blocked = runScript(["--root", join(tmpdir(), "h3-095-does-not-exist")]);
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toContain("BLOCKED_SCAN");
  });

  it("an unwritable artifacts directory degrades to a warning without corrupting the verdict", () => {
    const tree = trees[0];
    const notADirectory = join(tree.root, "artifacts-blocker");
    writeFileSync(notADirectory, "occupied by a regular file");
    const run = runScript(["--root", tree.root], { COREGRID_ARTIFACTS_DIR: notADirectory });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("WARN artifact write failed");
    expect(run.stdout).toContain("STATUS=PASS");
  });
});

describe("H3-095 provenance checker — real repository (read-only, offline)", () => {
  it("PASSes the checked-in governance inventory with zero findings", () => {
    const run = runScript(["--json"]);
    expect(run.status).toBe(0);
    const payload = parseJson(run.stdout);
    expect(payload.checked).toBeGreaterThanOrEqual(150);
    expect(payload.findings).toEqual([]);
    expect(payload.scanErrors).toEqual([]);
    expect(payload.classCounts["root-authority"]).toBe(1);
    expect(payload.classCounts["campaign-record"]).toBe(1);
    expect(payload.classCounts["wave-report"]).toBeGreaterThanOrEqual(90);
    expect(payload.classCounts["runbook"]).toBeGreaterThanOrEqual(12);
    expect(payload.classCounts["adr"]).toBeGreaterThanOrEqual(1);
  });

  it("covers the key governance anchors and exemplar artifacts", () => {
    const run = runScript(["--json"]);
    expect(run.status).toBe(0);
    const payload = parseJson(run.stdout);
    const files = new Set(payload.findings.map((f) => f.file));
    for (const rel of [
      "AGENTS.md",
      "architecture/campaigns/H3-WAVE-CAMPAIGN.md",
      "architecture/adr/ADR-011_BACKUP_EXPIRY_DISCIPLINE.md",
      "docs/runbooks/recovery-drill.md",
      "docs/runbooks/restore-recovery.md",
      "progress/h3-wave/H3-001.report.md",
      "progress/h3-wave/H3-085.report.md",
      "progress/h3-wave/H3-095.report.md",
    ]) {
      expect(files.has(rel), `unexpected finding for ${rel}`).toBe(false);
    }
  });

  it("discloses wave-inherited dating as advisories without weakening the verdict", () => {
    const run = runScript(["--json"]);
    expect(run.status).toBe(0);
    const payload = parseJson(run.stdout);
    // the wave convention dates artifacts through the dated campaign record;
    // artifacts relying on inheritance must be disclosed, never silently OK
    for (const advisory of payload.advisories) {
      expect(advisory).toContain("wave-inheritance");
    }
  });
});

describe("H3-095 provenance checker — tool hygiene (AGENTS §29/§30)", () => {
  it("is fully offline: no network transports, no child processes, no database clients", () => {
    expect(SCRIPT_SOURCE).not.toMatch(/child_process/i);
    expect(SCRIPT_SOURCE).not.toMatch(/\bfetch\s*\(/);
    expect(SCRIPT_SOURCE).not.toMatch(/node:(?:http|https|net|dns|tls)\b/);
    expect(SCRIPT_SOURCE).not.toMatch(/\b(?:supabase|postgres|mysql|mongodb)\b/i);
  });

  it("never references credential material and documents its no-credential contract", () => {
    expect(SCRIPT_SOURCE).not.toMatch(/SUPABASE_ACCESS_TOKEN|API_KEY|SECRET_|PASSWORD/);
    expect(SCRIPT_SOURCE).toContain("no network, no database, no credential");
  });
});
