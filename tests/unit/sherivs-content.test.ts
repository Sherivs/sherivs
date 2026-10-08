/**
 * Sherivs content architecture — schema validation, visibility rules,
 * structured-data and feed safety. Content is data, never HTML.
 */
import { describe, expect, it } from "vitest";
import {
  PUBLISHED_CONTENT,
  articleJsonLd,
  breadcrumbJsonLd,
  buildRssFeed,
  contentPath,
  findPublicContent,
  paginate,
  publicContent,
  readingTimeMinutes,
  relatedContent,
  serializeJsonLd,
  validateContentItem,
  type ContentItem,
} from "@/lib/experience-system/content";

const base = {
  kind: "guides",
  slug: "getting-started",
  title: "Getting started",
  description: "How to begin.",
  body: ["First paragraph.", "Second paragraph."],
  author: { name: "Sherivs" },
  status: "published",
  publishedAt: "2026-01-10T00:00:00Z",
};
const NOW = new Date("2026-06-01T00:00:00Z");
const item = (over: Record<string, unknown> = {}): ContentItem => {
  const v = validateContentItem({ ...base, ...over });
  if (!v.ok) throw new Error(v.errors.join(";"));
  return v.item;
};

describe("published registry", () => {
  it("is empty until real content is approved — no sample copy", () => {
    expect(PUBLISHED_CONTENT).toEqual([]);
    expect(publicContent(PUBLISHED_CONTENT, NOW)).toEqual([]);
  });
});

describe("validateContentItem", () => {
  it("accepts a well-formed item and applies safe defaults", () => {
    const v = item();
    expect(v.accessLevel).toBe("public");
    expect(v.locale).toBe("en");
    expect(v.tags).toEqual([]);
  });

  it.each([
    ["unknown kind", { kind: "press" }],
    ["bad slug", { slug: "Not A Slug" }],
    ["empty body", { body: [] }],
    ["empty title", { title: "" }],
    ["bad locale", { locale: "english" }],
    ["bad date", { publishedAt: "yesterday" }],
    ["unknown status", { status: "live" }],
  ])("rejects %s", (_name, over) => {
    expect(validateContentItem({ ...base, ...over }).ok).toBe(false);
  });

  it("rejects non-object input without throwing", () => {
    expect(validateContentItem(null).ok).toBe(false);
    expect(validateContentItem("<script>").ok).toBe(false);
  });
});

describe("public visibility", () => {
  const draft = item({ slug: "d", status: "draft" });
  const review = item({ slug: "r", status: "in_review" });
  const archived = item({ slug: "a", status: "archived" });
  const future = item({ slug: "f", publishedAt: "2027-01-01T00:00:00Z" });
  const internal = item({ slug: "i", accessLevel: "internal" });
  const org = item({ slug: "o", accessLevel: "organization" });
  const undated = item({ slug: "u", publishedAt: undefined });
  const visible = item({ slug: "v" });
  const all = [draft, review, archived, future, internal, org, undated, visible];

  it("shows only published, public, already-dated items", () => {
    expect(publicContent(all, NOW).map((c) => c.slug)).toEqual(["v"]);
  });

  it("does not resolve a hidden item by slug", () => {
    expect(findPublicContent(all, NOW, "guides", "d")).toBeUndefined();
    expect(findPublicContent(all, NOW, "guides", "i")).toBeUndefined();
    expect(findPublicContent(all, NOW, "guides", "v")?.slug).toBe("v");
  });

  it("sorts newest first", () => {
    const a = item({ slug: "old", publishedAt: "2026-01-01T00:00:00Z" });
    const b = item({ slug: "new", publishedAt: "2026-03-01T00:00:00Z" });
    expect(publicContent([a, b], NOW).map((c) => c.slug)).toEqual(["new", "old"]);
  });

  it("only relates visible items", () => {
    const main = item({ slug: "main", related: ["d", "v"] });
    expect(relatedContent([main, draft, visible], NOW, main).map((c) => c.slug)).toEqual(["v"]);
  });
});

describe("paths, reading time, pagination", () => {
  it("builds resource paths", () => {
    expect(contentPath({ kind: "case-studies", slug: "x" })).toBe("/resources/case-studies/x");
  });

  it("never reports less than one minute", () => {
    expect(readingTimeMinutes(["short"])).toBe(1);
    expect(readingTimeMinutes([Array(661).fill("w").join(" ")])).toBe(4);
  });

  it("clamps pages and tolerates junk", () => {
    const list = Array.from({ length: 25 }, (_, i) => i);
    expect(paginate(list, 1, 10).items).toHaveLength(10);
    expect(paginate(list, 3, 10).items).toHaveLength(5);
    expect(paginate(list, 99, 10).page).toBe(3);
    expect(paginate(list, Number.NaN, 10).page).toBe(1);
    expect(paginate([], 1, 10)).toEqual({ items: [], page: 1, pageCount: 1 });
  });
});

describe("structured data and feeds are injection-safe", () => {
  it("escapes `<` so content cannot close the script tag", () => {
    const hostile = item({ title: "</script><script>alert(1)</script>" });
    const out = serializeJsonLd(articleJsonLd(hostile));
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out).headline).toBe("</script><script>alert(1)</script>");
  });

  it("emits canonical breadcrumb positions", () => {
    const ld = breadcrumbJsonLd([
      { label: "Home", path: "/" },
      { label: "Platform", path: "/platform" },
    ]) as { itemListElement: Array<{ position: number; item: string }> };
    expect(ld.itemListElement.map((e) => e.position)).toEqual([1, 2]);
    expect(ld.itemListElement[1].item).toBe("https://sherivs.com/platform");
  });

  it("escapes XML in the RSS feed and lists only public items", () => {
    const hostile = item({ slug: "x", title: "A & B <b>bold</b>", description: 'He said "hi"' });
    const hidden = item({ slug: "h", status: "draft", title: "Secret draft" });
    const xml = buildRssFeed([hostile, hidden], NOW);
    expect(xml).toContain("A &amp; B &lt;b&gt;bold&lt;/b&gt;");
    expect(xml).not.toContain("<b>bold</b>");
    expect(xml).not.toContain("Secret draft");
    expect(buildRssFeed([], NOW)).toContain("<channel>");
  });
});
