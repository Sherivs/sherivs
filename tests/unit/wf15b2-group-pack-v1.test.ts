import { describe, expect, it } from "vitest";
import {
  GROUP_PACK_V1,
  validateGroupPackV1,
} from "../../frontend/src/lib/runtime/scholar/workflow-packs/group-pack-v1";
import {
  GROUP_AGGREGATE_MIN_COUNT,
  suppressSmallCount,
  validateRichEntry,
  type RichCatalogEntry,
} from "../../frontend/src/lib/runtime/scholar/workflow-packs/workflow-catalog";

const group = GROUP_PACK_V1.filter(
  (e) => e.key.startsWith("group.") && !e.key.startsWith("group.campus."),
);
const built = GROUP_PACK_V1.filter((e) => e.buildState === "built");

describe("Group Pack v1 (14 templates)", () => {
  it("is valid and holds exactly fourteen", () => {
    expect(validateGroupPackV1()).toEqual([]);
    expect(GROUP_PACK_V1).toHaveLength(14);
  });
  it("splits eight built campus templates and six group templates that still need an event source", () => {
    expect(built).toHaveLength(8);
    expect(group).toHaveLength(6);
    for (const e of group) expect(e.buildState).toBe("needs_event_source");
  });
  it("keeps every customer-visible step a draft with a named approver", () => {
    for (const e of GROUP_PACK_V1)
      for (const s of e.steps)
        if (s.channel && ["email", "sms", "whatsapp", "push"].includes(s.channel)) {
          expect(["draft", "suggest"]).toContain(s.autonomy);
          expect(s.approverRole).toBeTruthy();
        }
  });
  it("requires a step-up approval on every high-risk template", () => {
    for (const e of GROUP_PACK_V1.filter((x) => x.riskTier === "high"))
      expect(e.approvals.some((a) => a.stepUp)).toBe(true);
  });
  it("ships drafts of all five languages flagged for native review", () => {
    for (const e of GROUP_PACK_V1) {
      expect(e.translationStatus).toBe("draft_needs_native_review");
      for (const l of ["en", "ha", "yo", "ig", "pcm"])
        expect((e.title as Record<string, string>)[l]).toBeTruthy();
    }
  });
  it("rejects a customer-visible step that is not a draft", () => {
    const bad: RichCatalogEntry = {
      ...GROUP_PACK_V1[1],
      autonomyMax: "act_and_report",
      steps: [
        { id: "x", kind: "action", channel: "sms", autonomy: "act_and_report", approverRole: "r" },
      ],
    };
    expect(validateRichEntry(bad).join()).toMatch(/stays a draft/);
  });
  it("rejects an aggregate-only template without the no-individual-data case", () => {
    const bad: RichCatalogEntry = {
      ...group[0],
      evalCases: group[0].evalCases.filter((c) => c.id !== "no-individual-data"),
    };
    expect(validateRichEntry(bad).join()).toMatch(/no-individual-data/);
  });
  it("rejects a high-risk template with no step-up", () => {
    const hi = group.find((e) => e.riskTier === "high")!;
    expect(validateRichEntry({ ...hi, approvals: [] }).join()).toMatch(/step-up/);
  });
});

describe("small-number rule", () => {
  it("suppresses counts of 1 to 4 and shows zero and 5 or more", () => {
    expect(GROUP_AGGREGATE_MIN_COUNT).toBe(5);
    expect([0, 1, 4, 5, 40].map((n) => suppressSmallCount(n))).toEqual([0, null, null, 5, 40]);
  });
  it("suppresses invalid counts", () => {
    expect(suppressSmallCount(-1)).toBeNull();
    expect(suppressSmallCount(2.5)).toBeNull();
  });
});
