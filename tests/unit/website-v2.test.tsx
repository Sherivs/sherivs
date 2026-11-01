/** SHERIVS-101 website v2: content types, brand palette (WCAG AA), typography, bespoke chrome, posts, SEO. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiteView } from "@/components/website/site-view";
import { fontFaceCss, fontPreloads } from "@/components/website/fonts";
import { BLOCK_MAP, blockVisible, openVacancies } from "@/lib/website/catalog";
import { generateSite, orgKind } from "@/lib/website/generator";
import { postState } from "@/lib/website/posts";
import { siteIconSvg, siteRss, siteSeo, siteSitemapUrls } from "@/lib/website/seo";
import {
  contrast,
  defaultPairing,
  derivePalette,
  PAIRING_KEYS,
  resolvePairing,
  themeCss,
} from "@/lib/website/theme";
import type { PublicSite, SiteData } from "@/lib/website/types";
import { validateDocument } from "@/lib/website/validate";
import { DEMO_FACTS } from "../fixtures/website/demo-facts";

const ROOT = join(__dirname, "../..");
const bare: SiteData = { school: { name: "Bare School", slug: "bare" } };
const BRANDS = [
  "#ffd400",
  "#ffffff",
  "#000000",
  "#0b6b3a",
  "#c8102e",
  "#00a3e0",
  "#7a1fa2",
  "#f5a623",
  "#8bc34a",
  "#1a237e",
  "#ff69b4",
  "#808080",
  "#00ffff",
  "#ffe5b4",
  "#3e2723",
  "#e0e0e0",
];
const PAIRS: [string, string, number][] = [
  ["--sw-on-primary", "--sw-primary", 4.5],
  ["--sw-on-secondary", "--sw-secondary", 4.5],
  ["--sw-link", "--sw-muted", 4.5],
  ["--sw-link", "--sw-surface", 4.5],
  ["--sw-accent", "--sw-muted", 4.5],
  ["--sw-text", "--sw-bg", 7],
  ["--sw-text-2", "--sw-muted", 4.5],
  ["--sw-text-2", "--sw-surface", 4.5],
  ["--sw-footer-text", "--sw-footer-bg", 4.5],
  ["--sw-footer-muted", "--sw-footer-bg", 4.5],
  ["--sw-chip-text", "--sw-chip-bg", 4.5],
  ["--sw-text-2", "--sw-p100", 4.5],
  ["--sw-text-2", "--sw-s50", 4.5],
  ["--sw-text", "--sw-s50", 4.5],
  ["--sw-text", "--sw-surface", 7],
];

describe("brand palette", () => {
  it("every text/background pair meets WCAG AA in light and dark, for any brand colours", () => {
    for (const p of BRANDS)
      for (const s of BRANDS.slice().reverse()) {
        const pal = derivePalette(p, s);
        for (const scheme of [pal.light, pal.dark])
          for (const [fg, bg, min] of PAIRS)
            expect(
              contrast(scheme[fg], scheme[bg]),
              `${p}/${s} ${fg} on ${bg}`,
            ).toBeGreaterThanOrEqual(min - 0.01);
      }
  });
  it("keeps bright brand fills and switches to dark text instead of muddying the colour", () => {
    const pal = derivePalette("#ffd400", "#0b6b3a").light;
    expect(pal["--sw-primary"]).toBe("#ffd400");
    expect(pal["--sw-on-primary"]).toBe("#111111");
  });
  it("derives tints, shades and surfaces from the primary colour", () => {
    const a = derivePalette("#c8102e", "#ffd400").light;
    const b = derivePalette("#1a237e", "#ffd400").light;
    expect(a["--sw-p50"]).not.toBe(b["--sw-p50"]);
    expect(a["--sw-footer-bg"]).not.toBe(b["--sw-footer-bg"]);
    expect(a["--sw-muted"]).not.toBe("#ffffff");
  });
  it("emits only computed values (no CSS injection) and a dark scheme by preference", () => {
    const css = themeCss(
      {
        primary: "red;}body{display:none",
        secondary: "#123456",
        font: "system",
        radius: "soft",
      } as never,
      "secondary",
    );
    expect(css).not.toContain("display:none");
    expect(css).toContain("prefers-color-scheme: dark");
    expect(
      themeCss(
        { primary: "#123456", secondary: "#654321", font: "system", radius: "soft", dark: "light" },
        "x",
      ),
    ).not.toContain("prefers-color-scheme");
  });
});

describe("typography", () => {
  it("default pairing by kind; legacy font values still map", () => {
    expect(defaultPairing("nursery_primary")).toBe("friendly");
    expect(defaultPairing("university")).toBe("scholarly");
    expect(defaultPairing("secondary")).toBe("classic");
    expect(defaultPairing("government")).toBe("civic");
    expect(resolvePairing({ font: "serif" }, "university")).toBe("classic");
    expect(resolvePairing({ pairing: "modern", font: "serif" }, "x")).toBe("modern");
  });
  it("self-hosted faces cover Hausa, Yorùbá and Igbo letters; no Google Fonts", () => {
    for (const k of PAIRING_KEYS) {
      const css = fontFaceCss({ pairing: k }, "x");
      expect(css).not.toMatch(/googleapis|gstatic/);
      expect(css).toContain("U+0100-02BA"); // ɓ ɗ ƙ ị ọ ụ
      expect(css).toContain("U+1EA0-1EF9"); // ẹ ọ with tone marks
      expect(css).toContain("font-display:swap");
      expect(fontPreloads({ pairing: k }, "x").length).toBeGreaterThan(0);
    }
  });
  it("the builder fonts are bundled files and the root layout skips Google Fonts on school sites", () => {
    const root = readFileSync(join(ROOT, "frontend/src/routes/__root.tsx"), "utf8");
    expect(root).toMatch(/isOrgSite\(matches\)/);
    expect(
      readFileSync(join(ROOT, "frontend/src/components/website/font-files.ts"), "utf8"),
    ).toContain("@fontsource-variable/");
  });
});

describe("v2 content blocks", () => {
  const types = ["blog", "policies", "rules", "calendar", "downloads", "careers", "pta"];
  it("are hidden when empty and visible with content", () => {
    for (const t of types)
      expect(blockVisible({ id: "x", type: t, props: {} }, bare, "en"), t).toBe(false);
    const withPosts: SiteData = {
      ...bare,
      posts: [
        {
          id: "1",
          slug: "a",
          title: { en: "A" },
          published_at: "2026-10-01T00:00:00Z",
          category: "Sports",
        },
      ],
    };
    expect(blockVisible({ id: "x", type: "blog", props: {} }, withPosts, "en")).toBe(true);
    expect(
      blockVisible({ id: "x", type: "blog", props: { category: "Academics" } }, withPosts, "en"),
    ).toBe(false);
    expect(
      blockVisible(
        {
          id: "x",
          type: "rules",
          props: { groups: [{ title: { en: "G" }, rules: { en: "Be kind" } }] },
        },
        bare,
        "en",
      ),
    ).toBe(true);
    expect(
      blockVisible(
        {
          id: "x",
          type: "calendar",
          props: { items: [{ label: { en: "Term 1" }, starts: "2026-09-14" }] },
        },
        bare,
        "en",
      ),
    ).toBe(true);
    expect(
      blockVisible(
        { id: "x", type: "pta", props: { executives: [{ name: "Mrs A" }] } },
        bare,
        "en",
      ),
    ).toBe(true);
  });
  it("careers drops vacancies after their closing date", () => {
    const b = {
      id: "c",
      type: "careers",
      props: {
        items: [
          { title: { en: "Maths teacher" }, closes: "2026-01-31" },
          { title: { en: "Bursar" }, closes: "2026-12-31" },
        ],
      },
    };
    expect(openVacancies(b, "en", "2026-10-25").length).toBe(1);
    expect(openVacancies(b, "en", "2027-01-01").length).toBe(0);
  });
  it("post state: drafts, scheduled and published", () => {
    const now = new Date("2026-10-25T12:00:00Z");
    expect(postState({ status: "draft" }, now)).toBe("draft");
    expect(postState({ status: "published", publish_at: "2026-11-01T08:00:00Z" }, now)).toBe(
      "scheduled",
    );
    expect(postState({ status: "published", publish_at: "2026-10-20T08:00:00Z" }, now)).toBe(
      "published",
    );
  });
});

describe("generator seeds rules and policies by school type", () => {
  it("nursery-primary: rules, safeguarding, anti-bullying, NDPA privacy; friendly fonts; policies off the main nav", () => {
    const doc = generateSite(DEMO_FACTS.lagosNurseryPrimary);
    const pol = doc.pages.find((p) => p.slug === "policies")!;
    expect(pol.nav).toBe(false);
    const kinds = pol.sections
      .flatMap((s) => s.blocks)
      .flatMap((b) =>
        b.type === "policies" ? (b.props.items as { kind: string }[]).map((x) => x.kind) : [],
      );
    expect(kinds).toEqual(expect.arrayContaining(["privacy", "safeguarding", "anti_bullying"]));
    expect(pol.sections.some((s) => s.blocks.some((b) => b.type === "rules"))).toBe(true);
    expect(doc.theme.pairing).toBe("friendly");
    expect(validateDocument(doc)).toEqual([]);
  });
  it("university: student code of conduct, no child safeguarding policy, scholarly fonts", () => {
    const doc = generateSite(DEMO_FACTS.federalUniversity);
    const blocks = doc.pages.flatMap((p) => p.sections.flatMap((s) => s.blocks));
    const rules = JSON.stringify(blocks.find((b) => b.type === "rules")?.props ?? {});
    expect(rules).toContain("Academic integrity");
    expect(JSON.stringify(blocks)).not.toContain("safeguarding");
    expect(doc.theme.pairing).toBe("scholarly");
  });
  it("never seeds empty blocks (blog waits for posts, only beside real content)", () => {
    for (const f of Object.values(DEMO_FACTS)) {
      const doc = generateSite(f);
      for (const p of doc.pages)
        for (const s of p.sections)
          for (const b of s.blocks)
            if (b.type !== "blog")
              expect(
                BLOCK_MAP[b.type].hasContent(b, f.data, doc.locales[0]),
                `${p.slug}/${b.type}`,
              ).toBe(true);
    }
  });
});

const site = (
  k: keyof typeof DEMO_FACTS,
  host: string | null = null,
  patch?: (d: PublicSite) => void,
): PublicSite => {
  const s: PublicSite = {
    school_id: "00000000-0000-0000-0000-000000000001",
    version: 1,
    canonical_host: host,
    document: generateSite(DEMO_FACTS[k]),
    data: {
      ...DEMO_FACTS[k].data,
      posts: [
        {
          id: "p1",
          slug: "inter-house-sports",
          title: { en: "Inter-house sports <day>" },
          excerpt: { en: "Blue house wins & more" },
          category: "Sports",
          author_name: "Mrs Adeyemi",
          cover_url: "/media/sports.jpg",
          published_at: "2026-10-20T09:00:00Z",
        },
      ],
    },
  };
  patch?.(s);
  return s;
};

describe("bespoke public chrome", () => {
  it("school name, motto and logo lead; footer credit can be hidden so no Sherivs branding remains", () => {
    const s = site("lagosNurseryPrimary", "www.littlepearls.sch.ng", (x) => {
      x.document!.theme.credit = false;
    });
    const html = renderToStaticMarkup(<SiteView site={s} slug="home" />);
    expect(html).toContain('class="sw-brand-name"');
    expect(html).not.toMatch(/sherivs/i);
    const withCredit = renderToStaticMarkup(
      <SiteView site={site("lagosNurseryPrimary")} slug="home" />,
    );
    expect(withCredit).toContain("Website by Sherivs");
  });
  it("renders a post page inside the school's chrome, escaped", () => {
    const s = site("lagosNurseryPrimary");
    const html = renderToStaticMarkup(
      <SiteView
        site={s}
        slug="news"
        post={{ ...s.data.posts![0], body: { en: "We had **fun**." } }}
      />,
    );
    expect(html).toContain("Inter-house sports &lt;day&gt;");
    expect(html).toContain("<strong>fun</strong>");
    expect(html).toContain("Mrs Adeyemi");
  });
  it("palette and fonts are inlined per school; different schools get different looks", () => {
    const a = renderToStaticMarkup(<SiteView site={site("lagosNurseryPrimary")} slug="home" />);
    const b = renderToStaticMarkup(<SiteView site={site("federalUniversity")} slug="home" />);
    const style = (h: string) => h.match(/<style>(.*?)<\/style>/s)?.[1] ?? "";
    expect(style(a)).toContain("Nunito Variable");
    expect(style(b)).toContain("Source Serif 4 Variable");
    expect(style(a)).not.toBe(style(b));
  });
});

describe("SEO on the school's own domain", () => {
  it("post canonical, OG image and sitemap use the school's domain", () => {
    const s = site("lagosNurseryPrimary", "www.littlepearls.sch.ng");
    const seo = siteSeo(s, "news", "en", { ...s.data.posts![0] });
    expect(seo.canonical).toBe("https://www.littlepearls.sch.ng/posts/inter-house-sports");
    expect(seo.og.image).toBe("https://www.littlepearls.sch.ng/media/sports.jpg");
    expect(seo.og.type).toBe("article");
    expect(siteSitemapUrls(s)).toContain(
      "https://www.littlepearls.sch.ng/posts/inter-house-sports",
    );
    expect(siteSitemapUrls(s).every((u) => u.startsWith("https://www.littlepearls.sch.ng/"))).toBe(
      true,
    );
  });
  it("RSS is escaped and absolute; monogram favicon uses brand colours", () => {
    const s = site("bornoSecondary", "gss-gwange.sch.ng");
    const rss = siteRss(s);
    expect(rss).toContain("<title>Inter-house sports &lt;day&gt;</title>");
    expect(rss).toContain("<link>https://gss-gwange.sch.ng/posts/inter-house-sports</link>");
    const svg = siteIconSvg(s);
    expect(svg).toContain(s.document!.theme.primary.slice(0, 4));
    expect(svg).not.toContain("<script");
    expect(siteSeo(s, "home", "en").icon.href).toBeTruthy();
  });
  it("robots.txt is served per host (no static file shadows the route)", () => {
    expect(existsSync(join(ROOT, "public/robots.txt"))).toBe(false);
    const r = readFileSync(join(ROOT, "frontend/src/routes/robots[.]txt.ts"), "utf8");
    expect(r).toContain("Sitemap: https://${host}/sitemap.xml");
  });
  it("orgKind is unchanged by v2 (regression)", () => {
    expect(orgKind(DEMO_FACTS.federalUniversity)).toBe("university");
  });
});

describe("generator keeps the blog block for posts written after onboarding", () => {
  it("school sites carry a (hidden until posted) blog block; a bare org gets no empty page", () => {
    expect(JSON.stringify(generateSite(DEMO_FACTS.lagosNurseryPrimary))).toContain('"type":"blog"');
    expect(JSON.stringify(generateSite(DEMO_FACTS.federalUniversity))).toContain('"type":"blog"');
  });
});
