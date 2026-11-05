import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeTermResult, type TermResultWeights } from "@/lib/scholar/result-computation";
import type { GradingModel } from "@/lib/scholar/grading";

const migration = readFileSync(
  "database/supabase/migrations/20261104010000_sherivs_m06_ca_terminal_results.sql",
  "utf8",
);
const rollback = readFileSync(
  "database/supabase/rollbacks/20261104010000_sherivs_m06_ca_terminal_results.sql",
  "utf8",
);
const harness = readFileSync("tests/integration/m06-ca-and-results.local.sql", "utf8");
const adrIndex = readFileSync("architecture/adr/INDEX.md", "utf8");

const gradingModel: GradingModel = {
  code: "M06-PERCENT",
  name: "M06 percentage scale",
  kind: "letter",
  scale: [
    { label: "A", minPercentage: 70, maxPercentage: 100, passed: true },
    { label: "B", minPercentage: 60, maxPercentage: 69.99, passed: true },
    { label: "C", minPercentage: 50, maxPercentage: 59.99, passed: true },
    { label: "F", minPercentage: 0, maxPercentage: 49.99, passed: false },
  ],
};

const weights: TermResultWeights = {
  caWeight: 40,
  terminalWeight: 60,
  terminalMaxScore: 30,
  caComponents: [
    { code: "quiz", weight: 50, maxScore: 3 },
    { code: "project", weight: 50, maxScore: 3 },
  ],
};

describe("M06 weighted CA and terminal results", () => {
  it("weights each CA component and rounds the computed contributions and total", () => {
    const result = computeTermResult(
      weights,
      [
        { code: "quiz", score: 1 },
        { code: "project", score: 1 },
      ],
      20,
      gradingModel,
    );

    expect(result.caScore).toBe(13.33);
    expect(result.terminalScore).toBe(40);
    expect(result.totalScore).toBe(53.33);
    expect(result.grade?.label).toBe("C");
    expect(result.missingCaComponents).toEqual([]);
  });

  it("keeps a blank CA component unavailable rather than treating it as zero", () => {
    const result = computeTermResult(
      weights,
      [
        { code: "quiz", score: 3 },
        { code: "project", score: null },
      ],
      30,
      gradingModel,
    );

    expect(result.caScore).toBeNull();
    expect(result.totalScore).toBeNull();
    expect(result.grade).toBeNull();
    expect(result.missingCaComponents).toEqual(["project"]);
  });

  it("keeps a missing terminal mark unavailable while preserving a genuine zero", () => {
    const result = computeTermResult(
      weights,
      [
        { code: "quiz", score: 0 },
        { code: "project", score: 3 },
      ],
      null,
      gradingModel,
    );

    expect(result.caScore).toBe(20);
    expect(result.terminalScore).toBeNull();
    expect(result.totalScore).toBeNull();
  });

  it("rejects malformed or out-of-range weight and score configuration", () => {
    expect(() =>
      computeTermResult({ ...weights, terminalWeight: 50 }, [], null, gradingModel),
    ).toThrow("sum to 100");
    expect(() =>
      computeTermResult(
        { ...weights, caComponents: [{ code: "quiz", weight: 90, maxScore: 3 }] },
        [],
        null,
        gradingModel,
      ),
    ).toThrow("CA component weights must sum to 100");
    expect(() =>
      computeTermResult(weights, [{ code: "quiz", score: 4 }], null, gradingModel),
    ).toThrow("outside its possible range");
  });
});

describe("M06 database result workflow", () => {
  it("adds the reserved forward-only migration and a guarded rollback", () => {
    expect(migration).toContain("Authored only; never applied to a live database");
    expect(migration).not.toMatch(/^\s*(BEGIN|COMMIT);/m);
    expect(migration).toContain("public.m06_result_weight_profiles");
    expect(migration).toContain("public.m06_result_component_scores");
    expect(migration).toContain("public.m06_result_amendments");
    expect(rollback).toContain("M06 rollback refused");
    expect(rollback).toContain("result configuration, scores, approvals, or audit evidence");
    expect(rollback).toContain(
      "GENERATED ALWAYS AS (COALESCE(ca_score, 0) + COALESCE(exam_score, 0)) STORED",
    );
  });

  it("enforces null-aware weights, distinct approval, published lock, and audited amendments", () => {
    expect(migration).toContain("NEW.ca_score IS NULL OR NEW.exam_score IS NULL");
    expect(migration).toContain("NEW.grade_remark := NULL");
    expect(migration).toContain("v_locked_changed");
    expect(migration).toContain("NEW.result_entered_by = v_actor");
    expect(migration).toContain("public.workspace_role_sod_assert(NEW.school_id, v_actor)");
    expect(migration).toContain("approved results require a distinct, audited amendment");
    expect(migration).toContain("M06 result amendment audit is append-only");
    expect(migration).toContain("CREATE POLICY m06_result_amendments_read");
    expect(migration).toContain("s.recorded_by = v_actor");
    expect(harness).toContain("amender cannot approve their own amended scores");
    expect(harness).toContain("M06 Synthetic Independent Approver");
    expect(harness).toContain("configured M06 result cannot be published without approval");
  });

  it("runs the disposable Postgres harness in Verify after replaying migrations", () => {
    const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
    expect(workflow).toContain("name: M06 approval, amendment, and legacy publication SQL harness");
    expect(workflow).toContain("tests/integration/m06-ca-and-results.local.sql");
  });

  it("forces RLS and prevents direct writes to the M06 evidence tables", () => {
    expect(migration).toContain("ALTER TABLE public.%I FORCE ROW LEVEL SECURITY");
    expect(migration).toContain(
      "REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role",
    );
    expect(migration).toContain("TO authenticated");
    expect(harness).toContain("M06: refusing non-loopback server address");
    expect(harness).toContain("tenant B cannot read tenant A amendment audit");
    expect(harness).toContain("ROLLBACK;");
  });

  it("indexes the owner-reserved ADR and exposes only validated server calls", () => {
    expect(adrIndex).toContain("ADR-044_M06_TENANT_SCOPED_RESULTS_WORKFLOW.md");
    expect(adrIndex).toContain("ADR-045_M08_ASC_FIELD_ORDER_MANIFEST.md");
    expect(adrIndex).toContain("Next free number: **ADR-046**");
    const server = readFileSync("frontend/src/lib/runtime/scholar/results.functions.ts", "utf8");
    expect(server).toContain('"m06_set_result_weights"');
    expect(server).toContain('"m06_enter_result_scores"');
    expect(server).toContain('"m06_approve_result"');
    expect(server).toContain('"m06_publish_result"');
    expect(server).toContain('"m06_amend_result"');
  });
});
