/**
 * CoreGrid — phase acceptance probe tests (wave AUDIT-P01).
 *
 * A pasted phase document states acceptance criteria; the probe resolves each one
 * against real artefacts and classifies it. These tests keep that probe honest:
 *
 *  - it runs clean for the audited phase and writes a proof bound to the same run;
 *  - ENFORCED may never rest on a document: the executable evidence is re-derived
 *    from the phase's acceptance data independently of the script's own verdict;
 *  - every evidence path the proof cites exists on disk;
 *  - a REQUIRED acceptance area with no evidence fails the probe rather than being
 *    quietly accepted;
 *  - incomplete areas are reported as DECLARED/MISSING, never dressed up.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DATA_REF = "architecture/phase-acceptance/phase-01-foundation.json";
const PROOF_REF = "architecture/proofs/phase-01-acceptance.proof.json";
const EXECUTABLE_KINDS = ["test", "script", "migration", "policy", "config", "contract"];
const CLASSIFICATIONS = ["ENFORCED", "DECLARED", "IMPLEMENTED_UNWIRED", "MISSING"];

interface EvidenceEntry {
  kind: string;
  path: string;
  contains?: string;
}
interface AreaData {
  id: string;
  area: string;
  requirement: string;
  required?: boolean;
  evidence: EvidenceEntry[];
  boundary?: EvidenceEntry[];
}
interface AreaRow {
  id: string;
  area: string;
  required: boolean;
  classification: string;
  declaredEvidence: string[];
  matchedEvidence: string[];
  unresolvedEvidence: string[];
  declaredBoundary: string[];
  boundaryEvidence: string[];
}
interface AcceptanceProof {
  artifact: string;
  phase: string;
  source: string | null;
  classificationDefinitions: Record<string, string>;
  summary: {
    areas: number;
    enforced: number;
    declared: number;
    implementedUnwired: number;
    implementedUnwiredAreas: string[];
    missing: number;
    missingRequired: string[];
    unresolvedEvidencePaths: string[];
  };
  ownership: { canonicalOwners: Record<string, string> } | null;
  areas: AreaRow[];
  ok: boolean;
  limitations: string[];
}

const loadData = () =>
  JSON.parse(readFileSync(join(ROOT, DATA_REF), "utf8")) as { areas: AreaData[] };
const loadProof = () => JSON.parse(readFileSync(join(ROOT, PROOF_REF), "utf8")) as AcceptanceProof;

describe("AUDIT-P01 — the phase acceptance probe is executable", () => {
  it("runs cleanly for phase 01 and reports every classification", () => {
    const output = execFileSync("node", ["scripts/audit-phase-acceptance.mjs", "--phase=01"], {
      encoding: "utf8",
      cwd: ROOT,
    });
    expect(output).toMatch(/Phase 01 — Foundation: \d+ acceptance area\(s\)/);
    for (const classification of CLASSIFICATIONS) {
      expect(output).toContain(classification);
    }
    expect(output).toContain("Proof written: architecture/proofs/phase-01-acceptance.proof.json");
  });

  it("classifies every declared acceptance area exactly once", () => {
    const data = loadData();
    const proof = loadProof();
    expect(proof.artifact).toBe("phase-acceptance");
    expect(proof.phase).toBe("01");
    expect(proof.source).toBe("architecture/phase-01-foundation.md");
    expect(proof.areas).toHaveLength(data.areas.length);
    expect(new Set(proof.areas.map((row) => row.id)).size).toBe(data.areas.length);
    for (const classification of CLASSIFICATIONS) {
      expect(proof.classificationDefinitions[classification], classification).toBeTruthy();
    }
    expect(proof.summary.areas).toBe(proof.areas.length);
    expect(
      proof.summary.enforced +
        proof.summary.declared +
        proof.summary.implementedUnwired +
        proof.summary.missing,
    ).toBe(proof.areas.length);
    expect(proof.summary.implementedUnwired).toBe(proof.summary.implementedUnwiredAreas.length);
  });

  it("every acceptance area declares evidence and every matched path exists", () => {
    const data = loadData();
    const proof = loadProof();
    const declared = new Map(data.areas.map((area) => [area.id, area.evidence.map((e) => e.path)]));
    for (const row of proof.areas) {
      const declaredPaths = declared.get(row.id) ?? [];
      // An area is only auditable if it says what would prove it.
      expect(declaredPaths.length, `${row.id} declares no evidence`).toBeGreaterThan(0);
      expect(row.declaredEvidence).toEqual(declaredPaths);
      for (const ref of row.matchedEvidence) {
        expect(declaredPaths, `${row.id} matched undeclared ${ref}`).toContain(ref);
        expect(existsSync(join(ROOT, ref)), `${row.id} cites missing artefact ${ref}`).toBe(true);
      }
      // A declared path that is absent from the repository is a data defect.
      expect(row.unresolvedEvidence).toEqual([]);
    }
    expect(proof.summary.unresolvedEvidencePaths).toEqual([]);
  });

  it("re-derives ENFORCED from executable evidence, never from documents", () => {
    const data = loadData();
    const proof = loadProof();
    const byId = new Map(data.areas.map((area) => [area.id, area]));
    const enforced = proof.areas.filter((row) => row.classification === "ENFORCED");
    expect(enforced.length).toBeGreaterThan(0);
    for (const row of enforced) {
      const area = byId.get(row.id);
      expect(area, `${row.id} must exist in the acceptance data`).toBeTruthy();
      const executable = (area?.evidence ?? []).filter((entry) =>
        EXECUTABLE_KINDS.includes(entry.kind),
      );
      expect(
        executable.length,
        `${row.id} is ENFORCED without executable evidence`,
      ).toBeGreaterThan(0);
      for (const entry of executable) {
        expect(existsSync(join(ROOT, entry.path)), `${row.id} cites missing ${entry.path}`).toBe(
          true,
        );
      }
    }
    // Anything without executable evidence must be reported, not promoted.
    for (const row of proof.areas) {
      const area = byId.get(row.id);
      const executable = (area?.evidence ?? []).filter((entry) =>
        EXECUTABLE_KINDS.includes(entry.kind),
      );
      if (executable.length === 0) {
        expect(["DECLARED", "MISSING"], `${row.id} cannot be ENFORCED`).toContain(
          row.classification,
        );
      }
    }
  });

  it("never calls an unwired capability enforced, and proves the boundary was probed", () => {
    const data = loadData();
    const proof = loadProof();
    const byId = new Map(data.areas.map((area) => [area.id, area]));
    const unwired = proof.areas.filter((row) => row.classification === "IMPLEMENTED_UNWIRED");
    expect(unwired.length).toBe(proof.summary.implementedUnwired);
    for (const row of unwired) {
      const area = byId.get(row.id);
      // Unwired means: implementation exists, boundary patterns were declared and matched nothing.
      expect(
        (area?.boundary ?? []).length,
        `${row.id} must declare a boundary probe`,
      ).toBeGreaterThan(0);
      expect(row.declaredBoundary.length).toBe((area?.boundary ?? []).length);
      expect(row.boundaryEvidence, `${row.id} has a matched boundary — it is not unwired`).toEqual(
        [],
      );
      expect(
        row.matchedEvidence.length,
        `${row.id} must still show its implementation`,
      ).toBeGreaterThan(0);
    }
    // And the converse: an area classified ENFORCED with a declared boundary must show the match.
    for (const row of proof.areas) {
      const area = byId.get(row.id);
      if (row.classification === "ENFORCED" && (area?.boundary ?? []).length > 0) {
        expect(
          row.boundaryEvidence.length,
          `${row.id} claims ENFORCED without a boundary match`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("fails on a REQUIRED area with no evidence, and reports it when it does", () => {
    const proof = loadProof();
    const requiredMissing = proof.areas.filter(
      (row) => row.required && row.classification === "MISSING",
    );
    expect(proof.summary.missingRequired).toEqual(requiredMissing.map((row) => row.id));
    // Phase 01's mandatory §100 areas are all evidenced today.
    expect(requiredMissing).toEqual([]);
    expect(proof.ok).toBe(true);
  });

  it("covers the foundations the Phase 01 document makes non-negotiable", () => {
    const proof = loadProof();
    const ids = proof.areas.map((row) => row.id);
    for (const mandatory of [
      "identity",
      "organizations",
      "tenants",
      "memberships",
      "roles",
      "policies",
      "rbac",
      "abac",
      "pbac",
      "rebac",
      "rls",
      "data-classification",
      "privacy",
      "audit",
      "observability",
      "ai-governance",
      "agent-identity",
      "twin-identity",
      "api-validation",
      "testing",
      "migration-discipline",
      "environment-separation",
      "secret-management",
      "default-deny",
      "human-approval",
      "no-universal-admin-api",
    ]) {
      expect(ids, `${mandatory} must be audited`).toContain(mandatory);
    }
  });

  it("records ownership so acceptance never implies implementation ownership", () => {
    const proof = loadProof();
    const owners = proof.ownership?.canonicalOwners ?? {};
    expect(owners.identity).toBe("02");
    expect(owners.tenancy).toBe("03");
    expect(owners["authorization-enforcement"]).toBe("08");
    expect(owners["digital-twin"]).toBe("16");
    expect(owners["ai-gateway"]).toBe("26");
    expect(owners["foundation-standards-config-secrets-ci"]).toBe("01");
  });

  it("reports incompleteness honestly instead of claiming completeness", () => {
    const proof = loadProof();
    const limitations = proof.limitations.join(" ");
    expect(limitations).toMatch(/DECLARED area is unfinished work/i);
    expect(limitations).toMatch(/not the correctness/i);
    expect(limitations).toMatch(/IMPLEMENTED_UNWIRED area has a tested implementation/i);

    // Every kind of incompleteness must be reported consistently with its own list,
    // and the console report must name the unwired areas rather than hide them.
    expect(proof.summary.implementedUnwired).toBe(proof.summary.implementedUnwiredAreas.length);
    expect(proof.summary.missing).toBe(
      proof.areas.filter((row) => row.classification === "MISSING").length,
    );
    const output = execFileSync("node", ["scripts/audit-phase-acceptance.mjs", "--phase=01"], {
      encoding: "utf8",
      cwd: ROOT,
    });
    if (proof.summary.implementedUnwired > 0) {
      expect(output).toContain("Implemented and tested, but no boundary invokes it yet");
      for (const id of proof.summary.implementedUnwiredAreas) expect(output).toContain(id);
    }
    const remaining =
      proof.summary.declared + proof.summary.missing + proof.summary.implementedUnwired;
    if (remaining === 0) {
      expect(proof.summary.enforced).toBe(proof.summary.areas);
    } else {
      expect(output).toMatch(/DECLARED|UNWIRED|No evidence found/);
    }
  });
});
