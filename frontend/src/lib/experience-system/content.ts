/**
 * Sherivs content architecture — typed, validated content types.
 *
 * Content is data, never JSX. Every item is validated against a Zod schema at
 * the boundary, so arbitrary stored data cannot become UI without passing
 * schema validation and an access-level check (brief §47).
 *
 * The published registry is intentionally EMPTY until real, approved content
 * exists: the resources routes render honest empty states and publish nothing
 * to navigation or the sitemap until an item is published. Nothing here is
 * sample copy.
 */
import { z } from "zod";
import { SHERIVS_BRAND, canonicalUrl } from "./sherivs-brand";

export const PUBLIC_CONTENT_KINDS = [
  "blog",
  "guides",
  "case-studies",
  "changelog",
  "docs",
] as const;
export type PublicContentKind = (typeof PUBLIC_CONTENT_KINDS)[number];

export const CONTENT_KIND_LABELS: Readonly<Record<PublicContentKind, string>> = {
  blog: "Blog",
  guides: "Guides",
  "case-studies": "Case studies",
  changelog: "Changelog",
  docs: "Documentation",
};

export const CONTENT_ACCESS_LEVELS = ["public", "authenticated", "organization", "internal"] as const;
export const CONTENT_STATUSES = ["draft", "in_review", "published", "archived"] as const;

const slug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase kebab-case");

const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "must be an ISO date");

export const contentItemSchema = z.object({
  kind: z.enum(PUBLIC_CONTENT_KINDS),
  slug,
  title: z.string().min(1).max(160),
  description: z.string().min(1).max(320),
  /** Paragraph strings; rendered as text, never as HTML. */
  body: z.array(z.string().min(1)).min(1),
  author: z.object({ name: z.string().min(1), role: z.string().optional() }),
  status: z.enum(CONTENT_STATUSES),
  publishedAt: isoDate.optional(),
  updatedAt: isoDate.optional(),
  tags: z.array(z.string().min(1)).default([]),
  categories: z.array(z.string().min(1)).default([]),
  locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).default("en"),
  accessLevel: z.enum(CONTENT_ACCESS_LEVELS).default("public"),
  seo: z
    .object({
      title: z.string().max(70).optional(),
      description: z.string().max(200).optional(),
      canonicalUrl: z.string().url().optional(),
      socialImage: z.string().url().optional(),
    })
    .default({}),
  related: z.array(slug).default([]),
});
export type ContentItem = z.infer<typeof contentItemSchema>;

export type ContentValidation =
  | { ok: true; item: ContentItem }
  | { ok: false; errors: readonly string[] };

export function validateContentItem(input: unknown): ContentValidation {
  const parsed = contentItemSchema.safeParse(input);
  if (parsed.success) return { ok: true, item: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}

/** Real, approved content. Empty by design until publication. */
export const PUBLISHED_CONTENT: readonly ContentItem[] = [];

/**
 * Items visible to the public: published, public access level, publish date
 * not in the future. Anything else is invisible to public routes, feeds and
 * the sitemap.
 */
export function publicContent(
  registry: readonly ContentItem[],
  now: Date,
  kind?: PublicContentKind,
): readonly ContentItem[] {
  return registry
    .filter(
      (c) =>
        c.status === "published" &&
        c.accessLevel === "public" &&
        c.publishedAt !== undefined &&
        Date.parse(c.publishedAt) <= now.getTime() &&
        (kind === undefined || c.kind === kind),
    )
    .slice()
    .sort((a, b) => Date.parse(b.publishedAt ?? "") - Date.parse(a.publishedAt ?? ""));
}

export function findPublicContent(
  registry: readonly ContentItem[],
  now: Date,
  kind: PublicContentKind,
  contentSlug: string,
): ContentItem | undefined {
  return publicContent(registry, now, kind).find((c) => c.slug === contentSlug);
}

export function contentPath(item: Pick<ContentItem, "kind" | "slug">): string {
  return `/resources/${item.kind}/${item.slug}`;
}

/** Reading time at 220 wpm, never less than one minute. */
export function readingTimeMinutes(body: readonly string[]): number {
  const words = body.join(" ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 220));
}

export function relatedContent(
  registry: readonly ContentItem[],
  now: Date,
  item: ContentItem,
  limit = 3,
): readonly ContentItem[] {
  const visible = publicContent(registry, now).filter((c) => c.slug !== item.slug || c.kind !== item.kind);
  const explicit = visible.filter((c) => item.related.includes(c.slug));
  const byTag = visible.filter(
    (c) => !explicit.includes(c) && c.tags.some((t) => item.tags.includes(t)),
  );
  return [...explicit, ...byTag].slice(0, limit);
}

/* ── Structured data ─────────────────────────────────────────────────── */

type JsonLd = Record<string, unknown>;

export function organizationJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SHERIVS_BRAND.name,
    url: SHERIVS_BRAND.canonicalOrigin,
    description: SHERIVS_BRAND.description,
    logo: canonicalUrl("/icons/icon-512.png"),
  };
}

export function websiteJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SHERIVS_BRAND.name,
    url: SHERIVS_BRAND.canonicalOrigin,
  };
}

export function breadcrumbJsonLd(trail: ReadonlyArray<{ label: string; path: string }>): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.label,
      item: canonicalUrl(crumb.path),
    })),
  };
}

export function articleJsonLd(item: ContentItem): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": item.kind === "docs" ? "TechArticle" : "Article",
    headline: item.title,
    description: item.description,
    inLanguage: item.locale,
    datePublished: item.publishedAt,
    dateModified: item.updatedAt ?? item.publishedAt,
    author: { "@type": "Person", name: item.author.name },
    publisher: { "@type": "Organization", name: SHERIVS_BRAND.name },
    mainEntityOfPage: item.seo.canonicalUrl ?? canonicalUrl(contentPath(item)),
    image: item.seo.socialImage,
  };
}

/** Serialize JSON-LD for a <script> tag; `<` is escaped so content can never close the tag. */
export function serializeJsonLd(data: JsonLd | readonly JsonLd[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/* ── Feeds ───────────────────────────────────────────────────────────── */

const xmlEscape = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export function buildRssFeed(items: readonly ContentItem[], now: Date): string {
  const entries = publicContent(items, now)
    .map((c) =>
      [
        "    <item>",
        `      <title>${xmlEscape(c.title)}</title>`,
        `      <link>${xmlEscape(canonicalUrl(contentPath(c)))}</link>`,
        `      <guid isPermaLink="true">${xmlEscape(canonicalUrl(contentPath(c)))}</guid>`,
        `      <pubDate>${new Date(c.publishedAt ?? now).toUTCString()}</pubDate>`,
        `      <description>${xmlEscape(c.description)}</description>`,
        "    </item>",
      ].join("\n"),
    )
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    `    <title>${xmlEscape(SHERIVS_BRAND.name)} — Resources</title>`,
    `    <link>${xmlEscape(canonicalUrl("/resources"))}</link>`,
    `    <description>${xmlEscape(SHERIVS_BRAND.description)}</description>`,
    entries,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

/** Pagination over a content list (1-based pages). */
export function paginate<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
): { items: readonly T[]; page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safe = Math.min(Math.max(1, Math.trunc(page) || 1), pageCount);
  return { items: items.slice((safe - 1) * pageSize, safe * pageSize), page: safe, pageCount };
}
