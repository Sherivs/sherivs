/**
 * M5a (E-009, ADR-107) — plan generator golden files, determinism and the
 * honesty rules (unverified links, disabled oversight, placeholder packs,
 * §9.1 admissions defaults). Regenerate goldens with UPDATE_GOLDEN=1 and
 * review the diff by hand.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  allLinksUnverified,
  canonicalPlanJson,
  envelopeIntact,
  envelopePlan,
  getAtPlanPath,
  parsePlanPath,
  planPathMatcher,
  setAtPlanPath,
} from "@/lib/onboarding/plan";
import { FULL_REALITY_GRAPH } from "@/lib/scholar/reality/graph/full-graph";
import { walk, type GraphAnswers } from "@/lib/scholar/reality/graph";
import { generatePlan } from "@/lib/scholar/reality/graph/plan";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FIX = join(ROOT, "tests/fixtures/onboarding-plans");
const CASES = [
  "private-secondary",
  "public-primary-subeb",
  "polytechnic",
  "college-of-nursing",
  "oversight-subeb",
];
const answersOf = (name: string): GraphAnswers =>
  JSON.parse(readFileSync(join(FIX, `${name}.answers.json`), "utf8"));

describe("golden plans", () => {
  it.each(CASES)("%s matches its golden file exactly", (name) => {
    const answers = answersOf(name);
    expect(walk(FULL_REALITY_GRAPH, answers).complete).toBe(true);
    expect(walk(FULL_REALITY_GRAPH, answers).ignoredAnswerIds).toEqual([]);
    const text = `${canonicalPlanJson(generatePlan(answers), 2)}\n`;
    const file = join(FIX, `${name}.plan.json`);
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(file, text);
    // Exact content AND key order (JSON.parse keeps key order); whitespace-insensitive.
    const golden = JSON.parse(readFileSync(file, "utf8"));
    expect(JSON.stringify(golden)).toBe(JSON.stringify(generatePlan(answers)));
    expect(golden).toEqual(JSON.parse(text));
  });

  it("every fixture pair is listed", () => {
    const names = readdirSync(FIX)
      .filter((f) => f.endsWith(".answers.json"))
      .map((f) => f.replace(".answers.json", ""));
    expect(names.sort()).toEqual([...CASES].sort());
  });

  it.each(CASES)("%s is deterministic with stable key order", (name) => {
    const a = generatePlan(answersOf(name));
    const b = generatePlan(JSON.parse(JSON.stringify(answersOf(name))));
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).toBe(canonicalPlanJson(a));
    // Answer insertion order does not matter.
    const reversed = Object.fromEntries(Object.entries(answersOf(name)).reverse());
    expect(JSON.stringify(generatePlan(reversed))).toBe(JSON.stringify(a));
  });
});

describe("plan rules", () => {
  it("oversight bodies get a disabled oversight workspace with mandate unverified", () => {
    const p = generatePlan(answersOf("oversight-subeb"));
    const ws = p.modules.find((m) => m.code === "oversight_workspace")!;
    expect(ws.enabled).toBe(false);
    expect(ws.gate).toEqual({ kind: "mandate_verification", mandate_status: "unverified" });
    expect(p.flags).toContain("oversight_mandate_unverified");
    expect(p.admissions).toEqual({ enabledByDefault: false, mode: "none" });
    for (const t of [
      "lgea",
      "teaching_service_commission",
      "federal_ministry_of_education",
      "ubec",
    ]) {
      const q = generatePlan({ "entry.org.institution_type": t, "entry.location.state": "oyo" });
      expect(q.modules.find((m) => m.code === "oversight_workspace")?.enabled).toBe(false);
    }
  });

  it("every authority link candidate is unverified", () => {
    for (const name of CASES) {
      const p = generatePlan(answersOf(name));
      expect(p.authorityLinkCandidates.length).toBeGreaterThan(0);
      expect(allLinksUnverified(p.authorityLinkCandidates)).toBe(true);
    }
  });

  it("admissions: off until chosen for private, on for public and tertiary (§9.1)", () => {
    const priv = answersOf("private-secondary");
    expect(generatePlan(priv).admissions.enabledByDefault).toBe(true);
    const declined = { ...priv, "private_basic.intake.use_sherivs": false };
    expect(generatePlan(declined).admissions).toEqual({
      enabledByDefault: false,
      mode: "not_configured",
    });
    expect(
      generatePlan({ "entry.org.institution_type": "private_primary" }).admissions.enabledByDefault,
    ).toBe(false);
    expect(generatePlan(answersOf("public-primary-subeb")).admissions.enabledByDefault).toBe(true);
    expect(generatePlan(answersOf("polytechnic")).admissions.enabledByDefault).toBe(true);
    expect(generatePlan(answersOf("college-of-nursing")).admissions.enabledByDefault).toBe(true);
  });

  it("role packs are placeholders ng.<type>@0.1.0", () => {
    const p = generatePlan(answersOf("polytechnic"));
    expect(p.rolePack).toEqual({ code: "ng.polytechnic_federal", version: "0.1.0" });
    expect(p.flags).toContain("placeholder:role_pack");
  });

  it("[VERIFY] items are flags, never assertions", () => {
    const p = generatePlan({
      ...answersOf("college-of-nursing"),
      "health_college.licensing.bodies": ["nmcn", "chprbn"],
    });
    expect(p.flags).toContain("verify:chprbn_name");
    expect(generatePlan(answersOf("polytechnic")).flags).toContain("verify:jamb_caps_access_terms");
  });

  it("off-path answers do not change the plan; incomplete interviews are flagged", () => {
    const base = answersOf("polytechnic");
    const noisy = {
      ...base,
      "private_basic.structure.sections": ["sss"],
      "oversight.mandate.link": "x",
    };
    expect(generatePlan(noisy)).toEqual(generatePlan(base));
    expect(generatePlan({ "entry.org.institution_type": "polytechnic_state" }).flags).toContain(
      "interview_incomplete",
    );
    expect(generatePlan({}).rolePack.code).toBe("ng.unknown");
  });
});

describe("neutral plan primitives", () => {
  it("plan paths: grammar, wildcards, immutable writes, no prototype keys", () => {
    const m = planPathMatcher(["a.b", "c.*"]);
    expect(m.isKnown("a.b")).toBe(true);
    expect(m.isKnown("c.some_key")).toBe(true);
    expect(m.isKnown("c.x.y")).toBe(false);
    expect(m.isKnown("c.Bad")).toBe(false);
    expect(parsePlanPath("a.__proto__")).toBeNull();
    const src = { a: { k: 1 } };
    const out = setAtPlanPath(src, "a.b", 2);
    expect(src).toEqual({ a: { k: 1 } });
    expect(getAtPlanPath(out, "a.b")).toBe(2);
  });

  it("envelope digests are stable and detect drift", () => {
    const plan = generatePlan(answersOf("polytechnic"));
    const e1 = envelopePlan({
      graphId: "g",
      graphVersion: "1.0.0",
      answers: answersOf("polytechnic"),
      plan,
    });
    const e2 = envelopePlan({
      graphId: "g",
      graphVersion: "1.0.0",
      answers: answersOf("polytechnic"),
      plan,
    });
    expect(e1).toEqual(e2);
    expect(envelopeIntact(e1)).toBe(true);
    expect(envelopeIntact({ ...e1, plan: { ...(e1.plan as object), calendarModel: "x" } })).toBe(
      false,
    );
  });

  it("the universal onboarding/plan folder carries no domain vocabulary", () => {
    const dir = join(ROOT, "frontend/src/lib/onboarding/plan");
    const tokens = [
      "scholar",
      "student",
      "teacher",
      "school",
      "classroom",
      "curriculum",
      "exam",
      "examination",
      "grade",
      "grading",
      "attendance",
      "fee",
      "fees",
      "tuition",
      "timetable",
      "admission",
      "lesson",
      "homework",
      "library",
      "hostel",
      "bursar",
      "principal",
      "guardian",
      "enrollment",
      "enrolment",
      "academic",
      "discipline",
      "payroll",
      "textbook",
      "vibeora",
    ];
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), "utf8");
      for (const t of tokens)
        expect(new RegExp(`\\b${t}\\b`, "i").test(src), `${f}: ${t}`).toBe(false);
      expect(/['"`](parent|staff|driver|bus)['"`]/i.test(src), f).toBe(false);
    }
  });
});
