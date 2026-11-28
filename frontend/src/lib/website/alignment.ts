/**
 * Site vs approved interview alignment (ADR-164). Pure. For every approved answer that is public-safe, says
 * whether the generated site used it, could not place it, or contradicts it; and counts what is on the site
 * that the school did not write (standard texts still awaiting review). Nothing is guessed: a status is
 * `contradicted` only where two recorded facts disagree.
 */
import type { ApprovedAnswer } from "@/lib/scholar/reality";
import type { RealitySyncPlan } from "./reality-sync";
import { pendingReviewBlocks } from "./review";
import type { SiteData, SiteDocument } from "./types";

export type AlignmentStatus = "used" | "used_not_visible" | "not_supported" | "contradicted";

export interface AlignmentItem {
  readonly questionId: string;
  readonly websiteField: string;
  readonly status: AlignmentStatus;
  readonly detail: string;
}

export interface AlignmentReport {
  readonly items: readonly AlignmentItem[];
  /** Approved answers kept off the site because they are not public-safe (count only). */
  readonly withheld: number;
  /** Generated standard texts on the site that the school has not accepted. */
  readonly unreviewedStandardTexts: number;
  /** True when nothing contradicts the interview and no unreviewed text is on the site. */
  readonly aligned: boolean;
}

const LABELS: Record<string, string> = {
  science: "Science", arts: "Arts", commercial: "Commercial", technical: "Technical",
  waec: "WAEC", neco: "NECO", nabteb: "NABTEB",
};

function siteText(doc: SiteDocument): string {
  const parts: string[] = [];
  for (const p of doc.pages)
    for (const s of p.sections)
      for (const b of s.blocks) {
        if (b.hidden) continue;
        parts.push(JSON.stringify(b.props));
      }
  return parts.join(" ");
}

const namedCampuses = (data: SiteData): number =>
  (data.campuses ?? []).filter((c) => typeof c.name === "string" && c.name.trim() !== "").length;

export function buildAlignmentReport(
  snapshot: readonly ApprovedAnswer[],
  plan: RealitySyncPlan,
  doc: SiteDocument,
): AlignmentReport {
  const text = siteText(doc);
  const appliedFields = new Set(plan.applied.map((a) => a.websiteField));
  const items: AlignmentItem[] = [];
  const seen = new Set<string>();
  const ordered = [...snapshot].sort((a, b) => (a.questionId < b.questionId ? -1 : 1));
  for (const a of ordered) {
    if (!a.publicSafe || !a.websiteField || seen.has(a.websiteField)) continue;
    seen.add(a.websiteField);
    const field = a.websiteField;
    const base = { questionId: a.questionId, websiteField: field };
    if (field === "campus_count") {
      const said = typeof a.value === "number" ? a.value : Number(a.value);
      const have = namedCampuses(plan.facts.data);
      if (Number.isFinite(said) && have > 0 && said !== have) {
        items.push({ ...base, status: "contradicted", detail: `The interview says ${said} campuses; the school profile lists ${have}.` });
      } else {
        items.push({ ...base, status: "not_supported", detail: "Campuses are shown from the school profile, not from this answer." });
      }
      continue;
    }
    if (!appliedFields.has(field)) {
      items.push({ ...base, status: "not_supported", detail: "The generator has no place for this answer; it is not published." });
      continue;
    }
    if (field === "streams_offered" || field === "examinations") {
      const picked = Array.isArray(a.value) ? a.value.filter((v): v is string => typeof v === "string") : [];
      const shown = picked.filter((v) => LABELS[v]);
      const visible = shown.length > 0 && shown.every((v) => text.includes(LABELS[v]!));
      items.push({
        ...base,
        status: visible ? "used" : "used_not_visible",
        detail: visible ? `Shown: ${shown.map((v) => LABELS[v]).join(", ")}.` : "Applied to the site facts, but no visible block shows it.",
      });
      continue;
    }
    items.push({ ...base, status: "used", detail: plan.applied.find((x) => x.websiteField === field)?.summary ?? "Applied." });
  }
  const unreviewed = pendingReviewBlocks(doc).length;
  return {
    items,
    withheld: plan.withheldCount,
    unreviewedStandardTexts: unreviewed,
    aligned: unreviewed === 0 && !items.some((i) => i.status === "contradicted"),
  };
}
