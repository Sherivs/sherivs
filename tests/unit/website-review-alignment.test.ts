/**
 * ADR-164: generated standard texts are reviewed before publishing; approved streams and examinations reach the
 * site; the alignment report says what the interview and the site agree on. Pure modules, synthetic data only.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAlignmentReport } from "@/lib/website/alignment";
import { generateSite, type Facts } from "@/lib/website/generator";
import { planRealitySync } from "@/lib/website/reality-sync";
import {
  acceptReview,
  addStandardTexts,
  pendingReviewBlocks,
  publishReadiness,
  removePending,
} from "@/lib/website/review";
import { validateDocument } from "@/lib/website/validate";
import type { ApprovedAnswer } from "@/lib/scholar/reality";
import { DEMO_FACTS } from "../fixtures/website/demo-facts";

const facts: Facts = DEMO_FACTS.bornoSecondary;
const policiesPage = (d: ReturnType<typeof generateSite>) => d.pages.find((p) => p.slug === "policies");

describe("generator standard texts", () => {
  it("emits them pending by default, and the document still validates", () => {
    const doc = generateSite(facts);
    expect(policiesPage(doc)).toBeTruthy();
    expect(pendingReviewBlocks(doc).length).toBeGreaterThan(0);
    expect(validateDocument(doc)).toEqual([]);
  });
  it("leaves them out entirely when asked to omit", () => {
    const doc = generateSite(facts, { standardTexts: "omit" });
    expect(policiesPage(doc)).toBeUndefined();
    expect(pendingReviewBlocks(doc)).toEqual([]);
    expect(publishReadiness(doc)).toEqual({ ready: true, pending: 0 });
    expect(validateDocument(doc)).toEqual([]);
  });
  it("marks only the standard blocks, never the school's own content", () => {
    const doc = generateSite(facts);
    const marked = pendingReviewBlocks(doc).map((b) => b.type);
    expect(new Set(marked)).toEqual(new Set(["policies", "rules"].filter((t) => marked.includes(t))));
    expect(marked.every((t) => t === "policies" || t === "rules")).toBe(true);
  });
  it("omitting changes nothing but the policies page", () => {
    const withTexts = generateSite(facts);
    const without = generateSite(facts, { standardTexts: "omit" });
    expect(without.pages.map((p) => p.slug)).toEqual(withTexts.pages.map((p) => p.slug).filter((s) => s !== "policies"));
  });
});

describe("review actions", () => {
  const doc = generateSite(facts);
  const ids = pendingReviewBlocks(doc).map((b) => b.blockId);
  it("lists the entries the school must read", () => {
    const entries = pendingReviewBlocks(doc).flatMap((b) => b.entries);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.title.length > 0)).toBe(true);
  });
  it("accepts one block, then the rest, without mutating the input", () => {
    const before = JSON.stringify(doc);
    const one = acceptReview(doc, [ids[0]!]);
    expect(pendingReviewBlocks(one).length).toBe(ids.length - 1);
    expect(JSON.stringify(doc)).toBe(before);
    const all = acceptReview(one, "all");
    expect(publishReadiness(all).ready).toBe(true);
    expect(validateDocument(all)).toEqual([]);
  });
  it("accepting leaves an accepted mark, not a missing one", () => {
    const all = acceptReview(doc, "all");
    const marks = all.pages.flatMap((p) => p.sections.flatMap((s) => s.blocks.map((b) => b.review)));
    expect(marks).toContain("accepted");
  });
  it("removing pending blocks drops emptied sections and pages but never the home page or school content", () => {
    const gone = removePending(doc, "all");
    expect(gone.pages.some((p) => p.slug === "policies")).toBe(false);
    expect(gone.pages.some((p) => p.slug === "home")).toBe(true);
    expect(publishReadiness(gone).ready).toBe(true);
    expect(validateDocument(gone)).toEqual([]);
  });
  it("cannot remove or accept something that is not pending", () => {
    const clean = generateSite(facts, { standardTexts: "omit" });
    const anyId = clean.pages[0]!.sections[0]!.blocks[0]!.id;
    expect(removePending(clean, [anyId])).toEqual(clean);
    expect(acceptReview(clean, [anyId])).toEqual(clean);
  });
});

describe("offering the standard texts later", () => {
  const clean = generateSite(facts, { standardTexts: "omit" });
  it("appends the policies page, all pending, once", () => {
    const r = addStandardTexts(clean, facts);
    expect(r.added).toBe(true);
    expect(policiesPage(r.doc)).toBeTruthy();
    expect(pendingReviewBlocks(r.doc).length).toBeGreaterThan(0);
    expect(validateDocument(r.doc)).toEqual([]);
    const again = addStandardTexts(r.doc, facts);
    expect(again).toMatchObject({ added: false, reason: "already_present" });
  });
  it("never edits the existing pages", () => {
    const r = addStandardTexts(clean, facts);
    expect(r.doc.pages.slice(0, clean.pages.length)).toEqual(clean.pages);
  });
});

const approved = (questionId: string, websiteField: string, value: ApprovedAnswer["value"]): ApprovedAnswer => ({
  questionId,
  value,
  configPath: "x",
  entityType: "institution",
  publicSafe: true,
  websiteField,
});

describe("approved streams and examinations", () => {
  const snap = [
    approved("secondary.academics.streams", "streams_offered", ["arts", "science", "bogus"]),
    approved("secondary.governance.exam_bodies", "examinations", ["waec", "neco"]),
  ];
  const plan = planRealitySync(snap, facts);
  const doc = generateSite(plan.facts, { standardTexts: "omit" });
  const siteText = JSON.stringify(doc);

  it("are applied, filtered to the allowed options and sorted", () => {
    expect(plan.applied.map((a) => [a.websiteField, a.summary])).toEqual([
      ["streams_offered", "arts, science"],
      ["examinations", "neco, waec"],
    ]);
    expect(plan.notSupported).toEqual([]);
  });
  it("reach the academics page as the school's own statement, nothing more", () => {
    expect(siteText).toContain("Streams offered: Arts, Science.");
    expect(siteText).toContain("External examinations sat: NECO, WAEC.");
    expect(siteText).not.toContain("bogus");
    expect(validateDocument(doc)).toEqual([]);
  });
  it("are ignored when the value has nothing allowed in it", () => {
    const bad = planRealitySync([approved("secondary.academics.streams", "streams_offered", ["bogus"]), approved("secondary.governance.exam_bodies", "examinations", "waec")], facts);
    expect(bad.applied).toEqual([]);
    expect(bad.notSupported.map((n) => n.websiteField).sort()).toEqual(["examinations", "streams_offered"]);
    expect(JSON.stringify(generateSite(bad.facts, { standardTexts: "omit" }))).not.toContain("Streams offered");
  });
  it("change the plan hash, so a stale preview is refused", () => {
    expect(planRealitySync(snap, facts).planHash).not.toBe(planRealitySync([], facts).planHash);
  });
});

describe("alignment report", () => {
  const snap = [
    approved("secondary.academics.streams", "streams_offered", ["science"]),
    approved("secondary.governance.exam_bodies", "examinations", ["waec"]),
    approved("core.layout.campus_count", "campus_count", 3),
    approved("core.x", "unknown_field", "x"),
  ];
  const plan = planRealitySync(snap, { ...facts, data: { ...facts.data, campuses: [{ name: "Main" }] } });
  const doc = generateSite(plan.facts, { standardTexts: "omit" });
  const report = buildAlignmentReport(snap, plan, doc);
  const by = (f: string) => report.items.find((i) => i.websiteField === f);

  it("says which answers the site shows", () => {
    expect(by("streams_offered")?.status).toBe("used");
    expect(by("examinations")?.status).toBe("used");
  });
  it("flags a contradiction only where two recorded facts disagree", () => {
    expect(by("campus_count")?.status).toBe("contradicted");
    expect(by("campus_count")?.detail).toMatch(/3 campuses.*lists 1/);
    expect(report.aligned).toBe(false);
  });
  it("does not call matching or unknown campus data a contradiction", () => {
    const same = [approved("core.layout.campus_count", "campus_count", 1)];
    const p = planRealitySync(same, { ...facts, data: { ...facts.data, campuses: [{ name: "Main" }] } });
    expect(buildAlignmentReport(same, p, doc).items[0]!.status).toBe("not_supported");
    const none = planRealitySync(same, { ...facts, data: { ...facts.data, campuses: [] } });
    expect(buildAlignmentReport(same, none, doc).items[0]!.status).toBe("not_supported");
  });
  it("lists answers the generator cannot place", () => {
    expect(by("unknown_field")?.status).toBe("not_supported");
  });
  it("is aligned only with no contradiction and no unreviewed standard text", () => {
    const ok = [approved("secondary.academics.streams", "streams_offered", ["science"])];
    const p = planRealitySync(ok, facts);
    const clean = generateSite(p.facts, { standardTexts: "omit" });
    expect(buildAlignmentReport(ok, p, clean)).toMatchObject({ aligned: true, unreviewedStandardTexts: 0 });
    const withTexts = generateSite(p.facts);
    const r = buildAlignmentReport(ok, p, withTexts);
    expect(r.unreviewedStandardTexts).toBeGreaterThan(0);
    expect(r.aligned).toBe(false);
  });
  it("marks an applied answer as not visible when its block is hidden", () => {
    const hidden = JSON.parse(JSON.stringify(doc)) as typeof doc;
    for (const pg of hidden.pages) for (const sec of pg.sections) for (const b of sec.blocks) if (b.type === "rich_text") b.hidden = true;
    expect(buildAlignmentReport(snap, plan, hidden).items.find((i) => i.websiteField === "streams_offered")?.status).toBe("used_not_visible");
  });
});

describe("publish paths never include standard texts", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("bootstrap and the reality publish both omit them", () => {
    expect(read("frontend/src/lib/website/bootstrap.ts")).toContain('standardTexts: "omit"');
    expect(read("frontend/src/lib/runtime/scholar/reality-website.functions.ts")).toContain('standardTexts: "omit"');
  });
  it("the database refuses to publish a pending text", () => {
    expect(read("database/supabase/migrations/20261128001100_sherivs_website_review_gate.sql")).toContain("still need your review");
  });
});
