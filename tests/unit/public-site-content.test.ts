/**
 * Public website content gates: honest availability, publication flags,
 * and route collisions with internal / tenant surfaces.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_ANNOUNCEMENT } from "@/lib/public-site/announcement";
import { publishedArticles, ARTICLE_CATEGORIES } from "@/lib/public-site/articles";
import { FAQ_ITEMS, FAQ_PREVIEW_IDS } from "@/lib/public-site/faq";
import { HELP_ARTICLES } from "@/lib/public-site/help";
import { LEGAL_DOCUMENTS } from "@/lib/public-site/legal";
import { PUBLIC_SITEMAP_PATHS } from "@/lib/public-site/navigation";
import {
  THINKTECH_COLLABORATION,
  THINKTECH_FOCUS,
  THINKTECH_HEADLINE,
  THINKTECH_RELATIONSHIP,
  publishedPartners,
} from "@/lib/public-site/partners";
import { COMPLIANCE_CLAIMS } from "@/lib/public-site/compliance";
import { PRODUCT_FAMILIES, ARCHITECTURE_LAYERS } from "@/lib/public-site/capabilities";
import { PUBLIC_CONTACTS, PUBLIC_SOCIAL_LINKS } from "@/lib/public-site/contacts";
import {
  ACCEPTING_CUSTOMERS,
  COMPANY_LOCATION_LINE,
  COMPANY_MISSION,
  COMPANY_VISION,
  LEGAL_ENTITY_NAME,
  POSITIONING_FOUNDATIONS,
  POSITIONING_PROGRAMMABLE,
  POSITIONING_RETHINKING,
  POSITIONING_STATEMENT,
  POSITIONING_TAGLINE,
} from "@/lib/public-site/company";
import { PLATFORM_PAGE_DESCRIPTION, PLATFORM_PAGE_TITLE, PLATFORM_TAGLINE } from "@/lib/platform";

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
    expect(publishedPartners("technology_partner").map((p) => p.id)).toEqual(["thinktech"]);
    expect(publishedPartners("technology_partner")[0]?.logoSrc).toBe("/partners/thinktech.png");
    expect(THINKTECH_HEADLINE).toBe("Building the next generation of intelligent technology");
    expect(THINKTECH_COLLABORATION).toMatch(/collaborating across technology development/);
    expect(THINKTECH_RELATIONSHIP).toMatch(/establishing, integrating, and growing/);
    expect(THINKTECH_FOCUS).toMatch(/technology foundations, supporting integrations/);
    expect(publishedPartners("technology_partner")[0]?.summary).toBe(THINKTECH_COLLABORATION);
    expect(read("frontend/src/lib/public-site/partners.ts")).not.toMatch(
      /scope has not been supplied/,
    );
    expect(read("frontend/src/routes/(site)/company.partners.tsx")).toContain("{THINKTECH_FOCUS}");
    expect(read("frontend/src/lib/public-site/faq.ts")).toContain("THINKTECH_COLLABORATION");
    expect(existsSync(join(ROOT, "public/partners/thinktech.png"))).toBe(true);
    expect(existsSync(join(ROOT, "public/brand/sherivs-wordmark.png"))).toBe(true);
    expect(existsSync(join(ROOT, "docs/brand/sherivs-wordmark-source.png"))).toBe(true);
  });

  it("uses owner-provided company identity without inventing registration numbers", () => {
    expect(LEGAL_ENTITY_NAME).toBe("Sherivs Technologies Limited");
    expect(COMPANY_LOCATION_LINE).toBe("Maiduguri, Borno State, Nigeria");
    expect(ACCEPTING_CUSTOMERS).toBe(true);
    expect(POSITIONING_TAGLINE).toBe("Intelligence infrastructure for a more connected world");
    expect(PLATFORM_TAGLINE).toBe(POSITIONING_TAGLINE);
    expect(PLATFORM_PAGE_TITLE).toBe(`Sherivs — ${POSITIONING_TAGLINE}`);
    expect(PLATFORM_PAGE_DESCRIPTION).toBe(POSITIONING_STATEMENT);
    expect(POSITIONING_STATEMENT).toMatch(/AI-native institutional computing platform/);
    expect(POSITIONING_RETHINKING).toMatch(/rethinking how intelligence is deployed/);
    expect(POSITIONING_PROGRAMMABLE).toMatch(/programmable capabilities/);
    expect(POSITIONING_FOUNDATIONS).toMatch(/is developing the foundations/);
    expect(COMPANY_MISSION).toBe(
      "Build the computing infrastructure that enables people, institutions, and intelligent systems to work together.",
    );
    expect(COMPANY_VISION).toBe(
      "A world where intelligence, computation, and coordinated action are accessible capabilities for every institution.",
    );
    expect(read("frontend/src/components/public/sherivs-home.tsx")).toContain("{POSITIONING_STATEMENT}");
    expect(read("frontend/src/components/public/sherivs-home.tsx")).toContain("{COMPANY_MISSION}");
    expect(read("frontend/src/components/public/sherivs-home.tsx")).toContain("{COMPANY_VISION}");
    expect(read("frontend/src/lib/public-site/faq.ts")).toContain("POSITIONING_STATEMENT");
    expect(read("frontend/src/lib/public-site/seo.ts")).toContain("POSITIONING_STATEMENT");
    expect(PUBLIC_CONTACTS.info).toBe("info@sherivs.com");
    expect(PUBLIC_CONTACTS.hello).toBe("hello@sherivs.com");
    expect(PUBLIC_CONTACTS.support).toBe("support@sherivs.com");
    expect(PUBLIC_CONTACTS.privacy).toBe(PUBLIC_CONTACTS.info);
    expect(PUBLIC_CONTACTS.legal).toBe(PUBLIC_CONTACTS.info);
  });

  it("keeps social links unpublished until URLs are supplied", () => {
    expect(PUBLIC_SOCIAL_LINKS.every((item) => item.published === false)).toBe(true);
    expect(PUBLIC_SOCIAL_LINKS.map((item) => item.id).sort()).toEqual([
      "facebook",
      "github",
      "instagram",
      "linkedin",
      "x",
    ]);
  });

  it("does not publish TIN, NSCDC, NDPA, or certification badges", () => {
    expect(COMPLIANCE_CLAIMS.find((c) => c.id === "tin")?.published).toBe(false);
    expect(COMPLIANCE_CLAIMS.find((c) => c.id === "nscdc")?.status).toBe("pending");
    expect(COMPLIANCE_CLAIMS.find((c) => c.id === "ndpa")?.status).toBe("pending");
    expect(COMPLIANCE_CLAIMS.find((c) => c.id === "nscdc")?.published).toBe(false);
    expect(COMPLIANCE_CLAIMS.find((c) => c.id === "ndpa")?.published).toBe(false);
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
    expect(read("frontend/src/routes/(site)/insights.index.tsx")).toContain("/insights");
  });
});

describe("nested public layouts do not swallow children", () => {
  const layouts = [
    "frontend/src/routes/(site)/product.tsx",
    "frontend/src/routes/(site)/solutions.tsx",
    "frontend/src/routes/(site)/security.tsx",
    "frontend/src/routes/(site)/help.tsx",
    "frontend/src/routes/(site)/insights.tsx",
  ];

  it("renders an Outlet in every parent that has nested public pages", () => {
    for (const file of layouts) {
      const source = read(file);
      expect(source, file).toContain("<Outlet />");
      expect(source, file).not.toContain("throw redirect");
    }
  });

  it("keeps the /product → /sherivs alias on the index route only", () => {
    const index = read("frontend/src/routes/(site)/product.index.tsx");
    expect(index).toContain('createFileRoute("/(site)/product/")');
    expect(index).toContain('redirect({ to: "/sherivs" })');
    expect(read("frontend/src/routes/(site)/product.architecture.tsx")).toContain(
      "ProductLayerPage",
    );
  });
});
