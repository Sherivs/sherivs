/**
 * SV1-REALITY R23 (audit finding R-23) — early-childhood (creche) question pack.
 * Pure registry, interview and mapping tests. Synthetic data only; no database, network or AI.
 */
import { describe, expect, it } from "vitest";
import {
  QUESTION_REGISTRY,
  REQUIRED_BRANCH_COVERAGE,
  TYPE_QUESTION_ID,
  applyAnswer,
  approveInterview,
  approvedSnapshot,
  emptyInterview,
  nextQuestion,
  questionsForType,
  validateQuestionRegistry,
  visibleQuestions,
  type DiscoveryAnswer,
  type DiscoveryQuestion,
  type InterviewState,
} from "../../frontend/src/lib/scholar/reality";
import { generateSite, type Facts } from "../../frontend/src/lib/website/generator";
import { validateDocument } from "../../frontend/src/lib/website/validate";
import { planRealitySync } from "../../frontend/src/lib/website/reality-sync";

const T0 = 1_800_000_000_000;
const H = (questionId: string, value: DiscoveryAnswer["value"]): DiscoveryAnswer => ({
  questionId,
  state: "confirmed",
  value,
  source: "human",
});
function must(state: InterviewState, a: DiscoveryAnswer): InterviewState {
  const r = applyAnswer(state, a, T0);
  if (!r.ok) throw new Error(`${a.questionId}: ${r.issues.map((i) => i.code).join(",")}`);
  return r.state;
}
function validValue(q: DiscoveryQuestion): DiscoveryAnswer["value"] {
  const v = q.validation;
  switch (q.answerType) {
    case "single":
      return v.options![0];
    case "multi":
      return [v.options![0]];
    case "bool":
      return true;
    case "number":
      return Math.min(Math.max(v.min ?? 1, 1), v.max ?? 1000);
    case "repeating_group":
    case "hierarchy":
      return ["Main campus"];
    default:
      return "Head";
  }
}
function crecheInterview(overrides: Record<string, DiscoveryAnswer["value"]> = {}): InterviewState {
  let s = must(emptyInterview(T0), H(TYPE_QUESTION_ID, "creche"));
  for (let i = 0; i < 60; i++) {
    const q = nextQuestion(s);
    if (!q || !q.required) break;
    s = must(s, H(q.id, q.id in overrides ? overrides[q.id] : validValue(q)));
  }
  return s;
}
const EARLY = QUESTION_REGISTRY.filter((q) => q.pack === "early");
const BASE: Facts = {
  data: { school: { name: "Little Steps", slug: "little-steps" } },
  onboarding: {},
} as unknown as Facts;

describe("R23: the early-childhood pack in the registry", () => {
  it("adds seven questions, only for the creche type", () => {
    expect(EARLY).toHaveLength(7);
    for (const q of EARLY) expect(q.institutionTypes).toEqual(["creche"]);
    const ids = new Set(EARLY.map((q) => q.id));
    for (const t of ["primary", "secondary"] as const)
      for (const q of questionsForType(t)) expect(ids.has(q.id)).toBe(false);
    for (const q of questionsForType("creche")) {
      expect(q.pack === "core" || q.pack === "early").toBe(true);
    }
    expect(questionsForType("creche").filter((q) => q.pack === "early")).toHaveLength(7);
  });

  it("leaves the primary and secondary packs and the core pack unchanged", () => {
    const count = (pack: string) => QUESTION_REGISTRY.filter((q) => q.pack === pack).length;
    expect([count("core"), count("primary"), count("secondary")]).toEqual([10, 4, 4]);
    expect(QUESTION_REGISTRY).toHaveLength(25);
  });

  it("passes full registry validation, and creche is now a required coverage branch", () => {
    expect(validateQuestionRegistry()).toEqual([]);
    expect(REQUIRED_BRANCH_COVERAGE.map((r) => r.institutionType)).toEqual([
      "creche",
      "primary",
      "secondary",
    ]);
  });

  it("has unique config paths across the registry and ids in the early namespace", () => {
    const paths = QUESTION_REGISTRY.filter((q) => q.pack === "early").map(
      (q) => q.configMapping.path,
    );
    expect(new Set(paths).size).toBe(paths.length);
    for (const q of EARLY) expect(q.id.startsWith("early.")).toBe(true);
  });

  it("makes only the groups question public, and only that one is required to activate", () => {
    expect(EARLY.filter((q) => q.websiteMapping.publicSafe).map((q) => q.id)).toEqual([
      "early.academics.levels",
    ]);
    expect(EARLY.filter((q) => q.requiredToActivate).map((q) => q.id)).toEqual([
      "early.academics.levels",
    ]);
    for (const id of [
      "early.operations.meals",
      "early.human.children_per_caregiver",
      "early.academics.youngest_age_months",
    ])
      expect(EARLY.find((q) => q.id === id)!.websiteMapping.publicSafe).toBe(false);
  });
});

describe("R23: the interview for a creche", () => {
  it("now shows the early-childhood questions and not the primary or secondary ones", () => {
    const s = must(emptyInterview(T0), H(TYPE_QUESTION_ID, "creche"));
    const ids = visibleQuestions(s).map((q) => q.id);
    expect(ids).toContain("early.academics.levels");
    expect(ids.some((id) => id.startsWith("primary.") || id.startsWith("secondary."))).toBe(false);
  });

  it("cannot be approved until the groups question is answered, then can", () => {
    let s = must(emptyInterview(T0), H(TYPE_QUESTION_ID, "creche"));
    expect(approveInterview(s, "admin-1", T0).ok).toBe(false);
    s = crecheInterview();
    const r = approveInterview(s, "admin-1", T0);
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(approvedSnapshot(r.state).some((a) => a.questionId === "early.academics.levels")).toBe(
        true,
      );
  });

  it("refuses out-of-range and unknown values", () => {
    let s = must(emptyInterview(T0), H(TYPE_QUESTION_ID, "creche"));
    const bad: Array<[string, DiscoveryAnswer["value"]]> = [
      ["early.academics.levels", ["bogus"]],
      ["early.academics.levels", []],
      ["early.academics.youngest_age_months", -1],
      ["early.academics.youngest_age_months", 73],
      ["early.operations.care_hours", "overnight"],
      ["early.human.children_per_caregiver", 0],
      ["early.human.children_per_caregiver", 41],
      ["early.assessment.development_reports", "weekly"],
    ];
    for (const [id, value] of bad) expect(applyAnswer(s, H(id, value), T0).ok).toBe(false);
    s = must(s, H("early.academics.youngest_age_months", 0));
    s = must(s, H("early.human.children_per_caregiver", 8));
    expect(s.answers["early.human.children_per_caregiver"]).toBeDefined();
  });

  it("keeps private answers out of the public snapshot fields", () => {
    const s = crecheInterview({
      "early.academics.levels": ["playgroup", "nursery"],
    });
    const r = approveInterview(
      must(must(s, H("early.operations.meals", true)), H("early.human.children_per_caregiver", 8)),
      "admin-1",
      T0,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const snap = approvedSnapshot(r.state);
    for (const a of snap) {
      if (a.questionId.startsWith("early.") && a.questionId !== "early.academics.levels")
        expect(a.publicSafe).toBe(false);
    }
  });
});

describe("R23: mapping onto the website generator (R9)", () => {
  const plan = (levels: string[]) => {
    const s = crecheInterview({ "early.academics.levels": levels });
    const r = approveInterview(s, "admin-1", T0);
    if (!r.ok) throw new Error("not approvable");
    return planRealitySync(approvedSnapshot(r.state), BASE);
  };

  it("a nursery group becomes the nursery band", () => {
    const p = plan(["day_care", "nursery"]);
    expect(p.applied.map((x) => x.websiteField)).toContain("levels_offered");
    expect(
      (p.facts.onboarding as { institution?: { bands?: string[] } }).institution?.bands,
    ).toEqual(["nursery"]);
  });

  it("groups with no existing place on the site are not published, and nothing breaks", () => {
    const p = plan(["day_care", "playgroup"]);
    expect(p.applied.map((x) => x.websiteField)).not.toContain("levels_offered");
    expect(
      (p.facts.onboarding as { institution?: { bands?: string[] } }).institution?.bands,
    ).toBeUndefined();
  });

  it("the generated site stays valid for both creche outcomes", () => {
    for (const levels of [["nursery"], ["day_care", "playgroup"]]) {
      const doc = generateSite(plan(levels).facts);
      expect(validateDocument(doc)).toEqual([]);
    }
  });

  it("no private early-childhood answer ever reaches the plan", () => {
    const s = crecheInterview();
    const r = approveInterview(must(s, H("early.operations.meals", true)), "admin-1", T0);
    if (!r.ok) throw new Error("not approvable");
    const p = planRealitySync(approvedSnapshot(r.state), BASE);
    const text = JSON.stringify(p);
    for (const q of EARLY.filter((x) => !x.websiteMapping.publicSafe))
      expect(p.applied.map((a) => a.questionId)).not.toContain(q.id);
    expect(text).not.toContain("meals_provided");
    expect(text).not.toContain("children_per_caregiver");
  });
});
