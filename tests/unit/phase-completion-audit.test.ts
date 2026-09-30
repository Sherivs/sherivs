/**
 * CoreGrid — phase completion audit tests (wave AUDIT-1).
 *
 * The Constitution defines an evidence-derived five-level maturity model and a
 * Phase Completion Gate. These tests make that gate enforceable:
 *
 *  - the auditor runs clean and never accuses without proof;
 *  - the registry may not claim a level the artefacts cannot support (claims it
 *    cannot evidence are recorded as UNKNOWN-class review items, not failures);
 *  - provable defects DO fail: a contract citing a test artifact that is not in
 *    the repository, or a registry phase with no architecture document;
 *  - the generated status table and proof stay bound to the same evidence run;
 *  - completeness is reported honestly (incomplete work is never dressed up).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PROOF_REF = "architecture/proofs/phase-completion.proof.json";
const STATUS_REF = "architecture/phase-completion-status.md";
const LEVELS = [
  "L1 conceptual",
  "L2 data model",
  "L3 backend",
  "L4 frontend/workspace integration",
  "L5 operational maturity",
];

interface PhaseRow {
  id: string;
  name: string;
  capability: string | null;
  sections: string;
  modules: string[];
  modulesResolve: boolean;
  citedTestFiles: number;
  testsCounted: number;
  evidence: Record<string, boolean>;
  exemptedLevels: string[];
  registryLevels: boolean[];
  registryStatus: string;
  derivedStatus: string;
  complete: boolean;
  missingLevels: string[];
  unconfirmedLevels: string[];
}
interface AuditProof {
  artifact: string;
  wave: string;
  levelDefinitions: Record<string, string>;
  summary: {
    phasesAudited: number;
    complete: number;
    implementing: number;
    architectureDefined: number;
    withModules: number;
    withResolvedModules: number;
    totalTestsCited: number;
    registryBeyondAudit: string[];
    unconfirmedClaims: { id: string; levels: string[] }[];
    exemptionsApplied?: { phase: string; level: string }[];
    exemptionSource?: string;
    missingLevelFrequency: Record<string, number>;
  };
  phases: PhaseRow[];
  inconsistencies: string[];
  ok: boolean;
  limitations: string[];
}

const load = () => JSON.parse(readFileSync(join(ROOT, PROOF_REF), "utf8")) as AuditProof;
const read = (ref: string) => readFileSync(join(ROOT, ref), "utf8").replace(/\r\n/g, "\n");

describe("AUDIT-1 — the phase completion gate is executable", () => {
  it("runs cleanly and reports the five derived levels", { timeout: 120_000 }, () => {
    const output = execFileSync("node", ["scripts/audit-phase-completion.mjs"], {
      encoding: "utf8",
      cwd: ROOT,
    });
    expect(output).toMatch(/Audited 51 phases/);
    expect(output).toContain("COMPLETE");
    expect(output).toContain("Modules resolve:");
    expect(output).not.toContain("INCONSISTENT");
  });

  it("audits every registered phase exactly once", () => {
    const proof = load();
    expect(proof.artifact).toBe("phase-completion");
    expect(proof.summary.phasesAudited).toBe(51);
    expect(proof.phases).toHaveLength(51);
    expect(new Set(proof.phases.map((row) => row.id)).size).toBe(51);
    for (const level of LEVELS) {
      expect(proof.levelDefinitions[level], `${level} must be defined`).toBeTruthy();
    }
  });

  it("derives each level from artefacts, not from the registry claim", () => {
    for (const row of load().phases) {
      for (const level of LEVELS) {
        expect(typeof row.evidence[level]).toBe("boolean");
      }
      // A phase cannot be marked COMPLETE while a level is unevidenced and
      // unexempted; and completion always requires at least three evidenced levels.
      if (row.complete) {
        expect(LEVELS.filter((level) => row.evidence[level]).length).toBeGreaterThanOrEqual(3);
        for (const level of LEVELS) {
          expect(
            row.evidence[level] || (row.exemptedLevels ?? []).includes(level),
            `${row.id}: ${level} must be evidenced or explicitly exempted`,
          ).toBe(true);
        }
        expect(row.missingLevels).toEqual([]);
      } else {
        expect(row.missingLevels.length).toBeGreaterThan(0);
      }
      expect(["COMPLETE", "IMPLEMENTING", "ARCHITECTURE_DEFINED"]).toContain(row.derivedStatus);
    }
  });

  it("fails only on provable defects, never on incompleteness", () => {
    const proof = load();
    expect(proof.inconsistencies).toEqual([]);
    expect(proof.ok).toBe(true);
    // Incomplete phases are the normal state of an evolving platform.
    expect(proof.summary.complete).toBeLessThan(proof.summary.phasesAudited);
    expect(proof.limitations.join(" ")).toMatch(/incompleteness is reported, never failed/i);
  });

  it("keeps the generated status table in step with the proof", () => {
    const proof = load();
    const table = read(STATUS_REF);
    expect(table).toContain("GENERATED by scripts/audit-phase-completion.mjs");
    expect(table).toContain(
      `COMPLETE: ${proof.summary.complete} · IMPLEMENTING: ${proof.summary.implementing} · ARCHITECTURE_DEFINED: ${proof.summary.architectureDefined}`,
    );
    for (const row of proof.phases) {
      expect(table, `phase ${row.id} must appear in the status table`).toContain(`| ${row.id} |`);
    }
    expect(table).toContain("## Provable inconsistencies (these fail the gate)");
    expect(table).toContain("## Missing levels (frequency across phases)");
  });

  it("counts real tests only where contract-cited test files exist", () => {
    const proof = load();
    const withTests = proof.phases.filter((row) => row.citedTestFiles > 0);
    expect(withTests.length).toBeGreaterThan(0);
    expect(proof.summary.totalTestsCited).toBe(
      withTests.reduce((total, row) => total + row.testsCounted, 0),
    );
  });

  it("records stale and unconfirmed registry claims instead of hiding them", () => {
    const proof = load();
    expect(Array.isArray(proof.summary.registryBeyondAudit)).toBe(true);
    expect(Array.isArray(proof.summary.unconfirmedClaims)).toBe(true);
    // Every unconfirmed claim names the level it could not evidence.
    for (const claim of proof.summary.unconfirmedClaims) {
      expect(claim.levels.length).toBeGreaterThan(0);
      for (const level of claim.levels) expect(LEVELS).toContain(level);
    }
    expect(proof.summary.missingLevelFrequency).toBeTruthy();
  });

  it("only honours fully justified exemptions, and never to hide evidence (BR-01)", () => {
    const proof = load();
    const source = JSON.parse(read("architecture/phase-completion-exemptions.json")) as {
      exemptions: {
        phase: string;
        level: string;
        reason?: string;
        owner?: string;
        closesWhen?: string;
        ratified?: boolean;
      }[];
    };

    // Every declared exemption is justified and ratified in the source file.
    expect(source.exemptions.length).toBeGreaterThan(0);
    for (const exemption of source.exemptions) {
      expect(exemption.reason, `${exemption.phase}/${exemption.level} reason`).toBeTruthy();
      expect(exemption.owner, `${exemption.phase}/${exemption.level} owner`).toBeTruthy();
      expect(exemption.closesWhen, `${exemption.phase}/${exemption.level} closesWhen`).toBeTruthy();
      expect(exemption.ratified).toBe(true);
      expect(LEVELS).toContain(exemption.level);
    }

    // Applied exemptions appear in the proof, and the exempted level has NO evidence:
    // an exemption on an evidenced level would be hiding work, and the audit fails it.
    const applied = proof.summary.exemptionsApplied ?? [];
    expect(applied.length).toBe(source.exemptions.length);
    for (const row of proof.phases) {
      for (const level of row.exemptedLevels ?? []) {
        expect(row.evidence[level], `${row.id}/${level} has evidence — delete the exemption`).toBe(
          false,
        );
      }
      // A COMPLETE phase needs every level evidenced or explicitly exempted, and
      // must still evidence at least three levels of its own.
      if (row.complete) {
        const evidenced = LEVELS.filter((level) => row.evidence[level]).length;
        expect(evidenced).toBeGreaterThanOrEqual(3);
        for (const level of LEVELS) {
          expect(row.evidence[level] || (row.exemptedLevels ?? []).includes(level)).toBe(true);
        }
      }
    }
  });
});
