/**
 * Public website content gates: honest availability, publication flags,
 * and route collisions with internal / tenant surfaces.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_ANNOUNCEMENT } from "@/lib/public-site/announcement";
import { publishedArticles, ARTICLE_CATEGORIES } from "@/lib/public-site/articles";
import { FAQ_ITEMS, FAQ_PREVIEW_IDS } from "@/lib/public-site/faq";
import { HELP_ARTICLES } from "@/lib/public-site/help";
import { LEGAL_DOCUMENTS } from "@/lib/public-site/legal";
import { PUBLIC_SITEMAP_PATHS } from "@/lib/public-site/navigation";
import {
  THINKTECH_DESCRIPTION,
  THINKTECH_HEADLINE,
  publishedPartners,
} from "@/lib/public-site/partners";
import { awaitingWordingCompliance, COMPLIANCE_CLAIMS } from "@/lib/public-site/compliance";
import { PRODUCT_FAMILIES, ARCHITECTURE_LAYERS } from "@/lib/public-site/capabilities";
import {
  PUBLIC_CONTACTS,
  PUBLIC_SOCIAL_LINKS,
  publishedCompanySocial,
  publishedFounderSocial,
  socialAriaLabel,
  socialVisibleCaption,
} from "@/lib/public-site/contacts";
import { organizationJsonLd } from "@/lib/public-site/seo";
import {
  ACCEPTING_CUSTOMERS,
  COMPANY_LOCATION_LINE,
  COMPANY_MISSION,
  COMPANY_VISION,
  EMAIL_ROUTING,
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
    expect(THINKTECH_DESCRIPTION).toBe(
      "Sherivs and ThinkTech collaborate across technology development, infrastructure, consulting, integration, and marketing to advance the Sherivs platform. Their work focuses on developing technology foundations, supporting integrations, and growing the Sherivs ecosystem.",
    );
    expect(publishedPartners("technology_partner")[0]?.summary).toBe(THINKTECH_DESCRIPTION);
    expect(read("frontend/src/lib/public-site/partners.ts")).not.toMatch(
      /scope has not been supplied/,
    );
    expect(read("frontend/src/routes/(site)/company.partners.tsx")).toContain("{THINKTECH_DESCRIPTION}");
    expect(read("frontend/src/lib/public-site/faq.ts")).toContain("THINKTECH_DESCRIPTION");
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
    expect(POSITIONING_RETHINKING).toBe(
      "Sherivs is rethinking how intelligence is deployed, how work is coordinated, and how digital representations of real-world entities operate across connected systems.",
    );
    expect(POSITIONING_PROGRAMMABLE).toBe(
      "Its long-term vision is to make computing, coordination, and intelligence programmable capabilities that institutions can build upon—not isolated tools that operate in silos.",
    );
    expect(POSITIONING_FOUNDATIONS).toMatch(/is developing the foundations/);
    expect(COMPANY_MISSION).toBe(
      "Build the computing infrastructure that enables people, institutions, and intelligent systems to work together.",
    );
    expect(COMPANY_VISION).toBe(
      "A world where intelligence, computation, and coordinated action are accessible capabilities for every institution.",
    );
    expect(read("frontend/src/components/public/sherivs-home.tsx")).toContain("{POSITIONING_STATEMENT}");
    expect(read("frontend/src/components/public/sherivs-home.tsx")).toContain("{POSITIONING_RETHINKING}");
    expect(read("frontend/src/components/public/sherivs-home.tsx")).toContain("{COMPANY_MISSION}");
    expect(read("frontend/src/components/public/sherivs-home.tsx")).toContain("{COMPANY_VISION}");
    expect(read("frontend/src/lib/public-site/faq.ts")).toContain("POSITIONING_STATEMENT");
    expect(read("frontend/src/lib/public-site/seo.ts")).toContain("POSITIONING_STATEMENT");
    expect(read("frontend/src/routes/(site)/insights.index.tsx")).toContain("POSITIONING_TAGLINE");
    expect(read("frontend/src/lib/public-site/articles.ts")).toContain("POSITIONING_STATEMENT");
    expect(PUBLIC_CONTACTS.info).toBe("info@sherivs.com");
    expect(PUBLIC_CONTACTS.hello).toBe("hello@sherivs.com");
    expect(PUBLIC_CONTACTS.support).toBe("support@sherivs.com");
    expect(PUBLIC_CONTACTS.privacy).toBe(PUBLIC_CONTACTS.info);
    expect(PUBLIC_CONTACTS.legal).toBe(PUBLIC_CONTACTS.info);
    expect(EMAIL_ROUTING.info.purpose).toMatch(/General company and administrative/i);
    expect(EMAIL_ROUTING.hello.purpose).toMatch(/Demo requests, prospective customers, partnerships/i);
    expect(EMAIL_ROUTING.support.purpose).toMatch(/Existing-customer support/i);
    expect(read("frontend/src/components/public/mailto-form.tsx")).toContain("window.location.href = href");
    expect(read("frontend/src/components/public/mailto-form.tsx")).toContain(
      "This page does not claim a ticket was created.",
    );
  });

  it("publishes only owner-supplied company socials and never GitHub", () => {
    expect(PUBLIC_SOCIAL_LINKS.map((item) => item.id).sort()).toEqual([
      "facebook",
      "github",
      "instagram",
      "linkedin",
      "x",
    ]);
    const github = PUBLIC_SOCIAL_LINKS.find((item) => item.id === "github");
    expect(github?.published).toBe(false);
    expect(github?.href).toBe("");
    expect(github?.surface).toBe("none");
    expect(publishedCompanySocial().map((item) => item.id).sort()).toEqual([
      "facebook",
      "instagram",
      "x",
    ]);
    expect(publishedCompanySocial().every((item) => item.id !== "github")).toBe(true);
    expect(publishedFounderSocial()).toEqual([]);
    const instagram = PUBLIC_SOCIAL_LINKS.find((item) => item.id === "instagram");
    expect(instagram?.published).toBe(true);
    expect(instagram?.handle).toBe("@sherivs_");
    expect(instagram?.href).toMatch(/instagram\.com\/sherivs_/);
    expect(socialVisibleCaption(instagram!)).toBe("Instagram @sherivs_");
    const facebook = PUBLIC_SOCIAL_LINKS.find((item) => item.id === "facebook");
    expect(facebook?.published).toBe(true);
    expect(facebook?.label).toBe("Facebook");
    expect(facebook?.pageName).toBe("Sherivs Team");
    expect(socialVisibleCaption(facebook!)).toBe("Facebook — Sherivs Team");
    expect(socialAriaLabel(facebook!)).toBe("Sherivs Team on Facebook");
    const linkedin = PUBLIC_SOCIAL_LINKS.find((item) => item.id === "linkedin");
    expect(linkedin?.published).toBe(false);
    expect(linkedin?.href).toBe("");
    expect(linkedin?.surface).toBe("company");
    const x = PUBLIC_SOCIAL_LINKS.find((item) => item.id === "x");
    expect(x?.published).toBe(true);
    expect(x?.handle).toBe("@sherivs_");
    expect(x?.href).toBe("https://x.com/sherivs_");
    expect(socialVisibleCaption(x!)).toBe("X @sherivs_");
    expect(organizationJsonLd().sameAs).toContain("https://x.com/sherivs_");
    expect(organizationJsonLd().sameAs.join(" ")).not.toMatch(/github/i);
    expect(organizationJsonLd().sameAs.join(" ")).not.toMatch(/linkedin/i);
    expect(read("frontend/src/lib/public-site/contacts.ts")).toContain('href: "https://x.com/sherivs_"');
    expect(read("frontend/src/lib/public-site/contacts.ts")).not.toMatch(/linkedin\.com\/in\//i);
    expect(read("frontend/src/lib/public-site/seo.ts")).toContain('name: "twitter:site"');
    expect(read("frontend/src/routes/__root.tsx")).toContain('name: "twitter:site"');
    expect(read("frontend/src/routes/(site)/company.vision.tsx")).toContain("{POSITIONING_STATEMENT}");
    expect(read("frontend/src/routes/(site)/company.vision.tsx")).toContain("{POSITIONING_RETHINKING}");
    expect(read("frontend/src/components/public/site-footer.tsx")).toContain("CompanySocialLinks");
    expect(read("frontend/src/routes/(site)/contact.tsx")).toContain("CompanySocialLinks");
    expect(read("frontend/src/components/public/company-social-links.tsx")).toContain("href={item.href}");
    expect(read("frontend/src/components/public/company-social-links.tsx")).toContain("socialVisibleCaption");
    expect(read("frontend/src/components/public/company-social-links.tsx")).not.toMatch(/github/i);
    expect(read("frontend/src/components/public/site-footer.tsx")).not.toMatch(/github/i);
    expect(read("frontend/src/routes/(site)/contact.tsx")).not.toMatch(/github/i);
    expect(read("frontend/src/routes/(site)/about.tsx")).not.toMatch(/linkedin/i);
    expect(read("frontend/src/routes/(site)/about.tsx")).not.toMatch(/publishedFounderSocial/);
  });

  it("does not publish TIN, NSCDC, NDPA, or certification badges", () => {
    expect(COMPLIANCE_CLAIMS.find((c) => c.id === "tin")?.published).toBe(false);
    expect(COMPLIANCE_CLAIMS.find((c) => c.id === "cac")?.published).toBe(false);
    expect(COMPLIANCE_CLAIMS.find((c) => c.id === "nscdc")?.status).toBe("certified");
    expect(COMPLIANCE_CLAIMS.find((c) => c.id === "ndpa")?.status).toBe("certified");
    expect(COMPLIANCE_CLAIMS.find((c) => c.id === "nscdc")?.published).toBe(false);
    expect(COMPLIANCE_CLAIMS.find((c) => c.id === "ndpa")?.published).toBe(false);
    expect(COMPLIANCE_CLAIMS.find((c) => c.id === "nscdc")?.wordingGate).toBe(
      "awaiting_owner_approved_wording",
    );
    expect(COMPLIANCE_CLAIMS.find((c) => c.id === "ndpa")?.wordingGate).toBe(
      "awaiting_owner_approved_wording",
    );
    expect(awaitingWordingCompliance().map((c) => c.id).sort()).toEqual(["ndpa", "nscdc"]);
    expect(read("frontend/src/routes/(site)/trust.tsx")).toContain("Awaiting owner-approved wording");
    expect(read("frontend/src/routes/(site)/trust.tsx")).not.toMatch(/NSCDC certified|NDPA certified/i);
    expect(read("frontend/src/routes/(site)/trust.tsx")).not.toMatch(/pending and are not shown as completed/);
  });

  it("keeps the homepage free of customer-availability announcements", () => {
    const home = read("frontend/src/components/public/sherivs-home.tsx");
    expect(home).not.toMatch(/accepting customers|now accepting|open for customers/i);
    expect(home).toContain('href="/sherivs"');
    expect(home).toContain('href="/request-demo"');
    expect(FAQ_PREVIEW_IDS).not.toContain("how-to-start");
    expect(FAQ_PREVIEW_IDS).not.toContain("who-sherivs-serves");
    for (const id of FAQ_PREVIEW_IDS) {
      const item = FAQ_ITEMS.find((entry) => entry.id === id);
      expect(item?.answer, id).not.toMatch(/accepting customers/i);
    }
  });

  it("does not publish certification badges", () => {
    expect(COMPLIANCE_CLAIMS.filter((c) => c.status === "certified" && c.published)).toHaveLength(0);
  });

  it("keeps Scholar available and other product families not overclaimed", () => {
    expect(PRODUCT_FAMILIES.find((p) => p.id === "scholar")?.status).toBe("available");
    expect(PRODUCT_FAMILIES.find((p) => p.id === "developers")?.status).toBe("planned");
    expect(ARCHITECTURE_LAYERS).toHaveLength(8);
  });

  it("keeps GitHub URLs, CAC numbers, and TIN off public marketing sources", () => {
    const roots = [
      "frontend/src/lib/public-site",
      "frontend/src/components/public",
      "frontend/src/routes/(site)",
    ];
    const files = roots.flatMap((dir) =>
      readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
        .filter((name) => /\.(tsx?)$/.test(String(name)))
        .map((name) => join(dir, String(name))),
    );
    for (const ref of files) {
      const source = read(ref);
      expect(source, ref).not.toMatch(/github\.com\//i);
      expect(source, ref).not.toMatch(/linkedin\.com\/in\//i);
      expect(source, ref).not.toMatch(/linkedin\.com\/company\//i);
      expect(source, ref).not.toMatch(/\bRC[\s-]*\d{5,}\b/);
      expect(source, ref).not.toMatch(/\bTIN[\s:]*\d{6,}\b/i);
    }
  });

  it("never sitemaps the internal platform engineering route or tenant blog", () => {
    expect(PUBLIC_SITEMAP_PATHS).not.toContain("/platform");
    expect(PUBLIC_SITEMAP_PATHS).not.toContain("/blog");
    expect(PUBLIC_SITEMAP_PATHS).not.toContain("/auth");
  });
});

describe("route collision guards", () => {
  it("keeps /platform session-gated", () => {
    expect(existsSync(join(ROOT, "frontend/src/routes/platform.tsx"))).toBe(false);
  });

  it("does not replace the tenant blog routes", () => {
    expect(existsSync(join(ROOT, "frontend/src/routes/blog.tsx"))).toBe(false);
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
