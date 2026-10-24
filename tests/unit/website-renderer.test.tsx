/** SHERIVS-100 phase 2: renderer, public routing, SEO and prototype removal. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RENDERED_TYPES } from "@/components/website/blocks";
import { SiteView } from "@/components/website/site-view";
import { BLOCK_TYPES } from "@/lib/website/catalog";
import { generateSite } from "@/lib/website/generator";
import { siteTarget } from "@/lib/website/public-site.functions";
import { siteSeo, siteSitemapUrls } from "@/lib/website/seo";
import type { PublicSite } from "@/lib/website/types";
import { DEMO_FACTS } from "../fixtures/website/demo-facts";

const ROOT = join(__dirname, "../..");
const site = (k: keyof typeof DEMO_FACTS, published = true): PublicSite => ({
  school_id: `00000000-0000-0000-0000-00000000000${Object.keys(DEMO_FACTS).indexOf(k) + 1}`,
  version: published ? 1 : null,
  canonical_host: null,
  document: published ? generateSite(DEMO_FACTS[k]) : null,
  data: DEMO_FACTS[k].data,
});

describe("block renderer coverage", () => {
  it("every catalog block type has a renderer and nothing else", () => {
    expect([...RENDERED_TYPES].sort()).toEqual([...BLOCK_TYPES].sort());
  });
});

describe("server render of generated sites", () => {
  for (const k of Object.keys(DEMO_FACTS) as Array<keyof typeof DEMO_FACTS>) {
    it(`${k}: renders home with its own name, nav and no foreign org`, () => {
      const html = renderToStaticMarkup(<SiteView site={site(k)} slug="home" />);
      expect(html).toContain(DEMO_FACTS[k].data.school.name.replace(/&/g, "&amp;"));
      for (const other of Object.keys(DEMO_FACTS) as Array<keyof typeof DEMO_FACTS>) {
        if (other !== k) expect(html).not.toContain(DEMO_FACTS[other].data.school.slug);
      }
      expect(html).not.toMatch(/undefined|\[object Object\]|NaN/);
      expect(html).not.toContain("<script");
    });
  }

  it("unpublished org falls back to a generated site from live data", () => {
    const html = renderToStaticMarkup(
      <SiteView site={site("bornoSecondary", false)} slug="home" />,
    );
    expect(html).toContain("sw-hero");
  });

  it("every navigable page renders without empty placeholders", () => {
    const s = site("federalUniversity");
    for (const p of s.document!.pages) {
      const html = renderToStaticMarkup(<SiteView site={s} slug={p.slug} />);
      expect(html).not.toMatch(/Lorem|TODO|placeholder/i);
    }
  });

  it("unknown page shows not-found, not another tenant", () => {
    const html = renderToStaticMarkup(<SiteView site={site("lagosNurseryPrimary")} slug="nope" />);
    expect(html).toContain("This page is not available");
  });

  it("language switch renders other locales and keeps preview param", () => {
    const s = site("bornoSecondary");
    const html = renderToStaticMarkup(
      <SiteView site={s} slug="home" lang="ha" preview="gss-gwange" />,
    );
    expect(html).toContain('lang="ha"');
    expect(html).toContain("school=gss-gwange");
  });

  it("JSON-LD escapes < so stored text cannot close the script", () => {
    const s = site("lagosNurseryPrimary");
    s.data = {
      ...s.data,
      school: { ...s.data.school, about: "</script><script>alert(1)</script>" },
    };
    const seo = siteSeo(s, "home", undefined);
    expect(seo.jsonLd).not.toContain("</script>");
    const html = renderToStaticMarkup(<SiteView site={s} slug="home" jsonLd={seo.jsonLd} />);
    expect(html.match(/<script/g)?.length).toBe(1);
  });
});

describe("tenant resolution (host decides, never the query on tenant hosts)", () => {
  it("custom domain → host only; ?school is ignored", () => {
    expect(siteTarget("www.littlepearls.edu.ng", "fu-arewa")).toEqual({
      target: { p_host: "www.littlepearls.edu.ng" },
      preview: null,
    });
  });
  it("subdomain → its slug; ?school is ignored", () => {
    expect(siteTarget("gss-gwange.sherivs.com", "fu-arewa")).toEqual({
      target: { p_slug: "gss-gwange" },
      preview: null,
    });
  });
  it("platform host → ?school preview only with a valid slug", () => {
    expect(siteTarget("sherivs.com", "fu-arewa")).toEqual({
      target: { p_slug: "fu-arewa" },
      preview: "fu-arewa",
    });
    expect(siteTarget("sherivs.com", "x';drop")).toEqual({ target: null, preview: null });
    expect(siteTarget("sherivs.com", null)).toEqual({ target: null, preview: null });
  });
});

describe("SEO + sitemap", () => {
  it("canonical uses the verified host, hreflang lists every locale", () => {
    const s = { ...site("bornoSecondary"), canonical_host: "gssgwange.edu.ng" };
    const seo = siteSeo(s, "home", "ha");
    expect(seo.canonical).toBe("https://gssgwange.edu.ng/?lang=ha");
    expect(seo.alternates.map((a) => a.hreflang)).toEqual(
      s.document!.locales.map((l) => (l === "pcm" ? "pcm-NG" : l)),
    );
  });
  it("sitemap lists only pages with content, on the org's own origin", () => {
    const urls = siteSitemapUrls(site("federalUniversity"));
    expect(urls.length).toBeGreaterThan(3);
    expect(urls.every((u) => u.startsWith("https://fu-arewa.sherivs.com/"))).toBe(true);
  });
});

describe("prototype removed", () => {
  it("hard-coded site files are gone and the index route uses the engine", () => {
    for (const f of ["site.tsx", "sections.tsx", "sections"])
      expect(existsSync(join(ROOT, "frontend/src/components/public", f))).toBe(false);
    const idx = readFileSync(join(ROOT, "frontend/src/routes/index.tsx"), "utf8");
    expect(idx).toContain("<SiteView");
    expect(idx).not.toContain("PublicSchoolSite");
    const settings = readFileSync(
      join(ROOT, "frontend/src/routes/_authenticated/admin/settings.tsx"),
      "utf8",
    );
    expect(settings).not.toMatch(/SectionsTab|HeroTab/);
    expect(settings).toContain("/admin/website");
  });
});
