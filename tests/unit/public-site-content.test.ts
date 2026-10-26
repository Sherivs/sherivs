/**
 * Public website content gates: honest availability, publication flags,
 * and route collisions with internal / tenant surfaces.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_ANNOUNCEMENT } from "@/lib/public-site/announcement";
import { publishedArticles, ARTICLE_CATEGORIES } from "@/lib/public-site/articles";
import { FAQ_ITEMS, FAQ_PREVIEW_IDS } from "@/lib/public-site/faq";
import { HELP_ARTICLES } from "@/lib/public-site/help";
import { LEGAL_DOCUMENTS } from "@/lib/public-site/legal";
import { PUBLIC_SITEMAP_PATHS } from "@/lib/public-site/navigation";
import { publishedPartners } from "@/lib/public-site/partners";
import { COMPLIANCE_CLAIMS } from "@/lib/public-site/compliance";
import { PRODUCT_FAMILIES, ARCHITECTURE_LAYERS } from "@/lib/public-site/capabilities";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (ref: string) => readFileSync(join(ROOT, ref), "utf8");

describe("public content honesty", () => {
  it("does not publish an invented announcement", () => {
    expect(PUBLIC_ANNOUNCEMENT.published).toBe(false);
  });

  it("publishes evergreen articles with required metadata", () => {
    expect(publishedArticles().length).toBeGreaterThanOrEqual(6);
    expect(ARTICLE_CATEGORIES.length).toBe(8);
    for (const article of publishedArticles()) {
      expect(article.slug).toMatch(/^[a-z0-9-]+$/);
      expect(article.seoTitle.length).toBeGreaterThan(0);
      expect(article.seoDescription.length).toBeGreaterThan(0);
      expect(article.author.name).toBe("Sherivs");
    }
  });

  it("keeps FAQ preview ids resolvable", () => {
    const ids = new Set(FAQ_ITEMS.map((item) => item.id));
    for (const id of FAQ_PREVIEW_IDS) expect(ids.has(id)).toBe(true);
  });

  it("labels help articles that are still in development", () => {
    expect(HELP_ARTICLES.some((article) => article.status === "available")).toBe(true);
    expect(HELP_ARTICLES.find((article) => article.slug === "ai-workforce")?.status).toBe(
      "in_development",
    );
  });

  it("does not index unpublished legal drafts", () => {
    for (const doc of LEGAL_DOCUMENTS) {
      if (doc.status === "draft_pending_review") expect(doc.indexable).toBe(false);
    }
  });

  it("does not treat technology integrations as commercial partners", () => {
    expect(publishedPartners("commercial")).toHaveLength(0);
    expect(publishedPartners("technology_integration").map((p) => p.id).sort()).toEqual([
      "paystack",
      "whatsapp",
    ]);
  });

  it("does not publish certification badges", () => {
    expect(COMPLIANCE_CLAIMS.filter((c) => c.status === "certified" && c.published)).toHaveLength(0);
  });

  it("keeps Scholar available and other product families not overclaimed", () => {
    expect(PRODUCT_FAMILIES.find((p) => p.id === "scholar")?.status).toBe("available");
    expect(PRODUCT_FAMILIES.find((p) => p.id === "developers")?.status).toBe("planned");
    expect(ARCHITECTURE_LAYERS).toHaveLength(8);
  });

  it("never sitemaps the internal platform engineering route or tenant blog", () => {
    expect(PUBLIC_SITEMAP_PATHS).not.toContain("/platform");
    expect(PUBLIC_SITEMAP_PATHS).not.toContain("/blog");
    expect(PUBLIC_SITEMAP_PATHS).not.toContain("/auth");
  });
});

describe("route collision guards", () => {
  it("keeps /platform session-gated", () => {
    const source = read("frontend/src/routes/platform.tsx");
    expect(source).toContain("supabase.auth.getUser");
    expect(source).toContain('"noindex, nofollow"');
  });

  it("does not replace the tenant blog routes", () => {
    expect(read("frontend/src/routes/blog.tsx")).toContain("blog_posts");
    expect(read("frontend/src/routes/(site)/insights.tsx")).toContain("/insights");
  });
});
