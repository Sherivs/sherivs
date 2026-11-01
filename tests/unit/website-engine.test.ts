import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BLOCKS, BLOCK_MAP, blockVisible } from "@/lib/website/catalog";
import { generateSite, orgKind, siteLocales, type Facts } from "@/lib/website/generator";
import { UI_STRINGS, tx } from "@/lib/website/i18n";
import { buildNav, pageHref } from "@/lib/website/nav";
import { parseRich, safeUrl } from "@/lib/website/sanitize";
import { contrast, ensureAA, themeFromBrand } from "@/lib/website/theme";
import { LOCALES, type SiteData } from "@/lib/website/types";
import { validateDocument } from "@/lib/website/validate";
import { DEMO_FACTS } from "../fixtures/website/demo-facts";

const MIG = readFileSync(
  "database/supabase/migrations/20261025100240_sherivs_100_website_engine.sql",
  "utf8",
);
const MIG2 = readFileSync(
  "database/supabase/migrations/20261025100260_sherivs_101_website_v2.sql",
  "utf8",
);
/** Effective seed: v1 rows + v2 rows, with v2 variant UPDATEs applied. */
const SEED = (() => {
  const rows = new Map<
    string,
    { category: string; source: string | null; variants: string[]; optIn: boolean }
  >();
  for (const m of (MIG + MIG2).matchAll(
    /\('([a-z_]+)', '[^']*', '([a-z_]+)', (NULL|'[^']*'), ARRAY\[([^\]]*)\]::text\[\], (true|false)\)/g,
  ))
    rows.set(m[1], {
      category: m[2],
      source: m[3] === "NULL" ? null : m[3].replace(/'/g, ""),
      variants: m[4].replace(/'/g, "").split(", "),
      optIn: m[5] === "true",
    });
  for (const m of MIG2.matchAll(
    /SET variants = ARRAY\[([^\]]*)\]::text\[\] WHERE key = '([a-z_]+)'/g,
  ))
    rows.get(m[2])!.variants = m[1].replace(/'/g, "").split(", ");
  return rows;
})();
const bare: SiteData = { school: { name: "Bare School", slug: "bare" } };

describe("catalog", () => {
  it("matches the SQL seed exactly (keys, variants, opt-in), v1 + v2 migrations", () => {
    for (const b of BLOCKS) {
      const row = SEED.get(b.type);
      expect(row, b.type).toBeTruthy();
      expect(row!.category, b.type).toBe(b.category);
      expect(row!.variants, b.type).toEqual(b.variants);
      expect(row!.optIn, b.type).toBe(!!b.optIn);
      expect(row!.source, b.type).toBe(b.dataSource);
    }
    expect(SEED.size).toBe(BLOCKS.length);
  });
  it("has at least 25 blocks, each with variants, fields and a guard", () => {
    expect(BLOCKS.length).toBeGreaterThanOrEqual(25);
    for (const b of BLOCKS) {
      expect(b.variants.length).toBeGreaterThan(0);
      expect(typeof b.hasContent).toBe("function");
    }
  });
  it("hides every data-bound block when its data is empty (no empty placeholders)", () => {
    for (const b of BLOCKS.filter((x) => x.type !== "hero")) {
      expect(blockVisible({ id: "x", type: b.type, props: {} }, bare, "en"), b.type).toBe(false);
    }
    expect(blockVisible({ id: "x", type: "hero", props: {} }, bare, "en")).toBe(true);
    expect(
      blockVisible(
        { id: "x", type: "news", hidden: true, props: {} },
        { ...bare, news: [{ id: "1", title: "t" }] },
        "en",
      ),
    ).toBe(false);
  });
});

describe("generator", () => {
  for (const [name, f] of Object.entries(DEMO_FACTS)) {
    it(`${name}: valid document, only blocks with content, deterministic`, () => {
      const doc = generateSite(f);
      expect(validateDocument(doc)).toEqual([]);
      for (const p of doc.pages) {
        expect(p.sections.length, p.slug).toBeGreaterThan(0);
        for (const s of p.sections)
          for (const b of s.blocks)
            if (b.type !== "blog")
              // blog blocks wait for posts written after onboarding (hidden until then)
              expect(blockVisible(b, f.data, doc.locales[0]), `${p.slug}/${b.type}`).toBe(true);
      }
      expect(JSON.stringify(generateSite(f))).toBe(JSON.stringify(doc));
      expect(doc.pages[0].slug).toBe("home");
      // staff directory is opt-in: never generated
      expect(JSON.stringify(doc)).not.toContain('"staff_directory"');
    });
  }
  it("classifies organization kinds from reality", () => {
    expect(orgKind(DEMO_FACTS.lagosNurseryPrimary)).toBe("nursery_primary");
    expect(orgKind(DEMO_FACTS.bornoSecondary)).toBe("secondary");
    expect(orgKind(DEMO_FACTS.federalUniversity)).toBe("university");
    expect(orgKind(DEMO_FACTS.stateBoard)).toBe("government");
    expect(
      orgKind({ data: { ...bare, institution_category: "polytechnic" } as unknown as SiteData }),
    ).toBe("other");
    expect(
      orgKind({ data: { school: { ...bare.school, institution_category: "polytechnic" } } }),
    ).toBe("polytechnic");
  });
  it("adapts pages to the organization (no transport page for a school without buses, faculties for a university)", () => {
    const lagos = generateSite(DEMO_FACTS.lagosNurseryPrimary);
    const uni = generateSite(DEMO_FACTS.federalUniversity);
    const borno = generateSite(DEMO_FACTS.bornoSecondary);
    expect(lagos.pages.map((p) => p.slug)).toContain("classes");
    expect(uni.pages.map((p) => p.slug)).toContain("faculties");
    expect(JSON.stringify(uni)).toContain('"departments"');
    expect(JSON.stringify(borno)).not.toContain('"transport"');
    expect(JSON.stringify(borno)).toContain('"boarding"');
    expect(borno.locales).toEqual(["en", "ha"]);
    expect(lagos.locales).toEqual(["en", "yo"]);
  });
  it("a bare organization still gets a truthful one-page site", () => {
    const doc = generateSite({ data: bare });
    expect(doc.pages.map((p) => p.slug)).toEqual(["home"]);
    expect(validateDocument(doc)).toEqual([]);
  });
  it("locales come from the interview when given", () => {
    expect(siteLocales({ data: bare, onboarding: { languages: ["ig", "pcm"] } })).toEqual([
      "en",
      "ig",
      "pcm",
    ]);
  });
});

describe("validator", () => {
  const ok = generateSite(DEMO_FACTS.lagosNurseryPrimary);
  it("rejects script URLs, unknown blocks, bad slugs, duplicate ids, missing home", () => {
    const bad = (mut: (d: typeof ok) => void) => {
      const d = structuredClone(ok);
      mut(d);
      return validateDocument(d);
    };
    expect(
      bad((d) => {
        d.pages[0].sections[0].blocks[0].props.cta_href = "javascript:alert(1)";
      }),
    ).not.toEqual([]);
    expect(
      bad((d) => {
        d.pages[0].sections[0].blocks[0].type = "html";
      }),
    ).not.toEqual([]);
    expect(
      bad((d) => {
        d.pages[1].slug = "About Us";
      }),
    ).not.toEqual([]);
    expect(
      bad((d) => {
        d.pages[1].id = d.pages[0].id;
      }),
    ).not.toEqual([]);
    expect(
      bad((d) => {
        d.pages[0].slug = "start";
      }),
    ).not.toEqual([]);
    expect(
      bad((d) => {
        d.pages[0].sections[0].blocks[0].variant = "fancy";
      }),
    ).not.toEqual([]);
  });
});

describe("theme, safety, i18n, nav", () => {
  it("corrects low-contrast brand colours to AA", () => {
    expect(contrast(ensureAA("#ffd400", "#000000"), "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(themeFromBrand({ primary_color: "not-a-colour" }).primary).toBe("#0b6b3a");
  });
  it("allows only https/relative/mailto/tel URLs", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,x")).toBeNull();
    expect(safeUrl("//evil.example")).toBeNull();
    expect(safeUrl("http://school.sch.ng/a")).toBe("https://school.sch.ng/a");
    expect(safeUrl("/admissions")).toBe("/admissions");
    expect(safeUrl("tel:+2348000000000")).toBe("tel:+2348000000000");
  });
  it("rich text never produces HTML and drops unsafe links", () => {
    const r = parseRich(
      "Hello **world** <script>x</script>\n\n- one\n- [bad](javascript:x)\n\n## Title",
    );
    expect(r[0]).toEqual({
      t: "p",
      c: [
        { t: "text", v: "Hello " },
        { t: "b", v: "world" },
        { t: "text", v: " <script>x</script>" },
      ],
    });
    expect(r[1]).toEqual({
      t: "ul",
      items: [[{ t: "text", v: "one" }], [{ t: "text", v: "bad" }]],
    });
    expect(r[2].t).toBe("h");
  });
  it("every UI string exists in all five languages", () => {
    for (const [k, v] of Object.entries(UI_STRINGS))
      for (const l of LOCALES) expect((v as Record<string, string>)[l], `${k}.${l}`).toBeTruthy();
    expect(tx({ en: "Hi" }, "ha")).toBe("Hi");
  });
  it("navigation drops pages with nothing to show and keeps preview context", () => {
    const f = DEMO_FACTS.lagosNurseryPrimary;
    const doc = generateSite(f);
    const emptyData: SiteData = { ...f.data, news: [], events: [] };
    expect(buildNav(doc, emptyData, "en").map((n) => n.slug)).not.toContain("news");
    expect(pageHref("about", { school: "abc", lang: "yo", defaultLocale: "en" })).toBe(
      "/pages/about?school=abc&lang=yo",
    );
    expect(pageHref("home", { lang: "en", defaultLocale: "en" })).toBe("/");
    expect(BLOCK_MAP.hero).toBeTruthy();
  });
});
