/**
 * SV1-REALITY R1 (#332) — taxonomy, question registry and answer-state tests.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENTITY_TYPES,
  INSTITUTION_TYPES,
  QUESTION_REGISTRY,
  REALITY_DOMAINS,
  RELATIONSHIP_TYPES,
  canonicalJson,
  effectiveState,
  isSatisfied,
  isVisible,
  openActivationQuestions,
  questionsForType,
  registryVersion,
  validateAnswer,
  validateQuestionRegistry,
  validateRegistry,
  validateTaxonomy,
  type AnswerMap,
  type DiscoveryAnswer,
  type DiscoveryQuestion,
} from "@/lib/scholar/reality";

const byId = (id: string): DiscoveryQuestion => {
  const q = QUESTION_REGISTRY.find((x) => x.id === id);
  if (!q) throw new Error(`missing ${id}`);
  return q;
};
const human = (questionId: string, value: DiscoveryAnswer["value"]): DiscoveryAnswer => ({
  questionId,
  state: "confirmed",
  value,
  source: "human",
});
const map = (...a: DiscoveryAnswer[]): AnswerMap => new Map(a.map((x) => [x.questionId, x]));
const codes = (qs: readonly DiscoveryQuestion[]) => validateRegistry(qs).map((i) => i.code);

describe("taxonomy", () => {
  it("is internally consistent", () => {
    expect(validateTaxonomy()).toEqual([]);
  });
  it("covers every domain and cites existing owners", () => {
    const domains = new Set(ENTITY_TYPES.map((e) => e.domain));
    for (const d of REALITY_DOMAINS) expect(domains.has(d)).toBe(true);
    for (const e of ENTITY_TYPES)
      expect(existsSync(resolve(__dirname, "../..", e.owner)), e.owner).toBe(true);
    expect(RELATIONSHIP_TYPES.length).toBeGreaterThan(10);
  });
  it("keeps school_id out of the vocabulary", () => {
    expect(JSON.stringify([ENTITY_TYPES, RELATIONSHIP_TYPES, QUESTION_REGISTRY])).not.toMatch(
      /school_id|schoolId/,
    );
  });
  it("flags duplicate ids and unknown endpoints", () => {
    const issues = validateTaxonomy(
      [...ENTITY_TYPES, ENTITY_TYPES[0]],
      [{ id: "x", from: ["nope"], to: ["room"], label: "x", temporal: false }],
    ).map((i) => i.code);
    expect(issues).toContain("duplicate_entity_type");
    expect(issues).toContain("unknown_entity_type");
  });
});

describe("question registry", () => {
  it("passes validation including branch coverage", () => {
    expect(validateQuestionRegistry()).toEqual([]);
  });
  it("has unique, stable, namespaced ids", () => {
    const ids = QUESTION_REGISTRY.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("core.type.institution_type");
  });
  it("has representative packs for all required institution types", () => {
    for (const p of ["core", "primary", "secondary"]) {
      expect(
        QUESTION_REGISTRY.some((q) => q.pack === p),
        p,
      ).toBe(true);
    }
    for (const t of ["primary", "secondary"] as const) {
      expect(questionsForType(t).length).toBeGreaterThan(5);
    }
  });
  it("excludes tertiary and future-version scope", () => {
    expect(INSTITUTION_TYPES).not.toContain("university");
    expect(
      QUESTION_REGISTRY.some((q) =>
        /^(university|polytechnic|coe|nursing|agriculture)\./.test(q.id),
      ),
    ).toBe(false);
    expect(JSON.stringify(QUESTION_REGISTRY)).not.toMatch(/cgpa|siwes|clinical/i);
  });
  it("marks public-safe website mappings, defaulting to not public", () => {
    const pub = QUESTION_REGISTRY.filter((q) => q.websiteMapping.publicSafe);
    expect(pub.length).toBeGreaterThan(3);
    for (const q of pub) expect(q.websiteMapping.field).toBeTruthy();
    expect(byId("core.people.head_position").websiteMapping.publicSafe).toBe(false);
    expect(byId("core.finance.fee_model").websiteMapping.publicSafe).toBe(false);
  });
  it("carries the full metadata shape on every question", () => {
    for (const q of QUESTION_REGISTRY) {
      for (const k of [
        "id",
        "domain",
        "institutionTypes",
        "answerType",
        "visibleWhen",
        "required",
        "dependsOn",
        "validation",
        "followUps",
        "configMapping",
        "confidence",
      ]) {
        expect(q, `${q.id}.${k}`).toHaveProperty(k);
      }
      expect(q.configMapping.path.startsWith("scholar.institution.operating_model.")).toBe(true);
    }
  });
  it("derives follow-ups from visibility gating", () => {
    expect(byId("primary.academics.arms_enabled").followUps).toEqual([
      "primary.academics.arm_names",
    ]);
  });
  it("produces deterministic, order-independent version output", () => {
    const v = registryVersion();
    expect(v).toEqual(registryVersion());
    expect(v.contentHash).toMatch(/^[0-9a-f]{8}$/);
    expect(registryVersion([...QUESTION_REGISTRY].reverse()).contentHash).toBe(v.contentHash);
    const changed = QUESTION_REGISTRY.map((q, i) =>
      i === 0 ? { ...q, prompt: `${q.prompt}?` } : q,
    );
    expect(registryVersion(changed).contentHash).not.toBe(v.contentHash);
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });
});

describe("registry validation failures", () => {
  const base = byId("core.layout.campus_count");
  it("detects duplicate ids and bad id format", () => {
    expect(codes([base, base])).toContain("duplicate_id");
    expect(codes([{ ...base, id: "Bad Id" }])).toContain("bad_id_format");
  });
  it("detects unknown taxonomy references", () => {
    const c = codes([
      {
        ...base,
        domain: "nope" as never,
        institutionTypes: ["alien" as never],
        answerType: "blob" as never,
        configMapping: { path: "x", entityType: "ghost" },
      },
    ]);
    for (const code of [
      "unknown_domain",
      "unknown_institution_type",
      "unknown_answer_type",
      "bad_config_path",
      "unknown_entity_type",
    ]) {
      expect(c).toContain(code);
    }
  });
  it("detects unknown, self and cyclic dependencies", () => {
    const a = { ...base, id: "core.x.a", dependsOn: ["core.x.b"] };
    const b = { ...base, id: "core.x.b", dependsOn: ["core.x.a"] };
    expect(codes([a, b])).toContain("dependency_cycle");
    expect(codes([{ ...base, dependsOn: ["core.x.missing"] }])).toContain("unknown_dependency");
    expect(codes([{ ...base, dependsOn: [base.id] }])).toContain("self_dependency");
  });
  it("detects option, range and activation errors", () => {
    expect(codes([{ ...base, answerType: "single", validation: {} }])).toContain("missing_options");
    expect(codes([{ ...base, validation: { min: 5, max: 1 } }])).toContain("bad_range");
    expect(codes([{ ...base, required: false, requiredToActivate: true }])).toContain(
      "activation_requires_required",
    );
  });
  it("detects ungated follow-ups and unknown visibility refs", () => {
    const parent = { ...base, id: "core.x.parent", followUps: ["core.x.child"] };
    const child = { ...base, id: "core.x.child", dependsOn: [], visibleWhen: [] };
    expect(codes([parent, child])).toContain("follow_up_not_gated");
    const ghost = {
      ...base,
      visibleWhen: [{ questionId: "core.x.nope", op: "answered" as const }],
    };
    expect(codes([ghost])).toContain("unknown_visibility_ref");
  });
  it("rejects unsafe public mappings", () => {
    expect(codes([{ ...base, websiteMapping: { publicSafe: true } }])).toContain(
      "public_field_missing",
    );
    expect(
      codes([{ ...base, domain: "human", websiteMapping: { publicSafe: true, field: "x" } }]),
    ).toContain("public_human_forbidden");
  });
  it("detects missing branch coverage", () => {
    const only = QUESTION_REGISTRY.filter((q) => q.pack === "core");
    const issues = validateRegistry(only, [
      { institutionType: "primary", domains: ["assessment_grading"] },
    ]);
    expect(issues.map((i) => i.code)).toContain("branch_coverage_gap");
    expect(
      validateRegistry([], [{ institutionType: "primary", domains: [] }]).map((i) => i.code),
    ).toContain("no_root_question");
  });
});

describe("answer-state semantics", () => {
  const q = byId("primary.academics.arms_enabled");
  it("treats an unanswered question as unknown, never No", () => {
    expect(effectiveState(undefined)).toBe("unknown");
    expect(isSatisfied(q, undefined)).toBe(false);
    expect(openActivationQuestions(QUESTION_REGISTRY, "primary", map()).map((x) => x.id)).toContain(
      "core.type.institution_type",
    );
  });
  it("does not branch on unconfirmed answers or on false-by-default", () => {
    const arm = byId("primary.academics.arm_names");
    expect(isVisible(arm, "primary", map())).toBe(false);
    expect(
      isVisible(
        arm,
        "primary",
        map({ questionId: q.id, state: "inferred", value: true, source: "ai" }),
      ),
    ).toBe(false);
    expect(isVisible(arm, "primary", map(human(q.id, false)))).toBe(false);
    expect(isVisible(arm, "primary", map(human(q.id, true)))).toBe(true);
    expect(isVisible(arm, "secondary", map(human(q.id, true)))).toBe(false);
  });
  it("never lets AI confirm a fact", () => {
    const issues = validateAnswer(q, {
      questionId: q.id,
      state: "confirmed",
      value: true,
      source: "ai",
    });
    expect(issues.map((i) => i.code)).toContain("ai_cannot_confirm");
    expect(
      validateAnswer(q, { questionId: q.id, state: "inferred", value: true, source: "ai" }),
    ).toEqual([]);
    expect(
      validateAnswer(q, { questionId: q.id, state: "inferred", value: true, source: "human" })[0]
        .code,
    ).toBe("inferred_not_human");
  });
  it("accepts false and 0 as real confirmed values", () => {
    expect(validateAnswer(q, human(q.id, false))).toEqual([]);
    expect(
      validateAnswer(byId("core.layout.campus_count"), human("core.layout.campus_count", 0)).map(
        (i) => i.code,
      ),
    ).toContain("below_min");
  });
  it("requires candidates for conflicts and no value for unknown/pending", () => {
    expect(
      validateAnswer(q, { questionId: q.id, state: "conflicting", source: "system" })[0].code,
    ).toBe("conflict_requires_candidates");
    expect(
      validateAnswer(q, {
        questionId: q.id,
        state: "conflicting",
        source: "system",
        candidates: [true, false],
      }),
    ).toEqual([]);
    expect(
      validateAnswer(q, { questionId: q.id, state: "unknown", value: false, source: "system" })[0]
        .code,
    ).toBe("state_has_no_value");
    expect(validateAnswer(q, { questionId: q.id, state: "pending", source: "system" })).toEqual([]);
  });
  it("permits not_applicable only where metadata allows", () => {
    const na = { questionId: q.id, state: "not_applicable" as const, source: "human" as const };
    expect(validateAnswer(q, na)[0].code).toBe("not_applicable_forbidden");
    const allowed = byId("core.services.boarding");
    expect(validateAnswer(allowed, { ...na, questionId: allowed.id })).toEqual([]);
    expect(isSatisfied(allowed, { ...na, questionId: allowed.id })).toBe(true);
  });
  it("lets inference satisfy only inferred_ok questions", () => {
    const strict = byId("core.type.institution_type");
    const lenient = byId("core.authority.external_bodies");
    const inf = (id: string): DiscoveryAnswer => ({
      questionId: id,
      state: "inferred",
      value: "x",
      source: "ai",
    });
    expect(isSatisfied(strict, inf(strict.id))).toBe(false);
    expect(isSatisfied(lenient, inf(lenient.id))).toBe(true);
    expect(
      isSatisfied(strict, {
        questionId: strict.id,
        state: "conflicting",
        source: "system",
        candidates: ["a", "b"],
      }),
    ).toBe(false);
  });
  it("validates values by answer type", () => {
    const type = byId("core.type.institution_type");
    expect(validateAnswer(type, human(type.id, "alien"))[0].code).toBe("invalid_option");
    const t = byId("primary.academics.arm_names");
    expect(validateAnswer(t, human(t.id, ["A", "B"]))).toEqual([]);
    expect(validateAnswer(t, human(t.id, ["1"]))[0].code).toBe("invalid_option");
    expect(validateAnswer(t, human(t.id, []))[0].code).toBe("confirmed_requires_value");
  });
  it("walks a primary branch to completion of activation questions", () => {
    const answers = map(
      human("core.type.institution_type", "primary"),
      human("core.layout.campus_count", 1),
      human("core.layout.campuses", [{ name: "Main" }]),
      human("core.academics.calendar_kind", "term"),
      human("primary.academics.levels", ["primary_1"]),
    );
    expect(openActivationQuestions(QUESTION_REGISTRY, "primary", answers)).toEqual([]);
    expect(INSTITUTION_TYPES).toContain("primary");
  });
});
