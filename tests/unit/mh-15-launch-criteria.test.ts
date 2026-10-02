/**
 * MISSION H2-15 — launch-criteria harness (Part 74, 18 criteria).
 *
 * Proves the harness machinery, offline and deterministically:
 *   1. the parser reads the canonical Part 74 record and the harness catalog
 *      is drift-locked to it (18 ids, statements byte-identical, no invented
 *      criteria — catalog drift is exit 2, never silently accepted);
 *   2. check execution and verdict accounting against a synthetic fixture
 *      repo: proven / blocked / unproven are computed from the checks and the
 *      RECORDED gate register — a blocked claim never rescues a broken
 *      substrate, an unresolved gate never fakes a blocked verdict;
 *   3. the recorded RLS battery is consumed as a RECORD (never re-executed)
 *      and refuses to claim PASS from a dirty artifact;
 *   4. exit accounting: blocked is not failed; unproven is the failure state.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CRITERIA,
  checkRlsBatteryRecorded,
  evaluateCriterion,
  parseCanonicalCriteria,
  resolveGateRecord,
  runCriterionChecks,
  runRepoGates,
  summarize,
  validateCatalog,
} 
// @ts-expect-error — the harness is an ESM .mjs script; the typed contract below mirrors its exports
from "../../scripts/verify-launch-criteria.mjs";

/* The harness is an ESM script; these local contracts mirror its exported
 * shapes so the suite stays strict-typed while consuming it. */
interface CanonicalCriterion {
  id: string;
  statement: string;
  current: string;
}
interface CanonicalRecord {
  mission: string;
  artifact: string;
  status: string;
  launchDefinition: string;
  rule: string;
  criteria: CanonicalCriterion[];
}
interface HarnessCheck {
  id: string;
  desc: string;
  ref?: string;
  refs?: string[];
  mustMatch?: RegExp[];
  kind?: string;
  gate?: string;
}
interface HarnessCriterion {
  id: string;
  statement: string;
  verdictMode: "mechanical" | "gated";
  baseline: string;
  evidence: string[];
  checks: HarnessCheck[];
  gate?: { id: string; reason: string };
  residualGates?: string[];
}
interface CheckResult {
  id: string;
  desc: string;
  ok: boolean;
  detail: string;
}
interface GateResolution {
  ok: boolean;
  detail: string;
}
interface Outcome {
  verdict: "proven" | "blocked" | "unproven";
  failures: string[];
  note: string;
}
interface Summary {
  proven: number;
  blocked: number;
  unproven: number;
  exitCode: number;
}

const catalog = CRITERIA as unknown as HarnessCriterion[];
const parse = (root: string) => parseCanonicalCriteria(root) as unknown as CanonicalRecord;
const validate = (criteria: HarnessCriterion[], canonical: CanonicalRecord) =>
  validateCatalog(criteria, canonical) as unknown as { ok: boolean; errors: string[] };
const runChecks = (criterion: HarnessCriterion, ctx: { root: string; gateResults?: Record<string, GateResolution> }) =>
  runCriterionChecks(criterion, ctx) as unknown as CheckResult[];
const evaluate = (criterion: HarnessCriterion, results: CheckResult[], gate: GateResolution | null) =>
  evaluateCriterion(criterion, results, gate) as unknown as Outcome;
const resolveGate = (root: string, gate: { id: string }) =>
  resolveGateRecord(root, gate) as unknown as GateResolution;
const summarizeVerdicts = (verdicts: Pick<Outcome, "verdict">[]) =>
  summarize(verdicts) as unknown as Summary;
const runGates = (root: string, ids?: string[]) =>
  runRepoGates(root, undefined, ids) as unknown as Record<string, GateResolution>;
const batteryRecorded = (root: string, artifactPath?: string) =>
  checkRlsBatteryRecorded(root, artifactPath) as unknown as GateResolution;

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const FIXTURE_ROOT = mkdtempSync(join(tmpdir(), "mh15-launch-criteria-"));

const writeFixture = (ref: string, content: string) => {
  const path = join(FIXTURE_ROOT, ...ref.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
};

const writeFixtureAt = (root: string, ref: string, content: string) => {
  const path = join(root, ...ref.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
};

afterAll(() => {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

describe("H2-15 parser: the harness is drift-locked to the canonical Part 74 record", () => {
  it("parses the canonical record with exactly 18 criteria", () => {
    const canonical = parse(REPO_ROOT);
    expect(canonical.criteria.length).toBe(18);
    expect(canonical.artifact).toBe("COREGRID_V1_LAUNCH_CRITERIA");
    for (const c of canonical.criteria) {
      expect(c.id, "every canonical criterion carries an id").toBeTruthy();
      expect(c.statement, `criterion ${c.id} carries its question`).toBeTruthy();
      expect(c.current, `criterion ${c.id} carries its recorded current state`).toBeTruthy();
    }
  });

  it("the harness catalog matches the canonical record id-for-id and statement-for-statement", () => {
    const canonical = parse(REPO_ROOT);
    const validation = validate(catalog, canonical);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);
    expect(catalog.map((c) => c.id)).toEqual(canonical.criteria.map((c) => c.id));
  });

  it("every harness criterion is fully specified: evidence citation, checks, honest gating", () => {
    for (const c of catalog) {
      expect(c.evidence.length, `${c.id} cites its evidence sources`).toBeGreaterThan(0);
      expect(c.checks.length, `${c.id} maps to concrete repo checks`).toBeGreaterThan(0);
      expect(["mechanical", "gated"], `${c.id} declares a verdict mode`).toContain(c.verdictMode);
      if (c.verdictMode === "gated") {
        expect(c.gate, `${c.id} names its owning gate`).toBeTruthy();
        expect(c.gate?.reason, `${c.id} states why it is gated`).toBeTruthy();
      } else {
        expect(c.gate, `${c.id} is mechanical and claims no gate`).toBeUndefined();
      }
    }
  });

  it("refuses catalog drift in every direction (missing id, invented id, statement drift)", () => {
    const canonical = parse(REPO_ROOT);
    const missing = validate(catalog.slice(1), canonical);
    expect(missing.ok).toBe(false);
    expect(missing.errors.join(" ")).toMatch(/missing from harness data/);

    const invented = validate([...catalog, { ...catalog[0], id: "INVENTED" }], canonical);
    expect(invented.ok).toBe(false);
    expect(invented.errors.join(" ")).toMatch(/invented criteria are forbidden/);

    const driftedStatement = validate(
      catalog.map((c) => (c.id === "ECONOMICS" ? { ...c, statement: "drifted" } : c)),
      canonical,
    );
    expect(driftedStatement.ok).toBe(false);
    expect(driftedStatement.errors.join(" ")).toMatch(/ECONOMICS statement drifted/);
  });
});

describe("H2-15 fixture: check execution and honest verdict accounting", () => {
  it("a mechanical criterion with all substrate present re-evaluates to proven", () => {
    const workflow = catalog.find((c) => c.id === "WORKFLOW")!;
    for (const check of workflow.checks) {
      for (const ref of check.refs ?? [check.ref!]) {
        writeFixture(ref, "fixture substrate\n");
      }
    }
    const results = runChecks(workflow, { root: FIXTURE_ROOT });
    expect(results.every((r) => r.ok), results.map((r) => r.detail).join("; ")).toBe(true);
    const outcome = evaluate(workflow, results, null);
    expect(outcome.verdict).toBe("proven");
    expect(outcome.failures).toEqual([]);
  });

  it("a gated criterion with substrate present and a recorded open gate is blocked — not failed", () => {
    const payments = catalog.find((c) => c.id === "PAYMENTS")!;
    for (const check of payments.checks) {
      for (const ref of check.refs ?? [check.ref!]) {
        if (check.kind === "json") continue;
        writeFixture(ref, "fixture substrate\n");
      }
    }
    writeFixture(
      "architecture/coregrid-mvp-architecture/foundation/COREGRID_V1_BLOCKERS.json",
      JSON.stringify({
        blockers: [{ id: "BLK-4", item: "Paystack live/secret key; live validation pending" }],
      }),
    );
    const results = runChecks(payments, { root: FIXTURE_ROOT });
    expect(results.every((r) => r.ok), results.map((r) => r.detail).join("; ")).toBe(true);
    const gate = resolveGate(FIXTURE_ROOT, payments.gate!);
    expect(gate.ok).toBe(true);
    const outcome = evaluate(payments, results, gate);
    expect(outcome.verdict).toBe("blocked");
  });

  it("a broken substrate cannot be rescued by a recorded gate — it is unproven", () => {
    const payments = catalog.find((c) => c.id === "PAYMENTS")!;
    const results = runChecks(payments, { root: join(FIXTURE_ROOT, "empty") });
    const outcome = evaluate(payments, results, { ok: true, detail: "gate resolves" });
    expect(outcome.verdict).toBe("unproven");
    expect(outcome.note).toMatch(/cannot rescue a broken in-repo substrate/);
  });

  it("an unresolved or unrecorded gate never fakes a blocked verdict", () => {
    const criterion = catalog.find((c) => c.id === "AI")!;
    const results: CheckResult[] = criterion.checks.map((check) => ({
      id: check.id,
      desc: check.desc,
      ok: true,
      detail: "ok",
    }));
    const outcome = evaluate(criterion, results, {
      ok: false,
      detail: "gate BLK-2 is not recorded in the blockers register",
    });
    expect(outcome.verdict).toBe("unproven");
    expect(outcome.failures.join(" ")).toMatch(/BLK-2/);
    expect(outcome.note).toMatch(/refusing to fake one/);
  });

  it("gate resolution refuses invented gates and RESOLVED entries", () => {
    const blockers = JSON.parse(
      readFileSync(
        join(REPO_ROOT, "architecture/coregrid-mvp-architecture/foundation/COREGRID_V1_BLOCKERS.json"),
        "utf8",
      ),
    ) as { blockers: { id: string; item: string }[] };
    expect(blockers.blockers.some((b) => b.item.startsWith("RESOLVED"))).toBe(true);

    const resolvedFixture = mkdtempSync(join(tmpdir(), "mh15-gate-"));
    try {
      writeFixtureAt(
        resolvedFixture,
        "architecture/coregrid-mvp-architecture/foundation/COREGRID_V1_BLOCKERS.json",
        JSON.stringify({
          blockers: [{ id: "BLK-3", item: "RESOLVED 2026-10-01: deploy credentials provisioned" }],
        }),
      );
      expect(resolveGate(resolvedFixture, { id: "BLK-3" }).ok).toBe(false);
      expect(resolveGate(resolvedFixture, { id: "TOTALLY-UNKNOWN" }).ok).toBe(false);
      expect(resolveGate(REPO_ROOT, { id: "BLK-99" }).ok).toBe(false);
    } finally {
      rmSync(resolvedFixture, { recursive: true, force: true });
    }
  });
});

describe("H2-15 recorded RLS battery: consumed as a record, never re-executed", () => {
  it("claims PASS only from a clean recorded record", () => {
    const fixture = mkdtempSync(join(tmpdir(), "mh15-battery-"));
    try {
      writeFixtureAt(
        fixture,
        "architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md",
        "Live evidence excerpts (verbatim)\nFINDINGS: **0**. Artifacts recorded.\n",
      );
      const clean = batteryRecorded(fixture, join(fixture, "absent-artifact.json"));
      expect(clean.ok).toBe(true);
      expect(clean.detail).toMatch(/ratification record/);

      writeFixtureAt(
        fixture,
        "architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md",
        "FINDINGS: **2** — isolation weaknesses observed.\n",
      );
      expect(batteryRecorded(fixture, join(fixture, "absent-artifact.json")).ok).toBe(false);

      writeFixtureAt(
        fixture,
        "architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md",
        "FINDINGS: **0**. Artifacts recorded.\n",
      );
      writeFixtureAt(
        fixture,
        "battery-results.json",
        JSON.stringify({ summary: { total: 36, pass: 35, fail: 1 }, findings: ["FAIL x"] }),
      );
      const dirty = batteryRecorded(fixture, join(fixture, "battery-results.json"));
      expect(dirty.ok).toBe(false);
      expect(dirty.detail).toMatch(/does NOT record a clean battery/);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});

describe("H2-15 exit accounting: blocked is not failed; unproven is the failure state", () => {
  it("prints both counts and exits 0 when every criterion is proven or blocked", () => {
    const verdicts: Pick<Outcome, "verdict">[] = [
      { verdict: "proven" },
      { verdict: "blocked" },
      { verdict: "blocked" },
      { verdict: "proven" },
    ];
    const summary = summarizeVerdicts(verdicts);
    expect(summary).toMatchObject({ proven: 2, blocked: 2, unproven: 0, exitCode: 0 });
  });

  it("exits 1 the moment any criterion is unproven", () => {
    const summary = summarizeVerdicts([{ verdict: "proven" }, { verdict: "unproven" }, { verdict: "blocked" }]);
    expect(summary).toMatchObject({ proven: 1, blocked: 1, unproven: 1, exitCode: 1 });
  });

  it("the live repo tree keeps the whole harness honest: 18 criteria, no unproven, exit 0", () => {
    const canonical = parse(REPO_ROOT);
    expect(validate(catalog, canonical).ok).toBe(true);
    // The two criteria that claim a repo gate re-run that gate live (offline,
    // deterministic): EXTENSIBILITY claims neutrality, SECURITY claims retention.
    const gateResults = runGates(REPO_ROOT, ["neutrality", "retention"]);
    const verdicts = catalog.map((criterion) => {
      const results = runChecks(criterion, { root: REPO_ROOT, gateResults });
      const gate = criterion.gate ? resolveGate(REPO_ROOT, criterion.gate) : null;
      return evaluate(criterion, results, gate);
    });
    const summary = summarizeVerdicts(verdicts);
    expect(summary.proven + summary.blocked + summary.unproven).toBe(18);
    expect(summary.unproven, JSON.stringify(summary)).toBe(0);
    expect(summary.exitCode).toBe(0);
  });
});