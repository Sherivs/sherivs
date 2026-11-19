/**
 * M21 public-site truth guard (mission E-011).
 *
 * Brand rule (master brief §1): no public page may advertise a capability
 * that is not verified in production; no invented testimonials, customers,
 * statistics, certifications, partnerships or mandates; no "digital twin"
 * marketing claim; retired internal names never appear on customer-facing
 * pages. The full claim inventory is docs/public-site/TRUTH_AUDIT_2026-11-17.md.
 *
 * Scope: the public site sources — frontend/src/routes/(site)/**,
 * frontend/src/components/public/** and frontend/src/lib/public-site/**.
 * Comments are stripped before scanning so engineering notes may still name
 * history. Two data modules carry unpublished drafts and owner notes that
 * never render (articles.ts drafts, compliance.ts owner context); for those
 * the test checks the rendered selection through their own publish gates.
 *
 * The claim denylist is deliberately tight: each "removed" pattern is a
 * sentence the 2026-11-17 audit removed, and each "preventive" pattern is a
 * positive boast that honest text never needs (negations such as "SOC 2 ...
 * badges are not displayed" do not match).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ARTICLE_CATEGORIES, publishedArticles } from "@/lib/public-site/articles";
import { awaitingWordingCompliance, publishedCompliance } from "@/lib/public-site/compliance";
import { listedHelpArticles } from "@/lib/public-site/help";
import { MARKETING_TIERS } from "@/routes/(site)/-content/pricing-tiers";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SITE_ROOTS = [
  "frontend/src/routes/(site)",
  "frontend/src/components/public",
  "frontend/src/lib/public-site",
] as const;

/** Data modules whose raw text includes never-rendered drafts or owner notes. */
const GATED_DATA_FILES = new Set([
  "frontend/src/lib/public-site/articles.ts",
  "frontend/src/lib/public-site/compliance.ts",
]);

function siteFiles(): string[] {
  return SITE_ROOTS.flatMap((dir) =>
    readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
      .filter((name) => /\.(tsx?)$/.test(name))
      .map((name) => join(dir, name).split("\\").join("/")),
  );
}

/** Removes block comments and whole-line `//` comments; keeps string literals. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

function visibleSource(ref: string): string {
  return (
    stripComments(readFileSync(join(ROOT, ref), "utf8"))
      // The legacy /coregrid URL is a 301 redirect kept for old links; the
      // retired name is never rendered (pinned by site-marketing.test.ts).
      .replace(/"\/\(site\)\/coregrid"|"\/coregrid"/g, '""')
  );
}

const RETIRED_NAMES: readonly RegExp[] = [
  /\bcore[\s-]?grid\b/i,
  /\bluna\b/i,
  /\buniversal[\s-]?school[\s-]?os\b/i,
  /\buniversalschoolos\b/i,
  /\bvibeora\b/i,
];

/** Prose "digital twin(s)". Hyphenated slugs and ids (digital-twins) are routes, not copy. */
const DIGITAL_TWIN_CLAIM = /\bdigital twins?\b/i;

/** Sentences removed by the 2026-11-17 truth audit. They must not come back. */
const REMOVED_CLAIMS: readonly RegExp[] = [
  /AI workforce and Digital Twin/i,
  /Full governed autonomy/i,
  /Verified integration paths/i,
  /can settle through Paystack/i,
  /Schools can publish a public website/i,
  /Workers operate inside permissions/i,
  /shows a commercial catalog/i,
  /Everything your school needs/i,
  /Administrative twin surfaces exist/i,
  /Admin digital-twin UI exists/i,
];

/** Positive boasts that honest copy never needs. */
const PREVENTIVE_CLAIMS: readonly RegExp[] = [
  /\btrusted by\b/i,
  /\b\d[\d,.]*\s*\+?\s*(?:schools|students|institutions|customers|users|teachers|parents|organi[sz]ations)\b/i,
  /\b(?:ISO(?:\/IEC)?\s?27001|SOC\s?2)(?:\s+Type\s+I{1,2})?\s+(?:certified|compliant|attested|accredited)\b/i,
  /\b(?:NDPA|NDPC|NSCDC|GDPR)[\s-](?:certified|compliant|accredited)\b/i,
  /\b(?:approved|endorsed|mandated)\s+by\s+(?:the\s+)?(?:federal|state)?\s*ministry\b/i,
];

describe("public site truth guard", () => {
  const files = siteFiles();

  it("scans a non-trivial set of public site sources", () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files).toContain("frontend/src/components/public/sherivs-home.tsx");
    expect(files).toContain("frontend/src/routes/(site)/-content/site-content.ts");
  });

  it("never renders a retired internal name", () => {
    for (const ref of files) {
      const source = visibleSource(ref);
      for (const pattern of RETIRED_NAMES) expect(source, `${ref} ${pattern}`).not.toMatch(pattern);
    }
  });

  it("does not use 'digital twin' as marketing copy", () => {
    for (const ref of files) {
      if (GATED_DATA_FILES.has(ref)) continue;
      expect(visibleSource(ref), ref).not.toMatch(DIGITAL_TWIN_CLAIM);
    }
    for (const article of publishedArticles()) {
      const text = JSON.stringify(article);
      expect(text, article.slug).not.toMatch(DIGITAL_TWIN_CLAIM);
    }
    for (const category of ARTICLE_CATEGORIES) {
      expect(category).not.toMatch(DIGITAL_TWIN_CLAIM);
    }
    for (const article of listedHelpArticles()) {
      expect(JSON.stringify(article), article.slug).not.toMatch(DIGITAL_TWIN_CLAIM);
    }
  });

  it("does not bring back claims the truth audit removed", () => {
    for (const ref of files) {
      const source = visibleSource(ref);
      for (const pattern of REMOVED_CLAIMS)
        expect(source, `${ref} ${pattern}`).not.toMatch(pattern);
    }
  });

  it("carries no customer, statistic, certification, or mandate boasts", () => {
    const rendered = [
      ...files.filter((ref) => !GATED_DATA_FILES.has(ref)).map((ref) => [ref, visibleSource(ref)]),
      ...publishedArticles().map((a) => [`article:${a.slug}`, JSON.stringify(a)]),
      ...[...publishedCompliance(), ...awaitingWordingCompliance()].map((c) => [
        `compliance:${c.id}`,
        `${c.name} ${c.summary}`,
      ]),
    ];
    for (const [ref, text] of rendered) {
      for (const pattern of PREVENTIVE_CLAIMS)
        expect(text, `${ref} ${pattern}`).not.toMatch(pattern);
    }
  });

  it("marks unshipped pricing highlights as coming and offers no self-serve checkout", () => {
    const unshipped =
      /\b(?:AI|SMS|WhatsApp|payments?|API|domain|database|multi-branch|email|reports|priority)\b/i;
    for (const tier of MARKETING_TIERS) {
      expect(tier.ctaLabel, tier.id).toBe("Talk to us");
      for (const highlight of tier.highlights) {
        if (unshipped.test(highlight)) expect(highlight, tier.id).toMatch(/\(coming\)$/);
      }
    }
  });

  it("shows a 'not yet reviewed by legal counsel' notice on published legal pages", () => {
    const view = readFileSync(
      join(ROOT, "frontend/src/components/public/legal-document.tsx"),
      "utf8",
    );
    expect(view).toContain('doc.status === "published" && doc.counselReviewed !== true');
    expect(view).toContain("Not yet reviewed by legal counsel");
  });
});
