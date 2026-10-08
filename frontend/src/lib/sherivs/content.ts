/**
 * Sherivs content architecture — typed, validated, render-safe.
 *
 * Content is data validated by Zod at the boundary; bodies are structured blocks
 * (never raw HTML), so nothing in a content record can inject markup. Only
 * `published` + `public` items dated on or before "now" are ever returned to the
 * public plane. Organization and platform content types share the same envelope.
 */
import { z } from "zod";
import { PUBLIC_ORIGIN, BRAND_NAME } from "./brand";

export const CONTENT_SECTIONS = ["docs", "changelog", "blog", "guides", "case-studies"] as const;
export type ContentSection = (typeof CONTENT_SECTIONS)[number];

export const SECTION_META: Readonly<
  Record<ContentSection, { title: string; description: string; emptyTitle: string; emptyBody: string }>
> = {
  docs: {
    title: "Documentation",
    description: "Concepts and reference for how Sherivs works.",
    emptyTitle: "No documentation published yet",
    emptyBody: "Documentation is published here as it is reviewed.",
  },
  changelog: {
    title: "Changelog",
    description: "What changed in Sherivs, and when.",
    emptyTitle: "No releases recorded yet",
    emptyBody: "Release notes appear here when a release is published.",
  },
  blog: {
    title: "Blog",
    description: "Articles from the Sherivs team.",
    emptyTitle: "No articles published yet",
    emptyBody: "Nothing has been published to the blog. Articles appear here once they are written and reviewed.",
  },
  guides: {
    title: "Guides",
    description: "Task-oriented guides for running an organization on Sherivs.",
    emptyTitle: "No guides published yet",
    emptyBody: "Guides appear here once they are written and reviewed.",
  },
  "case-studies": {
    title: "Case studies",
    description: "Verified customer outcomes.",
    emptyTitle: "No case studies published yet",
    emptyBody:
      "Case studies are published only with a customer's consent and verified outcomes. None have been published.",
  },
};

export const ContentBlock = z.discriminatedUnion("type", [
  z.object({ type: z.literal("p"), text: z.string().min(1) }),
  z.object({ type: z.literal("h2"), text: z.string().min(1) }),
  z.object({ type: z.literal("h3"), text: z.string().min(1) }),
  z.object({ type: z.literal("ul"), items: z.array(z.string().min(1)).min(1) }),
  z.object({ type: z.literal("code"), language: z.string().default("text"), text: z.string().min(1) }),
  z.object({
    type: z.literal("callout"),
    tone: z.enum(["note", "warning"]).default("note"),
    text: z.string().min(1),
  }),
]);
export type ContentBlock = z.infer<typeof ContentBlock>;

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/, "ISO date required");

export const ContentItem = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  section: z.enum(CONTENT_SECTIONS),
  title: z.string().min(3).max(120),
  description: z.string().min(20).max(300),
  body: z.array(ContentBlock).min(1),
  author: z.object({ name: z.string().min(1), role: z.string().optional() }),
  status: z.enum(["draft", "published", "archived"]),
  publishedAt: iso,
  updatedAt: iso,
  tags: z.array(z.string()).default([]),
  categories: z.array(z.string()).default([]),
  locale: z.string().default("en"),
  access: z.enum(["public", "authenticated"]).default("public"),
  seo: z
    .object({
      title: z.string().max(70).optional(),
      description: z.string().max(200).optional(),
      canonical: z.string().url().optional(),
      socialImage: z.string().optional(),
    })
    .default({}),
});
export type ContentItem = z.infer<typeof ContentItem>;

export function parseContent(input: unknown): ContentItem[] {
  return z.array(ContentItem).parse(input);
}

/** Public-plane visibility: published, public, and not scheduled in the future. */
export function isPubliclyVisible(item: ContentItem, now: Date = new Date()): boolean {
  return item.status === "published" && item.access === "public" && new Date(item.publishedAt) <= now;
}

export function visibleItems(items: readonly ContentItem[], section?: ContentSection, now = new Date()) {
  return items
    .filter((i) => isPubliclyVisible(i, now) && (!section || i.section === section))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export function readingTimeMinutes(item: ContentItem): number {
  const words = item.body
    .map((b) => ("text" in b ? b.text : "items" in b ? b.items.join(" ") : ""))
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

export function relatedItems(items: readonly ContentItem[], current: ContentItem, limit = 3): ContentItem[] {
  const tagSet = new Set(current.tags);
  return visibleItems(items)
    .filter((i) => !(i.slug === current.slug && i.section === current.section))
    .map((i) => ({ i, score: (i.section === current.section ? 1 : 0) + i.tags.filter((t) => tagSet.has(t)).length * 2 }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.i);
}

export function searchItems(items: readonly ContentItem[], query: string): ContentItem[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return visibleItems(items).filter((i) => {
    const hay = `${i.title} ${i.description} ${i.tags.join(" ")} ${i.categories.join(" ")}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

export interface Page<T> {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
}

export function paginate<T>(items: readonly T[], page: number, pageSize = 10): Page<T> {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  return { items: items.slice((p - 1) * pageSize, p * pageSize), page: p, pageCount, total };
}

export const contentPath = (item: Pick<ContentItem, "section" | "slug">) => `/resources/${item.section}/${item.slug}`;

/* ───────────── SEO / structured data / feeds ───────────── */

export interface SeoMeta {
  readonly title: string;
  readonly description: string;
  readonly canonical: string;
  readonly image?: string;
}

export function seoFor(item: ContentItem): SeoMeta {
  return {
    title: item.seo.title ?? `${item.title} — ${BRAND_NAME}`,
    description: item.seo.description ?? item.description,
    canonical: item.seo.canonical ?? `${PUBLIC_ORIGIN}${contentPath(item)}`,
    image: item.seo.socialImage ? new URL(item.seo.socialImage, PUBLIC_ORIGIN).toString() : undefined,
  };
}

/** Standard head meta tags (OpenGraph + Twitter) for a page. */
export function metaTags(seo: SeoMeta, type: "website" | "article" = "website") {
  const image = seo.image ?? `${PUBLIC_ORIGIN}/og-image.png`;
  return [
    { title: seo.title },
    { name: "description", content: seo.description },
    { property: "og:title", content: seo.title },
    { property: "og:description", content: seo.description },
    { property: "og:type", content: type },
    { property: "og:url", content: seo.canonical },
    { property: "og:site_name", content: BRAND_NAME },
    { property: "og:image", content: image },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: seo.title },
    { name: "twitter:description", content: seo.description },
    { name: "twitter:image", content: image },
  ];
}

export function articleJsonLd(item: ContentItem) {
  const seo = seoFor(item);
  return {
    "@context": "https://schema.org",
    "@type": item.section === "docs" ? "TechArticle" : "Article",
    headline: item.title,
    description: seo.description,
    datePublished: item.publishedAt,
    dateModified: item.updatedAt,
    inLanguage: item.locale,
    mainEntityOfPage: seo.canonical,
    author: { "@type": "Organization", name: item.author.name },
    publisher: { "@type": "Organization", name: BRAND_NAME, url: PUBLIC_ORIGIN },
  };
}

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: BRAND_NAME,
    url: PUBLIC_ORIGIN,
    description: "Institutional intelligence infrastructure.",
  };
}

export function breadcrumbJsonLd(crumbs: readonly { label: string; href?: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.label,
      ...(c.href ? { item: `${PUBLIC_ORIGIN}${c.href === "/" ? "" : c.href}` } : {}),
    })),
  };
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export function buildRss(items: readonly ContentItem[], now = new Date()): string {
  const feed = visibleItems(items, undefined, now).filter((i) => i.section === "blog" || i.section === "changelog");
  const entries = feed
    .map(
      (i) => `    <item>
      <title>${xmlEscape(i.title)}</title>
      <link>${xmlEscape(PUBLIC_ORIGIN + contentPath(i))}</link>
      <guid isPermaLink="true">${xmlEscape(PUBLIC_ORIGIN + contentPath(i))}</guid>
      <pubDate>${new Date(i.publishedAt).toUTCString()}</pubDate>
      <description>${xmlEscape(i.description)}</description>
    </item>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${xmlEscape(BRAND_NAME)} — blog and changelog</title>
    <link>${PUBLIC_ORIGIN}/resources</link>
    <description>Articles and release notes from ${xmlEscape(BRAND_NAME)}.</description>
    <language>en</language>
${entries}
  </channel>
</rss>
`;
}
