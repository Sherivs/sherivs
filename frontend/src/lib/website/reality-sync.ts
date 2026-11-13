/**
 * SV1-REALITY R9 (#335): approved school reality -> the existing website generator's inputs. Pure.
 *
 * Reuses the generator (#135); it does not build another one. Only answers that are
 *   1. confirmed and visible,
 *   2. covered by a valid interview approval (they arrive via `approvedSnapshot`), and
 *   3. marked public-safe with a website field key in the R1 registry
 * are considered. Of those, only keys listed in FIELD_MAP are applied, because only those
 * have an existing place in the generator's inputs. A public-safe key with no existing
 * place is reported as `notSupported` and is NOT published; nothing is invented for it.
 *
 * The overlay is written onto a copy of the base facts. It never reads or emits any
 * other interview answer, so private answers cannot reach the site through this module.
 */
import { canonicalJson, type ApprovedAnswer } from "@/lib/scholar/reality";
import type { Facts } from "./generator";

export type RealityValue = ApprovedAnswer["value"];

interface FieldRule {
  /** Applies the value to a facts copy; returns a short human summary, or null if the value is not usable. */
  readonly apply: (facts: MutableFacts, value: RealityValue) => string | null;
}
type MutableFacts = { onboarding: Record<string, unknown>; data: Facts["data"] };

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};

/** creche and primary both generate the nursery & primary vocabulary; secondary stays secondary. */
const KIND_BY_TYPE: Readonly<Record<string, { kind: string; label: string }>> = {
  creche: { kind: "nursery_primary", label: "Nursery & primary school" },
  primary: { kind: "nursery_primary", label: "Nursery & primary school" },
  secondary: { kind: "secondary", label: "Secondary school" },
};

const FIELD_MAP: Readonly<Record<string, FieldRule>> = {
  institution_type: {
    apply(facts, value) {
      if (typeof value !== "string") return null;
      const hit = KIND_BY_TYPE[value];
      if (!hit) return null;
      facts.onboarding.organisation = { ...obj(facts.onboarding.organisation), org_type: hit.kind };
      return hit.label;
    },
  },
  levels_offered: {
    apply(facts, value) {
      if (!Array.isArray(value) || value.length === 0) return null;
      const levels = value.filter((v): v is string => typeof v === "string");
      const bands = new Set<string>();
      for (const l of levels) {
        if (l === "nursery") bands.add("nursery");
        else if (/^primary_[1-6]$/.test(l)) bands.add("primary");
      }
      if (bands.size === 0) return null;
      facts.onboarding.institution = {
        ...obj(facts.onboarding.institution),
        bands: [...bands].sort(),
      };
      return [...bands].sort().join(", ");
    },
  },
};

/** Field keys this module knows how to place on the site. */
export const SUPPORTED_WEBSITE_FIELDS: readonly string[] = Object.keys(FIELD_MAP).sort();

export interface AppliedField {
  readonly websiteField: string;
  readonly questionId: string;
  readonly summary: string;
}
export interface UnsupportedField {
  readonly websiteField: string;
  readonly questionId: string;
}
export interface RealitySyncPlan {
  /** Base facts with the approved overlay; the input to `generateSite`. */
  readonly facts: Facts;
  readonly applied: readonly AppliedField[];
  /** Approved and public-safe, but the generator has no existing place for it: not published. */
  readonly notSupported: readonly UnsupportedField[];
  /** Approved answers that are not public-safe; counted only, never listed. */
  readonly withheldCount: number;
  /** Detects a stale preview (changed approval or base). Drift detection, not a secret. */
  readonly planHash: string;
}

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function planRealitySync(snapshot: readonly ApprovedAnswer[], base: Facts): RealitySyncPlan {
  const facts: MutableFacts = {
    data: base.data,
    onboarding: obj(base.onboarding),
  };
  const applied: AppliedField[] = [];
  const notSupported: UnsupportedField[] = [];
  let withheld = 0;
  const seen = new Set<string>();
  // Sorted so the plan (and its hash) does not depend on snapshot order.
  const ordered = [...snapshot].sort((a, b) => (a.questionId < b.questionId ? -1 : 1));
  for (const a of ordered) {
    if (!a.publicSafe || !a.websiteField) {
      withheld++;
      continue;
    }
    if (seen.has(a.websiteField)) continue; // first (lowest id) wins: deterministic
    seen.add(a.websiteField);
    const rule = Object.prototype.hasOwnProperty.call(FIELD_MAP, a.websiteField)
      ? FIELD_MAP[a.websiteField]
      : undefined;
    if (!rule) {
      notSupported.push({ websiteField: a.websiteField, questionId: a.questionId });
      continue;
    }
    const summary = rule.apply(facts, a.value);
    if (summary === null) {
      notSupported.push({ websiteField: a.websiteField, questionId: a.questionId });
      continue;
    }
    applied.push({ websiteField: a.websiteField, questionId: a.questionId, summary });
  }
  const planHash = fnv(
    canonicalJson({
      applied: applied.map((x) => [x.websiteField, x.summary]),
      onboarding: facts.onboarding,
    }),
  );
  return {
    facts: { data: facts.data, onboarding: facts.onboarding },
    applied,
    notSupported,
    withheldCount: withheld,
    planHash,
  };
}
