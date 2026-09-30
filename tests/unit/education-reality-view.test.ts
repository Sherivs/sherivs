/**
 * CoreGrid — Phase 04 Educational Reality Engine: projection tests.
 *
 * The surface must answer "How does this institution operate?" from real state and
 * must never invent one. These tests prove the three honest states and the
 * defensive parsing behind them.
 */
import { describe, expect, it } from "vitest";

import {
  EDUCATION_REALITY_QUESTIONS,
  educationRealityView,
  parseOperatingModelSpec,
  type EducationRealitySource,
} from "@/lib/education-reality-view";

const source = (overrides: Partial<EducationRealitySource> = {}): EducationRealitySource => ({
  entity_id: "entity-1",
  tenant_id: "tenant-1",
  version: 3,
  reason: "term rollover",
  published_at: "2026-09-14T10:00:00.000Z",
  spec_json: JSON.stringify({
    levels: ["primary", "junior_secondary"],
    programmes: ["bsc"],
    curricula: ["nigerian"],
    subjects: ["maths", "english", "agric"],
  }),
  ...overrides,
});

describe("Phase 04 — a published operating model is projected truthfully", () => {
  it("counts structure from the spec and keeps the phase document's questions", () => {
    const view = educationRealityView(source());

    expect(view.status).toBe("published");
    expect(view.version).toBe(3);
    expect(view.reason).toBe("term rollover");
    expect(view.counts).toEqual({ levels: 2, programmes: 1, curricula: 1, subjects: 3 });
    expect(view.summary).toContain("Version 3");
    expect(view.questions).toBe(EDUCATION_REALITY_QUESTIONS);
    expect(view.questions.length).toBe(9);
  });

  it("exposes the kernel-bound reality vocabulary instead of a private one", () => {
    const view = educationRealityView(source());

    expect(view.vocabulary.entityTypes.length).toBeGreaterThan(0);
    expect(view.vocabulary.relationshipTypes.length).toBeGreaterThan(0);
  });

  it("reports zero counts for spec keys it does not recognise — never invented numbers", () => {
    const view = educationRealityView(source({ spec_json: JSON.stringify({ something: "else" }) }));

    expect(view.status).toBe("published");
    expect(view.counts).toEqual({ levels: 0, programmes: 0, curricula: 0, subjects: 0 });
  });
});

describe("Phase 04 — absent or unreadable state is reported, never fabricated", () => {
  it("says nothing is published when there is no operating model", () => {
    const view = educationRealityView(null);

    expect(view.status).toBe("not_published");
    expect(view.version).toBeNull();
    expect(view.counts).toEqual({ levels: 0, programmes: 0, curricula: 0, subjects: 0 });
    expect(view.summary).toMatch(/not represented/i);
  });

  it("flags an unreadable specification instead of rendering an empty school", () => {
    const view = educationRealityView(source({ spec_json: "{not json" }));

    expect(view.status).toBe("invalid_spec");
    expect(view.version).toBe(3);
    expect(view.summary).toMatch(/could not be read/i);
  });

  it("rejects non-object and empty specs defensively", () => {
    expect(parseOperatingModelSpec(null)).toBeNull();
    expect(parseOperatingModelSpec("   ")).toBeNull();
    expect(parseOperatingModelSpec("[1,2,3]")).toBeNull();
    expect(parseOperatingModelSpec('"text"')).toBeNull();
    expect(parseOperatingModelSpec("{}")).toEqual({});
  });
});
