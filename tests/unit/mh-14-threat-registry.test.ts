/**
 * CoreGrid — MISSION H2-14 threat-mitigation registry machine check.
 *
 * Parses architecture/coregrid-mvp-architecture/security/THREAT_MITIGATIONS_LT.md
 * and asserts the roadmap-bounded threat bundle L-T-001..014 is COMPLETE and
 * honestly classified:
 *
 *  1. every in-scope threat id has its own record section;
 *  2. every record carries the mandatory fields: Threat, Evidence, Verdict,
 *     Enforcing mechanism, Proof test;
 *  3. every verdict is one of the three legal tokens (ENFORCED | PARTIAL |
 *     OPEN) — no free-form, no absent verdict;
 *  4. an ENFORCED verdict must cite a concrete proof (a tests/ or scripts/
 *     path, or an executed evidence artifact) — "enforced without evidence"
 *     is machine-rejected;
 *  5. a PARTIAL or OPEN verdict must name its OPEN remainder with an owner
 *     (Owner/owner-proposal) — an open gap without an owner is rejected;
 *  6. out-of-scope threats L-T-015/L-T-016 (present in the source registry
 *     analyses.threat[]) are explicitly declared in the scope note — they
 *     may neither be silently claimed nor silently dropped.
 *
 * Evidence citations (Constitution §12 provenance): the source registry is
 * COREGRID_V1_ARCHITECTURE_HARDENING.json analyses.threat[]; the bundle scope
 * is COREGRID_V1_BUILD_ROADMAP.md ("threat mitigations L-T-001..014").
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const DOC_PATH = path.resolve(
  import.meta.dirname,
  "../../architecture/coregrid-mvp-architecture/security/THREAT_MITIGATIONS_LT.md",
);

const SOURCE_REGISTRY = path.resolve(
  import.meta.dirname,
  "../../architecture/coregrid-mvp-architecture/reconstruction/COREGRID_V1_ARCHITECTURE_HARDENING.json",
);

const ROADMAP = path.resolve(
  import.meta.dirname,
  "../../architecture/coregrid-mvp-architecture/COREGRID_V1_BUILD_ROADMAP.md",
);

/** The roadmap-bounded bundle: L-T-001 .. L-T-014 (H2-14 mission scope). */
const IN_SCOPE_IDS: readonly string[] = Array.from({ length: 14 }, (_, i) => `L-T-${String(i + 1).padStart(3, "0")}`);

/** Out-of-scope threats carried by the same source registry (must be disclaimed). */
const OUT_OF_SCOPE_IDS: readonly string[] = ["L-T-015", "L-T-016"];

const LEGAL_VERDICTS: readonly string[] = ["ENFORCED", "PARTIAL", "OPEN"];

const doc = readFileSync(DOC_PATH, "utf8");

interface ThreatRecord {
  id: string;
  section: string;
  verdict: string;
}

function sectionFor(id: string): string | null {
  const start = doc.indexOf(`## ${id} —`);
  if (start === -1) return null;
  const next = doc.indexOf("\n## ", start + 1);
  return doc.slice(start, next === -1 ? doc.length : next);
}

function fieldLine(section: string, label: string): string | null {
  const marker = new RegExp(`- \\*\\*${label}\\s*(\\([^)]*\\))?:\\*\\*`);
  const match = section.match(marker);
  if (!match || match.index === undefined) return null;
  const start = match.index;
  const next = section.indexOf("\n- **", start + 1);
  return section.slice(start, next === -1 ? section.length : next);
}

function extractVerdict(section: string): string | null {
  const line = fieldLine(section, "Verdict");
  if (line === null) return null;
  const match = line.match(/`([A-Z_]+)`/);
  return match ? (match[1] ?? null) : null;
}

describe("H2-14 — threat-mitigation registry (L-T-001..014)", () => {
  it("the document exists and is readable", () => {
    expect(doc.length).toBeGreaterThan(1000);
  });

  it("the source registry carries the threat analyses this bundle mitigates", () => {
    const registry = JSON.parse(readFileSync(SOURCE_REGISTRY, "utf8")) as {
      analyses: { threat: Array<{ id: string }> };
    };
    const registryIds = registry.analyses.threat.map((t) => t.id);
    for (const id of IN_SCOPE_IDS) {
      expect(registryIds, `${id} must exist in COREGRID_V1_ARCHITECTURE_HARDENING.json analyses.threat[]`).toContain(id);
    }
  });

  it("the roadmap bounds this bundle to L-T-001..014", () => {
    const roadmap = readFileSync(ROADMAP, "utf8");
    expect(roadmap).toContain("L-T-001..014");
  });

  it("every in-scope threat id has its own record section", () => {
    for (const id of IN_SCOPE_IDS) {
      expect(sectionFor(id), `${id} section missing`).not.toBeNull();
    }
  });

  it("no unexpected L-T-0xx record sections exist outside the bundle", () => {
    const headings = [...doc.matchAll(/^## (L-T-\d{3}) —/gm)].map((m) => m[1] ?? "");
    expect(new Set(headings)).toEqual(new Set(IN_SCOPE_IDS));
  });

  it("every record carries all mandatory fields", () => {
    const labels = ["Threat", "Evidence", "Verdict", "Enforcing mechanism", "Proof test"];
    for (const id of IN_SCOPE_IDS) {
      const section = sectionFor(id);
      expect(section, `${id} section missing`).not.toBeNull();
      for (const label of labels) {
        expect(fieldLine(section ?? "", label), `${id}: field "${label}" missing`).not.toBeNull();
      }
    }
  });

  it("every record's verdict is a legal token", () => {
    for (const id of IN_SCOPE_IDS) {
      const section = sectionFor(id);
      expect(section).not.toBeNull();
      const verdict = extractVerdict(section ?? "");
      expect(verdict, `${id}: no parseable verdict field`).not.toBeNull();
      expect(LEGAL_VERDICTS, `${id}: verdict "${verdict}" is not one of ${LEGAL_VERDICTS.join("|")}`).toContain(verdict);
    }
  });

  it("every ENFORCED verdict cites a concrete proof artifact (no enforced-without-evidence)", () => {
    for (const id of IN_SCOPE_IDS) {
      const section = sectionFor(id) ?? "";
      const verdict = extractVerdict(section);
      if (verdict !== "ENFORCED") continue;
      const proof = fieldLine(section, "Proof test") ?? "";
      const mechanism = section;
      const proofCited =
        /tests\/[A-Za-z0-9._/-]+\.test\.ts/.test(proof) ||
        /scripts\/[A-Za-z0-9._/-]+\.(mjs|sh)/.test(proof) ||
        /_APPLY_RECORD_[A-Z0-9_]+\.json/.test(`${proof}${mechanism}`);
      expect(proofCited, `${id}: verdict ENFORCED but no tests/, scripts/ or apply-record proof cited`).toBe(true);
    }
  });

  it("every PARTIAL or OPEN verdict names its open remainder with an owner", () => {
    for (const id of IN_SCOPE_IDS) {
      const section = sectionFor(id) ?? "";
      const verdict = extractVerdict(section);
      if (verdict !== "PARTIAL" && verdict !== "OPEN") continue;
      const finding = fieldLine(section, "Missing test finding") ?? "";
      const hasOwner = /Owner( proposal)?:\s*\S|owner:/.test(finding);
      expect(hasOwner, `${id}: ${verdict} without an owned open remainder ("Missing test finding" with an Owner)`).toBe(true);
      expect(finding.length, `${id}: empty open remainder for ${verdict}`).toBeGreaterThan(40);
    }
  });

  it("the scope note disclaims the out-of-scope registry threats L-T-015/L-T-016", () => {
    const scopeNote = doc.slice(doc.indexOf("## Scope note"));
    expect(scopeNote.length).toBeGreaterThan(0);
    for (const id of OUT_OF_SCOPE_IDS) {
      expect(scopeNote, `${id} must be explicitly disclaimed in the scope note`).toContain(id);
    }
    for (const id of OUT_OF_SCOPE_IDS) {
      expect(doc.indexOf(`## ${id} —`), `${id} must NOT have a verdict record in this bundle`).toBe(-1);
    }
  });
});