/**
 * CoreGrid — every phase acceptance probe must stay honest (wave AUDIT-P02/P03).
 *
 * Phase 01 proved the probe mechanism; phases 02 and 03 add data files. This test
 * is the durable guard for ALL probes: it discovers every
 * `architecture/phase-acceptance/phase-<id>-*.json`, requires a matching proof, and
 * re-derives the classification contract for each one:
 *
 *  - every declared evidence path resolves in the repository;
 *  - every matched path exists and is declared;
 *  - an area may only be ENFORCED on executable evidence (and, where a boundary is
 *    declared, a boundary that actually matched);
 *  - an area with no executable evidence is reported as DECLARED or MISSING;
 *  - a REQUIRED area may never be MISSING;
 *  - no probe may claim it is okay while a required area lacks evidence.
 *
 * Adding a phase probe therefore adds coverage without touching this file.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DATA_DIR = join(ROOT, "architecture/phase-acceptance");
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
  required?: boolean;
  evidence: EvidenceEntry[];
  boundary?: EvidenceEntry[];
}
interface AreaRow {
  id: string;
  required: boolean;
  classification: string;
  declaredEvidence: string[];
  matchedEvidence: string[];
  unresolvedEvidence: string[];
  declaredBoundary: string[];
  boundaryEvidence: string[];
}
interface Proof {
  artifact: string;
  phase: string;
  summary: {
    areas: number;
    enforced: number;
    declared: number;
    implementedUnwired: number;
    missing: number;
    missingRequired: string[];
    unresolvedEvidencePaths: string[];
  };
  areas: AreaRow[];
  ok: boolean;
  limitations: string[];
}

const probes = readdirSync(DATA_DIR)
  .filter((name) => /^phase-\d{2}-.+\.json$/.test(name))
  .map((name) => ({ file: name, id: name.slice(6, 8) }))
  .sort((a, b) => a.id.localeCompare(b.id));

const loadData = (file: string) =>
  JSON.parse(readFileSync(join(DATA_DIR, file), "utf8")) as { areas: AreaData[] };
const loadProof = (id: string) =>
  JSON.parse(
    readFileSync(join(ROOT, `architecture/proofs/phase-${id}-acceptance.proof.json`), "utf8"),
  ) as Proof;

/** Evidence references may be globs (e.g. `frontend/src/routes/*.tsx`); resolve both forms. */
function referenceResolves(ref: string): boolean {
  if (!ref.includes("*")) return existsSync(join(ROOT, ref));
  const slash = ref.lastIndexOf("/");
  const dir = join(ROOT, ref.slice(0, slash));
  const pattern = ref.slice(slash + 1);
  if (!existsSync(dir)) return false;
  const regex = new RegExp(
    `^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
  );
  return readdirSync(dir).some((name) => regex.test(name));
}

describe("AUDIT-P02/P03 — every phase acceptance probe is honest", () => {
  it("discovers the probes and finds a proof for each", () => {
    expect(probes.length).toBeGreaterThanOrEqual(3);
    for (const probe of probes) {
      expect(
        existsSync(join(ROOT, `architecture/proofs/phase-${probe.id}-acceptance.proof.json`)),
        `phase ${probe.id} has no acceptance proof — run npm run audit:phase -- --phase=${probe.id}`,
      ).toBe(true);
    }
  });

  for (const probe of probes) {
    it(`phase ${probe.id}: classification, evidence paths and required areas hold`, () => {
      const data = loadData(probe.file);
      const proof = loadProof(probe.id);
      const byId = new Map(data.areas.map((area) => [area.id, area]));

      expect(proof.artifact).toBe("phase-acceptance");
      expect(proof.phase).toBe(probe.id);
      expect(proof.areas).toHaveLength(data.areas.length);
      expect(proof.summary.areas).toBe(proof.areas.length);
      expect(
        proof.summary.enforced +
          proof.summary.declared +
          proof.summary.implementedUnwired +
          proof.summary.missing,
      ).toBe(data.areas.length);
      expect(proof.summary.missingRequired).toEqual([]);
      expect(proof.summary.unresolvedEvidencePaths).toEqual([]);
      expect(proof.ok).toBe(true);
      expect(proof.limitations.join(" ")).toMatch(
        /IMPLEMENTED_UNWIRED area has a tested implementation/i,
      );

      for (const row of proof.areas) {
        const area = byId.get(row.id);
        expect(area, `phase ${probe.id}: ${row.id} missing from data`).toBeTruthy();
        expect(CLASSIFICATIONS, `phase ${probe.id}: ${row.id}`).toContain(row.classification);

        // Declared evidence must equal the data, and resolve on disk.
        expect(row.declaredEvidence).toEqual((area?.evidence ?? []).map((entry) => entry.path));
        expect(row.declaredBoundary).toEqual((area?.boundary ?? []).map((entry) => entry.path));
        expect(row.unresolvedEvidence).toEqual([]);
        for (const ref of row.matchedEvidence) {
          expect(referenceResolves(ref), `phase ${probe.id}: ${row.id} cites missing ${ref}`).toBe(
            true,
          );
        }
        for (const ref of row.boundaryEvidence) {
          expect(referenceResolves(ref), `phase ${probe.id}: ${row.id} boundary ${ref}`).toBe(true);
        }

        const executable = (area?.evidence ?? []).filter((entry) =>
          EXECUTABLE_KINDS.includes(entry.kind),
        );
        if (row.classification === "ENFORCED") {
          expect(
            executable.length,
            `phase ${probe.id}: ${row.id} claims ENFORCED without executable evidence`,
          ).toBeGreaterThan(0);
          if ((area?.boundary ?? []).length > 0) {
            expect(
              row.boundaryEvidence.length,
              `phase ${probe.id}: ${row.id} claims ENFORCED without a boundary match`,
            ).toBeGreaterThan(0);
          }
        } else if (row.classification === "IMPLEMENTED_UNWIRED") {
          expect(
            executable.length,
            `phase ${probe.id}: ${row.id} unwired needs a tested implementation`,
          ).toBeGreaterThan(0);
          expect(
            (area?.boundary ?? []).length,
            `phase ${probe.id}: ${row.id} unwired needs a boundary probe`,
          ).toBeGreaterThan(0);
          expect(row.boundaryEvidence).toEqual([]);
        }
      }
    });
  }
});
