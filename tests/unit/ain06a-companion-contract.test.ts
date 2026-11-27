import { describe, expect, it } from "vitest";
import {
  COMPANIONS,
  checkCompanionAnswer,
  companionForRole,
  type CompanionAnswer,
} from "../../frontend/src/lib/assistant/companion-contract";

const good = (over: Partial<CompanionAnswer> = {}): CompanionAnswer => ({
  text: "Term two resumes on 4 January.",
  kind: "answer",
  citations: [{ source: "official_notice", ref: "notice-2026-12-01" }],
  limits: "Dates can change; the office confirms.",
  handoff: "School office",
  ...over,
});

describe("AIN-06a companion contract", () => {
  it("has one companion per role, each with a persona", () => {
    const roles = COMPANIONS.map((c) => c.role);
    expect(new Set(roles).size).toBe(roles.length);
    expect(COMPANIONS.every((c) => c.persona.startsWith("My "))).toBe(true);
  });
  it("accepts a cited answer that states limits and a handoff", () => {
    expect(checkCompanionAnswer("parent", good())).toEqual([]);
  });
  it("refuses an unknown role", () => {
    expect(checkCompanionAnswer("stranger", good())).toEqual(["no_companion_for_role"]);
  });
  it("refuses an answer with no source, or from a source the role may not use", () => {
    expect(checkCompanionAnswer("parent", good({ citations: [] }))).toContain("no_citation");
    expect(
      checkCompanionAnswer("parent", good({ citations: [{ source: "org_record", ref: "x" }] })),
    ).toContain("source_not_allowed");
    expect(
      checkCompanionAnswer(
        "parent",
        good({ citations: [{ source: "official_notice", ref: " " }] }),
      ),
    ).toContain("citation_without_ref");
  });
  it("requires stated limits", () => {
    expect(checkCompanionAnswer("teacher", good({ limits: "  " }))).toContain("limits_missing");
  });
  it("requires a human handoff for family and learner companions only", () => {
    expect(checkCompanionAnswer("parent", good({ handoff: undefined }))).toContain(
      "handoff_missing",
    );
    expect(checkCompanionAnswer("student", good({ handoff: "" }))).toContain("handoff_missing");
    expect(checkCompanionAnswer("teacher", good({ handoff: undefined }))).toEqual([]);
  });
  it("never lets a family or clinic companion draft", () => {
    expect(checkCompanionAnswer("parent", good({ kind: "draft_for_review" }))).toContain(
      "output_not_allowed",
    );
    expect(
      checkCompanionAnswer(
        "nurse",
        good({ kind: "draft_for_review", citations: [{ source: "own_clinic_record", ref: "r" }] }),
      ),
    ).toContain("output_not_allowed");
    expect(checkCompanionAnswer("teacher", good({ kind: "draft_for_review" }))).toEqual([]);
  });
  it("keeps platform companions to aggregates", () => {
    const base = good({
      citations: [{ source: "aggregate_metric", ref: "m1" }],
      handoff: undefined,
    });
    expect(checkCompanionAnswer("super_admin", base)).toEqual([]);
    expect(
      checkCompanionAnswer("super_admin", { ...base, text: "Contact ada@school.ng about it." }),
    ).toContain("person_detail_in_aggregate");
    expect(checkCompanionAnswer("support", { ...base, text: "Call 08031234567." })).toContain(
      "person_detail_in_aggregate",
    );
    expect(companionForRole("super_admin")?.sources).not.toContain("org_record");
  });
});
